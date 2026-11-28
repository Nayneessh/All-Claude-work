import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../data/api';
import { useAction, useSettings } from '../../data/hooks';
import { DEFAULT_SETTINGS, type Settings } from '../../domain/types';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../../lib/push';
import { Field, Section, Select, Tabs, TextInput } from '../../ui/kit';
import { AgenciesEditor, CompaniesEditor } from './AgenciesEditor';
import { ConfigEditor } from './ConfigEditor';
import { DataTab } from './DataTab';
import { useAuth } from '../auth/AuthProvider';

type Tab = 'prefs' | 'notify' | 'lists' | 'agencies' | 'data';
const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const LISTS: { kind: Parameters<typeof ConfigEditor>[0]['kind']; label: string; noun: string; help?: string }[] = [
  { kind: 'source', label: 'Candidate sources', noun: 'Source' },
  { kind: 'pipeline_stage', label: 'Recruitment stages', noun: 'Stage', help: 'Order = the funnel order. “Type” decides what a stage means (selected, offered, joined, rejected, dropped…). Rejected and Dropped always require a reason.' },
  { kind: 'rejection_reason', label: 'Rejection reasons', noun: 'Reason', help: 'Used when a candidate is turned down (interview, client, internal…).' },
  { kind: 'drop_reason', label: 'Drop reasons', noun: 'Reason', help: 'Used when a candidate steps back (withdrew, accepted another offer, unresponsive…).' },
  { kind: 'hiring_level', label: 'Hiring levels', noun: 'Level' }, { kind: 'task_category', label: 'Task categories', noun: 'Category' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('prefs');
  return (
    <div className="stack">
      <div className="row"><h1>Settings</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'prefs', label: 'Preferences' }, { value: 'notify', label: 'Notifications' }, { value: 'lists', label: 'Lists & stages' }, { value: 'agencies', label: 'Agencies & companies' }, { value: 'data', label: 'Data & security' }]} />
      {tab === 'prefs' && <Prefs />}{tab === 'notify' && <Notify />}{tab === 'lists' && <Lists />}
      {tab === 'agencies' && <div className="grid g2"><Section title="Agencies & consultants"><AgenciesEditor /></Section><Section title="Companies"><CompaniesEditor /></Section></div>}
      {tab === 'data' && <DataTab />}
    </div>
  );
}

function Lists() {
  const [k, setK] = useState(LISTS[0].kind); const l = LISTS.find((x) => x.kind === k)!;
  return <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 14 }}>
    <div className="stack-s">{LISTS.map((x) => <button key={x.kind} className={`opt ${k === x.kind ? 'on' : ''}`} onClick={() => setK(x.kind)} style={{ justifyContent: 'flex-start' }}>{x.label}</button>)}</div>
    <Section title={l.label}><ConfigEditor key={k} kind={k} noun={l.noun} help={l.help} /></Section></div>;
}

function Prefs() {
  const { settings, save, loading } = useSettings(); const { run, busy } = useAction(); const [f, setF] = useState<Settings>(settings); const [joinText, setJoinText] = useState(settings.joiningAlertDays.join(', '));
  useEffect(() => { setF(settings); setJoinText(settings.joiningAlertDays.join(', ')); }, [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const num = (k: keyof Settings, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Math.max(min, Math.min(max, Number(e.target.value) || min)) as never);
  const dirty = JSON.stringify(f) !== JSON.stringify(settings) || joinText !== settings.joiningAlertDays.join(', ');
  async function submit() {
    const days = joinText.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0 && x <= 60);
    await run(() => save({ ...f, joiningAlertDays: days.length ? [...new Set(days)].sort((a, b) => b - a) : DEFAULT_SETTINGS.joiningAlertDays }), { success: 'Preferences saved' });
  }
  if (loading) return null;
  return (
    <Section title="Preferences" actions={<button className="btn primary" disabled={!dirty || busy} onClick={submit}>Save preferences</button>}>
      <div className="form-grid">
        <Field label="Time zone" hint="Defines “today”, reminders and the daily reports"><Select value={f.timezone} onChange={(e) => set('timezone', e.target.value)} options={ZONES} /></Field>
        <Field label="Week starts on"><Select value={String(f.weekStartsOn)} onChange={(e) => set('weekStartsOn', Number(e.target.value) as 0 | 1)} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }]} /></Field>
        <Field label="Inactivity alert after (days)" hint="A mandate with no meaningful activity this long becomes Inactive"><TextInput type="number" value={f.inactivityDays} onChange={num('inactivityDays', 1, 30)} /></Field>
        <Field label="“Nearing close” window (days)"><TextInput type="number" value={f.nearCloseDays} onChange={num('nearCloseDays', 1, 30)} /></Field>
        <Field label="Joining alerts (days before)" hint="Comma-separated, e.g. 7, 1, 0"><TextInput value={joinText} onChange={(e) => setJoinText(e.target.value)} /></Field>
        <Field label="Default follow-up reminder (minutes)"><TextInput type="number" value={f.defaultFollowupMinutes} onChange={num('defaultFollowupMinutes', 5, 1440)} /></Field>
        <Field label="Calendar starts at (hour)"><TextInput type="number" value={f.calendarStartHour} onChange={num('calendarStartHour', 0, 12)} /></Field>
        <Field label="Calendar ends at (hour)"><TextInput type="number" value={f.calendarEndHour} onChange={num('calendarEndHour', 13, 24)} /></Field>
        <Field label="Layout density"><Select value={f.density} onChange={(e) => set('density', e.target.value as never)} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} /></Field>
        <Field label="Sign out after inactivity" hint="Minutes without input; 0 = never"><TextInput type="number" value={f.idleLogoutMinutes} onChange={num('idleLogoutMinutes', 0, 1440)} /></Field>
        <label className="check full"><input type="checkbox" checked={f.maskSensitive} onChange={(e) => set('maskSensitive', e.target.checked)} /><span><b>Hide candidate phone, email and pay</b> <span className="muted small">until you press “Reveal” — useful when screen-sharing</span></span></label>
        <label className="check full"><input type="checkbox" checked={f.notifyInApp} onChange={(e) => set('notifyInApp', e.target.checked)} /><span><b>Show reminders on screen while THE SLATE is open</b></span></label>
      </div>
    </Section>
  );
}

function Notify() {
  const { user } = useAuth(); const { run, busy } = useAction(); const [st, setSt] = useState<PushState>('default'); const [msg, setMsg] = useState('');
  const count = useQuery({ queryKey: ['push-count'], queryFn: api.pushCount });
  const refresh = () => pushState().then(setSt);
  useEffect(() => { refresh(); }, []);
  const label: Record<PushState, string> = { unsupported: 'Not supported in this browser', denied: 'Blocked in browser settings', default: 'Not enabled on this device', granted: 'Permission granted — finishing set-up', subscribed: 'Enabled on this device' };
  return (
    <div className="grid g2">
      <Section title="Push reminders" sub={user?.email ?? ''}>
        <div className="stack">
          <div className="row"><span className={`chip ${st === 'subscribed' ? 'green' : st === 'denied' || st === 'unsupported' ? 'red' : 'amber'}`}>{label[st]}</span><span className="small muted">{count.data ?? 0} device{count.data === 1 ? '' : 's'} registered</span></div>
          <div className="row wrap">
            {st !== 'subscribed' && <button className="btn primary" disabled={busy || st === 'unsupported'} onClick={async () => { const r = await run(enablePush); if (r) setMsg(r.message); await refresh(); count.refetch(); }}>Enable on this device</button>}
            {st === 'subscribed' && <><button className="btn" disabled={busy} onClick={async () => { const r = await run(sendTestPush); if (r) setMsg(r.ok > 0 ? 'Test sent — you should see it in a moment.' : 'No device accepted the test notification.'); }}>Send a test</button><button className="btn danger" disabled={busy} onClick={async () => { await run(disablePush); await refresh(); count.refetch(); setMsg('Push turned off on this device.'); }}>Turn off</button></>}
          </div>
          {msg && <div className="banner info small">{msg}</div>}
          <div className="small dim stack-s"><b>How reminders reach you</b>
            <div>1. <b>Push</b> — a server job checks every 5 minutes and sends a notification to every enabled device, even when THE SLATE is closed.</div>
            <div>2. <b>On screen</b> — while the app is open you also see the reminder immediately.</div>
            <div>3. <b>Notification bell</b> — every reminder is also kept in the bell as a record.</div>
            <div className="muted">Browser notifications need your permission. On iPhone/iPad, first add THE SLATE to the Home Screen (Share → Add to Home Screen). If notifications are blocked, allow them in your browser's site settings.</div></div>
        </div>
      </Section>
      <Section title="What triggers a notification"><ul className="small dim" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
        <li>A task's <b>reminder time</b>, and its <b>follow-up</b> if still not done</li><li>A mandate going <b>inactive</b> (no meaningful activity for your threshold)</li><li>A candidate's <b>joining date</b> approaching (7 days, 1 day, today by default)</li><li>Hiring follow-ups carried over from the earlier Hiring Copilot</li></ul></Section>
    </div>
  );
}
