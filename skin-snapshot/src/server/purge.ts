// Retention and housekeeping. Called by a scheduler (Vercel Cron today, system cron later)
// and opportunistically. Every step is idempotent.
import * as repo from '../data/repo';
import type { Deps } from './deps';
import { deleteCaseFully, drainStorageDeletions } from './service';
import { log } from './analysis';

export interface PurgeReport {
  expiredCases: number;
  storageDeleted: number;
  orphanObjects: number;
  stalledAnalyses: number;
}

export async function runPurge(deps: Deps): Promise<PurgeReport> {
  let expiredCases = 0;
  for (;;) {
    const batch = await repo.expiredCases(deps.db, 100);
    if (!batch.length) break;
    for (const c of batch) {
      await deleteCaseFully(deps, c, 'retention_expired');
      expiredCases++;
    }
  }
  let storageDeleted = await drainStorageDeletions(deps);
  let orphanObjects = 0;
  if (deps.store.kind === 'postgres') {
    for (const { key } of await repo.orphanObjectKeys(deps.db)) {
      await deps.store.delete(key);
      orphanObjects++;
    }
  }
  const stalled = await repo.staleAnalyses(deps.db);
  for (const s of stalled) {
    await repo.finishAnalysis(deps.db, s.id, { status: 'failed', errorCode: 'stalled' });
    await deps.db.query(`update ss.cases set stage='analysis_failed' where id=$1 and stage='analysing'`, [s.case_id]);
  }
  await repo.purgeExpiredRateLimits(deps.db);
  await repo.purgeExpiredCaptureSessions(deps.db);
  storageDeleted += await drainStorageDeletions(deps);
  const report = { expiredCases, storageDeleted, orphanObjects, stalledAnalyses: stalled.length };
  log('purge.done', report as unknown as Record<string, unknown>);
  return report;
}
