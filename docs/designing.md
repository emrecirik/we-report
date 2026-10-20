# Designing reports

A report is a stack of **sections** (bands) holding **items** (controls). Everything below can be
done in the designer without writing a formula; the JSON shapes are shown for people who generate
reports in code. Lengths are millimetres, font sizes points.

## Sections

| Section | Prints |
|---|---|
| Report header / footer | once, at the start / end |
| Page header / footer | on every page |
| Group header / footer | around every group of rows (`groupBy`, nested groups allowed) |
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

### Side by side: labels and cards

The detail section can print rows next to each other (`columns: { count, gap }`). Design one label;
the designer shades where the others go. **Label sheet** in the detail section's properties sets
the paper, margins and label size for common A4 and Letter sheets (`LABEL_SHEETS`,
`applyLabelSheet` in code). The Problems list warns when an item is wider than its label.

## Items

| Item | Notes |
|---|---|
| Text | Fixed text or a formula; *Grow to fit text* makes the row taller instead of cutting it, and pushes the items below it (in the same columns) down. Items marked *Extend to the bottom when the section grows* (`stretch`) grow with it, so cell borders and column lines stay aligned. |
| Table | Column widths, rows, cells that span columns. Click a cell to edit its content, format, bold, alignment and background; drop a data field on a cell to bind it. The table's border becomes the grid; *Grow to fit text* grows each row to its tallest cell. |
| Chart | Column, bar, line, pie or doughnut of the section's rows grouped by a field (sum, count, average, min, max). In a report header/footer it shows every row, in a group footer the group's rows. |
| Barcode / QR | Code 128, EAN-13, QR, DataMatrix, PDF417 and more; the value can come from data. |
| Image, line, shape, checkbox, page number / date | |

## Look

- **Conditional formatting** — on any item: *when [Amount] < 0, red and bold*. Rules apply in
  order; built from field, comparison and value, or any formula in Advanced mode.
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
  grid.
- **Format** — the format bar sets font, size, bold/italic/underline (Ctrl+B/I/U), alignment,
  colours and borders for everything selected; the brush copies one item's look to the next item
  you click.
- **Clipboard** — Ctrl+C / Ctrl+X / Ctrl+V use the system clipboard, so items paste into another
  tab; text or a screenshot copied from another program pastes as a text or picture item.
- **View** — Ctrl+wheel or Ctrl+= / Ctrl+− zoom, Ctrl+0 fits the width; the side panels can be
  resized or hidden (double-click their edge). F5 switches to the preview, F1 lists every shortcut.

The preview has page thumbnails, page navigation (PageUp/PageDown, Home/End), zoom presets, find
in report (Ctrl+F, Enter for the next match) and printing (Ctrl+P).
