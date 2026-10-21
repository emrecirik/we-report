# Getting started

we-report is two npm packages:

| Package | What it is |
|---|---|
| `we-report-core` | The engine: report format, formulas, data loading, layout, PDF and Excel output. No framework; runs in browsers and Node. |
| `we-report-angular` | `<we-report-designer>` and `<we-report-viewer>` for Angular 18 – 22. |

No backend is needed to design, preview, print or export. A backend is only for live databases
and web services that block browser calls — see [data sources](data-sources.md).

## Install

```bash
npm install we-report-angular we-report-core
```

Serve the bundled fonts (Noto Sans: Latin, Turkish, Greek, Cyrillic) by adding them to the assets
of your app in `angular.json`:

```json
"assets": [
  { "glob": "*.ttf", "input": "node_modules/we-report-core/fonts", "output": "assets/we-report/fonts" }
]
```

and the theme to your global styles:

```scss
@use 'we-report-angular/styles/we-report-theme';
```

The font reader pulls in `pako`, which ships as CommonJS. To silence the build warning about it,
add it to `allowedCommonJsDependencies` in the build options of `angular.json`:

```json
"allowedCommonJsDependencies": ["pako"]
```

## Configure

```ts
// app.config.ts
import { provideWeReport, weReportLocaleTr } from 'we-report-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideWeReport({ locale: 'tr-TR', currency: 'TRY' }, weReportLocaleTr),
  ],
};
```

| Option | Meaning |
|---|---|
| `locale`, `currency` | Number, money and date formatting of report output. |
| `fonts` | Your own font families (see [theming](theming.md#fonts)). |
| `defaultFontsUrl` | Where the bundled fonts are served (`assets/we-report/fonts/`), or `null` to use only yours. |
| `backendUrl` | A [data backend](backend.md), for live databases and proxied web services. |

The second argument is the language of the designer and viewer (`weReportLocaleEn` by default;
also `weReportLocaleTr`, `De`, `Fr`, `Es` — see [Languages and regions](localization.md)).

## Let users design reports

```ts
import { WeReportDesignerComponent } from 'we-report-angular';
import { createBlankReport, ReportDefinition } from 'we-report-core';

@Component({
  imports: [WeReportDesignerComponent],
  template: `<we-report-designer [(report)]="report" [data]="orders" style="height: 100vh" />`,
})
export class ReportEditorPage {
  report = signal<ReportDefinition>(createBlankReport('Orders'));
  orders = [{ no: 1, customer: 'Ayla', total: 1250.5 }];
}
```

`report` is updated on every edit. Save it anywhere — it is plain JSON (`*.wrpt.json`):

```ts
save() {
  this.http.put('/api/reports/orders', this.report()).subscribe();
}
```

`data` is optional sample data: its fields appear in the field list, it is shown inside the design
and used by the preview. Without it, the report's own data sources are used.

`fieldLabels` gives fields readable names when the data's own names are technical (`OrderNumber`,
`Supplier.SupplierName`): keys are paths from the data root, lists without `[]`, and objects or
lists themselves can be named too.

```html
<we-report-designer [(report)]="report" [data]="order"
  [fieldLabels]="{ OrderNumber: 'Order no', Supplier: 'Supplier', 'Supplier.SupplierName': 'Supplier name', Items: 'Lines', 'Items.ProductName': 'Product' }" />
```

The field list, the formula editor, the wizard and the list pickers show the labels (the name
stays as a tooltip, and search finds both); a dropped field's caption and the wizard's column
headings use them. Formulas and the saved report keep the real names. In core,
`generateListReport(..., { labels })` takes column headings by field name.

## Show and print reports

```ts
import { WeReportViewerComponent } from 'we-report-angular';

@Component({
  imports: [WeReportViewerComponent],
  template: `<we-report-viewer [report]="report" [data]="invoice" />`,
})
export class InvoicePage { /* … */ }
```

The viewer shows pages exactly as the PDF will print them, with zoom, a document map, find,
**Print**, **PDF**, **Excel** and **PNG** (the current page as an image) buttons; in code
`toPdf()`, `toXlsx()` and `toPng(pageIndex, dpi)`. `hide` leaves toolbar parts out, e.g.
`[hide]="['excel', 'more']"` (`print`, `pdf`, `excel`, `png`, `more`, `search`, `thumbnails`,
`map`). `parameters` passes
[report parameters](data-sources.md#parameters), `printDate` fixes the print time for
reproducible output, and `outerRow` is what `[^.field]` reads (a sub-report shown on its own). On
a phone the first preview fits the page's width unless you set `zoom`.

*More formats* saves:

- every page as **PNG in one ZIP** (`toPngZip(dpi)`);
- the rows as **CSV** (`toCsv()`), with `;` and decimal commas in regions that use them;
- the pages for **label printers** (Zebra ZPL, `toZpl(dpi)`) and **receipt printers** (ESC/POS,
  `toEscPos(dots)`) as an image the printer prints directly, so fonts and barcodes come out as
  previewed. Send the file to the printer's raw port (e.g. `copy /b label.zpl \\host\zebra` on
  Windows, `lp -o raw` elsewhere). In core, `toMonoBitmap`, `zplFromBitmaps` and
  `escPosFromBitmaps` do the encoding.

## Without Angular (Node, a worker, a CLI)

```ts
import { FontRegistry, layoutReport, migrateDefinition, renderPdf } from 'we-report-core';

const fonts = await FontRegistry.create();
fonts.register('Noto Sans', { regular: await read('NotoSans-Regular.ttf'), bold: await read('NotoSans-Bold.ttf') });

const report = migrateDefinition(JSON.parse(text)); // upgrades files saved by older versions
const doc = layoutReport(report, { fonts, data, now: new Date(), locale: 'tr-TR', currency: 'TRY' });
const pdf = await renderPdf(doc, fonts, { title: report.name });
```

`layoutReport` is synchronous and deterministic: the same report, data, fonts and `now` always
produce the same pages. `reportTable` + `writeXlsx` (or `writeCsv`) produce a spreadsheet of the rows.

## Next

- [Cookbook](cookbook.md) — recipes: running balances, statements per customer, sub-reports, labels
- [Formulas](expressions.md) — `[Price] * [Qty]`, `Sum(...)`, `Iif(...)`, formats
- [Data sources](data-sources.md) — JSON, CSV/Excel, web services, databases, parameters
- [Data backend](backend.md) — the protocol and ready-made backends in six languages
- [Theming and fonts](theming.md)
