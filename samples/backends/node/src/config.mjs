// All settings come from the environment (and an optional connections file), never from requests.
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_SEED = resolve(here, '../../../data/seed.sql');

const int = (v, fallback) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : fallback);
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/**
 * Connections: `WE_REPORT_CONNECTIONS` (JSON) or `connections.json` next to package.json.
 * Without either, a single SQLite connection with the fictional sample dataset is used.
 * Each entry: { id, name, dialect: "sqlite" | "postgres", url, allowFreeSql?, maxRows?, timeoutMs?, schema? }
 */
function loadConnections(env) {
  let raw;
  if (env.WE_REPORT_CONNECTIONS) raw = env.WE_REPORT_CONNECTIONS;
  else if (existsSync(resolve(here, '../connections.json'))) raw = readFileSync(resolve(here, '../connections.json'), 'utf8');
  if (!raw) {
    return [{ id: 'sample', name: 'Sample shop (SQLite)', dialect: 'sqlite', url: join(tmpdir(), 'we-report-sample.db'), seedFile: SAMPLE_SEED }];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Connections must be a JSON array.');
  const ids = new Set();
  for (const c of parsed) {
    if (!c.id || !c.name || !c.dialect || !c.url) throw new Error('Every connection needs id, name, dialect and url.');
    if (!/^[\w-]+$/.test(c.id) || ids.has(c.id)) throw new Error(`Connection id "${c.id}" must be unique and use letters, digits, _ or -.`);
    ids.add(c.id);
    if (c.dialect === 'sqlite' && c.seed === 'sample') c.seedFile = SAMPLE_SEED;
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const demo = env.WE_REPORT_DEMO === '1';
  const connections = loadConnections(env).map((c) => ({
    ...c,
    // Demo mode never runs free SQL, whatever the connection file says.
    allowFreeSql: !demo && c.allowFreeSql === true,
    maxRows: Math.min(int(String(c.maxRows ?? ''), 5000), 50000),
    timeoutMs: int(String(c.timeoutMs ?? ''), 15000),
  }));
  return {
    host: env.WE_REPORT_HOST ?? '127.0.0.1',
    port: int(env.PORT ?? env.WE_REPORT_PORT, 5480),
    demo,
    authToken: env.WE_REPORT_AUTH_TOKEN || null,
    corsOrigins: new Set(list(env.WE_REPORT_CORS_ORIGINS ?? 'http://localhost:4200,http://127.0.0.1:4200')),
    // The fetch proxy would be an open proxy on a public demo.
    webServiceFetch: !demo && env.WE_REPORT_FETCH !== '0',
    fetchAllowHosts: new Set(list(env.WE_REPORT_FETCH_ALLOW_HOSTS).map((h) => h.toLowerCase())),
    rateLimitPerMinute: int(env.WE_REPORT_RATE_LIMIT, demo ? 60 : 600),
    connections,
  };
}

export const isLoopback = (host) => /^127\./.test(host) || host === '::1' || host === 'localhost';
