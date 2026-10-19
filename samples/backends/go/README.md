# we-report backend — Go

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml) **1.1** (paging with `offset` and `total`,
`distinct`, `contains` / `startsWith`, saved grid layouts under `/v1/layouts/{key}`). SQLite ([modernc.org/sqlite](https://gitlab.com/cznic/sqlite),
pure Go — no C compiler needed) and PostgreSQL ([pgx](https://github.com/jackc/pgx)). Four files:
`main.go` (settings, access, endpoints, layouts), `query.go`, `databases.go`, `fetch_guard.go`.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 2 commands

```bash
cd samples/backends/go
go run .          # http://127.0.0.1:5480 with the fictional sample shop (SQLite)
```

Requires Go 1.26+. A single static binary: `go build -o we-report-backend .`

Then in the designer: **Data sources → + Database**, backend address `http://127.0.0.1:5480`.

## Connections

`connections.json` in the working directory (git-ignored) or `WE_REPORT_CONNECTIONS`:

```json
[
  { "id": "shop", "name": "Shop (PostgreSQL)", "dialect": "postgres",
    "url": "postgresql://report_reader:…@db:5432/shop", "maxRows": 5000, "timeoutMs": 15000 },
  { "id": "local", "name": "Local SQLite", "dialect": "sqlite", "url": "data/local.db" }
]
```

The browser only ever sees `id`, `name`, `dialect` and whether free SQL is allowed.
**Use a read-only database user** ([PostgreSQL script](../node/postgres-readonly.sql)). SQLite is
also opened read-only (`mode=ro`); PostgreSQL queries run in a `READ ONLY` transaction with a
`statement_timeout`, are always rolled back, and connections have a connect timeout.

## Settings, authentication, security

Same environment variables and behaviour as the other samples — see the
[Node sample](../node/README.md#settings).
Saved grid layouts are stored one JSON file per key in `WE_REPORT_LAYOUTS_DIR` (default
`<os temp>/we-report-layouts`); demo mode turns them off. Authentication lives in `access()` in `main.go`; without
`WE_REPORT_AUTH_TOKEN` the backend answers only local callers that address it as a local host
(DNS-rebinding safe), and it refuses to listen beyond `127.0.0.1` without a token. The web service
proxy resolves the host once, refuses internal addresses (IPv4/IPv6, IPv4-mapped, NAT64, numeric
shorthands like `2130706433`) and dials only the checked address, IPv4 first; TLS still verifies the
real hostname. Redirects are re-checked and drop the caller's headers when the origin changes.

## Docker

```bash
docker build -f samples/backends/go/Dockerfile -t we-report-go .   # from the repository root
docker run -p 5480:5480 -e WE_REPORT_AUTH_TOKEN=change-me we-report-go
```

## Prove it

```bash
go run . &
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```
