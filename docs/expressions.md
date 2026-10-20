# Formulas

Any text, barcode value, image, checkbox or "show only when" can be fixed or a formula. Formulas run
in we-report's own interpreter — never `eval` — so report files are safe to open.

## Values

| Write | Means |
|---|---|
| `[Price]` | The field `Price` of the current row |
| `[Customer.City]` | A nested field |
| `[^.number]` | A field of the object around the rows — e.g. the invoice header when the rows are its `lines` |
| `[?from]` | The value of the report parameter `from` |
| `'text'` or `"text"` | Text (double the quote inside: `'it''s'`) |
| `12`, `3.5`, `true`, `null` | Numbers, booleans, nothing |

Field names may contain spaces: `[Sipariş No]`.

## Operators

`+ - * / %`, comparisons `= != <> < <= > >=`, logic `and or not` (or `&& || !`), parentheses.
`+` joins text when either side is text: `'Sayın ' + [Name]`.
Arithmetic with an empty value gives an empty value; dividing by zero is an error.

## Functions

| Function | Example | Result |
|---|---|---|
| `Iif(cond, a, b)` | `Iif([Qty] > 10, 'Wholesale', 'Retail')` | Only the chosen branch is evaluated |
| `IsNull(v, fallback)` | `IsNull([Note], '-')` | |
| `Concat(a, b, …)` | `Concat([First], ' ', [Last])` | |
| `Len`, `Upper`, `Lower`, `Trim` | `Upper([City])` | Turkish casing with the `tr-TR` locale: `i → İ` |
| `Substring(s, start, length?)` | `Substring([Code], 0, 3)` | |
| `Replace(s, find, with)`, `Contains`, `StartsWith`, `EndsWith` | | |
| `Round(n, digits?)`, `Abs`, `Floor`, `Ceiling` | `Round(1.005, 2)` | `1.01` (half away from zero) |
| `ToNumber`, `ToString`, `Format(v, pattern)` | `Format([Date], 'dd MMMM yyyy')` | |
| `Today()`, `Now()` | | The print time |
| `Year`, `Month`, `Day`, `AddDays(d, n)` | `AddDays([^.date], 30)` | |
| `Sum`, `Count`, `Avg`, `Min`, `Max` | `Sum([Qty] * [Price])` | Over the rows in scope |
| `RowNumber()` | `RowNumber()` | `1`, `2`, `3` … — restarts in every group and inner list |
| `RunningSum(v)` | `RunningSum([Debit] - [Credit])` | Total so far: in a row, up to that row within its group (a running balance that starts again in every group, like `RowNumber()`); in a page footer, over the whole report up to the end of the page — the amount carried forward |
| `CarriedSum(v)` | `CarriedSum([Total])` | In a page header: the total of the earlier pages, brought forward (`0` on the first page) |
| `AmountInWords(n, currency?)` | `AmountInWords(Sum([Total]))` | `Bin İki Yüz Elli Türk Lirası Elli Kuruş` (`tr-TR`, TRY) · `twelve dollars and five cents` (other locales); the configured currency when omitted |
| `NumberToWords(n)` | `NumberToWords(1234)` | `Bin İki Yüz Otuz Dört` / `one thousand two hundred thirty-four` |

Aggregates work over the group in group headers/footers, the page in page headers/footers, and
all rows in report headers/footers. `Count()` counts rows; `Min(a, b)`/`Max(a, b)` with two
arguments compare two values.

## Conditional formatting

Every item can carry rules: *when the formula is true, use this colour, background or bold*.
The designer builds the formula from three choices (field, comparison, value), e.g.
`[Amount] < 0` or `Contains([Name], 'Ltd')`; any formula works in Advanced mode. Rules apply in
order, a later rule wins on the same property.

## Formats ("Show as")

| Pattern | Example (`tr-TR`) |
|---|---|
| `n0`, `n2` | `1.235`, `1.234,50` |
| `c2` | `₺1.234,50` (the configured currency) |
| `p0`, `p1` | `26%`, `25,6%` (of a 0–1 ratio) |
| `d5` | `00042` |
| `dd.MM.yyyy HH:mm` | `05.01.2026 09:07` |
| `d MMMM yyyy` | `5 Ocak 2026` |
| `'Tarih:' dd/MM/yy` | `Tarih: 05/01/26` (quoted text is literal) |

Page numbers use `{0}` (page) and `{1}` (pages): `Sayfa {0} / {1}`.

## Errors

A broken formula never stops the report: the cell shows `#ERR` and the problem is listed above the
preview with the formula and the reason ("Division by zero", "Unknown function", "Fields are
written in brackets: [Price]").
