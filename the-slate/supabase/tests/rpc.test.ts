import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, as, failure, freshDb, q } from './harness';

let db: PGlite;
const rpc = <T = unknown>(uid: string, sql: string, params: unknown[] = []) => as(db, uid, async () => (await db.query<T>(sql, params)).rows);
const save = async (uid: string, fn: string, obj: object) => (await rpc<{ id: string }>(uid, `select public.${fn}($1::jsonb) id`, [JSON.stringify(obj)]))[0].id;

beforeAll(async () => { db = await freshDb(); await rpc(A, `select public.slate_ensure_defaults()`); await rpc(B, `select public.slate_ensure_defaults()`); });

describe('mandates: save RPC, consultants, activity clock', () => {
  let m: string;
  it('creates company + mandate + consultants atomically and logs creation', async () => {
    m = await save(A, 'slate_save_mandate', { title: 'VP Procurement', company: 'ABC Company', location: 'Mumbai', reporting_to: 'CEO', budget: '80 lakhs', urgency: 'Critical', positions: 2, confidential: true, consultants: ['Michael Page', 'Elite Butlers'] });
    const row = (await rpc<Record<string, unknown>>(A, `select * from public.v_mandate_overview where id = $1`, [m]))[0];
    expect(row).toMatchObject({ title: 'VP Procurement', company_name: 'ABC Company', positions: 2, confidential: true, urgency: 'Critical' });
    expect(row.consultants).toEqual(['Elite Butlers', 'Michael Page']);
    expect(row.shared_count).toBe(2);
    expect(row.last_activity_at).toBeTruthy();
  });
  it('rejects an empty title and invalid urgency at the database', async () => {
    expect((await failure(rpc(A, `select public.slate_save_mandate('{"title":"  "}')`)))?.message).toMatch(/title is required/);
    expect(await failure(rpc(A, `select public.slate_save_mandate('{"title":"x","urgency":"Whenever"}')`))).not.toBeNull();
    expect(await failure(rpc(A, `select public.slate_save_mandate('{"title":"x","positions":0}')`))).not.toBeNull();
  });
  it('editing reconciles consultants (add/remove) and re-uses the company', async () => {
    await save(A, 'slate_save_mandate', { id: m, title: 'VP Procurement', company: 'abc company', consultants: ['Michael Page', 'Russell Reynolds'] });
    const row = (await rpc<Record<string, unknown>>(A, `select * from public.v_mandate_overview where id = $1`, [m]))[0];
    expect(row.consultants).toEqual(['Michael Page', 'Russell Reynolds']);
    expect((await q(db, `select 1 from public.companies where lower(name) = 'abc company'`)).length).toBe(1);
  });
  it('clock_started is logged once when the work start date is first entered', async () => {
    await save(A, 'slate_save_mandate', { id: m, title: 'VP Procurement', company: 'ABC Company', started_on: '2026-11-20' });
    await save(A, 'slate_save_mandate', { id: m, title: 'VP Procurement', company: 'ABC Company', started_on: '2026-11-21' });
    expect((await q(db, `select 1 from public.recruitment_activities where mandate_id = '${m}' and kind = 'clock_started'`)).length).toBe(1);
  });
  it('only meaningful events move last_activity_at (non-meaningful rows do not)', async () => {
    const before = (await q<{ t: string }>(db, `select last_activity_at t from public.mandates where id = '${m}'`))[0].t;
    await db.exec(`select public.slate_log_activity('${A}', '${m}', null, 'page_view', 'viewed', '{}', false, now() + interval '3 days')`);
    const after = (await q<{ t: string }>(db, `select last_activity_at t from public.mandates where id = '${m}'`))[0].t;
    expect(new Date(after).getTime()).toBe(new Date(before).getTime());
  });
  it('a cosmetic edit (notes) is not recorded as recruitment activity', async () => {
    const n = (await q<{ n: string }>(db, `select count(*) n from public.recruitment_activities where mandate_id = '${m}'`))[0].n;
    await save(A, 'slate_save_mandate', { id: m, title: 'VP Procurement', company: 'ABC Company', started_on: '2026-11-21', notes: 'typo fix' });
    expect((await q<{ n: string }>(db, `select count(*) n from public.recruitment_activities where mandate_id = '${m}'`))[0].n).toBe(n);
  });
  it('status change is logged', async () => {
    await as(db, A, () => db.query(`update public.mandates set status = 'on_hold' where id = $1`, [m]));
    expect((await q(db, `select 1 from public.recruitment_activities where mandate_id = '${m}' and kind = 'mandate_status_changed'`)).length).toBe(1);
  });
  it('another user cannot edit it through the RPC', async () => {
    expect((await failure(rpc(B, `select public.slate_save_mandate($1::jsonb)`, [JSON.stringify({ id: m, title: 'stolen' })])))?.message).toMatch(/not found/i);
  });
});

describe('candidates: lifecycle with history', () => {
  let m: string, c: string;
  beforeAll(async () => {
    m = await save(A, 'slate_save_mandate', { title: 'CFO', company: 'INFINX', location: 'Mumbai' });
    c = await save(A, 'slate_save_candidate', { name: 'Rahul Sharma', current_company: 'ABC Ltd', designation: 'VP Operations', current_location: 'Mumbai', current_ctc: '65 lakhs', expected_ctc: '80 lakhs', notice_period: '90 days', source: 'LinkedIn', open_to_relocate: true, mandate_id: m });
  });
  it('creates the person and the association with an initial history row + activity', async () => {
    expect((await q(db, `select 1 from public.candidate_mandates where candidate_id='${c}' and mandate_id='${m}' and stage='sourced' and status='active'`)).length).toBe(1);
    expect((await q(db, `select 1 from public.candidate_status_history where candidate_id='${c}' and from_stage is null and to_stage='sourced'`)).length).toBe(1);
    expect((await q(db, `select 1 from public.recruitment_activities where candidate_id='${c}' and kind='candidate_added'`)).length).toBe(1);
  });
  it('stage moves are recorded with previous/new stage, status, comment and time', async () => {
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'r1', null, 'Strong first round')`, [c, m]);
    const h = (await q<Record<string, unknown>>(db, `select * from public.candidate_status_history where candidate_id='${c}' order by changed_at desc, id limit 1`))[0];
    expect(h).toMatchObject({ from_stage: 'sourced', to_stage: 'r1', from_status: 'active', to_status: 'active', comment: 'Strong first round' });
    expect(h.changed_at).toBeTruthy();
    expect((await q(db, `select 1 from public.comments where candidate_id='${c}' and body='Strong first round'`)).length).toBe(1);
  });
  it('rejection requires a reason and is classified as a rejection', async () => {
    expect((await failure(rpc(A, `select public.slate_set_candidate_stage($1,$2,'rejected')`, [c, m])))?.message).toMatch(/reason is required/);
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'rejected','Client rejection','HM not convinced')`, [c, m]);
    const h = (await q<Record<string, unknown>>(db, `select * from public.candidate_status_history where candidate_id='${c}' and to_stage='rejected'`))[0];
    expect(h).toMatchObject({ reason_type: 'rejection', reason: 'Client rejection', comment: 'HM not convinced', from_stage: 'r1' });
  });
  it('reviving a candidate clears the closure but keeps every historical row', async () => {
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'r2')`, [c, m]);
    const cm = (await q<Record<string, unknown>>(db, `select * from public.candidate_mandates where candidate_id='${c}'`))[0];
    expect(cm).toMatchObject({ stage: 'r2', status: 'active', closed_reason: null });
    expect((await q(db, `select 1 from public.candidate_status_history where candidate_id='${c}'`)).length).toBeGreaterThanOrEqual(4);
  });
  it('dropping is a separate classification from rejection', async () => {
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'dropped','Accepted another offer')`, [c, m]);
    const h = (await q<Record<string, unknown>>(db, `select * from public.candidate_status_history where candidate_id='${c}' and to_stage='dropped'`))[0];
    expect(h).toMatchObject({ reason_type: 'drop', reason: 'Accepted another offer' });
  });
  it('direct table writes cannot skip the reason rule or the history', async () => {
    expect(await failure(as(db, A, () => db.query(`update public.candidate_mandates set status='rejected' where candidate_id=$1`, [c])))).not.toBeNull();
    const n = (await q<{ n: string }>(db, `select count(*) n from public.candidate_status_history where candidate_id='${c}'`))[0].n;
    await as(db, A, () => db.query(`update public.candidate_mandates set stage='hmfb', status='active' where candidate_id=$1`, [c]));
    expect(Number((await q<{ n: string }>(db, `select count(*) n from public.candidate_status_history where candidate_id='${c}'`))[0].n)).toBe(Number(n) + 1);
  });
  it('unknown stages are refused; joined/offered/selected set derived status + dates', async () => {
    expect(await failure(rpc(A, `select public.slate_set_candidate_stage($1,$2,'warp')`, [c, m]))).not.toBeNull();
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'selected')`, [c, m]);
    expect((await q<{ status: string; selected_at: string }>(db, `select status, selected_at from public.candidate_mandates where candidate_id='${c}'`))[0]).toMatchObject({ status: 'selected' });
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'offered',null,null,'2026-12-20','90 lakhs','confirmed')`, [c, m]);
    expect((await q<Record<string, unknown>>(db, `select status, offered_ctc, joining_status from public.candidate_mandates where candidate_id='${c}'`))[0]).toMatchObject({ status: 'offered', offered_ctc: '90 lakhs', joining_status: 'confirmed' });
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'joined')`, [c, m]);
    expect((await q<Record<string, unknown>>(db, `select status, joining_status from public.candidate_mandates where candidate_id='${c}'`))[0]).toMatchObject({ status: 'joined', joining_status: 'joined' });
  });
  it('a candidate can sit in more than one mandate; each pipeline is independent', async () => {
    const m2 = await save(A, 'slate_save_mandate', { title: 'COO', company: 'ISHARYA' });
    await save(A, 'slate_save_candidate', { id: c, name: 'Rahul Sharma', mandate_id: m2 });
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'contacted')`, [c, m2]);
    const rows = await q<{ mandate_id: string; stage: string }>(db, `select mandate_id, stage from public.candidate_mandates where candidate_id='${c}' order by stage`);
    expect(rows.map((r) => r.stage).sort()).toEqual(['contacted', 'joined']);
  });
  it('mandate overview counts reflect the pipeline', async () => {
    const r = (await rpc<Record<string, number>>(A, `select candidate_total, joined_count, rejected_count from public.v_mandate_overview where id = $1`, [m]))[0];
    expect(r).toMatchObject({ candidate_total: 1, joined_count: 1, rejected_count: 0 });
  });
  it('candidate comments keep their activity timestamp on the mandate clock', async () => {
    await as(db, A, () => db.query(`insert into public.comments (mandate_id, candidate_id, body) values ($1, $2, 'called him')`, [m, c]));
    expect((await q(db, `select 1 from public.recruitment_activities where mandate_id='${m}' and kind='comment_added'`)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('job description documents', () => {
  it('replacing a JD demotes the old one, keeps it as history, and logs both events', async () => {
    const m = await save(A, 'slate_save_mandate', { title: 'CHRO', company: 'MEPL' });
    const doc = (p: string) => as(db, A, () => db.query(`insert into public.mandate_documents (mandate_id, file_name, path, size, mime) values ($1, $2, $3, 1000, 'application/pdf')`, [m, p, `${A}/${m}/${p}`]));
    await doc('jd-v1.pdf'); await doc('jd-v2.pdf');
    const rows = await q<{ file_name: string; is_current: boolean; replaced_at: string | null }>(db, `select file_name, is_current, replaced_at from public.mandate_documents where mandate_id='${m}' order by created_at, file_name`);
    expect(rows.filter((r) => r.is_current).map((r) => r.file_name)).toEqual(['jd-v2.pdf']);
    expect(rows.find((r) => r.file_name === 'jd-v1.pdf')?.replaced_at).toBeTruthy();
    const kinds = (await q<{ kind: string }>(db, `select kind from public.recruitment_activities where mandate_id='${m}' and kind like 'document_%'`)).map((k) => k.kind).sort();
    expect(kinds).toEqual(['document_replaced', 'document_uploaded']);
    expect((await rpc<{ jd_file_name: string }>(A, `select jd_file_name from public.v_mandate_overview where id=$1`, [m]))[0].jd_file_name).toBe('jd-v2.pdf');
  });
  it('only PDF/Word files up to 10 MB are accepted', async () => {
    const m = (await q<{ id: string }>(db, `select id from public.mandates where title='CHRO'`))[0].id;
    expect(await failure(as(db, A, () => db.query(`insert into public.mandate_documents (mandate_id, file_name, path, size, mime) values ($1,'x.exe','p1',10,'application/x-msdownload')`, [m])))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`insert into public.mandate_documents (mandate_id, file_name, path, size, mime) values ($1,'big.pdf','p2',99999999,'application/pdf')`, [m])))).not.toBeNull();
  });
});

describe('talent pool search & funnel', () => {
  let m: string;
  beforeAll(async () => {
    m = await save(A, 'slate_save_mandate', { title: 'Head of Supply Chain', company: 'SyrmaSGS', location: 'Chennai' });
    for (const [n, co, d, loc, src] of [['Priya Menon', 'Tata Projects', 'Director Procurement', 'Chennai', 'Naukri'], ['Karan Malhotra', 'Godrej', 'VP Sourcing', 'Mumbai', 'LinkedIn'], ['Priyanka Das', 'Godrej', 'AVP', 'Pune', 'Naukri']]) {
      await save(A, 'slate_save_candidate', { name: n, current_company: co, designation: d, current_location: loc, source: src, mandate_id: m });
    }
  });
  const search = async (args: Record<string, unknown>) => {
    const r = await rpc<{ total: string; candidate: { name: string } }>(A, `select * from public.slate_search_candidates($1,$2,$3,$4,$5,$6,$7,$8)`,
      [args.q ?? null, args.mandate ?? null, args.status ?? null, args.stage ?? null, args.source ?? null, args.location ?? null, args.limit ?? 24, args.offset ?? 0]);
    return { total: r.length ? Number(r[0].total) : 0, names: r.map((x) => x.candidate.name).sort() };
  };
  it('matches partial text on name, company, designation and location', async () => {
    expect((await search({ q: 'priy' })).names).toEqual(['Priya Menon', 'Priyanka Das']);
    expect((await search({ q: 'godrej' })).names).toEqual(['Karan Malhotra', 'Priyanka Das']);
    expect((await search({ q: 'procure' })).names).toEqual(['Priya Menon']);
    expect((await search({ q: 'pune' })).names).toEqual(['Priyanka Das']);
  });
  it('matches by the associated mandate title/company, and ANDs multiple terms', async () => {
    expect((await search({ q: 'supply chain' })).total).toBeGreaterThanOrEqual(3);
    expect((await search({ q: 'syrma godrej' })).names).toEqual(['Karan Malhotra', 'Priyanka Das']);
    expect((await search({ q: 'nonexistent' })).total).toBe(0);
  });
  it('filters and paginates on real records', async () => {
    expect((await search({ source: 'naukri', mandate: m })).names).toEqual(['Priya Menon', 'Priyanka Das']);
    const p1 = await search({ q: 'a', limit: 2, offset: 0 });
    expect(p1.names).toHaveLength(2);
    expect(p1.total).toBeGreaterThan(2);
  });
  it('is isolated per user', async () => {
    const r = await as(db, B, async () => (await db.query(`select * from public.slate_search_candidates('priya')`)).rows);
    expect(r).toHaveLength(0);
  });
  it('funnel counts who reached each stage, not only who sits there now', async () => {
    const [c1, c2] = (await q<{ id: string }>(db, `select candidate_id id from public.candidate_mandates where mandate_id='${m}' order by created_at`)).map((r) => r.id);
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'r1')`, [c1, m]);
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'dropped','Candidate withdrew')`, [c1, m]);
    await rpc(A, `select public.slate_set_candidate_stage($1,$2,'shortlisted')`, [c2, m]);
    const f = await rpc<{ stage_key: string; reached: string; current_count: string }>(A, `select * from public.slate_funnel($1)`, [m]);
    const by = Object.fromEntries(f.map((x) => [x.stage_key, [Number(x.reached), Number(x.current_count)]]));
    expect(by.sourced[0]).toBe(3);
    expect(by.shortlisted).toEqual([2, 1]); // c1 reached it before dropping; c2 sits there
    expect(by.r1[0]).toBe(1);
    expect(by.joined[0]).toBe(0);
  });
});

describe('The Slate: tasks, sub-tasks, completion, calendar moves', () => {
  let t: string;
  const task = (o: object) => as(db, A, async () => (await db.query<{ id: string }>(`insert into public.slate_tasks (title, repeat, start_date, due_time, est_minutes, reminder_time, followup_minutes) select x->>'title', x->>'repeat', (x->>'start_date')::date, nullif(x->>'due_time','')::time, coalesce((x->>'est')::int, 30), nullif(x->>'rem','')::time, (x->>'fu')::int from (select $1::jsonb x) s returning id`, [JSON.stringify(o)])).rows[0].id);
  beforeAll(async () => { t = await task({ title: 'Complete INFINX mapping', repeat: 'once', start_date: '2026-12-01', due_time: '13:00', est: 30, rem: '12:45', fu: 30 }); });

  it('sub-tasks inherit the parent schedule and follow it when it changes', async () => {
    const c = await as(db, A, async () => (await db.query<{ id: string }>(`insert into public.slate_tasks (title, parent_id, repeat, start_date) values ('Identify companies', $1, 'daily', '2020-01-01') returning id`, [t])).rows[0].id);
    expect((await q<Record<string, unknown>>(db, `select repeat, start_date::text from public.slate_tasks where id='${c}'`))[0]).toMatchObject({ repeat: 'once', start_date: '2026-12-01' });
    await as(db, A, () => db.query(`update public.slate_tasks set start_date='2026-12-03' where id=$1`, [t]));
    expect((await q<{ start_date: string }>(db, `select start_date::text from public.slate_tasks where id='${c}'`))[0].start_date).toBe('2026-12-03');
    await as(db, A, () => db.query(`update public.slate_tasks set start_date='2026-12-01' where id=$1`, [t]));
  });
  it('rejects moving a task under its own descendant (cycle)', async () => {
    const child = (await q<{ id: string }>(db, `select id from public.slate_tasks where parent_id='${t}'`))[0].id;
    expect(await failure(as(db, A, () => db.query(`update public.slate_tasks set parent_id=$1 where id=$2`, [child, t])))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`update public.slate_tasks set parent_id=id where id=$1`, [t])))).not.toBeNull();
  });
  it('custom recurrence needs days; difficulty and duration are validated', async () => {
    expect(await failure(as(db, A, () => db.query(`insert into public.slate_tasks (title, repeat, start_date) values ('x','custom','2026-12-01')`)))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`insert into public.slate_tasks (title, repeat, start_date, difficulty) values ('x','once','2026-12-01','impossible')`)))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`insert into public.slate_tasks (title, repeat, start_date, est_minutes) values ('x','once','2026-12-01', 2)`)))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`insert into public.slate_tasks (title, repeat, start_date, rec_days) values ('ok','custom','2026-12-01', array[1,3]::smallint[])`)))).toBeNull();
  });
  it('stretching 1–3 PM stores 120 scheduled minutes and keeps the 30-minute estimate', async () => {
    await rpc(A, `select public.slate_move_task($1, '2026-12-01', '2026-12-01', '13:00', 120, 'this')`, [t]);
    expect((await q<Record<string, unknown>>(db, `select est_minutes, sched_minutes, due_time::text from public.slate_tasks where id='${t}'`))[0]).toMatchObject({ est_minutes: 30, sched_minutes: 120, due_time: '13:00:00' });
  });
  it('moving a one-time task to another day/time shifts its reminder by the same amount', async () => {
    await rpc(A, `select public.slate_move_task($1, '2026-12-01', '2026-12-02', '15:00', 60, 'this')`, [t]);
    expect((await q<Record<string, unknown>>(db, `select start_date::text, due_time::text, reminder_time::text, est_minutes from public.slate_tasks where id='${t}'`))[0])
      .toMatchObject({ start_date: '2026-12-02', due_time: '15:00:00', reminder_time: '14:45:00', est_minutes: 30 });
  });
  it('moving one occurrence of a recurring task leaves the series untouched', async () => {
    const r = await task({ title: 'Daily pipeline review', repeat: 'daily', start_date: '2026-12-01', due_time: '10:00', est: 30 });
    await rpc(A, `select public.slate_move_task($1, '2026-12-05', '2026-12-06', '16:00', 90, 'this')`, [r]);
    expect((await q<Record<string, unknown>>(db, `select day::text, new_day::text, start_time::text, sched_minutes from public.slate_overrides where task_id='${r}'`))[0])
      .toMatchObject({ day: '2026-12-05', new_day: '2026-12-06', start_time: '16:00:00', sched_minutes: 90 });
    expect((await q<Record<string, unknown>>(db, `select due_time::text, start_date::text, sched_minutes from public.slate_tasks where id='${r}'`))[0]).toMatchObject({ due_time: '10:00:00', start_date: '2026-12-01', sched_minutes: null });
    await rpc(A, `select public.slate_move_task($1, '2026-12-05', '2026-12-05', '10:00', 30, 'this')`, [r]); // back to original -> override removed
    expect((await q(db, `select 1 from public.slate_overrides where task_id='${r}'`)).length).toBe(0);
    await rpc(A, `select public.slate_move_task($1, '2026-12-05', '2026-12-05', '11:30', 45, 'series')`, [r]);
    expect((await q<Record<string, unknown>>(db, `select due_time::text, sched_minutes from public.slate_tasks where id='${r}'`))[0]).toMatchObject({ due_time: '11:30:00', sched_minutes: 45 });
  });
  it('rejects durations outside 5–1440 minutes', async () => {
    expect(await failure(rpc(A, `select public.slate_move_task($1,'2026-12-02','2026-12-02','10:00',3,'this')`, [t]))).not.toBeNull();
  });
  it('completion keeps its record when reopened and can be completed again', async () => {
    await rpc(A, `select public.slate_set_task_done($1,'2026-12-02',true)`, [t]);
    await rpc(A, `select public.slate_set_task_done($1,'2026-12-02',false)`, [t]);
    let row = (await q<{ undone_at: string | null }>(db, `select undone_at from public.slate_done where task_id='${t}' and day='2026-12-02'`));
    expect(row).toHaveLength(1);
    expect(row[0].undone_at).toBeTruthy();
    await rpc(A, `select public.slate_set_task_done($1,'2026-12-02',true)`, [t]);
    row = await q(db, `select undone_at from public.slate_done where task_id='${t}' and day='2026-12-02'`);
    expect(row[0].undone_at).toBeNull();
  });
  it("one user's tasks are invisible to another", async () => {
    expect((await as(db, B, async () => (await db.query(`select * from public.slate_tasks`)).rows)).length).toBe(0);
    expect((await failure(as(db, B, () => db.query(`select public.slate_move_task($1,'2026-12-02','2026-12-02','10:00',30,'this')`, [t]))))?.message).toMatch(/not found/i);
  });
});

describe('audit trail, SOP and notifications', () => {
  it('records who changed what, as a diff, and never lists noise columns', async () => {
    const m = await save(A, 'slate_save_mandate', { title: 'Audit me', company: 'ACME' });
    await save(A, 'slate_save_mandate', { id: m, title: 'Audit me v2', company: 'ACME' });
    const rows = await rpc<{ action: string; changes: Record<string, { old: unknown; new: unknown }> }>(A, `select action, changes from public.audit_log where table_name='mandates' and row_id=$1 and action='UPDATE' order by id`, [m]);
    expect(rows.some((r) => r.changes.title?.new === 'Audit me v2' && r.changes.title?.old === 'Audit me')).toBe(true);
    expect(rows.every((r) => !('updated_at' in r.changes))).toBe(true);
  });
  it('SOP is created on demand and keeps revisions, capped', async () => {
    const d = (await rpc<{ id: string }>(A, `select * from public.slate_ensure_sop()`))[0];
    await as(db, A, () => db.query(`update public.sop_documents set body = 'first draft' where id = $1`, [d.id]));
    await as(db, A, () => db.query(`update public.sop_documents set body = 'second draft' where id = $1`, [d.id]));
    const revs = await rpc<{ body: string }>(A, `select body from public.sop_revisions where sop_id = $1`, [d.id]);
    expect(revs.length).toBe(1);
    expect(revs[0].body).toBe(''); // snapshot of the content before the first edit; edits within 10 minutes collapse
    expect((await rpc(A, `select * from public.slate_ensure_sop()`)).length).toBe(1); // idempotent
  });
  it('the dedupe ledger works as an ON CONFLICT arbiter (what the reminder job and the in-app watcher actually do)', async () => {
    const ins = () => as(db, A, async () => (await db.query(`insert into public.notifications (kind, title, dedupe_key) values ('task_reminder', 'x', 'task:9:2026-12-01:primary') on conflict (user_id, dedupe_key) do nothing returning id`)).rows);
    expect(await ins()).toHaveLength(1); expect(await ins()).toHaveLength(0); // second attempt is silently ignored, nothing returned -> "already announced"
    await as(db, A, () => db.query(`insert into public.notifications (kind, title) values ('system', 'a'), ('system', 'b')`)); // rows without a key are never de-duplicated
  });
  it('notification de-duplication ledger prevents double sends', async () => {
    await as(db, A, () => db.query(`insert into public.notifications (kind, title, dedupe_key) values ('task_reminder', 'x', 'task:1:2026-12-01')`));
    expect(await failure(as(db, A, () => db.query(`insert into public.notifications (kind, title, dedupe_key) values ('task_reminder', 'x', 'task:1:2026-12-01')`)))).not.toBeNull();
  });
});
