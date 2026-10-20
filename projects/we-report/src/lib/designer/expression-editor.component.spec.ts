import { TestBed } from '@angular/core/testing';
import { weReportLocaleEn } from '../we-report-locale';
import { DesignerState } from './designer-state';
import { ExpressionEditorComponent } from './expression-editor.component';

describe('ExpressionEditorComponent', () => {
  it('suggests functions and fields while typing and completes with Enter', () => {
    TestBed.configureTestingModule({ imports: [ExpressionEditorComponent], providers: [DesignerState] });
    const fixture = TestBed.createComponent(ExpressionEditorComponent);
    fixture.componentRef.setInput('strings', weReportLocaleEn);
    fixture.componentRef.setInput('fields', [{ path: 'amount', label: 'Amount', expression: '[amount]', type: 'number', depth: 0, parent: false }]);
    fixture.detectChanges();
    const area = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const type = (text: string) => {
      area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const options = () => Array.from(fixture.nativeElement.querySelectorAll('.xe__suggest code')).map((e) => (e as HTMLElement).textContent);

    type('Sum');
    expect(options()).toContain('Sum(value)');
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(area.value).toBe('Sum()');
    expect(area.selectionStart).toBe(4); // between the brackets

    type('[am');
    expect(options()).toEqual(['[amount]']);
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(area.value).toBe('Sum([amount])');

    // Inside quotes nothing is suggested.
    area.selectionStart = area.selectionEnd = area.value.length;
    type(" + ' Su");
    fixture.detectChanges();
    expect(options()).toEqual([]);
  });
});
