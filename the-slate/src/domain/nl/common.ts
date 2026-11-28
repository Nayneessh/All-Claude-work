import { addDays, diffDays, dow, endOfMonth, fromUTC, type DateStr } from '../../lib/time';

/** Result of any natural-language extraction. Nothing is ever invented: unknown fields stay out of `fields`. */
export interface ParseResult<F> {
  fields: Partial<F>;
  /** fields whose value was INFERRED (not literally stated) — highlighted for review */
  inferred: string[];
  /** fields that could be read more than one way, with an explanation */
  ambiguous: Record<string, string>;
  /** important fields the text did not provide */
  missing: string[];
  /** fragments of the text that were not mapped to any field */
  unused: string[];
  source: 'rules' | 'ai';
}

export const CITIES = ['Navi Mumbai', 'Mumbai', 'Delhi', 'New Delhi', 'Gurugram', 'Gurgaon', 'Noida', 'Bengaluru', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata',
  'Ahmedabad', 'Jaipur', 'Kochi', 'Coimbatore', 'Nashik', 'Indore', 'Chandigarh', 'Lucknow', 'Vadodara', 'Surat', 'Nagpur', 'Thane', 'Faridabad', 'Visakhapatnam', 'Bhubaneswar',
  'Dubai', 'Singapore', 'London', 'Remote'];

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
export const wordToNum = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[w.toLowerCase()] ?? null);

export const norm = (s: string): string => s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[’]/g, "'").trim();
export const clean = (s: string): string => s.replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').replace(/\s+/g, ' ');
export const titleCase = (s: string): string => s.replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b);

export const CITY_RE = new RegExp(`\\b(${[...CITIES].sort((a, b) => b.length - a.length).map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');
export function findCities(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(CITY_RE)) {
    const canon = CITIES.find((c) => c.toLowerCase() === m[1].replace(/\s+/g, ' ').toLowerCase())!;
    const name = canon === 'Bangalore' ? 'Bengaluru' : canon === 'Gurgaon' ? 'Gurugram' : canon;
    if (!seen.includes(name)) seen.push(name);
  }
  // "Navi Mumbai" already contains "Mumbai": keep only the more specific one
  return seen.filter((c) => !(c === 'Mumbai' && seen.includes('Navi Mumbai')) && !(c === 'Delhi' && seen.includes('New Delhi')));
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WD: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const mk = (y: number, m: number, d: number): DateStr | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = fromUTC(Date.UTC(y, m - 1, d));
  return Number(s.slice(5, 7)) === m ? s : null;
};
/** If the year is omitted choose the occurrence closest to `today` (within the past 90 days or the future). */
function withYear(m: number, d: number, today: DateStr, y?: number): DateStr | null {
  const ty = Number(today.slice(0, 4));
  if (y) return mk(y < 100 ? 2000 + y : y, m, d);
  const a = mk(ty, m, d);
  if (a && diffDays(a, today) >= -90) return a;
  return mk(ty + 1, m, d);
}
/** Parse a short date phrase. Returns null when unsure — the caller then reports the field as missing. */
export function parseDatePhrase(input: string, today: DateStr): DateStr | null {
  const s = norm(input).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^(today|now|immediately|right away|asap)$/.test(s)) return today;
  if (s === 'tomorrow') return addDays(today, 1);
  if (s === 'yesterday') return addDays(today, -1);
  if (s === 'day after tomorrow') return addDays(today, 2);
  let m = s.match(/^in (\d+|one|two|three|four|five|six|seven|eight|nine|ten) (day|days|week|weeks|month|months)$/);
  if (m) { const n = wordToNum(m[1])!; return m[2].startsWith('day') ? addDays(today, n) : m[2].startsWith('week') ? addDays(today, 7 * n) : addDays(today, 30 * n); }
  m = s.match(/^(?:next|this|coming) (sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/);
  if (m) { const target = WD[m[1]]; let n = (target - dow(today) + 7) % 7; if (n === 0 || s.startsWith('next')) n = n === 0 ? 7 : n; return addDays(today, n); }
  if (/^end of (the )?month$/.test(s)) return endOfMonth(today);
  if (/^end of (the )?week$/.test(s)) return addDays(today, (5 - dow(today) + 7) % 7);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/); // Indian convention: day first
  if (m) return withYear(+m[2], +m[1], today, m[3] ? +m[3] : undefined);
  m = s.match(/^(\d{1,2}) ([a-z]{3,9})(?: (\d{2,4}))?$/);
  if (m && MON[m[2].slice(0, 4) in MON ? m[2].slice(0, 4) : m[2].slice(0, 3)]) return withYear(MON[m[2].slice(0, 4) in MON ? m[2].slice(0, 4) : m[2].slice(0, 3)], +m[1], today, m[3] ? +m[3] : undefined);
  m = s.match(/^([a-z]{3,9}) (\d{1,2})(?: (\d{2,4}))?$/);
  if (m && MON[m[1].slice(0, 3)]) return withYear(MON[m[1].slice(0, 3)], +m[2], today, m[3] ? +m[3] : undefined);
  return null;
}
/** Find a date in the text following a keyword pattern; tries the longest sensible phrase first. */
export function dateAfter(text: string, keyword: RegExp, today: DateStr): { date: DateStr; matched: string } | null {
  const re = new RegExp(`(${keyword.source})\\s*(?:on|from|by|before|is|date|:|within)?\\s*([^,;]{1,40})`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const tail = norm(m[m.length - 1]).replace(/[.]+$/, '');
  const words = tail.split(' ');
  for (let n = Math.min(words.length, 5); n >= 1; n--) {
    const d = parseDatePhrase(words.slice(0, n).join(' '), today);
    if (d) return { date: d, matched: m[0].replace(tail, words.slice(0, n).join(' ')) };
  }
  return null;
}
/** "within 30 days / 6 weeks" relative to `base`. */
export function withinDuration(text: string, base: DateStr): { date: DateStr; matched: string } | null {
  const m = text.match(/\b(?:within|in|inside)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|week|weeks|month|months)\b/i);
  if (!m) return null;
  const n = wordToNum(m[1])!;
  return { date: addDays(base, m[2].toLowerCase().startsWith('day') ? n : m[2].toLowerCase().startsWith('week') ? 7 * n : 30 * n), matched: m[0] };
}

export const AMOUNT_UNIT = String.raw`(?:lakhs?|lacs?|lpa|lac|l|cr|crores?|k|m|mn|million|thousand)`;
export const AMOUNT = String.raw`(?:rs\.?\s*|inr\s*|₹\s*)?\d[\d,]*(?:\.\d+)?\s*${AMOUNT_UNIT}?(?:\s*(?:-|–|to)\s*\d[\d,]*(?:\.\d+)?\s*${AMOUNT_UNIT}?)?(?:\s*(?:per annum|p\.?a\.?|lpa|fixed|fixed\s*\+\s*variable))?`;
export const tidyAmount = (s: string): string => clean(s).replace(/\s+/g, ' ').replace(/\blacs?\b/i, 'lakhs').replace(/\blakh\b/i, 'lakhs').replace(/\bcrores?\b/i, 'crore');

/** Remove the first occurrence of `fragment` from `rest` so leftovers can be reported as "unused". */
export const consume = (rest: string, fragment: string | undefined): string => (fragment ? rest.replace(fragment, ' ') : rest);
const FILLER = /^(?:and|also|the|a|an|new|mandate|requirement|position|positions|role|please|hire|hiring|need|needed|looking|candidate|profile|is|are|with|has|have|currently|at|in|for|to|of|on|by|as|from|via|through)$/i;
export function leftovers(rest: string): string[] {
  return rest.split(/[,;]|\.(?:\s|$)/).map((x) => clean(x)).filter((x) => x.length > 2 && x.split(/\s+/).some((w) => /[A-Za-z0-9]{2,}/.test(w) && !FILLER.test(w)));
}
