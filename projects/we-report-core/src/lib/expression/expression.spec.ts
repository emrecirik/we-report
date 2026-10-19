import { amountInWords, numberToWords } from './words';
import { evaluate } from './evaluate';
import { ExpressionError, parseExpression } from './parser';

describe('expression language', () => {
  const row = { Name: 'çağrı', Price: 12.5, Qty: 4, Customer: { City: 'İzmir' }, Missing: null, Date: '2026-03-07' };

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
