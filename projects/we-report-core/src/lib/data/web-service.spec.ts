import { createBlankReport } from '../definition/blank-report';
import { WebServiceDataSource } from '../definition/report-definition';
import { evaluate } from '../expression/evaluate';
import { findListPaths, resolveReportData } from './data-source';
import { fetchWebService, fillPlaceholders, loadReportData, resolveParameters } from './web-service';

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: string; type?: string }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = handler(String(input), init ?? {});
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/json' } });
  }) as typeof fetch;
}

describe('paged web services', () => {
  const pages = [[{ n: 1 }, { n: 2 }], [{ n: 3 }, { n: 4 }], [{ n: 5 }]];
  const fakeFetch = (wrap: boolean) =>
    (async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const rows = pages[page - 1] ?? [];
      return new Response(JSON.stringify(wrap ? { total: 5, data: { items: rows } } : rows), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

  it('loads every page until a short one and joins the rows', async () => {
    const source = { id: 'w', name: 'W', kind: 'webService' as const, url: 'https://api.example.com/x?page={{page}}&size={{size}}', paging: { size: 2 } };
    expect(await fetchWebService(source, {}, { fetch: fakeFetch(false) })).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
  });

  it('ends at a page without a list or with an error, and does not page an address without a placeholder', async () => {
    let calls = 0;
    const answers = [[{ n: 1 }, { n: 2 }], [{ n: 3 }, { n: 4 }]];
    const endFetch = (async (url: string) => {
      calls++;
      const page = Number(new URL(url).searchParams.get('page'));
      if (page === 3) return new Response(JSON.stringify({ error: 'out of range' }), { headers: { 'content-type': 'application/json' } });
      if (page > 3) return new Response('', { status: 404 });
      return new Response(JSON.stringify(answers[page - 1]), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const source = { id: 'w', name: 'W', kind: 'webService' as const, url: 'https://api.example.com/x?page={{page}}', paging: { size: 2 } };
    expect(await fetchWebService(source, {}, { fetch: endFetch })).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    calls = 0;
    const plain = { ...source, url: 'https://api.example.com/x?page=1' };
    expect(await fetchWebService(plain, {}, { fetch: endFetch })).toEqual([{ n: 1 }, { n: 2 }]);
    expect(calls).toBe(1);
  });

  it('finds the list inside each page and keeps the rest of the first page', async () => {
    const source = { id: 'w', name: 'W', kind: 'webService' as const, url: 'https://api.example.com/x?page={{page}}', paging: { size: 2, maxPages: 2 } };
    expect(await fetchWebService(source, {}, { fetch: fakeFetch(true) })).toEqual({ total: 5, data: { items: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] } });
  });
});

describe('web service data sources', () => {
  const source: WebServiceDataSource = {
    id: 'orders',
    name: 'Orders',
    kind: 'webService',
    url: 'https://api.example.com/orders?from={{from}}&q={{q}}',
    headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
  };

  function report() {
    const r = createBlankReport();
    r.dataSources.push(structuredClone(source));
    r.dataMember = { dataSourceId: 'orders', path: 'data.items' };
    r.parameters = [
      { name: 'from', type: 'date', defaultValue: '2026-01-01' },
      { name: 'q', type: 'string' },
      { name: 'token', type: 'string', defaultValue: 'abc' },
    ];
    return r;
  }

  it('applies parameter defaults and types', () => {
    const params = resolveParameters(report().parameters, { q: 'çay & şeker' });
    expect(params['from']).toEqual(new Date(2026, 0, 1));
    expect(params['q']).toBe('çay & şeker');
    expect(resolveParameters([{ name: 'n', type: 'number' }], { n: '1,5' })['n']).toBe(1.5);
    expect(resolveParameters([{ name: 'b', type: 'boolean' }], { b: 'true' })['b']).toBeTrue();
  });

  it('fills placeholders, URL-encoding only the URL', () => {
    const params = { q: 'a b&c', d: new Date(2026, 4, 9) };
    expect(fillPlaceholders('/x?q={{q}}&d={{ d }}&m={{missing}}', params, true)).toBe('/x?q=a%20b%26c&d=2026-05-09&m=');
    expect(fillPlaceholders('{"q":"{{q}}"}', params, false)).toBe('{"q":"a b&c"}');
  });

  it('calls the service with parameters and headers and feeds rows to the report', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const fetchImpl = fakeFetch((url, init) => {
      seen = { url, auth: new Headers(init.headers).get('Authorization') };
      return { body: JSON.stringify({ data: { items: [{ no: 1 }, { no: 2 }] }, total: 2 }) };
    });
    const r = report();
    const loaded = await loadReportData(r, { params: { q: 'x y' }, fetch: fetchImpl });
    expect(seen).toEqual({ url: 'https://api.example.com/orders?from=2026-01-01&q=x%20y', auth: 'Bearer abc' });
    expect(loaded.errors).toEqual([]);
    const { rows, parent } = resolveReportData(r, undefined, loaded.sources);
    expect(rows).toEqual([{ no: 1 }, { no: 2 }]);
    expect((parent as { items: unknown[] }).items.length).toBe(2);
    expect(findListPaths(loaded.sources['orders'])).toEqual(['data.items']);
  });

  it('parses CSV responses and reports HTTP errors without throwing', async () => {
    const r = report();
    r.dataMember = { dataSourceId: 'orders' };
    const csv = await loadReportData(r, { fetch: fakeFetch(() => ({ body: 'a;b\n1;2,5', type: 'text/csv' })) });
    expect(csv.sources['orders']).toEqual([{ a: 1, b: 2.5 }]);
    const failed = await loadReportData(r, { fetch: fakeFetch(() => ({ status: 503, body: 'down' })) });
    expect(failed.errors[0].message).toContain('503');
    const notJson = await loadReportData(r, { fetch: fakeFetch(() => ({ body: '<html>', type: 'text/html' })) });
    expect(notJson.errors[0].message).toContain('did not return JSON');
  });

  it('falls back to the saved sample when the service was not loaded', () => {
    const r = report();
    (r.dataSources[0] as WebServiceDataSource).sample = { data: { items: [{ no: 9 }] } };
    expect(resolveReportData(r).rows).toEqual([{ no: 9 }]);
  });

  it('runs database sources on the backend with serialized parameters and warns on truncation', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = fakeFetch((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { body: JSON.stringify({ columns: [], rows: [{ id: 1 }, { id: 2 }], truncated: true }) };
    });
    const r = createBlankReport();
    r.parameters = [{ name: 'from', type: 'date', defaultValue: '2026-03-01' }];
    r.dataSources.push({
      id: 'db', name: 'Orders', kind: 'database', connectionId: 'shop',
      query: { table: 'orders', where: [{ column: 'order_date', op: '>=', param: 'from' }] },
    });
    r.dataMember = { dataSourceId: 'db' };
    const loaded = await loadReportData(r, { fetch: fetchImpl, backendUrl: 'http://127.0.0.1:5480/' });
    expect(calls[0].url).toBe('http://127.0.0.1:5480/v1/connections/shop/query');
    expect(calls[0].body).toEqual({ query: r.dataSources[0].kind === 'database' ? r.dataSources[0].query : null, params: { from: '2026-03-01' } });
    expect(resolveReportData(r, undefined, loaded.sources).rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(loaded.warnings[0].message).toContain('first 2 rows');
    const noBackend = await loadReportData(r, { fetch: fetchImpl });
    expect(noBackend.errors[0].message).toContain('no backend address');
  });

  it('routes a web service through the backend proxy when asked', async () => {
    let seen: { url: string; body: { url: string; headers: { name: string; value: string }[] } } | undefined;
    const fetchImpl = fakeFetch((url, init) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return { body: '[{"a":1}]' };
    });
    const r = report();
    (r.dataSources[0] as WebServiceDataSource).via = 'backend';
    r.dataMember = { dataSourceId: 'orders' };
    const loaded = await loadReportData(r, { fetch: fetchImpl, backendUrl: 'http://b' });
    expect(seen!.url).toBe('http://b/v1/webservice/fetch');
    expect(seen!.body.url).toBe('https://api.example.com/orders?from=2026-01-01&q=');
    expect(seen!.body.headers).toContain({ name: 'Authorization', value: 'Bearer abc' });
    expect(loaded.sources['orders']).toEqual([{ a: 1 }]);
  });

  it('reads parameters in formulas with [?name]', () => {
    expect(evaluate("'Since ' + Format([?from], 'dd.MM.yyyy')", { params: { from: new Date(2026, 0, 1) } })).toBe('Since 01.01.2026');
    expect(evaluate('[?missing]', { params: {} })).toBeNull();
    expect(evaluate('[?constructor]', { params: {} })).toBeNull();
  });
});
