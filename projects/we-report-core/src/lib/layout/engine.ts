import { resolveReportData } from '../data/data-source';
import { resolveParameters } from '../data/web-service';
import { DEFAULT_WATERMARK_COLOR } from '../definition/blank-report';
import { PageGeometry, resolvePageGeometry } from '../definition/page';
import {
  Band,
  Bindable,
  ChartControl,
  TableCell,
  TableControl,
  isExpression,
  ReportControl,
  ReportDefinition,
  TextControl,
} from '../definition/report-definition';
import { evaluate, EvaluationContext } from '../expression/evaluate';
import { FontRegistry } from '../fonts/font-registry';
import { formatValue } from '../format';
import { barcodeItem } from './barcode';
import { aggregate, ChartPoint, chartItems } from './chart';
import { readImage } from './images';
import { LayoutDocument, LayoutItem, LayoutPage, LayoutProblem, TextItem } from './layout-types';
import { resolveStyle, ResolvedStyle } from './style';
import { wrapText } from './text-wrap';
import { toMm } from '../units';

export interface LayoutOptions {
  fonts: FontRegistry;
  /** Rows (or an object holding them) from the host app; replaces the bound data source's data. */
  data?: unknown;
  /** Loaded web-service responses by data source id (see `loadReportData`). */
  sources?: Record<string, unknown>;
  /** Report parameter values by name; defaults apply for missing ones. */
  params?: Record<string, unknown>;
  /** Print time for `Today()`, `Now()` and print-date page info. Required so output is reproducible. */
  now: Date;
  locale?: string;
  currency?: string;
}

interface PageInfo {
  number: number;
  count: number;
}

interface Scope {
  row: unknown;
  rows: readonly unknown[];
}

/** A band rendered at the origin; items are relative to its top-left corner. */
interface RenderedBand {
  band: Band;
  scope: Scope;
  height: number;
  items: LayoutItem[];
  /** Items that need the page number (page info controls), rendered once pages are known. */
  deferred: ((page: PageInfo) => LayoutItem[])[];
}

type Entry =
  | { type: 'band'; rendered: RenderedBand; groupLevel?: number }
  | { type: 'groupStart'; level: number; keepTogether: boolean; end: number }
  | { type: 'groupEnd'; level: number };

const ERROR_TEXT = '#ERR';
const MM_PER_PX = toMm(1, 'px');

/**
 * Lays a report out into pages. Pure and deterministic: the same definition, data, fonts and
 * options always give the same document.
 */
export function layoutReport(definition: ReportDefinition, options: LayoutOptions): LayoutDocument {
  return new LayoutRun(definition, options).run();
}

class LayoutRun {
  private readonly problems: LayoutProblem[] = [];
  private readonly reported = new Set<string>();
  private readonly geometry: PageGeometry;
  private readonly locale: string;
  private readonly currency: string;
  private readonly now: Date;
  private parent: unknown;
  private readonly params: Record<string, unknown>;

  constructor(
    private readonly def: ReportDefinition,
    private readonly options: LayoutOptions,
  ) {
    this.geometry = resolvePageGeometry(def.page);
    // A report written for one region keeps its formats wherever it is printed.
    this.locale = def.locale || options.locale || 'en-US';
    this.currency = def.currency || options.currency || 'USD';
    this.now = options.now;
    this.params = resolveParameters(def.parameters, options.params);
  }

  run(): LayoutDocument {
    const { rows, parent } = resolveReportData(this.def, this.options.data, this.options.sources);
    this.parent = parent;
    const allRows = rows ?? [];
    const first = allRows[0];
    const bands = this.def.bands;
    const byKind = (kind: Band['kind']) => bands.find((b) => b.kind === kind);
    const groupHeaders = bands.filter((b) => b.kind === 'groupHeader');
    const detail = byKind('detail');

    const entries: Entry[] = [];
    const reportHeader = byKind('reportHeader');
    if (reportHeader) entries.push({ type: 'band', rendered: this.renderBand(reportHeader, { row: first, rows: allRows }) });

    if (rows === null) {
      if (detail) entries.push({ type: 'band', rendered: this.renderBand(detail, { row: undefined, rows: [] }) });
    } else {
      const keys = new Map<unknown, unknown[]>();
      for (const row of rows) keys.set(row, groupHeaders.map((h) => this.groupKey(h, row)));
      const sorted = this.sortRows(rows, groupHeaders, keys);
      this.emitGroups(entries, 0, sorted, groupHeaders, keys, detail);
    }

    const reportFooter = byKind('reportFooter');
    if (reportFooter) {
      entries.push({ type: 'band', rendered: this.renderBand(reportFooter, { row: allRows[allRows.length - 1], rows: allRows }) });
    }

    const pages = this.paginate(entries, byKind('pageHeader'), byKind('pageFooter'), first);
    return { pages, problems: this.problems };
  }

  // ── Grouping ────────────────────────────────────────────────────────────────

  private groupKey(header: Band, row: unknown): unknown {
    if (!header.groupBy) return null;
    const v = this.eval(header.groupBy.expression, { row, rows: [] }, header.id);
    return v instanceof Date ? v.getTime() : v;
  }

  private sortRows(rows: unknown[], headers: Band[], keys: Map<unknown, unknown[]>): unknown[] {
    const collator = new Intl.Collator(this.locale, { numeric: true });
    const cmp = (a: unknown, b: unknown): number => {
      if (a === b) return 0;
      if (a === null || a === undefined) return -1;
      if (b === null || b === undefined) return 1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return collator.compare(String(a), String(b));
    };
    if (!headers.some((h) => h.groupBy && h.sort !== 'none')) return rows;
    // Array.prototype.sort is stable, so rows keep their order inside a group.
    return [...rows].sort((ra, rb) => {
      for (let i = 0; i < headers.length; i++) {
        const order = headers[i].sort ?? 'asc';
        if (order === 'none') continue;
        const c = cmp(keys.get(ra)![i], keys.get(rb)![i]);
        if (c) return order === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  private emitGroups(
    entries: Entry[],
    level: number,
    rows: unknown[],
    headers: Band[],
    keys: Map<unknown, unknown[]>,
    detail: Band | undefined,
  ): void {
    if (level === headers.length) {
      if (detail) for (const row of rows) entries.push({ type: 'band', rendered: this.renderBand(detail, { row, rows }) });
      return;
    }
    const header = headers[level];
    const footer = this.def.bands.find((b) => b.kind === 'groupFooter' && b.groupHeaderId === header.id);
    let start = 0;
    while (start < rows.length) {
      const key = keys.get(rows[start])![level];
      let end = start + 1;
      while (end < rows.length && keys.get(rows[end])![level] === key) end++;
      const groupRows = rows.slice(start, end);

      const startIndex = entries.length;
      entries.push({ type: 'groupStart', level, keepTogether: !!header.keepTogether, end: -1 });
      entries.push({ type: 'band', rendered: this.renderBand(header, { row: groupRows[0], rows: groupRows }), groupLevel: level });
      this.emitGroups(entries, level + 1, groupRows, headers, keys, detail);
      if (footer) {
        entries.push({ type: 'band', rendered: this.renderBand(footer, { row: groupRows[groupRows.length - 1], rows: groupRows }) });
      }
      entries.push({ type: 'groupEnd', level });
      (entries[startIndex] as Extract<Entry, { type: 'groupStart' }>).end = entries.length - 1;
      start = end;
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  private paginate(entries: Entry[], pageHeader: Band | undefined, pageFooter: Band | undefined, firstRow: unknown): LayoutPage[] {
    const { margins } = this.def.page;
    const contentHeight = this.geometry.contentHeight;
    const headerHeight = pageHeader?.height ?? 0;
    const footerHeight = pageFooter?.height ?? 0;
    const bodyBottom = contentHeight === null ? Infinity : contentHeight - footerHeight;

    interface PageState {
      items: LayoutItem[];
      rows: unknown[];
      deferred: { y: number; render: (page: PageInfo) => LayoutItem[] }[];
      endY: number;
    }
    const pages: PageState[] = [];
    let page!: PageState;
    let y = 0;
    let fresh = true;
    let breakPending = false;
    const repeating: (RenderedBand | null)[] = [];
    // Multi-column detail: the current row of cells, its top and its tallest cell.
    let column = 0;
    let rowTop = 0;
    let rowHeight = 0;
    const endRow = () => {
      if (column === 0) return;
      y = rowTop + rowHeight;
      page.endY = y;
      column = 0;
      rowHeight = 0;
    };

    const put = (r: RenderedBand, dx = 0) => {
      const dy = margins.top + y;
      for (const item of r.items) page.items.push(translate(item, margins.left + dx, dy));
      for (const render of r.deferred) page.deferred.push({ y: dy, render });
      if (r.band.kind === 'detail' && r.scope.row !== undefined) page.rows.push(r.scope.row);
      y += r.height;
      page.endY = y;
    };
    const startPage = () => {
      page = { items: [], rows: [], deferred: [], endY: 0 };
      pages.push(page);
      column = 0;
      rowHeight = 0;
      y = headerHeight;
      for (const r of repeating) if (r) put(r);
      fresh = true;
      breakPending = false;
    };
    startPage();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type === 'groupEnd') {
        repeating.length = entry.level;
        continue;
      }
      if (entry.type === 'groupStart') {
        if (entry.keepTogether && !fresh) {
          let total = 0;
          for (let j = i + 1; j < entry.end; j++) {
            const e = entries[j];
            if (e.type === 'band') total += e.rendered.height;
          }
          if (y + total > bodyBottom && headerHeight + total <= bodyBottom) startPage();
        }
        continue;
      }
      const r = entry.rendered;
      const columns = r.band.kind === 'detail' ? Math.max(1, Math.floor(r.band.columns?.count ?? 1)) : 1;
      if (columns === 1) endRow();
      // Later cells of a row sit beside the first one, which already decided the page.
      if (column === 0 && (breakPending || (r.band.pageBreakBefore && !fresh) || (!fresh && y + r.height > bodyBottom))) {
        if (entry.groupLevel !== undefined) repeating.length = entry.groupLevel;
        startPage();
      }
      if (columns > 1) {
        const gap = r.band.columns?.gap ?? 0;
        const cellWidth = (this.geometry.contentWidth - gap * (columns - 1)) / columns;
        if (column === 0) rowTop = y;
        y = rowTop;
        put(r, column * (cellWidth + gap));
        rowHeight = Math.max(rowHeight, r.height);
        y = rowTop;
        page.endY = rowTop + rowHeight;
        if (++column === columns) endRow();
      } else {
        // shortcut: a band taller than the page is placed anyway and overflows; split bands when needed.
        put(r);
      }
      fresh = false;
      if (entry.groupLevel !== undefined) {
        repeating.length = entry.groupLevel;
        repeating.push(r.band.repeatOnEveryPage ? r : null);
      }
      if (r.band.pageBreakAfter) breakPending = true;
    }
    endRow();

    const count = pages.length;
    const width = this.geometry.width;
    return pages.map((state, index) => {
      const info: PageInfo = { number: index + 1, count };
      const scope: Scope = { row: state.rows[0] ?? firstRow, rows: state.rows };
      const items: LayoutItem[] = [];
      const pageHeight = this.geometry.height ?? margins.top + state.endY + footerHeight + margins.bottom;
      const place = (band: Band | undefined, top: number) => {
        if (!band) return;
        const r = this.renderBand(band, scope);
        for (const item of r.items) items.push(translate(item, margins.left, top));
        for (const render of r.deferred) for (const item of render(info)) items.push(translate(item, margins.left, top));
      };
      items.push(...this.watermark(scope, width, pageHeight));
      place(pageHeader, margins.top);
      items.push(...state.items);
      for (const d of state.deferred) for (const item of d.render(info)) items.push(translate(item, margins.left, d.y));
      place(pageFooter, contentHeight === null ? margins.top + state.endY : margins.top + contentHeight - footerHeight);
      return { width, height: pageHeight, items };
    });
  }

  /** The watermark centred on the page, rotated, drawn first so the content sits on top. */
  private watermark(scope: Scope, pageWidth: number, pageHeight: number): LayoutItem[] {
    const w = this.def.watermark;
    if (!w) return [];
    const value = this.bind(w.text, scope, 'watermark');
    const text = value === null || value === undefined || value === ERROR_TEXT ? '' : String(value);
    if (!text.trim()) return [];
    const base = resolveStyle(this.def);
    const font = this.options.fonts.resolve(base.fontFamily, true, false);
    const angle = ((w.angle ?? 45) * Math.PI) / 180;
    // Fit 70% of the diagonal it runs along unless a size is given.
    const reach = Math.min(Math.abs(pageWidth / Math.cos(angle)) || Infinity, Math.abs(pageHeight / Math.sin(angle)) || Infinity);
    const size = w.fontSize ?? Math.min(200, (100 * reach * 0.7) / Math.max(1, font.widthOf(text, 100)));
    const textWidth = font.widthOf(text, size);
    const middle = font.capHeight(size) / 2;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const cx = pageWidth / 2;
    const cy = pageHeight / 2;
    const d = font.outline(text, size, (x, y) => {
      const lx = x - textWidth / 2;
      const ly = y + middle;
      return [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    });
    return [{ kind: 'path', x: 0, y: 0, width: pageWidth, height: pageHeight, viewBox: { width: pageWidth, height: pageHeight }, paths: [{ d, fill: w.color ?? DEFAULT_WATERMARK_COLOR }] }];
  }

  // ── Bands and controls ──────────────────────────────────────────────────────

  private renderBand(band: Band, scope: Scope): RenderedBand {
    const items: LayoutItem[] = [];
    const deferred: RenderedBand['deferred'] = [];
    let height = band.height;
    for (const control of band.controls) {
      if (control.visible !== undefined && !this.truthy(this.bind(control.visible, scope, control.id))) continue;
      const result = this.renderControl(control, scope);
      if (result.deferred) deferred.push(result.deferred);
      items.push(...result.items);
      height = Math.max(height, control.y + result.height);
    }
    if (band.backgroundColor) {
      items.unshift({ kind: 'rect', x: 0, y: 0, width: this.geometry.contentWidth, height, fill: band.backgroundColor });
    }
    return { band, scope, height, items, deferred };
  }

  private renderControl(
    c: ReportControl,
    scope: Scope,
  ): { items: LayoutItem[]; height: number; deferred?: (page: PageInfo) => LayoutItem[] } {
    const style = resolveStyle(this.def, c.style, this.overridesFor(c, scope));
    const box = { x: c.x, y: c.y, width: c.width, height: c.height };
    switch (c.type) {
      case 'text': {
        const text = this.textOf(c, scope);
        const height = c.canGrow ? Math.max(c.height, this.measureTextHeight(text, style, c.width)) : c.height;
        return { items: this.textBox(text, style, { ...box, height }), height };
      }
      case 'table':
        return this.renderTable(c, scope);
      case 'pageInfo':
        return {
          items: [],
          height: c.height,
          deferred: (page) => this.textBox(this.pageInfoText(c.info, c.format, page), style, box),
        };
      case 'line': {
        const color = c.color ?? style.color;
        const { x, y, width: w, height: h } = box;
        const [x1, y1, x2, y2] =
          c.direction === 'horizontal' ? [x, y + h / 2, x + w, y + h / 2]
          : c.direction === 'vertical' ? [x + w / 2, y, x + w / 2, y + h]
          : c.direction === 'diagonalDown' ? [x, y, x + w, y + h]
          : [x, y + h, x + w, y];
        return { items: [{ kind: 'line', x1, y1, x2, y2, color, width: c.lineWidth }], height: c.height };
      }
      case 'shape': {
        const stroke = style.border?.color ?? style.color;
        const strokeWidth = style.border?.width ?? 0.25;
        const fill = style.backgroundColor;
        const item: LayoutItem =
          c.shape === 'ellipse'
            ? { kind: 'ellipse', ...box, fill, stroke, strokeWidth }
            : { kind: 'rect', ...box, fill, stroke, strokeWidth, radius: c.shape === 'roundedRectangle' ? (c.cornerRadius ?? 2) : undefined };
        return { items: [item], height: c.height };
      }
      case 'image': {
        const src = this.bind(c.source, scope, c.id);
        const items = this.decorations(style, box);
        if (typeof src === 'string' && src) {
          const info = readImage(src);
          if (!info) {
            this.problem('image', c.id, 'Only PNG and JPEG data URIs are supported.');
          } else {
            items.push({ kind: 'image', ...fitImage(c.fit, box, info.width * MM_PER_PX, info.height * MM_PER_PX), clip: box, src });
          }
        }
        return { items, height: c.height };
      }
      case 'barcode': {
        const value = this.bind(c.value, scope, c.id);
        const items = this.decorations(style, box);
        if (value !== null && value !== undefined && value !== '' && value !== ERROR_TEXT) {
          try {
            items.push(barcodeItem(c.symbology, String(value), c.showText, box, style.color));
          } catch (e) {
            this.problem('barcode', c.id, (e as Error).message.replace(/^bwipp\.\w+#\d+:\s*/, ''));
            items.push(...this.textBox(ERROR_TEXT, style, box));
          }
        }
        return { items, height: c.height };
      }
      case 'chart': {
        const items = this.decorations(style, box);
        const options = { locale: this.locale, currency: this.currency };
        items.push(
          ...chartItems(c, this.chartPoints(c, scope), style, {
            text: (text, st, b) => this.textBox(text, st, b),
            lineHeight: (st) => this.options.fonts.resolve(st.fontFamily, st.bold, st.italic).lineHeight(st.fontSize),
            textWidth: (text, st) => this.options.fonts.resolve(st.fontFamily, st.bold, st.italic).widthOf(text, st.fontSize),
            format: (v) => formatValue(v, c.format || 'n0', options),
          }),
        );
        return { items, height: c.height };
      }
      case 'checkbox': {
        const checked = this.truthy(this.bind(c.checked, scope, c.id));
        const size = Math.min(c.width, c.height) * 0.8;
        const x = c.x + (c.width - size) / 2;
        const y = c.y + (c.height - size) / 2;
        const color = style.color;
        const w = Math.max(0.2, size / 12);
        const items: LayoutItem[] = [{ kind: 'rect', x, y, width: size, height: size, stroke: color, strokeWidth: w, fill: style.backgroundColor }];
        if (checked) {
          items.push(
            { kind: 'line', x1: x + size * 0.2, y1: y + size * 0.55, x2: x + size * 0.42, y2: y + size * 0.78, color, width: w * 1.5 },
            { kind: 'line', x1: x + size * 0.42, y1: y + size * 0.78, x2: x + size * 0.8, y2: y + size * 0.25, color, width: w * 1.5 },
          );
        }
        return { items, height: c.height };
      }
    }
  }

  /** The control's own overrides plus every formatting rule whose formula is true for this row. */
  private overridesFor(c: ReportControl, scope: Scope): ReportControl['styleOverrides'] {
    if (!c.formatting?.length) return c.styleOverrides;
    let merged = { ...c.styleOverrides };
    for (const rule of c.formatting) {
      if (rule.when.trim() && this.truthy(this.eval(rule.when, scope, c.id))) merged = { ...merged, ...rule.style };
    }
    return merged;
  }

  /** The band's rows grouped by the chart's category, in order of first appearance. */
  private chartPoints(c: ChartControl, scope: Scope): ChartPoint[] {
    if (!c.category.expression.trim() || !c.value.expression.trim()) return [];
    const groups = new Map<string, number[]>();
    const options = { locale: this.locale, currency: this.currency };
    for (const row of scope.rows) {
      const rowScope = { row, rows: scope.rows };
      const category = this.eval(c.category.expression, rowScope, c.id);
      const label = category instanceof Date ? formatValue(category, undefined, options) : String(category ?? '');
      const value = Number(this.eval(c.value.expression, rowScope, c.id));
      if (!groups.has(label)) groups.set(label, []);
      // Count counts rows, whatever the value formula returns.
      if (Number.isFinite(value) || c.aggregate === 'count') groups.get(label)!.push(Number.isFinite(value) ? value : 0);
    }
    return [...groups].map(([label, values]) => ({ label, value: aggregate(c.aggregate ?? 'sum', values) }));
  }

  /** Cells laid out on the column grid; with `canGrow` each row is as tall as its tallest text. */
  private renderTable(c: TableControl, scope: Scope): { items: LayoutItem[]; height: number } {
    const items: LayoutItem[] = [];
    const tableOverrides = this.overridesFor(c, scope);
    let y = c.y;
    for (const row of c.rows) {
      const cells: { text: string; style: ResolvedStyle; x: number; width: number }[] = [];
      let column = 0;
      let x = c.x;
      for (const cell of row.cells) {
        if (column >= c.columns.length) break;
        const span = Math.max(1, Math.min(cell.colSpan ?? 1, c.columns.length - column));
        const width = c.columns.slice(column, column + span).reduce((a, b) => a + b, 0);
        const style = resolveStyle(this.def, c.style, { ...tableOverrides, ...cell.styleOverrides });
        cells.push({ text: this.cellText(cell, scope, c.id), style, x, width });
        x += width;
        column += span;
      }
      const height = c.canGrow ? Math.max(row.height, ...cells.map((cell) => this.measureTextHeight(cell.text, cell.style, cell.width))) : row.height;
      for (const cell of cells) items.push(...this.textBox(cell.text, cell.style, { x: cell.x, y, width: cell.width, height }));
      y += height;
    }
    return { items, height: y - c.y };
  }

  private cellText(cell: TableCell, scope: Scope, controlId: string): string {
    const value = this.bind(cell.text, scope, controlId);
    if (value === ERROR_TEXT) return ERROR_TEXT;
    if (typeof value === 'string' && !cell.format) return value;
    return formatValue(value, cell.format, { locale: this.locale, currency: this.currency });
  }

  private textOf(c: TextControl, scope: Scope): string {
    const value = this.bind(c.text, scope, c.id);
    if (value === ERROR_TEXT) return ERROR_TEXT;
    if (typeof value === 'string' && !c.format) return value;
    return formatValue(value, c.format, { locale: this.locale, currency: this.currency });
  }

  private pageInfoText(info: string, format: string | undefined, page: PageInfo): string {
    switch (info) {
      case 'pageNumber':
        return String(page.number);
      case 'pageCount':
        return String(page.count);
      case 'pageNofM':
        return (format || '{0} / {1}').replace('{0}', String(page.number)).replace('{1}', String(page.count));
      default:
        return formatValue(this.now, format || 'dd.MM.yyyy', { locale: this.locale, currency: this.currency });
    }
  }

  private measureTextHeight(text: string, style: ResolvedStyle, width: number): number {
    const font = this.options.fonts.resolve(style.fontFamily, style.bold, style.italic);
    const lines = wrapText(text, font, style.fontSize, Math.max(0, width - 2 * style.padding));
    return lines.length * font.lineHeight(style.fontSize) + 2 * style.padding;
  }

  /** Background and borders of a control box. */
  private decorations(style: ResolvedStyle, box: { x: number; y: number; width: number; height: number }): LayoutItem[] {
    const items: LayoutItem[] = [];
    if (style.backgroundColor) items.push({ kind: 'rect', ...box, fill: style.backgroundColor });
    const b = style.border;
    if (b && b.width > 0) {
      const { x, y, width: w, height: h } = box;
      const line = (x1: number, y1: number, x2: number, y2: number): LayoutItem => ({ kind: 'line', x1, y1, x2, y2, color: b.color, width: b.width });
      if (b.sides.top) items.push(line(x, y, x + w, y));
      if (b.sides.right) items.push(line(x + w, y, x + w, y + h));
      if (b.sides.bottom) items.push(line(x, y + h, x + w, y + h));
      if (b.sides.left) items.push(line(x, y, x, y + h));
    }
    return items;
  }

  private textBox(text: string, style: ResolvedStyle, box: { x: number; y: number; width: number; height: number }): LayoutItem[] {
    const items = this.decorations(style, box);
    if (text === '') return items;
    const font = this.options.fonts.resolve(style.fontFamily, style.bold, style.italic);
    const size = style.fontSize;
    const pad = style.padding;
    const innerWidth = Math.max(0, box.width - 2 * pad);
    const lineHeight = font.lineHeight(size);
    const ascent = font.ascent(size);
    let lines = wrapText(text, font, size, innerWidth);
    const maxLines = Math.max(1, Math.floor((box.height - 2 * pad) / lineHeight + 0.01));
    if (lines.length > maxLines) lines = lines.slice(0, maxLines);
    const free = Math.max(0, box.height - 2 * pad - lines.length * lineHeight);
    const offset = style.verticalAlign === 'middle' ? free / 2 : style.verticalAlign === 'bottom' ? free : 0;
    const item: TextItem = {
      kind: 'text',
      ...box,
      lines: lines.map((line, i) => {
        const width = font.widthOf(line, size);
        // shortcut: 'justify' renders left-aligned; implement word spacing when the designer offers it.
        const dx = style.textAlign === 'center' ? (innerWidth - width) / 2 : style.textAlign === 'right' ? innerWidth - width : 0;
        return { text: line, x: box.x + pad + dx, baseline: box.y + pad + offset + ascent + i * lineHeight, width };
      }),
      fontKey: font.key,
      fontFamily: font.family,
      bold: font.variant === 'bold' || font.variant === 'boldItalic',
      italic: font.variant === 'italic' || font.variant === 'boldItalic',
      size,
      color: style.color,
      underline: style.underline,
    };
    items.push(item);
    return items;
  }

  // ── Expressions ─────────────────────────────────────────────────────────────

  private bind(value: Bindable<unknown>, scope: Scope, controlId: string): unknown {
    return isExpression(value) ? this.eval(value.expression, scope, controlId) : value;
  }

  private eval(expression: string, scope: Scope, controlId: string): unknown {
    const ctx: EvaluationContext = {
      row: scope.row,
      rows: scope.rows,
      parent: this.parent,
      params: this.params,
      locale: this.locale,
      currency: this.currency,
      now: this.now,
    };
    try {
      return evaluate(expression, ctx);
    } catch (e) {
      this.problem('expression', controlId, `${(e as Error).message} — in: ${expression}`);
      return ERROR_TEXT;
    }
  }

  private truthy(v: unknown): boolean {
    return v !== null && v !== undefined && v !== false && v !== 0 && v !== '' && v !== ERROR_TEXT;
  }

  private problem(code: LayoutProblem['code'], controlId: string | undefined, message: string): void {
    const key = `${code}|${controlId}|${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.problems.push({ code, controlId, message });
  }
}

function fitImage(
  fit: 'contain' | 'cover' | 'stretch' | 'none',
  box: { x: number; y: number; width: number; height: number },
  iw: number,
  ih: number,
): { x: number; y: number; width: number; height: number } {
  if (fit === 'stretch' || !iw || !ih) return { ...box };
  const scale = fit === 'none' ? 1 : (fit === 'contain' ? Math.min : Math.max)(box.width / iw, box.height / ih);
  const width = iw * scale;
  const height = ih * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** Moves an item by (dx, dy). */
export function translate(item: LayoutItem, dx: number, dy: number): LayoutItem {
  switch (item.kind) {
    case 'line':
      return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
    case 'text':
      return { ...item, x: item.x + dx, y: item.y + dy, lines: item.lines.map((l) => ({ ...l, x: l.x + dx, baseline: l.baseline + dy })) };
    case 'image':
      return { ...item, x: item.x + dx, y: item.y + dy, clip: { ...item.clip, x: item.clip.x + dx, y: item.clip.y + dy } };
    default:
      return { ...item, x: item.x + dx, y: item.y + dy };
  }
}
