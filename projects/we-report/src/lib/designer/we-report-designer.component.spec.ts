import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createBlankReport, ReportDefinition } from 'we-report-core';
import { WE_REPORT_LOCALE, weReportLocaleTr } from '../we-report-locale';
import { DesignSurfaceComponent } from './design-surface.component';
import { DesignerState } from './designer-state';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WeReportDesignerComponent } from './we-report-designer.component';

describe('WeReportDesignerComponent', () => {
  let fixture: ComponentFixture<WeReportDesignerComponent>;
  let state: DesignerState;
  const el = () => fixture.nativeElement as HTMLElement;

  function create(report: ReportDefinition, data?: unknown): void {
    fixture = TestBed.createComponent(WeReportDesignerComponent);
    fixture.componentRef.setInput('report', report);
    if (data !== undefined) fixture.componentRef.setInput('data', data);
    fixture.detectChanges();
    // The report is loaded into the designer state by an effect; render again to show it.
    fixture.detectChanges();
    state = fixture.debugElement.injector.get(DesignerState);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WeReportDesignerComponent],
      providers: [{ provide: WE_REPORT_LOCALE, useValue: weReportLocaleTr }],
    });
  });

  it('opens a sub-report in its own designer, with sample rows, and keeps its edits as one undo step', () => {
    const inner = createBlankReport('Siparişler');
    inner.bands = [{ id: 'd', kind: 'detail', height: 6, controls: [{ id: 'no', type: 'text', x: 0, y: 0, width: 30, height: 6, text: { expression: '[No]' } }] }];
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 'sub', type: 'subreport', x: 0, y: 0, width: 100, height: 10, report: inner, rows: { expression: '[orders]' } });
    create(report, [{ name: 'a', orders: [{ No: 'S-1' }, { No: 'S-2' }] }]);
    expect(el().querySelector('.wd__subreport')).toBeNull();
    el().querySelector<HTMLElement>('[data-control-id="sub"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    fixture.detectChanges();
    const dialog = el().querySelector('.wd__subreport')!;
    expect(dialog.querySelector('h2')?.textContent).toContain('Siparişler');
    // The inner designer shows the first order where the formula is.
    expect(dialog.querySelector('[data-control-id="no"]')?.textContent).toContain('S-1');
    // ...and knows the row around the sub-report: [^.name] is no unknown field.
    const innerDesigner = fixture.debugElement.queryAll((d) => d.name === 'we-report-designer')[0].componentInstance as { fields(): { parent: { path: string }[] } };
    expect(innerDesigner.fields().parent.map((f) => f.path)).toContain('name');

    // Keys that reach the outer designer while the window is open do not touch the outer page.
    state.selection.set({ kind: 'controls', ids: ['sub'] });
    el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(state.report().bands[1].controls.length).toBe(1);

    const innerState = fixture.debugElement.queryAll((d) => d.name === 'we-report-designer')[0].injector.get(DesignerState);
    innerState.updateControls(['no'], (c) => (c.x = 12));
    innerState.updateControls(['no'], (c) => (c.width = 40));
    fixture.detectChanges();
    const sub = () => state.report().bands[1].controls[0] as { report: ReportDefinition };
    expect(sub().report.bands[0].controls[0]).toEqual(jasmine.objectContaining({ x: 12, width: 40 }));
    expect(innerState.canUndo()).toBeTrue(); // the inner designer was not reloaded
    state.undo();
    expect(sub().report.bands[0].controls[0]).toEqual(jasmine.objectContaining({ x: 0, width: 30 }));

    // The window closes when its sub-report is gone.
    state.subreportOpen.set(null);
    state.selection.set({ kind: 'controls', ids: ['sub'] });
    state.deleteSelection();
    state.subreportOpen.set('sub');
    fixture.detectChanges();
    expect(state.subreportOpen()).toBeNull();
  });

  it('shows the rows of the sample row in the sub-report window, as the filter matches them', () => {
    const inner = createBlankReport('Hareketler');
    inner.bands = [{ id: 'd', kind: 'detail', height: 6, controls: [{ id: 'no', type: 'text', x: 0, y: 0, width: 30, height: 6, text: { expression: '[No]' } }] }];
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 'sub', type: 'subreport', x: 0, y: 0, width: 100, height: 10, report: inner, rows: { expression: '[all]' }, filter: { expression: '[owner] = [^.name]' } });
    const all = [{ No: 'X-1', owner: 'b' }, { No: 'A-1', owner: 'a' }];
    create(report, [{ name: 'a', all }]);
    state.subreportOpen.set('sub');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el().querySelector('.wd__subreport [data-control-id="no"]')?.textContent).toContain('A-1');
  });

  it('warns about a text the print would cut off and fixes it by letting it grow', async () => {
    const report = createBlankReport();
    report.bands[1].controls.push(
      { id: 'cut', type: 'text', x: 0, y: 0, width: 20, height: 5, text: 'one two three four five six seven eight' },
      { id: 'fits', type: 'text', x: 30, y: 0, width: 60, height: 5, text: 'short' },
    );
    create(report);
    await TestBed.inject(WeReportFontsService).ready();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const designer = fixture.componentInstance as unknown as { issues(): { code: string; controlId: string }[]; fixIssue(i: unknown): void };
    const cut = designer.issues().filter((i) => i.code === 'textCut');
    expect(cut.map((i) => i.controlId)).toEqual(['cut']);
    expect(el().querySelector('[data-control-id="cut"]')?.classList.contains('ds__control--cut')).toBeTrue();
    designer.fixIssue(cut[0]);
    expect(state.report().bands[1].controls[0]).toEqual(jasmine.objectContaining({ id: 'cut', canGrow: true }));
  });

  it('fits a bound text to what it prints even while the data is hidden', async () => {
    const report = createBlankReport();
    report.dataSources = [{ id: 'd', name: 'd', kind: 'json', data: [{ name: 'Anadolu Gıda ve Pazarlama Ticaret A.Ş.' }] }];
    report.dataMember = { dataSourceId: 'd' };
    report.bands[1].controls.push({ id: 'n', type: 'text', x: 0, y: 0, width: 10, height: 5, text: { expression: '[name]' } });
    create(report);
    const designer = fixture.componentInstance as unknown as { showData: { set(v: boolean): void }; fitToText(): Promise<void> };
    designer.showData.set(false);
    fixture.detectChanges();
    state.selection.set({ kind: 'controls', ids: ['n'] });
    await designer.fitToText();
    expect(state.report().bands[1].controls[0].width).toBeGreaterThan(50); // the name, not "[name]"
    // The choice is remembered in the browser: put it back for the other tests.
    designer.showData.set(true);
    fixture.detectChanges();
  });

  it('draws charts, cross tables, barcodes and sub-reports as they print, a broken one as its icon', async () => {
    const inner = createBlankReport('Inner');
    inner.bands = [{ id: 'd', kind: 'detail', height: 6, controls: [{ id: 't', type: 'text', x: 0, y: 0, width: 30, height: 6, text: 'inner text' }] }];
    const report = createBlankReport();
    report.bands.splice(2, 0, {
      id: 'rf', kind: 'reportFooter', height: 60, controls: [
        { id: 'ch', type: 'chart', chartType: 'column', x: 0, y: 0, width: 80, height: 40, category: { expression: '[c]' }, value: { expression: '[v]' } },
        { id: 'bc', type: 'barcode', x: 90, y: 0, width: 40, height: 15, symbology: 'code128', value: 'ABC123', showText: true },
        { id: 'sub', type: 'subreport', x: 90, y: 20, width: 60, height: 10, report: inner },
        { id: 'bad', type: 'subreport', x: 90, y: 40, width: 60, height: 10, report: { bands: 'nope' } as unknown as ReturnType<typeof createBlankReport> },
      ],
    });
    create(report, [{ c: 'a', v: 1 }, { c: 'b', v: 2 }]);
    await TestBed.inject(WeReportFontsService).ready();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    const preview = (id: string) => el().querySelector(`[data-control-id="${id}"] .ds__subpreview svg`);
    expect(preview('ch')).not.toBeNull();
    expect(preview('bc')).not.toBeNull();
    expect(preview('sub')?.textContent).toContain('inner text');
    expect(preview('bad')).toBeNull(); // nothing to draw: the icon stays
    expect(el().querySelector('[data-control-id="bad"] .ds__placeholder')).not.toBeNull();
  });

  it('renders the page at real size with localized bands', () => {
    create(createBlankReport());
    const page = el().querySelector('.ds__page') as HTMLElement;
    expect(page.style.width).toBe('210mm');
    expect(page.style.minHeight).toBe('297mm');
    const labels = Array.from(el().querySelectorAll('.ds__band-label')).map((e) => e.textContent?.trim());
    expect(labels).toEqual(['Sayfa başlığı', 'Detay (her satır için tekrarlanır)', 'Sayfa altlığı']);
  });

  it('adds a total of a detail column to every group footer and the report footer', () => {
    const report = createBlankReport();
    report.bands.splice(1, 0, { id: 'g', kind: 'groupHeader', height: 8, groupBy: { expression: '[city]' }, controls: [] });
    report.bands.splice(3, 0, { id: 'gf', kind: 'groupFooter', groupHeaderId: 'g', height: 8, controls: [] });
    report.bands[2].controls.push({ id: 'amount', type: 'text', x: 100, y: 0, width: 30, height: 6, text: { expression: '[amount]' }, format: 'n2' });
    create(report, [{ city: 'a', amount: 1 }]);
    state.selection.set({ kind: 'controls', ids: ['amount'] });
    (fixture.componentInstance as unknown as { addTotal(): void }).addTotal();
    const totals = state.report().bands.filter((b) => b.kind === 'groupFooter' || b.kind === 'reportFooter').map((b) => b.controls.map((c) => [c.type === 'text' ? c.text : null, c.x, (c as { format?: string }).format]));
    expect(totals).toEqual([
      [[{ expression: 'Sum([amount])' }, 100, 'n2']],
      [[{ expression: 'Sum([amount])' }, 100, 'n2']],
    ]);
    expect(state.report().bands.map((b) => b.kind)).toEqual(['pageHeader', 'groupHeader', 'detail', 'groupFooter', 'reportFooter', 'pageFooter']);
  });

  it('groups rows by the value of the selected detail item', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 'city', type: 'text', x: 0, y: 0, width: 30, height: 6, text: { expression: '[city]' } });
    create(report, [{ city: 'a' }]);
    state.selection.set({ kind: 'controls', ids: ['city'] });
    (fixture.componentInstance as unknown as { groupByValue(): void }).groupByValue();
    const header = state.report().bands.find((b) => b.kind === 'groupHeader')!;
    expect(header.groupBy).toEqual({ expression: '[city]' });
    expect(header.controls.map((c) => (c.type === 'text' ? c.text : null))).toEqual([{ expression: '[city]' }]);
    expect(state.report().bands.some((b) => b.kind === 'groupFooter' && b.groupHeaderId === header.id)).toBeTrue();
  });

  it('builds a grouped, sorted list from the report wizard', () => {
    create(createBlankReport(), [
      { city: 'B', name: 'x', amount: 2, paid: true },
      { city: 'A', name: 'y', amount: 1, paid: false },
    ]);
    el().querySelector<HTMLButtonElement>('.wd__magic')!.click();
    fixture.detectChanges();
    const selects = el().querySelectorAll<HTMLSelectElement>('.wd__wizard select');
    const choose = (select: HTMLSelectElement, value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    choose(selects[0], 'city');
    choose(selects[1], 'amount');
    choose(selects[2], 'desc');
    const create_ = el().querySelector<HTMLButtonElement>('.wd__wizard .wd__primary')!;
    expect(create_.disabled).toBeFalse();
    create_.click();
    fixture.detectChanges();
    expect(el().querySelector('.wd__wizard')).toBeNull();
    const bands = state.report().bands;
    expect(bands.map((b) => b.kind)).toEqual(['pageHeader', 'groupHeader', 'detail', 'groupFooter', 'reportFooter', 'pageFooter']);
    expect(bands.find((b) => b.kind === 'groupHeader')!.groupBy).toEqual({ expression: '[city]' });
    expect(bands.find((b) => b.kind === 'detail')!.sortBy).toEqual([{ expression: '[amount]', descending: true }]);
    // Undo brings the blank report back in one step.
    state.undo();
    expect(state.report().bands.map((b) => b.kind)).toEqual(['pageHeader', 'detail', 'pageFooter']);
  });

  it('emits every edit through the two-way report binding', () => {
    const report = createBlankReport();
    create(report);
    state.update((d) => (d.name = 'Changed'));
    fixture.detectChanges();
    expect(fixture.componentInstance.report().name).toBe('Changed');
  });

  it('drops a field as a value in the detail band and as caption + value elsewhere', () => {
    create(createBlankReport(), [{ unitPrice: 5 }]);
    const surface = fixture.debugElement.query((d) => d.componentInstance instanceof DesignSurfaceComponent).componentInstance as DesignSurfaceComponent;
    const [pageHeader, detail] = state.report().bands;
    surface.dropAt({ kind: 'field', path: 'unitPrice', parent: false }, detail, 20, 1);
    surface.dropAt({ kind: 'field', path: 'unitPrice', parent: false }, pageHeader, 0, 20);
    const bands = state.report().bands;
    expect(bands[1].controls.map((c) => (c.type === 'text' ? c.text : null))).toEqual([{ expression: '[unitPrice]' }]);
    expect(bands[0].controls.map((c) => (c.type === 'text' ? c.text : null))).toEqual(['Unit price', { expression: '[unitPrice]' }]);
    expect(bands[0].height).toBe(26); // grew to fit the drop at y = 20
  });

  it('shows the first data row inside bound controls while designing', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 40, height: 6, text: { expression: "Upper([name])" } });
    create(report, [{ name: 'çiçek' }, { name: 'b' }]);
    // No provideWeReport locale here, so formulas run in en-US casing.
    expect(el().querySelector('.ds__text--bound')?.textContent?.trim()).toBe('ÇIÇEK');
  });

  it('adds a group as the innermost header/footer pair around the detail band', () => {
    create(createBlankReport(), [{ cat: 'a' }]);
    (fixture.componentInstance as unknown as { addBand(k: string): void }).addBand('groupHeader');
    (fixture.componentInstance as unknown as { addBand(k: string): void }).addBand('groupHeader');
    (fixture.componentInstance as unknown as { addBand(k: string): void }).addBand('reportFooter');
    const kinds = state.report().bands.map((b) => `${b.kind}:${b.id}`);
    expect(kinds).toEqual([
      'pageHeader:pageHeader',
      'groupHeader:groupHeader1',
      'groupHeader:groupHeader2',
      'detail:detail',
      'groupFooter:groupHeader2Footer',
      'groupFooter:groupHeader1Footer',
      'reportFooter:reportFooter1',
      'pageFooter:pageFooter',
    ]);
    expect(state.report().bands[1].groupBy).toEqual({ expression: '[cat]' });
  });

  it('lists design problems and moves an item back onto the paper', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 'wide', type: 'text', x: 170, y: 0, width: 30, height: 5, text: { expression: '[nope]' } });
    create(report, [{ name: 'x' }]);
    const designer = fixture.componentInstance as unknown as { issues(): { code: string; controlId: string }[]; fixIssue(i: unknown): void };
    expect(designer.issues().map((i) => i.code)).toEqual(['outsidePage', 'unknownField']);
    el().querySelector<HTMLButtonElement>('.wd__issues')!.click();
    fixture.detectChanges();
    expect(el().querySelector('.wd__problems')!.textContent).toContain('kağıdın kenarından taşıyor');
    designer.fixIssue(designer.issues()[0]);
    expect(state.report().bands[1].controls[0].x).toBe(150);
    expect(designer.issues().map((i) => i.code)).toEqual(['unknownField']);
  });

  it('handles undo, delete and arrow keys', () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 't', type: 'text', x: 5, y: 0, width: 10, height: 5, text: 'x' });
    create(report);
    state.selection.set({ kind: 'controls', ids: ['t'] });
    const key = (key: string, init: KeyboardEventInit = {}) => {
      el().querySelector('we-report-design-surface')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
      fixture.detectChanges();
    };
    key('ArrowRight', { shiftKey: true });
    expect(state.report().bands[1].controls[0].x).toBe(10);
    key('Delete');
    expect(state.report().bands[1].controls.length).toBe(0);
    key('z', { ctrlKey: true });
    expect(state.report().bands[1].controls.length).toBe(1);
  });
});
