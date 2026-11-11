import { canonicalId } from './candidates';
import { effectiveStatus } from './decisions';
import {
  QUALIFIED, NEEDS_HUMAN, type Assessment, type AuditEntry, type Candidate, type Decision, type Department, type Entity, type Mandate,
  type MandateStatus, type ProcessingJob, type ScreeningStatus,
} from '@/domain/types';

/** Executive dashboard aggregates (plan §4.1). Pure: callers pass records already scoped to what the user may see. */

export interface DashInput {
  mandates: Mandate[];
  candidates: Candidate[];
  jobs: ProcessingJob[];
  assessments: Assessment[];
  decisions: Decision[];
  entities: Entity[];
  departments: Department[];
  audit?: AuditEntry[];
}

export interface DashFilters { entityId?: string; departmentId?: string; mandateStatus?: MandateStatus | 'all'; from?: string; to?: string }

export interface LatestRow {
  assessment: Assessment;
  candidate: Candidate;
  mandate: Mandate;
  status: ScreeningStatus; // effective (after human decisions)
}

export interface DashData {
  mandateCounts: { active: number; onHold: number; closed: number; archived: number };
  cvsReceived: number;
  cvsScreened: number;
  qualified: number;
  awaitingReview: number;
  averageScore: number | null;
  top: LatestRow[];
  byEntity: { entity: Entity; mandates: number; cvs: number; screened: number; qualified: number }[];
  byMandate: { mandate: Mandate; cvs: number; screened: number; qualified: number; avg: number | null; best: number | null }[];
  alerts: { failed: ProcessingJob[]; needsReview: ProcessingJob[]; pendingReview: LatestRow[] };
  statusMix: Record<ScreeningStatus, number>;
  recent: AuditEntry[];
}

const inRange = (iso: string, f: DashFilters): boolean => (!f.from || iso >= f.from) && (!f.to || iso <= `${f.to}T23:59:59.999Z`);

/** The newest assessment per (person, mandate), joined with the status in force. */
export function latestAssessments(input: Pick<DashInput, 'assessments' | 'candidates' | 'mandates' | 'decisions'>): LatestRow[] {
  const cands = new Map(input.candidates.map((c) => [c.id, c]));
  const mands = new Map(input.mandates.map((m) => [m.id, m]));
  const best = new Map<string, Assessment>();
  for (const a of input.assessments) {
    const key = `${canonicalId(input.candidates, a.candidateId)}|${a.mandateId}`;
    const cur = best.get(key);
    if (!cur || a.version > cur.version || (a.version === cur.version && a.createdAt > cur.createdAt)) best.set(key, a);
  }
  const rows: LatestRow[] = [];
  for (const a of best.values()) {
    const candidate = cands.get(canonicalId(input.candidates, a.candidateId)) ?? cands.get(a.candidateId);
    const mandate = mands.get(a.mandateId);
    if (candidate && mandate) rows.push({ assessment: a, candidate, mandate, status: effectiveStatus(a, input.decisions) });
  }
  return rows;
}

export function dashboard(input: DashInput, f: DashFilters = {}): DashData {
  const deptOk = (m: Mandate): boolean => !f.departmentId || m.departmentId === f.departmentId;
  const mandates = input.mandates.filter((m) => (!f.entityId || m.entityId === f.entityId) && deptOk(m)
    && (!f.mandateStatus || f.mandateStatus === 'all' || m.status === f.mandateStatus) && (!f.to || m.createdAt <= `${f.to}T23:59:59.999Z`));
  const ids = new Set(mandates.map((m) => m.id));
  const jobs = input.jobs.filter((j) => ids.has(j.mandateId) && inRange(j.createdAt, f));
  const assessments = input.assessments.filter((a) => ids.has(a.mandateId) && inRange(a.createdAt, f));
  const latest = latestAssessments({ ...input, assessments, mandates });

  const scores = latest.map((r) => r.assessment.score.total);
  const statusMix = Object.fromEntries((['exceptional_match', 'strong_match', 'potential_match', 'borderline_review', 'below_threshold', 'mandatory_non_compliance', 'verification_required', 'manual_review'] as ScreeningStatus[]).map((s) => [s, 0])) as Record<ScreeningStatus, number>;
  for (const r of latest) statusMix[r.status]++;

  const rowsFor = (id: string): LatestRow[] => latest.filter((r) => r.mandate.id === id);
  const jobsFor = (id: string): ProcessingJob[] => jobs.filter((j) => j.mandateId === id);

  return {
    mandateCounts: {
      active: mandates.filter((m) => m.status === 'open').length, onHold: mandates.filter((m) => m.status === 'on_hold').length,
      closed: mandates.filter((m) => m.status === 'closed').length, archived: mandates.filter((m) => m.status === 'archived').length,
    },
    cvsReceived: jobs.length,
    cvsScreened: latest.length,
    qualified: latest.filter((r) => QUALIFIED.has(r.status)).length,
    awaitingReview: latest.filter((r) => NEEDS_HUMAN.has(r.status)).length + jobs.filter((j) => j.status === 'needs_review').length,
    averageScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    top: [...latest].filter((r) => QUALIFIED.has(r.status)).sort((a, b) => b.assessment.score.total - a.assessment.score.total).slice(0, 5),
    byEntity: input.entities
      .filter((e) => !f.entityId || e.id === f.entityId)
      .map((entity) => {
        const ms = mandates.filter((m) => m.entityId === entity.id);
        const rows = ms.flatMap((m) => rowsFor(m.id));
        return { entity, mandates: ms.length, cvs: ms.reduce((a, m) => a + jobsFor(m.id).length, 0), screened: rows.length, qualified: rows.filter((r) => QUALIFIED.has(r.status)).length };
      })
      .filter((e) => e.mandates > 0),
    byMandate: mandates.map((mandate) => {
      const rows = rowsFor(mandate.id);
      const s = rows.map((r) => r.assessment.score.total);
      return {
        mandate, cvs: jobsFor(mandate.id).length, screened: rows.length, qualified: rows.filter((r) => QUALIFIED.has(r.status)).length,
        avg: s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 : null, best: s.length ? Math.max(...s) : null,
      };
    }),
    alerts: {
      failed: jobs.filter((j) => j.status === 'failed'),
      needsReview: jobs.filter((j) => j.status === 'needs_review'),
      pendingReview: latest.filter((r) => NEEDS_HUMAN.has(r.status)),
    },
    statusMix,
    recent: [...(input.audit ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
  };
}
