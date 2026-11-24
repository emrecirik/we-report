// A Turkish e-invoice (e-Fatura / e-Arşiv Fatura) as UBL-TR 1.2 XML — the document an integrator
// (özel entegratör) or GİB's portal signs and sends. Amounts come from `weReportInvoiceTotals`, so
// the XML, a Factur-X twin and the printed page agree to the kuruş.
import { WeReportInvoice, weReportInvoiceTotals } from './cii';
import { escapeXml, xmlDecimal } from './xml';

/** A party on a Turkish e-invoice */
export interface WeReportUblTrParty {
  /** Trade name (unvan); for a person, the full name */
  name: string;
  /** VKN (10 digits) for a company, TCKN (11 digits) for a person */
  taxId: string;
  /** Tax office (vergi dairesi), e.g. `Kadıköy` */
  taxOffice?: string;
  /** Street and number */
  address?: string;
  /** District (ilçe), e.g. `Kadıköy` */
  district: string;
  /** Province (il), e.g. `İstanbul` */
  city: string;
  postcode?: string;
  /** Country name; `Türkiye` when left out */
  country?: string;
  /** A person (TCKN): first name and family name, both required by GİB */
  firstName?: string;
  familyName?: string;
}

export interface WeReportUblTrLine {
  /** The seller's item code */
  id?: string;
  name: string;
  quantity: number;
  /** Net price of one unit */
  unitPrice: number;
  /** KDV rate in percent: 0, 1, 10, 20 … — a 0 % line needs the invoice's `exemption` */
  vatRate: number;
  /** UN/ECE Rec 20 unit code; `C62` (adet) when left out */
  unitCode?: string;
}

/** What `weReportUblTrInvoice` needs to know about an invoice */
export interface WeReportUblTrInvoice {
  /** `TEMELFATURA` / `TICARIFATURA` between e-Fatura users, `EARSIVFATURA` to anyone else */
  profile: 'TEMELFATURA' | 'TICARIFATURA' | 'EARSIVFATURA';
  /** GİB invoice number: three letters or digits, the year, nine digits — `ABC2026000000001` */
  id: string;
  /** The document's UUID; keep it with the invoice, a resend must carry the same one */
  uuid: string;
  issueDate: Date;
  /** `HH:mm:ss`, the local time of issue */
  issueTime?: string;
  dueDate?: Date;
  seller: WeReportUblTrParty;
  buyer: WeReportUblTrParty;
  lines: WeReportUblTrLine[];
  note?: string;
  /** IBAN the buyer pays to */
  iban?: string;
  /**
   * Why 0 % lines carry no KDV: a GİB exemption code and its text. `351` (not exempt, other) keeps the
   * invoice a `SATIS`; a code of GİB's exemption list (e.g. `301`, `213`) makes it an `ISTISNA` invoice.
   */
  exemption?: { code: string; reason: string };
}

const NS = [
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"'
].join(' ');

// GİB's exemption codes that need the ISTISNA invoice type (UBL-TR şematron, 2026-07-01)
const ISTISNA_CODES = new Set(
  '001,101,102,103,104,105,106,107,108,201,202,204,205,206,207,208,209,211,212,213,214,215,216,217,218,219,220,221,223,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,250,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,350,501'.split(',')
);

const money = (v: number): string => `currencyID="TRY">${v.toFixed(2)}`;
const isoDay = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const tag = (name: string, value: string | undefined): string => (value ? `<cbc:${name}>${escapeXml(value)}</cbc:${name}>` : '');

function checkParty(p: WeReportUblTrParty, role: string): void {
  if (!/^(\d{10}|\d{11})$/.test(p.taxId)) throw new RangeError(`The ${role}'s taxId must be a 10-digit VKN or an 11-digit TCKN.`);
  if (p.taxId.length === 11 && !(p.firstName?.trim() && p.familyName?.trim())) throw new RangeError(`The ${role} has a TCKN: firstName and familyName are required.`);
  if (!p.name.trim() || !p.district.trim() || !p.city.trim()) throw new RangeError(`The ${role} needs a name, a district and a city.`);
}

function party(p: WeReportUblTrParty): string {
  const scheme = p.taxId.length === 11 ? 'TCKN' : 'VKN';
  const address =
    `<cac:PostalAddress>${tag('StreetName', p.address)}${tag('CitySubdivisionName', p.district)}${tag('CityName', p.city)}${tag('PostalZone', p.postcode)}` +
    `<cac:Country><cbc:Name>${escapeXml(p.country || 'Türkiye')}</cbc:Name></cac:Country></cac:PostalAddress>`;
  const taxScheme = p.taxOffice ? `<cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>${escapeXml(p.taxOffice)}</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>` : '';
  const person = scheme === 'TCKN' ? `<cac:Person><cbc:FirstName>${escapeXml(p.firstName!)}</cbc:FirstName><cbc:FamilyName>${escapeXml(p.familyName!)}</cbc:FamilyName></cac:Person>` : '';
  return (
    `<cac:Party><cac:PartyIdentification><cbc:ID schemeID="${scheme}">${p.taxId}</cbc:ID></cac:PartyIdentification>` +
    `<cac:PartyName><cbc:Name>${escapeXml(p.name)}</cbc:Name></cac:PartyName>${address}${taxScheme}${person}</cac:Party>`
  );
}

/**
 * The invoice as UBL-TR 1.2 XML (GİB e-Fatura / e-Arşiv), unsigned — the integrator adds the XAdES
 * signature. KDV only, in Turkish lira: rated lines and 0 % lines with one exemption code. A credit
 * is an `IADE` invoice, not a negative quantity, so quantities and prices must not be negative.
 * Invalid input throws a `RangeError`.
 */
export function weReportUblTrInvoice(invoice: WeReportUblTrInvoice): string {
  if (!/^[A-Z0-9]{3}\d{13}$/.test(invoice.id)) throw new RangeError('The invoice id must be three letters or digits, the year and nine digits, e.g. ABC2026000000001.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoice.uuid)) throw new RangeError('The invoice uuid must be a UUID.');
  if (invoice.issueTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(invoice.issueTime)) throw new RangeError('issueTime must be HH:mm:ss.');
  if (!invoice.lines.length) throw new RangeError('The invoice has no lines.');
  checkParty(invoice.seller, 'seller');
  checkParty(invoice.buyer, 'buyer');
  for (const l of invoice.lines) {
    if (!(l.quantity >= 0) || !(l.unitPrice >= 0) || !Number.isFinite(l.quantity * l.unitPrice)) throw new RangeError(`Invoice line "${l.name}" needs a quantity and a price of 0 or more.`);
    if (!(l.vatRate >= 0 && l.vatRate <= 100)) throw new RangeError(`Invoice line "${l.name}" needs a KDV rate between 0 and 100.`);
    if (l.vatRate === 0 && !invoice.exemption) throw new RangeError(`Invoice line "${l.name}" has 0 % KDV: give the invoice an exemption code.`);
  }
  const exempt = invoice.exemption && invoice.lines.some((l) => l.vatRate === 0) ? invoice.exemption : undefined;
  if (exempt && !(exempt.code === '351' || ISTISNA_CODES.has(exempt.code))) {
    throw new RangeError(`Exemption code ${exempt.code} is not supported: use 351 or a code of GİB's exemption list (export and special-basis invoices are not modelled).`);
  }
  if (exempt && !exempt.reason.trim()) throw new RangeError('The exemption needs its reason text.');
  const type = exempt && exempt.code !== '351' ? 'ISTISNA' : 'SATIS';
  // Same rounding as the Factur-X invoice: lines to kuruş, the KDV once per rate
  const t = weReportInvoiceTotals({
    number: invoice.id,
    issueDate: invoice.issueDate,
    currency: 'TRY',
    seller: { name: '', country: 'TR' },
    buyer: { name: '', country: 'TR' },
    lines: invoice.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, vatRate: l.vatRate, vatCategory: l.vatRate === 0 ? 'E' : 'S' }))
  } satisfies WeReportInvoice);
  const category = (rate: number): string =>
    `<cac:TaxCategory>${rate === 0 && exempt ? `${tag('TaxExemptionReasonCode', exempt.code)}${tag('TaxExemptionReason', exempt.reason)}` : ''}` +
    `<cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>`;
  const subtotal = (basis: number, tax: number, rate: number): string =>
    `<cac:TaxSubtotal><cbc:TaxableAmount ${money(basis)}</cbc:TaxableAmount><cbc:TaxAmount ${money(tax)}</cbc:TaxAmount>` +
    `<cbc:Percent>${xmlDecimal(rate, 'KDV rate')}</cbc:Percent>${category(rate)}</cac:TaxSubtotal>`;
  const taxTotal = `<cac:TaxTotal><cbc:TaxAmount ${money(t.tax)}</cbc:TaxAmount>${t.vat.map((v) => subtotal(v.basis, v.tax, v.rate)).join('')}</cac:TaxTotal>`;
  const lines = invoice.lines
    .map((l, i) => {
      const net = t.lines[i].net;
      // From whole kuruş, half up, as the document's KDV per rate: 1.15 at 10 % is 0.12, not 0.11
      const tax = Math.round((Math.round(net * 100) * l.vatRate) / 100) / 100;
      return (
        `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="${escapeXml(l.unitCode || 'C62')}">${xmlDecimal(l.quantity, 'quantity')}</cbc:InvoicedQuantity>` +
        `<cbc:LineExtensionAmount ${money(net)}</cbc:LineExtensionAmount>` +
        `<cac:TaxTotal><cbc:TaxAmount ${money(tax)}</cbc:TaxAmount>${subtotal(net, tax, l.vatRate)}</cac:TaxTotal>` +
        `<cac:Item><cbc:Name>${escapeXml(l.name)}</cbc:Name>${l.id ? `<cac:SellersItemIdentification><cbc:ID>${escapeXml(l.id)}</cbc:ID></cac:SellersItemIdentification>` : ''}</cac:Item>` +
        `<cac:Price><cbc:PriceAmount currencyID="TRY">${xmlDecimal(l.unitPrice, 'price')}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`
      );
    })
    .join('\n  ');
  const payment =
    invoice.dueDate || invoice.iban
      ? `<cac:PaymentMeans><cbc:PaymentMeansCode>${invoice.iban ? '42' : '1'}</cbc:PaymentMeansCode>${invoice.dueDate ? `<cbc:PaymentDueDate>${isoDay(invoice.dueDate)}</cbc:PaymentDueDate>` : ''}` +
        `${invoice.iban ? `<cac:PayeeFinancialAccount><cbc:ID>${escapeXml(invoice.iban.replace(/\s+/g, ''))}</cbc:ID><cbc:CurrencyCode>TRY</cbc:CurrencyCode></cac:PayeeFinancialAccount>` : ''}</cac:PaymentMeans>`
      : '';
  const seller = invoice.seller;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice ${NS}>
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${invoice.profile}</cbc:ProfileID>
  <cbc:ID>${invoice.id}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${invoice.uuid.toUpperCase()}</cbc:UUID>
  <cbc:IssueDate>${isoDay(invoice.issueDate)}</cbc:IssueDate>
  ${invoice.issueTime ? `<cbc:IssueTime>${invoice.issueTime}</cbc:IssueTime>` : ''}
  <cbc:InvoiceTypeCode>${type}</cbc:InvoiceTypeCode>
  ${tag('Note', invoice.note)}
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${invoice.lines.length}</cbc:LineCountNumeric>
  <cac:Signature><cbc:ID schemeID="VKN_TCKN">${seller.taxId}</cbc:ID><cac:SignatoryParty><cac:PartyIdentification><cbc:ID schemeID="${seller.taxId.length === 11 ? 'TCKN' : 'VKN'}">${seller.taxId}</cbc:ID></cac:PartyIdentification><cac:PostalAddress>${tag('CitySubdivisionName', seller.district)}${tag('CityName', seller.city)}<cac:Country><cbc:Name>${escapeXml(seller.country || 'Türkiye')}</cbc:Name></cac:Country></cac:PostalAddress></cac:SignatoryParty><cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#Signature</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature>
  <cac:AccountingSupplierParty>${party(invoice.seller)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(invoice.buyer)}</cac:AccountingCustomerParty>
  ${payment}
  ${taxTotal}
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount ${money(t.net)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount ${money(t.taxBasis)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount ${money(t.grand)}</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount ${money(0)}</cbc:AllowanceTotalAmount><cbc:PayableAmount ${money(t.grand)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
  ${lines}
</Invoice>
`.replace(/\n {2}\n/g, '\n');
}
