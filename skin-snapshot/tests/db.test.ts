import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ADMIN, COSMO, NOBODY, asAnon, asClaims, failure, freshDb, seedCase, seedStaff, staff } from './db-harness';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await seedStaff(db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

const admin = () => staff(ADMIN, 'admin@example.test');
const cosmo = () => staff(COSMO, 'cosmo@example.test');
const q = <T = any>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);

describe('migrations', () => {
  it('create the expected tables, all with row-level security enabled', async () => {
    const { rows } = await q<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname='ss'`);
    expect(rows.length).toBeGreaterThanOrEqual(17);
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });
  it('seed sample routine templates, none approved', async () => {
    const { rows } = await q(`select count(*)::int as n, bool_or(approved) as any_approved, bool_and(sample) as all_sample from ss.routine_templates`);
    expect(rows[0].n).toBe(12);
    expect(rows[0].any_approved).toBe(false);
    expect(rows[0].all_sample).toBe(true);
  });
});

describe('visitor and anonymous roles have no direct data access', () => {
  it('anon cannot read or write any table', async () => {
    const c = await seedCase(db, { booked: true });
    for (const t of ['cases', 'photos', 'objects', 'bookings', 'consents', 'analyses', 'access_log', 'staff', 'case_notes', 'events']) {
      expect(await failure(asAnon(db, () => q(`select * from ss.${t}`))), t).toMatch(/permission denied/);
    }
    expect(await failure(asAnon(db, () => q(`insert into ss.events (name) values ('x')`)))).toMatch(/permission denied/);
    expect(await failure(asAnon(db, () => q(`select ss.console_list_cases()`)))).toMatch(/permission denied/);
    expect(c.id).toBeTruthy();
  });
  it('a signed-in role without a staff row is forbidden everywhere', async () => {
    const c = await seedCase(db, { booked: true });
    const who = staff(NOBODY, 'x@example.test');
    expect(await failure(asClaims(db, who, () => q(`select ss.console_list_cases()`)))).toMatch(/forbidden/);
    expect(await failure(asClaims(db, who, () => q(`select ss.console_open_case($1)`, [c.id])))).toMatch(/forbidden/);
    expect(await failure(asClaims(db, who, () => q(`select * from ss.cases`)))).toMatch(/permission denied/);
    expect(await failure(asClaims(db, null, () => q(`select ss.console_me()`)))).toMatch(/forbidden/);
  });
  it('a staff member without two-step verification (aal1) is forbidden', async () => {
    const c = await seedCase(db, { booked: true });
    const weak = staff(COSMO, 'cosmo@example.test', 'aal1');
    expect(await failure(asClaims(db, weak, () => q(`select ss.console_list_cases()`)))).toMatch(/forbidden/);
    expect(await failure(asClaims(db, weak, () => q(`select ss.console_open_case($1)`, [c.id])))).toMatch(/forbidden/);
  });
  it('an inactive staff member is forbidden', async () => {
    await q(`update ss.staff set active=false where user_id=$1`, [COSMO]);
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_me()`)))).toMatch(/forbidden/);
    await q(`update ss.staff set active=true where user_id=$1`, [COSMO]);
  });
  it('even a staff session cannot read the sensitive tables directly, only through the logged functions', async () => {
    for (const t of ['cases', 'photos', 'objects', 'bookings', 'analyses', 'consents', 'case_notes', 'access_log']) {
      expect(await failure(asClaims(db, admin(), () => q(`select * from ss.${t}`))), t).toMatch(/permission denied/);
    }
  });
});

describe('role-based access inside the console', () => {
  it('cosmetologist can open cases but cannot read the access log, staff list or change settings', async () => {
    expect(await asClaims(db, cosmo(), async () => (await q(`select ss.console_me() as me`)).rows[0].me.role)).toBe('cosmetologist');
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_access_log()`)))).toMatch(/forbidden/);
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_staff()`)))).toMatch(/forbidden/);
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_set_setting('x','1'::jsonb)`)))).toMatch(/forbidden/);
  });
  it('admin can read the access log, staff list and settings', async () => {
    expect(await failure(asClaims(db, admin(), () => q(`select ss.console_access_log()`)))).toBeNull();
    expect(await failure(asClaims(db, admin(), () => q(`select ss.console_staff()`)))).toBeNull();
    expect(await failure(asClaims(db, admin(), () => q(`select ss.console_set_setting('service_promise','"within a day"'::jsonb)`)))).toBeNull();
  });
});

describe('case visibility and the access log', () => {
  it('opening a booked case returns details and writes an access-log row in the same transaction', async () => {
    const c = await seedCase(db, { booked: true });
    const before = (await q(`select count(*)::int n from ss.access_log where case_id=$1`, [c.id])).rows[0].n;
    const out = await asClaims(db, cosmo(), async () => (await q(`select ss.console_open_case($1) as c`, [c.id])).rows[0].c);
    expect(out.details_visible).toBe(true);
    expect(out.answers.budget).toBe('b500_1500');
    expect(out.photos).toHaveLength(1);
    expect(out.booking.whatsapp_hash).toBeUndefined();
    const log = (await q(`select actor_email, action, case_code from ss.access_log where case_id=$1 order by id desc`, [c.id])).rows;
    expect(log.length).toBe(before + 1);
    expect(log[0]).toMatchObject({ actor_email: 'cosmo@example.test', action: 'open_case', case_code: c.code });
  });
  it('a flagged case that never booked shows metadata only (no answers, photos or analysis)', async () => {
    const c = await seedCase(db, { flagged: true });
    const out = await asClaims(db, cosmo(), async () => (await q(`select ss.console_open_case($1) as c`, [c.id])).rows[0].c);
    expect(out.flagged).toBe(true);
    expect(out.flags[0].code).toBe('changing_mole');
    expect(out.details_visible).toBe(false);
    expect(out.answers).toBeUndefined();
    expect(out.photos).toBeUndefined();
    expect(out.analysis).toBeUndefined();
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_export_case($1)`, [c.id])))).toMatch(/forbidden/);
  });
  it('withdrawing WhatsApp consent hides photos and answers from the console', async () => {
    const c = await seedCase(db, { booked: true });
    await q(`update ss.consents set withdrawn_at=now() where case_id=$1 and key='whatsapp'`, [c.id]);
    const out = await asClaims(db, cosmo(), async () => (await q(`select ss.console_open_case($1) as c`, [c.id])).rows[0].c);
    expect(out.details_visible).toBe(false);
    expect(out.photos).toBeUndefined();
  });
  it('access log is append-only, even for the application role', async () => {
    expect(await failure(q(`update ss.access_log set action='x'`))).toMatch(/append-only/);
    expect(await failure(q(`delete from ss.access_log`))).toMatch(/append-only/);
  });
  it('the queue lists newest booking first, supports filters, and hides personal fields of unbooked flagged cases', async () => {
    const a = await seedCase(db, { booked: true });
    await new Promise((r) => setTimeout(r, 15));
    const b = await seedCase(db, { booked: true });
    const f = await seedCase(db, { flagged: true });
    const list = await asClaims(db, cosmo(), async () => (await q(`select ss.console_list_cases() as l`)).rows[0].l);
    const codes = list.map((x: any) => x.code);
    expect(codes.indexOf(b.code)).toBeLessThan(codes.indexOf(a.code));
    const flagged = list.find((x: any) => x.code === f.code);
    expect(flagged.flagged).toBe(true);
    expect(flagged.first_name).toBeNull();
    const onlyFlagged = await asClaims(db, cosmo(), async () => (await q(`select ss.console_list_cases(null, null, true) as l`)).rows[0].l);
    expect(onlyFlagged.every((x: any) => x.flagged)).toBe(true);
    const requested = await asClaims(db, cosmo(), async () => (await q(`select ss.console_list_cases(null, 'requested') as l`)).rows[0].l);
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((x: any) => x.booking_status === 'requested')).toBe(true);
  });
});

describe('status, notes, feedback, templates, deletion', () => {
  it('moves through all six statuses; closing sets the retention deadline, reopening clears it', async () => {
    const c = await seedCase(db, { booked: true });
    for (const s of ['contacted', 'scheduled', 'completed', 'no_response', 'requested']) {
      await asClaims(db, cosmo(), () => q(`select ss.console_set_status($1,$2)`, [c.id, s]));
      expect((await q(`select status from ss.bookings where case_id=$1`, [c.id])).rows[0].status).toBe(s);
    }
    expect((await q(`select contacted_at is not null as t from ss.bookings where case_id=$1`, [c.id])).rows[0].t).toBe(true);
    await asClaims(db, cosmo(), () => q(`select ss.console_set_status($1,'closed',90)`, [c.id]));
    const k = (await q(`select closed_at, expires_at from ss.cases where id=$1`, [c.id])).rows[0];
    expect(k.closed_at).toBeTruthy();
    expect(new Date(k.expires_at).getTime() - new Date(k.closed_at).getTime()).toBeGreaterThan(89 * 864e5);
    await asClaims(db, cosmo(), () => q(`select ss.console_set_status($1,'contacted')`, [c.id]));
    expect((await q(`select expires_at from ss.cases where id=$1`, [c.id])).rows[0].expires_at).toBeNull();
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_set_status($1,'bogus')`, [c.id])))).toMatch(/bad_status/);
  });
  it('notes are private to staff and logged', async () => {
    const c = await seedCase(db, { booked: true });
    await asClaims(db, cosmo(), () => q(`select ss.console_add_note($1,'Prefers evening calls')`, [c.id]));
    const out = await asClaims(db, admin(), async () => (await q(`select ss.console_open_case($1) as c`, [c.id])).rows[0].c);
    expect(out.notes[0].body).toBe('Prefers evening calls');
    expect(await failure(asClaims(db, cosmo(), () => q(`select ss.console_add_note($1,'')`, [c.id])))).toBeTruthy();
  });
  it('AI feedback is one verdict per reviewer per observation and can be changed', async () => {
    const c = await seedCase(db, { booked: true });
    const aid = (await q(`select id from ss.analyses where case_id=$1`, [c.id])).rows[0].id;
    await asClaims(db, cosmo(), () => q(`select ss.console_feedback($1,$2,'observation','cheeks','redness','agree')`, [c.id, aid]));
    await asClaims(db, cosmo(), () => q(`select ss.console_feedback($1,$2,'observation','cheeks','redness','disagree')`, [c.id, aid]));
    const rows = (await q(`select verdict from ss.ai_feedback where case_id=$1`, [c.id])).rows;
    expect(rows).toEqual([{ verdict: 'disagree' }]);
    await asClaims(db, cosmo(), () => q(`select ss.console_feedback($1,null,'missed_flag',null,null,'disagree','mole not caught')`, [c.id]));
    await asClaims(db, cosmo(), () => q(`select ss.console_feedback($1,null,'missed_flag',null,null,'disagree','again')`, [c.id]));
    expect((await q(`select count(*)::int n from ss.ai_feedback where case_id=$1 and kind='missed_flag'`, [c.id])).rows[0].n).toBe(1);
  });
  it('routine templates: staff can read directly under RLS; approval stamps the approver; samples stop being samples once approved', async () => {
    const rows = await asClaims(db, cosmo(), async () => (await q(`select id, sample from ss.routine_templates limit 1`)).rows);
    expect(rows).toHaveLength(1);
    expect(await failure(asAnon(db, () => q(`select * from ss.routine_templates`)))).toMatch(/permission denied/);
    const id = rows[0].id;
    await asClaims(db, cosmo(), () => q(`select ss.console_save_template($1,'Dry, 2 steps',2,'dry','low','{}',$2::jsonb,true)`, [id, JSON.stringify([{ category: 'cleanser', text_en: 'x', text_hi: 'y' }])]));
    const t = (await q(`select approved, sample, approved_by from ss.routine_templates where id=$1`, [id])).rows[0];
    expect(t).toMatchObject({ approved: true, sample: false, approved_by: COSMO });
    expect(await failure(asClaims(db, cosmo(), () => q(`insert into ss.routine_templates (name, steps, items) values ('x',2,'[]')`)))).toMatch(/permission denied/);
  });
  it('deleting a case removes everything, queues object removal, and leaves a ledger row and an audit row', async () => {
    const c = await seedCase(db, { booked: true });
    await asClaims(db, cosmo(), () => q(`select ss.console_delete_case($1)`, [c.id]));
    for (const t of ['cases', 'photos', 'bookings', 'consents', 'analyses', 'case_notes']) {
      const col = t === 'cases' ? 'id' : 'case_id';
      expect((await q(`select count(*)::int n from ss.${t} where ${col}=$1`, [c.id])).rows[0].n, t).toBe(0);
    }
    expect((await q(`select count(*)::int n from ss.storage_deletions where key=$1`, [`cases/${c.id}/front.jpg`])).rows[0].n).toBe(1);
    expect((await q(`select reason from ss.deletion_ledger where case_id=$1`, [c.id])).rows[0].reason).toBe('staff_request');
    expect((await q(`select count(*)::int n from ss.access_log where case_id=$1 and action='delete_case'`, [c.id])).rows[0].n).toBe(1);
  });
});

describe('analytics counts', () => {
  it('computes the proposed success measures from events', async () => {
    const ev = async (s: string, name: string, at: string) => q(`insert into ss.events (session_id, name, at) values ($1,$2,$3::timestamptz)`, [s, name, at]);
    const now = new Date();
    const t = (sec: number) => new Date(now.getTime() - 3600_000 + sec * 1000).toISOString();
    await ev('s1', 'page_view', t(0)); await ev('s1', 'camera_started', t(10)); await ev('s1', 'photos_completed', t(100)); await ev('s1', 'snapshot_ready', t(130)); await ev('s1', 'snapshot_viewed', t(131)); await ev('s1', 'booking_requested', t(200));
    await ev('s2', 'page_view', t(0)); await ev('s2', 'camera_started', t(10)); await ev('s2', 'photos_completed', t(100)); await ev('s2', 'snapshot_ready', t(190)); await ev('s2', 'snapshot_viewed', t(191));
    await ev('s3', 'page_view', t(0)); await ev('s3', 'camera_started', t(10));
    await ev('s4', 'safety_stop', t(20));
    const out = await asClaims(db, admin(), async () => (await q(`select ss.console_counts(4) as c`)).rows[0].c);
    expect(out.measures.camera_sessions).toBe(3);
    expect(out.measures.camera_to_snapshot).toBe(2);
    expect(Number(out.measures.camera_to_snapshot_pct)).toBeCloseTo(66.7, 1);
    expect(Number(out.measures.snapshot_to_booking_pct)).toBeCloseTo(50, 1);
    expect(Number(out.measures.time_to_snapshot_p50_s)).toBeCloseTo(60, 0);
    expect(out.measures.safety_leaks).toBe(0);
    const funnel = Object.fromEntries(out.measures.funnel.map((f: any) => [f.step, f.sessions]));
    expect(funnel.camera_started).toBe(3);
    expect(funnel.snapshot_ready).toBe(2);
    expect(funnel.booking_requested).toBe(1);
    const gap = out.measures.stage_seconds.find((g: any) => g.from === 'photos_completed' && g.to === 'snapshot_ready');
    expect(Number(gap.median_s)).toBeCloseTo(60, 0);
    expect(out.weeks[0].flags).toBeGreaterThanOrEqual(1);
    await ev('s4', 'routine_shown', t(30));
    const out2 = await asClaims(db, admin(), async () => (await q(`select ss.console_counts(4) as c`)).rows[0].c);
    expect(out2.measures.safety_leaks).toBe(1);
  });
});
