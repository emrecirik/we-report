package dev.wereport.backend;

import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.sqlite.SQLiteConfig;

/** SQL differences between engines, plus schema and query execution for one connection. */
public abstract class Dialect {
  protected final BackendConfig.Connection config;

  protected Dialect(BackendConfig.Connection config) {
    this.config = config;
  }

  public String quote(String name) {
    return "\"" + name.replace("\"", "\"\"") + "\"";
  }

  public String select(String columns, String table, String where, String orderBy, int top) {
    return "SELECT " + columns + " FROM " + table + where + orderBy + " LIMIT " + top;
  }

  public String wrapLimit(String sql, int top) {
    return "SELECT * FROM (" + sql + ") AS we_report_q LIMIT " + top;
  }

  protected abstract Connection open() throws SQLException;

  protected abstract String schemaSql();

  public List<QueryBuilder.Table> schema() {
    Map<String, QueryBuilder.Table> tables = new LinkedHashMap<>();
    try (Connection c = open(); PreparedStatement st = c.prepareStatement(schemaSql())) {
      if (schemaSql().contains("?")) st.setString(1, schemaName());
      try (ResultSet rs = st.executeQuery()) {
        while (rs.next()) {
          tables.computeIfAbsent(rs.getString(1), n -> new QueryBuilder.Table(n, new ArrayList<>()))
              .columns().add(new QueryBuilder.Column(rs.getString(2), typeOf(rs.getString(3))));
        }
      }
    } catch (SQLException e) {
      // The driver message may name the host or user: logged, not sent.
      org.slf4j.LoggerFactory.getLogger(Dialect.class).warn("Schema of {} could not be read: {}", config.id(), e.getMessage());
      throw new ApiError(502, "The database could not be read. The backend log has the details.");
    }
    return List.copyOf(tables.values());
  }

  protected String schemaName() {
    return config.schema();
  }

  /** Runs read-only with a timeout, then rolls back whatever the statement might have done. */
  public List<Map<String, Object>> query(QueryBuilder.Built q, int timeoutSeconds) throws SQLException {
    try (Connection c = open()) {
      c.setAutoCommit(false);
      c.setReadOnly(true);
      try (PreparedStatement st = c.prepareStatement(q.sql())) {
        st.setQueryTimeout(timeoutSeconds);
        for (int i = 0; i < q.values().size(); i++) st.setObject(i + 1, q.values().get(i));
        List<Map<String, Object>> rows = new ArrayList<>();
        try (ResultSet rs = st.executeQuery()) {
          ResultSetMetaData md = rs.getMetaData();
          while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= md.getColumnCount(); i++) row.put(md.getColumnLabel(i), plain(rs.getObject(i)));
            rows.add(row);
          }
        }
        return rows;
      } finally {
        c.rollback();
      }
    }
  }

  /** JSON-friendly values. Dates keep their calendar day (no time-zone shift). */
  static Object plain(Object v) {
    if (v instanceof BigDecimal d) return d.doubleValue();
    if (v instanceof java.sql.Date d) return d.toLocalDate().toString();
    if (v instanceof java.sql.Timestamp t) return t.toLocalDateTime().toString();
    if (v instanceof LocalDate || v instanceof LocalDateTime) return v.toString();
    if (v instanceof Long l && Math.abs(l) > 9007199254740991L) return l.toString();
    if (v instanceof byte[]) return null; // shortcut: binary columns are not reportable yet.
    if (v instanceof java.util.UUID u) return u.toString();
    return v;
  }

  static String typeOf(String declared) {
    String t = declared == null ? "" : declared.toUpperCase();
    if (t.matches(".*(INT|DEC|NUM|REAL|FLOA|DOUB|MONEY).*")) return "number";
    if (t.matches(".*(DATE|TIME).*")) return "date";
    if (t.contains("BOOL") || t.equals("BIT")) return "boolean";
    if (t.matches(".*(CHAR|TEXT|CLOB|UUID|UNIQUEIDENTIFIER).*")) return "string";
    return "unknown";
  }

  public static Dialect create(BackendConfig.Connection c) {
    return switch (c.dialect()) {
      case "sqlite" -> new Sqlite(c);
      case "postgres" -> new Postgres(c);
      case "sqlserver" -> new SqlServer(c);
      default -> throw new IllegalStateException("Unsupported dialect " + c.dialect());
    };
  }

  static final class Sqlite extends Dialect {
    Sqlite(BackendConfig.Connection c) {
      super(c);
      String file = c.url().replaceFirst("^jdbc:sqlite:", "");
      if (c.seedSample() && !new java.io.File(file).exists()) {
        try (Connection seed = DriverManager.getConnection(c.url()); Statement st = seed.createStatement();
            InputStream in = Dialect.class.getResourceAsStream("/seed.sql")) {
          if (in == null) throw new IllegalStateException("seed.sql is missing from the build");
          // Comment lines are dropped first: they share a chunk with the statement that follows them.
          String script = new String(in.readAllBytes(), StandardCharsets.UTF_8).replaceAll("(?m)^--.*$", "");
          for (String sql : script.split(";\\s*\\n")) {
            if (!sql.isBlank()) st.addBatch(sql);
          }
          st.executeBatch();
        } catch (Exception e) {
          throw new IllegalStateException("Could not create the sample database", e);
        }
      }
    }

    @Override
    protected Connection open() throws SQLException {
      // Read-only at the driver level: even an allowed free SQL statement cannot write.
      SQLiteConfig cfg = new SQLiteConfig();
      cfg.setReadOnly(true);
      return cfg.createConnection(config.url());
    }

    @Override
    protected String schemaSql() {
      return "SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p "
          + "WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid";
    }
  }

  static final class Postgres extends Dialect {
    Postgres(BackendConfig.Connection c) {
      super(c);
    }

    @Override
    protected Connection open() throws SQLException {
      Properties p = new Properties();
      // statement_timeout as a server-side guard in addition to the JDBC query timeout.
      p.setProperty("options", "-c statement_timeout=" + config.timeoutSeconds() * 1000 + " -c search_path=" + schemaName());
      return DriverManager.getConnection(config.url(), p);
    }

    @Override
    protected String schemaName() {
      return config.schema() == null ? "public" : config.schema();
    }

    @Override
    protected String schemaSql() {
      return "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = ? ORDER BY table_name, ordinal_position";
    }
  }

  static final class SqlServer extends Dialect {
    SqlServer(BackendConfig.Connection c) {
      super(c);
    }

    @Override
    public String quote(String name) {
      return "[" + name.replace("]", "]]") + "]";
    }

    @Override
    public String select(String columns, String table, String where, String orderBy, int top) {
      return "SELECT TOP (" + top + ") " + columns + " FROM " + quote(schemaName()) + "." + table + where + orderBy;
    }

    // shortcut: free SQL with its own ORDER BY needs TOP on SQL Server; parse it if that becomes common.
    @Override
    public String wrapLimit(String sql, int top) {
      return "SELECT TOP (" + top + ") * FROM (" + sql + ") AS we_report_q";
    }

    @Override
    protected Connection open() throws SQLException {
      return DriverManager.getConnection(config.url());
    }

    @Override
    protected String schemaName() {
      return config.schema() == null ? "dbo" : config.schema();
    }

    @Override
    protected String schemaSql() {
      return "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION";
    }
  }
}
