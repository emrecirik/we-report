/** The no-formula form of a conditional-formatting rule: `[field] op value`. */
export interface SimpleCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

export type ConditionOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains';

export const CONDITION_OPS: { op: ConditionOp; label: string }[] = [
  { op: '=', label: '=' },
  { op: '!=', label: '≠' },
  { op: '<', label: '<' },
  { op: '<=', label: '≤' },
  { op: '>', label: '>' },
  { op: '>=', label: '≥' },
  { op: 'contains', label: '…' },
];

/** Numbers stay numbers, everything else becomes a quoted string. */
function literal(value: string): string {
  const v = value.trim();
  if (v !== '' && !isNaN(Number(v))) return v;
  return `'${value.replace(/'/g, "''")}'`;
}

function unliteral(text: string): string {
  const t = text.trim();
  const m = /^'((?:[^']|'')*)'$/.exec(t) ?? /^"((?:[^"]|"")*)"$/.exec(t);
  return m ? m[1].replace(/''/g, "'").replace(/""/g, '"') : t;
}

const LITERAL = String.raw`(-?\d+(?:\.\d+)?|'(?:[^']|'')*'|"(?:[^"]|"")*")`;
const CONTAINS = new RegExp(String.raw`^Contains\((\[[^\]]+\]),\s*${LITERAL}\)$`, 'i');
const COMPARISON = new RegExp(String.raw`^(\[[^\]]+\])\s*(<=|>=|!=|<>|==|=|<|>)\s*${LITERAL}$`);

export function buildCondition(c: SimpleCondition): string {
  if (!c.field) return '';
  return c.op === 'contains' ? `Contains(${c.field}, ${literal(c.value)})` : `${c.field} ${c.op} ${literal(c.value)}`;
}

/** Reads a formula back into the simple form, or `null` when it is something else. */
export function parseCondition(expression: string): SimpleCondition | null {
  const contains = CONTAINS.exec(expression.trim());
  if (contains) return { field: contains[1], op: 'contains', value: unliteral(contains[2]) };
  const m = COMPARISON.exec(expression.trim());
  if (!m) return expression.trim() ? null : { field: '', op: '<', value: '0' };
  const op = (m[2] === '<>' ? '!=' : m[2] === '==' ? '=' : m[2]) as ConditionOp;
  return { field: m[1], op, value: unliteral(m[3]) };
}
