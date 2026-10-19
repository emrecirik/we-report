# we-report backend — PHP

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml). Plain PHP 8.2+, no framework, no Composer
packages: PDO (SQLite, PostgreSQL) and the curl extension. Four files: `public/index.php`
(settings, access, endpoints), `src/query.php`, `src/databases.php`, `src/fetch_guard.php`.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 2 commands

```bash
cd samples/backends/php
php -S 127.0.0.1:5480 public/index.php   # the fictional sample shop (SQLite)
```

Extensions: `pdo_sqlite`, `curl` (and `pdo_pgsql` for PostgreSQL). On shared hosting or behind
nginx/Apache + php-fpm, point the front controller at `public/index.php`; keep `src/` outside the
web root.

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
also opened read-only; PostgreSQL queries run in a `READ ONLY` transaction with a
`statement_timeout`, are always rolled back, and connections have a connect timeout. Values always
go through PDO prepared statements.

## Settings, authentication, security

Same environment variables and behaviour as the other samples — see the
[Node sample](../node/README.md#settings). Authentication lives at the top of `handle()` in
`public/index.php`; without `WE_REPORT_AUTH_TOKEN` the backend answers only local callers that
address it as a local host (DNS-rebinding safe). The rate limit keeps its counts in small files in
the temp folder (PHP keeps no memory between requests). The web service proxy resolves the host
once, refuses internal addresses (IPv4/IPv6, IPv4-mapped, NAT64, numeric shorthands like
`2130706433`) and pins curl to the checked address with `CURLOPT_RESOLVE`; TLS still verifies the
real hostname. Redirects are re-checked and drop the caller's headers when the origin changes.

## Docker

```bash
docker build -f samples/backends/php/Dockerfile -t we-report-php .   # from the repository root
docker run -p 5480:5480 -e WE_REPORT_AUTH_TOKEN=change-me we-report-php
```

## Prove it

```bash
php -S 127.0.0.1:5480 public/index.php &
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```
