// we-report data backend — ASP.NET Core implementation of protocol/openapi.yaml (v1).
// SQL Server, PostgreSQL and SQLite. Verified by tools/protocol-conformance.
using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using WeReport.Backend;

var builder = WebApplication.CreateBuilder(args);
var config = BackendConfig.Load(builder.Configuration);

if (!config.IsLoopback && config.AuthToken is null && !config.Demo)
{
    Console.Error.WriteLine($"Refusing to listen on {config.Host} without authentication. Set WE_REPORT_AUTH_TOKEN, " +
        "plug your own auth into Authorize() in Program.cs, or keep WE_REPORT_HOST=127.0.0.1.");
    return 1;
}

builder.WebHost.UseUrls($"http://{(config.Host == "localhost" ? "127.0.0.1" : config.Host)}:{config.Port}");
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(config.CorsOrigins).WithMethods("GET", "POST", "PUT", "DELETE").WithHeaders("Content-Type", "Authorization")));
builder.Services.AddRateLimiter(o =>
{
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "", _ =>
            new FixedWindowRateLimiterOptions { PermitLimit = config.RateLimitPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.OnRejected = async (ctx, ct) => await WriteError(ctx.HttpContext, 429, "Too many requests; try again in a minute.");
});

var app = builder.Build();
var databases = new ConcurrentDictionary<string, Database>();
var guard = new FetchGuard(config.FetchAllowHosts);

// Unknown paths (404) and known paths called with another method (405, from routing) answer JSON too.
app.UseStatusCodePages(ctx => ctx.HttpContext.Response.StatusCode is 404 or 405
    ? WriteError(ctx.HttpContext, ctx.HttpContext.Response.StatusCode, ctx.HttpContext.Response.StatusCode == 404 ? "Not found." : "Method not allowed.")
    : Task.CompletedTask);
app.UseCors();
app.UseRateLimiter();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    // Caps chunked bodies too, which have no Content-Length to check up front.
    if (ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
        limit.MaxRequestBodySize = 1024 * 1024;
    if (HttpMethods.IsOptions(ctx.Request.Method))
    {
        await next();
        return;
    }
    if (!Authorize(ctx))
    {
        await WriteError(ctx, 401, "Not authorized.");
        return;
    }
    // A page elsewhere can POST a plain form (text/plain) without a CORS preflight; JSON it cannot.
    if ((HttpMethods.IsPost(ctx.Request.Method) || HttpMethods.IsPut(ctx.Request.Method)) && !ctx.Request.HasJsonContentType())
    {
        await WriteError(ctx, 415, "Send the body as application/json.");
        return;
    }
    try
    {
        await next();
    }
    catch (ApiError e)
    {
        await WriteError(ctx, e.Status, e.Message);
    }
    catch (JsonException)
    {
        await WriteError(ctx, 400, "Body must be JSON.");
    }
    catch (Exception e)
    {
        // Unexpected errors are logged here and never echoed: they could contain internals.
        app.Logger.LogError(e, "Request failed");
        await WriteError(ctx, 500, "Internal error.");
    }
});

app.MapGet("/v1/info", () => new
{
    protocol = 1,
    server = "we-report-dotnet",
    capabilities = new { webServiceFetch = config.WebServiceFetch, demo = config.Demo, grid = true, layouts = !config.Demo },
});

// Never the connection string: ids, names, dialects and what is allowed.
app.MapGet("/v1/connections", () => config.Connections.Select(c => new { id = c.Id, name = c.Name, dialect = c.Dialect, freeSql = c.AllowFreeSql }));

app.MapGet("/v1/connections/{id}/schema", async (string id, CancellationToken ct) =>
{
    var (_, db) = Open(id);
    var tables = await db.SchemaAsync(ct);
    return new { tables = tables.Select(t => new { name = t.Name, columns = t.Columns.Select(c => new { name = c.Name, type = c.Type }) }) };
});

app.MapPost("/v1/connections/{id}/query", async (string id, HttpRequest request, CancellationToken ct) =>
{
    var (connection, db) = Open(id);
    using var doc = await ReadJson(request, ct);
    var body = doc.RootElement;
    var parameters = body.TryGetProperty("params", out var p) ? p : default;
    BuiltQuery built;
    if (body.TryGetProperty("sql", out var sql))
    {
        if (!connection.AllowFreeSql) throw new ApiError(403, "Free SQL is not allowed on this connection. Use the query builder.");
        built = QueryBuilder.BuildFreeSql(sql.GetString(), db, parameters, connection.MaxRows);
    }
    else
    {
        built = QueryBuilder.BuildSelect(body.TryGetProperty("query", out var q) ? q : default, await db.SchemaAsync(ct), db, parameters, connection.MaxRows);
    }
    List<Dictionary<string, object?>> rows;
    long? total = null;
    try
    {
        rows = await db.QueryAsync(built, connection.TimeoutSeconds, ct);
        if (body.TryGetProperty("count", out var count) && count.ValueKind == JsonValueKind.True)
            total = Convert.ToInt64((await db.QueryAsync(built with { Sql = built.CountSql }, connection.TimeoutSeconds, ct))[0]["total"]);
    }
    catch (Exception e) when (e is not ApiError and not OperationCanceledException)
    {
        if (e.Message.Contains("timeout", StringComparison.OrdinalIgnoreCase) || e.Message.Contains("canceling statement", StringComparison.OrdinalIgnoreCase))
            throw new ApiError(504, "The query took too long and was stopped.");
        // Driver messages can name hosts, users and databases: logged here, never sent.
        app.Logger.LogWarning(e, "Query on {Connection} failed", id);
        throw new ApiError(400, "The query failed. The backend log has the details.");
    }
    var truncated = rows.Count > built.Limit;
    if (truncated) rows.RemoveRange(built.Limit, rows.Count - built.Limit);
    var columns = rows.Count == 0 ? [] : rows[0].Select(kv => new { name = kv.Key, type = kv.Value switch { null => "unknown", string => "string", bool => "boolean", _ => "number" } }).ToList();
    // total only when asked for: absent, not null, otherwise
    return total is null ? Results.Json(new { columns, rows, truncated }) : Results.Json(new { columns, rows, truncated, total });
});

// Saved grid layouts, views and sheets (protocol 1.1): one JSON file per key, named by the key in
// hex, so no key can reach outside the directory.
app.MapGet("/v1/layouts/{key}", async (string key, CancellationToken ct) =>
{
    try
    {
        return Results.Text(await File.ReadAllTextAsync(LayoutFile(key), ct), "application/json; charset=utf-8");
    }
    catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
    {
        throw new ApiError(404, "No layout saved under this key.");
    }
});

app.MapPut("/v1/layouts/{key}", async (string key, HttpRequest request, CancellationToken ct) =>
{
    var file = LayoutFile(key);
    using var doc = await ReadJson(request, ct, MaxLayoutBytes);
    if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new ApiError(400, "A layout is a JSON object.");
    Directory.CreateDirectory(config.LayoutsDir);
    // Written next to the target and renamed, so a reader never sees half a file.
    var tmp = $"{file}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
    await File.WriteAllTextAsync(tmp, doc.RootElement.GetRawText(), ct);
    File.Move(tmp, file, overwrite: true);
    return Results.NoContent();
});

app.MapDelete("/v1/layouts/{key}", (string key) =>
{
    var file = LayoutFile(key);
    if (File.Exists(file)) File.Delete(file);
    return Results.NoContent();
});

app.MapPost("/v1/webservice/fetch", async (HttpRequest request, HttpResponse response, CancellationToken ct) =>
{
    if (!config.WebServiceFetch) throw new ApiError(403, "Web service fetching is disabled on this backend.");
    using var doc = await ReadJson(request, ct);
    var body = doc.RootElement;
    var url = body.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString()! : throw new ApiError(400, "url is required.");
    var method = body.TryGetProperty("method", out var m) ? m.GetString() ?? "GET" : "GET";
    var headers = body.TryGetProperty("headers", out var h) && h.ValueKind == JsonValueKind.Array
        ? h.EnumerateArray().Select(x => (x.GetProperty("name").GetString() ?? "", x.TryGetProperty("value", out var v) ? v.GetString() ?? "" : "")).Where(x => x.Item1 != "").ToList()
        : [];
    var (contentType, bytes) = await guard.FetchAsync(url, method, headers, body.TryGetProperty("body", out var b) ? b.GetString() : null, ct);
    // Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
    response.ContentType = contentType;
    // Someone else's content: never active on this backend's origin.
    response.Headers.ContentSecurityPolicy = "sandbox";
    await response.Body.WriteAsync(bytes, ct);
});


app.Lifetime.ApplicationStarted.Register(() =>
    Console.WriteLine($"we-report backend on http://{config.Host}:{config.Port} — connections: " +
        string.Join(", ", config.Connections.Select(c => $"{c.Id} ({c.Dialect})")) + (config.Demo ? " — DEMO MODE" : "")));
app.Run();
return 0;

(ConnectionConfig, Database) Open(string id)
{
    var c = config.Connections.FirstOrDefault(x => x.Id == id) ?? throw new ApiError(404, $"No connection \"{id}\".");
    return (c, databases.GetOrAdd(id, _ => Database.Create(c)));
}

string LayoutFile(string key)
{
    // Route values arrive URL-decoded.
    if (!LayoutKey().IsMatch(key)) throw new ApiError(400, "Layout keys are 1-100 letters, digits and _ . : - characters.");
    if (config.Demo) throw new ApiError(403, "Saved layouts are disabled on this backend.");
    return Path.Combine(config.LayoutsDir, Convert.ToHexStringLower(System.Text.Encoding.UTF8.GetBytes(key)) + ".json");
}

/// <summary>
/// Who may call. Without a token only local callers are accepted — unless this is the public demo,
/// which serves read-only sample data to anyone. Replace with your own auth (cookie, JWT …) here.
/// </summary>
bool Authorize(HttpContext ctx)
{
    if (config.AuthToken is not null) return ctx.Request.Headers.Authorization == $"Bearer {config.AuthToken}";
    if (config.Demo) return true;
    // Local only — and addressed as a local host, so a page whose domain was re-pointed at
    // 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
    var host = ctx.Request.Host.Host.Trim('[', ']');
    var localHost = host == "localhost" || (IPAddress.TryParse(host, out var h) && IPAddress.IsLoopback(h));
    return localHost && ctx.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip.IsIPv4MappedToIPv6 ? ip.MapToIPv4() : ip);
}

static async Task<JsonDocument> ReadJson(HttpRequest request, CancellationToken ct, int maxBytes = MaxBody)
{
    if (request.ContentLength > MaxBody) throw new ApiError(413, "Request body too large.");
    try
    {
        if (maxBytes >= MaxBody) return await JsonDocument.ParseAsync(request.Body, default, ct);
        // Read to the end (Kestrel caps it at MaxBody) so the client gets the 413, not a reset connection.
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, ct);
        if (buffer.Length > maxBytes) throw new ApiError(413, "Request body too large.");
        return JsonDocument.Parse(buffer.ToArray());
    }
    catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
    {
        throw new ApiError(413, "Request body too large.");
    }
}

static Task WriteError(HttpContext ctx, int status, string message)
{
    ctx.Response.StatusCode = status;
    return ctx.Response.WriteAsJsonAsync(new { error = message });
}

partial class Program
{
    const int MaxBody = 1024 * 1024;
    const int MaxLayoutBytes = 256 * 1024;

    [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,99}\z")]
    private static partial System.Text.RegularExpressions.Regex LayoutKey();
}
