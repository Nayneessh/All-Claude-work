// Retention policy. Defaults follow the blueprint's proposed rules and are configurable.
// These are PROPOSED values that need legal validation before public launch.

export interface RetentionPolicy {
  /** Unbooked cases: everything is deleted this many hours after creation. */
  unbookedHours: number;
  /** Booked cases: deleted this many days after the case is closed. */
  closedDays: number;
  /** How long deleted data may survive in encrypted backups. Documented, not enforced by code. */
  backupPurgeDays: number;
  captureSessionMinutes: number;
  linkDaysBooked: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  unbookedHours: 72,
  closedDays: 90,
  backupPurgeDays: 7,
  captureSessionMinutes: 15,
  linkDaysBooked: 90,
};

const H = 3600_000;
const D = 24 * H;

export function unbookedDeadline(createdAt: Date, p: RetentionPolicy): Date {
  return new Date(createdAt.getTime() + p.unbookedHours * H);
}

/** Booked cases stay until closed plus N days; an open booked case has no deadline yet. */
export function bookedDeadline(closedAt: Date | null, p: RetentionPolicy): Date | null {
  return closedAt ? new Date(closedAt.getTime() + p.closedDays * D) : null;
}

export function isExpired(
  c: { createdAt: Date; booked: boolean; closedAt: Date | null },
  p: RetentionPolicy,
  now: Date,
): boolean {
  if (!c.booked) return now >= unbookedDeadline(c.createdAt, p);
  const d = bookedDeadline(c.closedAt, p);
  return d ? now >= d : false;
}
