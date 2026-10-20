// Turns the protocol's structured query into SQL. Every identifier is checked against the
// introspected schema and quoted by the dialect; every value is a driver parameter.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const OPS = new Set(['=', '!=', '<', '<=', '>', '>=', 'like', 'contains', 'startsWith', 'in', 'isNull', 'notNull']);

/** `contains` / `startsWith` match the text literally: LIKE's wildcards and the escape character are escaped. */
const likeLiteral = (v) => String(v ?? '').replace(/[\\%_]/g, (ch) => `\\${ch}`);
const MAX_IN_VALUES = 1000;

/** Parameter values sent as text are typed here; drivers only see numbers, strings, null. */
function driverValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  throw new HttpError(400, 'Query values must be text, numbers, booleans or null.');
}

/**
 * @param {object} query  protocol/schemas/query.json
 * @param {{tables: {name: string, columns: {name: string}[]}[]}} schema
 * @param {{quote(name: string): string, placeholder(i: number): string}} dialect
 * @param {Record<string, unknown>} params
 * @param {number} maxRows
 */
export function buildSelect(query, schema, dialect, params = {}, maxRows = 1000) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new HttpError(400, 'query must be an object.');
  const table = schema.tables.find((t) => t.name === query.table);
  if (!table) throw new HttpError(400, `Unknown table "${query.table}".`);
  const known = new Set(table.columns.map((c) => c.name));
  const column = (name) => {
    if (typeof name !== 'string' || !known.has(name)) throw new HttpError(400, `Unknown column "${name}" in "${table.name}".`);
    return dialect.quote(name);
  };

  const values = [];
  const bind = (v) => {
    values.push(driverValue(v));
    return dialect.placeholder(values.length);
  };

  if (query.distinct !== undefined && typeof query.distinct !== 'boolean') throw new HttpError(400, 'distinct must be true or false.');
  if (query.distinct && !query.columns?.length) throw new HttpError(400, 'distinct needs the columns to return.');
  if (query.offset !== undefined && !(Number.isInteger(query.offset) && query.offset >= 0)) throw new HttpError(400, 'offset must be a whole number of 0 or more.');
  const columns = query.columns?.length ? query.columns.map(column) : table.columns.map((c) => dialect.quote(c.name));
  let sql = `SELECT ${query.distinct ? 'DISTINCT ' : ''}${columns.join(', ')} FROM ${dialect.quote(table.name)}`;

  const conditions = [];
  for (const w of query.where ?? []) {
    if (!w || !OPS.has(w.op)) throw new HttpError(400, `Unsupported operator "${w?.op}".`);
    const col = column(w.column);
    const value = w.param !== undefined ? (Object.prototype.hasOwnProperty.call(params, w.param) ? params[w.param] : null) : w.value;
    if (w.op === 'isNull' || w.op === 'notNull') {
      conditions.push(`${col} IS ${w.op === 'isNull' ? '' : 'NOT '}NULL`);
    } else if (w.op === 'in') {
      if (!Array.isArray(value) || !value.length || value.length > MAX_IN_VALUES) throw new HttpError(400, `"in" needs a list of 1-${MAX_IN_VALUES} values.`);
      conditions.push(`${col} IN (${value.map(bind).join(', ')})`);
    } else if (w.op === 'like') {
      conditions.push(`${col} LIKE ${bind(value)}`);
    } else if (w.op === 'contains' || w.op === 'startsWith') {
      const pattern = `${w.op === 'contains' ? '%' : ''}${likeLiteral(value)}%`;
      conditions.push(`LOWER(${col}) LIKE LOWER(${bind(pattern)}) ESCAPE '\\'`);
    } else {
      conditions.push(`${col} ${w.op === '!=' ? '<>' : w.op} ${bind(value)}`);
    }
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  // The same rows without order, offset and limit — counted when the caller asks for `total`
  const count = { sql: `SELECT COUNT(*) AS total FROM (${sql}) AS we_report_c`, values: [...values] };

  const order = (query.orderBy ?? []).map((o) => {
    if (o.dir !== undefined && o.dir !== 'asc' && o.dir !== 'desc') throw new HttpError(400, 'orderBy.dir must be asc or desc.');
    return `${column(o.column)} ${o.dir === 'desc' ? 'DESC' : 'ASC'}`;
  });
  if (order.length) sql += ` ORDER BY ${order.join(', ')}`;

  const limit = Math.min(Number.isInteger(query.limit) && query.limit > 0 ? query.limit : maxRows, maxRows);
  // One extra row tells us whether the result was truncated.
  sql += ` LIMIT ${limit + 1}`;
  if (query.offset) sql += ` OFFSET ${query.offset}`;
  return { sql, values, limit, count };
}

// Standard strings, quoted and [bracketed] identifiers, comments — matched left to right.
const LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//;
const LITERALS_OR_PARAMS = new RegExp(`${LITERALS.source}|(?<![:\\w]):([A-Za-z_]\\w*)`, 'g');

/** Removes string literals, quoted identifiers and comments, so `;` and `:name` inside them are not misread. */
function stripLiterals(sql) {
  return sql.replace(new RegExp(LITERALS.source, 'g'), "''");
}

/**
 * Free SQL (only for connections that allow it): one statement, `:name` parameters, row limit.
 * The connection is opened read-only by the driver as well — this is not the only guard.
 */
export function buildFreeSql(sql, dialect, params = {}, maxRows = 1000) {
  if (typeof sql !== 'string' || !sql.trim()) throw new HttpError(400, 'sql must be a non-empty string.');
  const body = sql.trim().replace(/;\s*$/, '');
  // Backslash escapes (Postgres E'..') and dollar quoting change where a string ends in ways the
  // stripper cannot follow, which could hide a second statement. Report SQL never needs them.
  if (/\\|\$[A-Za-z_]*\$/.test(body)) throw new HttpError(400, 'Free SQL cannot contain backslashes or dollar-quoted strings.');
  if (stripLiterals(body).includes(';')) throw new HttpError(400, 'Only one SQL statement is allowed.');
  if (!/^\s*(select|with)\b/i.test(stripLiterals(body))) throw new HttpError(400, 'Only SELECT queries are allowed.');
  const values = [];
  // Literals and comments are matched first and kept as they are, so only real `:name`
  // parameters are replaced. `(?<![:\w])` keeps Postgres casts (`::int`) intact.
  const text = body.replace(LITERALS_OR_PARAMS, (match, name) => {
    if (name === undefined) return match;
    values.push(driverValue(Object.prototype.hasOwnProperty.call(params, name) ? params[name] : null));
    return dialect.placeholder(values.length);
  });
  return {
    sql: `SELECT * FROM (${text}) AS we_report_q LIMIT ${maxRows + 1}`,
    values,
    limit: maxRows,
    count: { sql: `SELECT COUNT(*) AS total FROM (${text}) AS we_report_c`, values: [...values] },
  };
}

/** Rows are trimmed to the limit; `truncated` says more existed. */
export function finishRows(rows, limit) {
  const truncated = rows.length > limit;
  return { rows: truncated ? rows.slice(0, limit) : rows, truncated };
}
