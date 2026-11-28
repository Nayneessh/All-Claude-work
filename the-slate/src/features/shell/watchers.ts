import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { K } from '../../data/hooks';
import { expandOccurrences, reminderMinutes } from '../../domain/recurrence';
import { minutesNowIn, todayIn, fmtTime, fromMin } from '../../lib/time';
import { useToast } from '../../ui/Toast';

/** Signs the user out after a period of no input (0 = never). */
export function useIdleLogout(minutes: number, signOut: () => Promise<void>) {
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last > minutes * 60_000) signOut(); }, 30_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [minutes, signOut]);
}

/**
 * In-app fallback for task reminders (the server `notify` job + web push is the primary channel and works with the app closed).
 * While the app is open this shows a toast the moment a reminder is due. The notification row uses the SAME dedupe key as the
 * server job, so a reminder is never announced twice.
 */
export function useReminderWatcher(tz: string, enabled: boolean) {
  const toast = useToast(); const qc = useQueryClient(); const busy = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = async () => {
      if (busy.current || document.hidden) return; busy.current = true;
      try {
        const today = todayIn(tz); const now = minutesNowIn(tz);
        const [tasks, done, ov] = await Promise.all([api.tasks(), api.done(today, today), api.overrides(today, today)]);
        const occ = expandOccurrences(tasks.filter((t) => !t.parent_id), ov, done, today, today).filter((o) => !o.done);
        for (const o of occ) {
          const r = reminderMinutes(o);
          const fire = async (kind: 'primary' | 'followup', at: number | null) => {
            if (at === null || now < at || now > at + 180) return;
            const title = kind === 'primary' ? `⏰ ${o.task.title}` : `⏰ Still open: ${o.task.title}`;
            const body = o.start ? `Scheduled ${fmtTime(o.start)} · ${kind === 'primary' ? 'reminder' : 'follow-up reminder'}` : 'Reminder';
            const created = await api.localNotice({ kind: 'task_reminder', title, body, link: '/slate', dedupe: `task:${o.task.id}:${o.originDay}:${kind}` });
            if (created) { toast.warn(`${title} (${fromMin(at)})`); qc.invalidateQueries({ queryKey: K.notifications }); }
          };
          await fire('primary', r.primary); await fire('followup', r.followup);
        }
      } catch { /* a failed tick must never disturb the user */ } finally { busy.current = false; }
    };
    const first = setTimeout(tick, 4000); const t = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [tz, enabled, toast, qc]);
}
