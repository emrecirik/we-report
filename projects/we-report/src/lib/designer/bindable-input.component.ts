import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Bindable, isExpression } from 'we-report-core';
import { WeReportLocale } from '../we-report-locale';
import { DesignerField } from './designer-fields';
import { ExpressionEditorComponent } from './expression-editor.component';

/**
 * Edits a value that is either fixed or comes from data: "Fixed text" with a text box, or
 * "From data" with a field picker and the formula it produces.
 */
@Component({
  selector: 'we-report-bindable-input',
  standalone: true,
  imports: [ExpressionEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bi__mode" role="radiogroup">
      <button type="button" role="radio" [attr.aria-checked]="!bound()" [class.bi__on]="!bound()" (click)="toFixed()">{{ strings().staticText }}</button>
      <button type="button" role="radio" [attr.aria-checked]="bound()" [class.bi__on]="bound()" (click)="toBound()">{{ strings().fromData }}</button>
    </div>
    @if (bound()) {
      @if (fields().length) {
        <select class="bi__input" [attr.aria-label]="label()" (change)="pickField($any($event.target).value)">
          <option value="" [selected]="!fieldMatch()">—</option>
          @for (f of fields(); track f.expression) {
            <option [value]="f.expression" [selected]="f.expression === expression()">{{ f.label }}</option>
          }
        </select>
      }
      <label class="bi__formula">
        <span>{{ strings().expression }}</span>
        <span class="bi__row">
          <input class="bi__input bi__mono" [value]="expression()" (input)="setExpression($any($event.target).value)" spellcheck="false" />
          <button type="button" class="bi__fx" (click)="editorOpen.set(true)" [title]="strings().openFormulaEditor" [attr.aria-label]="strings().openFormulaEditor">ƒx</button>
        </span>
      </label>
      @if (editorOpen()) {
        <we-report-expression-editor [expression]="expression()" [fields]="fields()" [strings]="strings()" (applied)="setExpression($event); editorOpen.set(false)" (closed)="editorOpen.set(false)" />
      }
      <small class="bi__hint">{{ strings().expressionHint }}</small>
    } @else if (multiline()) {
      <textarea class="bi__input" rows="3" [attr.aria-label]="label()" [value]="fixedText()" (input)="setFixed($any($event.target).value)"></textarea>
    } @else {
      <input class="bi__input" [attr.aria-label]="label()" [value]="fixedText()" (input)="setFixed($any($event.target).value)" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bi__mode {
      display: flex;
      padding: 2px;
      gap: 2px;
      border-radius: 8px;
      background: var(--we-report-segment-bg, rgba(118, 118, 128, 0.12));
    }
    .bi__mode button {
      flex: 1;
      border: 0;
      border-radius: 6px;
      padding: 4px 6px;
      font: inherit;
      font-size: 12px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      transition: background-color 0.15s ease, box-shadow 0.15s ease;
    }
    .bi__mode button.bi__on {
      background: var(--we-report-segment-on-bg, #fff);
      box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .bi__mode button:focus-visible,
    .bi__input:focus {
      outline: none;
      box-shadow: var(--we-report-focus-ring, 0 0 0 3px rgba(0, 122, 255, 0.35));
    }
    .bi__input {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      padding: 5px 8px;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      background: var(--we-report-input-bg, rgba(118, 118, 128, 0.1));
      color: inherit;
    }
    @media (prefers-reduced-motion: reduce) {
      .bi__mode button {
        transition: none;
      }
    }
    .bi__row {
      display: flex;
      gap: 4px;
    }
    .bi__fx {
      flex: none;
      width: 30px;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.07));
      color: var(--we-report-accent, #007aff);
      font: italic 600 13px Georgia, 'Times New Roman', serif;
      cursor: pointer;
    }
    .bi__fx:hover {
      background: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
    }
    .bi__mono {
      font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    }
    .bi__formula {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .bi__hint {
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
      font-size: 11px;
    }
  `,
})
export class BindableInputComponent {
  readonly value = input.required<Bindable<string>>();
  readonly fields = input<DesignerField[]>([]);
  readonly strings = input.required<WeReportLocale>();
  readonly multiline = input(false);
  /** What the value is, for screen readers (the visible caption sits outside the component). */
  readonly label = input<string | undefined>(undefined);
  readonly valueChange = output<Bindable<string>>();

  protected readonly editorOpen = signal(false);
  protected readonly bound = computed(() => isExpression(this.value()));
  protected readonly expression = computed(() => {
    const v = this.value();
    return isExpression(v) ? v.expression : '';
  });
  protected readonly fixedText = computed(() => {
    const v = this.value();
    return isExpression(v) ? '' : v;
  });
  protected readonly fieldMatch = computed(() => this.fields().some((f) => f.expression === this.expression()));

  protected toFixed(): void {
    if (this.bound()) this.valueChange.emit('');
  }

  protected toBound(): void {
    if (!this.bound()) this.valueChange.emit({ expression: this.fields()[0]?.expression ?? '' });
  }

  protected pickField(expression: string): void {
    if (expression) this.valueChange.emit({ expression });
  }

  protected setExpression(expression: string): void {
    this.valueChange.emit({ expression });
  }

  protected setFixed(text: string): void {
    this.valueChange.emit(text);
  }
}
