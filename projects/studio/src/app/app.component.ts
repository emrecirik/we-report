import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { csvToObjects, DefinitionVersionError, importReport, layoutReport, LayoutPage, migrateDefinition, ReportDefinition } from 'we-report-core';
import { WE_REPORT_CONFIG, WeReportBackendService, WeReportDesignerComponent, WeReportFontsService, weReportLocaleFor, WeReportPageComponent } from 'we-report-angular';
import { STUDIO_TEXT, StudioLanguage } from './studio-text';
import { TEMPLATES } from './templates';

const BACKEND_KEY = 'we-report-studio.backendUrl';
const AUTOSAVE_KEY = 'we-report-studio.autosave';
const LANGUAGE_KEY = 'we-report-studio.language';

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
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted */
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

    // The last design comes back after a reload; a first visit starts at the gallery.
    const restored = this.restore();
    if (restored) this.message.set(this.text().restored);
    else this.openGallery();
    effect(() => writeStorage(AUTOSAVE_KEY, JSON.stringify({ templateId: this.templateId(), report: this.report() })));
  }

  private restore(): boolean {
    try {
      const saved = JSON.parse(readStorage(AUTOSAVE_KEY) ?? 'null') as { templateId: string; report: unknown } | null;
      if (!saved?.report) return false;
      const t = TEMPLATES.find((x) => x.id === saved.templateId);
      this.templateId.set(t?.id ?? 'blank');
      this.report.set(migrateDefinition(saved.report));
      this.data.set(t?.data);
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
    this.templateId.set(id);
    this.report.set(t.report());
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

  protected async open(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { report, warnings } = importReport(await file.text(), file.name);
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
