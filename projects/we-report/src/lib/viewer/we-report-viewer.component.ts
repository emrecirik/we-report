import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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
      <button type="button" class="we-report-viewer__btn" (click)="setZoom(zoomLevel() - 0.1)" [attr.aria-label]="strings().zoomOut" [title]="strings().zoomOut" [innerHTML]="'zoomOut' | weReportIcon"></button>
      <span class="we-report-viewer__zoom">{{ (zoomLevel() * 100).toFixed(0) }}%</span>
      <button type="button" class="we-report-viewer__btn" (click)="setZoom(zoomLevel() + 0.1)" [attr.aria-label]="strings().zoomIn" [title]="strings().zoomIn" [innerHTML]="'zoomIn' | weReportIcon"></button>
      <span class="we-report-viewer__pages">{{ pageLabel() }}</span>
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
    <div class="we-report-viewer__scroll">
      @if (document(); as doc) {
        @for (page of doc.pages; track $index) {
          <we-report-page class="we-report-viewer__page" [page]="page" [zoom]="zoomLevel()" />
        }
      } @else if (!error()) {
        <div class="we-report-viewer__loading">{{ strings().loading }}</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      font-family: var(--we-report-font-family, system-ui, sans-serif);
      color: var(--we-report-fg, #1f2328);
      background: var(--we-report-workspace-bg, #eef0f3);
    }
    .we-report-viewer__toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--we-report-toolbar-bg, #fff);
      border-bottom: 1px solid var(--we-report-band-border, #d5dae1);
      font-size: 13px;
    }
    .we-report-viewer__btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 30px;
      height: 30px;
      justify-content: center;
      border: 1px solid var(--we-report-band-border, #d5dae1);
      border-radius: 6px;
      background: var(--we-report-toolbar-bg, #fff);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .we-report-viewer__btn--text {
      padding: 0 10px;
    }
    .we-report-viewer__btn:hover:not(:disabled) {
      border-color: var(--we-report-accent, #2563eb);
    }
    .we-report-viewer__btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .we-report-viewer__btn :is(svg) {
      width: 16px;
      height: 16px;
    }
    .we-report-viewer__zoom {
      min-width: 44px;
      text-align: center;
    }
    .we-report-viewer__pages {
      margin-left: 8px;
      color: var(--we-report-muted-fg, #57606a);
    }
    .we-report-viewer__spacer {
      flex: 1;
    }
    .we-report-viewer__scroll {
      flex: 1;
      overflow: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
    .we-report-viewer__params {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 10px;
      padding: 8px 10px;
      background: var(--we-report-toolbar-bg, #fff);
      border-bottom: 1px solid var(--we-report-band-border, #d5dae1);
      font-size: 12px;
    }
    .we-report-viewer__params label {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .we-report-viewer__params input:not([type='checkbox']) {
      font: inherit;
      padding: 5px 8px;
      border: 1px solid var(--we-report-band-border, #d5dae1);
      border-radius: 6px;
      background: var(--we-report-input-bg, #fff);
      color: inherit;
    }
    .we-report-viewer__error,
    .we-report-viewer__problems {
      margin: 8px 10px 0;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      background: var(--we-report-warning-bg, #fff8e6);
      color: var(--we-report-warning-fg, #7a4b00);
    }
    .we-report-viewer__problems ul {
      margin: 6px 0 0;
      padding-left: 18px;
    }
    .we-report-viewer__loading {
      color: var(--we-report-muted-fg, #57606a);
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

  private readonly config = inject(WE_REPORT_CONFIG);
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
