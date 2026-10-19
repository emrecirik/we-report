import { PAPER_SIZES } from '../paper-sizes';
import { ReportDefinition } from './report-definition';

/** A sheet of sticky labels: where the first label sits and how labels repeat. Millimetres. */
export interface LabelSheet {
  id: string;
  paper: 'A4' | 'Letter';
  columns: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  /** Distance from the paper's top/left edge to the first label. */
  top: number;
  left: number;
  /** Space between labels across / down. */
  gapX: number;
  gapY: number;
}

/** Common sheet layouts; the id carries the widely used product code for the layout. */
export const LABEL_SHEETS: readonly LabelSheet[] = [
  { id: 'L7160', paper: 'A4', columns: 3, rows: 7, labelWidth: 63.5, labelHeight: 38.1, top: 15.15, left: 7.21, gapX: 2.54, gapY: 0 },
  { id: 'L7159', paper: 'A4', columns: 3, rows: 8, labelWidth: 63.5, labelHeight: 33.9, top: 12.9, left: 6.47, gapX: 2.54, gapY: 0 },
  { id: '3474', paper: 'A4', columns: 3, rows: 8, labelWidth: 70, labelHeight: 37, top: 0.5, left: 0, gapX: 0, gapY: 0 },
  { id: 'L7163', paper: 'A4', columns: 2, rows: 7, labelWidth: 99.1, labelHeight: 38.1, top: 15.15, left: 4.65, gapX: 2.54, gapY: 0 },
  { id: 'L7165', paper: 'A4', columns: 2, rows: 4, labelWidth: 99.1, labelHeight: 67.7, top: 13.1, left: 4.65, gapX: 2.54, gapY: 0 },
  { id: 'L7651', paper: 'A4', columns: 5, rows: 13, labelWidth: 38.1, labelHeight: 21.2, top: 10.7, left: 4.75, gapX: 2.54, gapY: 0 },
  { id: '5160', paper: 'Letter', columns: 3, rows: 10, labelWidth: 66.7, labelHeight: 25.4, top: 12.7, left: 4.76, gapX: 3.18, gapY: 0 },
  { id: '5163', paper: 'Letter', columns: 2, rows: 5, labelWidth: 101.6, labelHeight: 50.8, top: 12.7, left: 4.76, gapX: 3.18, gapY: 0 },
];

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Turns a report into a label sheet: paper and margins so the detail section is exactly one label,
 * repeated across in `columns`. Page and report headers/footers are removed (labels have none);
 * the detail section and its contents are kept. Mutates `def`.
 */
export function applyLabelSheet(def: ReportDefinition, sheet: LabelSheet): void {
  const paper = PAPER_SIZES.find((p) => p.id === sheet.paper)!;
  const usedWidth = sheet.columns * sheet.labelWidth + (sheet.columns - 1) * sheet.gapX;
  const usedHeight = sheet.rows * (sheet.labelHeight + sheet.gapY);
  def.page = {
    ...def.page,
    paper: sheet.paper,
    orientation: 'portrait',
    margins: {
      top: sheet.top,
      left: sheet.left,
      right: round(Math.max(0, paper.width - sheet.left - usedWidth)),
      bottom: round(Math.max(0, paper.height! - sheet.top - usedHeight)),
    },
  };
  const detail = def.bands.find((b) => b.kind === 'detail') ?? { id: 'detail', kind: 'detail' as const, height: 0, controls: [] };
  detail.height = round(sheet.labelHeight + sheet.gapY);
  detail.columns = { count: sheet.columns, gap: sheet.gapX };
  def.bands = [detail];
}
