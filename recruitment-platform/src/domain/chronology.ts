import type { Employment, GateStatus } from './types';

/**
 * Career chronology analysis (plan §5.4). Discrepancies are flagged for verification and never penalised.
 * Month arithmetic is inclusive: Jan 2019 – Dec 2019 is 12 months.
 */

const ymIndex = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
};
const monthsLabel = (n: number): string => (n >= 12 ? `${Math.floor(n / 12)}y ${n % 12}m` : `${n} months`);

export const ymFromDate = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Ordered most-specific first. Titles are mapped to a coarse ladder used only for progression analysis. */
const LADDER: [RegExp, number][] = [
  [/\b(senior vice president|svp|evp|executive vice president|(?<!vice\s)president|chief|c[efpot]o|managing director|chairman)\b/i, 8],
  [/\b(assistant vice president|avp|associate vice president)\b/i, 6],
  [/\b(vice president|vp)\b/i, 7],
  [/\b(senior director|director|general manager|gm|head)\b/i, 6],
  [/\b(deputy general manager|dgm|assistant general manager|agm|senior manager)\b/i, 5],
  [/\b(manager|lead)\b/i, 4],
  [/\b(assistant manager|senior (executive|analyst|engineer|specialist)|specialist)\b/i, 3],
  [/\b(executive|analyst|engineer|officer|associate|coordinator)\b/i, 2],
  [/\b(intern|trainee)\b/i, 1],
];

export function seniorityLevel(title: string): number {
  // "Assistant Manager" must beat "Manager"; check the assistant/senior forms before the generic ones.
  if (/\bassistant manager\b/i.test(title)) return 3;
  for (const [re, level] of LADDER) if (re.test(title)) return level;
  return 0;
}

export interface Interval { start: number; end: number }

export interface ChronologyResult {
  totalMonths: number;
  totalYears: number;
  relevantMonths: number;
  relevantYears: number;
  /** Fraction of employment entries that carry usable dates (feeds extraction confidence). */
  datedShare: number;
  progression: 'ascending' | 'flat' | 'descending' | 'unclear';
  flags: string[];
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + 0) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

const monthsIn = (iv: Interval[]): number => iv.reduce((a, i) => a + (i.end - i.start + 1), 0);

export function analyseChronology(
  employment: Pick<Employment, 'company' | 'title' | 'start' | 'end'>[],
  asOf: Date,
  isRelevant: (e: Pick<Employment, 'company' | 'title' | 'start' | 'end'>) => boolean = () => true,
): ChronologyResult {
  const flags: string[] = [];
  const nowIdx = ymIndex(ymFromDate(asOf));
  const dated: { e: (typeof employment)[number]; iv: Interval }[] = [];

  for (const e of employment) {
    const label = `${e.title || 'Role'} at ${e.company || 'unknown employer'}`;
    if (!e.start) { flags.push(`${label}: start date missing — verify.`); continue; }
    const start = ymIndex(e.start);
    const end = !e.end || e.end === 'present' ? nowIdx : ymIndex(e.end);
    if (!e.end) flags.push(`${label}: end date missing; treated as current — verify.`);
    if (start > nowIdx) { flags.push(`${label}: start date is in the future — verify.`); continue; }
    if (end < start) { flags.push(`${label}: end date precedes start date — verify.`); continue; }
    dated.push({ e, iv: { start, end: Math.min(end, nowIdx) } });
  }

  const ordered = [...dated].sort((a, b) => a.iv.start - b.iv.start);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const gap = cur.iv.start - prev.iv.end - 1;
    if (gap > 6) flags.push(`Gap of ${monthsLabel(gap)} between ${prev.e.company} and ${cur.e.company} — ask about it; a gap alone is not penalised.`);
    const overlap = prev.iv.end - cur.iv.start + 1;
    if (overlap > 3 && prev.e.company.toLowerCase() !== cur.e.company.toLowerCase()) {
      flags.push(`${prev.e.company} and ${cur.e.company} overlap by ${monthsLabel(Math.min(overlap, cur.iv.end - cur.iv.start + 1))} — verify dates.`);
    }
  }

  const all = mergeIntervals(dated.map((d) => d.iv));
  const rel = mergeIntervals(dated.filter((d) => isRelevant(d.e)).map((d) => d.iv));
  const totalMonths = monthsIn(all);
  const relevantMonths = monthsIn(rel);

  let progression: ChronologyResult['progression'] = 'unclear';
  if (ordered.length >= 2) {
    const first = seniorityLevel(ordered[0].e.title);
    const last = seniorityLevel(ordered[ordered.length - 1].e.title);
    if (first > 0 && last > 0) progression = last > first ? 'ascending' : last === first ? 'flat' : 'descending';
  }

  return {
    totalMonths,
    totalYears: Math.round((totalMonths / 12) * 10) / 10,
    relevantMonths,
    relevantYears: Math.round((relevantMonths / 12) * 10) / 10,
    datedShare: employment.length === 0 ? 0 : dated.length / employment.length,
    progression,
    flags,
  };
}

/**
 * Deterministic minimum-experience gate. A shortfall is a verified failure only when the chronology is complete and
 * extraction is trustworthy; otherwise it needs verification (an incomplete CV is not proof of insufficient experience).
 */
export function evaluateExperienceGate(
  requiredYears: number,
  chronology: Pick<ChronologyResult, 'relevantYears' | 'totalYears' | 'datedShare'>,
  extractionConfidence: number,
  basis: 'relevant' | 'total' = 'relevant',
): { status: GateStatus; years: number; note: string } {
  const years = basis === 'relevant' ? chronology.relevantYears : chronology.totalYears;
  const what = basis === 'relevant' ? 'relevant experience' : 'total experience';
  if (years >= requiredYears) return { status: 'pass', years, note: `${years} years of ${what} from the stated chronology (requirement: ${requiredYears}).` };
  const complete = chronology.datedShare >= 0.99 && extractionConfidence >= 0.75;
  if (complete) return { status: 'fail', years, note: `${years} years of ${what} against a ${requiredYears}-year minimum, from a fully dated chronology.` };
  return {
    status: 'needs_verification',
    years,
    note: `${years} years of ${what} found against ${requiredYears} required, but the chronology is incomplete or low-confidence — confirm before treating as a failure.`,
  };
}
