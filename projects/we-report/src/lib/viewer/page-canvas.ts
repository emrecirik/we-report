import { LayoutPage, parseHexColor, TextItem } from 'we-report-core';
import { WeReportFontsService } from '../we-report-fonts.service';

const PT_TO_MM = 25.4 / 72;

function fontOf(item: TextItem): string {
  return `${item.italic ? 'italic ' : ''}${item.bold ? 700 : 400} ${item.size * PT_TO_MM}px '${WeReportFontsService.cssFamily(item.fontFamily)}'`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** A fetched picture as a PNG/JPEG `data:` URI (other formats, e.g. WebP or SVG, are converted to PNG). */
export async function pictureDataUri(blob: Blob, doc: Document = document): Promise<string> {
  const read = (b: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(b);
    });
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return read(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    if (!img) throw new Error('Not a picture.');
    const canvas = doc.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draws a laid-out page on a canvas, `pxPerMm` pixels per millimetre, from the same positioned
 * items (and the same registered fonts) as the on-screen SVG and the PDF.
 */
export async function drawPage(page: LayoutPage, pxPerMm: number, doc: Document = document): Promise<HTMLCanvasElement> {
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(page.width * pxPerMm);
  canvas.height = Math.round(page.height * pxPerMm);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  const texts = page.items.filter((i): i is TextItem => i.kind === 'text');
  // Canvas text uses only fonts that are already loaded.
  await Promise.all([...new Set(texts.map(fontOf))].map((f) => doc.fonts?.load(f).catch(() => undefined)));
  const images = new Map<string, HTMLImageElement | null>();
  for (const item of page.items) if (item.kind === 'image' && !images.has(item.src)) images.set(item.src, await loadImage(item.src));

  const hex = (c: string | undefined) => (parseHexColor(c) ? c! : null);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(pxPerMm, pxPerMm);
  ctx.lineCap = 'square';
  const paint = (fill: string | undefined, stroke: string | undefined, width: number | undefined, path: () => void) => {
    ctx.beginPath();
    path();
    if (hex(fill)) {
      ctx.fillStyle = fill!;
      ctx.fill();
    }
    if (hex(stroke)) {
      ctx.strokeStyle = stroke!;
      ctx.lineWidth = width ?? 0.25;
      ctx.stroke();
    }
  };
  for (const item of page.items) {
    switch (item.kind) {
      case 'rect':
        paint(item.fill, item.stroke, item.strokeWidth, () =>
          item.radius ? ctx.roundRect(item.x, item.y, item.width, item.height, item.radius) : ctx.rect(item.x, item.y, item.width, item.height),
        );
        break;
      case 'ellipse':
        paint(item.fill, item.stroke, item.strokeWidth, () => ctx.ellipse(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, item.height / 2, 0, 0, Math.PI * 2));
        break;
      case 'line':
        paint(undefined, item.color, item.width, () => {
          ctx.moveTo(item.x1, item.y1);
          ctx.lineTo(item.x2, item.y2);
        });
        break;
      case 'text': {
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.x, item.y, item.width, item.height);
        ctx.clip();
        ctx.font = fontOf(item);
        ctx.fontKerning = 'none';
        ctx.fillStyle = hex(item.color) ?? '#000000';
        for (const line of item.lines) {
          // Browsers draw text a little narrower or wider than the font metrics; keep the engine's width.
          const drawn = ctx.measureText(line.text).width;
          if (drawn > 0 && line.width > 0 && Math.abs(drawn - line.width) > 0.01) {
            ctx.save();
            ctx.translate(line.x, line.baseline);
            ctx.scale(line.width / drawn, 1);
            ctx.fillText(line.text, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(line.text, line.x, line.baseline);
          }
          if (item.underline) ctx.fillRect(line.x, line.baseline + item.size * PT_TO_MM * 0.12, line.width, item.size * PT_TO_MM * 0.06);
        }
        ctx.restore();
        break;
      }
      case 'image': {
        const img = images.get(item.src);
        if (!img) break;
        ctx.save();
        ctx.beginPath();
        ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height);
        ctx.clip();
        ctx.drawImage(img, item.x, item.y, item.width, item.height);
        ctx.restore();
        break;
      }
      case 'path':
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.lineCap = 'butt';
        for (const p of item.paths) {
          const path = new Path2D(p.d);
          if (hex(p.fill)) {
            ctx.fillStyle = p.fill!;
            ctx.fill(path);
          }
          if (hex(p.stroke)) {
            ctx.strokeStyle = p.stroke!;
            ctx.lineWidth = p.strokeWidth ?? 0.25;
            ctx.stroke(path);
          }
        }
        ctx.restore();
        break;
    }
  }
  return canvas;
}
