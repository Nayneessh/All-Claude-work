import { addDays, dayOf, diffDays, type DateStr } from '../lib/time';
import { computeClock, type ClockInfo, type ClockOptions } from './mandateClock';
import type { Agency, ConfigOption, MandateAgency, MandateRow, PipelineRow } from './types';

export interface MC { m: MandateRow; clock: ClockInfo }
export const withClocks = (rows: MandateRow[], o: ClockOptions): MC[] => rows.map((m) => ({ m, clock: computeClock(m, o) }));

// ------------------------------------------------------------------------------------------------
export interface MandateKpis { total: number; active: number; inactive: number; onHold: number; overdue: number; closed: number; critical: number; nearClose: number }
/** active+inactive+onHold+overdue+closed always equals total (each mandate is in exactly one clock state). critical/nearClose overlap and count OPEN mandates only. */
export function mandateKpis(rows: MC[]): MandateKpis {
  const k: MandateKpis = { total: rows.length, active: 0, inactive: 0, onHold: 0, overdue: 0, closed: 0, critical: 0, nearClose: 0 };
  for (const { m, clock } of rows) {
    if (clock.state === 'active') k.active++; else if (clock.state === 'inactive') k.inactive++; else if (clock.state === 'on_hold') k.onHold++;
    else if (clock.state === 'overdue') k.overdue++; else k.closed++;
    if (clock.state !== 'closed' && m.urgency === 'Critical') k.critical++;
    if (clock.nearClose) k.nearClose++;
  }
  return k;
}

export interface AttentionItem { mc: MC; reasons: string[]; score: number }
/** Open mandates needing attention, worst first: overdue, idle, no candidates, nearing close, open a long time. */
export function criticalAttention(rows: MC[], opts: { inactivityDays: number; limit?: number }): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const mc of rows) {
    const { m, clock: c } = mc;
    if (c.state === 'closed') continue;
    const reasons: string[] = []; let score = 0;
    if (c.state === 'overdue') { reasons.push(`${c.overdueDays} day${c.overdueDays === 1 ? '' : 's'} past target close`); score += 40 + Math.min(c.overdueDays, 30); }
    if (m.status === 'active' && c.idleDays >= opts.inactivityDays) { reasons.push(`No attention for ${c.idleDays} days`); score += Math.min(c.idleDays * 2, 40); }
    if (m.status === 'active' && m.candidate_total === 0 && c.daysOpen >= 3) { reasons.push('No candidates added'); score += 25; }
    if (c.nearClose) { reasons.push(c.daysToClose === 0 ? 'Target close is today' : `Target close in ${c.daysToClose} day${c.daysToClose === 1 ? '' : 's'}`); score += 15; }
    if (c.daysOpen >= 30 && m.status === 'active') { reasons.push(`Open ${c.daysOpen} days`); score += 10; }
    if (!reasons.length) continue;
    score *= m.urgency === 'Critical' ? 1.5 : m.urgency === 'High' ? 1.25 : 1;
    out.push({ mc, reasons, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.limit ?? 50);
}

// ------------------------------------------------------------------------------------------------
export interface CompanyStat { company: string; mandates: number; open: number; closed: number; candidates: number; selected: number; offered: number; joined: number; positions: number }
export function companyStats(rows: MC[]): CompanyStat[] {
  const map = new Map<string, CompanyStat>();
  for (const { m, clock } of rows) {
    const key = m.company_name ?? '(no company)';
    const s = map.get(key) ?? { company: key, mandates: 0, open: 0, closed: 0, candidates: 0, selected: 0, offered: 0, joined: 0, positions: 0 };
    s.mandates++; s.positions += m.positions; s.candidates += m.candidate_total; s.selected += m.selected_count; s.offered += m.offered_count; s.joined += m.joined_count;
    if (clock.state === 'closed') s.closed++; else s.open++;
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.mandates - a.mandates || a.company.localeCompare(b.company));
}

export interface AgencyStat { agencyId: string; agency: string; assigned: number; active: number; submitted: number; selected: number; offered: number; joined: number; avgAging: number; maxAging: number }
/**
 * Candidates are attributed to an agency only where the record supports it:
 * source equals the agency's name, OR source is "Agency" on a mandate that has exactly one agency assigned.
 */
export function agencyStats(rows: MC[], links: MandateAgency[], agencies: Agency[], pipeline: PipelineRow[]): { stats: AgencyStat[]; unattributed: number } {
  const byMandate = new Map<string, MC>(rows.map((r) => [r.m.id, r]));
  const agenciesByMandate = new Map<string, string[]>();
  for (const l of links) agenciesByMandate.set(l.mandate_id, [...(agenciesByMandate.get(l.mandate_id) ?? []), l.agency_id]);
  const stat = new Map<string, AgencyStat>();
  for (const a of agencies) stat.set(a.id, { agencyId: a.id, agency: a.name, assigned: 0, active: 0, submitted: 0, selected: 0, offered: 0, joined: 0, avgAging: 0, maxAging: 0 });
  const aging = new Map<string, number[]>();
  for (const l of links) {
    const s = stat.get(l.agency_id); const mc = byMandate.get(l.mandate_id);
    if (!s || !mc) continue;
    s.assigned++;
    if (mc.clock.state !== 'closed') { s.active++; aging.set(s.agencyId, [...(aging.get(s.agencyId) ?? []), mc.clock.daysOpen]); }
  }
  let unattributed = 0;
  for (const p of pipeline) {
    const ids = agenciesByMandate.get(p.mandate_id) ?? [];
    const src = (p.source ?? '').toLowerCase();
    let target: string | undefined = ids.find((id) => stat.get(id)?.agency.toLowerCase() === src);
    if (!target && src === 'agency') { if (ids.length === 1) target = ids[0]; else if (ids.length > 1) unattributed++; }
    if (!target) continue;
    const s = stat.get(target)!;
    s.submitted++;
    if (p.status === 'selected') s.selected++; else if (p.status === 'offered') s.offered++; else if (p.status === 'joined') s.joined++;
  }
  for (const s of stat.values()) { const a = aging.get(s.agencyId) ?? []; s.avgAging = a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0; s.maxAging = a.length ? Math.max(...a) : 0; }
  return { stats: [...stat.values()].filter((s) => s.assigned > 0).sort((a, b) => b.assigned - a.assigned || a.agency.localeCompare(b.agency)), unattributed };
}

export type AgingBy = 'agency' | 'location' | 'level' | 'company' | 'mandate';
export interface AgingRow { label: string; count: number; avgDays: number; maxDays: number; b0: number; b16: number; b31: number; b61: number }
/** Aging of OPEN mandates (days since work started / received), bucketed 0–15, 16–30, 31–60, 61+. */
export function agingBy(rows: MC[], by: AgingBy, links: MandateAgency[] = [], agencies: Agency[] = []): AgingRow[] {
  const nameOf = new Map(agencies.map((a) => [a.id, a.name]));
  const groups = new Map<string, number[]>();
  const add = (label: string, days: number) => groups.set(label, [...(groups.get(label) ?? []), days]);
  for (const { m, clock } of rows) {
    if (clock.state === 'closed') continue;
    if (by === 'agency') {
      const ls = links.filter((l) => l.mandate_id === m.id);
      if (!ls.length) add('(no agency)', clock.daysOpen); else for (const l of ls) add(nameOf.get(l.agency_id) ?? '(unknown)', clock.daysOpen);
    } else if (by === 'location') add(m.location ?? '(no location)', clock.daysOpen);
    else if (by === 'level') add(m.level ?? '(no level)', clock.daysOpen);
    else if (by === 'company') add(m.company_name ?? '(no company)', clock.daysOpen);
    else add(`${m.title}${m.company_name ? ' — ' + m.company_name : ''}`, clock.daysOpen);
  }
  return [...groups.entries()].map(([label, d]) => ({
    label, count: d.length, avgDays: Math.round(d.reduce((a, b) => a + b, 0) / d.length), maxDays: Math.max(...d),
    b0: d.filter((x) => x <= 15).length, b16: d.filter((x) => x > 15 && x <= 30).length, b31: d.filter((x) => x > 30 && x <= 60).length, b61: d.filter((x) => x > 60).length,
  })).sort((a, b) => b.avgDays - a.avgDays);
}

// ------------------------------------------------------------------------------------------------
export interface ReasonStat { reason: string; count: number }
export interface RejectDropStats { rejected: number; dropped: number; rejectionReasons: ReasonStat[]; dropReasons: ReasonStat[]; byMandate: { mandate: string; rejected: number; dropped: number }[]; rows: PipelineRow[] }
export function rejectDropStats(pipeline: PipelineRow[]): RejectDropStats {
  const rej = pipeline.filter((p) => p.status === 'rejected'); const drp = pipeline.filter((p) => p.status === 'dropped');
  const tally = (rows: PipelineRow[]): ReasonStat[] => {
    const m = new Map<string, number>(); for (const r of rows) { const k = r.closed_reason ?? '(no reason recorded)'; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  };
  const bm = new Map<string, { mandate: string; rejected: number; dropped: number }>();
  for (const r of [...rej, ...drp]) {
    const key = `${r.mandate_title}${r.mandate_company ? ' — ' + r.mandate_company : ''}`;
    const e = bm.get(key) ?? { mandate: key, rejected: 0, dropped: 0 }; if (r.status === 'rejected') e.rejected++; else e.dropped++; bm.set(key, e);
  }
  return { rejected: rej.length, dropped: drp.length, rejectionReasons: tally(rej), dropReasons: tally(drp), byMandate: [...bm.values()].sort((a, b) => b.rejected + b.dropped - (a.rejected + a.dropped)), rows: [...rej, ...drp] };
}

export interface Joiner { row: PipelineRow; daysUntil: number; level: 'today' | 'soon' | 'upcoming' | 'overdue' }
/** Candidates expected to join within `windowDays` (selected/offered with a joining date, or joined on a future date). Past-due dates not yet joined are flagged. */
export function upcomingJoiners(pipeline: PipelineRow[], today: DateStr, windowDays = 30, alertDays: number[] = [7, 1, 0]): Joiner[] {
  const max = Math.max(...alertDays, 0);
  return pipeline.filter((p) => p.joining_date && ['selected', 'offered', 'joined'].includes(p.status))
    .map((row) => ({ row, daysUntil: diffDays(row.joining_date!, today) }))
    .filter((j) => j.daysUntil <= windowDays && (j.daysUntil >= 0 || (j.row.status !== 'joined' && j.daysUntil >= -14)))
    .filter((j) => !(j.row.status === 'joined' && j.daysUntil < 0))
    .map((j): Joiner => ({ ...j, level: j.daysUntil < 0 ? 'overdue' : j.daysUntil === 0 ? 'today' : j.daysUntil <= max ? 'soon' : 'upcoming' }))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ------------------------------------------------------------------------------------------------
export const ACTIVITY_GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: 'candidates', label: 'Candidates added', kinds: ['candidate_added'] },
  { key: 'movement', label: 'Stage movements', kinds: ['candidate_stage_changed'] },
  { key: 'interviews', label: 'Interviews', kinds: ['interview_updated'] },
  { key: 'comments', label: 'Comments', kinds: ['comment_added'] },
  { key: 'checklist', label: 'Checklist steps', kinds: ['step_status_changed'] },
  { key: 'documents', label: 'Documents', kinds: ['document_uploaded', 'document_replaced', 'cv_uploaded'] },
  { key: 'consultants', label: 'Consultants', kinds: ['consultant_assigned', 'shared_with_consultant'] },
  { key: 'mandates', label: 'Mandate updates', kinds: ['mandate_created', 'mandate_status_changed', 'clock_started', 'waiting_updated'] },
  { key: 'joining', label: 'Joining dates', kinds: ['joining_date_set'] },
];
export const ACTIVITY_RANGES = [
  { key: '1w', label: 'Last 1 week', days: 7 }, { key: '30d', label: 'Last 30 days', days: 30 }, { key: '3m', label: 'Last 3 months', days: 91 },
  { key: '6m', label: 'Last 6 months', days: 182 }, { key: '1y', label: 'Last 1 year', days: 365 },
] as const;
export type ActivityRangeKey = (typeof ACTIVITY_RANGES)[number]['key'];
export interface ActivityRow { day: DateStr; kind: string; n: number }
export interface ActivitySummary { total: number; byGroup: { key: string; label: string; n: number }[]; byDay: { day: DateStr; n: number }[] }
export function summarizeActivity(rows: ActivityRow[], today: DateStr, range: ActivityRangeKey): ActivitySummary {
  const days = ACTIVITY_RANGES.find((r) => r.key === range)!.days;
  const from = addDays(today, -(days - 1));
  const inRange = rows.filter((r) => r.day >= from && r.day <= today);
  const byGroup = ACTIVITY_GROUPS.map((g) => ({ key: g.key, label: g.label, n: inRange.filter((r) => g.kinds.includes(r.kind)).reduce((s, r) => s + Number(r.n), 0) }));
  const dm = new Map<DateStr, number>(); for (const r of inRange) dm.set(r.day, (dm.get(r.day) ?? 0) + Number(r.n));
  return { total: inRange.reduce((s, r) => s + Number(r.n), 0), byGroup, byDay: [...dm.entries()].map(([day, n]) => ({ day, n })).sort((a, b) => a.day.localeCompare(b.day)) };
}

// ------------------------------------------------------------------------------------------------
export interface FunnelRow { stage_key: string; label: string; sort_order: number; reached: number; current_count: number }
export interface FunnelStep extends FunnelRow { pctOfFirst: number; pctOfPrev: number | null }
export function funnelSteps(rows: FunnelRow[]): FunnelStep[] {
  const first = rows.length ? Number(rows[0].reached) : 0;
  return rows.map((r, i) => ({ ...r, reached: Number(r.reached), current_count: Number(r.current_count), pctOfFirst: first ? Math.round((Number(r.reached) / first) * 100) : 0,
    pctOfPrev: i === 0 ? null : Number(rows[i - 1].reached) ? Math.round((Number(r.reached) / Number(rows[i - 1].reached)) * 100) : null }));
}

export interface CandidateStats {
  associations: number; people: number; byStatus: Record<string, number>; byStage: { key: string; label: string; n: number }[];
  bySource: { label: string; n: number }[]; byCompany: { label: string; n: number }[]; byMandate: { label: string; n: number }[];
}
export function candidateStats(pipeline: PipelineRow[], stages: ConfigOption[]): CandidateStats {
  const tally = (f: (p: PipelineRow) => string) => { const m = new Map<string, number>(); for (const p of pipeline) { const k = f(p); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); };
  const byStatus: Record<string, number> = {}; for (const p of pipeline) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const stageCount = new Map<string, number>(); for (const p of pipeline) stageCount.set(p.stage, (stageCount.get(p.stage) ?? 0) + 1);
  const known = new Set(stages.map((s) => s.key));
  const byStage = [...stages.filter((s) => s.active).sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ key: s.key, label: s.label, n: stageCount.get(s.key) ?? 0 })),
    ...[...stageCount.entries()].filter(([k]) => !known.has(k)).map(([k, n]) => ({ key: k, label: k, n }))];
  return {
    associations: pipeline.length, people: new Set(pipeline.map((p) => p.candidate_id)).size, byStatus, byStage,
    bySource: tally((p) => p.source ?? '(not recorded)'), byCompany: tally((p) => p.mandate_company ?? '(no company)'), byMandate: tally((p) => `${p.mandate_title}${p.mandate_company ? ' — ' + p.mandate_company : ''}`),
  };
}

/** Day a pipeline event is attributed to (for drill-downs on the candidates tab). */
export const addedDay = (p: PipelineRow, tz?: string): DateStr => dayOf(p.added_at, tz);
