import { LoadedFont } from '../fonts/font-registry';

/**
 * Breaks text into lines no wider than `maxWidth` (mm). Explicit newlines are kept; words longer
 * than a line are split by character. Widths are additive because measurement ignores kerning.
 */
export function wrapText(text: string, font: LoadedFont, sizePt: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = '';
    let width = 0;
    const flush = () => {
      lines.push(line.trimEnd());
      line = '';
      width = 0;
    };
    for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
      const w = font.widthOf(token, sizePt);
      if (/^\s/.test(token)) {
        // Whitespace only separates words; it never starts a line.
        if (line) {
          line += token;
          width += w;
        }
        continue;
      }
      if (line && width + w > maxWidth) flush();
      if (w <= maxWidth) {
        line += token;
        width += w;
        continue;
      }
      // A word wider than the whole line: split it by character.
      for (const ch of token) {
        const cw = font.widthOf(ch, sizePt);
        if (line && width + cw > maxWidth) flush();
        line += ch;
        width += cw;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
