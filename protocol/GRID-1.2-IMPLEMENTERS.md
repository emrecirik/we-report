# Implementing protocol 1.2 in a sample backend

Protocol 1.2 is backward compatible (`/v1`, `info.protocol` stays `1`) and builds on
[1.1](GRID-1.1-IMPLEMENTERS.md). It lets a grid scroll, search and group a whole table — a billion
rows — without loading it. The reference is `samples/backends/node/src/query.mjs`; the contract is
`protocol/openapi.yaml` + `protocol/schemas/query.json`; the proof is
`tools/protocol-conformance/run.mjs` (20 checks with the web-service proxy on). Every sample backend
implements it.

## Search (`query.search`)

- `{ text, columns }`: `text` a string of at most 200 characters, `columns` 1-50 known columns,
  else 400 `search needs text (at most 200 characters) and 1-50 columns.`
- `text` is split on whitespace; the first 10 words count. Every word must appear in some column:
  AND across words, OR across columns, ANDed with `where`.
- Per word and column: `LOWER(<col as text>) LIKE LOWER(:p) ESCAPE '\'` with `:p` = `%word%`, the
  word escaped as for `contains`. A driver parameter, as always.
- "As text": `CAST(col AS TEXT)`; DuckDB and PostgreSQL may use `VARCHAR`; SQL Server
  `CAST(col AS NVARCHAR(4000))` — `TEXT` there is a deprecated LOB type `LOWER` does not take.
- `count: true` counts the searched rows.

## Groups (`query.groupBy`, `query.aggregates`)

- `groupBy`: 1-8 different known columns, else 400 `groupBy must list 1-8 different columns.`
  Not together with `columns`, `distinct` or an `offset` > 0 (400
  `groupBy does not go with columns, distinct or offset.`).
- `aggregates` (needs `groupBy`, else 400 `aggregates need groupBy.`): at most 32 of
  `{ column, fn, as }`, `fn` one of `sum avg min max count` (400 `Unsupported aggregate "x".`),
  `as` matching `^(?!__)[A-Za-z_][A-Za-z0-9_]{0,63}$` (400
  `Aggregate name "x" must be a plain identifier not starting with __.`) and unique (400
  `Aggregate names must be different.`).
- SQL: `SELECT <groupBy cols>, COUNT(*) AS "__count", FN(col) AS "<as>" … FROM t WHERE … GROUP BY <groupBy cols>`.
- Without `orderBy`, groups come ordered by the `groupBy` columns ascending, NULL first — the order
  a grouped page query uses, so the counts add up to row offsets on the client.
- `limit` and `truncated` work as for rows: a truncated group list tells the client there are too
  many groups.

## Where empty values go (`orderBy[].nulls`)

- `"first"` or `"last"`, else 400 `orderBy.nulls must be first or last.` Absent: the database's
  default, as before.
- Emulated with `CASE WHEN col IS NULL THEN 0 ELSE 1 END, col <dir>` (`1 … 0` for last): SQL Server
  and MySQL have no `NULLS FIRST/LAST`, and one form keeps every backend alike.

## Info

- `info.capabilities.search: true` and `info.capabilities.groups: true`. Clients only send
  `search` / `groupBy` when these are set.

Update the backend's README (protocol 1.2). Keep every rule in `.claude/rules/backend-security.md`.
