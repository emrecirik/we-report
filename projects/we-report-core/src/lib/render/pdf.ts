import type { PDFDocument, PDFFont, PDFImage, PDFPage, PDFRef, RGB } from 'pdf-lib';
import { parseHexColor } from '../color';
import { fromMm } from '../units';
import { FontRegistry } from '../fonts/font-registry';
import { readImage } from '../layout/images';
import { LayoutBookmark, LayoutDocument, LayoutItem } from '../layout/layout-types';
import { FacturXProfile, PdfAttachment, weReportPdfAXmp, weReportSrgbIccProfile } from './pdfa';

const PT = fromMm(1, 'pt');

export interface PdfOptions {
  title?: string;
  author?: string;
  /** Written as creation/modification date; pass the layout's print time for reproducible files. */
  date?: Date;
  /** Language of the text (BCP 47, e.g. `tr-TR`), for screen readers and search. */
  lang?: string;
  /**
   * Writes an archivable PDF/A-3b: an sRGB output intent, XMP metadata matching the document
   * information, a document ID. On by itself whenever `facturX` is given.
   */
  pdfa?: boolean;
  /** Files carried inside the PDF — any type under PDF/A-3, each saying how it relates to the document. */
  attachments?: PdfAttachment[];
  /**
   * A Factur-X / ZUGFeRD e-invoice: the invoice's Cross Industry Invoice XML, attached as
   * `factur-x.xml` (or `fileName`, e.g. `zugferd-invoice.xml`) to a PDF/A-3b whose XMP names the profile.
   * A report that maps one (`eInvoice`) carries it when this is left out; `false` leaves it out.
   */
  facturX?: { xml: string | Uint8Array; profile: FacturXProfile; fileName?: string } | false;
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
  // A report that maps an e-invoice carries it unless the host hands its own
  // `false` leaves a mapped e-invoice out
  const facturX: Exclude<PdfOptions['facturX'], false> = options.facturX === false ? undefined : (options.facturX ?? (doc.eInvoice ? { xml: doc.eInvoice, profile: 'EN 16931' } : undefined));
  const pdfa = options.pdfa || !!facturX;
  // PDF/A wants the information dates to match the XMP ones, so pdf-lib must not touch them on save
  const pdf = await lib.PDFDocument.create({ updateMetadata: !pdfa });
  pdf.registerFontkit(((fontkit as unknown as { default?: unknown }).default ?? fontkit) as Parameters<typeof pdf.registerFontkit>[0]);
  pdf.setProducer('we-report');
  pdf.setCreator('we-report');
  if (options.title) pdf.setTitle(options.title);
  if (options.author) pdf.setAuthor(options.author);
  if (options.lang) pdf.setLanguage(options.lang);
  const date = options.date ?? (pdfa ? new Date(Math.floor(Date.now() / 1000) * 1000) : undefined);
  if (date) {
    pdf.setCreationDate(date);
    pdf.setModificationDate(date);
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

  const pages: PDFPage[] = [];
  for (const layoutPage of doc.pages) {
    const page = pdf.addPage([layoutPage.width * PT, layoutPage.height * PT]);
    pages.push(page);
    const H = layoutPage.height * PT;
    for (const item of layoutPage.items) {
      await drawItem(page, H, item, fontFor, imageFor);
    }
  }
  if (doc.bookmarks?.length) addOutline(pdf, pages, doc);

  const attachments = [...(options.attachments ?? [])];
  if (facturX) {
    const fx = facturX;
    // Factur-X: the XML is the invoice's alternative form for the profiles that carry the whole
    // invoice, and data the PDF only summarises for MINIMUM and BASIC WL
    const relationship = fx.profile === 'MINIMUM' || fx.profile === 'BASIC WL' ? 'Data' : 'Alternative';
    attachments.push({ name: fx.fileName ?? 'factur-x.xml', data: fx.xml, mimeType: 'text/xml', description: 'Factur-X invoice', relationship });
  }
  for (const a of attachments) {
    const bytes = typeof a.data === 'string' ? new TextEncoder().encode(a.data) : a.data;
    await pdf.attach(bytes, a.name, {
      mimeType: a.mimeType,
      description: a.description,
      creationDate: date ?? new Date(),
      modificationDate: date ?? new Date(),
      afRelationship: (a.relationship ?? 'Data') as never
    });
  }

  if (pdfa && date) {
    const title = options.title || 'we-report';
    if (!options.title) pdf.setTitle(title);
    const xmp = weReportPdfAXmp({
      title,
      author: options.author,
      producer: 'we-report',
      creator: 'we-report',
      date,
      lang: options.lang,
      facturX: facturX ? { profile: facturX.profile, fileName: facturX.fileName ?? 'factur-x.xml' } : undefined
    });
    const ctx = pdf.context;
    // The metadata stream stays unfiltered, as PDF/A asks
    const metadata = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    pdf.catalog.set(lib.PDFName.of('Metadata'), ctx.register(metadata));
    const icc = ctx.flateStream(weReportSrgbIccProfile(), { N: 3 });
    const intent = ctx.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: lib.PDFString.of('sRGB IEC61966-2.1'),
      Info: lib.PDFString.of('sRGB IEC61966-2.1'),
      DestOutputProfile: ctx.register(icc)
    });
    pdf.catalog.set(lib.PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));
    // A document ID, the same in both halves for a first version
    // What the document holds goes into the ID too: two reports of one name in the same second differ
    const id = lib.PDFHexString.of(documentId(xmp + doc.pages.map((p) => `${p.items.length}`).join(',')));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }
  return pdf.save();
}

/** The document map as PDF bookmarks, nested by level; the reader opens with them shown. */
function addOutline(pdf: PDFDocument, pages: PDFPage[], doc: LayoutDocument): void {
  const { PDFName, PDFHexString, PDFNumber, PDFNull } = lib;
  const ctx = pdf.context;
  type Node = { mark: LayoutBookmark; ref: PDFRef; children: Node[] };
  const top: Node[] = [];
  const stack: Node[] = [];
  for (const mark of doc.bookmarks ?? []) {
    if (!pages[mark.pageIndex]) continue;
    const node: Node = { mark, ref: ctx.nextRef(), children: [] };
    while (stack.length && stack[stack.length - 1].mark.level >= mark.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : top).push(node);
    stack.push(node);
  }
  const count = (nodes: Node[]): number => nodes.reduce((n, c) => n + 1 + count(c.children), 0);
  const write = (nodes: Node[], parent: PDFRef) => {
    nodes.forEach((node, i) => {
      const page = pages[node.mark.pageIndex];
      const dict = ctx.obj({});
      dict.set(PDFName.of('Title'), PDFHexString.fromText(node.mark.title));
      dict.set(PDFName.of('Parent'), parent);
      if (i > 0) dict.set(PDFName.of('Prev'), nodes[i - 1].ref);
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), nodes[i + 1].ref);
      if (node.children.length) {
        dict.set(PDFName.of('First'), node.children[0].ref);
        dict.set(PDFName.of('Last'), node.children[node.children.length - 1].ref);
        dict.set(PDFName.of('Count'), PDFNumber.of(count(node.children)));
      }
      const height = doc.pages[node.mark.pageIndex].height;
      dict.set(PDFName.of('Dest'), ctx.obj([page.ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of((height - node.mark.y) * PT), PDFNull]));
      ctx.assign(node.ref, dict);
      write(node.children, node.ref);
    });
  };
  if (!top.length) return;
  const outlines = ctx.nextRef();
  write(top, outlines);
  const root = ctx.obj({});
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), top[0].ref);
  root.set(PDFName.of('Last'), top[top.length - 1].ref);
  root.set(PDFName.of('Count'), PDFNumber.of(count(top)));
  ctx.assign(outlines, root);
  pdf.catalog.set(PDFName.of('Outlines'), outlines);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
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

/** 32 hex digits derived from the content — the PDF/A document ID (FNV-1a, not a security hash) */
function documentId(seed: string): string {
  let out = '';
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}
