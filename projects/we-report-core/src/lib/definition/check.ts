import { parseExpression, ExpressionError, ExpressionNode } from '../expression/parser';
import { resolvePageGeometry } from './page';
import { Bindable, isExpression, ReportControl, ReportDefinition } from './report-definition';

/** `textCut` is found by the designer, which measures with the loaded fonts; `checkReport` does not report it. */
export type ReportIssueCode = 'outsidePage' | 'outsideColumn' | 'formulaError' | 'unknownField' | 'emptyFormula' | 'overlap' | 'textCut';

/** A design problem the designer can explain and often fix. Messages are localized by `code`. */
export interface ReportIssue {
  code: ReportIssueCode;
  severity: 'error' | 'warning';
  bandId: string;
  controlId: string;
  /** Field name, formula error text, or the other control's id — depending on the code. */
  detail?: string;
}

function fieldsOf(node: ExpressionNode, out: string[][]): void {
  switch (node.kind) {
    case 'field':
      out.push(node.path);
      break;
    case 'unary':
      fieldsOf(node.operand, out);
      break;
    case 'binary':
      fieldsOf(node.left, out);
      fieldsOf(node.right, out);
      break;
    case 'call':
      node.args.forEach((a) => fieldsOf(a, out));
      break;
  }
}

function bindings(c: ReportControl): Bindable<unknown>[] {
  const list: Bindable<unknown>[] = c.visible !== undefined ? [c.visible] : [];
  for (const rule of c.formatting ?? []) if (rule.when.trim()) list.push({ expression: rule.when });
  switch (c.type) {
    case 'text':
      return [...list, c.text];
    case 'barcode':
      return [...list, c.value];
    case 'image':
      return [...list, c.source];
    case 'checkbox':
      return [...list, c.checked];
    case 'table':
      return [...list, ...c.rows.flatMap((r) => r.cells.map((cell) => cell.text))];
    case 'chart':
      return [...list, ...[c.category, c.value].filter((e) => e.expression.trim())];
    case 'subreport':
      // The filter reads the sub-report's own fields, so only the formulas over the outer row are checked here.
      return [...list, ...(c.rows?.expression.trim() ? [c.rows] : []), ...(c.parameters ?? []).map((p) => p.value)];
    default:
      return list;
  }
}

/**
 * Static checks of a design. `rowFields` / `parentFields` (dotted paths) enable the unknown-field
 * check; without them field names are not judged.
 */
export function checkReport(def: ReportDefinition, rowFields?: string[], parentFields?: string[], paramNames?: string[], innerFields?: string[]): ReportIssue[] {
  const issues: ReportIssue[] = [];
  let width = Infinity;
  try {
    width = resolvePageGeometry(def.page).contentWidth;
  } catch {
    /* an invalid page is reported by the page settings themselves */
  }
  const rows = rowFields && new Set(rowFields);
  const parent = parentFields && new Set(parentFields);
  const params = new Set(paramNames ?? (def.parameters ?? []).map((p) => p.name));
  const inner = innerFields && new Set(innerFields);

  for (const band of def.bands) {
    const count = band.kind === 'detail' ? Math.max(1, Math.floor(band.columns?.count ?? 1)) : 1;
    const columnWidth = count > 1 ? (width - (band.columns?.gap ?? 0) * (count - 1)) / count : Infinity;
    // Inside an inner list a field is an item's, and `^.` reads the detail row around it.
    const own = band.kind.startsWith('sub') ? inner : rows;
    const outer = band.kind.startsWith('sub') ? rows : parent;
    for (const c of band.controls) {
      if (c.x + c.width > width + 0.01) issues.push({ code: 'outsidePage', severity: 'error', bandId: band.id, controlId: c.id });
      // Side-by-side rows: an item wider than its column runs into the next label.
      else if (c.x + c.width > columnWidth + 0.01) issues.push({ code: 'outsideColumn', severity: 'warning', bandId: band.id, controlId: c.id });
      for (const b of bindings(c)) {
        if (!isExpression(b)) continue;
        if (!b.expression.trim()) {
          issues.push({ code: 'emptyFormula', severity: 'warning', bandId: band.id, controlId: c.id });
          continue;
        }
        let node: ExpressionNode;
        try {
          node = parseExpression(b.expression);
        } catch (e) {
          issues.push({ code: 'formulaError', severity: 'error', bandId: band.id, controlId: c.id, detail: (e as ExpressionError).message });
          continue;
        }
        const paths: string[][] = [];
        fieldsOf(node, paths);
        for (const path of paths) {
          const [head, ...rest] = path;
          const known =
            head === '^' ? !outer || outer.has(rest.join('.'))
            : head.startsWith('?') ? params.has(head.slice(1))
            : !own || own.has(path.join('.'));
          if (!known) issues.push({ code: 'unknownField', severity: 'warning', bandId: band.id, controlId: c.id, detail: path.join('.') });
        }
      }
    }
    // Overlapping texts print on top of each other; lines and shapes are often meant to overlap.
    const texts = band.controls.filter((c) => c.type === 'text' || c.type === 'pageInfo');
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w > 0.5 && h > 0.5 && w * h > 0.3 * Math.min(a.width * a.height, b.width * b.height)) {
          issues.push({ code: 'overlap', severity: 'warning', bandId: band.id, controlId: b.id, detail: a.id });
        }
      }
    }
  }
  return issues;
}
