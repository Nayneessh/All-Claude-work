import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { listExercises } from '@/data/repo/exercises';
import { listPrograms } from '@/data/repo/programs';
import { listSessions } from '@/data/repo/history';
import { tbl } from '@/data/db';
import { Card, Empty, Section } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { StatusBadge } from '@/ui/status';
import { useLive } from '@/app/hooks';
import { fmtDate } from '@/ui/format';

export function Search() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const res = useLive(async () => {
    if (needle.length < 2) return null;
    const [exercises, programs, sessions, notes] = await Promise.all([
      listExercises({ q: needle }),
      listPrograms({ includeArchived: true }).then((p) => p.filter((x) => `${x.name} ${x.description ?? ''} ${x.notes ?? ''}`.toLowerCase().includes(needle))),
      listSessions({ q: needle }, 15),
      tbl('set_records').filter((s) => !s.deleted_at && !!s.note && s.note.toLowerCase().includes(needle)).limit(10).toArray(),
    ]);
    return { exercises: exercises.slice(0, 10), programs, sessions, notes };
  }, [needle]);
  const r = res.data;
  const none = r && !r.exercises.length && !r.programs.length && !r.sessions.length && !r.notes.length;
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Search</h1></div>
      <input className="input" type="search" autoFocus placeholder="Exercises, programs, workouts, notes" aria-label="Search everything" value={q} onChange={(e) => setQ(e.target.value)} />
      {!r && <Card className="mt-4"><Empty icon="search" title="Type at least 2 letters" hint="Searches exercise names and muscles, programs, workout names, tags and every note you've written." /></Card>}
      {none && <Card className="mt-4"><Empty icon="search" title={`Nothing found for “${q}”`} /></Card>}
      {r && r.exercises.length > 0 && <Section title="Exercises"><Card className="pad-0"><div className="list">{r.exercises.map((e) => <button key={e.id} type="button" className="item" onClick={() => nav(`/exercises/${e.id}`)}><div className="grow strong">{e.name}</div><Icon name="right" className="chev" size={20} /></button>)}</div></Card></Section>}
      {r && r.programs.length > 0 && <Section title="Programs"><Card className="pad-0"><div className="list">{r.programs.map((p) => <button key={p.id} type="button" className="item" onClick={() => nav(`/program/${p.id}`)}><div className="grow strong">{p.name}</div><Icon name="right" className="chev" size={20} /></button>)}</div></Card></Section>}
      {r && r.sessions.length > 0 && <Section title="Workouts"><Card className="pad-0"><div className="list">{r.sessions.map((s) => <button key={s.id} type="button" className="item" onClick={() => nav(`/history/${s.id}`)}><div className="grow"><div className="strong ellipsis">{s.name.split(' — ')[1] ?? s.name}</div><div className="small dim">{fmtDate(s.session_date, { year: true })}{s.notes ? ` · ${s.notes.slice(0, 60)}` : ''}</div></div><StatusBadge status={s.status} /></button>)}</div></Card></Section>}
      {r && r.notes.length > 0 && <Section title="Set notes"><Card className="pad-0"><div className="list">{r.notes.map((n) => <button key={n.id} type="button" className="item" onClick={() => nav(`/history/${n.session_id}`)}><div className="grow small">“{n.note}”<div className="tiny dim">{fmtDate(n.session_date, { year: true })}</div></div></button>)}</div></Card></Section>}
    </div>
  );
}
