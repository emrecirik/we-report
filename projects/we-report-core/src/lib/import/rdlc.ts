import { Band, Bindable, ReportControl, ReportParameter, ReportStyle, TableCell, TableRow } from '../definition/report-definition';
import { roundMm, toMm } from '../units';
import { colorFrom, emptyReport, formatFrom, ImportResult, pageFor, validFormula } from './common';
import { child, children, parseXml, textAt, XmlElement } from './xml';

/**
 * Converts a Microsoft report (RDLC / RDL 2008–2016: Visual Studio, SSRS, Report Builder) into a
 * we-report definition. Text boxes, lines, rectangles, embedded images, the main table, page
 * header/footer, data set fields and parameters are carried over; what is not is listed in
 * `warnings`.
 */
export function importRdlc(source: string, name = 'Report'): ImportResult {
  return new RdlcImport(parseXml(source), name).run();
}

const UNITS: Record<string, 'mm' | 'cm' | 'in' | 'pt'> = { mm: 'mm', cm: 'cm', in: 'in', pt: 'pt' };

/** "2.5in", "1cm", "10mm", "12pt", "1pc" → millimetres. */
export function rdlSize(value: string | undefined): number {
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|pc)?\s*$/i.exec(value ?? '');
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = (m[2] ?? 'in').toLowerCase();
  return unit === 'pc' ? toMm(n * 12, 'pt') : toMm(n, UNITS[unit]);
}

/** Field names in expressions are the RDL field names; rows carry the data field names. */
type FieldMap = Map<string, string>;

/**
 * A VB report expression as one of our formulas. Static text (no leading "=") stays text. Returns
 * `null` for what cannot be translated (the caller keeps the original as text and warns).
 */
export function vbToFormula(value: string, fields: FieldMap = new Map()): Bindable<string> | null {
  if (!value.startsWith('=')) return value;
  let e = value.slice(1).trim();
  // Strings first, so nothing inside them is rewritten: "a & b" stays as written.
  const strings: string[] = [];
  e = e.replace(/"(?:[^"]|"")*"/g, (s) => {
    strings.push(s);
    return `\u0000${strings.length - 1}\u0000`;
  });
  // Aggregates take a scope as a second argument ("DataSet1"); our scope comes from the band.
  e = e.replace(/\b(Sum|Count|CountDistinct|Avg|Min|Max|First|Last)\s*\(((?:[^()]|\([^()]*\))*?),\s*\u0000\d+\u0000\s*\)/gi, '$1($2)');
  e = e
    .replace(/Fields!(\w+)\.Value/gi, (_, f: string) => `[${fields.get(f) ?? f}]`)
    .replace(/Parameters!(\w+)\.(Value|Label)/gi, (_, p: string) => `[?${p}]`)
    .replace(/\bCountRows\s*\(\s*\)/gi, 'Count()')
    .replace(/\b(First|Last)\s*\(\s*(\[[^\]]+\])\s*\)/gi, '$2')
    .replace(/\bIIF\s*\(/gi, 'Iif(')
    .replace(/\bUCase\s*\(/gi, 'Upper(')
    .replace(/\bLCase\s*\(/gi, 'Lower(')
    .replace(/\bCStr\s*\(/gi, 'ToString(')
    .replace(/\bC(Int|Dbl|Dec|Lng|Sng)\s*\(/gi, 'ToNumber(')
    .replace(/\bNow\b(?!\s*\()/gi, 'Now()')
    .replace(/\bToday\b(?!\s*\()/gi, 'Today()')
    .replace(/\bNothing\b/gi, 'null')
    .replace(/Globals!(Overall)?PageNumber\b/gi, '[PageNumber]')
    .replace(/Globals!(Overall)?TotalPages\b/gi, '[Pages]')
    .replace(/&/g, '+');
  // Format(x, "N2") → Format(x, 'n2'): .NET format strings to ours.
  e = e.replace(/\bFormat\s*\(([^,]+),\s*\u0000(\d+)\u0000\s*\)/gi, (whole, x: string, i: string) => {
    const f = formatFrom(strings[Number(i)].slice(1, -1).replace(/""/g, '"'));
    return f ? `Format(${x}, '${f.replace(/'/g, "''")}')` : whole;
  });
  e = e.replace(/\u0000(\d+)\u0000/g, (_, i: string) => strings[Number(i)]);
  if (/Globals!|ReportItems!|Code\.|Lookup|RunningValue|Previous\(/i.test(e)) return null;
  return validFormula(e) ? { expression: e } : null;
}

/** `=Globals!PageNumber` and friends → a page-info control, when that is the whole expression. */
function pageInfoOf(value: string): { info: 'pageNumber' | 'pageCount' | 'pageNofM' | 'printDate'; format?: string } | null {
  const v = value.replace(/\s+/g, '');
  if (/^=Globals!PageNumber$/i.test(v)) return { info: 'pageNumber' };
  if (/^=Globals!TotalPages$/i.test(v)) return { info: 'pageCount' };
  if (/^=Globals!ExecutionTime$/i.test(v)) return { info: 'printDate' };
  const m = /^="([^"]*)"&Globals!PageNumber&"([^"]*)"&Globals!TotalPages(?:&"([^"]*)")?$/i.exec(value.replace(/\s*&\s*/g, '&').trim());
  if (m) return { info: 'pageNofM', format: `${m[1]}{0}${m[2]}{1}${m[3] ?? ''}` };
  return null;
}

class RdlcImport {
  private readonly warnings: string[] = [];
  private readonly fields: FieldMap = new Map();
  private ids = new Set<string>();
  private readonly images = new Map<string, string>();

  constructor(
    private readonly root: XmlElement,
    private readonly name: string,
  ) {}

  run(): ImportResult {
    if (this.root.name !== 'Report') throw new Error('This is not an RDLC/RDL report file.');
    // RDL 2010+ wraps body and page in ReportSections; RDL 2008 has them on the report.
    const section = child(child(this.root, 'ReportSections'), 'ReportSection') ?? this.root;
    const page = child(section, 'Page') ?? this.root;
    const pageSize = (n: string) => rdlSize(textAt(page, n) ?? textAt(this.root, n));
    const width = pageSize('PageWidth') || 215.9;
    const height = pageSize('PageHeight') || 279.4;
    const margin = (n: string) => pageSize(n);
    const report = emptyReport(textAt(this.root, 'Description') || this.name, pageFor(width, height, {
      top: margin('TopMargin'), right: margin('RightMargin'), bottom: margin('BottomMargin'), left: margin('LeftMargin'),
    }));

    for (const img of children(child(this.root, 'EmbeddedImages'), 'EmbeddedImage')) {
      const mime = textAt(img, 'MIMEType') ?? 'image/png';
      const data = textAt(img, 'ImageData');
      if (data && img.attrs['Name']) this.images.set(img.attrs['Name'], `data:${mime};base64,${data.replace(/\s+/g, '')}`);
    }

    const dataSet = children(child(this.root, 'DataSets'), 'DataSet')[0];
    if (dataSet) {
      for (const f of children(child(dataSet, 'Fields'), 'Field')) {
        const dataField = textAt(f, 'DataField');
        if (f.attrs['Name'] && dataField) this.fields.set(f.attrs['Name'], dataField);
      }
      const id = (dataSet.attrs['Name'] || 'data').replace(/[^\w-]/g, '_');
      report.dataSources.push({ id, name: dataSet.attrs['Name'] || 'Data', kind: 'json', data: null });
      report.dataMember = { dataSourceId: id };
      this.warnings.push(`Data set "${dataSet.attrs['Name']}": add its data under Data sources (the file holds only the field list).`);
    }
    report.parameters = children(child(this.root, 'ReportParameters'), 'ReportParameter')
      .filter((p) => /^\w+$/.test(p.attrs['Name'] ?? ''))
      .map((p) => this.parameter(p));

    const header = child(page, 'PageHeader');
    const footer = child(page, 'PageFooter');
    const pageBand = (kind: 'pageHeader' | 'pageFooter', el: XmlElement): Band => {
      const band = this.band(kind, rdlSize(textAt(el, 'Height')), child(el, 'ReportItems'));
      if (textAt(el, 'PrintOnFirstPage')?.toLowerCase() === 'false') band.printOnFirstPage = false;
      if (textAt(el, 'PrintOnLastPage')?.toLowerCase() === 'false') band.printOnLastPage = false;
      return band;
    };
    if (header) report.bands.push(pageBand('pageHeader', header));
    report.bands.push(...this.body(child(section, 'Body')));
    if (footer) report.bands.push(pageBand('pageFooter', footer));
    return { report, warnings: this.warnings };
  }

  private parameter(p: XmlElement): ReportParameter {
    const type = (textAt(p, 'DataType') ?? 'String').toLowerCase();
    const def = textAt(p, 'DefaultValue', 'Values', 'Value');
    return {
      name: p.attrs['Name'],
      type: type === 'boolean' ? 'boolean' : type === 'datetime' ? 'date' : type === 'integer' || type === 'float' ? 'number' : 'string',
      label: textAt(p, 'Prompt') || undefined,
      defaultValue: def && !def.startsWith('=') ? def : undefined,
    };
  }

  /**
   * The body around its main table: what is above the table and the table's header rows print
   * once at the start, its detail rows once per data row, its total rows and everything below
   * once at the end. Without a table the body is the detail section.
   */
  private body(body: XmlElement | undefined): Band[] {
    const items = child(body, 'ReportItems');
    const bodyHeight = rdlSize(textAt(body, 'Height'));
    const tablix = items?.children.find((i) => i.name === 'Tablix' || i.name === 'Table');
    if (!tablix) return [this.band('detail', bodyHeight, items)];
    if (tablix.name === 'Table') this.warnings.push('RDL 2005 tables are not converted; save the report in a newer format first.');
    for (const other of items!.children.filter((i) => (i.name === 'Tablix' || i.name === 'Table') && i !== tablix)) {
      this.warnings.push(`Table "${other.attrs['Name']}": only the first table of the body becomes the detail section.`);
    }
    const top = rdlSize(textAt(tablix, 'Top'));
    const left = rdlSize(textAt(tablix, 'Left'));
    const { header, detail, footer, columns } = this.tablix(tablix);
    const above = items!.children.filter((i) => i !== tablix && rdlSize(textAt(i, 'Top')) < top);
    const below = items!.children.filter((i) => i !== tablix && rdlSize(textAt(i, 'Top')) >= top);
    const bands: Band[] = [];
    const reportHeader = this.bandOf('reportHeader', above, 0);
    if (header.length) {
      // The header rows stay where the table starts, under whatever is above it.
      reportHeader.controls.push(this.table(header, columns, left, top));
      reportHeader.height = roundMm(top + header.reduce((a, r) => a + r.height, 0));
    }
    if (reportHeader.controls.length) bands.push(reportHeader);
    const detailBand: Band = { id: this.id('detail'), kind: 'detail', height: roundMm(detail.reduce((a, r) => a + r.height, 0)), controls: [] };
    if (detail.length) detailBand.controls.push(this.table(detail, columns, left, 0));
    bands.push(detailBand);
    const tableHeight = rdlSize(textAt(tablix, 'Height'));
    const reportFooter = this.bandOf('reportFooter', [], 0);
    if (footer.length) {
      reportFooter.controls.push(this.table(footer, columns, left, 0));
      reportFooter.height = roundMm(footer.reduce((a, r) => a + r.height, 0));
    }
    const offset = reportFooter.height - (top + tableHeight);
    for (const item of below) reportFooter.controls.push(...this.item(item, 0, offset));
    reportFooter.height = roundMm(Math.max(reportFooter.height, bodyHeight + offset));
    if (reportFooter.controls.length) bands.push(reportFooter);
    return bands;
  }

  /** Rows of a table split by the details group, plus its column widths. */
  private tablix(t: XmlElement): { header: TableRow[]; detail: TableRow[]; footer: TableRow[]; columns: number[] } {
    const bodyEl = child(t, 'TablixBody');
    const columns = children(child(bodyEl, 'TablixColumns'), 'TablixColumn').map((c) => roundMm(rdlSize(textAt(c, 'Width'))));
    const rows = children(child(bodyEl, 'TablixRows'), 'TablixRow').map((r) => this.row(r));
    // Leaf members of the row hierarchy are the rows, in order; the one under a group without
    // group expressions is the details row.
    const leaves: { details: boolean; grouped: boolean }[] = [];
    const walk = (members: XmlElement | undefined, details: boolean, grouped: boolean) => {
      for (const m of children(members, 'TablixMember')) {
        const group = child(m, 'Group');
        const isDetails = details || (!!group && !child(group, 'GroupExpressions'));
        const isGrouped = grouped || (!!group && !!child(group, 'GroupExpressions'));
        const inner = child(m, 'TablixMembers');
        if (inner) walk(inner, isDetails, isGrouped);
        else leaves.push({ details: isDetails, grouped: isGrouped });
      }
    };
    walk(child(child(t, 'TablixRowHierarchy'), 'TablixMembers'), false, false);
    if (leaves.some((l) => l.grouped)) this.warnings.push(`Table "${t.attrs['Name']}": its row groups are not converted; add groups with Add section → Group by.`);
    const first = leaves.findIndex((l) => l.details);
    const last = leaves.length - 1 - [...leaves].reverse().findIndex((l) => l.details);
    if (first < 0) return { header: rows, detail: [], footer: [], columns };
    return { header: rows.slice(0, first), detail: rows.slice(first, last + 1), footer: rows.slice(last + 1), columns };
  }

  private row(r: XmlElement): TableRow {
    const cells: TableCell[] = [];
    let skip = 0;
    for (const c of children(child(r, 'TablixCells'), 'TablixCell')) {
      // Cells covered by a span are written as empty placeholders.
      if (skip > 0) {
        skip--;
        continue;
      }
      const contents = child(c, 'CellContents');
      const span = Number(textAt(contents, 'ColSpan') ?? 1) || 1;
      skip = span - 1;
      const box = contents?.children.find((x) => x.name === 'Textbox');
      const text = box ? this.textOf(box) : { text: '' as Bindable<string> };
      cells.push({ text: text.text, format: text.format, colSpan: span > 1 ? span : undefined, styleOverrides: box ? this.style(box) : undefined });
    }
    return { height: roundMm(rdlSize(textAt(r, 'Height'))), cells };
  }

  private table(rows: TableRow[], columns: number[], x: number, y: number): ReportControl {
    return {
      id: this.id('table'), type: 'table', x: roundMm(x), y: roundMm(y),
      width: roundMm(columns.reduce((a, b) => a + b, 0)), height: roundMm(rows.reduce((a, r) => a + r.height, 0)),
      columns, rows, canGrow: true,
    };
  }

  private band(kind: Band['kind'], height: number, items: XmlElement | undefined): Band {
    return this.bandOf(kind, items?.children ?? [], height);
  }

  private bandOf(kind: Band['kind'], items: XmlElement[], height: number): Band {
    const band: Band = { id: this.id(kind), kind, height: roundMm(height), controls: [] };
    for (const item of items) band.controls.push(...this.item(item, 0, 0));
    band.height = roundMm(Math.max(band.height, ...band.controls.map((c) => c.y + c.height)));
    return band;
  }

  /** One report item (and the items inside a rectangle) at its place, moved by (dx, dy). */
  private item(e: XmlElement, dx: number, dy: number): ReportControl[] {
    const x = roundMm(rdlSize(textAt(e, 'Left')) + dx);
    const y = roundMm(Math.max(0, rdlSize(textAt(e, 'Top')) + dy));
    const width = roundMm(rdlSize(textAt(e, 'Width')));
    const height = roundMm(rdlSize(textAt(e, 'Height')));
    const name = e.attrs['Name'];
    switch (e.name) {
      case 'Textbox': {
        const value = this.runs(e).map((r) => r.value).join('');
        const page = pageInfoOf(value);
        const styleOverrides = this.style(e);
        if (page) return [{ id: this.id('page'), name, type: 'pageInfo', x, y, width, height, ...page, styleOverrides }];
        const { text, format } = this.textOf(e);
        const canGrow = textAt(e, 'CanGrow') === 'true' || undefined;
        return [{ id: this.id('text'), name, type: 'text', x, y, width, height, text, format, canGrow, styleOverrides }];
      }
      case 'Line': {
        const border = this.borderOf(child(e, 'Style'));
        const direction = height < 0.01 ? 'horizontal' : width < 0.01 ? 'vertical' : 'diagonalDown';
        return [{ id: this.id('line'), name, type: 'line', x, y, width: Math.max(width, 0.5), height: Math.max(height, 0.5), direction, lineWidth: border?.width ?? 0.25, color: border?.color }];
      }
      case 'Rectangle': {
        const style = this.style(e);
        const shape: ReportControl[] = style?.border || style?.backgroundColor ? [{ id: this.id('shape'), name, type: 'shape', x, y, width, height, shape: 'rectangle', styleOverrides: style }] : [];
        return [...shape, ...(child(e, 'ReportItems')?.children ?? []).flatMap((i) => this.item(i, x, y))];
      }
      case 'Image': {
        const source = textAt(e, 'Source');
        const value = textAt(e, 'Value') ?? '';
        const sizing = textAt(e, 'Sizing');
        const fit = sizing === 'Fit' ? 'stretch' : sizing === 'Clip' || sizing === 'AutoSize' ? 'none' : 'contain';
        let src: Bindable<string> = '';
        if (source === 'Embedded') src = this.images.get(value) ?? '';
        else if (source === 'Database') src = vbToFormula(value, this.fields) ?? '';
        // An external picture from a web address (or a formula giving one) is fetched by the viewer.
        else if (source === 'External') src = /^https?:\/\//i.test(value.trim()) ? value.trim() : value.startsWith('=') ? (vbToFormula(value, this.fields) ?? '') : '';
        if (!src) this.warnings.push(`Image "${name}": ${source === 'External' ? 'only pictures from a web address (https://…) are loaded; choose the picture again' : 'its picture could not be read'}.`);
        return [{ id: this.id('image'), name, type: 'image', x, y, width, height, source: src, fit }];
      }
      case 'Subreport':
      case 'Chart':
      case 'GaugePanel':
      case 'Map':
      case 'List':
      case 'Matrix':
      case 'Tablix':
        this.warnings.push(`${e.name} "${name}" is not converted.`);
        return [];
      default:
        return [];
    }
  }

  private runs(box: XmlElement): { value: string; style?: XmlElement }[] {
    const paragraphs = children(child(box, 'Paragraphs'), 'Paragraph');
    if (!paragraphs.length) return [{ value: textAt(box, 'Value') ?? '' }];
    return paragraphs.flatMap((p, i) => [
      ...(i > 0 ? [{ value: '\n' }] : []),
      ...children(child(p, 'TextRuns'), 'TextRun').map((r) => ({ value: textAt(r, 'Value') ?? '', style: child(r, 'Style') })),
    ]);
  }

  /** The text of a text box: one run as is, several runs joined into one formula. */
  private textOf(box: XmlElement): { text: Bindable<string>; format?: string } {
    const runs = this.runs(box).filter((r) => r.value !== '');
    const format = formatFrom(runs.map((r) => textAt(r.style, 'Format')).find(Boolean) ?? textAt(box, 'Style', 'Format'));
    if (runs.every((r) => !r.value.startsWith('='))) return { text: runs.map((r) => r.value).join(''), format };
    const parts = runs.map((r) => {
      const f = vbToFormula(r.value, this.fields);
      if (f === null) {
        this.warnings.push(`Text box "${box.attrs['Name']}": the formula ${r.value} could not be converted; it is shown as text.`);
        return `'${r.value.replace(/'/g, "''")}'`;
      }
      return typeof f === 'string' ? `'${f.replace(/'/g, "''")}'` : runs.length > 1 ? `(${f.expression})` : f.expression;
    });
    return { text: { expression: parts.join(' + ') }, format };
  }

  /** Text box style, then its first paragraph's and first text run's (RDL 2010 puts fonts there). */
  private style(box: XmlElement): ReportStyle | undefined {
    const first = children(child(box, 'Paragraphs'), 'Paragraph')[0];
    const run = children(child(first, 'TextRuns'), 'TextRun')[0];
    const styles = [child(box, 'Style'), child(first, 'Style'), child(run, 'Style')].filter((s): s is XmlElement => !!s);
    const out: ReportStyle = {};
    for (const s of styles) {
      const get = (n: string) => textAt(s, n);
      const family = get('FontFamily');
      if (family && !family.startsWith('=')) out.fontFamily = family;
      if (get('FontSize')) out.fontSize = Math.round(rdlSize(get('FontSize')) / toMm(1, 'pt') * 10) / 10;
      if (get('FontWeight')) out.bold = /bold|black|heavy|semibold/i.test(get('FontWeight')!);
      if (get('FontStyle')) out.italic = /italic/i.test(get('FontStyle')!);
      if (get('TextDecoration')) out.underline = /underline/i.test(get('TextDecoration')!);
      const color = colorFrom(get('Color'));
      if (color) out.color = color;
      const background = colorFrom(get('BackgroundColor'));
      if (background) out.backgroundColor = background;
      const align = get('TextAlign')?.toLowerCase();
      if (align === 'left' || align === 'center' || align === 'right') out.textAlign = align;
      const valign = get('VerticalAlign')?.toLowerCase();
      if (valign === 'top' || valign === 'middle' || valign === 'bottom') out.verticalAlign = valign;
      const padding = get('PaddingLeft');
      if (padding) out.padding = roundMm(rdlSize(padding));
      const border = this.borderOf(s);
      if (border) out.border = border;
    }
    return Object.keys(out).length ? out : undefined;
  }

  private borderOf(style: XmlElement | undefined): ReportStyle['border'] {
    const side = (n: string) => {
      const b = child(style, n);
      const kind = textAt(b, 'Style');
      return b && kind && !/^none$/i.test(kind) ? { width: rdlSize(textAt(b, 'Width') ?? '1pt'), color: colorFrom(textAt(b, 'Color')) ?? '#000000' } : null;
    };
    const all = side('Border');
    const sides = { top: side('TopBorder') ?? all, right: side('RightBorder') ?? all, bottom: side('BottomBorder') ?? all, left: side('LeftBorder') ?? all };
    const any = sides.top ?? sides.right ?? sides.bottom ?? sides.left;
    if (!any) return undefined;
    return {
      width: roundMm(any.width),
      color: any.color,
      sides: { top: !!sides.top, right: !!sides.right, bottom: !!sides.bottom, left: !!sides.left },
    };
  }

  private id(prefix: string): string {
    let n = 1;
    while (this.ids.has(`${prefix}${n}`)) n++;
    this.ids.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  }
}
