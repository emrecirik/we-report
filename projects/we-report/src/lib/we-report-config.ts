import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { DEFAULT_FONT_FAMILY } from 'we-report-core';
import { WE_REPORT_LOCALE, WeReportLocale } from './we-report-locale';

/** A font file: a URL to fetch or the bytes themselves. */
export type WeReportFontFile = string | Uint8Array;

export interface WeReportFontFamily {
  family: string;
  regular: WeReportFontFile;
  bold?: WeReportFontFile;
  italic?: WeReportFontFile;
  boldItalic?: WeReportFontFile;
}

export interface WeReportConfig {
  /** Font families reports can use, in addition to (or replacing) the bundled Noto Sans. */
  fonts?: WeReportFontFamily[];
  /**
   * Where the bundled Noto Sans files are served from. Add this to `angular.json` assets:
   * `{ "glob": "*.ttf", "input": "node_modules/we-report-core/fonts", "output": "assets/we-report/fonts" }`.
   * Set to `null` to not load them (then `fonts` must provide at least one family).
   */
  defaultFontsUrl?: string | null;
  /**
   * Address of a we-report data backend (any language implementing protocol/openapi.yaml), for live
   * database data and proxied web services. Not needed for JSON, CSV or open web services.
   */
  backendUrl?: string;
  /** Number and currency formatting of report output (`tr-TR`, `TRY`). */
  locale?: string;
  currency?: string;
}

export const WE_REPORT_CONFIG = new InjectionToken<WeReportConfig>('WE_REPORT_CONFIG', {
  providedIn: 'root',
  factory: () => ({}),
});

export const DEFAULT_FONTS_URL = 'assets/we-report/fonts/';

export function defaultFontFamily(baseUrl: string): WeReportFontFamily {
  const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return {
    family: DEFAULT_FONT_FAMILY,
    regular: url + 'NotoSans-Regular.ttf',
    bold: url + 'NotoSans-Bold.ttf',
    italic: url + 'NotoSans-Italic.ttf',
    boldItalic: url + 'NotoSans-BoldItalic.ttf',
  };
}

/** `provideWeReport({ fonts, locale: 'tr-TR', currency: 'TRY' }, weReportLocaleTr)` in app config. */
export function provideWeReport(config: WeReportConfig = {}, uiLocale?: WeReportLocale): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: WE_REPORT_CONFIG, useValue: config },
    ...(uiLocale ? [{ provide: WE_REPORT_LOCALE, useValue: uiLocale }] : []),
  ]);
}
