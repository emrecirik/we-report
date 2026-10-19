import { LengthUnit } from '../units';

/**
 * The saved report format (`*.wrpt.json`). Every length is millimetres, every font size points.
 * Changing the shape of anything here requires a version bump and a migration — users keep
 * these files in their own databases.
 */
export const CURRENT_DEFINITION_VERSION = 1;

/** A value computed from data, e.g. `{ expression: "[Price] * [Quantity]" }`. */
export interface Expression {
  expression: string;
}

export type Bindable<T> = T | Expression;

export function isExpression(value: unknown): value is Expression {
  return typeof value === 'object' && value !== null && typeof (value as Expression).expression === 'string';
}

export type Orientation = 'portrait' | 'landscape';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSettings {
  /** A `PAPER_SIZES` id, or `'custom'` to use `width`/`height`. */
  paper: string;
  orientation: Orientation;
  margins: Margins;
  /** Portrait width/height for `paper: 'custom'`; `height: null` means continuous. */
  width?: number;
  height?: number | null;
  /** Unit the designer shows rulers and sizes in. Storage stays millimetres. */
  displayUnit: LengthUnit;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface BorderStyle {
  width: number;
  color: string;
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

/** A named text/box style. Controls reference styles by name and may override single properties. */
export interface ReportStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  backgroundColor?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  padding?: number;
  border?: BorderStyle;
}

interface ControlBase {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Name of an entry in `ReportDefinition.styles`; `'default'` when omitted. */
  style?: string;
  styleOverrides?: ReportStyle;
  visible?: Bindable<boolean>;
  /** Applied in order; every rule whose formula is true merges its style over the control's. */
  formatting?: FormattingRule[];
}

/** Conditional formatting: "when `[Amount] < 0`, use red text". */
export interface FormattingRule {
  /** A formula; the rule applies when it is true. */
  when: string;
  style: ReportStyle;
}

export interface TextControl extends ControlBase {
  type: 'text';
  text: Bindable<string>;
  /** Format pattern applied to non-string values, e.g. `n2`, `c2`, `dd.MM.yyyy`. */
  format?: string;
  canGrow?: boolean;
  canShrink?: boolean;
}

export interface LineControl extends ControlBase {
  type: 'line';
  direction: 'horizontal' | 'vertical' | 'diagonalDown' | 'diagonalUp';
  lineWidth: number;
  color?: string;
}

export interface ShapeControl extends ControlBase {
  type: 'shape';
  shape: 'rectangle' | 'roundedRectangle' | 'ellipse';
  cornerRadius?: number;
}

export interface ImageControl extends ControlBase {
  type: 'image';
  /** Data URI, or an expression yielding a data URI / URL. */
  source: Bindable<string>;
  fit: 'contain' | 'cover' | 'stretch' | 'none';
}

export interface BarcodeControl extends ControlBase {
  type: 'barcode';
  /** bwip-js symbology id: `code128`, `ean13`, `qrcode`, `datamatrix`, `pdf417` … */
  symbology: string;
  value: Bindable<string>;
  showText: boolean;
}

export interface PageInfoControl extends ControlBase {
  type: 'pageInfo';
  info: 'pageNumber' | 'pageCount' | 'pageNofM' | 'printDate';
  format?: string;
}

export interface CheckboxControl extends ControlBase {
  type: 'checkbox';
  checked: Bindable<boolean>;
}

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'doughnut';
export type ChartAggregate = 'sum' | 'count' | 'avg' | 'min' | 'max';

/**
 * A chart of the band's rows (all rows in a report header/footer, the group's rows in a group
 * footer): rows are grouped by `category` and `value` is aggregated per group.
 */
export interface ChartControl extends ControlBase {
  type: 'chart';
  chartType: ChartType;
  category: Expression;
  value: Expression;
  /** Default `sum`. */
  aggregate?: ChartAggregate;
  title?: string;
  showValues?: boolean;
  /** Pie and doughnut only; default true. */
  showLegend?: boolean;
  /** Format of the value labels and axis, e.g. `n0`, `c2`. */
  format?: string;
  /** Series colours; the default palette (`DEFAULT_CHART_PALETTE`) when omitted. */
  colors?: string[];
  /** Colour of the grid lines; `DEFAULT_CHART_GRID_COLOR` when omitted. */
  gridColor?: string;
}

/** One cell of a table row; a cell may span the columns to its right. */
export interface TableCell {
  text: Bindable<string>;
  format?: string;
  /** Number of columns this cell covers; default 1. */
  colSpan?: number;
  /** Merged over the table's own style, so a table border becomes the grid. */
  styleOverrides?: ReportStyle;
}

export interface TableRow {
  height: number;
  cells: TableCell[];
}

/** A grid of cells, e.g. a header row and a value row in a detail band. */
export interface TableControl extends ControlBase {
  type: 'table';
  /** Column widths in mm; the table is as wide as their sum. */
  columns: number[];
  rows: TableRow[];
  /** Rows grow to fit their longest text instead of cutting it off. */
  canGrow?: boolean;
}

export type ReportControl =
  | TextControl
  | LineControl
  | ShapeControl
  | ImageControl
  | BarcodeControl
  | PageInfoControl
  | CheckboxControl
  | ChartControl
  | TableControl;

export type ReportControlType = ReportControl['type'];

export type BandKind =
  | 'reportHeader'
  | 'pageHeader'
  | 'groupHeader'
  | 'detail'
  /** Inner list: repeats for every item of a list inside each detail row (e.g. a customer's orders). */
  | 'subHeader'
  | 'subDetail'
  | 'subFooter'
  | 'groupFooter'
  | 'pageFooter'
  | 'reportFooter';

export interface Band {
  id: string;
  kind: BandKind;
  height: number;
  controls: ReportControl[];
  /** groupHeader only: rows are grouped by this expression's value. */
  groupBy?: Expression;
  /** groupHeader only: order of the groups; rows keep their order inside a group. Default `asc`. */
  sort?: 'asc' | 'desc' | 'none';
  /**
   * subDetail only: path of the list inside each detail row, e.g. `orders`. Inside the inner list
   * `[field]` reads the item and `[^.field]` the detail row around it; totals run over the items.
   */
  rowsPath?: string;
  /** groupFooter only: id of the groupHeader band it closes. */
  groupHeaderId?: string;
  /** groupHeader: repeat on every page the group spans. pageHeader/pageFooter always repeat. */
  repeatOnEveryPage?: boolean;
  /** groupHeader: move the whole group to the next page if it would otherwise be split. */
  keepTogether?: boolean;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  backgroundColor?: string;
  /**
   * detail only: print rows side by side, e.g. labels. The band's controls fit one column, which
   * is `(content width - gap × (count - 1)) / count` wide; rows fill across, then down.
   */
  columns?: { count: number; gap?: number };
}

export interface JsonDataSource {
  id: string;
  name: string;
  kind: 'json';
  /** Inline data, as pasted or loaded. */
  data: unknown;
}

export interface CsvDataSource {
  id: string;
  name: string;
  kind: 'csv';
  text: string;
  delimiter?: string;
}

export interface WebServiceDataSource {
  id: string;
  name: string;
  kind: 'webService';
  /** `{{param}}` placeholders are replaced with URL-encoded report parameter values. */
  url: string;
  method?: 'GET' | 'POST';
  headers?: { name: string; value: string }[];
  /** Request body for POST; `{{param}}` placeholders are replaced as-is. */
  body?: string;
  /** Last response, saved by the designer's "Test" button so the report can be designed offline. */
  sample?: unknown;
  /** `backend`: called through the data backend (CORS-blocked APIs, secrets kept server-side). */
  via?: 'browser' | 'backend';
}

/** One condition of a structured query; `param` uses a report parameter's value. */
export interface QueryCondition {
  column: string;
  op: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'in' | 'isNull' | 'notNull';
  value?: unknown;
  param?: string;
}

/** What the visual query builder produces; see protocol/schemas/query.json. */
export interface StructuredQuery {
  table: string;
  columns?: string[];
  where?: QueryCondition[];
  orderBy?: { column: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
}

/** Live database data through a we-report data backend (any language implementing the protocol). */
export interface DatabaseDataSource {
  id: string;
  name: string;
  kind: 'database';
  /** Connection id on the backend; connection strings never leave the backend. */
  connectionId: string;
  query?: StructuredQuery;
  /** Free SQL with `:param` placeholders, only where the connection allows it. */
  sql?: string;
  sample?: unknown;
}

export type DataSourceDefinition = JsonDataSource | CsvDataSource | WebServiceDataSource | DatabaseDataSource;

export type ParameterType = 'string' | 'number' | 'date' | 'boolean';

/** A value asked from the user before the report runs; read in formulas as `[?name]`. */
export interface ReportParameter {
  name: string;
  type: ParameterType;
  label?: string;
  defaultValue?: string | number | boolean | null;
}

/** Large text across every page behind the content, e.g. "DRAFT" or "PAID". */
export interface Watermark {
  /** Fixed text, or a formula (e.g. `Iif([^.paid], 'PAID', '')`); empty text draws nothing. */
  text: Bindable<string>;
  color?: string;
  /** Points; fitted to the page diagonal when omitted. */
  fontSize?: number;
  /** Degrees, counter-clockwise; default 45. */
  angle?: number;
}

export interface ReportDefinition {
  $schema?: string;
  version: number;
  name: string;
  page: PageSettings;
  styles: Record<string, ReportStyle>;
  dataSources: DataSourceDefinition[];
  parameters?: ReportParameter[];
  /** Id of the data source the detail band repeats over, plus an optional path to the rows. */
  dataMember?: { dataSourceId: string; path?: string };
  watermark?: Watermark;
  /** BCP 47 locale for numbers, dates and words (`tr-TR`, `de-DE`); the host's when omitted. */
  locale?: string;
  /** ISO 4217 code for money formats (`TRY`, `EUR`); the host's when omitted. */
  currency?: string;
  bands: Band[];
}
