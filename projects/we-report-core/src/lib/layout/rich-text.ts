import { LoadedFont } from '../fonts/font-registry';

/** A piece of rich text in one style. */
export interface RichRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** A run placed on a line: `x` from the line's start, in mm. */
export interface RichSegment extends RichRun {
  x: number;
  width: number;
}

export interface RichLine {
  segments: RichSegment[];
  width: number;
}

/**
 * Reads the small rich-text language of a text box: `**bold**`, `*italic*`, `__underline__` and
 * `{formula}` fields, whose values are inserted as plain text (never read as markup). `{{`, `}}`
 * and `\*` (a backslash before any character) write the character itself.
 */
export function parseRichText(markup: string, field: (expression: string) => string): RichRun[] {
  const runs: RichRun[] = [];
  const style = { bold: false, italic: false, underline: false };
  let text = '';
  const flush = () => {
    if (text) runs.push({ text, ...style });
    text = '';
  };
  for (let i = 0; i < markup.length; i++) {
    const ch = markup[i];
    const next = markup[i + 1];
    if (ch === '\\' && next !== undefined) {
      text += next;
      i++;
    } else if ((ch === '{' && next === '{') || (ch === '}' && next === '}')) {
      text += ch;
      i++;
    } else if (ch === '{') {
      // A formula runs to the closing brace outside quotes.
      let j = i + 1;
      let quote: string | null = null;
      for (; j < markup.length; j++) {
        const c = markup[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === "'" || c === '"') quote = c;
        else if (c === '}') break;
      }
      if (j >= markup.length) {
        text += markup.slice(i);
        break;
      }
      text += field(markup.slice(i + 1, j));
      i = j;
    } else if (ch === '*' && next === '*') {
      flush();
      style.bold = !style.bold;
      i++;
    } else if (ch === '_' && next === '_') {
      flush();
      style.underline = !style.underline;
      i++;
    } else if (ch === '*') {
      flush();
      style.italic = !style.italic;
    } else {
      text += ch;
    }
  }
  flush();
  return runs;
}

/** The markup without its formatting, fields filled in: for searching, exports and measuring. */
export function plainRichText(runs: readonly RichRun[]): string {
  return runs.map((r) => r.text).join('');
}

type Part = { text: string; style: RichRun };

/**
 * Breaks runs into lines no wider than `maxWidth` (mm), like `wrapText`: newlines kept, spaces
 * only between words, words longer than a line split by character. A word may change style
 * midway (`**bo**ld`) and still stays together.
 */
export function wrapRichText(runs: readonly RichRun[], fontOf: (run: RichRun) => LoadedFont, sizePt: number, maxWidth: number): RichLine[] {
  const lines: RichLine[] = [];
  const width = (p: Part) => fontOf(p.style).widthOf(p.text, sizePt);
  let line: Part[] = [];
  let lineWidth = 0;
  let word: Part[] = [];
  let pendingSpace: Part[] = [];

  const flushLine = () => {
    let x = 0;
    const segments: RichSegment[] = [];
    for (const p of line) {
      const w = width(p);
      const last = segments[segments.length - 1];
      if (last && last.bold === p.style.bold && last.italic === p.style.italic && last.underline === p.style.underline) {
        last.text += p.text;
        last.width += w;
      } else {
        segments.push({ ...p.style, text: p.text, x, width: w });
      }
      x += w;
    }
    lines.push({ segments, width: x });
    line = [];
    lineWidth = 0;
    pendingSpace = [];
  };
  const place = (parts: Part[], w: number) => {
    line.push(...parts);
    lineWidth += w;
  };
  const flushWord = () => {
    if (!word.length) return;
    const w = word.reduce((s, p) => s + width(p), 0);
    const space = pendingSpace.reduce((s, p) => s + width(p), 0);
    if (line.length && lineWidth + space + w > maxWidth) flushLine();
    else if (line.length) place(pendingSpace, space);
    pendingSpace = [];
    if (w <= maxWidth) {
      place(word, w);
    } else {
      // A word wider than the whole line: split it by character.
      for (const p of word) {
        for (const ch of p.text) {
          const cw = fontOf(p.style).widthOf(ch, sizePt);
          if (line.length && lineWidth + cw > maxWidth) flushLine();
          place([{ text: ch, style: p.style }], cw);
        }
      }
    }
    word = [];
  };

  for (const run of runs) {
    for (const token of run.text.match(/\r\n|\r|\n|[^\S\r\n]+|\S+/g) ?? []) {
      if (/^[\r\n]/.test(token)) {
        flushWord();
        flushLine();
      } else if (/^\s/.test(token)) {
        flushWord();
        pendingSpace.push({ text: token, style: run });
      } else {
        word.push({ text: token, style: run });
      }
    }
  }
  flushWord();
  flushLine();
  return lines;
}
