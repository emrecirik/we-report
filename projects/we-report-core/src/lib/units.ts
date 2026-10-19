/** Units a length can be expressed in. The report definition always stores millimetres. */
export type LengthUnit = 'mm' | 'cm' | 'in' | 'pt' | 'px';

const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  px: 25.4 / 96,
};

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return fromMm(toMm(value, from), to);
}

/** Definition lengths are kept at 0.01 mm precision so saved files stay stable. */
export function roundMm(mm: number): number {
  return Math.round(mm * 100) / 100;
}
