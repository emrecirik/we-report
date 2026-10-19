import { toDate } from '../format';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'image' | 'object' | 'array';

export interface FieldSchema {
  name: string;
  type: FieldType;
  /** For `object` and `array` (of objects) fields. */
  fields?: FieldSchema[];
}

const DOTTED_DATE = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
// 1.234,56 | 1234,56 | -12,5 (comma decimal) — only when the grouping is unambiguous.
const COMMA_DECIMAL = /^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/;
// 1,234.56 | 1,234 (comma grouping)
const DOT_DECIMAL_GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Types a text cell: numbers (including `1.234,56` and `1,234.56`), `dd.MM.yyyy` dates (day
 * first, as in Türkiye and most of Europe), ISO dates, booleans. Anything else stays text.
 * Leading zeros (`00123`, postcodes, account numbers) stay text so they are not mangled.
 */
export function inferValue(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return null;
  if (/^-?0\d/.test(s) && !/^-?0[.,]/.test(s)) return raw;
  if (PLAIN_NUMBER.test(s)) return Number(s);
  if (COMMA_DECIMAL.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (DOT_DECIMAL_GROUPED.test(s)) return Number(s.replace(/,/g, ''));
  const lower = s.toLocaleLowerCase('tr');
  if (lower === 'true' || lower === 'evet') return true;
  if (lower === 'false' || lower === 'hayır') return false;
  const m = DOTTED_DATE.exec(s);
  if (m) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(year, month - 1, day, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    if (d.getMonth() === month - 1 && d.getDate() === day) return d;
  }
  return toDate(s) ?? raw;
}

function typeOf(value: unknown): FieldType | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') {
    if (/^data:image\//.test(value)) return 'image';
    if (toDate(value)) return 'date';
  }
  return 'string';
}

/** Field list of a row set: union of keys in first-seen order, types from the non-null values. */
export function inferSchema(rows: readonly unknown[]): FieldSchema[] {
  const fields = new Map<string, { types: Set<FieldType>; children: unknown[] }>();
  for (const row of rows.slice(0, 500)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const [name, value] of Object.entries(row)) {
      let entry = fields.get(name);
      if (!entry) fields.set(name, (entry = { types: new Set(), children: [] }));
      const t = typeOf(value);
      if (t) entry.types.add(t);
      if (t === 'object') entry.children.push(value);
      if (t === 'array') entry.children.push(...(value as unknown[]));
    }
  }
  return [...fields].map(([name, { types, children }]) => {
    // Mixed numbers/text, or nothing but nulls, is text.
    const type: FieldType = types.size === 1 ? [...types][0] : 'string';
    const schema: FieldSchema = { name, type };
    if ((type === 'object' || type === 'array') && children.length) {
      const nested = inferSchema(children);
      if (nested.length) schema.fields = nested;
    }
    return schema;
  });
}
