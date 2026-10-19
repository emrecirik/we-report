import { CURRENT_DEFINITION_VERSION, PageSettings, ReportDefinition } from '../definition/report-definition';
import { parseExpression } from '../expression/parser';
import { PAPER_SIZES } from '../paper-sizes';
import { roundMm } from '../units';

/** A converted report and what could not be carried over, in plain words. */
export interface ImportResult {
  report: ReportDefinition;
  warnings: string[];
}


/** A named paper when the size matches one (either way round), else a custom size. */
export function pageFor(widthMm: number, heightMm: number, margins: PageSettings['margins']): PageSettings {
  const landscape = widthMm > heightMm;
  const [w, h] = landscape ? [heightMm, widthMm] : [widthMm, heightMm];
  const paper = PAPER_SIZES.find((p) => p.height !== null && Math.abs(p.width - w) < 1.5 && Math.abs(p.height - h) < 1.5);
  // Files store paper sizes rounded to their own units (A4 = 8.27in = 210.06 mm): the right and
  // bottom margins absorb the difference, so the printable area stays exactly the file's.
  const paperWidth = paper ? (landscape ? paper.height! : paper.width) : widthMm;
  const paperHeight = paper ? (landscape ? paper.width : paper.height!) : heightMm;
  const right = Math.max(0, margins.right + paperWidth - widthMm);
  const bottom = Math.max(0, margins.bottom + paperHeight - heightMm);
  return {
    paper: paper?.id ?? 'custom',
    orientation: landscape ? 'landscape' : 'portrait',
    margins: { top: roundMm(margins.top), right: roundMm(right), bottom: roundMm(bottom), left: roundMm(margins.left) },
    ...(paper ? {} : { width: roundMm(w), height: roundMm(h) }),
    displayUnit: 'mm',
  };
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', dimgray: '#696969', dimgrey: '#696969',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', silver: '#c0c0c0',
  gainsboro: '#dcdcdc', whitesmoke: '#f5f5f5', red: '#ff0000', darkred: '#8b0000', maroon: '#800000',
  green: '#008000', darkgreen: '#006400', blue: '#0000ff', navy: '#000080', darkblue: '#00008b',
  steelblue: '#4682b4', royalblue: '#4169e1', cornflowerblue: '#6495ed', lightblue: '#add8e6', teal: '#008080',
  orange: '#ffa500', darkorange: '#ff8c00', gold: '#ffd700', yellow: '#ffff00', purple: '#800080',
  brown: '#a52a2a', lightsteelblue: '#b0c4de', aliceblue: '#f0f8ff', beige: '#f5f5dc', ivory: '#fffff0',
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** `#rrggbb` from a colour name, `#rgb`, `#rrggbb`, `#aarrggbb`, `r, g, b` or `a, r, g, b`; `undefined` for transparent or unknown. */
export function colorFrom(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v || /^transparent$/i.test(v)) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + [...v.slice(1)].map((c) => c + c).join('')).toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(1, 3) === '00' ? undefined : ('#' + v.slice(3)).toLowerCase();
  const parts = v.split(',').map((p) => Number(p.trim()));
  if ((parts.length === 3 || parts.length === 4) && parts.every((n) => Number.isFinite(n))) {
    if (parts.length === 4 && parts[0] === 0) return undefined;
    const [r, g, b] = parts.slice(-3);
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }
  return NAMED_COLORS[v.toLowerCase()];
}

/** Whether our parser accepts the formula. */
export function validFormula(expression: string): boolean {
  try {
    parseExpression(expression);
    return true;
  } catch {
    return false;
  }
}

export function emptyReport(name: string, page: PageSettings): ReportDefinition {
  return { version: CURRENT_DEFINITION_VERSION, name, page, styles: { default: {} }, dataSources: [], bands: [] };
}

/** Our format for a .NET format string: `N2`/`n2` → `n2`, `C` → `c2`, `P0` → `p0`, date patterns kept. */
export function formatFrom(netFormat: string | undefined): string | undefined {
  const f = netFormat?.trim();
  if (!f) return undefined;
  const standard = /^([NnCcPpDdFf])(\d*)$/.exec(f);
  if (standard) {
    const kind = standard[1].toLowerCase();
    const digits = standard[2];
    if (kind === 'd' && !digits) return 'dd.MM.yyyy'; // .NET "d" is the short date
    if (kind === 'f') return `n${digits || '2'}`;
    return `${kind}${digits || (kind === 'p' ? '0' : kind === 'd' ? '' : '2')}`;
  }
  if (/^[#0,.]+$/.test(f)) return f.includes('.') ? `n${f.split('.')[1].length}` : 'n0';
  if (/[dMyHhms]/.test(f)) return f;
  return undefined;
}
