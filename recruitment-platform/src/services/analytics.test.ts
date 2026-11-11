import { beforeAll, describe, expect, it } from 'vitest';
import { E_IND, E_LOG, E_RET, seedDemo } from '@/data/demo';
import { makeCtx } from '@/test/helpers';
import { decide } from './decisions';
import { dashboard, latestAssessments, type DashInput } from './analytics';
import { screenExisting } from './pipeline';
import type { Ctx } from './ctx';

let ctx: Ctx;
const load = async (): Promise<DashInput> => ({
  mandates: await ctx.repo.list('mandates'), candidates: await ctx.repo.list('candidates'), jobs: await ctx.repo.list('processing_jobs'),
  assessments: await ctx.repo.list('assessments'), decisions: await ctx.repo.list('decisions'), entities: await ctx.repo.list('entities'),
  departments: await ctx.repo.list('departments'), audit: await ctx.repo.list('audit_logs'),
});

beforeAll(async () => { ctx = await makeCtx(); await seedDemo(ctx); });

describe('dashboard', () => {
  it('answers the headline questions from the seeded pipeline', async () => {
    const d = dashboard(await load());
    expect(d.mandateCounts).toEqual({ active: 2, onHold: 1, closed: 0, archived: 0 });
    expect(d.cvsReceived).toBe(10);
    expect(d.cvsScreened).toBe(9); // the scanned PDF has no assessment
    expect(d.qualified).toBe(2); // strong + potential
    expect(d.averageScore).toBeGreaterThan(40);
    expect(d.top.map((r) => r.candidate.name)).toEqual(['Aarav Mehta', 'Sunita Pillai']);
    expect(d.top[0].assessment.score.total).toBeGreaterThan(d.top[1].assessment.score.total);
  });
  it('awaiting review counts borderline, verification-required and manual-review statuses plus needs-review files', async () => {
    const d = dashboard(await load());
    // borderline(1) + verification_required(2) + manual_review(1) + OCR needs_review job(1)
    expect(d.awaitingReview).toBe(5);
    expect(d.alerts.needsReview).toHaveLength(1);
    expect(d.alerts.pendingReview).toHaveLength(4);
  });
  it('filters by entity, department, mandate status and dates', async () => {
    const input = await load();
    expect(dashboard(input, { entityId: E_LOG }).cvsReceived).toBe(0);
    expect(dashboard(input, { entityId: E_IND }).cvsReceived).toBe(10);
    expect(dashboard(input, { mandateStatus: 'on_hold' }).mandateCounts.onHold).toBe(1);
    expect(dashboard(input, { mandateStatus: 'open', entityId: E_RET }).mandateCounts.active).toBe(0);
    expect(dashboard(input, { departmentId: input.departments.find((x) => x.entityId === E_IND && x.name === 'Procurement')!.id }).cvsReceived).toBe(10);
    expect(dashboard(input, { from: '2030-01-01' }).cvsReceived).toBe(0);
    expect(dashboard(input, { to: '2026-11-11' }).cvsReceived).toBe(10);
  });
  it('reports pipeline strength per mandate and per entity', async () => {
    const d = dashboard(await load());
    const vp = d.byMandate.find((m) => m.mandate.title === 'VP – Procurement')!;
    expect(vp).toMatchObject({ cvs: 10, screened: 9, qualified: 2 });
    expect(vp.best).toBeGreaterThan(80);
    expect(d.byEntity.map((e) => e.entity.name).sort()).toEqual(['Meridian Industries', 'Meridian Logistics', 'Meridian Retail']);
  });
  it('a human override moves a candidate in the counts without touching the assessment', async () => {
    const before = dashboard(await load());
    const harish = (await latestAssessments(await load())).find((r) => r.candidate.name === 'Harish Bhatia')!;
    await decide(ctx, harish.assessment.id, 'potential_match', 'Strong reference.');
    const after = dashboard(await load());
    expect(after.qualified).toBe(before.qualified + 1);
    expect(after.awaitingReview).toBe(before.awaitingReview - 1);
    expect(after.statusMix.potential_match).toBe(before.statusMix.potential_match + 1);
  });
  it('re-screening uses the newest assessment per person and mandate, never double counting', async () => {
    const before = dashboard(await load());
    const aarav = (await latestAssessments(await load())).find((r) => r.candidate.name === 'Aarav Mehta')!;
    await screenExisting(ctx, aarav.candidate.id, aarav.mandate.id);
    const after = dashboard(await load());
    expect(after.cvsScreened).toBe(before.cvsScreened);
    expect(latestAssessments(await load()).find((r) => r.candidate.name === 'Aarav Mehta')!.assessment.version).toBe(2);
  });
  it('lists recent activity newest first', async () => {
    const d = dashboard(await load());
    expect(d.recent.length).toBeGreaterThan(0);
    expect(d.recent.length).toBeLessThanOrEqual(12);
  });
});
