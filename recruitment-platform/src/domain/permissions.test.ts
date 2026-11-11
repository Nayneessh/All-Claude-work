import { describe, expect, it } from 'vitest';
import { can, canSeeEntity } from './permissions';

describe('role matrix', () => {
  it('viewer is read-only with no CV downloads', () => {
    expect(can('viewer', 'view')).toBe(true);
    expect(can('viewer', 'export')).toBe(true);
    for (const a of ['mandate.write', 'cv.upload', 'cv.download', 'decision.override', 'users.manage', 'audit.view'] as const) expect(can('viewer', a)).toBe(false);
  });
  it('recruiter works mandates, uploads and assessments but not administration', () => {
    for (const a of ['mandate.write', 'cv.upload', 'cv.download', 'assessment.run', 'decision.override', 'rubric.approve'] as const) expect(can('recruiter', a)).toBe(true);
    for (const a of ['users.manage', 'config.manage', 'audit.view', 'roles.assign_admin'] as const) expect(can('recruiter', a)).toBe(false);
  });
  it('admin manages users and config; only super_admin assigns admins', () => {
    expect(can('admin', 'users.manage')).toBe(true);
    expect(can('admin', 'roles.assign_admin')).toBe(false);
    expect(can('super_admin', 'roles.assign_admin')).toBe(true);
  });
  it('unknown role can do nothing', () => expect(can(undefined, 'view')).toBe(false));
});

describe('entity visibility', () => {
  it('central admins see every entity; others only assigned ones; inactive users see nothing', () => {
    expect(canSeeEntity({ role: 'admin', entityIds: [], active: true }, 'x')).toBe(true);
    expect(canSeeEntity({ role: 'recruiter', entityIds: ['a'], active: true }, 'a')).toBe(true);
    expect(canSeeEntity({ role: 'recruiter', entityIds: ['a'], active: true }, 'b')).toBe(false);
    expect(canSeeEntity({ role: 'super_admin', entityIds: [], active: false }, 'a')).toBe(false);
  });
});
