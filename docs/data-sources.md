# Data sources

Open **Data sources** in the designer. A report can have several sources; one of them feeds the
detail band ("rows come from"), optionally from a list inside it (`lines`, `data.items`).

| Source | Backend needed? |
|---|---|
| JSON (pasted, or passed by your app) | No |
| CSV / Excel table (pasted with its header row) | No |
| Web service the browser may call | No |
| Web service that blocks browsers (CORS) or needs a secret key | Yes — called *through the backend* |
| Live database (SQL Server, PostgreSQL, MySQL, SQLite …) | Yes |

## Data from your app

The simplest and most common: your Angular app already has the data.

```html
<we-report-viewer [report]="invoiceReport" [data]="invoice" />
```

`data` replaces the bound source's data. If the rows are a list inside it (an invoice and its
`lines`), set **Rows come from** to `lines`; the invoice's own fields are then available as
`[^.number]`, `[^.customer.name]`.

## CSV and Excel

Copy a table from Excel (including the header row) and paste it. Separators (`,` `;` tab) are
detected; Turkish numbers and dates (`1.234,56`, `31.12.2026`) are read as numbers and dates;
codes with leading zeros (`00123`) stay text.

## Web services

Address, method, headers and body; `{{name}}` inserts a [parameter](#parameters) (URL-encoded in
the address). **Test** calls the service, finds the list inside the answer and saves the answer as
sample data so the report can be designed even when the service is not reachable.

- Called from the browser by default. Anything typed here is visible in the browser and stored in
  the report file — never put secret keys here.
- Tick **Call through the data backend** for services that block browser calls (CORS) or need
  secrets: the backend calls them (protected against requests to internal addresses), and the
  secret can live in the backend instead.
- Your app can pass its own `fetchFn` to the viewer and designer to add auth headers.

## Databases

With a [data backend](backend.md) running: **+ Database → Connect → choose connection → table →
columns → conditions → order → Test**. Conditions can use fixed values or report parameters.
Connections that allow it also accept free SQL (`SELECT … WHERE date >= :from`).

The browser never sees connection strings — only connection names.

## Parameters

Values asked before the report runs: a date range, a customer, "only unpaid". Define them in
**Data sources → Parameters** (name, type, label, default). Use them as:

- `[?from]` in formulas
- `{{from}}` in web service addresses, headers and bodies
- a condition value in the database query builder

The viewer shows a parameter bar; the report runs with the defaults and again with
**Run report**. Your app can pass values: `<we-report-viewer [parameters]="{ from: '2026-01-01' }">`.
