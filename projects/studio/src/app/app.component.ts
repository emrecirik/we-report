import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { csvToObjects, DefinitionVersionError, migrateDefinition, ReportDefinition } from 'we-report-core';
import { WeReportBackendService, WeReportDesignerComponent, weReportLocaleEn, weReportLocaleTr } from 'we-report-angular';
import { STUDIO_TEXT } from './studio-text';
import { TEMPLATES } from './templates';

const BACKEND_KEY = 'we-report-studio.backendUrl';

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
  imports: [WeReportDesignerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly templates = TEMPLATES;
  protected readonly language = signal<'tr' | 'en'>('tr');
  protected readonly dark = signal(false);
  protected readonly text = computed(() => STUDIO_TEXT[this.language()]);
  protected readonly locale = computed(() => (this.language() === 'tr' ? weReportLocaleTr : weReportLocaleEn));

  protected readonly templateId = signal(TEMPLATES[0].id);
  protected readonly report = signal<ReportDefinition>(TEMPLATES[0].report());
  protected readonly data = signal<unknown>(TEMPLATES[0].data);

  protected readonly dataDialogOpen = signal(false);
  protected readonly dataDraft = signal('');
  protected readonly message = signal<string | null>(null);

  constructor() {
    // The backend address the user typed survives reloads; otherwise the deployed demo backend.
    const backend = inject(WeReportBackendService);
    const saved = readStorage(BACKEND_KEY);
    const deployed = document.querySelector<HTMLMetaElement>('meta[name="we-report-backend"]')?.content;
    backend.url.set(saved || deployed || '');
    effect(() => writeStorage(BACKEND_KEY, backend.url()));
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
      this.report.set(migrateDefinition(JSON.parse(await file.text())));
      this.message.set(null);
    } catch (e) {
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
