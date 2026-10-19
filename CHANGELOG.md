# Changelog

## Unreleased

- Charts: a `chart` control (column, bar, line, pie, doughnut) that groups the rows of its section
  by a field and sums, counts, averages or takes the min/max of a value; value labels, legend with
  percentages, title, number format, own colours and grid colour. Drawn from the same primitives
  as everything else, so the preview and the PDF are identical.
- Conditional formatting: `formatting` rules on every item ("when `[Amount] < 0`, red and bold"),
  built in the designer without typing a formula.
- Watermark: large text behind every page (`watermark`), fixed or from data (e.g. `PAID` only for
  paid invoices), rotated 45° or straight.
- Formulas: `AmountInWords` and `NumberToWords` (Turkish and English).
- Designer: Arrange section (align edges/centres, space evenly, same width/height, bring to
  front/send to back), right-click menu, cut/copy/paste (also between designers) and select all
  with the usual shortcuts, an Outline tab listing every item by section, a top ruler with margins
  and the selection's extent, fit-to-width and Ctrl+wheel zoom.
- Studio: a "New" gallery with live first-page previews of every template (opens on the first
  visit), automatic saving of the current design in the browser with restore on reload, and a
  sales template showing charts and conditional formatting.
- Definition: all additions are optional, so existing `*.wrpt.json` files load unchanged (still
  version 1). A report using charts opened with 0.1.0 shows no chart.

## 0.1.0 — 2026-10-19

First public release.

- Look and feel follows Apple's Human Interface Guidelines: system type, translucent toolbars,
  segmented controls, borderless toolbar buttons, a filled-field inspector with round colour wells,
  Keynote-style selection handles, section labels beside the page instead of over it, sheet-style
  dialogs and soft layered shadows; light and dark; animations honour `prefers-reduced-motion`.
- Workspace: `we-report-core` (framework-free engine), `we-report-angular` (designer/viewer), `studio` app.
- Core: report definition format v1 (`*.wrpt.json`) with migration entry point, paper sizes (ISO A/B,
  North American, envelopes, thermal rolls, business card), unit conversion, page geometry.
- Core: expression language — fields, arithmetic, comparison, logic, `Iif`, string/math/date
  functions, aggregates (`Sum`, `Count`, `Avg`, `Min`, `Max`), Turkish-aware casing; no `eval`.
- Core: value formatting (`n2`, `c2`, `p0`, `d5`, date patterns) through `Intl`.
- Angular: first design surface — real-size page, margins, bands, positioned controls, zoom,
  EN/TR locale, CSS-variable theme with light/dark.
- Core: layout engine — report/page/group header and footer bands, detail, nested groups with
  sort, keep-together and repeat-on-every-page, can-grow text, page breaks, page X of Y and print
  date, continuous thermal rolls; text measured with the embedded font so preview and PDF match.
- Core: `[^.field]` reads the object around the detail rows (e.g. invoice header fields).
- Core: CSV parsing with delimiter detection and Turkish number/date inference; schema inference.
- Core: barcodes and QR codes (bwip-js) drawn as vector paths; PNG/JPEG images with fit modes.
- Core: PDF renderer (pdf-lib, loaded on demand) with subset font embedding; bundled Noto Sans.
- Angular: `<we-report-viewer>` — SVG pages, zoom, PDF download, print, problems list.
- Angular: `<we-report-designer>` — toolbox and data-field drag and drop, move/resize with grid and
  alignment-guide snapping, multi-select, undo/redo, keyboard shortcuts, property panel with
  Basic/Advanced modes, live data shown in the design, add/remove sections and groups, preview tab.
- Angular: `provideWeReport({ fonts, locale, currency })` — your own font families, embedded in PDFs.
- Studio: invoice template, paste JSON/Excel/CSV data, open and save `.wrpt.json`, TR/EN, dark theme.
- Data: report parameters (`[?name]`, `{{name}}` in web service requests, query conditions) with a
  parameter bar in the viewer; web service sources (direct or through the backend proxy) with a
  saved sample for offline design; database sources through the data backend.
- Designer: data sources dialog — JSON, CSV/Excel paste, web service with Test, database with a
  visual query builder (connection, table, columns, conditions, order, limit) or free SQL.
- Designer: "Design from data" builds a list report (headers, typed formats, totals, page numbers).
- Viewer: Excel export (XLSX writer in core, no dependency) of the report's rows with typed cells.
- Protocol: `protocol/openapi.yaml` v1 and `tools/protocol-conformance`.
- Sample backends: Node.js (no dependencies), .NET, Spring Boot and Python — SQLite, PostgreSQL
  and SQL Server (.NET/Java), web service proxy with SSRF protection, demo mode; all pass the
  conformance suite.
- Performance: fontkit and pdf-lib load on demand; the studio's initial bundle is ~270 kB gzipped.
- Designer: problems panel — items past the paper edge (one-click fix), formula errors, fields not in
  the data, empty formulas, overlapping texts; click a problem to select the item.
- Studio: templates — invoice, sales grouped by city (subtotals, parameter), 80 mm receipt.
- Packaging: the bundled Noto Sans fonts and their licence ship in `we-report-core/fonts`.
- Security (sample backends, after a review): SSRF guard covers hex IPv4-mapped/NAT64/numeric
  addresses and connects to the checked address in every language (Java now uses a pinned socket
  client); free SQL rejects backslash and dollar-quoted strings and treats `[identifiers]` as opaque;
  driver errors are logged, not returned; request bodies capped while reading; local-only mode
  checks the `Host` header; caller headers are dropped on cross-origin redirects; one deadline per
  fetch; connect timeouts for PostgreSQL; protocol dialect name `sqlserver`.
- Core: `now` is required for `layoutReport` and `reportTable` (reproducible output); PDF paths keep
  transparency; the viewer draws only colours the PDF can draw.
