import { describe, expect, it } from 'vitest';
import { detectDips } from './dips';
import { ctxOf, ex, session, set } from '@/test/factories';
import type { SessionPerf } from './progression';

const bench = ex({ id: 'bench', name: 'Bench Press', primary_muscles: ['chest_mid'] });
const row = ex({ id: 'row', name: 'Row', primary_muscles: ['lats'] });
const today = '2026-12-02'; // Wednesday; the last FULL week is 2026-11-23 … 11-29

function history(weeklyKg: Record<string, number>, tags: Record<string, string[]> = {}) {
  const sessions = [];
  const sets = [];
  let i = 0;
  for (const [monday, kg] of Object.entries(weeklyKg)) {
    for (const [dayOff, exId] of [[0, 'bench'], [2, 'row']] as const) {
      const d = new Date(Date.parse(monday) + dayOff * 86_400_000).toISOString().slice(0, 10);
      const id = `s${i++}`;
      sessions.push(session({ id, session_date: d, tags: tags[monday] ?? [] }));
      for (let n = 1; n <= 4; n++) sets.push(set({ id: `${id}-${n}`, session_id: id, session_date: d, exercise_id: exId, set_number: n, weight_kg: kg / 4 / 5 / 2, reps: 5 }));
    }
  }
  return { sessions, sets };
}

const baseInput = (h: ReturnType<typeof history>) => ({
  today, sets: h.sets, ctx: ctxOf([bench, row], h.sessions), attendance: [], perfsByExercise: new Map<string, SessionPerf[]>(), readiness: [], sessionNotes: [],
});

describe('dip detection', () => {
  it('flags a clear weekly volume drop with contributors and labelled hypotheses', () => {
    const h = history({ '2026-10-26': 4000, '2026-11-02': 4000, '2026-11-09': 4000, '2026-11-16': 4000, '2026-11-23': 2000 });
    const flags = detectDips(baseInput(h));
    const f = flags.find((x) => x.kind === 'volume_drop')!;
    expect(f).toBeDefined();
    expect(f.magnitudePct).toBeCloseTo(-50, 5);
    expect(f.startDate).toBe('2026-11-23');
    expect(f.comparison.baseline).toBe(4000);
    expect(f.contributors.length).toBeGreaterThan(0);
    expect(f.drill).toEqual({ type: 'week', id: '2026-11-23' });
    expect(f.hypotheses.length).toBeGreaterThan(0);
  });
  it('does not flag normal week-to-week variation', () => {
    const h = history({ '2026-10-26': 4000, '2026-11-02': 4200, '2026-11-09': 3900, '2026-11-16': 4100, '2026-11-23': 3700 });
    expect(detectDips(baseInput(h)).some((x) => x.kind === 'volume_drop')).toBe(false);
  });
  it('never flags a planned deload week', () => {
    const h = history({ '2026-10-26': 4000, '2026-11-02': 4000, '2026-11-09': 4000, '2026-11-16': 4000, '2026-11-23': 2000 }, { '2026-11-23': ['deload'] });
    expect(detectDips(baseInput(h)).some((x) => x.kind === 'volume_drop' || x.kind === 'undertrained_muscle')).toBe(false);
  });
  it('needs at least 3 baseline weeks before judging anything', () => {
    const h = history({ '2026-11-16': 4000, '2026-11-23': 500 });
    expect(detectDips(baseInput(h))).toEqual([]);
  });
  it('flags missed sessions only with enough planned sessions in the window', () => {
    const results = ['2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27', '2026-11-30'].map((date, i) => ({ date, template_key: 'k', outcome: (i < 2 ? 'done' : 'missed') as 'done' | 'missed', session_id: null }));
    const flags = detectDips({ ...baseInput({ sessions: [], sets: [] }), attendance: results });
    expect(flags.find((x) => x.kind === 'missed_sessions')!.summary).toMatch(/2 of 5/);
    expect(detectDips({ ...baseInput({ sessions: [], sets: [] }), attendance: results.slice(0, 2) }).some((x) => x.kind === 'missed_sessions')).toBe(false);
  });
  it('flags an undertrained muscle group relative to its own baseline', () => {
    const h = history({ '2026-10-26': 4000, '2026-11-02': 4000, '2026-11-09': 4000, '2026-11-16': 4000 });
    // last full week: only back work
    const d = '2026-11-25';
    h.sessions.push(session({ id: 'late', session_date: d }));
    for (let n = 1; n <= 4; n++) h.sets.push(set({ id: `late-${n}`, session_id: 'late', session_date: d, exercise_id: 'row', set_number: n, weight_kg: 60, reps: 8 }));
    const flags = detectDips(baseInput(h));
    expect(flags.some((f) => f.kind === 'undertrained_muscle' && f.drill.id === 'chest')).toBe(true);
  });
});
