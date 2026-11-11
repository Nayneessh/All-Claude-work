import { keywordRegex } from '@/ai/heuristic';
import { newId } from '@/data/repo';
import { assessmentModelOutputSchema } from '@/domain/contract';
import { analyseChronology, evaluateExperienceGate } from '@/domain/chronology';
import { redactProtected } from '@/domain/fairness';
import { classify, computeScore, meanConfidence } from '@/domain/scoring';
import { validateAssessmentOutput } from '@/domain/validate';
import type {
  Assessment, Candidate, CandidateDocument, Flag, Mandate, Rubric, ScreeningStatus,
} from '@/domain/types';
import { audit, require, type Ctx } from './ctx';
import { groupIds } from './candidates';

export const RECOMMENDED_ACTION: Record<ScreeningStatus, string> = {
  exceptional_match: 'Prioritise outreach. Validate the flagged items in the first conversation.',
  strong_match: 'Shortlist. Compare with other strong profiles and resolve the verification questions.',
  potential_match: 'Meets the screening threshold. Consider for the shortlist after comparing with stronger candidates.',
  borderline_review: 'A recruiter decides. Review the score range and the unassessed criteria before progressing or setting aside.',
  below_threshold: 'Internal status only — no external rejection is sent. Review if the role priorities change; the status is overridable.',
  mandatory_non_compliance: 'Confirm the failed mandatory requirement with the candidate or the CV. Override with a reason if the facts differ.',
  verification_required: 'Verify the unclear mandatory requirement(s) before any decision. Unclear is not failed.',
  manual_review: 'A recruiter should review the CV, the extraction and the assessment before any decision.',
};

export interface ScreenInput { mandate: Mandate; rubric: Rubric; candidate: Candidate; doc: CandidateDocument }

/**
 * Run one assessment: blind the CV → model returns criterion ratings with evidence → validation layer → deterministic gates and
 * scoring → classification with safeguards → immutable Assessment record. The model never supplies the score or the status.
 */
export async function screenCandidate(ctx: Ctx, p: ScreenInput): Promise<Assessment> {
  const { mandate, rubric, candidate, doc } = p;
  require(ctx, 'assessment.run', mandate.entityId);

  const redacted = redactProtected(doc.pages, candidate.name);
  const blind = {
    name: '', location: candidate.location, currentDesignation: candidate.currentDesignation, currentCompany: candidate.currentCompany,
    employment: candidate.employment, education: candidate.education, certifications: candidate.certifications,
    skills: candidate.skills, industries: candidate.industries, achievements: candidate.achievements,
  };
  const raw = await ctx.ai.assessCandidate({
    mandate: { title: mandate.title, location: mandate.location, minExperience: mandate.minExperience },
    rubric: { criteria: rubric.criteria, gates: rubric.gates, roleIntelligence: rubric.roleIntelligence },
    profile: blind, pages: redacted.pages,
  });
  const served = (raw as { served?: typeof ctx.ai.info }).served ?? ctx.ai.info;
  const output = assessmentModelOutputSchema.parse(raw);
  const v = validateAssessmentOutput(rubric, output, { pages: doc.pages, alsoMatch: redacted.pages });

  // Chronology and the experience gate are computed by code, whatever the provider said.
  const fnKeywords = rubric.criteria.find((c) => c.category === 'functional_experience')?.keywords ?? [];
  const res = fnKeywords.filter(Boolean).map(keywordRegex);
  const chron = analyseChronology(candidate.employment, ctx.now(), (e) => {
    const full = candidate.employment.find((x) => x.company === e.company && x.title === e.title);
    return res.length === 0 || res.some((re) => re.test(`${e.title} ${full?.description ?? ''}`));
  });
  const gates = v.gates.map((g) => {
    const def = rubric.gates.find((d) => d.id === g.gateId);
    if (def?.type !== 'min_experience') return g;
    const r = evaluateExperienceGate(def.years ?? mandate.minExperience, chron, candidate.extractionConfidence, res.length ? 'relevant' : 'total');
    return { ...g, status: r.status, note: r.note, evidence: g.evidence.length ? g.evidence : candidate.employment.slice(0, 3).map((e) => e.ref).filter((x): x is NonNullable<typeof x> => !!x) };
  });

  const score = computeScore(rubric.criteria, v.criteria, rubric.policy);
  const cls = classify({
    score, gates, extractionConfidence: candidate.extractionConfidence,
    assessmentConfidence: meanConfidence(v.criteria), inconsistencies: v.inconsistencies, policy: rubric.policy,
  });

  const flags: Flag[] = [
    ...cls.flags,
    ...v.notes.map((message): Flag => ({ code: 'validation_note', severity: 'warning', message })),
    ...v.inconsistencies.map((message): Flag => ({ code: 'inconsistency', severity: 'blocking', message })),
    ...chron.flags.map((message): Flag => ({ code: 'chronology', severity: 'info', message })),
  ];
  if (redacted.redactions.length) flags.push({ code: 'blind_assessment', severity: 'info', message: `Assessed on a blind copy of the CV (${redacted.redactions.join(', ')}).` });
  if (doc.securityFlags.length) flags.push({ code: 'security', severity: 'warning', message: doc.securityFlags.join('; ') });

  const all = await ctx.repo.list('candidates');
  const ids = new Set(groupIds(all, candidate.id));
  const prior = (await ctx.repo.list('assessments', { mandateId: mandate.id })).filter((a) => ids.has(a.candidateId)).sort((a, b) => b.version - a.version);

  const assessment: Assessment = {
    id: newId(), entityId: mandate.entityId, mandateId: mandate.id, candidateId: candidate.id, documentId: doc.id,
    rubricId: rubric.id, rubricVersion: rubric.version, mandateVersion: mandate.version,
    version: (prior[0]?.version ?? 0) + 1, supersedesId: prior[0]?.id, provider: served,
    criteria: v.criteria, gates, score, status: cls.status, statusReasons: cls.reasons, flags,
    summary: output.summary, strengths: output.strengths, gaps: output.gaps, missingInformation: output.missingInformation,
    verificationQuestions: [...output.verificationQuestions, ...chron.flags.slice(0, 2)].filter((x, i, a) => a.indexOf(x) === i),
    recommendedAction: RECOMMENDED_ACTION[cls.status], chronologyFlags: chron.flags,
    extractionConfidence: candidate.extractionConfidence, redactions: redacted.redactions,
    createdBy: ctx.user.id, createdAt: ctx.now().toISOString(),
  };
  await ctx.repo.put('assessments', assessment);
  await audit(ctx, {
    action: 'assessment.create', targetType: 'assessment', targetId: assessment.id, entityId: mandate.entityId,
    summary: `${candidate.code} vs ${mandate.code}: score ${score.total} → ${cls.status} (rubric v${rubric.version}, assessment v${assessment.version}, ${served.id}/${served.model}, prompt ${served.promptVersion})`,
  });
  return assessment;
}
