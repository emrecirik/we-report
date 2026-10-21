import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createBlankReport, WebServiceDataSource } from 'we-report-core';
import { weReportLocaleTr } from '../we-report-locale';
import { DataSourcesDialogComponent } from './data-sources-dialog.component';
import { DesignerState } from './designer-state';

describe('DataSourcesDialogComponent', () => {
  let fixture: ComponentFixture<DataSourcesDialogComponent>;
  let state: DesignerState;
  let dialog: Record<string, (...args: unknown[]) => unknown>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DataSourcesDialogComponent], providers: [DesignerState] });
    state = TestBed.inject(DesignerState);
    state.load(createBlankReport());
    fixture = TestBed.createComponent(DataSourcesDialogComponent);
    fixture.componentRef.setInput('strings', weReportLocaleTr);
    fixture.detectChanges();
    dialog = fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => unknown>;
  });

  it('adds a JSON source that feeds the rows and finds the list inside it', () => {
    dialog['add']('json');
    dialog['setJson']('{ "invoice": { "lines": [ { "a": 1 }, { "a": 2 } ] } }');
    fixture.detectChanges();
    expect(state.report().dataMember).toEqual({ dataSourceId: 'source1', path: 'invoice.lines' });
    expect(el().textContent).toContain('2 satır');
  });

  it('says when the app passes the rows, so the main source is only a fallback', () => {
    dialog['add']('json');
    fixture.detectChanges();
    expect(el().textContent).not.toContain(weReportLocaleTr.hostDataNote);
    fixture.componentRef.setInput('hostData', true);
    fixture.detectChanges();
    expect(el().textContent).toContain(weReportLocaleTr.hostDataNote);
  });

  it('closes on Escape, but not from the JSON text that saves when it is left', () => {
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    dialog['add']('json');
    fixture.detectChanges();
    el().querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(0);
    el().querySelector('.dsd')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('keeps the previous data when pasted JSON is invalid', () => {
    dialog['add']('json');
    dialog['setJson']('[{"a":1}]');
    dialog['setJson']('{ broken');
    fixture.detectChanges();
    expect((state.report().dataSources[0] as { data: unknown }).data).toEqual([{ a: 1 }]);
    expect(el().querySelector('.dsd__error')?.textContent).toContain('geçerli bir JSON değil');
  });

  it('tests a web service with the parameters and saves the response as sample', async () => {
    let calledUrl = '';
    fixture.componentRef.setInput('fetchFn', (async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ items: [{ no: 1 }, { no: 2 }, { no: 3 }] }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    dialog['addParameter']();
    dialog['setParameter'](0, 'name', 'year');
    dialog['setParameter'](0, 'defaultValue', '2026');
    dialog['add']('webService');
    dialog['setWeb']('url', 'https://api.example.com/x?y={{year}}');
    await dialog['test']();
    fixture.detectChanges();
    const source = state.report().dataSources[0] as WebServiceDataSource;
    expect(calledUrl).toBe('https://api.example.com/x?y=2026');
    expect(source.sample).toEqual({ items: [{ no: 1 }, { no: 2 }, { no: 3 }] });
    expect(state.report().dataMember?.path).toBe('items');
    expect(el().querySelector('.dsd__ok')?.textContent).toContain('3 satır');
  });

  it('shows a readable error when the service cannot be reached', async () => {
    fixture.componentRef.setInput('fetchFn', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    dialog['add']('webService');
    dialog['setWeb']('url', 'https://nope.example.com');
    await dialog['test']();
    fixture.detectChanges();
    expect(el().querySelector('.dsd__error')?.textContent).toContain('CORS');
  });

  it('removes a source and moves the rows to the next one', () => {
    dialog['add']('json');
    dialog['add']('csv');
    dialog['select']('source1');
    dialog['remove']();
    expect(state.report().dataSources.map((s) => s.id)).toEqual(['source2']);
    expect(state.report().dataMember?.dataSourceId).toBe('source2');
  });
});
