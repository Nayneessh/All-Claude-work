import { newId } from '@/data/repo';
import { rubricDraftSchema, type RubricDraft } from '@/domain/contract';
import { approveRubric, assertEditable, checkRubric, reviseRubric } from '@/domain/rubric';
import { DEFAULT_POLICY } from '@/domain/scoring';
import type { Mandate, Rubric, RubricCriterion, ScreeningPolicy } from '@/domain/types';
import { NotFoundError, RuleError, audit, require, type Ctx } from './ctx';
import { getMandate } from './mandates';

/** Largest-remainder rescale to integers that total exactly 100. */
export function normaliseWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const base = Math.floor(100 / weights.length);
    return weights.map((_, i) => base + (i < 100 - base * weights.length ? 1 : 0));
  }
  const raw = weights.map((w) => (w * 100) / sum);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f).forEach(({ i }) => { if (left > 0) { floor[i]++; left--; } });
  return floor;
}

export async function listRubrics(ctx: Ctx, mandateId: string): Promise<Rubric[]> {
  return (await ctx.repo.list('rubrics', { mandateId })).sort((a, b) => b.version - a.version);
}

export async function getRubric(ctx: Ctx, id: string): Promise<Rubric> {
  const r = await ctx.repo.get('rubrics', id);
  if (!r) throw new NotFoundError('Rubric', id);
  return r;
}

export async function activeRubric(ctx: Ctx, mandate: Mandate): Promise<Rubric | undefined> {
  return mandate.activeRubricId ? ctx.repo.get('rubrics', mandate.activeRubricId) : undefined;
}

/** Why a mandate cannot be screened right now, or undefined if it can. */
export async function screeningBlocker(ctx: Ctx, mandate: Mandate): Promise<string | undefined> {
  if (mandate.status !== 'open') return `The mandate is ${mandate.status.replace('_', ' ')}. Reopen it to screen CVs.`;
  const r = await activeRubric(ctx, mandate);
  if (!r || r.status !== 'approved') return 'No approved rubric yet. Generate a rubric from the job description, review it and approve it before screening.';
  if (r.mandateVersion !== mandate.version) {
    return `The approved rubric (v${r.version}) was built for mandate v${r.mandateVersion}, but the mandate is now v${mandate.version} after a material change. Revise and approve a new rubric version.`;
  }
  return undefined;
}

export function draftToRubric(ctx: Ctx, mandate: Mandate, draft: RubricDraft, version: number, generatedBy: Rubric['generatedBy'], policy: ScreeningPolicy): { rubric: Rubric; notes: string[] } {
  const notes: string[] = [];
  const sum = draft.criteria.reduce((a, c) => a + c.weight, 0);
  const weights = normaliseWeights(draft.criteria.map((c) => c.weight));
  if (Math.abs(sum - 100) > 1e-9) notes.push(`Model weights totalled ${Math.round(sum * 10) / 10}; rescaled to 100.`);

  const criteria: RubricCriterion[] = draft.criteria.map((c, i) => ({ ...c, id: newId(), weight: weights[i] }));
  const gates = draft.gates.map((g) => ({ ...g, id: newId() }));
  if (mandate.minExperience > 0 && !gates.some((g) => g.type === 'min_experience')) {
    gates.unshift({
      id: newId(), type: 'min_experience', name: `Minimum ${mandate.minExperience} years relevant experience`,
      requirement: `At least ${mandate.minExperience} years of relevant experience.`, keywords: [], years: mandate.minExperience,
      verification: 'Confirm start and end dates.',
    });
    notes.push('Added the minimum-experience gate stated on the mandate.');
  }
  const at = ctx.now().toISOString();
  return {
    notes,
    rubric: {
      id: newId(), mandateId: mandate.id, entityId: mandate.entityId, mandateVersion: mandate.version, version,
      status: 'draft', criteria, gates, policy, roleIntelligence: draft.roleIntelligence, generatedBy,
      createdBy: ctx.user.id, createdAt: at, notes: notes.join(' ') || undefined,
    },
  };
}

/** AI proposes; a person reviews and approves. Always creates a new draft version; never edits an approved rubric. */
export async function generateRubric(ctx: Ctx, mandateId: string, policy: ScreeningPolicy = DEFAULT_POLICY): Promise<Rubric> {
  const mandate = await getMandate(ctx, mandateId);
  require(ctx, 'rubric.edit', mandate.entityId);
  const raw = await ctx.ai.generateRubric({ mandate, policy });
  const served = (raw as { served?: typeof ctx.ai.info }).served ?? ctx.ai.info;
  const draft = rubricDraftSchema.parse(raw);
  const version = ((await listRubrics(ctx, mandateId))[0]?.version ?? 0) + 1;
  const { rubric } = draftToRubric(ctx, mandate, draft, version, served, policy);
  await ctx.repo.put('rubrics', rubric);
  await audit(ctx, {
    action: 'rubric.generate', targetType: 'rubric', targetId: rubric.id, entityId: mandate.entityId,
    summary: `Generated rubric v${version} draft for ${mandate.code} with ${served.id}/${served.model} (${served.promptVersion})`,
  });
  return rubric;
}

export async function saveRubricDraft(ctx: Ctx, rubric: Rubric): Promise<Rubric> {
  require(ctx, 'rubric.edit', rubric.entityId);
  const current = await getRubric(ctx, rubric.id);
  assertEditable(current);
  await ctx.repo.put('rubrics', { ...rubric, generatedBy: current.generatedBy });
  await audit(ctx, { action: 'rubric.edit', targetType: 'rubric', targetId: rubric.id, entityId: rubric.entityId, summary: `Edited rubric v${rubric.version} draft` });
  return rubric;
}

export async function approveRubricVersion(ctx: Ctx, rubricId: string): Promise<Rubric> {
  const r = await getRubric(ctx, rubricId);
  require(ctx, 'rubric.approve', r.entityId);
  const mandate = await getMandate(ctx, r.mandateId);
  if (r.mandateVersion !== mandate.version) {
    throw new RuleError(`This draft was built for mandate v${r.mandateVersion} but the mandate is now v${mandate.version}. Revise it for the current version first.`);
  }
  const approved = approveRubric(r, ctx.user.id, ctx.now().toISOString());
  const problems = checkRubric(approved);
  if (problems.length) throw new RuleError(problems.join(' '));
  // Retire the previously active rubric (its content stays frozen for the assessments that used it).
  if (mandate.activeRubricId && mandate.activeRubricId !== approved.id) {
    const old = await ctx.repo.get('rubrics', mandate.activeRubricId);
    if (old && old.status === 'approved') await ctx.repo.put('rubrics', { ...old, status: 'superseded' });
  }
  await ctx.repo.put('rubrics', approved);
  await ctx.repo.put('mandates', { ...mandate, activeRubricId: approved.id, updatedAt: ctx.now().toISOString() });
  await audit(ctx, { action: 'rubric.approve', targetType: 'rubric', targetId: approved.id, entityId: approved.entityId, summary: `Approved rubric v${approved.version} for ${mandate.code} (mandate v${mandate.version})` });
  return approved;
}

/** New editable draft v+1 from an existing rubric, aligned to the mandate's current version. */
export async function reviseRubricVersion(ctx: Ctx, rubricId: string): Promise<Rubric> {
  const r = await getRubric(ctx, rubricId);
  require(ctx, 'rubric.edit', r.entityId);
  const mandate = await getMandate(ctx, r.mandateId);
  const latest = (await listRubrics(ctx, r.mandateId))[0];
  const draft = reviseRubric(r, newId(), ctx.user.id, ctx.now().toISOString(), mandate.version);
  draft.version = (latest?.version ?? r.version) + 1;
  await ctx.repo.put('rubrics', draft);
  await audit(ctx, { action: 'rubric.revise', targetType: 'rubric', targetId: draft.id, entityId: draft.entityId, summary: `Created rubric v${draft.version} draft from v${r.version} for ${mandate.code}` });
  return draft;
}
