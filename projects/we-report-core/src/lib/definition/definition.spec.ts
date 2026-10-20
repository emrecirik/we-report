import { createBlankReport } from './blank-report';
import { DefinitionVersionError, migrateDefinition } from './migrations';
import { resolvePageGeometry } from './page';
import { CURRENT_DEFINITION_VERSION, isExpression } from './report-definition';

describe('report definition', () => {
  it('creates a blank A4 report at the current version', () => {
    const report = createBlankReport('Invoice');
    expect(report.version).toBe(CURRENT_DEFINITION_VERSION);
    expect(report.page.paper).toBe('A4');
    expect(report.bands.map((b) => b.kind)).toEqual(['pageHeader', 'detail', 'pageFooter']);
    expect(report.styles['default']).toBeDefined();
  });

  it('survives a JSON round trip unchanged', () => {
    const report = createBlankReport();
    expect(migrateDefinition(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it('repairs a damaged file instead of breaking on it, and leaves the input alone', () => {
    const report = createBlankReport() as unknown as Record<string, unknown> & { bands: Record<string, unknown>[] };
    report['calculatedFields'] = 'x';
    report['parameters'] = {};
    report['styles'] = [1, 2];
    report['currency'] = 'true';
    report['locale'] = 'not a locale!';
    report['page'] = { paper: 'A4', margins: null };
    report.bands.push(null as unknown as Record<string, unknown>);
    report.bands[1]['visible'] = 5;
    report.bands[1]['controls'] = [
      { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 5, text: 12, format: 0, styleOverrides: { fontFamily: true, fontSize: 12 } },
      { id: 'b', type: 'chart', x: 0, y: 0, width: 10, height: 5, value: {}, category: [1, 2], colors: ['#000'] },
      { id: 'c', x: 0, y: 0 },
    ];
    const input = JSON.stringify(report);
    const fixed = migrateDefinition(JSON.parse(input)) as unknown as Record<string, unknown> & { bands: { controls: Record<string, unknown>[] }[] };
    expect(fixed['calculatedFields']).toEqual([]);
    expect(fixed['parameters']).toEqual([]);
    expect(fixed['styles']).toEqual({});
    expect(fixed['currency']).toBeUndefined();
    expect(fixed['locale']).toBeUndefined();
    expect((fixed['page'] as { margins: unknown }).margins).toEqual(createBlankReport().page.margins);
    expect(fixed.bands.length).toBe(3);
    expect('visible' in fixed.bands[1]).toBeFalse();
    const [text, chart] = fixed.bands[1].controls;
    expect(fixed.bands[1].controls.length).toBe(2); // the item without a type is gone
    expect(text).toEqual(jasmine.objectContaining({ text: '12', styleOverrides: { fontSize: 12 } }));
    expect('format' in text).toBeFalse();
    expect(chart).toEqual(jasmine.objectContaining({ value: { expression: '' }, category: { expression: '' }, colors: ['#000'] }));
    expect(JSON.stringify(report)).toBe(input);
  });

  it('rejects non-objects, missing versions and newer versions', () => {
    expect(() => migrateDefinition(null)).toThrowError(DefinitionVersionError);
    expect(() => migrateDefinition([])).toThrowError(DefinitionVersionError);
    expect(() => migrateDefinition({ name: 'x' })).toThrowError(DefinitionVersionError);
    expect(() => migrateDefinition({ version: CURRENT_DEFINITION_VERSION + 1 })).toThrowError(
      DefinitionVersionError,
      /newer/,
    );
  });

  it('recognises expressions', () => {
    expect(isExpression({ expression: '[Total]' })).toBeTrue();
    expect(isExpression('Total')).toBeFalse();
    expect(isExpression(null)).toBeFalse();
  });
});

describe('resolvePageGeometry', () => {
  const margins = { top: 10, right: 10, bottom: 10, left: 10 };

  it('swaps width and height for landscape', () => {
    const g = resolvePageGeometry({ paper: 'A4', orientation: 'landscape', margins, displayUnit: 'mm' });
    expect(g.width).toBe(297);
    expect(g.height).toBe(210);
    expect(g.contentWidth).toBe(277);
    expect(g.contentHeight).toBe(190);
  });

  it('keeps continuous thermal rolls unbounded and ignores landscape', () => {
    const g = resolvePageGeometry({ paper: 'Thermal80', orientation: 'landscape', margins, displayUnit: 'mm' });
    expect(g.width).toBe(80);
    expect(g.height).toBeNull();
    expect(g.contentHeight).toBeNull();
  });

  it('supports custom sizes and rejects invalid ones', () => {
    const custom = { paper: 'custom', orientation: 'portrait' as const, margins, displayUnit: 'mm' as const };
    expect(resolvePageGeometry({ ...custom, width: 100, height: 50 }).contentHeight).toBe(30);
    expect(() => resolvePageGeometry({ ...custom, width: 0 })).toThrow();
    expect(() => resolvePageGeometry({ ...custom, paper: 'A9' })).toThrow();
    expect(() => resolvePageGeometry({ ...custom, width: 15, height: 50 })).toThrow();
  });
});
