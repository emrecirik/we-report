import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FontRegistry, LayoutDocument, LayoutProblem, layoutReport, loadReportData, renderPdf, ReportDefinition, ReportParameter, reportTable, writeXlsx } from 'we-report-core';
import { WE_REPORT_CONFIG } from '../we-report-config';
import { WeReportBackendService } from '../we-report-backend.service';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { WE_REPORT_LOCALE, WeReportLocale } from '../we-report-locale';
import { WeReportPageComponent } from './we-report-page.component';

/** Paged preview of a report with zoom, PDF download and print. No server involved. */
@Component({
  selector: 'we-report-viewer',
  standalone: true,
  imports: [WeReportPageComponent, WeReportIconPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="we-report-viewer__toolbar" role="toolbar">
      <button type="button" class="we-report-viewer__btn" (click)="setZoom(zoomLevel() - 0.1)" [attr.aria-label]="strings().zoomOut" [title]="strings().zoomOut + ' (Ctrl+-)'" [innerHTML]="'zoomOut' | weReportIcon"></button>
      <select class="we-report-viewer__zoomsel" (change)="pickZoom($any($event.target).value); $any($event.target).value = ''" [attr.aria-label]="strings().zoomLevel">
        <option value="" selected>{{ (zoomLevel() * 100).toFixed(0) }}%</option>
        @for (z of zoomSteps; track z) {
          <option [value]="z">{{ z * 100 }}%</option>
        }
        <option value="width">{{ strings().fitWidth }}</option>
        <option value="page">{{ strings().fitPage }}</option>
      </select>
      <button type="button" class="we-report-viewer__btn" (click)="setZoom(zoomLevel() + 0.1)" [attr.aria-label]="strings().zoomIn" [title]="strings().zoomIn + ' (Ctrl+=)'" [innerHTML]="'zoomIn' | weReportIcon"></button>
      @if (pageTotal() > 1) {
        <span class="we-report-viewer__sep"></span>
        <button type="button" class="we-report-viewer__btn" [class.we-report-viewer__btn--on]="showThumbs()" (click)="showThumbs.set(!showThumbs())" [title]="strings().thumbnails" [attr.aria-label]="strings().thumbnails" [attr.aria-pressed]="showThumbs()" [innerHTML]="'thumbnails' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() <= 1" (click)="goToPage(1)" [title]="strings().firstPage + ' (Home)'" [attr.aria-label]="strings().firstPage" [innerHTML]="'firstPage' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() <= 1" (click)="goToPage(currentPage() - 1)" [title]="strings().previousPage + ' (PgUp)'" [attr.aria-label]="strings().previousPage" [innerHTML]="'previousPage' | weReportIcon"></button>
        <input class="we-report-viewer__pagebox" type="number" min="1" [max]="pageTotal()" [value]="currentPage()" (change)="goToPage(+$any($event.target).value)" [attr.aria-label]="strings().pageNumber" />
        <span class="we-report-viewer__pages">{{ strings().pageOf.replace('{0}', '' + pageTotal()) }}</span>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() >= pageTotal()" (click)="goToPage(currentPage() + 1)" [title]="strings().nextPage + ' (PgDn)'" [attr.aria-label]="strings().nextPage" [innerHTML]="'nextPage' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() >= pageTotal()" (click)="goToPage(pageTotal())" [title]="strings().lastPage + ' (End)'" [attr.aria-label]="strings().lastPage" [innerHTML]="'lastPage' | weReportIcon"></button>
      } @else {
        <span class="we-report-viewer__pages">{{ pageLabel() }}</span>
      }
      <span class="we-report-viewer__sep"></span>
      <input #searchBox class="we-report-viewer__search" type="search" [placeholder]="strings().search + ' (Ctrl+F)'" [value]="query()" (input)="setQuery($any($event.target).value)" (keydown.enter)="nextMatch($any($event).shiftKey ? -1 : 1)" [attr.aria-label]="strings().search" />
      @if (query().trim()) {
        <span class="we-report-viewer__pages">{{ matches().length ? strings().matches.replace('{0}', '' + (matchIndex() + 1)).replace('{1}', '' + matches().length) : strings().noMatches }}</span>
        <button type="button" class="we-report-viewer__btn" [disabled]="!matches().length" (click)="nextMatch(-1)" [attr.aria-label]="strings().previousMatch" [title]="strings().previousMatch + ' (Shift+Enter)'" [innerHTML]="'chevronUp' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="!matches().length" (click)="nextMatch(1)" [attr.aria-label]="strings().nextMatch" [title]="strings().nextMatch + ' (Enter)'" [innerHTML]="'chevronDown' | weReportIcon"></button>
      }
      <span class="we-report-viewer__spacer"></span>
      <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="print()" [disabled]="!document()">
        <span [innerHTML]="'print' | weReportIcon"></span>{{ strings().print }}
      </button>
      <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="downloadExcel()" [disabled]="!document()">
        <span [innerHTML]="'download' | weReportIcon"></span>{{ strings().downloadExcel }}
      </button>
      <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="downloadPdf()" [disabled]="!document()">
        <span [innerHTML]="'download' | weReportIcon"></span>{{ strings().downloadPdf }}
      </button>
    </div>
    @if (report().parameters?.length) {
      <form class="we-report-viewer__params" (submit)="$event.preventDefault(); applyParams()">
        @for (p of report().parameters!; track p.name) {
          <label>
            <span>{{ p.label || p.name }}</span>
            @switch (p.type) {
              @case ('boolean') {
                <input type="checkbox" [checked]="paramValue(p) === true" (change)="setParam(p, $any($event.target).checked)" />
              }
              @case ('date') {
                <input type="date" [value]="paramValue(p) ?? ''" (input)="setParam(p, $any($event.target).value)" />
              }
              @case ('number') {
                <input type="number" [value]="paramValue(p) ?? ''" (input)="setParam(p, $any($event.target).value)" />
              }
              @default {
                <input [value]="paramValue(p) ?? ''" (input)="setParam(p, $any($event.target).value)" />
              }
            }
          </label>
        }
        <button type="submit" class="we-report-viewer__btn we-report-viewer__btn--text">{{ strings().runReport }}</button>
      </form>
    }
    @for (e of loadErrors(); track $index) {
      <div class="we-report-viewer__error" role="alert">{{ strings().dataLoadError }}: {{ e }}</div>
    }
    @for (w of loadWarnings(); track $index) {
      <div class="we-report-viewer__error">{{ w }}</div>
    }
    @if (error(); as message) {
      <div class="we-report-viewer__error" role="alert">{{ strings().layoutError }}: {{ message }}</div>
    }
    @if (document()?.problems?.length) {
      <details class="we-report-viewer__problems">
        <summary>{{ strings().problems }} ({{ document()!.problems.length }})</summary>
        <ul>
          @for (p of document()!.problems; track $index) {
            <li>{{ p.controlId ? p.controlId + ': ' : '' }}{{ p.message }}</li>
          }
        </ul>
      </details>
    }
    <div class="we-report-viewer__main">
    @if (showThumbs() && pageTotal() > 1) {
      <nav #thumbs class="we-report-viewer__thumbs" [attr.aria-label]="strings().thumbnails">
        @for (page of document()!.pages; track $index; let p = $index) {
          <button type="button" class="we-report-viewer__thumb" [class.we-report-viewer__thumb--current]="currentPage() === p + 1" (click)="goToPage(p + 1)" [attr.aria-label]="strings().pageNumber + ' ' + (p + 1)">
            @defer (on viewport) {
              <we-report-page [page]="page" [zoom]="thumbZoom" />
            } @placeholder {
              <div class="we-report-viewer__thumb-blank" [style.width.mm]="page.width * thumbZoom" [style.height.mm]="page.height * thumbZoom"></div>
            }
            <span>{{ p + 1 }}</span>
          </button>
        }
      </nav>
    }
    <div #scroller class="we-report-viewer__scroll" tabindex="0" (scroll)="onScroll()">
      @if (document(); as doc) {
        @for (page of doc.pages; track $index; let p = $index) {
          <we-report-page
            class="we-report-viewer__page"
            [attr.data-page]="p + 1"
            [page]="page"
            [zoom]="zoomLevel()"
            [highlight]="query()"
            [locale]="config.locale"
            [current]="currentHit()?.page === p ? currentHit() : null"
          />
        }
      } @else if (!error()) {
        <div class="we-report-viewer__loading">{{ strings().loading }}</div>
      }
    </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      font-family: var(--we-report-font-family, system-ui, sans-serif);
      font-size: 13px;
      letter-spacing: -0.003em;
      color: var(--we-report-fg, #1d1d1f);
      background: var(--we-report-workspace-bg, #f2f2f7);
      -webkit-font-smoothing: antialiased;
    }
    .we-report-viewer__toolbar,
    .we-report-viewer__params {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      padding: 8px 14px;
      background: var(--we-report-toolbar-bg, rgba(250, 250, 252, 0.82));
      backdrop-filter: saturate(180%) blur(20px);
      -webkit-backdrop-filter: saturate(180%) blur(20px);
      border-bottom: 0.5px solid var(--we-report-separator, rgba(60, 60, 67, 0.14));
    }
    .we-report-viewer__btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 30px;
      height: 30px;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.15s ease, box-shadow 0.15s ease;
    }
    .we-report-viewer__btn--text {
      padding: 0 10px;
    }
    .we-report-viewer__btn:hover:not(:disabled) {
      background: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
    }
    .we-report-viewer__btn:focus-visible,
    .we-report-viewer__params input:focus {
      outline: none;
      box-shadow: var(--we-report-focus-ring, 0 0 0 3px rgba(0, 122, 255, 0.35));
    }
    .we-report-viewer__btn:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .we-report-viewer__btn :is(svg) {
      width: 17px;
      height: 17px;
    }
    .we-report-viewer__zoom {
      min-width: 44px;
      text-align: center;
      font-variant-numeric: tabular-nums;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
    }
    .we-report-viewer__pages {
      margin-left: 8px;
      font-variant-numeric: tabular-nums;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
    }
    .we-report-viewer__sep {
      width: 0.5px;
      height: 20px;
      margin: 0 6px;
      background: var(--we-report-separator, rgba(60, 60, 67, 0.14));
    }
    .we-report-viewer__zoomsel,
    .we-report-viewer__pagebox,
    .we-report-viewer__search {
      height: 28px;
      box-sizing: border-box;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      padding: 0 8px;
      background: var(--we-report-input-bg, rgba(118, 118, 128, 0.1));
      color: inherit;
      font: inherit;
      font-variant-numeric: tabular-nums;
    }
    .we-report-viewer__zoomsel:focus,
    .we-report-viewer__pagebox:focus,
    .we-report-viewer__search:focus {
      outline: none;
      box-shadow: var(--we-report-focus-ring, 0 0 0 3px rgba(0, 122, 255, 0.35));
    }
    .we-report-viewer__pagebox {
      width: 56px;
      text-align: center;
    }
    .we-report-viewer__search {
      width: 180px;
    }
    .we-report-viewer__scroll:focus {
      outline: none;
    }
    .we-report-viewer__spacer {
      flex: 1;
    }
    .we-report-viewer__main {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .we-report-viewer__thumbs {
      flex: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      overflow: auto;
      padding: 16px 12px;
      border-right: 0.5px solid var(--we-report-separator, rgba(60, 60, 67, 0.14));
      background: var(--we-report-panel-bg, #fbfbfd);
    }
    .we-report-viewer__thumb {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      border: 0;
      padding: 4px;
      border-radius: 6px;
      background: none;
      color: inherit;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .we-report-viewer__thumb--current {
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.12));
    }
    .we-report-viewer__thumb we-report-page,
    .we-report-viewer__thumb-blank {
      background: var(--we-report-page-bg, #fff);
      box-shadow: 0 0 0 0.5px var(--we-report-separator, rgba(60, 60, 67, 0.14));
      pointer-events: none;
    }
    .we-report-viewer__btn--on {
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.12));
    }
    .we-report-viewer__scroll {
      flex: 1;
      overflow: auto;
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
    }
    .we-report-viewer__page {
      border-radius: 2px;
    }
    .we-report-viewer__params {
      align-items: flex-end;
      gap: 12px;
      font-size: 12px;
    }
    .we-report-viewer__params label {
      display: flex;
      flex-direction: column;
      gap: 3px;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
    }
    .we-report-viewer__params input:not([type='checkbox']) {
      font: inherit;
      font-size: 13px;
      padding: 5px 8px;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      background: var(--we-report-input-bg, rgba(118, 118, 128, 0.1));
      color: var(--we-report-fg, #1d1d1f);
    }
    .we-report-viewer__params input[type='checkbox'] {
      accent-color: var(--we-report-accent, #007aff);
    }
    .we-report-viewer__params button[type='submit'] {
      background: var(--we-report-accent, #007aff);
      color: var(--we-report-accent-fg, #fff);
      padding: 0 14px;
    }
    .we-report-viewer__params button[type='submit']:hover {
      background: var(--we-report-accent, #007aff);
      filter: brightness(1.08);
    }
    .we-report-viewer__error,
    .we-report-viewer__problems {
      margin: 10px 14px 0;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      background: var(--we-report-warning-bg, rgba(255, 149, 0, 0.12));
      color: var(--we-report-warning-fg, #b25000);
    }
    .we-report-viewer__problems summary {
      cursor: pointer;
      font-weight: 500;
    }
    .we-report-viewer__problems ul {
      margin: 6px 0 0;
      padding-left: 18px;
    }
    .we-report-viewer__loading {
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
    }
    @media (prefers-reduced-motion: reduce) {
      .we-report-viewer__btn {
        transition: none;
      }
    }
    @media print {
      .we-report-viewer__toolbar {
        display: none;
      }
    }
  `,
})
export class WeReportViewerComponent {
  readonly report = input.required<ReportDefinition>();
  /** Rows (or an object holding them) to print; replaces the report's own data source data. */
  readonly data = input<unknown>(undefined);
  readonly zoom = input(1);
  /** Overrides the `WE_REPORT_LOCALE` token. */
  readonly locale = input<WeReportLocale | undefined>(undefined);
  /** Print time; defaults to now. Fix it for reproducible output. */
  readonly printDate = input<Date | undefined>(undefined);
  /** Report parameter values from the host; the user can still change them in the parameter bar. */
  readonly parameters = input<Record<string, unknown>>({});
  /** Fetch used for web-service data sources (add auth, or route through your backend). */
  readonly fetchFn = input<typeof fetch | undefined>(undefined);

  readonly problems = output<LayoutProblem[]>();
  readonly rendered = output<LayoutDocument>();

  protected readonly config = inject(WE_REPORT_CONFIG);
  private readonly fontsService = inject(WeReportFontsService);
  private readonly backend = inject(WeReportBackendService);
  private readonly dom = inject(DOCUMENT);
  private readonly defaultLocale = inject(WE_REPORT_LOCALE);
  protected readonly strings = computed(() => this.locale() ?? this.defaultLocale);

  protected readonly zoomLevel = signal(1);
  protected readonly document = signal<LayoutDocument | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loadErrors = signal<string[]>([]);
  protected readonly loadWarnings = signal<string[]>([]);
  /** Values typed into the parameter bar, applied with "Run report". */
  private readonly draftParams = signal<Record<string, unknown>>({});
  private readonly appliedParams = signal<Record<string, unknown>>({});
  protected readonly pageLabel = computed(() => {
    const doc = this.document();
    return doc ? this.strings().pageCount.replace('{0}', String(doc.pages.length)) : '';
  });

  private fonts?: FontRegistry;
  private run = 0;
  /** What the current preview was laid out from, so exports use exactly the same data. */
  private lastInput: { data: unknown; sources: Record<string, unknown>; params: Record<string, unknown>; now?: Date } = { data: undefined, sources: {}, params: {} };

  constructor() {
    effect(() => this.zoomLevel.set(this.zoom()), { allowSignalWrites: true });
    effect(() => {
      const values = { ...this.parameters() };
      untracked(() => {
        this.draftParams.set(values);
        this.appliedParams.set(values);
      });
    }, { allowSignalWrites: true });
    effect(() => {
      const report = this.report();
      const data = this.data();
      const now = this.printDate();
      const params = this.appliedParams();
      untracked(() => this.layout(report, data, now, params));
    }, { allowSignalWrites: true });
  }

  protected readonly zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];
  protected readonly showThumbs = signal(false);
  protected readonly thumbZoom = 0.18;
  protected readonly currentPage = signal(1);
  protected readonly pageTotal = computed(() => this.document()?.pages.length ?? 0);
  protected readonly query = signal('');
  protected readonly matchIndex = signal(0);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly thumbs = viewChild<ElementRef<HTMLElement>>('thumbs');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  /** Every line containing the search text: page, item and line index, in reading order. */
  protected readonly matches = computed(() => {
    const q = this.query().trim().toLocaleLowerCase(this.config.locale);
    const doc = this.document();
    if (!q || !doc) return [];
    const out: { page: number; item: number; line: number }[] = [];
    doc.pages.forEach((page, p) =>
      page.items.forEach((item, i) => {
        if (item.kind !== 'text') return;
        item.lines.forEach((line, l) => {
          if (line.text.toLocaleLowerCase(this.config.locale).includes(q)) out.push({ page: p, item: i, line: l });
        });
      }),
    );
    return out;
  });
  protected readonly currentHit = computed(() => this.matches()[this.matchIndex()] ?? null);

  protected setQuery(value: string): void {
    this.query.set(value);
    this.matchIndex.set(0);
    queueMicrotask(() => this.revealHit());
  }

  protected nextMatch(step: 1 | -1): void {
    const n = this.matches().length;
    if (!n) return;
    this.matchIndex.set((this.matchIndex() + step + n) % n);
    queueMicrotask(() => this.revealHit());
  }

  private revealHit(): void {
    const hit = this.currentHit();
    if (!hit) return;
    // Rendered after this change: wait a frame, then bring the line into view.
    requestAnimationFrame(() => {
      const page = this.scroller()?.nativeElement.querySelector(`[data-page="${hit.page + 1}"]`);
      const rect = page?.querySelector(`[data-hit="${hit.item}-${hit.line}"]`) ?? page;
      rect?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  protected goToPage(n: number): void {
    const target = Math.min(Math.max(1, Math.round(n) || 1), this.pageTotal());
    this.scroller()?.nativeElement.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: 'start' });
    this.setCurrent(target);
  }

  /** The page whose top is nearest the top of the view is the current page. */
  protected onScroll(): void {
    const box = this.scroller()?.nativeElement;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    let best = 1;
    box.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      if (el.getBoundingClientRect().top - top <= box.clientHeight / 3) best = Number(el.dataset['page']);
    });
    if (best !== this.currentPage()) this.setCurrent(best);
  }

  private setCurrent(page: number): void {
    this.currentPage.set(page);
    // Keep the current page's thumbnail in sight.
    this.thumbs()?.nativeElement.children[page - 1]?.scrollIntoView({ block: 'nearest' });
  }

  protected pickZoom(value: string): void {
    const box = this.scroller()?.nativeElement;
    const page = this.document()?.pages[0];
    if ((value === 'width' || value === 'page') && box && page) {
      const pxPerMm = 96 / 25.4;
      const byWidth = (box.clientWidth - 64) / (page.width * pxPerMm);
      const byHeight = (box.clientHeight - 64) / (page.height * pxPerMm);
      this.setZoom(value === 'width' ? byWidth : Math.min(byWidth, byHeight));
    } else if (value) {
      this.setZoom(Number(value));
    }
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const typing = (e.target as HTMLElement).closest('input, textarea, select');
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.searchBox()?.nativeElement.focus();
      this.searchBox()?.nativeElement.select();
    } else if (mod && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      void this.print();
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      this.setZoom(this.zoomLevel() + 0.1);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      this.setZoom(this.zoomLevel() - 0.1);
    } else if (!typing && (e.key === 'PageDown' || e.key === 'PageUp')) {
      e.preventDefault();
      this.goToPage(this.currentPage() + (e.key === 'PageDown' ? 1 : -1));
    } else if (!typing && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      this.goToPage(e.key === 'Home' ? 1 : this.pageTotal());
    }
  }

  protected setZoom(value: number): void {
    this.zoomLevel.set(Math.min(4, Math.max(0.25, Math.round(value * 100) / 100)));
  }

  protected paramValue(p: ReportParameter): unknown {
    const values = this.draftParams();
    return Object.prototype.hasOwnProperty.call(values, p.name) ? values[p.name] : p.defaultValue;
  }

  protected setParam(p: ReportParameter, value: unknown): void {
    this.draftParams.update((v) => ({ ...v, [p.name]: value }));
  }

  protected applyParams(): void {
    this.appliedParams.set({ ...this.draftParams() });
  }

  private async layout(report: ReportDefinition, data: unknown, now: Date | undefined, params: Record<string, unknown>): Promise<void> {
    const run = ++this.run;
    try {
      this.fonts ??= await this.fontsService.ready();
      // Host data replaces the bound source, so only call web services when there is none.
      const loaded =
        data === undefined && report.dataSources.some((s) => s.kind === 'webService' || s.kind === 'database')
          ? await loadReportData(report, { params, fetch: this.fetchFn(), backendUrl: this.backend.url() || undefined })
          : { sources: {}, errors: [], warnings: [] };
      if (run !== this.run) return;
      this.lastInput = { data, sources: loaded.sources, params, now };
      this.loadErrors.set(loaded.errors.map((e) => e.message));
      this.loadWarnings.set(loaded.warnings.map((e) => e.message));
      const doc = layoutReport(report, {
        fonts: this.fonts,
        now: now ?? new Date(),
        data,
        sources: loaded.sources,
        params,
        locale: this.config.locale,
        currency: this.config.currency,
      });
      this.error.set(null);
      this.document.set(doc);
      this.problems.emit(doc.problems);
      this.rendered.emit(doc);
    } catch (e) {
      if (run !== this.run) return;
      this.document.set(null);
      this.error.set((e as Error).message);
    }
  }

  /** The current preview as PDF bytes. */
  async toPdf(): Promise<Uint8Array> {
    const doc = this.document();
    if (!doc || !this.fonts) throw new Error('The report is not rendered yet.');
    return renderPdf(doc, this.fonts, { title: this.report().name, date: this.printDate() });
  }

  /** The report's rows as an Excel workbook (one column per detail field, typed values). */
  toXlsx(): Uint8Array {
    const { data, sources, params, now } = this.lastInput;
    const table = reportTable(this.report(), { data, sources, params, now: now ?? new Date(), locale: this.config.locale });
    return writeXlsx(table, this.report().name || 'Report');
  }

  protected async downloadPdf(): Promise<void> {
    this.save(new Blob([await this.toPdf()], { type: 'application/pdf' }), 'pdf');
  }

  protected downloadExcel(): void {
    this.save(new Blob([this.toXlsx()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'xlsx');
  }

  private save(blob: Blob, extension: string): void {
    const url = URL.createObjectURL(blob);
    const a = this.dom.createElement('a');
    a.href = url;
    a.download = `${this.report().name || 'report'}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Prints the PDF through a hidden frame, so page size and margins are exact. */
  protected async print(): Promise<void> {
    const url = URL.createObjectURL(new Blob([await this.toPdf()], { type: 'application/pdf' }));
    const frame = this.dom.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.src = url;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    this.dom.body.appendChild(frame);
  }
}
