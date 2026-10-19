import { StructuredQuery } from '../definition/report-definition';

/** Talks to any backend implementing protocol/openapi.yaml (v1). */
export interface BackendOptions {
  /** Base address, e.g. `http://127.0.0.1:5480`. */
  url: string;
  /** Defaults to the global `fetch`; pass your own to add auth headers or cookies. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface BackendConnection {
  id: string;
  name: string;
  dialect: string;
  freeSql: boolean;
}

export interface BackendSchema {
  tables: { name: string; columns: { name: string; type: string }[] }[];
}

export interface BackendQueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/** Parameter values as JSON: dates as `yyyy-MM-dd` (local), others unchanged. */
export function serializeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v instanceof Date) {
      const pad = (n: number) => String(n).padStart(2, '0');
      out[k] = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function call<T>(backend: BackendOptions, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const doFetch = backend.fetch ?? fetch;
  const url = backend.url.replace(/\/+$/, '') + path;
  let response: Response;
  try {
    response = await doFetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: backend.signal,
    });
  } catch (e) {
    throw new Error(`The data backend at ${backend.url} could not be reached. Is it running, and does it allow this site (CORS)? (${(e as Error).message})`);
  }
  const text = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* not JSON: keep the status line */
    }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

export const backendClient = {
  info: (b: BackendOptions) => call<{ protocol: number; server: string; capabilities: Record<string, boolean> }>(b, 'GET', '/v1/info'),
  connections: (b: BackendOptions) => call<BackendConnection[]>(b, 'GET', '/v1/connections'),
  schema: (b: BackendOptions, connectionId: string) => call<BackendSchema>(b, 'GET', `/v1/connections/${encodeURIComponent(connectionId)}/schema`),
  query: (b: BackendOptions, connectionId: string, request: { query?: StructuredQuery; sql?: string; params?: Record<string, unknown> }) =>
    call<BackendQueryResult>(b, 'POST', `/v1/connections/${encodeURIComponent(connectionId)}/query`, {
      ...request,
      params: serializeParams(request.params ?? {}),
    }),
};
