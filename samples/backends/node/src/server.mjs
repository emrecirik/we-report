// we-report data backend — reference implementation of protocol/openapi.yaml (v1).
// Zero dependencies for SQLite (node:sqlite); `npm install pg` for PostgreSQL.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { isLoopback, loadConfig } from './config.mjs';
import { DRIVERS } from './dialects.mjs';
import { guardedFetch } from './fetch-guard.mjs';
import { buildFreeSql, buildSelect, finishRows, HttpError } from './query.mjs';

const MAX_BODY = 1024 * 1024;

export function createServer(config = loadConfig()) {
  const opened = new Map();
  const open = async (connection) => {
    if (!opened.has(connection.id)) {
      const driver = DRIVERS[connection.dialect];
      if (!driver) throw new HttpError(500, `Dialect "${connection.dialect}" is not supported by this backend.`);
      opened.set(connection.id, driver(connection));
    }
    return opened.get(connection.id);
  };
  const connectionById = (id) => {
    const c = config.connections.find((x) => x.id === id);
    if (!c) throw new HttpError(404, `No connection "${id}".`);
    return c;
  };

  const hits = new Map();
  const rateLimited = (ip) => {
    const minute = Math.floor(Date.now() / 60000);
    const key = `${ip}|${minute}`;
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    if (hits.size > 10000) for (const k of hits.keys()) if (!k.endsWith(`|${minute}`)) hits.delete(k);
    return n > config.rateLimitPerMinute;
  };

  /**
   * Who may call. Without a token only local callers are accepted — unless this is the public demo,
   * which serves read-only sample data to anyone. Replace with your own auth (cookie, JWT …) here.
   */
  const authorize = (req) => {
    if (config.authToken) return req.headers.authorization === `Bearer ${config.authToken}`;
    if (config.demo) return true;
    // Local only — and addressed as a local host, so a page whose domain was re-pointed at
    // 127.0.0.1 (DNS rebinding) cannot use the browser to read local data.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return isLoopback(req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '') && isLoopback(host);
  };

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      // A page elsewhere can POST a plain form (text/plain) without a CORS preflight; JSON it cannot.
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
        reject(new HttpError(415, 'Send the body as application/json.'));
        return;
      }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'Request body too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new HttpError(400, 'Body must be JSON.'));
        }
      });
      req.on('error', reject);
    });

  const routes = [
    ['GET', /^\/v1\/info$/, async () => ({
      protocol: 1,
      server: 'we-report-node',
      capabilities: { webServiceFetch: config.webServiceFetch, demo: config.demo },
    })],
    ['GET', /^\/v1\/connections$/, async () =>
      // Never the url: ids, names, dialects and what is allowed.
      config.connections.map((c) => ({ id: c.id, name: c.name, dialect: c.dialect, freeSql: c.allowFreeSql }))],
    ['GET', /^\/v1\/connections\/([\w-]+)\/schema$/, async (_req, [id]) => (await open(connectionById(id))).schema()],
    ['POST', /^\/v1\/connections\/([\w-]+)\/query$/, async (req, [id]) => {
      const connection = connectionById(id);
      const db = await open(connection);
      const body = await readJson(req);
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      let built;
      if (body.sql !== undefined) {
        if (!connection.allowFreeSql) throw new HttpError(403, 'Free SQL is not allowed on this connection. Use the query builder.');
        built = buildFreeSql(body.sql, db.dialect, params, connection.maxRows);
      } else {
        built = buildSelect(body.query, await db.schema(), db.dialect, params, connection.maxRows);
      }
      let rows;
      try {
        rows = await db.query(built.sql, built.values, connection.timeoutMs);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        // Driver messages can name hosts, users and databases: logged here, never sent.
        console.error(`Query on "${connection.id}" failed:`, e.message);
        throw new HttpError(400, 'The query failed. The backend log has the details.');
      }
      const result = finishRows(rows, built.limit);
      const columns = Object.keys(result.rows[0] ?? {}).map((name) => ({ name, type: typeof result.rows[0][name] }));
      return { columns, ...result };
    }],
    ['POST', /^\/v1\/webservice\/fetch$/, async (req, _m, res) => {
      if (!config.webServiceFetch) throw new HttpError(403, 'Web service fetching is disabled on this backend.');
      const body = await readJson(req);
      if (typeof body.url !== 'string') throw new HttpError(400, 'url is required.');
      const upstream = await guardedFetch(body, { allowHosts: config.fetchAllowHosts });
      if (upstream.status >= 400) throw new HttpError(502, `The web service answered ${upstream.status}.`);
      // Passed through as-is; the client parses JSON or CSV exactly as when it calls directly.
      // Someone else's content: never active on this backend's origin.
      res.writeHead(200, { 'Content-Type': upstream.contentType, 'Content-Security-Policy': 'sandbox' });
      res.end(upstream.body);
      return undefined;
    }],
  ];

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    try {
      const ip = req.socket.remoteAddress ?? '';
      if (rateLimited(ip)) throw new HttpError(429, 'Too many requests; try again in a minute.');
      if (!authorize(req)) throw new HttpError(401, 'Not authorized.');
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      for (const [method, pattern, handler] of routes) {
        const m = pattern.exec(path);
        if (!m) continue;
        if (req.method !== method) throw new HttpError(405, 'Method not allowed.');
        const result = await handler(req, m.slice(1), res);
        if (result !== undefined) send(200, result);
        return;
      }
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      // Unexpected errors are logged here and never echoed: they could contain internals.
      console.error(e);
      send(500, { error: 'Internal error.' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  if (!isLoopback(config.host) && !config.authToken && !config.demo) {
    console.error(
      `Refusing to listen on ${config.host} without authentication. Set WE_REPORT_AUTH_TOKEN, ` +
        'plug your own auth into authorize() in src/server.mjs, or keep WE_REPORT_HOST=127.0.0.1.',
    );
    process.exit(1);
  }
  createServer(config).listen(config.port, config.host, () => {
    const names = config.connections.map((c) => `${c.id} (${c.dialect})`).join(', ');
    console.log(`we-report backend on http://${config.host}:${config.port} — connections: ${names}${config.demo ? ' — DEMO MODE' : ''}`);
  });
}
