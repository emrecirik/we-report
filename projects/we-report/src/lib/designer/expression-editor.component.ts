import { AfterViewInit, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { evaluate, EXPRESSION_FUNCTIONS, formatValue, FunctionCategory, FunctionInfo, resolveParameters } from 'we-report-core';
import { WE_REPORT_CONFIG } from '../we-report-config';
import { WeReportLocale } from '../we-report-locale';
import { DesignerField } from './designer-fields';
import { DesignerState } from './designer-state';

interface Suggestion {
  label: string;
  insert: string;
  /** How far the caret moves back after inserting (into a function's brackets). */
  back: number;
  help: string;
}

const CATEGORIES: { id: FunctionCategory; label: keyof WeReportLocale }[] = [
  { id: 'logic', label: 'fnLogic' },
  { id: 'text', label: 'fnText' },
  { id: 'number', label: 'fnNumber' },
  { id: 'date', label: 'fnDate' },
  { id: 'aggregate', label: 'fnAggregate' },
];

/**
 * A sheet for writing a formula: fields, parameters and every function with a one-line
 * explanation, inserted at the cursor, and the result for the first data row as you type.
 */
@Component({
  selector: 'we-report-expression-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = strings();
    <div class="xe__backdrop" (click)="closed.emit()"></div>
    <div class="xe" role="dialog" aria-modal="true" [attr.aria-label]="s.formulaEditor" (keydown.escape)="closed.emit()">
      <h2>{{ s.formulaEditor }}</h2>
      <p class="xe__hint">{{ s.formulaEditorHint }}</p>
      <div class="xe__field">
        <textarea
          #area
          class="xe__formula"
          (input)="draft.set($any($event.target).value); findToken()"
          (click)="findToken()"
          (keydown)="onKey($event)"
          (blur)="token.set(null)"
          spellcheck="false"
          rows="3"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="suggestions().length > 0"
          [attr.aria-label]="s.expression"
        ></textarea>
        @if (suggestions().length) {
          <ul class="xe__suggest" role="listbox">
            @for (o of suggestions(); track o.label; let i = $index) {
              <li role="option" [attr.aria-selected]="i === active()" [class.xe__on]="i === active()" (mousedown)="$event.preventDefault(); accept(o)">
                <code>{{ o.label }}</code>
                @if (o.help) {
                  <small>{{ o.help }}</small>
                }
              </li>
            }
          </ul>
        }
      </div>
      <div class="xe__result" [class.xe__result--error]="result().error" aria-live="polite">
        <span>{{ s.formulaResult }}</span>
        <output>{{ result().text }}</output>
      </div>
      <div class="xe__lists">
        <section>
          <h3>{{ s.fields }}</h3>
          <ul>
            @for (f of fields(); track f.expression) {
              <li><button type="button" (click)="insert(f.expression)" [style.padding-left.px]="8 + f.depth * 12" [attr.title]="f.caption ? f.expression : null">{{ f.label }}</button></li>
            }
            @for (p of parameters(); track p.name) {
              <li><button type="button" (click)="insert('[?' + p.name + ']')">? {{ p.label || p.name }}</button></li>
            }
            <li><button type="button" (click)="insert('[PageNumber]')"># {{ s.pageNumber }}</button></li>
            <li><button type="button" (click)="insert('[Pages]')"># {{ s.pageTotal }}</button></li>
          </ul>
        </section>
        <section>
          <h3>{{ s.functions }}</h3>
          <div class="xe__cats" role="tablist">
            @for (c of categories; track c.id) {
              <button type="button" role="tab" [attr.aria-selected]="category() === c.id" [class.xe__on]="category() === c.id" (click)="category.set(c.id)">{{ s[c.label] }}</button>
            }
          </div>
          <ul>
            @for (f of visibleFunctions(); track f.name) {
              <li>
                <button type="button" class="xe__fn" (click)="insertFunction(f)">
                  <code>{{ f.signature }}</code>
                  <small>{{ s.functionHelp[f.name] }}</small>
                </button>
              </li>
            }
          </ul>
        </section>
      </div>
      <div class="xe__actions">
        <button type="button" (click)="closed.emit()">{{ s.cancel }}</button>
        <button type="button" class="xe__primary" (click)="applied.emit(draft())">{{ s.apply }}</button>
      </div>
    </div>
  `,
  styles: `
    .xe__backdrop {
      position: fixed;
      inset: 0;
      z-index: 150;
      background: var(--we-report-backdrop, rgba(0, 0, 0, 0.22));
    }
    .xe {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 151;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: min(820px, calc(100vw - 32px));
      height: min(640px, calc(100vh - 32px));
      box-sizing: border-box;
      padding: 20px;
      border-radius: 14px;
      background: var(--we-report-panel-bg, #fbfbfd);
      color: var(--we-report-fg, #1d1d1f);
      box-shadow: var(--we-report-popover-shadow, 0 8px 24px rgba(0, 0, 0, 0.14));
      font: 13px var(--we-report-font-family, system-ui, sans-serif);
    }
    h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
    h3 {
      margin: 0 0 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .xe__hint {
      margin: -6px 0 0;
      font-size: 12px;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .xe__field {
      position: relative;
    }
    .xe__suggest {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      z-index: 2;
      max-height: 220px;
      overflow: auto;
      margin: 4px 0 0;
      padding: 4px;
      list-style: none;
      border-radius: 10px;
      background: var(--we-report-panel-bg, #fbfbfd);
      box-shadow: var(--we-report-popover-shadow, 0 8px 24px rgba(0, 0, 0, 0.14));
    }
    .xe__suggest li {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .xe__suggest li.xe__on {
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.12));
    }
    .xe__suggest small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .xe__formula {
      box-sizing: border-box;
      width: 100%;
      padding: 10px;
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      background: var(--we-report-input-bg, rgba(118, 118, 128, 0.1));
      color: inherit;
      font: 13px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      resize: vertical;
    }
    .xe__formula:focus,
    button:focus-visible {
      outline: none;
      box-shadow: var(--we-report-focus-ring, 0 0 0 3px rgba(0, 122, 255, 0.35));
    }
    .xe__result {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 8px 12px;
      border-radius: 10px;
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.07));
      font-size: 12px;
    }
    .xe__result span {
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .xe__result output {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xe__result--error {
      background: var(--we-report-warning-bg, rgba(255, 149, 0, 0.12));
      color: var(--we-report-warning-fg, #9a4400);
    }
    .xe__lists {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 16px;
    }
    .xe__lists section {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    ul {
      flex: 1;
      overflow: auto;
      list-style: none;
      margin: 0;
      padding: 4px;
      border-radius: 10px;
      background: var(--we-report-workspace-bg, #f2f2f7);
    }
    li button {
      display: block;
      width: 100%;
      border: 0;
      border-radius: 6px;
      padding: 5px 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    li button:hover {
      background: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
    }
    .xe__fn code {
      display: block;
      font: 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
      color: var(--we-report-accent, #007aff);
    }
    .xe__fn small {
      color: var(--we-report-muted-fg, rgba(60, 60, 67, 0.75));
    }
    .xe__cats {
      display: flex;
      gap: 2px;
      padding: 2px;
      margin-bottom: 6px;
      border-radius: 8px;
      background: var(--we-report-segment-bg, rgba(118, 118, 128, 0.12));
    }
    .xe__cats button {
      flex: 1;
      border: 0;
      border-radius: 6px;
      padding: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .xe__cats .xe__on {
      background: var(--we-report-segment-on-bg, #fff);
      box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .xe__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .xe__actions button {
      border: 0;
      border-radius: var(--we-report-control-radius, 7px);
      padding: 6px 16px;
      background: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
      color: inherit;
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .xe__actions .xe__primary {
      background: var(--we-report-accent, #007aff);
      color: var(--we-report-accent-fg, #fff);
    }
  `,
})
export class ExpressionEditorComponent implements AfterViewInit {
  readonly expression = input('');
  readonly fields = input<DesignerField[]>([]);
  readonly strings = input.required<WeReportLocale>();
  readonly applied = output<string>();
  readonly closed = output<void>();

  private readonly state = inject(DesignerState);
  private readonly config = inject(WE_REPORT_CONFIG);
  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');

  protected readonly categories = CATEGORIES;
  protected readonly draft = signal('');
  protected readonly category = signal<FunctionCategory>('logic');
  protected readonly parameters = computed(() => this.state.report().parameters ?? []);
  protected readonly visibleFunctions = computed(() => EXPRESSION_FUNCTIONS.filter((f) => f.category === this.category()));

  /** What the formula gives for the first row, or why it cannot be evaluated. */
  protected readonly result = computed<{ text: string; error: boolean }>(() => {
    const formula = this.draft().trim();
    if (!formula) return { text: this.strings().formulaEmpty, error: false };
    const report = this.state.report();
    const options = { locale: report.locale || this.config.locale || 'en-US', currency: report.currency || this.config.currency || 'USD' };
    const sample = this.state.sample();
    try {
      const value = evaluate(formula, { ...sample, params: resolveParameters(this.parameters()), ...options, now: new Date() });
      const text = typeof value === 'string' ? value : formatValue(value, undefined, options);
      return { text: text === '' ? this.strings().formulaEmpty : text, error: false };
    } catch (e) {
      return { text: (e as Error).message, error: true };
    }
  });

  ngAfterViewInit(): void {
    // The textarea owns its text (no [value] binding), so inserting never moves the caret.
    const el = this.area().nativeElement;
    el.value = this.expression();
    this.draft.set(el.value);
    queueMicrotask(() => el.focus());
  }

  /** Inserts at the caret (replacing a selection); `caretBack` moves the caret left afterwards. */
  protected insert(text: string, caretBack = 0): void {
    const el = this.area().nativeElement;
    el.focus();
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.selectionStart = el.selectionEnd = el.selectionEnd - caretBack;
    this.draft.set(el.value);
  }

  /** The word (or `[field` start) before the caret that suggestions complete. */
  protected readonly token = signal<{ start: number; text: string; field: boolean } | null>(null);
  protected readonly active = signal(0);

  /** Functions, fields and parameters matching the word being typed, best first. */
  protected readonly suggestions = computed<Suggestion[]>(() => {
    const t = this.token();
    if (!t) return [];
    const q = t.text.toLocaleLowerCase();
    const fields: Suggestion[] = [
      ...this.fields().map((f) => ({ label: f.expression, insert: f.expression, back: 0, help: f.label })),
      ...this.parameters().map((p) => ({ label: `[?${p.name}]`, insert: `[?${p.name}]`, back: 0, help: p.label ?? '' })),
      { label: '[PageNumber]', insert: '[PageNumber]', back: 0, help: this.strings().pageNumber },
      { label: '[Pages]', insert: '[Pages]', back: 0, help: this.strings().pageTotal },
    ];
    const matches = (s: Suggestion) => s.label.toLocaleLowerCase().replace(/^\[\??/, '').includes(q.replace(/^\[\??/, ''));
    if (t.field) return fields.filter(matches).slice(0, 8);
    const help = this.strings().functionHelp;
    const fns: Suggestion[] = EXPRESSION_FUNCTIONS.filter((f) => f.name.toLocaleLowerCase().startsWith(q)).map((f) => ({
      label: f.signature,
      insert: `${f.name}()`,
      back: 1,
      help: help[f.name] ?? '',
    }));
    return [...fns, ...fields.filter(matches)].slice(0, 8);
  });

  /** Finds the word at the caret: letters after an operator, or an unfinished `[field`. */
  protected findToken(): void {
    const el = this.area().nativeElement;
    const before = el.value.slice(0, el.selectionStart);
    const field = /\[[^\]]*$/.exec(before);
    const word = /[A-Za-zÇĞİÖŞÜçğıöşü_]+$/.exec(before);
    // Inside quotes it is text, not a formula word.
    const quotes = (before.match(/'/g) ?? []).length % 2 === 1;
    const found = quotes ? null : field ? { start: field.index, text: field[0], field: true } : word ? { start: word.index, text: word[0], field: false } : null;
    this.token.set(found);
    this.active.set(0);
  }

  protected onKey(e: KeyboardEvent): void {
    const list = this.suggestions();
    if (!list.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.accept(list[this.active()]);
    } else if (e.key === 'Escape') {
      // Closes the list only, not the editor.
      e.stopPropagation();
      this.token.set(null);
    }
  }

  protected accept(s: Suggestion): void {
    const t = this.token();
    if (!t) return;
    const el = this.area().nativeElement;
    el.focus();
    el.setRangeText(s.insert, t.start, el.selectionStart, 'end');
    el.selectionStart = el.selectionEnd = el.selectionEnd - s.back;
    this.draft.set(el.value);
    this.token.set(null);
  }

  /** Inserts `Name()` and puts the cursor between the brackets. */
  protected insertFunction(f: FunctionInfo): void {
    this.insert(`${f.name}()`, 1);
  }
}
