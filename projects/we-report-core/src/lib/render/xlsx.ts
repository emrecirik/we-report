import { calculatedFieldMap, resolveReportData } from '../data/data-source';
import { resolveParameters } from '../data/web-service';
import { Band, isExpression, ReportDefinition, TextControl } from '../definition/report-definition';
import { evaluate } from '../expression/evaluate';
import { toDate } from '../format';
import { parseRichText, plainRichText } from '../layout/rich-text';

export interface TableExport {
  headers: string[];
  rows: unknown[][];
  /** Excel number format per column (`#,##0.00`, `dd.mm.yyyy` …), or undefined. */
  formats: (string | undefined)[];
}

export interface TableExportOptions {
  data?: unknown;
  sources?: Record<string, unknown>;
  params?: Record<string, unknown>;
  locale?: string;
  /** Print time for `Today()`/`Now()` in formulas. */
  now: Date;
}

const EXCEL_FORMATS: Record<string, string> = { n0: '#,##0', n2: '#,##0.00', c2: '#,##0.00', p0: '0%', d: '0' };

function excelFormat(format: string | undefined): string | undefined {
  if (!format) return undefined;
  if (EXCEL_FORMATS[format]) return EXCEL_FORMATS[format];
  if (/^[nNcC]\d$/.test(format)) return '#,##0.' + '0'.repeat(Number(format[1]));
  if (/[yMd]/.test(format)) return format.replace(/M/g, 'm').replace(/'/g, '"');
  return undefined;
}

/** Text controls of a band, with every table cell as a text at its place in the band. */
function textItems(band: Band): TextControl[] {
  return band.controls.flatMap((c): TextControl[] => {
    if (c.type === 'text') return [c];
    if (c.type !== 'table') return [];
    const out: TextControl[] = [];
    let y = c.y;
    for (const row of c.rows) {
      let column = 0;
      let x = c.x;
      for (const cell of row.cells) {
        const span = Math.max(1, Math.min(cell.colSpan ?? 1, c.columns.length - column));
        const width = c.columns.slice(column, column + span).reduce((a, b) => a + b, 0);
        if (column < c.columns.length) out.push({ id: `${c.id}`, type: 'text', x, y, width, height: row.height, text: cell.text, format: cell.format });
        x += width;
        column += span;
      }
      y += row.height;
    }
    return out;
  });
}

/**
 * The report's data as a table, for spreadsheets: one column per text control of the detail band
 * (left to right), headed by the caption printed above it, with typed values (numbers, dates).
 */
export function reportTable(definition: ReportDefinition, options: TableExportOptions): TableExport {
  const detail = definition.bands.find((b) => b.kind === 'detail');
  const cells = (detail ? textItems(detail) : []).sort((a, b) => a.x - b.x);
  // Closest to the detail band first: the innermost group header, then report header, then page header.
  const captions = [
    ...definition.bands.filter((b) => b.kind === 'groupHeader').reverse(),
    ...definition.bands.filter((b) => b.kind === 'reportHeader'),
    ...definition.bands.filter((b) => b.kind === 'pageHeader'),
  ];
  const headers = cells.map((c) => captionAbove(c, captions) ?? (isExpression(c.text) ? c.text.expression.replace(/^\[|\]$/g, '') : c.text));
  const { rows, parent } = resolveReportData(definition, options.data, options.sources);
  const params = resolveParameters(definition.parameters, options.params);
  const ctxBase = { parent, params, locale: options.locale, now: options.now, rows: rows ?? [], calculated: calculatedFieldMap(definition) };
  // The rows in the order the report prints them: by group (by key, or by a formula over the
  // group with `orderBy`), then by the detail's own sort keys.
  const keyOf = (row: unknown, expression: string, groupRows?: unknown[]) => {
    try {
      const v = evaluate(expression, { ...ctxBase, row, ...(groupRows ? { rows: groupRows } : {}) });
      return v instanceof Date ? v.getTime() : v;
    } catch {
      return null;
    }
  };
  const groups = definition.bands.filter((b) => b.kind === 'groupHeader' && b.groupBy?.expression.trim());
  const detailKeys = Array.isArray(detail?.sortBy) ? detail.sortBy.filter((k) => typeof k?.expression === 'string' && k.expression.trim()) : [];
  const all = rows ?? [];
  const groupKeys = new Map(all.map((row) => [row, groups.map((g) => keyOf(row, g.groupBy!.expression))]));
  // A group's `orderBy` value, worked out over the rows of that group (inside its parent groups).
  const groupValue = groups.map((g, level) => {
    const value = new Map<string, unknown>();
    if (!g.orderBy?.expression?.trim()) return value;
    const members = new Map<string, unknown[]>();
    for (const row of all) {
      const path = JSON.stringify(groupKeys.get(row)!.slice(0, level + 1));
      const list = members.get(path);
      if (list) list.push(row);
      else members.set(path, [row]);
    }
    for (const [path, groupRows] of members) value.set(path, keyOf(groupRows[0], g.orderBy.expression, groupRows));
    return value;
  });
  const sortKeys: { descending: boolean }[] = [];
  const rowKeys = new Map(
    all.map((row) => {
      const gk = groupKeys.get(row)!;
      const k: unknown[] = [];
      groups.forEach((g, level) => {
        if (g.orderBy?.expression?.trim()) k.push(groupValue[level].get(JSON.stringify(gk.slice(0, level + 1))));
        if (g.sort !== 'none' || g.orderBy?.expression?.trim()) k.push(gk[level]);
      });
      for (const d of detailKeys) k.push(keyOf(row, d.expression));
      return [row, k];
    }),
  );
  groups.forEach((g) => {
    if (g.orderBy?.expression?.trim()) sortKeys.push({ descending: !!g.orderBy.descending });
    if (g.sort !== 'none' || g.orderBy?.expression?.trim()) sortKeys.push({ descending: g.sort === 'desc' });
  });
  for (const d of detailKeys) sortKeys.push({ descending: !!d.descending });
  const collator = new Intl.Collator(options.locale || 'en-US', { numeric: true });
  const sorted = !sortKeys.length
    ? all
    : [...all].sort((ra, rb) => {
        const a = rowKeys.get(ra)!;
        const b = rowKeys.get(rb)!;
        for (let i = 0; i < sortKeys.length; i++) {
          const x = a[i];
          const y = b[i];
          if (x === y) continue;
          const c = x === null || x === undefined ? -1 : y === null || y === undefined ? 1 : typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
          if (c) return sortKeys[i].descending ? -c : c;
        }
        return 0;
      });
  // Groups past a group's `top` are left out, as in print (counted inside their parent group).
  const tops = groups.map((g) => (typeof g.top === 'number' && g.top > 0 ? Math.floor(g.top) : Infinity));
  let ordered = sorted;
  if (tops.some((t) => t !== Infinity)) {
    const rank = groups.map(() => 0);
    let previous: unknown[] | undefined;
    ordered = sorted.filter((row) => {
      const gk = groupKeys.get(row)!;
      groups.forEach((_, level) => {
        const parentChanged = !previous || gk.slice(0, level).some((k, i) => k !== previous![i]);
        if (parentChanged) rank[level] = 1;
        else if (gk[level] !== previous![level]) rank[level]++;
      });
      previous = gk;
      return rank.every((r, level) => r <= tops[level]);
    });
  }
  const table = ordered.map((row) =>
    cells.map((c) => {
      const ctx = { ...ctxBase, row };
      const run = (expression: string) => {
        try {
          return evaluate(expression, ctx);
        } catch {
          return '#ERR';
        }
      };
      const value = isExpression(c.text) ? run(c.text.expression) : c.text;
      // A rich text exports its words: no markers, fields filled in.
      if (c.markup) return plainRichText(parseRichText(value === null || value === undefined ? '' : String(value), (e) => String(run(e) ?? '')));
      return value;
    }),
  );
  return { headers, rows: table, formats: cells.map((c) => excelFormat(c.format)) };
}

/**
 * The column caption: a static text above the cell, horizontally over its centre and not much wider
 * than the cell (titles are wider), the lowest one in the nearest band (header rows sit right above
 * the detail rows).
 */
function captionAbove(cell: TextControl, bands: Band[]): string | undefined {
  const centre = cell.x + cell.width / 2;
  for (const band of bands) {
    const hits = textItems(band).filter(
      (c) =>
        typeof c.text === 'string' && c.text.trim() !== '' && c.x <= centre && centre <= c.x + c.width && c.width <= cell.width * 1.5,
    );
    if (hits.length) return hits.reduce((a, b) => (b.y > a.y ? b : a)).text as string;
  }
  return undefined;
}

// ── Minimal XLSX writer (stored zip, inline strings) ─────────────────────────

const escapeXml = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel serial date of a local calendar day/time. */
function excelDate(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Writes a one-sheet XLSX workbook: bold header row, typed cells, column formats, frozen header. */
export function writeXlsx(table: TableExport, sheetName = 'Report'): Uint8Array {
  const formats = [...new Set(table.formats.filter((f): f is string => !!f))];
  const defaultDate = 'dd.mm.yyyy';
  if (!formats.includes(defaultDate)) formats.push(defaultDate);
  const fmtId = (f: string) => 164 + formats.indexOf(f);
  // Style 0 normal, 1 bold header, 2.. one per number format.
  const styleOf = (f: string | undefined) => (f ? 2 + formats.indexOf(f) : 0);

  const sheetRows: string[] = [];
  const cell = (ref: string, value: unknown, format: string | undefined, header = false): string => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${styleOf(format)}"><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
    const date = value instanceof Date ? value : typeof value === 'string' && !header ? toDate(value) : null;
    if (date) return `<c r="${ref}" s="${styleOf(format && /[dmy]/.test(format) ? format : defaultDate)}"><v>${excelDate(date)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
  };
  sheetRows.push(`<row r="1">${table.headers.map((h, i) => cell(`${columnName(i)}1`, h, undefined, true)).join('')}</row>`);
  table.rows.forEach((row, r) => {
    sheetRows.push(`<row r="${r + 2}">${row.map((v, i) => cell(`${columnName(i)}${r + 2}`, v, table.formats[i])).join('')}</row>`);
  });
  const widths = table.headers.map((h, i) => {
    const longest = Math.max(h.length, ...table.rows.slice(0, 200).map((row) => String(row[i] ?? '').length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, longest + 2))}" customWidth="1"/>`;
  });

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (widths.length ? `<cols>${widths.join('')}</cols>` : '') +
    `<sheetData>${sheetRows.join('')}</sheetData></worksheet>`;
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${formats.length}">${formats.map((f) => `<numFmt numFmtId="${fmtId(f)}" formatCode="${escapeXml(f)}"/>`).join('')}</numFmts>` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${2 + formats.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    formats.map((f) => `<xf numFmtId="${fmtId(f)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('') +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const name = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ];
  return storedZip(files.map(([path, text]) => [path, new TextEncoder().encode(text)]));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive with uncompressed entries — all XLSX needs, with no compression library. */
export function storedZip(files: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
