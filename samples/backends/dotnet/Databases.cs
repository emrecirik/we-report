using System.Data;
using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace WeReport.Backend;

/// <summary>SQL differences between engines, plus schema and query execution for one connection.</summary>
public interface IDialect
{
    string Quote(string name);
    string Placeholder(int index);
    string Select(string columns, string table, string where, string orderBy, int top);
    string WrapLimit(string sql, int top);
    Task<IReadOnlyList<TableInfo>> SchemaAsync(CancellationToken ct);
    Task<List<Dictionary<string, object?>>> QueryAsync(BuiltQuery query, int timeoutSeconds, CancellationToken ct);
}

public abstract class Database(ConnectionConfig config) : IDialect
{
    protected ConnectionConfig Config { get; } = config;

    public virtual string Quote(string name) => "\"" + name.Replace("\"", "\"\"") + "\"";
    public string Placeholder(int index) => "@p" + index;
    public virtual string Select(string columns, string table, string where, string orderBy, int top) =>
        $"SELECT {columns} FROM {table}{where}{orderBy} LIMIT {top}";
    public virtual string WrapLimit(string sql, int top) => $"SELECT * FROM ({sql}) AS we_report_q LIMIT {top}";

    protected abstract DbConnection Open();
    public abstract Task<IReadOnlyList<TableInfo>> SchemaAsync(CancellationToken ct);

    /// <summary>Hook to make the session read-only and time-limited where the engine supports it.</summary>
    protected virtual Task PrepareAsync(DbConnection connection, DbTransaction tx, int timeoutSeconds, CancellationToken ct) => Task.CompletedTask;

    public async Task<List<Dictionary<string, object?>>> QueryAsync(BuiltQuery query, int timeoutSeconds, CancellationToken ct)
    {
        await using var connection = Open();
        await connection.OpenAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);
        await PrepareAsync(connection, tx, timeoutSeconds, ct);
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = query.Sql;
        cmd.CommandTimeout = timeoutSeconds;
        for (var i = 0; i < query.Values.Count; i++)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = "@p" + (i + 1);
            p.Value = query.Values[i] ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }
        var rows = new List<Dictionary<string, object?>>();
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var row = new Dictionary<string, object?>(reader.FieldCount);
                for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = Plain(reader.IsDBNull(i) ? null : reader.GetValue(i));
                rows.Add(row);
            }
        }
        // Reports only read: nothing to commit, so roll back whatever the statement might have done.
        await tx.RollbackAsync(ct);
        return rows;
    }

    /// <summary>JSON-friendly values. Dates keep their calendar day (no time-zone shift).</summary>
    static object? Plain(object? v) => v switch
    {
        null => null,
        DateTime d when d.TimeOfDay == TimeSpan.Zero => d.ToString("yyyy-MM-dd"),
        DateTime d => d.ToString("yyyy-MM-ddTHH:mm:ss"),
        DateOnly d => d.ToString("yyyy-MM-dd"),
        DateTimeOffset d => d.ToString("o"),
        decimal m => (double)m,
        long l when l is > 9007199254740991 or < -9007199254740991 => l.ToString(),
        byte[] => null, // shortcut: binary columns are not reportable yet.
        Guid g => g.ToString(),
        _ => v,
    };

    protected static string TypeOf(string? declared)
    {
        var t = (declared ?? "").ToUpperInvariant();
        if (t.Contains("INT") || t.Contains("DEC") || t.Contains("NUM") || t.Contains("REAL") || t.Contains("FLOA") || t.Contains("DOUB") || t.Contains("MONEY")) return "number";
        if (t.Contains("DATE") || t.Contains("TIME")) return "date";
        if (t.Contains("BOOL") || t == "BIT") return "boolean";
        if (t.Contains("CHAR") || t.Contains("TEXT") || t.Contains("CLOB") || t.Contains("UUID") || t.Contains("UNIQUEIDENTIFIER")) return "string";
        return "unknown";
    }

    protected static async Task<IReadOnlyList<TableInfo>> GroupColumnsAsync(DbCommand cmd, CancellationToken ct)
    {
        var tables = new Dictionary<string, TableInfo>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var table = reader.GetString(0);
            if (!tables.TryGetValue(table, out var info)) tables[table] = info = new TableInfo(table, []);
            info.Columns.Add(new ColumnInfo(reader.GetString(1), TypeOf(reader.GetString(2))));
        }
        return [.. tables.Values];
    }

    public static Database Create(ConnectionConfig c) => c.Dialect switch
    {
        "sqlite" => new SqliteDatabase(c),
        "postgres" => new PostgresDatabase(c),
        "sqlserver" => new SqlServerDatabase(c),
        _ => throw new InvalidOperationException($"Unsupported dialect {c.Dialect}"),
    };
}

public sealed class SqliteDatabase : Database
{
    readonly string _readOnly;

    public SqliteDatabase(ConnectionConfig c) : base(c)
    {
        var builder = new SqliteConnectionStringBuilder(c.ConnectionString);
        if (c.SeedFile is not null && !File.Exists(builder.DataSource))
        {
            using var seed = new SqliteConnection(builder.ToString());
            seed.Open();
            using var cmd = seed.CreateCommand();
            cmd.CommandText = File.ReadAllText(c.SeedFile);
            cmd.ExecuteNonQuery();
        }
        // Read-only at the driver level: even an allowed free SQL statement cannot write.
        builder.Mode = SqliteOpenMode.ReadOnly;
        _readOnly = builder.ToString();
    }

    protected override DbConnection Open() => new SqliteConnection(_readOnly);

    public override async Task<IReadOnlyList<TableInfo>> SchemaAsync(CancellationToken ct)
    {
        await using var connection = Open();
        await connection.OpenAsync(ct);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT m.name, p.name, p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p
            WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid
            """;
        return await GroupColumnsAsync(cmd, ct);
    }
}

public sealed class PostgresDatabase(ConnectionConfig c) : Database(c)
{
    readonly NpgsqlDataSource _source = NpgsqlDataSource.Create(c.ConnectionString);
    string SchemaName => Config.Schema ?? "public";

    protected override DbConnection Open() => _source.CreateConnection();

    protected override async Task PrepareAsync(DbConnection connection, DbTransaction tx, int timeoutSeconds, CancellationToken ct)
    {
        // Read-only transaction with a statement timeout: defence in depth beside the read-only user.
        await using var cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = {timeoutSeconds * 1000}; SET LOCAL search_path = {Quote(SchemaName)}";
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public override async Task<IReadOnlyList<TableInfo>> SchemaAsync(CancellationToken ct)
    {
        await using var connection = Open();
        await connection.OpenAsync(ct);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = @s ORDER BY table_name, ordinal_position";
        cmd.Parameters.Add(new NpgsqlParameter("s", SchemaName));
        return await GroupColumnsAsync(cmd, ct);
    }
}

public sealed class SqlServerDatabase(ConnectionConfig c) : Database(c)
{
    string SchemaName => Config.Schema ?? "dbo";

    public override string Quote(string name) => "[" + name.Replace("]", "]]") + "]";
    public override string Select(string columns, string table, string where, string orderBy, int top) =>
        $"SELECT TOP ({top}) {columns} FROM {Quote(SchemaName)}.{table}{where}{orderBy}";
    // shortcut: SQL Server rejects ORDER BY inside a derived table without TOP; free SQL with ORDER BY
    // needs its own TOP. Parse the statement if that becomes a common complaint.
    public override string WrapLimit(string sql, int top) => $"SELECT TOP ({top}) * FROM ({sql}) AS we_report_q";

    protected override DbConnection Open() => new SqlConnection(Config.ConnectionString);

    public override async Task<IReadOnlyList<TableInfo>> SchemaAsync(CancellationToken ct)
    {
        await using var connection = Open();
        await connection.OpenAsync(ct);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @s ORDER BY TABLE_NAME, ORDINAL_POSITION";
        cmd.Parameters.Add(new SqlParameter("@s", SqlDbType.NVarChar) { Value = SchemaName });
        return await GroupColumnsAsync(cmd, ct);
    }
}
