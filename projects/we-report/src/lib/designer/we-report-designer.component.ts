import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { Band, BandKind, checkReport, generateListReport, inferSchema, isExpression, ReportControl, ReportControlType, ReportDefinition, ReportIssue, resolvePageGeometry, resolveReportData } from 'we-report-core';
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

const BAND_ORDER: Record<BandKind, number> = {
  pageHeader: 0,
  reportHeader: 1,
  groupHeader: 2,
  detail: 3,
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
  private readonly defaultLocale = inject(WE_REPORT_LOCALE);
  protected readonly strings = computed(() => this.locale() ?? this.defaultLocale);

  protected readonly toolbox = TOOLBOX_ITEMS;
  protected readonly tab = signal<'design' | 'preview'>('design');
  protected readonly advanced = signal(false);
  protected readonly zoomLevel = signal(1);
  protected readonly fontFamilies = signal<string[]>([]);
  protected readonly bandMenuOpen = signal(false);
  protected readonly dataDialogOpen = signal(false);
  protected readonly problemsOpen = signal(false);
  protected readonly leftTab = signal<'add' | 'outline'>('add');
  /** Right-click menu: screen position and the band it was opened on. */
  protected readonly contextMenu = signal<{ x: number; y: number; bandId: string | null; onControl: boolean } | null>(null);
  private readonly canvas = viewChild<ElementRef<HTMLElement>>('canvas');
  /** Design problems, checked on every edit; field names are judged only when there is data. */
  protected readonly issues = computed<ReportIssue[]>(() => {
    const { rows, parent } = this.fields();
    const known = rows.length || parent.length;
    return checkReport(this.state.report(), known ? rows.map((f) => f.path) : undefined, known ? parent.map((f) => f.path) : undefined);
  });
  /** Show the first data row inside bound controls instead of their formulas. */
  protected readonly showData = signal(true);
  protected readonly sample = computed<DesignSample | null>(() => {
    if (!this.showData()) return null;
    try {
      const { rows, parent } = resolveReportData(this.state.report(), this.data());
      if (!rows?.length && parent === undefined) return null;
      return { row: rows?.[0], rows: rows ?? [], parent };
    } catch {
      return null;
    }
  });

  protected readonly fields = computed(() => designerFields(this.state.report(), this.data()));
  protected readonly allFields = computed<DesignerField[]>(() => [...this.fields().rows, ...this.fields().parent]);
  protected readonly addableBands = computed(() => {
    const kinds = new Set(this.state.report().bands.map((b) => b.kind));
    const list: BandKind[] = (['reportHeader', 'reportFooter', 'pageHeader', 'pageFooter'] as BandKind[]).filter((k) => !kinds.has(k));
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
    this.contextMenu.set({ x: e.clientX, y: e.clientY, bandId: bandEl.dataset['bandId'] ?? null, onControl: !!controlId });
  }

  /** Runs a context-menu command and closes the menu. */
  protected menu(action: () => void): void {
    this.contextMenu.set(null);
    action();
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

  protected addBand(kind: BandKind): void {
    this.bandMenuOpen.set(false);
    const id = this.state.newId(kind);
    this.state.update((d) => {
      if (kind === 'groupHeader') {
        const field = this.allFields().find((f) => !f.parent);
        // Pushed last, so after the stable sort it is the innermost group header…
        d.bands.push({ id, kind, height: 8, groupBy: { expression: field?.expression ?? '' }, controls: [] });
        // …and its footer, placed right after the detail band, the innermost footer.
        const detailIndex = d.bands.findIndex((b) => b.kind === 'detail');
        d.bands.splice(detailIndex + 1, 0, { id: `${id}Footer`, kind: 'groupFooter', groupHeaderId: id, height: 8, controls: [] });
      } else {
        d.bands.push({ id, kind, height: kind.startsWith('page') ? 10 : 15, controls: [] });
      }
      d.bands = orderBands(d.bands);
    });
    this.state.selection.set({ kind: 'band', id });
  }

  /** Replaces the layout with a tidy list of the data (undoable): the fastest way to a first report. */
  protected autoDesign(): void {
    const { rows } = resolveReportData(this.state.report(), this.data());
    const fields = inferSchema(rows ?? []);
    if (!fields.length) return;
    const s = this.strings();
    this.state.update((d) => {
      // A blank report is still called "Report": show the localized word instead.
      const title = d.name && d.name !== 'Report' ? d.name : s.newReportTitle;
      const generated = generateListReport(d, fields, { title, total: s.totalLabel, pageOf: s.pageOfFormat }, '', rows ?? []);
      Object.assign(d, generated);
    });
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
    }[issue.code];
    return text.replace('{0}', issue.detail ?? '');
  }

  protected showIssue(issue: ReportIssue): void {
    this.state.selection.set({ kind: 'controls', ids: [issue.controlId] });
  }

  /** Moves (and if needed narrows) an item back inside the paper. */
  protected fixIssue(issue: ReportIssue): void {
    const width = resolvePageGeometry(this.state.report().page).contentWidth;
    this.state.updateControls([issue.controlId], (c) => {
      c.width = Math.min(c.width, width);
      c.x = Math.round(Math.max(0, width - c.width) * 100) / 100;
    });
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if (this.tab() !== 'design') return;
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.state.redo();
      else this.state.undo();
    } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
      e.preventDefault();
      this.state.redo();
    } else if (mod && e.key.toLowerCase() === 'd' && !typing) {
      e.preventDefault();
      this.state.duplicateSelection();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
      if (this.state.selection().kind === 'controls') {
        e.preventDefault();
        this.state.deleteSelection();
      }
    } else if (mod && e.key.toLowerCase() === 'c' && !typing) {
      if (this.state.copySelection()) e.preventDefault();
    } else if (mod && e.key.toLowerCase() === 'x' && !typing) {
      e.preventDefault();
      this.state.cutSelection();
    } else if (mod && e.key.toLowerCase() === 'v' && !typing && this.state.hasClipboard()) {
      e.preventDefault();
      this.state.paste();
    } else if (mod && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      this.state.selectAll();
    } else if (e.key === 'Escape' && !typing) {
      if (this.contextMenu()) this.contextMenu.set(null);
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
