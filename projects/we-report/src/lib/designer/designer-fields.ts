import { calculatedFieldMap, evaluate, FieldSchema, FieldType, inferSchema, ReportDefinition, resolveReportData } from 'we-report-core';
import { fieldExpression } from './control-factory';

/** A field the user can drop or pick, flattened from the data schema. */
export interface DesignerField {
  path: string;
  /** The host's display name (`fieldLabels`), else the field name. */
  label: string;
  /** The host's display name when it gave one; captions dropped fields. */
  caption?: string;
  type: FieldType;
  /** Belongs to the object around the rows (`[^.x]`), e.g. the invoice header. */
  parent: boolean;
  expression: string;
  depth: number;
}

/** Display name lookup: `labelOf(path)` reads `labels[keyPrefix + path]`. */
type LabelOf = (path: string) => string | undefined;

function field(path: string, name: string, type: FieldType, parent: boolean, depth: number, labelOf: LabelOf): DesignerField {
  const caption = labelOf(path);
  return { path, label: caption ?? name, caption, type, parent, expression: fieldExpression(path, parent), depth };
}

function flatten(fields: FieldSchema[], parent: boolean, labelOf: LabelOf, prefix = '', depth = 0, skip?: string): DesignerField[] {
  const out: DesignerField[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    // The row list itself is not a field of the parent; its columns are the row fields.
    if (skip && path === skip) continue;
    if (f.type === 'object' && f.fields) {
      out.push(field(path, f.name, f.type, parent, depth, labelOf));
      out.push(...flatten(f.fields, parent, labelOf, path, depth + 1, skip));
    } else if (f.type !== 'array') {
      out.push(field(path, f.name, f.type, parent, depth, labelOf));
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
  /** Inside a sub-report: the row around it, whose fields `[^.field]` reads. */
  outerRow?: unknown,
  /** Display names by path from the data root (`Supplier.SupplierName`, `Items.ProductName`). */
  labels?: Record<string, string>,
): { rows: DesignerField[]; parent: DesignerField[]; lists: string[]; listLabels: Record<string, string>; inner: DesignerField[] } {
  let resolved;
  try {
    resolved = resolveReportData(report, data);
  } catch {
    return { rows: [], parent: [], lists: [], listLabels: {}, inner: [] };
  }
  const own = (key: string) => (labels && Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined);
  const under = (prefix: string): LabelOf => (path) => own(prefix ? `${prefix}.${path}` : path);
  // Rows sit at `dataMember.path`; the parent is the object holding them (or the sub-report's outer row).
  const memberPath = report.dataMember?.path?.split('.').filter(Boolean) ?? [];
  const rowsLabel = under(memberPath.join('.'));
  const schema = inferSchema(resolved.rows ?? []);
  const rows = flatten(schema, false, rowsLabel);
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
    rows.push(field(name, name, type, false, 0, rowsLabel));
  }
  const lists = listPaths(schema);
  const innerPath = report.bands.find((b) => b.kind === 'subDetail')?.rowsPath;
  const inner = flatten(lists.find((l) => l.path === innerPath)?.fields ?? [], false, under([...memberPath, innerPath].filter(Boolean).join('.')));
  const parentValue = outerRow ?? resolved.parent;
  const listName = report.dataMember?.path?.split('.').pop();
  const parent =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? flatten(inferSchema([parentValue]), true, under(outerRow ? '' : memberPath.slice(0, -1).join('.')), '', 0, listName)
      : [];
  const listLabels: Record<string, string> = {};
  for (const l of lists) {
    const label = rowsLabel(l.path);
    if (label) listLabels[l.path] = label;
  }
  return { rows, parent, lists: lists.map((l) => l.path), listLabels, inner };
}
