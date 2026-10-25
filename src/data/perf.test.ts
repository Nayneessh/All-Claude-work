import { beforeAll, describe, expect, it } from 'vitest';
import { configureRuntime } from './runtime';
import { resetDb, tbl } from './db';
import { routineV6Program, routineV6Tree } from './seed/routineV6';
import { seedLibrary } from './repo/exercises';
import { createProgram } from './repo/programs';
import * as S from './repo/sessions';
import { exerciseInsight, listSessions, loadAnalytics, sessionSummaries } from './repo/history';
import { addDays } from '@/domain/periods';
import { muscleStats, periodStats, weeklySeries, plannedVsActual } from '@/domain/analytics';

/**
 * Scale check: two years of history (3 sessions/week × 9 sets) cloned from one genuinely logged workout.
 * Budgets are generous multiples of what was measured so the test is stable on slow CI but still catches an O(n²) regression.
 */
const FIRST = '2024-10-28'; // 104 weeks before TODAY
const TODAY = '2026-10-26';
let tick = 0; let ids = 0;

describe('performance at two years of history', () => {
  let setCount = 0; let sessionCount = 0;
  beforeAll(async () => {
    tick = 0; ids = 0;
    const T0 = Date.parse('2026-10-26T06:00:00.000Z');
    configureRuntime({ now: () => new Date(T0 + tick++ * 1000).toISOString(), newId: () => `id-${String(++ids).padStart(7, '0')}`, userId: null, deviceId: 'perf' });
    await resetDb(); await seedLibrary();
    const { program } = await createProgram(routineV6Program(), routineV6Tree(), TODAY);
    const first = (await S.planForDate(TODAY))[0]!;
    const s = await S.startScheduled(program.id, first.template.template_key, TODAY, TODAY);
    for (const v of await S.sessionExercises(s.id)) for (const st of v.sets) await S.logSet(st.id, { weight_kg: 60, reps: 10, rir: 2 });
    await S.finishSession(s.id, {});
    const base = (await tbl('workout_sessions').toArray())[0]!;
    const baseSes = await tbl('session_exercises').where('session_id').equals(base.id).toArray();
    const baseSets = await tbl('set_records').where('session_id').equals(base.id).toArray();
    const sessions: typeof base[] = []; const ses: typeof baseSes = []; const sets: typeof baseSets = [];
    let n = 0;
    for (let w = 0; w < 104; w++) for (const d of [0, 2, 4]) {
      const date = addDays(FIRST, w * 7 + d); // 312 historical sessions before the one really logged today
      const sid = `bulk-s-${n}`;
      sessions.push({ ...base, id: sid, session_date: date, scheduled_date: date, dedupe_key: `bulk:${n}` });
      const map = new Map<string, string>();
      baseSes.forEach((x, i) => { const id = `${sid}-e${i}`; map.set(x.id, id); ses.push({ ...x, id, session_id: sid }); });
      baseSets.forEach((x, i) => sets.push({ ...x, id: `${sid}-t${i}`, session_id: sid, session_exercise_id: map.get(x.session_exercise_id)!, session_date: date }));
      n++;
    }
    await tbl('workout_sessions').bulkAdd(sessions);
    await tbl('session_exercises').bulkAdd(ses);
    await tbl('set_records').bulkAdd(sets);
    sessionCount = n + 1; setCount = sets.length + baseSets.length;
  }, 120_000);

  it('has realistic volume (> 2,500 logged sets)', () => { expect(setCount).toBeGreaterThan(2500); expect(sessionCount).toBeGreaterThan(300); });

  it('loads a full year of analytics and derives every dashboard figure quickly', async () => {
    const t0 = performance.now();
    const data = await loadAnalytics(addDays(TODAY, -364), TODAY, TODAY);
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    const stats = periodStats(data.sets as never, data.ctx);
    muscleStats(data.sets as never, data.ctx); weeklySeries(data.sets as never, data.ctx, addDays(TODAY, -364), TODAY); plannedVsActual(data.sets as never, data.ctx);
    const deriveMs = performance.now() - t1;
    console.log(`PERF year-analytics load=${loadMs.toFixed(0)}ms derive=${deriveMs.toFixed(0)}ms sets=${data.sets.length}`);
    expect(stats.workingSets).toBeGreaterThan(1000);
    expect(loadMs).toBeLessThan(3000);
    expect(deriveMs).toBeLessThan(1500);
  });

  it('opens an exercise with two years of PR history, and lists history pages, quickly', async () => {
    const ex = (await tbl('set_records').toArray())[0]!.exercise_id;
    const t0 = performance.now();
    const ins = await exerciseInsight(ex, TODAY);
    const insightMs = performance.now() - t0;
    const t1 = performance.now();
    const page = await listSessions({}, 50);
    const sums = await sessionSummaries(page.map((s) => s.id), TODAY);
    const listMs = performance.now() - t1;
    console.log(`PERF exerciseInsight=${insightMs.toFixed(0)}ms historyPage=${listMs.toFixed(0)}ms`);
    expect(ins).toBeTruthy();
    expect(sums.size).toBe(50);
    expect(insightMs).toBeLessThan(2000);
    expect(listMs).toBeLessThan(1500);
  });
});
