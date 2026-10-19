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
| Detail | once for every row |
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
| Text | Fixed text or a formula; *Grow to fit text* makes the row taller instead of cutting it. |
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
