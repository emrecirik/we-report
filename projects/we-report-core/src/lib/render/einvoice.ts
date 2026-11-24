// A report's e-invoice mapping (`ReportDefinition.eInvoice`) worked out against its data: the
// invoice fields from the object around the rows, one invoice line per detail row in data order
// (the detail band's sorting and grouping do not apply).
import { calculatedFieldMap, resolveReportData } from '../data/data-source';
import { resolveParameters } from '../data/web-service';
import { EInvoicePartyMapping, ReportDefinition } from '../definition/report-definition';
import { evaluate, EvaluationContext } from '../expression/evaluate';
import { toDate } from '../format';
import { WeReportInvoice, WeReportInvoiceParty, WeReportVatCategory } from './cii';

export interface WeReportEInvoiceOptions {
  /** Rows (or the object holding them), as for `layoutReport`. */
  data?: unknown;
  sources?: Record<string, unknown>;
  params?: Record<string, unknown>;
  /** The object around the rows when the data does not hold it (what `[^.field]` reads). */
  parent?: unknown;
  now?: Date;
  /** Used when the report names none, as in `layoutReport`. */
  locale?: string;
  /** Used when neither the mapping nor the report names one. */
  currency?: string;
}

const CATEGORIES: readonly string[] = ['S', 'Z', 'E', 'AE'];

/**
 * The invoice a report's `eInvoice` mapping describes, ready for `weReportCiiInvoice`. Throws an
 * `Error` naming the field when a required value is empty, not a number or not a date.
 */
export function weReportEInvoice(definition: ReportDefinition, options: WeReportEInvoiceOptions = {}): WeReportInvoice {
  const map = definition.eInvoice;
  if (!map) throw new Error('The report has no e-invoice mapping.');
  const { rows, parent } = resolveReportData(definition, options.data, options.sources);
  const all = rows ?? [];
  const base: EvaluationContext = {
    rows: all,
    allRows: all,
    parent: options.parent ?? parent,
    params: resolveParameters(definition.parameters, options.params),
    calculated: calculatedFieldMap(definition),
    locale: definition.locale || options.locale,
    currency: definition.currency || options.currency,
    now: options.now,
  };

  const value = (field: string, src: string | undefined, row: unknown): unknown => {
    if (typeof src !== 'string' || !src.trim()) return undefined;
    try {
      return evaluate(src, { ...base, row });
    } catch (e) {
      throw new Error(`${field}: ${(e as Error).message}`);
    }
  };
  const text = (field: string, src: string | undefined, row: unknown): string | undefined => {
    const v = value(field, src, row);
    const s = v == null ? '' : String(v).trim();
    return s || undefined;
  };
  const required = (field: string, src: string | undefined, row: unknown): string => {
    const s = text(field, src, row);
    if (!s) throw new Error(`${field} is empty.`);
    return s;
  };
  const number = (field: string, src: string | undefined, row: unknown): number => {
    const v = value(field, src, row);
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    if (!Number.isFinite(n)) throw new Error(`${field} is not a number.`);
    return n;
  };
  // Report dates are local calendar days; the XML writes UTC days, so keep the day, not the instant
  const date = (field: string, src: string | undefined, row: unknown): Date | undefined => {
    const v = value(field, src, row);
    if (v == null || v === '') return undefined;
    // A date-time keeps the day written in it, not the day it falls on in this machine's time zone
    const d = toDate(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v);
    if (!d) throw new Error(`${field} is not a date.`);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  };
  const party = (field: string, m: EInvoicePartyMapping | undefined, row: unknown): WeReportInvoiceParty => ({
    name: required(`${field}.name`, m?.name, row),
    address: text(`${field}.address`, m?.address, row),
    postcode: text(`${field}.postcode`, m?.postcode, row),
    city: text(`${field}.city`, m?.city, row),
    country: required(`${field}.country`, m?.country, row).toUpperCase(),
    vatId: text(`${field}.vatId`, m?.vatId, row),
  });

  const head = all[0];
  const issueDate = date('issueDate', map.issueDate, head);
  if (!issueDate) throw new Error('issueDate is empty.');
  const currency = text('currency', map.currency, head) ?? (definition.currency || options.currency);
  if (!currency) throw new Error('currency is empty.');
  const iban = text('iban', map.iban, head);
  const line = map.line ?? ({} as Partial<typeof map.line>);
  if (!all.length) throw new Error('The invoice has no lines.');
  return {
    number: required('number', map.number, head),
    issueDate,
    dueDate: date('dueDate', map.dueDate, head),
    currency: currency.toUpperCase(),
    note: text('note', map.note, head),
    buyerReference: text('buyerReference', map.buyerReference, head),
    payment: iban ? { iban, bic: text('bic', map.bic, head) } : undefined,
    seller: party('seller', map.seller, head),
    buyer: party('buyer', map.buyer, head),
    lines: all.map((row, i) => {
      const at = (f: string) => `line ${i + 1} ${f}`;
      const category = text(at('vatCategory'), line.vatCategory, row)?.toUpperCase();
      if (category && !CATEGORIES.includes(category)) throw new Error(`${at('vatCategory')} must be S, Z, E or AE.`);
      return {
        id: text(at('id'), line.id, row),
        name: required(at('name'), line.name, row),
        quantity: number(at('quantity'), line.quantity, row),
        unitPrice: number(at('unitPrice'), line.unitPrice, row),
        vatRate: number(at('vatRate'), line.vatRate, row),
        vatCategory: category as WeReportVatCategory | undefined,
        unitCode: text(at('unitCode'), line.unitCode, row),
      };
    }),
  };
}
