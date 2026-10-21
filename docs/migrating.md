# Moving reports from other tools

we-report opens Microsoft and DevExpress report layouts and converts them into its own format.
In the Studio: **Open** and pick the file. In code:

```ts
import { importReport } from 'we-report-core';

const { report, warnings } = importReport(fileText, 'Invoice.rdlc');
// report: a we-report definition; warnings: what could not be carried over, in plain words
```

`importReport` judges the file by its content; `importRdlc` and `importRepx` convert one kind
directly. Only the layout is converted — **add your data** under Data sources afterwards (report
files keep only where the data came from). Try it with the samples in
[`samples/import`](../samples/import).

## Microsoft RDLC / RDL (Visual Studio, SSRS, Report Builder)

RDL 2008, 2010 and 2016 files (`.rdlc`, `.rdl`).

| Carried over | Notes |
|---|---|
| Paper, orientation, margins | Named paper when the size matches, else a custom size. |
| Page header and footer | |
| Text boxes | Text runs and paragraphs, fonts, colours, alignment, padding, borders, *Can grow*, number formats (`N2`, `C2`, `P0`, date patterns). |
| The main table (tablix) | Header rows print at the start, the details row once per data row, total rows at the end; spanned cells kept. |
| Lines, rectangles, embedded images, images from a field or a web address (`https://…`) | |
| `="Page " & Globals!PageNumber & " of " & Globals!TotalPages` | Becomes a page-number item. |
| `Globals!PageNumber`, `Globals!TotalPages` elsewhere in a formula | `[PageNumber]`, `[Pages]` |
| Data set fields, report parameters | Field names are mapped to their data fields. |
| Expressions | `Fields!X.Value`, `Parameters!X.Value`, `&`, `IIF`, `Sum/Count/Avg/Min/Max` (scope argument dropped), `First`, `CountRows()`, `Format(x, "N2")`, `UCase`, `LCase`, `CStr`, `CInt`/`CDbl`/`CDec`, `Today`, `Now`, `Nothing`. |

Not converted (listed in the warnings): charts, gauges, maps, subreports, lists/matrices, row
groups inside a table, a second table in the body, custom code (`Code.`), `Lookup`,
`RunningValue`, external images from a file path.

## DevExpress REPX (XtraReports v18 and later)

XML layouts as saved by the DevExpress designers. Older layouts saved as C# code must be opened
and saved again in a current designer first.

| Carried over | Notes |
|---|---|
| Paper, orientation, margins, report unit | Hundredths of an inch or tenths of a millimetre. |
| Bands | Report/page header and footer, groups (by level, with sort, *Repeat every page*, keep together), detail, page breaks. |
| Detail reports | Become an inner list over their data member. |
| Labels and table cells | Text, expression bindings (and older data bindings), `TextFormatString` (`{0:c2}`, `Total: {0:n0}`), summaries, fonts, colours, alignment, padding, borders, *Can grow*, *Visible* bindings. |
| Tables, panels, lines, shapes, pictures (embedded, from a field or a web address), barcodes, check boxes, page info | |
| Style sheet | Named styles keep their names. |
| Calculated fields | Become calculated fields of the report (a name with spaces or dots is put in place where it is used instead). |
| Parameters | `?name` and `[Parameters.name]` become `[?name]`. |

Not converted (listed in the warnings): charts, rich text, subreports, cross tabs, pivot grids,
items in the page margins, watermarks, running summaries.

Expressions are close to ours already (brackets, `Iif`, `Concat`, `Upper` …); aggregates
(`sumSum([x])` → `Sum([x])`), `GetYear`/`GetMonth`/`GetDay`, `ToStr` and `FormatString` are
translated.
