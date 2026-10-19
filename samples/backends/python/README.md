# we-report backend — Python (FastAPI)

Serves live database data and proxies web services for the we-report designer and viewer, over the
[we-report data protocol](../../../protocol/openapi.yaml). SQLite (standard library) and PostgreSQL
(psycopg). Four small files: `main.py` (endpoints), `query.py`, `databases.py`, `fetch_guard.py`.

You need a backend **only** for live databases or for web services that block browser calls (CORS)
or need secret keys. JSON, CSV and open web services work without one.

## Run in 3 commands

```bash
cd samples/backends/python
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
.venv/bin/python main.py      # http://127.0.0.1:5480 with the fictional sample shop (SQLite)
```

PostgreSQL: `pip install "psycopg[binary]"`. Requires Python 3.10+.

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
**Use a read-only database user.** SQLite is also opened read-only (`mode=ro`); PostgreSQL queries
run in a `READ ONLY` transaction with a `statement_timeout` and are always rolled back.

## Settings, authentication, security

Same environment variables and behaviour as the other samples — see the
[Node sample](../node/README.md#settings). Authentication lives in the `access` middleware in
`main.py`. The web service proxy resolves the host once, checks every address and connects to the
checked IP (TLS still verifies the real hostname), so DNS rebinding cannot bypass it.

## Prove it

```bash
.venv/bin/python main.py &
node ../../../tools/protocol-conformance/run.mjs http://127.0.0.1:5480
```
