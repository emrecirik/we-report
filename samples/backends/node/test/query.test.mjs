import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockedAddress } from '../src/fetch-guard.mjs';
import { buildFreeSql, buildSelect, finishRows, HttpError } from '../src/query.mjs';

const schema = { tables: [{ name: 'orders', columns: [{ name: 'id' }, { name: 'status' }, { name: 'order date' }] }] };
const pg = { quote: (n) => `"${n.replace(/"/g, '""')}"`, placeholder: (i) => `$${i}` };

test('builds a parameterised select with quoted identifiers', () => {
  const { sql, values, limit } = buildSelect(
    {
      table: 'orders',
      columns: ['id', 'order date'],
      where: [
        { column: 'status', op: 'in', value: ['new', 'shipped'] },
        { column: 'order date', op: '>=', param: 'from' },
        { column: 'id', op: 'notNull' },
      ],
      orderBy: [{ column: 'order date', dir: 'desc' }],
      limit: 50,
    },
    schema,
    pg,
    { from: '2026-01-01' },
    1000,
  );
  assert.equal(sql, 'SELECT "id", "order date" FROM "orders" WHERE "status" IN ($1, $2) AND "order date" >= $3 AND "id" IS NOT NULL ORDER BY "order date" DESC LIMIT 51');
  assert.deepEqual(values, ['new', 'shipped', '2026-01-01']);
  assert.equal(limit, 50);
});

test('rejects identifiers that are not in the schema (no injection through names)', () => {
  const attempts = [
    { table: 'orders; DROP TABLE orders' },
    { table: 'orders', columns: ['id) FROM orders; --'] },
    { table: 'orders', where: [{ column: 'status" OR 1=1 --', op: '=', value: 'x' }] },
    { table: 'orders', where: [{ column: 'status', op: 'OR 1=1', value: 'x' }] },
    { table: 'orders', orderBy: [{ column: 'id', dir: 'desc; DROP' }] },
  ];
  for (const q of attempts) assert.throws(() => buildSelect(q, schema, pg), HttpError);
});

test('keeps values out of the SQL text', () => {
  const { sql, values } = buildSelect({ table: 'orders', where: [{ column: 'status', op: '=', value: "x' OR '1'='1" }] }, schema, pg);
  assert.ok(!sql.includes("'1'='1"));
  assert.deepEqual(values, ["x' OR '1'='1"]);
  assert.throws(() => buildSelect({ table: 'orders', where: [{ column: 'status', op: '=', value: { $gt: 1 } }] }, schema, pg), HttpError);
});

test('caps the row limit and reports truncation', () => {
  assert.equal(buildSelect({ table: 'orders', limit: 999999 }, schema, pg, {}, 100).limit, 100);
  assert.deepEqual(finishRows([1, 2, 3], 2), { rows: [1, 2], truncated: true });
  assert.deepEqual(finishRows([1, 2], 2), { rows: [1, 2], truncated: false });
});

test('free SQL: one SELECT statement, named parameters, casts untouched', () => {
  const { sql, values } = buildFreeSql("SELECT id::text, ':not' AS x FROM orders WHERE status = :status;", pg, { status: 'new' }, 10);
  assert.equal(sql, `SELECT * FROM (SELECT id::text, ':not' AS x FROM orders WHERE status = $1) AS we_report_q LIMIT 11`);
  assert.deepEqual(values, ['new']);
  assert.throws(() => buildFreeSql('SELECT 1; DELETE FROM orders', pg), /one SQL statement/);
  assert.throws(() => buildFreeSql('DELETE FROM orders', pg), /Only SELECT/);
  assert.doesNotThrow(() => buildFreeSql("SELECT ';' AS semi -- trailing; comment", pg));
});

test('blocks internal addresses for the web service proxy', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
});

test('blocks IPv4-in-IPv6 forms that URL parsing produces (hex mapped, NAT64, compatible)', () => {
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '::7f00:1', '::127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('::ffff:808:808'), false); // 8.8.8.8
});

test('free SQL cannot hide a second statement in escape strings, dollar quotes or brackets', () => {
  const attempts = [
    String.raw`SELECT E'\'' AS c) a; COMMIT; DELETE FROM t; --'`,
    'SELECT $$ x $$; DELETE FROM t',
    "SELECT $tag$ ' $tag$; DELETE FROM t",
    "SELECT [a'b]; DELETE FROM t --'",
  ];
  for (const sql of attempts) assert.throws(() => buildFreeSql(sql, pg), HttpError, sql);
  assert.doesNotThrow(() => buildFreeSql('SELECT [order date] FROM t', pg));
});
