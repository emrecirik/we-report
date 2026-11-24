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
      { rate: 7, basis: 0.33, tax: 0.02 },
      { rate: 19, basis: 8.65, tax: 1.64 }
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

  it('leaves out what was not given — no due date, no VAT id, no note', () => {
    const xml = weReportCiiInvoice(invoice({ dueDate: undefined, seller: { name: 'S', country: 'FR' } }));
    expect(xml).not.toContain('DueDateDateTime');
    expect(xml).not.toContain('SpecifiedTaxRegistration');
    expect(xml).not.toContain('IncludedNote');
  });
});
