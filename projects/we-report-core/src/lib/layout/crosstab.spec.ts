import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { CrosstabControl, ReportDefinition } from '../definition/report-definition';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from './engine';
import { TextItem } from './layout-types';

const NOW = new Date(2026, 9, 19, 10, 0);
const SALES = [
  { city: 'İzmir', month: 2, amount: 10 },
  { city: 'Ankara', month: 1, amount: 5 },
  { city: 'Ankara', month: 2, amount: 7 },
  { city: 'Ankara', month: 1, amount: 3 },
  { city: 'İzmir', month: 10, amount: 1 },
];

function report(extra: Partial<CrosstabControl> = {}): ReportDefinition {
  const r = createBlankReport('Pivot');
  r.locale = 'tr-TR';
  r.dataSources = [{ id: 'd', name: 'Sales', kind: 'json', data: SALES }];
  r.dataMember = { dataSourceId: 'd' };
  r.bands = [
    { id: 'detail', kind: 'detail', height: 0, controls: [] },
    {
      id: 'rf', kind: 'reportFooter', height: 30,
      controls: [
        { id: 'x', type: 'crosstab', x: 0, y: 0, width: 120, height: 10, rows: { expression: '[city]' }, columns: { expression: '[month]' }, value: { expression: '[amount]' }, title: 'Şehir', ...extra } as CrosstabControl,
        { id: 'below', type: 'text', x: 0, y: 12, width: 40, height: 6, text: 'below' },
      ],
    },
  ];
  return r;
}

/** The table as text rows, read off the laid-out cells by position. */
function grid(r: ReportDefinition, fonts: FontRegistry): string[][] {
  const texts = layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text');
  const rows = new Map<number, TextItem[]>();
  for (const t of texts) rows.set(Math.round(t.y * 10), [...(rows.get(Math.round(t.y * 10)) ?? []), t]);
  return [...rows].sort((a, b) => a[0] - b[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map((t) => t.lines.map((l) => l.text).join(' ')));
}

describe('sparkline', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('draws a small line from the list inside every row, scaled to its own range', () => {
    const r = createBlankReport('Trend');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [{ name: 'A', months: [{ v: 1 }, { v: 3 }, { v: 2 }] }, { name: 'B', months: [{ v: 5 }] }, { name: 'C', months: [] }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[1].height = 8;
    r.bands[1].controls.push({ id: 's', type: 'chart', chartType: 'sparkline', x: 50, y: 1, width: 30, height: 6, rows: { expression: '[months]' }, category: { expression: '' }, value: { expression: '[v]' } });
    const items = layoutReport(r, { fonts, now: NOW }).pages[0].items;
    const lines = items.filter((i) => i.kind === 'path');
    const dots = items.filter((i) => i.kind === 'ellipse');
    expect(lines.length).toBe(1); // only A has two or more points
    expect(dots.length).toBe(2); // A and B get a dot on their last value, C nothing
    const path = (lines[0] as { paths: { d: string }[] }).paths[0].d;
    const ys = path.match(/-?[\d.]+/g)!.map(Number).filter((_, k) => k % 2 === 1);
    expect(ys[1]).toBeLessThan(ys[2]); // 3 is drawn higher than 2
    expect(ys[0]).toBeGreaterThan(ys[2]); // 1 is the lowest
  });
});

describe('cross table', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('pivots rows by columns with totals, numbers in numeric order', () => {
    const g = grid(report(), fonts);
    expect(g[0]).toEqual(['Şehir', '1', '2', '10', 'Σ']);
    expect(g[1]).toEqual(['Ankara', '8', '7', '15']); // empty cell prints nothing
    expect(g[2]).toEqual(['İzmir', '10', '1', '11']);
    expect(g[3]).toEqual(['Σ', '8', '17', '1', '26']);
    expect(g[4]).toEqual(['below']); // pushed below the grown table
  });

  it('caps the columns of a field with too many values and says so', () => {
    const r = report({ columns: { expression: '[n]' } });
    (r.dataSources[0] as { data: unknown }).data = Array.from({ length: 80 }, (_, i) => ({ city: 'A', n: i, amount: 1 }));
    const doc = layoutReport(r, { fonts, now: NOW });
    expect(doc.problems.some((p) => p.controlId === 'x' && p.code === 'overflow' && p.message.includes('50 columns'))).toBeTrue();
    const header = grid(r, fonts)[0];
    expect(header.length).toBe(1 + 50 + 1);
  });

  it('skips empty values in averages and stays fast at its size limit', () => {
    const r = report({ aggregate: 'avg', totals: false });
    (r.dataSources[0] as { data: unknown }).data = [{ city: 'A', month: 1, amount: 10 }, { city: 'A', month: 1, amount: null }, { city: 'A', month: 1, amount: '' }];
    expect(grid(r, fonts)[1]).toEqual(['A', '10']);
    const big = report({ columns: { expression: '[n] % 50' }, rows: { expression: '[n] % 500' } });
    (big.dataSources[0] as { data: unknown }).data = Array.from({ length: 25000 }, (_, n) => ({ n, amount: 1 }));
    const start = performance.now();
    layoutReport(big, { fonts, now: NOW });
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('aggregates by count or average and can leave the totals out', () => {
    expect(grid(report({ aggregate: 'count', totals: false }), fonts).slice(0, 3)).toEqual([
      ['Şehir', '1', '2', '10'],
      ['Ankara', '2', '1'],
      ['İzmir', '1', '1'],
    ]);
    const avg = grid(report({ aggregate: 'avg', format: 'n1', totalLabel: 'Toplam' }), fonts);
    expect(avg[1]).toEqual(['Ankara', '4,0', '7,0', '5,0']);
    expect(avg[3][0]).toBe('Toplam');
  });
});
