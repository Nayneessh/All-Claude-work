import type { Id, Role, UserProfile } from './types';

/** Role-based access (plan §11.1). Mirrored by Postgres RLS in supabase/migrations; the UI uses this to hide what a user cannot do. */

export type Action =
  | 'view'
  | 'export'
  | 'mandate.write'
  | 'mandate.close'
  | 'rubric.edit'
  | 'rubric.approve'
  | 'cv.upload'
  | 'cv.download'
  | 'assessment.run'
  | 'decision.override'
  | 'candidate.edit'
  | 'candidate.merge'
  | 'users.manage'
  | 'entities.manage'
  | 'audit.view'
  | 'config.manage'
  | 'roles.assign_admin';

const READ: Action[] = ['view', 'export'];
const RECRUITER: Action[] = [
  ...READ, 'mandate.write', 'mandate.close', 'rubric.edit', 'rubric.approve', 'cv.upload', 'cv.download',
  'assessment.run', 'decision.override', 'candidate.edit', 'candidate.merge',
];
const ADMIN: Action[] = [...RECRUITER, 'users.manage', 'entities.manage', 'audit.view', 'config.manage'];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set(READ), // read-only; no CV downloads
  recruiter: new Set(RECRUITER),
  admin: new Set(ADMIN),
  super_admin: new Set<Action>([...ADMIN, 'roles.assign_admin']),
};

export const can = (role: Role | undefined, action: Action): boolean => !!role && MATRIX[role].has(action);

/** Central administration: super_admin and admin see every entity; recruiters/viewers only their assigned entities. */
export const seesAllEntities = (role: Role): boolean => role === 'super_admin' || role === 'admin';

export function canSeeEntity(user: Pick<UserProfile, 'role' | 'entityIds' | 'active'>, entityId: Id): boolean {
  if (!user.active) return false;
  return seesAllEntities(user.role) || user.entityIds.includes(entityId);
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin', admin: 'Administrator', recruiter: 'Recruiter', viewer: 'Viewer',
};
