import type { AssessmentModelOutput } from './contract';
import { stateFromRating } from './scoring';
import type {
  CriterionAssessment, EvidenceRef, GateResult, PageText, Rating, Rubric,
} from './types';

/**
 * Validation layer (plan §5.2, §11.3 "Hallucination: require evidence references and validation").
 * Nothing a model returns reaches the scoring engine until it has been checked against the rubric and the CV text:
 *  - every rubric criterion and gate is covered exactly once;
 *  - ratings are integers 0–5 or null;
 *  - every cited quote must actually appear in the CV; invented quotes are dropped;
 *  - a positive rating needs verified evidence, otherwise it is downgraded to Not Evident;
 *  - "Not met" (0) and a gate "fail" cannot rest on absence of evidence — Not Evident is not proof of non-compliance.
 */

const norm = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, ' ').replace(/[“”"'`’‘]/g, '').trim();

export interface Sources { pages: PageText[]; alsoMatch?: PageText[] }

function locate(quote: string, sources: Sources): { found: boolean; page?: number } {
  const q = norm(quote);
  if (q.length < 6) return { found: false };
  for (const set of [sources.pages, ...(sources.alsoMatch ? [sources.alsoMatch] : [])]) {
    for (const p of set) if (norm(p.text).includes(q)) return { found: true, page: p.page };
  }
  return { found: false };
}

export interface ValidationOutcome {
  criteria: CriterionAssessment[];
  gates: GateResult[];
  inconsistencies: string[];
  notes: string[];
}

export function validateAssessmentOutput(
  rubric: Pick<Rubric, 'criteria' | 'gates'>,
  out: AssessmentModelOutput,
  sources: Sources,
): ValidationOutcome {
  const inconsistencies: string[] = [];
  const notes: string[] = [];
  const criteriaIds = new Set(rubric.criteria.map((c) => c.id));
  const gateIds = new Set(rubric.gates.map((g) => g.id));

  const seen = new Set<string>();
  for (const c of out.criteria) {
    if (!criteriaIds.has(c.criterionId)) inconsistencies.push(`unknown criterion "${c.criterionId}" returned`);
    else if (seen.has(c.criterionId)) inconsistencies.push(`criterion "${c.criterionId}" returned more than once`);
    seen.add(c.criterionId);
  }

  const criteria: CriterionAssessment[] = rubric.criteria.map((def) => {
    const m = out.criteria.find((c) => c.criterionId === def.id);
    if (!m) {
      inconsistencies.push(`criterion "${def.name}" was not assessed`);
      return { criterionId: def.id, rating: null, state: 'unable_to_assess', evidence: [], interpretation: 'The assessment did not return a result for this criterion.', verification: 'Re-run or assess manually.', confidence: 0 };
    }

    const verified: EvidenceRef[] = [];
    let dropped = 0;
    for (const e of m.evidence) {
      const hit = locate(e.quote, sources);
      if (hit.found) verified.push({ page: e.page ?? hit.page, paragraph: e.paragraph, quote: e.quote });
      else dropped++;
    }
    if (dropped) notes.push(`${dropped} quote(s) for "${def.name}" were not found in the CV and were discarded.`);

    let rating: Rating | null = null;
    let unable = !!m.unable;
    if (m.rating !== null && !unable) {
      if (Number.isInteger(m.rating) && m.rating >= 0 && m.rating <= 5) rating = m.rating as Rating;
      else { inconsistencies.push(`criterion "${def.name}" returned an invalid rating (${m.rating})`); unable = true; }
    }

    let interpretation = m.interpretation;
    const verification = m.verification;
    if (rating !== null && verified.length === 0) {
      if (rating >= 1) {
        // A positive rating with no verifiable evidence is a hallucination risk: do not let it score.
        inconsistencies.push(`criterion "${def.name}" was rated ${rating} without verifiable CV evidence`);
        rating = null;
        interpretation = `${interpretation} (Rating withheld: no cited evidence could be found in the CV.)`.trim();
      } else {
        // Zero from absence is Not Evident, not Not Met.
        rating = null;
        interpretation = `${interpretation} (Treated as Not Evident: absence of evidence is not proof of non-compliance.)`.trim();
      }
    }

    return {
      criterionId: def.id,
      rating,
      state: stateFromRating(rating, unable),
      evidence: verified,
      interpretation,
      verification,
      confidence: unable ? 0 : m.confidence,
    };
  });

  const gates: GateResult[] = rubric.gates.map((def) => {
    const m = out.gates.find((g) => g.gateId === def.id);
    if (!m) {
      notes.push(`Gate "${def.name}" was not returned; set to Needs Verification.`);
      return { gateId: def.id, status: 'needs_verification', evidence: [], note: 'No result returned for this requirement; confirm manually.' };
    }
    const verified = m.evidence.filter((e) => locate(e.quote, sources).found);
    let status = m.status;
    let note = m.note;
    if (status === 'fail' && verified.length === 0 && def.type !== 'min_experience') {
      status = 'needs_verification';
      note = `${note} (Downgraded from Fail: no verifiable CV evidence supports a failure; Not Evident is not non-compliance.)`.trim();
    }
    return { gateId: def.id, status, evidence: verified, note };
  });
  for (const g of out.gates) if (!gateIds.has(g.gateId)) inconsistencies.push(`unknown gate "${g.gateId}" returned`);

  return { criteria, gates, inconsistencies, notes };
}

/** Extraction confidence from completeness of what was found — computed in code, not self-reported by a model. */
export function extractionConfidence(
  p: {
    name: string; email?: string; phone?: string;
    employment: { start?: string; company?: string; title?: string }[];
    education: unknown[];
  },
  doc: { textLength: number; ocrRequired: boolean; isLegacyDoc?: boolean },
): number {
  if (doc.ocrRequired) return 0.2;
  let c = 0;
  if (p.name.trim().split(/\s+/).length >= 2) c += 0.2;
  else if (p.name.trim()) c += 0.1;
  if (p.email || p.phone) c += 0.1;
  const jobs = p.employment;
  if (jobs.length) {
    const withDates = jobs.filter((j) => j.start).length / jobs.length;
    const named = jobs.filter((j) => j.company && j.title).length / jobs.length;
    c += 0.2 * withDates + 0.15 * named;
  }
  if (p.education.length) c += 0.15;
  if (doc.textLength > 1500) c += 0.2;
  else if (doc.textLength > 600) c += 0.12;
  else if (doc.textLength > 250) c += 0.05;
  if (doc.isLegacyDoc) c = Math.min(c, 0.55); // best-effort .doc text is always reviewed by a person
  return Math.round(Math.min(c, 1) * 100) / 100;
}
