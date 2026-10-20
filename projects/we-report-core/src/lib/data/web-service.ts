import { DatabaseDataSource, DataSourceDefinition, ReportDefinition, ReportParameter, WebServiceDataSource } from '../definition/report-definition';
import { backendClient } from './backend-client';
import { toDate } from '../format';
import { csvToObjects } from './csv';
import { findListPaths, readPath } from './data-source';

export interface LoadDataOptions {
  /** Report parameter values by name; missing ones use the parameter's default. */
  params?: Record<string, unknown>;
  /** Defaults to the global `fetch`; pass your own to add auth headers or cookies. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Data backend address, needed for database sources and web services called `via: 'backend'`. */
  backendUrl?: string;
}

export interface LoadedData {
  /** Response data by data source id. */
  sources: Record<string, unknown>;
  /** Sources that failed, with a readable reason. */
  errors: { sourceId: string; message: string }[];
  /** Loaded, but incomplete (e.g. the backend's row limit was reached). */
  warnings: { sourceId: string; message: string }[];
}

/** Parameter values with defaults applied and types normalised (numbers, dates, booleans). */
export function resolveParameters(parameters: ReportParameter[] | undefined, values: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of parameters ?? []) {
    const raw = Object.prototype.hasOwnProperty.call(values, p.name) ? values[p.name] : p.defaultValue;
    out[p.name] = coerce(raw, p.type);
  }
  return out;
}

function coerce(value: unknown, type: ReportParameter['type']): unknown {
  if (value === undefined || value === null || value === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'date':
      return toDate(value) ?? null;
    default:
      return String(value);
  }
}

/** Text of a parameter value for a URL or body: dates as `yyyy-MM-dd`, everything else as text. */
function paramText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value);
}

/** Replaces `{{name}}` with parameter values; `encode` URL-encodes them (for the URL itself). */
export function fillPlaceholders(template: string, params: Record<string, unknown>, encode: boolean): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => {
    const text = paramText(Object.prototype.hasOwnProperty.call(params, name) ? params[name] : null);
    return encode ? encodeURIComponent(text) : text;
  });
}

/**
 * Calls one web service and returns its parsed body (JSON, or CSV as rows). A paged source
 * (`paging`) is called page by page and its rows are joined into the first page's shape.
 */
export async function fetchWebService(source: WebServiceDataSource, params: Record<string, unknown>, options: LoadDataOptions = {}): Promise<unknown> {
  const paging = source.paging;
  // Without {{page}} or {{offset}} every call would bring the same rows: not a paged address.
  const placeholder = /\{\{\s*(page|offset)\s*\}\}/;
  const paged = placeholder.test(source.url) || placeholder.test(source.body ?? '') || (source.headers ?? []).some((h) => placeholder.test(h.value));
  if (!paging || !(paging.size > 0) || !paged) return fetchPage(source, params, options);
  const size = Math.floor(paging.size);
  const start = paging.start ?? 1;
  const max = Math.min(100, Math.max(1, Math.floor(paging.maxPages ?? 20)));
  let first: unknown;
  let path = paging.rowsPath?.trim() || undefined;
  const rows: unknown[] = [];
  for (let i = 0; i < max; i++) {
    let body: unknown;
    try {
      body = await fetchPage(source, { ...params, page: start + i, offset: i * size, size }, options);
    } catch (e) {
      // Many APIs answer an error past the last page: that is the end, not a failure.
      if (i === 0) throw e;
      break;
    }
    if (i === 0) {
      first = body;
      if (!path && !Array.isArray(body)) {
        const lists = findListPaths(body);
        if (lists.length === 1) path = lists[0];
      }
    }
    const page = path ? readPath(body, path) : body;
    // No list on the first page: not a paged answer after all, keep it as it is. Later: the end.
    if (!Array.isArray(page)) {
      if (i === 0) return first;
      break;
    }
    rows.push(...page);
    if (page.length < size) break;
  }
  return path ? withPath(first, path, rows) : rows;
}

/** A copy of `value` with the list at the dotted `path` replaced by `rows`. */
function withPath(value: unknown, path: string, rows: unknown[]): unknown {
  const [key, ...rest] = path.split('.');
  const object = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { ...object, [key]: rest.length ? withPath(object[key], rest.join('.'), rows) : rows };
}

async function fetchPage(source: WebServiceDataSource, params: Record<string, unknown>, options: LoadDataOptions): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json, text/csv;q=0.9, */*;q=0.5' };
  for (const h of source.headers ?? []) if (h.name.trim()) headers[h.name.trim()] = fillPlaceholders(h.value, params, false);
  const method = source.method ?? 'GET';
  const init: RequestInit = { method, headers, signal: options.signal };
  if (method === 'POST' && source.body) {
    init.body = fillPlaceholders(source.body, params, false);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  const url = fillPlaceholders(source.url, params, true);
  if (source.via === 'backend') {
    if (!options.backendUrl) throw new Error('This web service is called through the data backend, but no backend address is set.');
    // The backend fetches it (SSRF-guarded) and passes the body through unchanged.
    init.method = 'POST';
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ url, method, headers: Object.entries(headers).map(([name, value]) => ({ name, value })), body: method === 'POST' ? init.body : undefined });
  }
  const target = source.via === 'backend' ? `${options.backendUrl!.replace(/\/+$/, '')}/v1/webservice/fetch` : url;
  let response: Response;
  try {
    response = await doFetch(target, init);
  } catch (e) {
    // Browsers report CORS refusals and offline hosts the same way.
    throw new Error(`Could not reach ${url}. The service may be down, or it does not allow calls from this site (CORS). (${(e as Error).message})`);
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}`.trim());
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (/csv|text\/plain/.test(type) && !/^\s*[[{]/.test(text)) return csvToObjects(text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON or CSV.`);
  }
}

/** Runs a database source's query on the data backend; returns its rows. */
export async function fetchDatabase(
  source: DatabaseDataSource,
  params: Record<string, unknown>,
  options: LoadDataOptions = {},
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  if (!options.backendUrl) throw new Error('Database data needs a data backend, but no backend address is set.');
  if (!source.query && !source.sql) throw new Error('The database source has no query yet.');
  const result = await backendClient.query({ url: options.backendUrl, fetch: options.fetch, signal: options.signal }, source.connectionId, {
    query: source.sql ? undefined : source.query,
    sql: source.sql,
    params,
  });
  return { rows: result.rows, truncated: result.truncated };
}

/**
 * The report's data sources and those of its sub-reports (nested ones too), each id once; the
 * outer report's source wins when ids clash, as in the layout.
 */
export function allDataSources(definition: ReportDefinition, depth = 0): DataSourceDefinition[] {
  const out = [...(definition.dataSources ?? [])];
  if (depth >= 5) return out;
  for (const band of definition.bands ?? []) {
    for (const c of band.controls ?? []) {
      if (c.type !== 'subreport' || !c.report) continue;
      for (const s of allDataSources(c.report, depth + 1)) if (!out.some((o) => o.id === s.id)) out.push(s);
    }
  }
  return out;
}

/**
 * Loads every web-service and database source of a report and its sub-reports. Inline JSON/CSV
 * need no loading.
 * shortcut: a sub-report's sources load once, with the report's own parameter values, not per
 * row; rows are matched to the row around the sub-report by its filter.
 */
export async function loadReportData(definition: ReportDefinition, options: LoadDataOptions = {}): Promise<LoadedData> {
  const params = resolveParameters(definition.parameters, options.params);
  const result: LoadedData = { sources: {}, errors: [], warnings: [] };
  await Promise.all(
    allDataSources(definition).map(async (source) => {
      try {
        if (source.kind === 'webService') {
          result.sources[source.id] = await fetchWebService(source, params, options);
        } else if (source.kind === 'database') {
          const { rows, truncated } = await fetchDatabase(source, params, options);
          result.sources[source.id] = rows;
          if (truncated) result.warnings.push({ sourceId: source.id, message: `${source.name}: only the first ${rows.length} rows were loaded (row limit).` });
        }
      } catch (e) {
        result.errors.push({ sourceId: source.id, message: `${source.name}: ${(e as Error).message}` });
      }
    }),
  );
  return result;
}
