import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, addUsers, as, asAnon, bareDb, failure, freshDb, migrationFiles, migrationSql, q } from './harness';

describe('migrations replay from zero', () => {
  it('applies every migration to an empty database without error', async () => {
    const db = await freshDb();
    const tables = await q<{ t: string }>(db, `select tablename t from pg_tables where schemaname='public' order by 1`);
    const names = tables.map((r) => r.t);
    for (const t of ['mandates', 'candidates', 'candidate_mandates', 'candidate_status_history', 'recruitment_activities', 'companies', 'agencies',
      'mandate_agencies', 'mandate_documents', 'config_options', 'slate_tasks', 'slate_done', 'slate_overrides', 'notifications', 'sop_documents',
      'sop_revisions', 'audit_log', 'backup_runs']) expect(names).toContain(t);
  });
  it('every public table has row level security enabled', async () => {
    const db = await freshDb();
    const rows = await q<{ relname: string }>(db, `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
  it('migration files are ordered and unique', () => {
    const f = migrationFiles();
    expect(f).toEqual([...f].sort());
    expect(new Set(f).size).toBe(f.length);
  });
  it('API roles hold no TRUNCATE/REFERENCES/TRIGGER privileges and cannot touch the sign-up whitelist', async () => {
    const db = await freshDb();
    const bad = await q<{ table_name: string; privilege_type: string }>(db, `select table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')`);
    expect(bad).toEqual([]);
    expect(await q(db, `select 1 from information_schema.role_table_grants where table_name='allowed_emails' and grantee in ('anon','authenticated')`)).toEqual([]);
    expect(await failure(as(db, A, () => db.query(`select * from public.allowed_emails`)))).not.toBeNull();
  });
  it('sign-up whitelist still blocks unknown emails', async () => {
    const db = await freshDb();
    const err = await failure(db.exec(`insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'stranger@example.test')`));
    expect(err?.message).toMatch(/restricted/i);
  });
});

describe('upgrade path: legacy Hiring Copilot data survives and is back-filled', () => {
  let db: PGlite;
  const M1 = 'aaaaaaaa-0000-4000-8000-000000000001', M2 = 'aaaaaaaa-0000-4000-8000-000000000002';
  const C1 = 'bbbbbbbb-0000-4000-8000-000000000001', C2 = 'bbbbbbbb-0000-4000-8000-000000000002', C3 = 'bbbbbbbb-0000-4000-8000-000000000003';
  const T1 = 'cccccccc-0000-4000-8000-000000000001';
  let before: Record<string, number>;
  beforeAll(async () => {
    db = await bareDb();
    const files = migrationFiles();
    await db.exec(migrationSql(files[0])); // baseline only
    await addUsers(db);
    await db.exec(`
      insert into public.mandates (id, user_id, title, company, level, urgency, status, started_on, target_close, agencies, agency_shared, agency_shared_at, created_at, updated_at, work_mode)
        values ('${M1}', '${A}', 'CFO', 'INFINX', 'CXO / C-suite', 'Critical', 'active', '2026-11-01', '2026-12-15', array['Michael Page','Russell Reynolds'], true, '2026-11-03T10:00:00Z', '2026-11-01T05:00:00Z', '2026-11-02T06:30:00Z', 'Hybrid'),
               ('${M2}', '${A}', 'VP Ops', 'infinx ', 'SVP / VP', 'Low', 'closed', null, null, '{}', false, null, '2026-10-20T05:00:00Z', '2026-10-21T05:00:00Z', null);
      insert into public.candidates (id, user_id, mandate_id, name, status, stage, source, rounds, status_log, created_at, joining_date)
        values ('${C1}', '${A}', '${M1}', 'Asha Rao', 'active', 'r2', 'LinkedIn', '[{"round":"Round 1","status":"cleared"}]', '[{"at":"2026-11-05T05:00:00Z","stage":"contacted","note":"first call","label":"Contacted"},{"at":"2026-11-08T05:00:00Z","stage":"r2","note":"","label":"R2"}]', '2026-11-04T05:00:00Z', null),
               ('${C2}', '${A}', '${M1}', 'Vikram Shah', 'offered', null, 'Naukri', '[]', '[]', '2026-11-06T05:00:00Z', '2026-12-20'),
               ('${C3}', '${A}', '${M2}', 'Neha Iyer', 'joined', 'joined', 'Agency', '[]', '[{"at":"2026-11-02T05:00:00Z","stage":"joined","note":"","label":"Joined"}]', '2026-10-21T05:00:00Z', '2026-11-02');
      insert into public.comments (user_id, mandate_id, candidate_id, body, created_at) values ('${A}', '${M1}', '${C1}', 'good fit', '2026-11-09T05:00:00Z');
      insert into public.steps (user_id, scope, mandate_id, seq, phase, title, status, completed_at) values ('${A}', 'mandate', '${M1}', 1, 'Intake', 'Kickoff', 'done', '2026-11-02T05:00:00Z'), ('${A}', 'mandate', '${M1}', 2, 'Intake', 'JD', 'waiting', null);
      insert into public.slate_tasks (id, user_id, title, repeat, start_date, due_time) values ('${T1}', '${A}', 'Call HM', 'daily', '2026-11-01', '15:30'), (gen_random_uuid(), '${A}', 'No time', 'once', '2026-11-02', null);
      insert into public.slate_done (user_id, task_id, day) values ('${A}', '${T1}', '2026-11-02');
    `);
    before = {};
    for (const t of ['mandates', 'candidates', 'steps', 'comments', 'slate_tasks', 'slate_done']) before[t] = (await q<{ n: string }>(db, `select count(*) n from public.${t}`))[0].n as unknown as number;
    for (const f of files.slice(1)) await db.exec(migrationSql(f));
  });

  it('loses no legacy rows', async () => {
    for (const t of Object.keys(before)) expect(Number((await q<{ n: string }>(db, `select count(*) n from public.${t}`))[0].n)).toBe(Number(before[t]));
  });
  it('companies are de-duplicated case/space-insensitively and linked', async () => {
    const c = await q(db, `select name from public.companies order by name`);
    expect(c).toHaveLength(1);
    const m = await q<{ company_id: string | null }>(db, `select company_id from public.mandates`);
    expect(m.every((r) => r.company_id)).toBe(true);
  });
  it('agencies and mandate_agencies are back-filled with shared_at', async () => {
    const a = await q<{ name: string }>(db, `select name from public.agencies order by name`);
    expect(a.map((r) => r.name)).toEqual(['Michael Page', 'Russell Reynolds']);
    const ma = await q<{ shared_at: string | null }>(db, `select shared_at from public.mandate_agencies where mandate_id = '${M1}'`);
    expect(ma).toHaveLength(2);
    expect(ma.every((r) => r.shared_at)).toBe(true);
  });
  it('candidate-mandate associations carry stage/status correctly', async () => {
    const r = await q<{ name: string; stage: string; status: string; joining_status: string | null }>(db,
      `select c.name, cm.stage, cm.status, cm.joining_status from public.candidate_mandates cm join public.candidates c on c.id = cm.candidate_id order by c.name`);
    expect(r).toEqual([
      { name: 'Asha Rao', stage: 'r2', status: 'active', joining_status: null },
      { name: 'Neha Iyer', stage: 'joined', status: 'joined', joining_status: 'joined' },
      { name: 'Vikram Shah', stage: 'offered', status: 'offered', joining_status: 'expected' },
    ]);
  });
  it('status history is rebuilt from the old status_log, with previous stage', async () => {
    const h = await q<{ from_stage: string | null; to_stage: string }>(db,
      `select from_stage, to_stage from public.candidate_status_history where candidate_id = '${C1}' order by changed_at`);
    expect(h).toEqual([{ from_stage: null, to_stage: 'contacted' }, { from_stage: 'contacted', to_stage: 'r2' }]);
    const imported = await q(db, `select 1 from public.candidate_status_history where candidate_id = '${C2}' and comment = 'Imported from Hiring Copilot'`);
    expect(imported).toHaveLength(1);
  });
  it('activity history and last_activity_at reflect real past work', async () => {
    const m = await q<{ last_activity_at: string }>(db, `select last_activity_at from public.mandates where id = '${M1}'`);
    expect(new Date(m[0].last_activity_at).toISOString()).toBe('2026-11-09T05:00:00.000Z'); // the comment is the latest meaningful event
    const kinds = await q<{ kind: string }>(db, `select distinct kind from public.recruitment_activities where mandate_id = '${M1}'`);
    expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(['mandate_created', 'clock_started', 'candidate_added', 'comment_added', 'step_status_changed']));
  });
  it('legacy updated_at / created_at timestamps are not rewritten by the back-fill', async () => {
    const r = await q<{ updated_at: string }>(db, `select updated_at from public.mandates where id = '${M1}'`);
    expect(new Date(r[0].updated_at).toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
  it('legacy nudge behaviour is preserved as explicit reminder fields', async () => {
    const t = await q<{ reminder_time: string | null; followup_minutes: number | null; title: string }>(db, `select title, reminder_time, followup_minutes from public.slate_tasks order by title`);
    expect(t.find((x) => x.title === 'Call HM')).toMatchObject({ reminder_time: '15:30:00', followup_minutes: 60 });
    expect(t.find((x) => x.title === 'No time')).toMatchObject({ reminder_time: null, followup_minutes: null });
  });
  it('legacy `company` text stays in sync and legacy writers still work', async () => {
    const id = 'dddddddd-0000-4000-8000-000000000001';
    await db.exec(`insert into public.mandates (id, user_id, title, company) values ('${id}', '${A}', 'Old-app mandate', 'Brand New Co')`);
    const m = await q<{ company_id: string }>(db, `select company_id from public.mandates where id = '${id}'`);
    expect(m[0].company_id).toBeTruthy();
    expect(await q(db, `select 1 from public.companies where name = 'Brand New Co'`)).toHaveLength(1);
  });
  it('seeds default configuration, including levels already used by mandates', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${A}', false)`);
    const stages = await q(db, `select 1 from public.config_options where user_id = '${A}' and kind = 'pipeline_stage'`);
    expect(stages.length).toBe(18);
    const lv = await q<{ label: string }>(db, `select label from public.config_options where user_id = '${A}' and kind = 'hiring_level' order by sort_order`);
    expect(lv.map((x) => x.label)).toEqual(expect.arrayContaining(['CXO / C-suite', 'SVP / VP']));
  });
});

describe('row level security', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await as(db, A, async () => {
      await db.query(`select public.slate_ensure_defaults()`);
      await db.query(`select public.slate_save_mandate($1::jsonb)`, [JSON.stringify({ title: 'Secret role', company: 'ACME', consultants: ['Agency X'] })]);
      await db.query(`select public.slate_save_candidate($1::jsonb)`, [JSON.stringify({ name: 'Private Person', phone: '999', current_ctc: '1 cr' })]);
    });
  });
  const tables = ['mandates', 'candidates', 'companies', 'agencies', 'mandate_agencies', 'recruitment_activities', 'config_options', 'audit_log'];
  it('another user sees none of the owner rows', async () => {
    for (const t of tables) {
      const own = await as(db, A, async () => (await db.query(`select count(*)::int n from public.${t}`)).rows[0] as { n: number });
      const other = await as(db, B, async () => (await db.query(`select count(*)::int n from public.${t}`)).rows[0] as { n: number });
      expect(own.n, t).toBeGreaterThan(0);
      expect(other.n, t).toBe(0);
    }
  });
  it('anon cannot read anything', async () => {
    for (const t of [...tables, 'candidate_mandates', 'slate_tasks', 'notifications']) {
      expect(await failure(asAnon(db, () => db.query(`select * from public.${t}`))), t).not.toBeNull();
    }
  });
  it('another user cannot update or delete owner rows', async () => {
    const r = await as(db, B, async () => db.query(`update public.mandates set title = 'hacked' returning id`));
    expect(r.rows).toHaveLength(0);
    const d = await as(db, B, async () => db.query(`delete from public.candidates returning id`));
    expect(d.rows).toHaveLength(0);
  });
  it('history, activity and audit tables are read-only for users', async () => {
    for (const t of ['candidate_status_history', 'recruitment_activities', 'audit_log', 'sop_revisions']) {
      expect(await failure(as(db, A, () => db.query(`delete from public.${t}`))), 'delete ' + t).not.toBeNull();
      expect(await failure(as(db, A, () => db.query(`update public.${t} set user_id = user_id`))), 'update ' + t).not.toBeNull();
    }
    expect(await failure(as(db, A, () => db.query(`insert into public.recruitment_activities (user_id, kind) values ('${A}', 'fake')`)))).not.toBeNull();
  });
  it('anon may call only the health probe', async () => {
    const h = await asAnon(db, () => db.query(`select public.slate_health() h`));
    expect((h.rows[0] as { h: { ok: boolean } }).h.ok).toBe(true);
    expect(await failure(asAnon(db, () => db.query(`select public.slate_save_mandate('{"title":"x"}')`)))).not.toBeNull();
    expect(await failure(as(db, A, () => db.query(`select public.slate_log_activity('${A}', null, null, 'x', 'x')`)))).not.toBeNull();
  });
});
