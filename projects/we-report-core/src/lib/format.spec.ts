import { formatValue, toDate } from './format';

describe('formatValue', () => {
  const tr = { locale: 'tr-TR', currency: 'TRY' };
  const en = { locale: 'en-US', currency: 'USD' };

  it('formats numbers with locale grouping and decimals', () => {
    expect(formatValue(1234.5, 'n2', tr)).toBe('1.234,50');
    expect(formatValue(1234.5, 'n2', en)).toBe('1,234.50');
    expect(formatValue(1234.567, 'n0', en)).toBe('1,235');
    expect(formatValue(42, 'd5', en)).toBe('00042');
    expect(formatValue(0.256, 'p1', en)).toBe('25.6%');
  });

  it('formats currency in the given currency', () => {
    expect(formatValue(1500, 'c2', en)).toBe('$1,500.00');
    expect(formatValue(1500, 'c2', tr)).toContain('1.500,00');
  });

  it('formats dates with tokens and quoted literals', () => {
    const d = new Date(2026, 0, 5, 9, 7, 3);
    expect(formatValue(d, 'dd.MM.yyyy HH:mm:ss', tr)).toBe('05.01.2026 09:07:03');
    expect(formatValue(d, "d MMMM yyyy", tr)).toBe('5 Ocak 2026');
    expect(formatValue('2026-01-05', "'Tarih:' dd/MM/yy", tr)).toBe('Tarih: 05/01/26');
  });

  it('leaves strings alone and renders null as empty', () => {
    expect(formatValue('2026 plan', undefined, tr)).toBe('2026 plan');
    expect(formatValue(null, 'n2', tr)).toBe('');
    expect(formatValue(true, undefined, tr)).toBe('true');
  });

  it('parses bare ISO dates as local dates', () => {
    const d = toDate('2026-12-31')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 11, 31, 0]);
    expect(toDate('31.12.2026')).toBeNull();
    expect(toDate(new Date(NaN))).toBeNull();
  });
});
