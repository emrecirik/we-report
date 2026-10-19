# we-report

[![npm version](https://img.shields.io/npm/v/we-report-angular.svg?label=we-report-angular)](https://www.npmjs.com/package/we-report-angular)
[![npm downloads](https://img.shields.io/npm/dm/we-report-angular.svg?label=downloads)](https://www.npmjs.com/package/we-report-angular)
[![npm version](https://img.shields.io/npm/v/we-report-core.svg?label=we-report-core)](https://www.npmjs.com/package/we-report-core)
[![npm downloads](https://img.shields.io/npm/dm/we-report-core.svg?label=downloads)](https://www.npmjs.com/package/we-report-core)
[![CI](https://github.com/emrecirik/we-report/actions/workflows/ci.yml/badge.svg)](https://github.com/emrecirik/we-report/actions/workflows/ci.yml)
[![Angular 18-22 builds](https://github.com/emrecirik/we-report/actions/workflows/compat.yml/badge.svg)](https://github.com/emrecirik/we-report/actions/workflows/compat.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Angular 18-22](https://img.shields.io/badge/Angular-18%20%E2%80%93%2022-dd0031.svg)](https://angular.dev)
[![Languages](https://img.shields.io/badge/UI-EN%20%C2%B7%20TR%20%C2%B7%20DE%20%C2%B7%20FR%20%C2%B7%20ES-5b5bd6.svg)](docs/localization.md)

**Free, open-source, native Angular report designer and viewer.** Design banded reports with drag
and drop, bind them to JSON, Excel/CSV, web services or live databases, preview, print and export to
PDF and Excel — the DevExpress XtraReports / Crystal Reports experience, MIT licensed, with **no
backend required**.

**Try it:** [we-report Studio](https://emrecirik.github.io/we-report/) · **Install:** `npm install we-report-angular we-report-core`

## Why

- **The preview is the PDF.** One layout engine measures text with the embedded font, so the
  screen, the printout and the PDF break lines and pages in exactly the same places.
- **Data first.** Paste a table from Excel, call a web service or pick a database table — then
  *Design from data* builds a tidy report with headers, totals and page numbers in one click.
- **Live data while designing.** Fields show the first record's real values, not `[CustomerName]`.
- **Plain language.** "Grow to fit text", "Keep group on one page", "Show only when" — a Basic mode
  that hides everything a first report does not need.
- **Any backend, or none.** Everything runs in the browser. For live databases there is a small,
  documented protocol and ready-made backends for **.NET, Spring Boot, Node.js, Python, PHP and Go**.
- **Yours.** Your fonts embedded in PDFs, your colours (designer theme and report styles), English
  and Turkish out of the box, free forever.

## What is in it

| | |
|---|---|
| Paper | ISO A0–A6, B4/B5, Letter, Legal, Tabloid, Executive, envelopes, 58/80 mm receipt rolls (page grows with content), business cards, any custom size, portrait/landscape, margins |
| Sections | Report header/footer, page header/footer, nested groups (sort, keep together, repeat on every page), detail, page breaks |
| Items | Text, data fields, lines, rectangles/ellipses, images (fit/fill/stretch), 1D/2D barcodes and QR codes (Code128, EAN, UPC, ITF, GS1-128, DataMatrix, PDF417, Aztec …, as vectors), checkboxes, page number / page X of Y / print date |
| Formulas | `[Price] * [Qty]`, `Iif`, `Sum/Count/Avg/Min/Max` per group/page/report, text, math and date functions, Turkish casing, `[^.invoiceNo]` parent fields, `[?param]` parameters — no `eval` |
| Formats | Numbers, money, percent, dates — with the locale (`1.234,50 ₺`, `5 Ocak 2026`) |
| Data | JSON, CSV/Excel paste (Turkish numbers and dates recognised), web services (direct or via backend), SQL Server, PostgreSQL, SQLite (via a backend), report parameters |
| Designer | Drag from toolbox and field list, move/resize with grid and alignment-guide snapping, multi-select, undo/redo, keyboard nudging, properties panel, preview tab, light/dark |
| Output | Paged preview, print, PDF (embedded subset fonts), Excel (typed cells) |

## Packages

| Package | |
|---|---|
| `we-report-core` | Framework-free engine: report format, formulas, data, layout, PDF and Excel. Browser and Node. |
| `we-report-angular` | `<we-report-designer>` and `<we-report-viewer>` for Angular 18 – 22. |

## Documentation

- [Getting started](docs/getting-started.md)
- [Designing reports](docs/designing.md) — sections, inner lists, labels, tables, charts
- [Moving reports from other tools](docs/migrating.md) — open RDLC/RDL and DevExpress REPX files
- [Formulas](docs/expressions.md)
- [Data sources](docs/data-sources.md)
- [Data backend](docs/backend.md) — protocol and samples
- [Theming and fonts](docs/theming.md)
- [Languages and regions](docs/localization.md)

## Development

```bash
npm install
npm run build:libs     # we-report-core, then we-report-angular
npm test               # unit tests (headless Chrome)
npm start              # Studio on http://localhost:4200
```

Sample backends live in [`samples/backends`](samples/backends); each one passes
`npm run conformance -- <url>`.

## Support the project

we-report is and will stay free. If it saves you a licence, consider sponsoring its development.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE). The bundled Noto Sans fonts
are under the SIL Open Font License.
