// A Cross Industry Invoice (UN/CEFACT CII D16B) in the EN 16931 profile — the XML a Factur-X /
// ZUGFeRD PDF carries. The caller describes the invoice in plain fields; the amounts are worked out
// here in whole cents, so the totals add up the way the standard checks them.

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
}

/** The totals the XML states — exposed so the printed invoice can show the very same numbers */
export interface WeReportInvoiceTotals {
  lines: { net: number }[];
  vat: { rate: number; basis: number; tax: number }[];
  net: number;
  tax: number;
  grand: number;
}

/** Rounds half away from zero, so a credit note's amounts are exactly the invoice's, negated */
const roundHalfAway = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));
/** An amount in whole cents; `toPrecision` first drops binary noise such as 3 × 1.1 = 3.3000000000000003 */
const cents = (v: number): number => roundHalfAway(Number((v * 100).toPrecision(15)));

/** Line nets, VAT per rate and the grand total, rounded to cents as EN 16931 expects */
export function weReportInvoiceTotals(invoice: WeReportInvoice): WeReportInvoiceTotals {
  const lines = invoice.lines.map((l) => ({ net: cents(l.quantity * l.unitPrice), rate: l.vatRate }));
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.rate, (byRate.get(l.rate) ?? 0) + l.net);
  const vat = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, basis]) => ({ rate, basis, tax: roundHalfAway((basis * rate) / 100) }));
  const net = lines.reduce((a, l) => a + l.net, 0);
  const tax = vat.reduce((a, v) => a + v.tax, 0);
  return {
    lines: lines.map((l) => ({ net: l.net / 100 })),
    vat: vat.map((v) => ({ rate: v.rate, basis: v.basis / 100, tax: v.tax / 100 })),
    net: net / 100,
    tax: tax / 100,
    grand: (net + tax) / 100
  };
}

// Control characters are not allowed in XML 1.0 at all: dropped, not escaped
const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const amount = (v: number): string => v.toFixed(2);
/** A quantity, price or rate as an XML decimal — no exponent, no binary noise, never NaN */
function decimal(v: number, what: string): string {
  if (!Number.isFinite(v)) throw new RangeError(`Invoice ${what} must be a finite number, got ${v}.`);
  return Number(v.toPrecision(15)).toFixed(6).replace(/\.?0+$/, '');
}
const day = (d: Date): string => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

function party(tag: 'SellerTradeParty' | 'BuyerTradeParty', p: WeReportInvoiceParty): string {
  const address = [
    p.postcode ? `<ram:PostcodeCode>${esc(p.postcode)}</ram:PostcodeCode>` : '',
    p.address ? `<ram:LineOne>${esc(p.address)}</ram:LineOne>` : '',
    p.city ? `<ram:CityName>${esc(p.city)}</ram:CityName>` : '',
    `<ram:CountryID>${esc(p.country)}</ram:CountryID>`
  ].join('');
  const vat = p.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : '';
  return `<ram:${tag}><ram:Name>${esc(p.name)}</ram:Name><ram:PostalTradeAddress>${address}</ram:PostalTradeAddress>${vat}</ram:${tag}>`;
}

/**
 * The invoice as Cross Industry Invoice XML, EN 16931 profile (`urn:cen.eu:en16931:2017`) — pass it
 * to `renderPdf(…, { facturX: { xml, profile: 'EN 16931' } })`. VAT is standard-rated (`S`) above 0 %
 * and zero-rated (`Z`) at 0 %; exempt and reverse-charge lines are not modelled yet. A credit is a
 * negative quantity; a negative price, or a quantity that is not a finite number, throws a `RangeError`.
 */
export function weReportCiiInvoice(invoice: WeReportInvoice): string {
  for (const l of invoice.lines) {
    if (l.unitPrice < 0) throw new RangeError(`Invoice line "${l.name}" has a negative price; credit a quantity instead (BR-27).`);
    if (l.vatRate < 0) throw new RangeError(`Invoice line "${l.name}" has a negative VAT rate.`);
  }
  const t = weReportInvoiceTotals(invoice);
  const category = (rate: number): string => (rate > 0 ? 'S' : 'Z');
  const cur = esc(invoice.currency);
  const lines = invoice.lines
    .map(
      (l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>${l.id ? `<ram:SellerAssignedID>${esc(l.id)}</ram:SellerAssignedID>` : ''}<ram:Name>${esc(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${decimal(l.unitPrice, 'price')}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(l.unitCode ?? 'C62')}">${decimal(l.quantity, 'quantity')}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category(l.vatRate)}</ram:CategoryCode><ram:RateApplicablePercent>${decimal(l.vatRate, 'VAT rate')}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(t.lines[i].net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`
    )
    .join('');
  const taxes = t.vat
    .map(
      (v) =>
        `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amount(v.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${amount(v.basis)}</ram:BasisAmount><ram:CategoryCode>${category(v.rate)}</ram:CategoryCode><ram:RateApplicablePercent>${decimal(v.rate, 'VAT rate')}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
    )
    .join('');
  const due = invoice.dueDate
    ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${day(invoice.dueDate)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${day(invoice.issueDate)}</udt:DateTimeString></ram:IssueDateTime>${invoice.note ? `\n    <ram:IncludedNote><ram:Content>${esc(invoice.note)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${party('SellerTradeParty', invoice.seller)}${party('BuyerTradeParty', invoice.buyer)}</ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${day(invoice.issueDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>
      ${taxes}
      ${due}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(t.net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(t.net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${cur}">${amount(t.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(t.grand)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${amount(t.grand)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
