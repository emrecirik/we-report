import { PDFDocument } from 'pdf-lib';
import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { Band, ChartControl, ReportDefinition } from '../definition/report-definition';
import { FontRegistry } from '../fonts/font-registry';
import { renderPdf } from '../render/pdf';
import { layoutReport } from './engine';
import { LayoutPage, PathItem, RectItem, TextItem } from './layout-types';
import { niceScale } from './chart';
import { wrapText } from './text-wrap';

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
});
