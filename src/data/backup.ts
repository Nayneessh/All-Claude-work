import type { TableName } from '@/domain/types';
import { SYNC_ORDER } from '@/domain/types';
import { allTables, db, getMeta, setMeta, tbl, type Row } from './db';
import { nowIso, runtime } from './runtime';
import { isNative, nativeList, nativeRead, nativeRemove, nativeWrite } from '@/services/platform';

/**
 * Backup, restore and export (blueprint §20/§24).
 *  - A backup is plain JSON: every table, including soft-deleted rows, so nothing is ever "gone".
 *  - Restore is MERGE-ONLY with last-writer-wins on client_updated_at: restoring an old backup can never overwrite newer work.
 *  - Rolling snapshots are written automatically (daily + before any restore) to a second store that is independent of the
 *    WebView database on Android, so even a corrupted browser store cannot take your history with it.
 */
export const BACKUP_APP = 'monster-gains';
export const BACKUP_SCHEMA = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  schema: number;
  exported_at: string;
  device_id: string;
  user_id: string | null;
  counts: Record<string, number>;
  tables: Partial<Record<TableName, Record<string, unknown>[]>>;
}

const isSystemExercise = (t: TableName, r: Record<string, unknown>): boolean => t === 'exercises' && !!r.seed_key;

export async function exportBackup(): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  const counts: Record<string, number> = {};
  for (const t of SYNC_ORDER) {
    const rows = (await tbl(t).toArray()).filter((r) => !isSystemExercise(t, r as unknown as Record<string, unknown>)).map((r) => {
      const { _dirty: _d, ...rest } = r as Row<TableName>;
      void _d;
      return rest as unknown as Record<string, unknown>;
    });
    tables[t] = rows;
    counts[t] = rows.length;
  }
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exported_at: nowIso(), device_id: runtime.deviceId, user_id: runtime.userId, counts, tables };
}

export class BackupFormatError extends Error { constructor(m: string) { super(m); this.name = 'BackupFormatError'; } }

export function parseBackup(json: string): BackupFile {
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new BackupFormatError('This file is not valid JSON.'); }
  const f = data as Partial<BackupFile>;
  if (!f || f.app !== BACKUP_APP) throw new BackupFormatError('This is not a Monster Gains backup.');
  if (typeof f.schema !== 'number' || f.schema > BACKUP_SCHEMA) throw new BackupFormatError('This backup comes from a newer version of the app. Update Monster Gains first.');
  if (!f.tables || typeof f.tables !== 'object') throw new BackupFormatError('The backup has no data.');
  for (const [name, rows] of Object.entries(f.tables)) {
    if (!SYNC_ORDER.includes(name as TableName)) continue;
    if (!Array.isArray(rows)) throw new BackupFormatError(`Table “${name}” is malformed.`);
    for (const r of rows) if (!r || typeof (r as { id?: unknown }).id !== 'string') throw new BackupFormatError(`A row in “${name}” has no id.`);
  }
  return f as BackupFile;
}

export interface ImportResult { added: number; updated: number; skippedNewerLocal: number; tables: number }

const ts = (v: unknown): number => Date.parse(String(v));

/** Merge: add what is missing, update what is older, never touch what is newer locally. Idempotent. */
export async function importBackup(file: BackupFile): Promise<ImportResult> {
  await createSnapshot('pre-restore');
  const res: ImportResult = { added: 0, updated: 0, skippedNewerLocal: 0, tables: 0 };
  await db.transaction('rw', allTables(), async () => {
    for (const t of SYNC_ORDER) {
      const rows = file.tables[t];
      if (!rows?.length) continue;
      res.tables++;
      const incoming = rows.filter((r) => !isSystemExercise(t, r));
      const local = await tbl(t).bulkGet(incoming.map((r) => String(r.id)));
      const puts: Row<TableName>[] = [];
      incoming.forEach((r, i) => {
        const cur = local[i];
        const row = { ...r, user_id: (r.user_id as string | null) ?? runtime.userId, _dirty: 1 } as unknown as Row<TableName>;
        if (!cur) { puts.push(row); res.added++; }
        else if (ts(r.client_updated_at) > ts(cur.client_updated_at)) { puts.push(row); res.updated++; }
        else res.skippedNewerLocal++;
      });
      if (puts.length) await tbl(t).bulkPut(puts as never);
    }
  });
  return res;
}

// ── CSV export ──────────────────────────────────────────────────────────────
const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportCsv(kind: 'sets' | 'sessions' | 'body'): Promise<string> {
  if (kind === 'body') {
    const rows = (await tbl('body_measurements').toArray()).filter((r) => !r.deleted_at).sort((a, b) => (a.measured_at < b.measured_at ? -1 : 1));
    const cols = ['measured_at', 'bodyweight_kg', 'waist_cm', 'chest_cm', 'arm_cm', 'thigh_cm', 'hip_cm', 'calf_cm', 'body_fat_pct', 'body_fat_method', 'muscle_mass_kg', 'notes'];
    return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
  }
  if (kind === 'sessions') {
    const rows = (await tbl('workout_sessions').toArray()).filter((r) => !r.deleted_at).sort((a, b) => (a.session_date < b.session_date ? -1 : 1));
    const cols = ['session_date', 'scheduled_date', 'name', 'status', 'started_at', 'finished_at', 'paused_total_s', 'session_rpe', 'tags', 'notes', 'change_reason', 'corrected_after_completion'];
    return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
  }
  const exs = new Map((await tbl('exercises').toArray()).map((e) => [e.id, e.name]));
  const sessions = new Map((await tbl('workout_sessions').toArray()).map((s) => [s.id, s]));
  const rows = (await tbl('set_records').toArray()).filter((r) => !r.deleted_at).sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : a.set_number - b.set_number));
  const cols = ['session_date', 'session', 'exercise', 'set_number', 'set_type', 'status', 'side', 'planned_weight_kg', 'planned_reps_min', 'planned_reps_max', 'weight_kg', 'reps', 'reps_partial', 'duration_s', 'distance_m', 'rir', 'rpe', 'failure', 'tempo', 'rest_before_s', 'note'];
  const lines = rows.map((r) => {
    const rec = r as unknown as Record<string, unknown>;
    return cols.map((c) => csvCell(c === 'session' ? sessions.get(r.session_id)?.name : c === 'exercise' ? exs.get(r.exercise_id) : rec[c])).join(',');
  });
  return [cols.join(','), ...lines].join('\n');
}

// ── Rolling snapshots ───────────────────────────────────────────────────────
const SNAP_DIR = 'backups';
const KEEP_DAILY = 7;
const KEEP_PRE_RESTORE = 3;

export interface SnapshotInfo { name: string; reason: string; at: string; size: number }
const snapName = (reason: string, at: string): string => `snap-${at.replace(/[:.]/g, '-')}-${reason}.json`;
const parseName = (name: string): { reason: string; at: string } | null => {
  const m = name.match(/^snap-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z-]+)\.json$/);
  return m ? { at: m[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z'), reason: m[2]! } : null;
};

async function idbWrite(name: string, text: string): Promise<void> { await setMeta(`snapshot:${name}`, text); }
async function idbRead(name: string): Promise<string | null> { return getMeta<string | null>(`snapshot:${name}`, null); }
async function idbList(): Promise<{ name: string; size: number }[]> {
  const rows = await db.meta.where('key').startsWith('snapshot:').toArray();
  return rows.map((r) => ({ name: r.key.slice('snapshot:'.length), size: String(r.value).length }));
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const seen = new Map<string, SnapshotInfo>();
  const add = (name: string, size: number): void => {
    const p = parseName(name);
    if (p && !seen.has(name)) seen.set(name, { name, reason: p.reason, at: p.at, size });
  };
  for (const f of await idbList()) add(f.name, f.size);
  if (isNative()) for (const f of await nativeList(SNAP_DIR)) add(f.name, f.size);
  return [...seen.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

async function prune(): Promise<void> {
  const all = await listSnapshots();
  const drop = [...all.filter((s) => s.reason === 'daily').slice(KEEP_DAILY), ...all.filter((s) => s.reason === 'pre-restore').slice(KEEP_PRE_RESTORE)];
  for (const s of drop) {
    await db.meta.delete(`snapshot:${s.name}`);
    if (isNative()) { try { await nativeRemove(SNAP_DIR, s.name); } catch { /* already gone */ } }
  }
}

export async function createSnapshot(reason: 'daily' | 'pre-restore' | 'manual'): Promise<SnapshotInfo> {
  const text = JSON.stringify(await exportBackup());
  const at = nowIso();
  const name = snapName(reason, at);
  await idbWrite(name, text);
  if (isNative()) { try { await nativeWrite(SNAP_DIR, name, text); } catch { /* the in-app copy still exists */ } }
  await setMeta('last_snapshot_at', at);
  await prune();
  return { name, reason, at, size: text.length };
}

/** Called at launch and on resume: at most one daily snapshot per ~20 hours, and only when there is data worth keeping. */
export async function maybeDailySnapshot(): Promise<SnapshotInfo | null> {
  const last = await getMeta<string | null>('last_snapshot_at', null);
  if (last && Date.parse(nowIso()) - Date.parse(last) < 20 * 3600 * 1000) return null;
  if ((await tbl('workout_sessions').count()) === 0 && (await tbl('programs').count()) === 0) return null;
  return createSnapshot('daily');
}

export async function readSnapshot(name: string): Promise<BackupFile> {
  const text = (await idbRead(name)) ?? (isNative() ? await nativeRead(SNAP_DIR, name) : null);
  if (!text) throw new BackupFormatError('Snapshot not found.');
  return parseBackup(text);
}
