import { validateWeights } from './scoring';
import type { Mandate, Rubric } from './types';

/** Rubric & mandate lifecycle rules (plan §4.2, §4.3). */

export class RubricLockedError extends Error {
  constructor(public readonly status: string) {
    super(`This rubric is ${status} and cannot be edited. Create a new version instead — an approved rubric must never change silently mid-cycle.`);
    this.name = 'RubricLockedError';
  }
}
export class RubricInvalidError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Rubric cannot be approved: ${problems.join(' ')}`);
    this.name = 'RubricInvalidError';
  }
}

export function assertEditable(r: Pick<Rubric, 'status'>): void {
  if (r.status !== 'draft') throw new RubricLockedError(r.status);
}

export function checkRubric(r: Pick<Rubric, 'criteria' | 'gates' | 'policy'>): string[] {
  const problems = [...validateWeights(r.criteria).problems];
  if (r.policy.borderlineFloor >= r.policy.threshold) problems.push('The borderline floor must be below the screening threshold.');
  if (r.policy.threshold >= r.policy.strongAt || r.policy.strongAt >= r.policy.exceptionalAt) {
    problems.push('Score bands must ascend: threshold < strong < exceptional.');
  }
  const names = new Set<string>();
  for (const c of r.criteria) {
    const k = c.name.trim().toLowerCase();
    if (names.has(k)) problems.push(`Duplicate criterion name "${c.name}".`);
    names.add(k);
    if (!c.name.trim()) problems.push('A criterion has no name.');
  }
  return problems;
}

export function approveRubric(r: Rubric, userId: string, at: string): Rubric {
  assertEditable(r);
  const problems = checkRubric(r);
  if (problems.length) throw new RubricInvalidError(problems);
  return { ...r, status: 'approved', approvedBy: userId, approvedAt: at };
}

/** New editable draft from an approved/superseded rubric; the original stays untouched for the assessments that used it. */
export function reviseRubric(r: Rubric, newId: string, userId: string, at: string, mandateVersion = r.mandateVersion): Rubric {
  return {
    ...r,
    id: newId,
    version: r.version + 1,
    mandateVersion,
    status: 'draft',
    approvedBy: undefined,
    approvedAt: undefined,
    createdBy: userId,
    createdAt: at,
    criteria: r.criteria.map((c) => ({ ...c, keywords: [...c.keywords] })),
    gates: r.gates.map((g) => ({ ...g, keywords: [...g.keywords] })),
    notes: `Revised from v${r.version}.`,
  };
}

// ───────────────────────── Mandate versioning ─────────────────────────
const MATERIAL: (keyof Mandate)[] = [
  'title', 'function', 'jdText', 'minExperience', 'preferredExperience', 'maxExperience', 'education', 'certifications',
  'competencies', 'mandatoryIndustries', 'preferredIndustries', 'location', 'teamSize', 'budget', 'strategicResponsibilities',
];
const LABEL: Partial<Record<keyof Mandate, string>> = {
  jdText: 'Job description', minExperience: 'Minimum experience', preferredExperience: 'Preferred experience',
  maxExperience: 'Maximum experience', mandatoryIndustries: 'Mandatory industries', preferredIndustries: 'Preferred industries',
  strategicResponsibilities: 'Strategic responsibilities', teamSize: 'Team size',
};
const OTHER_TRACKED: (keyof Mandate)[] = [
  'compMin', 'compMax', 'currency', 'priority', 'hiringManager', 'targetDate', 'reportingManager', 'status', 'departmentId',
];

const label = (k: keyof Mandate): string => LABEL[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface MandateDiff { material: boolean; changes: string[] }

/** A change is material if it can alter who qualifies; material changes require a new rubric version. */
export function diffMandate(prev: Mandate, next: Mandate): MandateDiff {
  const changes: string[] = [];
  let material = false;
  for (const k of MATERIAL) if (!same(prev[k], next[k])) { material = true; changes.push(`${label(k)} changed (material)`); }
  for (const k of OTHER_TRACKED) if (!same(prev[k], next[k])) changes.push(`${label(k)} changed`);
  return { material, changes };
}
