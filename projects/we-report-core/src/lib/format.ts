export interface FormatOptions {
  /** BCP 47 locale, e.g. `tr-TR`. */
  locale: string;
  /** ISO 4217 code used by the `c` pattern, e.g. `TRY`. */
  currency: string;
}

const NUMBER_PATTERN = /^([nNcCpPdD])(\d{0,2})$/;
const DATE_TOKENS = /yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|mm|ss|'[^']*'/g;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Accepts a Date or an ISO-8601 string; a bare `yyyy-MM-dd` is a local date (no time-zone shift). */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (ISO_DATETIME.test(value)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Formats a value for display. Numbers: `n2` (grouped, 2 decimals), `c2` (currency), `p0`
 * (percent of a 0-1 ratio), `d4` (integer, zero padded). Dates: tokens `yyyy yy MMMM MMM MM M
 * dddd ddd dd d HH H mm ss` (`dddd` the day's name), literal text in single quotes.
 */
export function formatValue(value: unknown, pattern: string | undefined, options: FormatOptions): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value, pattern, options);
  const date = pattern || value instanceof Date ? toDate(value) : null;
  if (date) return formatDate(date, pattern, options.locale);
  return String(value);
}

// Building an Intl formatter costs far more than using one; a report formats thousands of values.
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function numberFormat(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = 'n' + locale + JSON.stringify(options);
  let f = formatters.get(key) as Intl.NumberFormat | undefined;
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(locale, options)));
  return f;
}
function dateFormat(locale: string, options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const key = 'd' + locale + JSON.stringify(options);
  let f = formatters.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat(locale, options)));
  return f;
}

function formatNumber(value: number, pattern: string | undefined, { locale, currency }: FormatOptions): string {
  const m = pattern ? NUMBER_PATTERN.exec(pattern) : null;
  if (!m) return numberFormat(locale).format(value);
  const kind = m[1].toLowerCase();
  const digits = m[2] === '' ? undefined : Number(m[2]);
  switch (kind) {
    case 'd': {
      const s = Math.trunc(Math.abs(value)).toString().padStart(digits ?? 0, '0');
      return value < 0 ? '-' + s : s;
    }
    case 'c':
      return numberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    case 'p':
      return numberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: digits ?? 0,
        maximumFractionDigits: digits ?? 0,
      }).format(value);
    default:
      return numberFormat(locale, {
        minimumFractionDigits: digits ?? 2,
        maximumFractionDigits: digits ?? 2,
      }).format(value);
  }
}

function formatDate(date: Date, pattern: string | undefined, locale: string): string {
  if (!pattern) return dateFormat(locale).format(date);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  return pattern.replace(DATE_TOKENS, (token) => {
    switch (token) {
      case 'yyyy': return pad(date.getFullYear(), 4);
      case 'yy': return pad(date.getFullYear() % 100);
      case 'MMMM': return dateFormat(locale, { month: 'long' }).format(date);
      case 'MMM': return dateFormat(locale, { month: 'short' }).format(date);
      case 'MM': return pad(date.getMonth() + 1);
      case 'M': return String(date.getMonth() + 1);
      case 'dddd': return dateFormat(locale, { weekday: 'long' }).format(date);
      case 'ddd': return dateFormat(locale, { weekday: 'short' }).format(date);
      case 'dd': return pad(date.getDate());
      case 'd': return String(date.getDate());
      case 'HH': return pad(date.getHours());
      case 'H': return String(date.getHours());
      case 'mm': return pad(date.getMinutes());
      case 'ss': return pad(date.getSeconds());
      default: return token.slice(1, -1);
    }
  });
}
