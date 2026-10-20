import { amountInWords, numberToWords } from './words';
import { evaluate, EXPRESSION_FUNCTIONS, implementedFunctionNames, RunningTotals } from './evaluate';
import { ExpressionError, parseExpression } from './parser';

describe('expression language', () => {
  const row = { Name: 'çağrı', Price: 12.5, Qty: 4, Customer: { City: 'İzmir' }, Missing: null, Date: '2026-03-07' };

  it('gives the same running totals with remembered sums, also over chained earlier pages', () => {
    const rows = [1, 2, null, 4, 5].map((v) => ({ v }));
    const page1 = rows.slice(0, 2);
    const page2 = rows.slice(2, 4);
    const memo = new RunningTotals();
    const before = memo.chain(memo.chain([], page1), page2);
    for (const runningTotals of [undefined, memo]) {
      const sums = rows.map((r, i) => evaluate('RunningSum([v])', { row: r, rows, rowIndex: i, runningTotals }));
      expect(sums).toEqual([1, 3, 3, 7, 12]);
      expect(evaluate('RunningSum([v])', { rows: [rows[4]], before, runningTotals })).toBe(12);
      expect(evaluate('CarriedSum([v])', { rows: [rows[4]], before, runningTotals })).toBe(7);
    }
    // A new run (new memo) sees a changed parameter.
    expect(evaluate('RunningSum([v] * [?k])', { rows, params: { k: 2 }, runningTotals: memo })).toBe(24);
    expect(evaluate('RunningSum([v] * [?k])', { rows, params: { k: 3 }, runningTotals: new RunningTotals() })).toBe(36);
  });

  it('moves dates by months and years and counts whole days, months and years between them', () => {
    const ev = (e: string, row: unknown = {}) => evaluate(e, { row });
    const feb = ev("AddMonths('2026-01-31', 1)") as Date;
    expect([feb.getMonth(), feb.getDate()]).toEqual([1, 28]);
    expect((ev("AddMonths('2024-01-31', 1)") as Date).getDate()).toBe(29); // leap year
    expect((ev("AddYears('2024-02-29', 1)") as Date).getDate()).toBe(28);
    expect((ev("AddMonths('2026-03-15', -3)") as Date).getMonth()).toBe(11);
    expect(ev("DateDiff('day', '2026-10-01', '2026-10-20')")).toBe(19);
    expect(ev("DateDiff('day', '2026-10-20', '2026-10-01')")).toBe(-19);
    expect(ev("DateDiff('day', '2026-03-28', '2026-03-30')")).toBe(2); // across a clock change
    expect(ev("DateDiff('month', '2026-01-31', '2026-02-28')")).toBe(0);
    expect(ev("DateDiff('month', '2026-01-15', '2026-03-15')")).toBe(2);
    expect(ev("DateDiff('year', '1990-10-21', '2026-10-20')")).toBe(35);
    expect(ev("DateDiff('month', '2026-03-15', '2026-01-20')")).toBe(-1);
    expect(ev("DateDiff('year', '2026-03-15', '2025-03-20')")).toBe(0);
    expect(() => ev("DateDiff('week', '2026-01-01', '2026-02-01')")).toThrow();
  });

  it('reads calculated fields like data fields, data first, and stops a loop', () => {
    const calculated = { total: '[qty] * [price]', net: '[total] * 0.8', loop: '[loop] + 1', qty: '999' };
    const rows = [{ qty: 2, price: 10 }, { qty: 1, price: 5 }];
    expect(evaluate('[total]', { row: rows[0], calculated })).toBe(20);
    expect(evaluate('[net]', { row: rows[0], calculated })).toBe(16);
    expect(evaluate('Sum([total])', { rows, calculated })).toBe(25);
    expect(evaluate('[qty]', { row: rows[0], calculated })).toBe(2); // the data field wins
    expect(() => evaluate('[loop]', { row: rows[0], calculated })).toThrowError(/refers to itself/);
    expect(evaluate('[^.total]', { row: {}, parent: rows[0], calculated })).toBe(20); // the row around has them too
  });

  it('picks a result by value and tests membership', () => {
    const ev = (e: string, row: unknown) => evaluate(e, { row });
    expect(ev("Switch([s], 1, 'Open', 2, 'Closed', 'Other')", { s: 2 })).toBe('Closed');
    expect(ev("Switch([s], 1, 'Open', 2, 'Closed', 'Other')", { s: 9 })).toBe('Other');
    expect(ev("Switch([s], 1, 'Open')", { s: 9 })).toBeNull();
    // Only the chosen result is evaluated: the broken one is never reached.
    expect(ev("Switch([s], 1, 'ok', 2, 1 / 'x')", { s: 1 })).toBe('ok');
    expect(ev("In([c], 'Ankara', 'İzmir')", { c: 'İzmir' })).toBeTrue();
    expect(ev("In([c], 'Ankara', 'İzmir')", { c: 'Bursa' })).toBeFalse();
    expect(ev('In([n], 1, 2, 3)', { n: '2' })).toBeTrue();
  });

  it('writes the name of the day', () => {
    const now = new Date(2026, 9, 19); // a Monday
    expect(evaluate("Format(Today(), 'dddd, dd MMMM yyyy')", { now, locale: 'tr-TR' })).toBe('Pazartesi, 19 Ekim 2026');
    expect(evaluate("Format(Today(), 'ddd dd.MM')", { now, locale: 'en-US' })).toBe('Mon 19.10');
  });

  it('takes the left and right ends of a text and pads it', () => {
    const ev = (e: string) => evaluate(e, { row: { no: 42 } });
    expect(ev("Left('İstanbul', 3)")).toBe('İst');
    expect(ev("Right('İstanbul', 4)")).toBe('nbul');
    expect(ev("Right('abc', 0)")).toBe('');
    expect(ev("PadLeft([no], 6, '0')")).toBe('000042');
    expect(ev("PadLeft('ab', 4)")).toBe('  ab');
  });

  it('evaluates arithmetic with precedence', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('-2 * -3')).toBe(6);
    expect(evaluate('10 % 4')).toBe(2);
    expect(evaluate('.5 + 1e2')).toBe(100.5);
  });

  it('reads fields, nested paths and treats missing as null', () => {
    expect(evaluate('[Price] * [Qty]', { row })).toBe(50);
    expect(evaluate('[Customer.City]', { row })).toBe('İzmir');
    expect(evaluate('[Nope]', { row })).toBeNull();
    expect(evaluate('[Missing] + 1', { row })).toBeNull();
  });

  it('never exposes prototype members through field paths', () => {
    expect(evaluate('[__proto__]', { row })).toBeNull();
    expect(evaluate('[constructor]', { row })).toBeNull();
    expect(evaluate('[Name.constructor]', { row })).toBeNull();
    expect(() => evaluate('constructor(1)')).toThrowError(ExpressionError, /Unknown function/);
    expect(() => evaluate('toString(1)')).not.toThrow(); // our own ToString
  });

  it('concatenates strings and handles quotes', () => {
    expect(evaluate("'Sayın ' + [Name]", { row })).toBe('Sayın çağrı');
    expect(evaluate("'it''s'")).toBe("it's");
    expect(evaluate('"a" + 1')).toBe('a1');
  });

  it('compares and combines with logic operators and aliases', () => {
    expect(evaluate('[Qty] > 3 and [Price] < 20', { row })).toBeTrue();
    expect(evaluate('[Qty] = 4 && not ([Qty] <> 4)', { row })).toBeTrue();
    expect(evaluate('[Missing] = null', { row })).toBeTrue();
    expect(evaluate('[Missing] > 1', { row })).toBeFalse();
    expect(evaluate('!true || false')).toBeFalse();
  });

  it('short-circuits Iif so the untaken branch cannot fail', () => {
    expect(evaluate('Iif([Qty] = 0, 0, [Price] / [Qty])', { row })).toBe(3.125);
    expect(evaluate('Iif(true, 1, 1 / 0)')).toBe(1);
    expect(() => evaluate('1 / 0')).toThrowError(ExpressionError, /Division by zero/);
  });

  it('uses Turkish casing for the tr locale', () => {
    expect(evaluate('Upper([Name])', { row, locale: 'tr-TR' })).toBe('ÇAĞRI');
    expect(evaluate("Upper('i')", { locale: 'tr-TR' })).toBe('İ');
    expect(evaluate("Lower('I')", { locale: 'tr-TR' })).toBe('ı');
  });

  it('runs string, math and date functions', () => {
    expect(evaluate("Substring('report', 2, 3)")).toBe('por');
    expect(evaluate("Replace('a-b-c', '-', '/')")).toBe('a/b/c');
    expect(evaluate('Round(2.5)')).toBe(3);
    expect(evaluate('Round(-2.5)')).toBe(-3);
    expect(evaluate('Round(1.005, 2)')).toBe(1.01);
    expect(evaluate('IsNull([Missing], 5)', { row })).toBe(5);
    expect(evaluate('Year([Date]) * 100 + Month([Date])', { row })).toBe(202603);
    expect(evaluate("Format(AddDays([Date], 30), 'dd.MM.yyyy')", { row })).toBe('06.04.2026');
    expect(evaluate('Min(3, 7) + Max(3, 7)')).toBe(10);
  });

  it('takes Today() from the context, never the clock', () => {
    const now = new Date(2026, 9, 19, 15, 30);
    expect(evaluate("Format(Today(), 'yyyy-MM-dd HH:mm')", { now })).toBe('2026-10-19 00:00');
    expect(() => evaluate('Today()')).toThrowError(ExpressionError);
  });

  it('aggregates over the rows in scope', () => {
    const rows = [{ T: 10, C: 'b' }, { T: 5, C: 'a' }, { T: null, C: 'c' }, { T: 15, C: 'a' }];
    expect(evaluate('Sum([T])', { rows })).toBe(30);
    expect(evaluate('Count()', { rows })).toBe(4);
    expect(evaluate('RowNumber()', { rows, row: rows[2] })).toBe(3);
    expect(evaluate('RowNumber()', { rows, row: { T: 1 } })).toBeNull();
    expect(evaluate('Count([T])', { rows })).toBe(3);
    expect(evaluate('Avg([T])', { rows })).toBe(10);
    expect(evaluate('Min([C])', { rows })).toBe('a');
    expect(evaluate('Max([T])', { rows })).toBe(15);
    expect(evaluate('Sum([T] * 2) / Count([T])', { rows })).toBe(20);
    expect(evaluate('Avg([T])', { rows: [] })).toBeNull();
    expect(() => evaluate('Sum()', { rows })).toThrowError(ExpressionError, /needs 1 argument/);
  });

  it('reports syntax errors with positions and helpful messages', () => {
    const fail = (src: string): ExpressionError => {
      try {
        parseExpression(src);
      } catch (e) {
        return e as ExpressionError;
      }
      throw new Error('expected a syntax error for ' + src);
    };
    expect(fail('1 +').message).toMatch(/end of expression/);
    expect(fail("'open").position).toBe(0);
    expect(fail('[Price').message).toMatch(/"\]"/);
    expect(fail('Price * 2').message).toMatch(/\[Price\]/);
    expect(fail('1 2').position).toBe(2);
    expect(fail('Round(1,').message).toMatch(/end of expression/);
    expect(() => evaluate('Round(1, 2, 3)')).toThrowError(ExpressionError, /1-2 argument/);
  });
});

describe('amounts in words', () => {
  it('writes Turkish and English amounts with their currency', () => {
    expect(numberToWords(1234, 'tr-TR')).toBe('Bin İki Yüz Otuz Dört');
    expect(numberToWords(2001100, 'tr-TR')).toBe('İki Milyon Bin Yüz');
    expect(numberToWords(0, 'tr-TR')).toBe('Sıfır');
    expect(amountInWords(1250.5, 'tr-TR', 'TRY')).toBe('Bin İki Yüz Elli Türk Lirası Elli Kuruş');
    expect(numberToWords(1234, 'en-US')).toBe('one thousand two hundred thirty-four');
    expect(amountInWords(-12.05, 'en-US', 'USD')).toBe('minus twelve dollars and five cents');
    expect(evaluate('AmountInWords([x])', { row: { x: 100 }, locale: 'tr-TR', currency: 'TRY' })).toBe('Yüz Türk Lirası');
  });
});

describe('function catalogue', () => {
  it('lists exactly the functions the interpreter implements', () => {
    const catalogue = EXPRESSION_FUNCTIONS.map((f) => f.name.toLowerCase()).sort();
    expect(catalogue).toEqual([...new Set(implementedFunctionNames())].sort());
    for (const f of EXPRESSION_FUNCTIONS) expect(f.signature.startsWith(`${f.name}(`)).toBeTrue();
  });
});
