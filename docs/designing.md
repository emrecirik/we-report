# Designing reports

A report is a stack of **sections** (bands) holding **items** (controls). Everything below can be
done in the designer without writing a formula; the JSON shapes are shown for people who generate
reports in code. Lengths are millimetres, font sizes points.

## Sections

| Section | Prints |
|---|---|
| Report header / footer | once, at the start / end |
| Page header / footer | on every page |
| Group header / footer | around every group of rows (`groupBy`, nested groups allowed); *New page and page numbers per group* (`resetPageNumber`) prints each group as its own document — one statement per customer, each "page 1 of 2" |
| Detail | once for every row, in data order or sorted (`sortBy`, inside each group) |
| Inner list header / inner list / inner list footer | for a list *inside* every row — see below |

### Inner lists (master–detail)

When every row holds a list — a customer with its orders, an invoice with its lines — add an
**inner list** (`subDetail`) and choose the list (`rowsPath`). It prints under each row, once per
item, with an optional header (`subHeader`) and footer (`subFooter`):

```json
{ "id": "orders", "kind": "subDetail", "height": 6, "rowsPath": "orders", "controls": [ … ] }
```

Inside it `[field]` is the item and `[^.field]` the row around it; `Sum([amount])` and `Count()` in
the inner footer run over that row's items. Rows with an empty list print no inner list. The
header always starts on the same page as the first item.

### Sub-reports

A **sub-report** is a whole report — its own sections, styles, data and parameters — printed inside
a box. Double-click it (or *Edit sub-report…*) to design it in its own designer window, or put a
saved report (`.wrpt.json`, RDLC, REPX) into it. Its rows come from, in this order:

- **Its rows come from** (`rows`): a formula over the row around it, e.g. `[orders]`;
- otherwise its own data source, or one of the outer report's sources by id.

**Show only rows where** (`filter`) keeps matching rows, e.g. `[CustomerId] = [^.Id]` to show each
customer's payments from another table. Inside the sub-report `[^.field]` reads the row around the
box, and its parameters (`[?name]`) take values from formulas over that row (`parameters`).

```json
{ "id": "pay", "type": "subreport", "x": 10, "y": 8, "width": 120, "height": 14,
  "report": { "version": 1, "name": "Payments", … },
  "filter": { "expression": "[CustomerId] = [^.Id]" } }
```

The box grows to fit its rows and pushes the items below it down. Web-service and database sources
of sub-reports load once with the report, not per row. Sub-reports may be nested five deep.

### Sections taller than a page

A section that needs more room than a page — a long sub-report or text — continues on the next
pages. It is cut between items and between text lines; pictures, barcodes and charts are never
cut, and boxes and lines are split at the cut.

### Side by side: labels and cards

The detail section can print rows next to each other (`columns: { count, gap }`). Design one label;
the designer shades where the others go. **Label sheet** in the detail section's properties sets
the paper, margins and label size for common A4 and Letter sheets (`LABEL_SHEETS`,
`applyLabelSheet` in code). The Problems list warns when an item is wider than its label.

## Items

| Item | Notes |
|---|---|
| Text | Fixed text or a formula; *Grow to fit text* makes the row taller instead of cutting it, and pushes the items below it (in the same columns) down. Items marked *Extend to the bottom when the section grows* (`stretch`) grow with it, so cell borders and column lines stay aligned. *Rich text* (`markup`) formats words inside the text — `**bold**`, `*italic*`, `__underline__` — and inserts data with `{formula}`: `Dear **{[name]}**, your order of {Format([date], 'dd MMMM yyyy')}…`; field values are never read as formatting, `{{`, `}}` and `\*` write the characters themselves. |
| Table | Column widths, rows, cells that span columns. Click a cell to edit its content, format, bold, alignment and background; drop a data field on a cell to bind it. The table's border becomes the grid; *Grow to fit text* grows each row to its tallest cell. |
| Chart | Column, bar, line, pie or doughnut of the section's rows grouped by a field (sum, count, average, min, max). In a report header/footer it shows every row, in a group footer the group's rows. *Rows from a list in each row* (`rows`, e.g. `[months]`) draws a small chart in every detail row from that row's own list; the *Sparkline* type is a bare line scaled to its own values (leave *Group by* empty to plot every item in order). *Data bar* draws the row's value as a bar, full at `max` or at the largest value among the section's rows. |
| Cross table | A pivot of the section's rows: one row per value of a field, one column per value of another, each cell the sum (count, average, min, max) of the rows that have both, with a total row and column (`Σ`, or your `totalLabel`). Like a chart it reads every row in a report header/footer, the group's rows in a group footer; it grows downwards and its columns share the width. |
| Sub-report | A separate report inside a box; see *Sub-reports* above. |
| Barcode / QR | Code 128, EAN-13, QR, DataMatrix, PDF417 and more; the value can come from data. A fixed EAN/UPC with a wrong check digit shows under Problems, with the right digit. |
| Image | A PNG/JPEG you choose, or a picture from data: a `data:` URI or an `https://` address (e.g. a product photo). The viewer fetches addresses (the server must allow it — CORS), converts WebP/SVG to PNG and lays out again; one that fails is listed under Problems. In code, pass fetched pictures as `layoutReport(…, { images })` — `LayoutDocument.imageUrls` lists the ones still needed. |
| Line, shape, checkbox, page number / date | |

## Look

- **Conditional formatting** — on any item: *when [Amount] < 0, red and bold*. Rules apply in
  order; built from field, comparison and value, or any formula in Advanced mode.
- **Page** — paper, orientation and margins; in Advanced mode a page colour (`page.color`) and
  mirrored margins for booklets (`page.mirrorMargins`: even pages swap left and right).
- **Sections** — a background colour, zebra stripes for detail rows (*Every second row*,
  `alternateBackgroundColor`) and, in Advanced mode, *Print only when* (`visible`, e.g.
  `[Discount] > 0`).
- **Keep the header with the first row** (`keepWithFirstRow`) — a group header never ends a page
  alone; *Keep group on one page* (`keepTogether`) moves the whole group instead.
- **Bookmarks** — a group header or the detail section can carry a `bookmark` (fixed text or a
  formula such as `[Customer]`): the entries become PDF bookmarks and the preview's *Document map*,
  nested by group (`LayoutDocument.bookmarks` in code).
- **Watermark** — large faint text behind every page (`watermark`), fixed or from data, e.g. `PAID`
  only on paid invoices.
- **Language and region** — a report can carry its own `locale` and `currency`, so it writes
  numbers, dates, money and amounts in words the same way wherever it is printed. See
  [Languages and regions](localization.md).

Formulas and formats are described in [Formulas](expressions.md).

## Working in the designer

The designer behaves like a desktop report designer:

- **Start fast** — the *Report wizard* builds a list from your data: pick the columns, what to group and
  sort by, totals and paper orientation. Undo brings your previous design back.
- **Add** — drag an item or a data field onto the page, or click an item / double-click a field to
  add it to the selected section. Right-click an empty spot for *Add text here*. Drop a field on a
  text to show that field there; drop a PNG/JPEG from your desktop to place a picture.
- **Edit text in place** — double-click, press F2 or Enter, or just start typing on a selected text
  or table cell. Enter keeps it, Shift+Enter starts a new line, Escape cancels. Formulas open the
  formula editor instead.
- **Select** — click, Shift/Ctrl-click to add, drag on an empty part of a section for a rubber
  band, Tab to step through items, Ctrl+A for everything.
- **Move and size** — drag (items snap to the grid and to other items; hold Alt to move freely),
  arrows move by 1 mm (Shift: 5 mm, Alt: 0.1 mm), Ctrl+arrows resize. While moving, the distance
  to the nearest items is shown. Ctrl+drag leaves a copy behind. The grid menu sets 0.5–5 mm or no
  grid. *Tidy up* (right-click a section or a selection) puts items on the grid, lines up those
  that are nearly in a row or column and gives the texts of a row one height.
- **Format** — the format bar sets font, size, bold/italic/underline (Ctrl+B/I/U), alignment,
  colours and borders for everything selected; the brush copies one item's look to the next item
  you click.
- **Clipboard** — Ctrl+C / Ctrl+X / Ctrl+V use the system clipboard, so items paste into another
  tab; text or a screenshot copied from another program pastes as a text or picture item.
- **View** — Ctrl+wheel or Ctrl+= / Ctrl+− zoom, Ctrl+0 fits the width; the side panels can be
  resized or hidden (double-click their edge). F5 switches to the preview, F1 lists every shortcut.

The preview has page thumbnails, page navigation (PageUp/PageDown, Home/End), zoom presets, find
in report (Ctrl+F, Enter for the next match) and printing (Ctrl+P).
