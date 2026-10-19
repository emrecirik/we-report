# Theming and fonts

Two separate things can be styled:

1. **The designer and viewer** (your app's look) — CSS custom properties.
2. **The report itself** (what is printed) — styles inside the report, edited in the designer.

## Designer and viewer

Every colour of the UI is a `--we-report-*` custom property with a light and a dark value. Override
any of them in your global styles:

```css
:root {
  --we-report-accent: #0f766e;
  --we-report-workspace-bg: #f5f5f4;
}
```

Dark mode follows `prefers-color-scheme`, or force it with `<html data-theme="dark">`
(`data-theme="light"` forces light).

| Property | Used for |
|---|---|
| `--we-report-font-family` | UI text |
| `--we-report-fg`, `--we-report-muted-fg` | Text, secondary text |
| `--we-report-accent` | Buttons, selection in lists, links |
| `--we-report-workspace-bg` | Around the pages |
| `--we-report-toolbar-bg`, `--we-report-panel-bg`, `--we-report-input-bg`, `--we-report-hover-bg` | Surfaces |
| `--we-report-page-bg`, `--we-report-page-shadow` | The paper |
| `--we-report-band-border`, `--we-report-band-label-bg`, `--we-report-band-label-fg` | Report sections in the designer |
| `--we-report-margin-guide`, `--we-report-control-outline` | Guides in the designer |
| `--we-report-selection`, `--we-report-selection-fill`, `--we-report-guide` | Selected items, alignment guides |
| `--we-report-warning-bg`, `--we-report-warning-fg` | Problems and warnings |
| `--we-report-search-highlight` | Matches of *find in report* in the viewer |

Icons are inline SVG on the `WE_REPORT_ICONS` token — provide your own set to restyle them.

## Report styles

Text, colours and borders of report items come from the report's style sheet (`styles` in the
report file) and per-item overrides set in the properties panel. A report has a `default` style;
named styles (`title`, `columnHeader` …) can be shared by many items — change the style once and
every item using it follows.

## Fonts

we-report measures text with the same font file it embeds in the PDF, so the preview and the PDF
break lines and pages in exactly the same places. Bring your own families:

```ts
provideWeReport({
  fonts: [
    {
      family: 'Kurumsal',
      regular: 'assets/fonts/Kurumsal-Regular.ttf',
      bold: 'assets/fonts/Kurumsal-Bold.ttf',
      italic: 'assets/fonts/Kurumsal-Italic.ttf',
      boldItalic: 'assets/fonts/Kurumsal-BoldItalic.ttf',
    },
  ],
});
```

- TTF or OTF files, as URLs or `Uint8Array` bytes.
- The family appears in the designer's font list; PDFs embed only the characters used.
- A missing bold or italic file falls back to the regular one (no fake bold).
- Check the font's licence allows embedding in documents.
- The bundled Noto Sans (SIL Open Font License) covers Latin, Turkish, Greek and Cyrillic.
