import { useMemo, useState } from 'react';
import { api } from '../../data/api';
import { parseMandate } from '../../data/nlClient';
import { ALL_RECRUITMENT_KEYS, K, useAction, useAgencies, useCompanies, useConfig, useDraft, useToday } from '../../data/hooks';
import { URGENCIES, WORK_MODES, type MandateRow, type Urgency } from '../../domain/types';
import type { MandateInput } from '../../domain/nl/mandateParser';
import type { ParseResult } from '../../domain/nl/common';
import { validateDocument } from '../../lib/storage';
import { Field, Icon, Select, TextArea, TextInput, Tabs } from '../../ui/kit';
import { Modal } from '../../ui/Modal';
import { useAuth } from '../auth/AuthProvider';
import { ParseBanner } from './ParseBanner';

type Form = Omit<MandateInput, 'positions'> & { positions: string; id?: string; waiting_on: string; hasConsultant: boolean };
const blank = (): Form => ({ title: '', company: '', stakeholder: '', level: '', positions: '1', location: '', work_mode: '', reporting_to: '', span: '', budget: '', urgency: 'Medium', confidential: false,
  received_on: '', started_on: '', target_close: '', consultants: [], notes: '', waiting_on: '', hasConsultant: false });
const fromRow = (m: MandateRow): Form => ({ id: m.id, title: m.title, company: m.company_name ?? '', stakeholder: m.stakeholder ?? '', level: m.level ?? '', positions: String(m.positions), location: m.location ?? '',
  work_mode: m.work_mode ?? '', reporting_to: m.reporting_to ?? '', span: m.span ?? '', budget: m.budget ?? '', urgency: m.urgency, confidential: m.confidential, received_on: m.received_on ?? '',
  started_on: m.started_on ?? '', target_close: m.target_close ?? '', consultants: m.consultants, notes: m.notes ?? '', waiting_on: m.waiting_on ?? '', hasConsultant: m.consultants.length > 0 });

export function validateMandate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = 'Enter the mandate title.';
  if (!f.company.trim()) e.company = 'Enter the company / entity.';
  const n = Number(f.positions); if (!Number.isInteger(n) || n < 1 || n > 500) e.positions = 'Use a whole number from 1.';
  if (f.received_on && f.target_close && f.target_close < f.received_on) e.target_close = 'Target close cannot be before the received date.';
  if (f.started_on && f.target_close && f.target_close < f.started_on) e.target_close = 'Target close cannot be before the work start date.';
  if (f.hasConsultant && f.consultants.length === 0) e.consultants = 'Add the consultant\'s name, or untick the box.';
  return e;
}

export function MandateForm({ mandate, startInQuick, onClose, onSaved }: { mandate?: MandateRow; startInQuick?: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = !!mandate;
  const { user } = useAuth(); const today = useToday();
  const cfg = useConfig(); const companies = useCompanies(); const agencies = useAgencies();
  const [draft, setDraft, clearDraft] = useDraft<Form>(editing ? `mandate-${mandate!.id}` : 'mandate-new', editing ? fromRow(mandate!) : blank());
  const [f, setF] = useState<Form>(draft);
  const [tab, setTab] = useState<'quick' | 'form'>(startInQuick && !editing ? 'quick' : 'form');
  const [text, setText] = useState(''); const [parse, setParse] = useState<ParseResult<MandateInput> | null>(null); const [parsing, setParsing] = useState(false);
  const [dirty, setDirty] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null); const [consultantInput, setConsultantInput] = useState('');
  const { run, busy } = useAction();
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { const n = { ...f, [k]: v }; setF(n); setDraft(n); setDirty(true); if (errors[k as string]) setErrors({ ...errors, [k as string]: '' }); };
  const levels = cfg.labels('hiring_level');
  const levelOptions = f.level && !levels.includes(f.level) ? [f.level, ...levels] : levels;
  const flag = (k: string) => (parse && parse.ambiguous[k]) || (parse && parse.inferred.includes(k) ? 'Inferred — please confirm' : undefined);
  const miss = (k: string) => !!parse && parse.missing.includes(k) && !(f as unknown as Record<string, unknown>)[k];

  async function understand() {
    if (!text.trim()) return; setParsing(true);
    const r = await parseMandate(text, { today, levels, companies: (companies.data ?? []).map((c) => c.name), agencies: (agencies.data ?? []).map((a) => a.name) });
    setParsing(false); setParse(r);
    const x = r.fields; const n: Form = { ...f };
    for (const [k, v] of Object.entries(x)) { if (v === undefined || v === null) continue; if (k === 'positions') n.positions = String(v); else if (k === 'consultants') { n.consultants = v as string[]; n.hasConsultant = (v as string[]).length > 0; } else (n as unknown as Record<string, unknown>)[k] = v; }
    setF(n); setDraft(n); setDirty(true); setTab('form'); setErrors({});
  }
  function addConsultant() { const v = consultantInput.trim().replace(/,$/, ''); if (!v) return; if (!f.consultants.some((c) => c.toLowerCase() === v.toLowerCase())) set('consultants', [...f.consultants, v]); setConsultantInput(''); }
  async function save() {
    const err = validateMandate(f); setErrors(err);
    if (Object.keys(err).length) { setTab('form'); return; }
    if (file) { const m = validateDocument(file); if (m) { setErrors({ file: m }); return; } }
    const id = await run(async () => {
      const mid = await api.saveMandate({ id: f.id, title: f.title.trim(), company: f.company.trim(), stakeholder: f.stakeholder, level: f.level, positions: Number(f.positions) as never, location: f.location, work_mode: f.work_mode,
        reporting_to: f.reporting_to, span: f.span, budget: f.budget, urgency: f.urgency, confidential: f.confidential, received_on: f.received_on, started_on: f.started_on, target_close: f.target_close,
        notes: f.notes, waiting_on: f.waiting_on, consultants: f.hasConsultant ? f.consultants : [] } as never);
      if (file) { try { await api.uploadJd(mid, user!.id, file); } catch (e) { throw new Error(`The mandate was saved, but the JD upload failed: ${(e as Error).message}. Re-upload it from the mandate page.`); } }
      return mid;
    }, { success: editing ? 'Mandate updated' : 'Mandate created', invalidate: [...ALL_RECRUITMENT_KEYS, K.companies, K.agencies, K.mandateAgencies] });
    if (id) { clearDraft(); setDirty(false); onSaved(id); }
  }
  const agencyNames = useMemo(() => (agencies.data ?? []).map((a) => a.name), [agencies.data]);

  return (
    <Modal drawer dirty={dirty} onClose={() => { clearDraft(); onClose(); }} title={editing ? `Edit mandate — ${mandate!.title}` : 'New mandate'}
      footer={<><button className="btn" onClick={() => { clearDraft(); onClose(); }} type="button">Cancel</button><button className="btn primary" onClick={save} disabled={busy} type="button">{busy ? <span className="spinner" /> : editing ? 'Save changes' : 'Confirm & create mandate'}</button></>}>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'quick', label: <><Icon n="spark" size={15} /> Describe it</> }, { value: 'form', label: 'Mandate form' }]} />
      {tab === 'quick' && (
        <div className="stack">
          <div className="dim small">Type or paste the requirement in plain words. I'll fill the form for you to review — nothing is saved until you confirm.</div>
          <TextArea autoFocus rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. VP Procurement for ABC Company, Mumbai, reporting to the CEO, budget 80 lakhs, immediate requirement, two positions, confidential mandate."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) understand(); }} />
          <div className="row"><button className="btn primary" onClick={understand} disabled={parsing || !text.trim()} type="button">{parsing ? <><span className="spinner" /> Reading…</> : <><Icon n="spark" size={15} /> Fill the form</>}</button>
            <span className="tiny muted">or press <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> · or switch to the form to type manually</span></div>
        </div>
      )}
      {tab === 'form' && (
        <div className="stack">
          {parse && <ParseBanner r={parse as never} onDismiss={() => setParse(null)} />}
          <div className="form-grid">
            <Field label="Mandate title" required error={errors.title} flag={flag('title')} missing={miss('title')} full><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} placeholder="e.g. Chief Financial Officer" /></Field>
            <Field label="Company / entity" required error={errors.company} flag={flag('company')} missing={miss('company')}><TextInput list="cos" value={f.company} onChange={(e) => set('company', e.target.value)} maxLength={120} /><datalist id="cos">{(companies.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist></Field>
            <Field label="Hiring manager level" flag={flag('level')} missing={miss('level')} hint="Seniority band — used for filters and aging"><Select value={f.level} onChange={(e) => set('level', e.target.value)} options={levelOptions} placeholder="Select…" /></Field>
            <Field label="Number of positions" required error={errors.positions} flag={flag('positions')}><TextInput inputMode="numeric" value={f.positions} onChange={(e) => set('positions', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Work location" flag={flag('location')} missing={miss('location')}><TextInput value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={120} placeholder="City / cities" /></Field>
            <Field label="Work mode" missing={miss('work_mode')}><Select value={f.work_mode} onChange={(e) => set('work_mode', e.target.value as never)} options={WORK_MODES} placeholder="Select…" /></Field>
            <Field label="Reporting to" flag={flag('reporting_to')} missing={miss('reporting_to')}><TextInput value={f.reporting_to} onChange={(e) => set('reporting_to', e.target.value)} maxLength={120} /></Field>
            <Field label="Span of control" missing={miss('span')} hint="Team size / reportees"><TextInput value={f.span} onChange={(e) => set('span', e.target.value)} maxLength={80} /></Field>
            <Field label="Budget" flag={flag('budget')} missing={miss('budget')}><TextInput value={f.budget} onChange={(e) => set('budget', e.target.value)} maxLength={80} placeholder="e.g. 80 lakhs" /></Field>
            <Field label="Urgency" flag={flag('urgency')}><Select value={f.urgency} onChange={(e) => set('urgency', e.target.value as Urgency)} options={URGENCIES} /></Field>
            <Field label="Mandate received date"><TextInput type="date" value={f.received_on} onChange={(e) => set('received_on', e.target.value)} /></Field>
            <Field label="Work start date" hint="Starts the 30-day activity clock" flag={flag('started_on')} missing={miss('started_on')}><TextInput type="date" value={f.started_on} onChange={(e) => set('started_on', e.target.value)} /></Field>
            <Field label="Target close date" error={errors.target_close} flag={flag('target_close')} missing={miss('target_close')}><TextInput type="date" value={f.target_close} onChange={(e) => set('target_close', e.target.value)} /></Field>
            <Field label="Hiring manager (name)"><TextInput value={f.stakeholder} onChange={(e) => set('stakeholder', e.target.value)} maxLength={120} /></Field>
            <div className="full stack-s">
              <label className="check"><input type="checkbox" checked={f.hasConsultant} onChange={(e) => set('hasConsultant', e.target.checked)} /><span>Assigned to an external consultant / agency</span></label>
              {f.hasConsultant && (
                <Field label="External consultant name" error={errors.consultants} hint="Press Enter after each name. Saved and linked to this mandate." flag={flag('consultants')}>
                  <div className="row wrap gap-s">{f.consultants.map((c) => <span key={c} className="chip purple">{c}<button type="button" onClick={() => set('consultants', f.consultants.filter((x) => x !== c))} aria-label={`Remove ${c}`}>✕</button></span>)}</div>
                  <div className="row"><TextInput list="ags" value={consultantInput} onChange={(e) => setConsultantInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addConsultant(); } }} placeholder="Consultant or agency name" /><datalist id="ags">{agencyNames.map((n) => <option key={n} value={n} />)}</datalist><button type="button" className="btn" onClick={addConsultant}>Add</button></div>
                </Field>
              )}
            </div>
            <label className="check full"><input type="checkbox" checked={f.confidential} onChange={(e) => set('confidential', e.target.checked)} /><span><b>{f.confidential ? 'Confidential mandate' : 'Open for advertisement'}</b> <span className="muted small">— tick for confidential; untick means it may be advertised</span></span></label>
            <Field label="Job description (PDF or Word, max 10 MB)" error={errors.file} full hint={editing && mandate!.jd_file_name ? `Current: ${mandate!.jd_file_name} — choosing a file replaces it (the old version is kept in history).` : undefined}>
              <TextInput type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); setDirty(true); setErrors({ ...errors, file: x ? validateDocument(x) ?? '' : '' }); }} />
            </Field>
            <Field label="Waiting on someone?" hint="e.g. HM feedback, client approval — feeds the “Waiting” filter"><TextInput value={f.waiting_on} onChange={(e) => set('waiting_on', e.target.value)} maxLength={120} /></Field>
            <Field label="Notes" full><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} /></Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
