# Contributing

Thanks for considering a contribution to we-report. Every contribution is welcome — code, report
templates, translations, paper/label sizes, and sample backends in new languages.

## Setup

```bash
npm install
npm run build:libs    # build we-report-core, then we-report-angular
npm test              # unit tests (headless Chrome)
npm start             # studio on http://localhost:4200
```

## Guidelines

- Anything that affects report output (layout, pagination, expressions, formatting, export) lives
  in `projects/we-report-core`, which must not import Angular, the DOM or Node built-ins.
- Designer/viewer visuals go through `var(--we-report-*, fallback)` custom properties; new ones are
  declared in all three blocks of `projects/we-report/styles/we-report-theme.scss`.
- No hardcoded user-facing text — add a key to `WeReportLocale` and fill both `weReportLocaleEn`
  and `weReportLocaleTr`.
- No icon fonts; icons are inline SVG.
- A change to the report definition format needs a version bump and a migration, so saved reports
  keep opening.
- Comments and identifiers in English. Add or update `*.spec.ts` for every behavioural change.
- `npm run build:libs` and `npm test` must be clean before a PR — CI runs the same steps.

## Reporting issues

Please include: Angular version, we-report version, the report definition (`.wrpt.json`) and sample
data if possible, and the expected vs. actual result.
