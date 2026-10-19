package dev.wereport.backend;

import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** The protocol endpoints (protocol/openapi.yaml, v1). */
@RestController
@RequestMapping("/v1")
public class Api {
  private static final Logger log = LoggerFactory.getLogger(Api.class);
  private final BackendConfig config;
  private final FetchGuard guard;
  private final Map<String, Dialect> databases = new ConcurrentHashMap<>();

  public Api(BackendConfig config) {
    this.config = config;
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
        "capabilities", Map.of("webServiceFetch", config.webServiceFetch(), "demo", config.demo()));
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

  @PostMapping("/connections/{id}/query")
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
    List<Map<String, Object>> rows;
    try {
      rows = db.query(built, c.timeoutSeconds());
    } catch (SQLTimeoutException e) {
      throw new ApiError(504, "The query took too long and was stopped.");
    } catch (SQLException e) {
      // Driver messages can name hosts, users and databases: logged here, never sent.
      log.warn("Query on {} failed: {}", c.id(), e.getMessage());
      throw new ApiError(400, "The query failed. The backend log has the details.");
    }
    boolean truncated = rows.size() > built.limit();
    if (truncated) rows = rows.subList(0, built.limit());
    List<Map<String, Object>> columns = rows.isEmpty() ? List.of() : rows.get(0).entrySet().stream()
        .map(e -> Map.<String, Object>of("name", e.getKey(), "type",
            e.getValue() == null ? "unknown" : e.getValue() instanceof Number ? "number" : e.getValue() instanceof Boolean ? "boolean" : "string"))
        .toList();
    return Map.of("columns", columns, "rows", rows, "truncated", truncated);
  }

  @PostMapping("/webservice/fetch")
  @SuppressWarnings("unchecked")
  public ResponseEntity<byte[]> fetch(@RequestBody Map<String, Object> body) {
    if (!config.webServiceFetch()) throw new ApiError(403, "Web service fetching is disabled on this backend.");
    if (!(body.get("url") instanceof String url)) throw new ApiError(400, "url is required.");
    List<Map<String, String>> headers = body.get("headers") instanceof List<?> h ? (List<Map<String, String>>) h : List.of();
    FetchGuard.Result result = guard.fetch(url, "POST".equals(body.get("method")) ? "POST" : "GET", headers,
        body.get("body") instanceof String b ? b : null);
    // Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(result.contentType())).body(result.body());
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
