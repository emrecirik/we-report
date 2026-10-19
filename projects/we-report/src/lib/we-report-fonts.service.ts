import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { FontFamilyBytes, FontRegistry, FontVariant } from 'we-report-core';
import { DEFAULT_FONTS_URL, defaultFontFamily, WE_REPORT_CONFIG, WeReportFontFamily, WeReportFontFile } from './we-report-config';

const VARIANTS: FontVariant[] = ['regular', 'bold', 'italic', 'boldItalic'];

/**
 * Loads the configured fonts once. The same bytes feed the layout engine (measurement), the PDF
 * (embedding) and the browser (`FontFace`, used by the on-screen SVG), so preview and PDF match.
 */
@Injectable({ providedIn: 'root' })
export class WeReportFontsService {
  private readonly config = inject(WE_REPORT_CONFIG);
  private readonly document = inject(DOCUMENT);
  private registry?: Promise<FontRegistry>;

  /** CSS family the browser renders a report family with. Prefixed so an installed font of the same name can never be picked instead. */
  static cssFamily(family: string): string {
    return `we-report ${family}`;
  }

  ready(): Promise<FontRegistry> {
    this.registry ??= this.load();
    return this.registry;
  }

  private async load(): Promise<FontRegistry> {
    const families: WeReportFontFamily[] = [];
    const defaultUrl = this.config.defaultFontsUrl === undefined ? DEFAULT_FONTS_URL : this.config.defaultFontsUrl;
    if (defaultUrl !== null) families.push(defaultFontFamily(defaultUrl));
    families.push(...(this.config.fonts ?? []));

    const registry = await FontRegistry.create();
    await Promise.all(
      families.map(async (f) => {
        const bytes: Partial<FontFamilyBytes> = {};
        await Promise.all(
          VARIANTS.map(async (v) => {
            if (f[v]) bytes[v] = await this.read(f[v]!);
          }),
        );
        if (!bytes.regular) throw new Error(`Font family "${f.family}" has no regular face.`);
        registry.register(f.family, bytes as FontFamilyBytes);
        this.addFontFaces(f.family, bytes);
      }),
    );
    return registry;
  }

  private async read(file: WeReportFontFile): Promise<Uint8Array> {
    if (typeof file !== 'string') return file;
    const response = await fetch(file);
    if (!response.ok) throw new Error(`Could not load font ${file} (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private addFontFaces(family: string, bytes: Partial<FontFamilyBytes>): void {
    const fonts = (this.document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts || typeof FontFace === 'undefined') return;
    const regular = bytes.regular!;
    // A missing variant uses the regular file, mirroring FontRegistry.resolve (no synthetic bold).
    for (const variant of VARIANTS) {
      const data = bytes[variant] ?? (variant === 'boldItalic' ? (bytes.bold ?? bytes.italic) : undefined) ?? regular;
      const face = new FontFace(WeReportFontsService.cssFamily(family), data as BufferSource, {
        weight: variant === 'bold' || variant === 'boldItalic' ? '700' : '400',
        style: variant === 'italic' || variant === 'boldItalic' ? 'italic' : 'normal',
      });
      // TypeScript 5.5's DOM typings omit FontFaceSet.add; every target browser has it.
      (fonts as unknown as Set<FontFace>).add(face);
      face.load().catch(() => undefined);
    }
  }
}
