import { z } from 'zod';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';

const schema = z.object({
  timezone: z.string().min(3).default(DEFAULT_SETTINGS.timezone),
  inactivityDays: z.number().int().min(1).max(30).default(DEFAULT_SETTINGS.inactivityDays),
  nearCloseDays: z.number().int().min(1).max(30).default(DEFAULT_SETTINGS.nearCloseDays),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(DEFAULT_SETTINGS.weekStartsOn),
  defaultReminderTime: z.string().regex(/^\d{2}:\d{2}$/).default(DEFAULT_SETTINGS.defaultReminderTime),
  calendarStartHour: z.number().int().min(0).max(12).default(DEFAULT_SETTINGS.calendarStartHour),
  calendarEndHour: z.number().int().min(13).max(24).default(DEFAULT_SETTINGS.calendarEndHour),
  maskSensitive: z.boolean().default(DEFAULT_SETTINGS.maskSensitive),
  density: z.enum(['comfortable', 'compact']).default(DEFAULT_SETTINGS.density),
  defaultFollowupMinutes: z.number().int().min(5).max(1440).default(DEFAULT_SETTINGS.defaultFollowupMinutes),
  notifyInApp: z.boolean().default(DEFAULT_SETTINGS.notifyInApp),
  idleLogoutMinutes: z.number().int().min(0).max(1440).default(DEFAULT_SETTINGS.idleLogoutMinutes),
  joiningAlertDays: z.array(z.number().int().min(0).max(60)).default(DEFAULT_SETTINGS.joiningAlertDays),
});
/** Unknown/legacy keys in app_settings.data are preserved by the caller; invalid values fall back to defaults. */
export function parseSettings(raw: unknown): Settings {
  const obj = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>).slate ?? {} : {}) as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { const one = schema.shape[k as keyof typeof schema.shape]; if (one && one.safeParse(v).success) safe[k] = v; }
  return schema.parse(safe) as Settings;
}
export const mergeSettings = (raw: unknown, patch: Partial<Settings>): Record<string, unknown> => {
  const base = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  return { ...base, slate: { ...parseSettings(raw), ...patch } };
};
