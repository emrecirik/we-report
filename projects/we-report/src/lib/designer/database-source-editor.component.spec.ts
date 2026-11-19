import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DatabaseDataSource } from 'we-report-core';
import { weReportLocaleEn } from '../we-report-locale';
import { WeReportBackendService } from '../we-report-backend.service';
import { DatabaseSourceEditorComponent } from './database-source-editor.component';

const SCHEMA = { tables: [{ name: 'sales', columns: [{ name: 'city', type: 'string' }, { name: 'category', type: 'string' }, { name: 'total', type: 'number' }] }] };

function fakeBackend(capabilities: Record<string, boolean>): typeof fetch {
  return (async (url: string) => {
    const body = url.endsWith('/v1/info')
      ? { protocol: 1, server: 'test', capabilities }
      : url.endsWith('/v1/connections')
        ? [{ id: 'big', name: 'Big', dialect: 'duckdb', freeSql: false }]
        : SCHEMA;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('DatabaseSourceEditorComponent', () => {
  let fixture: ComponentFixture<DatabaseSourceEditorComponent>;
  let source: DatabaseDataSource;
  const el = () => fixture.nativeElement as HTMLElement;
  const editor = () => fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown>;

  async function open(capabilities: Record<string, boolean>, query: DatabaseDataSource['query']): Promise<void> {
    source = { id: 's', name: 'Sales', kind: 'database', connectionId: 'big', query };
    TestBed.configureTestingModule({ imports: [DatabaseSourceEditorComponent] });
    TestBed.inject(WeReportBackendService).url.set('http://backend');
    fixture = TestBed.createComponent(DatabaseSourceEditorComponent);
    fixture.componentRef.setInput('source', source);
    fixture.componentRef.setInput('strings', weReportLocaleEn);
    fixture.componentRef.setInput('fetchFn', fakeBackend(capabilities));
    // Applies every edit to the source, as the dialog does
    fixture.componentInstance.edit.subscribe(({ mutate }) => {
      source = structuredClone(source);
      mutate(source);
      fixture.componentRef.setInput('source', source);
    });
    fixture.detectChanges();
    await editor()['connect']();
    fixture.detectChanges();
  }

  it('summarizes in the database: group columns, totals with field names, no column list', async () => {
    await open({ groups: true }, { table: 'sales', columns: ['city', 'total'], orderBy: [{ column: 'total', dir: 'desc' }] });
    expect(el().textContent).toContain(weReportLocaleEn.summarize);
    editor()['toggleGroup']('city', true);
    editor()['addAggregate']();
    editor()['addAggregate']();
    editor()['setAggregate'](1, 'avg', 'total');
    editor()['addAggregate']();
    fixture.detectChanges();
    // Grouped, the column list and an order by a column that isn't grouped no longer apply
    expect(source.query).toEqual({
      table: 'sales',
      groupBy: ['city'],
      aggregates: [
        { column: 'total', fn: 'sum', as: 'sum_total' },
        { column: 'total', fn: 'avg', as: 'avg_total' },
        { column: 'total', fn: 'sum', as: 'sum_total_2' },
      ],
    });
    expect(el().textContent).toContain('avg_total');
    editor()['removeAggregate'](0);
    expect(source.query!.aggregates!.map((a) => a.as)).toEqual(['avg_total', 'sum_total']);
    editor()['toggleGroup']('city', false);
    expect(source.query).toEqual({ table: 'sales' });
  });

  it('offers no summary on a backend older than protocol 1.2', async () => {
    await open({ grid: true }, { table: 'sales' });
    expect(el().textContent).toContain(weReportLocaleEn.columns);
    expect(el().textContent).not.toContain(weReportLocaleEn.summarize);
  });
});
