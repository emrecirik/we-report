import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createBlankReport } from 'we-report-core';
import { weReportLocaleTr } from '../we-report-locale';
import { DesignerState } from './designer-state';
import { PropertyPanelComponent } from './property-panel.component';

describe('PropertyPanelComponent', () => {
  let fixture: ComponentFixture<PropertyPanelComponent>;
  let state: DesignerState;
  const el = () => fixture.nativeElement as HTMLElement;
  const checkbox = (label: string) =>
    Array.from(el().querySelectorAll('label.pp__check')).find((l) => l.textContent?.includes(label))?.querySelector('input') as HTMLInputElement | undefined;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PropertyPanelComponent], providers: [DesignerState] });
    state = TestBed.inject(DesignerState);
    const report = createBlankReport();
    report.bands.splice(2, 0, { id: 'rf', kind: 'reportFooter', height: 10, controls: [] });
    state.load(report);
    fixture = TestBed.createComponent(PropertyPanelComponent);
    fixture.componentRef.setInput('strings', weReportLocaleTr);
    fixture.componentRef.setInput('advanced', true);
    fixture.detectChanges();
  });

  it('keeps a page footer off the last page and brings it back, storing only false', () => {
    state.selection.set({ kind: 'band', id: report().bands.find((b) => b.kind === 'pageFooter')!.id });
    fixture.detectChanges();
    const last = checkbox(weReportLocaleTr.printOnLastPage)!;
    expect(last.checked).toBeTrue();
    last.click();
    expect(footer().printOnLastPage).toBeFalse();
    last.click();
    expect(footer().printOnLastPage).toBeUndefined();
  });

  it('offers "at the bottom of the last page" on the report footer only', () => {
    state.selection.set({ kind: 'band', id: 'rf' });
    fixture.detectChanges();
    checkbox(weReportLocaleTr.printAtBottom)!.click();
    expect(report().bands.find((b) => b.id === 'rf')!.printAtBottom).toBeTrue();
    state.selection.set({ kind: 'band', id: report().bands.find((b) => b.kind === 'pageFooter')!.id });
    fixture.detectChanges();
    expect(checkbox(weReportLocaleTr.printAtBottom)).toBeUndefined();
  });

  function report() {
    return state.report();
  }
  function footer() {
    return report().bands.find((b) => b.kind === 'pageFooter')!;
  }
});
