# we-report-angular

[![npm version](https://img.shields.io/npm/v/we-report-angular.svg)](https://www.npmjs.com/package/we-report-angular)
[![npm downloads](https://img.shields.io/npm/dm/we-report-angular.svg)](https://www.npmjs.com/package/we-report-angular)
[![CI](https://github.com/emrecirik/we-report/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecirik/we-report/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/emrecirik/we-report/blob/main/LICENSE)
[![Angular 18-22](https://img.shields.io/badge/Angular-18%20%E2%80%93%2022-dd0031.svg)](https://angular.dev)

**Free, native Angular report designer and viewer.** Drag-and-drop banded reports, live data in the
design, paper sizes from A4 to 80 mm receipt rolls, barcodes and QR codes, parameters, print, PDF and
Excel — MIT licensed, no backend required. Angular 18 – 22.

**Try it:** [we-report Studio](https://emrecirik.github.io/we-report/) ·
**Docs:** [github.com/emrecirik/we-report](https://github.com/emrecirik/we-report#documentation)

```bash
npm install we-report-angular we-report-core
```

Serve the bundled fonts (`angular.json` → assets) and include the theme:

```json
{ "glob": "*.ttf", "input": "node_modules/we-report-core/fonts", "output": "assets/we-report/fonts" }
```

```scss
@use 'we-report-angular/styles/we-report-theme';
```

```ts
// app.config.ts
providers: [provideWeReport({ locale: 'tr-TR', currency: 'TRY' }, weReportLocaleTr)]
```

```html
<!-- let users design -->
<we-report-designer [(report)]="report" [data]="orders" />

<!-- show, print, export -->
<we-report-viewer [report]="report" [data]="orders" />
```

The report is plain JSON (`*.wrpt.json`) — store it anywhere. The preview, the printout and the PDF
are laid out by the same engine with the same font, so they break pages in the same places.

- Data: JSON from your app, pasted Excel/CSV, web services, live databases through a
  [small backend](https://github.com/emrecirik/we-report/blob/main/docs/backend.md) in any language
  (.NET, Spring Boot, Node.js and Python samples included)
- Formulas: `[Price] * [Qty]`, `Sum(...)`, `Iif(...)`, report parameters — no `eval`
- Your fonts (embedded in PDFs), your colours, English and Turkish UI

MIT © Emre CIRIK
