import { useMemo } from 'react';
import { slateStats } from '../../domain/slateStats';
import type { Task, TaskDone, TaskOverride } from '../../domain/types';
import { dayName, dow, fmtDuration, type DateStr } from '../../lib/time';
import { Kpi } from '../../ui/charts';
import { Progress, Ring } from '../../ui/kit';

/** Compact productivity dashboard: today, backlog, focus load, time budget and consistency. */
export function SlateDashboard({ tasks, overrides, done, today, weekStartsOn }: { tasks: Task[]; overrides: TaskOverride[]; done: TaskDone[]; today: DateStr; weekStartsOn: 0 | 1 }) {
  const s = useMemo(() => slateStats(tasks, overrides, done, today, weekStartsOn), [tasks, overrides, done, today, weekStartsOn]);
  return (
    <div className="card pad stack">
      <div className="row wrap gap-l">
        <div className="row"><Ring pct={s.completionPct} color="var(--green-2)" /><div><div className="bold">Today</div><div className="small muted">{s.todayDone} of {s.todayTotal} done</div></div></div>
        <div className="kpis grow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' }}>
          <Kpi n={s.todayPending} label="Pending today" tone="info" /><Kpi n={s.overdue} label="Overdue" tone={s.overdue ? 'red' : 'grey'} /><Kpi n={s.upcoming} label="Next 7 days" />
          <Kpi n={s.focusPending} label="Focus tasks left" tone="amber" /><Kpi n={fmtDuration(s.scheduledMinutes)} label="Scheduled today" sub={s.scheduledMinutes !== s.estMinutes ? `estimated ${fmtDuration(s.estMinutes)}` : undefined} /><Kpi n={s.pointsToday} label="Points today" tone="green" sub={`${s.pointsWeek} this week`} />
        </div>
      </div>
      <div className="grid g2">
        <div><div className="lbl" style={{ marginBottom: 6 }}>This week</div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 74 }}>{s.week.map((d) => <div key={d.day} className="grow center" title={`${d.done}/${d.total} done`}>
            <div style={{ height: 52, display: 'flex', alignItems: 'flex-end' }}><div style={{ width: '100%', height: `${d.total ? Math.max(8, d.pct) : 4}%`, background: d.day === today ? 'var(--gold)' : d.pct === 100 ? 'var(--green-2)' : 'var(--surface-3)', borderRadius: '4px 4px 0 0' }} /></div>
            <div className="tiny muted">{dayName(dow(d.day)).slice(0, 2)}</div></div>)}</div></div>
        <div><div className="lbl" style={{ marginBottom: 6 }}>Recurring tasks · last 14 days</div>
          {s.recurring.length === 0 ? <div className="muted small">No recurring tasks yet.</div> : <div className="stack-s">{s.recurring.slice(0, 4).map((r) => <div key={r.id} className="row small"><span className="grow trunc">{r.title}</span><div style={{ width: 90 }}><Progress pct={r.pct} tone={r.pct < 50 ? 'red' : undefined} /></div><b style={{ width: 38, textAlign: 'right' }}>{r.pct}%</b></div>)}</div>}</div>
      </div>
    </div>
  );
}
