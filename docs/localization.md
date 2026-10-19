# Languages and regions

we-report separates two things:

- **The language of the designer and viewer** — buttons, menus, hints. Bundled: English, Türkçe,
  Deutsch, Français, Español.
- **The region of the report output** — how numbers, dates, money and amounts in words are written
  (`1.234,50 ₺` or `$1,234.50`). Any locale the browser's `Intl` knows works.

## Designer and viewer language

Pass the language as the second argument of `provideWeReport`:

```ts
import { provideWeReport, weReportLocaleDe } from 'we-report-angular';

providers: [provideWeReport({ locale: 'de-DE', currency: 'EUR' }, weReportLocaleDe)];
```

| Language | Export |
|---|---|
| English (default) | `weReportLocaleEn` |
| Türkçe | `weReportLocaleTr` |
| Deutsch | `weReportLocaleDe` |
| Français | `weReportLocaleFr` |
| Español | `weReportLocaleEs` |

Import only the one you use and the others stay out of your bundle. To follow the user's language
at runtime, `weReportLocaleFor('de-AT')` returns the matching language (English when there is none)
and both components take it as an input:

```html
<we-report-designer [(report)]="report" [locale]="ui()" />
<we-report-viewer [report]="report" [locale]="ui()" />
```

```ts
ui = computed(() => weReportLocaleFor(this.userLanguage()));
```

`weReportLocaleFor` and `WE_REPORT_LOCALES` import every bundled language.

### Changing or adding a language

A language is a plain object of type `WeReportLocale`, so TypeScript tells you every string that is
missing. Change a few strings by spreading an existing one:

```ts
const myGerman = { ...weReportLocaleDe, print: 'Ausdrucken', newReportTitle: 'Auswertung' };
```

For a new language, copy `projects/we-report/src/lib/locales/de.ts`, translate it, and — if you
would like everyone to have it — open a pull request adding it to `WE_REPORT_LOCALES`. The test
`we-report-locales.spec.ts` checks that every string and every formula function is translated.

## Report region

`provideWeReport({ locale, currency })` sets the default for every report. A report can carry its
own, so an invoice written for Germany prints `1.234,50 €` wherever it runs:

```json
{ "version": 1, "name": "Rechnung", "locale": "de-DE", "currency": "EUR", ... }
```

In the designer: select nothing, then **Language and region** in the properties. The region drives
the `n`/`c`/`p` and date formats, chart labels, and `AmountInWords` / `NumberToWords` (Turkish for
`tr-*`, English otherwise).
