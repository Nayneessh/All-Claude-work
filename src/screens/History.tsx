import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAllTags, listSessions, sessionSummaries, sessionsInRange, type HistoryFilter } from '@/data/repo/history';
import { listPrograms } from '@/data/repo/programs';
import { formatVolume } from '@/domain/units';
import { GROUP_LABELS, GROUP_ORDER, type MuscleGroup } from '@/domain/muscles';
import { addDays, isoWeekday, monthKey, weekStartOf } from '@/domain/periods';
import type { SessionStatus } from '@/domain/types';
import { Button, Card, Chip, Empty, Loading, Seg } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { StatusBadge } from '@/ui/status';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { fmtDate, fmtMonth, weekdayShort } from '@/ui/format';
import { ExercisePicker } from './shared/ExercisePicker';

const STATUS_FILTERS: { label: string; v: SessionStatus[] | undefined }[] = [
  { label: 'All', v: undefined }, { label: 'Completed', v: ['completed_as_planned', 'completed_modified'] }, { label: 'Partial', v: ['partial'] }, { label: 'Skipped', v: ['skipped', 'rescheduled'] },
];
const PAGE = 25;

export function History() {
  const nav = useNavigate();
  const { today, unit, weekStart } = useApp();
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [q, setQ] = useState('');
  const [statusIdx, setStatusIdx] = useState(0);
  const [group, setGroup] = useState<MuscleGroup | undefined>();
  const [tag, setTag] = useState<string | undefined>();
  const [programId, setProgramId] = useState<string | undefined>();
  const [exerciseId, setExerciseId] = useState<string | undefined>();
  const [bookmarked, setBookmarked] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const [pick, setPick] = useState(false);
  const [month, setMonth] = useState(monthKey(today));
  const [selDay, setSelDay] = useState<string | null>(null);

  const filter: HistoryFilter = useMemo(() => ({ q: q || undefined, status: STATUS_FILTERS[statusIdx]?.v, group, tag, programId, exerciseId, bookmarked: bookmarked || undefined }), [q, statusIdx, group, tag, programId, exerciseId, bookmarked]);
  const rows = useLive(() => listSessions(filter, limit + 1), [filter, limit]);
  const sums = useLive(() => sessionSummaries((rows.data ?? []).slice(0, limit).map((r) => r.id), today), [rows.data, limit, today]);
  const tags = useLive(() => listAllTags(), []);
  const programs = useLive(() => listPrograms({ includeArchived: true }), []);
  const monthFrom = `${month}-01`;
  const monthTo = addDays(`${month}-01`, 40).slice(0, 7) === month ? addDays(`${month}-01`, 40) : `${month}-31`;
  const cal = useLive(() => sessionsInRange(addDays(weekStartOf(monthFrom, weekStart), 0), addDays(monthFrom, 42)), [month, weekStart]);
  const activeFilters = [group, tag, programId, exerciseId, bookmarked || undefined, statusIdx ? 1 : undefined].filter(Boolean).length;
  const list = (rows.data ?? []).slice(0, limit);
  const groups = useMemo(() => { const m = new Map<string, typeof list>(); for (const s of list) { const k = monthKey(s.session_date); m.set(k, [...(m.get(k) ?? []), s]); } return [...m]; }, [list]);

  const shiftMonth = (d: number): void => { const [y, m] = month.split('-').map(Number) as [number, number]; const dt = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`); setSelDay(null); };
  void monthTo;
  const first = weekStartOf(monthFrom, weekStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const byDay = new Map<string, NonNullable<typeof cal.data>>();
  for (const s of cal.data ?? []) byDay.set(s.session_date, [...(byDay.get(s.session_date) ?? []), s]);

  return (
    <div className="screen">
      <div className="page-title"><h1>History</h1><Seg value={mode} onChange={setMode} label="View" options={[{ value: 'list', label: 'List' }, { value: 'calendar', label: 'Calendar' }]} /></div>
      <div className="row-flex">
        <input className="input" type="search" placeholder="Search notes, exercises, tags" aria-label="Search history" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <Button variant={activeFilters ? 'soft' : 'outline'} icon="filter" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>{activeFilters || ''}</Button>
      </div>
      {showFilters && (
        <Card className="mt-3 col">
          <div className="field"><span className="label">Status</span><div className="chips">{STATUS_FILTERS.map((s, i) => <Chip key={s.label} on={statusIdx === i} onClick={() => setStatusIdx(i)}>{s.label}</Chip>)}</div></div>
          <div className="field"><span className="label">Muscle group</span><div className="chips">{GROUP_ORDER.map((g) => <Chip key={g} on={group === g} onClick={() => setGroup(group === g ? undefined : g)}>{GROUP_LABELS[g]}</Chip>)}</div></div>
          {(tags.data?.length ?? 0) > 0 && <div className="field"><span className="label">Tag</span><div className="chips">{tags.data?.map((t) => <Chip key={t} on={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>{t}</Chip>)}</div></div>}
          {(programs.data?.length ?? 0) > 1 && <div className="field"><span className="label">Program</span><div className="chips">{programs.data?.map((p) => <Chip key={p.id} on={programId === p.id} onClick={() => setProgramId(programId === p.id ? undefined : p.id)}>{p.name.slice(0, 22)}</Chip>)}</div></div>}
          <div className="row-flex"><Chip on={!!exerciseId} onClick={() => (exerciseId ? setExerciseId(undefined) : setPick(true))}>{exerciseId ? 'Exercise filter on ✕' : 'Filter by exercise…'}</Chip><Chip on={bookmarked} onClick={() => setBookmarked(!bookmarked)}><Icon name="bookmark" size={14} /> Bookmarked</Chip></div>
        </Card>
      )}
      <ExercisePicker open={pick} onClose={() => setPick(false)} title="Filter by exercise" onPick={(e) => setExerciseId(e.id)} />

      {mode === 'calendar' ? (
        <div className="mt-4">
          <div className="row-flex between"><button className="icon-btn" aria-label="Previous month" type="button" onClick={() => shiftMonth(-1)}><Icon name="left" /></button><h3>{fmtMonth(month)}</h3><button className="icon-btn" aria-label="Next month" type="button" onClick={() => shiftMonth(1)}><Icon name="right" /></button></div>
          <div className="cal mt-3">
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="hdr">{weekdayShort(isoWeekday(addDays(first, i)))}</div>)}
            {cells.map((d) => {
              const ss = byDay.get(d) ?? [];
              const kind = ss.some((s) => ['completed_as_planned', 'completed_modified'].includes(s.status)) ? '' : ss.some((s) => s.status === 'partial') ? 'partial' : ss.some((s) => ['skipped', 'cancelled'].includes(s.status)) ? 'skipped' : ss.length ? 'planned' : null;
              return <button key={d} type="button" className={`d${d.slice(0, 7) !== month ? ' out' : ''}${d === today ? ' today' : ''}`} aria-label={`${fmtDate(d)}${ss.length ? `, ${ss.length} workout` : ''}`} onClick={() => setSelDay(d)}>{Number(d.slice(8))}{kind !== null && <i className={kind} />}</button>;
            })}
          </div>
          {selDay && <Card className="mt-3 pad-0"><div className="list">{(byDay.get(selDay) ?? []).length === 0 ? <div className="item dim">No workout on {fmtDate(selDay)}</div> : (byDay.get(selDay) ?? []).map((s) => <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.id}`)}><div className="grow"><div className="strong">{s.name}</div></div><StatusBadge status={s.status} /></button>)}</div></Card>}
        </div>
      ) : rows.loading ? <div className="mt-4"><Loading /></div> : list.length === 0 ? (
        <Card className="mt-4"><Empty icon="history" title={activeFilters || q ? 'No matching workouts' : 'No workouts yet'} hint={activeFilters || q ? 'Try removing a filter.' : 'Finish your first workout and it will appear here with every set.'} /></Card>
      ) : (
        <div className="mt-4">
          {groups.map(([m, ss]) => (
            <div key={m} className="mt-3"><div className="eyebrow mb-2" style={{ marginBottom: 8 }}>{fmtMonth(m)}</div>
              <Card className="pad-0"><div className="list">{ss.map((s) => {
                const sm = sums.data?.get(s.id);
                const performed = ['completed_as_planned', 'completed_modified', 'partial', 'in_progress'].includes(s.status);
                return (
                  <button key={s.id} className="item" type="button" onClick={() => nav(`/history/${s.id}`)}>
                    <div style={{ minWidth: 58 }}><div className="gold strong">{fmtDate(s.session_date).split(' ').slice(1).join(' ')}</div><div className="tiny dim">{weekdayShort(isoWeekday(s.session_date))}</div></div>
                    <div className="grow"><div className="strong ellipsis">{(s.name.split(' — ')[1] ?? s.name)}</div>
                      <div className="small dim">{performed && sm ? `${sm.workingSets} sets · ${formatVolume(sm.volumeKg, unit)}` : s.skip_reason ?? ''}{s.corrected_after_completion ? ' · corrected' : ''}</div></div>
                    {s.is_bookmarked && <Icon name="bookmark" size={16} className="gold" />}<StatusBadge status={s.status} />
                  </button>
                );
              })}</div></Card>
            </div>
          ))}
          {(rows.data?.length ?? 0) > limit && <Button block className="mt-4" onClick={() => setLimit(limit + PAGE)}>Load more</Button>}
        </div>
      )}
    </div>
  );
}
