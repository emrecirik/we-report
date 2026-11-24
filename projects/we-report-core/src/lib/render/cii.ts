// A Cross Industry Invoice (UN/CEFACT CII D16B) in the EN 16931 profile — the XML a Factur-X /
// ZUGFeRD PDF carries. The caller describes the invoice in plain fields; the amounts are worked out
// here in whole cents, so the totals add up the way the standard checks them.
import { escapeXml, xmlDecimal } from './xml';

/** A party on the invoice — seller or buyer */
export interface WeReportInvoiceParty {
  name: string;
  /** Street and number */
  address?: string;
  postcode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2, e.g. `DE`, `FR`, `TR` */
  country: string;
  /** VAT registration number, e.g. `DE123456789` */
  vatId?: string;
}

export interface WeReportInvoiceLine {
  /** The seller's item code */
  id?: string;
  name: string;
  quantity: number;
  /** Net price of one unit */
  unitPrice: number;
  /** VAT rate in percent, e.g. 20 */
  vatRate: number;
  /** UN/ECE Rec 20 unit code; `C62` (one) when left out */
  unitCode?: string;
  /** VAT category; `S` above 0 %, `Z` at 0 % when left out. `E` and `AE` need a 0 % rate. */
  vatCategory?: WeReportVatCategory;
}

/**
 * EN 16931 VAT categories: `S` standard rate, `Z` zero rated, `E` exempt, `AE` reverse charge
 * (the buyer accounts for the VAT). Intra-community supply (`K`), export (`G`) and out of scope (`O`)
 * are not modelled yet.
 */
export type WeReportVatCategory = 'S' | 'Z' | 'E' | 'AE';

/** A document-level discount (allowance) or surcharge (charge), net, in one VAT category */
export interface WeReportAllowanceCharge {
  amount: number;
  reason: string;
  vatRate: number;
  vatCategory?: WeReportVatCategory;
}

/** What `weReportCiiInvoice` needs to know about an invoice */
export interface WeReportInvoice {
  number: string;
  issueDate: Date;
  dueDate?: Date;
  /** ISO 4217, e.g. `EUR`, `TRY` */
  currency: string;
  seller: WeReportInvoiceParty;
  buyer: WeReportInvoiceParty;
  lines: WeReportInvoiceLine[];
  note?: string;
  /** The buyer's reference (BT-10) — required by XRechnung, where it carries the Leitweg-ID */
  buyerReference?: string;
  /** Payment by credit transfer to this account (SEPA, payment means 58) */
  payment?: { iban: string; bic?: string; accountName?: string };
  /** Document-level discounts, net */
  allowances?: WeReportAllowanceCharge[];
  /** Document-level surcharges (freight, packing), net */
  charges?: WeReportAllowanceCharge[];
  /** Why `E` / `AE` amounts carry no VAT; defaults: "Exempt from VAT", "Reverse charge" */
  vatExemptionReasons?: Partial<Record<WeReportVatCategory, string>>;
}

/** The totals the XML states — exposed so the printed invoice can show the very same numbers */
export interface WeReportInvoiceTotals {
  lines: { net: number }[];
  /** One entry per VAT category and rate, the lines, allowances and charges in it */
  vat: { category: WeReportVatCategory; rate: number; basis: number; tax: number }[];
  /** Sum of the line nets */
  net: number;
  allowances: number;
  charges: number;
  /** Lines − allowances + charges: what the VAT is worked out on */
  taxBasis: number;
  tax: number;
  grand: number;
}

/** A line's or allowance's category: the given one, else `S` above 0 % and `Z` at 0 % */
const categoryOf = (x: { vatRate: number; vatCategory?: WeReportVatCategory }): WeReportVatCategory => x.vatCategory ?? (x.vatRate > 0 ? 'S' : 'Z');

/** Rounds half away from zero, so a credit note's amounts are exactly the invoice's, negated */
const roundHalfAway = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));
/** An amount in whole cents; `toPrecision` first drops binary noise such as 3 × 1.1 = 3.3000000000000003 */
const cents = (v: number): number => roundHalfAway(Number((v * 100).toPrecision(15)));

/** Line nets, VAT per rate and the grand total, rounded to cents as EN 16931 expects */
export function weReportInvoiceTotals(invoice: WeReportInvoice): WeReportInvoiceTotals {
  const groups = new Map<string, { category: WeReportVatCategory; rate: number; basis: number }>();
  const add = (category: WeReportVatCategory, rate: number, value: number): void => {
    const key = `${category}|${rate}`;
    const group = groups.get(key) ?? { category, rate, basis: 0 };
    group.basis += value;
    groups.set(key, group);
  };
  const lines = invoice.lines.map((l) => {
    const net = cents(l.quantity * l.unitPrice);
    add(categoryOf(l), l.vatRate, net);
    return net;
  });
  const sumOf = (list: WeReportAllowanceCharge[] | undefined, sign: number): number =>
    (list ?? []).reduce((total, a) => {
      const value = cents(a.amount);
      add(categoryOf(a), a.vatRate, sign * value);
      return total + value;
    }, 0);
  const allowances = sumOf(invoice.allowances, -1);
  const charges = sumOf(invoice.charges, 1);
  const order: WeReportVatCategory[] = ['S', 'Z', 'E', 'AE'];
  const vat = [...groups.values()]
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.rate - b.rate)
    .map((g) => ({ ...g, tax: roundHalfAway((g.basis * g.rate) / 100) }));
  const net = lines.reduce((a, v) => a + v, 0);
  const taxBasis = net - allowances + charges;
  const tax = vat.reduce((a, v) => a + v.tax, 0);
  return {
    lines: lines.map((v) => ({ net: v / 100 })),
    vat: vat.map((v) => ({ category: v.category, rate: v.rate, basis: v.basis / 100, tax: v.tax / 100 })),
    net: net / 100,
    allowances: allowances / 100,
    charges: charges / 100,
    taxBasis: taxBasis / 100,
    tax: tax / 100,
    grand: (taxBasis + tax) / 100
  };
}

const amount = (v: number): string => v.toFixed(2);
const day = (d: Date): string => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

function party(tag: 'SellerTradeParty' | 'BuyerTradeParty', p: WeReportInvoiceParty): string {
  const address = [
    p.postcode ? `<ram:PostcodeCode>${escapeXml(p.postcode)}</ram:PostcodeCode>` : '',
    p.address ? `<ram:LineOne>${escapeXml(p.address)}</ram:LineOne>` : '',
    p.city ? `<ram:CityName>${escapeXml(p.city)}</ram:CityName>` : '',
    `<ram:CountryID>${escapeXml(p.country)}</ram:CountryID>`
  ].join('');
  const vat = p.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${escapeXml(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : '';
  return `<ram:${tag}><ram:Name>${escapeXml(p.name)}</ram:Name><ram:PostalTradeAddress>${address}</ram:PostalTradeAddress>${vat}</ram:${tag}>`;
}

/**
 * The invoice as Cross Industry Invoice XML, EN 16931 profile (`urn:cen.eu:en16931:2017`) — pass it
 * to `renderPdf(…, { facturX: { xml, profile: 'EN 16931' } })`. VAT categories `S`, `Z`, `E` and `AE`
 * (see `WeReportVatCategory`), document-level allowances and charges, SEPA payment details and a buyer
 * reference. A credit is a negative quantity; a negative price, a rate that does not fit its category,
 * or a number that is not finite throws a `RangeError`.
 */
export function weReportCiiInvoice(invoice: WeReportInvoice): string {
  for (const l of invoice.lines) {
    if (l.unitPrice < 0) throw new RangeError(`Invoice line "${l.name}" has a negative price; credit a quantity instead (BR-27).`);
    checkVat(l.vatRate, l.vatCategory, `Invoice line "${l.name}"`);
  }
  for (const a of [...(invoice.allowances ?? []), ...(invoice.charges ?? [])]) {
    if (!(a.amount >= 0) || !Number.isFinite(a.amount)) throw new RangeError(`Allowance or charge "${a.reason}" needs a positive amount.`);
    checkVat(a.vatRate, a.vatCategory, `Allowance or charge "${a.reason}"`);
  }
  const t = weReportInvoiceTotals(invoice);
  const reasons: Record<WeReportVatCategory, string> = { S: '', Z: '', E: 'Exempt from VAT', AE: 'Reverse charge', ...invoice.vatExemptionReasons };
  const tradeTax = (category: WeReportVatCategory, rate: number): string =>
    `<ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category}</ram:CategoryCode><ram:RateApplicablePercent>${xmlDecimal(rate, 'VAT rate')}</ram:RateApplicablePercent>`;
  const allowanceCharge = (a: WeReportAllowanceCharge, charge: boolean): string =>
    `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${charge}</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${amount(cents(a.amount) / 100)}</ram:ActualAmount><ram:Reason>${escapeXml(a.reason)}</ram:Reason><ram:CategoryTradeTax>${tradeTax(categoryOf(a), a.vatRate)}</ram:CategoryTradeTax></ram:SpecifiedTradeAllowanceCharge>`;
  const cur = escapeXml(invoice.currency);
  const lines = invoice.lines
    .map(
      (l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>${l.id ? `<ram:SellerAssignedID>${escapeXml(l.id)}</ram:SellerAssignedID>` : ''}<ram:Name>${escapeXml(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${xmlDecimal(l.unitPrice, 'price')}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${escapeXml(l.unitCode ?? 'C62')}">${xmlDecimal(l.quantity, 'quantity')}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>${tradeTax(categoryOf(l), l.vatRate)}</ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(t.lines[i].net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
    )
    .join('');
  const taxes = t.vat
    .map(
      (v) =>
        `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amount(v.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${
          reasons[v.category] ? `<ram:ExemptionReason>${escapeXml(reasons[v.category])}</ram:ExemptionReason>` : ''
        }<ram:BasisAmount>${amount(v.basis)}</ram:BasisAmount><ram:CategoryCode>${v.category}</ram:CategoryCode><ram:RateApplicablePercent>${xmlDecimal(v.rate, 'VAT rate')}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
    )
    .join('');
  const payment = invoice.payment
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${escapeXml(invoice.payment.iban.replace(/\s+/g, ''))}</ram:IBANID>${
        invoice.payment.accountName ? `<ram:AccountName>${escapeXml(invoice.payment.accountName)}</ram:AccountName>` : ''
      }</ram:PayeePartyCreditorFinancialAccount>${
        invoice.payment.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${escapeXml(invoice.payment.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''
      }</ram:SpecifiedTradeSettlementPaymentMeans>`
    : '';
  const allowancesAndCharges = [...(invoice.allowances ?? []).map((a) => allowanceCharge(a, false)), ...(invoice.charges ?? []).map((c) => allowanceCharge(c, true))].join('');
  const due = invoice.dueDate
    ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${day(invoice.dueDate)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${day(invoice.issueDate)}</udt:DateTimeString></ram:IssueDateTime>${invoice.note ? `\n    <ram:IncludedNote><ram:Content>${escapeXml(invoice.note)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${invoice.buyerReference ? `<ram:BuyerReference>${escapeXml(invoice.buyerReference)}</ram:BuyerReference>` : ''}${party('SellerTradeParty', invoice.seller)}${party('BuyerTradeParty', invoice.buyer)}</ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${day(invoice.issueDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>
      ${payment}
      ${taxes}
      ${allowancesAndCharges}
      ${due}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(t.net)}</ram:LineTotalAmount>${
          invoice.charges?.length ? `\n        <ram:ChargeTotalAmount>${amount(t.charges)}</ram:ChargeTotalAmount>` : ''
        }${invoice.allowances?.length ? `\n        <ram:AllowanceTotalAmount>${amount(t.allowances)}</ram:AllowanceTotalAmount>` : ''}
        <ram:TaxBasisTotalAmount>${amount(t.taxBasis)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${cur}">${amount(t.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(t.grand)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(t.grand)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/** `E` and `AE` carry no VAT, `S` needs a rate, `Z` is 0 % — EN 16931's BR-S/Z/E/AE-05 and -06 */
function checkVat(rate: number, category: WeReportVatCategory | undefined, what: string): void {
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError(`${what} has an invalid VAT rate.`);
  const c = category ?? (rate > 0 ? 'S' : 'Z');
  if (c === 'S' && rate === 0) throw new RangeError(`${what} is standard-rated (S) at 0 %; use Z, E or AE.`);
  if (c !== 'S' && rate !== 0) throw new RangeError(`${what} is in category ${c}, which takes a 0 % rate.`);
}
