import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { EInvoiceMapping, ReportDefinition } from '../definition/report-definition';
import { sanitizeDefinition } from '../definition/sanitize';
import { layoutReport } from '../layout/engine';
import { weReportCiiInvoice } from './cii';
import { renderPdf } from './pdf';
import { weReportEInvoice } from './einvoice';

const mapping: EInvoiceMapping = {
  number: '[^.number]',
  issueDate: '[^.date]',
  dueDate: 'AddDays([^.date], [^.paymentDays])',
  note: '[^.note]',
  iban: '[^.iban]',
  seller: { name: '[^.seller.name]', country: "'DE'", vatId: "'DE' + [^.seller.taxNo]" },
  buyer: { name: '[^.customer.name]', city: '[^.customer.city]', country: '[^.customer.country]' },
  line: { id: '[code]', name: '[product]', quantity: '[qty]', unitPrice: '[price]', vatRate: '[vat]', vatCategory: '[category]' },
};

const report = (over: Partial<ReportDefinition> = {}): ReportDefinition => ({
  ...createBlankReport(),
  currency: 'EUR',
  dataMember: { dataSourceId: 'main', path: 'lines' },
  eInvoice: mapping,
  ...over,
});

const data = (over: Record<string, unknown> = {}) => ({
  number: 'INV-7',
  date: '2026-10-19',
  paymentDays: 30,
  iban: 'DE02120300000000202051',
  seller: { name: 'Sample GmbH', taxNo: '123456789' },
  customer: { name: 'Client', city: 'Lyon', country: 'fr' },
  lines: [
    { code: 'A', product: 'Coffee', qty: 3, price: 1.1, vat: 19 },
    { code: 'B', product: 'Advice', qty: '2', price: 50, vat: 0, category: 'ae' },
  ],
  ...over,
});

describe('weReportEInvoice (a report’s e-invoice mapping)', () => {
  it('reads the invoice fields from the object around the rows and one line per row', () => {
    const invoice = weReportEInvoice(report(), { data: data() });
    expect(invoice.number).toBe('INV-7');
    expect(invoice.currency).toBe('EUR');
    // Calendar days, whatever the host's time zone
    expect(invoice.issueDate.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(invoice.dueDate!.toISOString()).toBe('2026-11-18T00:00:00.000Z');
    expect(invoice.seller).toEqual({ name: 'Sample GmbH', address: undefined, postcode: undefined, city: undefined, country: 'DE', vatId: 'DE123456789' });
    expect(invoice.buyer.country).toBe('FR');
    expect(invoice.payment).toEqual({ iban: 'DE02120300000000202051', bic: undefined });
    expect(invoice.note).toBeUndefined();
    expect(invoice.lines.map((l) => [l.id, l.quantity, l.vatCategory])).toEqual([['A', 3, undefined], ['B', 2, 'AE']]);
    const xml = weReportCiiInvoice(invoice);
    expect(xml).toContain('<udt:DateTimeString format="102">20261019</udt:DateTimeString>');
    expect(xml).toContain('<ram:CategoryCode>AE</ram:CategoryCode>');
  });

  it('names the field a value is missing or wrong for', () => {
    expect(() => weReportEInvoice(report(), { data: data({ number: '' }) })).toThrowError('number is empty.');
    expect(() => weReportEInvoice(report(), { data: data({ date: 'soon' }) })).toThrowError('issueDate is not a date.');
    expect(() => weReportEInvoice(report(), { data: data({ lines: [{ product: 'X', qty: 'many', price: 1, vat: 19 }] }) })).toThrowError('line 1 quantity is not a number.');
    expect(() => weReportEInvoice(report(), { data: data({ lines: [{ product: 'X', qty: 1, price: 1, vat: 19, category: 'K' }] }) })).toThrowError(/must be S, Z, E or AE/);
    expect(() => weReportEInvoice(report(), { data: data({ lines: [] }) })).toThrowError('The invoice has no lines.');
    expect(() => weReportEInvoice(report({ currency: undefined }), { data: data() })).toThrowError('currency is empty.');
    expect(weReportEInvoice(report({ currency: undefined }), { data: data(), currency: 'try' }).currency).toBe('TRY');
    // A date-time keeps its written day in every time zone
    expect(weReportEInvoice(report(), { data: data({ date: '2026-01-01T23:30:00Z' }) }).issueDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps only formulas when a report file is opened', () => {
    const raw = { ...report(), eInvoice: { number: '[^.number]', issueDate: 42, seller: 'x', line: { name: '[product]', quantity: null } } };
    expect(sanitizeDefinition(raw)['eInvoice']).toEqual({ number: '[^.number]', seller: {}, buyer: {}, line: { name: '[product]' } });
    expect(sanitizeDefinition({ ...report(), eInvoice: 'yes' })['eInvoice']).toBeUndefined();
  });

  it('lays out with the XML on the document, which renderPdf embeds; a mapping the data cannot fill is a problem', async () => {
    const fonts = await loadTestFonts();
    const doc = layoutReport(report(), { fonts, now: new Date(2026, 9, 19), data: data() });
    expect(doc.problems).toEqual([]);
    expect(doc.eInvoice).toContain('<rsm:CrossIndustryInvoice');
    const pdf = await PDFDocument.load(await renderPdf(doc, fonts, { date: new Date(2026, 9, 19) }));
    expect((pdf.catalog.lookup(PDFName.of('AF')) as PDFArray).size()).toBe(1);
    const plain = await PDFDocument.load(await renderPdf(doc, fonts, { date: new Date(2026, 9, 19), facturX: false }));
    expect(plain.catalog.lookup(PDFName.of('AF'))).toBeUndefined();

    const bad = layoutReport(report(), { fonts, now: new Date(2026, 9, 19), data: data({ number: '' }) });
    expect(bad.eInvoice).toBeUndefined();
    expect(bad.problems).toEqual([{ code: 'data', message: 'E-invoice: number is empty.' }]);
  });
});
