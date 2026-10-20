/** A 1-bit picture of a page: `width` × `height` dots, one byte per dot, 1 = black. */
export interface MonoBitmap {
  width: number;
  height: number;
  dots: Uint8Array;
}

/**
 * Turns RGBA pixels (as from a canvas) into black and white dots; darker than `threshold` (0–255)
 * is black. The default keeps grey text, thin strokes and light grid lines; only pale fills turn white.
 */
export function toMonoBitmap(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, threshold = 215): MonoBitmap {
  const dots = new Uint8Array(width * height);
  for (let i = 0; i < dots.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    // Transparent is paper (white).
    const luma = 255 - a * (255 - (0.299 * r + 0.587 * g + 0.114 * b));
    dots[i] = luma < threshold ? 1 : 0;
  }
  return { width, height, dots };
}

/** Rows packed 8 dots per byte, most significant bit first, as printers take them. */
function packRows(bitmap: MonoBitmap): { bytesPerRow: number; bytes: Uint8Array } {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const bytes = new Uint8Array(bytesPerRow * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.dots[y * bitmap.width + x]) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, bytes };
}

/**
 * Zebra ZPL II: every page as one label holding the page as a graphic field (`^GFA`), so any ZPL
 * printer prints it exactly as previewed, fonts included. Rasterize at the printer's resolution
 * (203 or 300 dpi) first.
 */
export function zplFromBitmaps(pages: readonly MonoBitmap[]): string {
  return pages
    .map((page) => {
      const { bytesPerRow, bytes } = packRows(page);
      let hex = '';
      for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
      return `^XA^PW${page.width}^LL${page.height}^FO0,0^GFA,${bytes.length},${bytes.length},${bytesPerRow},${hex.toUpperCase()}^FS^XZ\n`;
    })
    .join('');
}

/**
 * ESC/POS (receipt printers): every page as raster images (`GS v 0`, sent in bands of at most 256
 * rows, which every printer accepts), then a feed and a cut. Rasterize to the printer's dot width
 * (384 for 58 mm, 576 for 80 mm rolls) first.
 */
export function escPosFromBitmaps(pages: readonly MonoBitmap[], options: { cut?: boolean } = {}): Uint8Array {
  const out: number[] = [0x1b, 0x40]; // ESC @: reset
  for (const page of pages) {
    const { bytesPerRow, bytes } = packRows(page);
    for (let top = 0; top < page.height; top += 256) {
      const rows = Math.min(256, page.height - top);
      out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
      for (let i = top * bytesPerRow; i < (top + rows) * bytesPerRow; i++) out.push(bytes[i]);
    }
    out.push(0x1b, 0x64, 0x04); // ESC d 4: feed four lines
    if (options.cut !== false) out.push(0x1d, 0x56, 0x42, 0x00); // GS V B 0: feed to the cutter and cut
  }
  return Uint8Array.from(out);
}
