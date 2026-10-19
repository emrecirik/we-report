using System.Text.Json;
using System.Text.RegularExpressions;

namespace WeReport.Backend;

/// <summary>An error whose message is safe to show to the caller.</summary>
public sealed class ApiError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public sealed record TableInfo(string Name, List<ColumnInfo> Columns);
public sealed record ColumnInfo(string Name, string Type);
/// <summary>A statement, its parameters, the row limit, and the statement counting the same rows (protocol 1.1 <c>count</c>).</summary>
public sealed record BuiltQuery(string Sql, List<object?> Values, int Limit, string CountSql);

/// <summary>
/// Turns the protocol's structured query into SQL. Every identifier is checked against the
/// introspected schema and quoted by the dialect; every value is a command parameter.
/// </summary>
public static partial class QueryBuilder
{
    static readonly HashSet<string> Ops = ["=", "!=", "<", "<=", ">", ">=", "like", "contains", "startsWith", "in", "isNull", "notNull"];
    const int MaxInValues = 1000;

    public static object? DriverValue(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.True => 1,
        JsonValueKind.False => 0,
        JsonValueKind.String => v.GetString(),
        JsonValueKind.Number => v.TryGetInt64(out var l) ? l : v.GetDouble(),
        _ => throw new ApiError(400, "Query values must be text, numbers, booleans or null."),
    };

    /// <summary><c>contains</c> / <c>startsWith</c> match the text literally: LIKE's wildcards and the escape character are escaped.</summary>
    static string LikeLiteral(JsonElement v) =>
        Regex.Replace(Convert.ToString(DriverValue(v), System.Globalization.CultureInfo.InvariantCulture) ?? "", @"[\\%_]", @"\$0");

    static JsonElement? Prop(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : null;

    public static BuiltQuery BuildSelect(JsonElement query, IReadOnlyList<TableInfo> schema, IDialect d, JsonElement parameters, int maxRows)
    {
        if (query.ValueKind != JsonValueKind.Object) throw new ApiError(400, "query must be an object.");
        var tableName = Prop(query, "table")?.GetString();
        var table = schema.FirstOrDefault(t => t.Name == tableName) ?? throw new ApiError(400, $"Unknown table \"{tableName}\".");
        var known = table.Columns.Select(c => c.Name).ToHashSet();
        string Column(JsonElement? name)
        {
            var n = name is { ValueKind: JsonValueKind.String } s ? s.GetString()! : null;
            if (n is null || !known.Contains(n)) throw new ApiError(400, $"Unknown column \"{n}\" in \"{table.Name}\".");
            return d.Quote(n);
        }

        var values = new List<object?>();
        string Bind(object? v)
        {
            values.Add(v);
            return d.Placeholder(values.Count);
        }

        var distinct = Prop(query, "distinct") switch
        {
            null => false,
            { ValueKind: JsonValueKind.True } => true,
            { ValueKind: JsonValueKind.False } => false,
            _ => throw new ApiError(400, "distinct must be true or false."),
        };
        var hasColumns = Prop(query, "columns") is { ValueKind: JsonValueKind.Array } cols && cols.GetArrayLength() > 0;
        if (distinct && !hasColumns) throw new ApiError(400, "distinct needs the columns to return.");
        var offset = Prop(query, "offset") switch
        {
            null => 0,
            { ValueKind: JsonValueKind.Number } o when o.TryGetInt32(out var oi) && oi >= 0 => oi,
            _ => throw new ApiError(400, "offset must be a whole number of 0 or more."),
        };
        var columns = hasColumns
            ? Prop(query, "columns")!.Value.EnumerateArray().Select(c => Column(c)).ToList()
            : table.Columns.Select(c => d.Quote(c.Name)).ToList();

        var conditions = new List<string>();
        if (Prop(query, "where") is { ValueKind: JsonValueKind.Array } where)
        {
            foreach (var w in where.EnumerateArray())
            {
                var op = Prop(w, "op")?.GetString();
                if (op is null || !Ops.Contains(op)) throw new ApiError(400, $"Unsupported operator \"{op}\".");
                var col = Column(Prop(w, "column"));
                var value = Prop(w, "param") is { ValueKind: JsonValueKind.String } p
                    ? (parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty(p.GetString()!, out var pv) ? pv : default)
                    : Prop(w, "value") ?? default;
                switch (op)
                {
                    case "isNull": conditions.Add($"{col} IS NULL"); break;
                    case "notNull": conditions.Add($"{col} IS NOT NULL"); break;
                    case "in":
                        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is 0 or > MaxInValues)
                            throw new ApiError(400, $"\"in\" needs a list of 1-{MaxInValues} values.");
                        conditions.Add($"{col} IN ({string.Join(", ", value.EnumerateArray().Select(x => Bind(DriverValue(x))))})");
                        break;
                    case "like": conditions.Add($"{col} LIKE {Bind(DriverValue(value))}"); break;
                    case "contains" or "startsWith":
                        conditions.Add($"LOWER({col}) LIKE LOWER({Bind((op == "contains" ? "%" : "") + LikeLiteral(value) + "%")}) ESCAPE '\\'");
                        break;
                    default: conditions.Add($"{col} {(op == "!=" ? "<>" : op)} {Bind(DriverValue(value))}"); break;
                }
            }
        }

        var order = new List<string>();
        if (Prop(query, "orderBy") is { ValueKind: JsonValueKind.Array } orderBy)
        {
            foreach (var o in orderBy.EnumerateArray())
            {
                var dir = Prop(o, "dir")?.GetString();
                if (dir is not (null or "asc" or "desc")) throw new ApiError(400, "orderBy.dir must be asc or desc.");
                order.Add($"{Column(Prop(o, "column"))} {(dir == "desc" ? "DESC" : "ASC")}");
            }
        }

        var requested = Prop(query, "limit") is { ValueKind: JsonValueKind.Number } l && l.TryGetInt32(out var li) && li > 0 ? li : maxRows;
        var limit = Math.Min(requested, maxRows);
        var select = $"SELECT {(distinct ? "DISTINCT " : "")}{string.Join(", ", columns)} FROM {d.Table(table.Name)}" +
            (conditions.Count > 0 ? " WHERE " + string.Join(" AND ", conditions) : "");
        // One extra row tells us whether the result was truncated.
        var sql = d.Page(select, order.Count > 0 ? " ORDER BY " + string.Join(", ", order) : "", limit + 1, offset, distinct);
        // The same rows without order, offset and limit; only parameters from the WHERE clause are bound.
        return new BuiltQuery(sql, values, limit, $"SELECT COUNT(*) AS total FROM ({select}) AS we_report_c");
    }

    // Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
    [GeneratedRegex(@"'(?:[^']|'')*'|""(?:[^""]|"""")*""|\[[^\]]*\]|--[^\n]*|/\*[\s\S]*?\*/|(?<![:\w@]):([A-Za-z_]\w*)")]
    private static partial Regex LiteralsOrParams();

    [GeneratedRegex(@"'(?:[^']|'')*'|""(?:[^""]|"""")*""|\[[^\]]*\]|--[^\n]*|/\*[\s\S]*?\*/")]
    private static partial Regex Literals();

    /// <summary>Free SQL (only where allowed): one SELECT statement, <c>:name</c> parameters, row limit.</summary>
    public static BuiltQuery BuildFreeSql(string? sql, IDialect d, JsonElement parameters, int maxRows)
    {
        if (string.IsNullOrWhiteSpace(sql)) throw new ApiError(400, "sql must be a non-empty string.");
        var body = sql.Trim().TrimEnd(';').TrimEnd();
        // Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
        // stripper cannot follow, which could hide a second statement. Report SQL never needs them.
        if (Regex.IsMatch(body, @"\\|\$[A-Za-z_]*\$")) throw new ApiError(400, "Free SQL cannot contain backslashes or dollar-quoted strings.");
        var bare = Literals().Replace(body, "''");
        if (bare.Contains(';')) throw new ApiError(400, "Only one SQL statement is allowed.");
        if (!Regex.IsMatch(bare, @"^\s*(select|with)\b", RegexOptions.IgnoreCase)) throw new ApiError(400, "Only SELECT queries are allowed.");
        var values = new List<object?>();
        // Literals and comments are matched first and kept, so only real :name parameters are replaced.
        var text = LiteralsOrParams().Replace(body, m =>
        {
            if (!m.Groups[1].Success) return m.Value;
            var name = m.Groups[1].Value;
            values.Add(parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty(name, out var v) ? DriverValue(v) : null);
            return d.Placeholder(values.Count);
        });
        return new BuiltQuery(d.WrapLimit(text, maxRows + 1), values, maxRows, $"SELECT COUNT(*) AS total FROM ({text}) AS we_report_c");
    }
}
