import { writeCsv } from './csv';

describe('CSV export', () => {
  const table = {
    headers: ['Ürün', 'Tutar', 'Tarih', 'Not'],
    rows: [
      ['Çay; siyah', 1234.5, new Date(2026, 9, 20), 'iyi "taze"'],
      ['=HYPERLINK("x")', -3, null, '-boş'],
    ],
    formats: [undefined, 'n2', 'dd.mm.yyyy', undefined],
  };

  it('writes Turkish CSV with semicolons, decimal commas, ISO dates and a byte-order mark', () => {
    const csv = writeCsv(table, { locale: 'tr-TR' });
    expect(csv.startsWith('\uFEFF')).toBeTrue();
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Ürün;Tutar;Tarih;Not');
    expect(lines[1]).toBe('"Çay; siyah";1234,5;2026-10-20;"iyi ""taze"""');
  });

  it('quotes a number whose decimal comma is also the separator', () => {
    const lines = writeCsv(table, { locale: 'tr-TR', delimiter: ',' }).slice(1).split('\r\n');
    expect(lines[1]).toContain(',"1234,5",');
  });

  it('defuses text a spreadsheet would run as a formula, but not numbers', () => {
    const lines = writeCsv(table, { locale: 'en-US' }).slice(1).split('\r\n');
    expect(lines[0]).toBe('Ürün,Tutar,Tarih,Not');
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",-3,,'-boş`);
  });
});
