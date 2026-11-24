# Cookbook

Short recipes for reports people ask for. Each works in the designer without code; the JSON shows
what the designer writes, for people who generate reports.

## An e-invoice (Factur-X / ZUGFeRD)

*(0.10.0)* A Factur-X invoice is a PDF/A-3 that people read and an XML (UN/CEFACT Cross Industry
Invoice) that accounting software reads — the e-invoice format of Germany (ZUGFeRD, XRechnung via
CII) and France. Describe the invoice once; `weReportCiiInvoice` writes the EN 16931 XML and
`renderPdf` puts it inside the report's PDF/A-3b.

**Without code** *(0.11.0)*: in the designer (advanced mode, nothing selected) open
**E-invoice (Factur-X)** → **Map an e-invoice** and give each field a formula. Invoice fields read
the object around the rows, line fields read each detail row. The report file then carries:

```json
"eInvoice": {
  "number": "[^.number]",
  "issueDate": "[^.date]",
  "dueDate": "AddDays([^.date], [^.paymentDays])",
  "currency": "'EUR'",
  "iban": "[^.iban]",
  "seller": { "name": "[^.seller.name]", "city": "[^.seller.city]", "country": "'DE'", "vatId": "[^.seller.vatId]" },
  "buyer": { "name": "[^.customer.name]", "city": "[^.customer.city]", "country": "[^.customer.country]" },
  "line": { "id": "[code]", "name": "[product]", "quantity": "[qty]", "unitPrice": "[price]", "vatRate": "[vat]" }
}
```

Every PDF of that report is then a Factur-X invoice — from the viewer's download, the designer's
preview or `renderPdf` on a server — because `layoutReport` puts the XML on the document
(`doc.eInvoice`) and `renderPdf` embeds it. A field the data leaves empty, or a value that is not a
number or a date, shows up in the preview's problems ("E-invoice: line 3 quantity is not a number.")
and the PDF comes out without the invoice. `weReportEInvoice(report, { data })` returns the mapped
invoice for printing its totals with `weReportInvoiceTotals`. Allowances, charges and exemption
reasons are not mapped yet; pass `facturX` yourself for those (it wins over the mapping), or
`facturX: false` for a PDF without it. The invoice lines follow the data's order — the detail band's
sorting and grouping are for the page.

With code:

```ts
import { renderPdf, weReportCiiInvoice, weReportInvoiceTotals } from 'we-report-core';

const invoice = {
  number: 'INV-2026-0042', issueDate: new Date('2026-11-24'), dueDate: new Date('2026-12-24'), currency: 'EUR',
  seller: { name: 'Sample GmbH', address: 'Musterstraße 1', postcode: '10115', city: 'Berlin', country: 'DE', vatId: 'DE123456789' },
  buyer: { name: 'Client SARL', city: 'Lyon', country: 'FR' },
  lines: [{ id: 'A-1', name: 'Consulting', quantity: 8, unitPrice: 95, vatRate: 19 }]
};
const pdf = await renderPdf(doc, fonts, {
  title: 'Invoice INV-2026-0042',
  facturX: { xml: weReportCiiInvoice(invoice), profile: 'EN 16931' }
});
```

- Amounts are worked out in whole cents: each line net, the VAT once per rate (halves away from
  zero, so a credit note is the invoice negated), the grand total. `weReportInvoiceTotals(invoice)`
  returns those numbers — print them, and the PDF and the XML agree to the cent. A report that adds up
  its own totals with a different rounding can differ by a cent.
- The PDF is PDF/A-3b with `factur-x.xml` attached (AFRelationship *Alternative*; *Data* for the
  MINIMUM and BASIC WL profiles) and the Factur-X XMP extension. The Studio's Invoice template
  produces one from its sample data; that file passes the Mustang validator (PDF/A, XML schema and
  the 670 Factur-X EN 16931 rules) and veraPDF.
- VAT categories *(0.11.0)*: standard (`S`, the default above 0 %), zero-rated (`Z`, the default at
  0 %), exempt (`E`) and reverse charge (`AE`) through a line's `vatCategory`, with
  `vatExemptionReasons` for the text the breakdown shows. Document-level `allowances` (discounts)
  and `charges` (shipping, packing) go into the VAT basis of their own category and rate; `payment`
  writes a SEPA credit transfer (IBAN, BIC, account name); `buyerReference` is the BT-10 reference
  XRechnung requires (the Leitweg-ID). Each of these was checked with the Mustang validator.
- A credit is a negative quantity. A negative price, a rate that does not fit its category (`S` at
  0 %, `AE` above 0 %) or a number that is not finite throws a `RangeError`. Intra-community supply
  (`K`), export (`G`) and out-of-scope (`O`) lines are not modelled yet — bring your own CII XML
  through `facturX.xml` for those.

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

## Invoice totals at the bottom of the page

Put the totals, the amount in words and the signature lines in the report footer and tick *At the
bottom of the last page* (Advanced, `printAtBottom`). However few the lines, the block sits just
above the page footer; with many lines it follows them onto the last page.

## The ten biggest customers

Group by customer, put `Sum([amount])` in the group footer, and on the group header (Advanced) set
*Order groups by* `Sum([amount])` with *Largest first* and *Only the first … groups* `10`. Excel
and CSV export the same ten; the report footer's totals still add up every customer.

```json
{ "id": "byCustomer", "kind": "groupHeader", "groupBy": { "expression": "[customer]" },
  "orderBy": { "expression": "Sum([amount])", "descending": true }, "top": 10, "height": 8, "controls": [] }
```

## Each customer's share of the total

In the group footer (or the detail row) add a text with `Sum([amount]) / SumAll([amount])` and
format `p0` (`[amount] / SumAll([amount])` in a row). `SumAll` is the grand total of every row,
wherever it stands, so the shares add up to 100 %.

## "Page 2 of 5" inside a sentence

A text with the formula `'Sayfa ' + [PageNumber] + ' / ' + [Pages] + ' — ' + [?customer]` — the
page fields work in any formula and in rich text (`{[PageNumber]}`); with *page numbers per group*
they count the group's pages.

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
