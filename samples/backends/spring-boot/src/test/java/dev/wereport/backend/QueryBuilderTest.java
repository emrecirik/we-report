package dev.wereport.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class QueryBuilderTest {
  private static final List<QueryBuilder.Table> SCHEMA = List.of(new QueryBuilder.Table("customers",
      List.of(new QueryBuilder.Column("id", "number"), new QueryBuilder.Column("city", "string"))));
  private static final BackendConfig.Connection SQLITE = new BackendConfig.Connection("t", "t", "sqlite", "jdbc:sqlite::memory:", false, 100, 5, null, false);
  private static final BackendConfig.Connection MSSQL = new BackendConfig.Connection("t", "t", "sqlserver", "jdbc:sqlserver://x", false, 100, 5, null, false);

  private static QueryBuilder.Built build(BackendConfig.Connection c, Map<String, Object> query) {
    return QueryBuilder.select(query, SCHEMA, Dialect.create(c), Map.of(), 100);
  }

  @Test
  void offsetAndCount() {
    QueryBuilder.Built b = build(SQLITE, Map.of("table", "customers", "columns", List.of("id"), "offset", 5, "limit", 5));
    assertEquals("SELECT \"id\" FROM \"customers\" LIMIT 6 OFFSET 5", b.sql());
    assertEquals("SELECT COUNT(*) AS total FROM (SELECT \"id\" FROM \"customers\") AS we_report_c", b.countSql());
    assertThrows(ApiError.class, () -> build(SQLITE, Map.of("table", "customers", "offset", -1)));
    assertThrows(ApiError.class, () -> build(SQLITE, Map.of("table", "customers", "offset", 1.5)));
  }

  @Test
  void distinctNeedsColumns() {
    assertEquals("SELECT DISTINCT \"city\" FROM \"customers\" LIMIT 101",
        build(SQLITE, Map.of("table", "customers", "columns", List.of("city"), "distinct", true)).sql());
    assertThrows(ApiError.class, () -> build(SQLITE, Map.of("table", "customers", "distinct", true)));
    assertThrows(ApiError.class, () -> build(SQLITE, Map.of("table", "customers", "columns", List.of("city"), "distinct", "yes")));
  }

  @Test
  void containsIsLiteralAndParameterised() {
    QueryBuilder.Built b = build(SQLITE, Map.of("table", "customers",
        "where", List.of(Map.of("column", "city", "op", "contains", "value", "50%_a\\b"), Map.of("column", "city", "op", "startsWith", "value", "x"))));
    assertEquals("SELECT \"id\", \"city\" FROM \"customers\" WHERE LOWER(\"city\") LIKE LOWER(?) ESCAPE '\\' AND LOWER(\"city\") LIKE LOWER(?) ESCAPE '\\' LIMIT 101", b.sql());
    assertEquals(List.of("%50\\%\\_a\\\\b%", "x%"), b.values());
  }

  @Test
  void sqlServerPagesWithOffsetFetch() {
    assertEquals("SELECT [id] FROM [dbo].[customers] ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 101 ROWS ONLY",
        build(MSSQL, Map.of("table", "customers", "columns", List.of("id"))).sql());
    assertEquals("SELECT DISTINCT [city] FROM [dbo].[customers] ORDER BY 1 OFFSET 3 ROWS FETCH NEXT 101 ROWS ONLY",
        build(MSSQL, Map.of("table", "customers", "columns", List.of("city"), "distinct", true, "offset", 3)).sql());
  }
}
