import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { evaluate } from '../expression/evaluate';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from './engine';
import { renderPdf } from '../render/pdf';
import { reportTable } from '../render/xlsx';
import { checkReport } from '../definition/check';
import { TextItem } from './layout-types';

const NOW = new Date(2026, 9, 19, 10, 0);

describe('running totals', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('adds up to the current row, or all rows without one', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    expect(evaluate('RunningSum([a])', { row: rows[1], rows, rowIndex: 1 })).toBe(3);
    expect(evaluate('RunningSum([a])', { row: rows[0], rows })).toBe(6);
    expect(evaluate('RunningSum([a])', { rows, before: [{ a: 10 }] })).toBe(16);
    expect(evaluate('CarriedSum([a])', { rows, before: [{ a: 10 }, { a: 5 }] })).toBe(15);
    expect(evaluate('CarriedSum([a])', { rows })).toBe(0);
    expect(() => evaluate('RunningSum()', { rows })).toThrow();
  });

  it('brings totals forward in page headers and carries them in page footers', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ n: i + 1, amount: 1 }));
    const r = createBlankReport('Ledger');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: rows }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[0].controls.push({ id: 'bf', type: 'text', x: 0, y: 0, width: 80, height: 6, text: { expression: "'BF ' + CarriedSum([amount])" } });
    r.bands[1].controls.push({ id: 'run', type: 'text', x: 0, y: 0, width: 80, height: 6, text: { expression: "'R ' + RunningSum([amount])" } });
    r.bands[2].controls.push({ id: 'cf', type: 'text', x: 0, y: 0, width: 80, height: 6, text: { expression: "'CF ' + RunningSum([amount]) + ' P ' + Sum([amount])" } });
    const pages = layoutReport(r, { fonts, now: NOW }).pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' ')));
    expect(pages.length).toBeGreaterThan(2);
    let carried = 0;
    for (const page of pages) {
      const onPage = page.filter((t) => t.startsWith('R ')).length;
      expect(page).toContain(`BF ${carried}`);
      expect(page).toContain(`R ${carried + 1}`);
      carried += onPage;
      expect(page).toContain(`CF ${carried} P ${onPage}`);
    }
    expect(carried).toBe(100);
  });
});

describe('page numbers per group', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('starts every group on a new page numbered from 1, with its own carried total', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) => ({ c: 'A', n: i, amount: 1 })),
      ...Array.from({ length: 10 }, (_, i) => ({ c: 'B', n: i, amount: 2 })),
    ];
    const r = createBlankReport('Statements');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: rows }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands.splice(1, 0, { id: 'g', kind: 'groupHeader', height: 8, groupBy: { expression: '[c]' }, resetPageNumber: true, controls: [{ id: 'gt', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "'Customer ' + [c]" } }] });
    r.bands[0].controls.push({ id: 'bf', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: "'BF ' + CarriedSum([amount])" } });
    r.bands[3].controls.push({ id: 'pg', type: 'pageInfo', x: 100, y: 0, width: 40, height: 6, info: 'pageNofM' });
    const pages = layoutReport(r, { fonts, now: NOW }).pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' ')));
    const a = pages.filter((p) => !p.includes('Customer B') && !pages.slice(0, pages.indexOf(p)).some((q) => q.includes('Customer B')));
    expect(a.length).toBe(2);
    expect(pages.map((p) => p.find((t) => /^\d+ \/ \d+$/.test(t)))).toEqual(['1 / 2', '2 / 2', '1 / 1']);
    expect(pages[2]).toContain('Customer B');
    expect(pages[2]).toContain('BF 0'); // B's carried total starts again
    expect(pages[1]).not.toContain('BF 0');

    // A report header shares the first group's first page instead of standing alone.
    r.bands.unshift({ id: 'rh', kind: 'reportHeader', height: 10, controls: [{ id: 'rt', type: 'text', x: 0, y: 0, width: 60, height: 6, text: 'Statements' }] });
    const withHeader = layoutReport(r, { fonts, now: NOW }).pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' ')));
    expect(withHeader[0]).toContain('Statements');
    expect(withHeader[0]).toContain('Customer A');
  });
});

describe('group header with its first row', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('moves a header that would end a page alone to the next page', () => {
    const r = createBlankReport('Orphans');
    // 242 mm of body: A's header and 38 rows end at 234, so B's header fits but its row does not.
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [...Array.from({ length: 38 }, (_, i) => ({ g: 'A', n: String(i) })), { g: 'B', n: 'B-first' }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands.splice(1, 0, { id: 'gh', kind: 'groupHeader', height: 6, groupBy: { expression: '[g]' }, controls: [{ id: 'h', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "'Group ' + [g]" } }] });
    r.bands[2].height = 6;
    r.bands[2].controls.push({ id: 'n', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "'row ' + [n]" } });
    const where = () => {
      const pages = layoutReport(r, { fonts, now: NOW }).pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0].text));
      return [pages.findIndex((p) => p.includes('Group B')), pages.findIndex((p) => p.includes('row B-first'))];
    };
    expect(where()).toEqual([0, 1]); // the header ends page 1 alone
    r.bands[1].keepWithFirstRow = true;
    expect(where()).toEqual([1, 1]);
  });
});

describe('groups ordered by a formula', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('puts the group with the largest total first, nested groups ordered within their parent', () => {
    const rows = [
      { c: 'Ankara', p: 'Çay', a: 10 }, { c: 'Ankara', p: 'Kahve', a: 50 },
      { c: 'İzmir', p: 'Çay', a: 100 }, { c: 'İzmir', p: 'Kahve', a: 1 },
      { c: 'Bursa', p: 'Çay', a: 30 },
    ];
    const r = createBlankReport('Top');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: rows }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands.splice(1, 0,
      { id: 'gc', kind: 'groupHeader', height: 6, groupBy: { expression: '[c]' }, orderBy: { expression: 'Sum([a])', descending: true }, controls: [{ id: 'ct', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: "'C ' + [c]" } }] },
      { id: 'gp', kind: 'groupHeader', height: 6, groupBy: { expression: '[p]' }, orderBy: { expression: 'Sum([a])', descending: true }, controls: [{ id: 'pt', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: "'P ' + [p]" } }] },
    );
    const texts = layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0].text).filter((t) => /^[CP] /.test(t));
    expect(texts).toEqual(['C İzmir', 'P Çay', 'P Kahve', 'C Ankara', 'P Kahve', 'P Çay', 'C Bursa', 'P Çay']);
    // Top 2 cities only.
    r.bands[1].top = 2;
    const top = layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0].text).filter((t) => t.startsWith('C '));
    expect(top).toEqual(['C İzmir', 'C Ankara']);
    delete r.bands[1].top;
    // Exports list the rows in the same order.
    r.bands.find((b) => b.kind === 'detail')!.controls = [{ id: 'a', type: 'text', x: 0, y: 0, width: 30, height: 6, text: { expression: '[a]' } }];
    expect(reportTable(r, { now: NOW }).rows.map((x) => x[0])).toEqual([100, 1, 50, 10, 30]);
  });
});

describe('section options', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('stripes every second detail row and leaves out sections whose formula is false', () => {
    const r = createBlankReport('Stripes');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[1].alternateBackgroundColor = '#eeeeee';
    r.bands[1].controls.push({ id: 'n', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: '[n]' } });
    r.bands.splice(2, 0, { id: 'rf', kind: 'reportFooter', height: 8, visible: { expression: 'Count() > 10' }, controls: [{ id: 't', type: 'text', x: 0, y: 0, width: 40, height: 6, text: 'many' }] });
    const page = layoutReport(r, { fonts, now: NOW }).pages[0];
    expect(page.items.filter((i) => i.kind === 'rect' && i.fill === '#eeeeee').length).toBe(2);
    expect(page.items.some((i) => i.kind === 'text' && i.lines[0].text === 'many')).toBeFalse();
    (r.bands[2].visible as { expression: string }).expression = 'Count() = 4';
    expect(layoutReport(r, { fonts, now: NOW }).pages[0].items.some((i) => i.kind === 'text' && i.lines[0].text === 'many')).toBeTrue();
  });
});

describe('document map', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('lists bookmarked groups and rows with their page, nested by level, and writes PDF bookmarks', async () => {
    const rows = [...Array.from({ length: 40 }, (_, i) => ({ c: 'Ankara', n: `A${i}` })), ...Array.from({ length: 3 }, (_, i) => ({ c: 'İzmir', n: `I${i}` }))];
    const r = createBlankReport('Map');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: rows }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands.splice(1, 0, { id: 'g', kind: 'groupHeader', height: 8, groupBy: { expression: '[c]' }, bookmark: { expression: '[c]' }, controls: [] });
    r.bands[2].bookmark = { expression: '[n]' };
    r.bands[2].height = 7;
    const doc = layoutReport(r, { fonts, now: NOW });
    const marks = doc.bookmarks!;
    expect(marks.length).toBe(2 + 43);
    expect(marks[0]).toEqual(jasmine.objectContaining({ title: 'Ankara', pageIndex: 0, level: 0 }));
    expect(marks[1]).toEqual(jasmine.objectContaining({ title: 'A0', level: 1 }));
    const izmir = marks.find((m) => m.title === 'İzmir')!;
    expect(izmir.pageIndex).toBe(doc.pages.length - 1);
    expect(marks.find((m) => m.title === 'A39')!.pageIndex).toBeGreaterThan(0);

    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
    const pdf = await PDFDocument.load(await renderPdf(doc, fonts, { lang: 'tr-TR' }));
    expect(pdf.catalog.get(PDFName.of('Lang'))!.toString()).toContain('tr-TR');
    const outlines = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    expect(outlines.get(PDFName.of('Count'))!.toString()).toBe('45');
    const first = outlines.lookup(PDFName.of('First'), PDFDict);
    expect(first.lookup(PDFName.of('Title'))!.toString()).toContain('FEFF'); // UTF-16 text
  });
});

describe('calculated fields', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('prints, totals, sorts and exports a calculated field, and checks its formula', () => {
    const r = createBlankReport('Calc');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [{ qty: 2, price: 10 }, { qty: 5, price: 1 }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.calculatedFields = [{ name: 'total', expression: '[qty] * [price]' }];
    r.bands[1].sortBy = [{ expression: '[total]' }];
    r.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "'T ' + [total]" } });
    r.bands.splice(2, 0, { id: 'rf', kind: 'reportFooter', height: 8, controls: [{ id: 's', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "'S ' + Sum([total])" } }] });
    const texts = layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0].text);
    expect(texts.filter((t) => /^[TS] /.test(t))).toEqual(['T 5', 'T 20', 'S 25']);
    expect(checkReport(r, ['qty', 'price']).filter((i) => i.code === 'unknownField')).toEqual([]);
    r.calculatedFields.push({ name: 'bad', expression: '1 +' });
    expect(checkReport(r).some((i) => i.code === 'formulaError' && i.controlId === 'bad')).toBeTrue();
    r.bands[1].controls[0] = { id: 'c', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: '[total]' } };
    expect(reportTable(r, { now: NOW }).rows).toEqual([[5], [20]]); // sorted as printed
  });
});

describe('page settings', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('paints the page colour first and mirrors the margins on even pages', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ n: i }));
    const r = createBlankReport('Booklet');
    r.page.margins = { top: 15, right: 10, bottom: 15, left: 25 };
    r.page.mirrorMargins = true;
    r.page.color = '#fffbe6';
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: rows }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[0].controls.push({ id: 'h', type: 'text', x: 0, y: 0, width: 40, height: 6, text: 'Head' });
    r.bands[1].controls.push({ id: 'n', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: '[n]' } });
    const pages = layoutReport(r, { fonts, now: NOW }).pages;
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].items[0]).toEqual(jasmine.objectContaining({ kind: 'rect', x: 0, y: 0, fill: '#fffbe6' }));
    const firstX = (i: number) => pages[i].items.filter((t): t is TextItem => t.kind === 'text').map((t) => t.x);
    expect(new Set(firstX(0))).toEqual(new Set([25]));
    expect(new Set(firstX(1))).toEqual(new Set([10]));
  });
});

describe('pictures from addresses', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));
  // A 1 × 1 PNG.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('lists the addresses it needs, then draws what the host fetched', () => {
    const r = createBlankReport('Catalogue');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [{ photo: 'https://example.com/a.png' }, { photo: 'https://example.com/b.png' }, { photo: 'https://example.com/a.png' }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[1].controls.push({ id: 'img', type: 'image', x: 0, y: 0, width: 20, height: 20, source: { expression: '[photo]' }, fit: 'contain' });
    r.bands[1].height = 22;
    const first = layoutReport(r, { fonts, now: NOW });
    expect(first.imageUrls).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    expect(first.pages[0].items.some((i) => i.kind === 'image')).toBeFalse();

    const second = layoutReport(r, { fonts, now: NOW, images: { 'https://example.com/a.png': PNG, 'https://example.com/b.png': '' } });
    expect(second.imageUrls).toBeUndefined();
    expect(second.pages[0].items.filter((i) => i.kind === 'image').length).toBe(2);
    expect(second.problems.some((p) => p.code === 'image' && p.message.includes('b.png'))).toBeTrue();
  });
});
