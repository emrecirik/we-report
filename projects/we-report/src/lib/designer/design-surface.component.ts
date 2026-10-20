import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, OnDestroy, signal } from '@angular/core';
import { Band, Bindable, createBlankReport, DEFAULT_WATERMARK_COLOR, evaluate, readImage, fitLines, formatValue, isExpression, LayoutPage, layoutReport, parseRichText, ReportControl, ReportControlType, ReportDefinition, ReportStyle, resolvePageGeometry, resolveStyle, RichRun } from 'we-report-core';
import { WeReportPageComponent } from '../viewer/we-report-page.component';
import { WE_REPORT_CONFIG } from '../we-report-config';
import { WeReportFontsService } from '../we-report-fonts.service';
import { WeReportIconPipe } from '../we-report-icon.pipe';
import { DesignerField } from './designer-fields';
import { ExpressionEditorComponent } from './expression-editor.component';
import { WeReportLocale } from '../we-report-locale';
import { captionFor, createControl, fieldExpression } from './control-factory';
import { DesignerState } from './designer-state';

/** First row of the data, shown inside bound controls while designing. */
export interface DesignSample {
  row: unknown;
  rows: readonly unknown[];
  parent: unknown;
  /** The report's calculated fields, so the sample shows them too. */
  calculated?: Record<string, string>;
}

/** Payload of an HTML5 drag from the toolbox or the field list. */
export type DesignerDragData =
  | { kind: 'control'; type: ReportControlType; variant?: string }
  | { kind: 'field'; path: string; parent: boolean; format?: string };

export const DRAG_MIME = 'application/x-we-report';

const PX_PER_MM = 96 / 25.4;
const SNAP_DISTANCE_MM = 1.5;
const MIN_SIZE_MM = 1;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Guide {
  bandId: string;
  orientation: 'v' | 'h';
  at: number;
}

/** The gap between a dragged item and its nearest neighbour, shown while moving (mm). */
export interface Gap {
  bandId: string;
  orientation: 'v' | 'h';
  x: number;
  y: number;
  length: number;
}

/** Gaps from `p` to the nearest rect on each side that faces it (overlaps on the other axis). */
export function gapsAround(p: Rect, others: Rect[], bandId: string, max = 60): Gap[] {
  const gaps: Gap[] = [];
  const overlapY = (r: Rect) => Math.min(r.y + r.height, p.y + p.height) - Math.max(r.y, p.y);
  const overlapX = (r: Rect) => Math.min(r.x + r.width, p.x + p.width) - Math.max(r.x, p.x);
  const midY = (r: Rect) => (Math.max(r.y, p.y) + Math.min(r.y + r.height, p.y + p.height)) / 2;
  const midX = (r: Rect) => (Math.max(r.x, p.x) + Math.min(r.x + r.width, p.x + p.width)) / 2;
  const nearest = (items: Rect[], dist: (r: Rect) => number) =>
    items.reduce<Rect | null>((best, r) => (dist(r) >= 0 && dist(r) <= max && (!best || dist(r) < dist(best)) ? r : best), null);
  const facingH = others.filter((r) => overlapY(r) > 0);
  const facingV = others.filter((r) => overlapX(r) > 0);
  const left = nearest(facingH, (r) => p.x - (r.x + r.width));
  const right = nearest(facingH, (r) => r.x - (p.x + p.width));
  const up = nearest(facingV, (r) => p.y - (r.y + r.height));
  const down = nearest(facingV, (r) => r.y - (p.y + p.height));
  if (left) gaps.push({ bandId, orientation: 'h', x: left.x + left.width, y: midY(left), length: p.x - left.x - left.width });
  if (right) gaps.push({ bandId, orientation: 'h', x: p.x + p.width, y: midY(right), length: right.x - p.x - p.width });
  if (up) gaps.push({ bandId, orientation: 'v', x: midX(up), y: up.y + up.height, length: p.y - up.y - up.height });
  if (down) gaps.push({ bandId, orientation: 'v', x: midX(down), y: p.y + p.height, length: down.y - p.y - p.height });
  return gaps.filter((g) => g.length > 0.05);
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragOp {
  kind: 'move' | 'resize' | 'band' | 'marquee';
  /** marquee: what was selected before (Shift/Ctrl), and the section's screen position. */
  baseIds?: string[];
  origin?: { left: number; top: number };
  startX: number;
  startY: number;
  key: string;
  handle?: Handle;
  bandId: string;
  primaryId?: string;
  originals: Map<string, Rect>;
  bandHeight?: number;
  additive?: boolean;
  /** Ctrl-click on a selected item: unselect it only if the pointer did not drag (Ctrl+drag copies). */
  toggleOnClick?: boolean;
  moved: boolean;
}

/** The page, its bands and controls, with selection, drag, resize, snapping and drop targets. */
@Component({
  selector: 'we-report-design-surface',
  standalone: true,
  imports: [WeReportIconPipe, ExpressionEditorComponent, WeReportPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Focusable so keyboard shortcuts (undo, delete, arrows) reach the designer after a click.
  host: { tabindex: '0', '[class.ds--painting]': '!!state.painter()' },
  template: `
    @let r = ruler();
    <svg class="ds__ruler" aria-hidden="true" [attr.width]="r.width" height="20" [attr.viewBox]="'0 0 ' + r.width + ' 20'">
      <rect class="ds__ruler-margin" x="0" y="0" [attr.width]="r.left" height="20" />
      <rect class="ds__ruler-margin" [attr.x]="r.width - r.right" y="0" [attr.width]="r.right" height="20" />
      @if (r.selection; as sel) {
        <rect class="ds__ruler-selection" [attr.x]="sel.x" y="0" [attr.width]="sel.width" height="20" />
      }
      <path class="ds__ruler-ticks" [attr.d]="r.ticks" />
      @for (l of r.labels; track l.x) {
        <text [attr.x]="l.x + 2" y="9">{{ l.text }}</text>
      }
    </svg>
    <div class="ds__page" (pointermove)="trackPointer($event)" (pointerleave)="state.pointer.set(null)" role="region" [attr.aria-label]="strings().designerLabel" [style.width.mm]="geometry().width * zoom()" [style.min-height.mm]="(geometry().height ?? 0) * zoom()" [style.padding]="padding()" [style.--ds-margin-right.mm]="state.report().page.margins.right * zoom()" [style.background-color]="state.report().page.color || null">
      @if (watermarkText(); as wm) {
        <div class="ds__watermark" aria-hidden="true" [style.color]="state.report().watermark?.color ?? defaultWatermarkColor" [style.font-size.mm]="geometry().width * zoom() * 0.12" [style.transform]="'translate(-50%, -50%) rotate(' + -(state.report().watermark?.angle ?? 45) + 'deg)'">{{ wm }}</div>
      }
      @for (band of state.report().bands; track band.id) {
        @let folded = state.collapsed().has(band.id);
        <div class="ds__band" [class.ds__band--selected]="isBandSelected(band.id)" [class.ds__band--collapsed]="folded">
          <button type="button" class="ds__band-label" [title]="bandLabel(band) + ' — ' + (folded ? strings().expandBand : strings().collapseBand) " [attr.aria-expanded]="!folded" (click)="selectBand(band.id)" (dblclick)="state.toggleCollapsed(band.id)">
            {{ bandLabel(band) }}
          </button>
          <div
            class="ds__band-body"
            [attr.data-band-id]="band.id"
            [style.height.mm]="folded ? 6 : band.height * zoom()"
            [style.background-color]="band.backgroundColor ?? null"
            [style.background-size.mm]="gridSize() * zoom()"
            [style.background-image]="gridSize() ? null : 'none'"
            (pointerdown)="onBodyPointerDown($event, band)"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event, band)"
          >
            @for (c of band.controls; track c.id) {
              <div
                class="ds__control"
                [attr.data-control-id]="c.id"
                [class.ds__control--selected]="isSelected(c.id)"
                [class.ds__control--cut]="cutTexts().has(c.id)"
                [attr.data-type]="c.type"
                [style.left.mm]="c.x * zoom()"
                [style.top.mm]="c.y * zoom()"
                [style.width.mm]="c.width * zoom()"
                [style.height.mm]="c.height * zoom()"
                (pointerdown)="onControlPointerDown($event, c, band)"
                (dblclick)="startEditing(c)"
              >
                @switch (c.type) {
                  @case ('line') {
                    <svg class="ds__fill" preserveAspectRatio="none" [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height">
                      <line
                        [attr.x1]="lineCoords(c)[0]"
                        [attr.y1]="lineCoords(c)[1]"
                        [attr.x2]="lineCoords(c)[2]"
                        [attr.y2]="lineCoords(c)[3]"
                        [attr.stroke]="lineColor(c)"
                        [attr.stroke-width]="lineWidth(c)"
                      />
                    </svg>
                  }
                  @case ('shape') {
                    <div class="ds__fill" [style]="shapeStyle(c)"></div>
                  }
                  @case ('image') {
                    @if (staticImage(c); as src) {
                      <img class="ds__fill ds__image" [src]="src" [style.object-fit]="objectFit(c)" alt="" />
                    } @else {
                      <div class="ds__placeholder" [innerHTML]="'image' | weReportIcon"></div>
                    }
                  }
                  @case ('barcode') {
                    <div class="ds__placeholder">
                      <span [innerHTML]="(isQr(c) ? 'qrcode' : 'barcode') | weReportIcon"></span>
                      <small>{{ barcodeLabel(c) }}</small>
                    </div>
                  }
                  @case ('table') {
                    @for (cell of tableCells(c, band); track $index) {
                      <div
                        class="ds__cell"
                        [class.ds__cell--on]="isCellSelected(c.id, cell.row, cell.index)"
                        [class.ds__text--bound]="cell.bound"
                        [style]="cell.style"
                        [style.left.mm]="cell.x * zoom()"
                        [style.top.mm]="cell.y * zoom()"
                        [style.width.mm]="cell.width * zoom()"
                        [style.height.mm]="cell.height * zoom()"
                        (click)="selectCell(c.id, cell.row, cell.index)"
                        (dblclick)="$event.stopPropagation(); startEditing(c, cell.row, cell.index)"
                      >
                        @if (isEditing(c.id, cell.row, cell.index)) {
                          <textarea class="ds__editor" [value]="editText()" [style]="cell.style" (pointerdown)="$event.stopPropagation()" (keydown)="onEditorKey($event)" (blur)="commitEditing($event)" [attr.aria-label]="strings().content"></textarea>
                        } @else {
                          {{ cell.text }}
                        }
                      </div>
                    }
                  }
                  @case ('chart') {
                    <div class="ds__placeholder ds__chart">
                      <span [innerHTML]="'chart' | weReportIcon"></span>
                      <small>{{ chartLabel(c) }}</small>
                    </div>
                  }
                  @case ('checkbox') {
                    <div class="ds__placeholder" [innerHTML]="'checkbox' | weReportIcon"></div>
                  }
                  @case ('crosstab') {
                    <div class="ds__placeholder ds__chart">
                      <span [innerHTML]="'crosstab' | weReportIcon"></span>
                      <small>{{ crosstabLabel(c) }}</small>
                    </div>
                  }
                  @case ('subreport') {
                    @if (subreportPages().get(c.id); as preview) {
                      <!-- The sub-report laid out with the sample row, as it prints; double-click edits it. -->
                      <div class="ds__subpreview" [title]="strings().subreportEdit">
                        <we-report-page [page]="preview" [zoom]="zoom()" />
                        <small class="ds__subname">{{ c.report.name || strings().controlNames.subreport }}</small>
                      </div>
                    } @else {
                      <div class="ds__placeholder ds__chart" [title]="strings().subreportEdit">
                        <span [innerHTML]="'subreport' | weReportIcon"></span>
                        <small>{{ c.report.name || strings().controlNames.subreport }}</small>
                      </div>
                    }
                  }
                  @default {
                    @if (isEditing(c.id)) {
                      <textarea class="ds__editor" [value]="editText()" [style]="textStyle(c)" (pointerdown)="$event.stopPropagation()" (keydown)="onEditorKey($event)" (blur)="commitEditing($event)" [attr.aria-label]="strings().content"></textarea>
                    } @else {
                      @if (c.type === 'text' && c.markup) {
                        <div class="ds__text" [class.ds__text--bound]="isBound(c)" [style]="textStyle(c)" [attr.title]="isBound(c) ? boundExpression(c) : null">
                          <!-- One flex item, so the pieces flow as one paragraph. -->
                          <span>
                            @for (r of richRuns(c, band); track $index) {
                              <span [style.font-weight]="r.bold ? 700 : null" [style.font-style]="r.italic ? 'italic' : null" [style.text-decoration]="r.underline ? 'underline' : null">{{ r.text }}</span>
                            }
                          </span>
                        </div>
                      } @else {
                        <div class="ds__text" [class.ds__text--bound]="isBound(c)" [style]="textStyle(c)" [attr.title]="isBound(c) ? boundExpression(c) : null">{{ caption(c, band) }}</div>
                      }
                    }
                  }
                }
                @if (isOnlySelected(c.id)) {
                  @for (h of handles; track h) {
                    <span class="ds__handle" [attr.data-handle]="h" (pointerdown)="onHandlePointerDown($event, c, band, h)"></span>
                  }
                }
              </div>
            }
            @if (marquee(); as m) {
              @if (m.bandId === band.id) {
                <div class="ds__marquee" [style.left.mm]="m.x * zoom()" [style.top.mm]="m.y * zoom()" [style.width.mm]="m.width * zoom()" [style.height.mm]="m.height * zoom()"></div>
              }
            }
            @if (columnShade(band); as shade) {
              <div class="ds__columns" [style.left.mm]="shade.left * zoom()" aria-hidden="true">
                <span>{{ strings().repeatsAcross.replace('{0}', '' + shade.count) }}</span>
              </div>
            }
            @for (g of guidesFor(band.id); track $index) {
              <div class="ds__guide" [class.ds__guide--v]="g.orientation === 'v'" [style.left.mm]="g.orientation === 'v' ? g.at * zoom() : null" [style.top.mm]="g.orientation === 'h' ? g.at * zoom() : null"></div>
            }
            @for (g of gaps(); track $index) {
              @if (g.bandId === band.id) {
                <div
                  class="ds__gap"
                  [class.ds__gap--v]="g.orientation === 'v'"
                  [style.left.mm]="g.x * zoom()"
                  [style.top.mm]="g.y * zoom()"
                  [style.width.mm]="g.orientation === 'h' ? g.length * zoom() : null"
                  [style.height.mm]="g.orientation === 'v' ? g.length * zoom() : null"
                >
                  <span>{{ g.length.toFixed(1) }}</span>
                </div>
              }
            }
          </div>
          <div class="ds__band-resize" [hidden]="folded" (pointerdown)="onBandResizePointerDown($event, band)" [title]="strings().bandHeight"></div>
        </div>
      }
    </div>
    @if (formulaEdit(); as f) {
      <we-report-expression-editor [expression]="f.expression" [fields]="fields()" [strings]="strings()" (applied)="applyFormula($event)" (closed)="formulaEdit.set(null)" />
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 32px 136px 32px 24px;
      outline: none;
    }
    .ds__ruler {
      position: sticky;
      top: 0;
      z-index: 6;
      display: block;
      margin: -28px auto 8px;
      padding-top: 6px;
      box-sizing: content-box;
      background: var(--we-report-workspace-bg, #f2f2f7);
      font: 9px var(--we-report-font-family, system-ui, sans-serif);
      overflow: visible;
    }
    .ds__ruler text {
      fill: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
    }
    .ds__ruler-ticks {
      stroke: var(--we-report-muted-fg, rgba(60, 60, 67, 0.62));
      stroke-width: 1;
      shape-rendering: crispEdges;
    }
    .ds__ruler-margin {
      fill: var(--we-report-hover-bg, rgba(118, 118, 128, 0.12));
    }
    .ds__ruler-selection {
      fill: var(--we-report-selection-fill, rgba(0, 122, 255, 0.07));
      stroke: var(--we-report-selection, #007aff);
      stroke-width: 1;
    }
    .ds__page {
      box-sizing: border-box;
      margin: 0 auto;
      background: var(--we-report-page-bg, #fff);
      box-shadow: var(--we-report-page-shadow, 0 1px 3px rgba(0, 0, 0, 0.2));
      border-radius: 2px;
    }
    .ds__page {
      position: relative;
    }
    .ds__watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      font-weight: 700;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }
    .ds__band {
      position: relative;
    }
    .ds__band + .ds__band {
      border-top: 1px dashed var(--we-report-margin-guide, rgba(0, 122, 255, 0.18));
    }
    /* The section name hangs beside the page, so it never covers the design and the page keeps
       its real size. */
    .ds__band-label {
      position: absolute;
      top: 0;
      left: calc(100% + var(--ds-margin-right, 0mm) + 10px);
      z-index: 5;
      max-width: 116px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 0;
      border-radius: 999px;
      padding: 2px 9px;
      font: 500 11px var(--we-report-font-family, system-ui, sans-serif);
      background: var(--we-report-band-label-bg, rgba(118, 118, 128, 0.1));
      color: var(--we-report-band-label-fg, rgba(60, 60, 67, 0.7));
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .ds__band:hover .ds__band-label {
      color: var(--we-report-fg, #1d1d1f);
    }
    .ds__band--selected .ds__band-label {
      background: var(--we-report-accent, #007aff);
      color: var(--we-report-accent-fg, #fff);
    }
    .ds__band--selected .ds__band-body {
      box-shadow: inset 0 0 0 1.5px var(--we-report-selection, #007aff);
    }
    .ds__band-label:focus-visible {
      outline: none;
      box-shadow: var(--we-report-focus-ring, 0 0 0 3px rgba(0, 122, 255, 0.35));
    }
    /* A folded section: a thin hatched strip, its items hidden. */
    .ds__band--collapsed .ds__band-body {
      overflow: hidden;
      background: repeating-linear-gradient(-45deg, var(--we-report-band-label-bg, rgba(118, 118, 128, 0.1)) 0 4px, transparent 4px 8px) !important;
    }
    .ds__band--collapsed .ds__band-body > * {
      display: none;
    }
    .ds__band-body {
      position: relative;
      background-image: radial-gradient(circle, var(--we-report-margin-guide, rgba(0, 122, 255, 0.18)) 0.7px, transparent 0.7px);
    }
    /* Where the other columns of a multi-column detail print: not editable, just shown. */
    .ds__columns {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-left: 1px dashed var(--we-report-selection, #007aff);
      background: repeating-linear-gradient(-45deg, var(--we-report-selection-fill, rgba(0, 122, 255, 0.07)) 0 6px, transparent 6px 12px);
      color: var(--we-report-accent, #007aff);
      font: 500 11px var(--we-report-font-family, system-ui, sans-serif);
      pointer-events: none;
    }
    .ds__band-resize {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -3px;
      height: 6px;
      cursor: ns-resize;
      z-index: 2;
    }
    .ds__control {
      position: absolute;
      box-sizing: border-box;
      outline: 1px dashed var(--we-report-control-outline, rgba(60, 60, 67, 0.22));
      outline-offset: -1px;
      border-radius: 2px;
      cursor: default;
      touch-action: none;
      transition: outline-color 0.12s ease, background-color 0.12s ease;
    }
    .ds__control:hover {
      outline: 1px solid var(--we-report-selection, #007aff);
    }
    .ds__control--selected {
      outline: 1.5px solid var(--we-report-selection, #007aff);
      outline-offset: 0;
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.07));
      cursor: move;
      z-index: 1;
    }
    /* Typing on the page: the editor takes the item's box and look. */
    :host(.ds--painting) .ds__control {
      cursor: copy;
    }
    /* A text that will be cut off in print. */
    .ds__control--cut {
      box-shadow: inset 0 -2px 0 var(--we-report-warning-fg, #c93400);
    }
    .ds__editor {
      position: absolute;
      inset: 0;
      z-index: 6;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      margin: 0;
      border: 0;
      outline: 2px solid var(--we-report-selection, #007aff);
      resize: none;
      overflow: hidden;
      background: var(--we-report-page-bg, #fff);
      line-height: 1.36;
    }
    .ds__marquee {
      position: absolute;
      z-index: 7;
      border: 1px solid var(--we-report-selection, #007aff);
      background: var(--we-report-selection-fill, rgba(0, 122, 255, 0.07));
      pointer-events: none;
    }
    .ds__cell {
      position: absolute;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.36;
    }
    .ds__cell--on {
      outline: 2px solid var(--we-report-selection, #007aff);
      outline-offset: -2px;
      z-index: 1;
    }
    .ds__fill {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      pointer-events: none;
    }
    .ds__image {
      display: block;
    }
    .ds__placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--we-report-accent, #007aff);
      font: 10px var(--we-report-font-family, system-ui, sans-serif);
      opacity: 0.8;
      overflow: hidden;
      pointer-events: none;
    }
    .ds__text {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.36;
      pointer-events: none;
    }
    .ds__subpreview {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      --we-report-page-bg: transparent;
      --we-report-page-shadow: none;
    }
    .ds__subname {
      position: absolute;
      top: 1px;
      right: 2px;
      padding: 0 4px;
      border-radius: 4px;
      font-size: 10px;
      background: var(--we-report-band-label-bg, rgba(118, 118, 128, 0.1));
      color: var(--we-report-band-label-fg, rgba(60, 60, 67, 0.7));
    }
    .ds__text--bound {
      text-decoration: underline dotted var(--we-report-accent, #007aff);
      text-underline-offset: 2px;
    }
    /* Keynote-style handles: white dots with an accent ring and a soft shadow. */
    .ds__handle {
      position: absolute;
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
      box-sizing: border-box;
      background: var(--we-report-page-bg, #fff);
      border: 1.5px solid var(--we-report-selection, #007aff);
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      z-index: 3;
    }
    .ds__handle[data-handle='nw'] { left: 0; top: 0; cursor: nwse-resize; }
    .ds__handle[data-handle='n'] { left: 50%; top: 0; cursor: ns-resize; }
    .ds__handle[data-handle='ne'] { left: 100%; top: 0; cursor: nesw-resize; }
    .ds__handle[data-handle='e'] { left: 100%; top: 50%; cursor: ew-resize; }
    .ds__handle[data-handle='se'] { left: 100%; top: 100%; cursor: nwse-resize; }
    .ds__handle[data-handle='s'] { left: 50%; top: 100%; cursor: ns-resize; }
    .ds__handle[data-handle='sw'] { left: 0; top: 100%; cursor: nesw-resize; }
    .ds__handle[data-handle='w'] { left: 0; top: 50%; cursor: ew-resize; }
    .ds__gap {
      position: absolute;
      z-index: 4;
      height: 0;
      border-top: 1px dashed var(--we-report-guide, #ff375f);
      pointer-events: none;
    }
    .ds__gap--v {
      width: 0;
      border-top: 0;
      border-left: 1px dashed var(--we-report-guide, #ff375f);
    }
    .ds__gap span {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      padding: 0 4px;
      border-radius: 4px;
      background: var(--we-report-guide, #ff375f);
      color: var(--we-report-accent-fg, #fff);
      font: 600 10px var(--we-report-font-family, system-ui, sans-serif);
      white-space: nowrap;
    }
    .ds__guide {
      position: absolute;
      left: 0;
      right: 0;
      height: 0;
      border-top: 1px solid var(--we-report-guide, #ff375f);
      pointer-events: none;
      z-index: 4;
    }
    .ds__guide--v {
      top: 0;
      bottom: 0;
      right: auto;
      width: 0;
      height: auto;
      border-top: 0;
      border-left: 1px solid var(--we-report-guide, #ff375f);
    }
    @media (prefers-reduced-motion: reduce) {
      .ds__band-label,
      .ds__control {
        transition: none;
      }
    }
  `,
})
export class DesignSurfaceComponent implements OnDestroy {
  readonly strings = input.required<WeReportLocale>();
  readonly zoom = input(1);
  /** Snap grid in mm; 0 turns snapping off. */
  readonly gridSize = input(1);
  /** When set, bound text shows this data instead of its formula. */
  readonly sample = input<DesignSample | null>(null);
  /** Fields for the formula editor opened by double-clicking a bound item. */
  readonly fields = input<DesignerField[]>([]);

  protected readonly state = inject(DesignerState);
  private readonly config = inject(WE_REPORT_CONFIG);
  private readonly dom = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  protected readonly guides = signal<Guide[]>([]);
  protected readonly gaps = signal<Gap[]>([]);
  private readonly fontsService = inject(WeReportFontsService);
  /** Texts (without Grow to fit text) whose content does not fit, measured with the report's fonts like the print. */
  readonly cutTexts = signal<ReadonlySet<string>>(new Set());
  /** First page of every sub-report, laid out with the sample row, shown inside its box. */
  protected readonly subreportPages = signal<ReadonlyMap<string, LayoutPage>>(new Map());
  private previewRun = 0;
  private readonly previewSubreports = effect(() => {
    const report = this.state.report();
    this.sample();
    const subs = report.bands.flatMap((band) => band.controls.filter((c) => c.type === 'subreport').map((c) => ({ c, band })));
    const run = ++this.previewRun;
    if (!subs.length) {
      if (this.subreportPages().size) setTimeout(() => run === this.previewRun && this.subreportPages.set(new Map()));
      return;
    }
    void this.fontsService.ready().then((fonts) => {
      if (run !== this.previewRun) return;
      const pages = new Map<string, LayoutPage>();
      for (const { c, band } of subs) {
        const row = this.sampleFor(band)?.row;
        // The box alone on a page of its own width, with the sample row around it.
        const def: ReportDefinition = {
          ...createBlankReport(),
          page: { paper: 'custom', orientation: 'portrait', width: c.width, height: null, margins: { top: 0, right: 0, bottom: 0, left: 0 }, displayUnit: 'mm' },
          styles: report.styles,
          dataSources: report.dataSources,
          calculatedFields: report.calculatedFields,
          parameters: report.parameters,
          locale: report.locale,
          currency: report.currency,
          bands: [{ id: 'preview', kind: 'detail', height: c.height, controls: [{ ...c, x: 0, y: 0 }] }],
        };
        try {
          const doc = layoutReport(def, {
            fonts,
            data: row === undefined ? undefined : [row],
            now: new Date(),
            locale: this.config.locale,
            currency: this.config.currency,
          });
          if (doc.pages[0]) pages.set(c.id, doc.pages[0]);
        } catch {
          /* a sub-report that cannot be laid out shows its placeholder */
        }
      }
      this.subreportPages.set(pages);
    });
  });
  private measureRun = 0;
  private readonly measureTexts = effect(() => {
    const report = this.state.report();
    // shortcut: rich texts are not checked (their pieces measure in different fonts).
    const texts = report.bands.flatMap((b) => b.controls.filter((c) => c.type === 'text' && !c.canGrow && !c.markup).map((c) => ({ c, text: this.caption(c, b) })));
    const run = ++this.measureRun;
    void this.fontsService.ready().then((fonts) => {
      if (run !== this.measureRun) return;
      const cut = new Set<string>();
      for (const { c, text } of texts) {
        if (!text) continue;
        const style = resolveStyle(report, c.style, c.styleOverrides);
        const font = fonts.resolve(style.fontFamily, style.bold, style.italic);
        if (fitLines(text, font, style.fontSize, style.padding, c.width, c.height).cut) cut.add(c.id);
      }
      this.cutTexts.set(cut);
    });
  });
  /** The rubber band while dragging on an empty part of a section (mm in that section). */
  protected readonly marquee = signal<{ bandId: string; x: number; y: number; width: number; height: number } | null>(null);
  /** A bound item whose formula is open in the editor. */
  protected readonly formulaEdit = signal<{ controlId: string; row?: number; cell?: number; expression: string } | null>(null);
  /** A key typed on a selected text: editing starts with it instead of the old text. */
  private readonly editSeed = signal<string | null>(null);
  /** The text an in-place editor starts with. */
  protected readonly editText = computed(() => {
    const e = this.state.editing();
    if (!e) return '';
    const seed = this.editSeed();
    if (seed !== null) return seed;
    const c = this.state.selectedControls().find((x) => x.id === e.controlId) ?? this.state.report().bands.flatMap((b) => b.controls).find((x) => x.id === e.controlId);
    const value = c?.type === 'text' ? c.text : c?.type === 'table' && e.row !== undefined && e.cell !== undefined ? c.rows[e.row]?.cells[e.cell]?.text : '';
    return typeof value === 'string' ? value : '';
  });

  protected readonly geometry = computed(() => resolvePageGeometry(this.state.report().page));
  /** Top ruler in screen pixels: 0 at the left margin, a tick per millimetre, a label per centimetre. */
  protected readonly ruler = computed(() => {
    const page = this.state.report().page;
    const geometry = this.geometry();
    const px = PX_PER_MM * this.zoom();
    const left = page.margins.left * px;
    const step = this.zoom() < 0.6 ? 5 : 1;
    let ticks = '';
    const labels: { x: number; text: string }[] = [];
    for (let mm = -Math.floor(page.margins.left / step) * step; mm <= geometry.width - page.margins.left; mm += step) {
      const x = Math.round((left + mm * px) * 10) / 10;
      const h = mm % 10 === 0 ? 8 : mm % 5 === 0 ? 5 : 3;
      ticks += `M${x} 20v-${h}`;
      if (mm % 10 === 0 && mm >= 0) labels.push({ x, text: String(mm / 10) });
    }
    const selected = this.state.selectedControls();
    const selection = selected.length
      ? (() => {
          const x1 = Math.min(...selected.map((c) => c.x));
          const x2 = Math.max(...selected.map((c) => c.x + c.width));
          return { x: left + x1 * px, width: (x2 - x1) * px };
        })()
      : null;
    return { width: geometry.width * px, left, right: page.margins.right * px, ticks, labels, selection };
  });

  protected readonly padding = computed(() => {
    const { top, right, bottom, left } = this.state.report().page.margins;
    const z = this.zoom();
    return `${top * z}mm ${right * z}mm ${bottom * z}mm ${left * z}mm`;
  });

  private op: DragOp | null = null;
  private readonly onMove = (e: PointerEvent) => this.pointerMove(e);
  private readonly onUp = (e: PointerEvent) => this.pointerUp(e);
  private opCounter = 0;

  ngOnDestroy(): void {
    this.stopListening();
  }

  // ── Rendering helpers ───────────────────────────────────────────────────────

  protected bandLabel(band: Band): string {
    const name = this.strings().bandNames[band.kind];
    if (band.kind === 'subDetail' && band.rowsPath) return `${name}: ${band.rowsPath}`;
    return band.kind === 'groupHeader' && band.groupBy ? `${name}: ${band.groupBy.expression}` : name;
  }

  protected isSelected(id: string): boolean {
    const sel = this.state.selection();
    return sel.kind === 'controls' && sel.ids.includes(id);
  }

  protected isOnlySelected(id: string): boolean {
    const sel = this.state.selection();
    return sel.kind === 'controls' && sel.ids.length === 1 && sel.ids[0] === id;
  }

  protected isBandSelected(id: string): boolean {
    const sel = this.state.selection();
    return sel.kind === 'band' && sel.id === id;
  }

  protected guidesFor(bandId: string): Guide[] {
    return this.guides().filter((g) => g.bandId === bandId);
  }

  protected isBound(c: ReportControl): boolean {
    return c.type === 'text' && isExpression(c.text);
  }

  protected boundExpression(c: ReportControl): string {
    return c.type === 'text' && isExpression(c.text) ? c.text.expression : '';
  }

  protected caption(c: ReportControl, band?: Band): string {
    if (c.type === 'text') {
      if (!isExpression(c.text)) return c.text;
      const sample = this.sampleFor(band);
      if (!sample) return c.text.expression;
      try {
        const report = this.state.report();
        const options = { locale: report.locale || this.config.locale || 'en-US', currency: report.currency || this.config.currency || 'USD' };
        const value = evaluate(c.text.expression, { ...sample, ...options, now: new Date() });
        return typeof value === 'string' && !c.format ? value : formatValue(value, c.format, options);
      } catch {
        return c.text.expression;
      }
    }
    if (c.type === 'pageInfo') {
      const s = this.strings();
      return c.info === 'pageNumber' ? '1' : c.info === 'pageCount' ? '9' : c.info === 'pageNofM' ? (c.format || '{0} / {1}').replace('{0}', '1').replace('{1}', '9') : s.printDate;
    }
    return '';
  }

  /** A rich text's styled pieces; its `{formula}` fields show the sample data, else the formula. */
  protected richRuns(c: ReportControl, band?: Band): RichRun[] {
    const sample = this.sampleFor(band);
    const report = this.state.report();
    const options = { locale: report.locale || this.config.locale || 'en-US', currency: report.currency || this.config.currency || 'USD' };
    return parseRichText(this.caption(c, band), (expression) => {
      if (!sample) return `{${expression}}`;
      try {
        const v = evaluate(expression, { ...sample, ...options, now: new Date() });
        return v === null || v === undefined ? '' : typeof v === 'string' ? v : formatValue(v, undefined, options);
      } catch {
        return `{${expression}}`;
      }
    });
  }

  protected textStyle(c: ReportControl): Record<string, string> {
    return this.styleOf(c.style, c.styleOverrides);
  }

  /** Cells of a table control in mm relative to the control, with their text and look. */
  protected tableCells(c: ReportControl, band?: Band): { row: number; index: number; x: number; y: number; width: number; height: number; text: string; bound: boolean; style: Record<string, string> }[] {
    if (c.type !== 'table') return [];
    const out: ReturnType<typeof this.tableCells> = [];
    let y = 0;
    c.rows.forEach((row, r) => {
      let column = 0;
      let x = 0;
      row.cells.forEach((cell, i) => {
        const span = Math.max(1, Math.min(cell.colSpan ?? 1, c.columns.length - column));
        const width = c.columns.slice(column, column + span).reduce((a, b) => a + b, 0);
        if (column < c.columns.length) {
          out.push({
            row: r, index: i, x, y, width, height: row.height,
            text: this.bindableText(cell.text, cell.format, band),
            bound: isExpression(cell.text),
            style: this.styleOf(c.style, { ...c.styleOverrides, ...cell.styleOverrides }),
          });
        }
        x += width;
        column += span;
      });
      y += row.height;
    });
    return out;
  }

  /** Inside an inner list the sample is the first item of the first row that has items, around that row. */
  private sampleFor(band: Band | undefined): DesignSample | null {
    const sample = this.sample();
    if (!sample || !band?.kind.startsWith('sub')) return sample;
    const path = this.state.report().bands.find((b) => b.kind === 'subDetail')?.rowsPath;
    if (!path) return null;
    for (const row of sample.rows.length ? sample.rows : [sample.row]) {
      try {
        const items = evaluate(`[${path}]`, { row });
        if (Array.isArray(items) && items.length) return { row: items[0], rows: items, parent: row, calculated: sample.calculated };
      } catch {
        return null;
      }
    }
    return null;
  }

  protected isCellSelected(controlId: string, row: number, cell: number): boolean {
    const ref = this.state.tableCell();
    return !!ref && ref.controlId === controlId && ref.row === row && ref.cell === cell && this.isSelected(controlId);
  }

  protected selectCell(controlId: string, row: number, cell: number): void {
    this.state.tableCell.set({ controlId, row, cell });
  }

  /** Fixed text, or a formula shown with the first data row when there is one. */
  private bindableText(text: Bindable<string>, format: string | undefined, band?: Band): string {
    if (!isExpression(text)) return text;
    const sample = this.sampleFor(band);
    if (!sample) return text.expression;
    try {
      const report = this.state.report();
      const options = { locale: report.locale || this.config.locale || 'en-US', currency: report.currency || this.config.currency || 'USD' };
      const value = evaluate(text.expression, { ...sample, ...options, now: new Date() });
      return typeof value === 'string' && !format ? value : formatValue(value, format, options);
    } catch {
      return text.expression;
    }
  }

  private styleOf(name: string | undefined, overrides: ReportStyle | undefined): Record<string, string> {
    const s = resolveStyle(this.state.report(), name, overrides);
    const z = this.zoom();
    const style: Record<string, string> = {
      'font-family': `'${WeReportFontsService.cssFamily(s.fontFamily)}', sans-serif`,
      'font-size': `${s.fontSize * z}pt`,
      'font-weight': s.bold ? '700' : '400',
      'font-style': s.italic ? 'italic' : 'normal',
      color: s.color,
      'text-align': s.textAlign === 'justify' ? 'justify' : s.textAlign,
      'justify-content': s.verticalAlign === 'middle' ? 'center' : s.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start',
      padding: `${s.padding * z}mm`,
    };
    if (s.underline) style['text-decoration'] = 'underline';
    if (s.backgroundColor) style['background'] = s.backgroundColor;
    if (s.border && s.border.width > 0) {
      const b = `${s.border.width * z}mm solid ${s.border.color}`;
      if (s.border.sides.top) style['border-top'] = b;
      if (s.border.sides.right) style['border-right'] = b;
      if (s.border.sides.bottom) style['border-bottom'] = b;
      if (s.border.sides.left) style['border-left'] = b;
    }
    return style;
  }

  protected shapeStyle(c: ReportControl): Record<string, string> {
    if (c.type !== 'shape') return {};
    const s = resolveStyle(this.state.report(), c.style, c.styleOverrides);
    const z = this.zoom();
    return {
      border: `${(s.border?.width ?? 0.25) * z}mm solid ${s.border?.color ?? s.color}`,
      background: s.backgroundColor ?? 'transparent',
      'border-radius': c.shape === 'ellipse' ? '50%' : c.shape === 'roundedRectangle' ? `${(c.cornerRadius ?? 2) * z}mm` : '0',
    };
  }

  protected lineCoords(c: ReportControl): [number, number, number, number] {
    if (c.type !== 'line') return [0, 0, 0, 0];
    const { width: w, height: h } = c;
    return c.direction === 'horizontal' ? [0, h / 2, w, h / 2] : c.direction === 'vertical' ? [w / 2, 0, w / 2, h] : c.direction === 'diagonalDown' ? [0, 0, w, h] : [0, h, w, 0];
  }

  protected lineColor(c: ReportControl): string {
    return c.type === 'line' ? (c.color ?? resolveStyle(this.state.report(), c.style, c.styleOverrides).color) : '';
  }

  protected lineWidth(c: ReportControl): number {
    return c.type === 'line' ? c.lineWidth : 0;
  }

  protected staticImage(c: ReportControl): string | null {
    // Only embedded pictures: an address is fetched by the viewer (through the host's fetch), never by the design page.
    return c.type === 'image' && typeof c.source === 'string' && c.source.startsWith('data:image/') ? c.source : null;
  }

  protected objectFit(c: ReportControl): string {
    if (c.type !== 'image') return 'contain';
    return c.fit === 'stretch' ? 'fill' : c.fit;
  }

  protected isQr(c: ReportControl): boolean {
    return c.type === 'barcode' && /qr/i.test(c.symbology);
  }

  protected barcodeLabel(c: ReportControl): string {
    if (c.type !== 'barcode') return '';
    return `${c.symbology}: ${isExpression(c.value) ? c.value.expression : c.value}`;
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  protected selectBand(id: string): void {
    this.state.selection.set({ kind: 'band', id });
  }

  /** On an empty part of a section: starts a rubber-band selection (Shift/Ctrl add to the selection). */
  protected onBodyPointerDown(e: PointerEvent, band: Band): void {
    if (e.button !== 0) return;
    this.host.nativeElement.focus({ preventScroll: true });
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const sel = this.state.selection();
    const base = additive && sel.kind === 'controls' ? sel.ids : [];
    if (!additive) this.state.selection.set({ kind: 'none' });
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.begin(e, { kind: 'marquee', bandId: band.id, originals: new Map(), baseIds: base, origin: { left: rect.left, top: rect.top } });
  }

  // ── Editing on the page ─────────────────────────────────────────────────────

  protected isEditing(controlId: string, row?: number, cell?: number): boolean {
    const e = this.state.editing();
    return !!e && e.controlId === controlId && e.row === row && e.cell === cell;
  }

  /** Double-click / F2: fixed text is typed on the page, a formula opens the formula editor. */
  startEditing(c: ReportControl, row?: number, cell?: number, seed?: string): void {
    if (c.type === 'subreport') {
      this.state.subreportOpen.set(c.id);
      return;
    }
    let value: Bindable<string> | undefined;
    if (c.type === 'text') value = c.text;
    else if (c.type === 'table') {
      const at = row ?? this.state.tableCell()?.row;
      const index = cell ?? this.state.tableCell()?.cell;
      if (at === undefined || index === undefined) return;
      row = at;
      cell = index;
      value = c.rows[row]?.cells[cell]?.text;
    }
    if (value === undefined) return;
    this.state.selection.set({ kind: 'controls', ids: [c.id] });
    if (isExpression(value)) {
      this.formulaEdit.set({ controlId: c.id, row, cell, expression: value.expression });
      return;
    }
    this.editSeed.set(seed ?? null);
    this.state.editing.set({ controlId: c.id, row, cell });
    // The editor exists after this change is rendered.
    setTimeout(() => {
      const editor = this.host.nativeElement.querySelector<HTMLTextAreaElement>('.ds__editor');
      editor?.focus({ preventScroll: true });
      if (seed === undefined) editor?.select();
      else editor?.setSelectionRange(editor.value.length, editor.value.length);
    });
  }

  /** Enter or Escape pressed before the editor had focus: keep or drop what was typed. */
  finishEditing(keep: boolean): void {
    const editing = this.state.editing();
    if (!editing) return;
    const editor = this.host.nativeElement.querySelector<HTMLTextAreaElement>('.ds__editor');
    const text = editor?.value ?? this.editSeed() ?? '';
    this.state.editing.set(null);
    if (keep) this.setText(editing.controlId, editing.row, editing.cell, text);
    this.host.nativeElement.focus({ preventScroll: true });
  }

  /** Keys typed before the editor has focus (fast typists) are not lost. */
  appendToEdit(key: string): void {
    if (this.editSeed() !== null) this.editSeed.update((s) => s + key);
  }

  /** Enter keeps the text, Shift+Enter starts a new line, Escape leaves it as it was. */
  protected onEditorKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      // Save shortcuts of the host app keep working: keep the typed text first, then let it through.
      (e.target as HTMLTextAreaElement).blur();
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.state.editing.set(null);
      this.host.nativeElement.focus({ preventScroll: true });
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    }
  }

  protected commitEditing(e: FocusEvent): void {
    const editing = this.state.editing();
    if (!editing) return;
    const text = (e.target as HTMLTextAreaElement).value;
    this.state.editing.set(null);
    this.setText(editing.controlId, editing.row, editing.cell, text);
    this.host.nativeElement.focus({ preventScroll: true });
  }

  protected applyFormula(expression: string): void {
    const f = this.formulaEdit();
    this.formulaEdit.set(null);
    if (f) this.setText(f.controlId, f.row, f.cell, { expression });
  }

  private setText(controlId: string, row: number | undefined, cell: number | undefined, text: Bindable<string>): void {
    const c = this.state.report().bands.flatMap((b) => b.controls).find((x) => x.id === controlId);
    const current = c?.type === 'text' ? c.text : c?.type === 'table' && row !== undefined && cell !== undefined ? c.rows[row]?.cells[cell]?.text : undefined;
    // Leaving the editor without a change adds no undo step.
    if (JSON.stringify(current) === JSON.stringify(text)) return;
    this.state.updateControls([controlId], (c) => {
      if (c.type === 'text') c.text = text;
      else if (c.type === 'table' && row !== undefined && cell !== undefined && c.rows[row]?.cells[cell]) c.rows[row].cells[cell].text = text;
    });
  }

  /** Pointer position in mm inside the section under it, for the status bar. */
  protected trackPointer(e: PointerEvent): void {
    const body = (e.target as HTMLElement).closest<HTMLElement>('[data-band-id]');
    if (!body) return this.state.pointer.set(null);
    const r = body.getBoundingClientRect();
    const scale = PX_PER_MM * this.zoom();
    this.state.pointer.set({ bandId: body.dataset['bandId']!, x: round((e.clientX - r.left) / scale), y: round((e.clientY - r.top) / scale) });
  }

  // ── Drag: move / resize / band height ───────────────────────────────────────

  protected onControlPointerDown(e: PointerEvent, c: ReportControl, band: Band): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const look = this.state.painter();
    if (look) {
      this.state.painter.set(null);
      this.state.updateControls([c.id], (x) => {
        x.style = look.style;
        x.styleOverrides = structuredClone(look.styleOverrides);
      });
      this.state.selection.set({ kind: 'controls', ids: [c.id] });
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const sel = this.state.selection();
    const toggleOnClick = (e.ctrlKey || e.metaKey) && sel.kind === 'controls' && sel.ids.includes(c.id);
    if (!toggleOnClick) this.state.select(c.id, additive);
    const ids = this.state.selection().kind === 'controls' ? (this.state.selection() as { ids: string[] }).ids : [];
    if (!ids.includes(c.id)) return;
    this.begin(e, { kind: 'move', bandId: band.id, primaryId: c.id, originals: this.rectsOf(ids), additive, toggleOnClick });
  }

  protected onHandlePointerDown(e: PointerEvent, c: ReportControl, band: Band, handle: Handle): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.begin(e, { kind: 'resize', bandId: band.id, primaryId: c.id, handle, originals: this.rectsOf([c.id]) });
  }

  protected onBandResizePointerDown(e: PointerEvent, band: Band): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.state.selection.set({ kind: 'band', id: band.id });
    this.begin(e, { kind: 'band', bandId: band.id, bandHeight: band.height, originals: new Map() });
  }

  private begin(e: PointerEvent, op: Omit<DragOp, 'startX' | 'startY' | 'key' | 'moved'>): void {
    this.host.nativeElement.focus({ preventScroll: true });
    this.op = { ...op, startX: e.clientX, startY: e.clientY, key: `drag${++this.opCounter}`, moved: false };
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerup', this.onUp);
    this.dom.addEventListener('pointercancel', this.onUp);
  }

  private stopListening(): void {
    this.dom.removeEventListener('pointermove', this.onMove);
    this.dom.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('pointercancel', this.onUp);
  }

  private rectsOf(ids: string[]): Map<string, Rect> {
    const map = new Map<string, Rect>();
    for (const b of this.state.report().bands) {
      for (const c of b.controls) if (ids.includes(c.id)) map.set(c.id, { x: c.x, y: c.y, width: c.width, height: c.height });
    }
    return map;
  }

  private pointerMove(e: PointerEvent): void {
    const op = this.op;
    if (!op) return;
    const scale = PX_PER_MM * this.zoom();
    const dx = (e.clientX - op.startX) / scale;
    const dy = (e.clientY - op.startY) / scale;
    if (!op.moved && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;
    op.moved = true;
    const snap = !e.altKey;

    if (op.kind === 'marquee') {
      const o = op.origin!;
      const x1 = (op.startX - o.left) / scale;
      const y1 = (op.startY - o.top) / scale;
      const x2 = (e.clientX - o.left) / scale;
      const y2 = (e.clientY - o.top) / scale;
      const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      this.marquee.set({ bandId: op.bandId, ...box });
      // Everything the band touches is selected, as in desktop designers.
      const band = this.state.report().bands.find((b) => b.id === op.bandId);
      const hit = (band?.controls ?? [])
        .filter((c) => c.x < box.x + box.width && c.x + c.width > box.x && c.y < box.y + box.height && c.y + c.height > box.y)
        .map((c) => c.id);
      const ids = [...new Set([...(op.baseIds ?? []), ...hit])];
      this.state.selection.set(ids.length ? { kind: 'controls', ids } : op.baseIds?.length ? { kind: 'controls', ids: op.baseIds } : { kind: 'none' });
      return;
    }

    if (op.kind === 'band') {
      const band = this.state.report().bands.find((b) => b.id === op.bandId);
      const minHeight = Math.max(2, ...(band?.controls.map((c) => c.y + c.height) ?? [0]));
      const height = Math.max(minHeight, this.snapToGrid(op.bandHeight! + dy, snap));
      this.state.updateBand(op.bandId, (b) => (b.height = round(height)), op.key);
      return;
    }

    const primary = op.originals.get(op.primaryId!)!;
    const others = this.otherRects(op.bandId, [...op.originals.keys()]);
    const guides: Guide[] = [];

    if (op.kind === 'move') {
      const proposed = { ...primary, x: primary.x + dx, y: primary.y + dy };
      const sx = this.snapAxis([proposed.x, proposed.x + proposed.width / 2, proposed.x + proposed.width], others, 'v', snap);
      const sy = this.snapAxis([proposed.y, proposed.y + proposed.height / 2, proposed.y + proposed.height], others, 'h', snap);
      const ox = sx ? sx.delta : this.snapToGrid(proposed.x, snap) - proposed.x;
      const oy = sy ? sy.delta : this.snapToGrid(proposed.y, snap) - proposed.y;
      if (sx) guides.push({ bandId: op.bandId, orientation: 'v', at: sx.at });
      if (sy) guides.push({ bandId: op.bandId, orientation: 'h', at: sy.at });
      const mx = dx + ox;
      const my = dy + oy;
      this.state.updateControls([...op.originals.keys()], (c) => {
        const o = op.originals.get(c.id)!;
        c.x = round(Math.max(0, o.x + mx));
        c.y = round(Math.max(0, o.y + my));
      }, op.key);
      const moved = { ...primary, x: Math.max(0, primary.x + mx), y: Math.max(0, primary.y + my) };
      this.gaps.set(op.originals.size === 1 ? gapsAround(moved, others, op.bandId) : []);
    } else {
      const h = op.handle!;
      let { x, y, width, height } = primary;
      let right = x + width;
      let bottom = y + height;
      if (h.includes('w')) x = this.snapEdge(x + dx, others, 'v', snap, op.bandId, guides);
      if (h.includes('e')) right = this.snapEdge(right + dx, others, 'v', snap, op.bandId, guides);
      if (h.includes('n')) y = this.snapEdge(y + dy, others, 'h', snap, op.bandId, guides);
      if (h.includes('s')) bottom = this.snapEdge(bottom + dy, others, 'h', snap, op.bandId, guides);
      x = Math.max(0, Math.min(x, right - MIN_SIZE_MM));
      y = Math.max(0, Math.min(y, bottom - MIN_SIZE_MM));
      width = Math.max(MIN_SIZE_MM, right - x);
      height = Math.max(MIN_SIZE_MM, bottom - y);
      this.state.updateControls([op.primaryId!], (c) => {
        c.x = round(x);
        c.y = round(y);
        c.width = round(width);
        c.height = round(height);
      }, op.key);
    }
    this.guides.set(guides);
  }

  private pointerUp(e: PointerEvent): void {
    const op = this.op;
    this.op = null;
    this.stopListening();
    this.guides.set([]);
    this.gaps.set([]);
    if (op?.kind === 'marquee') {
      // A plain click on an empty part selects the section.
      if (!op.moved && !op.baseIds?.length) this.state.selection.set({ kind: 'band', id: op.bandId });
      this.marquee.set(null);
      return;
    }
    if (op?.kind === 'move' && !op.moved && op.toggleOnClick) {
      this.state.select(op.primaryId!, true);
      return;
    }
    // Ctrl+drag copies: the originals stay where they were, the dragged items are the copies.
    if (op?.kind === 'move' && op.moved && (e.ctrlKey || e.metaKey)) {
      this.state.update((d) => {
        const taken = new Set<string>();
        // The selection can span sections: each section keeps copies of its own items.
        for (const band of d.bands) {
          const copies = band.controls
            .filter((c) => op.originals.has(c.id))
            .map((c) => ({ ...structuredClone(c), id: this.state.newId(c.type, taken), ...op.originals.get(c.id)! }));
          band.controls.unshift(...copies);
        }
      }, op.key);
    }
    // A click (no drag) inside a multi-selection narrows it to the clicked control.
    if (op?.kind === 'move' && !op.moved && !op.additive && op.originals.size > 1) {
      this.state.selection.set({ kind: 'controls', ids: [op.primaryId!] });
      return;
    }
    if (!op || !op.moved || op.kind !== 'move') return;
    // Dropped over another band: move the controls there, keeping their position under the pointer.
    const target = this.bandBodyAt(e.clientX, e.clientY);
    if (!target || target.id === op.bandId) return;
    const scale = PX_PER_MM * this.zoom();
    const ids = [...op.originals.keys()];
    const primary = op.originals.get(op.primaryId!)!;
    const pointerYInTarget = (e.clientY - target.rect.top) / scale;
    const grabOffset = (op.startY - this.bandBodyRect(op.bandId)!.top) / scale - primary.y;
    const newPrimaryY = Math.max(0, pointerYInTarget - grabOffset);
    this.state.update((d) => {
      const from = d.bands.find((b) => b.id === op.bandId)!;
      const to = d.bands.find((b) => b.id === target.id)!;
      const moving = from.controls.filter((c) => ids.includes(c.id));
      from.controls = from.controls.filter((c) => !ids.includes(c.id));
      for (const c of moving) {
        c.y = round(Math.max(0, newPrimaryY + (op.originals.get(c.id)!.y - primary.y)));
        to.height = Math.max(to.height, round(c.y + c.height));
        to.controls.push(c);
      }
    }, op.key);
  }

  private bandBodyAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    for (const el of this.dom.elementsFromPoint(x, y)) {
      const body = (el as HTMLElement).closest?.('[data-band-id]') as HTMLElement | null;
      if (body) return { id: body.dataset['bandId']!, rect: body.getBoundingClientRect() };
    }
    return null;
  }

  private bandBodyRect(id: string): DOMRect | null {
    const el = this.dom.querySelector(`[data-band-id="${CSS.escape(id)}"]`);
    return el ? el.getBoundingClientRect() : null;
  }

  private otherRects(bandId: string, exclude: string[]): Rect[] {
    const band = this.state.report().bands.find((b) => b.id === bandId);
    const rects = band?.controls.filter((c) => !exclude.includes(c.id)) ?? [];
    // The band's own edges (page content box) are snap targets too.
    return [...rects, { x: 0, y: 0, width: this.geometry().contentWidth, height: band?.height ?? 0 }];
  }

  /** Finds the closest edge/centre alignment among `others` for any of `candidates`. */
  private snapAxis(candidates: number[], others: Rect[], axis: 'v' | 'h', enabled: boolean): { delta: number; at: number } | null {
    if (!enabled) return null;
    let best: { delta: number; at: number } | null = null;
    for (const r of others) {
      const lines = axis === 'v' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];
      for (const line of lines) {
        for (const c of candidates) {
          const delta = line - c;
          if (Math.abs(delta) <= SNAP_DISTANCE_MM && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: line };
        }
      }
    }
    return best;
  }

  private snapEdge(value: number, others: Rect[], axis: 'v' | 'h', enabled: boolean, bandId: string, guides: Guide[]): number {
    const s = this.snapAxis([value], others, axis, enabled);
    if (s) {
      guides.push({ bandId, orientation: axis, at: s.at });
      return value + s.delta;
    }
    return this.snapToGrid(value, enabled);
  }

  private snapToGrid(value: number, enabled: boolean): number {
    const g = this.gridSize();
    return enabled && g > 0 ? Math.round(value / g) * g : value;
  }

  // ── Drop from toolbox / field list ──────────────────────────────────────────

  protected onDragOver(e: DragEvent): void {
    if (e.dataTransfer?.types.includes(DRAG_MIME) || e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onDrop(e: DragEvent, band: Band): void {
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    const file = e.dataTransfer?.files?.[0];
    if (!raw && file && /^image\/(png|jpeg)$/.test(file.type)) {
      // A picture dragged in from the desktop becomes an image item where it is dropped.
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const scale = PX_PER_MM * this.zoom();
      void this.readFile(file).then((src) => this.addImage(band, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale, src));
      return;
    }
    if (!raw) return;
    e.preventDefault();
    let data: DesignerDragData;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scale = PX_PER_MM * this.zoom();
    const x = this.snapToGrid((e.clientX - rect.left) / scale, true);
    const y = this.snapToGrid((e.clientY - rect.top) / scale, true);
    this.dropAt(data, band, x, y);
  }

  protected readonly defaultWatermarkColor = DEFAULT_WATERMARK_COLOR;

  /** For a multi-column detail: where the first column ends (mm) and how many columns print. */
  protected columnShade(band: Band): { left: number; count: number } | null {
    const count = band.kind === 'detail' ? Math.floor(band.columns?.count ?? 1) : 1;
    if (count < 2) return null;
    const gap = band.columns?.gap ?? 0;
    return { left: (this.geometry().contentWidth - gap * (count - 1)) / count, count };
  }

  /** Fixed watermark text, or its formula, shown faintly on the design page. */
  protected watermarkText(): string {
    const text = this.state.report().watermark?.text;
    return text === undefined ? '' : isExpression(text) ? text.expression : text;
  }

  protected crosstabLabel(c: ReportControl): string {
    if (c.type !== 'crosstab') return '';
    const parts = [c.rows, c.columns].map((e) => e.expression.trim()).filter(Boolean);
    return parts.length === 2 ? `${parts[0]} × ${parts[1]}` : this.strings().controlNames.crosstab;
  }

  protected chartLabel(c: ReportControl): string {
    if (c.type !== 'chart') return '';
    const s = this.strings();
    const type = { column: s.chartColumn, bar: s.chartBar, line: s.chartLine, pie: s.chartPie, doughnut: s.chartDoughnut, sparkline: s.chartSparkline }[c.chartType];
    return c.category.expression ? `${type}: ${c.value.expression} / ${c.category.expression}` : type;
  }

  private readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /** A picture at (x, y) mm, at its natural size up to 80 mm wide (PNG/JPEG data URI). */
  addImage(band: Band, x: number, y: number, src: string): void {
    const info = readImage(src);
    if (!info) return;
    const pxToMm = 25.4 / 96;
    const scale = Math.min(1, 80 / (info.width * pxToMm));
    const width = round(Math.max(5, info.width * pxToMm * scale));
    const height = round(Math.max(5, info.height * pxToMm * scale));
    const pageWidth = this.geometry().contentWidth;
    const control: ReportControl = {
      id: this.state.newId('image'), type: 'image', fit: 'contain', source: src, width, height,
      x: round(Math.max(0, Math.min(x, pageWidth - width))), y: round(Math.max(0, y)),
    };
    this.growBand(band, [control]);
  }

  /** Text pasted from elsewhere becomes a text item, tall enough for its lines. */
  addText(band: Band, x: number, y: number, text: string): void {
    const lines = text.split(/\r?\n/).length;
    const control: ReportControl = {
      id: this.state.newId('text'), type: 'text', text, x: round(Math.max(0, x)), y: round(Math.max(0, y)),
      width: Math.min(120, this.geometry().contentWidth), height: round(Math.min(60, 5 * lines + 1)), canGrow: lines > 1 || undefined,
    };
    this.growBand(band, [control]);
  }

  /** Creates controls for a drop at (x, y) mm inside `band`. */
  dropAt(data: DesignerDragData, band: Band, x: number, y: number): void {
    const width = this.geometry().contentWidth;
    if (data.kind === 'control') {
      const s = this.strings();
      const control = createControl(data.type, this.state.newId(data.type), x, y, data.type === 'table' ? s.columnN : data.type === 'subreport' ? s.controlNames.subreport : s.newText, data.variant);
      if (control.type === 'crosstab') {
        // Start bound to the data: the first two text fields across, the first number field summed.
        const row = this.sample()?.row;
        const entries = row && typeof row === 'object' ? Object.entries(row as Record<string, unknown>) : [];
        const texts = entries.filter(([, v]) => typeof v === 'string').map(([k]) => k);
        const number = entries.find(([, v]) => typeof v === 'number')?.[0];
        if (texts.length >= 2 && number) {
          control.rows = { expression: `[${texts[0]}]` };
          control.columns = { expression: `[${texts[1]}]` };
          control.value = { expression: `[${number}]` };
        }
      }
      if (control.type === 'chart') {
        // Start bound to the data: the first text field per the first number field.
        const row = this.sample()?.row;
        const entries = row && typeof row === 'object' ? Object.entries(row as Record<string, unknown>) : [];
        const text = entries.find(([, v]) => typeof v === 'string')?.[0];
        const number = entries.find(([, v]) => typeof v === 'number')?.[0];
        if (text && number) {
          control.category = { expression: `[${text}]` };
          control.value = { expression: `[${number}]` };
        }
      }
      control.x = round(Math.max(0, Math.min(x, width - control.width)));
      control.y = round(Math.max(0, y));
      this.growBand(band, [control]);
      return;
    }
    // A field dropped on a text shows that field there instead (desktop designers bind on drop).
    const text = band.controls.find((c) => c.type === 'text' && x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
    if (text) {
      this.state.updateControls([text.id], (c) => {
        if (c.type !== 'text') return;
        c.text = { expression: fieldExpression(data.path, data.parent) };
        c.format = data.format;
      });
      this.state.selection.set({ kind: 'controls', ids: [text.id] });
      return;
    }
    // A field dropped on a table cell fills that cell.
    const table = band.controls.find((c) => c.type === 'table' && x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
    if (table?.type === 'table') {
      const hit = this.tableCells(table, band).find((c) => x >= table.x + c.x && x < table.x + c.x + c.width && y >= table.y + c.y && y < table.y + c.y + c.height);
      if (hit) {
        this.state.updateControls([table.id], (c) => {
          if (c.type !== 'table') return;
          const cell = c.rows[hit.row].cells[hit.index];
          cell.text = { expression: fieldExpression(data.path, data.parent) };
          cell.format = data.format;
        });
        this.state.selection.set({ kind: 'controls', ids: [table.id] });
        this.state.tableCell.set({ controlId: table.id, row: hit.row, cell: hit.index });
        return;
      }
    }
    const value: ReportControl = {
      id: this.state.newId('text'),
      type: 'text',
      x: 0,
      y: round(Math.max(0, y)),
      width: 40,
      height: 6,
      text: { expression: fieldExpression(data.path, data.parent) },
      format: data.format,
    };
    const name = data.path.split('.').pop()!;
    if (band.kind === 'detail') {
      // Rows repeat, so only the value goes here.
      value.x = round(Math.max(0, Math.min(x, width - value.width)));
      this.growBand(band, [value]);
    } else {
      // Elsewhere a caption + value pair reads better: "Invoice no  WR-42".
      const label: ReportControl = { id: this.state.newId('label'), type: 'text', x: 0, y: value.y, width: 30, height: 6, text: captionFor(name), styleOverrides: { bold: true } };
      label.x = round(Math.max(0, Math.min(x, width - label.width - value.width)));
      value.x = round(label.x + label.width);
      this.growBand(band, [label, value]);
    }
  }

  private growBand(band: Band, controls: ReportControl[]): void {
    const bottom = Math.max(...controls.map((c) => c.y + c.height));
    this.state.update((d) => {
      const b = d.bands.find((x) => x.id === band.id)!;
      b.controls.push(...controls);
      if (bottom > b.height) b.height = round(bottom);
    });
    this.state.selection.set({ kind: 'controls', ids: controls.map((c) => c.id) });
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
