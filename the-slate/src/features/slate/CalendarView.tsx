import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../data/api';
import { useSettings } from '../../data/hooks';
import { layoutOverlaps, moveBlock, pxToMin, resizeEnd, resizeStart, snap } from '../../domain/calendar';
import { expandOccurrences, type Occurrence } from '../../domain/recurrence';
import type { Task, TaskDone, TaskOverride } from '../../domain/types';
import { addDays, dayName, daysInRange, dow, endOfMonth, fmtDuration, fmtTime, fromMin, minutesNowIn, monthName, startOfMonth, startOfWeek, toMin, type DateStr } from '../../lib/time';
import { friendlyError } from '../../lib/supabase';
import { Icon, Seg } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { DIFF_COLOR } from './useSlate';

type Mode = 'day' | 'week' | 'month';
interface Pos { day: DateStr; startMin: number; dur: number }
interface Drag { key: string; mode: 'move' | 'rzb' | 'rzt'; x0: number; y0: number; colW: number; orig: Pos; cur: Pos; moved: boolean }
const keyOf = (o: Occurrence) => `${o.task.id}|${o.originDay}`;
const evStyle = (t: Task) => ({ ['--evc' as string]: DIFF_COLOR[t.difficulty].bg, ['--evb' as string]: DIFF_COLOR[t.difficulty].bar });

export function CalendarView({ tasks, done, overrides, today, onEdit, onCreate, onRange }: {
  tasks: Task[]; done: TaskDone[]; overrides: TaskOverride[]; today: DateStr; onEdit: (t: Task) => void; onCreate: (p: { start_date: DateStr; due_time: string }) => void; onRange: (from: DateStr, to: DateStr) => void;
}) {
  const { settings } = useSettings(); const toast = useToast(); const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(() => (window.matchMedia('(max-width: 720px)').matches ? 'day' : 'week'));
  const [anchor, setAnchor] = useState<DateStr>(today);
  const [drag, setDrag] = useState<Drag | null>(null); const [pending, setPending] = useState<Record<string, Pos>>({}); const [hover, setHover] = useState<DateStr | null>(null);
  const [nowMin, setNowMin] = useState(() => minutesNowIn(settings.timezone)); const gridRef = useRef<HTMLDivElement>(null);
  const pph = settings.density === 'compact' ? 44 : 56;
  useEffect(() => { const t = setInterval(() => setNowMin(minutesNowIn(settings.timezone)), 30_000); return () => clearInterval(t); }, [settings.timezone]);

  const { from, to, days } = useMemo(() => {
    if (mode === 'day') return { from: anchor, to: anchor, days: [anchor] };
    if (mode === 'week') { const s = startOfWeek(anchor, settings.weekStartsOn); return { from: s, to: addDays(s, 6), days: daysInRange(s, addDays(s, 6)) }; }
    const s = startOfWeek(startOfMonth(anchor), settings.weekStartsOn); return { from: s, to: addDays(s, 41), days: daysInRange(s, addDays(s, 41)) };
  }, [mode, anchor, settings.weekStartsOn]);
  useEffect(() => { onRange(from, to); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = useMemo(() => tasks.filter((t) => !t.parent_id), [tasks]);
  const occs = useMemo(() => expandOccurrences(top, overrides, done, from, to), [top, overrides, done, from, to]);
  const posOf = (o: Occurrence): Pos => (pending[keyOf(o)] ?? (drag?.key === keyOf(o) ? drag.cur : { day: o.day, startMin: o.start ? toMin(o.start) : 0, dur: o.minutes }));
  const timed = occs.filter((o) => o.start); const allDay = occs.filter((o) => !o.start);

  // visible hour range expands to include early/late events
  const [lo, hi] = useMemo(() => {
    let l = settings.calendarStartHour, h = settings.calendarEndHour;
    for (const o of timed) { const p = posOf(o); l = Math.min(l, Math.floor(p.startMin / 60)); h = Math.max(h, Math.ceil((p.startMin + p.dur) / 60)); }
    return [Math.max(0, l), Math.min(24, h)];
  }, [timed, settings.calendarStartHour, settings.calendarEndHour, pending, drag]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = (min: number) => ((min - lo * 60) / 60) * pph;
  const height = (hi - lo) * pph;

  async function commit(o: Occurrence, cur: Pos, scope: 'this' | 'series' = 'this') {
    const key = keyOf(o); setPending((p) => ({ ...p, [key]: cur }));
    try {
      await api.moveTask({ task: o.task.id, day: o.originDay, newDay: cur.day, start: fromMin(cur.startMin), minutes: cur.dur, scope });
      await qc.invalidateQueries({ queryKey: ['slate'] });
      if (o.task.repeat !== 'once' && scope === 'this') toast.warn('Moved this occurrence only.', { label: 'Apply to all', run: () => commit(o, cur, 'series') });
      else if (cur.dur !== o.estMinutes) toast.ok(`Blocked ${fmtDuration(cur.dur)} (estimate ${fmtDuration(o.estMinutes)} is kept)`);
    } catch (e) { toast.error(friendlyError(e)); }
    finally { setPending((p) => { const n = { ...p }; delete n[key]; return n; }); }
  }

  function down(e: React.PointerEvent, o: Occurrence, m: Drag['mode']) {
    if (e.button !== 0) return; e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const colW = gridRef.current?.querySelector('.cal-col')?.getBoundingClientRect().width ?? 0; const p = posOf(o);
    setDrag({ key: keyOf(o), mode: m, x0: e.clientX, y0: e.clientY, colW, orig: p, cur: p, moved: false });
  }
  function move(e: React.PointerEvent, o: Occurrence) {
    if (!drag || drag.key !== keyOf(o)) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; const moved = drag.moved || Math.hypot(dx, dy) > 4; if (!moved) return;
    const dMin = pxToMin(dy, pph);
    let cur: Pos;
    if (drag.mode === 'move') { const dd = mode === 'week' && drag.colW ? Math.round(dx / drag.colW) : 0; const i = Math.max(0, Math.min(days.length - 1, days.indexOf(drag.orig.day) + dd)); const b = moveBlock({ startMin: drag.orig.startMin, durMin: drag.orig.dur }, dMin, dd); cur = { day: days[i], startMin: b.startMin, dur: drag.orig.dur }; }
    else if (drag.mode === 'rzb') cur = { ...drag.orig, dur: resizeEnd({ startMin: drag.orig.startMin, durMin: drag.orig.dur }, dMin).durMin };
    else { const b = resizeStart({ startMin: drag.orig.startMin, durMin: drag.orig.dur }, dMin); cur = { ...drag.orig, startMin: b.startMin, dur: b.durMin }; }
    setDrag({ ...drag, cur, moved: true });
  }
  function up(e: React.PointerEvent, o: Occurrence) {
    if (!drag || drag.key !== keyOf(o)) return; const d = drag; setDrag(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!d.moved) { if (d.mode === 'move') onEdit(o.task); return; }
    if (d.cur.day !== d.orig.day || d.cur.startMin !== d.orig.startMin || d.cur.dur !== d.orig.dur) commit(o, d.cur);
  }
  function key(e: React.KeyboardEvent, o: Occurrence) {
    const p = posOf(o); const base = { startMin: p.startMin, durMin: p.dur };
    if (e.key === 'Enter') { e.preventDefault(); onEdit(o.task); return; }
    let next: Pos | null = null;
    if (e.key === 'ArrowUp') next = e.shiftKey ? { ...p, ...{ dur: resizeEnd(base, -15).durMin } } : { ...p, startMin: moveBlock(base, -15, 0).startMin };
    if (e.key === 'ArrowDown') next = e.shiftKey ? { ...p, dur: resizeEnd(base, 15).durMin } : { ...p, startMin: moveBlock(base, 15, 0).startMin };
    if (e.key === 'ArrowLeft' && mode !== 'day') next = { ...p, day: addDays(p.day, -1) }; if (e.key === 'ArrowRight' && mode !== 'day') next = { ...p, day: addDays(p.day, 1) };
    if (next) { e.preventDefault(); commit(o, next); }
  }

  /** Pointer drag for chips (all-day tray and month view): drop on a day column (sets a time) or a day cell (changes the date). */
  const chipDrag = useRef<{ o: Occurrence; x: number; y: number; moved: boolean } | null>(null);
  function chipDown(e: React.PointerEvent, o: Occurrence) { if (e.button !== 0) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); chipDrag.current = { o, x: e.clientX, y: e.clientY, moved: false }; }
  function chipMove(e: React.PointerEvent) {
    const d = chipDrag.current; if (!d) return; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true; if (!d.moved) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.cell || (x as HTMLElement).dataset?.day) as HTMLElement | undefined; setHover(el ? (el.dataset.cell ?? el.dataset.day ?? null) : null);
  }
  async function chipUp(e: React.PointerEvent) {
    const d = chipDrag.current; chipDrag.current = null; setHover(null); if (!d) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.moved) { onEdit(d.o.task); return; }
    const els = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]; const col = els.find((x) => x.dataset?.day); const cell = els.find((x) => x.dataset?.cell); const o = d.o;
    try {
      if (col?.dataset.day) {
        const r = col.getBoundingClientRect(); const startMin = Math.max(0, Math.min(1440 - 15, snap(lo * 60 + pxToMin(e.clientY - r.top, pph)))); await commit(o, { day: col.dataset.day, startMin, dur: o.minutes });
      } else if (cell?.dataset.cell && cell.dataset.cell !== o.day) {
        const day = cell.dataset.cell;
        if (o.start) await commit(o, { day, startMin: toMin(o.start), dur: o.minutes });
        else if (o.task.repeat === 'once') { await api.setTaskDate(o.task.id, day); await qc.invalidateQueries({ queryKey: ['slate'] }); toast.ok('Task moved'); }
        else toast.error('Give this recurring task a start time to move a single occurrence.');
      }
    } catch (x) { toast.error(friendlyError(x)); }
  }

  const label = mode === 'day' ? `${dayName(dow(anchor))}, ${anchor.slice(8)} ${monthName(+anchor.slice(5, 7) - 1)} ${anchor.slice(0, 4)}`
    : mode === 'week' ? `${from.slice(8)} ${monthName(+from.slice(5, 7) - 1)} – ${to.slice(8)} ${monthName(+to.slice(5, 7) - 1)} ${to.slice(0, 4)}` : `${monthName(+anchor.slice(5, 7) - 1)} ${anchor.slice(0, 4)}`;
  const step = (n: number) => setAnchor(mode === 'month' ? (n > 0 ? addDays(endOfMonth(anchor), 1) : addDays(startOfMonth(anchor), -1)) : addDays(anchor, n * (mode === 'week' ? 7 : 1)));
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="stack">
      <div className="row wrap">
        <button className="btn sm" onClick={() => setAnchor(today)}>Today</button><button className="btn sm" onClick={() => step(-1)} aria-label="Previous"><Icon n="back" size={15} /></button><button className="btn sm" onClick={() => step(1)} aria-label="Next"><Icon n="chev" size={15} /></button>
        <h2 aria-live="polite">{label}</h2><span className="tiny muted">drag to move · drag the top/bottom edge to resize · click to edit</span>
        <div className="right"><Seg value={mode} onChange={setMode} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} /></div>
      </div>

      {mode !== 'month' ? (
        <div className="cal" ref={gridRef}>
          <div className="cal-head" style={{ gridTemplateColumns: cols }}><div />{days.map((d) => <div key={d} className={d === today ? 'today' : ''}>{dayName(dow(d))}<b>{Number(d.slice(8))}</b></div>)}</div>
          {allDay.length > 0 && <div className="allday" style={{ gridTemplateColumns: cols }}><div className="tiny muted" style={{ padding: 6 }}>All day</div>
            {days.map((d) => <div key={d} data-cell={d} style={hover === d ? { background: 'var(--gold-bg)' } : undefined}>{allDay.filter((o) => o.day === d).map((o) => <span key={keyOf(o)} className={`pill-ev ${o.done ? 'done' : ''}`} style={evStyle(o.task)} onPointerDown={(e) => chipDown(e, o)} onPointerMove={chipMove} onPointerUp={chipUp} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onEdit(o.task)} title="Drag onto the grid to give it a time">{o.task.title}</span>)}</div>)}</div>}
          <div className="cal-body" style={{ gridTemplateColumns: cols }}>
            <div className="cal-times" style={{ height }}>{Array.from({ length: hi - lo + 1 }, (_, i) => <span key={i} style={{ top: i * pph }}>{i === 0 ? '' : fmtTime(fromMin((lo + i) * 60 === 1440 ? 1439 : (lo + i) * 60)).replace(':00', '')}</span>)}</div>
            {days.map((d) => {
              const evs = timed.map((o) => ({ o, p: posOf(o) })).filter((x) => x.p.day === d).map((x) => ({ ...x, startMin: x.p.startMin, endMin: x.p.startMin + x.p.dur }));
              const laid = layoutOverlaps(evs);
              return (
                <div key={d} data-day={d} className={`cal-col ${d === today ? 'today' : ''}`} style={{ height, ['--hh' as string]: `${pph}px` }}
                  onClick={(e) => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); onCreate({ start_date: d, due_time: fromMin(Math.max(0, Math.min(1425, snap(lo * 60 + pxToMin(e.clientY - r.top, pph), 15)))) }); }}>
                  {d === today && nowMin >= lo * 60 && nowMin <= hi * 60 && <div className="now-line" style={{ top: y(nowMin) }} />}
                  {laid.map(({ item, col, cols: n }) => { const { o, p } = item; const dragging = drag?.key === keyOf(o) && drag.moved; const tall = (p.dur / 60) * pph;
                    return (
                      <div key={keyOf(o)} className={`ev ${o.done ? 'done' : ''} ${dragging ? 'dragging' : ''} ${p.dur !== o.estMinutes ? 'est-gap' : ''}`} role="button" tabIndex={0}
                        aria-label={`${o.task.title}, ${fmtTime(fromMin(p.startMin))}, ${fmtDuration(p.dur)}. Arrow keys move, Shift+arrows resize, Enter edits.`}
                        style={{ ...evStyle(o.task), top: y(p.startMin), height: Math.max(20, tall - 2), left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                        onPointerDown={(e) => down(e, o, 'move')} onPointerMove={(e) => move(e, o)} onPointerUp={(e) => up(e, o)} onPointerCancel={() => setDrag(null)} onKeyDown={(e) => key(e, o)}>
                        <div className="rz t" onPointerDown={(e) => down(e, o, 'rzt')} />
                        <div style={{ fontWeight: 650 }} className="trunc">{o.task.title}</div>
                        {tall >= 38 && <div style={{ opacity: .85 }} className="tiny">{fmtTime(fromMin(p.startMin))} – {fmtTime(fromMin(p.startMin + p.dur))}{p.dur !== o.estMinutes && ` · est ${fmtDuration(o.estMinutes)}`}</div>}
                        <div className="rz b" onPointerDown={(e) => down(e, o, 'rzb')} />
                      </div>); })}
                </div>);
            })}
          </div>
        </div>
      ) : (
        <div className="cal"><div className="month">{(settings.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]).map((d) => <div key={d} className="dh">{dayName(d)}</div>)}
          {days.map((d) => { const evs = occs.filter((o) => o.day === d); return (
            <div key={d} data-cell={d} className={`cell ${d.slice(0, 7) !== anchor.slice(0, 7) ? 'out' : ''} ${d === today ? 'today' : ''} ${hover === d ? 'over' : ''}`} onDoubleClick={() => onCreate({ start_date: d, due_time: '' })}>
              <button className="dn" style={{ all: 'unset', cursor: 'pointer', alignSelf: 'flex-start', padding: '0 6px', borderRadius: 11, minWidth: 22, textAlign: 'center' }} onClick={() => { setAnchor(d); setMode('day'); }} aria-label={`Open ${d}`}>{Number(d.slice(8))}</button>
              {evs.slice(0, 3).map((o) => <span key={keyOf(o)} className={`pill-ev trunc ${o.done ? 'done' : ''}`} style={evStyle(o.task)} onPointerDown={(e) => chipDown(e, o)} onPointerMove={chipMove} onPointerUp={chipUp} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onEdit(o.task)}>{o.start && <span style={{ opacity: .8 }}>{fmtTime(o.start).replace(' ', '').toLowerCase()} </span>}{o.task.title}</span>)}
              {evs.length > 3 && <button className="tiny muted" style={{ all: 'unset', cursor: 'pointer' }} onClick={() => { setAnchor(d); setMode('day'); }}>+{evs.length - 3} more</button>}
            </div>); })}</div></div>
      )}
    </div>
  );
}
