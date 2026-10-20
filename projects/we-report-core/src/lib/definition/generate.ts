import { FieldSchema } from '../data/infer';
import { resolvePageGeometry } from './page';
import { Band, ReportControl, ReportDefinition } from './report-definition';

export interface GenerateLabels {
  title: string;
  total: string;
  /** `{0}` page number, `{1}` page count. */
  pageOf: string;
}

/** Choices of the report wizard; every one is optional. */
export interface GenerateOptions {
  /** One group per value of this field: a heading, the rows, and the group's totals. */
  groupBy?: string;
  /** Totals of numeric columns at the end (and per group). Default true. */
  totals?: boolean;
  /** Rows are sorted by this field (inside their group). */
  sortBy?: string;
  sortDescending?: boolean;
  /** Default: landscape when there are more than seven columns. */
  orientation?: 'portrait' | 'landscape';
}

/** "unitPrice" / "unit_price" → "Unit price": a readable caption for a field name. */
export function captionFor(name: string): string {
  const words = name
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-zç-ş])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
    .trim()
    .toLocaleLowerCase();
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : name;
}

// Identifier columns are shown as they are and never summed: "id", "customer_id", "Sipariş No", "Kod" …
const ID_LIKE = /(^|[\s_\-.])(id|no|nr|code|kod|number|numara|numarası)$/i;
// camelCase identifiers: "customerId", "orderNo" (case-sensitive, so "casino" is not one).
const CAMEL_ID = /[a-z](Id|ID|No|Nr|Code|Number)$/;
const idLike = (name: string) => ID_LIKE.test(name) || CAMEL_ID.test(name);
// Calendar parts are numbers too, but a total of months or years means nothing: "Ay", "Year", "Gün" …
const PERIOD_LIKE = /^(ay|yıl|yil|gün|gun|hafta|çeyrek|ceyrek|dönem|donem|month|year|day|week|quarter|period)$/i;
const MAX_COLUMNS = 12;

/** Whether a number field is worth totalling: not an identifier (`orderNo`, `Kod`) or a calendar part (`Ay`, `year`). */
export function isSummableField(name: string): boolean {
  return !idLike(name) && !PERIOD_LIKE.test(name.trim());
}

/** Relative column width by data type: text needs the most room. */
const weight = (f: FieldSchema) => (f.type === 'string' ? 2.2 : f.type === 'date' ? 1.3 : f.type === 'boolean' ? 0.8 : 1);

/**
 * Designs a tidy list report for the given fields: title, column headers repeated on every page,
 * one row per record, totals of numeric columns, print date and page numbers. Many columns switch
 * the page to landscape. Returns a new definition based on `base` (page, data, parameters kept).
 */
export function generateListReport(
  base: ReportDefinition,
  fields: FieldSchema[],
  labels: GenerateLabels,
  parentPrefix = '',
  rows: readonly unknown[] = [],
  options: GenerateOptions = {},
): ReportDefinition {
  const scalar = (f: FieldSchema) => f.type !== 'object' && f.type !== 'array' && f.type !== 'image';
  const groupField = options.groupBy ? fields.find((f) => f.name === options.groupBy && scalar(f)) : undefined;
  // The group's value is its heading, so it is not repeated as a column.
  const columns = fields.filter((f) => scalar(f) && f !== groupField).slice(0, MAX_COLUMNS);
  const page = { ...base.page, orientation: options.orientation ?? (columns.length > 7 ? ('landscape' as const) : base.page.orientation) };
  const width = resolvePageGeometry(page).contentWidth;
  const total = columns.reduce((s, f) => s + weight(f), 0) || 1;
  const fontSize = columns.length > 9 ? 8 : 9;

  let x = 0;
  const layout = columns.map((f, i) => {
    // The last column absorbs rounding so the table spans the full width exactly.
    const w = i === columns.length - 1 ? Math.round((width - x) * 100) / 100 : Math.round(((width * weight(f)) / total) * 100) / 100;
    const cell = { field: f, x, width: w };
    x += w;
    return cell;
  });

  const numeric = (f: FieldSchema) => f.type === 'number';
  const summable = (f: FieldSchema) => numeric(f) && isSummableField(f.name);
  // Whole-number columns (quantities, counts) get no decimals; the sample rows decide.
  const wholeNumbers = (f: FieldSchema) =>
    rows.length > 0 && rows.every((r) => {
      const v = r && typeof r === 'object' ? (r as Record<string, unknown>)[f.name] : undefined;
      return v === null || v === undefined || Number.isInteger(v);
    });
  const formatOf = (f: FieldSchema) =>
    f.type === 'date' ? 'dd.MM.yyyy' : f.type !== 'number' ? undefined : idLike(f.name) ? 'd' : wholeNumbers(f) ? 'n0' : 'n2';
  const field = (f: FieldSchema) => `[${parentPrefix}${f.name}]`;

  const headerCells: ReportControl[] = layout.map(({ field: f, x, width: w }, i) => ({
    id: `head${i + 1}`,
    type: 'text',
    x,
    y: 12,
    width: w,
    height: 7,
    style: 'columnHeader',
    styleOverrides: numeric(f) ? { textAlign: 'right' } : undefined,
    text: captionFor(f.name),
  }));
  const detailCells: ReportControl[] = layout.map(({ field: f, x, width: w }, i): ReportControl =>
    // Yes/no values print as a tick box.
    f.type === 'boolean'
      ? { id: `cell${i + 1}`, type: 'checkbox', x, y: 0.5, width: w, height: 5, checked: { expression: field(f) } }
      : {
          id: `cell${i + 1}`,
          type: 'text',
          x,
          y: 0,
          width: w,
          height: 6,
          style: 'cell',
          styleOverrides: numeric(f) ? { textAlign: 'right' } : undefined,
          text: { expression: field(f) },
          format: formatOf(f),
          canGrow: f.type === 'string' ? true : undefined,
        },
  );
  const totalsRow = (prefix: string): ReportControl[] => {
    const cells: ReportControl[] = layout.filter(({ field: f }) => summable(f)).map(({ field: f, x, width: w }, i) => ({
      id: `${prefix}${i + 1}`,
      type: 'text',
      x,
      y: 1,
      width: w,
      height: 7,
      style: 'total',
      text: { expression: `Sum(${field(f)})` },
      format: formatOf(f),
    }));
    const firstX = cells.length ? Math.min(...cells.map((t) => t.x)) : 0;
    if (cells.length && firstX > 0) {
      cells.unshift({ id: `${prefix}Label`, type: 'text', x: 0, y: 1, width: firstX, height: 7, style: 'total', styleOverrides: { textAlign: 'left' }, text: labels.total });
    }
    return cells;
  };
  const withTotals = options.totals !== false;
  const totals = withTotals ? totalsRow('total') : [];

  const bands: Band[] = [
    {
      id: 'pageHeader',
      kind: 'pageHeader',
      height: 20,
      controls: [
        { id: 'title', type: 'text', x: 0, y: 0, width, height: 9, style: 'title', text: labels.title },
        { id: 'titleRule', type: 'line', x: 0, y: 9.5, width, height: 1, direction: 'horizontal', lineWidth: 0.4, color: '#2563eb' },
        ...headerCells,
      ],
    },
    {
      id: 'detail',
      kind: 'detail',
      height: 6,
      sortBy: options.sortBy ? [{ expression: `[${parentPrefix}${options.sortBy}]`, descending: options.sortDescending || undefined }] : undefined,
      controls: [...detailCells, { id: 'rowRule', type: 'line', x: 0, y: 5.6, width, height: 0.8, direction: 'horizontal', lineWidth: 0.1, color: '#e5e7eb' }],
    },
  ];
  if (groupField) {
    const groupTotals = withTotals ? totalsRow('groupTotal') : [];
    bands.splice(1, 0, {
      id: 'group1',
      kind: 'groupHeader',
      height: 10,
      groupBy: { expression: field(groupField) },
      keepTogether: true,
      controls: [{ id: 'groupValue', type: 'text', x: 0, y: 2, width, height: 7, style: 'group', text: { expression: field(groupField) }, format: formatOf(groupField) }],
    });
    if (groupTotals.length) bands.splice(3, 0, { id: 'group1Footer', kind: 'groupFooter', groupHeaderId: 'group1', height: 10, controls: groupTotals });
  }
  if (totals.length) bands.push({ id: 'reportFooter', kind: 'reportFooter', height: 10, controls: totals });
  bands.push({
    id: 'pageFooter',
    kind: 'pageFooter',
    height: 8,
    controls: [
      { id: 'printed', type: 'pageInfo', x: 0, y: 2, width: width / 2, height: 6, style: 'muted', info: 'printDate', format: 'dd.MM.yyyy HH:mm' },
      { id: 'pageNo', type: 'pageInfo', x: width / 2, y: 2, width: width / 2, height: 6, style: 'muted', styleOverrides: { textAlign: 'right' }, info: 'pageNofM', format: labels.pageOf },
    ],
  });

  return {
    ...base,
    page,
    styles: {
      ...base.styles,
      default: { ...base.styles['default'], fontSize },
      title: { fontSize: 16, bold: true, color: '#1d4ed8' },
      columnHeader: { bold: true, fontSize: fontSize - 0.5, color: '#ffffff', backgroundColor: '#2563eb', verticalAlign: 'middle', padding: 1 },
      cell: { verticalAlign: 'middle', padding: 1 },
      group: { bold: true, fontSize: fontSize + 1.5, color: '#1d4ed8', verticalAlign: 'bottom' },
      total: { bold: true, textAlign: 'right', padding: 1, border: { width: 0.3, color: '#2563eb', sides: { top: true, right: false, bottom: false, left: false } } },
      muted: { fontSize: 7.5, color: '#6b7280' },
    },
    bands,
  };
}
