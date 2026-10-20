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
