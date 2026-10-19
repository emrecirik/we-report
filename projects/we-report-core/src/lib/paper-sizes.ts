export type PaperGroup = 'iso-a' | 'iso-b' | 'north-america' | 'envelope' | 'thermal' | 'card';

/** A paper size in portrait orientation, in millimetres. */
export interface PaperSize {
  id: string;
  group: PaperGroup;
  width: number;
  /** `null` for continuous media (thermal rolls): the page grows with its content. */
  height: number | null;
}

export const PAPER_SIZES: readonly PaperSize[] = [
  { id: 'A0', group: 'iso-a', width: 841, height: 1189 },
  { id: 'A1', group: 'iso-a', width: 594, height: 841 },
  { id: 'A2', group: 'iso-a', width: 420, height: 594 },
  { id: 'A3', group: 'iso-a', width: 297, height: 420 },
  { id: 'A4', group: 'iso-a', width: 210, height: 297 },
  { id: 'A5', group: 'iso-a', width: 148, height: 210 },
  { id: 'A6', group: 'iso-a', width: 105, height: 148 },
  { id: 'B4', group: 'iso-b', width: 250, height: 353 },
  { id: 'B5', group: 'iso-b', width: 176, height: 250 },
  { id: 'Letter', group: 'north-america', width: 215.9, height: 279.4 },
  { id: 'Legal', group: 'north-america', width: 215.9, height: 355.6 },
  { id: 'Tabloid', group: 'north-america', width: 279.4, height: 431.8 },
  { id: 'Executive', group: 'north-america', width: 184.15, height: 266.7 },
  { id: 'DL', group: 'envelope', width: 110, height: 220 },
  { id: 'C5', group: 'envelope', width: 162, height: 229 },
  { id: 'Envelope10', group: 'envelope', width: 104.78, height: 241.3 },
  { id: 'Thermal58', group: 'thermal', width: 58, height: null },
  { id: 'Thermal80', group: 'thermal', width: 80, height: null },
  { id: 'BusinessCard', group: 'card', width: 85, height: 55 },
];

export function findPaperSize(id: string): PaperSize | undefined {
  return PAPER_SIZES.find((p) => p.id === id);
}
