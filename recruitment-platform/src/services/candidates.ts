import { newId } from '@/data/repo';
import { findDuplicates } from '@/domain/duplicates';
import type { Candidate } from '@/domain/types';
import { NotFoundError, RuleError, audit, require, type Ctx } from './ctx';

/** The surviving candidate id for a (possibly merged) candidate; follows merge links. */
export function canonicalId(all: Candidate[], id: string): string {
  const byId = new Map(all.map((c) => [c.id, c]));
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const next = byId.get(cur)?.mergedInto;
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

/** Ids whose assessments/documents belong to one person: the survivor plus every record merged into it. */
export function groupIds(all: Candidate[], id: string): string[] {
  const root = canonicalId(all, id);
  return all.filter((c) => canonicalId(all, c.id) === root).map((c) => c.id);
}

export async function getCandidate(ctx: Ctx, id: string): Promise<Candidate> {
  const c = await ctx.repo.get('candidates', id);
  if (!c) throw new NotFoundError('Candidate', id);
  return c;
}

/** Audited, reversible-by-record merge. Assessments are immutable, so they stay attached to their original candidate id and are
 *  read together through the group; the absorbed profile is soft-deleted (mergedInto), never destroyed. */
export async function mergeCandidates(ctx: Ctx, survivorId: string, absorbedId: string, reason: string): Promise<Candidate> {
  if (survivorId === absorbedId) throw new RuleError('Choose two different candidate records to merge.');
  if (!reason.trim()) throw new RuleError('A reason is required to merge candidate profiles.');
  const [s, a] = await Promise.all([getCandidate(ctx, survivorId), getCandidate(ctx, absorbedId)]);
  require(ctx, 'candidate.merge', s.entityId);
  require(ctx, 'candidate.merge', a.entityId);
  if (s.mergedInto || a.mergedInto) throw new RuleError('One of these profiles has already been merged.');
  const at = ctx.now().toISOString();
  const merged: Candidate = {
    ...s,
    email: s.email ?? a.email,
    phone: s.phone ?? a.phone,
    skills: [...new Set([...s.skills, ...a.skills])],
    duplicateOf: (s.duplicateOf ?? []).filter((x) => x !== absorbedId),
    identityFlags: [...new Set([...s.identityFlags.filter((f) => f !== 'possible_duplicate'), `merged:${a.code}`])],
    updatedAt: at,
  };
  await ctx.repo.put('candidates', merged);
  await ctx.repo.put('candidates', { ...a, mergedInto: s.id, duplicateOf: [], updatedAt: at });
  await audit(ctx, { action: 'candidate.merge', targetType: 'candidate', targetId: s.id, entityId: s.entityId, summary: `Merged ${a.code} (${a.name}) into ${s.code} (${s.name}). Reason: ${reason}` });
  return merged;
}

export async function markNotDuplicate(ctx: Ctx, candidateId: string, otherId: string): Promise<Candidate> {
  const c = await getCandidate(ctx, candidateId);
  require(ctx, 'candidate.merge', c.entityId);
  const next: Candidate = {
    ...c,
    duplicateOf: (c.duplicateOf ?? []).filter((x) => x !== otherId),
    notDuplicateOf: [...new Set([...(c.notDuplicateOf ?? []), otherId])],
    identityFlags: c.identityFlags.filter((f) => f !== 'possible_duplicate' && f !== 'shared_identifier_name_conflict'),
    updatedAt: ctx.now().toISOString(),
  };
  await ctx.repo.put('candidates', next);
  await audit(ctx, { action: 'candidate.not_duplicate', targetType: 'candidate', targetId: c.id, entityId: c.entityId, summary: `Confirmed ${c.code} is not the same person as ${otherId}` });
  return next;
}

export async function updateCandidate(ctx: Ctx, id: string, patch: Partial<Pick<Candidate, 'name' | 'email' | 'phone' | 'location' | 'currentDesignation' | 'currentCompany' | 'verificationStatus'>>): Promise<Candidate> {
  const c = await getCandidate(ctx, id);
  require(ctx, 'candidate.edit', c.entityId);
  const next = { ...c, ...patch, updatedAt: ctx.now().toISOString() };
  await ctx.repo.put('candidates', next);
  await audit(ctx, { action: 'candidate.edit', targetType: 'candidate', targetId: id, entityId: c.entityId, summary: `Edited ${c.code}: ${Object.keys(patch).join(', ')}`, before: pick(c, patch), after: patch });
  return next;
}
const pick = (o: object, keys: object): object => Object.fromEntries(Object.keys(keys).map((k) => [k, (o as Record<string, unknown>)[k]]));

export { findDuplicates, newId };

// ───────────────────────── Search ─────────────────────────
export interface CandidateQuery {
  text?: string;
  minYears?: number;
  maxYears?: number;
  skill?: string;
  industry?: string;
  company?: string;
  minTeam?: number;
}

const teamOf = (c: Candidate): number => {
  let max = 0;
  for (const e of c.employment) for (const m of `${e.description}`.matchAll(/\b(?:team|staff|people|reports|organi[sz]ation|buyers|members)\s+of\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:people|buyers|reports|members|employees|fte)\b/gi)) max = Math.max(max, +(m[1] ?? m[2]));
  for (const a of c.achievements) for (const m of a.text.matchAll(/\b(?:team|people)\s+of\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:people|buyers|reports)\b/gi)) max = Math.max(max, +(m[1] ?? m[2]));
  return max;
};

/** Searches structured fields and extracted evidence (experience, team size, industries), not just keywords in a blob. */
export function searchCandidates(all: Candidate[], q: CandidateQuery): Candidate[] {
  const text = q.text?.toLowerCase().trim();
  return all.filter((c) => {
    if (c.mergedInto) return false;
    if (text) {
      const hay = [c.name, c.currentDesignation, c.currentCompany, c.location, ...c.skills, ...c.industries, ...c.employment.flatMap((e) => [e.title, e.company])].join(' ').toLowerCase();
      if (!text.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    if (q.minYears !== undefined && (c.totalExperienceYears ?? 0) < q.minYears) return false;
    if (q.maxYears !== undefined && (c.totalExperienceYears ?? 0) > q.maxYears) return false;
    if (q.skill && !c.skills.some((s) => s.toLowerCase().includes(q.skill!.toLowerCase()))) return false;
    if (q.industry && !c.industries.some((s) => s.toLowerCase().includes(q.industry!.toLowerCase()))) return false;
    if (q.company && !c.employment.some((e) => e.company.toLowerCase().includes(q.company!.toLowerCase()))) return false;
    if (q.minTeam !== undefined && teamOf(c) < q.minTeam) return false;
    return true;
  });
}
