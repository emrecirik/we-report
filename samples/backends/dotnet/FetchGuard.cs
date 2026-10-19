using System.Net;
using System.Net.Sockets;

namespace WeReport.Backend;

/// <summary>
/// Fetches web services for reports while refusing internal addresses (SSRF). The check runs in the
/// socket's ConnectCallback on the address actually connected to, so DNS rebinding cannot slip past
/// it; redirects are followed by hand and checked again.
/// </summary>
public sealed class FetchGuard
{
    const int MaxBytes = 5 * 1024 * 1024;
    const int MaxRedirects = 3;
    readonly HttpClient _client;
    readonly HashSet<string> _allowHosts;

    public FetchGuard(HashSet<string> allowHosts)
    {
        _allowHosts = allowHosts;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            ConnectCallback = async (context, ct) =>
            {
                var host = context.DnsEndPoint.Host.Trim('[', ']');
                var addresses = IPAddress.TryParse(host, out var literal) ? [literal] : await Dns.GetHostAddressesAsync(host, ct);
                if (!_allowHosts.Contains(host.ToLowerInvariant()) && (addresses.Length == 0 || addresses.Any(IsBlocked)))
                    throw new ApiError(403, $"Refusing to fetch {host}: it resolves to an internal address.");
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try
                {
                    await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            },
        };
        _client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    }

    static readonly (IPAddress Base, int Bits)[] V4Blocked =
    [
        (IPAddress.Parse("0.0.0.0"), 8), (IPAddress.Parse("10.0.0.0"), 8), (IPAddress.Parse("100.64.0.0"), 10),
        (IPAddress.Parse("127.0.0.0"), 8), (IPAddress.Parse("169.254.0.0"), 16), (IPAddress.Parse("172.16.0.0"), 12),
        (IPAddress.Parse("192.0.0.0"), 24), (IPAddress.Parse("192.168.0.0"), 16), (IPAddress.Parse("198.18.0.0"), 15),
        (IPAddress.Parse("224.0.0.0"), 4), (IPAddress.Parse("240.0.0.0"), 4),
    ];

    public static bool IsBlocked(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var n = ToUInt(ip);
            return V4Blocked.Any(r => n >> (32 - r.Bits) == ToUInt(r.Base) >> (32 - r.Bits));
        }
        return IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.IPv6Any) || ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal
            || ip.IsIPv6Multicast || (ip.GetAddressBytes()[0] & 0xFE) == 0xFC; // fc00::/7 unique local
    }

    static uint ToUInt(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return (uint)(b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]);
    }

    public async Task<(string ContentType, byte[] Body)> FetchAsync(string url, string method, IReadOnlyList<(string Name, string Value)> headers, string? body, CancellationToken requestAborted)
    {
        // One deadline for the whole fetch, redirects and a slowly dripping body included.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        var ct = deadline.Token;
        var current = url;
        Uri? origin = Uri.TryCreate(url, UriKind.Absolute, out var o) ? o : null;
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            if (!Uri.TryCreate(current, UriKind.Absolute, out var uri)) throw new ApiError(400, "Invalid URL.");
            if (uri.Scheme is not ("http" or "https")) throw new ApiError(400, "Only http and https URLs can be fetched.");
            using var request = new HttpRequestMessage(method == "POST" ? HttpMethod.Post : HttpMethod.Get, uri);
            // The caller's headers (Authorization, cookies) are for the original site only.
            var sameOrigin = origin is not null && Uri.Compare(uri, origin, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;
            if (sameOrigin) foreach (var (name, value) in headers) request.Headers.TryAddWithoutValidation(name, value);
            if (method == "POST" && body is not null) request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
            HttpResponseMessage response;
            try
            {
                response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            }
            catch (HttpRequestException e) when (e.InnerException is ApiError api)
            {
                throw api;
            }
            catch (HttpRequestException e)
            {
                throw new ApiError(502, $"Could not reach the web service: {e.Message}");
            }
            catch (TaskCanceledException)
            {
                throw new ApiError(504, "The web service did not answer in time.");
            }
            using (response)
            {
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
                {
                    current = new Uri(uri, location).ToString();
                    continue;
                }
                if ((int)response.StatusCode >= 400) throw new ApiError(502, $"The web service answered {(int)response.StatusCode}.");
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int read;
                try
                {
                    while ((read = await stream.ReadAsync(chunk, ct)) > 0)
                    {
                        if (buffer.Length + read > MaxBytes) throw new ApiError(502, "The response is larger than 5 MB.");
                        buffer.Write(chunk, 0, read);
                    }
                }
                catch (OperationCanceledException) when (!requestAborted.IsCancellationRequested)
                {
                    throw new ApiError(504, "The web service did not answer in time.");
                }
                return (response.Content.Headers.ContentType?.ToString() ?? "application/octet-stream", buffer.ToArray());
            }
        }
        throw new ApiError(502, "Too many redirects.");
    }
}
