import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from './engine';
import { TextItem } from './layout-types';
import { parseRichText, plainRichText, wrapRichText } from './rich-text';
import { reportTable } from '../render/xlsx';

const NOW = new Date(2026, 9, 19, 10, 0);
const plain = { bold: false, italic: false, underline: false };

describe('rich text', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  it('reads bold, italic, underline, fields and escapes', () => {
    const runs = parseRichText('Sayın **{[name]}**, *lütfen* __imzalayın__ \\*{{x}}', (e) => (e === '[name]' ? 'Ayşe **Kaya**' : '?'));
    expect(runs).toEqual([
      { text: 'Sayın ', ...plain },
      { text: 'Ayşe **Kaya**', ...plain, bold: true }, // a field value is never markup
      { text: ', ', ...plain },
      { text: 'lütfen', ...plain, italic: true },
      { text: ' ', ...plain },
      { text: 'imzalayın', ...plain, underline: true },
      { text: ' *{x}', ...plain },
    ]);
    expect(plainRichText(runs)).toBe('Sayın Ayşe **Kaya**, lütfen imzalayın *{x}');
    expect(parseRichText("{Iif(1, '}', 'x')} ok", (e) => e)).toEqual([{ text: "Iif(1, '}', 'x') ok", ...plain }]);
    expect(parseRichText('open {never closed', () => 'x')).toEqual([{ text: 'open {never closed', ...plain }]);
  });

  it('wraps like plain text, keeping a word whose style changes midway together', () => {
    const font = fonts.resolve('Noto Sans');
    const runs = parseRichText('alpha **be**ta gamma\nDelta', () => '');
    const max = font.widthOf('alpha ', 10) + fonts.resolve('Noto Sans', true).widthOf('be', 10) + font.widthOf('ta', 10) + 0.01;
    const lines = wrapRichText(runs, (r) => fonts.resolve('Noto Sans', r.bold), 10, max);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(''))).toEqual(['alpha beta', 'gamma', 'Delta']);
    expect(lines[0].segments.map((s) => [s.text, s.bold])).toEqual([['alpha ', false], ['be', true], ['ta', false]]);
  });

  it('exports the words of a rich text to spreadsheets', () => {
    const r = createBlankReport('List');
    r.dataSources = [{ id: 'd', name: 'Rows', kind: 'json', data: [{ name: 'Ayşe' }] }];
    r.dataMember = { dataSourceId: 'd' };
    r.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 60, height: 6, markup: true, text: 'Sayın **{[name]}**' });
    expect(reportTable(r, { now: NOW }).rows).toEqual([['Sayın Ayşe']]);
  });

  it('lays out styled pieces side by side and grows the box to fit', () => {
    const r = createBlankReport('Letter');
    r.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 60, height: 6, markup: true, canGrow: true, text: { expression: "'Dear **' + 'Ayşe' + '**, ' + 'word '" } });
    r.bands[1].controls.push({ id: 'long', type: 'text', x: 70, y: 0, width: 30, height: 6, markup: true, canGrow: true, text: 'one two three four five six seven eight nine ten' });
    const items = layoutReport(r, { fonts, now: NOW }).pages[0].items.filter((i): i is TextItem => i.kind === 'text');
    const dear = items.find((t) => t.lines[0].text === 'Dear ')!;
    const name = items.find((t) => t.lines[0].text === 'Ayşe')!;
    expect(name.bold).toBeTrue();
    expect(name.lines[0].x).toBeCloseTo(dear.lines[0].x + dear.lines[0].width, 5);
    expect(name.lines[0].baseline).toBe(dear.lines[0].baseline);
    const long = items.filter((t) => t.x === items.find((i) => i.lines[0].text.startsWith('one'))!.x);
    expect(new Set(long.map((t) => t.lines[0].baseline)).size).toBeGreaterThan(1);
    expect(long[0].height).toBeGreaterThan(6);
  });
});
