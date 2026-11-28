// Pure decision logic for the reminder job (no I/O) so it can be unit-tested; the same recurrence engine as the app.
import { expandOccurrences, reminderMinutes } from '../_shared/recurrence.ts';
import { addDays, diffDays, fmtTime, fromMin, type DateStr } from '../_shared/time.ts';
import type { Task, TaskDone, TaskOverride } from '../_shared/types.ts';

export interface Note { key: string; kind: string; title: string; body: string; url: string }
/** Reminders whose time has passed within the grace window and whose task is not done. Dedupe keys are shared with the in-app watcher. */
export function dueTaskReminders(a: { today: DateStr; nowMin: number; tasks: Task[]; done: TaskDone[]; overrides: TaskOverride[]; graceMin?: number }): Note[] {
  const grace = a.graceMin ?? 180;
  const top = a.tasks.filter((t) => !t.parent_id && !t.archived_at);
  const out: Note[] = [];
  for (const o of expandOccurrences(top, a.overrides, a.done, a.today, a.today)) {
    if (o.done) continue;
    const r = reminderMinutes(o);
    const add = (kind: 'primary' | 'followup', at: number | null) => {
      if (at === null || a.nowMin < at || a.nowMin > at + grace) return;
      out.push({ key: `task:${o.task.id}:${o.originDay}:${kind}`, kind: 'task_reminder', url: '/slate',
        title: kind === 'primary' ? `⏰ ${o.task.title}` : `⏰ Still open: ${o.task.title}`,
        body: `${o.start ? `Scheduled ${fmtTime(o.start)} · ` : ''}${kind === 'primary' ? 'reminder' : 'follow-up reminder'} (${fromMin(at)})` });
    };
    add('primary', r.primary); add('followup', r.followup);
  }
  return out;
}

export interface MandateLite { id: string; title: string; company_name: string | null; urgency: string; status: string; last_activity_at: string | null; created_at: string }
const URG: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
/** One digest per day listing active mandates idle for `threshold`+ days, most urgent first. */
export function idleDigest(a: { today: DateStr; rows: MandateLite[]; threshold: number; dayOf: (iso: string) => DateStr }): Note | null {
  const idle = a.rows.filter((m) => m.status === 'active').map((m) => ({ m, idle: diffDays(a.today, a.dayOf(m.last_activity_at ?? m.created_at)) })).filter((x) => x.idle >= a.threshold)
    .sort((x, y) => (URG[y.m.urgency] ?? 0) - (URG[x.m.urgency] ?? 0) || y.idle - x.idle);
  if (!idle.length) return null;
  const top = idle.slice(0, 3).map((x) => `${x.m.title}${x.m.company_name ? ' (' + x.m.company_name + ')' : ''} — ${x.idle}d`).join('; ');
  const crit = idle.filter((x) => x.m.urgency === 'Critical').length;
  return { key: `digest:idle:${a.today}`, kind: 'mandate_inactive', url: '/mandates?view=idle', title: `${crit ? '🔴 ' : '⚠️ '}${idle.length} mandate${idle.length === 1 ? '' : 's'} with no activity for ${a.threshold}+ days`, body: top + (idle.length > 3 ? ` and ${idle.length - 3} more` : '') };
}

export interface JoinerLite { assoc_id: string; name: string; mandate_title: string; joining_date: string | null; status: string }
/** Joining alerts N days before (default 7, 1, 0) for selected/offered candidates. */
export function joiningAlerts(a: { today: DateStr; rows: JoinerLite[]; alertDays: number[] }): Note[] {
  const out: Note[] = [];
  for (const r of a.rows) {
    if (!r.joining_date || !['selected', 'offered'].includes(r.status)) continue;
    const d = diffDays(r.joining_date, a.today);
    if (!a.alertDays.includes(d)) continue;
    out.push({ key: `join:${r.assoc_id}:${d}`, kind: 'joining_soon', url: '/', title: d === 0 ? `🎉 ${r.name} is due to join today` : `📅 ${r.name} joins in ${d} day${d === 1 ? '' : 's'}`, body: `${r.mandate_title} · ${r.joining_date}` });
  }
  return out;
}
export const retentionCutoff = (today: DateStr, days = 90): DateStr => addDays(today, -days);
