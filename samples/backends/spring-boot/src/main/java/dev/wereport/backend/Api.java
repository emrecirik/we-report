package dev.wereport.backend;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/** The protocol endpoints (protocol/openapi.yaml, v1). */
@RestController
@RequestMapping("/v1")
public class Api {
  private static final Logger log = LoggerFactory.getLogger(Api.class);
  private final BackendConfig config;
  private final FetchGuard guard;
  private final Map<String, Dialect> databases = new ConcurrentHashMap<>();
  private final JsonMapper json;
  private static final int MAX_LAYOUT_BYTES = 256 * 1024;

  public Api(BackendConfig config, JsonMapper json) {
    this.config = config;
    this.json = json;
    this.guard = new FetchGuard(config.fetchAllowHosts());
  }

  private BackendConfig.Connection connection(String id) {
    return config.connections().stream().filter(c -> c.id().equals(id)).findFirst()
        .orElseThrow(() -> new ApiError(404, "No connection \"" + id + "\"."));
  }

  private Dialect database(BackendConfig.Connection c) {
    return databases.computeIfAbsent(c.id(), k -> Dialect.create(c));
  }

  @GetMapping("/info")
  public Map<String, Object> info() {
    return Map.of("protocol", 1, "server", "we-report-spring-boot",
        "capabilities", Map.of("webServiceFetch", config.webServiceFetch(), "demo", config.demo(), "grid", true, "layouts", !config.demo()));
  }

  /** Never the JDBC URL: ids, names, dialects and what is allowed. */
  @GetMapping("/connections")
  public List<Map<String, Object>> connections() {
    return config.connections().stream()
        .map(c -> Map.<String, Object>of("id", c.id(), "name", c.name(), "dialect", c.dialect(), "freeSql", c.allowFreeSql()))
        .toList();
  }

  @GetMapping("/connections/{id}/schema")
  public Map<String, Object> schema(@PathVariable String id) {
    return Map.of("tables", database(connection(id)).schema());
  }

  @PostMapping(path = "/connections/{id}/query", consumes = MediaType.APPLICATION_JSON_VALUE)
  @SuppressWarnings("unchecked")
  public Map<String, Object> query(@PathVariable String id, @RequestBody Map<String, Object> body) {
    BackendConfig.Connection c = connection(id);
    Dialect db = database(c);
    Map<String, Object> params = body.get("params") instanceof Map<?, ?> p ? (Map<String, Object>) p : Map.of();
    QueryBuilder.Built built;
    if (body.containsKey("sql")) {
      if (!c.allowFreeSql()) throw new ApiError(403, "Free SQL is not allowed on this connection. Use the query builder.");
      built = QueryBuilder.freeSql(body.get("sql"), db, params, c.maxRows());
    } else {
      built = QueryBuilder.select(body.get("query"), db.schema(), db, params, c.maxRows());
    }
    List<Map<String, Object>> rows = run(db, c, built);
    boolean truncated = rows.size() > built.limit();
    if (truncated) rows = rows.subList(0, built.limit());
    List<Map<String, Object>> columns = rows.isEmpty() ? List.of() : rows.get(0).entrySet().stream()
        .map(e -> Map.<String, Object>of("name", e.getKey(), "type",
            e.getValue() == null ? "unknown" : e.getValue() instanceof Number ? "number" : e.getValue() instanceof Boolean ? "boolean" : "string"))
        .toList();
    Map<String, Object> result = new LinkedHashMap<>(Map.of("columns", columns, "rows", rows, "truncated", truncated));
    if (Boolean.TRUE.equals(body.get("count"))) {
      Object total = run(db, c, new QueryBuilder.Built(built.countSql(), built.values(), 0, null)).get(0).get("total");
      result.put("total", ((Number) total).longValue());
    }
    return result;
  }

  private static List<Map<String, Object>> run(Dialect db, BackendConfig.Connection c, QueryBuilder.Built built) {
    try {
      return db.query(built, c.timeoutSeconds());
    } catch (SQLTimeoutException e) {
      throw new ApiError(504, "The query took too long and was stopped.");
    } catch (SQLException e) {
      // Driver messages can name hosts, users and databases: logged here, never sent.
      log.warn("Query on {} failed: {}", c.id(), e.getMessage());
      throw new ApiError(400, "The query failed. The backend log has the details.");
    }
  }

  /** Saved grid layouts and sheets: one file per key, named by the key in hex, so no key can leave the directory. */
  private Path layoutFile(String key) {
    if (!key.matches("[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,99}")) throw new ApiError(400, "Layout keys are 1-100 letters, digits and _ . : - characters.");
    if (config.demo()) throw new ApiError(403, "Saved layouts are disabled on this backend.");
    return config.layoutsDir().resolve(HexFormat.of().formatHex(key.getBytes(StandardCharsets.UTF_8)) + ".json");
  }

  @GetMapping("/layouts/{key}")
  public ResponseEntity<byte[]> getLayout(@PathVariable String key) throws IOException {
    Path file = layoutFile(key);
    if (!Files.exists(file)) throw new ApiError(404, "No layout saved under this key.");
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(Files.readAllBytes(file));
  }

  /** Raw bytes, so the 256 KB cap is checked after the body was read (a 413, not a reset connection), and stored as sent. */
  @PutMapping(path = "/layouts/{key}", consumes = MediaType.APPLICATION_JSON_VALUE)
  public ResponseEntity<Void> putLayout(@PathVariable String key, @RequestBody(required = false) byte[] body) throws IOException {
    Path file = layoutFile(key);
    if (body != null && body.length > MAX_LAYOUT_BYTES) throw new ApiError(413, "Request body too large.");
    try {
      if (body == null || !json.readTree(body).isObject()) throw new ApiError(400, "A layout is a JSON object.");
    } catch (JacksonException e) {
      throw new ApiError(400, "Body must be JSON.");
    }
    Files.createDirectories(file.getParent());
    // Written next to the target and renamed, so a reader never sees half a file.
    Path tmp = Files.createTempFile(file.getParent(), file.getFileName().toString(), ".tmp");
    try {
      Files.write(tmp, body);
      Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } finally {
      Files.deleteIfExists(tmp);
    }
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/layouts/{key}")
  public ResponseEntity<Void> deleteLayout(@PathVariable String key) throws IOException {
    Files.deleteIfExists(layoutFile(key));
    return ResponseEntity.noContent().build();
  }

  @PostMapping(path = "/webservice/fetch", consumes = MediaType.APPLICATION_JSON_VALUE)
  @SuppressWarnings("unchecked")
  public ResponseEntity<byte[]> fetch(@RequestBody Map<String, Object> body) {
    if (!config.webServiceFetch()) throw new ApiError(403, "Web service fetching is disabled on this backend.");
    if (!(body.get("url") instanceof String url)) throw new ApiError(400, "url is required.");
    List<Map<String, String>> headers = body.get("headers") instanceof List<?> h ? (List<Map<String, String>>) h : List.of();
    FetchGuard.Result result = guard.fetch(url, "POST".equals(body.get("method")) ? "POST" : "GET", headers,
        body.get("body") instanceof String b ? b : null);
    // Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
    // Someone else's content: never active on this backend's origin.
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(result.contentType())).header("Content-Security-Policy", "sandbox").body(result.body());
  }

  @ExceptionHandler(ApiError.class)
  public ResponseEntity<Map<String, String>> apiError(ApiError e) {
    return ResponseEntity.status(e.status()).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String, String>> badJson(HttpMessageNotReadableException e) {
    // The body cap (see LimitedRequest) surfaces here, wrapped by the JSON reader.
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof ApiError api) return apiError(api);
    }
    return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Body must be JSON."));
  }

  /** A page elsewhere can POST a plain form (text/plain) without a CORS preflight; JSON it cannot. */
  @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
  public ResponseEntity<Map<String, String>> notJson() {
    return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Send the body as application/json."));
  }

  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<Map<String, String>> notFound() {
    return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Not found."));
  }

  /** Unexpected errors are logged here and never echoed: they could contain internals. */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, String>> unexpected(Exception e) {
    log.error("Request failed", e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", "Internal error."));
  }
}
