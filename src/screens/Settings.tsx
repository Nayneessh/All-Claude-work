import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppSettings } from '@/domain/types';
import type { PrType as PrEventType } from '@/domain/records';
import { Banner, Button, Card, Chip, Field, Section, Seg, Sheet, Toggle, useUi } from '@/ui/kit';
import { Icon } from '@/ui/icons';
import { useApp } from '@/app/AppContext';
import { fmtDate, errMsg, weekdayShort } from '@/ui/format';
import { changePassword, deleteCloudAccount } from '@/services/auth';
import { DEFAULT_REMINDERS, applyReminders, nextDays } from '@/services/reminders';
import { disableLock, lockEnabled, setPin } from '@/app/AppLock';
import { PR_LABELS } from '@/domain/records';
import { formatWeight, fromDisplayWeight, parseNumber, toDisplayWeight } from '@/domain/units';
import { activePrograms } from '@/data/repo/programs';
import { planForDate } from '@/data/repo/sessions';
import { db, allTables } from '@/data/db';
import { exportBackup } from '@/data/backup';
import { shareFile, requestNotificationPermission } from '@/services/platform';

export function Settings() {
  const nav = useNavigate();
  const ui = useUi();
  const { profile, settings, unit, saveProfile, auth, signOut, today, weekStart } = useApp();
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const rem = { ...DEFAULT_REMINDERS, ...(settings.reminders ?? {}) };
  const setS = async (p: Partial<AppSettings>): Promise<void> => { try { await saveProfile({ settings: p }); } catch (e) { ui.toast(errMsg(e), { tone: 'err' }); } };
  const setRem = async (p: Partial<typeof rem>): Promise<void> => {
    const next = { ...rem, ...p };
    await setS({ reminders: next });
    if (p.enabled && !(await requestNotificationPermission())) ui.toast('Notifications are blocked in Android settings.', { tone: 'err' });
    const wds = new Set((await activePrograms()).flatMap((b) => b.templates.map((t) => t.weekday ?? 0)));
    const done = (await planForDate(today)).some((i) => i.session && ['completed_as_planned', 'completed_modified', 'partial'].includes(i.session.status));
    await applyReminders(next, nextDays(today, wds, done));
  };
  const prTypes = settings.pr_types ?? (Object.keys(PR_LABELS) as PrEventType[]);

  async function wipeLocal(): Promise<void> {
    const snapshot = JSON.stringify(await exportBackup());
    await shareFile(`monster-gains-final-backup-${today}.json`, snapshot).catch(() => undefined);
    await db.transaction('rw', allTables(), async () => { for (const t of allTables()) await t.clear(); });
    await db.meta.clear();
    window.location.reload();
  }

  return (
    <div className="screen">
      <div className="page-title"><button className="icon-btn" type="button" aria-label="Back" onClick={() => nav(-1)}><Icon name="left" /></button><h1>Settings</h1></div>

      <Section title="Profile">
        <Card className="col">
          <Field label="Name">{(id) => <input id={id} className="input" defaultValue={profile?.display_name ?? ''} onBlur={(e) => void saveProfile({ display_name: e.target.value.trim() || null })} />}</Field>
          <div className="field"><span className="label">Units</span><Seg value={unit} onChange={(v) => void saveProfile({ units: v })} label="Units" options={[{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }]} /></div>
          <div className="field"><span className="label">Week starts on</span><Seg value={String(weekStart)} onChange={(v) => void saveProfile({ week_start: Number(v) })} label="Week start" options={[{ value: '1', label: 'Monday' }, { value: '7', label: 'Sunday' }, { value: '6', label: 'Saturday' }]} /></div>
          <div className="row-flex"><Field label="Height (cm)">{(id) => <input id={id} className="input" inputMode="decimal" defaultValue={profile?.height_cm ?? ''} onBlur={(e) => void saveProfile({ height_cm: parseNumber(e.target.value) })} />}</Field><Field label="Birth year">{(id) => <input id={id} className="input" inputMode="numeric" defaultValue={profile?.birth_year ?? ''} onBlur={(e) => void saveProfile({ birth_year: parseNumber(e.target.value) })} />}</Field></div>
          <Field label="Limitations / exercises to avoid (optional)">{(id) => <textarea id={id} className="input" defaultValue={profile?.constraints_note ?? ''} onBlur={(e) => void saveProfile({ constraints_note: e.target.value || null })} />}</Field>
          <p className="tiny dim">Everything here is optional. Nothing leaves your account.</p>
        </Card>
      </Section>

      <Section title="Logging">
        <Card className="col">
          <div className="field"><span className="label">Effort scale</span><Seg value={settings.rpe_mode} onChange={(v) => void setS({ rpe_mode: v })} label="Effort scale" options={[{ value: 'rir', label: 'RIR' }, { value: 'rpe', label: 'RPE' }, { value: 'none', label: 'Off' }]} /></div>
          <Field label="Default rest (seconds)">{(id) => <input id={id} className="input" inputMode="numeric" defaultValue={settings.default_rest_s} onBlur={(e) => { const n = parseNumber(e.target.value); if (n !== null && n >= 0 && n <= 1800) void setS({ default_rest_s: Math.round(n) }); }} />}</Field>
          <div className="row-flex between"><span>Start rest timer automatically</span><Toggle on={settings.auto_start_rest} onChange={(v) => void setS({ auto_start_rest: v })} label="Auto-start rest timer" /></div>
          <div className="row-flex between"><span>Beep when rest is over</span><Toggle on={settings.rest_sound} onChange={(v) => void setS({ rest_sound: v })} label="Rest beep" /></div>
          <div className="row-flex between"><span>Vibrate when rest is over</span><Toggle on={settings.rest_vibrate} onChange={(v) => void setS({ rest_vibrate: v })} label="Rest vibrate" /></div>
          <Field label={`Bar weight (${unit})`}>{(id) => <input id={id} className="input" inputMode="decimal" defaultValue={toDisplayWeight(settings.plate_bar_kg, unit)} onBlur={(e) => { const n = parseNumber(e.target.value); if (n !== null && n > 0) void setS({ plate_bar_kg: fromDisplayWeight(n, unit) }); }} />}</Field>
          <div className="field"><span className="label">Text size</span><Seg value={String(settings.text_scale)} onChange={(v) => void setS({ text_scale: Number(v) })} label="Text size" options={[{ value: '0.9', label: 'Small' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Large' }, { value: '1.3', label: 'Huge' }]} /></div>
        </Card>
      </Section>

      <Section title="Calculation rules">
        <Card className="col">
          <div className="field"><span className="label">Estimated 1RM formula</span><Seg value={settings.e1rm_formula} onChange={(v) => void setS({ e1rm_formula: v })} label="1RM formula" options={[{ value: 'epley', label: 'Epley' }, { value: 'brzycki', label: 'Brzycki' }, { value: 'lombardi', label: 'Lombardi' }]} /></div>
          <p className="tiny dim">Epley: w×(1+reps/30). Used for sets of 1–12 reps; always labelled “estimated”.</p>
          <div className="row-flex between"><div className="grow"><div>Double per-hand dumbbell loads in volume</div><div className="tiny dim">Off: a 25 kg dumbbell press set of 10 counts 250 (as logged).</div></div><Toggle on={settings.double_per_hand} onChange={(v) => void setS({ double_per_hand: v })} label="Double per-hand loads" /></div>
          <div className="row-flex between"><div className="grow"><div>Count sets without RIR/RPE as “hard sets”</div><div className="tiny dim">Hard = RIR ≤ 3, RPE ≥ 7 or taken to failure.</div></div><Toggle on={settings.unrated_counts_as_hard} onChange={(v) => void setS({ unrated_counts_as_hard: v })} label="Unrated sets are hard sets" /></div>
          <div className="field"><span className="label">Secondary-muscle credit (weighted counts)</span><Seg value={String(settings.secondary_muscle_weight)} onChange={(v) => void setS({ secondary_muscle_weight: Number(v) })} label="Secondary credit" options={[{ value: '0.25', label: '¼' }, { value: '0.5', label: '½' }, { value: '0.75', label: '¾' }]} /></div>
          <div className="field"><span className="label">Records to track</span><div className="chips wrap">{(Object.keys(PR_LABELS) as PrEventType[]).map((t) => <Chip key={t} on={prTypes.includes(t)} onClick={() => void setS({ pr_types: prTypes.includes(t) ? prTypes.filter((x) => x !== t) : [...prTypes, t] })}>{PR_LABELS[t]}</Chip>)}</div></div>
          <p className="tiny dim">Bar {formatWeight(settings.plate_bar_kg, unit)}. Changing a rule recalculates charts and records instantly — your logged sets are never altered.</p>
        </Card>
      </Section>

      <Section title="Reminders">
        <Card className="col">
          <div className="row-flex between"><span>Workout reminders</span><Toggle on={rem.enabled} onChange={(v) => void setRem({ enabled: v })} label="Workout reminders" /></div>
          {rem.enabled && (
            <>
              <Field label="Time">{(id) => <input id={id} className="input" type="time" value={rem.time} onChange={(e) => void setRem({ time: e.target.value })} />}</Field>
              <div className="field"><span className="label">Days</span><div className="chips wrap">{[1, 2, 3, 4, 5, 6, 7].map((d) => <Chip key={d} on={rem.days.includes(d)} onClick={() => void setRem({ days: rem.days.includes(d) ? rem.days.filter((x) => x !== d) : [...rem.days, d] })}>{weekdayShort(d)}</Chip>)}</div></div>
              <div className="row-flex between"><span>“Not logged yet” prompt (8:30 pm)</span><Toggle on={rem.missed_prompt} onChange={(v) => void setRem({ missed_prompt: v })} label="Missed workout prompt" /></div>
              <div className="row-flex between"><span>Weekly summary (Sunday 6 pm)</span><Toggle on={rem.weekly_summary} onChange={(v) => void setRem({ weekly_summary: v })} label="Weekly summary" /></div>
              <div className="field"><span className="label">Snooze</span><Seg value={String(rem.snooze_min)} onChange={(v) => void setRem({ snooze_min: Number(v) })} label="Snooze" options={[{ value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }]} /></div>
            </>
          )}
        </Card>
      </Section>

      <Section title="Privacy & security">
        <Card className="col">
          <div className="row-flex between"><div className="grow"><div>App lock (PIN)</div><div className="tiny dim">Asks for a PIN when you return after a minute away.</div></div><Toggle on={lockEnabled()} onChange={async (v) => { if (v) { setPin1(''); setPin2(''); setPinOpen(true); } else { disableLock(); ui.toast('App lock off'); await setS({ app_lock: { enabled: false } }); } }} label="App lock" /></div>
          <p className="tiny dim">Your workouts stay on this phone and, when signed in, in your private account. Photos use a private folder. No analytics, no ads, no third parties.</p>
        </Card>
      </Section>

      <Section title="Account">
        <Card className="col">
          {auth.status === 'signed_in' ? (
            <>
              <div className="small">Signed in as <strong>{auth.email}</strong></div>
              <Button onClick={() => setPwOpen(true)}>Change password</Button>
              <Button onClick={async () => { await signOut(); ui.toast('Signed out. Your data stays on this phone.'); }}>Sign out</Button>
              <Button variant="danger" onClick={() => setDelOpen(true)}>Delete my account…</Button>
            </>
          ) : <><p className="small dim">Not signed in — everything is stored on this phone only.</p><Button variant="primary" onClick={() => nav('/auth')}>Sign in or create an account</Button></>}
        </Card>
      </Section>

      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password" footer={<Button block variant="primary" onClick={async () => { const r = await changePassword(pw); if (r.ok) { ui.toast('Password updated', { tone: 'ok' }); setPwOpen(false); setPw(''); } else ui.toast(r.error ?? 'Failed', { tone: 'err' }); }}>Update</Button>}>
        <Field label="New password" hint="At least 8 characters">{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
      </Sheet>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Set a PIN" footer={<Button block variant="primary" onClick={async () => { if (!/^\d{4,8}$/.test(pin1)) { ui.toast('Use 4–8 digits', { tone: 'err' }); return; } if (pin1 !== pin2) { ui.toast("PINs don't match", { tone: 'err' }); return; } await setPin(pin1); await setS({ app_lock: { enabled: true } }); setPinOpen(false); ui.toast('App lock on', { tone: 'ok' }); }}>Turn on</Button>}>
        <div className="col"><Banner icon="warn">If you forget the PIN you can reinstall the app, but data that is not backed up to your account would be lost. Keep a backup.</Banner>
          <Field label="PIN (4–8 digits)">{(id) => <input id={id} className="input" type="password" inputMode="numeric" maxLength={8} value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="Repeat PIN">{(id) => <input id={id} className="input" type="password" inputMode="numeric" maxLength={8} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />}</Field></div>
      </Sheet>
      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="Delete account">
        <div className="col">
          <Banner tone="err" icon="warn"><strong>This permanently deletes your cloud account and every workout stored in it.</strong> The data on this phone is kept unless you also choose to erase it.</Banner>
          <Button variant="danger" onClick={async () => { if (!(await ui.confirm({ title: 'Delete cloud account?', message: 'This cannot be undone. A backup file is offered first.', confirmLabel: 'Delete account', danger: true }))) return; await shareFile(`monster-gains-backup-before-delete-${today}.json`, JSON.stringify(await exportBackup())).catch(() => undefined); const r = await deleteCloudAccount(); if (r.ok) { ui.toast('Cloud account deleted. Local data kept.', { tone: 'ok' }); setDelOpen(false); } else ui.toast(r.error ?? 'Failed', { tone: 'err' }); }}>Delete cloud account</Button>
          <Button variant="danger" onClick={async () => { if (await ui.confirm({ title: 'Erase everything on this phone?', message: 'Every workout, program and measurement stored here is erased. A backup file is offered first. Cloud data is not touched.', confirmLabel: 'Erase this phone', danger: true })) await wipeLocal().catch((e) => ui.toast(errMsg(e), { tone: 'err' })); }}>Erase data on this phone</Button>
          <p className="tiny dim">Last backup check: {fmtDate(today, { year: true })}</p>
        </div>
      </Sheet>
    </div>
  );
}
