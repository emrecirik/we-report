import { LoadedFont } from '../fonts/font-registry';

/**
 * The lines a box of `width` × `height` mm shows of `text`, and whether some were cut off. A box
 * always shows at least one line. The engine draws exactly these lines, so the designer can warn
 * about cut text with the same rule.
 */
export function fitLines(text: string, font: LoadedFont, sizePt: number, padding: number, width: number, height: number): { lines: string[]; cut: boolean } {
  const lines = wrapText(text, font, sizePt, Math.max(0, width - 2 * padding));
  const maxLines = Math.max(1, Math.floor((height - 2 * padding) / font.lineHeight(sizePt) + 0.01));
  return lines.length > maxLines ? { lines: lines.slice(0, maxLines), cut: true } : { lines, cut: false };
}

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
