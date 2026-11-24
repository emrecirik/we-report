import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import { loadTestFonts } from '../../testing/test-fonts';
import { createBlankReport } from '../definition/blank-report';
import { FontRegistry } from '../fonts/font-registry';
import { layoutReport } from '../layout/engine';
import { renderPdf } from './pdf';
import { weReportPdfAXmp, weReportSrgbIccProfile, xmpDate } from './pdfa';

const NOW = new Date('2026-11-24T10:00:00Z');
const CII = '<?xml version="1.0" encoding="UTF-8"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"/>';

describe('PDF/A', () => {
  let fonts: FontRegistry;
  beforeAll(async () => (fonts = await loadTestFonts()));

  const sampleDoc = () => {
    const report = createBlankReport();
    report.bands[1].controls.push({ id: 't', type: 'text', x: 0, y: 0, width: 80, height: 8, text: { expression: "'Fatura — İğüşöç ₺'" } });
    return layoutReport(report, { fonts, now: NOW });
  };

  it('builds an sRGB ICC display profile with a correct header and tag table', () => {
    const icc = weReportSrgbIccProfile();
    const view = new DataView(icc.buffer);
    const ascii = (at: number) => String.fromCharCode(...icc.slice(at, at + 4));
    expect(view.getUint32(0)).toBe(icc.length);
    expect(icc.length % 4).toBe(0);
    expect(ascii(12)).toBe('mntr');
    expect(ascii(16)).toBe('RGB ');
    expect(ascii(20)).toBe('XYZ ');
    expect(ascii(36)).toBe('acsp');
    const tags = view.getUint32(128);
    const sigs = Array.from({ length: tags }, (_, i) => ascii(132 + i * 12));
    expect(sigs).toEqual(['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']);
    for (let i = 0; i < tags; i++) {
      const offset = view.getUint32(132 + i * 12 + 4);
      const size = view.getUint32(132 + i * 12 + 8);
      expect(offset % 4).toBe(0);
      expect(offset + size).toBeLessThanOrEqual(icc.length);
    }
  });

  it('writes the PDF/A-3B identity, escaped text and the Factur-X extension into the XMP', () => {
    const xmp = weReportPdfAXmp({ title: 'A & B <x>', producer: 'we-report', creator: 'we-report', date: NOW, facturX: { profile: 'EN 16931', fileName: 'factur-x.xml' } });
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('A &#38; B &#60;x&#62;');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(xmp).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>');
    expect(xmp).toContain(`<xmp:CreateDate>${xmpDate(NOW)}</xmp:CreateDate>`);
    expect(new DOMParser().parseFromString(xmp.replace(/<\?xpacket[^>]*\?>/g, ''), 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('attaches a Factur-X invoice to a PDF/A-3b: output intent, unfiltered XMP, AF entry, matching dates', async () => {
    const bytes = await renderPdf(sampleDoc(), fonts, { title: 'Invoice 42', date: NOW, facturX: { xml: CII, profile: 'EN 16931' } });
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const catalog = pdf.catalog;

    const metadata = catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
    expect(metadata.dict.has(PDFName.of('Filter'))).toBeFalse();
    const xmp = new TextDecoder().decode(metadata.getContents());
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');

    const intents = catalog.lookup(PDFName.of('OutputIntents')) as PDFArray;
    const intent = intents.lookup(0) as PDFDict;
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
    expect(intent.lookup(PDFName.of('DestOutputProfile'))).toBeInstanceOf(PDFStream);

    const af = catalog.lookup(PDFName.of('AF')) as PDFArray;
    const spec = af.lookup(0) as PDFDict;
    expect(spec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Alternative'));
    const file = (spec.lookup(PDFName.of('EF')) as PDFDict).lookup(PDFName.of('F')) as PDFStream;
    expect(file.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
    expect((file.dict.lookup(PDFName.of('Params')) as PDFDict).has(PDFName.of('ModDate'))).toBeTrue();

    // The information dates are the XMP ones, to the second
    expect(pdf.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    expect(pdf.getModificationDate()?.toISOString()).toBe(NOW.toISOString());
    expect(pdf.context.trailerInfo.ID).toBeDefined();
  });

  it('marks a MINIMUM invoice as data the PDF summarises, and leaves a plain PDF plain', async () => {
    const minimum = await PDFDocument.load(await renderPdf(sampleDoc(), fonts, { date: NOW, facturX: { xml: CII, profile: 'MINIMUM' } }));
    const spec = (minimum.catalog.lookup(PDFName.of('AF')) as PDFArray).lookup(0) as PDFDict;
    expect(spec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Data'));

    const plain = await PDFDocument.load(await renderPdf(sampleDoc(), fonts, { date: NOW }));
    expect(plain.catalog.has(PDFName.of('OutputIntents'))).toBeFalse();
    expect(plain.catalog.has(PDFName.of('Metadata'))).toBeFalse();
  });
});
