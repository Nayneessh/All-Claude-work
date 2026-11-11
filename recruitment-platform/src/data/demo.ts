import type { Repo } from './repo';
import { DEFAULT_POLICY } from '@/domain/scoring';
import type { Department, Entity, UserProfile } from '@/domain/types';
import { decide } from '@/services/decisions';
import { createMandate } from '@/services/mandates';
import { ingestText } from '@/services/pipeline';
import { approveRubricVersion, generateRubric } from '@/services/rubrics';
import { audit, type Ctx } from '@/services/ctx';
import { DEMO_CVS, VP_PROCUREMENT_JD } from './demoCvs';

/** Fixed ids so demo users and entities are stable across reloads and can be referenced before any data exists. */
export const E_IND = '00000000-0000-4000-8000-0000000000a1';
export const E_RET = '00000000-0000-4000-8000-0000000000a2';
export const E_LOG = '00000000-0000-4000-8000-0000000000a3';

export const DEMO_ENTITIES: Entity[] = [
  { id: E_IND, name: 'Meridian Industries', code: 'MIL', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: E_RET, name: 'Meridian Retail', code: 'MRL', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: E_LOG, name: 'Meridian Logistics', code: 'MLG', createdAt: '2026-01-01T00:00:00.000Z' },
];

export const DEMO_DEPARTMENTS: Department[] = [
  { id: '00000000-0000-4000-8000-0000000000b1', entityId: E_IND, name: 'Procurement' },
  { id: '00000000-0000-4000-8000-0000000000b2', entityId: E_IND, name: 'Finance' },
  { id: '00000000-0000-4000-8000-0000000000b3', entityId: E_RET, name: 'Finance' },
  { id: '00000000-0000-4000-8000-0000000000b4', entityId: E_LOG, name: 'Supply Chain' },
];

export const DEMO_USERS: UserProfile[] = [
  { id: '00000000-0000-4000-8000-0000000000c1', email: 'super.admin@demo.local', name: 'Sana Admin (Super Admin)', role: 'super_admin', entityIds: [], active: true },
  { id: '00000000-0000-4000-8000-0000000000c2', email: 'admin@demo.local', name: 'Dev Kapoor (Administrator)', role: 'admin', entityIds: [], active: true },
  { id: '00000000-0000-4000-8000-0000000000c3', email: 'recruiter@demo.local', name: 'Rhea Shah (Recruiter, Industries + Retail)', role: 'recruiter', entityIds: [E_IND, E_RET], active: true },
  { id: '00000000-0000-4000-8000-0000000000c4', email: 'viewer@demo.local', name: 'Vikas Rao (Viewer, Industries)', role: 'viewer', entityIds: [E_IND], active: true },
];

export async function ensureBaseData(repo: Repo): Promise<void> {
  if ((await repo.list('entities')).length) return;
  for (const e of DEMO_ENTITIES) await repo.put('entities', e);
  for (const d of DEMO_DEPARTMENTS) await repo.put('departments', d);
  for (const u of DEMO_USERS) await repo.put('profiles', u);
}

/** Populate a realistic pipeline through the real services (rubric → approval → CV ingestion → screening → one override). */
export async function seedDemo(ctx: Ctx): Promise<void> {
  await ensureBaseData(ctx.repo);
  if ((await ctx.repo.list('mandates')).length) return;

  const vp = await createMandate(ctx, {
    entityId: E_IND, departmentId: DEMO_DEPARTMENTS[0].id, title: 'VP – Procurement', function: 'Procurement', reportingManager: 'Chief Operating Officer',
    location: 'Mumbai', minExperience: 15, preferredExperience: 18, maxExperience: 28, education: 'MBA or equivalent postgraduate qualification',
    certifications: ['CPSM'], competencies: [], mandatoryIndustries: ['Manufacturing'], preferredIndustries: ['Automotive', 'Steel & Metals'],
    teamSize: '40+', budget: 'Spend under management above ₹500 crore', strategicResponsibilities: 'Procurement strategy, supplier risk and transformation',
    compMin: 6_000_000, compMax: 9_000_000, currency: 'INR', priority: 'high', hiringManager: 'Chief Operating Officer', targetDate: '2027-02-28', jdText: VP_PROCUREMENT_JD,
  });
  const draft = await generateRubric(ctx, vp.id, DEFAULT_POLICY);
  await approveRubricVersion(ctx, draft.id);

  for (const cv of DEMO_CVS) await ingestText(ctx, vp.id, cv.fileName, cv.text);

  await createMandate(ctx, {
    entityId: E_LOG, departmentId: DEMO_DEPARTMENTS[3].id, title: 'Head – Supply Chain', function: 'Supply Chain', reportingManager: 'CEO', location: 'Gurugram',
    minExperience: 12, education: 'Graduate; MBA preferred', certifications: [], competencies: [], mandatoryIndustries: [], preferredIndustries: ['Logistics'],
    currency: 'INR', priority: 'medium', hiringManager: 'CEO', targetDate: '2027-03-31',
    jdText: 'Head – Supply Chain\n\nKey responsibilities\n- Own end-to-end supply chain planning and distribution network design.\n- Lead warehousing, inventory and transportation operations.\n\nRequirements\n- 12+ years in supply chain and logistics.\n- Graduate degree; MBA preferred.',
  });
  const cfo = await createMandate(ctx, {
    entityId: E_RET, departmentId: DEMO_DEPARTMENTS[2].id, title: 'Chief Financial Officer', function: 'Finance', reportingManager: 'CEO', location: 'Mumbai',
    minExperience: 18, education: 'CA or MBA (Finance)', certifications: [], competencies: [], mandatoryIndustries: [], preferredIndustries: ['Retail'],
    currency: 'INR', priority: 'critical', hiringManager: 'CEO',
    jdText: 'Chief Financial Officer\n\nKey responsibilities\n- Lead financial planning, treasury and investor relations.\n- Own the controllership and audit function.\n\nRequirements\n- 18+ years in finance with P&L ownership.\n- CA or MBA (Finance).',
  });
  const { setMandateStatus } = await import('@/services/mandates');
  await setMandateStatus(ctx, cfo.id, 'on_hold');

  await audit(ctx, { action: 'demo.seed', targetType: 'system', targetId: 'demo', summary: 'Loaded demo data: 3 entities, 3 mandates, 7 synthetic CVs.' });
  void decide;
}
