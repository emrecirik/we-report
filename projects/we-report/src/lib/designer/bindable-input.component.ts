import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Bindable, isExpression } from 'we-report-core';
import { WeReportLocale } from '../we-report-locale';
import { DesignerField } from './designer-fields';

/**
 * Edits a value that is either fixed or comes from data: "Fixed text" with a text box, or
 * "From data" with a field picker and the formula it produces.
 */
@Component({
  selector: 'we-report-bindable-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bi__mode" role="radiogroup">
      <button type="button" role="radio" [attr.aria-checked]="!bound()" [class.bi__on]="!bound()" (click)="toFixed()">{{ strings().staticText }}</button>
      <button type="button" role="radio" [attr.aria-checked]="bound()" [class.bi__on]="bound()" (click)="toBound()">{{ strings().fromData }}</button>
    </div>
    @if (bound()) {
      @if (fields().length) {
        <select class="bi__input" (change)="pickField($any($event.target).value)">
          <option value="" [selected]="!fieldMatch()">—</option>
          @for (f of fields(); track f.expression) {
            <option [value]="f.expression" [selected]="f.expression === expression()">{{ f.label }}</option>
          }
        </select>
      }
      <label class="bi__formula">
        <span>{{ strings().expression }}</span>
        <input class="bi__input bi__mono" [value]="expression()" (input)="setExpression($any($event.target).value)" spellcheck="false" />
      </label>
      <small class="bi__hint">{{ strings().expressionHint }}</small>
    } @else if (multiline()) {
      <textarea class="bi__input" rows="3" [value]="fixedText()" (input)="setFixed($any($event.target).value)"></textarea>
    } @else {
      <input class="bi__input" [value]="fixedText()" (input)="setFixed($any($event.target).value)" />
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
      border: 1px solid var(--we-report-band-border, #d5dae1);
      border-radius: 6px;
      overflow: hidden;
    }
    .bi__mode button {
      flex: 1;
      border: 0;
      padding: 4px 6px;
      font: inherit;
      background: var(--we-report-input-bg, #fff);
      color: inherit;
      cursor: pointer;
    }
    .bi__mode button.bi__on {
      background: var(--we-report-accent, #2563eb);
      color: var(--we-report-page-bg, #fff);
    }
    .bi__input {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      padding: 4px 6px;
      border: 1px solid var(--we-report-band-border, #d5dae1);
      border-radius: 6px;
      background: var(--we-report-input-bg, #fff);
      color: inherit;
    }
    .bi__mono {
      font-family: ui-monospace, Consolas, monospace;
    }
    .bi__formula {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
      color: var(--we-report-muted-fg, #57606a);
    }
    .bi__hint {
      color: var(--we-report-muted-fg, #57606a);
      font-size: 11px;
    }
  `,
})
export class BindableInputComponent {
  readonly value = input.required<Bindable<string>>();
  readonly fields = input<DesignerField[]>([]);
  readonly strings = input.required<WeReportLocale>();
  readonly multiline = input(false);
  readonly valueChange = output<Bindable<string>>();

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
