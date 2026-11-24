// Control characters are not allowed in XML 1.0 at all: dropped, not escaped
export const escapeXml = (s: string): string => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A quantity, price or rate as an XML decimal — no exponent, no binary noise, never NaN */
export function xmlDecimal(v: number, what: string): string {
  if (!Number.isFinite(v)) throw new RangeError(`Invoice ${what} must be a finite number, got ${v}.`);
  return Number(v.toPrecision(15)).toFixed(6).replace(/\.?0+$/, '');
}
