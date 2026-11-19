package dev.wereport.backend;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns the protocol's structured query into SQL. Every identifier is checked against the
 * introspected schema and quoted by the dialect; every value is a JDBC parameter.
 */
public final class QueryBuilder {
  public record Column(String name, String type) {}

  public record Table(String name, List<Column> columns) {}

  /** {@code countSql} counts the same rows without order, offset and limit; it takes the same values. */
  public record Built(String sql, List<Object> values, int limit, String countSql) {}

  private static final Set<String> OPS = Set.of("=", "!=", "<", "<=", ">", ">=", "like", "contains", "startsWith", "in", "isNull", "notNull");
  private static final int MAX_IN_VALUES = 1000;
  private static final Set<String> AGGREGATES = Set.of("sum", "avg", "min", "max", "count");
  private static final Pattern ALIAS = Pattern.compile("^(?!__)[A-Za-z_][A-Za-z0-9_]{0,63}$");
  private static final int MAX_SEARCH_WORDS = 10;
  // Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
  private static final Pattern LITERALS = Pattern.compile("'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|\\[[^\\]]*\\]|--[^\\n]*|/\\*[\\s\\S]*?\\*/");
  private static final Pattern UNTRACKABLE = Pattern.compile("\\\\|\\$[A-Za-z_]*\\$");
  private static final Pattern LITERALS_OR_PARAMS = Pattern.compile(LITERALS.pattern() + "|(?<![:\\w]):([A-Za-z_]\\w*)");

  private QueryBuilder() {}

  /** {@code contains} / {@code startsWith} match the text literally: LIKE's wildcards and the escape character are escaped. */
  static String likeLiteral(Object v) {
    return String.valueOf(v == null ? "" : v).replaceAll("([\\\\%_])", "\\\\$1");
  }

  /** JSON values from the request: drivers only ever see text, numbers and null. */
  static Object driverValue(Object v) {
    if (v == null || v instanceof String || v instanceof Number) return v;
    if (v instanceof Boolean b) return b ? 1 : 0;
    throw new ApiError(400, "Query values must be text, numbers, booleans or null.");
  }

  @SuppressWarnings("unchecked")
  public static Built select(Object queryObject, List<Table> schema, Dialect d, Map<String, Object> params, int maxRows) {
    if (!(queryObject instanceof Map<?, ?> query)) throw new ApiError(400, "query must be an object.");
    Object tableName = query.get("table");
    Table table = schema.stream().filter(t -> t.name().equals(tableName)).findFirst()
        .orElseThrow(() -> new ApiError(400, "Unknown table \"" + tableName + "\"."));
    Set<String> known = Set.copyOf(table.columns().stream().map(Column::name).toList());
    java.util.function.Function<Object, String> column = name -> {
      if (!(name instanceof String n) || !known.contains(n)) throw new ApiError(400, "Unknown column \"" + name + "\" in \"" + table.name() + "\".");
      return d.quote(n);
    };

    List<Object> values = new ArrayList<>();
    java.util.function.Function<Object, String> bind = v -> {
      values.add(driverValue(v));
      return "?";
    };

    if (query.containsKey("distinct") && !(query.get("distinct") instanceof Boolean)) throw new ApiError(400, "distinct must be true or false.");
    boolean distinct = Boolean.TRUE.equals(query.get("distinct"));
    if (distinct && !(query.get("columns") instanceof List<?> c && !c.isEmpty())) throw new ApiError(400, "distinct needs the columns to return.");
    Object offsetValue = query.containsKey("offset") ? query.get("offset") : 0;
    if (!((offsetValue instanceof Integer || offsetValue instanceof Long) && ((Number) offsetValue).longValue() >= 0)) {
      throw new ApiError(400, "offset must be a whole number of 0 or more.");
    }
    long offset = ((Number) offsetValue).longValue();

    // 1.2 groups: one row per combination of the groupBy columns, with its count and subtotals
    boolean grouped = query.containsKey("groupBy");
    List<?> groupBy = List.of();
    if (grouped) {
      if (!(query.get("groupBy") instanceof List<?> g) || g.isEmpty() || g.size() > 8 || new java.util.HashSet<>(g).size() != g.size()) {
        throw new ApiError(400, "groupBy must list 1-8 different columns.");
      }
      if (query.get("columns") instanceof List<?> c && !c.isEmpty() || distinct || offset > 0) {
        throw new ApiError(400, "groupBy does not go with columns, distinct or offset.");
      }
      groupBy = g;
    }
    if (query.containsKey("aggregates") && !grouped) throw new ApiError(400, "aggregates need groupBy.");
    Object aggregatesValue = query.containsKey("aggregates") ? query.get("aggregates") : List.of();
    if (!(aggregatesValue instanceof List<?> aggregateList) || aggregateList.size() > 32) throw new ApiError(400, "aggregates must be a list of at most 32.");
    List<String> aggregates = new ArrayList<>();
    Set<Object> names = new java.util.HashSet<>();
    for (Object item : aggregateList) {
      Map<?, ?> a = item instanceof Map<?, ?> m ? m : Map.of();
      if (!(a.get("fn") instanceof String fn) || !AGGREGATES.contains(fn)) throw new ApiError(400, "Unsupported aggregate \"" + a.get("fn") + "\".");
      if (!(a.get("as") instanceof String as) || !ALIAS.matcher(as).matches()) {
        throw new ApiError(400, "Aggregate name \"" + a.get("as") + "\" must be a plain identifier not starting with __.");
      }
      if (!names.add(as)) throw new ApiError(400, "Aggregate names must be different.");
      aggregates.add(fn.toUpperCase() + "(" + column.apply(a.get("column")) + ") AS " + d.quote(as));
    }

    List<String> columns;
    if (grouped) {
      columns = new ArrayList<>(groupBy.stream().map(column).toList());
      columns.add("COUNT(*) AS " + d.quote("__count"));
      columns.addAll(aggregates);
    } else {
      columns = query.get("columns") instanceof List<?> cols && !cols.isEmpty()
          ? cols.stream().map(column).toList()
          : table.columns().stream().map(c -> d.quote(c.name())).toList();
    }

    List<String> conditions = new ArrayList<>();
    if (query.get("where") instanceof List<?> where) {
      for (Object item : where) {
        if (!(item instanceof Map<?, ?> w) || !(w.get("op") instanceof String op) || !OPS.contains(op)) {
          throw new ApiError(400, "Unsupported operator \"" + (item instanceof Map<?, ?> m ? m.get("op") : null) + "\".");
        }
        String col = column.apply(w.get("column"));
        Object value = w.get("param") instanceof String p ? params.get(p) : w.get("value");
        switch (op) {
          case "isNull" -> conditions.add(col + " IS NULL");
          case "notNull" -> conditions.add(col + " IS NOT NULL");
          case "in" -> {
            if (!(value instanceof List<?> list) || list.isEmpty() || list.size() > MAX_IN_VALUES) {
              throw new ApiError(400, "\"in\" needs a list of 1-" + MAX_IN_VALUES + " values.");
            }
            conditions.add(col + " IN (" + String.join(", ", list.stream().map(bind).toList()) + ")");
          }
          case "like" -> conditions.add(col + " LIKE " + bind.apply(value));
          case "contains", "startsWith" -> conditions.add("LOWER(" + col + ") LIKE LOWER("
              + bind.apply((op.equals("contains") ? "%" : "") + likeLiteral(value) + "%") + ") ESCAPE '\\'");
          default -> conditions.add(col + " " + (op.equals("!=") ? "<>" : op) + " " + bind.apply(value));
        }
      }
    }

    // 1.2 search: every word in some column, read as text — AND across words, OR across columns
    if (query.containsKey("search")) {
      if (!(query.get("search") instanceof Map<?, ?> s) || !(s.get("text") instanceof String text) || text.length() > 200
          || !(s.get("columns") instanceof List<?> searchColumns) || searchColumns.isEmpty() || searchColumns.size() > 50) {
        throw new ApiError(400, "search needs text (at most 200 characters) and 1-50 columns.");
      }
      List<String> searched = searchColumns.stream().map(column).toList();
      java.util.Arrays.stream(text.strip().split("\\s+")).filter(w -> !w.isEmpty()).limit(MAX_SEARCH_WORDS).forEach(word -> {
        String pattern = "%" + likeLiteral(word) + "%";
        conditions.add("(" + String.join(" OR ", searched.stream()
            .map(col -> "LOWER(" + d.asText(col) + ") LIKE LOWER(" + bind.apply(pattern) + ") ESCAPE '\\'").toList()) + ")");
      });
    }

    // Groups come in groupBy order, NULL first, unless the caller orders them
    Object orderValue = query.get("orderBy");
    if (orderValue == null && grouped) orderValue = groupBy.stream().map(c -> Map.of("column", c, "nulls", "first")).toList();
    List<String> order = new ArrayList<>();
    if (orderValue instanceof List<?> orderBy) {
      for (Object item : orderBy) {
        Map<String, Object> o = item instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Object dir = o.get("dir");
        Object nulls = o.get("nulls");
        if (dir != null && !"asc".equals(dir) && !"desc".equals(dir)) throw new ApiError(400, "orderBy.dir must be asc or desc.");
        if (nulls != null && !"first".equals(nulls) && !"last".equals(nulls)) throw new ApiError(400, "orderBy.nulls must be first or last.");
        String col = column.apply(o.get("column"));
        String by = col + ("desc".equals(dir) ? " DESC" : " ASC");
        // CASE rather than NULLS FIRST/LAST: every dialect has it (SQL Server has no NULLS clause)
        boolean first = "first".equals(nulls);
        order.add(nulls == null ? by : "CASE WHEN " + col + " IS NULL THEN " + (first ? 0 : 1) + " ELSE " + (first ? 1 : 0) + " END, " + by);
      }
    }

    int requested = query.get("limit") instanceof Number n && n.intValue() > 0 ? n.intValue() : maxRows;
    int limit = Math.min(requested, maxRows);
    String select = "SELECT " + (distinct ? "DISTINCT " : "") + String.join(", ", columns) + " FROM " + d.table(d.quote(table.name()))
        + (conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions))
        + (grouped ? " GROUP BY " + String.join(", ", groupBy.stream().map(column).toList()) : "");
    // One extra row tells us whether the result was truncated.
    String sql = d.page(select, order.isEmpty() ? "" : " ORDER BY " + String.join(", ", order), limit + 1, offset);
    return new Built(sql, values, limit, "SELECT COUNT(*) AS total FROM (" + select + ") AS we_report_c");
  }

  /** Free SQL (only where allowed): one SELECT statement, {@code :name} parameters, row limit. */
  public static Built freeSql(Object sqlObject, Dialect d, Map<String, Object> params, int maxRows) {
    if (!(sqlObject instanceof String sql) || sql.isBlank()) throw new ApiError(400, "sql must be a non-empty string.");
    String body = sql.strip().replaceAll(";\\s*$", "");
    // Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
    // stripper cannot follow, which could hide a second statement. Report SQL never needs them.
    if (UNTRACKABLE.matcher(body).find()) throw new ApiError(400, "Free SQL cannot contain backslashes or dollar-quoted strings.");
    String bare = LITERALS.matcher(body).replaceAll("''");
    if (bare.contains(";")) throw new ApiError(400, "Only one SQL statement is allowed.");
    if (!bare.matches("(?is)\\s*(select|with)\\b.*")) throw new ApiError(400, "Only SELECT queries are allowed.");
    List<Object> values = new ArrayList<>();
    // Literals and comments are matched first and kept, so only real :name parameters are replaced.
    Matcher m = LITERALS_OR_PARAMS.matcher(body);
    StringBuilder text = new StringBuilder();
    while (m.find()) {
      if (m.group(1) == null) {
        m.appendReplacement(text, Matcher.quoteReplacement(m.group()));
      } else {
        values.add(driverValue(params.get(m.group(1))));
        m.appendReplacement(text, "?");
      }
    }
    m.appendTail(text);
    return new Built(d.wrapLimit(text.toString(), maxRows + 1), values, maxRows, "SELECT COUNT(*) AS total FROM (" + text + ") AS we_report_c");
  }
}
