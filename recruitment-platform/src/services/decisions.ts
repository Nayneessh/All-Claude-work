import { newId } from '@/data/repo';
import type { Assessment, Decision, ScreeningStatus } from '@/domain/types';
import { NotFoundError, RuleError, audit, require, type Ctx } from './ctx';

export function latestDecision(decisions: Decision[], assessmentId: string): Decision | undefined {
  return decisions.filter((d) => d.assessmentId === assessmentId).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
}

/** The status in force: the latest human decision if any, else the AI-derived status. The assessment itself is never overwritten. */
export function effectiveStatus(a: Assessment, decisions: Decision[]): ScreeningStatus {
  return latestDecision(decisions, a.id)?.newStatus ?? a.status;
}

/** Record a human override or review outcome (plan §6.6). Original score and status stay untouched on the assessment. */
export async function decide(ctx: Ctx, assessmentId: string, newStatus: ScreeningStatus, reason: string, comments?: string): Promise<Decision> {
  const a = await ctx.repo.get('assessments', assessmentId);
  if (!a) throw new NotFoundError('Assessment', assessmentId);
  require(ctx, 'decision.override', a.entityId);
  if (!reason.trim()) throw new RuleError('A reason is required for every override.');
  const decisions = await ctx.repo.list('decisions', { assessmentId });
  const current = effectiveStatus(a, decisions);
  if (current === newStatus) throw new RuleError('The candidate is already in that status.');
  const d: Decision = {
    id: newId(), entityId: a.entityId, assessmentId, candidateId: a.candidateId, mandateId: a.mandateId,
    originalStatus: a.status, newStatus, reason: reason.trim(), comments: comments?.trim() || undefined,
    rubricVersion: a.rubricVersion, assessmentVersion: a.version, decidedBy: ctx.user.id, decidedAt: ctx.now().toISOString(),
  };
  await ctx.repo.put('decisions', d);
  await audit(ctx, {
    action: 'decision.override', targetType: 'assessment', targetId: assessmentId, entityId: a.entityId,
    summary: `Status ${current} → ${newStatus} (AI status ${a.status}, score ${a.score.total}, rubric v${a.rubricVersion}, assessment v${a.version}). Reason: ${d.reason}`,
    before: { status: current, score: a.score.total }, after: { status: newStatus },
  });
  return d;
}
