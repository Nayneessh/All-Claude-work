import { newId } from '@/data/repo';
import { diffMandate, type MandateDiff } from '@/domain/rubric';
import type { Mandate, MandateStatus, MandateVersion } from '@/domain/types';
import { NotFoundError, RuleError, audit, nextCode, require, type Ctx } from './ctx';

export type MandateInput = Omit<Mandate, 'id' | 'code' | 'version' | 'status' | 'activeRubricId' | 'createdBy' | 'createdAt' | 'updatedAt'>;

export function validateMandate(m: Pick<Mandate, 'title' | 'entityId' | 'jdText' | 'minExperience' | 'preferredExperience' | 'maxExperience' | 'compMin' | 'compMax'>): string[] {
  const p: string[] = [];
  if (!m.title.trim()) p.push('Position title is required.');
  if (!m.entityId) p.push('Choose the business entity this position belongs to.');
  if (!m.jdText.trim()) p.push('Paste or upload the job description; the screening rubric is built from it.');
  if (m.minExperience < 0) p.push('Minimum experience cannot be negative.');
  if (m.preferredExperience !== undefined && m.preferredExperience < m.minExperience) p.push('Preferred experience cannot be below the minimum.');
  if (m.maxExperience !== undefined && m.maxExperience < m.minExperience) p.push('Maximum experience cannot be below the minimum.');
  if (m.compMin !== undefined && m.compMax !== undefined && m.compMax < m.compMin) p.push('Maximum compensation cannot be below the minimum.');
  return p;
}

export async function getMandate(ctx: Ctx, id: string): Promise<Mandate> {
  const m = await ctx.repo.get('mandates', id);
  if (!m) throw new NotFoundError('Mandate', id);
  return m;
}

export async function createMandate(ctx: Ctx, input: MandateInput): Promise<Mandate> {
  require(ctx, 'mandate.write', input.entityId);
  const problems = validateMandate(input);
  if (problems.length) throw new RuleError(problems.join(' '));
  const at = ctx.now().toISOString();
  const m: Mandate = {
    ...input, id: newId(), code: await nextCode(ctx, 'mandates', 'MND', 4), version: 1, status: 'open',
    createdBy: ctx.user.id, createdAt: at, updatedAt: at,
  };
  await ctx.repo.put('mandates', m);
  await saveVersion(ctx, m, false, ['Created']);
  await audit(ctx, { action: 'mandate.create', targetType: 'mandate', targetId: m.id, entityId: m.entityId, summary: `Created ${m.code} — ${m.title}` });
  return m;
}

async function saveVersion(ctx: Ctx, m: Mandate, material: boolean, changes: string[]): Promise<void> {
  const v: MandateVersion = {
    id: newId(), mandateId: m.id, entityId: m.entityId, version: m.version, snapshot: m, materialChange: material,
    changes, changedBy: ctx.user.id, changedAt: ctx.now().toISOString(),
  };
  await ctx.repo.put('mandate_versions', v);
}

export interface UpdateResult { mandate: Mandate; diff: MandateDiff }

/**
 * Edit a mandate. A material change (JD, experience, education, industries, location, ...) bumps the version and snapshots it;
 * existing rubrics and assessments are left exactly as they were and keep pointing at the version they used.
 */
export async function updateMandate(ctx: Ctx, id: string, patch: Partial<MandateInput>): Promise<UpdateResult> {
  const prev = await getMandate(ctx, id);
  require(ctx, 'mandate.write', prev.entityId);
  const merged: Mandate = { ...prev, ...patch, updatedAt: ctx.now().toISOString() };
  const problems = validateMandate(merged);
  if (problems.length) throw new RuleError(problems.join(' '));
  const diff = diffMandate(prev, merged);
  if (diff.changes.length === 0) return { mandate: prev, diff };
  const next: Mandate = diff.material ? { ...merged, version: prev.version + 1 } : merged;
  await ctx.repo.put('mandates', next);
  if (diff.material) await saveVersion(ctx, next, true, diff.changes);
  await audit(ctx, {
    action: diff.material ? 'mandate.update.material' : 'mandate.update', targetType: 'mandate', targetId: id, entityId: next.entityId,
    summary: `${next.code}: ${diff.changes.join('; ')}${diff.material ? ` → now version ${next.version}; a new rubric version is required before further screening` : ''}`,
    before: { version: prev.version }, after: { version: next.version },
  });
  return { mandate: next, diff };
}

const ALLOWED: Record<MandateStatus, MandateStatus[]> = {
  open: ['on_hold', 'closed', 'archived'],
  on_hold: ['open', 'closed', 'archived'],
  closed: ['open', 'archived'],
  archived: ['open'],
};

export async function setMandateStatus(ctx: Ctx, id: string, status: MandateStatus): Promise<Mandate> {
  const m = await getMandate(ctx, id);
  require(ctx, status === 'closed' || status === 'archived' ? 'mandate.close' : 'mandate.write', m.entityId);
  if (m.status === status) return m;
  if (!ALLOWED[m.status].includes(status)) throw new RuleError(`A ${m.status.replace('_', ' ')} mandate cannot move to ${status.replace('_', ' ')}.`);
  const next = { ...m, status, updatedAt: ctx.now().toISOString() };
  await ctx.repo.put('mandates', next);
  await audit(ctx, { action: 'mandate.status', targetType: 'mandate', targetId: id, entityId: m.entityId, summary: `${m.code}: ${m.status} → ${status}`, before: m.status, after: status });
  return next;
}

/** Copy a mandate as a fresh requirement: new code, version 1, open, no rubric (rubrics are never copied implicitly). */
export async function duplicateMandate(ctx: Ctx, id: string): Promise<Mandate> {
  const m = await getMandate(ctx, id);
  const { id: _i, code: _c, version: _v, status: _s, activeRubricId: _r, createdBy: _b, createdAt: _a, updatedAt: _u, ...input } = m;
  return createMandate(ctx, { ...input, title: `${m.title} (copy)` });
}
