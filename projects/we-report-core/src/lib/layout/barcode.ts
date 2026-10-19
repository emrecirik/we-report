import { toSVG } from 'bwip-js';
import { PathItem } from './layout-types';

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

  const paths: PathItem['paths'] = [];
  for (const [, attrText] of svg.matchAll(/<path ([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const [, k, v] of attrText.matchAll(ATTRS)) attrs[k] = v;
    if (!attrs['d']) continue;
    // SVG fills a path black unless told otherwise; bwip-js relies on that for 2D symbols.
    const stroked = !!attrs['stroke'];
    paths.push({
      d: scalePath(attrs['d'], sx, sy),
      fill: attrs['fill'] || !stroked ? color : undefined,
      stroke: stroked ? color : undefined,
      // Linear bars are vertical strokes, so their width scales horizontally.
      strokeWidth: attrs['stroke-width'] ? Number(attrs['stroke-width']) * sx : undefined,
    });
  }
  return { kind: 'path', x, y, width, height, viewBox: { width, height }, paths };
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
