# Implementing protocol 1.1 in a sample backend

Protocol 1.1 is backward compatible (`/v1`, `info.protocol` stays `1`). The reference is
`samples/backends/node` (see `src/query.mjs`, `src/server.mjs`, `src/layouts.mjs`, `src/config.mjs`);
the contract is `protocol/openapi.yaml` + `protocol/schemas/query.json`; the proof is
`tools/protocol-conformance/run.mjs` (15 checks with the web-service proxy on).

## Query (`POST /v1/connections/{id}/query`)

- `query.offset` — integer ≥ 0, else 400. SQL: rows skipped after the limit is applied
  (`LIMIT n+1 OFFSET m`; SQL Server `ORDER BY … OFFSET m ROWS FETCH NEXT n+1 ROWS ONLY`, with
  `ORDER BY (SELECT NULL)` when no order is given). `truncated` keeps its meaning: more rows follow.
- `query.distinct` — boolean (else 400); `SELECT DISTINCT` over `query.columns`, which are then
  required (400 without them).
- Operators `contains` and `startsWith` — case-insensitive, literal:
  `LOWER(col) LIKE LOWER(:p) ESCAPE '\'` where `:p` is `%value%` / `value%` after escaping `\`, `%`
  and `_` in the value with a backslash. The value is still a driver parameter.
- Request `count: true` → result gets `total` (integer): the number of rows the query matches
  without offset/limit — `SELECT COUNT(*) AS total FROM (<select with where, distinct, no order/limit/offset>) AS we_report_c`,
  same parameters. Free SQL with `count: true`: `SELECT COUNT(*) AS total FROM (<sql>) AS we_report_c`.
  Without `count`, `total` is absent.
- `info.capabilities.grid: true`.

## Layouts (`/v1/layouts/{key}`)

- Key: URL-decoded, must match `^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,127}$`, else 400.
- `GET` → 200 with the stored JSON object as-is, 404 `{error}` when missing.
- `PUT` → body must be `application/json` (415), at most 256 KB (413 — read the body and still
  answer 413; do not reset the connection), a JSON **object** (400 for arrays/scalars/invalid JSON).
  Stores it, answers **204** with no body.
- `DELETE` → 204, also when the key did not exist.
- Storage: one file per key in `WE_REPORT_LAYOUTS_DIR` (default `<os temp>/we-report-layouts`),
  file name = the key's UTF-8 bytes in lowercase hex + `.json`; write to a temp file and rename.
- Same rate limit and `authorize` gate as every other route. Demo mode (`WE_REPORT_DEMO=1`):
  `capabilities.layouts: false` and every layouts call answers 403 `{error}` (after key validation).
- `info.capabilities.layouts: !demo`.
- CORS `Access-Control-Allow-Methods` gains `PUT, DELETE`.
- 405 only when the path exists for another method.

Update the backend's README (protocol 1.1, layouts dir env var). Keep every rule in
`.claude/rules/backend-security.md`.
