import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { Band, BandKind, calculatedFieldMap, checkReport, evaluate, formatValue, generateListReport, inferSchema, isExpression, ReportControl, ReportControlType, ReportDefinition, ReportIssue, ReportStyle, resolvePageGeometry, resolveReportData, resolveStyle, sourceValue, TextAlign } from 'we-report-core';
import { WE_REPORT_CONFIG } from '../we-report-config';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { WeReportIcons } from '../we-report-icons';
import { WE_REPORT_LOCALE, WeReportLocale } from '../we-report-locale';
import { WeReportViewerComponent } from '../viewer/we-report-viewer.component';
import { formatFor, TOOLBOX_ITEMS } from './control-factory';
import { DesignSample, DesignSurfaceComponent, DesignerDragData, DRAG_MIME } from './design-surface.component';
import { DesignerField, designerFields } from './designer-fields';
import { DesignerState } from './designer-state';
import { PropertyPanelComponent } from './property-panel.component';
import { DataSourcesDialogComponent } from './data-sources-dialog.component';

const WIDTH_KEY = 'we-report-designer.panels';

/** Panel widths, zoom and grid are a per-browser convenience; storage may be unavailable. */
function readSaved<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? '{}')[key];
    return valid(saved) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSaved(values: Record<string, unknown>): void {
  try {
    const all = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? '{}');
    localStorage.setItem(WIDTH_KEY, JSON.stringify({ ...all, ...values }));
  } catch {
    /* not remembered */
  }
}

let designerCount = 0;

const isWidth = (v: unknown) => typeof v === 'number' && (v === 0 || (v >= 160 && v <= 480));

const BAND_ORDER: Record<BandKind, number> = {
  pageHeader: 0,
  reportHeader: 1,
  groupHeader: 2,
  detail: 3,
  subHeader: 3.1,
  subDetail: 3.2,
  subFooter: 3.3,
  groupFooter: 4,
  reportFooter: 5,
  pageFooter: 6,
};

/** Keeps bands in the order they print; sort is stable, so group nesting is preserved. */
export function orderBands(bands: Band[]): Band[] {
  return [...bands].sort((a, b) => BAND_ORDER[a.kind] - BAND_ORDER[b.kind]);
}

/**
 * The end-user report designer: toolbox and data fields on the left, the page in the middle,
 * properties on the right, and a live preview tab. Two-way bind `[(report)]`.
 */
@Component({
  selector: 'we-report-designer',
  standalone: true,
  imports: [DesignSurfaceComponent, PropertyPanelComponent, WeReportViewerComponent, WeReportIconPipe, DataSourcesDialogComponent],
  providers: [DesignerState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './we-report-designer.component.html',
  styleUrl: './we-report-designer.component.scss',
})
export class WeReportDesignerComponent {
  /** The report being designed. Updated on every edit. */
  readonly report = model.required<ReportDefinition>();
  /** Sample data for the field list and preview; replaces the report's own data source data. */
  readonly data = input<unknown>(undefined);
  /** Overrides the `WE_REPORT_LOCALE` token, e.g. to switch language at runtime. */
  readonly locale = input<WeReportLocale | undefined>(undefined);
  readonly zoom = input(1);
  /** Fetch used for web-service data sources (testing in the designer and the preview). */
  readonly fetchFn = input<typeof fetch | undefined>(undefined);

  protected readonly state = inject(DesignerState);
  private readonly fontsService = inject(WeReportFontsService);
  private readonly config = inject(WE_REPORT_CONFIG);
  private readonly defaultLocale = inject(WE_REPORT_LOCALE);
  protected readonly strings = computed(() => this.locale() ?? this.defaultLocale);

  protected readonly toolbox = TOOLBOX_ITEMS;
  protected readonly tab = signal<'design' | 'preview'>('design');
  protected readonly advanced = signal(false);
  protected readonly zoomLevel = signal(readSaved('zoom', 1, (v) => typeof v === 'number' && v >= 0.3 && v <= 3));
  protected readonly fontFamilies = signal<string[]>([]);
  protected readonly bandMenuOpen = signal(false);
  protected readonly dataDialogOpen = signal(false);
  protected readonly problemsOpen = signal(false);
  protected readonly leftTab = signal<'add' | 'outline'>('add');
  /** Right-click menu: screen position and the band it was opened on. */
  protected readonly contextMenu = signal<{ x: number; y: number; bandId: string | null; onControl: boolean; at?: { x: number; y: number } } | null>(null);
  private readonly canvas = viewChild<ElementRef<HTMLElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly surface = viewChild(DesignSurfaceComponent);
  protected readonly shortcutsOpen = signal(false);
  /** Side panel widths in px; 0 hides a panel. Remembered in this browser. */
  protected readonly leftWidth = signal(readSaved('left', 232, isWidth));
  protected readonly rightWidth = signal(readSaved('right', 288, isWidth));
  protected readonly fontSizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  protected readonly textAligns: { value: TextAlign; icon: keyof WeReportIcons; label: 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify' }[] = [
    { value: 'left', icon: 'textLeft', label: 'alignLeft' },
    { value: 'center', icon: 'textCenter', label: 'alignCenter' },
    { value: 'right', icon: 'textRight', label: 'alignRight' },
    { value: 'justify', icon: 'textJustify', label: 'alignJustify' },
  ];

  /** The look of the first selected item (or the clicked table cell), shown in the format bar. */
  protected readonly formatStyle = computed(() => {
    const c = this.state.selectedControls()[0];
    if (!c) return null;
    const cell = this.state.tableCell();
    const cellOverrides = c.type === 'table' && cell?.controlId === c.id ? c.rows[cell.row]?.cells[cell.cell]?.styleOverrides : undefined;
    return resolveStyle(this.state.report(), c.style, { ...c.styleOverrides, ...cellOverrides });
  });

  /** One line about the selection for the status bar. */
  protected readonly selectionInfo = computed(() => {
    const s = this.strings();
    const controls = this.state.selectedControls();
    if (controls.length === 1) {
      const c = controls[0];
      return { title: `${s.controlNames[c.type]} · ${c.name || c.id}`, box: c as { x: number; y: number; width: number; height: number } };
    }
    if (controls.length > 1) return { title: s.itemsSelected.replace('{0}', String(controls.length)), box: null };
    const band = this.state.selectedBand();
    if (band) return { title: s.bandNames[band.kind], box: { x: 0, y: 0, width: resolvePageGeometry(this.state.report().page).contentWidth, height: band.height } };
    return { title: s.noSelection, box: null };
  });

  protected readonly pointerInfo = computed(() => {
    const p = this.state.pointer();
    const band = p && this.state.report().bands.find((b) => b.id === p.bandId);
    return p && band ? `${this.strings().bandNames[band.kind]} · ${this.mm(p.x)} × ${this.mm(p.y)} mm` : '';
  });

  protected mm(v: number): string {
    return String(Math.round(v * 10) / 10);
  }

  /** Where a click-added item goes: the selected section, the selected item's section, else the detail rows. */
  private targetBand(): Band | undefined {
    const bands = this.state.report().bands;
    const sel = this.state.selection();
    if (sel.kind === 'band') return bands.find((b) => b.id === sel.id);
    if (sel.kind === 'controls') return this.state.findBandOf(sel.ids[0]);
    return bands.find((b) => b.kind === 'detail') ?? bands[0];
  }

  /** Adds a toolbox item or a field without dragging: under (or, for rows, beside) what is there. */
  protected addByClick(data: DesignerDragData): void {
    const band = this.targetBand();
    const surface = this.surface();
    if (!band || !surface) return;
    const width = resolvePageGeometry(this.state.report().page).contentWidth;
    const right = Math.max(0, ...band.controls.map((c) => c.x + c.width));
    const bottom = Math.max(0, ...band.controls.map((c) => c.y + c.height));
    // Detail rows grow sideways (a new column); other sections grow downwards.
    const beside = band.kind === 'detail' && data.kind === 'field' && right + 42 <= width;
    surface.dropAt(data, band, beside ? Math.round(right + 2) : 0, beside ? 0 : Math.round(bottom + (band.controls.length ? 1 : 0)));
  }

  protected onToolClick(item: { type: ReportControlType; variant?: string }): void {
    this.addByClick({ kind: 'control', type: item.type, variant: item.variant });
  }

  protected onFieldDblClick(field: DesignerField): void {
    this.addByClick({ kind: 'field', path: field.path, parent: field.parent, format: formatFor({ name: field.path, type: field.type }) });
  }

  /** Dragging a panel edge; a double-click hides the panel or brings it back. */
  protected startResize(e: PointerEvent, side: 'left' | 'right'): void {
    e.preventDefault();
    const target = side === 'left' ? this.leftWidth : this.rightWidth;
    const start = e.clientX;
    const from = target();
    const move = (m: PointerEvent) => {
      const delta = side === 'left' ? m.clientX - start : start - m.clientX;
      target.set(Math.round(Math.min(480, Math.max(160, from + delta))));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      writeSaved({ [side]: target() });
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  protected togglePanel(side: 'left' | 'right'): void {
    const target = side === 'left' ? this.leftWidth : this.rightWidth;
    target.set(target() ? 0 : side === 'left' ? 232 : 288);
    writeSaved({ [side]: target() });
  }

  protected editSelected(): void {
    const c = this.state.selectedControls()[0];
    if (c) this.surface()?.startEditing(c);
  }

  protected format<K extends keyof ReportStyle>(key: K, value: ReportStyle[K] | undefined): void {
    this.state.applyStyle(key, value);
  }

  private typeStartsEditing(): boolean {
    const controls = this.state.selectedControls();
    const c = controls.length === 1 ? controls[0] : undefined;
    return c?.type === 'text' && !isExpression(c.text);
  }

  protected toggleFormat(key: 'bold' | 'italic' | 'underline'): void {
    if (!this.formatStyle()) return;
    this.state.applyStyle(key, !this.formatStyle()![key]);
  }

  protected togglePainter(): void {
    const c = this.state.selectedControls()[0];
    this.state.painter.set(this.state.painter() || !c ? null : { style: c.style, styleOverrides: structuredClone(c.styleOverrides) });
  }

  protected setBorder(on: boolean): void {
    const st = this.formatStyle();
    this.state.applyStyle('border', on ? { width: 0.25, color: st?.color ?? '#000000', sides: { top: true, right: true, bottom: true, left: true } } : undefined);
  }
  /** Design problems, checked on every edit; field names are judged only when there is data. */
  protected readonly issues = computed<ReportIssue[]>(() => {
    const { rows, parent, lists } = this.fields();
    const known = rows.length || parent.length;
    const inner = this.fields().inner;
    const bandOf = (id: string) => this.state.report().bands.find((b) => b.controls.some((c) => c.id === id))?.id ?? '';
    const cut: ReportIssue[] = [...(this.surface()?.cutTexts() ?? [])].map((controlId) => ({ code: 'textCut', severity: 'warning', bandId: bandOf(controlId), controlId }));
    return [
      ...checkReport(
        this.state.report(),
        // Lists inside a row are fields too (a sub-report's rows, Count([orders])).
        known ? [...rows.map((f) => f.path), ...lists] : undefined,
        known ? parent.map((f) => f.path) : undefined,
        undefined,
        inner.length ? inner.map((f) => f.path) : undefined,
      ),
      ...cut,
    ];
  });
  /** Show the first data row inside bound controls instead of their formulas. */
  protected readonly showData = signal(readSaved('showData', true, (v) => typeof v === 'boolean'));
  protected readonly sample = computed<DesignSample | null>(() => (this.showData() ? this.state.sample() : null));

  protected readonly fields = computed(() => designerFields(this.state.report(), this.data()));
  protected readonly fieldFilter = signal('');
  /** The field list narrowed to names containing the filter text. */
  protected readonly shownFields = computed(() => {
    const f = this.fields();
    const q = this.fieldFilter().trim().toLocaleLowerCase();
    if (!q) return f;
    const keep = (list: DesignerField[]) => list.filter((x) => x.label.toLocaleLowerCase().includes(q) || x.path.toLocaleLowerCase().includes(q));
    return { ...f, rows: keep(f.rows), inner: keep(f.inner), parent: keep(f.parent) };
  });
  protected readonly allFields = computed<DesignerField[]>(() => [...this.fields().rows, ...this.fields().parent, ...this.fields().inner]);
  protected readonly addableBands = computed(() => {
    const kinds = new Set(this.state.report().bands.map((b) => b.kind));
    const list: BandKind[] = (['reportHeader', 'reportFooter', 'pageHeader', 'pageFooter'] as BandKind[]).filter((k) => !kinds.has(k));
    // An inner list needs a list inside the rows; its header and footer need the list section.
    if (!kinds.has('subDetail') && this.fields().lists.length) list.push('subDetail');
    if (kinds.has('subDetail')) list.push(...(['subHeader', 'subFooter'] as BandKind[]).filter((k) => !kinds.has(k)));
    return [...list, 'groupHeader' as BandKind];
  });

  constructor() {
    effect(() => {
      const incoming = this.report();
      untracked(() => {
        if (incoming !== this.state.report()) this.state.load(incoming);
      });
    }, { allowSignalWrites: true });
    effect(() => {
      const current = this.state.report();
      untracked(() => {
        if (current !== this.report()) this.report.set(current);
      });
    }, { allowSignalWrites: true });
    effect(() => this.zoomLevel.set(this.zoom()), { allowSignalWrites: true });
    // The formula editor reads the sample even when "Show data" is off.
    effect(() => {
      let sample: DesignSample | null = null;
      try {
        const { rows, parent } = resolveReportData(this.state.report(), this.data());
        if (rows?.length || (parent !== undefined && parent !== null)) sample = { row: rows?.[0], rows: rows ?? [], parent, calculated: calculatedFieldMap(this.state.report()) };
      } catch {
        sample = null;
      }
      this.state.sample.set(sample);
    }, { allowSignalWrites: true });
    this.fontsService
      .ready()
      .then((r) => this.fontFamilies.set(r.familyNames()))
      .catch(() => undefined);
  }

  /** Short label of a control for the outline: its name, its text or formula, else its type. */
  protected outlineLabel(c: ReportControl): string {
    if (c.name) return c.name;
    if (c.type === 'text') return isExpression(c.text) ? c.text.expression : c.text || this.strings().controlNames.text;
    if (c.type === 'barcode') return `${c.symbology}: ${isExpression(c.value) ? c.value.expression : c.value}`;
    return this.strings().controlNames[c.type];
  }

  protected outlineIcon(c: ReportControl): keyof WeReportIcons {
    if (c.type === 'shape') return c.shape === 'ellipse' ? 'ellipse' : 'rectangle';
    if (c.type === 'barcode') return c.symbology === 'qrcode' ? 'qrcode' : 'barcode';
    return c.type;
  }

  protected selectFromOutline(e: MouseEvent, id: string): void {
    this.state.select(id, e.shiftKey || e.ctrlKey || e.metaKey);
  }

  protected isSelected(id: string): boolean {
    const sel = this.state.selection();
    return sel.kind === 'controls' && sel.ids.includes(id);
  }

  /** Unique per designer, so two designers on one page do not share the size list. */
  protected readonly sizeListId = `we-report-sizes-${++designerCount}`;
  protected readonly zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];
  protected readonly gridSteps = [0, 0.5, 1, 2, 5];
  /** Snap grid in mm; 0 turns the grid off. */
  protected readonly gridSize = signal(readSaved('grid', 1, (v) => typeof v === 'number' && v >= 0 && v <= 10));
  private readonly rememberView = effect(() => writeSaved({ zoom: this.zoomLevel(), grid: this.gridSize(), showData: this.showData() }));

  protected pickZoom(value: string): void {
    if (value === 'width') this.fitWidth();
    else if (value) this.setZoom(Number(value));
  }

  protected fitWidth(): void {
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const pagePx = (resolvePageGeometry(this.state.report().page).width * 96) / 25.4;
    // The surface keeps 24px on the left and 136px on the right for the section labels.
    this.setZoom(Math.floor(((el.clientWidth - 24 - 136 - 16) / pagePx) * 20) / 20);
  }

  protected onCanvasWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setZoom(this.zoomLevel() + (e.deltaY < 0 ? 0.1 : -0.1));
  }

  protected openContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const bandEl = target.closest<HTMLElement>('[data-band-id]');
    if (!bandEl) return;
    e.preventDefault();
    const controlId = target.closest<HTMLElement>('[data-control-id]')?.dataset['controlId'];
    if (controlId) this.state.select(controlId, false);
    else this.state.selection.set({ kind: 'band', id: bandEl.dataset['bandId']! });
    const p = this.state.pointer();
    const at = p && p.bandId === bandEl.dataset['bandId'] ? { x: p.x, y: p.y } : undefined;
    this.contextMenu.set({ x: e.clientX, y: e.clientY, bandId: bandEl.dataset['bandId'] ?? null, onControl: !!controlId, at });
  }

  /** A new text where the section was right-clicked, ready to type in. */
  protected addTextAt(bandId: string | null, at?: { x: number; y: number }): void {
    const band = this.state.report().bands.find((b) => b.id === bandId);
    const surface = this.surface();
    if (!band || !surface) return;
    surface.dropAt({ kind: 'control', type: 'text' }, band, Math.round(at?.x ?? 0), Math.round(at?.y ?? 0));
    this.editSelected();
  }

  /** A single bound text in the detail section: it can get a total ("insert summary"). */
  protected readonly totalTarget = computed(() => {
    const [c, ...more] = this.state.selectedControls();
    if (!c || more.length || c.type !== 'text' || !isExpression(c.text) || !c.text.expression.trim()) return null;
    return this.state.selectedBand()?.kind === 'detail' || this.state.report().bands.find((b) => b.controls.includes(c))?.kind === 'detail' ? c : null;
  });

  protected groupByValue(): void {
    const c = this.totalTarget();
    if (c?.type === 'text' && isExpression(c.text)) this.addBand('groupHeader', c.text.expression);
  }

  /** Puts `Sum(...)` of the selected column under it in every group footer and the report footer. */
  protected addTotal(): void {
    const c = this.totalTarget();
    if (!c || c.type !== 'text' || !isExpression(c.text)) return;
    const expression = `Sum(${c.text.expression})`;
    const taken = new Set<string>();
    const ids: string[] = [];
    this.state.update((d) => {
      if (!d.bands.some((b) => b.kind === 'reportFooter')) {
        d.bands.push({ id: this.state.newId('reportFooter', taken), kind: 'reportFooter', height: 8, controls: [] });
        d.bands = orderBands(d.bands);
      }
      for (const band of d.bands) {
        if (band.kind !== 'groupFooter' && band.kind !== 'reportFooter') continue;
        // Under whatever already sits in this column, else at the top.
        const inColumn = band.controls.filter((x) => x.x < c.x + c.width && x.x + x.width > c.x);
        const y = inColumn.length ? Math.round(Math.max(...inColumn.map((x) => x.y + x.height)) * 100) / 100 : 1;
        const id = this.state.newId('total', taken);
        ids.push(id);
        band.controls.push({
          id, type: 'text', x: c.x, y, width: c.width, height: c.height, text: { expression }, format: c.format,
          style: c.style, styleOverrides: { ...c.styleOverrides, bold: true },
        });
        band.height = Math.max(band.height, y + c.height + 1);
      }
    });
    this.state.selection.set({ kind: 'controls', ids });
  }

  /** The sub-report whose design is open in its own designer window. */
  protected readonly openSubreport = computed(() => {
    const id = this.state.subreportOpen();
    const c = id ? this.state.report().bands.flatMap((b) => b.controls).find((x) => x.id === id) : undefined;
    return c?.type === 'subreport' ? c : null;
  });

  /** The sub-report on a page as wide as its box and as tall as its content, as it prints. */
  protected readonly subreportDesign = computed(() => {
    const c = this.openSubreport();
    if (!c) return null;
    const p = c.report.page;
    // Only paper and size are fixed by the box; other page settings stay as edited (so editing
    // them inside does not reload the inner designer). The layout ignores them for a sub-report.
    if (p?.paper === 'custom' && p.width === c.width && p.height == null) return c.report;
    return {
      ...c.report,
      page: {
        ...p,
        orientation: p?.orientation ?? 'portrait',
        displayUnit: p?.displayUnit ?? 'mm',
        paper: 'custom',
        width: c.width,
        height: null,
        margins: p?.margins ?? { top: 0, right: 0, bottom: 0, left: 0 },
      },
    } satisfies ReportDefinition;
  });

  /**
   * Sample data for the sub-report's designer: its rows formula over the first row, else the data
   * of the source it is bound to (its own, or one of this report's, as in the layout).
   */
  protected readonly subreportData = computed(() => {
    const c = this.openSubreport();
    if (!c) return undefined;
    const sample = this.state.sample();
    if (c.rows?.expression.trim()) {
      if (!sample) return undefined;
      try {
        const value = evaluate(c.rows.expression, sample);
        return Array.isArray(value) ? value : undefined;
      } catch {
        return undefined;
      }
    }
    const id = c.report.dataMember?.dataSourceId;
    if (!id || c.report.dataSources.some((s) => s.id === id)) return undefined;
    const outer = this.state.report().dataSources.find((s) => s.id === id);
    return outer ? sourceValue(outer) : undefined;
  });

  /** The window closes when its sub-report is gone (deleted, or undone away), and takes the focus when it opens. */
  private readonly subreportWindow = effect(() => {
    const id = this.state.subreportOpen();
    if (id && !this.openSubreport()) {
      untracked(() => this.state.subreportOpen.set(null));
      return;
    }
    if (id) setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.wd__subreport')?.focus());
  }, { allowSignalWrites: true });

  /** Edits from the sub-report's designer; one undo step per burst of edits here. */
  protected setSubreport(id: string, report: ReportDefinition): void {
    // The very object the inner designer holds, so it does not reload (and lose its undo history).
    this.state.updateControls([id], (c) => {
      if (c.type === 'subreport') c.report = report;
    }, `subreport-${id}`);
  }

  protected readonly hasTextSelected = computed(() => this.state.selectedControls().some((c) => c.type === 'text'));

  /**
   * Sizes the selected texts to what they show on the page (fixed text, or the sample value),
   * measured with the report's fonts, so it matches the printed size.
   */
  protected async fitToText(): Promise<void> {
    const texts = this.state.selectedControls().filter((c) => c.type === 'text');
    if (!texts.length) return;
    const fonts = await this.fontsService.ready();
    const report = this.state.report();
    const sizes = new Map<string, { width: number; height: number }>();
    for (const c of texts) {
      const shown = this.printedText(c) ?? this.host.nativeElement.querySelector(`[data-control-id="${CSS.escape(c.id)}"] .ds__text`)?.textContent ?? '';
      const lines = shown.split('\n');
      const style = resolveStyle(report, c.style, c.styleOverrides);
      const font = fonts.resolve(style.fontFamily, style.bold, style.italic);
      const up = (v: number) => Math.ceil(v * 10) / 10;
      sizes.set(c.id, {
        width: up(Math.max(2, ...lines.map((l) => font.widthOf(l, style.fontSize))) + 2 * style.padding + 0.5),
        height: up(lines.length * font.lineHeight(style.fontSize) + 2 * style.padding),
      });
    }
    this.state.updateControls([...sizes.keys()], (c) => Object.assign(c, sizes.get(c.id)));
  }

  protected tidySelection(): void {
    this.state.tidy(this.state.selectedControls().map((c) => c.id), this.gridSize());
  }

  protected tidyBand(bandId: string): void {
    const band = this.state.report().bands.find((b) => b.id === bandId);
    if (band) this.state.tidy(band.controls.map((c) => c.id), this.gridSize());
  }

  /**
   * What a bound text prints with the first data row, also while *Show data* is off (the page
   * then shows the formula); `null` when there is no data to evaluate with.
   * shortcut: inner-list texts use the detail row, so their size may be off; measure them with *Show data* on.
   */
  private printedText(c: ReportControl): string | null {
    const sample = this.state.sample();
    if (c.type !== 'text' || !isExpression(c.text) || !sample || this.showData()) return null;
    const report = this.state.report();
    const options = { locale: report.locale || this.config.locale || 'en-US', currency: report.currency || this.config.currency || 'USD' };
    try {
      const value = evaluate(c.text.expression, { ...sample, ...options, now: new Date() });
      return typeof value === 'string' && !c.format ? value : formatValue(value, c.format, options);
    } catch {
      return null;
    }
  }

  /** Shrinks (or grows) a section to just below its lowest item. */
  protected fitBand(bandId: string | null): void {
    this.state.update((d) => {
      const band = d.bands.find((b) => b.id === bandId);
      if (band) band.height = Math.max(2, Math.round(Math.max(0, ...band.controls.map((c) => c.y + c.height)) * 100) / 100);
    });
  }

  /** Runs a context-menu command and closes the menu. */
  protected menu(action: () => void): void {
    this.contextMenu.set(null);
    action();
  }

  /** Ctrl+C/X/V pressed on the page and not yet answered by a clipboard event. */
  private pendingClipboardKey: string | null = null;

  /** Copy and cut also put the items on the system clipboard, so they paste in another tab. */
  @HostListener('copy', ['$event'])
  @HostListener('cut', ['$event'])
  protected onCopy(e: ClipboardEvent): void {
    this.pendingClipboardKey = null;
    // While a sub-report window is open, the inner designer has the clipboard.
    if (this.state.subreportOpen()) return;
    // Text selected on the page (a label, a hint) is copied as text, not as report items.
    if (this.tab() !== 'design' || this.isTyping(e) || !document.getSelection()?.isCollapsed || !this.state.copySelection()) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', this.state.clipboardText());
    if (e.type === 'cut') this.state.deleteSelection();
  }

  /** Pastes our items, else a picture (screenshot) or text from any other program. */
  @HostListener('paste', ['$event'])
  protected onPaste(e: ClipboardEvent): void {
    this.pendingClipboardKey = null;
    if (this.state.subreportOpen()) return;
    if (this.tab() !== 'design' || this.isTyping(e)) return;
    const data = e.clipboardData;
    const text = data?.getData('text/plain') ?? '';
    const image = Array.from(data?.files ?? []).find((f) => /^image\/(png|jpeg)$/.test(f.type));
    if (this.state.loadClipboard(text) || (!text && !image && this.state.hasClipboard())) {
      e.preventDefault();
      this.state.paste();
      return;
    }
    const band = this.targetBand();
    const surface = this.surface();
    if (!band || !surface) return;
    const y = Math.max(0, ...band.controls.map((c) => c.y + c.height));
    if (image) {
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => surface.addImage(band, 0, y, reader.result as string);
      reader.readAsDataURL(image);
    } else if (text.trim()) {
      e.preventDefault();
      surface.addText(band, 0, y, text.replace(/\s+$/, ''));
    }
  }

  private isTyping(e: Event): boolean {
    return !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeMenus(e: PointerEvent): void {
    if (!this.contextMenu()) return;
    if (!(e.target as HTMLElement).closest('.wd__context')) this.contextMenu.set(null);
  }

  protected iconName(name: string): keyof WeReportIcons {
    return name as keyof WeReportIcons;
  }

  protected setZoom(value: number): void {
    this.zoomLevel.set(Math.min(3, Math.max(0.3, Math.round(value * 100) / 100)));
  }

  protected onToolDragStart(e: DragEvent, item: { type: ReportControlType; variant?: string }): void {
    this.setDrag(e, { kind: 'control', type: item.type, variant: item.variant });
  }

  protected onFieldDragStart(e: DragEvent, field: DesignerField): void {
    this.setDrag(e, { kind: 'field', path: field.path, parent: field.parent, format: formatFor({ name: field.path, type: field.type }) });
  }

  private setDrag(e: DragEvent, data: DesignerDragData): void {
    e.dataTransfer?.setData(DRAG_MIME, JSON.stringify(data));
    e.dataTransfer?.setData('text/plain', data.kind === 'field' ? `[${data.path}]` : data.type);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  protected addBand(kind: BandKind, groupBy?: string): void {
    this.bandMenuOpen.set(false);
    const id = this.state.newId(kind);
    this.state.update((d) => {
      if (kind === 'groupHeader') {
        const expression = groupBy ?? this.allFields().find((f) => !f.parent)?.expression ?? '';
        const width = resolvePageGeometry(d.page).contentWidth;
        // A group made from a value shows that value as its heading.
        const heading: ReportControl[] = groupBy
          ? [{ id: `${id}Value`, type: 'text', x: 0, y: 1, width: Math.min(120, width), height: 6, text: { expression }, styleOverrides: { bold: true } }]
          : [];
        // Pushed last, so after the stable sort it is the innermost group header…
        d.bands.push({ id, kind, height: 8, groupBy: { expression }, controls: heading });
        // …and its footer, placed right after the detail band, the innermost footer.
        const detailIndex = d.bands.findIndex((b) => b.kind === 'detail');
        d.bands.splice(detailIndex + 1, 0, { id: `${id}Footer`, kind: 'groupFooter', groupHeaderId: id, height: 8, controls: [] });
      } else if (kind === 'subDetail') {
        d.bands.push({ id, kind, height: 6, rowsPath: this.fields().lists[0], controls: [] });
      } else {
        d.bands.push({ id, kind, height: kind.startsWith('page') ? 10 : kind.startsWith('sub') ? 6 : 15, controls: [] });
      }
      d.bands = orderBands(d.bands);
    });
    this.state.selection.set({ kind: 'band', id });
  }

  /** The report wizard's choices while it is open. */
  protected readonly wizard = signal<{
    title: string;
    fields: { name: string; on: boolean }[];
    groupBy: string;
    sortBy: string;
    sortDescending: boolean;
    totals: boolean;
    orientation: '' | 'portrait' | 'landscape';
  } | null>(null);

  /** Opens the report wizard: pick columns, grouping, totals and paper, then a tidy list is built. */
  protected autoDesign(): void {
    const { rows } = resolveReportData(this.state.report(), this.data());
    const fields = inferSchema(rows ?? []).filter((f) => f.type !== 'object' && f.type !== 'array' && f.type !== 'image');
    if (!fields.length) return;
    const name = this.state.report().name;
    // A blank report is still called "Report": show the localized word instead.
    this.wizard.set({
      title: name && name !== 'Report' ? name : this.strings().newReportTitle,
      fields: fields.map((f, i) => ({ name: f.name, on: i < 12 })),
      groupBy: '',
      sortBy: '',
      sortDescending: false,
      totals: true,
      orientation: '',
    });
    // Focus the dialog so Escape and Enter work at once.
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.wd__wizard input')?.select());
  }

  /** At least one column (or a grouping) to build from. */
  protected readonly wizardReady = computed(() => !!this.wizard()?.fields.some((f) => f.on) || !!this.wizard()?.groupBy);

  protected updateWizard(change: Partial<NonNullable<ReturnType<typeof this.wizard>>>): void {
    const w = this.wizard();
    if (w) this.wizard.set({ ...w, ...change });
  }

  protected toggleWizardField(name: string): void {
    const w = this.wizard();
    if (w) this.wizard.set({ ...w, fields: w.fields.map((f) => (f.name === name ? { ...f, on: !f.on } : f)) });
  }

  /** Replaces the layout with the wizard's list report (undoable). */
  protected runWizard(): void {
    const w = this.wizard();
    if (!w) return;
    const { rows } = resolveReportData(this.state.report(), this.data());
    const schema = inferSchema(rows ?? []);
    const chosen = new Set(w.fields.filter((f) => f.on || f.name === w.groupBy).map((f) => f.name));
    const fields = schema.filter((f) => chosen.has(f.name));
    if (!fields.length) return;
    const s = this.strings();
    this.state.update((d) => {
      const generated = generateListReport(d, fields, { title: w.title, total: s.totalLabel, pageOf: s.pageOfFormat }, '', rows ?? [], {
        groupBy: w.groupBy || undefined,
        sortBy: w.sortBy || undefined,
        sortDescending: w.sortDescending,
        totals: w.totals,
        orientation: w.orientation || undefined,
      });
      Object.assign(d, generated);
    });
    this.wizard.set(null);
    this.state.selection.set({ kind: 'none' });
  }

  protected issueText(issue: ReportIssue): string {
    const s = this.strings();
    const text = {
      outsidePage: s.issueOutsidePage,
      formulaError: s.issueFormulaError,
      unknownField: s.issueUnknownField,
      emptyFormula: s.issueEmptyFormula,
      overlap: s.issueOverlap,
      outsideColumn: s.issueOutsideColumn,
      textCut: s.issueTextCut,
      checkDigit: s.issueCheckDigit,
    }[issue.code];
    return text.replace('{0}', issue.detail ?? '');
  }

  protected showIssue(issue: ReportIssue): void {
    this.state.selection.set({ kind: 'controls', ids: [issue.controlId] });
  }

  /** Moves (and if needed narrows) an item back inside the paper; a cut text grows to fit instead. */
  protected fixIssue(issue: ReportIssue): void {
    if (issue.code === 'checkDigit') {
      this.state.updateControls([issue.controlId], (c) => {
        if (c.type === 'barcode' && typeof c.value === 'string') c.value = c.value.slice(0, -1) + issue.detail;
      });
      return;
    }
    if (issue.code === 'textCut') {
      this.state.updateControls([issue.controlId], (c) => {
        if (c.type === 'text') c.canGrow = true;
      });
      return;
    }
    const width = resolvePageGeometry(this.state.report().page).contentWidth;
    this.state.updateControls([issue.controlId], (c) => {
      c.width = Math.min(c.width, width);
      c.x = Math.round(Math.max(0, width - c.width) * 100) / 100;
    });
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    // Keys pressed while a sub-report window is open belong to it, even when focus stayed behind it.
    if (this.state.subreportOpen()) return;
    if (e.key === 'F5') {
      // Desktop designers preview with F5; here it switches between design and preview.
      e.preventDefault();
      this.tab.set(this.tab() === 'design' ? 'preview' : 'design');
      return;
    }
    if (this.tab() !== 'design') return;
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    const mod = e.ctrlKey || e.metaKey;
    // Text is being typed on the page and its editor is about to take focus.
    if (this.state.editing() && !typing) {
      e.preventDefault();
      if (e.key === 'Enter' || e.key === 'Escape') this.surface()?.finishEditing(e.key === 'Enter');
      else if (e.key.length === 1 && !mod) this.surface()?.appendToEdit(e.key);
      return;
    }
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.state.redo();
      else this.state.undo();
    } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      this.state.redo();
    } else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase()) && !typing && this.state.selection().kind === 'controls') {
      e.preventDefault();
      this.toggleFormat(({ b: 'bold', i: 'italic', u: 'underline' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u']);
    } else if (mod && e.key === '0' && !typing) {
      e.preventDefault();
      this.fitWidth();
    } else if (mod && (e.key === '=' || e.key === '+') && !typing) {
      e.preventDefault();
      this.setZoom(this.zoomLevel() + 0.1);
    } else if (mod && e.key === '-' && !typing) {
      e.preventDefault();
      this.setZoom(this.zoomLevel() - 0.1);
    } else if (e.key === 'F1') {
      e.preventDefault();
      this.shortcutsOpen.set(!this.shortcutsOpen());
    } else if (!typing && !mod && !e.altKey && e.key.length === 1 && e.key !== ' ' && this.typeStartsEditing()) {
      // Typing on a selected text replaces it, as in a spreadsheet.
      e.preventDefault();
      this.surface()?.startEditing(this.state.selectedControls()[0], undefined, undefined, e.key);
    } else if (e.key === 'Tab' && !typing && !mod) {
      e.preventDefault();
      this.state.selectNext(e.shiftKey ? -1 : 1);
    } else if ((e.key === 'F2' || e.key === 'Enter') && !typing && this.state.selectedControls().length === 1) {
      e.preventDefault();
      this.surface()?.startEditing(this.state.selectedControls()[0]);
    } else if (mod && e.key.startsWith('Arrow') && !typing && this.state.selection().kind === 'controls') {
      // Ctrl+arrow resizes (Shift: 5 mm), plain arrows move.
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      this.state.resizeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    } else if (mod && e.key.toLowerCase() === 'd' && !typing) {
      e.preventDefault();
      this.state.duplicateSelection();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
      if (this.state.selection().kind === 'controls') {
        e.preventDefault();
        this.state.deleteSelection();
      }
    } else if (mod && ['c', 'x', 'v'].includes(e.key.toLowerCase()) && !typing && !e.shiftKey && !e.altKey) {
      // Copy, cut and paste go through the clipboard events below (system clipboard). Browsers
      // that fire no clipboard event on a non-editable element (Safari) get the in-memory clipboard.
      const key = e.key.toLowerCase();
      this.pendingClipboardKey = key;
      setTimeout(() => {
        if (this.pendingClipboardKey !== key) return;
        this.pendingClipboardKey = null;
        if (key === 'c') this.state.copySelection();
        else if (key === 'x') this.state.cutSelection();
        else if (this.state.hasClipboard()) this.state.paste();
      });
    } else if (mod && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      this.state.selectAll();
    } else if (e.key === 'Escape' && !typing) {
      if (this.contextMenu()) this.contextMenu.set(null);
      else if (this.state.painter()) this.state.painter.set(null);
      else this.state.selection.set({ kind: 'none' });
    } else if (e.key.startsWith('Arrow') && !typing && this.state.selection().kind === 'controls') {
      e.preventDefault();
      const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const ids = this.state.selectedControls().map((c) => c.id);
      this.state.updateControls(ids, (c, band) => {
        c.x = Math.max(0, Math.round((c.x + dx) * 100) / 100);
        c.y = Math.max(0, Math.round((c.y + dy) * 100) / 100);
        band.height = Math.max(band.height, c.y + c.height);
      }, 'nudge');
    }
  }
}
