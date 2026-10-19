/** Numbers written out in words: Turkish for `tr*` locales, English otherwise. */

const TR_ONES = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
const TR_TENS = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
const TR_SCALES = ['', 'Bin', 'Milyon', 'Milyar', 'Trilyon'];

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

/** Major and minor unit names per currency code. */
const CURRENCY_WORDS: Record<string, { tr: [string, string]; en: [string, string] }> = {
  TRY: { tr: ['Türk Lirası', 'Kuruş'], en: ['Turkish lira', 'kuruş'] },
  USD: { tr: ['Amerikan Doları', 'Sent'], en: ['dollars', 'cents'] },
  EUR: { tr: ['Avro', 'Sent'], en: ['euros', 'cents'] },
  GBP: { tr: ['İngiliz Sterlini', 'Peni'], en: ['pounds', 'pence'] },
};

const isTurkish = (locale: string | undefined) => (locale ?? '').toLowerCase().startsWith('tr');

function trUnder1000(n: number): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  if (h) words.push(...(h > 1 ? [TR_ONES[h]] : []), 'Yüz');
  const t = Math.floor((n % 100) / 10);
  if (t) words.push(TR_TENS[t]);
  if (n % 10) words.push(TR_ONES[n % 10]);
  return words;
}

function enUnder1000(n: number): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  if (h) words.push(EN_ONES[h], 'hundred');
  const rest = n % 100;
  if (rest < 20) {
    if (rest) words.push(EN_ONES[rest]);
  } else {
    words.push(EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${EN_ONES[rest % 10]}` : ''));
  }
  return words;
}

/** A whole number in words, e.g. 1234 → "Bin İki Yüz Otuz Dört" / "one thousand two hundred thirty-four". */
export function numberToWords(value: number, locale?: string): string {
  const tr = isTurkish(locale);
  let n = Math.floor(Math.abs(value));
  if (!Number.isSafeInteger(n)) throw new Error('NumberToWords: the number is too large.');
  if (n === 0) return tr ? 'Sıfır' : 'zero';
  const groups: string[][] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const part = n % 1000;
    if (!part) continue;
    if (scale >= TR_SCALES.length) throw new Error('NumberToWords: the number is too large.');
    // Turkish says "Bin", never "Bir Bin".
    const words = tr ? (scale === 1 && part === 1 ? [] : trUnder1000(part)) : enUnder1000(part);
    const scaleWord = (tr ? TR_SCALES : EN_SCALES)[scale];
    groups.unshift(scaleWord ? [...words, scaleWord] : words);
  }
  const text = groups.flat().join(' ');
  return value < 0 ? `${tr ? 'Eksi' : 'minus'} ${text}` : text;
}

/** An amount with its currency in words, e.g. 1250.5 TRY → "Bin İki Yüz Elli Türk Lirası Elli Kuruş". */
export function amountInWords(value: number, locale?: string, currency = 'USD'): string {
  const tr = isTurkish(locale);
  const cents = Math.round(Math.abs(value) * 100);
  const major = Math.floor(cents / 100);
  const minor = cents % 100;
  const names = CURRENCY_WORDS[currency.toUpperCase()]?.[tr ? 'tr' : 'en'] ?? [currency.toUpperCase(), tr ? 'Kuruş' : 'cents'];
  const sign = value < 0 ? (tr ? 'Eksi ' : 'minus ') : '';
  const main = `${sign}${numberToWords(major, locale)} ${names[0]}`;
  if (!minor) return main;
  return tr ? `${main} ${numberToWords(minor, locale)} ${names[1]}` : `${main} and ${numberToWords(minor, locale)} ${names[1]}`;
}
