import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import {
  BackendConnection,
  backendClient,
  BackendSchema,
  DatabaseDataSource,
  fetchDatabase,
  QueryCondition,
  ReportParameter,
  resolveParameters,
  StructuredQuery,
} from 'we-report-core';
import { WeReportBackendService } from '../we-report-backend.service';
import { WeReportLocale } from '../we-report-locale';

const OPERATORS: QueryCondition['op'][] = ['=', '!=', '<', '<=', '>', '>=', 'like', 'isNull', 'notNull'];

/**
 * Visual query builder for a database source: backend → connection → table → columns → filters
 * → order → limit, or free SQL where the connection allows it. Produces protocol/schemas/query.json.
 */
@Component({
  selector: 'we-report-database-source-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = strings();
    @let src = source();
    <div class="dbe__row">
      <label class="dbe__grow">
        <span>{{ s.backendAddress }}</span>
        <input [value]="backend.url()" (change)="backend.url.set($any($event.target).value.trim())" placeholder="http://127.0.0.1:5480" spellcheck="false" />
      </label>
      <button type="button" (click)="connect()">{{ s.connect }}</button>
    </div>
    @if (status(); as st) {
      <p [class.dbe__error]="!st.ok" [class.dbe__ok]="st.ok">{{ st.message }}</p>
    }

    @if (connections().length) {
      <label>
        <span>{{ s.connection }}</span>
        <select (change)="setConnection($any($event.target).value)">
          <option value="" [selected]="!src.connectionId">—</option>
          @for (c of connections(); track c.id) {
            <option [value]="c.id" [selected]="c.id === src.connectionId">{{ c.name }} ({{ c.dialect }})</option>
          }
        </select>
      </label>
    }

    @if (connection()?.freeSql) {
      <label class="dbe__check">
        <input type="checkbox" [checked]="src.sql !== undefined" (change)="toggleSql($any($event.target).checked)" />
        {{ s.writeSql }}
      </label>
    }

    @if (src.sql !== undefined) {
      <label>
        <span>SQL</span>
        <textarea rows="6" spellcheck="false" [value]="src.sql" (input)="setSql($any($event.target).value)" placeholder="SELECT * FROM orders WHERE order_date >= :from"></textarea>
        <small class="dbe__hint">{{ s.sqlHint }}</small>
      </label>
    } @else if (schema()) {
      @let sc = schema()!;
      <label>
        <span>{{ s.table }}</span>
        <select (change)="setTable($any($event.target).value)">
          <option value="" [selected]="!query().table">—</option>
          @for (t of sc.tables; track t.name) {
            <option [value]="t.name" [selected]="t.name === query().table">{{ t.name }}</option>
          }
        </select>
      </label>
      @if (tableColumns().length) {
        <div>
          <span class="dbe__label">{{ s.columns }}</span>
          <div class="dbe__columns">
            @for (col of tableColumns(); track col.name) {
              <label class="dbe__check">
                <input type="checkbox" [checked]="isColumnOn(col.name)" (change)="toggleColumn(col.name, $any($event.target).checked)" />
                {{ col.name }}
              </label>
            }
          </div>
        </div>
        <div>
          <span class="dbe__label">{{ s.filters }}</span>
          @for (w of query().where ?? []; track $index; let i = $index) {
            <div class="dbe__row">
              <select (change)="setWhere(i, 'column', $any($event.target).value)" [attr.aria-label]="s.columns">
                @for (col of tableColumns(); track col.name) {
                  <option [value]="col.name" [selected]="col.name === w.column">{{ col.name }}</option>
                }
              </select>
              <select (change)="setWhere(i, 'op', $any($event.target).value)" class="dbe__op">
                @for (op of operators; track op) {
                  <option [value]="op" [selected]="op === w.op">{{ opLabel(op) }}</option>
                }
              </select>
              @if (w.op !== 'isNull' && w.op !== 'notNull') {
                <select (change)="setWhere(i, 'param', $any($event.target).value)" class="dbe__source">
                  <option value="" [selected]="!w.param">{{ s.fixedValue }}</option>
                  @for (p of parameters(); track p.name) {
                    <option [value]="p.name" [selected]="p.name === w.param">[?{{ p.name }}]</option>
                  }
                </select>
                @if (!w.param) {
                  <input class="dbe__grow" [value]="w.value ?? ''" (input)="setWhere(i, 'value', $any($event.target).value)" />
                }
              }
              <button type="button" (click)="removeWhere(i)" [attr.aria-label]="s.delete">×</button>
            </div>
          }
          <button type="button" class="dbe__link" (click)="addWhere()">+ {{ s.addFilter }}</button>
        </div>
        <div class="dbe__row">
          <label class="dbe__grow">
            <span>{{ s.sortBy }}</span>
            <select (change)="setOrder($any($event.target).value, query().orderBy?.[0]?.dir ?? 'asc')">
              <option value="" [selected]="!query().orderBy?.length">—</option>
              @for (col of tableColumns(); track col.name) {
                <option [value]="col.name" [selected]="col.name === query().orderBy?.[0]?.column">{{ col.name }}</option>
              }
            </select>
          </label>
          <label>
            <span>&nbsp;</span>
            <select (change)="setOrder(query().orderBy?.[0]?.column ?? '', $any($event.target).value)">
              <option value="asc" [selected]="query().orderBy?.[0]?.dir !== 'desc'">{{ s.sortAsc }}</option>
              <option value="desc" [selected]="query().orderBy?.[0]?.dir === 'desc'">{{ s.sortDesc }}</option>
            </select>
          </label>
          <label>
            <span>{{ s.maxRows }}</span>
            <input type="number" min="1" [value]="query().limit ?? ''" (input)="setLimit($any($event.target).value)" />
          </label>
        </div>
      }
    }

    @if (src.connectionId && (src.sql !== undefined || query().table)) {
      <div class="dbe__row">
        <button type="button" class="dbe__primary" (click)="test()" [disabled]="testing()">{{ testing() ? s.testing : s.test }}</button>
      </div>
      @if (testResult(); as r) {
        <p [class.dbe__ok]="r.ok" [class.dbe__error]="!r.ok">{{ r.message }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    label > span,
    .dbe__label {
      font-weight: 500;
    }
    .dbe__row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
      margin-bottom: 4px;
    }
    .dbe__grow {
      flex: 1;
    }
    .dbe__op {
      width: 110px;
    }
    .dbe__source {
      width: 140px;
    }
    .dbe__columns {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin-top: 4px;
    }
    .dbe__check {
      flex-direction: row;
      align-items: center;
      gap: 6px;
      font-weight: 400;
    }
    input:not([type='checkbox']),
    select,
    textarea,
    button {
      box-sizing: border-box;
      font: inherit;
      padding: 5px 8px;
      border: 1px solid var(--we-report-band-border, #d5dae1);
      border-radius: 6px;
      background: var(--we-report-input-bg, #fff);
      color: inherit;
      min-width: 0;
    }
    textarea {
      font-family: ui-monospace, Consolas, monospace;
    }
    button {
      cursor: pointer;
    }
    .dbe__primary {
      border: 0;
      background: var(--we-report-accent, #2563eb);
      color: var(--we-report-page-bg, #fff);
    }
    .dbe__link {
      border: 0;
      padding: 0;
      background: none;
      color: var(--we-report-accent, #2563eb);
    }
    .dbe__hint {
      font-size: 11px;
      color: var(--we-report-muted-fg, #57606a);
    }
    .dbe__ok,
    .dbe__error {
      margin: 0;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
    .dbe__ok {
      background: var(--we-report-selection-fill, rgba(37, 99, 235, 0.08));
      color: var(--we-report-accent, #2563eb);
    }
    .dbe__error {
      background: var(--we-report-warning-bg, #fff8e6);
      color: var(--we-report-warning-fg, #7a4b00);
    }
  `,
})
export class DatabaseSourceEditorComponent {
  readonly source = input.required<DatabaseDataSource>();
  readonly parameters = input<ReportParameter[]>([]);
  readonly strings = input.required<WeReportLocale>();
  readonly fetchFn = input<typeof fetch | undefined>(undefined);
  /** Emits a mutation of the source; the dialog applies it as one undoable step. */
  readonly edit = output<{ mutate: (s: DatabaseDataSource) => void; key: string }>();

  protected readonly backend = inject(WeReportBackendService);
  protected readonly operators = OPERATORS;
  protected readonly connections = signal<BackendConnection[]>([]);
  protected readonly schema = signal<BackendSchema | null>(null);
  protected readonly status = signal<{ ok: boolean; message: string } | null>(null);
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; message: string } | null>(null);

  protected readonly query = computed<StructuredQuery>(() => this.source().query ?? { table: '' });
  protected readonly connection = computed(() => this.connections().find((c) => c.id === this.source().connectionId) ?? null);
  protected readonly tableColumns = computed(() => this.schema()?.tables.find((t) => t.name === this.query().table)?.columns ?? []);

  constructor() {
    // Reconnect automatically when the dialog opens on an existing source with a known backend.
    effect(() => {
      const id = this.source().connectionId;
      untracked(() => {
        if (this.backend.url() && !this.connections().length) void this.connect(id);
      });
    }, { allowSignalWrites: true });
  }

  private get options() {
    return { url: this.backend.url(), fetch: this.fetchFn() };
  }

  async connect(connectionId = this.source().connectionId): Promise<void> {
    if (!this.backend.url()) return;
    try {
      const list = await backendClient.connections(this.options);
      this.connections.set(list);
      this.status.set({ ok: true, message: this.strings().connected.replace('{0}', String(list.length)) });
      if (connectionId && list.some((c) => c.id === connectionId)) await this.loadSchema(connectionId);
    } catch (e) {
      this.connections.set([]);
      this.status.set({ ok: false, message: (e as Error).message });
    }
  }

  private async loadSchema(connectionId: string): Promise<void> {
    try {
      this.schema.set(await backendClient.schema(this.options, connectionId));
    } catch (e) {
      this.schema.set(null);
      this.status.set({ ok: false, message: (e as Error).message });
    }
  }

  protected async setConnection(id: string): Promise<void> {
    this.edit.emit({ mutate: (s) => ((s.connectionId = id), (s.query = undefined)), key: 'connection' });
    this.schema.set(null);
    if (id) await this.loadSchema(id);
  }

  private setQuery(mutate: (q: StructuredQuery) => void, key: string): void {
    this.edit.emit({
      mutate: (s) => {
        const q: StructuredQuery = structuredClone(s.query ?? { table: '' });
        mutate(q);
        s.query = q;
      },
      key,
    });
  }

  protected setTable(table: string): void {
    this.edit.emit({ mutate: (s) => (s.query = table ? { table } : undefined), key: 'table' });
  }

  protected isColumnOn(name: string): boolean {
    const cols = this.query().columns;
    return !cols?.length || cols.includes(name);
  }

  protected toggleColumn(name: string, on: boolean): void {
    const all = this.tableColumns().map((c) => c.name);
    this.setQuery((q) => {
      const current = q.columns?.length ? q.columns : all;
      const next = on ? all.filter((c) => c === name || current.includes(c)) : current.filter((c) => c !== name);
      // Every column ticked is stored as "all", so new columns in the table appear automatically.
      q.columns = next.length === all.length ? undefined : next;
    }, 'columns');
  }

  protected addWhere(): void {
    const first = this.tableColumns()[0]?.name ?? '';
    this.setQuery((q) => (q.where = [...(q.where ?? []), { column: first, op: '=', value: '' }]), 'where-add');
  }

  protected setWhere(i: number, key: 'column' | 'op' | 'value' | 'param', value: string): void {
    this.setQuery((q) => {
      const w = q.where?.[i];
      if (!w) return;
      if (key === 'column') w.column = value;
      else if (key === 'op') w.op = value as QueryCondition['op'];
      else if (key === 'param') {
        w.param = value || undefined;
        if (value) delete w.value;
      } else w.value = value;
    }, `where-${i}-${key}`);
  }

  protected removeWhere(i: number): void {
    this.setQuery((q) => (q.where = (q.where ?? []).filter((_, j) => j !== i)), 'where-remove');
  }

  protected setOrder(column: string, dir: string): void {
    this.setQuery((q) => (q.orderBy = column ? [{ column, dir: dir === 'desc' ? 'desc' : 'asc' }] : undefined), 'order');
  }

  protected setLimit(value: string): void {
    const n = Number(value);
    this.setQuery((q) => (q.limit = Number.isInteger(n) && n > 0 ? n : undefined), 'limit');
  }

  protected toggleSql(on: boolean): void {
    this.edit.emit({ mutate: (s) => (s.sql = on ? (s.sql ?? (s.query?.table ? `SELECT * FROM ${s.query.table}` : 'SELECT ')) : undefined), key: 'sql-toggle' });
  }

  protected setSql(sql: string): void {
    this.edit.emit({ mutate: (s) => (s.sql = sql), key: 'sql' });
  }

  protected opLabel(op: QueryCondition['op']): string {
    const s = this.strings();
    return op === 'like' ? s.opLike : op === 'isNull' ? s.opIsEmpty : op === 'notNull' ? s.opIsNotEmpty : op === '!=' ? '≠' : op;
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const params = resolveParameters(this.parameters());
      const { rows, truncated } = await fetchDatabase(this.source(), params, { backendUrl: this.backend.url(), fetch: this.fetchFn() });
      this.edit.emit({ mutate: (s) => (s.sample = rows), key: 'sample' });
      const message = this.strings().testOk.replace('{0}', String(rows.length)) + (truncated ? ` ${this.strings().rowLimitReached}` : '');
      this.testResult.set({ ok: true, message });
    } catch (e) {
      this.testResult.set({ ok: false, message: (e as Error).message });
    } finally {
      this.testing.set(false);
    }
  }
}
