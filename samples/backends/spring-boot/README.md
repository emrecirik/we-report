# we-report backend — Java (Spring Boot)

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml) 1.1 — including the grid queries (`offset`,
`distinct`, `count` → `total`, `contains` / `startsWith`) and saved layouts (`/v1/layouts/{key}`). SQL Server, PostgreSQL and SQLite with
plain JDBC; one controller (`Api.java`) you can drop into an existing Spring Boot application.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 3 commands

```bash
cd samples/backends/spring-boot
./mvnw -DskipTests package
java -jar target/we-report-backend-0.1.0.jar   # http://127.0.0.1:5480, fictional sample shop (SQLite)
```

Then in the designer: **Data sources → + Database**, backend address `http://127.0.0.1:5480`.
For your own Angular app: `provideWeReport({ backendUrl: 'http://127.0.0.1:5480' })`.

Requires Java 21. Spring Boot 4.

## Connections

Configured by you, never sent by the browser: `connections.json` in the working directory
(git-ignored) or the `WE_REPORT_CONNECTIONS` environment variable:

```json
[
  { "id": "erp", "name": "ERP (SQL Server)", "dialect": "sqlserver",
    "url": "jdbc:sqlserver://db:1433;databaseName=Erp;user=report_reader;password=…;encrypt=false",
    "schema": "dbo", "maxRows": 5000, "timeoutMs": 15000 },
  { "id": "shop", "name": "Shop (PostgreSQL)", "dialect": "postgres",
    "url": "jdbc:postgresql://db:5432/shop?user=report_reader&password=…" },
  { "id": "local", "name": "Local SQLite", "dialect": "sqlite", "url": "data/local.db" }
]
```

The browser only ever sees `id`, `name`, `dialect` and whether free SQL is allowed.
**Use a read-only database user** — it is the guard that cannot be bypassed. The backend also
opens SQLite read-only, marks every JDBC connection read-only, sets a PostgreSQL
`statement_timeout`, applies a JDBC query timeout and rolls back every transaction.

Free SQL is off; enable it per connection with `"allowFreeSql": true` for trusted designers only.

## Settings

Same environment variables as every we-report sample backend: `WE_REPORT_HOST` (default
`127.0.0.1`), `WE_REPORT_PORT`, `WE_REPORT_AUTH_TOKEN`, `WE_REPORT_CORS_ORIGINS`,
`WE_REPORT_FETCH`, `WE_REPORT_FETCH_ALLOW_HOSTS`, `WE_REPORT_RATE_LIMIT`, `WE_REPORT_DEMO`,
`WE_REPORT_LAYOUTS_DIR` (where saved grid layouts go, one JSON file per key; default
`<temp>/we-report-layouts`, off in demo mode) — see the [Node sample](../node/README.md#settings) for the table.

## Authentication

The `accessFilter` bean in `WeReportBackendApplication` is the one place for auth. If your app uses
Spring Security, delete the token check there and secure `/v1/**` like your other endpoints.

## Security in this sample

- Identifiers are validated against the live schema and quoted (`"x"` / `[x]`); values are JDBC
  parameters.
- Row limit (`truncated: true`) and query timeout on every query.
- The web service proxy resolves and checks every hop (redirects are followed by hand) and pins
  the JVM DNS cache so the connection uses the checked address; 5 MB / 10 s caps.
- Saved layouts: keys are validated and stored under a hex file name (no key can leave the
  directory), JSON objects only, 256 KB cap, written to a temp file and renamed.
- Errors never echo internals; unexpected errors are logged on the server only.

## Prove it

```bash
java -jar target/we-report-backend-0.1.0.jar &
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```
