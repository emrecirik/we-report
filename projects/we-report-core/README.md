# we-report-core

The framework-free engine of [we-report](https://github.com/emrecirik/we-report): the report format,
formulas, data loading, the layout/pagination engine, and PDF and Excel output. Runs in browsers and
Node. The Angular designer and viewer live in
[`we-report-angular`](https://www.npmjs.com/package/we-report-angular).

```bash
npm install we-report-core
```

```ts
import { FontRegistry, layoutReport, migrateDefinition, renderPdf, reportTable, writeXlsx } from 'we-report-core';

const fonts = await FontRegistry.create();
fonts.register('Noto Sans', { regular: regularBytes, bold: boldBytes }); // bundled in ./fonts

const report = migrateDefinition(JSON.parse(wrptJson));
const doc = layoutReport(report, { fonts, data, now: new Date(), locale: 'tr-TR', currency: 'TRY' });
const pdf = await renderPdf(doc, fonts, { title: report.name });            // Uint8Array
const xlsx = writeXlsx(reportTable(report, { data, now: new Date() }));      // Uint8Array
```

- Bands, nested groups, keep-together, repeated headers, can-grow text, page X of Y, receipt rolls
- Text is measured with the embedded font: the same pages on screen and in the PDF
- Barcodes/QR (bwip-js) as vectors; PNG/JPEG images; subset font embedding (pdf-lib)
- Formulas with their own interpreter (no `eval`); data from JSON, CSV, web services and the
  [we-report data protocol](https://github.com/emrecirik/we-report/blob/main/protocol/openapi.yaml)

Fonts in `fonts/` are Noto Sans under the SIL Open Font License (`fonts/OFL.txt`).

MIT © Emre CIRIK
