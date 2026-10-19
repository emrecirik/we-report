import { FieldSchema } from '../data/infer';
import { resolvePageGeometry } from './page';
import { Band, ReportControl, ReportDefinition } from './report-definition';

export interface GenerateLabels {
  title: string;
  total: string;
  /** `{0}` page number, `{1}` page count. */
  pageOf: string;
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
const ID_LIKE = /(^|[\s_\-.])(id|no|nr|code|kod|number|numara|numarası)$|[a-z]Id$/i;
const MAX_COLUMNS = 12;

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
): ReportDefinition {
  const columns = fields.filter((f) => f.type !== 'object' && f.type !== 'array' && f.type !== 'image').slice(0, MAX_COLUMNS);
  const page = { ...base.page, orientation: columns.length > 7 ? ('landscape' as const) : base.page.orientation };
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
  const summable = (f: FieldSchema) => numeric(f) && !ID_LIKE.test(f.name);
  // Whole-number columns (quantities, counts) get no decimals; the sample rows decide.
  const wholeNumbers = (f: FieldSchema) =>
    rows.length > 0 && rows.every((r) => {
      const v = r && typeof r === 'object' ? (r as Record<string, unknown>)[f.name] : undefined;
      return v === null || v === undefined || Number.isInteger(v);
    });
  const formatOf = (f: FieldSchema) =>
    f.type === 'date' ? 'dd.MM.yyyy' : f.type === 'number' && !ID_LIKE.test(f.name) ? (wholeNumbers(f) ? 'n0' : 'n2') : undefined;
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
  const detailCells: ReportControl[] = layout.map(({ field: f, x, width: w }, i) => ({
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
  }));
  const totals: ReportControl[] = layout.filter(({ field: f }) => summable(f)).map(({ field: f, x, width: w }, i) => ({
    id: `total${i + 1}`,
    type: 'text',
    x,
    y: 1,
    width: w,
    height: 7,
    style: 'total',
    text: { expression: `Sum(${field(f)})` },
    format: formatOf(f),
  }));
  const firstTotalX = totals.length ? Math.min(...totals.map((t) => t.x)) : 0;
  if (totals.length && firstTotalX > 0) {
    totals.unshift({ id: 'totalLabel', type: 'text', x: 0, y: 1, width: firstTotalX, height: 7, style: 'total', styleOverrides: { textAlign: 'left' }, text: labels.total });
  }

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
      controls: [...detailCells, { id: 'rowRule', type: 'line', x: 0, y: 5.6, width, height: 0.8, direction: 'horizontal', lineWidth: 0.1, color: '#e5e7eb' }],
    },
  ];
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
      total: { bold: true, textAlign: 'right', padding: 1, border: { width: 0.3, color: '#2563eb', sides: { top: true, right: false, bottom: false, left: false } } },
      muted: { fontSize: 7.5, color: '#6b7280' },
    },
    bands,
  };
}
