import type { SyncFields, TableMap, TableName } from '@/domain/types';
import { type Row, tbl } from './db';
import { newId, nowIso, runtime } from './runtime';

/**
 * The ONLY write path. Every mutation:
 *  - stamps client_updated_at (drives deterministic last-writer-wins on sync) and device_id
 *  - sets _dirty so the row is pushed (and re-pushed until acknowledged)
 *  - never deletes: removal is a soft delete (deleted_at) and history is preserved
 * Call inside `db.transaction('rw', …)` when several rows must change together.
 */
export type NewRow<T extends TableName> = Omit<TableMap[T], keyof SyncFields> & Partial<SyncFields>;

export function fresh<T extends TableName>(data: NewRow<T>): Row<T> {
  const t = nowIso();
  return {
    id: newId(),
    user_id: runtime.userId,
    created_at: t,
    deleted_at: null,
    ...data,
    client_updated_at: t,
    device_id: runtime.deviceId,
    _dirty: 1,
  } as unknown as Row<T>;
}

export async function insert<T extends TableName>(table: T, data: NewRow<T>): Promise<Row<T>> {
  const row = fresh<T>(data);
  await tbl(table).put(row);
  return row;
}

export async function update<T extends TableName>(table: T, id: string, patch: Partial<TableMap[T]>): Promise<Row<T>> {
  const t = tbl(table);
  const cur = await t.get(id);
  if (!cur) throw new Error(`${table}/${id} not found`);
  const next = { ...cur, ...patch, id: cur.id, user_id: cur.user_id, created_at: cur.created_at, client_updated_at: nowIso(), device_id: runtime.deviceId, _dirty: 1 } as Row<T>;
  await t.put(next);
  return next;
}

export async function softDelete<T extends TableName>(table: T, id: string): Promise<void> {
  await update(table, id, { deleted_at: nowIso() } as Partial<TableMap[T]>);
}

export async function restore<T extends TableName>(table: T, id: string): Promise<void> {
  await update(table, id, { deleted_at: null } as Partial<TableMap[T]>);
}

export const live = <T extends { deleted_at: string | null }>(rows: T[]): T[] => rows.filter((r) => !r.deleted_at);

export function strip<T extends Row<TableName>>(row: T): Omit<T, '_dirty' | 'server_updated_at'> {
  const { _dirty: _d, server_updated_at: _s, ...rest } = row as T & { server_updated_at?: unknown };
  void _d; void _s;
  return rest as Omit<T, '_dirty' | 'server_updated_at'>;
}
