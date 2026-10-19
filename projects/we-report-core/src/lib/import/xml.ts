/**
 * A small XML reader for importing report files: elements, attributes, text, CDATA and entities.
 * Namespace prefixes are dropped (`rd:DataSourceName` → `DataSourceName`). No DTDs, no external
 * entities — report files are untrusted input.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Text directly inside the element (CDATA included), entities decoded. */
  text: string;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

export class XmlError extends Error {}

export function parseXml(source: string): XmlElement {
  const s = source.replace(/^﻿/, '');
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const textEnd = lt < 0 ? s.length : lt;
    if (textEnd > i) stack[stack.length - 1].text += decode(s.slice(i, textEnd));
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) {
      i = end(s, '-->', lt) + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const close = end(s, ']]>', lt);
      stack[stack.length - 1].text += s.slice(lt + 9, close);
      i = close + 3;
    } else if (s.startsWith('<?', lt)) {
      i = end(s, '?>', lt) + 2;
    } else if (s.startsWith('<!', lt)) {
      i = end(s, '>', lt) + 1; // DOCTYPE: skipped, its entities are never expanded.
    } else if (s[lt + 1] === '/') {
      const close = end(s, '>', lt);
      const name = localName(s.slice(lt + 2, close).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name) throw new XmlError(`Unexpected </${name}>.`);
      i = close + 1;
    } else {
      const m = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(s.slice(lt, lt + 100_000));
      if (!m) throw new XmlError(`Malformed tag at ${lt}.`);
      const element: XmlElement = { name: localName(m[1]), attrs: {}, children: [], text: '' };
      for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        element.attrs[localName(a[1])] = decode(a[2] ?? a[3] ?? '');
      }
      stack[stack.length - 1].children.push(element);
      if (!m[3]) stack.push(element);
      i = lt + m[0].length;
    }
  }
  if (stack.length !== 1) throw new XmlError(`<${stack[stack.length - 1].name}> is not closed.`);
  const top = root.children[0];
  if (!top) throw new XmlError('The file has no XML element.');
  return top;
}

function end(s: string, marker: string, from: number): number {
  const at = s.indexOf(marker, from);
  if (at < 0) throw new XmlError(`Unterminated ${s.slice(from, from + 9)}…`);
  return at;
}

/** First child with this local name. */
export function child(e: XmlElement | undefined, name: string): XmlElement | undefined {
  return e?.children.find((c) => c.name === name);
}

export function children(e: XmlElement | undefined, name: string): XmlElement[] {
  return e?.children.filter((c) => c.name === name) ?? [];
}

/** Text of the element at a path of child names, trimmed; `undefined` when absent. */
export function textAt(e: XmlElement | undefined, ...path: string[]): string | undefined {
  let current = e;
  for (const name of path) current = child(current, name);
  return current?.text.trim();
}
