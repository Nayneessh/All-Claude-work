import { runtime } from '../runtime';
import { clearConflicts, pendingCount, snapshotOf, syncOnce } from './engine';
import type { Remote, SyncSnapshot, SyncStatus } from './types';

export interface ManagerDeps {
  remote: () => Remote | null;       // null → not signed in / cloud not configured
  online: () => boolean;
  schedule: (fn: () => void, ms: number) => () => void;
  disabled?: boolean;
  /** Runs after a cycle that finished without error (e.g. upload photos that were taken offline). Failures here never fail the sync. */
  afterSync?: () => Promise<void>;
}

/**
 * Orchestrates syncing: debounced trigger on local changes, immediate on reconnect / resume / sign-in, exponential backoff on
 * transient failures (5 s → 5 min). Pure scheduling logic — all I/O is injected, so it is unit-testable.
 */
export function createSyncManager(deps: ManagerDeps) {
  let snapshot: SyncSnapshot = { status: deps.disabled ? 'disabled' : 'idle', pending: 0, lastSyncAt: null, lastError: null, failures: 0, conflicts: 0 };
  const listeners = new Set<(s: SyncSnapshot) => void>();
  let running = false;
  let rerun = false;
  let attempt = 0;
  let cancelTimer: (() => void) | null = null;

  const emit = async (status: SyncStatus, lastError: string | null): Promise<void> => {
    snapshot = await snapshotOf(status, lastError);
    listeners.forEach((l) => l(snapshot));
  };

  const arm = (ms: number): void => {
    cancelTimer?.();
    cancelTimer = deps.schedule(() => { cancelTimer = null; void run(); }, ms);
  };

  async function run(): Promise<SyncSnapshot> {
    if (running) { rerun = true; return snapshot; }
    const remote = deps.remote();
    if (deps.disabled) { await emit('disabled', null); return snapshot; }
    if (!remote || !runtime.userId) { await emit('signed_out', null); return snapshot; }
    if (!deps.online()) { await emit('offline', null); return snapshot; }
    running = true;
    try {
      await emit('syncing', snapshot.lastError);
      const res = await syncOnce(remote);
      if (res.error) {
        attempt += 1;
        await emit(deps.online() ? 'error' : 'offline', res.error.message);
        arm(Math.min(300_000, 5_000 * 2 ** (attempt - 1)));
      } else {
        attempt = 0;
        try { await deps.afterSync?.(); } catch { /* optional extras (photos) retry on the next cycle */ }
        await emit('idle', null);
      }
    } finally {
      running = false;
    }
    if (rerun) { rerun = false; arm(250); }
    return snapshot;
  }

  return {
    get snapshot(): SyncSnapshot { return snapshot; },
    subscribe(fn: (s: SyncSnapshot) => void): () => void { listeners.add(fn); fn(snapshot); return () => listeners.delete(fn); },
    /** A local write happened: sync shortly (debounced), not once per keystroke. */
    notifyLocalChange(): void { if (!running) arm(3_000); else rerun = true; },
    /** Reconnect, app resume, sign-in or the "Sync now" button. */
    syncNow: run,
    async refresh(): Promise<void> { await emit(snapshot.status, snapshot.lastError); },
    clearConflictLog: async (): Promise<void> => { await clearConflicts(); await emit(snapshot.status, snapshot.lastError); },
    pending: pendingCount,
    stop(): void { cancelTimer?.(); cancelTimer = null; },
  };
}

export type SyncManager = ReturnType<typeof createSyncManager>;
