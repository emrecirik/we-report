import { WeReportUblTrInvoice, weReportUblTrInvoice } from './ubl-tr';

const company = { name: 'Örnek <Ticaret> A.Ş.', taxId: '1234567890', taxOffice: 'Kadıköy', district: 'Kadıköy', city: 'İstanbul' };
const invoice = (over: Partial<WeReportUblTrInvoice> = {}): WeReportUblTrInvoice => ({
  profile: 'TEMELFATURA',
  id: 'WRF2026000000001',
  uuid: '3f2b8c1e-6a4d-4e2f-9b1a-2c3d4e5f6a7b',
  issueDate: new Date('2026-11-24T00:00:00Z'),
  seller: company,
  buyer: { name: 'Ayşe Örnek', taxId: '11111111110', firstName: 'Ayşe', familyName: 'Örnek', district: 'Konak', city: 'İzmir' },
  lines: [
    { id: 'A1', name: 'Kahve', quantity: 14, unitPrice: 269.51, vatRate: 1 },
    { name: 'Danışmanlık', quantity: 8, unitPrice: 1250, vatRate: 20, unitCode: 'HUR' }
  ],
  ...over
});
const cbc = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return (name: string) => Array.from(doc.getElementsByTagNameNS(cbc, name)).map((e) => e.textContent);
};

describe('UBL-TR invoice (GİB e-Fatura)', () => {
  it('writes the UBL-TR header, both parties and the KDV per rate, rounded like the Factur-X invoice', () => {
    const text = parse(weReportUblTrInvoice(invoice()));
    expect(text('CustomizationID')).toEqual(['TR1.2']);
    expect(text('ProfileID')).toEqual(['TEMELFATURA']);
    expect(text('UUID')).toEqual(['3F2B8C1E-6A4D-4E2F-9B1A-2C3D4E5F6A7B']);
    expect(text('IssueDate')).toEqual(['2026-11-24']);
    expect(text('InvoiceTypeCode')).toEqual(['SATIS']);
    expect(text('LineCountNumeric')).toEqual(['2']);
    // 14 × 269.51 = 3,773.14 at 1 %; 8 × 1,250 = 10,000 at 20 %
    expect(text('LineExtensionAmount')).toEqual(['13773.14', '3773.14', '10000.00']);
    expect(text('PayableAmount')).toEqual(['15810.87']);
    expect(text('Percent')).toEqual(['1', '20', '1', '20']);
    expect(text('FirstName')).toEqual(['Ayşe']);
    expect(text('Name')).toContain('Örnek <Ticaret> A.Ş.');
  });

  it('makes a 0 % line exempt: 351 keeps a SATIS invoice, an exemption-list code makes it ISTISNA', () => {
    const lines = [{ name: 'Ürün', quantity: 1, unitPrice: 100, vatRate: 0 }];
    const satis = parse(weReportUblTrInvoice(invoice({ lines, exemption: { code: '351', reason: 'Diğer' } })));
    expect(satis('InvoiceTypeCode')).toEqual(['SATIS']);
    expect(satis('TaxExemptionReasonCode')).toEqual(['351', '351']);
    const istisna = parse(weReportUblTrInvoice(invoice({ lines, exemption: { code: '301', reason: 'Mal ihracatı' } })));
    expect(istisna('InvoiceTypeCode')).toEqual(['ISTISNA']);
  });

  it('rounds the KDV of a line half up from whole kuruş', () => {
    const text = parse(weReportUblTrInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: 1.15, vatRate: 10 }] })));
    expect(text('TaxAmount')).toEqual(['0.12', '0.12', '0.12', '0.12']);
  });

  it('refuses what GİB would reject', () => {
    expect(() => weReportUblTrInvoice(invoice({ id: 'WRF26-1' }))).toThrowError(RangeError);
    expect(() => weReportUblTrInvoice(invoice({ uuid: 'not-a-uuid' }))).toThrowError(RangeError);
    expect(() => weReportUblTrInvoice(invoice({ buyer: { ...company, taxId: '12345678901' } }))).toThrowError(/firstName and familyName/);
    expect(() => weReportUblTrInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: 1, vatRate: 0 }] }))).toThrowError(/exemption code/);
    expect(() => weReportUblTrInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: 1, vatRate: 0 }], exemption: { code: '701', reason: 'İhraç kayıtlı' } }))).toThrowError(/not supported/);
    expect(() => weReportUblTrInvoice(invoice({ lines: [{ name: 'X', quantity: -1, unitPrice: 1, vatRate: 20 }] }))).toThrowError(RangeError);
    expect(() => weReportUblTrInvoice(invoice({ lines: [] }))).toThrowError(RangeError);
  });
});
