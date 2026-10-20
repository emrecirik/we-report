import { calculatedFieldMap, resolveReportData, toRows } from '../data/data-source';
import { resolveParameters } from '../data/web-service';
import { DEFAULT_WATERMARK_COLOR } from '../definition/blank-report';
import { PageGeometry, resolvePageGeometry } from '../definition/page';
import {
  Band,
  Bindable,
  ChartControl,
  CrosstabControl,
  TableCell,
  TableControl,
  isExpression,
  ReportControl,
  ReportDefinition,
  SubreportControl,
  TextControl,
} from '../definition/report-definition';
import { evaluate, EvaluationContext } from '../expression/evaluate';
import { FontRegistry } from '../fonts/font-registry';
import { formatValue } from '../format';
import { barcodeItem } from './barcode';
import { aggregate, ChartPoint, chartItems } from './chart';
import { readImage } from './images';
import { LayoutBookmark, LayoutDocument, LayoutItem, LayoutPage, LayoutProblem, TextItem } from './layout-types';
import { resolveStyle, ResolvedStyle } from './style';
import { fitLines, wrapText } from './text-wrap';
import { parseRichText, RichRun, wrapRichText } from './rich-text';
import { toMm } from '../units';

export interface LayoutOptions {
  fonts: FontRegistry;
  /** Rows (or an object holding them) from the host app; replaces the bound data source's data. */
  data?: unknown;
  /** Loaded web-service responses by data source id (see `loadReportData`). */
  sources?: Record<string, unknown>;
  /** Report parameter values by name; defaults apply for missing ones. */
  params?: Record<string, unknown>;
  /**
   * Pictures the host fetched for image addresses: URL → PNG/JPEG `data:` URI, or `''` when it
   * could not be loaded. Missing ones are listed in `LayoutDocument.imageUrls`.
   */
  images?: Record<string, string>;
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
  /** What `[^.field]` reads; the report's parent object unless inside an inner list. */
  parent?: unknown;
  /** Position of `row` in `rows`, for `RowNumber()`. */
  rowIndex?: number;
  /** Page header/footer: detail rows of the earlier pages, for `CarriedSum()`. */
  before?: readonly unknown[];
}

/** A band rendered at the origin; items are relative to its top-left corner. */
interface RenderedBand {
  band: Band;
  scope: Scope;
  height: number;
  items: LayoutItem[];
  /** Items that need the page number (page info controls), rendered once pages are known. */
  deferred: ((page: PageInfo) => LayoutItem[])[];
  /** The section's entry in the document map. */
  bookmark?: string;
}

type Entry =
  | { type: 'band'; rendered: RenderedBand; groupLevel?: number }
  | { type: 'groupStart'; level: number; keepTogether: boolean; end: number }
  | { type: 'groupEnd'; level: number };

const ERROR_TEXT = '#ERR';
const MM_PER_PX = toMm(1, 'px');
/** Sub-reports inside sub-reports deeper than this are not printed (report files are untrusted). */
const MAX_SUBREPORT_DEPTH = 5;
/** A cross table shows at most this many rows and columns (each value of a unique id would be one). */
const MAX_CROSSTAB_ROWS = 500;
const MAX_CROSSTAB_COLUMNS = 50;

/**
 * Lays a report out into pages. Pure and deterministic: the same definition, data, fonts and
 * options always give the same document.
 */
export function layoutReport(definition: ReportDefinition, options: LayoutOptions): LayoutDocument {
  return new LayoutRun(definition, options).run();
}

class LayoutRun {
  private readonly problems: LayoutProblem[] = [];
  private readonly imageUrls = new Set<string>();
  private readonly bookmarks: LayoutBookmark[] = [];
  private readonly reported = new Set<string>();
  private readonly geometry: PageGeometry;
  private readonly locale: string;
  private readonly currency: string;
  private readonly now: Date;
  private parent: unknown;
  private readonly params: Record<string, unknown>;
  private readonly calculated: Record<string, string> | undefined;

  constructor(
    private readonly def: ReportDefinition,
    private readonly options: LayoutOptions,
    /** Set for a sub-report: the row around its box (what `[^.field]` reads) and how deep it is nested. */
    private readonly nesting: { parent: unknown; depth: number } | null = null,
  ) {
    this.geometry = resolvePageGeometry(def.page);
    // A report written for one region keeps its formats wherever it is printed.
    this.locale = def.locale || options.locale || 'en-US';
    this.currency = def.currency || options.currency || 'USD';
    this.now = options.now;
    this.params = resolveParameters(def.parameters, options.params);
    this.calculated = calculatedFieldMap(def);
  }

  run(): LayoutDocument {
    const { rows, parent } = resolveReportData(this.def, this.options.data, this.options.sources);
    this.parent = this.nesting ? this.nesting.parent : parent;
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
      // Group keys first (one per level), then the detail's own sort keys.
      // Report files are untrusted: ignore a malformed sortBy rather than fail the whole report.
      const sortBy = Array.isArray(detail?.sortBy) ? detail.sortBy.filter((k) => typeof k?.expression === 'string' && k.expression.trim()) : [];
      for (const row of rows) {
        keys.set(row, [
          ...groupHeaders.map((h) => this.groupKey(h, row)),
          ...sortBy.map((k) => this.sortKey(k.expression, row, detail!.id)),
        ]);
      }
      const orders = [
        ...groupHeaders.map((h) => (h.groupBy ? (h.sort ?? 'asc') : 'none')),
        ...sortBy.map((k) => (k.descending ? 'desc' : 'asc') as 'asc' | 'desc'),
      ];
      const sorted = this.sortRows(rows, orders, keys);
      this.emitGroups(entries, 0, sorted, groupHeaders, keys, detail);
    }

    const reportFooter = byKind('reportFooter');
    if (reportFooter) {
      entries.push({ type: 'band', rendered: this.renderBand(reportFooter, { row: allRows[allRows.length - 1], rows: allRows }) });
    }

    const pages = this.paginate(entries, byKind('pageHeader'), byKind('pageFooter'), first);
    return {
      pages,
      problems: this.problems,
      ...(this.imageUrls.size ? { imageUrls: [...this.imageUrls] } : {}),
      ...(this.bookmarks.length ? { bookmarks: this.bookmarks } : {}),
    };
  }

  // ── Grouping ────────────────────────────────────────────────────────────────

  private groupKey(header: Band, row: unknown): unknown {
    if (!header.groupBy) return null;
    const v = this.eval(header.groupBy.expression, { row, rows: [] }, header.id);
    return v instanceof Date ? v.getTime() : v;
  }

  private sortKey(expression: string, row: unknown, bandId: string): unknown {
    const v = this.eval(expression, { row, rows: [] }, bandId);
    return v instanceof Date ? v.getTime() : v;
  }

  private sortRows(rows: unknown[], orders: ('asc' | 'desc' | 'none')[], keys: Map<unknown, unknown[]>): unknown[] {
    const collator = new Intl.Collator(this.locale, { numeric: true });
    const cmp = (a: unknown, b: unknown): number => {
      if (a === b) return 0;
      if (a === null || a === undefined) return -1;
      if (b === null || b === undefined) return 1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return collator.compare(String(a), String(b));
    };
    if (!orders.some((o) => o !== 'none')) return rows;
    // Array.prototype.sort is stable, so rows keep their order inside a group.
    return [...rows].sort((ra, rb) => {
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
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
      if (detail) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          entries.push({ type: 'band', rendered: this.renderBand(detail, { row, rows, rowIndex: i }) });
          this.emitInnerList(entries, row);
        }
      }
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

  /** Width of one column of a band: the content width, or a cell of a multi-column detail. */
  private cellWidth(band: Band): number {
    const count = band.kind === 'detail' ? Math.max(1, Math.floor(band.columns?.count ?? 1)) : 1;
    const gap = band.columns?.gap ?? 0;
    return (this.geometry.contentWidth - gap * (count - 1)) / count;
  }

  /**
   * The inner list of one detail row: its header, a band per item, its footer. Nothing when empty.
   * The header stays with the first item on one page.
   * shortcut: the header is not repeated when the list continues on the next page.
   */
  private emitInnerList(entries: Entry[], row: unknown): void {
    const bands = this.def.bands;
    const sub = bands.find((b) => b.kind === 'subDetail');
    if (!sub?.rowsPath?.trim()) return;
    const value = this.eval(`[${sub.rowsPath}]`, { row, rows: [] }, sub.id);
    const items = Array.isArray(value) ? value : [];
    if (!items.length) return;
    const header = bands.find((b) => b.kind === 'subHeader');
    const footer = bands.find((b) => b.kind === 'subFooter');
    const scope = (index: number) => ({ row: items[index], rows: items, parent: row, rowIndex: index });
    if (header) {
      // A keep-together block of the header and the first item (level past every group: no repeats touched).
      const level = bands.filter((b) => b.kind === 'groupHeader').length;
      const start = entries.length;
      entries.push({ type: 'groupStart', level, keepTogether: true, end: -1 });
      entries.push({ type: 'band', rendered: this.renderBand(header, scope(0)) });
      entries.push({ type: 'band', rendered: this.renderBand(sub, scope(0)) });
      entries.push({ type: 'groupEnd', level });
      (entries[start] as Extract<Entry, { type: 'groupStart' }>).end = entries.length - 1;
    }
    for (let i = header ? 1 : 0; i < items.length; i++) entries.push({ type: 'band', rendered: this.renderBand(sub, scope(i)) });
    if (footer) entries.push({ type: 'band', rendered: this.renderBand(footer, { row: items[items.length - 1], rows: items, parent: row }) });
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  private paginate(entries: Entry[], pageHeader: Band | undefined, pageFooter: Band | undefined, firstRow: unknown): LayoutPage[] {
    const { margins } = this.def.page;
    const contentHeight = this.geometry.contentHeight;
    const headerHeight = pageHeader?.height ?? 0;
    const footerHeight = pageFooter?.height ?? 0;
    // Lengths add up with float drift (228.6 + 25.4 = 254.00000000000003): allow a hair.
    const bodyBottom = contentHeight === null ? Infinity : contentHeight - footerHeight + 0.01;

    interface PageState {
      items: LayoutItem[];
      rows: unknown[];
      deferred: { y: number; render: (page: PageInfo) => LayoutItem[] }[];
      endY: number;
      /** Pages are numbered within their run; a group that resets the numbering starts a new run. */
      run: number;
    }
    let run = 0;
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
      page = { items: [], rows: [], deferred: [], endY: 0, run };
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
      // A band that fits on no page starts right here and is cut, rather than leaving this page empty.
      // Side-by-side cells are never cut, so they still move to a new page.
      const fitsAPage = columns > 1 || r.height <= bodyBottom - headerHeight;
      const resets = r.band.kind === 'groupHeader' && !!r.band.resetPageNumber && entry.groupLevel !== undefined;
      // A header that keeps with its first row needs room for everything up to that row.
      let withFirstRow = r.height;
      if (r.band.kind === 'groupHeader' && r.band.keepWithFirstRow && !fresh) {
        for (let j = i + 1; j < entries.length; j++) {
          const e = entries[j];
          if (e.type !== 'band') continue;
          withFirstRow += e.rendered.height;
          if (e.rendered.band.kind === 'detail') break;
        }
      }
      const orphan = withFirstRow > r.height && y + withFirstRow > bodyBottom && headerHeight + withFirstRow <= bodyBottom;
      // The first group stays under the report header; every later one starts a page of its own.
      if (column === 0 && (breakPending || orphan || ((r.band.pageBreakBefore || (resets && run > 0)) && !fresh) || (!fresh && y + r.height > bodyBottom && (fitsAPage || bodyBottom - y < 10)))) {
        if (entry.groupLevel !== undefined) repeating.length = entry.groupLevel;
        startPage();
      }
      if (resets) page.run = ++run;
      if (r.bookmark && !this.nesting) {
        const level = r.band.kind === 'groupHeader' ? (entry.groupLevel ?? 0) : this.def.bands.filter((b) => b.kind === 'groupHeader').length;
        this.bookmarks.push({ title: r.bookmark, pageIndex: pages.length - 1, y: margins.top + (columns > 1 && column > 0 ? rowTop : y), level });
      }
      if (columns > 1) {
        // shortcut: the first cell of a row decides the page break; a taller can-grow cell later in
        // the row may overlap the page footer. Measure the whole row first if that becomes a need.
        const gap = r.band.columns?.gap ?? 0;
        if (column === 0) rowTop = y;
        y = rowTop;
        put(r, column * (this.cellWidth(r.band) + gap));
        rowHeight = Math.max(rowHeight, r.height);
        y = rowTop;
        page.endY = rowTop + rowHeight;
        if (++column === columns) endRow();
      } else {
        // A band taller than a whole page (a long sub-report or text) is cut between its items and
        // text lines onto the following pages.
        let rest = r;
        while (y + rest.height > bodyBottom && bodyBottom - y > 1) {
          const cut = cutPoint(rest.items, bodyBottom - y);
          const [top, bottom] = splitItems(rest.items, cut);
          // Page numbers go with the piece they start in (found by drawing them for a sample page).
          const below = (render: (page: PageInfo) => LayoutItem[]) => Math.min(...render({ number: 1, count: 1 }).map((i) => extent(i)[0])) >= cut - EPS;
          const upper = rest.deferred.filter((render) => !below(render));
          const lower = rest.deferred.filter(below).map((render) => (page: PageInfo) => render(page).map((i) => translate(i, 0, -cut)));
          put({ ...rest, items: top, deferred: upper, height: cut });
          startPage();
          // The row counts on the page where it starts.
          rest = { ...rest, scope: { ...rest.scope, row: undefined }, items: bottom, deferred: lower, height: rest.height - cut };
        }
        put(rest);
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
    const before: unknown[] = [];
    const runLength = new Map<number, number>();
    for (const p of pages) runLength.set(p.run, (runLength.get(p.run) ?? 0) + 1);
    let runStart = 0;
    return pages.map((state, index) => {
      if (index > 0 && state.run !== pages[index - 1].run) {
        runStart = index;
        before.length = 0;
      }
      const info: PageInfo = runLength.size > 1 ? { number: index - runStart + 1, count: runLength.get(state.run)! } : { number: index + 1, count };
      const scope: Scope = { row: state.rows[0] ?? firstRow, rows: state.rows, before: [...before] };
      before.push(...state.rows);
      const items: LayoutItem[] = [];
      const pageHeight = this.geometry.height ?? margins.top + state.endY + footerHeight + margins.bottom;
      // Mirrored margins: even pages move the content over by the difference of the two margins.
      const shift = this.def.page.mirrorMargins && index % 2 === 1 ? margins.right - margins.left : 0;
      const left = margins.left + shift;
      const place = (band: Band | undefined, top: number) => {
        if (!band) return;
        const r = this.renderBand(band, scope);
        for (const item of r.items) items.push(translate(item, left, top));
        for (const render of r.deferred) for (const item of render(info)) items.push(translate(item, left, top));
      };
      if (this.def.page.color) items.push({ kind: 'rect', x: 0, y: 0, width, height: pageHeight, fill: this.def.page.color });
      items.push(...this.watermark(scope, width, pageHeight));
      place(pageHeader, margins.top);
      items.push(...(shift ? state.items.map((item) => translate(item, shift, 0)) : state.items));
      for (const d of state.deferred) for (const item of d.render(info)) items.push(translate(item, left, d.y));
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
    // A hidden section takes no room (its rows still count in totals: they are data, not print).
    if (band.visible?.expression.trim() && !this.truthy(this.eval(band.visible.expression, scope, band.id))) {
      return { band, scope, height: 0, items, deferred };
    }
    const mark = band.bookmark === undefined ? undefined : this.bind(band.bookmark, scope, band.id);
    const bookmark = mark === null || mark === undefined || mark === ERROR_TEXT || mark === '' ? undefined : mark instanceof Date ? formatValue(mark, undefined, { locale: this.locale, currency: this.currency }) : String(mark);
    let height = band.height;
    const shown = band.controls.filter((c) => c.visible === undefined || this.truthy(this.bind(c.visible, scope, c.id)));
    // An item that grows pushes down the items below it (that share its columns), as in desktop
    // designers. Top to bottom, so a push carries on down the section.
    // An item that starts up to 1 mm inside the grown one's box (a sloppy drop) still counts as below it.
    const growths: { x1: number; x2: number; top: number; bottom: number; delta: number }[] = [];
    const shiftOf = (c: ReportControl) =>
      growths.reduce((m, g) => (c.y > g.top && g.bottom <= c.y + 1 && g.x1 < c.x + c.width && g.x2 > c.x ? Math.max(m, g.delta) : m), 0);
    // Every item first at its natural size decides the height; stretching items then grow by as
    // much as the section grew, so they keep reaching its bottom.
    const results = new Map<ReportControl, ReturnType<typeof this.renderControl>>();
    for (const control of [...shown].sort((a, b) => a.y - b.y)) {
      const shift = shiftOf(control);
      const result = this.renderControl(shift ? { ...control, y: control.y + shift } : control, scope);
      results.set(control, result);
      if (result.height > control.height + 0.01 || shift) {
        growths.push({ x1: control.x, x2: control.x + control.width, top: control.y, bottom: control.y + control.height, delta: shift + Math.max(0, result.height - control.height) });
      }
      height = Math.max(height, control.y + shift + result.height);
    }
    const growth = height - band.height;
    for (const control of shown) {
      // A horizontal line marks a row's edge; stretching would move it to the middle.
      if (!control.stretch || growth <= 0.01 || (control.type === 'line' && control.direction === 'horizontal')) continue;
      const y = control.y + shiftOf(control);
      const natural = results.get(control)!.height;
      results.set(control, this.renderControl({ ...control, y, height: Math.max(natural, control.height + growth) }, scope));
    }
    for (const control of shown) {
      const result = results.get(control)!;
      if (result.deferred) deferred.push(result.deferred);
      items.push(...result.items);
    }
    const striped = band.alternateBackgroundColor && scope.rowIndex !== undefined && scope.rowIndex % 2 === 1;
    const fill = striped ? band.alternateBackgroundColor : band.backgroundColor;
    if (fill) {
      items.unshift({ kind: 'rect', x: 0, y: 0, width: this.cellWidth(band), height, fill });
    }
    return { band, scope, height, items, deferred, bookmark };
  }

  private renderControl(
    c: ReportControl,
    scope: Scope,
  ): { items: LayoutItem[]; height: number; deferred?: (page: PageInfo) => LayoutItem[] } {
    const style = resolveStyle(this.def, c.style, this.overridesFor(c, scope));
    const box = { x: c.x, y: c.y, width: c.width, height: c.height };
    switch (c.type) {
      case 'text': {
        if (c.markup) {
          const runs = this.richRuns(c, scope);
          const height = c.canGrow ? Math.max(c.height, this.richHeight(runs, style, c.width)) : c.height;
          return { items: this.richTextBox(runs, style, { ...box, height }), height };
        }
        const text = this.textOf(c, scope);
        const height = c.canGrow ? Math.max(c.height, this.measureTextHeight(text, style, c.width)) : c.height;
        return { items: this.textBox(text, style, { ...box, height }), height };
      }
      case 'table':
        return this.renderTable(c, scope);
      case 'crosstab':
        return this.renderCrosstab(c, scope);
      case 'subreport': {
        const inner = this.renderSubreport(c, scope);
        const height = Math.max(c.height, inner.height);
        return { items: [...this.decorations(style, { ...box, height }), ...inner.items], height };
      }
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
        // An address is drawn from the picture the host fetched for it (see `LayoutOptions.images`).
        const remote = typeof src === 'string' && /^https?:\/\//i.test(src.trim());
        const data = remote ? this.options.images?.[(src as string).trim()] : src;
        if (remote && data === undefined) {
          this.imageUrls.add((src as string).trim());
        } else if (remote && data === '') {
          this.problem('image', c.id, `The picture could not be loaded: ${src}`);
        } else if (typeof data === 'string' && data) {
          const info = readImage(data);
          if (!info) {
            this.problem('image', c.id, 'Only PNG and JPEG pictures are supported.');
          } else {
            items.push({ kind: 'image', ...fitImage(c.fit, box, info.width * MM_PER_PX, info.height * MM_PER_PX), clip: box, src: data });
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

  /**
   * A sub-report laid out on a continuous page as wide as its box. Its rows come from the `rows`
   * formula or its own data source (it may also use the outer report's sources), then `filter`.
   * shortcut: page numbers inside a sub-report count its own pages (always 1 / 1).
   */
  private renderSubreport(c: SubreportControl, scope: Scope): { items: LayoutItem[]; height: number } {
    const report = c.report;
    const depth = (this.nesting?.depth ?? 0) + 1;
    if (!report || !Array.isArray(report.bands) || depth > MAX_SUBREPORT_DEPTH) {
      this.problem('data', c.id, depth > MAX_SUBREPORT_DEPTH ? `Sub-reports are nested deeper than ${MAX_SUBREPORT_DEPTH}.` : 'The sub-report has no design.');
      return { items: [], height: 0 };
    }
    const ownSources = Array.isArray(report.dataSources) ? report.dataSources : [];
    const dataSources = [...ownSources, ...this.def.dataSources.filter((d) => !ownSources.some((o) => o.id === d.id))];
    const values: Record<string, unknown> = {};
    for (const p of c.parameters ?? []) if (p?.name) values[p.name] = this.bind(p.value, scope, c.id);
    const params = resolveParameters(report.parameters, values);
    let rows: unknown[] | null;
    if (c.rows?.expression.trim()) {
      const value = this.eval(c.rows.expression, scope, c.id);
      rows = toRows(value === ERROR_TEXT ? null : value);
    } else {
      rows = resolveReportData({ ...report, dataSources }, undefined, this.options.sources).rows;
    }
    const filter = c.filter?.expression.trim();
    if (rows && filter) {
      const all = rows;
      rows = all.filter((row) => this.truthy(this.eval(filter, { row, rows: all, parent: scope.row }, c.id, params)));
    }
    const definition: ReportDefinition = {
      ...report,
      dataSources,
      dataMember: undefined,
      watermark: undefined,
      styles: report.styles ?? {},
      page: { paper: 'custom', orientation: 'portrait', width: c.width, height: null, margins: { top: 0, right: 0, bottom: 0, left: 0 }, displayUnit: 'mm' },
    };
    let doc: LayoutDocument;
    try {
      doc = new LayoutRun(
        definition,
        { ...this.options, data: rows ?? undefined, params, locale: this.locale, currency: this.currency },
        { parent: scope.row, depth },
      ).run();
    } catch (e) {
      this.problem('data', c.id, (e as Error).message);
      return { items: [], height: 0 };
    }
    for (const p of doc.problems) this.problem(p.code, p.controlId ?? c.id, p.message);
    for (const url of doc.imageUrls ?? []) this.imageUrls.add(url);
    // A page break inside it starts another continuous page: stack them.
    const items: LayoutItem[] = [];
    let height = 0;
    for (const page of doc.pages) {
      for (const item of page.items) items.push(translate(item, c.x, c.y + height));
      height += page.height;
    }
    return { items, height };
  }

  /** The cross table of the band's rows; rows and columns in ascending order of their values. */
  private renderCrosstab(c: CrosstabControl, scope: Scope): { items: LayoutItem[]; height: number } {
    const style = resolveStyle(this.def, c.style, this.overridesFor(c, scope));
    const options = { locale: this.locale, currency: this.currency };
    const kind = c.aggregate ?? 'sum';
    const totals = c.totals !== false;
    type Key = { label: string; sort: unknown };
    const rowKeys = new Map<string, Key>();
    const colKeys = new Map<string, Key>();
    const cells = new Map<string, number[]>();
    const rowTotals = new Map<string, number[]>();
    const colTotals = new Map<string, number[]>();
    const grand: number[] = [];
    const add = (map: Map<string, number[]>, key: string, value: number) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    const keyOf = (v: unknown): Key => {
      if (v instanceof Date) return { label: formatValue(v, undefined, options), sort: v.getTime() };
      return { label: v === null || v === undefined || v === ERROR_TEXT ? '' : typeof v === 'string' ? v : formatValue(v, undefined, options), sort: v ?? '' };
    };
    const ready = [c.rows, c.columns, c.value].every((e) => e?.expression?.trim());
    for (const row of ready ? scope.rows : []) {
      const rowScope = { row, rows: scope.rows };
      const r = keyOf(this.eval(c.rows.expression, rowScope, c.id));
      const k = keyOf(this.eval(c.columns.expression, rowScope, c.id));
      const value = numberOrNull(this.eval(c.value.expression, rowScope, c.id));
      if (!rowKeys.has(r.label)) rowKeys.set(r.label, r);
      if (!colKeys.has(k.label)) colKeys.set(k.label, k);
      const cell = `${r.label}\u0000${k.label}`;
      if (!cells.has(cell)) cells.set(cell, []);
      // Count counts rows, whatever the value formula returns; the others skip empty values.
      if (value === null && kind !== 'count') continue;
      const v = value ?? 0;
      cells.get(cell)!.push(v);
      add(rowTotals, r.label, v);
      add(colTotals, k.label, v);
      grand.push(v);
    }
    const collator = new Intl.Collator(this.locale, { numeric: true });
    const order = (a: Key, b: Key) =>
      typeof a.sort === 'number' && typeof b.sort === 'number' ? a.sort - b.sort : collator.compare(String(a.sort), String(b.sort));
    if (rowKeys.size > MAX_CROSSTAB_ROWS || colKeys.size > MAX_CROSSTAB_COLUMNS) {
      this.problem('overflow', c.id, `The cross table shows the first ${MAX_CROSSTAB_ROWS} rows and ${MAX_CROSSTAB_COLUMNS} columns of ${rowKeys.size} × ${colKeys.size}.`);
    }
    const rows = [...rowKeys.values()].sort(order).slice(0, MAX_CROSSTAB_ROWS).map((k) => k.label);
    const cols = [...colKeys.values()].sort(order).slice(0, MAX_CROSSTAB_COLUMNS).map((k) => k.label);
    const values = (r?: string, k?: string) =>
      (r !== undefined && k !== undefined ? cells.get(`${r}\u0000${k}`) : r !== undefined ? rowTotals.get(r) : k !== undefined ? colTotals.get(k) : grand) ?? [];
    const show = (list: number[], always: boolean) => (list.length || always ? formatValue(aggregate(kind, list), c.format || undefined, options) : '');

    const headerWidth = c.rowHeaderWidth ?? Math.min(40, c.width / 3);
    const columnCount = cols.length + (totals ? 1 : 0);
    const columnWidth = (c.width - headerWidth) / Math.max(1, columnCount);
    if (columnWidth < 6) this.problem('overflow', c.id, `The cross table has ${columnCount} columns; they are too narrow to read.`);
    const rowHeight = c.rowHeight ?? 6;
    const middle = { ...style, verticalAlign: 'middle' as const };
    const head = { ...middle, bold: true };
    const number = { ...middle, textAlign: 'right' as const };
    const total = c.totalLabel ?? 'Σ';
    const items: LayoutItem[] = [];
    const cell = (text: string, st: ResolvedStyle, column: number, line: number) => {
      const x = column < 0 ? c.x : c.x + headerWidth + column * columnWidth;
      items.push(...this.textBox(text, st, { x, y: c.y + line * rowHeight, width: column < 0 ? headerWidth : columnWidth, height: rowHeight }));
    };
    cell(c.title ?? '', head, -1, 0);
    cols.forEach((k, i) => cell(k, { ...head, textAlign: 'right' }, i, 0));
    if (totals) cell(total, { ...head, textAlign: 'right' }, cols.length, 0);
    rows.forEach((r, line) => {
      cell(r, head, -1, line + 1);
      cols.forEach((k, i) => cell(show(values(r, k), false), number, i, line + 1));
      if (totals) cell(show(values(r), true), { ...number, bold: true }, cols.length, line + 1);
    });
    if (totals) {
      const line = rows.length + 1;
      cell(total, head, -1, line);
      cols.forEach((k, i) => cell(show(values(undefined, k), true), { ...number, bold: true }, i, line));
      cell(show(values(), true), { ...number, bold: true }, cols.length, line);
    }
    const lines = 1 + rows.length + (totals ? 1 : 0);
    return { items, height: Math.max(c.height, lines * rowHeight) };
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
    // A sparkline may leave the category empty: then every row is one point, in order.
    const byRow = c.chartType === 'sparkline' && !c.category.expression.trim();
    if ((!byRow && !c.category.expression.trim()) || !c.value.expression.trim()) return [];
    const groups = new Map<string, number[]>();
    const options = { locale: this.locale, currency: this.currency };
    let rows = scope.rows;
    if (c.rows?.expression.trim()) {
      const value = this.eval(c.rows.expression, scope, c.id);
      rows = toRows(value === ERROR_TEXT ? null : value);
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowScope = { row, rows, parent: c.rows?.expression.trim() ? scope.row : scope.parent };
      if (byRow) {
        const value = numberOrNull(this.eval(c.value.expression, rowScope, c.id));
        if (value !== null) groups.set(String(i), [value]);
        continue;
      }
      const category = this.eval(c.category.expression, rowScope, c.id);
      const label = category instanceof Date ? formatValue(category, undefined, options) : String(category ?? '');
      const value = numberOrNull(this.eval(c.value.expression, rowScope, c.id));
      if (!groups.has(label)) groups.set(label, []);
      // Count counts rows, whatever the value formula returns; the others skip empty values.
      if (value !== null || c.aggregate === 'count') groups.get(label)!.push(value ?? 0);
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

  /** The runs of a rich text: its fixed text or formula result, with `{formula}` fields filled in. */
  private richRuns(c: TextControl, scope: Scope): RichRun[] {
    const value = this.bind(c.text, scope, c.id);
    const markup = value === null || value === undefined ? '' : String(value);
    const options = { locale: this.locale, currency: this.currency };
    return parseRichText(markup, (expression) => {
      const v = this.eval(expression, scope, c.id);
      return v === null || v === undefined ? '' : typeof v === 'string' ? v : formatValue(v, undefined, options);
    });
  }

  private richFont(style: ResolvedStyle, run: RichRun) {
    return this.options.fonts.resolve(style.fontFamily, style.bold || run.bold, style.italic || run.italic);
  }

  private richHeight(runs: RichRun[], style: ResolvedStyle, width: number): number {
    const lines = wrapRichText(runs, (r) => this.richFont(style, r), style.fontSize, Math.max(0, width - 2 * style.padding));
    // Lines are spaced by the base font, as `richTextBox` places them.
    return lines.length * this.richFont(style, { text: '', bold: false, italic: false, underline: false }).lineHeight(style.fontSize) + 2 * style.padding;
  }

  /** Like `textBox`, one text item per styled piece of a line. */
  private richTextBox(runs: RichRun[], style: ResolvedStyle, box: { x: number; y: number; width: number; height: number }): LayoutItem[] {
    const items = this.decorations(style, box);
    if (!runs.length) return items;
    const size = style.fontSize;
    const pad = style.padding;
    const innerWidth = Math.max(0, box.width - 2 * pad);
    const base = this.richFont(style, { text: '', bold: false, italic: false, underline: false });
    const lineHeight = base.lineHeight(size);
    const ascent = base.ascent(size);
    let lines = wrapRichText(runs, (r) => this.richFont(style, r), size, innerWidth);
    // The same rule as plain text: at least one line, cut where the box ends.
    const maxLines = Math.max(1, Math.floor((box.height - 2 * pad) / lineHeight + 0.01));
    lines = lines.slice(0, maxLines);
    const free = Math.max(0, box.height - 2 * pad - lines.length * lineHeight);
    const offset = style.verticalAlign === 'middle' ? free / 2 : style.verticalAlign === 'bottom' ? free : 0;
    lines.forEach((line, i) => {
      const dx = style.textAlign === 'center' ? (innerWidth - line.width) / 2 : style.textAlign === 'right' ? innerWidth - line.width : 0;
      const baseline = box.y + pad + offset + ascent + i * lineHeight;
      for (const s of line.segments) {
        if (!s.text.trim()) continue;
        const font = this.richFont(style, s);
        items.push({
          kind: 'text',
          ...box,
          lines: [{ text: s.text, x: box.x + pad + dx + s.x, baseline, width: s.width }],
          fontKey: font.key,
          fontFamily: font.family,
          bold: font.variant === 'bold' || font.variant === 'boldItalic',
          italic: font.variant === 'italic' || font.variant === 'boldItalic',
          size,
          color: style.color,
          underline: style.underline || s.underline,
        });
      }
    });
    return items;
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
    const { lines } = fitLines(text, font, size, pad, box.width, box.height);
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

  private eval(expression: string, scope: Scope, controlId: string, params = this.params): unknown {
    const ctx: EvaluationContext = {
      row: scope.row,
      rows: scope.rows,
      rowIndex: scope.rowIndex,
      before: scope.before,
      calculated: this.calculated,
      parent: scope.parent ?? this.parent,
      params,
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

const EPS = 0.01;

/** A number for aggregating, or `null` for an empty or non-numeric value (which is skipped). */
function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === ERROR_TEXT) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Top and bottom of an item. */
function extent(item: LayoutItem): [number, number] {
  return item.kind === 'line' ? [Math.min(item.y1, item.y2), Math.max(item.y1, item.y2)] : [item.y, item.y + item.height];
}

/**
 * Where to cut a band that needs more than `room`: the lowest point at or above `room` that cuts
 * through no text line, picture, barcode or chart. Boxes and lines can be cut anywhere. Falls back
 * to `room` when nothing fits (a picture taller than the page).
 */
function cutPoint(items: LayoutItem[], room: number): number {
  const solid: [number, number][] = [];
  for (const item of items) {
    if (item.kind === 'rect' || item.kind === 'line') continue;
    if (item.kind === 'text') {
      const step = item.lines.length > 1 ? item.lines[1].baseline - item.lines[0].baseline : (item.size * 25.4 * 1.2) / 72;
      for (const l of item.lines) solid.push([l.baseline - step * 0.8, l.baseline + step * 0.2]);
    } else {
      solid.push(extent(item));
    }
  }
  const candidates = solid.flat().filter((c) => c > EPS && c <= room + EPS);
  candidates.push(room);
  let best = 0;
  for (const c of candidates) {
    if (c > best && !solid.some(([a, b]) => a < c - EPS && b > c + EPS)) best = c;
  }
  return best > EPS ? Math.min(best, room) : room;
}

/** Items above `cut`, and those below it moved up by `cut`; boxes, lines and texts across it are split. */
function splitItems(items: LayoutItem[], cut: number): [LayoutItem[], LayoutItem[]] {
  const top: LayoutItem[] = [];
  const bottom: LayoutItem[] = [];
  const below = (item: LayoutItem) => bottom.push(translate(item, 0, -cut));
  for (const item of items) {
    const [a, b] = extent(item);
    if (b <= cut + EPS) top.push(item);
    else if (a >= cut - EPS) below(item);
    else if (item.kind === 'rect') {
      top.push({ ...item, height: cut - item.y });
      below({ ...item, y: cut, height: item.y + item.height - cut });
    } else if (item.kind === 'line') {
      const t = (cut - item.y1) / (item.y2 - item.y1);
      const x = item.x1 + (item.x2 - item.x1) * t;
      const [upper, lower] = item.y1 < item.y2 ? [[item.x1, item.y1], [item.x2, item.y2]] : [[item.x2, item.y2], [item.x1, item.y1]];
      top.push({ ...item, x1: upper[0], y1: upper[1], x2: x, y2: cut });
      below({ ...item, x1: x, y1: cut, x2: lower[0], y2: lower[1] });
    } else if (item.kind === 'text') {
      const lines = item.lines.filter((l) => l.baseline < cut);
      top.push({ ...item, height: cut - item.y, lines });
      below({ ...item, y: cut, height: item.y + item.height - cut, lines: item.lines.filter((l) => l.baseline >= cut) });
    } else {
      // Pictures cannot be cut: one taller than the page stays with the top part and runs over.
      top.push(item);
    }
  }
  return [top, bottom];
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
