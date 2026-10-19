package dev.wereport.backend;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.json.JsonParserFactory;

/** All settings come from the environment (and an optional connections file), never from requests. */
public record BackendConfig(
    String host,
    int port,
    boolean demo,
    String authToken,
    List<String> corsOrigins,
    boolean webServiceFetch,
    Set<String> fetchAllowHosts,
    int rateLimitPerMinute,
    List<Connection> connections,
    Path layoutsDir) {

  /** A database the backend may query. The JDBC URL never leaves the server. */
  public record Connection(
      String id, String name, String dialect, String url, boolean allowFreeSql, int maxRows, int timeoutSeconds, String schema, boolean seedSample) {}

  public boolean isLoopback() {
    return host.equals("127.0.0.1") || host.equals("::1") || host.equals("localhost");
  }

  public static BackendConfig fromEnvironment(Map<String, String> env) {
    boolean demo = "1".equals(env.get("WE_REPORT_DEMO"));
    return new BackendConfig(
        env.getOrDefault("WE_REPORT_HOST", "127.0.0.1"),
        parseInt(env.getOrDefault("WE_REPORT_PORT", env.get("PORT")), 5480),
        demo,
        blankToNull(env.get("WE_REPORT_AUTH_TOKEN")),
        list(env.getOrDefault("WE_REPORT_CORS_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200")),
        // The fetch proxy would be an open proxy on a public demo.
        !demo && !"0".equals(env.get("WE_REPORT_FETCH")),
        new HashSet<>(list(env.get("WE_REPORT_FETCH_ALLOW_HOSTS")).stream().map(String::toLowerCase).toList()),
        parseInt(env.get("WE_REPORT_RATE_LIMIT"), demo ? 60 : 600),
        connections(env, demo),
        // Saved grid layouts and sheets (protocol 1.1): one JSON file per key; off in demo mode.
        blankToNull(env.get("WE_REPORT_LAYOUTS_DIR")) instanceof String dir ? Path.of(dir) : Path.of(System.getProperty("java.io.tmpdir"), "we-report-layouts"));
  }

  /**
   * {@code WE_REPORT_CONNECTIONS} (JSON) or {@code connections.json}; without either, a SQLite
   * connection with the fictional sample dataset. Entry: { id, name, dialect: sqlite | postgres |
   * sqlserver, url (JDBC URL, or a file path for sqlite), allowFreeSql?, maxRows?, timeoutMs?, schema?, seed? }.
   */
  @SuppressWarnings("unchecked")
  static List<Connection> connections(Map<String, String> env, boolean demo) {
    String json = env.get("WE_REPORT_CONNECTIONS");
    try {
      if ((json == null || json.isBlank()) && Files.exists(Path.of("connections.json"))) json = Files.readString(Path.of("connections.json"));
    } catch (Exception e) {
      throw new IllegalStateException("connections.json could not be read", e);
    }
    if (json == null || json.isBlank()) {
      String file = Path.of(System.getProperty("java.io.tmpdir"), "we-report-sample-java.db").toString();
      return List.of(new Connection("sample", "Sample shop (SQLite)", "sqlite", "jdbc:sqlite:" + file, false, 5000, 15, null, true));
    }
    List<Connection> list = new ArrayList<>();
    for (Object item : JsonParserFactory.getJsonParser().parseList(json)) {
      Map<String, Object> c = (Map<String, Object>) item;
      String id = required(c, "id");
      if (!id.matches("[\\w-]+") || list.stream().anyMatch(x -> x.id().equals(id))) {
        throw new IllegalStateException("Connection id \"" + id + "\" must be unique and use letters, digits, _ or -.");
      }
      String dialect = required(c, "dialect");
      if (!List.of("sqlite", "postgres", "sqlserver").contains(dialect)) throw new IllegalStateException("Unsupported dialect " + dialect);
      String url = required(c, "url");
      if (dialect.equals("sqlite") && !url.startsWith("jdbc:")) url = "jdbc:sqlite:" + url;
      list.add(new Connection(
          id,
          required(c, "name"),
          dialect,
          url,
          // Demo mode never runs free SQL, whatever the file says.
          !demo && Boolean.TRUE.equals(c.get("allowFreeSql")),
          Math.min(c.get("maxRows") instanceof Number n ? n.intValue() : 5000, 50000),
          Math.max(1, (c.get("timeoutMs") instanceof Number n ? n.intValue() : 15000) / 1000),
          c.get("schema") instanceof String s ? s : null,
          "sample".equals(c.get("seed"))));
    }
    return list;
  }

  private static String required(Map<String, Object> c, String key) {
    if (c.get(key) instanceof String s && !s.isBlank()) return s;
    throw new IllegalStateException("Every connection needs \"" + key + "\".");
  }

  private static int parseInt(String value, int fallback) {
    try {
      return value == null ? fallback : Integer.parseInt(value.trim());
    } catch (NumberFormatException e) {
      return fallback;
    }
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }

  private static List<String> list(String value) {
    return value == null || value.isBlank() ? List.of() : Arrays.stream(value.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
  }
}
