import { beforeEach, describe, expect, it } from 'vitest';
import { configureRuntime } from './runtime';
import { db, resetDb, tbl } from './db';
import { seedLibrary } from './repo/exercises';
import { createProgram } from './repo/programs';
import * as S from './repo/sessions';
import { routineV6Program, routineV6Tree } from './seed/routineV6';
import { BackupFormatError, createSnapshot, exportBackup, exportCsv, importBackup, listSnapshots, maybeDailySnapshot, parseBackup, readSnapshot } from './backup';
import { saveBody } from './repo/misc';

let tick = 0, ids = 0;
const T0 = Date.parse('2026-10-26T06:00:00.000Z');

async function populate(): Promise<string> {
  tick = 0; ids = 0;
  configureRuntime({ now: () => new Date(T0 + tick++ * 60_000).toISOString(), newId: () => `id-${String(++ids).padStart(5, '0')}`, userId: 'user-1', deviceId: 'phone' });
  await resetDb();
  await seedLibrary();
  const { program } = await createProgram(routineV6Program(), routineV6Tree(), '2026-10-26');
  const tpl = (await tbl('workout_templates').toArray()).find((t) => t.weekday === 1)!;
  const s = await S.startScheduled(program.id, tpl.template_key, '2026-10-26', '2026-10-26');
  for (const v of await S.sessionExercises(s.id)) for (const st of v.sets) await S.logSet(st.id, { weight_kg: 50, reps: 10 });
  await S.finishSession(s.id, { notes: 'Good, "quoted" note, with comma' });
  await saveBody({ measured_at: '2026-10-26T07:00:00.000Z', bodyweight_kg: 82.5 });
  return s.id;
}

describe('backup and restore', () => {
  beforeEach(async () => { await populate(); });

  it('exports everything (including soft-deleted rows) but not the built-in library', async () => {
    const b = await exportBackup();
    expect(b.app).toBe('monster-gains');
    expect(b.counts.set_records).toBe(9);
    expect(b.counts.workout_sessions).toBe(1);
    expect(b.counts.exercises).toBe(0);
    const st = (await tbl('set_records').toArray())[0]!;
    await S.deleteSet(st.id);
    const b2 = await exportBackup();
    expect(b2.counts.set_records).toBe(9); // soft-deleted rows stay in the backup
    expect(JSON.stringify(b2)).not.toContain('_dirty');
  });

  it('round-trips: wipe → restore → identical data', async () => {
    const before = await exportBackup();
    const json = JSON.stringify(before);
    await db.transaction('rw', db.tables, async () => { for (const t of db.tables) if (t.name !== 'meta') await t.clear(); });
    await seedLibrary();
    expect(await tbl('set_records').count()).toBe(0);
    const r = await importBackup(parseBackup(json));
    expect(r.added).toBeGreaterThan(50);
    const after = await exportBackup();
    for (const t of Object.keys(before.tables) as (keyof typeof before.tables)[]) expect(after.tables[t], t).toEqual(before.tables[t]);
  });

  it('restore is merge-only: it can never overwrite newer local work', async () => {
    const old = await exportBackup();
    const set = (await tbl('set_records').toArray()).find((s) => s.status === 'completed')!;
    await S.editSet(set.id, { weight_kg: 77.5 }, 'newer correction');
    const r = await importBackup(old);
    expect(r.skippedNewerLocal).toBeGreaterThan(0);
    expect((await tbl('set_records').get(set.id))!.weight_kg).toBe(77.5);
    const again = await importBackup(old); // idempotent
    expect(again.added).toBe(0);
    expect(again.updated).toBe(0);
  });

  it('restored rows are marked dirty so they sync', async () => {
    const old = await exportBackup();
    await db.table('set_records').clear();
    await importBackup(old);
    expect(await tbl('set_records').where('_dirty').equals(1).count()).toBe(9);
  });

  it('rejects files that are not valid backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupFormatError);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Monster Gains backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'monster-gains', schema: 99, tables: {} }))).toThrow(/newer version/);
    expect(() => parseBackup(JSON.stringify({ app: 'monster-gains', schema: 1, tables: { set_records: [{ nope: 1 }] } }))).toThrow(/no id/);
    expect(() => parseBackup(JSON.stringify({ app: 'monster-gains', schema: 1 }))).toThrow(/no data/);
  });

  it('exports CSV with proper escaping and readable names', async () => {
    const sets = await exportCsv('sets');
    const lines = sets.split('\n');
    expect(lines[0]).toContain('session_date,session,exercise');
    expect(lines).toHaveLength(10);
    expect(lines[1]).toContain('Underhand Lat Pulldown');
    const sessions = await exportCsv('sessions');
    expect(sessions).toContain('"Good, ""quoted"" note, with comma"');
    expect(await exportCsv('body')).toContain('82.5');
  });
});

describe('rolling snapshots', () => {
  beforeEach(async () => { await populate(); });
  it('creates, lists, reads and prunes snapshots; auto-snapshots at most once a day', async () => {
    const first = await maybeDailySnapshot();
    expect(first?.reason).toBe('daily');
    expect(await maybeDailySnapshot()).toBeNull(); // same day: nothing new
    tick += 60 * 24; // a day passes
    expect((await maybeDailySnapshot())?.reason).toBe('daily');
    for (let i = 0; i < 9; i++) { tick += 60 * 24; await createSnapshot('daily'); }
    const list = await listSnapshots();
    expect(list.filter((s) => s.reason === 'daily')).toHaveLength(7);
    for (let i = 0; i < 5; i++) { tick += 5; await createSnapshot('pre-restore'); }
    expect((await listSnapshots()).filter((s) => s.reason === 'pre-restore')).toHaveLength(3);
    const snap = await readSnapshot(list[0]!.name);
    expect(snap.counts.set_records).toBe(9);
  });
  it('takes a safety snapshot before every restore', async () => {
    const b = await exportBackup();
    const before = (await listSnapshots()).length;
    await importBackup(b);
    expect((await listSnapshots()).some((s) => s.reason === 'pre-restore')).toBe(true);
    expect((await listSnapshots()).length).toBe(before + 1);
  });
  it('does not snapshot an empty app', async () => {
    await resetDb();
    expect(await maybeDailySnapshot()).toBeNull();
  });
});
