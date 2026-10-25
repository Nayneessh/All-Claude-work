import type { TableName } from '@/domain/types';
import { type PullCursor, type Remote, type RemoteRow, SyncError } from '@/data/sync/types';

/**
 * In-memory server that enforces the same rules as the Postgres migration:
 *  - ownership (RLS), idempotent upsert by id, last-writer-wins on client_updated_at (stale writes ignored),
 *  - server_updated_at assigned by the server (monotonic), unique dedupe_key for sessions, and no deletes.
 */
export class FakeServer {
  rows = new Map<TableName, Map<string, RemoteRow>>();
  clock = 0;
  upsertCalls = 0;
  failNext: SyncError | null = null;
  offline = false;
  constructor(public userId: string) {}

  private tbl(t: TableName): Map<string, RemoteRow> {
    if (!this.rows.has(t)) this.rows.set(t, new Map());
    return this.rows.get(t) as Map<string, RemoteRow>;
  }
  private stamp(): string {
    const n = ++this.clock;
    return `2026-10-26T10:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000000+00:00`;
  }
  get(t: TableName, id: string): RemoteRow | undefined { return this.tbl(t).get(id); }
  count(t: TableName): number { return this.tbl(t).size; }

  /** A write made by another device (already newer on the server). */
  injectRemote(t: TableName, row: RemoteRow): void { this.tbl(t).set(String(row.id), { ...row, user_id: this.userId, server_updated_at: this.stamp() }); }

  remote(): Remote {
    return {
      upsert: async (t, batch) => {
        this.upsertCalls++;
        if (this.offline) throw new SyncError('Failed to fetch', true);
        if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
        // statement-level atomicity: validate everything first
        for (const r of batch) {
          if (r.user_id !== this.userId) throw new SyncError('new row violates row-level security policy', false, '42501');
          const cur = this.tbl(t).get(String(r.id));
          if (cur && cur.user_id !== this.userId) throw new SyncError('row-level security (USING)', false, '42501');
          if (t === 'workout_sessions' && r.dedupe_key) {
            const dup = [...this.tbl(t).values()].find((x) => x.dedupe_key === r.dedupe_key && x.id !== r.id && !x.deleted_at);
            if (dup) throw new SyncError('duplicate key value violates unique constraint "workout_sessions_dedupe_idx"', false, '23505');
          }
          if (t === 'set_records' && !this.tbl('session_exercises').has(String(r.session_exercise_id))) throw new SyncError('violates foreign key constraint', false, '23503');
          if (t === 'session_exercises' && !this.tbl('workout_sessions').has(String(r.session_id))) throw new SyncError('violates foreign key constraint', false, '23503');
          if (typeof r.reps === 'number' && (r.reps < 0 || r.reps > 1000)) throw new SyncError('violates check constraint', false, '23514');
        }
        for (const r of batch) {
          const cur = this.tbl(t).get(String(r.id));
          if (cur && Date.parse(String(r.client_updated_at)) < Date.parse(String(cur.client_updated_at))) continue; // stale: ignored by the trigger
          this.tbl(t).set(String(r.id), { ...r, server_updated_at: this.stamp() });
        }
      },
      pull: async (t, cursor: PullCursor | null, limit) => {
        if (this.offline) throw new SyncError('Failed to fetch', true);
        const rows = [...this.tbl(t).values()]
          .filter((r) => r.user_id === this.userId || r.user_id === null)
          .filter((r) => !cursor || String(r.server_updated_at) > cursor.ts || (String(r.server_updated_at) === cursor.ts && String(r.id) > cursor.id))
          .sort((a, b) => String(a.server_updated_at).localeCompare(String(b.server_updated_at)) || String(a.id).localeCompare(String(b.id)));
        return rows.slice(0, limit).map((r) => ({ ...r }));
      },
    };
  }
}
