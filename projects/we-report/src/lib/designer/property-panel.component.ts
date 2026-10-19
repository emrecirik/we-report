import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  Band,
  BARCODE_SYMBOLOGIES,
  Bindable,
  BorderStyle,
  ChartAggregate,
  ChartType,
  FormattingRule,
  isExpression,
  PAPER_SIZES,
  ReportControl,
  ReportStyle,
  resolveStyle,
} from 'we-report-core';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { WeReportIcons } from '../we-report-icons';
import { WeReportLocale } from '../we-report-locale';
import { BindableInputComponent } from './bindable-input.component';
import { DesignerField } from './designer-fields';
import { AlignEdge, DesignerState } from './designer-state';
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
];

const AGGREGATES: { value: ChartAggregate; label: keyof WeReportLocale }[] = [
  { value: 'sum', label: 'aggSum' },
  { value: 'count', label: 'aggCount' },
  { value: 'avg', label: 'aggAvg' },
  { value: 'min', label: 'aggMin' },
  { value: 'max', label: 'aggMax' },
];

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

  protected readonly state = inject(DesignerState);
  protected readonly papers = PAPER_SIZES;
  protected readonly symbologies = BARCODE_SYMBOLOGIES;
  protected readonly formats = FORMATS;
  protected readonly alignActions = ALIGN_ACTIONS;
  protected readonly chartTypes = CHART_TYPES;
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
  protected readonly hasText = computed(() => this.controls().some((c) => c.type === 'text' || c.type === 'pageInfo' || c.type === 'barcode'));
  protected readonly formatIsCustom = computed(() => {
    const c = this.control();
    const f = c && (c.type === 'text' || c.type === 'pageInfo') ? c.format : undefined;
    return !!f && !FORMATS.some((x) => x.value === f);
  });

  // ── Report ──────────────────────────────────────────────────────────────────

  protected setReport<K extends 'name'>(key: K, value: string): void {
    this.state.update((d) => (d[key] = value), `report-${key}`);
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

  protected setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: string): void {
    this.state.update((d) => (d.page.margins[side] = nonNegative(value)), `margin-${side}`);
  }

  protected setRowsPath(path: string): void {
    this.state.update((d) => {
      if (d.dataMember) d.dataMember.path = path.trim() || undefined;
    }, 'rows-path');
  }

  // ── Band ────────────────────────────────────────────────────────────────────

  protected setBand(key: 'height' | 'groupBy' | 'sort' | 'backgroundColor', value: string): void {
    const band = this.band();
    if (!band) return;
    this.state.updateBand(band.id, (b) => {
      if (key === 'height') b.height = Math.max(2, Math.max(positive(value, 2), ...b.controls.map((c) => c.y + c.height)));
      else if (key === 'groupBy') b.groupBy = { expression: value };
      else if (key === 'sort') b.sort = value as Band['sort'];
      else b.backgroundColor = value || undefined;
    }, `band-${key}`);
  }

  protected toggleBand(key: 'keepTogether' | 'repeatOnEveryPage' | 'pageBreakBefore' | 'pageBreakAfter', value: boolean): void {
    const band = this.band();
    if (band) this.state.updateBand(band.id, (b) => (b[key] = value || undefined));
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

  protected setExpression(key: 'category' | 'value', expression: string): void {
    this.set(key, { expression }, `chart-${key}`);
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
