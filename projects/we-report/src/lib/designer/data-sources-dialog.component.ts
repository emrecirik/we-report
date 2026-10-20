import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  csvToObjects,
  DatabaseDataSource,
  DataSourceDefinition,
  fetchWebService,
  findListPaths,
  inferSchema,
  ParameterType,
  readPath,
  ReportParameter,
  resolveParameters,
  sourceValue,
  toRows,
  WebServiceDataSource,
} from 'we-report-core';
import { WeReportLocale } from '../we-report-locale';
import { WeReportBackendService } from '../we-report-backend.service';
import { DatabaseSourceEditorComponent } from './database-source-editor.component';
import { DesignerState } from './designer-state';

/**
 * Data sources and parameters of the report: paste JSON/CSV, or describe a web service and test it.
 * The test response is saved as the source's sample so fields show up and the design has data.
 */
@Component({
  selector: 'we-report-data-sources-dialog',
  standalone: true,
  imports: [DatabaseSourceEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-sources-dialog.component.html',
  styleUrl: './data-sources-dialog.component.scss',
})
export class DataSourcesDialogComponent {
  readonly strings = input.required<WeReportLocale>();
  readonly fetchFn = input<typeof fetch | undefined>(undefined);
  /** The host app passes the rows (the designer's `data`), so the main source's own data is a fallback. */
  readonly hostData = input(false);
  readonly closed = output<void>();

  protected readonly state = inject(DesignerState);
  private readonly backend = inject(WeReportBackendService);
  protected readonly report = computed(() => this.state.report());
  protected readonly selectedId = signal<string | null>(null);
  protected readonly source = computed(() => {
    const sources = this.report().dataSources;
    return sources.find((s) => s.id === this.selectedId()) ?? sources[0] ?? null;
  });
  protected readonly isMain = computed(() => this.report().dataMember?.dataSourceId === this.source()?.id);
  protected readonly listPaths = computed(() => {
    const s = this.source();
    if (!s) return [];
    try {
      return findListPaths(sourceValue(s));
    } catch {
      return [];
    }
  });
  protected readonly rowCount = computed(() => {
    const s = this.source();
    if (!s) return 0;
    try {
      const value = sourceValue(s);
      const path = this.isMain() ? this.report().dataMember?.path : undefined;
      const rows = path ? path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), value) : value;
      return Array.isArray(rows) ? rows.length : rows ? 1 : 0;
    } catch {
      return 0;
    }
  });

  protected readonly jsonError = signal<string | null>(null);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);
  protected readonly types: ParameterType[] = ['string', 'number', 'date', 'boolean'];

  /** Plain fields of every source, offered as a parameter's list ("source|field"). */
  protected readonly choiceFields = computed(() =>
    this.report().dataSources.flatMap((s) =>
      // The main source lists its rows (`dataMember.path`), as parameterChoices reads them.
      inferSchema(toRows(readPath(sourceValue(s), this.report().dataMember?.dataSourceId === s.id ? this.report().dataMember?.path : undefined)).slice(0, 50))
        .filter((f) => f.type !== 'object' && f.type !== 'array' && f.type !== 'image')
        .map((f) => ({ key: `${s.id}|${f.name}`, label: `${s.name} › ${f.name}` })),
    ),
  );

  protected choicesText(p: ReportParameter): string {
    return p.choices?.values?.join(', ') ?? '';
  }

  protected choicesKey(p: ReportParameter): string {
    return p.choices?.dataSourceId && p.choices.valueField ? `${p.choices.dataSourceId}|${p.choices.valueField}` : '';
  }

  /** A typed list ("A, B, C") or a data field ("source|field"); empty removes the list. */
  protected setChoices(index: number, kind: 'values' | 'field', value: string): void {
    this.state.update((d) => {
      const p = d.parameters?.[index];
      if (!p) return;
      if (kind === 'values') {
        const values = value.split(',').map((v) => v.trim()).filter(Boolean);
        p.choices = values.length ? { values: p.type === 'number' && values.every((v) => !isNaN(Number(v))) ? values.map(Number) : values } : undefined;
      } else {
        const [dataSourceId, valueField] = value.split('|');
        p.choices = dataSourceId && valueField ? { dataSourceId, valueField } : undefined;
      }
      if (!p.choices) delete p.choices;
    }, `param-${index}-choices-${kind}`);
  }

  protected add(kind: DataSourceDefinition['kind']): void {
    const id = this.uniqueSourceId();
    const s = this.strings();
    const source: DataSourceDefinition =
      kind === 'json' ? { id, name: 'JSON', kind, data: [] }
      : kind === 'csv' ? { id, name: 'CSV', kind, text: '' }
      : kind === 'database' ? { id, name: s.database, kind, connectionId: '' }
      : { id, name: s.webService, kind, url: 'https://', method: 'GET', headers: [] };
    this.state.update((d) => {
      d.dataSources.push(source);
      // The first source feeds the detail band; a nicer default than "nothing happens".
      d.dataMember ??= { dataSourceId: id };
    });
    this.selectedId.set(id);
    this.testResult.set(null);
  }

  protected remove(): void {
    const s = this.source();
    if (!s) return;
    this.state.update((d) => {
      d.dataSources = d.dataSources.filter((x) => x.id !== s.id);
      if (d.dataMember?.dataSourceId === s.id) d.dataMember = d.dataSources[0] ? { dataSourceId: d.dataSources[0].id } : undefined;
    });
    this.selectedId.set(null);
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.jsonError.set(null);
    this.testResult.set(null);
  }

  /** Edits the selected source in one undoable, coalesced step. */
  protected edit(mutate: (s: DataSourceDefinition) => void, key: string): void {
    const id = this.source()?.id;
    if (!id) return;
    this.state.update((d) => {
      const i = d.dataSources.findIndex((x) => x.id === id);
      if (i < 0) return;
      const copy = structuredClone(d.dataSources[i]);
      mutate(copy);
      d.dataSources[i] = copy;
    }, `source-${id}-${key}`);
  }

  protected setName(name: string): void {
    this.edit((s) => (s.name = name), 'name');
  }

  protected useForRows(): void {
    const s = this.source();
    if (s) this.state.update((d) => (d.dataMember = { dataSourceId: s.id, path: this.listPaths()[0] || undefined }));
  }

  protected setRowsPath(path: string): void {
    this.state.update((d) => {
      if (d.dataMember) d.dataMember.path = path.trim() || undefined;
    }, 'rows-path');
  }

  protected jsonText(s: DataSourceDefinition): string {
    return s.kind === 'json' ? JSON.stringify(s.data, null, 2) : '';
  }

  protected setJson(text: string): void {
    try {
      const data = text.trim() ? JSON.parse(text) : [];
      this.jsonError.set(null);
      this.edit((s) => {
        if (s.kind === 'json') s.data = data;
      }, 'json');
      this.autoPath(data);
    } catch (e) {
      this.jsonError.set(`${this.strings().invalidJson} (${(e as Error).message})`);
    }
  }

  protected setCsv(text: string): void {
    this.edit((s) => {
      if (s.kind === 'csv') s.text = text;
    }, 'csv');
  }

  protected csvRows(s: DataSourceDefinition): number {
    return s.kind === 'csv' ? csvToObjects(s.text, s.delimiter).length : 0;
  }

  protected web(s: DataSourceDefinition): WebServiceDataSource | null {
    return s.kind === 'webService' ? s : null;
  }

  protected setWeb(key: 'url' | 'method' | 'body' | 'via', value: string): void {
    this.edit((s) => {
      if (s.kind !== 'webService') return;
      if (key === 'method') s.method = value as 'GET' | 'POST';
      else if (key === 'via') s.via = value === 'backend' ? 'backend' : undefined;
      else s[key] = value;
    }, key);
  }

  /** Page size of a paged web service; empty turns paging off. */
  protected setPaging(size: string): void {
    this.edit((s) => {
      if (s.kind !== 'webService') return;
      const n = Math.floor(Number(size));
      if (size === '' || !(n > 0)) delete s.paging;
      else s.paging = { ...s.paging, size: n };
    }, 'paging');
  }

  protected db(s: DataSourceDefinition): DatabaseDataSource | null {
    return s.kind === 'database' ? s : null;
  }

  protected applyDbEdit(e: { mutate: (s: DatabaseDataSource) => void; key: string }): void {
    this.edit((s) => {
      if (s.kind === 'database') e.mutate(s);
    }, e.key);
    if (e.key === 'sample') this.autoPath(this.source()?.kind === 'database' ? (this.source() as DatabaseDataSource).sample : undefined);
  }

  protected addHeader(): void {
    this.edit((s) => {
      if (s.kind === 'webService') s.headers = [...(s.headers ?? []), { name: '', value: '' }];
    }, 'header-add');
  }

  protected setHeader(index: number, key: 'name' | 'value', value: string): void {
    this.edit((s) => {
      if (s.kind === 'webService' && s.headers?.[index]) s.headers[index][key] = value;
    }, `header-${index}-${key}`);
  }

  protected removeHeader(index: number): void {
    this.edit((s) => {
      if (s.kind === 'webService') s.headers = (s.headers ?? []).filter((_, i) => i !== index);
    }, 'header-remove');
  }

  protected async test(): Promise<void> {
    const s = this.source();
    if (!s || s.kind !== 'webService') return;
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const params = resolveParameters(this.report().parameters);
      const data = await fetchWebService(s, params, { fetch: this.fetchFn(), backendUrl: this.backend.url() || undefined });
      this.edit((x) => {
        if (x.kind === 'webService') x.sample = data;
      }, 'sample');
      this.autoPath(data);
      this.testResult.set({ ok: true, message: this.strings().testOk.replace('{0}', String(this.rowCount())) });
    } catch (e) {
      this.testResult.set({ ok: false, message: (e as Error).message });
    } finally {
      this.testing.set(false);
    }
  }

  /** When the main source is an object with exactly one list in it, rows come from that list. */
  private autoPath(data: unknown): void {
    if (!this.isMain() || this.report().dataMember?.path || Array.isArray(data)) return;
    const paths = findListPaths(data);
    if (paths.length === 1) this.setRowsPath(paths[0]);
  }

  // ── Parameters ──────────────────────────────────────────────────────────────

  protected addParameter(): void {
    this.state.update((d) => {
      const names = new Set((d.parameters ?? []).map((p) => p.name));
      let n = 1;
      while (names.has(`param${n}`)) n++;
      d.parameters = [...(d.parameters ?? []), { name: `param${n}`, type: 'string' }];
    });
  }

  protected setParameter(index: number, key: keyof ReportParameter, value: string): void {
    this.state.update((d) => {
      const p = d.parameters?.[index];
      if (!p) return;
      if (key === 'name') p.name = value.replace(/[^\p{L}\p{N}_]/gu, '');
      else if (key === 'type') p.type = value as ParameterType;
      else if (key === 'label') p.label = value || undefined;
      else p.defaultValue = value === '' ? undefined : value;
    }, `param-${index}-${key}`);
  }

  protected addCalculated(): void {
    this.state.update((d) => {
      const names = new Set((d.calculatedFields ?? []).map((f) => f.name));
      let n = 1;
      while (names.has(`field${n}`)) n++;
      d.calculatedFields = [...(d.calculatedFields ?? []), { name: `field${n}`, expression: '' }];
    });
  }

  /** Names are used as [name]: the box shows the cleaned name right away. */
  protected setCalculatedName(index: number, input: HTMLInputElement): void {
    this.setCalculated(index, 'name', input.value);
    input.value = this.report().calculatedFields?.[index]?.name ?? '';
  }

  protected setParameterName(index: number, input: HTMLInputElement): void {
    this.setParameter(index, 'name', input.value);
    input.value = this.report().parameters?.[index]?.name ?? '';
  }

  protected setCalculated(index: number, key: 'name' | 'expression', value: string): void {
    this.state.update((d) => {
      const f = d.calculatedFields?.[index];
      if (!f) return;
      // A name is used as [name] in formulas: letters, digits and underscores only.
      if (key === 'name') f.name = value.replace(/[^\p{L}\p{N}_]/gu, '');
      else f.expression = value;
    }, `calc-${index}-${key}`);
  }

  protected removeCalculated(index: number): void {
    this.state.update((d) => {
      d.calculatedFields = (d.calculatedFields ?? []).filter((_, i) => i !== index);
      if (!d.calculatedFields.length) delete d.calculatedFields;
    });
  }

  protected removeParameter(index: number): void {
    this.state.update((d) => {
      d.parameters = (d.parameters ?? []).filter((_, i) => i !== index);
      if (!d.parameters.length) delete d.parameters;
    });
  }

  protected typeLabel(t: ParameterType): string {
    const s = this.strings();
    return { string: s.typeText, number: s.typeNumber, date: s.typeDate, boolean: s.typeYesNo }[t];
  }

  protected kindLabel(s: DataSourceDefinition): string {
    return s.kind === 'webService' ? this.strings().webService : s.kind === 'database' ? this.strings().database : s.kind.toUpperCase();
  }

  private uniqueSourceId(): string {
    const used = new Set(this.report().dataSources.map((s) => s.id));
    let n = 1;
    while (used.has(`source${n}`)) n++;
    return `source${n}`;
  }
}
