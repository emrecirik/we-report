import { DEFAULT_FONT_FAMILY, FontRegistry } from '../lib/fonts/font-registry';

let registry: Promise<FontRegistry> | undefined;

/** The bundled Noto Sans faces, served to Karma under /fonts (see angular.json test assets). */
export function loadTestFonts(): Promise<FontRegistry> {
  registry ??= (async () => {
    const load = async (name: string) => new Uint8Array(await (await fetch(`/fonts/NotoSans-${name}.ttf`)).arrayBuffer());
    const fonts = await FontRegistry.create();
    fonts.register(DEFAULT_FONT_FAMILY, {
      regular: await load('Regular'),
      bold: await load('Bold'),
      italic: await load('Italic'),
      boldItalic: await load('BoldItalic'),
    });
    return fonts;
  })();
  return registry;
}
