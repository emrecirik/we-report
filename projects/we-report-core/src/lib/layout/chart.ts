import { DEFAULT_CHART_GRID_COLOR, DEFAULT_CHART_PALETTE } from '../definition/blank-report';
import { ChartAggregate, ChartControl } from '../definition/report-definition';
import { LayoutItem } from './layout-types';
import { ResolvedStyle } from './style';

export interface ChartPoint {
  label: string;
  value: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the chart needs from the layout engine: text drawn and measured with the report's fonts. */
export interface ChartEnv {
  text(text: string, style: ResolvedStyle, box: Box): LayoutItem[];
  lineHeight(style: ResolvedStyle): number;
  textWidth(text: string, style: ResolvedStyle): number;
  format(value: number): string;
}

const PAD = 1.5;

export function aggregate(kind: ChartAggregate, values: number[]): number {
  if (kind === 'count') return values.length;
  if (!values.length) return 0;
  if (kind === 'min') return Math.min(...values);
  if (kind === 'max') return Math.max(...values);
  const sum = values.reduce((a, b) => a + b, 0);
  return kind === 'avg' ? sum / values.length : sum;
}

/** A round axis: 0 included, about five steps of 1, 2 or 5 × 10ⁿ. */
export function niceScale(min: number, max: number): { min: number; max: number; step: number } {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const range = hi - lo || 1;
  const raw = range / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step || step, step };
}

/** Lays out a chart inside the control's box. Pure: the same points always give the same items. */
export function chartItems(c: ChartControl, points: ChartPoint[], style: ResolvedStyle, env: ChartEnv): LayoutItem[] {
  const palette = c.colors?.length ? c.colors : DEFAULT_CHART_PALETTE;
  const items: LayoutItem[] = [];
  // Labels are plain text: the control's background and border belong to the whole chart.
  style = { ...style, backgroundColor: undefined, border: undefined };
  let area: Box = { x: c.x + PAD, y: c.y + PAD, width: c.width - 2 * PAD, height: c.height - 2 * PAD };
  if (c.title) {
    const titleStyle = { ...style, bold: true, textAlign: 'center' as const, padding: 0 };
    const h = env.lineHeight(titleStyle);
    items.push(...env.text(c.title, titleStyle, { ...area, height: h }));
    area = { ...area, y: area.y + h + 1, height: area.height - h - 1 };
  }
  if (!points.length || area.width <= 0 || area.height <= 0) return items;
  const small: ResolvedStyle = { ...style, fontSize: Math.max(5, style.fontSize * 0.8), bold: false, italic: false, underline: false, padding: 0 };
  if (c.chartType === 'pie' || c.chartType === 'doughnut') items.push(...pie(c, points, area, small, palette, env));
  else items.push(...axes(c, points, area, small, palette, env));
  return items;
}

function pie(c: ChartControl, points: ChartPoint[], area: Box, small: ResolvedStyle, palette: string[], env: ChartEnv): LayoutItem[] {
  const items: LayoutItem[] = [];
  const positive = points.map((p) => Math.max(0, p.value));
  const total = positive.reduce((a, b) => a + b, 0);
  const lh = env.lineHeight(small);
  let pieBox = area;
  if (c.showLegend !== false) {
    const labels = points.map((p, i) => {
      const share = total ? ` (${Math.round((positive[i] / total) * 100)}%)` : '';
      return c.showValues ? `${p.label}: ${env.format(p.value)}${share}` : p.label;
    });
    const legendWidth = Math.min(area.width * 0.45, Math.max(...labels.map((l) => env.textWidth(l, small))) + lh + 2);
    const rows = Math.min(labels.length, Math.max(1, Math.floor(area.height / lh)));
    // What does not fit is summed up in the last row.
    if (rows < labels.length) labels[rows - 1] = `+${labels.length - rows + 1}`;
    let y = area.y + (area.height - rows * lh) / 2;
    const x = area.x + area.width - legendWidth;
    for (let i = 0; i < rows; i++) {
      const swatch = lh * 0.6;
      items.push({ kind: 'rect', x, y: y + (lh - swatch) / 2, width: swatch, height: swatch, fill: palette[i % palette.length], radius: swatch / 4 });
      items.push(...env.text(labels[i], small, { x: x + lh, y, width: legendWidth - lh, height: lh }));
      y += lh;
    }
    pieBox = { ...area, width: area.width - legendWidth - 2 };
  }
  if (!total) return items;
  const r = Math.max(0, Math.min(pieBox.width, pieBox.height) / 2);
  const cx = r;
  const cy = r;
  const inner = c.chartType === 'doughnut' ? r * 0.55 : 0;
  const box = { x: pieBox.x + (pieBox.width - 2 * r) / 2, y: pieBox.y + (pieBox.height - 2 * r) / 2, width: 2 * r, height: 2 * r };
  const at = (radius: number, angle: number) => `${round(cx + radius * Math.sin(angle))} ${round(cy - radius * Math.cos(angle))}`;
  const paths: { d: string; fill?: string }[] = [];
  let start = 0;
  positive.forEach((v, i) => {
    if (!v) return;
    const end = start + (v / total) * Math.PI * 2;
    // Arcs as short segments: every renderer draws straight lines identically.
    const steps = Math.max(2, Math.ceil(((end - start) * 180) / Math.PI / 2));
    let d = inner ? `M${at(inner, start)}` : `M${cx} ${cy}`;
    for (let s = 0; s <= steps; s++) d += `L${at(r, start + ((end - start) * s) / steps)}`;
    if (inner) for (let s = steps; s >= 0; s--) d += `L${at(inner, start + ((end - start) * s) / steps)}`;
    paths.push({ d: `${d}Z`, fill: palette[i % palette.length] });
    start = end;
  });
  items.push({ kind: 'path', ...box, viewBox: { width: 2 * r, height: 2 * r }, paths });
  return items;
}

function axes(c: ChartControl, points: ChartPoint[], area: Box, small: ResolvedStyle, palette: string[], env: ChartEnv): LayoutItem[] {
  const items: LayoutItem[] = [];
  const horizontal = c.chartType === 'bar';
  const scale = niceScale(Math.min(...points.map((p) => p.value)), Math.max(...points.map((p) => p.value)));
  const ticks: number[] = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) ticks.push(round(v));
  const lh = env.lineHeight(small);
  const tickLabels = ticks.map((t) => env.format(t));
  const right: ResolvedStyle = { ...small, textAlign: 'right' };
  const center: ResolvedStyle = { ...small, textAlign: 'center' };

  // Value axis along the bottom for bars, along the left otherwise.
  const leftWidth = horizontal
    ? Math.min(area.width * 0.35, Math.max(...points.map((p) => env.textWidth(p.label, small))) + 1)
    : Math.max(...tickLabels.map((l) => env.textWidth(l, small))) + 1;
  const plot: Box = { x: area.x + leftWidth, y: area.y + (c.showValues && !horizontal ? lh : 0), width: area.width - leftWidth, height: area.height - lh - 1 - (c.showValues && !horizontal ? lh : 0) };
  if (plot.width <= 0 || plot.height <= 0) return items;
  const toPos = (v: number) =>
    horizontal ? plot.x + ((v - scale.min) / (scale.max - scale.min)) * plot.width : plot.y + plot.height - ((v - scale.min) / (scale.max - scale.min)) * plot.height;

  ticks.forEach((t, i) => {
    const p = toPos(t);
    if (horizontal) {
      items.push({ kind: 'line', x1: p, y1: plot.y, x2: p, y2: plot.y + plot.height, color: DEFAULT_CHART_GRID_COLOR, width: 0.1 });
      items.push(...env.text(tickLabels[i], center, { x: p - 10, y: plot.y + plot.height + 1, width: 20, height: lh }));
    } else {
      items.push({ kind: 'line', x1: plot.x, y1: p, x2: plot.x + plot.width, y2: p, color: DEFAULT_CHART_GRID_COLOR, width: 0.1 });
      items.push(...env.text(tickLabels[i], right, { x: area.x, y: p - lh / 2, width: leftWidth - 1, height: lh }));
    }
  });

  const slot = (horizontal ? plot.height : plot.width) / points.length;
  const zero = toPos(0);
  const color = palette[0];
  const linePoints: string[] = [];
  const markers: LayoutItem[] = [];
  points.forEach((p, i) => {
    const mid = (horizontal ? plot.y : plot.x) + slot * (i + 0.5);
    const v = toPos(p.value);
    if (horizontal) {
      const h = slot * 0.6;
      items.push({ kind: 'rect', x: Math.min(zero, v), y: mid - h / 2, width: Math.abs(v - zero), height: h, fill: color });
      items.push(...env.text(p.label, { ...right }, { x: area.x, y: mid - lh / 2, width: leftWidth - 1, height: lh }));
      if (c.showValues) items.push(...env.text(env.format(p.value), small, { x: Math.max(zero, v) + 0.8, y: mid - lh / 2, width: 30, height: lh }));
    } else {
      if (c.chartType === 'column') {
        const w = slot * 0.6;
        items.push({ kind: 'rect', x: mid - w / 2, y: Math.min(zero, v), width: w, height: Math.abs(v - zero), fill: color });
      } else {
        linePoints.push(`${round(mid - plot.x)} ${round(v - plot.y)}`);
        const m = Math.min(1.6, slot * 0.3);
        markers.push({ kind: 'ellipse', x: mid - m / 2, y: v - m / 2, width: m, height: m, fill: color });
      }
      items.push(...env.text(p.label, center, { x: mid - slot / 2, y: plot.y + plot.height + 1, width: slot, height: lh }));
      if (c.showValues) items.push(...env.text(env.format(p.value), center, { x: mid - slot / 2, y: Math.min(zero, v) - lh, width: slot, height: lh }));
    }
  });
  if (linePoints.length > 1) {
    items.push({ kind: 'path', ...plot, viewBox: { width: plot.width, height: plot.height }, paths: [{ d: `M${linePoints.join('L')}`, stroke: color, strokeWidth: 0.5 }] });
  }
  items.push(...markers);
  const axisColor = small.color;
  items.push(
    horizontal
      ? { kind: 'line', x1: zero, y1: plot.y, x2: zero, y2: plot.y + plot.height, color: axisColor, width: 0.2 }
      : { kind: 'line', x1: plot.x, y1: zero, x2: plot.x + plot.width, y2: zero, color: axisColor, width: 0.2 },
  );
  return items;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
