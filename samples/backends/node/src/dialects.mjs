// Database drivers. SQLite uses Node's built-in node:sqlite (no install); Postgres needs `pg`
// (`npm install pg`) and is loaded only when a postgres connection is configured.
import { existsSync, readFileSync } from 'node:fs';
import { HttpError } from './query.mjs';

const typeOf = (declared) => {
  const t = String(declared ?? '').toUpperCase();
  if (/INT|DEC|NUM|REAL|FLOA|DOUB|MONEY/.test(t)) return 'number';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/BOOL/.test(t)) return 'boolean';
  if (/CHAR|TEXT|CLOB|STRING|UUID/.test(t)) return 'string';
  return 'unknown';
};

/** JSON-friendly values: bigints that fit become numbers, dates become ISO text. */
function plain(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (v instanceof Uint8Array) out[k] = null; // shortcut: binary columns are not reportable yet.
    else out[k] = v;
  }
  return out;
}

const quoteDouble = (name) => `"${String(name).replace(/"/g, '""')}"`;

export async function openSqlite(connection) {
  const { DatabaseSync } = await import('node:sqlite');
  const path = connection.url;
  if (connection.seedFile && !existsSync(path)) {
    const seed = new DatabaseSync(path);
    seed.exec(readFileSync(connection.seedFile, 'utf8'));
    seed.close();
  }
  // Read-only at the driver level: even an allowed free SQL statement cannot write.
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    dialect: { quote: quoteDouble, placeholder: () => '?' },
    async schema() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return {
        tables: tables.map(({ name }) => ({
          name,
          columns: db.prepare(`PRAGMA table_info(${quoteDouble(name)})`).all().map((c) => ({ name: c.name, type: typeOf(c.type) })),
        })),
      };
    },
    // shortcut: node:sqlite is synchronous and cannot be interrupted, so the timeout is not enforced
    // for SQLite; the row limit still is. Use a worker thread if SQLite serves untrusted free SQL.
    async query(sql, values) {
      return db.prepare(sql).all(...values).map(plain);
    },
    async close() {
      db.close();
    },
  };
}

export async function openPostgres(connection) {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error('Connection "' + connection.id + '" is postgres: install the driver with `npm install pg`.');
  }
  // NUMERIC and BIGINT arrive as text by default; reports need numbers. DATE/TIMESTAMP stay text:
  // turning them into JS Dates would shift them by the server's time-zone offset.
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number.isSafeInteger(Number(v)) ? Number(v) : v));
  pg.types.setTypeParser(1082, (v) => v);
  pg.types.setTypeParser(1114, (v) => v);
  // Without a connect timeout an unreachable database would hang requests forever.
  const pool = new pg.Pool({ connectionString: connection.url, max: 5, connectionTimeoutMillis: connection.timeoutMs });
  const schemaName = connection.schema ?? 'public';
  return {
    dialect: { quote: quoteDouble, placeholder: (i) => `$${i}` },
    async schema() {
      const { rows } = await pool.query(
        'SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position',
        [schemaName],
      );
      const tables = new Map();
      for (const r of rows) {
        if (!tables.has(r.table_name)) tables.set(r.table_name, []);
        tables.get(r.table_name).push({ name: r.column_name, type: typeOf(r.data_type) });
      }
      return { tables: [...tables].map(([name, columns]) => ({ name, columns })) };
    },
    async query(sql, values, timeoutMs) {
      const client = await pool.connect();
      try {
        // Read-only transaction with a statement timeout: defence in depth beside the read-only user.
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
        await client.query(`SET LOCAL search_path = ${quoteDouble(schemaName)}`);
        const result = await client.query(sql, values);
        await client.query('COMMIT');
        return result.rows.map(plain);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (e.code === '57014') throw new HttpError(504, 'The query took too long and was stopped.');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** The fictional `sales` table of the big-data demo — seeded, so every machine builds the same rows */
const BIGDATA_SQL = (rows) => `
CREATE TABLE sales AS
SELECT
  i AS id,
  ['Ada','Deniz','Ekin','Kaan','Lale','Mert','Nehir','Ozan','Pelin','Rüzgar','Selin','Toprak','Umut','Yağmur'][1 + (hash(i * 3) % 14)::INTEGER]
    || ' ' || chr(65 + (hash(i * 5) % 26)::INTEGER) || '.' AS customer,
  ['İstanbul','Ankara','İzmir','Bursa','Antalya','Konya','Adana','Trabzon','Eskişehir','Kayseri'][1 + (hash(i * 7) % 10)::INTEGER] AS city,
  ['Electronics','Books','Garden','Toys','Food','Clothing','Sports','Beauty'][1 + (hash(i * 11) % 8)::INTEGER] AS category,
  (1 + hash(i * 13) % 50)::INTEGER AS qty,
  ((hash(i * 17) % 100000) / 100)::DECIMAL(10, 2) AS price,
  ((1 + hash(i * 13) % 50) * ((hash(i * 17) % 100000) / 100))::DECIMAL(14, 2) AS total,
  DATE '2024-01-01' + (hash(i * 19) % 730)::INTEGER AS order_date
FROM range(1, ${rows + 1}) t(i)`;

/** DuckDB dates arrive as JS Dates at UTC midnight; the protocol sends them as YYYY-MM-DD like the other dialects */
function plainDuck(row) {
  const out = plain(row);
  for (const [k, v] of Object.entries(out)) if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v)) out[k] = v.slice(0, 10);
  return out;
}

export async function openDuckdb(connection) {
  let duck;
  try {
    duck = await import('@duckdb/node-api');
  } catch {
    throw new Error('Connection "' + connection.id + '" is duckdb: install the driver with `npm install @duckdb/node-api`.');
  }
  const { DuckDBInstance } = duck;
  if (connection.seed === 'bigdata' && !existsSync(connection.url)) {
    // Built once, then only ever opened read-only. A billion rows take a few minutes and ~10 GB.
    const rows = Math.max(1, Math.min(Number(connection.seedRows) || 10_000_000, 2_000_000_000));
    console.log(`Building the big-data demo table (${rows.toLocaleString('en-US')} rows) in ${connection.url} …`);
    const writer = await DuckDBInstance.create(connection.url);
    const w = await writer.connect();
    await w.run(BIGDATA_SQL(Math.floor(rows)));
    w.closeSync();
    writer.closeSync();
  }
  // Read-only at the driver level, as with SQLite
  const instance = await DuckDBInstance.create(connection.url, { access_mode: 'READ_ONLY' });
  const db = await instance.connect();
  return {
    dialect: { quote: quoteDouble, placeholder: (i) => `$${i}`, asText: (expr) => `CAST(${expr} AS VARCHAR)` },
    async schema() {
      const reader = await db.runAndReadAll(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position",
      );
      const tables = new Map();
      for (const r of reader.getRowObjectsJS()) {
        if (!tables.has(r.table_name)) tables.set(r.table_name, []);
        tables.get(r.table_name).push({ name: r.column_name, type: typeOf(r.data_type) });
      }
      return { tables: [...tables].map(([name, columns]) => ({ name, columns })) };
    },
    async query(sql, values, timeoutMs) {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        db.interrupt();
      }, Math.max(1, timeoutMs));
      try {
        const reader = await db.runAndReadAll(sql, values);
        return reader.getRowObjectsJS().map(plainDuck);
      } catch (e) {
        if (timedOut) throw new HttpError(504, 'The query took too long and was stopped.');
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      db.closeSync();
      instance.closeSync();
    },
  };
}

export const DRIVERS = { sqlite: openSqlite, postgres: openPostgres, duckdb: openDuckdb };
