import { supabase, must, friendlyError } from '../lib/supabase';
import { jdStore, cvStore, safeName, docMime } from '../lib/storage';
import { mergeSettings } from '../lib/settings';
import type { Activity, Agency, AppNotification, Candidate, CandidateFile, Comment, ConfigKind, ConfigOption, MandateAgency, MandateDocument, MandateRow, PipelineRow,
  SopDoc, Step, StatusHistory, Task, TaskDone, TaskOverride } from '../domain/types';
import type { MandateInput } from '../domain/nl/mandateParser';
import type { CandidateInput } from '../domain/nl/candidateParser';
import type { FunnelRow, ActivityRow } from '../domain/analytics';
import type { DateStr } from '../lib/time';

const PAGE = 1000;
/** PostgREST caps responses; fetch every page so dashboards never silently truncate. */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const chunk = await must(build(from, from + PAGE - 1));
    out.push(...chunk);
    if (chunk.length < PAGE) return out;
  }
}

export const api = {
  // ---------------------------------------------------------------- mandates
  mandates: () => all<MandateRow>((a, b) => supabase.from('v_mandate_overview').select('*').order('created_at', { ascending: false }).range(a, b)),
  mandate: async (id: string) => (await must(supabase.from('v_mandate_overview').select('*').eq('id', id).maybeSingle())) as MandateRow | null,
  saveMandate: async (input: Partial<MandateInput> & { id?: string }) => (await must(supabase.rpc('slate_save_mandate', { p: input }))) as string,
  setMandateStatus: async (id: string, status: 'active' | 'on_hold' | 'closed' | 'cancelled', note: string | null) => {
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status, status_note: note, status_changed_at: now };
    if (status === 'closed') { patch.closed_at = now; patch.close_outcome = 'filled'; patch.close_note = note; }
    else if (status === 'cancelled') { patch.closed_at = now; patch.close_outcome = 'cancelled'; patch.close_note = note; }
    else { patch.closed_at = null; patch.close_outcome = null; patch.close_note = null; }
    await must(supabase.from('mandates').update(patch).eq('id', id).select('id').single());
  },
  companies: () => all<{ id: string; name: string }>((a, b) => supabase.from('companies').select('id,name').order('name').range(a, b)),
  renameCompany: async (id: string, name: string) => { await must(supabase.from('companies').update({ name: name.trim() }).eq('id', id).select('id').single()); },
  agencies: () => all<Agency>((a, b) => supabase.from('agencies').select('*').order('name').range(a, b)),
  mandateAgencies: () => all<MandateAgency>((a, b) => supabase.from('mandate_agencies').select('id,mandate_id,agency_id,shared_at').range(a, b)),
  saveAgency: async (a: Partial<Agency> & { name: string }) => {
    if (a.id) await must(supabase.from('agencies').update({ name: a.name.trim(), kind: a.kind, contact_name: a.contact_name, email: a.email, phone: a.phone, notes: a.notes, active: a.active }).eq('id', a.id).select('id').single());
    else await must(supabase.from('agencies').insert({ name: a.name.trim(), kind: a.kind ?? 'agency', contact_name: a.contact_name, email: a.email, phone: a.phone, notes: a.notes }).select('id').single());
  },
  setShared: async (id: string, shared: boolean) => { await must(supabase.from('mandate_agencies').update({ shared_at: shared ? new Date().toISOString() : null }).eq('id', id).select('id').single()); },
  addMandateAgency: async (mandateId: string, name: string) => {
    const agencyId = (await must(supabase.rpc('slate_upsert_agency', { p_name: name, p_kind: 'consultant' }))) as string;
    await must(supabase.from('mandate_agencies').upsert({ mandate_id: mandateId, agency_id: agencyId, shared_at: new Date().toISOString() }, { onConflict: 'mandate_id,agency_id', ignoreDuplicates: true }).select('id'));
  },
  removeMandateAgency: async (id: string) => { await must(supabase.from('mandate_agencies').delete().eq('id', id).select('id')); },
  documents: (mandateId: string) => must(supabase.from('mandate_documents').select('*').eq('mandate_id', mandateId).order('created_at', { ascending: false })) as Promise<MandateDocument[]>,
  uploadJd: async (mandateId: string, userId: string, file: File) => {
    const path = `${userId}/${mandateId}/${Date.now()}-${safeName(file.name)}`;
    await jdStore.upload(path, file);
    try {
      await must(supabase.from('mandate_documents').insert({ mandate_id: mandateId, kind: 'jd', file_name: file.name, path, size: file.size, mime: docMime(file) }).select('id').single());
    } catch (e) { throw new Error(friendlyError(e)); }
  },
  documentUrl: (path: string, download?: string) => jdStore.url(path, { download }),

  // ---------------------------------------------------------------- candidates
  pipeline: () => all<PipelineRow>((a, b) => supabase.from('v_candidate_pipeline').select('*').order('added_at', { ascending: false }).range(a, b)),
  candidateCount: async () => { const { count, error } = await supabase.from('candidates').select('id', { count: 'exact', head: true }); if (error) throw new Error(friendlyError(error)); return count ?? 0; },
  searchCandidates: async (p: { q?: string; mandate?: string; status?: string; stage?: string; source?: string; location?: string; limit?: number; offset?: number }) => {
    const rows = (await must(supabase.rpc('slate_search_candidates', { p_q: p.q || null, p_mandate: p.mandate || null, p_status: p.status || null, p_stage: p.stage || null,
      p_source: p.source || null, p_location: p.location || null, p_limit: p.limit ?? 24, p_offset: p.offset ?? 0 }))) as { total: number; candidate: Candidate }[];
    return { total: rows.length ? Number(rows[0].total) : 0, rows: rows.map((r) => r.candidate) };
  },
  candidate: async (id: string) => (await must(supabase.from('candidates').select('*').eq('id', id).maybeSingle())) as Candidate | null,
  candidatePipeline: (id: string) => must(supabase.from('v_candidate_pipeline').select('*').eq('candidate_id', id).order('stage_updated_at', { ascending: false })) as Promise<PipelineRow[]>,
  saveCandidate: async (input: Partial<CandidateInput> & { id?: string }) => (await must(supabase.rpc('slate_save_candidate', { p: input }))) as string,
  setStage: async (a: { candidate: string; mandate: string; stage: string; reason?: string; comment?: string; joiningDate?: string | null; offeredCtc?: string | null; joiningStatus?: string | null }) =>
    must(supabase.rpc('slate_set_candidate_stage', { p_candidate: a.candidate, p_mandate: a.mandate, p_stage: a.stage, p_reason: a.reason ?? null, p_comment: a.comment ?? null,
      p_joining_date: a.joiningDate || null, p_offered_ctc: a.offeredCtc || null, p_joining_status: a.joiningStatus || null })),
  setRounds: async (assocId: string, rounds: unknown[]) => { await must(supabase.from('candidate_mandates').update({ rounds }).eq('id', assocId).select('id').single()); },
  setJoining: async (assocId: string, patch: { joining_date?: string | null; joining_status?: string | null; offered_ctc?: string | null }) => { await must(supabase.from('candidate_mandates').update(patch).eq('id', assocId).select('id').single()); },
  associate: async (candidateId: string, mandateId: string) => { await must(supabase.from('candidate_mandates').insert({ candidate_id: candidateId, mandate_id: mandateId }).select('id').single()); },
  history: (candidateId: string) => must(supabase.from('candidate_status_history').select('*').eq('candidate_id', candidateId).order('changed_at', { ascending: false })) as Promise<StatusHistory[]>,
  rawAssociations: (candidateId: string) => must(supabase.from('candidate_mandates').select('id,mandate_id,rounds').eq('candidate_id', candidateId)) as Promise<{ id: string; mandate_id: string; rounds: unknown }[]>,
  files: (candidateId: string) => must(supabase.from('candidate_files').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false })) as Promise<CandidateFile[]>,
  uploadCv: async (candidateId: string, mandateId: string, userId: string, file: File) => {
    const path = `${userId}/${candidateId}/${Date.now()}-${safeName(file.name)}`;
    await cvStore.upload(path, file);
    await must(supabase.from('candidate_files').insert({ candidate_id: candidateId, mandate_id: mandateId, kind: 'cv', file_name: file.name, path, size: file.size, mime: docMime(file) }).select('id').single());
  },
  cvUrl: (path: string, download?: string) => cvStore.url(path, { download }),

  // ---------------------------------------------------------------- comments / steps / activity
  comments: (f: { mandateId?: string; candidateId?: string }) => {
    let q = supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(200);
    if (f.candidateId) q = q.eq('candidate_id', f.candidateId); else if (f.mandateId) q = q.eq('mandate_id', f.mandateId);
    return must(q) as Promise<Comment[]>;
  },
  addComment: async (c: { mandateId: string | null; candidateId?: string | null; body: string }) => { await must(supabase.from('comments').insert({ mandate_id: c.mandateId, candidate_id: c.candidateId ?? null, body: c.body.trim() }).select('id').single()); },
  steps: (f: { mandateId?: string; candidateId?: string }) => {
    let q = supabase.from('steps').select('id,scope,mandate_id,candidate_id,seq,phase,title,hint,status,due_date,follow_up_date,note,completed_at').order('seq');
    if (f.candidateId) q = q.eq('candidate_id', f.candidateId); else if (f.mandateId) q = q.eq('mandate_id', f.mandateId).eq('scope', 'mandate');
    return must(q) as Promise<Step[]>;
  },
  setStep: async (id: string, patch: { status?: Step['status']; due_date?: string | null; note?: string | null }) => {
    const p: Record<string, unknown> = { ...patch };
    if (patch.status) p.completed_at = patch.status === 'done' ? new Date().toISOString() : null;
    await must(supabase.from('steps').update(p).eq('id', id).select('id').single());
  },
  activities: (mandateId: string) => must(supabase.from('recruitment_activities').select('id,mandate_id,candidate_id,kind,meaningful,summary,detail,occurred_at').eq('mandate_id', mandateId).order('occurred_at', { ascending: false }).limit(100)) as Promise<Activity[]>,
  activitySummary: async (sinceIso: string) => ((await must(supabase.rpc('slate_activity_summary', { p_since: sinceIso }))) as ActivityRow[]),
  funnel: async (mandate?: string) => (await must(supabase.rpc('slate_funnel', { p_mandate: mandate ?? null }))) as FunnelRow[],

  // ---------------------------------------------------------------- config / settings
  config: async () => { await must(supabase.rpc('slate_ensure_defaults')); return all<ConfigOption>((a, b) => supabase.from('config_options').select('id,kind,key,label,sort_order,active,meta').order('sort_order').range(a, b)); },
  saveConfig: async (o: { id?: string; kind: ConfigKind; label: string; key?: string; sort_order?: number; active?: boolean; meta?: Record<string, unknown> }) => {
    if (o.id) await must(supabase.from('config_options').update({ label: o.label.trim(), sort_order: o.sort_order, active: o.active, meta: o.meta }).eq('id', o.id).select('id').single());
    else await must(supabase.from('config_options').insert({ kind: o.kind, key: o.key!, label: o.label.trim(), sort_order: o.sort_order ?? 100, meta: o.meta ?? {} }).select('id').single());
  },
  settingsRaw: async () => (await must(supabase.from('app_settings').select('data').maybeSingle())) as { data: unknown } | null,
  saveSettings: async (userId: string, current: unknown, patch: Record<string, unknown>) => {
    await must(supabase.from('app_settings').upsert({ user_id: userId, data: mergeSettings(current, patch) }, { onConflict: 'user_id' }).select('user_id').single());
  },

  // ---------------------------------------------------------------- The Slate
  tasks: () => all<Task>((a, b) => supabase.from('slate_tasks').select('*').is('archived_at', null).order('sort_order').order('created_at').range(a, b)),
  done: (from: DateStr, to: DateStr) => all<TaskDone>((a, b) => supabase.from('slate_done').select('task_id,day,completed_at,undone_at').gte('day', from).lte('day', to).range(a, b)),
  overrides: (from: DateStr, to: DateStr) => all<TaskOverride>((a, b) => supabase.from('slate_overrides').select('id,task_id,day,new_day,start_time,sched_minutes').or(`and(day.gte.${from},day.lte.${to}),and(new_day.gte.${from},new_day.lte.${to})`).range(a, b)),
  saveTask: async (t: Partial<Task> & { title: string }) => {
    const row = {
      title: t.title.trim(), parent_id: t.parent_id ?? null, repeat: t.repeat ?? 'once', start_date: t.start_date, due_time: t.due_time ?? null, notes: t.notes ?? null,
      difficulty: t.difficulty ?? 'moderate', est_minutes: t.est_minutes ?? 30, category: t.category ?? null, reminder_time: t.reminder_time ?? null, followup_minutes: t.followup_minutes ?? null,
      rec_days: t.repeat === 'custom' ? t.rec_days : null, rec_every_weeks: t.rec_every_weeks ?? 1, end_date: t.end_date ?? null, xp: t.xp ?? 10,
    };
    if (t.id) { const patch: Record<string, unknown> = { ...row }; if (t.sched_minutes !== undefined) patch.sched_minutes = t.sched_minutes; return must(supabase.from('slate_tasks').update(patch).eq('id', t.id).select('id').single()); }
    return must(supabase.from('slate_tasks').insert(row).select('id').single());
  },
  setTaskDate: async (id: string, date: DateStr) => { await must(supabase.from('slate_tasks').update({ start_date: date }).eq('id', id).select('id').single()); },
  archiveTask: async (id: string, archived: boolean) => { await must(supabase.from('slate_tasks').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id').single()); },
  setDone: async (task: string, day: DateStr, done: boolean) => { await must(supabase.rpc('slate_set_task_done', { p_task: task, p_day: day, p_done: done })); },
  moveTask: async (a: { task: string; day: DateStr; newDay: DateStr; start: string; minutes: number; scope: 'this' | 'series' }) =>
    must(supabase.rpc('slate_move_task', { p_task: a.task, p_day: a.day, p_new_day: a.newDay, p_start: a.start, p_minutes: a.minutes, p_scope: a.scope })),

  // ---------------------------------------------------------------- notifications, SOP, push, audit, backups
  notifications: () => must(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)) as Promise<AppNotification[]>,
  markRead: async (ids: string[]) => { if (ids.length) await must(supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).select('id')); },
  /** Inserts an in-app notification once (the unique dedupe key is shared with the server job). Returns true only if THIS call created it. */
  localNotice: async (n: { kind: string; title: string; body?: string; link?: string; dedupe: string }): Promise<boolean> => {
    const { data } = await supabase.from('notifications').upsert({ kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupe_key: n.dedupe }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id');
    return (data?.length ?? 0) > 0;
  },
  sop: async () => (await must(supabase.rpc('slate_ensure_sop'))) as SopDoc,
  saveSop: async (id: string, body: string, expectedUpdatedAt: string) => {
    const { data, error } = await supabase.from('sop_documents').update({ body }).eq('id', id).eq('updated_at', expectedUpdatedAt).select('id,title,body,updated_at');
    if (error) throw new Error(friendlyError(error));
    return (data?.[0] ?? null) as SopDoc | null; // null => someone else changed it
  },
  sopRevisions: (sopId: string) => must(supabase.from('sop_revisions').select('id,body,saved_at').eq('sop_id', sopId).order('saved_at', { ascending: false }).limit(20)) as Promise<{ id: string; body: string; saved_at: string }[]>,
  audit: (limit = 100) => must(supabase.from('audit_log').select('id,table_name,row_id,action,changes,at').order('at', { ascending: false }).limit(limit)) as Promise<{ id: number; table_name: string; row_id: string | null; action: string; changes: unknown; at: string }[]>,
  backups: () => must(supabase.from('backup_runs').select('*').order('started_at', { ascending: false }).limit(15)) as Promise<{ id: string; started_at: string; finished_at: string | null; status: string; path: string | null; size_bytes: number | null; row_counts: Record<string, number>; verified: boolean; error: string | null }[]>,
  vapidKey: async () => (await must(supabase.rpc('slate_vapid_public_key'))) as string | null,
  savePush: async (sub: { endpoint: string; p256dh: string; auth: string; userAgent: string }) => { await must(supabase.from('push_subscriptions').upsert({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.userAgent }, { onConflict: 'endpoint' }).select('id')); },
  pushCount: async () => { const { count } = await supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }); return count ?? 0; },
};

/** Every table a user owns, for the "download everything" export. */
export const EXPORT_TABLES = ['companies', 'agencies', 'mandates', 'mandate_agencies', 'mandate_documents', 'candidates', 'candidate_mandates', 'candidate_status_history', 'candidate_files', 'comments',
  'steps', 'reminders', 'recruitment_activities', 'config_options', 'slate_tasks', 'slate_done', 'slate_overrides', 'sop_documents', 'notifications', 'app_settings', 'audit_log'] as const;
export async function exportEverything(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) out[t] = await all<unknown>((a, b) => supabase.from(t).select('*').range(a, b));
  return out;
}
