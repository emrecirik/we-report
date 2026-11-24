import { WeReportInvoice, weReportCiiInvoice, weReportInvoiceTotals } from './cii';

const invoice = (over: Partial<WeReportInvoice> = {}): WeReportInvoice => ({
  number: 'INV-1',
  issueDate: new Date('2026-10-19T00:00:00Z'),
  dueDate: new Date('2026-11-18T00:00:00Z'),
  currency: 'EUR',
  seller: { name: 'Seller & Sons', city: 'Berlin', country: 'DE', vatId: 'DE123456789' },
  buyer: { name: 'Buyer <GmbH>', country: 'DE' },
  lines: [
    { id: 'A', name: 'Coffee', quantity: 3, unitPrice: 1.1, vatRate: 19 },
    { name: 'Tea', quantity: 1, unitPrice: 0.33, vatRate: 7 },
    { name: 'Cake', quantity: 2, unitPrice: 2.675, vatRate: 19 }
  ],
  ...over
});

describe('Cross Industry Invoice (EN 16931)', () => {
  it('rounds every line to cents and the VAT once per rate, so the totals add up exactly', () => {
    const t = weReportInvoiceTotals(invoice());
    // 3 × 1.10 = 3.30 (not 3.3000000000000003); 2 × 2.675 = 5.35
    expect(t.lines.map((l) => l.net)).toEqual([3.3, 0.33, 5.35]);
    expect(t.vat).toEqual([
      { category: 'S', rate: 7, basis: 0.33, tax: 0.02 },
      { category: 'S', rate: 19, basis: 8.65, tax: 1.64 }
    ]);
    expect(t.net).toBe(8.98);
    expect(t.tax).toBe(1.66);
    expect(t.grand).toBe(10.64);
  });

  it('writes well-formed XML in the EN 16931 profile, with every amount and the text escaped', () => {
    const xml = weReportCiiInvoice(invoice());
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const ram = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
    const text = (name: string) => Array.from(doc.getElementsByTagNameNS(ram, name)).map((e) => e.textContent);
    expect(text('ID')[0]).toBe('urn:cen.eu:en16931:2017');
    expect(text('LineTotalAmount')).toEqual(['3.30', '0.33', '5.35', '8.98']);
    expect(text('GrandTotalAmount')).toEqual(['10.64']);
    expect(text('CalculatedAmount')).toEqual(['0.02', '1.64']);
    expect(text('Name')).toContain('Buyer <GmbH>');
    expect(xml).toContain('Buyer &#60;GmbH&#62;');
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(xml).toContain('<udt:DateTimeString format="102">20261118</udt:DateTimeString>');
  });

  it('makes a credit note exactly the invoice negated — halves round away from zero', () => {
    const lines = [{ name: 'Fee', quantity: 1, unitPrice: 25.5, vatRate: 1 }];
    const invoiceTotals = weReportInvoiceTotals(invoice({ lines }));
    const creditTotals = weReportInvoiceTotals(invoice({ lines: lines.map((l) => ({ ...l, quantity: -1 })) }));
    expect(invoiceTotals.vat[0].tax).toBe(0.26);
    expect(creditTotals.vat[0].tax).toBe(-0.26);
    expect(creditTotals.grand).toBe(-invoiceTotals.grand);
  });

  it('writes quantities and prices as plain decimals, and 0 % lines as zero-rated (Z)', () => {
    const xml = weReportCiiInvoice(invoice({ lines: [{ name: 'Book', quantity: 0.1 + 0.2, unitPrice: 0.0000001, vatRate: 0 }] }));
    expect(xml).toContain('>0.3</ram:BilledQuantity>');
    expect(xml).toContain('<ram:ChargeAmount>0</ram:ChargeAmount>');
    expect(xml).not.toContain('e-7');
    expect(xml).toContain('<ram:CategoryCode>Z</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent>');
  });

  it('refuses what an e-invoice cannot carry, and drops control characters from the text', () => {
    expect(() => weReportCiiInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: -5, vatRate: 19 }] }))).toThrowError(RangeError);
    expect(() => weReportCiiInvoice(invoice({ lines: [{ name: 'X', quantity: NaN, unitPrice: 5, vatRate: 19 }] }))).toThrowError(RangeError);
    const xml = weReportCiiInvoice(invoice({ buyer: { name: 'Bad\u0001\u0008Name￿', country: 'DE' } }));
    expect(xml).toContain('<ram:Name>BadName</ram:Name>');
    expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('takes allowances and charges into the VAT basis of their category and rate', () => {
    const t = weReportInvoiceTotals(
      invoice({
        lines: [
          { name: 'Consulting', quantity: 8, unitPrice: 95, vatRate: 19 },
          { name: 'Book', quantity: 2, unitPrice: 24.9, vatRate: 7 }
        ],
        allowances: [{ amount: 50, reason: 'Loyalty', vatRate: 19 }],
        charges: [{ amount: 12.5, reason: 'Shipping', vatRate: 19 }]
      })
    );
    expect(t.vat).toEqual([
      { category: 'S', rate: 7, basis: 49.8, tax: 3.49 },
      { category: 'S', rate: 19, basis: 722.5, tax: 137.28 }
    ]);
    expect([t.net, t.allowances, t.charges, t.taxBasis, t.tax, t.grand]).toEqual([809.8, 50, 12.5, 772.3, 140.77, 913.07]);
  });

  it('writes reverse charge and exempt breakdowns with their reasons, payment details and the buyer reference', () => {
    const xml = weReportCiiInvoice(
      invoice({
        buyerReference: '04011000-12345-67',
        payment: { iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001' },
        lines: [
          { name: 'Service', quantity: 1, unitPrice: 100, vatRate: 0, vatCategory: 'AE' },
          { name: 'Care', quantity: 1, unitPrice: 50, vatRate: 0, vatCategory: 'E' }
        ],
        vatExemptionReasons: { E: 'Exempt under §4' }
      })
    );
    expect(xml).toContain('<ram:ExemptionReason>Reverse charge</ram:ExemptionReason><ram:BasisAmount>100.00</ram:BasisAmount><ram:CategoryCode>AE</ram:CategoryCode>');
    expect(xml).toContain('<ram:ExemptionReason>Exempt under §4</ram:ExemptionReason>');
    expect(xml).toContain('<ram:IBANID>DE02120300000000202051</ram:IBANID>');
    expect(xml).toContain('<ram:BICID>BYLADEM1001</ram:BICID>');
    expect(xml).toContain('<ram:BuyerReference>04011000-12345-67</ram:BuyerReference>');
    expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('refuses a rate that does not fit its category', () => {
    expect(() => weReportCiiInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: 1, vatRate: 19, vatCategory: 'AE' }] }))).toThrowError(RangeError);
    expect(() => weReportCiiInvoice(invoice({ lines: [{ name: 'X', quantity: 1, unitPrice: 1, vatRate: 0, vatCategory: 'S' }] }))).toThrowError(RangeError);
    expect(() => weReportCiiInvoice(invoice({ allowances: [{ amount: -5, reason: 'Bad', vatRate: 19 }] }))).toThrowError(RangeError);
  });

  it('leaves out what was not given — no due date, no VAT id, no note', () => {
    const xml = weReportCiiInvoice(invoice({ dueDate: undefined, seller: { name: 'S', country: 'FR' } }));
    expect(xml).not.toContain('DueDateDateTime');
    expect(xml).not.toContain('SpecifiedTaxRegistration');
    expect(xml).not.toContain('IncludedNote');
  });
});
