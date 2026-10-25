import { insert } from './write';
import { nowIso } from './runtime';

/** Significant edits and historical corrections leave an append-only audit event (same transaction as the change). */
export async function audit(entityType: string, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string | null = null): Promise<void> {
  await insert('audit_events', { entity_type: entityType, entity_id: entityId, action, before, after, reason, occurred_at: nowIso() });
}

/** Only the fields that actually changed, for compact before/after records. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: T): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (['client_updated_at', 'updated_at', '_dirty', 'server_updated_at'].includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k] ?? null; a[k] = after[k] ?? null; }
  }
  return { before: b, after: a };
}
