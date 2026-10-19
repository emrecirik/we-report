import { FieldSchema, FieldType, inferSchema, ReportDefinition, resolveReportData } from 'we-report-core';
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

/** Row fields, then fields of the object holding the rows (when the rows are a nested list). */
export function designerFields(report: ReportDefinition, data?: unknown): { rows: DesignerField[]; parent: DesignerField[] } {
  let resolved;
  try {
    resolved = resolveReportData(report, data);
  } catch {
    return { rows: [], parent: [] };
  }
  const rows = flatten(inferSchema(resolved.rows ?? []), false);
  const parentValue = resolved.parent;
  const listName = report.dataMember?.path?.split('.').pop();
  const parent =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? flatten(inferSchema([parentValue]), true, '', 0, listName)
      : [];
  return { rows, parent };
}
