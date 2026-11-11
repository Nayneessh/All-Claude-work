import type { Rubric } from './types';

/**
 * Write guards (plan §10 "immutable audit history", "versioned assessments", §4.3 "AI must not silently change an approved
 * rubric"). Enforced in the local repository and mirrored by Postgres triggers in the migration.
 */

export class ImmutableRecordError extends Error {
  constructor(public readonly table: string, public readonly id: string) {
    super(`${table} records are append-only: "${id}" already exists and cannot be modified. Create a new version or a new decision instead.`);
    this.name = 'ImmutableRecordError';
  }
}

export const APPEND_ONLY: ReadonlySet<string> = new Set(['assessments', 'audit_logs', 'decisions', 'mandate_versions']);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Throws if `next` is not an allowed change to `existing` for this table. `existing` is undefined for inserts. */
export function guardWrite<T extends { id: string }>(table: string, existing: T | undefined, next: T): void {
  if (!existing) return;
  if (APPEND_ONLY.has(table)) throw new ImmutableRecordError(table, next.id);

  if (table === 'rubrics') {
    const a = existing as unknown as Rubric;
    const b = next as unknown as Rubric;
    if (a.status === 'draft') return; // drafts are freely editable and may be approved
    // An approved rubric may only be retired (approved → superseded); its content never changes.
    const frozen = same(a.criteria, b.criteria) && same(a.gates, b.gates) && same(a.policy, b.policy) && same(a.version, b.version)
      && same(a.mandateId, b.mandateId) && same(a.roleIntelligence, b.roleIntelligence);
    const okStatus = a.status === b.status || (a.status === 'approved' && b.status === 'superseded');
    if (!frozen || !okStatus) throw new ImmutableRecordError('rubrics (approved)', next.id);
  }
}
