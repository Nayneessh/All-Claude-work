import type { Repo } from '@/data/repo';
import { canSeeEntity } from '@/domain/permissions';
import type {
  Assessment, AuditEntry, Candidate, Decision, Department, Entity, Mandate, ProcessingJob, Rubric, UserProfile,
} from '@/domain/types';

/** Everything the signed-in user may see, loaded once and re-loaded on change. (At larger scale, page these server-side.) */
export interface World {
  entities: Entity[];
  departments: Department[];
  mandates: Mandate[];
  rubrics: Rubric[];
  candidates: Candidate[];
  jobs: ProcessingJob[];
  assessments: Assessment[];
  decisions: Decision[];
  audit: AuditEntry[];
  profiles: UserProfile[];
}

export const EMPTY_WORLD: World = { entities: [], departments: [], mandates: [], rubrics: [], candidates: [], jobs: [], assessments: [], decisions: [], audit: [], profiles: [] };

export async function loadWorld(repo: Repo, user: UserProfile): Promise<World> {
  const see = (id?: string): boolean => !!id && canSeeEntity(user, id);
  const [entities, departments, mandates, rubrics, candidates, jobs, assessments, decisions] = await Promise.all([
    repo.list('entities'), repo.list('departments'), repo.list('mandates'), repo.list('rubrics'), repo.list('candidates'),
    repo.list('processing_jobs'), repo.list('assessments'), repo.list('decisions'),
  ]);
  const admin = user.role === 'admin' || user.role === 'super_admin';
  const [audit, profiles] = admin ? await Promise.all([repo.list('audit_logs'), repo.list('profiles')]) : [[], []];

  const visAssess = assessments.filter((a) => see(a.entityId));
  const candIds = new Set(visAssess.map((a) => a.candidateId));
  return {
    entities: entities.filter((e) => see(e.id)),
    departments: departments.filter((d) => see(d.entityId)),
    mandates: mandates.filter((m) => see(m.entityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    rubrics: rubrics.filter((r) => see(r.entityId)),
    candidates: candidates.filter((c) => see(c.entityId) || candIds.has(c.id)),
    jobs: jobs.filter((j) => see(j.entityId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    assessments: visAssess,
    decisions: decisions.filter((d) => see(d.entityId)),
    audit: audit.filter((a) => !a.entityId || see(a.entityId)).sort((a, b) => b.at.localeCompare(a.at)),
    profiles,
  };
}
