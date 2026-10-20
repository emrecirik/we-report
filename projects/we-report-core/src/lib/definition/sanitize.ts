/**
 * Report files are untrusted and may be hand-edited: optional fields of the wrong type are dropped
 * (and lists that are not lists emptied) so a damaged file opens instead of breaking the designer
 * or aborting the layout. Inline data (`dataSources[].data`) is never touched. Returns copies; the
 * input is not modified.
 */

import { createBlankReport } from './blank-report';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isExpression = (v: unknown): boolean => isObj(v) && typeof v['expression'] === 'string';
const isBindable = (v: unknown): boolean => typeof v === 'string' || isExpression(v);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

function validLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

const STYLE_TYPES: Record<string, 'string' | 'number' | 'boolean' | 'object'> = {
  fontFamily: 'string', color: 'string', backgroundColor: 'string', textAlign: 'string', verticalAlign: 'string',
  fontSize: 'number', padding: 'number', bold: 'boolean', italic: 'boolean', underline: 'boolean', border: 'object',
};

/** A style with its wrongly typed properties left out (they fall back to the style sheet). */
function sanitizeStyle(style: Obj): Obj {
  const copy: Obj = { ...style };
  for (const [key, type] of Object.entries(STYLE_TYPES)) {
    if (key in copy && (type === 'object' ? !isObj(copy[key]) : typeof copy[key] !== type || (type === 'number' && !Number.isFinite(copy[key])))) delete copy[key];
  }
  return copy;
}

/** Drops `key` from `o` unless `ok(value)`. */
function keepIf(o: Obj, key: string, ok: (v: unknown) => boolean): void {
  if (key in o && !ok(o[key])) delete o[key];
}

function sanitizeControl(input: Obj): Obj {
  const c: Obj = { ...input };
  keepIf(c, 'visible', (v) => typeof v === 'boolean' || isExpression(v));
  keepIf(c, 'format', (v) => typeof v === 'string');
  keepIf(c, 'style', (v) => typeof v === 'string');
  keepIf(c, 'styleOverrides', isObj);
  if (isObj(c['styleOverrides'])) c['styleOverrides'] = sanitizeStyle(c['styleOverrides']);
  keepIf(c, 'title', (v) => typeof v === 'string');
  keepIf(c, 'totalLabel', (v) => typeof v === 'string');
  if ('formatting' in c) {
    c['formatting'] = objects(c['formatting'])
      .filter((r) => typeof r['when'] === 'string' && isObj(r['style']))
      .map((r) => ({ ...r, style: sanitizeStyle(r['style'] as Obj) }));
  }
  if ('text' in c && !isBindable(c['text'])) c['text'] = typeof c['text'] === 'number' || typeof c['text'] === 'boolean' ? String(c['text']) : '';
  // Every other object on an item is a formula: one without formula text reads as an empty formula
  // (the sub-report's own report migrates on its own).
  for (const [key, value] of Object.entries(c)) {
    if (key !== 'report' && key !== 'styleOverrides' && isObj(value) && typeof value['expression'] !== 'string') c[key] = { ...value, expression: '' };
    // Lists are only these; a list anywhere else stands where a formula belongs.
    const list = ['formatting', 'colors', 'parameters'].includes(key) || (c['type'] === 'table' && (key === 'rows' || key === 'columns'));
    if (Array.isArray(value) && !list) c[key] = { expression: '' };
  }
  if (c['type'] === 'table') {
    c['rows'] = objects(c['rows']).map((row) => ({
      ...row,
      cells: objects(row['cells']).map((cell) => {
        const copy: Obj = { ...cell, text: isBindable(cell['text']) ? cell['text'] : '' };
        keepIf(copy, 'format', (v) => typeof v === 'string');
        keepIf(copy, 'styleOverrides', isObj);
        if (isObj(copy['styleOverrides'])) copy['styleOverrides'] = sanitizeStyle(copy['styleOverrides']);
        return copy;
      }),
    }));
    if (!Array.isArray(c['columns'])) c['columns'] = [];
  }
  return c;
}

function sanitizeBand(input: Obj): Obj {
  // An item without a type cannot be drawn or edited.
  const b: Obj = { ...input, controls: objects(input['controls']).filter((c) => typeof c['type'] === 'string').map(sanitizeControl) };
  keepIf(b, 'visible', isExpression);
  keepIf(b, 'bookmark', isBindable);
  keepIf(b, 'groupBy', isExpression);
  keepIf(b, 'orderBy', isExpression);
  keepIf(b, 'top', (v) => typeof v === 'number');
  keepIf(b, 'rowsPath', (v) => typeof v === 'string');
  keepIf(b, 'columns', isObj);
  if ('sortBy' in b) b['sortBy'] = objects(b['sortBy']).filter(isExpression);
  return b;
}

export function sanitizeDefinition(input: Obj): Obj {
  const d: Obj = { ...input, bands: objects(input['bands']).map(sanitizeBand), dataSources: objects(input['dataSources']) };
  if ('parameters' in d) d['parameters'] = objects(d['parameters']).filter((p) => typeof p['name'] === 'string');
  if ('calculatedFields' in d) d['calculatedFields'] = objects(d['calculatedFields']).filter((f) => typeof f['name'] === 'string' && typeof f['expression'] === 'string');
  // The style sheet is always there; a damaged one is replaced by the defaults.
  d['styles'] = isObj(d['styles'])
    ? Object.fromEntries(Object.entries(d['styles']).filter(([, v]) => isObj(v)).map(([k, v]) => [k, sanitizeStyle(v as Obj)]))
    : {};
  keepIf(d, 'dataMember', (v) => isObj(v) && typeof v['dataSourceId'] === 'string');
  if (isObj(d['dataMember'])) {
    d['dataMember'] = { ...d['dataMember'] };
    keepIf(d['dataMember'] as Obj, 'path', (v) => typeof v === 'string');
  }
  keepIf(d, 'locale', (v) => typeof v === 'string' && validLocale(v));
  keepIf(d, 'currency', (v) => typeof v === 'string' && /^[A-Za-z]{3}$/.test(v));
  keepIf(d, 'watermark', isObj);
  // Paper and margins are needed to lay anything out: damaged ones fall back to A4.
  const blank = createBlankReport().page;
  if (!isObj(d['page'])) d['page'] = blank;
  else if (!isObj(d['page']['margins'])) d['page'] = { ...d['page'], margins: blank.margins };
  return d;
}
