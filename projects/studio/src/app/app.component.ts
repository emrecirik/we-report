import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { csvToObjects, DefinitionVersionError, importReport, layoutReport, LayoutPage, migrateDefinition, ReportDefinition } from 'we-report-core';
import { WE_REPORT_CONFIG, WeReportBackendService, WeReportDesignerComponent, WeReportFontsService, weReportLocaleFor, WeReportPageComponent } from 'we-report-angular';
import { STUDIO_TEXT, StudioLanguage } from './studio-text';
import { decodeShare, encodeShare, hasRemoteSources, MAX_SHARE_URL, SHARE_PREFIX } from './share-link';
import { HistoryEntry, parseHistory, pushHistory } from './history';
import { TEMPLATES } from './templates';

const BACKEND_KEY = 'we-report-studio.backendUrl';
const AUTOSAVE_KEY = 'we-report-studio.autosave';
const LANGUAGE_KEY = 'we-report-studio.language';
const HISTORY_KEY = 'we-report-studio.history';
/** History limits in characters: browsers give a site about 5 MB, and the current design comes first. */
const MAX_ENTRY_CHARS = 500_000;
const MAX_HISTORY_CHARS = 2_000_000;
/** While editing, a snapshot at most this often. */
const SNAPSHOT_MS = 5 * 60_000;

const LANGUAGES: { id: StudioLanguage; name: string }[] = [
  { id: 'tr', name: 'Türkçe' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
];

/** The saved choice, else the browser's language when the studio speaks it, else Turkish. */
function initialLanguage(): StudioLanguage {
  const wanted = [readStorage(LANGUAGE_KEY), ...(navigator.languages ?? [])].map((l) => (l ?? '').slice(0, 2).toLowerCase());
  return wanted.map((l) => LANGUAGES.find((x) => x.id === l)?.id).find(Boolean) ?? 'tr';
}

// Storage can be unavailable (private mode, blocked site data): the studio works without it.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  tryWrite(key, value);
}

function tryWrite(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

@Component({
  selector: 'studio-root',
  standalone: true,
  imports: [WeReportDesignerComponent, WeReportPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly templates = TEMPLATES;
  protected readonly languages = LANGUAGES;
  protected readonly language = signal<StudioLanguage>(initialLanguage());
  protected readonly dark = signal(false);
  protected readonly text = computed(() => STUDIO_TEXT[this.language()]);
  protected readonly locale = computed(() => weReportLocaleFor(this.language()));

  protected readonly templateId = signal(TEMPLATES[0].id);
  protected readonly report = signal<ReportDefinition>(TEMPLATES[0].report());
  protected readonly data = signal<unknown>(TEMPLATES[0].data);

  protected readonly dataDialogOpen = signal(false);
  protected readonly dataDraft = signal('');
  protected readonly message = signal<string | null>(null);
  /** What an imported RDLC/REPX file could not carry over, shown under the message. */
  protected readonly importWarnings = signal<string[]>([]);
  protected readonly galleryOpen = signal(false);
  /** First page of every template, laid out by the real engine, for the gallery. */
  protected readonly thumbnails = signal<Record<string, LayoutPage>>({});
  protected readonly history = signal<HistoryEntry[]>(parseHistory(readStorage(HISTORY_KEY)));
  protected readonly historyOpen = signal(false);
  private lastSnapshot = Date.now();
  /** A shared link is being decoded; autosave waits for it. */
  private readonly opening = signal(false);
  private readonly fonts = inject(WeReportFontsService);
  private readonly config = inject(WE_REPORT_CONFIG);

  constructor() {
    // The backend address the user typed survives reloads; otherwise the deployed demo backend.
    const backend = inject(WeReportBackendService);
    const saved = readStorage(BACKEND_KEY);
    const deployed = document.querySelector<HTMLMetaElement>('meta[name="we-report-backend"]')?.content;
    backend.url.set(saved || deployed || '');
    effect(() => writeStorage(BACKEND_KEY, backend.url()));
    effect(() => {
      writeStorage(LANGUAGE_KEY, this.language());
      document.documentElement.lang = this.language();
    });

    // A shared link wins; else the last design comes back after a reload; a first visit starts at the gallery.
    if (location.hash.startsWith(SHARE_PREFIX)) void this.openShared(location.hash);
    else if (this.restore()) this.message.set(this.text().restored);
    else this.openGallery();
    effect(() => {
      // Not while a shared link is still opening: that would overwrite the last design.
      if (this.opening()) return;
      const t = TEMPLATES.find((x) => x.id === this.templateId());
      // Data that is not the template's own (pasted, shared) is kept too, when it fits in storage.
      const data = this.data() === t?.data ? undefined : this.data();
      const saved = JSON.stringify({ templateId: this.templateId(), report: this.report(), data });
      // The current design comes first: when storage is full, older history makes room for it.
      if (!tryWrite(AUTOSAVE_KEY, saved) && this.history().length) {
        untracked(() => this.writeHistory(this.history().slice(0, Math.floor(this.history().length / 2))));
        tryWrite(AUTOSAVE_KEY, saved);
      }
      if (Date.now() - this.lastSnapshot > SNAPSHOT_MS) untracked(() => this.remember());
    });
  }

  /** Keeps the current design in the history (before it is replaced, and now and then while editing). */
  private remember(): void {
    this.lastSnapshot = Date.now();
    const t = TEMPLATES.find((x) => x.id === this.templateId());
    let entry: HistoryEntry = { time: Date.now(), name: this.report().name, templateId: this.templateId(), report: this.report(), data: this.data() === t?.data ? undefined : this.data() };
    // Large pasted data is not kept in the history (the design is); a huge design is not kept at all.
    if (JSON.stringify(entry).length > MAX_ENTRY_CHARS) entry = { ...entry, data: undefined };
    if (JSON.stringify(entry).length > MAX_ENTRY_CHARS) return;
    this.writeHistory(pushHistory(this.history(), entry));
  }

  /** Stores the history within its share of the storage; the oldest designs make room for the newest. */
  private writeHistory(list: HistoryEntry[]): void {
    while (list.length && (JSON.stringify(list).length > MAX_HISTORY_CHARS || !tryWrite(HISTORY_KEY, JSON.stringify(list)))) list = list.slice(0, -1);
    if (!list.length) {
      try {
        localStorage.removeItem(HISTORY_KEY);
      } catch {
        /* storage unavailable */
      }
    }
    this.history.set(list);
  }

  protected restoreVersion(entry: HistoryEntry): void {
    try {
      const report = migrateDefinition(entry.report);
      this.remember();
      const t = TEMPLATES.find((x) => x.id === entry.templateId);
      this.templateId.set(t?.id ?? 'blank');
      this.report.set(report);
      this.data.set(entry.data ?? t?.data);
      this.message.set(this.text().versionRestored);
    } catch (e) {
      this.message.set(e instanceof DefinitionVersionError ? e.message : this.text().openFailed);
    }
    this.historyOpen.set(false);
  }

  protected historyTime(entry: HistoryEntry): string {
    return new Date(entry.time).toLocaleString(this.language(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  /** A design from a share link: an untrusted report file, so it goes through the same migration as Open. */
  private async openShared(hash: string): Promise<void> {
    this.opening.set(true);
    // The design the user had (autosaved) goes into the history before the link replaces it.
    if (this.restore()) this.remember();
    try {
      const shared = (await decodeShare(hash)) as { report?: unknown; data?: unknown } | null;
      const report = migrateDefinition(shared?.report);
      this.report.set(report);
      this.data.set(shared?.data);
      this.templateId.set('blank');
      this.message.set(hasRemoteSources(report) ? this.text().sharedRemote : this.text().sharedOpened);
    } catch {
      this.message.set(this.text().sharedFailed);
      if (!this.restore()) this.openGallery();
    }
    // Later edits (with the shared data) are autosaved; the link itself leaves the address bar.
    history.replaceState(null, '', location.pathname + location.search);
    this.opening.set(false);
  }

  /** A share link pasted into an open studio tab. */
  @HostListener('window:hashchange')
  protected onHashChange(): void {
    if (location.hash.startsWith(SHARE_PREFIX)) void this.openShared(location.hash);
  }

  /** Puts the design and its data in the address bar (and on the clipboard) as a link. */
  protected async share(): Promise<void> {
    const url = location.origin + location.pathname + location.search + (await encodeShare({ report: this.report(), data: this.data() }));
    if (url.length > MAX_SHARE_URL) {
      this.message.set(this.text().shareTooLarge);
      return;
    }
    try {
      history.replaceState(null, '', url);
      await navigator.clipboard.writeText(url);
      this.message.set(this.text().shareCopied);
    } catch {
      this.message.set(this.text().shareReady);
    }
  }

  private restore(): boolean {
    try {
      const saved = JSON.parse(readStorage(AUTOSAVE_KEY) ?? 'null') as { templateId: string; report: unknown; data?: unknown } | null;
      if (!saved?.report) return false;
      const t = TEMPLATES.find((x) => x.id === saved.templateId);
      this.templateId.set(t?.id ?? 'blank');
      this.report.set(migrateDefinition(saved.report));
      this.data.set(saved.data ?? t?.data);
      return true;
    } catch {
      return false;
    }
  }

  protected openGallery(): void {
    this.galleryOpen.set(true);
    if (Object.keys(this.thumbnails()).length) return;
    this.fonts
      .ready()
      .then((fonts) => {
        const pages: Record<string, LayoutPage> = {};
        for (const t of TEMPLATES) {
          try {
            const doc = layoutReport(t.report(), { fonts, data: t.data, now: new Date(), locale: this.config.locale, currency: this.config.currency });
            if (doc.pages[0]) pages[t.id] = doc.pages[0];
          } catch {
            /* a template that cannot be laid out shows no thumbnail */
          }
        }
        this.thumbnails.set(pages);
      })
      .catch(() => undefined);
  }

  protected chooseTemplate(id: string): void {
    this.useTemplate(id);
    this.galleryOpen.set(false);
    this.message.set(null);
  }

  protected useTemplate(id: string): void {
    const t = TEMPLATES.find((x) => x.id === id)!;
    this.remember();
    this.templateId.set(id);
    const report = t.report();
    // A blank report is named in the language of the page (the designer's default title).
    this.report.set(id === 'blank' ? { ...report, name: this.locale().newReportTitle } : report);
    this.data.set(t.data);
  }

  protected toggleTheme(): void {
    this.dark.update((d) => !d);
    document.documentElement.dataset['theme'] = this.dark() ? 'dark' : 'light';
  }

  protected openDataDialog(): void {
    const d = this.data();
    this.dataDraft.set(d === undefined ? '' : JSON.stringify(d, null, 2));
    this.dataDialogOpen.set(true);
  }

  /** Accepts JSON, or a CSV / Excel paste (tab separated) with a header row. */
  protected applyData(): void {
    const raw = this.dataDraft().trim();
    if (!raw) {
      this.data.set(undefined);
      this.dataDialogOpen.set(false);
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = csvToObjects(raw);
      if (!(data as unknown[]).length) {
        this.message.set(this.text().dataInvalid);
        return;
      }
    }
    this.data.set(data);
    // Pasted rows bind straight to the detail band; an object keeps the template's row path.
    if (Array.isArray(data)) {
      this.report.update((r) => ({ ...r, dataSources: [{ id: 'data', name: 'Data', kind: 'json', data: null }], dataMember: { dataSourceId: 'data' } }));
    }
    this.message.set(null);
    this.dataDialogOpen.set(false);
  }

  /** A data file dragged onto the window becomes the report data (pictures are the designer's). */
  @HostListener('window:dragover', ['$event'])
  protected onWindowDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  }

  @HostListener('window:drop', ['$event'])
  protected async onWindowDrop(e: DragEvent): Promise<void> {
    const file = e.dataTransfer?.files?.[0];
    if (e.defaultPrevented || !file) return;
    e.preventDefault();
    if (/\.(rdlc?|repx|wrpt\.json)$/i.test(file.name)) {
      await this.openFile(file);
    } else if (/\.(json|csv|tsv|txt)$/i.test(file.name) || /json|csv|text/.test(file.type)) {
      this.dataDraft.set(await file.text());
      this.applyData();
    }
  }

  private readonly openInput = viewChild<ElementRef<HTMLInputElement>>('openInput');

  /** Desktop shortcuts: Ctrl+S saves the report file, Ctrl+O opens one; Esc closes the studio's own dialogs. */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && (this.galleryOpen() || this.historyOpen() || this.dataDialogOpen())) {
      this.galleryOpen.set(false);
      this.historyOpen.set(false);
      this.dataDialogOpen.set(false);
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      this.save();
    } else if (key === 'o') {
      e.preventDefault();
      this.openInput()?.nativeElement.click();
    }
  }

  protected async open(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openFile(file);
  }

  private async openFile(file: File): Promise<void> {
    try {
      const { report, warnings } = importReport(await file.text(), file.name);
      this.remember();
      this.templateId.set('blank');
      this.report.set(report);
      this.data.set(undefined);
      this.importWarnings.set(warnings);
      this.message.set(warnings.length ? this.text().importedWith.replace('{0}', file.name) : null);
    } catch (e) {
      this.importWarnings.set([]);
      this.message.set(e instanceof DefinitionVersionError ? e.message : this.text().openFailed);
    }
  }

  protected save(): void {
    const blob = new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.report().name || 'report'}.wrpt.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}
