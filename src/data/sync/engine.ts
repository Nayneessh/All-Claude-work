import type { TableName } from '@/domain/types';
import { SYNC_ORDER } from '@/domain/types';
import { allTables, db, getMeta, setMeta, tbl, type Row } from '../db';
import { nowIso, runtime } from '../runtime';
import { strip } from '../write';
import { type ConflictNote, NIL_UUID, type PullCursor, type Remote, type RemoteRow, SyncError, type SyncSnapshot } from './types';

/**
 * Local-first sync (documented in docs/ARCHITECTURE.md → Synchronisation).
 *  - Every local write marks the row dirty. Push upserts dirty rows by primary key — replays are harmless, so retries
 *    never duplicate a workout or a set. A row stays dirty until the server acknowledged exactly that version.
 *  - Conflicts are deterministic last-writer-wins on client_updated_at (enforced identically by the server trigger).
 *    When a newer remote edit replaces an un-pushed local edit, the overwritten values are kept in a conflict log.
 *  - Pull is keyset-paginated by (server_updated_at, id) with a 2-minute look-back to tolerate late-committing writes.
 *  - Nothing is ever hard-deleted; deletions are soft-delete updates that sync like any other edit.
 */
const BATCH: Partial<Record<TableName, number>> = { set_records: 200, audit_events: 200 };
const PULL_PAGE = 500;
const LOOKBACK_MS = 120_000;
const MAX_CONFLICTS = 100;

interface FailureMap { [key: string]: { message: string; stamp: string } }

const isSyncable = (table: TableName, r: Row<TableName>): boolean => {
  if (table === 'exercises' && (r as Row<'exercises'>).seed_key) return false; // built-in library: read-only, never pushed
  return r.user_id !== null && r.user_id === runtime.userId;
};

export async function pendingCount(): Promise<number> {
  let n = 0;
  for (const t of SYNC_ORDER) {
    const rows = await tbl(t).where('_dirty').equals(1).toArray();
    n += rows.filter((r) => !(t === 'exercises' && (r as Row<'exercises'>).seed_key)).length;
  }
  return n;
}

export async function loadFailures(): Promise<FailureMap> { return getMeta<FailureMap>('sync_failures', {}); }
export async function loadConflicts(): Promise<ConflictNote[]> { return getMeta<ConflictNote[]>('sync_conflicts', []); }
export async function clearConflicts(): Promise<void> { await setMeta('sync_conflicts', []); }
/** Forget held-back rows so they are attempted again (e.g. after the server-side problem was fixed). */
export async function retryFailures(): Promise<void> { await setMeta('sync_failures', {}); }

async function ack(table: TableName, pushed: Row<TableName>[]): Promise<void> {
  await db.transaction('rw', tbl(table), async () => {
    const t = tbl(table);
    const now = await t.bulkGet(pushed.map((p) => p.id));
    const clean: Row<TableName>[] = [];
    pushed.forEach((p, i) => {
      const cur = now[i];
      // only acknowledge the exact version that was sent; an edit made while the request was in flight stays dirty
      if (cur && cur.client_updated_at === p.client_updated_at) clean.push({ ...cur, _dirty: 0 });
    });
    if (clean.length) await t.bulkPut(clean as never);
  });
}

export interface PushResult { pushed: number; failed: number; retryableError: SyncError | null }

export async function pushAll(remote: Remote): Promise<PushResult> {
  const failures = await loadFailures();
  let pushed = 0, failed = 0;
  let retryable: SyncError | null = null;
  for (const table of SYNC_ORDER) {
    const dirty = (await tbl(table).where('_dirty').equals(1).toArray()).filter((r) => isSyncable(table, r) && !(failures[`${table}:${r.id}`] && failures[`${table}:${r.id}`]!.stamp === r.client_updated_at));
    const size = BATCH[table] ?? 100;
    for (let i = 0; i < dirty.length; i += size) {
      const batch = dirty.slice(i, i + size);
      try {
        await remote.upsert(table, batch.map((r) => strip(r) as unknown as RemoteRow));
        await ack(table, batch);
        pushed += batch.length;
      } catch (e) {
        const err = e instanceof SyncError ? e : new SyncError(e instanceof Error ? e.message : String(e), true);
        if (err.retryable) { retryable = err; return { pushed, failed, retryableError: retryable }; }
        // A constraint/RLS rejection: isolate the offending row(s) so one bad record can never block the rest.
        for (const row of batch) {
          try {
            await remote.upsert(table, [strip(row) as unknown as RemoteRow]);
            await ack(table, [row]);
            pushed += 1;
          } catch (e2) {
            const err2 = e2 instanceof SyncError ? e2 : new SyncError(e2 instanceof Error ? e2.message : String(e2), true);
            if (err2.retryable) return { pushed, failed, retryableError: err2 };
            failures[`${table}:${row.id}`] = { message: err2.message, stamp: row.client_updated_at };
            failed += 1;
          }
        }
        await setMeta('sync_failures', failures);
      }
    }
  }
  // drop failure records whose row has since been edited or removed
  await setMeta('sync_failures', failures);
  return { pushed, failed, retryableError: retryable };
}

const ts = (s: unknown): number => Date.parse(String(s));

async function applyRemote(table: TableName, rows: RemoteRow[]): Promise<number> {
  if (!rows.length) return 0;
  let applied = 0;
  const conflicts: ConflictNote[] = [];
  await db.transaction('rw', tbl(table), async () => {
    const t = tbl(table);
    const local = await t.bulkGet(rows.map((r) => String(r.id)));
    const puts: Row<TableName>[] = [];
    rows.forEach((remote, i) => {
      const cur = local[i];
      const incoming = { ...remote, _dirty: 0 } as unknown as Row<TableName>;
      if (!cur) { puts.push(incoming); applied++; return; }
      const remoteNewer = ts(remote.client_updated_at) > ts(cur.client_updated_at);
      const equal = ts(remote.client_updated_at) === ts(cur.client_updated_at);
      if (cur._dirty === 0) {
        if (remoteNewer || equal) { puts.push(incoming); applied++; }
      } else if (remoteNewer) {
        // a newer edit from another device replaces an un-pushed local edit: keep the overwritten values on record
        const { _dirty: _d, ...lost } = cur as Row<TableName> & Record<string, unknown>;
        void _d;
        conflicts.push({ table, id: cur.id, at: nowIso(), lost: lost as Record<string, unknown>, kept: 'remote' });
        puts.push(incoming); applied++;
      } // else: the local edit is newer or equal → keep it dirty; it will win on the next push
    });
    if (puts.length) await t.bulkPut(puts as never);
  });
  if (conflicts.length) {
    const all = [...conflicts, ...(await loadConflicts())].slice(0, MAX_CONFLICTS);
    await setMeta('sync_conflicts', all);
  }
  return applied;
}

export async function pullAll(remote: Remote): Promise<number> {
  let total = 0;
  for (const table of SYNC_ORDER) {
    let cursor = await getMeta<PullCursor | null>(`pull_cursor:${table}`, null);
    if (cursor && !cursor.id) cursor = { ...cursor, id: NIL_UUID }; // cursors saved by earlier builds used '' (invalid uuid)
    for (;;) {
      const rows = await remote.pull(table, cursor, PULL_PAGE);
      if (!rows.length) break;
      total += await applyRemote(table, rows);
      const last = rows[rows.length - 1]!;
      cursor = { ts: String(last.server_updated_at), id: String(last.id) };
      if (rows.length < PULL_PAGE) break;
    }
    if (cursor) {
      // persist a cursor slightly in the past so a transaction that committed late is picked up on the next pull
      const back = new Date(ts(cursor.ts) - LOOKBACK_MS).toISOString();
      const prev = await getMeta<PullCursor | null>(`pull_cursor:${table}`, null);
      const next: PullCursor = prev && ts(prev.ts) > ts(back) ? prev : { ts: back, id: NIL_UUID };
      await setMeta(`pull_cursor:${table}`, next);
    }
  }
  return total;
}

export interface SyncOutcome { pushed: number; pulled: number; failed: number; error: SyncError | null }

/** One full cycle: pull remote changes first (so we never push over something newer unknowingly), then push. */
export async function syncOnce(remote: Remote): Promise<SyncOutcome> {
  try {
    const pulled = await pullAll(remote);
    const res = await pushAll(remote);
    if (res.retryableError) return { pushed: res.pushed, pulled, failed: res.failed, error: res.retryableError };
    await setMeta('last_sync_at', nowIso());
    return { pushed: res.pushed, pulled, failed: res.failed, error: null };
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError(e instanceof Error ? e.message : String(e), true);
    return { pushed: 0, pulled: 0, failed: 0, error: err };
  }
}

/**
 * First sign-in on this device: every locally created row (user_id still null) becomes the user's.
 * If the account already has a profile on the server (second device / reinstall), the untouched local placeholder is dropped
 * so a fresh default profile can never overwrite the real one.
 */
export async function claimLocalData(userId: string): Promise<{ claimed: number }> {
  let claimed = 0;
  await db.transaction('rw', allTables(), async () => {
    for (const table of SYNC_ORDER) {
      const t = tbl(table);
      const rows = (await t.toArray()).filter((r) => r.user_id === null && !(table === 'exercises' && (r as Row<'exercises'>).seed_key));
      for (const r of rows) {
        if (table === 'profiles') continue;
        await t.put({ ...r, user_id: userId, _dirty: 1 } as never);
        claimed++;
      }
    }
    const profiles = await tbl('profiles').toArray();
    const mine = profiles.find((p) => p.id === userId);
    for (const p of profiles.filter((x) => x.id !== userId)) {
      await tbl('profiles').delete(p.id); // local-only placeholder row (never synced under this id)
      // keep the local profile only if the user actually completed onboarding here AND it is newer than the server copy
      const localWins = p.onboarding_done && (!mine || ts(p.client_updated_at) > ts(mine.client_updated_at));
      if (localWins) { await tbl('profiles').put({ ...p, id: userId, user_id: userId, _dirty: 1 } as never); claimed++; }
    }
  });
  runtime.userId = userId;
  return { claimed };
}

export async function snapshotOf(status: SyncSnapshot['status'], lastError: string | null): Promise<SyncSnapshot> {
  const failures = Object.keys(await loadFailures()).length;
  return { status, pending: await pendingCount(), lastSyncAt: await getMeta<string | null>('last_sync_at', null), lastError, failures, conflicts: (await loadConflicts()).length };
}
