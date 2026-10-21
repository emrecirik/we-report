import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { allDataSources, escPosFromBitmaps, FontRegistry, LayoutBookmark, LayoutDocument, LayoutProblem, layoutReport, loadReportData, MonoBitmap, parameterChoices, renderPdf, ReportDefinition, ReportParameter, reportTable, storedZip, toMonoBitmap, writeCsv, writeXlsx, zplFromBitmaps } from 'we-report-core';
import { WE_REPORT_CONFIG } from '../we-report-config';
import { WeReportBackendService } from '../we-report-backend.service';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { WE_REPORT_LOCALE, WeReportLocale } from '../we-report-locale';
import { drawPage, pictureDataUri } from './page-canvas';

/** A part of the viewer's toolbar that the host can leave out (`hide`). */
export type WeReportViewerTool = 'print' | 'pdf' | 'excel' | 'png' | 'more' | 'search' | 'thumbnails' | 'map';

/** Pictures from addresses: at most this many per report, each at most this big. */
const MAX_PICTURES = 200;
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
/** A picture that has not arrived by then counts as failed, so one slow server cannot hold the preview. */
const PICTURE_TIMEOUT_MS = 15_000;
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
      @if (document()?.bookmarks?.length && !hidden('map')) {
        <button type="button" class="we-report-viewer__btn" [class.we-report-viewer__btn--on]="showMap()" (click)="showMap.set(!showMap())" [title]="strings().documentMap" [attr.aria-label]="strings().documentMap" [attr.aria-pressed]="showMap()" [innerHTML]="'outline' | weReportIcon"></button>
      }
      @if (pageTotal() > 1) {
        <span class="we-report-viewer__sep"></span>
        @if (!hidden('thumbnails')) {
          <button type="button" class="we-report-viewer__btn" [class.we-report-viewer__btn--on]="showThumbs()" (click)="showThumbs.set(!showThumbs())" [title]="strings().thumbnails" [attr.aria-label]="strings().thumbnails" [attr.aria-pressed]="showThumbs()" [innerHTML]="'thumbnails' | weReportIcon"></button>
        }
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() <= 1" (click)="goToPage(1)" [title]="strings().firstPage + ' (Home)'" [attr.aria-label]="strings().firstPage" [innerHTML]="'firstPage' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() <= 1" (click)="goToPage(currentPage() - 1)" [title]="strings().previousPage + ' (PgUp)'" [attr.aria-label]="strings().previousPage" [innerHTML]="'previousPage' | weReportIcon"></button>
        <input class="we-report-viewer__pagebox" type="number" min="1" [max]="pageTotal()" [value]="currentPage()" (change)="goToPage(+$any($event.target).value)" [attr.aria-label]="strings().pageNumber" />
        <span class="we-report-viewer__pages">{{ strings().pageOf.replace('{0}', '' + pageTotal()) }}</span>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() >= pageTotal()" (click)="goToPage(currentPage() + 1)" [title]="strings().nextPage + ' (PgDn)'" [attr.aria-label]="strings().nextPage" [innerHTML]="'nextPage' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="currentPage() >= pageTotal()" (click)="goToPage(pageTotal())" [title]="strings().lastPage + ' (End)'" [attr.aria-label]="strings().lastPage" [innerHTML]="'lastPage' | weReportIcon"></button>
      } @else {
        <span class="we-report-viewer__pages">{{ pageLabel() }}</span>
      }
      @if (!hidden('search')) {
      <span class="we-report-viewer__sep"></span>
      <input #searchBox class="we-report-viewer__search" type="search" [placeholder]="strings().search + ' (Ctrl+F)'" [value]="query()" (input)="setQuery($any($event.target).value)" (keydown.enter)="nextMatch($any($event).shiftKey ? -1 : 1)" [attr.aria-label]="strings().search" />
      }
      @if (query().trim()) {
        <span class="we-report-viewer__pages">{{ matches().length ? strings().matches.replace('{0}', '' + (matchIndex() + 1)).replace('{1}', '' + matches().length) : strings().noMatches }}</span>
        <button type="button" class="we-report-viewer__btn" [disabled]="!matches().length" (click)="nextMatch(-1)" [attr.aria-label]="strings().previousMatch" [title]="strings().previousMatch + ' (Shift+Enter)'" [innerHTML]="'chevronUp' | weReportIcon"></button>
        <button type="button" class="we-report-viewer__btn" [disabled]="!matches().length" (click)="nextMatch(1)" [attr.aria-label]="strings().nextMatch" [title]="strings().nextMatch + ' (Enter)'" [innerHTML]="'chevronDown' | weReportIcon"></button>
      }
      <span class="we-report-viewer__spacer"></span>
      @if (!hidden('print')) {
        <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="print()" [disabled]="!document()">
          <span [innerHTML]="'print' | weReportIcon"></span>{{ strings().print }}
        </button>
      }
      @if (!hidden('excel')) {
        <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="downloadExcel()" [disabled]="!document()">
          <span [innerHTML]="'download' | weReportIcon"></span>{{ strings().downloadExcel }}
        </button>
      }
      @if (!hidden('png')) {
        <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="downloadPng()" [disabled]="!document()" [title]="strings().downloadPng + ' · ' + strings().pageNumber + ' ' + currentPage()">
          <span [innerHTML]="'download' | weReportIcon"></span>{{ strings().downloadPng }}
        </button>
      }
      @if (!hidden('more')) {
      <select class="we-report-viewer__more" [disabled]="!document()" (change)="downloadForPrinter($any($event.target).value); $any($event.target).value = ''" [attr.aria-label]="strings().printerOutput" [title]="strings().printerOutputHint">
        <option value="" selected>{{ strings().printerOutput }}…</option>
        <option value="csv">CSV</option>
        <option value="pngzip">{{ strings().pngAllPages }}</option>
        <option value="zpl">{{ strings().printerZpl }}</option>
        <option value="escpos58">{{ strings().printerEscPos }} · 58 mm</option>
        <option value="escpos80">{{ strings().printerEscPos }} · 80 mm</option>
      </select>
      }
      @if (!hidden('pdf')) {
        <button type="button" class="we-report-viewer__btn we-report-viewer__btn--text" (click)="downloadPdf()" [disabled]="!document()">
          <span [innerHTML]="'download' | weReportIcon"></span>{{ strings().downloadPdf }}
        </button>
      }
    </div>
    @if (report().parameters?.length) {
      <form class="we-report-viewer__params" (submit)="$event.preventDefault(); applyParams()">
        @for (p of report().parameters!; track p.name) {
          <label>
            <span>{{ p.label || p.name }}</span>
            @let options = choices()[p.name];
            @if (options?.length) {
              <select (change)="setParam(p, $any($event.target).value)">
                <option value="" [selected]="(paramValue(p) ?? '') === ''">—</option>
                @for (o of options; track o.value) {
                  <option [value]="o.value" [selected]="'' + o.value === '' + (paramValue(p) ?? '')">{{ o.label }}</option>
                }
              </select>
            } @else {
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
    @if (showMap() && document()?.bookmarks?.length) {
      <nav class="we-report-viewer__map" [attr.aria-label]="strings().documentMap">
        @for (mark of document()!.bookmarks!; track $index) {
          <button type="button" class="we-report-viewer__mark" [style.padding-left.px]="8 + mark.level * 14" (click)="goToBookmark(mark)">{{ mark.title }}</button>
        }
      </nav>
    }
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
    <div #scroller class="we-report-viewer__scroll" tabindex="0" (scroll)="onScroll()" (wheel)="onWheel($event)">
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
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .we-report-viewer__pages {
      margin-left: 8px;
      font-variant-numeric: tabular-nums;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
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
    .we-report-viewer__map {
      flex: none;
      display: flex;
      flex-direction: column;
      width: 220px;
      overflow: auto;
      padding: 8px 4px;
      border-right: 0.5px solid var(--we-report-separator, rgba(60, 60, 67, 0.14));
      background: var(--we-report-panel-bg, #fbfbfd);
    }
    .we-report-viewer__mark {
      border: 0;
      padding: 4px 8px;
      border-radius: 6px;
      background: none;
      color: inherit;
      font: inherit;
      font-size: 12px;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .we-report-viewer__mark:hover {
      background: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
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
      align-items: flex-start;
      gap: 32px;
    }
    /* Auto margins centre a page but, unlike align-items: center, never push a wide one out of reach. */
    .we-report-viewer__scroll > * {
      margin-inline: auto;
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
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .we-report-viewer__more,
    .we-report-viewer__params input:not([type='checkbox']),
    .we-report-viewer__params select {
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
      color: var(--we-report-warning-fg, #9a4400);
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
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
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
  /** The row around the report, read with `[^.field]` (e.g. previewing a sub-report on its own). */
  readonly outerRow = input<unknown>(undefined);
  /** Default 1; at 1, a page wider than the viewer (a phone) first shows at its width. */
  readonly zoom = input(1);
  /** Overrides the `WE_REPORT_LOCALE` token. */
  readonly locale = input<WeReportLocale | undefined>(undefined);
  /** Print time; defaults to now. Fix it for reproducible output. */
  readonly printDate = input<Date | undefined>(undefined);
  /** Report parameter values from the host; the user can still change them in the parameter bar. */
  readonly parameters = input<Record<string, unknown>>({});
  /** Toolbar parts to leave out, e.g. `['excel', 'more']`; the methods (`toPdf()` …) stay available. */
  readonly hide = input<readonly WeReportViewerTool[]>([]);
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
  /** Web-service and database responses of the last run, for parameter lists drawn from them. */
  private readonly loadedSources = signal<Record<string, unknown>>({});
  protected readonly choices = computed(() => {
    const report = this.report();
    const sources = this.loadedSources();
    return Object.fromEntries((report.parameters ?? []).map((p) => [p.name, parameterChoices(report, p, sources)]));
  });
  protected readonly pageLabel = computed(() => {
    const doc = this.document();
    return doc ? this.strings().pageCount.replace('{0}', String(doc.pages.length)) : '';
  });

  private fonts?: FontRegistry;
  private run = 0;
  /** Pictures fetched for image addresses (URL → data URI), kept between runs; failures are tried again next run. */
  private readonly pictures = new Map<string, string>();
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
      this.outerRow(); // lays out again when the row around changes
      const now = this.printDate();
      const params = this.appliedParams();
      untracked(() => this.layout(report, data, now, params));
    }, { allowSignalWrites: true });
  }

  protected readonly zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];
  protected readonly showThumbs = signal(false);
  /** The document map: the bookmarked groups and rows, for jumping to them. */
  protected readonly showMap = signal(false);
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

  /** Scrolls to a document-map entry: its page, then down to the section on it. */
  protected goToBookmark(mark: LayoutBookmark): void {
    this.goToPage(mark.pageIndex + 1);
    const box = this.scroller()?.nativeElement;
    const pageEl = box?.querySelector<HTMLElement>(`[data-page="${mark.pageIndex + 1}"]`);
    const page = this.document()?.pages[mark.pageIndex];
    if (box && pageEl && page) box.scrollTop += (mark.y / page.height) * pageEl.getBoundingClientRect().height;
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

  /** Ctrl + wheel (and a trackpad pinch) zooms, as in the designer and desktop viewers. */
  protected onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setZoom(this.zoomLevel() + (e.deltaY < 0 ? 0.1 : -0.1));
  }

  private fittedOnce = false;
  /** On a screen narrower than the page (a phone), the first preview at the default zoom fits the page's width. */
  private fitNarrowScreen(doc: LayoutDocument): void {
    const box = this.scroller()?.nativeElement;
    const page = doc.pages[0];
    if (this.fittedOnce || !box?.clientWidth || !page) return;
    this.fittedOnce = true;
    if (this.zoomLevel() === 1 && page.width * (96 / 25.4) + 64 > box.clientWidth) this.pickZoom('width');
  }

  protected pickZoom(value: string): void {
    const box = this.scroller()?.nativeElement;
    const page = this.document()?.pages[0];
    if ((value === 'width' || value === 'page') && box && page) {
      const pxPerMm = 96 / 25.4;
      // Room for the vertical scrollbar the zoomed pages will bring, when it is not there yet.
      const scrollbar = box.offsetWidth > box.clientWidth ? 0 : 16;
      const byWidth = (box.clientWidth - 64 - scrollbar) / (page.width * pxPerMm);
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
      // A host that hides Print does not get it back through the shortcut.
      if (!this.hidden('print')) void this.print();
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

  protected hidden(tool: WeReportViewerTool): boolean {
    return this.hide().includes(tool);
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
        data === undefined && allDataSources(report).some((s) => s.kind === 'webService' || s.kind === 'database')
          ? await loadReportData(report, { params, fetch: this.fetchFn(), backendUrl: this.backend.url() || undefined })
          : { sources: {}, errors: [], warnings: [] };
      if (run !== this.run) return;
      this.lastInput = { data, sources: loaded.sources, params, now };
      this.loadedSources.set(loaded.sources);
      this.loadErrors.set(loaded.errors.map((e) => e.message));
      this.loadWarnings.set(loaded.warnings.map((e) => e.message));
      const failed = new Map<string, string>();
      const lay = () =>
        layoutReport(report, {
          fonts: this.fonts!,
          now: now ?? new Date(),
          data,
          sources: loaded.sources,
          params,
          parent: this.outerRow(),
          images: Object.fromEntries([...this.pictures, ...failed]),
          locale: this.config.locale,
          currency: this.config.currency,
        });
      let doc = lay();
      // Pictures from addresses: fetch the ones the layout asked for, then lay out again.
      if (doc.imageUrls?.length) {
        await this.fetchPictures(doc.imageUrls, failed);
        if (run !== this.run) return;
        doc = lay();
      }
      this.error.set(null);
      this.document.set(doc);
      this.fitNarrowScreen(doc);
      this.problems.emit(doc.problems);
      this.rendered.emit(doc);
    } catch (e) {
      if (run !== this.run) return;
      this.document.set(null);
      this.error.set((e as Error).message);
    }
  }

  private async fetchPictures(urls: string[], failed: Map<string, string>): Promise<void> {
    const fetchFn = this.fetchFn() ?? fetch;
    const wanted = urls.filter((u) => !this.pictures.has(u));
    // Beyond the limit a picture counts as failed: it shows as a problem, not as a silent gap.
    for (const url of wanted.slice(MAX_PICTURES)) failed.set(url, '');
    await Promise.all(
      wanted.slice(0, MAX_PICTURES).map(async (url) => {
        try {
          const response = await fetchFn(url, { signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS) });
          if (!response.ok) throw new Error(String(response.status));
          const blob = await response.blob();
          if (blob.size > MAX_PICTURE_BYTES) throw new Error('Too large.');
          this.pictures.set(url, await pictureDataUri(blob, this.dom));
        } catch {
          failed.set(url, '');
        }
      }),
    );
    // Keep the cache to the most recent pictures (a Map keeps insertion order).
    for (const url of this.pictures.keys()) {
      if (this.pictures.size <= MAX_PICTURES * 2) break;
      this.pictures.delete(url);
    }
  }

  /** The current preview as PDF bytes. */
  async toPdf(): Promise<Uint8Array> {
    const doc = this.document();
    if (!doc || !this.fonts) throw new Error('The report is not rendered yet.');
    return renderPdf(doc, this.fonts, { title: this.report().name, date: this.printDate(), lang: this.report().locale || this.config.locale });
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

  /** One page of the current preview as a PNG image, `dpi` dots per inch (default 200). */
  async toPng(pageIndex = this.currentPage() - 1, dpi = 200): Promise<Blob> {
    const page = this.document()?.pages[pageIndex];
    if (!page) throw new Error('The page is not rendered yet.');
    const canvas = await drawPage(page, dpi / 25.4, this.dom);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be made.'))), 'image/png'));
  }

  /** Every page as a PNG (`page-1.png` …) in one ZIP file. */
  async toPngZip(dpi = 200): Promise<Uint8Array> {
    const pages = this.document()?.pages ?? [];
    const files: [string, Uint8Array][] = [];
    for (let i = 0; i < pages.length; i++) files.push([`page-${i + 1}.png`, new Uint8Array(await (await this.toPng(i, dpi)).arrayBuffer())]);
    return storedZip(files);
  }

  /** Every page in black and white dots, `pxPerMm(page)` dots per millimetre. */
  private async bitmaps(pxPerMm: (pageWidth: number) => number): Promise<MonoBitmap[]> {
    const doc = this.document();
    if (!doc) throw new Error('The report is not rendered yet.');
    const out: MonoBitmap[] = [];
    for (const page of doc.pages) {
      const canvas = await drawPage(page, pxPerMm(page.width), this.dom);
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      out.push(toMonoBitmap(pixels, canvas.width, canvas.height));
    }
    return out;
  }

  /** Zebra ZPL for label printers: each page as a label, at the printer's `dpi` (203 or 300). */
  async toZpl(dpi = 203): Promise<string> {
    return zplFromBitmaps(await this.bitmaps(() => dpi / 25.4));
  }

  /** ESC/POS for receipt printers: the page width fills `dots` (384 for 58 mm, 576 for 80 mm rolls). */
  async toEscPos(dots = 576): Promise<Uint8Array> {
    return escPosFromBitmaps(await this.bitmaps((width) => dots / width));
  }

  /** The report's rows as CSV for spreadsheets (`;` and decimal commas in regions that write them). */
  toCsv(): string {
    const { data, sources, params, now } = this.lastInput;
    const locale = this.report().locale || this.config.locale;
    return writeCsv(reportTable(this.report(), { data, sources, params, now: now ?? new Date(), locale }), { locale });
  }

  protected async downloadForPrinter(kind: string): Promise<void> {
    if (kind === 'csv') this.save(new Blob([this.toCsv()], { type: 'text/csv' }), 'csv');
    else if (kind === 'pngzip') this.save(new Blob([await this.toPngZip()], { type: 'application/zip' }), 'zip');
    else if (kind === 'zpl') this.save(new Blob([await this.toZpl()], { type: 'text/plain' }), 'zpl');
    else if (kind === 'escpos58' || kind === 'escpos80') this.save(new Blob([await this.toEscPos(kind === 'escpos58' ? 384 : 576)], { type: 'application/octet-stream' }), 'bin');
  }

  protected async downloadPng(): Promise<void> {
    const page = this.currentPage();
    this.save(await this.toPng(page - 1), this.pageTotal() > 1 ? `p${page}.png` : 'png');
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
