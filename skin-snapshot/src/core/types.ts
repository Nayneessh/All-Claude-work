// Shared vocabulary for the whole product. Pure data, no I/O.
// Every observable the AI can report is a member of one of these closed sets.

export const LANGS = ['en', 'hi'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

export const PATHS = ['maintenance', 'concerns', 'scars'] as const;
export type PathId = (typeof PATHS)[number];

export const ZONES = ['forehead', 'cheeks', 'nose', 'chin', 'under_eyes'] as const;
export type Zone = (typeof ZONES)[number];

export const ATTRIBUTES = [
  'texture',
  'tone_evenness',
  'shine',
  'radiance',
  'fine_lines',
  'redness',
  'breakouts',
  'dark_patches',
  'marks_scars',
  'mark_contrast',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const CONFIDENCES = ['clear', 'likely', 'not_sure', 'not_assessed'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const ASSESSED_CONFIDENCES = ['clear', 'likely', 'not_sure'] as const;
export type AssessedConfidence = (typeof ASSESSED_CONFIDENCES)[number];

export const SIDES = ['both', 'left', 'right', 'centre'] as const;
export type Side = (typeof SIDES)[number];

export const PHOTO_SLOTS = ['front', 'left', 'right', 'closeup'] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
export const REQUIRED_SLOTS: readonly PhotoSlot[] = ['front', 'left', 'right'];

export const REASONS = [
  'photo_too_dark',
  'photo_blurry',
  'angle_not_suitable',
  'zone_hidden',
  'uneven_lighting',
  'possible_filter',
  'makeup_present',
  'photo_missing',
] as const;
export type Reason = (typeof REASONS)[number];

export const BOOKING_STATUSES = [
  'requested',
  'contacted',
  'scheduled',
  'completed',
  'no_response',
  'closed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const STAFF_ROLES = ['admin', 'cosmetologist'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Red flags that can stop the cosmetic flow. Gate A uses answers, Gate B uses images. */
export const RED_FLAG_CODES = [
  'changing_mole',
  'non_healing_sore',
  'infection_signs',
  'severe_inflammation',
  'eye_area_problem',
  'rapid_worsening',
  'painful_lumps',
  'bleeding_or_oozing',
  'raised_or_changing_marks',
  'lesion_visible',
  'open_wound_visible',
] as const;
export type RedFlagCode = (typeof RED_FLAG_CODES)[number];

/** Subset of red flags the vision model may report. It never describes them, only reports the code. */
export const IMAGE_RED_FLAG_CODES = [
  'lesion_visible',
  'infection_signs',
  'severe_inflammation',
  'eye_area_problem',
  'open_wound_visible',
] as const satisfies readonly RedFlagCode[];
export type ImageRedFlagCode = (typeof IMAGE_RED_FLAG_CODES)[number];

export interface RedFlag {
  code: RedFlagCode;
  source: 'answers' | 'image';
  /** Rule id (answers) or model confidence (image), for the cosmetologist's brief. */
  detail?: string;
}

export type Restriction = 'no_routine';

/** Closed vocabulary of findings per attribute. The model can only choose from these. */
export const FINDINGS = {
  texture: ['smooth', 'slightly_uneven', 'uneven', 'rough_patches'],
  tone_evenness: ['even', 'slightly_uneven', 'uneven'],
  shine: ['matte', 'balanced', 'shiny_in_areas', 'very_shiny'],
  radiance: ['bright', 'slightly_dull', 'dull_in_areas'],
  fine_lines: ['none_visible', 'faint', 'visible'],
  redness: ['none_visible', 'mild', 'moderate', 'marked'],
  breakouts: ['none_visible', 'few_small', 'several', 'many'],
  dark_patches: ['none_visible', 'faint', 'noticeable', 'pronounced'],
  marks_scars: ['none_visible', 'few_flat_marks', 'several_flat_marks', 'widespread_flat_marks', 'indented_scars'],
  mark_contrast: ['subtle', 'noticeable', 'strong'],
} as const satisfies Record<Attribute, readonly string[]>;

export const ALL_FINDING_CODES: readonly string[] = Array.from(new Set(Object.values(FINDINGS).flat()));

/** Which attributes may be reported for which zones. */
export const ZONE_ATTRIBUTES: Record<Attribute, readonly Zone[]> = {
  texture: ['forehead', 'cheeks', 'nose', 'chin'],
  tone_evenness: ['forehead', 'cheeks', 'nose', 'chin', 'under_eyes'],
  shine: ['forehead', 'cheeks', 'nose', 'chin'],
  radiance: ['forehead', 'cheeks', 'nose', 'chin'],
  fine_lines: ['forehead', 'under_eyes'],
  redness: ['forehead', 'cheeks', 'nose', 'chin'],
  breakouts: ['forehead', 'cheeks', 'nose', 'chin'],
  dark_patches: ['forehead', 'cheeks', 'nose', 'chin', 'under_eyes'],
  marks_scars: ['forehead', 'cheeks', 'nose', 'chin'],
  mark_contrast: ['forehead', 'cheeks', 'nose', 'chin'],
};

/** Which attributes each path assesses (blueprint section 4). */
export const PATH_ATTRIBUTES: Record<PathId, readonly Attribute[]> = {
  maintenance: ['texture', 'tone_evenness', 'shine', 'radiance', 'fine_lines'],
  concerns: ['breakouts', 'redness', 'dark_patches', 'texture'],
  scars: ['marks_scars', 'mark_contrast', 'dark_patches', 'texture', 'redness'],
};

export const PATH_LABEL_KEY: Record<PathId, string> = {
  maintenance: 'path.maintenance',
  concerns: 'path.concerns',
  scars: 'path.scars',
};

/** Zones with a left/right distinction. Others are always 'centre'. */
export const SIDED_ZONES: readonly Zone[] = ['cheeks', 'under_eyes'];

export function allowedSides(zone: Zone): readonly Side[] {
  return SIDED_ZONES.includes(zone) ? ['both', 'left', 'right'] : ['centre'];
}

/** Rows the snapshot must contain for a path: every applicable (zone, attribute) pair. */
export function expectedGrid(path: PathId): { zone: Zone; attribute: Attribute }[] {
  const out: { zone: Zone; attribute: Attribute }[] = [];
  for (const attribute of PATH_ATTRIBUTES[path]) {
    for (const zone of ZONE_ATTRIBUTES[attribute]) out.push({ zone, attribute });
  }
  return out;
}

export function isPath(v: unknown): v is PathId {
  return typeof v === 'string' && (PATHS as readonly string[]).includes(v);
}
export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}
