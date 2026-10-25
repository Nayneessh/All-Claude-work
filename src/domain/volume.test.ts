import { describe, expect, it } from 'vitest';
import { addSetToTotals, emptyTotals, isHardSet, setVolumeKg, totalsFor } from './volume';
import { set } from '@/test/factories';

const barbell = { tracking_method: 'weight_reps', load_mode: 'total', bodyweight_fraction: 1 } as const;
const db = { tracking_method: 'weight_reps', load_mode: 'per_hand', bodyweight_fraction: 1 } as const;
const pullup = { tracking_method: 'bodyweight_reps', load_mode: 'bodyweight', bodyweight_fraction: 1 } as const;
const assisted = { tracking_method: 'assisted_reps', load_mode: 'assisted', bodyweight_fraction: 1 } as const;
const plank = { tracking_method: 'duration', load_mode: 'bodyweight', bodyweight_fraction: 1 } as const;

describe('volume load', () => {
  it('is load × reps for completed working sets', () => {
    expect(setVolumeKg(set({ weight_kg: 100, reps: 5 }), barbell)).toBe(500);
  });
  it('excludes warm-ups from volume and from working-set counts', () => {
    const w = set({ set_type: 'warmup', weight_kg: 40, reps: 10 });
    expect(setVolumeKg(w, barbell)).toBeNull();
    const t = emptyTotals();
    addSetToTotals(t, w, barbell);
    addSetToTotals(t, set({ weight_kg: 100, reps: 5 }), barbell);
    expect(t.workingSets).toBe(1);
    expect(t.warmupSets).toBe(1);
    expect(t.volumeKg).toBe(500);
    expect(t.reps).toBe(5);
  });
  it('treats missing load as UNKNOWN, never zero', () => {
    const noLoad = set({ weight_kg: null, reps: 10 });
    expect(setVolumeKg(noLoad, barbell)).toBeNull();
    const t = totalsFor([noLoad, set({ weight_kg: 50, reps: 10 })], () => barbell);
    expect(t.volumeKg).toBe(500);
    expect(t.unknownVolumeSets).toBe(1);
    expect(t.workingSets).toBe(2); // the set still happened
  });
  it('does not count planned / skipped / failed sets', () => {
    for (const status of ['planned', 'skipped', 'failed'] as const) {
      expect(setVolumeKg(set({ status }), barbell)).toBeNull();
    }
    expect(totalsFor([set({ status: 'planned' })], () => barbell).workingSets).toBe(0);
  });
  it('counts per-hand loads as logged unless doubling is switched on', () => {
    const s = set({ weight_kg: 25, reps: 10 });
    expect(setVolumeKg(s, db)).toBe(250);
    expect(setVolumeKg(s, db, { doublePerHand: true })).toBe(500);
    expect(setVolumeKg(s, barbell, { doublePerHand: true })).toBe(250); // only per-hand exercises double
  });
  it('uses bodyweight × fraction + added load for bodyweight reps, unknown without a bodyweight', () => {
    expect(setVolumeKg(set({ weight_kg: null, reps: 8, bodyweight_kg: 80 }), pullup)).toBe(640);
    expect(setVolumeKg(set({ weight_kg: 10, reps: 5, bodyweight_kg: 80 }), pullup)).toBe(450);
    expect(setVolumeKg(set({ weight_kg: null, reps: 8, bodyweight_kg: null }), pullup)).toBeNull();
    expect(setVolumeKg(set({ weight_kg: null, reps: 8 }), pullup, { bodyweightKg: 82 })).toBe(656);
  });
  it('uses bodyweight − assistance for assisted reps (never negative)', () => {
    expect(setVolumeKg(set({ weight_kg: null, assist_kg: 30, reps: 10, bodyweight_kg: 80 }), assisted)).toBe(500);
    expect(setVolumeKg(set({ weight_kg: null, assist_kg: 100, reps: 10, bodyweight_kg: 80 }), assisted)).toBe(0);
    expect(setVolumeKg(set({ weight_kg: null, assist_kg: null, reps: 10, bodyweight_kg: 80 }), assisted)).toBeNull();
  });
  it('has no volume load for time-based work but tracks duration', () => {
    const t = totalsFor([set({ weight_kg: null, reps: null, duration_s: 60 })], () => plank);
    expect(t.volumeKg).toBe(0);
    expect(t.durationS).toBe(60);
    expect(t.unknownVolumeSets).toBe(0);
  });
  it('technique components add volume but are one working set', () => {
    const parent = set({ id: 'p', weight_kg: 60, reps: 10 });
    const drop = set({ id: 'd', set_type: 'drop', parent_set_id: 'p', weight_kg: 45, reps: 8 });
    const rp = set({ id: 'r', set_type: 'rest_pause', parent_set_id: 'p', weight_kg: 60, reps: 3 });
    const t = totalsFor([parent, drop, rp], () => barbell);
    expect(t.workingSets).toBe(1);
    expect(t.reps).toBe(21);
    expect(t.volumeKg).toBe(600 + 360 + 180);
  });
  it('tracks partial reps separately from reps and volume', () => {
    const t = totalsFor([set({ weight_kg: 30, reps: 10, reps_partial: 6 })], () => barbell);
    expect(t.reps).toBe(10);
    expect(t.partialReps).toBe(6);
    expect(t.volumeKg).toBe(300);
  });
  it('ignores soft-deleted sets', () => {
    expect(totalsFor([set({ deleted_at: '2026-10-27T00:00:00.000Z' })], () => barbell).workingSets).toBe(0);
  });
});

describe('hard sets', () => {
  it('uses failure, RIR ≤ 3 or RPE ≥ 7; unrated follows the option', () => {
    expect(isHardSet(set({ failure: 'muscular' }))).toBe(true);
    expect(isHardSet(set({ rir: 2 }))).toBe(true);
    expect(isHardSet(set({ rir: 5 }))).toBe(false);
    expect(isHardSet(set({ rpe: 8 }))).toBe(true);
    expect(isHardSet(set({ rpe: 5 }))).toBe(false);
    expect(isHardSet(set({}), { unratedCountsAsHard: true })).toBe(true);
    expect(isHardSet(set({}), { unratedCountsAsHard: false })).toBe(false);
    expect(isHardSet(set({ set_type: 'warmup', rir: 0 }))).toBe(false);
    expect(isHardSet(set({ parent_set_id: 'p', rir: 0 }))).toBe(false);
  });
});
