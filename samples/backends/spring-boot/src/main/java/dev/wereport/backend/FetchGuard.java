package dev.wereport.backend;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Fetches web services for reports while refusing internal addresses (SSRF). The host is resolved
 * once, every address is checked, and the socket connects to the checked address — TLS still
 * verifies the real host name (SNI + certificate) — so DNS rebinding cannot slip past the check.
 * A small HTTP/1.1 client is used because the JDK HttpClient cannot be pinned to an address.
 */
public final class FetchGuard {
  private static final int MAX_BYTES = 5 * 1024 * 1024;
  private static final int MAX_HEADER_BYTES = 64 * 1024;
  private static final int MAX_REDIRECTS = 3;
  private static final long TIMEOUT_NANOS = 10_000_000_000L;
  private static final Set<String> RESTRICTED_HEADERS = Set.of("host", "connection", "content-length", "transfer-encoding", "expect", "upgrade", "accept-encoding");

  private final Set<String> allowHosts;

  public FetchGuard(Set<String> allowHosts) {
    this.allowHosts = allowHosts;
  }

  public record Result(String contentType, byte[] body) {}

  static boolean isBlocked(InetAddress ip) {
    if (ip.isLoopbackAddress() || ip.isAnyLocalAddress() || ip.isLinkLocalAddress() || ip.isSiteLocalAddress() || ip.isMulticastAddress()) {
      return true;
    }
    byte[] b = ip.getAddress();
    if (ip instanceof Inet4Address) {
      int first = b[0] & 0xFF;
      int second = b[1] & 0xFF;
      return first == 0 || (first == 100 && second >= 64 && second <= 127) || (first == 192 && second == 0 && (b[2] & 0xFF) == 0)
          || (first == 198 && (second == 18 || second == 19)) || first >= 224;
    }
    if (ip instanceof Inet6Address) {
      boolean mapped = b[10] == (byte) 0xFF && b[11] == (byte) 0xFF && java.util.stream.IntStream.range(0, 10).allMatch(i -> b[i] == 0);
      boolean nat64 = (b[0] & 0xFF) == 0x00 && (b[1] & 0xFF) == 0x64 && (b[2] & 0xFF) == 0xFF && (b[3] & 0xFF) == 0x9B;
      if (mapped || nat64) {
        try {
          return isBlocked(InetAddress.getByAddress(new byte[] {b[12], b[13], b[14], b[15]}));
        } catch (UnknownHostException e) {
          return true;
        }
      }
      // ::/96 (deprecated IPv4-compatible) and fc00::/7 (unique local).
      boolean compatible = java.util.stream.IntStream.range(0, 12).allMatch(i -> b[i] == 0);
      return compatible || (b[0] & 0xFE) == 0xFC;
    }
    return true;
  }

  /** Every address of the host, all checked; IPv4 first, as many networks have no IPv6 route. */
  private List<InetAddress> resolve(String host) {
    try {
      InetAddress[] addresses = InetAddress.getAllByName(host);
      if (!allowHosts.contains(host.toLowerCase(Locale.ROOT))) {
        for (InetAddress a : addresses) {
          if (isBlocked(a)) throw new ApiError(403, "Refusing to fetch " + host + ": it resolves to an internal address.");
        }
      }
      return java.util.Arrays.stream(addresses).sorted(java.util.Comparator.comparing(a -> a instanceof Inet4Address ? 0 : 1)).toList();
    } catch (UnknownHostException e) {
      throw new ApiError(502, "Could not resolve " + host + ".");
    }
  }

  private static String origin(URI u) {
    return u.getScheme() + "://" + Objects.toString(u.getHost(), "").toLowerCase(Locale.ROOT) + ":" + port(u);
  }

  private static int port(URI u) {
    return u.getPort() != -1 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80;
  }

  private static void requireClean(String s) {
    if (s.indexOf('\r') >= 0 || s.indexOf('\n') >= 0) throw new ApiError(400, "Header names and values cannot contain line breaks.");
  }

  public Result fetch(String url, String method, List<Map<String, String>> headers, String body) {
    long deadline = System.nanoTime() + TIMEOUT_NANOS;
    URI uri;
    try {
      uri = URI.create(url);
    } catch (IllegalArgumentException e) {
      throw new ApiError(400, "Invalid URL.");
    }
    String firstOrigin = origin(uri);
    for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) throw new ApiError(400, "Only http and https URLs can be fetched.");
      String host = uri.getHost();
      if (host == null) throw new ApiError(400, "Invalid URL.");
      host = host.replaceAll("^\\[|\\]$", "");
      List<InetAddress> addresses = resolve(host);
      // The caller's headers (Authorization, cookies) are for the original site only.
      boolean sameOrigin = origin(uri).equals(firstOrigin);
      Response response = exchange(uri, host, addresses, method, sameOrigin ? headers : List.of(), body, deadline);
      if (response.status >= 300 && response.status < 400 && response.location != null) {
        uri = uri.resolve(response.location);
        continue;
      }
      if (response.status >= 400) throw new ApiError(502, "The web service answered " + response.status + ".");
      return new Result(response.contentType == null ? "application/octet-stream" : response.contentType, response.body);
    }
    throw new ApiError(502, "Too many redirects.");
  }

  private record Response(int status, String location, String contentType, byte[] body) {}

  private static int remainingMillis(long deadline) {
    long left = (deadline - System.nanoTime()) / 1_000_000;
    if (left <= 0) throw new ApiError(504, "The web service did not answer in time.");
    return (int) Math.min(left, Integer.MAX_VALUE);
  }

  /** Connects to the first reachable checked address (a few seconds each), never to anything else. */
  private static Socket connect(List<InetAddress> addresses, int port, long deadline) throws IOException {
    IOException last = null;
    for (InetAddress address : addresses) {
      Socket socket = new Socket();
      try {
        socket.connect(new InetSocketAddress(address, port), Math.min(3000, remainingMillis(deadline)));
        return socket;
      } catch (IOException e) {
        socket.close();
        last = e;
      }
    }
    throw last != null ? last : new IOException("no address");
  }

  private Response exchange(URI uri, String host, List<InetAddress> addresses, String method, List<Map<String, String>> headers, String body, long deadline) {
    boolean https = "https".equals(uri.getScheme());
    int port = port(uri);
    try (Socket raw = connect(addresses, port, deadline)) {
      raw.setSoTimeout(remainingMillis(deadline));
      Socket socket = raw;
      if (https) {
        SSLSocket ssl = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(raw, host, port, true);
        SSLParameters params = ssl.getSSLParameters();
        params.setEndpointIdentificationAlgorithm("HTTPS");
        if (!host.matches("[0-9.]+") && !host.contains(":")) params.setServerNames(List.of(new SNIHostName(host)));
        ssl.setSSLParameters(params);
        ssl.startHandshake();
        socket = ssl;
      }
      String path = (uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath()) + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
      requireClean(path);
      StringBuilder req = new StringBuilder();
      req.append("POST".equals(method) ? "POST" : "GET").append(' ').append(path).append(" HTTP/1.1\r\n");
      req.append("Host: ").append(uri.getRawAuthority().replaceFirst("^.*@", "")).append("\r\n");
      req.append("User-Agent: we-report\r\nAccept-Encoding: identity\r\nConnection: close\r\n");
      for (Map<String, String> h : headers) {
        String name = h.getOrDefault("name", "");
        String value = h.getOrDefault("value", "");
        requireClean(name);
        requireClean(value);
        if (!name.isBlank() && !RESTRICTED_HEADERS.contains(name.toLowerCase(Locale.ROOT))) req.append(name).append(": ").append(value).append("\r\n");
      }
      byte[] payload = "POST".equals(method) && body != null ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];
      if ("POST".equals(method)) {
        req.append("Content-Type: application/json\r\nContent-Length: ").append(payload.length).append("\r\n");
      }
      req.append("\r\n");
      OutputStream out = socket.getOutputStream();
      out.write(req.toString().getBytes(StandardCharsets.UTF_8));
      out.write(payload);
      out.flush();
      return read(socket, socket.getInputStream(), deadline);
    } catch (ApiError e) {
      throw e;
    } catch (SocketTimeoutException e) {
      throw new ApiError(504, "The web service did not answer in time.");
    } catch (IOException e) {
      throw new ApiError(502, "Could not reach the web service: " + e.getMessage());
    }
  }

  private static String readLine(InputStream in, int[] budget) throws IOException {
    ByteArrayOutputStream line = new ByteArrayOutputStream();
    int c;
    while ((c = in.read()) != -1) {
      if (--budget[0] < 0) throw new ApiError(502, "The web service sent oversized headers.");
      if (c == '\n') break;
      if (c != '\r') line.write(c);
    }
    if (c == -1 && line.size() == 0) throw new ApiError(502, "The web service closed the connection.");
    return line.toString(StandardCharsets.ISO_8859_1);
  }

  private static Response read(Socket socket, InputStream raw, long deadline) throws IOException {
    InputStream in = new java.io.BufferedInputStream(raw);
    int[] budget = {MAX_HEADER_BYTES};
    String statusLine = readLine(in, budget);
    String[] parts = statusLine.split(" ", 3);
    if (parts.length < 2 || !parts[0].startsWith("HTTP/")) throw new ApiError(502, "The web service did not answer with HTTP.");
    int status = Integer.parseInt(parts[1]);
    String location = null;
    String contentType = null;
    long length = -1;
    boolean chunked = false;
    for (String line = readLine(in, budget); !line.isEmpty(); line = readLine(in, budget)) {
      int colon = line.indexOf(':');
      if (colon <= 0) continue;
      String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
      String value = line.substring(colon + 1).trim();
      switch (name) {
        case "location" -> location = value;
        case "content-type" -> contentType = value;
        case "content-length" -> length = Long.parseLong(value);
        case "transfer-encoding" -> chunked = value.toLowerCase(Locale.ROOT).contains("chunked");
        default -> {}
      }
    }
    if (status >= 300 && status < 400) return new Response(status, location, contentType, new byte[0]);
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    if (chunked) {
      while (true) {
        String sizeLine = readLine(in, new int[] {1024}).split(";", 2)[0].trim();
        int size = Integer.parseInt(sizeLine, 16);
        if (size == 0) break;
        copy(socket, in, body, size, deadline);
        readLine(in, new int[] {16});
      }
    } else {
      copy(socket, in, body, length, deadline);
    }
    return new Response(status, location, contentType, body.toByteArray());
  }

  /** Copies `count` bytes (or until the end when negative), within the size cap and the deadline. */
  private static void copy(Socket socket, InputStream in, ByteArrayOutputStream out, long count, long deadline) throws IOException {
    byte[] chunk = new byte[81920];
    long left = count;
    while (left != 0) {
      socket.setSoTimeout(remainingMillis(deadline));
      int read = in.read(chunk, 0, (int) (left < 0 ? chunk.length : Math.min(chunk.length, left)));
      if (read == -1) {
        if (count < 0) return;
        throw new ApiError(502, "The web service closed the connection early.");
      }
      if (out.size() + read > MAX_BYTES) throw new ApiError(502, "The response is larger than 5 MB.");
      out.write(chunk, 0, read);
      if (left > 0) left -= read;
    }
  }
}
