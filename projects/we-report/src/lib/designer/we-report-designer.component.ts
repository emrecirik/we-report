import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { Band, BandKind, checkReport, generateListReport, inferSchema, isExpression, ReportControl, ReportControlType, ReportDefinition, ReportIssue, ReportStyle, resolvePageGeometry, resolveReportData, resolveStyle, TextAlign } from 'we-report-core';
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

/** Panel widths are a per-browser convenience; storage may be unavailable. */
function readWidth(side: 'left' | 'right', fallback: number): number {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? '{}')[side];
    return typeof saved === 'number' && (saved === 0 || (saved >= 160 && saved <= 480)) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function writeWidth(side: 'left' | 'right', width: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? '{}');
    localStorage.setItem(WIDTH_KEY, JSON.stringify({ ...all, [side]: width }));
  } catch {
    /* not remembered */
  }
}

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
  private readonly surface = viewChild(DesignSurfaceComponent);
  protected readonly shortcutsOpen = signal(false);
  /** Side panel widths in px; 0 hides a panel. Remembered in this browser. */
  protected readonly leftWidth = signal(readWidth('left', 232));
  protected readonly rightWidth = signal(readWidth('right', 288));
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
      writeWidth(side, target());
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  protected togglePanel(side: 'left' | 'right'): void {
    const target = side === 'left' ? this.leftWidth : this.rightWidth;
    target.set(target() ? 0 : side === 'left' ? 232 : 288);
    writeWidth(side, target());
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

  protected setBorder(on: boolean): void {
    const st = this.formatStyle();
    this.state.applyStyle('border', on ? { width: 0.25, color: st?.color ?? '#000000', sides: { top: true, right: true, bottom: true, left: true } } : undefined);
  }
  /** Design problems, checked on every edit; field names are judged only when there is data. */
  protected readonly issues = computed<ReportIssue[]>(() => {
    const { rows, parent } = this.fields();
    const known = rows.length || parent.length;
    const inner = this.fields().inner;
    return checkReport(
      this.state.report(),
      known ? rows.map((f) => f.path) : undefined,
      known ? parent.map((f) => f.path) : undefined,
      undefined,
      inner.length ? inner.map((f) => f.path) : undefined,
    );
  });
  /** Show the first data row inside bound controls instead of their formulas. */
  protected readonly showData = signal(true);
  protected readonly sample = computed<DesignSample | null>(() => (this.showData() ? this.state.sample() : null));

  protected readonly fields = computed(() => designerFields(this.state.report(), this.data()));
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
        if (rows?.length || (parent !== undefined && parent !== null)) sample = { row: rows?.[0], rows: rows ?? [], parent };
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

  protected readonly zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
    this.contextMenu.set({ x: e.clientX, y: e.clientY, bandId: bandEl.dataset['bandId'] ?? null, onControl: !!controlId });
  }

  /** Runs a context-menu command and closes the menu. */
  protected menu(action: () => void): void {
    this.contextMenu.set(null);
    action();
  }

  /** Copy and cut also put the items on the system clipboard, so they paste in another tab. */
  @HostListener('copy', ['$event'])
  @HostListener('cut', ['$event'])
  protected onCopy(e: ClipboardEvent): void {
    if (this.tab() !== 'design' || this.isTyping(e) || !this.state.copySelection()) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', this.state.clipboardText());
    if (e.type === 'cut') this.state.deleteSelection();
  }

  /** Pastes our items, else a picture (screenshot) or text from any other program. */
  @HostListener('paste', ['$event'])
  protected onPaste(e: ClipboardEvent): void {
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
      } else if (kind === 'subDetail') {
        d.bands.push({ id, kind, height: 6, rowsPath: this.fields().lists[0], controls: [] });
      } else {
        d.bands.push({ id, kind, height: kind.startsWith('page') ? 10 : kind.startsWith('sub') ? 6 : 15, controls: [] });
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
      outsideColumn: s.issueOutsideColumn,
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
    } else if (mod && e.key.toLowerCase() === 'c' && !typing) {
      // Copy, cut and paste go through the clipboard events below (system clipboard).
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
