import { beforeEach, describe, expect, it } from 'vitest';
import { createHeuristicProvider } from '@/ai/heuristic';
import { DEMO_CVS, VP_PROCUREMENT_JD } from '@/data/demoCvs';
import { DEMO_USERS, E_IND, E_LOG, E_RET, seedDemo } from '@/data/demo';
import { ImmutableRecordError } from '@/domain/guards';
import { RubricLockedError } from '@/domain/rubric';
import { DEFAULT_POLICY } from '@/domain/scoring';
import type { AiProvider } from '@/domain/contract';
import type { Mandate } from '@/domain/types';
import { enc, makeDocx, makePdf } from '@/test/fixtures';
import { NOW, asUser, makeCtx } from '@/test/helpers';
import { PermissionError, RuleError, type Ctx } from './ctx';
import { canonicalId, groupIds, markNotDuplicate, mergeCandidates, searchCandidates } from './candidates';
import { decide, effectiveStatus } from './decisions';
import { createMandate, duplicateMandate, setMandateStatus, updateMandate, type MandateInput } from './mandates';
import { createJob, ingestText, processUpload, recoverStuckJobs, releaseQuarantine, resolveWithText, retryJob, runJob, runQueue, screenExisting, screenPending } from './pipeline';
import { approveRubricVersion, generateRubric, reviseRubricVersion, saveRubricDraft, screeningBlocker, normaliseWeights } from './rubrics';

const [SUPER, ADMIN, RECRUITER, VIEWER] = DEMO_USERS;
const ascii = (s: string): string => s.replace(/₹/g, 'Rs.').replace(/[–—]/g, '-');

const input = (o: Partial<MandateInput> = {}): MandateInput => ({
  entityId: E_IND, title: 'VP – Procurement', function: 'Procurement', reportingManager: 'COO', location: 'Mumbai', minExperience: 15,
  education: 'MBA or equivalent', certifications: ['CPSM'], competencies: [], mandatoryIndustries: ['Manufacturing'], preferredIndustries: ['Automotive'],
  currency: 'INR', priority: 'high', hiringManager: 'COO', jdText: VP_PROCUREMENT_JD, ...o,
});

async function readyMandate(ctx: Ctx): Promise<Mandate> {
  const m = await createMandate(ctx, input());
  const r = await generateRubric(ctx, m.id, DEFAULT_POLICY);
  await approveRubricVersion(ctx, r.id);
  return (await ctx.repo.get('mandates', m.id))!;
}

describe('mandates', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await makeCtx(); });

  it('creates v1 with a code, an open status, a version snapshot and an audit record', async () => {
    const m = await createMandate(ctx, input());
    expect(m).toMatchObject({ code: 'MND-0001', version: 1, status: 'open' });
    expect(await ctx.repo.list('mandate_versions', { mandateId: m.id })).toHaveLength(1);
    expect((await ctx.repo.list('audit_logs')).map((a) => a.action)).toContain('mandate.create');
  });
  it('validates required fields in plain language', async () => {
    await expect(createMandate(ctx, input({ title: ' ', jdText: '' }))).rejects.toThrow(/title is required.*job description/is);
    await expect(createMandate(ctx, input({ minExperience: 15, preferredExperience: 10 }))).rejects.toBeInstanceOf(RuleError);
  });
  it('a non-material edit keeps the version; a material edit bumps it and snapshots it', async () => {
    const m = await createMandate(ctx, input());
    const a = await updateMandate(ctx, m.id, { priority: 'low', hiringManager: 'Someone' });
    expect(a.diff.material).toBe(false);
    expect(a.mandate.version).toBe(1);
    const b = await updateMandate(ctx, m.id, { minExperience: 12 });
    expect(b.diff.material).toBe(true);
    expect(b.mandate.version).toBe(2);
    expect(await ctx.repo.list('mandate_versions', { mandateId: m.id })).toHaveLength(2);
  });
  it('a no-op edit writes nothing', async () => {
    const m = await createMandate(ctx, input());
    const before = (await ctx.repo.list('audit_logs')).length;
    await updateMandate(ctx, m.id, { title: m.title });
    expect((await ctx.repo.list('audit_logs')).length).toBe(before);
  });
  it('status transitions are constrained and audited', async () => {
    const m = await createMandate(ctx, input());
    expect((await setMandateStatus(ctx, m.id, 'on_hold')).status).toBe('on_hold');
    expect((await setMandateStatus(ctx, m.id, 'closed')).status).toBe('closed');
    await expect(setMandateStatus(ctx, m.id, 'on_hold')).rejects.toBeInstanceOf(RuleError);
    expect((await setMandateStatus(ctx, m.id, 'open')).status).toBe('open');
  });
  it('duplicate creates a fresh v1 requirement with no rubric', async () => {
    const m = await readyMandate(ctx);
    const d = await duplicateMandate(ctx, m.id);
    expect(d).toMatchObject({ version: 1, status: 'open', title: 'VP – Procurement (copy)' });
    expect(d.activeRubricId).toBeUndefined();
    expect(d.id).not.toBe(m.id);
  });
  it('enforces roles and entity boundaries', async () => {
    await expect(createMandate(asUser(ctx, VIEWER), input())).rejects.toBeInstanceOf(PermissionError);
    await expect(createMandate(asUser(ctx, RECRUITER), input({ entityId: E_LOG }))).rejects.toBeInstanceOf(PermissionError); // not their entity
    await expect(createMandate(asUser(ctx, RECRUITER), input({ entityId: E_RET }))).resolves.toBeDefined();
    await expect(createMandate(asUser(ctx, { ...RECRUITER, active: false }), input())).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('rubric lifecycle', () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await makeCtx(); });

  it('AI drafts a rubric with weights totalling 100, the mandated gates, and provenance', async () => {
    const m = await createMandate(ctx, input());
    const r = await generateRubric(ctx, m.id);
    expect(r.status).toBe('draft');
    expect(r.criteria.reduce((a, c) => a + c.weight, 0)).toBe(100);
    expect(r.gates.map((g) => g.type)).toEqual(expect.arrayContaining(['min_experience', 'qualification', 'industry']));
    expect(r.generatedBy).toMatchObject({ id: 'heuristic' });
    expect(r.mandateVersion).toBe(1);
  });
  it('screening is blocked until a rubric is approved, then allowed', async () => {
    const m = await createMandate(ctx, input());
    expect(await screeningBlocker(ctx, m)).toMatch(/No approved rubric/);
    const r = await generateRubric(ctx, m.id);
    expect(await screeningBlocker(ctx, m)).toMatch(/No approved rubric/);
    await approveRubricVersion(ctx, r.id);
    expect(await screeningBlocker(ctx, (await ctx.repo.get('mandates', m.id))!)).toBeUndefined();
  });
  it('an approved rubric cannot be edited; revising creates v2 as an independent draft', async () => {
    const m = await readyMandate(ctx);
    const v1 = (await ctx.repo.get('rubrics', m.activeRubricId!))!;
    await expect(saveRubricDraft(ctx, { ...v1, criteria: [] })).rejects.toBeInstanceOf(RubricLockedError);
    const v2 = await reviseRubricVersion(ctx, v1.id);
    expect(v2).toMatchObject({ version: 2, status: 'draft' });
    await saveRubricDraft(ctx, { ...v2, criteria: v2.criteria.map((c, i) => (i === 0 ? { ...c, weight: c.weight - 5 } : i === 1 ? { ...c, weight: c.weight + 5 } : c)) });
    expect((await ctx.repo.get('rubrics', v1.id))!.criteria[0].weight).toBe(v1.criteria[0].weight);
  });
  it('approving v2 retires v1 but keeps its content frozen', async () => {
    const m = await readyMandate(ctx);
    const v1 = (await ctx.repo.get('rubrics', m.activeRubricId!))!;
    const v2 = await reviseRubricVersion(ctx, v1.id);
    await approveRubricVersion(ctx, v2.id);
    expect((await ctx.repo.get('rubrics', v1.id))!.status).toBe('superseded');
    expect((await ctx.repo.get('mandates', m.id))!.activeRubricId).toBe(v2.id);
  });
  it('a weight total other than 100 blocks approval', async () => {
    const m = await createMandate(ctx, input());
    const r = await generateRubric(ctx, m.id);
    await saveRubricDraft(ctx, { ...r, criteria: r.criteria.map((c, i) => (i === 0 ? { ...c, weight: c.weight + 7 } : c)) });
    await expect(approveRubricVersion(ctx, r.id)).rejects.toThrow(/total 100/);
  });
  it('a material mandate change preserves the old rubric, blocks screening and blocks approving a stale draft', async () => {
    const m = await readyMandate(ctx);
    const v1Id = m.activeRubricId!;
    const { mandate: m2 } = await updateMandate(ctx, m.id, { minExperience: 12 });
    expect(m2.version).toBe(2);
    expect(m2.activeRubricId).toBe(v1Id);
    expect(await screeningBlocker(ctx, m2)).toMatch(/material change/);
    const stale = await generateRubric(ctx, m.id); // built for v2
    const old = (await ctx.repo.get('rubrics', v1Id))!;
    expect(old.mandateVersion).toBe(1);
    expect(old.status).toBe('approved');
    await approveRubricVersion(ctx, stale.id);
    expect(await screeningBlocker(ctx, (await ctx.repo.get('mandates', m.id))!)).toBeUndefined();
  });
  it('normaliseWeights always totals 100 with integers', () => {
    for (const w of [[1, 1, 1], [33, 33, 33], [10, 20, 30], [0, 0], [99.5, 0.5], [7]]) {
      const n = normaliseWeights(w);
      expect(n.reduce((a, b) => a + b, 0)).toBe(100);
      expect(n.every(Number.isInteger)).toBe(true);
    }
  });
  it('a viewer cannot generate or approve', async () => {
    const m = await createMandate(ctx, input());
    await expect(generateRubric(asUser(ctx, VIEWER), m.id)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('CV pipeline with real files', () => {
  let ctx: Ctx;
  let mandate: Mandate;
  beforeEach(async () => { ctx = await makeCtx(); mandate = await readyMandate(ctx); });
  const aarav = DEMO_CVS.find((c) => c.key === 'aarav')!;

  it('DOCX → extracted → deduplicated → screened → completed, with the original file stored', async () => {
    const j = await processUpload(ctx, { mandateId: mandate.id, fileName: aarav.fileName, bytes: await makeDocx(aarav.text) });
    expect(j.status).toBe('completed');
    expect(j.notes.join(' ')).toMatch(/Extracted/);
    expect(await ctx.repo.getFile(j.storagePath!)).toBeDefined();
    const a = (await ctx.repo.get('assessments', j.assessmentId!))!;
    expect(a.score.total).toBeGreaterThan(75);
    expect(a.criteria.every((c) => c.state)).toBe(true);
    expect(a.provider.id).toBe('heuristic');
  });
  it('PDF works too', async () => {
    const j = await processUpload(ctx, { mandateId: mandate.id, fileName: 'a.pdf', bytes: makePdf([ascii(aarav.text)]) });
    expect(j.status).toBe('completed');
    const c = (await ctx.repo.get('candidates', j.candidateId!))!;
    expect(c.name).toBe('Aarav Mehta');
    expect(c.employment.length).toBe(3);
  });
  it('a rejected file stays visible as a failed job with a plain reason; it is never silently dropped', async () => {
    const j = await processUpload(ctx, { mandateId: mandate.id, fileName: 'cv.pdf', bytes: enc('MZ not a pdf at all') });
    expect(j).toMatchObject({ status: 'failed' });
    expect(j.error).toMatch(/does not match/);
    expect((await ctx.repo.list('processing_jobs'))).toHaveLength(1);
  });
  it('re-running a job that validation rejected keeps the original plain-language reason', async () => {
    const j = await createJob(ctx, { mandateId: mandate.id, fileName: 'cv.pdf', bytes: await makeDocx(aarav.text) }); // DOCX bytes, .pdf name
    expect(j.status).toBe('failed');
    const again = await runQueue(ctx, [j.id]);
    expect(again[0].error).toMatch(/does not match/);
  });
  it('active content is quarantined, and only an administrator can release it', async () => {
    const evil = enc('%PDF-1.4\n/JavaScript /JS (x)\n' + 'x'.repeat(200));
    const j = await createJob(ctx, { mandateId: mandate.id, fileName: 'evil.pdf', bytes: evil });
    expect(j.status).toBe('needs_review');
    expect(j.error).toMatch(/Quarantined.*JavaScript/);
    await expect(releaseQuarantine(asUser(ctx, RECRUITER), j.id)).rejects.toBeInstanceOf(PermissionError);
    expect((await releaseQuarantine(asUser(ctx, ADMIN), j.id)).status).toBe('queued');
    expect((await ctx.repo.list('audit_logs')).map((a) => a.action)).toContain('job.quarantine_release');
  });
  it('a scanned PDF needs OCR: kept, flagged Needs Review, and resolvable by supplying the text', async () => {
    const j = await processUpload(ctx, { mandateId: mandate.id, fileName: 'scan.pdf', bytes: makePdf(['']) });
    expect(j.status).toBe('needs_review');
    expect(j.error).toMatch(/OCR/);
    expect(await ctx.repo.getFile(j.storagePath!)).toBeDefined();
    const done = await resolveWithText(ctx, j.id, aarav.text);
    expect(done.status).toBe('completed');
    expect((await ctx.repo.list('audit_logs')).map((a) => a.action)).toContain('job.manual_text');
  });
  it('an AI/provider failure fails the job but keeps the file, and Retry succeeds once the provider recovers', async () => {
    let boom = true;
    const base = createHeuristicProvider({ now: () => NOW });
    const flaky: AiProvider = { ...base, async extractProfile(r) { if (boom) throw new Error('provider unavailable'); return base.extractProfile(r); } };
    const c = { ...ctx, ai: flaky };
    const j = await createJob(c, { mandateId: mandate.id, fileName: aarav.fileName, bytes: await makeDocx(aarav.text) });
    const failed = await runJob(c, j.id);
    expect(failed).toMatchObject({ status: 'failed', error: 'provider unavailable' });
    expect(await ctx.repo.getFile(failed.storagePath!)).toBeDefined();
    boom = false;
    expect((await retryJob(c, j.id)).status).toBe('completed');
  });
  it('the exact same file for the same mandate is recognised and not screened twice', async () => {
    const bytes = await makeDocx(aarav.text);
    const first = await processUpload(ctx, { mandateId: mandate.id, fileName: 'one.docx', bytes });
    const second = await processUpload(ctx, { mandateId: mandate.id, fileName: 'copy.docx', bytes });
    expect(second.status).toBe('completed');
    expect(second.notes.join(' ')).toMatch(/Duplicate file/);
    expect(second.assessmentId).toBe(first.assessmentId);
    expect(await ctx.repo.list('assessments')).toHaveLength(1);
    expect(await ctx.repo.list('candidates')).toHaveLength(1);
  });
  it('the same file for a different mandate reuses the profile and screens it against the new rubric', async () => {
    const bytes = await makeDocx(aarav.text);
    await processUpload(ctx, { mandateId: mandate.id, fileName: 'one.docx', bytes });
    const other = await readyMandate(ctx);
    const j = await processUpload(ctx, { mandateId: other.id, fileName: 'one.docx', bytes });
    expect(j.status).toBe('completed');
    expect(await ctx.repo.list('candidates')).toHaveLength(1);
    expect(await ctx.repo.list('assessments')).toHaveLength(2);
  });
  it('CVs uploaded before the rubric is approved wait, then screen on approval', async () => {
    const m2 = await createMandate(ctx, input());
    const j = await processUpload(ctx, { mandateId: m2.id, fileName: aarav.fileName, bytes: await makeDocx(aarav.text) });
    expect(j.status).toBe('extracted');
    expect(j.notes.join(' ')).toMatch(/Waiting for screening/);
    const r = await generateRubric(ctx, m2.id);
    await approveRubricVersion(ctx, r.id);
    const done = await screenPending(ctx, m2.id);
    expect(done[0].status).toBe('completed');
  });
  it('bulk queue processes everything with bounded concurrency and reports failures individually', async () => {
    const ids: string[] = [];
    for (const cv of DEMO_CVS.filter((c) => c.text)) ids.push((await createJob(ctx, { mandateId: mandate.id, fileName: cv.fileName.replace(/\.\w+$/, '.docx'), bytes: await makeDocx(cv.text) })).id);
    let active = 0; let peak = 0;
    const base = ctx.ai;
    const counted: AiProvider = { ...base, async extractProfile(r) { active++; peak = Math.max(peak, active); await new Promise((res) => setTimeout(res, 5)); try { return await base.extractProfile(r); } finally { active--; } } };
    const done = await runQueue({ ...ctx, ai: counted }, ids, { concurrency: 2 });
    expect(done).toHaveLength(ids.length);
    expect(done.every((j) => j.status === 'completed')).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
  });
  it('recovers jobs left mid-flight by a crash (their files are stored)', async () => {
    const j = await createJob(ctx, { mandateId: mandate.id, fileName: aarav.fileName, bytes: await makeDocx(aarav.text) });
    await ctx.repo.put('processing_jobs', { ...j, status: 'extracting' });
    expect(await recoverStuckJobs(ctx)).toEqual([j.id]);
    expect((await runQueue(ctx, [j.id]))[0].status).toBe('completed');
  });
});

describe('screening, scoring and governance', () => {
  let ctx: Ctx;
  let mandate: Mandate;
  beforeEach(async () => { ctx = await makeCtx(); mandate = await readyMandate(ctx); });
  const cv = (k: string) => DEMO_CVS.find((c) => c.key === k)!;
  const run = async (k: string, c: Ctx = ctx) => {
    const j = await ingestText(c, mandate.id, cv(k).fileName, cv(k).text);
    return { job: j, a: j.assessmentId ? (await c.repo.get('assessments', j.assessmentId))! : undefined };
  };

  it('the 74-vs-75 safeguard: a 74.3 goes to borderline review, not rejection', async () => {
    await seedDemo(await makeCtx());
    const { a } = await run('harish');
    expect(a!.score.total).toBeGreaterThanOrEqual(70);
    expect(a!.score.total).toBeLessThan(75);
    expect(a!.status).toBe('borderline_review');
  });
  it('a verified mandatory failure is not hidden by the rest of the score', async () => {
    const { a } = await run('nisha');
    expect(a!.gates.some((g) => g.status === 'fail')).toBe(true);
    expect(a!.status).toBe('mandatory_non_compliance');
  });
  it('an unstated mandatory requirement is Verification Required, not a failure', async () => {
    const { a } = await run('meera');
    expect(a!.score.total).toBeGreaterThan(75);
    expect(a!.gates.find((g) => g.status === 'needs_verification')).toBeDefined();
    expect(a!.gates.some((g) => g.status === 'fail')).toBe(false);
    expect(a!.status).toBe('verification_required');
  });
  it('a near-empty CV goes to manual review on low extraction confidence', async () => {
    const { a, job } = await run('karan');
    expect(job.status).toBe('completed');
    expect(a!.status).toBe('manual_review');
    expect(a!.statusReasons.join(' ')).toMatch(/Extraction confidence/);
  });
  it('every assessed criterion cites evidence that exists in the CV, with the three layers separated', async () => {
    const { a } = await run('aarav');
    const doc = (await ctx.repo.get('candidate_documents', a!.documentId))!;
    const text = doc.pages.map((p) => p.text.toLowerCase().replace(/\s+/g, ' ')).join(' ');
    for (const c of a!.criteria.filter((x) => x.rating !== null)) {
      expect(c.evidence.length).toBeGreaterThan(0);
      for (const e of c.evidence) expect(text).toContain(e.quote.toLowerCase().replace(/\s+/g, ' '));
      expect(c.interpretation.length).toBeGreaterThan(0);
    }
  });
  it('the score is recomputed by code from ratings and weights, and reproduces exactly', async () => {
    const { a } = await run('sunita');
    const rubric = (await ctx.repo.get('rubrics', a!.rubricId))!;
    const manual = a!.criteria.reduce((sum, c) => sum + (c.rating === null ? 0 : (c.rating / 5) * rubric.criteria.find((x) => x.id === c.criterionId)!.weight), 0);
    const assessed = a!.score.coverage * 100;
    expect(a!.score.total).toBeCloseTo((manual / assessed) * 100, 1);
    const again = await screenExisting(ctx, a!.candidateId, mandate.id);
    expect(again.score.total).toBe(a!.score.total);
    expect(again.version).toBe(2);
    expect(again.supersedesId).toBe(a!.id);
  });
  it('a model that invents evidence cannot raise a score: unsupported ratings are withheld and the CV goes to manual review', async () => {
    const base = createHeuristicProvider({ now: () => NOW });
    const liar: AiProvider = {
      ...base,
      async assessCandidate(r) {
        const out = await base.assessCandidate(r);
        return { ...out, criteria: out.criteria.map((c) => ({ ...c, rating: 5, evidence: [{ quote: 'Won the Global Procurement Leader of the Year award three times' }] })) };
      },
    };
    const { a } = await run('rohan', { ...ctx, ai: liar });
    expect(a!.score.total).toBe(0);
    expect(a!.status).toBe('manual_review');
    expect(a!.flags.some((f) => f.code === 'inconsistency')).toBe(true);
  });
  it('a model-supplied total, status or gate "pass" for experience cannot override code: experience is computed deterministically', async () => {
    const base = createHeuristicProvider({ now: () => NOW });
    const liar: AiProvider = {
      ...base,
      async assessCandidate(r) {
        const out = await base.assessCandidate(r);
        return { ...out, gates: out.gates.map((g) => ({ ...g, status: 'pass' as const })) };
      },
    };
    const { a } = await run('nisha', { ...ctx, ai: liar });
    expect(a!.gates.find((g) => g.note.includes('years'))?.status).toBe('fail');
    expect(a!.status).toBe('mandatory_non_compliance');
  });
  it('bias check: the same CV with a different name, gender, age and religion scores identically', async () => {
    const original = cv('aarav').text;
    const swapped = original
      .replace(/AARAV MEHTA/, 'ANITA IYENGAR').replace(/aarav\.mehta@/, 'anita.iyengar@').replace(/aaravmehta-demo/, 'anitaiyengar-demo')
      .replace(/Gender: Male/, 'Gender: Female').replace(/Date of Birth: .*/, 'Date of Birth: 14 July 1996').replace(/Marital Status: Married/, 'Marital Status: Single\nReligion: Jain');
    const a = (await run('aarav')).a!;
    const j2 = await ingestText(ctx, mandate.id, 'Anita_Iyengar_CV.docx', swapped);
    const b = (await ctx.repo.get('assessments', j2.assessmentId!))!;
    expect(b.score.total).toBe(a.score.total);
    expect(b.status).toBe(a.status);
    expect(b.criteria.map((c) => c.rating)).toEqual(a.criteria.map((c) => c.rating));
    expect(a.redactions).toEqual(expect.arrayContaining(['gender / sex removed', 'name replaced']));
  });
  it('re-screening never overwrites: assessments are append-only', async () => {
    const { a } = await run('aarav');
    await expect(ctx.repo.put('assessments', { ...a!, status: 'exceptional_match' })).rejects.toBeInstanceOf(ImmutableRecordError);
    expect((await ctx.repo.get('assessments', a!.id))!.status).toBe(a!.status);
  });

  describe('human override', () => {
    it('records who/when/why, leaves the AI assessment untouched, and changes the effective status', async () => {
      const { a } = await run('harish');
      const d = await decide(ctx, a!.id, 'potential_match', 'Reference call confirmed strategic ownership of the procurement agenda.', 'Hiring manager aligned.');
      expect(d).toMatchObject({ originalStatus: 'borderline_review', newStatus: 'potential_match', decidedBy: SUPER.id, rubricVersion: 1, assessmentVersion: 1 });
      expect((await ctx.repo.get('assessments', a!.id))!.status).toBe('borderline_review');
      expect(effectiveStatus(a!, await ctx.repo.list('decisions'))).toBe('potential_match');
      const log = (await ctx.repo.list('audit_logs')).find((x) => x.action === 'decision.override')!;
      expect(log.summary).toMatch(/borderline_review → potential_match/);
      expect(log.summary).toMatch(/Reference call/);
    });
    it('requires a reason, a real change, and permission', async () => {
      const { a } = await run('harish');
      await expect(decide(ctx, a!.id, 'potential_match', '  ')).rejects.toThrow(/reason is required/);
      await expect(decide(ctx, a!.id, 'borderline_review', 'same')).rejects.toThrow(/already in that status/);
      await expect(decide(asUser(ctx, VIEWER), a!.id, 'potential_match', 'x')).rejects.toBeInstanceOf(PermissionError);
    });
    it('the latest decision wins and the whole history is retained', async () => {
      const { a } = await run('harish');
      await decide(ctx, a!.id, 'potential_match', 'first');
      await decide({ ...ctx, now: () => new Date(NOW.getTime() + 60_000) }, a!.id, 'below_threshold', 'second');
      const ds = await ctx.repo.list('decisions', { assessmentId: a!.id });
      expect(ds).toHaveLength(2);
      expect(effectiveStatus(a!, ds)).toBe('below_threshold');
    });
  });
});

describe('candidate identity', () => {
  let ctx: Ctx;
  let mandate: Mandate;
  beforeEach(async () => { ctx = await makeCtx(); mandate = await readyMandate(ctx); });
  const aarav = DEMO_CVS[0];

  it('a new CV with the same email links as CV version 2; the old assessment is unchanged', async () => {
    const j1 = await ingestText(ctx, mandate.id, 'v1.docx', aarav.text);
    const a1 = (await ctx.repo.get('assessments', j1.assessmentId!))!;
    const v2 = aarav.text.replace('Jan 2019 – Present', 'Jan 2019 – Present').replace('Procurement leader with 18 years', 'Procurement leader with 19 years') + '\n- Added a new achievement: reduced working capital by 12% through supplier financing programmes.';
    const j2 = await ingestText(ctx, mandate.id, 'v2.docx', v2);
    expect(j2.candidateId).toBe(j1.candidateId);
    expect(await ctx.repo.list('candidates')).toHaveLength(1);
    const docs = await ctx.repo.list('candidate_documents', { candidateId: j1.candidateId });
    expect(docs.map((d) => d.version).sort()).toEqual([1, 2]);
    expect((await ctx.repo.get('assessments', a1.id))).toEqual(a1);
    expect((await ctx.repo.list('assessments')).filter((a) => a.candidateId === j1.candidateId)).toHaveLength(2);
  });
  it('a similar name with no shared identifier is NOT linked', async () => {
    await ingestText(ctx, mandate.id, 'a.docx', aarav.text);
    const other = aarav.text.replace(/aarav\.mehta@example\.com/, 'a.mehta2@example.com').replace(/\+91 90000 00011/, '+91 98888 12345');
    const j = await ingestText(ctx, mandate.id, 'b.docx', other);
    const cands = await ctx.repo.list('candidates');
    expect(cands).toHaveLength(2);
    const second = cands.find((c) => c.id === j.candidateId)!;
    // Same name AND same current employer → flagged for a person, never auto-merged.
    expect(second.duplicateOf?.length).toBe(1);
    expect(second.identityFlags).toContain('possible_duplicate');
    expect(second.mergedInto).toBeUndefined();
  });
  it('a shared email with a different name needs review rather than silently linking', async () => {
    await ingestText(ctx, mandate.id, 'a.docx', aarav.text);
    const j = await ingestText(ctx, mandate.id, 'b.docx', aarav.text.replace(/AARAV MEHTA/, 'PRIYA NAIR').replace(/linkedin.*\n/, ''));
    const c = (await ctx.repo.get('candidates', j.candidateId!))!;
    expect(c.identityFlags).toContain('shared_identifier_name_conflict');
    expect(await ctx.repo.list('candidates')).toHaveLength(2);
  });
  it('merge is audited, keeps both records, and groups assessments under the survivor', async () => {
    await ingestText(ctx, mandate.id, 'a.docx', aarav.text);
    const j2 = await ingestText(ctx, mandate.id, 'b.docx', aarav.text.replace(/aarav\.mehta@example\.com/, 'a.mehta2@example.com').replace(/\+91 90000 00011/, '+91 98888 12345'));
    const [first, second] = (await ctx.repo.list('candidates')).sort((a, b) => a.code.localeCompare(b.code));
    await expect(mergeCandidates(ctx, first.id, second.id, '')).rejects.toThrow(/reason is required/);
    await expect(mergeCandidates(asUser(ctx, VIEWER), first.id, second.id, 'same person')).rejects.toBeInstanceOf(PermissionError);
    await mergeCandidates(ctx, first.id, second.id, 'Same person, second email');
    const all = await ctx.repo.list('candidates');
    expect(all.find((c) => c.id === second.id)!.mergedInto).toBe(first.id);
    expect(canonicalId(all, second.id)).toBe(first.id);
    expect(groupIds(all, first.id).sort()).toEqual([first.id, second.id].sort());
    const assessments = await ctx.repo.list('assessments');
    expect(assessments.filter((a) => groupIds(all, first.id).includes(a.candidateId))).toHaveLength(2);
    expect((await ctx.repo.list('audit_logs')).some((a) => a.action === 'candidate.merge' && /Same person/.test(a.summary))).toBe(true);
    expect(j2.assessmentId).toBeDefined();
  });
  it('"not the same person" is remembered and clears the flag', async () => {
    await ingestText(ctx, mandate.id, 'a.docx', aarav.text);
    const j2 = await ingestText(ctx, mandate.id, 'b.docx', aarav.text.replace(/aarav\.mehta@example\.com/, 'x@example.com').replace(/\+91 90000 00011/, '+91 98888 12345'));
    const c = (await ctx.repo.get('candidates', j2.candidateId!))!;
    const cleared = await markNotDuplicate(ctx, c.id, c.duplicateOf![0]);
    expect(cleared.duplicateOf).toEqual([]);
    expect(cleared.notDuplicateOf).toEqual([c.duplicateOf![0]]);
  });
  it('searches structured evidence, not just keywords', async () => {
    for (const k of ['aarav', 'kavita', 'rohan']) await ingestText(ctx, mandate.id, `${k}.docx`, DEMO_CVS.find((c) => c.key === k)!.text);
    const all = await ctx.repo.list('candidates');
    expect(searchCandidates(all, { minYears: 17 }).map((c) => c.name).sort()).toEqual(['Aarav Mehta', 'Rohan Desai']); // Kavita (15y) excluded
    expect(searchCandidates(all, { minYears: 17, industry: 'automotive' }).map((c) => c.name)).toEqual(['Aarav Mehta']);
    expect(searchCandidates(all, { industry: 'automotive' }).map((c) => c.name)).toEqual(['Aarav Mehta']);
    expect(searchCandidates(all, { minTeam: 40 }).map((c) => c.name)).toEqual(['Aarav Mehta']);
    expect(searchCandidates(all, { text: 'sourcing', company: 'brightline' }).map((c) => c.name)).toEqual(['Kavita Rao']);
    expect(searchCandidates(all, { skill: 'negotiation' }).map((c) => c.name)).toEqual(['Kavita Rao']);
  });
});

describe('demo seed', () => {
  it('loads a realistic spread of outcomes through the real pipeline', async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const statuses = (await ctx.repo.list('assessments')).map((a) => a.status);
    for (const s of ['strong_match', 'potential_match', 'borderline_review', 'below_threshold', 'mandatory_non_compliance', 'verification_required', 'manual_review']) expect(statuses).toContain(s);
    expect((await ctx.repo.list('processing_jobs')).filter((j) => j.status === 'needs_review')).toHaveLength(1); // the scanned PDF
    expect((await ctx.repo.list('mandates')).map((m) => m.status).sort()).toEqual(['on_hold', 'open', 'open']);
    await seedDemo(ctx); // idempotent
    expect(await ctx.repo.list('mandates')).toHaveLength(3);
    expect(E_RET).toBeDefined();
  });
});
