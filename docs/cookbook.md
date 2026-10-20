# Cookbook

Short recipes for reports people ask for. Each works in the designer without code; the JSON shows
what the designer writes, for people who generate reports.

## A ledger with a running balance and totals carried over

Rows: `date`, `doc`, `debit`, `credit`.

1. In the detail section add a text with `RunningSum([debit] - [credit])` — the balance after each
   row.
2. In the page header add `'Brought forward: ' + Format(CarriedSum([debit] - [credit]), 'n2')`.
3. In the page footer add `'Carried forward: ' + Format(RunningSum([debit] - [credit]), 'n2')`.

A running balance starts again in every group; the page totals always run over the whole report.

## One statement per customer, each numbered "page 1 of 2"

Group by customer and tick *New page and page numbers per group* on the group header
(`resetPageNumber`). Page X of Y now counts each customer's pages, and `CarriedSum` starts again for
every customer. Add a `bookmark` (`[customer]`) to the group header to get a PDF bookmark per
customer.

```json
{ "id": "byCustomer", "kind": "groupHeader", "groupBy": { "expression": "[customer]" },
  "resetPageNumber": true, "keepWithFirstRow": true, "bookmark": { "expression": "[customer]" },
  "height": 10, "controls": [] }
```

## The ten biggest customers

Group by customer, put `Sum([amount])` in the group footer, and on the group header (Advanced) set
*Order groups by* `Sum([amount])` with *Largest first* and *Only the first … groups* `10`. The report
footer's totals still add up every customer.

```json
{ "id": "byCustomer", "kind": "groupHeader", "groupBy": { "expression": "[customer]" },
  "orderBy": { "expression": "Sum([amount])", "descending": true }, "top": 10, "height": 8, "controls": [] }
```

## Customers with their payments from another table

Two data sources: `customers` (main) and `payments`. Put a **Sub-report** in the detail section and
double-click it. In its own designer, bind it to `payments` and design one row. Back outside, set
*Show only rows where* to `[customerId] = [^.id]` — `[^.id]` is the customer around the box. Its
report footer can total the customer's payments with `Sum([amount])`. The Studio template *Customer
statement* is built this way.

## Sales by city and month

A **Cross table** in the report footer: rows `[city]`, columns `Month([date])`, value `[amount]`,
sum. Numbers are sorted numerically (1, 2, … 12), and the total row and column are added. Use
`Format([date], 'MMM')` for month names — but then they sort alphabetically, so prefer numbers or
`Format([date], 'MM MMM')`.

## A trend in every row

Rows that hold a list (`{ "customer": "…", "months": [{ "total": 120 }, …] }`): add a **Chart** to
the detail section, type *Sparkline*, *Rows from a list in each row* `[months]`, value `[total]`,
and leave *Group by* empty. For a single number against the others in its group, use *Data bar*.

## A computed column used everywhere

Under **Data sources → Calculated fields** add `net` = `[qty] * [price] * (1 - [discount])`. Now
`[net]` works in texts, `Sum([net])`, sorting (`sortBy`), grouping and the Excel export.

## Pick a customer before the report runs

Add a parameter `customer` (number) with a list from the `customers` source: value field `id`,
label field `name` (`choices`). The viewer shows a drop-down of names; use `[?customer]` in a
database query condition or in a sub-report filter.

## Letters to many people

A detail section a page tall with *page break after*, and one text with **Rich text** on:

```
Dear **{[name]}**,

your balance on {Format(Today(), 'dd MMMM yyyy')} is **{Format([balance], 'c2')}**.
```

Field values are never read as formatting, so a name with `*` in it prints as typed.

## Shipping labels on a Zebra printer

Custom paper 100 × 150 mm, a detail section the size of the label with *page break after*, and a
Code 128 barcode bound to `[tracking]`. In the preview choose *More formats → Label printer (ZPL)*
and send the file to the printer's raw port. The whole label is sent as an image, so the fonts and
barcodes print exactly as previewed. Receipt printers take *ESC/POS* the same way (58 or 80 mm).

## Product photos from a web address

An image bound to `[photoUrl]` (an `https://` address) is fetched by the viewer and drawn in the
preview, the PDF and the PNG. The server must allow it (CORS); pictures that fail are listed
under Problems. Your own app can fetch them itself and pass them to `layoutReport` as `images`.
