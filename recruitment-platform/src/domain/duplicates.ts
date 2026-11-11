import type { Candidate } from './types';

/**
 * Duplicate detection (plan §4.4). Never merge on a similar name alone: strong identifiers (email, phone) link a new CV
 * to an existing profile; weaker combinations only raise a possible-duplicate flag for a person to resolve.
 */

export const normaliseEmail = (e?: string): string | undefined => {
  const v = e?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined;
};

/** Compares the last 10 digits so +91 98765 43210, 098765-43210 and 9876543210 are the same number. */
export const normalisePhone = (p?: string): string | undefined => {
  const digits = (p ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : undefined;
};

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'shri', 'smt', 'sri']);
const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((t) => t && !TITLES.has(t));

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const tokenMatch = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0]; // initial vs full token
  return Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1;
};

/** 0..1, order-insensitive, tolerant of initials and one-letter typos. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let hits = 0;
  for (const t of short) {
    const idx = long.findIndex((u, i) => !used.has(i) && tokenMatch(t, u));
    if (idx >= 0) { used.add(idx); hits++; }
  }
  return hits / long.length;
}

const COMPANY_NOISE = /\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co|company|plc|the)\b/g;
export const normaliseCompany = (c?: string): string =>
  (c ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();

export const sameCompany = (a?: string, b?: string): boolean => {
  const x = normaliseCompany(a);
  const y = normaliseCompany(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))));
};

export interface DuplicateInput {
  name: string;
  email?: string;
  phone?: string;
  currentCompany?: string;
  employers: string[];
}

export interface DuplicateMatch {
  candidateId: string;
  level: 'strong' | 'possible';
  signals: string[];
  /** A shared identifier with a clearly different name needs a human look before linking. */
  nameConflict: boolean;
  nameSimilarity: number;
}

export function findDuplicates(input: DuplicateInput, existing: Candidate[]): DuplicateMatch[] {
  const email = normaliseEmail(input.email);
  const phone = normalisePhone(input.phone);
  const out: DuplicateMatch[] = [];

  for (const c of existing) {
    if (c.mergedInto) continue;
    const signals: string[] = [];
    const nameSim = nameSimilarity(input.name, c.name);
    if (email && email === normaliseEmail(c.email)) signals.push('Same email address');
    if (phone && phone === normalisePhone(c.phone)) signals.push('Same phone number');

    if (signals.length) {
      out.push({ candidateId: c.id, level: 'strong', signals, nameConflict: nameSim < 0.5, nameSimilarity: nameSim });
      continue;
    }

    // Weak identifiers only combine: a similar name needs corroboration from employment history.
    if (nameSim >= 0.8) {
      const sharedEmployers = input.employers.filter((e) => c.employment.some((x) => sameCompany(e, x.company))).length;
      const sameCurrent = sameCompany(input.currentCompany, c.currentCompany);
      if (sameCurrent || sharedEmployers >= 2) {
        out.push({
          candidateId: c.id, level: 'possible', nameConflict: false, nameSimilarity: nameSim,
          signals: ['Similar name', sameCurrent ? 'Same current employer' : `${sharedEmployers} shared employers`],
        });
      }
    }
  }
  return out.sort((a, b) => (a.level === b.level ? b.nameSimilarity - a.nameSimilarity : a.level === 'strong' ? -1 : 1));
}
