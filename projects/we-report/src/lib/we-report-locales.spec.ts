import { EXPRESSION_FUNCTIONS } from 'we-report-core';
import { WE_REPORT_LOCALES, weReportLocaleFor } from './we-report-locales';
import { weReportLocaleEn } from './we-report-locale';

/** Every key path of an object, nested ones as `a.b`. */
function keyPaths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([k, v]) => (v && typeof v === 'object' ? keyPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
}

describe('UI languages', () => {
  it('translate every string, including every function explanation', () => {
    const expected = keyPaths(weReportLocaleEn);
    for (const [code, locale] of Object.entries(WE_REPORT_LOCALES)) {
      expect(keyPaths(locale)).withContext(code).toEqual(expected);
      for (const f of EXPRESSION_FUNCTIONS) expect(locale.functionHelp[f.name]).withContext(`${code} ${f.name}`).toBeTruthy();
      for (const [key, text] of Object.entries(locale)) {
        if (typeof text === 'string') expect(text.trim()).withContext(`${code}.${key}`).not.toBe('');
      }
    }
  });

  it('picks the language of a locale tag and falls back to English', () => {
    expect(weReportLocaleFor('de-AT')).toBe(WE_REPORT_LOCALES['de']);
    expect(weReportLocaleFor('fr_CA')).toBe(WE_REPORT_LOCALES['fr']);
    expect(weReportLocaleFor('TR')).toBe(WE_REPORT_LOCALES['tr']);
    expect(weReportLocaleFor('ja-JP')).toBe(weReportLocaleEn);
    expect(weReportLocaleFor(undefined)).toBe(weReportLocaleEn);
  });
});
