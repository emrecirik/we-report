using System.Text.Json;
using System.Text.RegularExpressions;

namespace WeReport.Backend;

/// <summary>A database the backend may query. The connection string never leaves the server.</summary>
public sealed record ConnectionConfig(
    string Id,
    string Name,
    string Dialect,
    string ConnectionString,
    bool AllowFreeSql,
    int MaxRows,
    int TimeoutSeconds,
    string? Schema,
    string? SeedFile);

/// <summary>All settings come from configuration (appsettings / environment), never from requests.</summary>
public sealed class BackendConfig
{
    public required string Host { get; init; }
    public required int Port { get; init; }
    public required bool Demo { get; init; }
    public string? AuthToken { get; init; }
    public required string[] CorsOrigins { get; init; }
    public required bool WebServiceFetch { get; init; }
    public required HashSet<string> FetchAllowHosts { get; init; }
    public required int RateLimitPerMinute { get; init; }
    public required IReadOnlyList<ConnectionConfig> Connections { get; init; }

    public bool IsLoopback => Host is "127.0.0.1" or "::1" or "localhost";

    static readonly string SampleSeed = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "seed.sql"));

    public static BackendConfig Load(IConfiguration c)
    {
        var demo = c["WE_REPORT_DEMO"] == "1";
        return new BackendConfig
        {
            Host = c["WE_REPORT_HOST"] ?? "127.0.0.1",
            Port = int.TryParse(c["WE_REPORT_PORT"] ?? c["PORT"], out var p) ? p : 5480,
            Demo = demo,
            AuthToken = string.IsNullOrEmpty(c["WE_REPORT_AUTH_TOKEN"]) ? null : c["WE_REPORT_AUTH_TOKEN"],
            CorsOrigins = List(c["WE_REPORT_CORS_ORIGINS"] ?? "http://localhost:4200,http://127.0.0.1:4200"),
            // The fetch proxy would be an open proxy on a public demo.
            WebServiceFetch = !demo && c["WE_REPORT_FETCH"] != "0",
            FetchAllowHosts = List(c["WE_REPORT_FETCH_ALLOW_HOSTS"]).Select(h => h.ToLowerInvariant()).ToHashSet(),
            RateLimitPerMinute = int.TryParse(c["WE_REPORT_RATE_LIMIT"], out var r) ? r : demo ? 60 : 600,
            Connections = LoadConnections(c, demo),
        };
    }

    static string[] List(string? value) =>
        string.IsNullOrWhiteSpace(value) ? [] : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>
    /// <c>WE_REPORT_CONNECTIONS</c> (JSON) or <c>connections.json</c>; without either, a SQLite
    /// connection with the fictional sample dataset. Entry: { id, name, dialect: sqlite | postgres |
    /// sqlserver, url, allowFreeSql?, maxRows?, timeoutMs?, schema?, seed?: "sample" }.
    /// </summary>
    static List<ConnectionConfig> LoadConnections(IConfiguration c, bool demo)
    {
        var json = c["WE_REPORT_CONNECTIONS"];
        if (string.IsNullOrWhiteSpace(json) && File.Exists("connections.json")) json = File.ReadAllText("connections.json");
        if (string.IsNullOrWhiteSpace(json))
        {
            var file = Path.Combine(Path.GetTempPath(), "we-report-sample-dotnet.db");
            return [new("sample", "Sample shop (SQLite)", "sqlite", $"Data Source={file}", false, 5000, 15, null, SampleSeed)];
        }

        var list = new List<ConnectionConfig>();
        foreach (var e in JsonDocument.Parse(json).RootElement.EnumerateArray())
        {
            string Req(string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s
                ? s : throw new InvalidOperationException($"Every connection needs \"{name}\".");
            var id = Req("id");
            if (!Regex.IsMatch(id, @"^[\w-]+$") || list.Any(x => x.Id == id))
                throw new InvalidOperationException($"Connection id \"{id}\" must be unique and use letters, digits, _ or -.");
            var dialect = Req("dialect");
            if (dialect is not ("sqlite" or "postgres" or "sqlserver")) throw new InvalidOperationException($"Unsupported dialect \"{dialect}\".");
            list.Add(new(
                id,
                Req("name"),
                dialect,
                dialect == "sqlite" && !Req("url").Contains('=') ? $"Data Source={Req("url")}" : Req("url"),
                // Demo mode never runs free SQL, whatever the file says.
                !demo && e.TryGetProperty("allowFreeSql", out var f) && f.ValueKind == JsonValueKind.True,
                Math.Min(e.TryGetProperty("maxRows", out var m) && m.TryGetInt32(out var mi) ? mi : 5000, 50000),
                Math.Max(1, (e.TryGetProperty("timeoutMs", out var t) && t.TryGetInt32(out var ti) ? ti : 15000) / 1000),
                e.TryGetProperty("schema", out var s) ? s.GetString() : null,
                e.TryGetProperty("seed", out var seed) && seed.GetString() == "sample" ? SampleSeed : null));
        }
        return list;
    }
}
