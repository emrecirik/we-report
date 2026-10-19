import { loadTestFonts } from '../../testing/test-fonts';
import { inferSchema } from '../data/infer';
import { layoutReport } from '../layout/engine';
import { TextItem } from '../layout/layout-types';
import { createBlankReport } from './blank-report';
import { captionFor, generateListReport } from './generate';
import { resolvePageGeometry } from './page';

const labels = { title: 'Orders', total: 'Total', pageOf: 'Page {0} of {1}' };

describe('generateListReport', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, customer: `Customer ${i + 1}`, orderDate: '2026-03-01', amount: 10.5, paid: true }));

  it('lays out one column per scalar field across the full width', () => {
    const report = generateListReport(createBlankReport(), inferSchema(rows), labels);
    const detail = report.bands.find((b) => b.kind === 'detail')!;
    const cells = detail.controls.filter((c) => c.type === 'text');
    expect(cells.map((c) => (c.type === 'text' && typeof c.text !== 'string' ? c.text.expression : ''))).toEqual(['[id]', '[customer]', '[orderDate]', '[amount]', '[paid]']);
    const last = cells[cells.length - 1];
    expect(last.x + last.width).toBeCloseTo(resolvePageGeometry(report.page).contentWidth, 6);
    expect(cells.find((c) => c.id === 'cell3')!.type === 'text' && (cells[2] as { format?: string }).format).toBe('dd.MM.yyyy');
  });

  it('sums numeric columns but not id-like ones, and repeats headers on every page', async () => {
    const fonts = await loadTestFonts();
    const report = generateListReport(createBlankReport(), inferSchema(rows), labels);
    const doc = layoutReport(report, { fonts, data: rows, now: new Date(2026, 0, 1) });
    const texts = (i: number) => doc.pages[i].items.filter((x): x is TextItem => x.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' '));
    expect(doc.pages.length).toBeGreaterThan(1);
    expect(texts(1)).toContain('Customer');
    expect(texts(doc.pages.length - 1)).toContain('Total');
    expect(texts(doc.pages.length - 1)).toContain('472.50'); // 45 × 10.50, not the sum of ids
    expect(texts(0)).toContain(`Page 1 of ${doc.pages.length}`);
    expect(doc.problems).toEqual([]);
  });

  it('switches wide tables to landscape and keeps nested objects out', () => {
    const wide = [Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`col${i}`, i])) as Record<string, unknown>];
    wide[0]['nested'] = { a: 1 };
    const report = generateListReport(createBlankReport(), inferSchema(wide), labels);
    expect(report.page.orientation).toBe('landscape');
    expect(report.bands.find((b) => b.kind === 'detail')!.controls.filter((c) => c.type === 'text').length).toBe(10);
  });

  it('treats identifier columns as plain values and whole numbers without decimals', () => {
    const data = [{ 'Sipariş No': 1000, qty: 3, price: 2.5 }, { 'Sipariş No': 1001, qty: 4, price: 3 }];
    const report = generateListReport(createBlankReport(), inferSchema(data), labels, '', data);
    const formats = report.bands.find((b) => b.kind === 'detail')!.controls.filter((c) => c.type === 'text').map((c) => (c as { format?: string }).format);
    expect(formats).toEqual([undefined, 'n0', 'n2']);
    const totals = report.bands.find((b) => b.kind === 'reportFooter')!.controls.map((c) => (c.type === 'text' && typeof c.text !== 'string' ? c.text.expression : c.id));
    expect(totals).toEqual(['totalLabel', 'Sum([qty])', 'Sum([price])']);
  });

  it('groups by a field with a heading and group totals, as the wizard asks', async () => {
    const data = [
      { city: 'B', customer: 'x', amount: 2 },
      { city: 'A', customer: 'y', amount: 1 },
      { city: 'B', customer: 'z', amount: 3 },
    ];
    const report = generateListReport(createBlankReport(), inferSchema(data), labels, '', data, { groupBy: 'city', orientation: 'landscape' });
    expect(report.page.orientation).toBe('landscape');
    expect(report.bands.map((b) => b.kind)).toEqual(['pageHeader', 'groupHeader', 'detail', 'groupFooter', 'reportFooter', 'pageFooter']);
    // The group field is the heading, not a column.
    expect(report.bands.find((b) => b.kind === 'detail')!.controls.filter((c) => c.type === 'text').length).toBe(2);
    const fonts = await loadTestFonts();
    const doc = layoutReport(report, { fonts, data, now: new Date(2026, 0, 1) });
    const texts = doc.pages[0].items.filter((x): x is TextItem => x.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' '));
    expect(texts.indexOf('A')).toBeLessThan(texts.indexOf('B'));
    expect(texts).toContain('5'); // group B total
    expect(texts).toContain('6');
    expect(doc.problems).toEqual([]);

    const plain = generateListReport(createBlankReport(), inferSchema(data), labels, '', data, { totals: false });
    expect(plain.bands.some((b) => b.kind === 'reportFooter')).toBeFalse();
  });

  it('makes readable captions', () => {
    expect(captionFor('orderDate')).toBe('Order date');
    expect(captionFor('customer_name')).toBe('Customer name');
  });
});
