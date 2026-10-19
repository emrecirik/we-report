import { DataSourceDefinition, ReportDefinition } from '../definition/report-definition';
import { csvToObjects } from './csv';

/** Reads a dotted path (`data.items`) on own properties only. */
export function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current = value;
  for (const key of path.split('.').map((k) => k.trim()).filter(Boolean)) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Normalizes any data shape to rows: an array stays, an object becomes one row, nothing is none. */
export function toRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export interface ReportData {
  /** Rows the detail band repeats over; `null` when the report is not bound to data. */
  rows: unknown[] | null;
  /** The object that holds the rows (the root when `dataMember.path` is `lines`), for `[^.Field]`. */
  parent: unknown;
}

/** Rows plus their parent object. `data` from the host app replaces the bound source's data. */
export function resolveReportData(definition: ReportDefinition, data?: unknown, sources?: Record<string, unknown>): ReportData {
  const member = definition.dataMember;
  let raw: unknown;
  if (data !== undefined) {
    raw = data;
  } else if (!member) {
    return { rows: null, parent: undefined };
  } else {
    const source = definition.dataSources.find((s) => s.id === member.dataSourceId);
    if (!source) return { rows: [], parent: undefined };
    raw = sourceValue(source, sources);
  }
  const path = member?.path?.split('.').filter(Boolean) ?? [];
  const parent = path.length ? readPath(raw, path.slice(0, -1).join('.')) : undefined;
  return { rows: toRows(readPath(raw, member?.path)), parent };
}

/**
 * The rows the detail band repeats over. `data` (from the host app) replaces the bound data
 * source's own data. Returns `null` when the report is not bound to data at all — the detail band
 * then prints once.
 */
export function resolveReportRows(definition: ReportDefinition, data?: unknown, sources?: Record<string, unknown>): unknown[] | null {
  return resolveReportData(definition, data, sources).rows;
}

/** The data of a source: inline JSON, parsed CSV, or a web service's loaded (else saved sample) response. */
export function sourceValue(source: DataSourceDefinition, loaded?: Record<string, unknown>): unknown {
  switch (source.kind) {
    case 'json':
      return source.data;
    case 'csv':
      return csvToObjects(source.text, source.delimiter);
    case 'webService':
    case 'database':
      return loaded && Object.prototype.hasOwnProperty.call(loaded, source.id) ? loaded[source.id] : source.sample;
  }
}

/** Dotted paths of the lists inside a value — candidates for "rows come from". */
export function findListPaths(value: unknown, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (Array.isArray(v)) {
      out.push(path);
      return;
    }
    if (depth >= maxDepth || v === null || typeof v !== 'object') return;
    for (const [k, child] of Object.entries(v)) walk(child, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(value, '', 0);
  return out;
}
