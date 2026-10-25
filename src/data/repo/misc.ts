import type { BodyMeasurement, EquipmentProfile, Goal, ISODate, ReadinessRecord, Recommendation } from '@/domain/types';
import { localDateOf } from '@/domain/periods';
import { bodyweightOn } from '@/domain/body';
import { tbl } from '../db';
import { insert, update, type NewRow } from '../write';
import { audit } from '../audit';
import { getProfile } from './profile';
import { db } from '../db';
import { nowIso } from '../runtime';

const clean = <T extends { _dirty: 0 | 1 }>(r: T): Omit<T, '_dirty'> => { const { _dirty: _d, ...rest } = r; void _d; return rest; };
const liveRows = async <T extends 'goals' | 'body_measurements' | 'readiness_records' | 'recommendations' | 'equipment_profiles'>(t: T) =>
  (await tbl(t).toArray()).filter((r) => !r.deleted_at).map(clean);

// ── Body measurements ───────────────────────────────────────────────────────
export const listBody = async (): Promise<BodyMeasurement[]> => ((await liveRows('body_measurements')) as BodyMeasurement[]).sort((a, b) => (a.measured_at < b.measured_at ? -1 : 1));
export type BodyInput = Partial<Omit<BodyMeasurement, keyof import('@/domain/types').SyncFields>> & { measured_at: string };
export async function saveBody(data: BodyInput, id?: string): Promise<void> {
  const blank = { bodyweight_kg: null, waist_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, hip_cm: null, calf_cm: null, body_fat_pct: null, body_fat_method: null, muscle_mass_kg: null, conditions: null, notes: null };
  if (id) {
    const before = await tbl('body_measurements').get(id);
    await update('body_measurements', id, data);
    await audit('body_measurement', id, 'update', before ? { bodyweight_kg: before.bodyweight_kg } : null, { bodyweight_kg: data.bodyweight_kg ?? null });
  } else await insert('body_measurements', { ...blank, ...data });
}
export async function deleteBody(id: string): Promise<void> { await update('body_measurements', id, { deleted_at: nowIso() }); }

/** Bodyweight in force on a date: latest measurement, else the profile baseline. Null when unknown (never 0). */
export async function bodyweightKgOn(date: ISODate): Promise<number | null> {
  const profile = await getProfile();
  const base = typeof profile?.baseline?.bodyweight_kg === 'number' ? (profile.baseline.bodyweight_kg as number) : null;
  return bodyweightOn(await listBody(), date, base);
}

// ── Readiness ───────────────────────────────────────────────────────────────
export const listReadiness = async (): Promise<ReadinessRecord[]> => ((await liveRows('readiness_records')) as ReadinessRecord[]).sort((a, b) => (a.record_date < b.record_date ? -1 : 1));
export async function saveReadiness(date: ISODate, data: Partial<Omit<ReadinessRecord, keyof import('@/domain/types').SyncFields | 'record_date'>>): Promise<void> {
  const existing = (await listReadiness()).find((r) => r.record_date === date);
  const base = { sleep_hours: null, sleep_quality: null, energy: null, soreness: null, stress: null, motivation: null, perceived_recovery: null, fatigue: null, resting_hr: null, hrv_ms: null, soreness_areas: [] as string[], illness_note: null, notes: null };
  if (existing) await update('readiness_records', existing.id, data);
  else await insert('readiness_records', { ...base, ...data, record_date: date });
}

// ── Goals ───────────────────────────────────────────────────────────────────
export const listGoals = async (): Promise<Goal[]> => ((await liveRows('goals')) as Goal[]).sort((a, b) => a.priority - b.priority || (a.created_at < b.created_at ? 1 : -1));
export async function createGoal(data: NewRow<'goals'>): Promise<Goal> { return clean(await insert('goals', data)) as Goal; }
/** Goals are paused/completed/abandoned — never deleted — so the historical record is kept. */
export async function setGoalStatus(id: string, status: Goal['status']): Promise<void> {
  await db.transaction('rw', tbl('goals'), tbl('audit_events'), async () => {
    const before = await tbl('goals').get(id);
    await update('goals', id, { status, completed_at: status === 'completed' ? nowIso() : null });
    await audit('goal', id, `status_${status}`, before ? { status: before.status } : null, { status });
  });
}
export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> { await update('goals', id, patch); }

// ── Equipment profiles ──────────────────────────────────────────────────────
export const listEquipment = async (): Promise<EquipmentProfile[]> => (await liveRows('equipment_profiles')) as EquipmentProfile[];
export async function saveEquipment(data: NewRow<'equipment_profiles'>, id?: string): Promise<void> { if (id) await update('equipment_profiles', id, data); else await insert('equipment_profiles', data); }

// ── Recommendations ─────────────────────────────────────────────────────────
export const listRecommendations = async (): Promise<Recommendation[]> => ((await liveRows('recommendations')) as Recommendation[]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

/** Inserts proposals that don't exist yet (by dedupe_key), so a dismissed or deferred card is never recreated. */
export async function storeRecommendations(proposals: Pick<Recommendation, 'kind' | 'dedupe_key' | 'exercise_id' | 'muscle' | 'observation' | 'evidence' | 'suggestion' | 'tradeoff' | 'proposed_change'>[]): Promise<number> {
  let n = 0;
  await db.transaction('rw', tbl('recommendations'), async () => {
    const existing = new Set((await tbl('recommendations').toArray()).filter((r) => !r.deleted_at).map((r) => r.dedupe_key));
    for (const p of proposals) {
      if (existing.has(p.dedupe_key)) continue;
      await insert('recommendations', { ...p, status: 'open', deferred_until: null, resolved_at: null, response_note: null });
      existing.add(p.dedupe_key);
      n++;
    }
  });
  return n;
}

export async function respondToRecommendation(id: string, action: 'accepted' | 'edited' | 'dismissed' | 'deferred', opts: { deferUntil?: ISODate; note?: string } = {}): Promise<void> {
  await db.transaction('rw', tbl('recommendations'), tbl('audit_events'), async () => {
    const before = await tbl('recommendations').get(id);
    await update('recommendations', id, { status: action, resolved_at: action === 'deferred' ? null : nowIso(), deferred_until: opts.deferUntil ?? null, response_note: opts.note ?? null });
    await audit('recommendation', id, action, before ? { status: before.status } : null, { status: action }, opts.note ?? null);
  });
}

export const localDay = localDateOf;
