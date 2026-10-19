import type { PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib';
import { parseHexColor } from '../color';
import { fromMm } from '../units';
import { FontRegistry } from '../fonts/font-registry';
import { readImage } from '../layout/images';
import { LayoutDocument, LayoutItem } from '../layout/layout-types';

const PT = fromMm(1, 'pt');

export interface PdfOptions {
  title?: string;
  author?: string;
  /** Written as creation/modification date; pass the layout's print time for reproducible files. */
  date?: Date;
}

// pdf-lib is loaded on first export only, keeping it out of the initial bundle of apps that just preview.
type PdfLib = typeof import('pdf-lib');
let lib: PdfLib;

function color(value: string | undefined): { color: RGB | undefined; opacity: number } {
  const c = parseHexColor(value);
  return c ? { color: lib.rgb(c.r, c.g, c.b), opacity: c.a } : { color: undefined, opacity: 1 };
}

/** Draws a laid-out document into a PDF. Fonts are embedded as subsets of the registry's faces. */
export async function renderPdf(doc: LayoutDocument, fonts: FontRegistry, options: PdfOptions = {}): Promise<Uint8Array> {
  lib ??= await import('pdf-lib');
  const fontkit = await import('@pdf-lib/fontkit');
  const pdf = await lib.PDFDocument.create();
  pdf.registerFontkit(((fontkit as unknown as { default?: unknown }).default ?? fontkit) as Parameters<typeof pdf.registerFontkit>[0]);
  pdf.setProducer('we-report');
  pdf.setCreator('we-report');
  if (options.title) pdf.setTitle(options.title);
  if (options.author) pdf.setAuthor(options.author);
  if (options.date) {
    pdf.setCreationDate(options.date);
    pdf.setModificationDate(options.date);
  }

  const faces = new Map(fonts.allFaces().map((f) => [f.key, f]));
  const embeddedFonts = new Map<string, PDFFont>();
  const embeddedImages = new Map<string, PDFImage>();
  const fontFor = async (key: string): Promise<PDFFont> => {
    let font = embeddedFonts.get(key);
    if (!font) {
      const face = faces.get(key);
      if (!face) throw new Error(`Font "${key}" is not registered.`);
      font = await pdf.embedFont(face.bytes, { subset: face.safeToSubset });
      embeddedFonts.set(key, font);
    }
    return font;
  };
  const imageFor = async (src: string): Promise<PDFImage | null> => {
    let image = embeddedImages.get(src);
    if (!image) {
      const info = readImage(src);
      if (!info) return null;
      image = info.mime === 'image/png' ? await pdf.embedPng(info.bytes) : await pdf.embedJpg(info.bytes);
      embeddedImages.set(src, image);
    }
    return image;
  };

  for (const layoutPage of doc.pages) {
    const page = pdf.addPage([layoutPage.width * PT, layoutPage.height * PT]);
    const H = layoutPage.height * PT;
    for (const item of layoutPage.items) {
      await drawItem(page, H, item, fontFor, imageFor);
    }
  }
  return pdf.save();
}

function withClip(page: PDFPage, H: number, box: { x: number; y: number; width: number; height: number }, draw: () => void): void {
  page.pushOperators(lib.pushGraphicsState(), lib.rectangle(box.x * PT, H - (box.y + box.height) * PT, box.width * PT, box.height * PT), lib.clip(), lib.endPath());
  draw();
  page.pushOperators(lib.popGraphicsState());
}

async function drawItem(
  page: PDFPage,
  H: number,
  item: LayoutItem,
  fontFor: (key: string) => Promise<PDFFont>,
  imageFor: (src: string) => Promise<PDFImage | null>,
): Promise<void> {
  switch (item.kind) {
    case 'rect': {
      const fill = color(item.fill);
      const stroke = color(item.stroke);
      const borderWidth = item.stroke ? (item.strokeWidth ?? 0.25) * PT : 0;
      if (item.radius) {
        const w = item.width * PT;
        const h = item.height * PT;
        const r = Math.min(item.radius * PT, w / 2, h / 2);
        const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
        page.drawSvgPath(d, {
          x: item.x * PT,
          y: H - item.y * PT,
          color: fill.color,
          opacity: fill.opacity,
          borderColor: stroke.color,
          borderOpacity: stroke.opacity,
          borderWidth,
        });
      } else {
        page.drawRectangle({
          x: item.x * PT,
          y: H - (item.y + item.height) * PT,
          width: item.width * PT,
          height: item.height * PT,
          color: fill.color,
          opacity: fill.opacity,
          borderColor: stroke.color,
          borderOpacity: stroke.opacity,
          borderWidth,
        });
      }
      return;
    }
    case 'ellipse': {
      const fill = color(item.fill);
      const stroke = color(item.stroke);
      page.drawEllipse({
        x: (item.x + item.width / 2) * PT,
        y: H - (item.y + item.height / 2) * PT,
        xScale: (item.width / 2) * PT,
        yScale: (item.height / 2) * PT,
        color: fill.color,
        opacity: fill.opacity,
        borderColor: stroke.color,
        borderOpacity: stroke.opacity,
        borderWidth: item.stroke ? (item.strokeWidth ?? 0.25) * PT : 0,
      });
      return;
    }
    case 'line': {
      const c = color(item.color);
      if (!c.color) return;
      page.drawLine({
        start: { x: item.x1 * PT, y: H - item.y1 * PT },
        end: { x: item.x2 * PT, y: H - item.y2 * PT },
        thickness: item.width * PT,
        color: c.color,
        opacity: c.opacity,
        lineCap: lib.LineCapStyle.Projecting,
      });
      return;
    }
    case 'text': {
      const font = await fontFor(item.fontKey);
      const c = color(item.color);
      withClip(page, H, item, () => {
        for (const line of item.lines) {
          if (!line.text) continue;
          page.drawText(line.text, { x: line.x * PT, y: H - line.baseline * PT, size: item.size, font, color: c.color, opacity: c.opacity });
          if (item.underline) {
            const y = H - line.baseline * PT - item.size * 0.12;
            page.drawLine({
              start: { x: line.x * PT, y },
              end: { x: (line.x + line.width) * PT, y },
              thickness: item.size * 0.06,
              color: c.color,
              opacity: c.opacity,
            });
          }
        }
      });
      return;
    }
    case 'image': {
      const image = await imageFor(item.src);
      if (!image) return;
      withClip(page, H, item.clip, () =>
        page.drawImage(image, { x: item.x * PT, y: H - (item.y + item.height) * PT, width: item.width * PT, height: item.height * PT }),
      );
      return;
    }
    case 'path':
      for (const p of item.paths) {
        const fill = color(p.fill);
        const stroke = color(p.stroke);
        page.drawSvgPath(p.d, {
          x: item.x * PT,
          y: H - item.y * PT,
          scale: PT,
          color: fill.color,
          opacity: fill.opacity,
          borderColor: stroke.color,
          borderOpacity: stroke.opacity,
          // pdf-lib sets the line width after `scale`, so it is in path units (mm).
          borderWidth: p.strokeWidth ?? 0,
          borderLineCap: lib.LineCapStyle.Butt,
        });
      }
      return;
  }
}
