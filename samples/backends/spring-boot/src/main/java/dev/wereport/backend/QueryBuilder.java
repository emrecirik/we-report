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

  public record Built(String sql, List<Object> values, int limit) {}

  private static final Set<String> OPS = Set.of("=", "!=", "<", "<=", ">", ">=", "like", "in", "isNull", "notNull");
  private static final int MAX_IN_VALUES = 1000;
  // Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
  private static final Pattern LITERALS = Pattern.compile("'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"|\\[[^\\]]*\\]|--[^\\n]*|/\\*[\\s\\S]*?\\*/");
  private static final Pattern UNTRACKABLE = Pattern.compile("\\\\|\\$[A-Za-z_]*\\$");
  private static final Pattern LITERALS_OR_PARAMS = Pattern.compile(LITERALS.pattern() + "|(?<![:\\w]):([A-Za-z_]\\w*)");

  private QueryBuilder() {}

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

    List<String> columns = query.get("columns") instanceof List<?> cols && !cols.isEmpty()
        ? cols.stream().map(column).toList()
        : table.columns().stream().map(c -> d.quote(c.name())).toList();

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
          default -> conditions.add(col + " " + (op.equals("!=") ? "<>" : op) + " " + bind.apply(value));
        }
      }
    }

    List<String> order = new ArrayList<>();
    if (query.get("orderBy") instanceof List<?> orderBy) {
      for (Object item : orderBy) {
        Map<String, Object> o = item instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Object dir = o.get("dir");
        if (dir != null && !"asc".equals(dir) && !"desc".equals(dir)) throw new ApiError(400, "orderBy.dir must be asc or desc.");
        order.add(column.apply(o.get("column")) + ("desc".equals(dir) ? " DESC" : " ASC"));
      }
    }

    int requested = query.get("limit") instanceof Number n && n.intValue() > 0 ? n.intValue() : maxRows;
    int limit = Math.min(requested, maxRows);
    // One extra row tells us whether the result was truncated.
    String sql = d.select(String.join(", ", columns), d.quote(table.name()),
        conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions),
        order.isEmpty() ? "" : " ORDER BY " + String.join(", ", order),
        limit + 1);
    return new Built(sql, values, limit);
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
    return new Built(d.wrapLimit(text.toString(), maxRows + 1), values, maxRows);
  }
}
