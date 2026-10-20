import { PDFDocument } from 'pdf-lib';
import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { Band, ChartControl, ReportDefinition } from '../definition/report-definition';
import { FontRegistry } from '../fonts/font-registry';
import { renderPdf } from '../render/pdf';
import { layoutReport } from './engine';
import { LayoutPage, PathItem, RectItem, TextItem } from './layout-types';
import { niceScale } from './chart';
import { barcodeItem } from './barcode';
import { applyLabelSheet, LABEL_SHEETS } from '../definition/label-sheets';
import { checkReport } from '../definition/check';
import { reportTable } from '../render/xlsx';
import { fitLines, wrapText } from './text-wrap';

const NOW = new Date(2026, 9, 19, 10, 0);

function texts(page: LayoutPage): string[] {
  return page.items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines.map((l) => l.text).join('\n'));
}

function listReport(rows: unknown[]): ReportDefinition {
  const report = createBlankReport('List');
  report.dataSources.push({ id: 'd', name: 'Rows', kind: 'json', data: rows });
  report.dataMember = { dataSourceId: 'd' };
  report.bands[0].controls.push({ id: 'title', type: 'text', x: 0, y: 0, width: 100, height: 8, text: 'Title' });
  report.bands[1].controls.push({ id: 'name', type: 'text', x: 0, y: 1, width: 100, height: 6, text: { expression: '[Name]' } });
  report.bands[2].controls.push({ id: 'page', type: 'pageInfo', x: 140, y: 2, width: 40, height: 6, info: 'pageNofM' });
  return report;
}

describe('layout engine', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('measures Turkish text and has a glyph for ₺', () => {
    const font = fonts.resolve('Noto Sans');
    expect(font.hasGlyph('₺'.codePointAt(0)!)).toBeTrue();
    expect(font.widthOf('İŞĞÜÇÖ', 10)).toBeGreaterThan(font.widthOf('ISGUCO', 10) - 0.01);
    expect(font.widthOf('ab', 10)).toBeCloseTo(font.widthOf('a', 10) + font.widthOf('b', 10), 6);
    expect(fonts.resolve('Unknown family', true).variant).toBe('bold');
    // The bundled fonts are padded so pdf-lib can subset them (see LoadedFont.safeToSubset).
    expect(fonts.allFaces().every((f) => f.safeToSubset)).toBeTrue();
  });

  it('wraps on words, keeps newlines and splits words longer than a line', () => {
    const font = fonts.resolve('Noto Sans');
    const lines = wrapText('alpha beta gamma\nDelta', font, 10, font.widthOf('alpha beta', 10) + 0.01);
    expect(lines).toEqual(['alpha beta', 'gamma', 'Delta']);
    const long = wrapText('Supercalifragilistic', font, 10, font.widthOf('Supercal', 10) + 0.01);
    expect(long.join('')).toBe('Supercalifragilistic');
    expect(long.length).toBeGreaterThan(1);
  });

  it('paginates a list with page headers, footers and page X / Y', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ Name: `Row ${i + 1}` }));
    const doc = layoutReport(listReport(rows), { fonts, now: NOW });
    // A4 content 267 mm − 10 mm footer, detail starts at 15 mm: 30 rows of 8 mm per page.
    expect(doc.pages.length).toBe(4);
    expect(texts(doc.pages[0])).toEqual(['Title', ...rows.slice(0, 30).map((r) => r.Name), '1 / 4']);
    expect(texts(doc.pages[3]).slice(-2)).toEqual(['Row 100', '4 / 4']);
    expect(doc.pages[0].width).toBe(210);
    expect(doc.problems).toEqual([]);
  });

  it('positions text at its baseline inside the padded box, with right alignment', () => {
    const report = listReport([{ Name: 'Total' }]);
    report.bands[1].controls[0].styleOverrides = { textAlign: 'right' };
    const doc = layoutReport(report, { fonts, now: NOW });
    const item = doc.pages[0].items.find((i): i is TextItem => i.kind === 'text' && i.lines[0]?.text === 'Total')!;
    const line = item.lines[0];
    const pad = 0.5;
    expect(line.x + line.width).toBeCloseTo(15 + 100 - pad, 6);
    expect(item.y).toBeCloseTo(15 + 15 + 1, 6); // margin + page header + control y
    expect(line.baseline).toBeCloseTo(item.y + pad + fonts.resolve('Noto Sans').ascent(10), 6);
  });

  it('grows a band for long text when canGrow is set', () => {
    const report = listReport([{ Name: 'word '.repeat(80) }, { Name: 'next' }]);
    const name = report.bands[1].controls[0];
    if (name.type === 'text') name.canGrow = true;
    const doc = layoutReport(report, { fonts, now: NOW });
    const items = doc.pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const grown = items[1];
    const next = items[2];
    expect(grown.lines.length).toBeGreaterThan(3);
    expect(next.y).toBeCloseTo(grown.y + grown.height + 1, 6); // band = control y (1) + grown height; next control at y 1
  });

  it('groups, sorts groups and aggregates in group footers', () => {
    const report = listReport([
      { Name: 'Tea', Cat: 'Drinks', Price: 10 },
      { Name: 'Apple', Cat: 'Fruit', Price: 3 },
      { Name: 'Coffee', Cat: 'Drinks', Price: 20 },
    ]);
    const header: Band = { id: 'gh', kind: 'groupHeader', height: 8, groupBy: { expression: '[Cat]' }, controls: [
      { id: 'cat', type: 'text', x: 0, y: 0, width: 80, height: 8, text: { expression: '[Cat]' } },
    ] };
    const footer: Band = { id: 'gf', kind: 'groupFooter', groupHeaderId: 'gh', height: 8, controls: [
      { id: 'sum', type: 'text', x: 0, y: 0, width: 80, height: 8, text: { expression: "'Sum: ' + Sum([Price])" } },
    ] };
    report.bands.splice(1, 0, header);
    report.bands.splice(3, 0, footer);
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(texts(doc.pages[0])).toEqual(['Title', 'Drinks', 'Tea', 'Coffee', 'Sum: 30', 'Fruit', 'Apple', 'Sum: 3', '1 / 1']);
  });

  it('says when a box cuts text off, always showing at least one line', () => {
    const font = fonts.resolve(undefined);
    // A single line never counts as cut, even in a box shorter than the line.
    expect(fitLines('FATURA', font, 22, 0.8, 50, 6).cut).toBeFalse();
    const long = 'one two three four five six seven eight nine ten';
    expect(fitLines(long, font, 10, 0.8, 20, 6)).toEqual(jasmine.objectContaining({ cut: true }));
    expect(fitLines(long, font, 10, 0.8, 20, 6).lines.length).toBe(1);
    expect(fitLines(long, font, 10, 0.8, 200, 6).cut).toBeFalse();
  });

  it('pushes items below a growing text down instead of overlapping them', () => {
    const report = listReport([{ Name: 'A long name that wraps onto several lines in a narrow box', Price: 1 }]);
    const detail = report.bands.find((b) => b.kind === 'detail')!;
    detail.height = 14;
    detail.controls = [
      { id: 'name', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, text: { expression: '[Name]' } },
      { id: 'below', type: 'text', x: 0, y: 8, width: 20, height: 6, text: 'Below' },
      { id: 'beside', type: 'text', x: 30, y: 8, width: 20, height: 6, text: 'Beside' },
    ];
    const doc = layoutReport(report, { fonts, now: NOW });
    const items = doc.pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const name = items.find((t) => t.lines[0]?.text.startsWith('A long'))!;
    const below = items.find((t) => t.lines[0]?.text === 'Below')!;
    const beside = items.find((t) => t.lines[0]?.text === 'Beside')!;
    expect(below.y).toBeCloseTo(name.y + name.height + 2, 5); // the 2 mm gap is kept
    expect(beside.y).toBeCloseTo(name.y + 8, 5); // other columns stay put
  });

  it('also pushes an item dropped slightly into the growing text, but not one beside it', () => {
    const report = listReport([{ Name: 'A long name that wraps onto several lines in a narrow box', Price: 1 }]);
    const detail = report.bands.find((b) => b.kind === 'detail')!;
    detail.height = 14;
    detail.controls = [
      { id: 'name', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, text: { expression: '[Name]' } },
      { id: 'overlap', type: 'text', x: 0, y: 5.6, width: 20, height: 6, text: 'Overlap' },
      { id: 'side', type: 'text', x: 10, y: 0, width: 20, height: 6, text: 'Side' },
    ];
    const items = layoutReport(report, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const name = items.find((t) => t.lines[0]?.text.startsWith('A long'))!;
    const overlap = items.find((t) => t.lines[0]?.text === 'Overlap')!;
    const side = items.find((t) => t.lines[0]?.text === 'Side')!;
    expect(overlap.y).toBeCloseTo(name.y + name.height - 0.4, 5);
    expect(side.y).toBeCloseTo(name.y, 5);
  });

  it('numbers rows per group, the same on every run', () => {
    const rows = [{ Name: 'a', G: 1 }, { Name: 'b', G: 1 }, { Name: 'c', G: 2 }];
    const report = listReport(rows);
    report.bands.splice(1, 0, { id: 'gh', kind: 'groupHeader', height: 8, groupBy: { expression: '[G]' }, controls: [] });
    report.bands.find((b) => b.kind === 'detail')!.controls = [{ id: 'n', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "RowNumber() + '. ' + [Name]" } }];
    const run = () => texts(layoutReport(report, { fonts, data: rows, now: NOW }).pages[0]).filter((t) => /^\d\./.test(t));
    expect(run()).toEqual(['1. a', '2. b', '1. c']);
    rows.push({ Name: 'd', G: 2 });
    expect(run()).toEqual(['1. a', '2. b', '1. c', '2. d']);
  });

  it('carries a push on down: an item pushed by one pushes the next', () => {
    const report = listReport([{ Name: 'A long name that wraps onto several lines in a narrow box', Price: 1 }]);
    const detail = report.bands.find((b) => b.kind === 'detail')!;
    detail.height = 20;
    detail.controls = [
      { id: 'a', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, text: { expression: '[Name]' } },
      { id: 'b', type: 'text', x: 0, y: 7, width: 20, height: 6, text: 'B' },
      { id: 'c', type: 'text', x: 10, y: 14, width: 20, height: 6, text: 'C' },
    ];
    const items = layoutReport(report, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const a = items.find((t) => t.lines[0]?.text.startsWith('A long'))!;
    const b = items.find((t) => t.lines[0]?.text === 'B')!;
    const c = items.find((t) => t.lines[0]?.text === 'C')!;
    expect(b.y).toBeCloseTo(a.y + a.height + 1, 5);
    expect(c.y).toBeCloseTo(b.y + 7, 5);
  });

  it('stretches marked items to the bottom of a grown section', () => {
    const report = listReport([{ Name: 'A long name that wraps onto several lines in a narrow box', Price: 1 }]);
    const detail = report.bands.find((b) => b.kind === 'detail')!;
    detail.controls = [
      { id: 'name', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, text: { expression: '[Name]' } },
      { id: 'box', type: 'shape', shape: 'rectangle', x: 20, y: 0, width: 10, height: 6, stretch: true },
      { id: 'fixed', type: 'shape', shape: 'rectangle', x: 30, y: 0, width: 10, height: 6 },
    ];
    const doc = layoutReport(report, { fonts, now: NOW });
    const rects = doc.pages[0].items.filter((i) => i.kind === 'rect') as { height: number }[];
    expect(rects[0].height).toBeGreaterThan(12);
    expect(rects[1].height).toBe(6);

    // A section that does not grow leaves stretching items at their own size.
    detail.controls[0] = { id: 'name', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, text: 'Short' };
    detail.height = 10;
    const still = layoutReport(report, { fonts, now: NOW }).pages[0].items.filter((i) => i.kind === 'rect') as { height: number }[];
    expect(still[0].height).toBe(6);

    // A stretching text that grows itself also moves its stretching neighbours.
    detail.height = 6;
    detail.controls = [
      { id: 'name', type: 'text', x: 0, y: 0, width: 20, height: 6, canGrow: true, stretch: true, text: { expression: '[Name]' } },
      { id: 'box', type: 'shape', shape: 'rectangle', x: 20, y: 0, width: 10, height: 6, stretch: true },
    ];
    const both = layoutReport(report, { fonts, now: NOW }).pages[0];
    const grown = both.items.find((i): i is TextItem => i.kind === 'text' && i.lines.length > 1)!;
    const box = both.items.find((i) => i.kind === 'rect') as { height: number };
    expect(box.height).toBeCloseTo(grown.height, 5);
  });

  it('sorts detail rows inside their group', () => {
    const report = listReport([
      { Name: 'Tea', Cat: 'Drinks', Price: 10 },
      { Name: 'Apple', Cat: 'Fruit', Price: 3 },
      { Name: 'Coffee', Cat: 'Drinks', Price: 20 },
      { Name: 'Water', Cat: 'Drinks', Price: 1 },
    ]);
    report.bands.splice(1, 0, { id: 'gh', kind: 'groupHeader', height: 8, groupBy: { expression: '[Cat]' }, controls: [] });
    report.bands.find((b) => b.kind === 'detail')!.sortBy = [{ expression: '[Price]', descending: true }];
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(texts(doc.pages[0])).toEqual(['Title', 'Coffee', 'Tea', 'Water', 'Apple', '1 / 1']);

    // A malformed sort from a hand-edited file is ignored instead of failing the report.
    (report.bands.find((b) => b.kind === 'detail') as { sortBy: unknown }).sortBy = [{}];
    expect(layoutReport(report, { fonts, now: NOW }).pages.length).toBe(1);
  });

  it('keeps a group together and repeats its header on following pages', () => {
    const rows = [
      ...Array.from({ length: 25 }, (_, i) => ({ Name: `A${i}`, G: 'A' })),
      ...Array.from({ length: 10 }, (_, i) => ({ Name: `B${i}`, G: 'B' })),
      ...Array.from({ length: 40 }, (_, i) => ({ Name: `C${i}`, G: 'C' })),
    ];
    const report = listReport(rows);
    report.bands.splice(1, 0, {
      id: 'gh', kind: 'groupHeader', height: 8, groupBy: { expression: '[G]' }, keepTogether: true, repeatOnEveryPage: true,
      controls: [{ id: 'g', type: 'text', x: 0, y: 0, width: 50, height: 8, text: { expression: "'Group ' + [G]" } }],
    });
    const doc = layoutReport(report, { fonts, now: NOW });
    const [p1, p2, p3] = doc.pages.map(texts);
    expect(p1).toContain('A24');
    expect(p1).not.toContain('Group B'); // 10 rows of B do not fit after A: moved as a whole
    expect(p2.slice(0, 2)).toEqual(['Title', 'Group B']);
    expect(p3.slice(0, 2)).toEqual(['Title', 'Group C']); // C spans pages: its header repeats
    expect(p3).not.toContain('Group B');
  });

  it('makes thermal rolls one page as tall as the content', () => {
    const report = listReport([{ Name: 'a' }, { Name: 'b' }]);
    report.page = { ...report.page, paper: 'Thermal80', margins: { top: 2, right: 2, bottom: 2, left: 2 } };
    report.bands[1].controls[0].width = 70;
    report.bands[2].controls[0] = { ...report.bands[2].controls[0], x: 30 };
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(doc.pages.length).toBe(1);
    expect(doc.pages[0].height).toBeCloseTo(2 + 15 + 8 * 2 + 10 + 2, 6);
  });

  it('reports broken expressions and barcodes without aborting', () => {
    const report = listReport([{ Name: 'x' }]);
    report.bands[1].controls.push(
      { id: 'bad', type: 'text', x: 0, y: 0, width: 20, height: 6, text: { expression: '[Name] +' } },
      { id: 'ean', type: 'barcode', x: 0, y: 0, width: 40, height: 15, symbology: 'ean13', value: '2900000000011', showText: true },
      { id: 'qr', type: 'barcode', x: 50, y: 0, width: 40, height: 15, symbology: 'qrcode', value: 'hello', showText: false },
    );
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(texts(doc.pages[0])).toContain('#ERR');
    expect(doc.problems.map((p) => [p.code, p.controlId])).toEqual([
      ['expression', 'bad'],
      ['barcode', 'ean'],
    ]);
    const qr = doc.pages[0].items.find((i) => i.kind === 'path')!;
    expect(qr.width).toBeCloseTo(15, 6); // square inside a 40×15 box
    expect(qr.x).toBeCloseTo(15 + 50 + 12.5, 6);
    expect(qr.kind === 'path' && qr.paths.every((p) => p.fill === '#1f2328')).toBeTrue();
  });

  it('prints the detail band once when the report has no data', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 'd', type: 'text', x: 0, y: 0, width: 50, height: 6, text: { expression: "Format(Today(), 'dd.MM.yyyy')" } });
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(texts(doc.pages[0])).toEqual(['19.10.2026']);
  });

  it('renders a valid PDF with subset fonts', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ Name: `Satır ${i + 1} — ₺ İğüşöç` }));
    const report = listReport(rows);
    report.bands[1].controls.push({ id: 'qr', type: 'barcode', x: 120, y: 0, width: 8, height: 8, symbology: 'qrcode', value: 'x', showText: false });
    const doc = layoutReport(report, { fonts, now: NOW });
    const bytes = await renderPdf(doc, fonts, { title: 'Test', date: NOW });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(doc.pages.length);
    expect(loaded.getTitle()).toBe('Test');
    expect(bytes.length).toBeLessThan(120_000);
  });

  it('applies conditional formatting only to the rows whose rule is true', () => {
    const report = listReport([{ Name: 'a', Amount: 5 }, { Name: 'b', Amount: -3 }]);
    report.bands[1].controls[0].formatting = [{ when: '[Amount] < 0', style: { color: '#dc2626', bold: true } }];
    const doc = layoutReport(report, { fonts, now: NOW });
    const rows = doc.pages[0].items.filter((i): i is TextItem => i.kind === 'text' && (i.lines[0]?.text === 'a' || i.lines[0]?.text === 'b'));
    expect(rows.map((r) => [r.lines[0].text, r.color, r.bold])).toEqual([
      ['a', '#1f2328', false],
      ['b', '#dc2626', true],
    ]);
  });

  it('groups chart rows by category and aggregates the values', () => {
    const report = listReport([
      { Name: 'x', City: 'Ankara', Amount: 10 },
      { Name: 'y', City: 'İzmir', Amount: 5 },
      { Name: 'z', City: 'Ankara', Amount: 20 },
    ]);
    report.bands[0].height = 60;
    report.bands[0].controls.push({
      id: 'chart', type: 'chart', chartType: 'column', x: 0, y: 10, width: 120, height: 50,
      category: { expression: '[City]' }, value: { expression: '[Amount]' }, showValues: true,
    });
    report.bands.splice(1, 0, { id: 'rh', kind: 'reportHeader', height: 60, controls: [report.bands[0].controls.pop()!] });
    const items = layoutReport(report, { fonts, now: NOW }).pages[0].items;
    const bars = items.filter((i): i is RectItem => i.kind === 'rect' && !!i.fill);
    expect(bars.length).toBe(2);
    // Ankara (10 + 20) is six times İzmir (5) — same baseline, so heights compare directly.
    expect(bars[0].height / bars[1].height).toBeCloseTo(6, 5);
    const labels = items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0]?.text);
    expect(labels).toEqual(jasmine.arrayContaining(['Ankara', 'İzmir', '30', '5']));

    (report.bands[1].controls[0] as ChartControl).chartType = 'pie';
    const pie = layoutReport(report, { fonts, now: NOW }).pages[0].items.find((i): i is PathItem => i.kind === 'path')!;
    expect(pie.paths.length).toBe(2);
  });

  it('picks round chart axes that include zero', () => {
    expect(niceScale(3, 97)).toEqual({ min: 0, max: 100, step: 20 });
    expect(niceScale(-12, 40)).toEqual({ min: -20, max: 40, step: 20 });
    expect(niceScale(0, 0).max).toBeGreaterThan(0);
  });

  it('draws the watermark behind the content of every page, centred on the page', () => {
    const report = listReport(Array.from({ length: 40 }, (_, i) => ({ Name: `Row ${i}`, Paid: true })));
    report.watermark = { text: { expression: "Iif([Paid], 'PAID', '')" } };
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(doc.pages.length).toBe(2);
    for (const page of doc.pages) {
      const mark = page.items[0] as PathItem;
      expect(mark.kind).toBe('path');
      const nums = mark.paths[0].d.match(/-?[\d.]+/g)!.map(Number);
      const xs = nums.filter((_, k) => k % 2 === 0);
      const ys = nums.filter((_, k) => k % 2 === 1);
      // Rotated 45°, the text is centred on the page (on its advance width, so within the side bearings).
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(105, -1);
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(148.5, -1);
    }
    report.watermark.text = '';
    expect(layoutReport(report, { fonts, now: NOW }).pages[0].items[0].kind).not.toBe('path');
  });

  it('renders charts and a watermark to a valid PDF', async () => {
    const report = listReport([{ Name: 'a', City: 'X', Amount: 3 }, { Name: 'b', City: 'Y', Amount: 4 }]);
    report.watermark = { text: 'DRAFT' };
    report.bands.splice(1, 0, {
      id: 'rh', kind: 'reportHeader', height: 50,
      controls: (['column', 'bar', 'line', 'doughnut'] as const).map((chartType, i) => ({
        id: `c${i}`, type: 'chart' as const, chartType, x: i * 45, y: 0, width: 44, height: 45,
        category: { expression: '[City]' }, value: { expression: '[Amount]' }, showValues: true, title: chartType,
      })),
    });
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(doc.problems).toEqual([]);
    const pdf = await PDFDocument.load(await renderPdf(doc, fonts, { title: 'Charts', date: NOW }));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('formats with the region and currency of the report over those of the host', () => {
    const report = listReport([{ Name: 'a', Amount: 1234.5 }]);
    report.bands[1].controls[0] = { id: 'amt', type: 'text', x: 0, y: 0, width: 60, height: 6, text: { expression: '[Amount]' }, format: 'c2' };
    const text = (r: ReportDefinition) =>
      layoutReport(r, { fonts, now: NOW, locale: 'en-US', currency: 'USD' }).pages[0].items.filter((i): i is TextItem => i.kind === 'text').map((t) => t.lines[0]?.text);
    expect(text(report)).toContain('$1,234.50');
    report.locale = 'de-DE';
    report.currency = 'EUR';
    expect(text(report).some((t) => /^1\.234,50\s€$/.test(t))).toBeTrue();
  });

  it('prints a label sheet: labels across, then down, then on the next sheet', () => {
    const report = listReport(Array.from({ length: 25 }, (_, i) => ({ Name: `L${i + 1}` })));
    const sheet = LABEL_SHEETS.find((l) => l.id === 'L7160')!;
    applyLabelSheet(report, sheet);
    expect(report.bands.map((b) => b.kind)).toEqual(['detail']);
    expect(report.page.margins).toEqual({ top: 15.15, left: 7.21, right: 7.21, bottom: 15.15 });
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(doc.pages.length).toBe(2);
    const labels = (page: LayoutPage) => page.items.filter((i): i is TextItem => i.kind === 'text');
    const first = labels(doc.pages[0]);
    expect(first.length).toBe(21);
    const at = (n: string) => first.find((t) => t.lines[0].text === n)!;
    expect(at('L1').x).toBeCloseTo(7.21, 5);
    expect(at('L2').x).toBeCloseTo(7.21 + 63.5 + 2.54, 5);
    expect(at('L4').x).toBeCloseTo(7.21, 5);
    expect(at('L4').y - at('L1').y).toBeCloseTo(38.1, 5);
    expect(at('L21').y - at('L1').y).toBeCloseTo(6 * 38.1, 5);
    expect(labels(doc.pages[1]).map((t) => t.lines[0].text)).toEqual(['L22', 'L23', 'L24', 'L25']);
  });

  it('starts the section after a multi-column detail below its last, unfinished row', () => {
    const report = listReport([{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }]);
    report.bands[1].columns = { count: 2 };
    report.bands.splice(2, 0, { id: 'rf', kind: 'reportFooter', height: 6, controls: [{ id: 'end', type: 'text', x: 0, y: 0, width: 50, height: 6, text: 'END' }] });
    const items = layoutReport(report, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const y = (n: string) => items.find((t) => t.lines[0]?.text === n)!.y;
    expect(y('b')).toBeCloseTo(y('a'), 5);
    expect(y('c') - y('a')).toBeCloseTo(8, 5);
    // The row is 8 mm with its text 1 mm down; the footer's text sits at its top.
    expect(y('END') - y('c')).toBeCloseTo(7, 5);
  });

  it('stretches barcode bars to the box but keeps the digits in shape', () => {
    const textBox = (box: { x: number; y: number; width: number; height: number }) => {
      const item = barcodeItem('code128', '29001000', true, box, '#000000');
      const nums = item.paths.filter((p) => !p.stroke).flatMap((p) => p.d.match(/-?[\d.]+/g)!.map(Number));
      const xs = nums.filter((_, k) => k % 2 === 0);
      const ys = nums.filter((_, k) => k % 2 === 1);
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), item };
    };
    const natural = textBox({ x: 0, y: 0, width: 40, height: 20 });
    const wide = textBox({ x: 0, y: 0, width: 57.5, height: 14 });
    expect(wide.w / wide.h).toBeCloseTo(natural.w / natural.h, 1);
    expect(wide.right).toBeLessThanOrEqual(57.5);
    expect(wide.bottom).toBeLessThanOrEqual(14.001);
    expect(wide.item.width).toBe(57.5);
    // Text above the bars (ISBN) stays inside the box too.
    const isbn = barcodeItem('isbn', '978-1-56581-231-4', true, { x: 0, y: 0, width: 40, height: 30 }, '#000000');
    const isbnYs = isbn.paths.flatMap((p) => p.d.match(/-?[\d.]+/g)!.map(Number).filter((_, k) => k % 2 === 1));
    expect(Math.min(...isbnYs)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.max(...isbnYs)).toBeLessThanOrEqual(30.01);
    // The bars stop clearly above the digits.
    const barYs = wide.item.paths.filter((p) => p.stroke).flatMap((p) => p.d.match(/-?[\d.]+/g)!.map(Number).filter((_, k) => k % 2 === 1));
    expect(Math.max(...barYs)).toBeLessThan(wide.bottom - wide.h - wide.h * 0.2);
  });

  it('lays out a table: columns, spans, data cells, growing rows and a border grid', () => {
    const report = listReport([{ Name: 'Kuşadası çok uzun bir ürün adı ki iki satıra sığmaz ve büyümesi gerekir', Qty: 3 }]);
    report.bands[1].controls[0] = {
      id: 't', type: 'table', x: 5, y: 0, width: 90, height: 12, columns: [20, 30, 40], canGrow: true,
      styleOverrides: { border: { width: 0.2, color: '#000000', sides: { top: true, right: true, bottom: true, left: true } } },
      rows: [
        { height: 6, cells: [{ text: 'Head', colSpan: 2 }, { text: 'Qty' }] },
        { height: 6, cells: [{ text: 'A' }, { text: { expression: '[Name]' } }, { text: { expression: '[Qty]' }, format: 'n2' }] },
      ],
    };
    const items = layoutReport(report, { fonts, now: NOW }).pages[0].items;
    const texts = items.filter((i): i is TextItem => i.kind === 'text');
    const cell = (t: string) => texts.find((x) => x.lines[0]?.text.startsWith(t))!;
    expect([cell('Head').x, cell('Head').width]).toEqual([20, 50]); // margin 15 + x 5; spans 20 + 30
    expect([cell('Qty').x, cell('Qty').width]).toEqual([70, 40]);
    expect(cell('3.00').x).toBe(70);
    const name = cell('Kuşadası');
    expect(name.lines.length).toBeGreaterThan(1);
    // The grown row is as tall as the long name, and every cell of the row shares that height.
    expect(cell('A').height).toBeCloseTo(name.height, 5);
    expect(name.height).toBeGreaterThan(6);
    expect(cell('A').y - cell('Head').y).toBeCloseTo(6, 5);
    // Four border lines per cell: the table border is the grid.
    expect(items.filter((i) => i.kind === 'line').length).toBe(5 * 4);
  });

  it('prints an inner list under every row, with its own header, footer and totals', () => {
    const report = listReport([
      { Name: 'Ayşe', orders: [{ no: 1, amount: 10 }, { no: 2, amount: 15 }] },
      { Name: 'Bora', orders: [] },
      { Name: 'Cem', orders: [{ no: 3, amount: 7 }] },
    ]);
    const text = (id: string, expression: string) => ({ id, type: 'text' as const, x: 0, y: 0, width: 80, height: 5, text: { expression } });
    report.bands.splice(2, 0,
      { id: 'sh', kind: 'subHeader', height: 5, controls: [text('sh1', "'Orders of ' + [^.Name]")] },
      { id: 'sd', kind: 'subDetail', height: 5, rowsPath: 'orders', controls: [text('sd1', "[^.Name] + ' #' + [no] + ' ' + [amount]")] },
      { id: 'sf', kind: 'subFooter', height: 5, controls: [text('sf1', "'Total ' + Sum([amount]) + ' in ' + Count()")] },
    );
    const doc = layoutReport(report, { fonts, now: NOW });
    expect(doc.problems).toEqual([]);
    expect(texts(doc.pages[0]).slice(1, -1)).toEqual([
      'Ayşe', 'Orders of Ayşe', 'Ayşe #1 10', 'Ayşe #2 15', 'Total 25 in 2',
      'Bora',
      'Cem', 'Orders of Cem', 'Cem #3 7', 'Total 7 in 1',
    ]);
    // Inner fields are judged against the item, `^.` against the row around it.
    expect(checkReport(report, ['Name', 'orders'], [], [], ['no', 'amount']).filter((i) => i.code === 'unknownField')).toEqual([]);
    expect(checkReport(report, ['Name'], [], [], ['no']).map((i) => i.detail)).toContain('amount');
  });

  it('reads [^.field] from the parent the host passes (a sub-report previewed on its own)', () => {
    const report = listReport([{ Name: 'Ayşe' }]);
    report.bands[1].controls[0] = { id: 'n', type: 'text', x: 0, y: 0, width: 80, height: 5, text: { expression: "[Name] + ' / ' + [^.city]" } };
    expect(texts(layoutReport(report, { fonts, now: NOW, parent: { city: 'İzmir' } }).pages[0])).toContain('Ayşe / İzmir');
  });

  it('fits exactly rows × columns labels on every sheet layout', () => {
    for (const sheet of LABEL_SHEETS) {
      const per = sheet.rows * sheet.columns;
      const report = listReport(Array.from({ length: per + 1 }, (_, i) => ({ Name: `L${i}` })));
      applyLabelSheet(report, sheet);
      const doc = layoutReport(report, { fonts, now: NOW });
      expect(doc.pages.map((p) => texts(p).length)).withContext(sheet.id).toEqual([per, 1]);
    }
  });

  it('keeps groups when a label sheet is applied and warns about items wider than a label', () => {
    const report = listReport([{ Name: 'a' }]);
    report.bands.splice(1, 0, { id: 'g', kind: 'groupHeader', height: 5, groupBy: { expression: '[Name]' }, controls: [] });
    applyLabelSheet(report, LABEL_SHEETS[0]);
    expect(report.bands.map((b) => b.kind)).toEqual(['groupHeader', 'detail']);
    const detail = report.bands[1];
    detail.controls[0].width = 70; // the label is 63.5 mm wide
    expect(checkReport(report).map((i) => i.code)).toContain('outsideColumn');
  });

  it('moves an inner list header to the next page together with its first item', () => {
    // 30 rows of 8 mm leave 2 mm of the page body: room for the 1.5 mm header, not for its item.
    const rows: Record<string, unknown>[] = Array.from({ length: 29 }, (_, i) => ({ Name: `R${i}`, items: [] }));
    rows.push({ Name: 'Last', items: [{ v: 1 }] });
    const report = listReport(rows);
    const text = (id: string, expression: string, height = 4) => ({ id, type: 'text' as const, x: 0, y: 0, width: 50, height, text: { expression } });
    report.bands.splice(2, 0,
      { id: 'sh', kind: 'subHeader', height: 1.5, controls: [text('h', "'HEAD'", 1.5)] },
      { id: 'sd', kind: 'subDetail', height: 4, rowsPath: 'items', controls: [text('d', "'ITEM ' + [v]")] },
    );
    const doc = layoutReport(report, { fonts, now: NOW });
    const second = texts(doc.pages[1]);
    expect(texts(doc.pages[0])).not.toContain('HEAD');
    expect(second.slice(1, 3)).toEqual(['HEAD', 'ITEM 1']);
  });

  it('exports table cells of the detail band as spreadsheet columns', () => {
    const report = listReport([{ Name: 'a', Qty: 2 }]);
    report.bands[0].controls = [{ id: 'th', type: 'table', x: 0, y: 0, width: 60, height: 6, columns: [30, 30], rows: [{ height: 6, cells: [{ text: 'Name' }, { text: 'Qty' }] }] }];
    report.bands[1].controls = [{ id: 'td', type: 'table', x: 0, y: 0, width: 60, height: 6, columns: [30, 30], rows: [{ height: 6, cells: [{ text: { expression: '[Name]' } }, { text: { expression: '[Qty]' }, format: 'n0' }] }] }];
    const table = reportTable(report, { now: NOW });
    expect(table.headers).toEqual(['Name', 'Qty']);
    expect(table.rows).toEqual([['a', 2]]);
  });
});
