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
    static readonly HashSet<string> Aggregates = ["sum", "avg", "min", "max", "count"];
    const int MaxInValues = 1000;
    const int MaxSearchWords = 10;

    [GeneratedRegex(@"^(?!__)[A-Za-z_][A-Za-z0-9_]{0,63}$")]
    private static partial Regex Alias();

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

    // A value that is not text reads as "", which no option accepts: a 400, not a 500
    static string? Text(JsonElement? v) => v is { ValueKind: JsonValueKind.String } s ? s.GetString() : v is null or { ValueKind: JsonValueKind.Null } ? null : "";

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
        // 1.2 groups: one row per combination of the groupBy columns, with its count and subtotals
        var groupByProp = Prop(query, "groupBy");
        var grouped = groupByProp is not null;
        var groupCols = new List<string>();
        if (grouped)
        {
            if (groupByProp!.Value.ValueKind != JsonValueKind.Array || groupByProp.Value.GetArrayLength() is 0 or > 8)
                throw new ApiError(400, "groupBy must list 1-8 different columns.");
            var names = groupByProp.Value.EnumerateArray().Select(g => g.ValueKind == JsonValueKind.String ? g.GetString() : null).ToList();
            if (names.Distinct().Count() != names.Count) throw new ApiError(400, "groupBy must list 1-8 different columns.");
            if (hasColumns || distinct || offset > 0) throw new ApiError(400, "groupBy does not go with columns, distinct or offset.");
            groupCols = groupByProp.Value.EnumerateArray().Select(g => Column(g)).ToList();
        }
        var aggregateCols = new List<string>();
        if (Prop(query, "aggregates") is { } aggregatesProp)
        {
            if (!grouped) throw new ApiError(400, "aggregates need groupBy.");
            if (aggregatesProp.ValueKind != JsonValueKind.Array || aggregatesProp.GetArrayLength() > 32) throw new ApiError(400, "aggregates must be a list of at most 32.");
            var aliases = new HashSet<string>();
            foreach (var a in aggregatesProp.EnumerateArray())
            {
                var fn = Prop(a, "fn") is { ValueKind: JsonValueKind.String } f ? f.GetString() : null;
                if (fn is null || !Aggregates.Contains(fn)) throw new ApiError(400, $"Unsupported aggregate \"{fn}\".");
                var name = Prop(a, "as") is { ValueKind: JsonValueKind.String } n ? n.GetString() : null;
                if (name is null || !Alias().IsMatch(name)) throw new ApiError(400, $"Aggregate name \"{name}\" must be a plain identifier not starting with __.");
                if (!aliases.Add(name)) throw new ApiError(400, "Aggregate names must be different.");
                aggregateCols.Add($"{fn.ToUpperInvariant()}({Column(Prop(a, "column"))}) AS {d.Quote(name)}");
            }
        }
        var columns = grouped
            ? [.. groupCols, $"COUNT(*) AS {d.Quote("__count")}", .. aggregateCols]
            : hasColumns
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

        // 1.2 search: every word in some column, read as text — AND across words, OR across columns
        if (Prop(query, "search") is { } search)
        {
            var text = Prop(search, "text") is { ValueKind: JsonValueKind.String } t ? t.GetString()! : null;
            var searchCols = Prop(search, "columns");
            if (text is null || text.Length > 200 || searchCols is not { ValueKind: JsonValueKind.Array } sc || sc.GetArrayLength() is 0 or > 50)
                throw new ApiError(400, "search needs text (at most 200 characters) and 1-50 columns.");
            var searched = searchCols.Value.EnumerateArray().Select(c => Column(c)).ToList();
            foreach (var word in text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(MaxSearchWords))
            {
                var pattern = "%" + Regex.Replace(word, @"[\\%_]", @"\$0") + "%";
                conditions.Add("(" + string.Join(" OR ", searched.Select(col => $"LOWER({d.AsText(col)}) LIKE LOWER({Bind(pattern)}) ESCAPE '\\'")) + ")");
            }
        }

        // Groups come in groupBy order, NULL first, unless the caller orders them
        var order = new List<string>();
        void AddOrder(string col, string? dir, string? nulls)
        {
            var by = $"{col} {(dir == "desc" ? "DESC" : "ASC")}";
            // CASE rather than NULLS FIRST/LAST: every dialect has it (MySQL and SQL Server have no NULLS clause)
            order.Add(nulls is null ? by : $"CASE WHEN {col} IS NULL THEN {(nulls == "first" ? 0 : 1)} ELSE {(nulls == "first" ? 1 : 0)} END, {by}");
        }
        if (Prop(query, "orderBy") is { ValueKind: JsonValueKind.Array } orderBy)
        {
            foreach (var o in orderBy.EnumerateArray())
            {
                var dir = Text(Prop(o, "dir"));
                if (dir is not (null or "asc" or "desc")) throw new ApiError(400, "orderBy.dir must be asc or desc.");
                var nulls = Text(Prop(o, "nulls"));
                if (nulls is not (null or "first" or "last")) throw new ApiError(400, "orderBy.nulls must be first or last.");
                AddOrder(Column(Prop(o, "column")), dir, nulls);
            }
        }
        else if (grouped)
        {
            foreach (var col in groupCols) AddOrder(col, null, "first");
        }

        var requested = Prop(query, "limit") is { ValueKind: JsonValueKind.Number } l && l.TryGetInt32(out var li) && li > 0 ? li : maxRows;
        var limit = Math.Min(requested, maxRows);
        var select = $"SELECT {(distinct ? "DISTINCT " : "")}{string.Join(", ", columns)} FROM {d.Table(table.Name)}" +
            (conditions.Count > 0 ? " WHERE " + string.Join(" AND ", conditions) : "") +
            (grouped ? " GROUP BY " + string.Join(", ", groupCols) : "");
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
