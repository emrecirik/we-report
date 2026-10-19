import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createBlankReport, ReportDefinition } from 'we-report-core';
import { WE_REPORT_LOCALE, weReportLocaleTr } from '../we-report-locale';
import { DesignSurfaceComponent } from './design-surface.component';
import { DesignerState } from './designer-state';
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

  it('renders the page at real size with localized bands', () => {
    create(createBlankReport());
    const page = el().querySelector('.ds__page') as HTMLElement;
    expect(page.style.width).toBe('210mm');
    expect(page.style.minHeight).toBe('297mm');
    const labels = Array.from(el().querySelectorAll('.ds__band-label')).map((e) => e.textContent?.trim());
    expect(labels).toEqual(['Sayfa başlığı', 'Detay (her satır için tekrarlanır)', 'Sayfa altlığı']);
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
