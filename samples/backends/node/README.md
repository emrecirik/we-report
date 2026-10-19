# we-report backend — Node.js (reference)

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml). No framework, no dependencies for SQLite
(Node's built-in `node:sqlite`); `pg` is installed only if you use PostgreSQL.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 3 commands

```bash
cd samples/backends/node
npm install          # optional: only installs pg
npm start            # http://127.0.0.1:5480 with the fictional sample shop database
```

Then in the designer: **Data sources → + Database**, backend address `http://127.0.0.1:5480`.
For your own Angular app: `provideWeReport({ backendUrl: 'http://127.0.0.1:5480' })`.

Requires Node 22.13+ (for `node:sqlite`). With Docker: `docker compose up` (Postgres + this backend).

## Connections

Connections are configured by you, never sent by the browser. Put them in `connections.json`
(next to `package.json`, git-ignored) or in the `WE_REPORT_CONNECTIONS` environment variable:

```json
[
  { "id": "shop", "name": "Shop (PostgreSQL)", "dialect": "postgres",
    "url": "postgres://report_reader:secret@db:5432/shop", "schema": "public",
    "maxRows": 5000, "timeoutMs": 15000 },
  { "id": "local", "name": "Local SQLite", "dialect": "sqlite", "url": "./data/local.db" }
]
```

The browser only ever sees `id`, `name`, `dialect` and whether free SQL is allowed.
**Use a read-only database user.** The backend also opens SQLite read-only and runs every
PostgreSQL query in a `READ ONLY` transaction with a statement timeout — but the database user is
the guard that cannot be bypassed.

Free SQL is off. Enable it per connection with `"allowFreeSql": true` only for trusted designers;
it still allows one `SELECT`, with `:name` parameters and the row limit.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `WE_REPORT_HOST` | `127.0.0.1` | Listen address. Anything else requires `WE_REPORT_AUTH_TOKEN` (or your own auth). |
| `WE_REPORT_PORT` / `PORT` | `5480` | Port. |
| `WE_REPORT_AUTH_TOKEN` | — | When set, every request needs `Authorization: Bearer <token>`. |
| `WE_REPORT_CORS_ORIGINS` | `http://localhost:4200,http://127.0.0.1:4200` | Origins allowed to call from a browser. Never `*`. |
| `WE_REPORT_FETCH` | on | `0` disables the web service proxy. |
| `WE_REPORT_FETCH_ALLOW_HOSTS` | — | Internal hostnames the proxy may reach anyway (comma separated). |
| `WE_REPORT_RATE_LIMIT` | `600` (`60` in demo) | Requests per minute per IP. |
| `WE_REPORT_DEMO` | — | `1` = public demo: fixed connections, no free SQL, no proxy, open to anyone. |

## Authentication

`authorize(req)` in `src/server.mjs` is the one place to plug in your own auth (session cookie,
JWT, API gateway header). Without a token the backend only answers local callers.

## Security in this sample

- Identifiers are validated against the live schema and quoted; values are driver parameters.
- Row limit (`truncated: true` in the response) and statement timeout on every query.
- The web service proxy refuses loopback, private, link-local and cloud metadata addresses,
  checked at connection time (no DNS-rebinding window) and after every redirect; 5 MB / 10 s caps.
- Errors never echo internals; unexpected errors are logged on the server only.

## Prove it

```bash
npm test                                                   # unit tests
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480   # protocol suite
```
