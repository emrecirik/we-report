import { createBlankReport } from './blank-report';
import { checkReport } from './check';

describe('checkReport', () => {
  it('finds items outside the paper, broken and empty formulas, unknown fields and overlaps', () => {
    const report = createBlankReport();
    report.parameters = [{ name: 'from', type: 'date' }];
    report.bands[1].controls.push(
      { id: 'wide', type: 'text', x: 150, y: 0, width: 40, height: 6, text: 'x' }, // A4 content is 180 mm
      { id: 'broken', type: 'text', x: 0, y: 10, width: 20, height: 6, text: { expression: '[Price] *' } },
      { id: 'empty', type: 'barcode', x: 0, y: 20, width: 20, height: 6, symbology: 'qrcode', value: { expression: ' ' }, showText: false },
      { id: 'fields', type: 'text', x: 0, y: 30, width: 20, height: 6, text: { expression: "[Price] * [Qty] + [^.vat] + [?from] + [?to]" } },
      { id: 'a', type: 'text', x: 50, y: 40, width: 30, height: 6, text: 'a' },
      { id: 'b', type: 'text', x: 55, y: 41, width: 30, height: 6, text: 'b' },
    );
    const issues = checkReport(report, ['Price'], ['number']);
    expect(issues.map((i) => [i.code, i.controlId, i.detail ?? ''])).toEqual([
      ['outsidePage', 'wide', ''],
      ['formulaError', 'broken', 'Unexpected end of expression.'],
      ['emptyFormula', 'empty', ''],
      ['unknownField', 'fields', 'Qty'],
      ['unknownField', 'fields', '^.vat'],
      ['unknownField', 'fields', '?to'],
      ['overlap', 'b', 'a'],
    ]);
  });

  it('does not judge field names when the data is unknown', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 20, height: 6, text: { expression: '[Anything]' } });
    expect(checkReport(report)).toEqual([]);
  });
});
