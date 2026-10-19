/**
 * Expression language, e.g. `Iif([Qty] > 10, [Price] * 0.9, [Price])`.
 * Fields are bracketed paths (`[Customer.Name]`), strings use single or double quotes
 * (a doubled quote escapes it), operators: + - * / % = == != <> < <= > >= and or not && || !.
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or';

export type ExpressionNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'field'; path: string[]; position: number }
  | { kind: 'unary'; op: '-' | 'not'; operand: ExpressionNode }
  | { kind: 'binary'; op: BinaryOperator; left: ExpressionNode; right: ExpressionNode; position: number }
  | { kind: 'call'; name: string; args: ExpressionNode[]; position: number };

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'field'; value: string; pos: number }
  | { type: 'ident'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'eof'; pos: number };

const OPERATORS = ['<=', '>=', '<>', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', ','];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      tokens.push({ type: 'number', value: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (ch === "'" || ch === '"') {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new ExpressionError('Unterminated string.', start);
        if (src[i] === ch) {
          if (src[i + 1] === ch) {
            value += ch;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += src[i++];
      }
      tokens.push({ type: 'string', value, pos: start });
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new ExpressionError('Missing "]" after field name.', i);
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new ExpressionError('Empty field name.', i);
      tokens.push({ type: 'field', value: name, pos: i });
      i = end + 1;
    } else if (/[A-Za-z_À-ɏ]/.test(ch)) {
      const m = /^[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/.exec(src.slice(i))!;
      tokens.push({ type: 'ident', value: m[0], pos: i });
      i += m[0].length;
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) throw new ExpressionError(`Unexpected character "${ch}".`, i);
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
    }
  }
  tokens.push({ type: 'eof', pos: src.length });
  return tokens;
}

const OP_ALIASES: Record<string, BinaryOperator> = { '==': '=', '<>': '!=', '&&': 'and', '||': 'or' };

export function parseExpression(src: string): ExpressionNode {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];

  const isOp = (...ops: string[]) => {
    const t = peek();
    if (t.type === 'op' && ops.includes(t.value)) return true;
    return t.type === 'ident' && ops.includes(t.value.toLowerCase());
  };
  const take = () => tokens[p++];
  const expect = (op: string) => {
    if (!isOp(op)) throw new ExpressionError(`Expected "${op}".`, peek().pos);
    take();
  };
  const binary = (next: () => ExpressionNode, ops: string[]) => (): ExpressionNode => {
    let left = next();
    while (isOp(...ops)) {
      const t = take() as { value: string; pos: number };
      const raw = t.value.toLowerCase();
      const op = (OP_ALIASES[raw] ?? raw) as BinaryOperator;
      left = { kind: 'binary', op, left, right: next(), position: t.pos };
    }
    return left;
  };

  const primary = (): ExpressionNode => {
    const t = take();
    switch (t.type) {
      case 'number':
      case 'string':
        return { kind: 'literal', value: t.value };
      case 'field':
        return { kind: 'field', path: t.value.split('.').map((s) => s.trim()), position: t.pos };
      case 'ident': {
        const lower = t.value.toLowerCase();
        if (lower === 'true' || lower === 'false') return { kind: 'literal', value: lower === 'true' };
        if (lower === 'null') return { kind: 'literal', value: null };
        if (!isOp('(')) throw new ExpressionError(`Unknown name "${t.value}". Fields are written in brackets: [${t.value}]`, t.pos);
        take();
        const args: ExpressionNode[] = [];
        if (!isOp(')')) {
          do {
            args.push(or());
          } while (isOp(',') && take());
        }
        expect(')');
        return { kind: 'call', name: t.value, args, position: t.pos };
      }
      case 'op':
        if (t.value === '(') {
          const inner = or();
          expect(')');
          return inner;
        }
        throw new ExpressionError(`Unexpected "${t.value}".`, t.pos);
      case 'eof':
        throw new ExpressionError('Unexpected end of expression.', t.pos);
    }
  };

  const unary = (): ExpressionNode => {
    if (isOp('-')) {
      take();
      return { kind: 'unary', op: '-', operand: unary() };
    }
    if (isOp('+')) {
      take();
      return unary();
    }
    return primary();
  };
  const multiplicative = binary(unary, ['*', '/', '%']);
  const additive = binary(multiplicative, ['+', '-']);
  const comparison = binary(additive, ['=', '==', '!=', '<>', '<', '<=', '>', '>=']);
  const not = (): ExpressionNode => {
    if (isOp('not', '!')) {
      take();
      return { kind: 'unary', op: 'not', operand: not() };
    }
    return comparison();
  };
  const and = binary(not, ['and', '&&']);
  const or = binary(and, ['or', '||']);

  const result = or();
  if (peek().type !== 'eof') throw new ExpressionError('Unexpected text after the expression.', peek().pos);
  return result;
}
