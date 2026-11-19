#!/usr/bin/env node
// we-report protocol conformance suite (protocol 1.2 — the 1.1 and 1.2 checks run when the
// backend's capabilities say it offers them). A sample backend is "supported" only while it passes.
// Usage: node tools/protocol-conformance/run.mjs http://127.0.0.1:5480 [--token=...]
// The backend must expose a connection with the sample dataset (samples/data/seed.sql).

const base = (process.argv[2] ?? 'http://127.0.0.1:5480').replace(/\/$/, '');
const token = process.argv.find((a) => a.startsWith('--token='))?.slice(8);
const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✘ ${name}\n      ${e.message}`);
  }
}
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};
async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}
const expectError = (r, status) => {
  assert(r.status === status, `expected HTTP ${status}, got ${r.status}: ${r.text.slice(0, 200)}`);
  assert(r.json && typeof r.json.error === 'string', 'error responses must be JSON { "error": "..." }');
};

console.log(`we-report protocol conformance — ${base}\n`);

let info;
let connection;
await check('GET /v1/info reports protocol 1', async () => {
  const r = await call('GET', '/v1/info');
  assert(r.status === 200, `HTTP ${r.status}`);
  info = r.json;
  assert(info.protocol === 1, `protocol is ${info.protocol}`);
  assert(typeof info.server === 'string', 'server name missing');
});

await check('GET /v1/connections lists connections without secrets', async () => {
  const r = await call('GET', '/v1/connections');
  assert(r.status === 200 && Array.isArray(r.json), `HTTP ${r.status}`);
  for (const c of r.json) {
    assert(typeof c.id === 'string' && typeof c.name === 'string' && typeof c.freeSql === 'boolean', `bad connection shape: ${JSON.stringify(c)}`);
    assert(['sqlite', 'postgres', 'mysql', 'sqlserver', 'oracle', 'duckdb'].includes(c.dialect), `dialect "${c.dialect}" is not one of the protocol's`);
    const extra = Object.keys(c).filter((k) => !['id', 'name', 'dialect', 'freeSql'].includes(k));
    assert(!extra.length, `connection exposes extra fields: ${extra.join(', ')}`);
    assert(!/password|user id=|:\/\/[^@/]+@/i.test(JSON.stringify(c)), 'connection looks like it contains credentials');
  }
  for (const c of r.json) {
    const s = await call('GET', `/v1/connections/${encodeURIComponent(c.id)}/schema`);
    if (s.status === 200 && s.json.tables.some((t) => t.name === 'customers')) {
      connection = c;
      break;
    }
  }
  assert(connection, 'no connection exposes the sample dataset (table "customers")');
});

if (connection) {
  const path = `/v1/connections/${encodeURIComponent(connection.id)}`;

  await check('schema describes tables and typed columns', async () => {
    const r = await call('GET', `${path}/schema`);
    const customers = r.json.tables.find((t) => t.name === 'customers');
    const cols = Object.fromEntries(customers.columns.map((c) => [c.name, c.type]));
    for (const name of ['id', 'name', 'city', 'email', 'credit_limit']) assert(name in cols, `customers.${name} missing`);
    assert(cols.credit_limit === 'number', `credit_limit should be number, is ${cols.credit_limit}`);
  });

  await check('structured query with a parameter, order and limit', async () => {
    const r = await call('POST', `${path}/query`, {
      query: { table: 'customers', columns: ['id', 'name', 'city'], where: [{ column: 'city', op: '=', param: 'city' }], orderBy: [{ column: 'id', dir: 'desc' }], limit: 5 },
      params: { city: 'Fallowick' },
    });
    assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    const { rows, columns, truncated } = r.json;
    assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 5, `expected 1-5 rows, got ${rows?.length}`);
    assert(rows.every((x) => x.city === 'Fallowick'), 'filter not applied');
    assert(rows.every((x, i) => i === 0 || rows[i - 1].id > x.id), 'order not applied');
    assert(Object.keys(rows[0]).join() === 'id,name,city', `columns: ${Object.keys(rows[0]).join()}`);
    assert(Array.isArray(columns) && typeof truncated === 'boolean', 'columns/truncated missing');
  });

  await check('row limit is reported as truncated', async () => {
    const r = await call('POST', `${path}/query`, { query: { table: 'customers', limit: 3 } });
    assert(r.status === 200 && r.json.rows.length === 3 && r.json.truncated === true, `rows ${r.json?.rows?.length}, truncated ${r.json?.truncated}`);
  });

  await check('in / like / isNull operators', async () => {
    const r = await call('POST', `${path}/query`, {
      query: { table: 'customers', where: [{ column: 'id', op: 'in', value: [1, 2, 3] }, { column: 'email', op: 'like', value: 'customer%' }, { column: 'name', op: 'notNull' }] },
    });
    assert(r.status === 200 && r.json.rows.length === 3, `got ${r.json?.rows?.length} rows`);
  });

  await check('identifier injection is rejected with 400', async () => {
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers; DROP TABLE customers' } }), 400);
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers', columns: ['id FROM customers --'] } }), 400);
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers', where: [{ column: 'id', op: 'OR 1=1 --', value: 1 }] } }), 400);
  });

  await check('values are parameters, not SQL', async () => {
    const r = await call('POST', `${path}/query`, { query: { table: 'customers', where: [{ column: 'city', op: '=', value: "x' OR '1'='1" }] } });
    assert(r.status === 200 && r.json.rows.length === 0, `injection returned ${r.json?.rows?.length} rows`);
    const count = await call('POST', `${path}/query`, { query: { table: 'customers', columns: ['id'] } });
    assert(count.json.rows.length === 40, `customers table changed: ${count.json.rows.length} rows`);
  });

  if (info?.capabilities?.grid) {
    await check('1.1 paging: offset, limit and count → total', async () => {
      const r = await call('POST', `${path}/query`, {
        query: { table: 'customers', columns: ['id'], orderBy: [{ column: 'id' }], offset: 5, limit: 5 },
        count: true,
      });
      assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      assert(r.json.rows.map((x) => x.id).join() === '6,7,8,9,10', `rows ${r.json.rows.map((x) => x.id).join()}`);
      assert(r.json.total === 40, `total is ${r.json.total}`);
      assert(r.json.truncated === true, 'truncated should be true — more rows follow the page');
      const filtered = await call('POST', `${path}/query`, {
        query: { table: 'customers', where: [{ column: 'city', op: '=', value: 'Fallowick' }], offset: 0, limit: 1 },
        count: true,
      });
      assert(filtered.json.rows.length === 1 && filtered.json.total > 1, `filtered total ${filtered.json.total}`);
      const none = await call('POST', `${path}/query`, { query: { table: 'customers', limit: 2 } });
      assert(none.json.total === undefined, 'total must only be sent when count is asked for');
      expectError(await call('POST', `${path}/query`, { query: { table: 'customers', offset: -1 } }), 400);
    });

    await check('1.1 distinct values and case-insensitive contains / startsWith', async () => {
      const d = await call('POST', `${path}/query`, {
        query: { table: 'customers', columns: ['city'], distinct: true, orderBy: [{ column: 'city' }] },
        count: true,
      });
      assert(d.status === 200, `HTTP ${d.status}: ${d.text.slice(0, 200)}`);
      const cities = d.json.rows.map((x) => x.city);
      assert(cities.length > 1 && new Set(cities).size === cities.length, `distinct returned duplicates: ${cities.join()}`);
      assert(cities.every((c, i) => i === 0 || cities[i - 1] <= c), 'distinct values not ordered');
      assert(d.json.total === cities.length, `distinct total ${d.json.total} vs ${cities.length}`);
      expectError(await call('POST', `${path}/query`, { query: { table: 'customers', distinct: true } }), 400);
      const c = await call('POST', `${path}/query`, { query: { table: 'customers', where: [{ column: 'email', op: 'contains', value: 'EXAMPLE.COM' }] }, count: true });
      assert(c.json.total === 40, `contains matched ${c.json.total}`);
      const s = await call('POST', `${path}/query`, { query: { table: 'customers', where: [{ column: 'email', op: 'startsWith', value: 'CUSTOMER1' }] }, count: true });
      assert(s.json.total === 11, `startsWith matched ${s.json.total} (customer1, customer10-19)`);
      const literal = await call('POST', `${path}/query`, { query: { table: 'customers', where: [{ column: 'email', op: 'contains', value: '%' }] }, count: true });
      assert(literal.json.total === 0, `% must match literally, matched ${literal.json.total}`);
    });
  } else {
    console.log('  – grid queries (1.1) not offered by this backend (skipped)');
  }

  if (!connection.freeSql) {
    await check('free SQL is refused when the connection does not allow it', async () => {
      expectError(await call('POST', `${path}/query`, { sql: 'SELECT 1' }), 403);
    });
  } else {
    await check('free SQL allows one SELECT and rejects writes / multiple statements', async () => {
      const ok = await call('POST', `${path}/query`, { sql: 'SELECT id FROM customers WHERE id = :id', params: { id: 2 } });
      assert(ok.status === 200 && ok.json.rows.length === 1, `HTTP ${ok.status}`);
      expectError(await call('POST', `${path}/query`, { sql: 'DELETE FROM customers' }), 400);
      expectError(await call('POST', `${path}/query`, { sql: 'SELECT 1; SELECT 2' }), 400);
      // A second statement hidden where a naive literal stripper loses track.
      for (const sql of [String.raw`SELECT E'\'' AS c; DELETE FROM customers; --'`, 'SELECT $$ x $$; DELETE FROM customers', "SELECT [a'b]; DELETE FROM customers --'"]) {
        const r = await call('POST', `${path}/query`, { sql });
        assert(r.status === 400, `hidden statement accepted (${r.status}): ${sql}`);
      }
      const count = await call('POST', `${path}/query`, { query: { table: 'customers', columns: ['id'] } });
      assert(count.json.rows.length === 40, 'customers changed');
    });
  }
}

if (connection && info?.capabilities?.search) {
  const path = `/v1/connections/${encodeURIComponent(connection.id)}`;
  const all = (await call('POST', `${path}/query`, { query: { table: 'customers', limit: 5000 } })).json?.rows ?? [];

  await check('1.2 search: every word in some column, case-insensitive, literal', async () => {
    const sample = all.find((c) => c.name.includes(' '));
    assert(sample, 'the sample dataset has no customer with a two-word name');
    const [first] = sample.name.split(' ');
    const text = `${first.toUpperCase()} ${sample.city.slice(1, 4)}`;
    const words = text.toLowerCase().split(/\s+/);
    const expected = all.filter((c) => words.every((w) => [c.name, c.city].some((v) => String(v).toLowerCase().includes(w))));
    const r = await call('POST', `${path}/query`, { query: { table: 'customers', search: { text, columns: ['name', 'city'] }, orderBy: [{ column: 'id' }] }, count: true });
    assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    assert(r.json.total === expected.length, `total ${r.json.total}, expected ${expected.length}`);
    assert(JSON.stringify(r.json.rows.map((c) => c.id)) === JSON.stringify(expected.map((c) => c.id)), 'the rows differ from every word in some column');
    const none = await call('POST', `${path}/query`, { query: { table: 'customers', search: { text: '%', columns: ['name'] } }, count: true });
    assert(none.status === 200 && none.json.total === 0, '% must match a percent sign, not everything');
    const numbers = await call('POST', `${path}/query`, { query: { table: 'customers', search: { text: String(all[0].id), columns: ['id'] } }, count: true });
    assert(numbers.status === 200 && numbers.json.total >= 1, 'a number column is searched as text');
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers', search: { text: 'x', columns: ['secret'] } } }), 400);
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers', search: { text: 'x', columns: [] } } }), 400);
  });

  await check('1.2 orderBy nulls is accepted and keeps the order', async () => {
    const r = await call('POST', `${path}/query`, { query: { table: 'customers', columns: ['id'], orderBy: [{ column: 'id', dir: 'desc', nulls: 'last' }], limit: 3 } });
    assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    const ids = all.map((c) => c.id).sort((a, b) => b - a).slice(0, 3);
    assert(JSON.stringify(r.json.rows.map((c) => c.id)) === JSON.stringify(ids), `got ${JSON.stringify(r.json.rows)}`);
    expectError(await call('POST', `${path}/query`, { query: { table: 'customers', orderBy: [{ column: 'id', nulls: 'middle' }] } }), 400);
  });
}

if (connection && info?.capabilities?.groups) {
  const path = `/v1/connections/${encodeURIComponent(connection.id)}`;
  const all = (await call('POST', `${path}/query`, { query: { table: 'customers', limit: 5000 } })).json?.rows ?? [];

  await check('1.2 groups: one row per combination with __count and the aggregates', async () => {
    const r = await call('POST', `${path}/query`, {
      query: {
        table: 'customers',
        groupBy: ['city'],
        aggregates: [
          { column: 'credit_limit', fn: 'sum', as: 'limit_sum' },
          { column: 'credit_limit', fn: 'max', as: 'limit_max' },
          { column: 'id', fn: 'count', as: 'ids' }
        ]
      },
      count: true
    });
    assert(r.status === 200, `HTTP ${r.status}: ${r.text.slice(0, 200)}`);
    const cities = [...new Set(all.map((c) => c.city))];
    assert(r.json.rows.length === cities.length && r.json.total === cities.length, `${r.json.rows.length} groups, total ${r.json.total}, expected ${cities.length}`);
    for (const row of r.json.rows) {
      const members = all.filter((c) => c.city === row.city);
      assert(Number(row.__count) === members.length, `${row.city}: __count ${row.__count}, expected ${members.length}`);
      assert(Number(row.ids) === members.length, `${row.city}: count ${row.ids}`);
      const sum = members.reduce((s, c) => s + Number(c.credit_limit), 0);
      assert(Math.abs(Number(row.limit_sum) - sum) < 0.01, `${row.city}: sum ${row.limit_sum}, expected ${sum}`);
      assert(Number(row.limit_max) === Math.max(...members.map((c) => Number(c.credit_limit))), `${row.city}: max ${row.limit_max}`);
    }
    assert(r.json.rows.reduce((n, g) => n + Number(g.__count), 0) === all.length, 'the groups do not add up to the table');
  });

  await check('1.2 groups come in the order a grouped page query uses, so offsets line up', async () => {
    const groups = (await call('POST', `${path}/query`, { query: { table: 'customers', groupBy: ['city'] } })).json.rows;
    const rows = (await call('POST', `${path}/query`, { query: { table: 'customers', columns: ['city'], orderBy: [{ column: 'city', nulls: 'first' }], limit: 5000 } })).json.rows;
    let at = 0;
    for (const g of groups) {
      const run = rows.slice(at, at + Number(g.__count));
      assert(run.length && run.every((x) => x.city === g.city), `rows ${at}… are not the ${g.city} group`);
      at += Number(g.__count);
    }
  });

  await check('1.2 groups, search and order are validated: columns, names, types', async () => {
    for (const bad of [
      { groupBy: ['secret'] },
      { groupBy: [] },
      { groupBy: ['city'], columns: ['id'] },
      { groupBy: ['city'], offset: 5 },
      { aggregates: [{ column: 'id', fn: 'sum', as: 's' }] },
      { groupBy: ['city'], aggregates: [{ column: 'id', fn: 'median', as: 's' }] },
      { groupBy: ['city'], aggregates: [{ column: 'id', fn: 'sum', as: 'x; DROP TABLE customers' }] },
      { groupBy: ['city'], aggregates: [{ column: 'id', fn: 'sum', as: '__count' }] },
      // Wrong types are refused as bad requests, not server errors
      { groupBy: [null] },
      { groupBy: 'city' },
      { groupBy: ['city'], aggregates: 'x' },
      { groupBy: ['city'], aggregates: [{ column: 'id', fn: ['sum'], as: 's' }] },
      { groupBy: ['city'], aggregates: Array.from({ length: 33 }, (_, i) => ({ column: 'id', fn: 'sum', as: `s${i}` })) },
      { orderBy: [{ column: 'id', nulls: 5 }] },
      { orderBy: [{ column: 'id', dir: 5 }] },
      { search: { text: 'x'.repeat(201), columns: ['name'] } },
      { search: { text: 5, columns: ['name'] } },
      { search: 'x' }
    ]) {
      expectError(await call('POST', `${path}/query`, { query: { table: 'customers', ...bad } }), 400);
    }
  });
}

await check('POST bodies must be application/json (a cross-site form cannot send that)', async () => {
  for (const path of [connection ? `/v1/connections/${encodeURIComponent(connection.id)}/query` : '/v1/connections/x/query', '/v1/webservice/fetch']) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ query: { table: 'customers' }, url: 'http://example.com/' }),
    });
    const text = await res.text();
    assert(res.status === 415, `${path} accepted text/plain (${res.status}): ${text.slice(0, 120)}`);
    assert(typeof JSON.parse(text).error === 'string', 'error responses must be JSON { "error": "..." }');
  }
});

await check('unknown connection is 404', async () => {
  expectError(await call('GET', '/v1/connections/does-not-exist/schema'), 404);
});

if (info?.capabilities?.webServiceFetch) {
  await check('web service proxy refuses internal addresses (SSRF)', async () => {
    for (const url of [
      'http://127.0.0.1:5480/v1/info', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/', 'http://[::1]/', 'http://10.0.0.1/',
      'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://2130706433/', 'http://0x7f.1/',
    ]) {
      const r = await call('POST', '/v1/webservice/fetch', { url });
      assert(r.status === 403 || r.status === 400, `${url} answered ${r.status}`);
    }
    expectError(await call('POST', '/v1/webservice/fetch', { url: 'file:///etc/passwd' }), 400);
  });
} else {
  console.log('  – web service proxy disabled on this backend (skipped)');
}

if (info?.capabilities?.layouts) {
  await check('1.1 layouts: put, get, delete; keys, size and content type are checked', async () => {
    const key = `conformance:${Date.now()}`;
    const doc = { gridKey: 'x', version: 1, columns: [{ field: 'a', visible: true, order: 0, pinned: null }], note: 'İ ş "q"' };
    const put = await call('PUT', `/v1/layouts/${encodeURIComponent(key)}`, doc);
    assert(put.status === 204, `PUT answered ${put.status}: ${put.text.slice(0, 120)}`);
    const get = await call('GET', `/v1/layouts/${encodeURIComponent(key)}`);
    assert(get.status === 200 && JSON.stringify(get.json) === JSON.stringify(doc), `GET returned ${get.status} ${get.text.slice(0, 120)}`);
    const del = await call('DELETE', `/v1/layouts/${encodeURIComponent(key)}`);
    assert(del.status === 204, `DELETE answered ${del.status}`);
    expectError(await call('GET', `/v1/layouts/${encodeURIComponent(key)}`), 404);
    assert((await call('DELETE', `/v1/layouts/${encodeURIComponent(key)}`)).status === 204, 'deleting a missing key must succeed');
    expectError(await call('GET', '/v1/layouts/.hidden'), 400);
    expectError(await call('PUT', `/v1/layouts/${'k'.repeat(101)}`, {}), 400);
    expectError(await call('PUT', `/v1/layouts/${encodeURIComponent(key)}`, [1, 2]), 400);
    expectError(await call('PUT', `/v1/layouts/${encodeURIComponent(key)}`, { big: 'x'.repeat(300 * 1024) }), 413);
    const text = await fetch(`${base}/v1/layouts/${encodeURIComponent(key)}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' });
    assert(text.status === 415, `text/plain PUT answered ${text.status}`);
  });
} else {
  console.log('  – layouts (1.1) not offered by this backend (skipped)');
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
