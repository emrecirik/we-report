import { createBlankReport } from '../definition/blank-report';
import { crc32, reportTable, storedZip, writeXlsx } from './xlsx';

/** Reads back a stored (uncompressed) zip: file name → text. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, string> = {};
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLength));
    const data = bytes.slice(p + 30 + nameLength, p + 30 + nameLength + size);
    expect(crc32(data)).toBe(view.getUint32(p + 14, true));
    out[name] = new TextDecoder().decode(data);
    p += 30 + nameLength + size;
  }
  return out;
}

describe('xlsx export', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('builds a table from the detail band with captions from the header above', () => {
    const report = createBlankReport();
    report.bands[0].controls.push(
      { id: 'h1', type: 'text', x: 0, y: 0, width: 40, height: 6, text: 'Ürün' },
      { id: 'h2', type: 'text', x: 100, y: 0, width: 30, height: 6, text: 'Tutar' },
    );
    report.bands[1].controls.push(
      { id: 'c2', type: 'text', x: 100, y: 0, width: 30, height: 6, text: { expression: '[qty] * [price]' }, format: 'n2' },
      { id: 'c1', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: '[name]' } },
      { id: 'c3', type: 'text', x: 140, y: 0, width: 30, height: 6, text: { expression: '[day]' }, format: 'dd.MM.yyyy' },
    );
    const table = reportTable(report, { data: [{ name: 'Çay <&>', qty: 2, price: 1.5, day: '2026-03-01' }], now: new Date(2026, 0, 1) });
    expect(table.headers).toEqual(['Ürün', 'Tutar', 'day']);
    expect(table.rows).toEqual([['Çay <&>', 3, '2026-03-01']]);
    expect(table.formats).toEqual([undefined, '#,##0.00', 'dd.mm.yyyy']);

    const files = unzip(writeXlsx(table, 'Satışlar'));
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<t xml:space="preserve">Çay &lt;&amp;&gt;</t>');
    expect(sheet).toContain('<c r="B2" s="2"><v>3</v></c>');
    expect(sheet).toContain('<v>46082</v>'); // 2026-03-01 as an Excel serial date
    expect(files['xl/workbook.xml']).toContain('name="Satışlar"');
  });

  it('leaves out the rows the detail section does not print', () => {
    const report = createBlankReport();
    report.bands[1].visible = { expression: '[qty] > 0' };
    report.bands[1].controls.push({ id: 'c1', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: '[name]' } });
    const table = reportTable(report, { data: [{ name: 'a', qty: 1 }, { name: 'b', qty: 0 }, { name: 'c', qty: 2 }], now: new Date(2026, 0, 1) });
    expect(table.rows).toEqual([['a'], ['c']]);
  });

  it('writes a valid empty archive structure', () => {
    const zip = storedZip([['a.txt', new TextEncoder().encode('hi')]]);
    expect(unzip(zip)).toEqual({ 'a.txt': 'hi' });
  });
});
