import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { evaluate } from '../expression/evaluate';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from './engine';
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
