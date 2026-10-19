import { TableControl, TableRow } from 'we-report-core';

/** A cell of a table control, addressed by row and position in that row's `cells`. */
export interface TableCellRef {
  controlId: string;
  row: number;
  cell: number;
}

const span = (c: { colSpan?: number }) => Math.max(1, c.colSpan ?? 1);

/** First column (0-based) covered by a cell. */
export function columnOf(row: TableRow, cellIndex: number): number {
  return row.cells.slice(0, cellIndex).reduce((n, c) => n + span(c), 0);
}

/** Index of the cell covering `column`, or -1. */
export function cellAt(row: TableRow, column: number): number {
  let start = 0;
  for (let i = 0; i < row.cells.length; i++) {
    if (column < start + span(row.cells[i])) return i;
    start += span(row.cells[i]);
  }
  return -1;
}

/** Width and height follow the grid. */
export function syncSize(t: TableControl): void {
  t.width = Math.round(t.columns.reduce((a, b) => a + b, 0) * 100) / 100;
  t.height = Math.round(t.rows.reduce((a, r) => a + r.height, 0) * 100) / 100;
}

/** A new row under `rowIndex` with the same cell layout and look, but no content. */
export function insertRow(t: TableControl, rowIndex: number): void {
  const model = t.rows[rowIndex];
  t.rows.splice(rowIndex + 1, 0, {
    height: model.height,
    cells: model.cells.map((c) => ({ text: '', colSpan: c.colSpan, styleOverrides: c.styleOverrides ? { ...c.styleOverrides } : undefined })),
  });
  syncSize(t);
}

export function deleteRow(t: TableControl, rowIndex: number): void {
  if (t.rows.length < 2) return;
  t.rows.splice(rowIndex, 1);
  syncSize(t);
}

/** A new column right of `column`, as wide as it; a cell spanning across it just gets wider. */
export function insertColumn(t: TableControl, column: number): void {
  t.columns.splice(column + 1, 0, t.columns[column]);
  for (const row of t.rows) {
    const i = cellAt(row, column);
    if (i < 0) continue;
    const cell = row.cells[i];
    if (columnOf(row, i) + span(cell) - 1 === column) row.cells.splice(i + 1, 0, { text: '' });
    else cell.colSpan = span(cell) + 1;
  }
  syncSize(t);
}

export function deleteColumn(t: TableControl, column: number): void {
  if (t.columns.length < 2) return;
  t.columns.splice(column, 1);
  for (const row of t.rows) {
    const i = cellAt(row, column);
    if (i < 0) continue;
    const cell = row.cells[i];
    if (span(cell) > 1) cell.colSpan = span(cell) - 1 > 1 ? span(cell) - 1 : undefined;
    else row.cells.splice(i, 1);
  }
  syncSize(t);
}

/** Joins a cell with the next one in its row; the first cell's content stays. */
export function mergeRight(t: TableControl, rowIndex: number, cellIndex: number): void {
  const row = t.rows[rowIndex];
  const next = row.cells[cellIndex + 1];
  if (!next) return;
  row.cells[cellIndex].colSpan = span(row.cells[cellIndex]) + span(next);
  row.cells.splice(cellIndex + 1, 1);
}

/** Undoes a merge: the cell keeps one column and empty cells fill the rest. */
export function splitCell(t: TableControl, rowIndex: number, cellIndex: number): void {
  const row = t.rows[rowIndex];
  const cell = row.cells[cellIndex];
  const n = span(cell);
  if (n < 2) return;
  cell.colSpan = undefined;
  row.cells.splice(cellIndex + 1, 0, ...Array.from({ length: n - 1 }, () => ({ text: '' })));
}
