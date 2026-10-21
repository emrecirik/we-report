import { Band, Bindable, ReportControl, ReportParameter, ReportStyle, TableRow } from '../definition/report-definition';
import { roundMm, toMm } from '../units';
import { colorFrom, emptyReport, formatFrom, ImportResult, pageFor, validFormula } from './common';
import { child, children, parseXml, XmlElement } from './xml';

/**
 * Converts a DevExpress report layout (.repx saved as XML, XtraReports v18 and later) into a
 * we-report definition. Bands, labels, tables, panels, lines, shapes, pictures, barcodes, check
 * boxes, page info, groups, detail reports, styles, calculated fields and parameters are carried
 * over; what is not is listed in `warnings`. Older code-based (.repx as C#) layouts are refused.
 */
export function importRepx(source: string, name = 'Report'): ImportResult {
  if (!source.trimStart().startsWith('<')) {
    throw new Error('This .repx is saved as code (older DevExpress versions). Open it in a current DevExpress designer and save it again, which writes XML.');
  }
  return new RepxImport(parseXml(source), name).run();
}

const SYMBOLOGIES: Readonly<Record<string, string>> = {
  Code128: 'code128', Code39: 'code39', Code39Extended: 'code39ext', Code93: 'code93', EAN13: 'ean13', EAN8: 'ean8',
  UPCA: 'upca', UPCE0: 'upce', Interleaved2of5: 'interleaved2of5', ITF14: 'itf14', QRCode: 'qrcode', DataMatrix: 'datamatrix',
  PDF417: 'pdf417', Codabar: 'rationalizedCodabar', EAN128: 'gs1-128', DataBar: 'databaromni', AztecCode: 'azteccode',
};

/** DevExpress criteria language → ours: nearly the same; aggregates and a few names differ. */
export function devExpressToFormula(expression: string, calculated: Map<string, string> = new Map()): string | null {
  let e = expression.trim();
  // Calculated fields have no counterpart: their formula is put in place (they may use each
  // other, a few levels deep). A size cap stops formulas that double at every level.
  for (let depth = 0; depth < 5 && calculated.size; depth++) {
    const next = e.replace(/\[([^\]]+)\]/g, (whole, name: string) => (calculated.has(name) ? `(${calculated.get(name)})` : whole));
    if (next === e) break;
    if (next.length > 10_000) return null;
    e = next;
  }
  // Still a calculated field after five levels: nested too deep to convert.
  if ([...e.matchAll(/\[([^\]]+)\]/g)].some((m) => calculated.has(m[1]))) return null;
  e = e
    .replace(/\[Parameters\.(\w+)\]/g, '[?$1]')
    .replace(/(^|[^\w[\]'])\?(\w+)/g, '$1[?$2]')
    .replace(/\bsumCount\s*\([^)]*\)/gi, 'Count()')
    .replace(/\bsum(Sum|Avg|Min|Max)\s*\(/gi, (_, f: string) => `${f}(`)
    .replace(/\[DataSource\.RowCount\]/g, 'Count()')
    .replace(/\bToStr\s*\(/gi, 'ToString(')
    .replace(/\bGetYear\s*\(/gi, 'Year(')
    .replace(/\bGetMonth\s*\(/gi, 'Month(')
    .replace(/\bGetDay\s*\(/gi, 'Day(')
    .replace(/\bLocalDateTimeToday\s*\(\s*\)/gi, 'Today()')
    .replace(/\bLocalDateTimeNow\s*\(\s*\)/gi, 'Now()');
  e = e.replace(/\bFormatString\s*\(\s*'\{0:([^}']*)\}'\s*,\s*([^)]+)\)/gi, (whole, f: string, x: string) => {
    const ours = formatFrom(f);
    return ours ? `Format(${x}, '${ours}')` : whole;
  });
  if (/\bsum[A-Z]\w*\(|\[DataSource\.|\bIsNull\s*\([^,()]*\)/.test(e)) return null;
  return validFormula(e) ? e : null;
}

/** "{0:c2}" → c2; "Total: {0:n0} pcs" → the text around it as well. */
function formatString(f: string | undefined): { format?: string; before: string; after: string } {
  const m = /^(.*?)\{0(?::([^}]*))?\}(.*)$/s.exec(f ?? '');
  if (!m) return { before: '', after: '' };
  return { format: formatFrom(m[2]), before: m[1], after: m[3] };
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

class RepxImport {
  private readonly warnings: string[] = [];
  private readonly ids = new Set<string>();
  private readonly calculated = new Map<string, string>();
  private readonly styles: Record<string, ReportStyle> = {};
  private unit = 0.254; // mm per report unit: hundredths of an inch unless told otherwise
  private dpiPadding = 100;

  constructor(
    private readonly root: XmlElement,
    private readonly name: string,
  ) {}

  run(): ImportResult {
    const a = this.root.attrs;
    if (this.root.name !== 'XtraReportsLayoutSerializer') throw new Error('This is not a DevExpress report layout (.repx).');
    if (a['ReportUnit'] === 'TenthsOfAMillimeter') this.unit = 0.1;
    if (a['ReportUnit'] === 'Pixels') this.unit = 25.4 / 96;
    const margins = (a['Margins'] ?? '100, 100, 100, 100').split(',').map((v) => this.mm(v));
    const paper = a['PaperKind'];
    let width = this.mm(a['PageWidth']);
    let height = this.mm(a['PageHeight']);
    if (!width || !height) [width, height] = paper === 'Letter' || !paper ? [215.9, 279.4] : [210, 297];
    if (a['Landscape'] === 'true' && width < height) [width, height] = [height, width];
    const report = emptyReport(a['DisplayName'] || a['Name'] || this.name, pageFor(width, height, {
      left: margins[0] ?? 25.4, right: margins[1] ?? 25.4, top: margins[2] ?? 25.4, bottom: margins[3] ?? 25.4,
    }));
    const font = this.font(a['Font']);
    report.styles['default'] = { ...font };

    for (const s of this.items(child(this.root, 'StyleSheet'))) {
      // Style names become keys: plain names only (never __proto__ and friends).
      if (/^[\w -]+$/.test(s.attrs['Name'] ?? '') && !/^(__proto__|constructor|prototype)$/.test(s.attrs['Name'])) {
        this.styles[s.attrs['Name']] = this.styleOf(s) ?? {};
      }
    }
    Object.assign(report.styles, this.styles);
    // Calculated fields with a plain name stay calculated fields; any other is put in place where used.
    const fields = this.items(child(this.root, 'CalculatedFields')).filter((f) => f.attrs['Name'] && f.attrs['Expression']);
    for (const f of fields) if (!/^[\p{L}\p{N}_]+$/u.test(f.attrs['Name'])) this.calculated.set(f.attrs['Name'], f.attrs['Expression']);
    const kept: { name: string; expression: string }[] = [];
    for (const f of fields) {
      if (this.calculated.has(f.attrs['Name'])) continue;
      const expression = devExpressToFormula(f.attrs['Expression'], this.calculated);
      if (expression === null) this.warnings.push(`Calculated field "${f.attrs['Name']}": the expression ${f.attrs['Expression']} could not be converted.`);
      else kept.push({ name: f.attrs['Name'], expression });
    }
    if (kept.length) report.calculatedFields = kept;
    report.parameters = this.items(child(this.root, 'Parameters'))
      .filter((p) => /^\w+$/.test(p.attrs['Name'] ?? ''))
      .map((p) => this.parameter(p));
    report.dataSources.push({ id: 'data', name: 'Data', kind: 'json', data: null });
    report.dataMember = { dataSourceId: 'data', ...(a['DataMember'] ? { path: a['DataMember'] } : {}) };
    this.warnings.push('Add the report data under Data sources: a .repx keeps only where the data came from.');

    report.bands = this.bands(child(this.root, 'Bands'), false);
    if (a['Watermark'] || child(this.root, 'Watermark')) this.warnings.push('The watermark is not converted; set it again in the report properties.');
    return { report, warnings: this.warnings };
  }

  /** Children of a collection element (Item1, Item2 …) in order. */
  private items(e: XmlElement | undefined): XmlElement[] {
    return (e?.children ?? []).filter((c) => /^Item\d+$/.test(c.name)).sort((x, y) => Number(x.name.slice(4)) - Number(y.name.slice(4)));
  }

  private type(e: XmlElement): string {
    return (e.attrs['ControlType'] ?? '').split(',')[0].split('.').pop()!;
  }

  private mm(v: string | undefined): number {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) ? roundMm(n * this.unit) : 0;
  }

  private pair(v: string | undefined): [number, number] {
    const [x, y] = String(v ?? '0,0').split(',');
    return [this.mm(x), this.mm(y)];
  }

  private parameter(p: XmlElement): ReportParameter {
    const type = (p.attrs['Type'] ?? '').toLowerCase();
    return {
      name: p.attrs['Name'],
      type: /int|decimal|double|single/.test(type) ? 'number' : /date/.test(type) ? 'date' : /bool/.test(type) ? 'boolean' : 'string',
      label: p.attrs['Description'] || undefined,
      defaultValue: p.attrs['ValueInfo'] ?? undefined,
    };
  }

  private bands(e: XmlElement | undefined, inner: boolean): Band[] {
    const out: Band[] = [];
    const headers: { level: number; band: Band }[] = [];
    const footers: { level: number; band: Band }[] = [];
    for (const b of this.items(e)) {
      const type = this.type(b);
      const height = this.mm(b.attrs['HeightF'] ?? b.attrs['Height']);
      const kinds: Record<string, Band['kind']> = inner
        ? { DetailBand: 'subDetail', ReportHeaderBand: 'subHeader', ReportFooterBand: 'subFooter' }
        : { PageHeaderBand: 'pageHeader', ReportHeaderBand: 'reportHeader', GroupHeaderBand: 'groupHeader', DetailBand: 'detail',
            GroupFooterBand: 'groupFooter', ReportFooterBand: 'reportFooter', PageFooterBand: 'pageFooter' };
      const kind = Object.hasOwn(kinds, type) ? kinds[type] : undefined;
      if (type === 'DetailReportBand' && !inner) {
        const path = b.attrs['DataMember']?.split('.').pop();
        if (out.some((x) => x.kind === 'subDetail')) {
          this.warnings.push(`Detail report "${b.attrs['Name']}": only one detail report is converted (one inner list per report).`);
          continue;
        }
        if (!path) {
          this.warnings.push(`Detail report "${b.attrs['Name']}" without a data member is not converted.`);
          continue;
        }
        const sub = this.bands(child(b, 'Bands'), true);
        const detail = sub.find((x) => x.kind === 'subDetail');
        if (detail) detail.rowsPath = path;
        out.push(...sub);
        continue;
      }
      if (type === 'TopMarginBand' || type === 'BottomMarginBand') {
        if (this.items(child(b, 'Controls')).length) this.warnings.push(`Items in the ${type === 'TopMarginBand' ? 'top' : 'bottom'} margin are not converted; put them in the page header/footer.`);
        continue;
      }
      if (!kind) {
        this.warnings.push(`${type} "${b.attrs['Name']}" is not converted.`);
        continue;
      }
      const band: Band = { id: this.id(kind), kind, height, controls: this.controls(child(b, 'Controls'), 0, 0) };
      if (b.attrs['BackColor']) band.backgroundColor = colorFrom(b.attrs['BackColor']);
      const level = Number(b.attrs['Level'] ?? 0);
      if (kind === 'groupHeader') {
        const field = this.items(child(b, 'GroupFields'))[0];
        const groupFormula = field?.attrs['FieldName'] ? devExpressToFormula(`[${field.attrs['FieldName']}]`, this.calculated) : null;
        if (field?.attrs['FieldName'] && groupFormula === null) this.warnings.push(`Group "${b.attrs['Name']}": its field ${field.attrs['FieldName']} could not be converted.`);
        band.groupBy = { expression: groupFormula ?? '' };
        band.sort = field?.attrs['SortOrder'] === 'Descending' ? 'desc' : field?.attrs['SortOrder'] === 'None' ? 'none' : 'asc';
        if (b.attrs['RepeatEveryPage'] === 'true') band.repeatOnEveryPage = true;
        if (b.attrs['GroupUnion'] === 'WholePage' || b.attrs['GroupUnion'] === 'WholeGroup') band.keepTogether = true;
        if (b.attrs['GroupUnion'] === 'WithFirstDetail') band.keepWithFirstRow = true;
        headers.push({ level, band });
      } else if (kind === 'groupFooter') {
        footers.push({ level, band });
      }
      if (kind === 'reportFooter' && b.attrs['PrintAtBottom'] === 'true') band.printAtBottom = true;
      if (b.attrs['PageBreak'] === 'BeforeBand') band.pageBreakBefore = true;
      if (b.attrs['PageBreak'] === 'AfterBand') band.pageBreakAfter = true;
      band.height = roundMm(Math.max(band.height, ...band.controls.map((c) => c.y + c.height)));
      out.push(band);
    }
    // DevExpress: level 0 is the group nearest the detail rows. Ours: outermost header first.
    headers.sort((x, y) => y.level - x.level);
    for (const f of footers) f.band.groupHeaderId = headers.find((h) => h.level === f.level)?.band.id;
    const order = (b: Band) => ({ pageHeader: 0, reportHeader: 1, groupHeader: 2, detail: 3, subHeader: 3.1, subDetail: 3.2, subFooter: 3.3, groupFooter: 4, reportFooter: 5, pageFooter: 6 })[b.kind];
    const headerRank = (b: Band) => headers.findIndex((h) => h.band === b);
    // Footers close the innermost group first.
    const footerRank = (b: Band) => -headers.findIndex((h) => h.band.id === b.groupHeaderId);
    return out.sort((x, y) => order(x) - order(y) || (x.kind === 'groupHeader' ? headerRank(x) - headerRank(y) : x.kind === 'groupFooter' ? footerRank(x) - footerRank(y) : 0));
  }

  private controls(e: XmlElement | undefined, dx: number, dy: number): ReportControl[] {
    return this.items(e).flatMap((c) => this.control(c, dx, dy));
  }

  private binding(e: XmlElement, property: string): string | undefined {
    const b = this.items(child(e, 'ExpressionBindings')).find((x) => x.attrs['PropertyName'] === property);
    if (b?.attrs['Expression']) return b.attrs['Expression'];
    // Older layouts: DataBindings with a data member path.
    const old = this.items(child(e, 'DataBindings')).find((x) => x.attrs['PropertyName'] === property);
    return old?.attrs['DataMember'] ? `[${old.attrs['DataMember'].split('.').pop()}]` : undefined;
  }

  /** A bound property as a formula, or undefined with a warning when it cannot be converted. */
  private formula(e: XmlElement, property: string): string | undefined {
    const raw = this.binding(e, property);
    if (!raw) return undefined;
    // An old-style summary: Summary Func="Sum" on a bound label.
    const summary = child(e, 'Summary');
    const func = summary?.attrs['Func'];
    const expr = func && !/^sum/i.test(raw) && /^(Sum|Count|Avg|Min|Max)$/.test(func) ? (func === 'Count' ? 'Count()' : `${func}(${raw})`) : raw;
    const ours = devExpressToFormula(expr, this.calculated);
    if (ours === null) this.warnings.push(`"${e.attrs['Name']}": the expression ${raw} could not be converted.`);
    return ours ?? undefined;
  }

  private control(e: XmlElement, dx: number, dy: number): ReportControl[] {
    const type = this.type(e);
    const [lx, ly] = this.pair(e.attrs['LocationFloat'] ?? e.attrs['Location']);
    const [width, height] = this.pair(e.attrs['SizeF'] ?? e.attrs['Size']);
    const x = roundMm(lx + dx);
    const y = roundMm(ly + dy);
    const name = e.attrs['Name'];
    const style = e.attrs['StyleName'] && this.styles[e.attrs['StyleName']] ? e.attrs['StyleName'] : undefined;
    const styleOverrides = this.styleOf(e);
    const visible = this.formula(e, 'Visible');
    const common = { name, x, y, width, height, style, styleOverrides, ...(visible ? { visible: { expression: visible } } : {}) };
    switch (type) {
      case 'XRLabel':
      case 'XRTableCell': {
        const { text, format } = this.label(e);
        return [{ id: this.id('text'), type: 'text', ...common, text, format, canGrow: e.attrs['CanGrow'] === 'true' || undefined }];
      }
      case 'XRPageInfo': {
        const info = e.attrs['PageInfo'] ?? 'NumberOfTotal';
        const f = e.attrs['TextFormatString'];
        if (info === 'DateTime') return [{ id: this.id('page'), type: 'pageInfo', ...common, info: 'printDate', format: formatString(f).format }];
        const kind = info === 'Number' ? 'pageNumber' : info === 'Total' ? 'pageCount' : 'pageNofM';
        return [{ id: this.id('page'), type: 'pageInfo', ...common, info: kind, format: kind === 'pageNofM' && f ? f.replace(/\{(\d)(?::[^}]*)?\}/g, '{$1}') : undefined }];
      }
      case 'XRLine': {
        const d = e.attrs['LineDirection'];
        const direction = d === 'Vertical' ? 'vertical' : d === 'Slant' ? 'diagonalUp' : d === 'BackSlant' ? 'diagonalDown' : 'horizontal';
        return [{ id: this.id('line'), type: 'line', ...common, direction, lineWidth: roundMm(toMm(Number(e.attrs['LineWidth'] ?? 1), 'px')), color: colorFrom(e.attrs['ForeColor']) }];
      }
      case 'XRShape': {
        const shape = child(e, 'Shape');
        const kind = shape?.attrs['ShapeName'] === 'Ellipse' ? 'ellipse' : Number(shape?.attrs['Fillet'] ?? 0) > 0 ? 'roundedRectangle' : 'rectangle';
        const fill = colorFrom(e.attrs['FillColor']);
        const stroke = colorFrom(e.attrs['ForeColor']);
        const overrides: ReportStyle = { ...styleOverrides, ...(fill ? { backgroundColor: fill } : {}) };
        if (stroke) overrides.border = { width: roundMm(toMm(Number(e.attrs['LineWidth'] ?? 1), 'px')), color: stroke, sides: { top: true, right: true, bottom: true, left: true } };
        return [{ id: this.id('shape'), type: 'shape', ...common, styleOverrides: overrides, shape: kind }];
      }
      case 'XRPictureBox': {
        const sizing = e.attrs['Sizing'];
        const fit = sizing === 'StretchImage' ? 'stretch' : sizing === 'Normal' || sizing === 'AutoSize' ? 'none' : 'contain';
        const bound = this.formula(e, 'ImageSource') ?? this.formula(e, 'ImageUrl');
        const embedded = /^(img|svg),(.+)$/s.exec(e.attrs['ImageSource'] ?? '');
        const url = /^https?:\/\//i.test(e.attrs['ImageUrl'] ?? '') ? e.attrs['ImageUrl'] : '';
        const source: Bindable<string> = bound ? { expression: bound } : embedded?.[1] === 'img' ? `data:${this.mime(embedded[2])};base64,${embedded[2]}` : url;
        if (!source) this.warnings.push(`Picture "${name}": ${embedded?.[1] === 'svg' ? 'SVG pictures are not supported' : 'no picture found'}; choose it again.`);
        return [{ id: this.id('image'), type: 'image', ...common, source, fit }];
      }
      case 'XRBarCode': {
        const generator = (child(e, 'Symbology')?.attrs['ControlType'] ?? '').split(',')[0].split('.').pop()?.replace(/Generator$/, '') ?? '';
        const symbology = Object.hasOwn(SYMBOLOGIES, generator) ? SYMBOLOGIES[generator] : undefined;
        if (!symbology) this.warnings.push(`Barcode "${name}": ${generator || 'its'} symbology is not supported; Code 128 is used.`);
        const bound = this.formula(e, 'Text');
        return [{ id: this.id('barcode'), type: 'barcode', ...common, symbology: symbology ?? 'code128', value: bound ? { expression: bound } : (e.attrs['Text'] ?? ''), showText: e.attrs['ShowText'] !== 'false' && symbology !== 'qrcode' }];
      }
      case 'XRCheckBox': {
        const bound = this.formula(e, 'CheckBoxState') ?? this.formula(e, 'Checked');
        const checked: Bindable<boolean> = bound ? { expression: bound } : e.attrs['CheckBoxState'] === 'Checked' || e.attrs['Checked'] === 'true';
        return [{ id: this.id('checkbox'), type: 'checkbox', ...common, checked }];
      }
      case 'XRPanel':
        return [
          ...(styleOverrides?.border || styleOverrides?.backgroundColor ? [{ id: this.id('shape'), type: 'shape' as const, ...common, shape: 'rectangle' as const }] : []),
          ...this.controls(child(e, 'Controls'), x, y),
        ];
      case 'XRTable':
        return [this.table(e, common)];
      default:
        this.warnings.push(`${type || 'An item'} "${name}" is not converted.`);
        return [];
    }
  }

  /** A label's text: fixed, or a formula wrapped with the format string's surrounding text. */
  private label(e: XmlElement): { text: Bindable<string>; format?: string } {
    const bound = this.formula(e, 'Text');
    const f = formatString(e.attrs['TextFormatString'] ?? this.items(child(e, 'DataBindings'))[0]?.attrs['FormatString'] ?? child(e, 'Summary')?.attrs['FormatString']);
    if (!bound) return { text: e.attrs['Text'] ?? '' };
    if (!f.before && !f.after) return { text: { expression: bound }, format: f.format };
    const value = f.format ? `Format(${bound}, ${quote(f.format)})` : `(${bound})`;
    return { text: { expression: [f.before ? quote(f.before) : '', value, f.after ? quote(f.after) : ''].filter(Boolean).join(' + ') } };
  }

  private table(e: XmlElement, common: { x: number; y: number; width: number; height: number } & Record<string, unknown>): ReportControl {
    const rows = this.items(child(e, 'Rows'));
    // Cell widths are weights of the table's width; columns come from the row with most cells.
    const widest = rows.reduce((a, r) => (this.items(child(r, 'Cells')).length > this.items(child(a, 'Cells')).length ? r : a), rows[0]);
    const weights = this.items(child(widest, 'Cells')).map((c) => Number(c.attrs['Weight'] ?? 1));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const columns = weights.map((w) => roundMm((common.width * w) / total));
    const rowWeights = rows.map((r) => Number(r.attrs['Weight'] ?? 1));
    const rowTotal = rowWeights.reduce((a, b) => a + b, 0) || 1;
    // Column boundaries as fractions of the width; a cell spans the columns between its edges.
    const bounds: number[] = [0];
    for (const w of weights) bounds.push(bounds[bounds.length - 1] + w / total);
    const nearest = (f: number) => bounds.reduce((best, b, i) => (Math.abs(b - f) < Math.abs(bounds[best] - f) ? i : best), 0);
    const tableRows: TableRow[] = rows.map((r, i) => {
      const cellEls = this.items(child(r, 'Cells'));
      const rowTotalWeight = cellEls.reduce((a, c) => a + Number(c.attrs['Weight'] ?? 1), 0) || 1;
      let start = 0;
      let edge = 0;
      const cells = cellEls.map((c) => {
        const { text, format } = this.label(c);
        edge += Number(c.attrs['Weight'] ?? 1) / rowTotalWeight;
        const end = Math.min(weights.length, Math.max(start + 1, nearest(edge)));
        const span = end - start;
        start = end;
        return { text, format, colSpan: span > 1 ? span : undefined, styleOverrides: this.styleOf(c) };
      });
      return { height: roundMm((common.height * rowWeights[i]) / rowTotal), cells };
    });
    return { id: this.id('table'), ...(common as object), type: 'table', columns, rows: tableRows } as ReportControl;
  }

  private mime(base64: string): string {
    return base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  }

  private font(f: string | undefined): ReportStyle {
    if (!f) return {};
    const [family, size, ...rest] = f.split(',').map((p) => p.trim());
    const style = rest.join(',');
    const pt = /^([\d.]+)pt$/.exec(size ?? '');
    return {
      ...(family ? { fontFamily: family } : {}),
      ...(pt ? { fontSize: Number(pt[1]) } : {}),
      ...(/Bold/.test(style) ? { bold: true } : {}),
      ...(/Italic/.test(style) ? { italic: true } : {}),
      ...(/Underline/.test(style) ? { underline: true } : {}),
    };
  }

  /** Font, colours, alignment, padding and borders set on a control or a style. */
  private styleOf(e: XmlElement): ReportStyle | undefined {
    const a = e.attrs;
    const out: ReportStyle = this.font(a['Font']);
    const color = colorFrom(a['ForeColor']);
    if (color) out.color = color;
    const background = colorFrom(a['BackColor']);
    if (background) out.backgroundColor = background;
    const align = /^(Top|Middle|Bottom)(Left|Center|Right|Justify)$/.exec(a['TextAlignment'] ?? '');
    if (align) {
      out.verticalAlign = align[1].toLowerCase() as ReportStyle['verticalAlign'];
      out.textAlign = align[2] === 'Justify' ? 'justify' : (align[2].toLowerCase() as ReportStyle['textAlign']);
    }
    const padding = (a['Padding'] ?? '').split(',').map((v) => Number(v.trim()));
    if (padding.length >= 1 && Number.isFinite(padding[0]) && a['Padding']) out.padding = roundMm((padding[0] / (padding[4] || this.dpiPadding)) * 25.4);
    const borders = a['Borders'];
    if (borders && borders !== 'None') {
      const all = borders === 'All';
      out.border = {
        width: roundMm(toMm(Number(a['BorderWidth'] ?? 1), 'px')),
        color: colorFrom(a['BorderColor']) ?? '#000000',
        sides: { top: all || borders.includes('Top'), right: all || borders.includes('Right'), bottom: all || borders.includes('Bottom'), left: all || borders.includes('Left') },
      };
    }
    return Object.keys(out).length ? out : undefined;
  }

  private id(prefix: string): string {
    let n = 1;
    while (this.ids.has(`${prefix}${n}`)) n++;
    this.ids.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  }
}
