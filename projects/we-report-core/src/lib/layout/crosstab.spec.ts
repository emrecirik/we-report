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
