import { TableExport } from './xlsx';

export interface CsvOptions {
  /** Region of the numbers; a comma-decimal region (`tr-TR`, `de-DE`) gets `;` between columns, as its Excel expects. */
  locale?: string;
  /** Overrides the column separator. */
  delimiter?: string;
}

/**
 * The report's rows (see `reportTable`) as CSV that Excel opens with the right columns and
 * characters: a UTF-8 byte-order mark, CRLF line ends, the region's decimal separator, ISO dates.
 * Text starting with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet does not run it as a formula.
 */
export function writeCsv(table: TableExport, options: CsvOptions = {}): string {
  const decimal = (1.5).toLocaleString(options.locale || 'en-US').includes(',') ? ',' : '.';
  const delimiter = options.delimiter ?? (decimal === ',' ? ';' : ',');
  const pad = (n: number) => String(n).padStart(2, '0');
  const quote = (s: string) => (s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', decimal) : '';
    if (v instanceof Date) {
      const day = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
      return v.getHours() || v.getMinutes() ? `${day} ${pad(v.getHours())}:${pad(v.getMinutes())}` : day;
    }
    const s = String(v);
    return quote(/^[=+\-@]/.test(s) ? `'${s}` : s);
  };
  const lines = [table.headers.map((h) => quote(h)), ...table.rows.map((r) => r.map(cell))].map((r) => r.join(delimiter));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
