import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { TableName } from '@/domain/types';
import { NIL_UUID, type PullCursor, type Remote, type RemoteRow, SyncError } from './types';

/** Constraint / RLS / validation errors will never succeed on retry; everything else (network, 5xx, 429, expired token) will. */
export function toSyncError(e: PostgrestError | { message: string; code?: string; status?: number }): SyncError {
  const code = 'code' in e ? (e.code ?? '') : '';
  const status = 'status' in e ? e.status : undefined;
  const permanent = /^(23|22|42|P0001)/.test(code) && code !== 'PGRST301';
  const transient = !code || status === 429 || status === 408 || (status !== undefined && status >= 500) || code === 'PGRST301' || /fetch|network|timeout|load failed|abort/i.test(e.message);
  return new SyncError(e.message, transient && !permanent, code || undefined);
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async upsert(table: TableName, rows: RemoteRow[]): Promise<void> {
      try {
        const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
        if (error) throw toSyncError(error);
      } catch (e) {
        if (e instanceof SyncError) throw e;
        throw new SyncError(e instanceof Error ? e.message : String(e), true);
      }
    },
    async pull(table: TableName, cursor: PullCursor | null, limit: number): Promise<RemoteRow[]> {
      try {
        let q = client.from(table).select('*').order('server_updated_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
        if (cursor) q = q.or(`server_updated_at.gt.${cursor.ts},and(server_updated_at.eq.${cursor.ts},id.gt.${cursor.id || NIL_UUID})`);
        const { data, error } = await q;
        if (error) throw toSyncError(error);
        return (data ?? []) as RemoteRow[];
      } catch (e) {
        if (e instanceof SyncError) throw e;
        throw new SyncError(e instanceof Error ? e.message : String(e), true);
      }
    },
  };
}
