import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  Band,
  BARCODE_SYMBOLOGIES,
  Bindable,
  BorderStyle,
  ChartAggregate,
  ChartType,
  FormattingRule,
  TableCell,
  TextAlign,
  Watermark,
  isExpression,
  LabelSheet,
  LABEL_SHEETS,
  applyLabelSheet,
  PAPER_SIZES,
  ReportControl,
  ReportStyle,
  resolveStyle,
  importReport,
} from 'we-report-core';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { WeReportIcons } from '../we-report-icons';
import { WeReportLocale } from '../we-report-locale';
import { BindableInputComponent } from './bindable-input.component';
import { DesignerField } from './designer-fields';
import { AlignEdge, DesignerState } from './designer-state';
import { columnOf, deleteColumn, deleteRow, insertColumn, insertRow, mergeRight, splitCell, syncSize } from './table-ops';
import { buildCondition, CONDITION_OPS, parseCondition, SimpleCondition } from './formatting-rule';

const FORMATS: { value: string; key: keyof WeReportLocale }[] = [
  { value: '', key: 'formatNone' },
  { value: 'n0', key: 'formatNumber0' },
  { value: 'n2', key: 'formatNumber2' },
  { value: 'c2', key: 'formatCurrency' },
  { value: 'p0', key: 'formatPercent' },
  { value: 'dd.MM.yyyy', key: 'formatDate' },
  { value: 'dd.MM.yyyy HH:mm', key: 'formatDateTime' },
];

const CHART_TYPES: { type: ChartType; label: keyof WeReportLocale }[] = [
  { type: 'column', label: 'chartColumn' },
  { type: 'bar', label: 'chartBar' },
  { type: 'line', label: 'chartLine' },
  { type: 'pie', label: 'chartPie' },
  { type: 'doughnut', label: 'chartDoughnut' },
  { type: 'sparkline', label: 'chartSparkline' },
];

const AGGREGATES: { value: ChartAggregate; label: keyof WeReportLocale }[] = [
  { value: 'sum', label: 'aggSum' },
  { value: 'count', label: 'aggCount' },
  { value: 'avg', label: 'aggAvg' },
  { value: 'min', label: 'aggMin' },
  { value: 'max', label: 'aggMax' },
];

/** Regions offered for a report's number, date and word formats (any BCP 47 tag works in the file). */
const CULTURES: { id: string; name: string }[] = [
  { id: 'tr-TR', name: 'Türkçe (Türkiye)' },
  { id: 'en-US', name: 'English (United States)' },
  { id: 'en-GB', name: 'English (United Kingdom)' },
  { id: 'de-DE', name: 'Deutsch (Deutschland)' },
  { id: 'fr-FR', name: 'Français (France)' },
  { id: 'es-ES', name: 'Español (España)' },
  { id: 'it-IT', name: 'Italiano (Italia)' },
  { id: 'nl-NL', name: 'Nederlands (Nederland)' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'ru-RU', name: 'Русский (Россия)' },
  { id: 'ar-SA', name: 'العربية (السعودية)' },
  { id: 'ja-JP', name: '日本語 (日本)' },
];

const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'RUB', 'SAR', 'AED', 'BRL'];

const ALIGN_ACTIONS: { edge: AlignEdge; icon: keyof WeReportIcons; label: keyof WeReportLocale & `arrange${string}` }[] = [
  { edge: 'left', icon: 'arrangeLeft', label: 'arrangeLeft' },
  { edge: 'center', icon: 'arrangeCenter', label: 'arrangeCenter' },
  { edge: 'right', icon: 'arrangeRight', label: 'arrangeRight' },
  { edge: 'top', icon: 'arrangeTop', label: 'arrangeTop' },
  { edge: 'middle', icon: 'arrangeMiddle', label: 'arrangeMiddle' },
  { edge: 'bottom', icon: 'arrangeBottom', label: 'arrangeBottom' },
];

/** Plain-language properties of the selection: a control, a band, or the report itself. */
@Component({
  selector: 'we-report-property-panel',
  standalone: true,
  imports: [BindableInputComponent, WeReportIconPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './property-panel.component.html',
  styleUrl: './property-panel.component.scss',
})
export class PropertyPanelComponent {
  readonly strings = input.required<WeReportLocale>();
  readonly fields = input<DesignerField[]>([]);
  readonly fontFamilies = input<string[]>([]);
  readonly advanced = input(false);
  /** Lists inside a row that an inner list can repeat over. */
  readonly lists = input<string[]>([]);

  protected readonly state = inject(DesignerState);
  protected readonly papers = PAPER_SIZES;
  protected readonly symbologies = BARCODE_SYMBOLOGIES;
  protected readonly formats = FORMATS;
  protected readonly alignActions = ALIGN_ACTIONS;
  protected readonly chartTypes = CHART_TYPES;
  protected readonly cultures = CULTURES;
  protected readonly labelSheets = LABEL_SHEETS;
  protected readonly currencies = CURRENCIES;
  protected readonly aggregates = AGGREGATES;
  protected readonly conditionOps = CONDITION_OPS;

  protected readonly controls = computed(() => this.state.selectedControls());
  protected readonly control = computed<ReportControl | null>(() => (this.controls().length === 1 ? this.controls()[0] : null));
  protected readonly band = computed<Band | null>(() => this.state.selectedBand());
  protected readonly report = computed(() => this.state.report());
  protected readonly style = computed(() => {
    const c = this.controls()[0];
    return c ? resolveStyle(this.report(), c.style, c.styleOverrides) : null;
  });
  protected readonly hasText = computed(() => this.controls().some((c) => c.type === 'text' || c.type === 'pageInfo' || c.type === 'barcode' || c.type === 'table'));

  /** The clicked cell of the selected table, with its row and first column. */
  protected readonly selectedCell = computed(() => {
    const c = this.control();
    const ref = this.state.tableCell();
    if (c?.type !== 'table' || !ref || ref.controlId !== c.id) return null;
    const cell = c.rows[ref.row]?.cells[ref.cell];
    return cell ? { cell, row: ref.row, index: ref.cell, column: columnOf(c.rows[ref.row], ref.cell) } : null;
  });
  protected readonly formatIsCustom = computed(() => {
    const c = this.control();
    const f = c && (c.type === 'text' || c.type === 'pageInfo') ? c.format : undefined;
    return !!f && !FORMATS.some((x) => x.value === f);
  });

  // ── Report ──────────────────────────────────────────────────────────────────

  protected setReport<K extends 'name'>(key: K, value: string): void {
    this.state.update((d) => (d[key] = value), `report-${key}`);
  }

  /** Empty means "use the app's setting". */
  protected setCulture(key: 'locale' | 'currency', value: string): void {
    this.state.update((d) => (d[key] = value || undefined));
  }

  /** Empty text removes the watermark. */
  protected setWatermark(patch: Partial<Watermark>): void {
    this.state.update((d) => {
      const next = { text: '', ...d.watermark, ...patch } as Watermark;
      const empty = isExpression(next.text) ? !next.text.expression.trim() : !next.text.trim();
      d.watermark = empty ? undefined : next;
    }, 'watermark');
  }

  protected setPaper(paper: string): void {
    this.state.update((d) => {
      if (paper === 'custom' && d.page.paper !== 'custom') {
        const current = PAPER_SIZES.find((p) => p.id === d.page.paper);
        d.page.width = current?.width ?? 210;
        d.page.height = current?.height ?? 297;
      }
      d.page.paper = paper;
    });
  }

  protected setPage(key: 'orientation' | 'width' | 'height', value: string): void {
    this.state.update((d) => {
      if (key === 'orientation') d.page.orientation = value as 'portrait' | 'landscape';
      else if (key === 'width') d.page.width = positive(value, 10);
      // An empty height means continuous media (a roll that grows with the content).
      else d.page.height = value === '' ? null : positive(value, 10);
    }, `page-${key}`);
  }

  protected setPageOption(key: 'color' | 'mirrorMargins', value: string | boolean | undefined): void {
    this.state.update((d) => {
      if (value === undefined || value === '') delete d.page[key];
      else if (key === 'color') d.page.color = String(value);
      else d.page.mirrorMargins = true;
    }, `page-${key}`);
  }

  protected setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: string): void {
    this.state.update((d) => (d.page.margins[side] = nonNegative(value)), `margin-${side}`);
  }

  protected setRowsPath(path: string): void {
    this.state.update((d) => {
      if (d.dataMember) d.dataMember.path = path.trim() || undefined;
    }, 'rows-path');
  }

  // ── Band ────────────────────────────────────────────────────────────────────

  protected setBand(key: 'height' | 'groupBy' | 'sort' | 'backgroundColor' | 'rowsPath', value: string): void {
    const band = this.band();
    if (!band) return;
    this.state.updateBand(band.id, (b) => {
      if (key === 'height') b.height = Math.max(2, Math.max(positive(value, 2), ...b.controls.map((c) => c.y + c.height)));
      else if (key === 'groupBy') b.groupBy = { expression: value };
      else if (key === 'sort') b.sort = value as Band['sort'];
      else if (key === 'rowsPath') b.rowsPath = value || undefined;
      else b.backgroundColor = value || undefined;
    }, `band-${key}`);
  }

  protected toggleBand(key: 'keepTogether' | 'repeatOnEveryPage' | 'pageBreakBefore' | 'pageBreakAfter', value: boolean): void {
    const band = this.band();
    if (band) this.state.updateBand(band.id, (b) => (b[key] = value || undefined));
  }

  protected labelSheetName(l: LabelSheet): string {
    const count = this.strings().labelsCount.replace('{0}', String(l.columns * l.rows));
    return `${l.paper} · ${count} · ${l.labelWidth} × ${l.labelHeight} mm (${l.id})`;
  }

  protected applyLabelSheet(id: string): void {
    const sheet = LABEL_SHEETS.find((l) => l.id === id);
    if (!sheet) return;
    this.state.update((d) => applyLabelSheet(d, sheet));
    this.state.selection.set({ kind: 'band', id: this.state.report().bands[0].id });
  }

  protected readonly fieldExpressions = computed(() => new Set(this.fields().map((f) => f.expression)));

  /** The detail's first sort key; further keys (set in the file) are kept. */
  protected setSort(expression: string, descending: boolean): void {
    const band = this.band();
    if (!band) return;
    this.state.updateBand(band.id, (b) => {
      const rest = b.sortBy?.slice(1) ?? [];
      const keys = expression ? [{ expression, descending: descending || undefined }, ...rest] : rest;
      b.sortBy = keys.length ? keys : undefined;
    });
  }

  /** Detail columns; one column removes the setting. */
  protected setColumns(key: 'count' | 'gap', value: string): void {
    const band = this.band();
    if (!band) return;
    this.state.updateBand(band.id, (b) => {
      const next = { count: 1, gap: 0, ...b.columns, [key]: Math.max(key === 'count' ? 1 : 0, Number(value) || 0) };
      next.count = Math.min(12, Math.floor(next.count));
      b.columns = next.count > 1 ? next : undefined;
    }, `band-columns-${key}`);
  }

  protected removeBand(): void {
    const band = this.band();
    if (band) this.state.removeBand(band.id);
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  protected ids(): string[] {
    return this.controls().map((c) => c.id);
  }

  protected setGeometry(key: 'x' | 'y' | 'width' | 'height', value: string): void {
    const n = key === 'x' || key === 'y' ? nonNegative(value) : positive(value, 0.5);
    this.state.updateControls(this.ids(), (c, band) => {
      c[key] = n;
      if (key === 'y' || key === 'height') band.height = Math.max(band.height, c.y + c.height);
    }, `geo-${key}`);
  }

  /** Sets one property on the selected control(s) of a given type. */
  protected set(key: string, value: unknown, coalesce?: string): void {
    this.state.updateControls(this.ids(), (c) => {
      (c as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }, coalesce ?? `prop-${key}`);
  }

  protected setBindable(key: 'text' | 'value' | 'source' | 'checked' | 'visible', value: Bindable<string>): void {
    this.set(key, key === 'checked' && !isExpression(value) ? value !== '' && value !== 'false' : value, `bind-${key}`);
  }

  protected visibleValue(c: ReportControl): Bindable<string> {
    return isExpression(c.visible) ? c.visible : '';
  }

  protected setVisible(value: Bindable<string>): void {
    this.state.updateControls(this.ids(), (c) => {
      c.visible = isExpression(value) && value.expression.trim() ? value : undefined;
    }, 'bind-visible');
  }

  protected setOptionalChartRows(expression: string): void {
    this.set('rows', expression.trim() ? { expression } : undefined, 'chart-rows');
  }

  protected setExpression(key: 'category' | 'value', expression: string): void {
    this.set(key, { expression }, `chart-${key}`);
  }

  protected readonly crosstabKeys: { key: 'rows' | 'columns' | 'value'; label: 'crosstabRows' | 'crosstabColumns' | 'crosstabValue' }[] = [
    { key: 'rows', label: 'crosstabRows' },
    { key: 'columns', label: 'crosstabColumns' },
    { key: 'value', label: 'crosstabValue' },
  ];

  protected setCrosstab(key: 'rows' | 'columns' | 'value', expression: string): void {
    this.set(key, { expression }, `crosstab-${key}`);
  }

  // ── Sub-report ─────────────────────────────────────────────────────────────

  /** A file chosen for "Use a saved report" could not be read. */
  protected readonly subreportError = signal(false);

  /** A formula that may be left empty (then the property goes away). */
  protected setOptionalExpression(key: 'rows' | 'filter', expression: string): void {
    this.set(key, expression.trim() ? { expression } : undefined, `sub-${key}`);
  }

  /** Puts a saved report (or an RDLC / REPX one, converted) into the selected sub-report. */
  protected async chooseSubreport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { report } = importReport(await file.text(), file.name);
      this.subreportError.set(false);
      this.set('report', report, 'sub-file');
    } catch {
      this.subreportError.set(true);
    }
  }

  protected subreportParamValue(c: ReportControl, name: string): Bindable<string> {
    const value = c.type === 'subreport' ? c.parameters?.find((p) => p.name === name)?.value : undefined;
    return isExpression(value) ? value : value === undefined || value === null ? '' : String(value);
  }

  protected setSubreportParam(name: string, value: Bindable<string>): void {
    this.state.updateControls(this.ids(), (c) => {
      if (c.type !== 'subreport') return;
      const rest = (c.parameters ?? []).filter((p) => p.name !== name);
      const empty = isExpression(value) ? !value.expression.trim() : value === '';
      c.parameters = empty ? (rest.length ? rest : undefined) : [...rest, { name, value }];
    }, `sub-param-${name}`);
  }

  // ── Table ──────────────────────────────────────────────────────────────────

  /** Row/column commands act on the clicked cell, or on the last row/column. */
  protected tableOp(op: 'insertRow' | 'insertColumn' | 'deleteRow' | 'deleteColumn' | 'mergeRight' | 'splitCell'): void {
    const c = this.control();
    if (c?.type !== 'table') return;
    const at = this.selectedCell();
    const row = at?.row ?? c.rows.length - 1;
    const column = at?.column ?? c.columns.length - 1;
    this.state.updateControls([c.id], (t, band) => {
      if (t.type !== 'table') return;
      // A section exactly as tall as the table follows it when rows go away.
      const fitted = Math.abs(band.height - (t.y + t.height)) < 0.01;
      if (op === 'insertRow') insertRow(t, row);
      else if (op === 'insertColumn') insertColumn(t, column);
      else if (op === 'deleteRow') deleteRow(t, row);
      else if (op === 'deleteColumn') deleteColumn(t, column);
      else if (op === 'mergeRight' && at) mergeRight(t, at.row, at.index);
      else if (op === 'splitCell' && at) splitCell(t, at.row, at.index);
      const bottom = Math.max(t.y + t.height, ...band.controls.filter((x) => x !== t).map((x) => x.y + x.height));
      band.height = fitted ? Math.max(2, bottom) : Math.max(band.height, t.y + t.height);
    });
    // A removed row or cell leaves no selection behind.
    const t = this.control();
    if (t?.type === 'table' && at && !t.rows[at.row]?.cells[at.index]) this.state.tableCell.set(null);
  }

  private updateCell(mutate: (cell: TableCell) => void, coalesce?: string): void {
    const c = this.control();
    const at = this.selectedCell();
    if (c?.type !== 'table' || !at) return;
    this.state.updateControls([c.id], (t) => {
      if (t.type === 'table') mutate(t.rows[at.row].cells[at.index]);
    }, coalesce);
  }

  protected setCell(patch: Partial<TableCell>): void {
    this.updateCell((cell) => Object.assign(cell, patch), 'cell-content');
  }

  protected setCellStyle<K extends keyof ReportStyle>(key: K, value: ReportStyle[K] | undefined): void {
    this.updateCell((cell) => {
      const style: ReportStyle = { ...cell.styleOverrides };
      if (value === undefined) delete style[key];
      else style[key] = value;
      cell.styleOverrides = Object.keys(style).length ? style : undefined;
    }, `cell-${key}`);
  }

  protected cellAlign(cell: TableCell): TextAlign {
    const c = this.control();
    return cell.styleOverrides?.textAlign ?? resolveStyle(this.report(), c?.style, c?.styleOverrides).textAlign;
  }

  protected setColumnWidth(column: number, value: string): void {
    const c = this.control();
    if (c?.type !== 'table') return;
    this.state.updateControls([c.id], (t) => {
      if (t.type !== 'table') return;
      t.columns[column] = positive(value, 2);
      syncSize(t);
    }, `table-col-${column}`);
  }

  protected setRowHeight(row: number, value: string): void {
    const c = this.control();
    if (c?.type !== 'table') return;
    this.state.updateControls([c.id], (t, band) => {
      if (t.type !== 'table') return;
      t.rows[row].height = positive(value, 2);
      syncSize(t);
      band.height = Math.max(band.height, t.y + t.height);
    }, `table-row-${row}`);
  }

  // ── Conditional formatting ──────────────────────────────────────────────────

  protected condition(when: string): SimpleCondition | null {
    return parseCondition(when);
  }

  private updateRules(mutate: (rules: FormattingRule[]) => void, coalesce?: string): void {
    this.state.updateControls(this.ids(), (c) => {
      const rules = structuredClone(c.formatting ?? []);
      mutate(rules);
      c.formatting = rules.length ? rules : undefined;
    }, coalesce);
  }

  protected addRule(): void {
    this.updateRules((rules) => rules.push({ when: '', style: { bold: true } }));
  }

  protected removeRule(index: number): void {
    this.updateRules((rules) => rules.splice(index, 1));
  }

  protected setRule(index: number, patch: Partial<FormattingRule>): void {
    this.updateRules((rules) => rules[index] && Object.assign(rules[index], patch), `rule-${index}`);
  }

  protected setCondition(index: number, current: SimpleCondition, key: keyof SimpleCondition, value: string): void {
    this.setRule(index, { when: buildCondition({ ...current, [key]: value }) });
  }

  protected setRuleStyle<K extends keyof ReportStyle>(index: number, key: K, value: ReportStyle[K] | undefined): void {
    this.updateRules((rules) => {
      const style = rules[index]?.style;
      if (!style) return;
      if (value === undefined) delete style[key];
      else style[key] = value;
    }, `rule-style-${index}-${key}`);
  }

  protected checkedValue(c: ReportControl): Bindable<string> {
    if (c.type !== 'checkbox') return '';
    return isExpression(c.checked) ? c.checked : c.checked ? 'true' : '';
  }

  protected setStyle<K extends keyof ReportStyle>(key: K, value: ReportStyle[K] | undefined): void {
    this.state.updateControls(this.ids(), (c) => {
      const overrides: ReportStyle = { ...c.styleOverrides };
      if (value === undefined || value === '') delete overrides[key];
      else overrides[key] = value;
      c.styleOverrides = Object.keys(overrides).length ? overrides : undefined;
    }, `style-${key}`);
  }

  protected setBorder(patch: Partial<BorderStyle> | null): void {
    // A new border takes the item's text colour from the report style sheet.
    const current = this.style()?.border ?? { width: 0.25, color: this.style()?.color ?? '#000000', sides: { top: true, right: true, bottom: true, left: true } };
    this.setStyle('border', patch === null ? undefined : { ...current, ...patch });
  }

  protected toggleBorderSide(side: keyof BorderStyle['sides'], on: boolean): void {
    const current = this.style()?.border;
    const sides = { top: false, right: false, bottom: false, left: false, ...current?.sides, [side]: on };
    if (!Object.values(sides).some(Boolean)) return this.setBorder(null);
    this.setBorder({ sides });
  }

  protected async chooseImage(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) return;
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    this.set('source', dataUri, 'image-file');
  }

  protected textValue(c: ReportControl): Bindable<string> {
    switch (c.type) {
      case 'text':
        return c.text;
      case 'barcode':
        return c.value;
      case 'image':
        return isExpression(c.source) || !c.source.startsWith('data:') ? c.source : '';
      default:
        return '';
    }
  }

  protected num(value: number | undefined | null): string {
    return value === undefined || value === null ? '' : String(Math.round(value * 100) / 100);
  }

  protected asNumber(value: string, fallback: number): number {
    return positive(value, fallback);
  }
}

function positive(value: string, min: number): number {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(min, Math.round(n * 100) / 100) : min;
}

function nonNegative(value: string): number {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}
