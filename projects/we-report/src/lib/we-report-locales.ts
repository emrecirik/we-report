import { weReportLocaleDe } from './locales/de';
import { weReportLocaleEs } from './locales/es';
import { weReportLocaleFr } from './locales/fr';
import { WeReportLocale, weReportLocaleEn, weReportLocaleTr } from './we-report-locale';

/**
 * Every bundled UI language by its ISO 639-1 code. Importing this pulls in all of them; import a
 * single `weReportLocaleXx` instead to ship only one.
 */
export const WE_REPORT_LOCALES: Record<string, WeReportLocale> = {
  en: weReportLocaleEn,
  tr: weReportLocaleTr,
  de: weReportLocaleDe,
  fr: weReportLocaleFr,
  es: weReportLocaleEs,
};

/** The UI strings for a BCP 47 tag (`de-AT` → German); English when there is no translation. */
export function weReportLocaleFor(tag: string | undefined): WeReportLocale {
  const language = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return WE_REPORT_LOCALES[language] ?? weReportLocaleEn;
}
