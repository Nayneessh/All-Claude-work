import Dexie, { type Table } from 'dexie';
import type { TableMap, TableName } from '@/domain/types';

/** `_dirty` marks rows with local changes not yet acknowledged by the server (0 | 1 so it can be indexed). */
export type Local = { _dirty: 0 | 1 };
export type Row<T extends TableName> = TableMap[T] & Local;

export interface MetaRow { key: string; value: unknown }
export interface PhotoBlob { id: string; blob: Blob; uploaded: 0 | 1 }

const STORES: Record<TableName, string> = {
  profiles: 'id, user_id, _dirty',
  exercises: 'id, seed_key, user_id, name, archived_at, _dirty',
  equipment_profiles: 'id, _dirty',
  programs: 'id, status, _dirty',
  program_versions: 'id, program_id, [program_id+version_no], effective_from, _dirty',
  workout_templates: 'id, program_id, program_version_id, template_key, [program_version_id+template_key], _dirty',
  planned_exercises: 'id, program_version_id, template_id, plan_key, [template_id+plan_key], exercise_id, _dirty',
  workout_sessions: 'id, session_date, status, program_id, template_key, dedupe_key, [program_id+session_date], _dirty',
  session_exercises: 'id, session_id, exercise_id, _dirty',
  set_records: 'id, session_id, session_exercise_id, exercise_id, session_date, [exercise_id+session_date], parent_set_id, _dirty',
  goals: 'id, status, _dirty',
  body_measurements: 'id, measured_at, _dirty',
  readiness_records: 'id, record_date, _dirty',
  progress_photos: 'id, taken_at, _dirty',
  program_modifications: 'id, program_id, _dirty',
  audit_events: 'id, entity_type, entity_id, occurred_at, _dirty',
  recommendations: 'id, dedupe_key, status, _dirty',
};

export class MonsterDB extends Dexie {
  meta!: Table<MetaRow, string>;
  photo_blobs!: Table<PhotoBlob, string>;

  constructor(name = 'monster-gains') {
    super(name);
    this.version(1).stores({ ...STORES, meta: 'key', photo_blobs: 'id, uploaded' });
  }
}

export let db = new MonsterDB();

/** Typed accessor — the single place where Dexie's dynamic table lookup is narrowed. */
export function tbl<T extends TableName>(name: T): Table<Row<T>, string> {
  return db.table(name) as unknown as Table<Row<T>, string>;
}

export const TABLE_NAMES = Object.keys(STORES) as TableName[];

/** Scope for multi-table flows (starting a session reads the program schedule, writes sessions, sets, audit…). Single-user app, so one wide scope is fine. */
export const allTables = (): Table<Row<TableName>, string>[] => TABLE_NAMES.map((n) => tbl(n)) as unknown as Table<Row<TableName>, string>[];

/** Test helper: start from a clean database. */
export async function resetDb(name = 'monster-gains-test'): Promise<void> {
  db.close();
  await Dexie.delete(name);
  db = new MonsterDB(name);
  await db.open();
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
