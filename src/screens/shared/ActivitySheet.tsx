import { useMemo, useState } from 'react';
import { logActivity } from '@/data/repo/sessions';
import { listExercises } from '@/data/repo/exercises';
import { useLive } from '@/app/hooks';
import { Button, Chip, Field, Sheet, useUi } from '@/ui/kit';
import { errMsg } from '@/ui/format';
import { parseNumber } from '@/domain/units';
import type { Exercise, ISODate } from '@/domain/types';

const KINDS: Exercise['category'][] = ['sport', 'cardio', 'conditioning', 'mobility', 'stretching'];
const hasDistance = (e: Exercise | undefined): boolean => !!e && (e.tracking_method === 'distance' || e.tracking_method === 'distance_duration');

/** Log MMA, a run, a swim or a mobility session in one step. Strength history and the program are not touched. */
export function ActivitySheet({ open, onClose, today, onSaved }: { open: boolean; onClose: () => void; today: ISODate; onSaved?: (sessionId: string) => void }) {
  const ui = useUi();
  const all = useLive(() => listExercises(), []);
  const options = useMemo(() => (all.data ?? []).filter((e) => KINDS.includes(e.category)).sort((a, b) => KINDS.indexOf(a.category) - KINDS.indexOf(b.category) || a.name.localeCompare(b.name)), [all.data]);
  const [exId, setExId] = useState<string | null>(null);
  const [date, setDate] = useState<ISODate>(today);
  const [minutes, setMinutes] = useState('');
  const [km, setKm] = useState('');
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const picked = options.find((e) => e.id === (exId ?? options[0]?.id));

  async function save(): Promise<void> {
    if (!picked) return;
    const durationMin = parseNumber(minutes);
    if (durationMin === null) { ui.toast('Enter how many minutes', { tone: 'err' }); return; }
    setBusy(true);
    try {
      const s = await logActivity({ exerciseId: picked.id, date, durationMin, distanceKm: hasDistance(picked) ? parseNumber(km) : null, rpe, notes }, today);
      ui.toast(`${picked.name} logged`, { tone: 'ok' });
      setMinutes(''); setKm(''); setRpe(null); setNotes('');
      onSaved?.(s.id);
      onClose();
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add activity" footer={<Button block variant="primary" disabled={busy || !picked} onClick={() => void save()}>{busy ? 'Saving…' : 'Save activity'}</Button>}>
      <div className="col">
        <p className="small dim">For MMA, cardio, sport or mobility. It is saved as its own session — your strength program and totals are not changed.</p>
        <div className="field"><span className="label">What did you do?</span>
          <div className="chips wrap">{options.map((e) => <Chip key={e.id} on={picked?.id === e.id} onClick={() => setExId(e.id)}>{e.name}</Chip>)}</div></div>
        <Field label="Date">{(id) => <input id={id} className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}</Field>
        <div className="row-flex">
          <Field label="Minutes">{(id) => <input id={id} className="input" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="45" />}</Field>
          {hasDistance(picked) && <Field label="Distance (km)">{(id) => <input id={id} className="input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="optional" />}</Field>}
        </div>
        <div className="field"><span className="label">How hard? (RPE 1–10, optional)</span><div className="chips wrap">{[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <Chip key={n} on={rpe === n} onClick={() => setRpe(rpe === n ? null : n)}>{n}</Chip>)}</div></div>
        <Field label="Notes">{(id) => <textarea id={id} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sparring, drilling, how it felt…" />}</Field>
      </div>
    </Sheet>
  );
}
