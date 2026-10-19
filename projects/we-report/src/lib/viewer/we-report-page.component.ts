import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LayoutPage, parseHexColor, PathItem, TextItem } from 'we-report-core';
import { WeReportFontsService } from '../we-report-fonts.service';

const PT_TO_MM = 25.4 / 72;

/**
 * Draws one laid-out page as SVG in millimetre units. It only draws what the layout engine
 * positioned — text lines included — so it matches the PDF exactly.
 */
@Component({
  selector: 'we-report-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="we-report-page"
      xmlns="http://www.w3.org/2000/svg"
      [attr.viewBox]="'0 0 ' + page().width + ' ' + page().height"
      [style.width.mm]="page().width * zoom()"
      [style.height.mm]="page().height * zoom()"
    >
      @for (item of page().items; track $index; let i = $index) {
        @switch (item.kind) {
          @case ('rect') {
            <rect
              [attr.x]="item.x"
              [attr.y]="item.y"
              [attr.width]="item.width"
              [attr.height]="item.height"
              [attr.rx]="item.radius ?? null"
              [attr.fill]="paint(item.fill)"
              [attr.stroke]="stroke(item.stroke)"
              [attr.stroke-width]="item.stroke ? (item.strokeWidth ?? 0.25) : null"
            />
          }
          @case ('ellipse') {
            <ellipse
              [attr.cx]="item.x + item.width / 2"
              [attr.cy]="item.y + item.height / 2"
              [attr.rx]="item.width / 2"
              [attr.ry]="item.height / 2"
              [attr.fill]="paint(item.fill)"
              [attr.stroke]="stroke(item.stroke)"
              [attr.stroke-width]="item.stroke ? (item.strokeWidth ?? 0.25) : null"
            />
          }
          @case ('line') {
            <line
              [attr.x1]="item.x1"
              [attr.y1]="item.y1"
              [attr.x2]="item.x2"
              [attr.y2]="item.y2"
              [attr.stroke]="stroke(item.color)"
              [attr.stroke-width]="item.width"
              stroke-linecap="square"
            />
          }
          @case ('text') {
            <svg [attr.x]="item.x" [attr.y]="item.y" [attr.width]="item.width" [attr.height]="item.height" overflow="hidden">
              @for (line of text(item).lines; track $index; let l = $index) {
                @if (isHit(line.text)) {
                  <rect
                    class="we-report-page__hit"
                    [class.we-report-page__hit--current]="current()?.item === i && current()?.line === l"
                    [attr.data-hit]="i + '-' + l"
                    [attr.x]="line.x - item.x - 0.4"
                    [attr.y]="line.baseline - item.y - text(item).size * ptToMm * 0.85"
                    [attr.width]="line.width + 0.8"
                    [attr.height]="text(item).size * ptToMm * 1.15"
                    rx="0.4"
                  />
                }
                <text
                  class="we-report-page__text"
                  [attr.x]="line.x - item.x"
                  [attr.y]="line.baseline - item.y"
                  [attr.font-family]="family(text(item))"
                  [attr.font-size]="text(item).size * ptToMm"
                  [attr.font-weight]="text(item).bold ? 700 : 400"
                  [attr.font-style]="text(item).italic ? 'italic' : 'normal'"
                  [attr.fill]="textColor(text(item).color)"
                  [attr.text-decoration]="text(item).underline ? 'underline' : null"
                >{{ line.text }}</text>
              }
            </svg>
          }
          @case ('image') {
            <svg [attr.x]="item.clip.x" [attr.y]="item.clip.y" [attr.width]="item.clip.width" [attr.height]="item.clip.height" overflow="hidden">
              <image
                [attr.x]="item.x - item.clip.x"
                [attr.y]="item.y - item.clip.y"
                [attr.width]="item.width"
                [attr.height]="item.height"
                preserveAspectRatio="none"
                [attr.href]="item.src"
              />
            </svg>
          }
          @case ('path') {
            <g [attr.transform]="'translate(' + item.x + ' ' + item.y + ')'">
              @for (p of path(item).paths; track $index) {
                <path [attr.d]="p.d" [attr.fill]="paint(p.fill)" [attr.stroke]="stroke(p.stroke)" [attr.stroke-width]="p.strokeWidth ?? null" />
              }
            </g>
          }
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    .we-report-page {
      display: block;
      background: var(--we-report-page-bg, #fff);
      box-shadow: var(--we-report-page-shadow, 0 1px 3px rgba(0, 0, 0, 0.2));
    }
    .we-report-page__hit {
      fill: var(--we-report-search-highlight, rgba(255, 204, 0, 0.45));
    }
    .we-report-page__hit--current {
      stroke: var(--we-report-accent, #007aff);
      stroke-width: 0.4;
    }
    .we-report-page__text {
      white-space: pre;
      font-kerning: none;
    }
  `,
})
export class WeReportPageComponent {
  readonly page = input.required<LayoutPage>();
  readonly zoom = input(1);
  /** Lines containing this text are highlighted (case-insensitive). */
  readonly highlight = input('');
  /** The match the viewer is showing now, drawn stronger. */
  readonly current = input<{ item: number; line: number } | null>(null);
  readonly locale = input<string | undefined>(undefined);

  protected readonly ptToMm = PT_TO_MM;

  protected isHit(text: string): boolean {
    const q = this.highlight().trim();
    return !!q && text.toLocaleLowerCase(this.locale()).includes(q.toLocaleLowerCase(this.locale()));
  }

  protected text(item: unknown): TextItem {
    return item as TextItem;
  }

  protected path(item: unknown): PathItem {
    return item as PathItem;
  }

  // Only colours the PDF can draw too (hex): anything else renders as the PDF renders it.
  protected paint(color: string | undefined): string {
    return parseHexColor(color) ? color! : 'none';
  }

  protected stroke(color: string | undefined): string | null {
    return parseHexColor(color) ? color! : null;
  }

  protected textColor(color: string): string {
    return parseHexColor(color) ? color : '#000000';
  }

  protected family(item: TextItem): string {
    return `'${WeReportFontsService.cssFamily(item.fontFamily)}'`;
  }
}
