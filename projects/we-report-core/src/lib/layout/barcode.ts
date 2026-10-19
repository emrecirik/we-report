import type { toSVG as ToSvg } from 'bwip-js';
import { PathItem } from './layout-types';

// bwip-js is large (~0.9 MB): loaded on demand, like the font engine, so it stays out of an app's
// initial bundle. `FontRegistry.create()` loads it, and every layout needs a registry first.
let toSVG: typeof ToSvg | undefined;

/** Loads the barcode engine once; layout can draw barcodes afterwards. */
export async function loadBarcodeEngine(): Promise<void> {
  if (toSVG) return;
  const mod = (await import('bwip-js')) as unknown as { toSVG?: typeof ToSvg; default?: { toSVG: typeof ToSvg } };
  toSVG = mod.toSVG ?? mod.default?.toSVG;
}

/** Square symbologies keep their aspect ratio; linear ones stretch to the control. */
const TWO_D = new Set([
  'qrcode', 'microqrcode', 'gs1qrcode', 'datamatrix', 'gs1datamatrix', 'datamatrixrectangular',
  'azteccode', 'azteccodecompact', 'maxicode', 'dotcode', 'hanxin', 'pdf417', 'micropdf417',
]);

/** Symbologies offered in the designer, most used first. Any bwip-js id also works. */
export const BARCODE_SYMBOLOGIES: readonly string[] = [
  'code128', 'ean13', 'ean8', 'upca', 'upce', 'code39', 'interleaved2of5', 'gs1-128', 'itf14',
  'qrcode', 'datamatrix', 'pdf417', 'azteccode', 'codabar', 'code93', 'isbn', 'gs1datamatrix',
];

const ATTRS = /([\w-]+)="([^"]*)"/g;

/**
 * Renders a barcode as vector paths fitted into `box`. bwip-js draws the human-readable text as
 * paths too, so the result needs no font. Throws bwip-js's message for invalid input
 * (e.g. a wrong EAN-13 check digit).
 */
export function barcodeItem(
  symbology: string,
  value: string,
  showText: boolean,
  box: { x: number; y: number; width: number; height: number },
  color: string,
): PathItem {
  if (!toSVG) throw new Error('The barcode engine is not loaded yet: create the FontRegistry with FontRegistry.create() first.');
  const svg = toSVG({ bcid: symbology, text: value, includetext: showText, textxalign: 'center', scale: 1 });
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) throw new Error('Barcode could not be drawn.');
  const vw = Number(vb[1]);
  const vh = Number(vb[2]);

  let { x, y, width, height } = box;
  if (TWO_D.has(symbology)) {
    const scale = Math.min(width / vw, height / vh);
    x += (width - vw * scale) / 2;
    y += (height - vh * scale) / 2;
    width = vw * scale;
    height = vh * scale;
  }
  const sx = width / vw;
  const sy = height / vh;

  const parsed: { d: string; fill?: string; stroke?: string; strokeWidth?: string }[] = [];
  for (const [, attrText] of svg.matchAll(/<path ([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const [, k, v] of attrText.matchAll(ATTRS)) attrs[k] = v;
    if (attrs['d']) parsed.push({ d: attrs['d'], fill: attrs['fill'], stroke: attrs['stroke'], strokeWidth: attrs['stroke-width'] });
  }

  // Linear codes stretch their bars to the box, but the human-readable digits keep their shape:
  // scaled evenly, centred under the bars and resting on the bottom edge.
  const text = TWO_D.has(symbology) ? [] : parsed.filter((p) => !p.stroke);
  const nums = text.flatMap((p) => p.d.match(/-?[\d.]+/g)?.map(Number) ?? []);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const bottom = ys.length ? Math.max(...ys) : 0;
  const even = Math.min(sx, sy);

  const paths: PathItem['paths'] = parsed.map((p) => {
    // SVG fills a path black unless told otherwise; bwip-js relies on that for 2D symbols.
    const stroked = !!p.stroke;
    const d = text.includes(p)
      ? mapPath(p.d, (px, py) => [cx * sx + (px - cx) * even, bottom * sy + (py - bottom) * even])
      : scalePath(p.d, sx, sy);
    return {
      d,
      fill: p.fill || !stroked ? color : undefined,
      stroke: stroked ? color : undefined,
      // Linear bars are vertical strokes, so their width scales horizontally.
      strokeWidth: p.strokeWidth ? Number(p.strokeWidth) * sx : undefined,
    };
  });
  return { kind: 'path', x, y, width, height, viewBox: { width, height }, paths };
}

/** Passes every point of an absolute-coordinate path (M, L, Q, Z) through `map`. */
function mapPath(d: string, map: (x: number, y: number) => [number, number]): string {
  return d.replace(/([MLQ])([^MLQZ]*)/g, (_, command: string, args: string) => {
    const n = args.match(/-?[\d.]+/g)?.map(Number) ?? [];
    let out = command;
    for (let i = 0; i + 1 < n.length; i += 2) {
      const [x, y] = map(n[i], n[i + 1]);
      out += `${Math.round(x * 10000) / 10000} ${Math.round(y * 10000) / 10000} `;
    }
    return out.trimEnd();
  });
}

/** Scales an absolute-coordinate path (bwip-js emits only M, L, Q, Z). */
export function scalePath(d: string, sx: number, sy: number): string {
  let index = 0;
  return d.replace(/[MLQZ]|-?[\d.]+/g, (token) => {
    if (/[MLQZ]/.test(token)) {
      index = 0;
      return token;
    }
    const scaled = Number(token) * (index++ % 2 === 0 ? sx : sy);
    return String(Math.round(scaled * 10000) / 10000) + ' ';
  }).replace(/ (?=[MLQZ]|$)/g, '');
}
