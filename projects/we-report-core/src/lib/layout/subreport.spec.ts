import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { checkReport } from '../definition/check';
import { migrateDefinition } from '../definition/migrations';
import { ReportDefinition, SubreportControl } from '../definition/report-definition';
import { allDataSources } from '../data/web-service';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from './engine';
import { TextItem } from './layout-types';

const NOW = new Date(2026, 9, 19, 10, 0);

const CUSTOMERS = [
  { Id: 1, Name: 'Anadolu Gıda', orders: [{ No: 'A-1' }, { No: 'A-2' }, { No: 'A-3' }] },
  { Id: 2, Name: 'Ege Tekstil', orders: [] },
];
const PAYMENTS = [
  { CustomerId: 1, Amount: 100 },
  { CustomerId: 2, Amount: 250 },
  { CustomerId: 1, Amount: 40 },
];

/** A sub-report listing `[field]` per row, with a header and a total in its footer. */
function innerReport(field: string, total?: string): ReportDefinition {
  const r = createBlankReport('Inner');
  r.bands = [
    { id: 'ih', kind: 'reportHeader', height: 6, controls: [{ id: 'cap', type: 'text', x: 0, y: 0, width: 40, height: 6, text: 'Inner header' }] },
    { id: 'id', kind: 'detail', height: 6, controls: [{ id: 'v', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: `[${field}]` } }] },
  ];
  if (total) r.bands.push({ id: 'if', kind: 'reportFooter', height: 6, controls: [{ id: 't', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: total } }] });
  return r;
}

function outerReport(sub: Partial<SubreportControl>): ReportDefinition {
  const r = createBlankReport('Outer');
  r.dataSources = [
    { id: 'customers', name: 'Customers', kind: 'json', data: CUSTOMERS },
    { id: 'payments', name: 'Payments', kind: 'json', data: PAYMENTS },
  ];
  r.dataMember = { dataSourceId: 'customers' };
  r.bands = [
    {
      id: 'd',
      kind: 'detail',
      height: 20,
      controls: [
        { id: 'name', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: '[Name]' } },
        { id: 'sub', type: 'subreport', x: 10, y: 6, width: 80, height: 6, report: innerReport('No'), ...sub } as SubreportControl,
        { id: 'after', type: 'text', x: 10, y: 14, width: 60, height: 6, text: 'after' },
      ],
    },
  ];
  return r;
}

describe('sub-reports', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  const textItems = (r: ReportDefinition) =>
    layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text').map((t) => ({ text: t.lines.map((l) => l.text).join(' '), x: t.x, y: t.y }));

  it('prints rows from a formula inside its box, growing it and pushing what is below', () => {
    const items = textItems(outerReport({ rows: { expression: '[orders]' } }));
    const first = items.find((t) => t.text === 'Anadolu Gıda')!;
    const second = items.find((t) => t.text === 'Ege Tekstil')!;
    const a1 = items.find((t) => t.text === 'A-1')!;
    expect(a1.x - first.x).toBeCloseTo(10, 5);
    expect(a1.y - first.y).toBeCloseTo(12, 5); // box at 6 + its 6 mm header
    const afters = items.filter((t) => t.text === 'after');
    // Header + 3 rows = 24 mm instead of 6: 'after' moves 18 mm down; the empty list keeps the box size.
    expect(afters[0].y - first.y).toBeCloseTo(32, 5);
    expect(afters[1].y - second.y).toBeCloseTo(14, 5);
  });

  it('links its own data to the outer row with a filter, and takes parameter values from the row', () => {
    const inner = innerReport('Amount', "[?title] + ': ' + Sum([Amount])");
    inner.dataSources = [];
    inner.dataMember = { dataSourceId: 'payments' };
    inner.parameters = [{ name: 'title', type: 'string', defaultValue: 'x' }];
    const items = textItems(
      outerReport({ report: inner, filter: { expression: '[CustomerId] = [^.Id]' }, parameters: [{ name: 'title', value: { expression: "'Total ' + [Name]" } }] }),
    );
    const texts = items.map((t) => t.text);
    expect(texts).toContain('Total Anadolu Gıda: 140');
    expect(texts).toContain('Total Ege Tekstil: 250');
    expect(texts.filter((t) => t === '100' || t === '40' || t === '250').length).toBe(3);
  });

  it('reports a broken sub-report instead of failing the report', () => {
    const r = outerReport({ report: { bands: 'nope' } as unknown as ReportDefinition });
    const doc = layoutReport(r, { fonts, now: NOW });
    expect(doc.problems.some((p) => p.controlId === 'sub')).toBeTrue();
    expect(doc.pages.length).toBe(1);
  });

  it('migrates nested designs with the report around them and refuses endless nesting', () => {
    const r = outerReport({ rows: { expression: '[orders]' } });
    const saved = JSON.parse(JSON.stringify(r));
    delete saved.bands[0].controls[1].report.version;
    const migrated = migrateDefinition(saved);
    expect((migrated.bands[0].controls[1] as SubreportControl).report.version).toBe(1);
    expect(saved.bands[0].controls[1].report.version).toBeUndefined(); // the input is not changed

    let deep: ReportDefinition = createBlankReport('leaf');
    for (let i = 0; i < 8; i++) deep = outerReport({ report: deep });
    expect(() => migrateDefinition(deep)).toThrow();
  });

  it('loads the remote sources of sub-reports too, and checks its formulas over the outer row', () => {
    const inner = innerReport('No');
    inner.dataSources = [{ id: 'ws', name: 'Api', kind: 'webService', url: 'https://example.com/x' }];
    const r = outerReport({ report: inner, rows: { expression: '[nope]' } });
    expect(allDataSources(r).map((s) => s.id)).toEqual(['customers', 'payments', 'ws']);
    const issues = checkReport(r, ['Id', 'Name', 'orders']);
    expect(issues.some((i) => i.controlId === 'sub' && i.code === 'unknownField')).toBeTrue();
  });
});

describe('sections taller than a page', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('continues a long sub-report on the next pages, cutting between its rows', () => {
    const orders = Array.from({ length: 80 }, (_, i) => ({ No: `N-${i + 1}` }));
    const r = outerReport({ rows: { expression: '[orders]' } });
    r.dataSources[0] = { id: 'customers', name: 'Customers', kind: 'json', data: [{ Id: 1, Name: 'Long', orders }] };
    r.bands.unshift({ id: 'ph', kind: 'pageHeader', height: 10, controls: [{ id: 'h', type: 'text', x: 0, y: 0, width: 50, height: 6, text: 'Page head' }] });
    r.bands[1].backgroundColor = '#eeeeee';
    const doc = layoutReport(r, { fonts, now: NOW });
    expect(doc.pages.length).toBe(2);
    const all = doc.pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' ')));
    const numbers = all.flat().filter((t) => t.startsWith('N-'));
    expect(numbers.length).toBe(80); // every row printed exactly once
    expect(all[1][0]).toBe('Page head');
    expect(all[1]).toContain('after');
    const bodyBottom = 297 - 15; // page height - bottom margin (no page footer)
    for (const page of doc.pages) {
      for (const item of page.items) if (item.kind === 'text' || item.kind === 'rect') expect(item.y + item.height).toBeLessThanOrEqual(bodyBottom + 0.02);
    }
    // The section background continues on the second page.
    expect(doc.pages[1].items.some((i) => i.kind === 'rect' && i.fill === '#eeeeee')).toBeTrue();
  });

  it('starts a section that fits on no page right after the previous one instead of leaving the page empty', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ No: `L-${i + 1}` }));
    const r = outerReport({ rows: { expression: '[orders]' } });
    r.dataSources[0] = { id: 'customers', name: 'Customers', kind: 'json', data: [{ Id: 1, Name: 'Short', orders: [{ No: 'S-1' }] }, { Id: 2, Name: 'Long', orders: long }] };
    const pages = layoutReport(r, { fonts, now: NOW }).pages.map((p) => p.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join(' ')));
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain('Short');
    expect(pages[0]).toContain('Long');
    expect(pages[0]).toContain('L-1');
  });

  it('flows a very long text over pages between its lines', () => {
    const r = createBlankReport('Long text');
    const words = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ');
    r.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 180, height: 6, canGrow: true, text: words });
    const doc = layoutReport(r, { fonts, now: NOW });
    expect(doc.pages.length).toBeGreaterThan(1);
    const lines = doc.pages.flatMap((p) => p.items.filter((i): i is TextItem => i.kind === 'text').flatMap((t) => t.lines.map((l) => l.text)));
    expect(lines.join(' ').split(' ').length).toBe(1500);
    for (const page of doc.pages) {
      for (const t of page.items.filter((i): i is TextItem => i.kind === 'text')) {
        for (const l of t.lines) expect(l.baseline).toBeLessThan(t.y + t.height);
      }
    }
  });
});
