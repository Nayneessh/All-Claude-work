import type { AppSettings, Profile } from '@/domain/types';
import { tbl } from '../db';
import { insert, update } from '../write';
import { runtime } from '../runtime';

export const DEFAULT_SETTINGS: Required<Pick<AppSettings, 'default_rest_s' | 'rpe_mode' | 'e1rm_formula' | 'double_per_hand' | 'unrated_counts_as_hard' | 'secondary_muscle_weight' | 'auto_start_rest' | 'rest_sound' | 'rest_vibrate' | 'text_scale' | 'plate_bar_kg'>> = {
  default_rest_s: 90, rpe_mode: 'rir', e1rm_formula: 'epley', double_per_hand: false, unrated_counts_as_hard: true, secondary_muscle_weight: 0.5,
  auto_start_rest: true, rest_sound: true, rest_vibrate: true, text_scale: 1, plate_bar_kg: 20,
};

export type ProfilePatch = Partial<Omit<Profile, 'settings' | 'baseline'>> & { settings?: Partial<AppSettings>; baseline?: Record<string, unknown> };

export async function getProfile(): Promise<Profile | undefined> {
  const rows = (await tbl('profiles').toArray()).filter((p) => !p.deleted_at);
  const p = rows[0];
  if (!p) return undefined;
  const { _dirty: _d, ...rest } = p;
  void _d;
  return rest;
}

export async function ensureProfile(): Promise<Profile> {
  const cur = await getProfile();
  if (cur) return cur;
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const row = await insert('profiles', {
    id: runtime.userId ?? 'local-profile', display_name: null, units: 'kg', week_start: 1, timezone: tz ?? null, language: 'en', birth_year: null, height_cm: null,
    experience: null, training_years: null, goals: [], preferred_days: [], session_minutes: null, equipment: [], constraints_note: null,
    settings: {}, baseline: {}, onboarding_done: false,
  });
  const { _dirty: _d, ...rest } = row;
  void _d;
  return rest;
}

export async function saveProfile(patch: ProfilePatch): Promise<Profile> {
  const cur = await ensureProfile();
  const { settings, baseline, ...rest } = patch;
  const next = await update('profiles', cur.id, {
    ...rest,
    ...(settings ? { settings: { ...cur.settings, ...settings } } : {}),
    ...(baseline ? { baseline: { ...cur.baseline, ...baseline } } : {}),
  });
  const { _dirty: _d, ...out } = next;
  void _d;
  return out;
}

/** Effective settings with defaults filled in. */
export const effectiveSettings = (p: Profile | undefined): typeof DEFAULT_SETTINGS & AppSettings => ({ ...DEFAULT_SETTINGS, ...(p?.settings ?? {}) });
