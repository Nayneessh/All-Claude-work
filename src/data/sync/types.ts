import type { TableName } from '@/domain/types';

export type RemoteRow = Record<string, unknown>;

/** Thrown by a Remote for failures the engine should retry (network, 5xx, 429) versus reject (constraint/RLS). */
export class SyncError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly code?: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** Smallest possible uuid — the id part of a cursor that has no row yet (an empty string is not a valid uuid in Postgres). */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export interface PullCursor { ts: string; id: string }

/** The server contract. Implemented by Supabase in production and by an in-memory server in tests. */
export interface Remote {
  /** Idempotent upsert by primary key. Stale writes (older client_updated_at) must be ignored by the server. */
  upsert(table: TableName, rows: RemoteRow[]): Promise<void>;
  /** Rows strictly after `cursor` ordered by (server_updated_at, id). */
  pull(table: TableName, cursor: PullCursor | null, limit: number): Promise<RemoteRow[]>;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'signed_out' | 'disabled';

export interface SyncSnapshot {
  status: SyncStatus;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  failures: number;
  conflicts: number;
}

export interface ConflictNote { table: TableName; id: string; at: string; lost: Record<string, unknown>; kept: 'remote' }
