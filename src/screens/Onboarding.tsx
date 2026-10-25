import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Chip, Field, Seg, Toggle, useUi } from '@/ui/kit';
import { useApp } from '@/app/AppContext';
import { createProgram, listPrograms } from '@/data/repo/programs';
import { ROUTINE_START_DATE, routineV6Program, routineV6Tree } from '@/data/seed/routineV6';
import { fmtDate, errMsg } from '@/ui/format';
import type { Unit } from '@/domain/types';

const GOALS = ['Hypertrophy', 'Strength', 'Fat loss', 'General fitness', 'Endurance', 'Athletic performance', 'Mobility'];
const EQUIP = ['Barbell', 'Dumbbell', 'Cable', 'Machines', 'Bodyweight', 'Bands', 'Kettlebell'];

export function Onboarding() {
  const nav = useNavigate();
  const { profile, saveProfile, today, auth } = useApp();
  const ui = useUi();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [units, setUnits] = useState<Unit>(profile?.units ?? 'kg');
  const [experience, setExperience] = useState<'beginner' | 'intermediate' | 'advanced' | null>(profile?.experience ?? null);
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? ['Hypertrophy']);
  const [equip, setEquip] = useState<string[]>(profile?.equipment ?? []);
  const [bodyweight, setBodyweight] = useState('');
  const [loadRoutine, setLoadRoutine] = useState(true);
  const [busy, setBusy] = useState(false);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void): void => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function finish(): Promise<void> {
    setBusy(true);
    try {
      const bw = Number(bodyweight.replace(',', '.'));
      const baselineKg = bodyweight && Number.isFinite(bw) && bw > 0 ? (units === 'lb' ? Math.round(bw * 0.45359237 * 100) / 100 : bw) : null;
      await saveProfile({ display_name: name.trim() || null, units, experience, goals, equipment: equip, onboarding_done: true, ...(baselineKg ? { baseline: { bodyweight_kg: baselineKg } } : {}) });
      if (loadRoutine && (await listPrograms({ includeArchived: true })).length === 0) {
        await createProgram(routineV6Program(), routineV6Tree(), today);
        ui.toast('Your v6 routine is loaded', { tone: 'ok' });
      }
      nav('/', { replace: true });
    } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } finally { setBusy(false); }
  }

  return (
    <div className="screen no-nav">
      <div className="row-flex gap-2" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <div key={i} className="bar grow"><i style={{ width: i <= step ? '100%' : '0%' }} /></div>)}</div>
      {step === 0 && (
        <div className="col mt-5">
          <img className="hero-logo" src="./logo.svg" alt="" />
          <h1 className="center">Welcome to Monster Gains</h1>
          <p className="center dim">Plan it. Log it. Watch it grow. Everything is saved on your phone first — you never need a connection to train.</p>
          <Field label="What should we call you? (optional)">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="given-name" />}</Field>
          <div className="field"><span className="label">Units</span><Seg value={units} onChange={setUnits} options={[{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }]} label="Weight units" /></div>
          <Button variant="primary" block onClick={() => setStep(1)}>Next</Button>
        </div>
      )}
      {step === 1 && (
        <div className="col mt-5">
          <h2>Your training</h2><p className="dim small">All optional — it just helps with suggestions. You can change it any time.</p>
          <div className="field"><span className="label">Experience</span><Seg value={experience ?? ('' as never)} onChange={setExperience} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]} label="Experience" /></div>
          <div className="field"><span className="label">Goals</span><div className="chips wrap">{GOALS.map((g) => <Chip key={g} on={goals.includes(g)} onClick={() => toggle(goals, g, setGoals)}>{g}</Chip>)}</div></div>
          <div className="field"><span className="label">Equipment you use</span><div className="chips wrap">{EQUIP.map((g) => <Chip key={g} on={equip.includes(g)} onClick={() => toggle(equip, g, setEquip)}>{g}</Chip>)}</div></div>
          <Field label={`Bodyweight (${units}) — optional`} hint="Used only to count bodyweight exercises in volume.">{(id) => <input id={id} className="input" inputMode="decimal" value={bodyweight} onChange={(e) => setBodyweight(e.target.value)} placeholder="e.g. 82" />}</Field>
          <div className="row-flex"><Button block onClick={() => setStep(0)}>Back</Button><Button block variant="primary" onClick={() => setStep(2)}>Next</Button></div>
        </div>
      )}
      {step === 2 && (
        <div className="col mt-5">
          <h2>Your program</h2>
          <div className="card hl">
            <div className="row-flex between"><div><div className="strong">v6 · Arms First · Chest = Back</div><div className="small dim">Mon–Sat · 98 sets/week · starts {fmtDate(ROUTINE_START_DATE)}</div></div><Toggle on={loadRoutine} onChange={setLoadRoutine} label="Load my v6 routine" /></div>
            <p className="small dim mt-3">Your routine from the sheet, ready to run — every exercise, set, rep range, RIR, tempo, rest and last-set technique. Edit anything later.</p>
          </div>
          {auth.status !== 'signed_in' && (
            <Banner icon="cloud" action={<Button small variant="soft" onClick={() => nav('/auth', { state: { from: '/onboarding' } })}>Sign in</Button>}>
              <strong>Back up your progress.</strong> Create a free account so your history can never be lost with the phone. You can do this later.
            </Banner>
          )}
          <div className="row-flex"><Button block onClick={() => setStep(1)}>Back</Button><Button block variant="primary" disabled={busy} onClick={() => void finish()}>{busy ? 'Setting up…' : 'Start training'}</Button></div>
        </div>
      )}
    </div>
  );
}
