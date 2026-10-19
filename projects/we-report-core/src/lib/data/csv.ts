import { inferValue } from './infer';

/** RFC 4180 parsing: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Picks the delimiter that appears most in the first line: `;` (Excel in tr/de/fr), `,`, tab or `|`. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** First row is the header; values are typed with `inferValue`. */
export function csvToObjects(text: string, delimiter?: string): Record<string, unknown>[] {
  const [header, ...rows] = parseCsv(text, delimiter);
  if (!header) return [];
  const names = header.map((h, i) => h.trim() || `Column${i + 1}`);
  return rows.map((cells) => {
    const obj: Record<string, unknown> = {};
    names.forEach((name, i) => (obj[name] = inferValue(cells[i] ?? '')));
    return obj;
  });
}
