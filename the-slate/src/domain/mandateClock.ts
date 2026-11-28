import { dayOf, diffDays, type DateStr } from '../lib/time';
import type { MandateRow, Urgency } from './types';

/**
 * THE 30-DAY MANDATE CLOCK
 * ------------------------------------------------------------------------------------------------
 * - The clock starts when the Work Start Date (`started_on`) is entered; day 1 is that date.
 * - "Meaningful activity" is whatever the database trigger layer records in `recruitment_activities`
 *   (candidate added, stage change, comment, checklist step done/waiting, interview update, JD upload/replace,
 *   consultant assigned/shared, status change…). Page views are never recorded, so they can never reset the clock.
 *   `mandates.last_activity_at` is the newest meaningful event.
 * - A mandate is INACTIVE when it is open and has had no meaningful activity for `inactivityDays` (default 5) days.
 * - The inactivity alert is always raised at that threshold; its SEVERITY follows urgency
 *   (Critical→critical, High→high, Medium→warning, Low→info) and is raised one notch when the idle time doubles.
 */
export const CLOCK_DAYS = 30;

export type ClockState = 'active' | 'inactive' | 'on_hold' | 'overdue' | 'closed';
export type AlertLevel = 'info' | 'warning' | 'high' | 'critical';
export const ALERT_ORDER: AlertLevel[] = ['info', 'warning', 'high', 'critical'];

export interface ClockOptions { today: DateStr; tz?: string; inactivityDays?: number; nearCloseDays?: number }
export interface ClockInfo {
  state: ClockState;
  /** True once a Work Start Date exists. */
  clockStarted: boolean;
  /** Days since work started (or since the mandate was received/created when the clock has not started). */
  daysOpen: number;
  /** 1-based day of the 30-day clock, null until it starts. */
  clockDay: number | null;
  /** 0..1 progress through the 30-day window. */
  clockProgress: number;
  clockExpired: boolean;
  idleDays: number;
  daysToClose: number | null;
  overdueDays: number;
  nearClose: boolean;
  /** Open for 30+ days AND currently idle: the "stalled" condition. */
  stalled: boolean;
  alerts: ClockAlert[];
}
export interface ClockAlert { kind: 'inactive' | 'overdue' | 'no_candidates' | 'near_close' | 'clock_expired'; level: AlertLevel; message: string }

const isOpen = (m: Pick<MandateRow, 'status'>) => m.status === 'active' || m.status === 'on_hold';

export function raise(level: AlertLevel, steps = 1): AlertLevel {
  return ALERT_ORDER[Math.min(ALERT_ORDER.length - 1, ALERT_ORDER.indexOf(level) + steps)];
}
export function inactivityLevel(urgency: Urgency, idleDays: number, threshold: number): AlertLevel {
  const base: AlertLevel = { Critical: 'critical', High: 'high', Medium: 'warning', Low: 'info' }[urgency] as AlertLevel;
  return idleDays >= threshold * 2 ? raise(base) : base;
}

export function computeClock(m: MandateRow, o: ClockOptions): ClockInfo {
  const threshold = o.inactivityDays ?? 5;
  const nearDays = o.nearCloseDays ?? 7;
  const tz = o.tz;
  const clockStarted = !!m.started_on;
  const basis = m.started_on ?? m.received_on ?? dayOf(m.created_at, tz);
  const daysOpen = Math.max(0, diffDays(o.today, basis));
  const lastActivityDay = dayOf(m.last_activity_at ?? m.created_at, tz);
  const idleDays = Math.max(0, diffDays(o.today, lastActivityDay));
  const daysToClose = m.target_close ? diffDays(m.target_close, o.today) : null;
  const open = isOpen(m);
  const overdue = open && daysToClose !== null && daysToClose < 0;
  const overdueDays = overdue ? -daysToClose! : 0;
  const nearClose = open && daysToClose !== null && daysToClose >= 0 && daysToClose <= nearDays;
  const idle = m.status === 'active' && idleDays >= threshold;

  let state: ClockState;
  if (!open) state = 'closed';
  else if (m.status === 'on_hold') state = 'on_hold';
  else if (overdue) state = 'overdue';
  else if (idle) state = 'inactive';
  else state = 'active';

  const stalled = open && m.status === 'active' && daysOpen >= CLOCK_DAYS && idleDays >= threshold;
  const alerts: ClockAlert[] = [];
  if (idle) {
    alerts.push({ kind: 'inactive', level: inactivityLevel(m.urgency, idleDays, threshold),
      message: `No meaningful activity for ${idleDays} day${idleDays === 1 ? '' : 's'} · ${m.urgency} urgency` });
  }
  if (overdue) {
    alerts.push({ kind: 'overdue', level: m.urgency === 'Critical' || m.urgency === 'High' ? 'critical' : 'high', message: `${overdueDays} day${overdueDays === 1 ? '' : 's'} past target close date` });
  }
  if (m.status === 'active' && m.candidate_total === 0 && daysOpen >= 3) {
    alerts.push({ kind: 'no_candidates', level: m.urgency === 'Critical' ? 'high' : 'warning', message: `No candidates added after ${daysOpen} days` });
  }
  if (nearClose) {
    alerts.push({ kind: 'near_close', level: 'warning', message: daysToClose === 0 ? 'Target close date is today' : `Target close in ${daysToClose} day${daysToClose === 1 ? '' : 's'}` });
  }
  if (clockStarted && open && daysOpen >= CLOCK_DAYS && m.joined_count < m.positions) {
    alerts.push({ kind: 'clock_expired', level: 'warning', message: `30-day clock completed (day ${daysOpen + 1})` });
  }
  alerts.sort((a, b) => ALERT_ORDER.indexOf(b.level) - ALERT_ORDER.indexOf(a.level));

  return {
    state, clockStarted, daysOpen, clockDay: clockStarted ? daysOpen + 1 : null,
    clockProgress: clockStarted ? Math.min(1, daysOpen / CLOCK_DAYS) : 0, clockExpired: clockStarted && daysOpen >= CLOCK_DAYS,
    idleDays, daysToClose, overdueDays, nearClose, stalled, alerts,
  };
}

export const topAlert = (c: ClockInfo): ClockAlert | null => c.alerts[0] ?? null;

// ------------------------------------------------------------------------------------------------
// COLOUR BAND (primary status indicator on every mandate card)
// ------------------------------------------------------------------------------------------------
export type BandKey = 'stalled' | 'critical' | 'joined' | 'offered' | 'selected' | 'shared' | 'closed' | 'none';
/** Highest precedence first. Negative signals outrank progress; progress ranks by closeness to the outcome; "shared" is informational. */
export const BAND_PRECEDENCE: BandKey[] = ['stalled', 'critical', 'joined', 'offered', 'selected', 'shared'];
export const BAND_META: Record<BandKey, { label: string; colorVar: string; hint: string }> = {
  stalled: { label: 'Stalled', colorVar: '--band-stalled', hint: 'Open 30+ days with no meaningful activity' },
  critical: { label: 'Critical', colorVar: '--band-critical', hint: 'Critical mandate' },
  joined: { label: 'Joined', colorVar: '--band-joined', hint: 'A candidate has joined' },
  offered: { label: 'Offered', colorVar: '--band-offered', hint: 'A candidate has been offered' },
  selected: { label: 'Selected', colorVar: '--band-selected', hint: 'A candidate has been selected' },
  shared: { label: 'With consultant', colorVar: '--band-shared', hint: 'Shared with an external consultant' },
  closed: { label: 'Closed', colorVar: '--band-closed', hint: 'Mandate closed' },
  none: { label: 'In progress', colorVar: '--band-none', hint: 'No special status' },
};
export interface Band { primary: BandKey; secondary: BandKey[] }

export function computeBand(m: MandateRow, clock: ClockInfo): Band {
  const open = m.status === 'active' || m.status === 'on_hold';
  const hit = new Set<BandKey>();
  if (open && clock.stalled) hit.add('stalled');
  if (open && m.urgency === 'Critical') hit.add('critical');
  if (m.joined_count > 0) hit.add('joined');
  if (m.offered_count > 0) hit.add('offered');
  if (m.selected_count > 0) hit.add('selected');
  if (m.shared_count > 0) hit.add('shared');
  const ordered = BAND_PRECEDENCE.filter((k) => hit.has(k));
  if (ordered.length === 0) return { primary: open ? 'none' : 'closed', secondary: [] };
  return { primary: ordered[0], secondary: ordered.slice(1) };
}
