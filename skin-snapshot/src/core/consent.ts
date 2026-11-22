// Consent model: four separate, unticked consents plus one optional extra (D4).
// Each grant is stored with the version of the text the visitor saw, and a timestamp.
//
// STATUS: DRAFT wording. Needs data-protection counsel before public launch.

export const CONSENT_KEYS = ['privacy', 'health', 'photos_ai', 'whatsapp', 'evaluation'] as const;
export type ConsentKey = (typeof CONSENT_KEYS)[number];

/** Collected before the questionnaire. All required. */
export const START_REQUIRED: readonly ConsentKey[] = ['privacy', 'health', 'photos_ai'];
/** Collected on the booking form. Required to book. */
export const BOOKING_REQUIRED: readonly ConsentKey[] = ['whatsapp'];
/** Offered but never required. */
export const OPTIONAL: readonly ConsentKey[] = ['evaluation'];

export const CONSENT_VERSION = '2026-11-22-DRAFT-1';

export type WithdrawalEffect =
  | 'delete_case'
  | 'delete_answers_and_analysis'
  | 'delete_photos_and_analysis'
  | 'stop_contact'
  | 'stop_evaluation_use';

export const WITHDRAWAL_EFFECTS: Record<ConsentKey, WithdrawalEffect> = {
  privacy: 'delete_case',
  health: 'delete_answers_and_analysis',
  photos_ai: 'delete_photos_and_analysis',
  whatsapp: 'stop_contact',
  evaluation: 'stop_evaluation_use',
};

export function isConsentKey(v: unknown): v is ConsentKey {
  return typeof v === 'string' && (CONSENT_KEYS as readonly string[]).includes(v);
}

export function hasAll(granted: readonly string[], needed: readonly ConsentKey[]): boolean {
  return needed.every((k) => granted.includes(k));
}
