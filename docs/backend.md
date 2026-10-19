# Data backend

we-report does everything in the browser. A backend is only needed for **live databases** and for
**web services that block browser calls** or need secret keys. It is small, and you can write it in
any language — the contract is [`protocol/openapi.yaml`](../protocol/openapi.yaml):

| Endpoint | Does |
|---|---|
| `GET /v1/info` | Protocol version and capabilities |
| `GET /v1/connections` | Connection ids and names (never connection strings) |
| `GET /v1/connections/{id}/schema` | Tables and typed columns |
| `POST /v1/connections/{id}/query` | A [structured query](../protocol/schemas/query.json) (or free SQL if allowed) with parameters |
| `POST /v1/webservice/fetch` | Fetches a web service for the report, refusing internal addresses |

## Ready-made backends

| Language | Folder | Databases |
|---|---|---|
| Node.js (no dependencies) | [`samples/backends/node`](../samples/backends/node) | SQLite, PostgreSQL |
| .NET (ASP.NET Core) | [`samples/backends/dotnet`](../samples/backends/dotnet) | SQL Server, PostgreSQL, SQLite |
| Java (Spring Boot) | [`samples/backends/spring-boot`](../samples/backends/spring-boot) | SQL Server, PostgreSQL, SQLite |
| Python (FastAPI) | [`samples/backends/python`](../samples/backends/python) | PostgreSQL, SQLite |
| PHP (no framework, PDO) | [`samples/backends/php`](../samples/backends/php) | PostgreSQL, SQLite |
| Go (single binary) | [`samples/backends/go`](../samples/backends/go) | PostgreSQL, SQLite (pure Go) |

Each one runs in about three commands, ships a Dockerfile, and serves a fictional sample shop
database when no connection is configured. Every one passes the same
[conformance suite](../tools/protocol-conformance/run.mjs) in CI, against SQLite and PostgreSQL.

## Security (all samples)

- Connection strings live only on the server; responses and errors never contain them.
- Table and column names are checked against the live schema and quoted; values are always driver
  parameters — the suite tries SQL injection through names and values.
- Free SQL is off by default; when on, it is one `SELECT` with parameters.
- Every query has a row limit (reported as `truncated`) and a timeout; SQLite is opened read-only,
  PostgreSQL runs in `READ ONLY` transactions. Still: **use a read-only database user.**
- The web service proxy refuses loopback, private, link-local and cloud-metadata addresses —
  checked on the address actually connected to, and again after each redirect.
- Listens on `127.0.0.1` unless authentication is configured (`WE_REPORT_AUTH_TOKEN` or your own).
- CORS allow-list, never `*`. Rate limit per IP.

## Writing your own

Implement the five endpoints, then prove it:

```bash
# serve the sample dataset (samples/data/seed.sql) on a connection, then:
node tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```

A backend that passes the suite works with the designer and viewer. PHP and Go samples are open for
contributions — the suite tells you when yours is done.

## Public demo mode

`WE_REPORT_DEMO=1` serves fixed read-only connections to anyone: no free SQL, no web service proxy,
60 requests per minute per IP. This is how the live demo behind the public Studio runs.
