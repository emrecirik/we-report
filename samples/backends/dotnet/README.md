# we-report backend — .NET (ASP.NET Core)

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml) 1.1 — including the grid additions
(`offset`, `distinct`, `contains` / `startsWith`, `count` → `total`) and saved grid layouts
(`/v1/layouts/{key}`) used by we-grid-angular. SQL Server, PostgreSQL and SQLite; one
`Program.cs` with minimal APIs — copy it into your own ASP.NET Core app or run it as is.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 3 commands

```bash
cd samples/backends/dotnet
dotnet run -c Release      # http://127.0.0.1:5480 with the fictional sample shop database (SQLite)
```

Then in the designer: **Data sources → + Database**, backend address `http://127.0.0.1:5480`.
For your own Angular app: `provideWeReport({ backendUrl: 'http://127.0.0.1:5480' })`.

Requires the .NET 10 SDK. With Docker: `docker compose up` (SQL Server + this backend).

## Connections

Configured by you, never sent by the browser: `connections.json` next to the project (git-ignored),
or the `WE_REPORT_CONNECTIONS` environment variable / `appsettings.json` key:

```json
[
  { "id": "erp", "name": "ERP (SQL Server)", "dialect": "sqlserver",
    "url": "Server=db;Database=Erp;User Id=report_reader;Password=…;TrustServerCertificate=True",
    "schema": "dbo", "maxRows": 5000, "timeoutMs": 15000 },
  { "id": "shop", "name": "Shop (PostgreSQL)", "dialect": "postgres",
    "url": "Host=db;Database=shop;Username=report_reader;Password=…" },
  { "id": "local", "name": "Local SQLite", "dialect": "sqlite", "url": "data/local.db" }
]
```

The browser only ever sees `id`, `name`, `dialect` and whether free SQL is allowed.
**Use a read-only database user** — it is the guard that cannot be bypassed. The backend also
opens SQLite read-only, runs PostgreSQL queries in a `READ ONLY` transaction with a statement
timeout, rolls back every transaction, and applies a command timeout everywhere.

Free SQL is off; enable it per connection with `"allowFreeSql": true` for trusted designers only.
It still allows one `SELECT`, with `:name` parameters and the row limit.

## Settings

Same environment variables as every we-report sample backend:

| Variable | Default | Meaning |
|---|---|---|
| `WE_REPORT_HOST` | `127.0.0.1` | Listen address. Anything else requires `WE_REPORT_AUTH_TOKEN` (or your own auth). |
| `WE_REPORT_PORT` / `PORT` | `5480` | Port. |
| `WE_REPORT_AUTH_TOKEN` | — | When set, every request needs `Authorization: Bearer <token>`. |
| `WE_REPORT_CORS_ORIGINS` | `http://localhost:4200,http://127.0.0.1:4200` | Origins allowed to call from a browser. Never `*`. |
| `WE_REPORT_FETCH` | on | `0` disables the web service proxy. |
| `WE_REPORT_FETCH_ALLOW_HOSTS` | — | Internal hostnames the proxy may reach anyway. |
| `WE_REPORT_RATE_LIMIT` | `600` (`60` in demo) | Requests per minute per IP. |
| `WE_REPORT_LAYOUTS_DIR` | `<temp>/we-report-layouts` | Where saved grid layouts are kept: one JSON file per key (max 256 KB), named by the key in hex. |
| `WE_REPORT_DEMO` | — | `1` = public demo: fixed connections, no free SQL, no proxy, no saved layouts. |

## Authentication

`Authorize(HttpContext)` in `Program.cs` is the one place to plug in your own auth — e.g. replace it
with `app.UseAuthentication()` + `RequireAuthorization()` on the endpoints if your app already has
cookie or JWT authentication. Without a token the backend only answers local callers.

## Security in this sample

- Identifiers are validated against the live schema and quoted (`"x"` / `[x]`); values are
  command parameters (`@p1 …`).
- Row limit (`truncated: true`) and command timeout on every query.
- The web service proxy checks the address inside `SocketsHttpHandler.ConnectCallback` — the
  address actually connected to — so DNS rebinding cannot bypass it; redirects are re-checked;
  5 MB / 10 s caps.
- Errors never echo internals; unexpected errors are logged on the server only.

Known limit: free SQL on SQL Server cannot contain its own `ORDER BY` without `TOP` (the row limit
and `count` wrap it in a derived table). The query builder is not affected.

## Prove it

```bash
dotnet run -c Release &
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```
