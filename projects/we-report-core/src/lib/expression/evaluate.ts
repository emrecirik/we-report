import { formatValue, toDate } from '../format';
import { ExpressionError, ExpressionNode, parseExpression } from './parser';
import { amountInWords, numberToWords } from './words';

export interface EvaluationContext {
  /** The current data row; fields resolve against it. */
  row?: unknown;
  /** Rows in scope (group, page or report) for aggregates such as `Sum([Total])`. */
  rows?: readonly unknown[];
  /** The object holding the detail rows (e.g. the invoice around its lines), read with `[^.Field]`. */
  parent?: unknown;
  /** Report parameter values, read with `[?name]`. */
  params?: Record<string, unknown>;
  locale?: string;
  currency?: string;
  /** Print time for `Today()`/`Now()`; supplied by the host so rendering stays deterministic. */
  now?: Date;
}

type Value = unknown;

interface FunctionDef {
  min: number;
  max: number;
  fn: (args: Value[], ctx: EvaluationContext) => Value;
}

const str = (v: Value) => (v === null || v === undefined ? '' : String(v));
const num = (v: Value, name: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  throw new Error(`${name} expects a number.`);
};
const date = (v: Value, name: string): Date => {
  const d = toDate(v);
  if (!d) throw new Error(`${name} expects a date.`);
  return d;
};
const now = (ctx: EvaluationContext) => {
  if (!ctx.now) throw new Error('The print date is not available.');
  return ctx.now;
};

const FUNCTIONS: Record<string, FunctionDef> = {
  isnull: { min: 2, max: 2, fn: ([v, fallback]) => (v === null || v === undefined ? fallback : v) },
  concat: { min: 1, max: 99, fn: (args) => args.map(str).join('') },
  numbertowords: { min: 1, max: 1, fn: ([v], ctx) => numberToWords(num(v, 'NumberToWords'), ctx.locale) },
  amountinwords: {
    min: 1,
    max: 2,
    fn: ([v, currency], ctx) => amountInWords(num(v, 'AmountInWords'), ctx.locale, currency === undefined ? (ctx.currency ?? 'USD') : str(currency)),
  },
  len: { min: 1, max: 1, fn: ([v]) => str(v).length },
  upper: { min: 1, max: 1, fn: ([v], ctx) => str(v).toLocaleUpperCase(ctx.locale) },
  lower: { min: 1, max: 1, fn: ([v], ctx) => str(v).toLocaleLowerCase(ctx.locale) },
  trim: { min: 1, max: 1, fn: ([v]) => str(v).trim() },
  substring: {
    min: 2,
    max: 3,
    fn: ([v, start, length]) => {
      const s = str(v);
      const from = num(start, 'Substring');
      return length === undefined ? s.slice(from) : s.slice(from, from + num(length, 'Substring'));
    },
  },
  replace: { min: 3, max: 3, fn: ([v, find, repl]) => str(v).split(str(find)).join(str(repl)) },
  contains: { min: 2, max: 2, fn: ([v, part]) => str(v).includes(str(part)) },
  startswith: { min: 2, max: 2, fn: ([v, part]) => str(v).startsWith(str(part)) },
  endswith: { min: 2, max: 2, fn: ([v, part]) => str(v).endsWith(str(part)) },
  round: {
    min: 1,
    max: 2,
    fn: ([v, digits]) => {
      const d = digits === undefined ? 0 : Math.trunc(num(digits, 'Round'));
      if (d < 0 || d > 15) throw new Error('Round digits must be between 0 and 15.');
      const n = num(v, 'Round');
      // Half away from zero (2.5 -> 3, -2.5 -> -3) on the decimal text, so 1.005 rounds to 1.01.
      return Math.sign(n) * Number(Math.round(Number(Math.abs(n) + 'e' + d)) + 'e-' + d);
    },
  },
  abs: { min: 1, max: 1, fn: ([v]) => Math.abs(num(v, 'Abs')) },
  floor: { min: 1, max: 1, fn: ([v]) => Math.floor(num(v, 'Floor')) },
  ceiling: { min: 1, max: 1, fn: ([v]) => Math.ceil(num(v, 'Ceiling')) },
  tonumber: { min: 1, max: 1, fn: ([v]) => num(v, 'ToNumber') },
  tostring: { min: 1, max: 1, fn: ([v]) => str(v) },
  format: {
    min: 2,
    max: 2,
    fn: ([v, pattern], ctx) =>
      formatValue(v, str(pattern), { locale: ctx.locale ?? 'en-US', currency: ctx.currency ?? 'USD' }),
  },
  today: {
    min: 0,
    max: 0,
    fn: (_, ctx) => {
      const d = now(ctx);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    },
  },
  now: { min: 0, max: 0, fn: (_, ctx) => now(ctx) },
  year: { min: 1, max: 1, fn: ([v]) => date(v, 'Year').getFullYear() },
  month: { min: 1, max: 1, fn: ([v]) => date(v, 'Month').getMonth() + 1 },
  day: { min: 1, max: 1, fn: ([v]) => date(v, 'Day').getDate() },
  adddays: {
    min: 2,
    max: 2,
    fn: ([v, days]) => {
      const d = date(v, 'AddDays');
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + num(days, 'AddDays'), d.getHours(), d.getMinutes(), d.getSeconds());
    },
  },
};

const AGGREGATES = new Set(['sum', 'count', 'avg', 'min', 'max']);

export type FunctionCategory = 'logic' | 'text' | 'number' | 'date' | 'aggregate';

/** One entry of the function catalogue the designer's formula editor offers. */
export interface FunctionInfo {
  name: string;
  /** How it is called, e.g. `Round(number, digits?)`. */
  signature: string;
  category: FunctionCategory;
}

/** Every function of the language. Explanations are locale strings keyed by `name`. */
export const EXPRESSION_FUNCTIONS: readonly FunctionInfo[] = [
  { name: 'Iif', signature: 'Iif(condition, then, else)', category: 'logic' },
  { name: 'IsNull', signature: 'IsNull(value, fallback)', category: 'logic' },
  { name: 'Concat', signature: 'Concat(a, b, …)', category: 'text' },
  { name: 'Len', signature: 'Len(text)', category: 'text' },
  { name: 'Upper', signature: 'Upper(text)', category: 'text' },
  { name: 'Lower', signature: 'Lower(text)', category: 'text' },
  { name: 'Trim', signature: 'Trim(text)', category: 'text' },
  { name: 'Substring', signature: 'Substring(text, start, length?)', category: 'text' },
  { name: 'Replace', signature: 'Replace(text, find, with)', category: 'text' },
  { name: 'Contains', signature: 'Contains(text, part)', category: 'text' },
  { name: 'StartsWith', signature: 'StartsWith(text, part)', category: 'text' },
  { name: 'EndsWith', signature: 'EndsWith(text, part)', category: 'text' },
  { name: 'ToString', signature: 'ToString(value)', category: 'text' },
  { name: 'Format', signature: "Format(value, 'pattern')", category: 'text' },
  { name: 'AmountInWords', signature: 'AmountInWords(amount, currency?)', category: 'text' },
  { name: 'NumberToWords', signature: 'NumberToWords(number)', category: 'text' },
  { name: 'Round', signature: 'Round(number, digits?)', category: 'number' },
  { name: 'Abs', signature: 'Abs(number)', category: 'number' },
  { name: 'Floor', signature: 'Floor(number)', category: 'number' },
  { name: 'Ceiling', signature: 'Ceiling(number)', category: 'number' },
  { name: 'ToNumber', signature: 'ToNumber(value)', category: 'number' },
  { name: 'Today', signature: 'Today()', category: 'date' },
  { name: 'Now', signature: 'Now()', category: 'date' },
  { name: 'Year', signature: 'Year(date)', category: 'date' },
  { name: 'Month', signature: 'Month(date)', category: 'date' },
  { name: 'Day', signature: 'Day(date)', category: 'date' },
  { name: 'AddDays', signature: 'AddDays(date, days)', category: 'date' },
  { name: 'Sum', signature: 'Sum(value)', category: 'aggregate' },
  { name: 'Count', signature: 'Count()', category: 'aggregate' },
  { name: 'Avg', signature: 'Avg(value)', category: 'aggregate' },
  { name: 'Min', signature: 'Min(value)', category: 'aggregate' },
  { name: 'Max', signature: 'Max(value)', category: 'aggregate' },
];

/** Function names only, in catalogue order. */
export const EXPRESSION_FUNCTION_NAMES: readonly string[] = EXPRESSION_FUNCTIONS.map((f) => f.name);

/** Lower-case names the interpreter implements; the catalogue test keeps both lists in step. */
export function implementedFunctionNames(): string[] {
  return [...Object.keys(FUNCTIONS), ...AGGREGATES, 'iif'];
}

/** Resolves a field path on own properties only, so `[__proto__]` or `[constructor]` read nothing. */
function readField(row: unknown, path: string[]): Value {
  let current: unknown = row;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current === undefined ? null : current;
}

function truthy(v: Value): boolean {
  return v !== null && v !== undefined && v !== false && v !== 0 && v !== '';
}

function comparable(v: Value): Value {
  return v instanceof Date ? v.getTime() : v;
}

function compare(a: Value, b: Value): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const x = comparable(a);
  const y = comparable(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  return String(x).localeCompare(String(y));
}

function evalNode(node: ExpressionNode, ctx: EvaluationContext): Value {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'field':
      if (node.path[0] === '^') return readField(ctx.parent, node.path.slice(1));
      if (node.path[0].startsWith('?')) return readField(ctx.params, [node.path[0].slice(1), ...node.path.slice(1)]);
      return readField(ctx.row, node.path);
    case 'unary': {
      const v = evalNode(node.operand, ctx);
      if (node.op === 'not') return !truthy(v);
      return v === null || v === undefined ? null : -num(v, '-');
    }
    case 'binary': {
      if (node.op === 'and') return truthy(evalNode(node.left, ctx)) && truthy(evalNode(node.right, ctx));
      if (node.op === 'or') return truthy(evalNode(node.left, ctx)) || truthy(evalNode(node.right, ctx));
      const a = evalNode(node.left, ctx);
      const b = evalNode(node.right, ctx);
      try {
        return applyBinary(node.op, a, b);
      } catch (e) {
        throw new ExpressionError((e as Error).message, node.position);
      }
    }
    case 'call':
      try {
        return evalCall(node, ctx);
      } catch (e) {
        if (e instanceof ExpressionError) throw e;
        throw new ExpressionError((e as Error).message, node.position);
      }
  }
}

function applyBinary(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '+':
      if (typeof a === 'string' || typeof b === 'string') return str(a) + str(b);
      if (a === null || a === undefined || b === null || b === undefined) return null;
      return num(a, '+') + num(b, '+');
    case '-':
    case '*':
    case '/':
    case '%': {
      if (a === null || a === undefined || b === null || b === undefined) return null;
      const x = num(a, op);
      const y = num(b, op);
      if ((op === '/' || op === '%') && y === 0) throw new Error('Division by zero.');
      return op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y;
    }
    case '=':
      return (a ?? null) === (b ?? null) || compare(a, b) === 0;
    case '!=':
      return !((a ?? null) === (b ?? null) || compare(a, b) === 0);
    default: {
      const c = compare(a, b);
      if (c === null) return false;
      return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
    }
  }
}

function evalCall(node: Extract<ExpressionNode, { kind: 'call' }>, ctx: EvaluationContext): Value {
  const name = node.name.toLowerCase();
  const args = node.args;

  if (name === 'iif') {
    if (args.length !== 3) throw new Error('Iif needs 3 arguments: condition, value if true, value if false.');
    return evalNode(truthy(evalNode(args[0], ctx)) ? args[1] : args[2], ctx);
  }

  // Min/Max with two arguments are scalar; with one argument they aggregate like Sum.
  if (AGGREGATES.has(name) && (args.length === 1 || (name === 'count' && args.length === 0))) {
    const rows = ctx.rows ?? [];
    if (args.length === 0) return rows.length;
    const values = rows
      .map((row) => evalNode(args[0], { ...ctx, row }))
      .filter((v) => v !== null && v !== undefined);
    if (name === 'count') return values.length;
    if (name === 'min' || name === 'max') {
      if (!values.length) return null;
      return values.reduce((m, v) => {
        const c = compare(v, m);
        return c !== null && (name === 'min' ? c < 0 : c > 0) ? v : m;
      });
    }
    const sum = values.reduce<number>((s, v) => s + num(v, node.name), 0);
    if (name === 'sum') return sum;
    return values.length ? sum / values.length : null;
  }
  if ((name === 'min' || name === 'max') && args.length === 2) {
    const [a, b] = args.map((a) => evalNode(a, ctx));
    const c = compare(a, b);
    if (c === null) return null;
    return name === 'min' ? (c <= 0 ? a : b) : c >= 0 ? a : b;
  }
  if (AGGREGATES.has(name)) throw new Error(`${node.name} needs 1 argument, e.g. ${node.name}([Total]).`);

  const def = FUNCTIONS[name];
  if (!def || !Object.prototype.hasOwnProperty.call(FUNCTIONS, name)) throw new Error(`Unknown function "${node.name}".`);
  if (args.length < def.min || args.length > def.max) {
    const expected = def.min === def.max ? `${def.min}` : `${def.min}-${def.max}`;
    throw new Error(`${node.name} needs ${expected} argument(s), got ${args.length}.`);
  }
  return def.fn(args.map((a) => evalNode(a, ctx)), ctx);
}

/** Evaluates a parsed expression. Throws `ExpressionError` with the source position on failure. */
export function evaluateExpression(node: ExpressionNode, ctx: EvaluationContext = {}): Value {
  return evalNode(node, ctx);
}

const cache = new Map<string, ExpressionNode>();

/** Parses (cached) and evaluates source text. */
export function evaluate(src: string, ctx: EvaluationContext = {}): Value {
  let node = cache.get(src);
  if (!node) {
    node = parseExpression(src);
    // shortcut: unbounded cache, fine for a report's few hundred expressions; add LRU if a host evaluates user input in a loop.
    cache.set(src, node);
  }
  return evaluateExpression(node, ctx);
}
