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
