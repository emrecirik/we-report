import type * as Fontkit from '@pdf-lib/fontkit';
import { toMm } from '../units';

type FontkitLib = { create(buffer: Uint8Array): Fontkit.Font };

/** Font files of one family. Only `regular` is required; missing variants fall back to it. */
export interface FontFamilyBytes {
  regular: Uint8Array;
  bold?: Uint8Array;
  italic?: Uint8Array;
  boldItalic?: Uint8Array;
}

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';

export const DEFAULT_FONT_FAMILY = 'Noto Sans';

const PT_TO_MM = toMm(1, 'pt');

/** One font file, measured with the same glyph data the PDF embeds. */
export class LoadedFont {
  private readonly font: Fontkit.Font;
  private readonly widths = new Map<string, number>();

  constructor(
    readonly family: string,
    readonly variant: FontVariant,
    readonly bytes: Uint8Array,
    fontkit: FontkitLib,
  ) {
    this.font = fontkit.create(bytes);
  }

  /**
   * Glyph outlines of `text` as SVG path data. Points are in mm with x to the right of the start
   * of the baseline and y downwards, passed through `map` (e.g. a rotation) before writing.
   */
  outline(text: string, sizePt: number, map: (x: number, y: number) => [number, number]): string {
    const scale = (sizePt * PT_TO_MM) / this.font.unitsPerEm;
    let pen = 0;
    let d = '';
    for (const glyph of this.font.layout(text).glyphs) {
      for (const [, command, args] of glyph.path.toSVG().matchAll(/([MLQCZ])([^MLQCZ]*)/gi)) {
        const nums = args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        d += command.toUpperCase();
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const [x, y] = map((pen + nums[i]) * scale, -nums[i + 1] * scale);
          d += `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000} `;
        }
      }
      // Same advances as widthOf, so a measured width matches the drawn outline.
      pen += glyph.advanceWidth;
    }
    return d.trim();
  }

  /** Stable id for this face, used by renderers (`Noto Sans|bold`). */
  get key(): string {
    return `${this.family}|${this.variant}`;
  }

  /** Distance from the top of a line to its baseline, in mm. */
  ascent(sizePt: number): number {
    return (this.font.ascent / this.font.unitsPerEm) * sizePt * PT_TO_MM;
  }

  /** Height of capital letters in mm. */
  capHeight(sizePt: number): number {
    return (this.font.capHeight / this.font.unitsPerEm) * sizePt * PT_TO_MM;
  }

  lineHeight(sizePt: number): number {
    const { ascent, descent, lineGap, unitsPerEm } = this.font;
    return ((ascent - descent + lineGap) / unitsPerEm) * sizePt * PT_TO_MM;
  }

  /**
   * Width in mm. Sums the advance widths of the shaped glyphs without kerning adjustments —
   * exactly what pdf-lib writes, and what the HTML renderer draws with `font-kerning: none`.
   */
  widthOf(text: string, sizePt: number): number {
    let units = this.widths.get(text);
    if (units === undefined) {
      units = 0;
      for (const glyph of this.font.layout(text).glyphs) units += glyph.advanceWidth;
      // shortcut: unbounded per-font cache, fine for report text; add LRU if fonts live for days in a server.
      this.widths.set(text, units);
    }
    return (units / this.font.unitsPerEm) * sizePt * PT_TO_MM;
  }

  /**
   * Whether pdf-lib can subset this face. Its fontkit fork writes a short `loca` table and halves
   * the offsets, which corrupts glyphs when any TrueType glyph has an odd byte length. Such fonts
   * are embedded whole instead: bigger files, correct output.
   */
  get safeToSubset(): boolean {
    const offsets = (this.font as unknown as { loca?: { offsets?: number[] } }).loca?.offsets;
    if (!offsets) return true; // CFF-based (OTF) fonts have no loca table.
    for (let i = 1; i < offsets.length; i++) if ((offsets[i] - offsets[i - 1]) % 2) return false;
    return true;
  }

  hasGlyph(codePoint: number): boolean {
    return this.font.hasGlyphForCodePoint(codePoint);
  }
}

/** The fonts a report can use. Layout and every renderer resolve faces through it. */
export class FontRegistry {
  private readonly families = new Map<string, Partial<Record<FontVariant, LoadedFont>>>();
  private defaultFamily: string | undefined;

  /** Loads the font engine (a large module, so it is not in the initial bundle) and returns an empty registry. */
  static async create(): Promise<FontRegistry> {
    const mod = await import('@pdf-lib/fontkit');
    return new FontRegistry((mod as unknown as { default?: FontkitLib }).default ?? (mod as unknown as FontkitLib));
  }

  private constructor(private readonly fontkit: FontkitLib) {}

  register(family: string, bytes: FontFamilyBytes): void {
    const faces: Partial<Record<FontVariant, LoadedFont>> = {};
    for (const variant of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
      const data = bytes[variant];
      if (data) faces[variant] = new LoadedFont(family, variant, data, this.fontkit);
    }
    this.families.set(family.toLowerCase(), faces);
    this.defaultFamily ??= family.toLowerCase();
    if (family === DEFAULT_FONT_FAMILY) this.defaultFamily = family.toLowerCase();
  }

  has(family: string): boolean {
    return this.families.has(family.toLowerCase());
  }

  familyNames(): string[] {
    return [...this.families.values()].map((f) => f.regular!.family);
  }

  /** The requested face, else the closest variant of the family, else the default family. */
  resolve(family: string | undefined, bold = false, italic = false): LoadedFont {
    const faces = (family && this.families.get(family.toLowerCase())) || (this.defaultFamily && this.families.get(this.defaultFamily));
    if (!faces) throw new Error('No fonts are registered. Register at least one font family.');
    // shortcut: no synthetic bold/italic; a family without the variant renders regular.
    const wanted: FontVariant = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    return faces[wanted] ?? (bold ? faces.bold : undefined) ?? (italic ? faces.italic : undefined) ?? faces.regular!;
  }

  /** All faces, for embedding in a PDF. */
  allFaces(): LoadedFont[] {
    return [...this.families.values()].flatMap((f) => Object.values(f) as LoadedFont[]);
  }
}
