// PDF/A-3b support: the pieces pdf-lib does not write on its own — an sRGB output intent, XMP
// metadata that matches the document information, a document ID — plus Factur-X / ZUGFeRD, the
// European e-invoice that rides inside a PDF/A-3 as an attached XML.
import { escapeXml } from './xml';

/** Factur-X / ZUGFeRD conformance levels, as written into the XMP */
export type FacturXProfile = 'MINIMUM' | 'BASIC WL' | 'BASIC' | 'EN 16931' | 'EXTENDED' | 'XRECHNUNG';

/** A file carried inside the PDF — PDF/A-3 allows any, as long as it says what it is */
export interface PdfAttachment {
  name: string;
  data: Uint8Array | string;
  /** MIME type, e.g. `text/xml`, `application/json`, `text/csv` */
  mimeType: string;
  description?: string;
  /** How the file relates to the document (PDF/A-3's AFRelationship); `Data` when left out */
  relationship?: 'Source' | 'Data' | 'Alternative' | 'Supplement' | 'Unspecified';
}

/** What PDF/A metadata says about the document */
export interface PdfAInfo {
  title: string;
  author?: string;
  producer: string;
  creator: string;
  date: Date;
  lang?: string;
  facturX?: { profile: FacturXProfile; fileName: string };
}

const S15 = (v: number): number => Math.round(v * 65536);

/**
 * A small ICC v2 display profile for sRGB, built from the standard's D50-adapted primaries and a 2.2
 * gamma curve — enough for a PDF/A output intent, with no third-party profile file to license.
 */
export function weReportSrgbIccProfile(): Uint8Array {
  const tags: { sig: string; data: number[] }[] = [];
  const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
  const u32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const s15 = (v: number): number[] => u32(S15(v) >>> 0);
  const xyz = (x: number, y: number, z: number): number[] => [...ascii('XYZ '), 0, 0, 0, 0, ...s15(x), ...s15(y), ...s15(z)];
  const name = 'we-report sRGB';
  // textDescriptionType: ASCII description, then empty Unicode and ScriptCode parts (67 bytes)
  const desc = [...ascii('desc'), 0, 0, 0, 0, ...u32(name.length + 1), ...ascii(name), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...new Array(67).fill(0)];
  const cprt = [...ascii('text'), 0, 0, 0, 0, ...ascii('No copyright, use freely'), 0];
  const curve = [...ascii('curv'), 0, 0, 0, 0, ...u32(1), 0x02, 0x33]; // gamma 2.2 as u8Fixed8
  tags.push({ sig: 'desc', data: desc });
  tags.push({ sig: 'cprt', data: cprt });
  tags.push({ sig: 'wtpt', data: xyz(0.9642, 1.0, 0.8249) });
  tags.push({ sig: 'rXYZ', data: xyz(0.4361, 0.2225, 0.0139) });
  tags.push({ sig: 'gXYZ', data: xyz(0.3851, 0.7169, 0.0971) });
  tags.push({ sig: 'bXYZ', data: xyz(0.1431, 0.0606, 0.7141) });
  tags.push({ sig: 'rTRC', data: curve });
  tags.push({ sig: 'gTRC', data: curve });
  tags.push({ sig: 'bTRC', data: curve });

  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const table: number[] = [...u32(tags.length)];
  const body: number[] = [];
  for (const tag of tags) {
    while ((offset + body.length - 128 - tableSize) % 4) body.push(0);
    const at = 128 + tableSize + body.length;
    table.push(...ascii(tag.sig), ...u32(at), ...u32(tag.data.length));
    body.push(...tag.data);
  }
  offset = 128 + tableSize + body.length;
  while (offset % 4) {
    body.push(0);
    offset++;
  }
  const header = [
    ...u32(offset), // profile size
    0, 0, 0, 0, // preferred CMM
    0x02, 0x10, 0, 0, // version 2.1
    ...ascii('mntr'),
    ...ascii('RGB '),
    ...ascii('XYZ '),
    0x07, 0xd0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, // 2000-01-01 00:00:00
    ...ascii('acsp'),
    0, 0, 0, 0, // platform
    0, 0, 0, 0, // flags
    0, 0, 0, 0, // manufacturer
    0, 0, 0, 0, // model
    0, 0, 0, 0, 0, 0, 0, 0, // attributes
    0, 0, 0, 0, // rendering intent: perceptual
    ...s15(0.9642), ...s15(1.0), ...s15(0.8249), // PCS illuminant D50
    0, 0, 0, 0 // creator
  ];
  while (header.length < 128) header.push(0);
  return new Uint8Array([...header, ...table, ...body]);
}


/** An XMP date: `2026-11-24T10:15:30Z` — to the second, like the document information's date */
export const xmpDate = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The XMP packet of a PDF/A-3b document, with the Factur-X extension when an invoice is attached */
export function weReportPdfAXmp(info: PdfAInfo): string {
  const date = xmpDate(info.date);
  const fx = info.facturX;
  const facturX = fx
    ? `
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${escapeXml(fx.fileName)}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${escapeXml(fx.profile)}</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        ${['DocumentFileName|The name of the embedded XML document', 'DocumentType|The type of the hybrid document in capital letters, e.g. INVOICE or ORDER', 'Version|The actual version of the standard applying to the embedded XML document', 'ConformanceLevel|The conformance level of the embedded XML document']
          .map((p) => {
            const [name, description] = p.split('|');
            return `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`;
          })
          .join('\n        ')}
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>`
    : '';
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(info.title)}</rdf:li></rdf:Alt></dc:title>${
     info.author ? `\n   <dc:creator><rdf:Seq><rdf:li>${escapeXml(info.author)}</rdf:li></rdf:Seq></dc:creator>` : ''
   }${info.lang ? `\n   <dc:language><rdf:Bag><rdf:li>${escapeXml(info.lang)}</rdf:li></rdf:Bag></dc:language>` : ''}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${escapeXml(info.creator)}</xmp:CreatorTool>
   <xmp:CreateDate>${date}</xmp:CreateDate>
   <xmp:ModifyDate>${date}</xmp:ModifyDate>
   <xmp:MetadataDate>${date}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${escapeXml(info.producer)}</pdf:Producer>
  </rdf:Description>${facturX}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
