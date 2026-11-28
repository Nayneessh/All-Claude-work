// Supabase Edge Function: notify  — the reminder engine. Called every 5 minutes by pg_cron (see supabase/hosted/).
// Sends task reminders / follow-ups, a daily "mandates going idle" digest and joining-date alerts, as web push
// (works with the app closed) AND as rows in `notifications` (the in-app bell). The unique dedupe_key makes every
// message at-most-once, even if the job overlaps or the in-app watcher already raised it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { dayOf, minutesNowIn, todayIn } from '../_shared/time.ts';
import type { Task, TaskDone, TaskOverride } from '../_shared/types.ts';
import { dueTaskReminders, idleDigest, joiningAlerts, retentionCutoff, type Note } from './logic.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: cfg } = await sb.from('push_config').select('key,value');
  const c: Record<string, string> = Object.fromEntries((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  if (!c.cron_secret || req.headers.get('x-cron-secret') !== c.cron_secret) return json({ error: 'unauthorised' }, 401);
  const pushOn = !!(c.vapid_private && c.vapid_public);
  if (pushOn) webpush.setVapidDetails(c.vapid_subject, c.vapid_public, c.vapid_private);

  const stats = { users: 0, created: 0, pushed: 0, errors: [] as string[] };
  const { data: list, error: lerr } = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (lerr) return json({ error: lerr.message }, 500);

  for (const u of list.users) {
    stats.users++;
    try {
      const { data: st } = await sb.from('app_settings').select('data').eq('user_id', u.id).maybeSingle();
      const s = ((st?.data as Record<string, unknown> | null)?.slate ?? {}) as Record<string, unknown>;
      const tz = typeof s.timezone === 'string' ? s.timezone : 'Asia/Kolkata';
      const threshold = typeof s.inactivityDays === 'number' ? s.inactivityDays : 5;
      const alertDays = Array.isArray(s.joiningAlertDays) ? (s.joiningAlertDays as number[]) : [7, 1, 0];
      const today = todayIn(tz); const nowMin = minutesNowIn(tz);
      const notes: Note[] = [];

      const [tasks, done, ov] = await Promise.all([
        sb.from('slate_tasks').select('*').eq('user_id', u.id).is('archived_at', null).not('reminder_time', 'is', null),
        sb.from('slate_done').select('task_id,day,completed_at,undone_at').eq('user_id', u.id).eq('day', today),
        sb.from('slate_overrides').select('id,task_id,day,new_day,start_time,sched_minutes').eq('user_id', u.id).or(`day.eq.${today},new_day.eq.${today}`),
      ]);
      notes.push(...dueTaskReminders({ today, nowMin, tasks: (tasks.data ?? []) as Task[], done: (done.data ?? []) as TaskDone[], overrides: (ov.data ?? []) as TaskOverride[] }));

      if (nowMin >= 8 * 60) { // morning-only items
        const { data: ms } = await sb.from('v_mandate_overview').select('id,title,company_name,urgency,status,last_activity_at,created_at').eq('user_id', u.id);
        const d = idleDigest({ today, rows: ms ?? [], threshold, dayOf: (iso) => dayOf(iso, tz) }); if (d) notes.push(d);
        const { data: js } = await sb.from('v_candidate_pipeline').select('association_id,name,mandate_title,joining_date,status').eq('user_id', u.id).not('joining_date', 'is', null);
        notes.push(...joiningAlerts({ today, rows: (js ?? []).map((j: Record<string, string>) => ({ assoc_id: j.association_id, name: j.name, mandate_title: j.mandate_title, joining_date: j.joining_date, status: j.status })), alertDays }));
      }

      for (const n of notes) {
        const { data: ins, error: ierr } = await sb.from('notifications').upsert({ user_id: u.id, kind: n.kind, title: n.title, body: n.body, link: n.url, dedupe_key: n.key }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
        if (ierr) { stats.errors.push(`notify ${n.key}: ${ierr.message}`); continue; } // never fail silently
        if (!ins?.length) continue; // already announced
        stats.created++;
        if (!pushOn) continue;
        const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', u.id);
        for (const sub of subs ?? []) {
          try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: n.title, body: n.body, tag: n.key, url: n.url }), { TTL: 86400, urgency: 'high' }); stats.pushed++; }
          catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', sub.id); else stats.errors.push(`push ${code ?? (e as Error).message}`); }
        }
      }
      await sb.from('notifications').delete().eq('user_id', u.id).lt('created_at', retentionCutoff(today) + 'T00:00:00Z'); // keep 90 days
    } catch (e) { stats.errors.push(`${u.id.slice(0, 8)}: ${(e as Error).message}`); }
  }
  return json(stats, stats.errors.length ? 207 : 200);
});
