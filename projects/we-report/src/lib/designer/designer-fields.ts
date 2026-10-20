import { calculatedFieldMap, evaluate, FieldSchema, FieldType, inferSchema, ReportDefinition, resolveReportData } from 'we-report-core';
import { fieldExpression } from './control-factory';

/** A field the user can drop or pick, flattened from the data schema. */
export interface DesignerField {
  path: string;
  label: string;
  type: FieldType;
  /** Belongs to the object around the rows (`[^.x]`), e.g. the invoice header. */
  parent: boolean;
  expression: string;
  depth: number;
}

function flatten(fields: FieldSchema[], parent: boolean, prefix = '', depth = 0, skip?: string): DesignerField[] {
  const out: DesignerField[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    // The row list itself is not a field of the parent; its columns are the row fields.
    if (skip && path === skip) continue;
    if (f.type === 'object' && f.fields) {
      out.push({ path, label: f.name, type: f.type, parent, expression: fieldExpression(path, parent), depth });
      out.push(...flatten(f.fields, parent, path, depth + 1, skip));
    } else if (f.type !== 'array') {
      out.push({ path, label: f.name, type: f.type, parent, expression: fieldExpression(path, parent), depth });
    }
  }
  return out;
}

/** Paths of the lists of objects inside a row, e.g. `orders` or `customer.addresses`. */
function listPaths(fields: FieldSchema[], prefix = ''): { path: string; fields: FieldSchema[] }[] {
  return fields.flatMap((f) => {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    if (f.type === 'array' && f.fields?.length) return [{ path, fields: f.fields }];
    return f.type === 'object' && f.fields ? listPaths(f.fields, path) : [];
  });
}

/**
 * Row fields, fields of the object holding the rows (when the rows are a nested list), the lists
 * inside a row (for an inner list) and the fields of the inner list's items.
 */
export function designerFields(
  report: ReportDefinition,
  data?: unknown,
): { rows: DesignerField[]; parent: DesignerField[]; lists: string[]; inner: DesignerField[] } {
  let resolved;
  try {
    resolved = resolveReportData(report, data);
  } catch {
    return { rows: [], parent: [], lists: [], inner: [] };
  }
  const schema = inferSchema(resolved.rows ?? []);
  const rows = flatten(schema, false);
  // Calculated fields join the row fields, typed by their value in the first row.
  const calculated = calculatedFieldMap(report);
  for (const name of Object.keys(calculated ?? {})) {
    if (rows.some((f) => f.path === name)) continue;
    let value: unknown = null;
    try {
      value = evaluate(`[${name}]`, { row: resolved.rows?.[0], rows: resolved.rows ?? [], parent: resolved.parent, calculated });
    } catch {
      /* typed as text */
    }
    const type: FieldType = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : value instanceof Date ? 'date' : 'string';
    rows.push({ path: name, label: name, type, parent: false, expression: fieldExpression(name, false), depth: 0 });
  }
  const lists = listPaths(schema);
  const innerPath = report.bands.find((b) => b.kind === 'subDetail')?.rowsPath;
  const inner = flatten(lists.find((l) => l.path === innerPath)?.fields ?? [], false);
  const parentValue = resolved.parent;
  const listName = report.dataMember?.path?.split('.').pop();
  const parent =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? flatten(inferSchema([parentValue]), true, '', 0, listName)
      : [];
  return { rows, parent, lists: lists.map((l) => l.path), inner };
}
