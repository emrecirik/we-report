# Changelog

## Unreleased

### New items

- **Sub-reports** (`type: 'subreport'`): a whole report inside a box, designed in its own designer
  window (double-click), or loaded from a saved report / RDLC / REPX file. Rows come from a formula
  over the outer row (`rows`) or the sub-report's own data, matched with `filter`
  (`[CustomerId] = [^.Id]`); `parameters` pass values from the outer row; *Its rows come from*
  suggests the lists in the data; its designer knows the row around it, so `[^.field]` shows a
  sample value and is no unknown field (`outerRow` input), its rows are those the filter matches
  to the sample row and its preview reads the row around (`outerRow` on the viewer,
  `LayoutOptions.parent`), and it offers no paper or watermark
  settings there (`embedded`). The box grows and pushes the items below it. Remote sources of
  sub-reports are loaded with the report (`allDataSources`). Nested sub-reports migrate with the
  file around them; more than five levels are refused.
- **Cross table** (`type: 'crosstab'`): rows × columns of the section's rows with sum / count /
  average / min / max, a total row and column, numbers sorted numerically, at most 500 rows and
  50 columns (a problem says when more were cut). A number wider than its cell is printed smaller,
  or as `###` when it would be unreadable — never cut off into a different number. It grows downwards and pushes the items below.
  A dropped cross table or chart starts grouped by the text fields that repeat, summing the number
  field with the largest total (never an identifier such as `orderNo` or a calendar field —
  `isSummableField` in core); a cross table puts the field with the fewest values across and
  shows whole numbers (`n0`).
- **Rich text** (`markup: true` on a text): `**bold**`, `*italic*`, `__underline__` and `{formula}`
  fields inside one text, wrapped and measured with the right font per word; the designer shows it
  formatted, Excel exports the words. `parseRichText`, `wrapRichText` and `plainRichText` are
  exported from core.
- Charts: **sparkline** type (a bare line with a dot on the last value) and `rows` — a chart in
  every detail row from a list inside that row (`[months]`). Choosing *Sparkline* shrinks the box.
- Charts: **data bar** type — the row's value as a bar, full at `max` or the section's largest value.

### Layout

- Damaged report files open: `migrateDefinition` drops optional fields of the wrong type, empties
  lists that are not lists, falls back to A4 for missing paper and leaves out items without a
  type; an unknown item type prints nothing. They used to break the designer or stop the layout
  with a technical error (found by feeding thousands of damaged files to the layout).
- A report stops at 20 000 pages with a problem saying so: a file with an item a million pages tall
  (report files are untrusted) no longer freezes the browser.
- A number wider than its text box or table cell is printed smaller on one line, or as `###` when
  it would be unreadable; it was cut off or wrapped, which can read as a different amount.
- A section taller than a page continues on the next pages, cut between items and text lines
  (boxes and lines are split, pictures never), instead of running off the page. A section that
  fits on no page starts right after the previous one; side-by-side cells are never cut.
- Groups: *New page and page numbers per group* (`resetPageNumber`) — every group starts on a new
  page, page X of Y counts the group's pages and carried totals restart: batch-printed statements.
- Groups: *Order groups by* (`orderBy`) — a formula over each group's rows, e.g. `Sum([amount])`
  descending: the biggest customers first (nested groups within their parent); with `top`, only
  the first N groups print and export (the top 10 customers).
- Groups: *Keep the header with the first row* (`keepWithFirstRow`) — no group header left alone
  at the bottom of a page.
- Sections: zebra stripes (`alternateBackgroundColor` on detail and inner-list sections) and
  *Print only when* (`visible` formula on any section but the page header/footer).
- **Document map**: a `bookmark` on group headers and the detail section becomes PDF bookmarks
  (nested by group; the PDF opens with them shown) and a list in the preview that jumps to the
  section (`LayoutDocument.bookmarks`).
- Page settings: page colour (`page.color`) and mirrored margins for booklets
  (`page.mirrorMargins`: even pages swap left and right), under Advanced.
- An item placed up to 1 mm inside a growing text is pushed down with it.
- Barcodes: the bars of linear codes end clearly above their digits; ISBN and other codes with
  text above the bars stay inside their box.
- Cross tables and charts skip empty values in averages, minimums and maximums (they counted as 0).

### Formulas and data

- Pasted dates whose day starts with a zero (`05.01.2026`) are read as dates; they stayed text.
- **Calculated fields** (`calculatedFields`): a formula per row used like a data field (`[total]`)
  in texts, totals, sorting, groups and exports; edited under Data sources, listed with the fields.
- `RunningSum(value)` — a running balance in a row (within its group), the amount carried forward
  in a page footer — and `CarriedSum(value)`, the total brought forward in a page header.
- `AddMonths`, `AddYears`, `DateDiff('day' | 'month' | 'year', start, end)` (days overdue, ages),
  `Left`, `Right`, `PadLeft`, `Switch(value, match, result, …, otherwise)` and `In(value, a, b, …)`.
- Date formats: `dddd` and `ddd` write the day's name (`Pazartesi`, `Pzt`); *Show as* offers a long date and a date with the day's name.
- Parameters can offer a list (`choices`): fixed values, or each value of a data field with an
  optional label field (a customer's name for its id). The viewer shows a drop-down; core exports
  `parameterChoices()`.
- Web services: **paged APIs** (`paging`: `{{page}}` / `{{offset}}` / `{{size}}` in the address;
  pages are loaded and joined until a short page, at most 20 or `maxPages` ≤ 100).
- **Pictures from addresses**: an image whose source (or data) is an `https://` address is fetched
  by the viewer and drawn in the preview, PDF and PNG (WebP/SVG converted; at most 200 pictures of
  10 MB, 15 s each, through the viewer's `fetchFn`). Core: `LayoutOptions.images` and
  `LayoutDocument.imageUrls` for a host's own fetching. The design page shows a placeholder.

### Viewer and output

- **PNG** — the current page as an image (200 dpi; `toPng(pageIndex, dpi)`).
- *More formats*: every page as PNG in one ZIP (`toPngZip()`), **CSV** (`toCsv()`; `;` and decimal commas in comma-decimal regions, a UTF-8
  byte-order mark, formula-like text defused; `writeCsv()` in core), Zebra **ZPL** (203 dpi) for
  label printers and **ESC/POS** (58 / 80 mm) for receipt printers — the pages sent as an image,
  so they print exactly as previewed (`toZpl()`, `toEscPos()`; `toMonoBitmap`, `zplFromBitmaps`,
  `escPosFromBitmaps` in core).
- Excel and CSV list the rows in the printed order (groups and the detail's sort keys).
- Every text line is drawn exactly as wide as the engine measured it (SVG `textLength`, and in
  PNG), so the screen matches the PDF; styled words no longer leave gaps.
- PDF: the report's language is written into the file (`PdfOptions.lang`), for screen readers.
- The viewer loads the remote sources of sub-reports.
- `hide` input: leave toolbar parts out (`print`, `pdf`, `excel`, `png`, `more`, `search`,
  `thumbnails`, `map`). The document-map button also shows on single-page reports.
- A page wider than the preview (zoomed in, landscape) can be scrolled to its left edge; it was
  centred with its left part out of reach. On a phone the first preview fits the page's width
  (when `zoom` is left at 1); *Fit width* leaves room for the scrollbar.
- `WeReportLocale` has new keys; a custom locale that spreads an existing one
  (`{ ...weReportLocaleEn, … }`, see docs/localization.md) gets them automatically.

### Speed

- Long reports lay out about twice as fast: number and date formatters are reused, and running
  totals (`RunningSum`, `CarriedSum`) add each row once instead of re-adding all rows before it
  (`EvaluationContext.runningTotals`, `RunningTotals`). 20 000 grouped rows: 3.5 s → 1.8 s.

### Designer

- *Tidy up* (right-click a section or several items): snaps to the grid, lines up items that are
  nearly in a row or column, one height per row of texts; one undo step.
- Problems: a fixed EAN-13 / EAN-8 / UPC-A / ITF-14 with a wrong check digit is reported with the
  right digit, and *Fix* corrects it (`gtinCheckDigit` in core; `ReportIssueCode` gains
  `checkDigit` — a `switch` over every code needs the new case).
- *Fit size to text* measures what a bound text prints, also while *Show data* is off.
- The report wizard and *Design from data* no longer total calendar fields (month, year, day …).
- Sub-reports, charts, cross tables, barcodes, check boxes and pictures from data are drawn on the
  design page as they print, from the sample data (clipped to their box), instead of an icon.

- Data sources: when the app passes the rows (`data`), the main source says its own data is only a
  fallback (`hostDataNote`), instead of showing an empty source with 0 rows as if data were missing.
- Dark theme: scrollbars and form controls are dark too (`color-scheme: dark` in the theme's dark
  blocks).

### Import

- DevExpress calculated fields become calculated fields of the report.
- RDLC external images and REPX `ImageUrl` pictures from a web address are kept.

### Studio

- *History*: the design is kept in the browser whenever a template, file or shared link replaces it
  and every few minutes while editing (20 kept); *Restore* brings one back.
- New templates: customer statement (sub-report), e-Archive (e-Arşiv) invoice look, cheques and
  notes list (grouped by due month, days left, totals carried forward), mail merge letter (rich
  text), business cards (A4, 10 per sheet), payment receipt (A5) and shipping label (100×150). The grouped sales template keeps its headers with their first row and has bookmarks.
- Opening a shared link that fetches from a web service or database (also inside a sub-report)
  shows a warning; a design too large for a link says so instead of producing a link that will not
  open. Studio has unit tests (`npm test` runs them). Esc closes the gallery, history and data
  dialogs; landscape templates fit their gallery card; a blank report is named in the page's
  language.

## 0.6.0 — 2026-10-20

- Data protocol 1.1 (backward compatible, still `/v1`): query `offset` and `distinct`, the
  case-insensitive `contains` / `startsWith` operators, `count: true` → `total`, and
  `GET/PUT/DELETE /v1/layouts/{key}` for saved grid layouts and sheets (capabilities `grid` and
  `layouts`; layouts are off in demo mode, keys 1-100 characters, bodies up to 256 KB). All six
  sample backends implement it and pass the extended conformance suite (15 checks) on SQLite and
  PostgreSQL. Used by we-grid-angular 0.11 for server-side paging and server-saved layouts.

- Designer: texts that will be cut off in print are underlined in orange and listed under
  Problems (measured with the report's fonts); *Fix* turns on *Grow to fit text*. `wrapText` is
  exported from core, with `fitLines` (the rule the engine cuts text by). `ReportIssueCode` gains `textCut`
  (a `switch` over every code needs the new case).
- Layout: a text that grows pushes the items below it (in the same columns) down instead of
  overlapping them, keeping their spacing — as in desktop designers.
- Formula editor: suggestions while typing — functions with their explanation, `[` for fields and
  parameters; arrows to choose, Enter or Tab to insert.
- Items can *extend to the bottom when the section grows* (`stretch`), so cell borders and column
  lines stay aligned next to a text that grows (Advanced → Behaviour).
- Formulas: `RowNumber()` — 1, 2, 3 … for each row, restarting in every group and inner list.
- Studio: delivery note template (row numbers, quantities, signature lines).
- Studio: *Share* puts the design and its data into a link (gzip in the address bar, no server);
  opening the link loads it like an opened file.
- Designer: *Fit size to text* (right-click) sizes texts to what they show, measured with the
  report's fonts.
- Designer: zoom, grid size and *Show data* are remembered in the browser, like the panel widths.
- Designer: fold a section away (double-click its label, or right-click) to make room while
  working on others; only the designer view changes.
- Designer: right-click a value in the detail section → *Add a total of this column* puts its sum
  under it in every group footer and the report footer (added when missing).
  *Group rows by this value* adds a group with that value as its heading.
- Designer: a search box over the data fields when there are many.
- Designer: the report wizard focuses its first field and its Create button is off until a column
  or a grouping is chosen; Ctrl+S while typing on the page keeps the text and reaches the app's save.

## 0.5.0 — 2026-10-20

- Designer, desktop comfort: type on the page (double-click, F2 or just start typing on a selected
  text or table cell), formulas open the formula editor; rubber-band selection; distances to the nearest items while moving; Ctrl+drag copies;
  copy and paste through the system clipboard (also between tabs, and pictures or text from other
  programs); drop a PNG/JPEG from the desktop onto the page; drop a field on a text to bind it;
  click a toolbox item or double-click a field to add it; a format bar (font, size, bold, italic,
  underline, alignment, colours, border); right-click menu (also: add text here, fit a section to its content); outline tab; status bar with pointer
  position and selection size; resizable and collapsible side panels that remember their width;
  zoom menu; grid size menu (0.5–5 mm or no grid); format painter (copy one item's look to another); keyboard shortcuts sheet (F1); Tab moves between items, Ctrl+arrows resize.
- Viewer: page thumbnails, first/previous/next/last page, a page-number box that follows scrolling, zoom presets
  (50–200 %, fit width, whole page), find in report (Ctrl+F) with highlighted matches and
  next/previous, PageUp/PageDown/Home/End and Ctrl+P. New theme token `--we-report-search-highlight`.
- Sorting: the detail section can sort its rows (`sortBy: [{ expression, descending }]`, inside
  each group); the designer has "Sort rows by" on the detail section.
- Report wizard: "Design from data" now asks which columns to show, what to group and sort by, whether to
  print totals and which paper orientation to use, then builds the list (`generateListReport`
  takes `GenerateOptions { groupBy, sortBy, sortDescending, totals, orientation }`).
- Generated lists: yes/no columns print as tick boxes; camelCase identifiers (`orderNo`,
  `customerId`) are no longer summed and print without thousands separators.
- Studio: certificate template (one page filled from parameters); Ctrl+S saves, Ctrl+O opens.
- Fix: duplicating several items of the same kind gave them the same id.
- Items pasted from the system clipboard are checked (known kind, numeric position and size, a
  table's rows and columns) before they reach the report; a malformed `sortBy` in a report file is
  ignored instead of failing the layout. New toolbar icons are on `WE_REPORT_ICONS`.

## 0.4.0 — 2026-10-19

- Smaller apps: the barcode engine (bwip-js, ~0.9 MB) now loads on demand together with the font
  engine (`FontRegistry.create()`), so an app's initial bundle shrinks from about 1.5 MB to 0.6 MB
  and fits Angular's default 1 MB budget. No API change.
- Security (sample backends): POST bodies must be `application/json` (else 415) and proxied
  web-service content is served with `Content-Security-Policy: sandbox`. A page on another site
  could otherwise post a plain form to a local backend's fetch proxy and have its HTML run on the
  backend's origin. All six samples fixed; the conformance suite checks it. The PHP sample pins
  curl to the checked address with `CURLOPT_CONNECT_TO`.
- CI: every supported Angular major (18–22) builds a new app with the packed libraries (`compat.yml`).
- Import: open Microsoft RDLC/RDL (Visual Studio, SSRS, Report Builder) and DevExpress REPX layouts
  and convert them — paper, bands, text, tables, lines, shapes, images, barcodes, page info,
  groups, detail reports, styles, calculated fields, parameters and expressions — with a plain list
  of what could not be carried over (`importReport`, `importRdlc`, `importRepx`; Studio: Open).
  See [Moving reports from other tools](docs/migrating.md); sample files in `samples/import`.
- Sample backends for **PHP** (plain PHP 8.2+, PDO, no framework or Composer packages) and **Go**
  (one static binary; SQLite in pure Go, PostgreSQL via pgx). Both pass the protocol conformance
  suite against SQLite and PostgreSQL in CI and follow the same security rules as the others:
  local-only without a token, read-only queries with timeouts and row limits, free SQL off by
  default, 1 MB request bodies, and an SSRF-guarded web-service proxy pinned to checked addresses.

## 0.3.0 — 2026-10-19

- Inner lists (master–detail): new `subHeader`, `subDetail` (with `rowsPath`) and `subFooter`
  sections print a list inside every detail row — e.g. each customer's orders with their own
  header and subtotal — and page like any other section. Inside them `[field]` is the item and
  `[^.field]` the row around it; totals run over the row's items. The designer lists the inner
  fields, shows their live values and checks them; Studio has a customer-orders template.
- Tables: a `table` control — column widths, rows, cells that span columns, fixed text or formulas
  per cell with their own format, bold, alignment and background; the table's border becomes the
  grid; rows can grow to fit their text. In the designer: click a cell to edit it, add/remove rows
  and columns, merge and split, set column width and row height, drop a data field on a cell.
- Label sheets: the detail section can print rows side by side (`columns: { count, gap }`), filling
  across, then down, then the next sheet. Ready layouts for common A4 and Letter label sheets
  (`LABEL_SHEETS`, `applyLabelSheet`) set the paper, margins and label size in one step; the
  designer shades where the other labels go.
- Barcodes: the digits under a linear barcode keep their shape when the bars are stretched to a
  wide or short box.
- Fixes: rows that fit a page exactly no longer move to the next page (float drift; two label
  sheets lost their last row); a multi-column section's background is one column wide; applying a
  label sheet keeps groups and inner lists; Excel export includes table cells.
- Docs: [Designing reports](docs/designing.md).
- Studio: a shelf-label template (A4, 21 per sheet) with product, price and barcode.

## 0.2.0 — 2026-10-19

- Languages: the designer and viewer now speak German (`weReportLocaleDe`), French
  (`weReportLocaleFr`) and Spanish (`weReportLocaleEs`) besides English and Turkish;
  `weReportLocaleFor('de-AT')` picks one from a locale tag; a test keeps every language complete.
- Regions: a report can carry its own `locale` and `currency` (designer: Language and region), so
  its numbers, dates, money and amounts in words look the same wherever it is printed.
- Studio: five languages (remembers the choice, follows the browser on the first visit), npm
  downloads and GitHub stars in the header. README shows npm version/download badges.
- Charts: a `chart` control (column, bar, line, pie, doughnut) that groups the rows of its section
  by a field and sums, counts, averages or takes the min/max of a value; value labels, legend with
  percentages, title, number format, own colours and grid colour. Drawn from the same primitives
  as everything else, so the preview and the PDF are identical.
- Conditional formatting: `formatting` rules on every item ("when `[Amount] < 0`, red and bold"),
  built in the designer without typing a formula.
- Watermark: large text behind every page (`watermark`), fixed or from data (e.g. `PAID` only for
  paid invoices), rotated 45° or straight.
- Formulas: `AmountInWords` and `NumberToWords` (Turkish and English), and a formula editor (ƒx
  next to every formula) listing fields, parameters and every function by category with a
  one-line explanation, inserting at the cursor and showing the result for the first row as you
  type. Core exports the catalogue as `EXPRESSION_FUNCTIONS`.
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
