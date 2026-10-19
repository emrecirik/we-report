import { convertLength, fromMm, roundMm, toMm } from './units';

describe('units', () => {
  it('converts inches and points to millimetres', () => {
    expect(toMm(1, 'in')).toBe(25.4);
    expect(toMm(72, 'pt')).toBeCloseTo(25.4, 10);
    expect(toMm(96, 'px')).toBeCloseTo(25.4, 10);
    expect(toMm(2, 'cm')).toBe(20);
  });

  it('round-trips through every unit', () => {
    for (const unit of ['mm', 'cm', 'in', 'pt', 'px'] as const) {
      expect(toMm(fromMm(123.45, unit), unit)).toBeCloseTo(123.45, 10);
    }
  });

  it('converts A4 width to points', () => {
    expect(convertLength(210, 'mm', 'pt')).toBeCloseTo(595.28, 2);
  });

  it('rounds to 0.01 mm', () => {
    expect(roundMm(10.12345)).toBe(10.12);
    expect(roundMm(10.125001)).toBe(10.13);
  });
});
