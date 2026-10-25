import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteBody, listBody, listReadiness, saveBody, saveReadiness } from '@/data/repo/misc';
import { addPhoto, deletePhoto, listPhotos, photoUrl, shrinkImage, uploadPendingPhotos } from '@/data/repo/photos';
import { listSessions } from '@/data/repo/history';
import { BODY_LABELS, rollingAverage, seriesOf, weeklyRate, type BodyKey } from '@/domain/body';
import { correlate, readinessLabel, readinessScore } from '@/domain/readiness';
import { GROUP_LABELS, GROUP_ORDER } from '@/domain/muscles';
import { fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { addDays, parseDate, localDateOf } from '@/domain/periods';
import { Banner, Button, Card, Chip, Empty, Field, Loading, Rating, Section, Sheet, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { LineChart } from '@/ui/charts';
import { useLive } from '@/app/hooks';
import { useApp } from '@/app/AppContext';
import { getClient } from '@/services/supabase';
import { fmtDate, errMsg } from '@/ui/format';
import { useEffect } from 'react';
import type { ProgressPhoto, ReadinessRecord } from '@/domain/types';

export function Recovery() {
  const nav = useNavigate();
  const ui = useUi();
  const { today } = useApp();
  const [date, setDate] = useState(today);
  const all = useLive(() => listReadiness(), []);
  const existing = all.data?.find((r) => r.record_date === date);
  const [form, setForm] = useState<Partial<ReadinessRecord>>({});
  const key = `${date}:${existing?.id ?? 'new'}:${existing?.client_updated_at ?? ''}`;
  const cur: Partial<ReadinessRecord> = useMemo(() => ({ ...(existing ?? {}), ...form }), [existing, form]);
  const score = readinessScore({ sleep_quality: cur.sleep_quality ?? null, energy: cur.energy ?? null, soreness: cur.soreness ?? null, stress: cur.stress ?? null, motivation: cur.motivation ?? null, perceived_recovery: cur.perceived_recovery ?? null, fatigue: cur.fatigue ?? null });
  const set = <K extends keyof ReadinessRecord>(k: K, v: ReadinessRecord[K]): void => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: 'sleep_hours' | 'resting_hr' | 'hrv_ms', max: number) => <input className="input" inputMode="decimal" aria-label={k} defaultValue={cur[k] ?? ''} onChange={(e) => { const n = parseNumber(e.target.value); set(k, n !== null && n >= 0 && n <= max ? n : null); }} />;
  const sessions = useLive(() => listSessions({ status: ['completed_as_planned', 'completed_modified', 'partial'] }, 200), []);

  const analysis = useMemo(() => {
    const byDate = new Map((all.data ?? []).map((r) => [r.record_date, readinessScore(r)]));
    const pairs = (sessions.data ?? []).map((s) => ({ r: byDate.get(s.session_date) ?? null, rpe: s.session_rpe })).filter((p): p is { r: number; rpe: number } => p.r !== null && p.rpe !== null);
    const c = correlate(pairs.map((p) => p.r), pairs.map((p) => p.rpe));
    const poor = (all.data ?? []).filter((r) => r.sleep_hours !== null && r.sleep_hours < 6).map((r) => r.record_date);
    const good = (all.data ?? []).filter((r) => r.sleep_hours !== null && r.sleep_hours >= 7).map((r) => r.record_date);
    const rpeOn = (ds: string[]): number | null => { const v = (sessions.data ?? []).filter((s) => ds.includes(s.session_date) && s.session_rpe !== null).map((s) => s.session_rpe as number); return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return { c, poorRpe: rpeOn(poor), goodRpe: rpeOn(good) };
  }, [all.data, sessions.data]);

  const hist = (all.data ?? []).slice(-21).map((r) => ({ d: r.record_date, s: readinessScore(r) })).filter((x): x is { d: string; s: number } => x.s !== null);
  const t0 = hist[0] ? parseDate(hist[0].d) : 0;

  async function save(): Promise<void> {
    try { await saveReadiness(date, { ...form }); setForm({}); ui.toast('Check-in saved', { tone: 'ok' }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <div className="screen" key={key}>
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Recovery</h1></div>
      <Banner icon="info">Optional and separate from your lifting numbers. It is a simple self-rating — not a medical or overtraining measure.</Banner>
      <div className="col mt-3">
        <Field label="Date">{(id) => <input id={id} className="input" type="date" max={today} value={date} onChange={(e) => { setDate(e.target.value); setForm({}); }} />}</Field>
        <Rating label="Sleep quality" value={cur.sleep_quality ?? null} onChange={(v) => set('sleep_quality', v)} lowLabel="Poor" highLabel="Great" />
        <Rating label="Energy" value={cur.energy ?? null} onChange={(v) => set('energy', v)} lowLabel="Drained" highLabel="Energised" />
        <Rating label="Muscle soreness" value={cur.soreness ?? null} onChange={(v) => set('soreness', v)} lowLabel="None" highLabel="Very sore" />
        <Rating label="Stress" value={cur.stress ?? null} onChange={(v) => set('stress', v)} lowLabel="Calm" highLabel="High" />
        <Rating label="Motivation" value={cur.motivation ?? null} onChange={(v) => set('motivation', v)} lowLabel="Low" highLabel="High" />
        <Rating label="Perceived recovery" value={cur.perceived_recovery ?? null} onChange={(v) => set('perceived_recovery', v)} lowLabel="Not recovered" highLabel="Fully recovered" />
        <Rating label="General fatigue" value={cur.fatigue ?? null} onChange={(v) => set('fatigue', v)} lowLabel="Fresh" highLabel="Exhausted" />
        <div className="row-flex"><Field label="Sleep (hours)">{() => num('sleep_hours', 24)}</Field><Field label="Resting HR">{() => num('resting_hr', 250)}</Field><Field label="HRV (ms)">{() => num('hrv_ms', 500)}</Field></div>
        <div className="field"><span className="label">Where do you feel sore?</span><div className="chips wrap">{GROUP_ORDER.map((g) => { const on = (cur.soreness_areas ?? []).includes(g); return <Chip key={g} on={on} onClick={() => set('soreness_areas', on ? (cur.soreness_areas ?? []).filter((x) => x !== g) : [...(cur.soreness_areas ?? []), g])}>{GROUP_LABELS[g]}</Chip>; })}</div></div>
        <Field label="Illness / interruption note (optional)">{(id) => <input id={id} className="input" defaultValue={cur.illness_note ?? ''} onChange={(e) => set('illness_note', e.target.value || null)} />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} className="input" defaultValue={cur.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} />}</Field>
        <div className="card blue row-flex between"><span>Readiness</span><span className="strong gold">{score !== null ? `${score} · ${readinessLabel(score)}` : 'Answer 3+ ratings'}</span></div>
        <Button variant="primary" block onClick={() => void save()} disabled={Object.keys(form).length === 0}>Save check-in</Button>
      </div>
      <Section title="Last 3 weeks">
        <Card className="blue">{hist.length >= 2 ? <LineChart ariaLabel="Readiness trend" series={[{ name: 'Readiness', points: hist.map((h) => ({ x: Math.round((parseDate(h.d) - t0) / 86_400_000), y: h.s, label: `${fmtDate(h.d)} · ${h.s}` })) }]} xTicks={[0, Math.round((parseDate(hist.at(-1)!.d) - t0) / 86_400_000)].map((x) => ({ x, label: fmtDate(addDays(hist[0]!.d, x), { weekday: false }) }))} /> : <Empty icon="moon" title="Not enough check-ins yet" hint="A trend needs at least two days." />}</Card>
      </Section>
      <Section title="Patterns in your data">
        <Card>
          {analysis.c ? <p className="small">Readiness vs session effort (RPE): correlation {analysis.c.r.toFixed(2)} ({analysis.c.strength}, {analysis.c.n} sessions). <span className="dim">{analysis.c.note}</span></p> : <p className="small dim">Needs 8+ sessions that have both a check-in and a session RPE.</p>}
          {analysis.poorRpe !== null && analysis.goodRpe !== null && <p className="small mt-2">Average session RPE after &lt; 6 h sleep: <span className="strong">{analysis.poorRpe.toFixed(1)}</span> · after 7 h+: <span className="strong">{analysis.goodRpe.toFixed(1)}</span>. <span className="dim">Correlation, not proof of cause.</span></p>}
        </Card>
      </Section>
    </div>
  );
}

const BODY_KEYS: BodyKey[] = ['bodyweight_kg', 'waist_cm', 'chest_cm', 'arm_cm', 'thigh_cm', 'hip_cm', 'calf_cm', 'body_fat_pct', 'muscle_mass_kg'];

export function Body() {
  const nav = useNavigate();
  const ui = useUi();
  const { today, unit } = useApp();
  const rows = useLive(() => listBody(), []);
  const photos = useLive(() => listPhotos(), []);
  const [key, setKey] = useState<BodyKey>('bodyweight_kg');
  const [add, setAdd] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<ProgressPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const series = useMemo(() => seriesOf(rows.data ?? [], key), [rows.data, key]);
  const avg = useMemo(() => rollingAverage(series, 7), [series]);
  const rate = weeklyRate(series, today, 28);
  const isW = key === 'bodyweight_kg' || key === 'muscle_mass_kg';
  const conv = (v: number): number => (isW ? toDisplayWeight(v, unit) : v);
  const t0 = series[0] ? parseDate(series[0].date) : 0;
  const lab = (k: BodyKey): string => `${BODY_LABELS[k]}${isW && k === key ? ` (${unit})` : k.endsWith('_cm') ? ' (cm)' : k === 'body_fat_pct' ? ' (%)' : ''}`;

  async function pickPhoto(f: File | undefined): Promise<void> {
    if (!f) return;
    try { const blob = await shrinkImage(f); await addPhoto(blob, null, null); const c = getClient(); if (c) void uploadPendingPhotos(c); ui.toast('Photo saved privately', { tone: 'ok' }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Body</h1><Button small variant="primary" icon="plus" onClick={() => setAdd(true)}>Log</Button></div>
      <div className="chips">{BODY_KEYS.map((k) => <Chip key={k} on={key === k} onClick={() => setKey(k)}>{BODY_LABELS[k].replace(' (estimate)', '')}</Chip>)}</div>
      <Card className="blue mt-3">
        {series.length >= 2 ? (
          <>
            <LineChart ariaLabel={`${BODY_LABELS[key]} over time`} series={[{ name: 'Measured', points: series.map((p) => ({ x: Math.round((parseDate(p.date) - t0) / 86_400_000), y: conv(p.value), label: `${fmtDate(p.date)} · ${conv(p.value)}` })) }, ...(key === 'bodyweight_kg' && series.length >= 4 ? [{ name: '7-day average', color: 'var(--series-2)', points: avg.map((p) => ({ x: Math.round((parseDate(p.date) - t0) / 86_400_000), y: conv(p.value) })) }] : [])]}
              xTicks={[0, Math.round((parseDate(series.at(-1)!.date) - t0) / 86_400_000)].map((x) => ({ x, label: fmtDate(addDays(series[0]!.date, x), { weekday: false }) }))} />
            {rate !== null && <p className="small mt-2">Rate of change: <span className="strong gold">{rate >= 0 ? '+' : '−'}{Math.abs(isW ? toDisplayWeight(rate, unit) : rate).toFixed(2)} {isW ? unit : key === 'body_fat_pct' ? '%' : 'cm'}/week</span> over the last 4 weeks</p>}
            {key === 'bodyweight_kg' && <p className="tiny dim mt-2">Scale weight changes are not the same as muscle gain. Gold line = each weigh-in, green = 7-day average.</p>}
            {(key === 'body_fat_pct' || key === 'muscle_mass_kg') && <p className="tiny dim mt-2">Consumer body-fat and muscle estimates are rough; watch the trend, not single readings.</p>}
          </>
        ) : <Empty icon="scale" title={series.length === 1 ? 'One reading so far' : 'No readings yet'} hint="Add a second reading to see a trend. Only enter what you actually measure — empty fields are never stored as zero." action={<Button variant="primary" onClick={() => setAdd(true)}>Log a measurement</Button>} />}
      </Card>
      <Section title="History">
        {rows.loading ? <Loading /> : (rows.data?.length ?? 0) === 0 ? <Card><p className="dim small">Nothing logged.</p></Card> : (
          <Card className="pad-0"><div className="list">{[...(rows.data ?? [])].reverse().slice(0, 20).map((r) => <div key={r.id} className="item"><div className="grow"><div className="strong">{fmtDate(localDateOf(r.measured_at), { year: true })}</div><div className="small dim">{BODY_KEYS.filter((k) => r[k] !== null).map((k) => `${BODY_LABELS[k].split(' ')[0]} ${k === 'bodyweight_kg' || k === 'muscle_mass_kg' ? toDisplayWeight(r[k] as number, unit) : r[k]}`).join(' · ')}</div></div><button className="icon-btn" type="button" aria-label="Delete reading" onClick={async () => { await deleteBody(r.id); ui.toast('Reading removed'); }}><Icon name="trash" size={20} /></button></div>)}</div></Card>
        )}
      </Section>
      <Section title="Progress photos (optional)" action={<Button small variant="soft" icon="camera" onClick={() => fileRef.current?.click()}>Add</Button>}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} aria-label="Take or choose a photo" />
        {(photos.data?.length ?? 0) === 0 ? <Card><p className="small dim">Photos stay on your phone and, if you're signed in, in a private folder only you can open. Nothing is shared.</p></Card> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>{photos.data?.map((p) => <PhotoThumb key={p.id} p={p} onOpen={() => setViewPhoto(p)} />)}</div>}
      </Section>
      <Sheet open={add} onClose={() => setAdd(false)} title="Log measurement"><BodyForm onSaved={() => setAdd(false)} today={today} /></Sheet>
      <Sheet open={!!viewPhoto} onClose={() => setViewPhoto(null)} title={viewPhoto ? fmtDate(localDateOf(viewPhoto.taken_at), { year: true }) : ''}>
        {viewPhoto && <PhotoFull p={viewPhoto} onDelete={async () => { if (await ui.confirm({ title: 'Delete this photo?', message: 'The photo is removed from this phone and from your private cloud folder.', confirmLabel: 'Delete', danger: true })) { await deletePhoto(viewPhoto, getClient()); setViewPhoto(null); } }} />}
      </Sheet>
      <span hidden>{lab(key)}</span>
    </div>
  );
}

function usePhotoUrl(p: ProgressPhoto): string | null {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { let url: string | null = null; void photoUrl(p, getClient()).then((x) => { url = x; setU(x); }); return () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); }; }, [p]);
  return u;
}
const PhotoThumb = ({ p, onOpen }: { p: ProgressPhoto; onOpen: () => void }) => { const u = usePhotoUrl(p); return <button type="button" onClick={onOpen} aria-label={`Photo from ${fmtDate(localDateOf(p.taken_at))}`} style={{ aspectRatio: '3/4', borderRadius: 12, border: '1px solid var(--line)', background: u ? `center/cover url(${u})` : 'var(--card)' }} />; };
const PhotoFull = ({ p, onDelete }: { p: ProgressPhoto; onDelete: () => void }) => { const u = usePhotoUrl(p); return <div className="col">{u ? <img src={u} alt="Progress" style={{ width: '100%', borderRadius: 12 }} /> : <Loading />}<Button variant="danger" icon="trash" onClick={onDelete}>Delete photo</Button></div>; };

function BodyForm({ onSaved, today }: { onSaved: () => void; today: string }) {
  const ui = useUi();
  const { unit } = useApp();
  const [v, setV] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  async function save(): Promise<void> {
    const rec: Record<string, number | null> = {};
    for (const k of BODY_KEYS) { const n = parseNumber(v[k] ?? ''); rec[k] = n === null ? null : (k === 'bodyweight_kg' || k === 'muscle_mass_kg') ? fromDisplayWeight(n, unit) : n; }
    if (Object.values(rec).every((x) => x === null)) { ui.toast('Enter at least one measurement', { tone: 'err' }); return; }
    try { await saveBody({ measured_at: `${date}T08:00:00.000Z`, ...rec, body_fat_method: method || null, notes: notes || null }); ui.toast('Saved', { tone: 'ok' }); onSaved(); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); }
  }
  return (
    <div className="col">
      <Field label="Date">{(id) => <input id={id} className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {BODY_KEYS.map((k) => <Field key={k} label={`${BODY_LABELS[k]}${k === 'bodyweight_kg' || k === 'muscle_mass_kg' ? ` (${unit})` : k.endsWith('_cm') ? ' (cm)' : ' (%)'}`}>{(id) => <input id={id} className="input" inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />}</Field>)}
      </div>
      <Field label="Body-fat method (optional)">{(id) => <input id={id} className="input" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="scale, calipers, DEXA…" />}</Field>
      <Field label="Notes (optional)">{(id) => <input id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Morning, fasted…" />}</Field>
      <Button variant="primary" block onClick={() => void save()}>Save</Button>
    </div>
  );
}
