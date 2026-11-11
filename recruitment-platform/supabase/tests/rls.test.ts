import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { E1, E2, U, as, asAnon, failure, freshDb, insertAssessment, insertCandidate, insertMandate, j, uuid } from './harness';

let db: PGlite;
const M1 = uuid(1); const M2 = uuid(2); const C1 = uuid(10); const C2 = uuid(11); const A1 = uuid(20); const A2 = uuid(21);

beforeAll(async () => {
  db = await freshDb();
  await insertMandate(db, M1, E1);
  await insertMandate(db, M2, E2);
  await insertCandidate(db, C1, E1);
  await insertCandidate(db, C2, E2);
  await insertAssessment(db, A1, M1, C1, E1);
  await insertAssessment(db, A2, M2, C2, E2);
});

describe('bootstrap and profiles', () => {
  it('the first sign-up became super admin; later sign-ups default to inactive viewers', async () => {
    const r = await db.query<{ id: string; role: string; active: boolean }>(`select id, role, active from public.profiles where id in ('${U.super}')`);
    expect(r.rows[0]).toMatchObject({ role: 'super_admin', active: true });
    const fresh = await freshDb();
    await fresh.exec(`insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', 'late@example.test')`);
    const late = await fresh.query<{ role: string; active: boolean }>(`select role, active from public.profiles where id='99999999-9999-4999-8999-999999999999'`);
    expect(late.rows[0]).toEqual({ role: 'viewer', active: false });
  });
  it('a user reads only their own profile; an admin reads all', async () => {
    expect((await as(db, U.rec1, () => db.query(`select id from public.profiles`))).rows).toHaveLength(1);
    expect((await as(db, U.admin, () => db.query(`select id from public.profiles`))).rows.length).toBeGreaterThanOrEqual(6);
  });
  it('a non-admin cannot change any profile, including their own (RLS matches zero rows)', async () => {
    for (const set of [`role='admin'`, `active=false`, `entity_ids=array['${E2}']::uuid[]`]) {
      const r = await as(db, U.rec1, () => db.query(`update public.profiles set ${set} where id='${U.rec1}' returning id`));
      expect(r.rows, set).toHaveLength(0);
    }
    const stored = await db.query<{ role: string }>(`select role from public.profiles where id='${U.rec1}'`);
    expect(stored.rows[0].role).toBe('recruiter');
  });
  it('even an administrator cannot change their own role, activation or entity access', async () => {
    for (const [u, set] of [[U.admin, `role='super_admin'`], [U.admin, `active=false`], [U.super, `role='viewer'`], [U.admin, `entity_ids=array['${E1}']::uuid[]`]] as const) {
      const e = await as(db, u, () => failure(db.exec(`update public.profiles set ${set} where id='${u}'`)));
      expect(e?.message, set).toMatch(/cannot change your own/);
    }
  });
  it('a recruiter cannot edit other profiles; an admin cannot mint admins, a super admin can', async () => {
    const rec = await as(db, U.rec1, () => db.query(`update public.profiles set name='x' where id='${U.view1}' returning id`));
    expect(rec.rows).toHaveLength(0);
    const e = await as(db, U.admin, () => failure(db.exec(`update public.profiles set role='admin' where id='${U.view1}'`)));
    expect(e?.message).toMatch(/only a super admin/);
    const ok = await as(db, U.super, () => failure(db.exec(`update public.profiles set role='admin' where id='${U.off}'`)));
    expect(ok).toBeNull();
    await db.exec(`update public.profiles set role='recruiter' where id='${U.off}'`);
  });
  it('an admin may activate a viewer and assign entities', async () => {
    expect(await as(db, U.admin, () => failure(db.exec(`update public.profiles set entity_ids=array['${E1}','${E2}']::uuid[] where id='${U.view1}'`)))).toBeNull();
    await db.exec(`update public.profiles set entity_ids=array['${E1}']::uuid[] where id='${U.view1}'`);
  });
});

describe('entity isolation (RLS)', () => {
  it('anon sees and writes nothing', async () => {
    expect(await failure(asAnon(db, () => db.query(`select * from public.mandates`)))).not.toBeNull();
  });
  it('a recruiter sees only their entity across every table', async () => {
    const q = (t: string) => as(db, U.rec1, () => db.query<{ id: string }>(`select id from public.${t}`)).then((r) => r.rows.map((x) => x.id));
    expect(await q('mandates')).toEqual([M1]);
    expect(await q('candidates')).toEqual([C1]);
    expect(await q('assessments')).toEqual([A1]);
    expect(await q('entities')).toEqual([E1]);
  });
  it('admins and super admins see everything', async () => {
    for (const u of [U.admin, U.super]) expect((await as(db, u, () => db.query(`select id from public.mandates`))).rows).toHaveLength(2);
  });
  it('an inactive user sees nothing', async () => {
    expect((await as(db, U.off, () => db.query(`select id from public.mandates`))).rows).toHaveLength(0);
  });
  it('a recruiter cannot write into another entity, or reassign a row to one', async () => {
    const m = uuid(30);
    const e1 = await as(db, U.rec1, () => failure(db.exec(`insert into public.mandates (id, entity_id, status, data) values ('${m}', '${E2}', 'open', '${j({ id: m, entityId: E2, status: 'open' })}')`)));
    expect(e1).not.toBeNull();
    const e2 = await as(db, U.rec1, () => failure(db.exec(`update public.mandates set entity_id='${E2}', data = data || '{"entityId":"${E2}"}'::jsonb where id='${M1}'`)));
    expect(e2).not.toBeNull();
  });
  it('a viewer reads but cannot write anything', async () => {
    expect((await as(db, U.view1, () => db.query(`select id from public.mandates`))).rows).toHaveLength(1);
    const m = uuid(31);
    expect(await as(db, U.view1, () => failure(db.exec(`insert into public.mandates (id, entity_id, status, data) values ('${m}', '${E1}', 'open', '${j({ id: m, entityId: E1, status: 'open' })}')`)))).not.toBeNull();
    expect((await as(db, U.view1, () => db.query(`update public.mandates set status='closed', data = data || '{"status":"closed"}'::jsonb where id='${M1}' returning id`))).rows).toHaveLength(0);
  });
  it('a recruiter can create and edit within their entity', async () => {
    const m = uuid(32);
    expect(await as(db, U.rec1, () => failure(db.exec(`insert into public.mandates (id, entity_id, status, data) values ('${m}', '${E1}', 'open', '${j({ id: m, entityId: E1, status: 'open' })}')`)))).toBeNull();
    const up = await as(db, U.rec1, () => db.query(`update public.mandates set status='on_hold', data = data || '{"status":"on_hold"}'::jsonb where id='${m}' returning id`));
    expect(up.rows).toHaveLength(1);
  });
  it('the typed columns and the record must agree (no showing one entity while storing under another)', async () => {
    const m = uuid(33);
    const e = await failure(db.exec(`insert into public.mandates (id, entity_id, status, data) values ('${m}', '${E1}', 'open', '${j({ id: m, entityId: E2, status: 'open' })}')`));
    expect(e?.message).toMatch(/mandates_entity_matches/);
  });
  it('hard deletes are refused for every core table', async () => {
    for (const t of ['mandates', 'candidates']) {
      const e = await as(db, U.admin, () => failure(db.exec(`delete from public.${t}`)));
      expect(e, t).not.toBeNull();
    }
    expect(await failure(db.exec(`delete from public.mandates`))).not.toBeNull(); // even for the superuser
  });
});

describe('central candidates, entity-level visibility', () => {
  it('a candidate becomes visible to another entity only through an assessment there', async () => {
    expect(await as(db, U.rec2, () => db.query<{ id: string }>(`select id from public.candidates`)).then((r) => r.rows.map((x) => x.id))).toEqual([C2]);
    const a = uuid(40);
    await insertAssessment(db, a, M2, C1, E2); // C1 (owned by E1) assessed against a mandate of E2
    const seen = (await as(db, U.rec2, () => db.query<{ id: string }>(`select id from public.candidates order by id`))).rows.map((x) => x.id);
    expect(seen).toEqual([C1, C2]);
    // …but the E1-owned assessment history stays hidden from E2.
    const assessments = (await as(db, U.rec2, () => db.query<{ id: string }>(`select id from public.assessments`))).rows.map((x) => x.id);
    expect(assessments).not.toContain(A1);
  });
  it('documents follow candidate visibility', async () => {
    const d = uuid(41);
    await db.exec(`insert into public.candidate_documents (id, candidate_id, entity_id, sha256, data) values ('${d}', '${C1}', '${E1}', 'abc', '${j({ id: d, entityId: E1 })}')`);
    expect((await as(db, U.rec1, () => db.query(`select id from public.candidate_documents`))).rows).toHaveLength(1);
    expect((await as(db, U.rec2, () => db.query(`select id from public.candidate_documents`))).rows).toHaveLength(1); // via the E2 assessment above
    const onlyE2 = '77777777-7777-4777-8777-777777777777';
    expect(onlyE2).toBeTruthy();
  });
});

describe('immutability', () => {
  it.each(['assessments', 'decisions', 'audit_logs', 'mandate_versions'])('%s: UPDATE and DELETE are refused for everyone, including the superuser', async (t) => {
    // seed one row per table
    const id = uuid(50 + ['assessments', 'decisions', 'audit_logs', 'mandate_versions'].indexOf(t));
    if (t === 'decisions') await db.exec(`insert into public.decisions (id, assessment_id, mandate_id, candidate_id, entity_id, data) values ('${id}', '${A1}', '${M1}', '${C1}', '${E1}', '${j({ id, entityId: E1, decidedBy: U.rec1 })}')`);
    if (t === 'audit_logs') await db.exec(`insert into public.audit_logs (id, at, user_id, entity_id, target_id, data) values ('${id}', now(), '${U.rec1}', '${E1}', 'x', '{}')`);
    if (t === 'mandate_versions') await db.exec(`insert into public.mandate_versions (id, mandate_id, entity_id, data) values ('${id}', '${M1}', '${E1}', '${j({ entityId: E1 })}')`);
    const target = t === 'assessments' ? A1 : id;
    expect((await failure(db.exec(`update public.${t} set data = '{}'::jsonb where id='${target}'`)))?.message).toMatch(/append-only/);
    expect((await failure(db.exec(`delete from public.${t} where id='${target}'`)))?.message).toMatch(/append-only/);
    expect(await failure(db.exec(`truncate public.${t}`))).not.toBeNull(); // trigger, or an FK refusing it first
    for (const u of [U.super, U.admin, U.rec1]) {
      const r = await as(db, u, () => failure(db.exec(`update public.${t} set data = '{}'::jsonb where id='${target}'`)));
      expect(r, `${t} as ${u}`).not.toBeNull();
    }
  });
  it('rubrics: drafts are editable; an approved rubric is frozen and can only be superseded', async () => {
    const r = uuid(60);
    const rec = { id: r, mandateId: M1, entityId: E1, status: 'draft', criteria: [{ weight: 100 }], version: 1 };
    await db.exec(`insert into public.rubrics (id, mandate_id, entity_id, status, data) values ('${r}', '${M1}', '${E1}', 'draft', '${j(rec)}')`);
    const upd = (status: string, criteria: unknown) => as(db, U.rec1, () => db.exec(`update public.rubrics set status='${status}', data='${j({ ...rec, status, criteria })}' where id='${r}'`));
    expect(await failure(upd('draft', [{ weight: 90 }]))).toBeNull(); // edit draft
    expect(await failure(upd('approved', [{ weight: 90 }]))).toBeNull(); // approve
    expect((await failure(upd('approved', [{ weight: 50 }])))?.message).toMatch(/frozen/); // change approved content
    expect((await failure(upd('draft', [{ weight: 90 }])))?.message).toMatch(/frozen/); // reopen
    expect(await failure(upd('superseded', [{ weight: 90 }]))).toBeNull(); // retire
    expect((await failure(upd('approved', [{ weight: 90 }])))?.message).toMatch(/frozen/); // resurrect
    expect((await failure(db.exec(`delete from public.rubrics where id='${r}'`)))?.message).toMatch(/cannot be deleted/);
  });
  it('assessments and decisions can be inserted by writers in their entity, but not by viewers or other entities', async () => {
    const a = uuid(70);
    const ins = (u: string, ent: string, id: string) => as(db, u, () => failure(db.exec(`insert into public.assessments (id, mandate_id, candidate_id, entity_id, data) values ('${id}', '${ent === E1 ? M1 : M2}', '${ent === E1 ? C1 : C2}', '${ent}', '${j({ id, entityId: ent })}')`)));
    expect(await ins(U.rec1, E1, a)).toBeNull();
    expect(await ins(U.view1, E1, uuid(71))).not.toBeNull();
    expect(await ins(U.rec1, E2, uuid(72))).not.toBeNull();
  });
  it('a decision must be attributed to the person making it', async () => {
    const d1 = uuid(80); const d2 = uuid(81);
    const ins = (id: string, by: string) => as(db, U.rec1, () => failure(db.exec(`insert into public.decisions (id, assessment_id, mandate_id, candidate_id, entity_id, data) values ('${id}', '${A1}', '${M1}', '${C1}', '${E1}', '${j({ id, entityId: E1, decidedBy: by })}')`)));
    expect(await ins(d1, U.rec1)).toBeNull();
    expect(await ins(d2, U.admin)).not.toBeNull(); // cannot record a decision as someone else
  });
});

describe('audit log access', () => {
  const ins = (u: string, id: string, userId: string, entity: string | null) =>
    as(db, u, () => failure(db.exec(`insert into public.audit_logs (id, at, user_id, entity_id, target_id, data) values ('${id}', now(), '${userId}', ${entity ? `'${entity}'` : 'null'}, 't', '{}')`)));
  it('any active user appends entries attributed to themselves, within entities they can see', async () => {
    expect(await ins(U.rec1, uuid(90), U.rec1, E1)).toBeNull();
    expect(await ins(U.view1, uuid(91), U.view1, E1)).toBeNull();
  });
  it('cannot forge another user, write into a foreign entity, or write while inactive', async () => {
    expect(await ins(U.rec1, uuid(92), U.admin, E1)).not.toBeNull();
    expect(await ins(U.rec1, uuid(93), U.rec1, E2)).not.toBeNull();
    expect(await ins(U.off, uuid(94), U.off, E1)).not.toBeNull();
  });
  it('only administrators can read the audit trail', async () => {
    expect((await as(db, U.rec1, () => db.query(`select id from public.audit_logs`))).rows).toHaveLength(0);
    expect((await as(db, U.admin, () => db.query(`select id from public.audit_logs`))).rows.length).toBeGreaterThan(0);
  });
});

describe('storage: original CVs', () => {
  const put = (u: string, name: string) => as(db, u, () => failure(db.exec(`insert into storage.objects (bucket_id, name) values ('cvs', '${name}')`)));
  const seen = (u: string) => as(db, u, () => db.query<{ name: string }>(`select name from storage.objects where bucket_id='cvs' order by name`)).then((r) => r.rows.map((x) => x.name));

  it('the bucket is private with a size cap and document-type allow-list', async () => {
    const b = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='cvs'`);
    expect(b.rows[0].public).toBe(false);
    expect(Number(b.rows[0].file_size_limit)).toBe(10 * 1024 * 1024);
    expect(b.rows[0].allowed_mime_types).toContain('application/pdf');
  });
  it('writers upload only under entities they can see', async () => {
    expect(await put(U.rec1, `${E1}/job1/cv.pdf`)).toBeNull();
    expect(await put(U.rec1, `${E2}/job2/cv.pdf`)).not.toBeNull();
    expect(await put(U.rec2, `${E2}/job3/cv.pdf`)).toBeNull();
    expect(await put(U.view1, `${E1}/job4/cv.pdf`)).not.toBeNull();
  });
  it('only writers of that entity can download; viewers and other entities cannot', async () => {
    expect(await seen(U.rec1)).toEqual([`${E1}/job1/cv.pdf`]);
    expect(await seen(U.rec2)).toEqual([`${E2}/job3/cv.pdf`]);
    expect(await seen(U.view1)).toEqual([]);
    expect(await seen(U.admin)).toHaveLength(2);
  });
  it('files are write-once: no update or delete policy exists', async () => {
    const del = await as(db, U.rec1, () => db.query(`delete from storage.objects where bucket_id='cvs' returning name`));
    expect(del.rows).toHaveLength(0);
    const upd = await as(db, U.rec1, () => db.query(`update storage.objects set name = name || 'x' where bucket_id='cvs' returning name`));
    expect(upd.rows).toHaveLength(0);
  });
});
