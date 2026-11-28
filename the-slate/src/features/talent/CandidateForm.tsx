import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../data/api';
import { parseCandidate } from '../../data/nlClient';
import { ALL_RECRUITMENT_KEYS, useAction, useConfig, useDraft, useMandates, useToday } from '../../data/hooks';
import type { Candidate, MandateRow } from '../../domain/types';
import type { CandidateInput } from '../../domain/nl/candidateParser';
import type { ParseResult } from '../../domain/nl/common';
import { Field, Icon, Select, Tabs, TextArea, TextInput } from '../../ui/kit';
import { Modal } from '../../ui/Modal';
import { ParseBanner } from '../mandates/ParseBanner';

type Form = Omit<CandidateInput, 'open_to_relocate'> & { id?: string; relocate: '' | 'yes' | 'no' };
const blank = (mandate = ''): Form => ({ name: '', current_company: '', designation: '', phone: '', email: '', source: '', current_ctc: '', expected_ctc: '', additional_benefits: '', notice_period: '', current_location: '', relocate: '', mandate_id: mandate, notes: '' });
const fromCand = (c: Candidate): Form => ({ id: c.id, name: c.name, current_company: c.current_company ?? '', designation: c.designation ?? '', phone: c.phone ?? '', email: c.email ?? '', source: c.source ?? '', current_ctc: c.current_ctc ?? '',
  expected_ctc: c.expected_ctc ?? '', additional_benefits: c.additional_benefits ?? '', notice_period: c.notice_period ?? '', current_location: c.current_location ?? '', relocate: c.open_to_relocate === null ? '' : c.open_to_relocate ? 'yes' : 'no', mandate_id: '', notes: c.notes ?? '' });

export function validateCandidate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Enter the candidate\'s name.';
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'That email address looks wrong.';
  if (f.phone && !/^\+?[\d\s()-]{7,18}$/.test(f.phone.trim())) e.phone = 'Use digits only (7–15), with an optional country code.';
  return e;
}

/** Searchable single-select of existing mandates. New mandates are created only from the Mandates workflow. */
export function MandatePicker({ value, onChange, mandates, error }: { value: string; onChange: (id: string) => void; mandates: MandateRow[]; error?: string }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [closed, setClosed] = useState(false);
  const sel = mandates.find((m) => m.id === value);
  const list = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    return mandates.filter((m) => (closed || m.status === 'active' || m.status === 'on_hold') && t.every((w) => `${m.title} ${m.company_name ?? ''} ${m.location ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  }, [mandates, q, closed]);
  return (
    <div style={{ position: 'relative' }}>
      <div className="row"><div className="grow"><TextInput value={open ? q : sel ? `${sel.title} — ${sel.company_name ?? ''}` : ''} onFocus={() => { setOpen(true); setQ(''); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="Search or choose a mandate…" role="combobox" aria-expanded={open} aria-invalid={!!error} /></div>{value && <button type="button" className="btn sm" onClick={() => { onChange(''); setQ(''); }}>Clear</button>}</div>
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 40, maxHeight: 260, overflow: 'auto', boxShadow: 'var(--shadow)' }} role="listbox">
          {list.length === 0 && <div className="muted small" style={{ padding: 12 }}>No matching mandate. Create it first from <Link to="/mandates">Mandates</Link>.</div>}
          {list.map((m) => <button type="button" key={m.id} role="option" aria-selected={m.id === value} style={{ all: 'unset', display: 'block', boxSizing: 'border-box', width: '100%', padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
            onMouseDown={(e) => { e.preventDefault(); onChange(m.id); setOpen(false); }}><b>{m.title}</b> <span className="gold">{m.company_name}</span><div className="tiny muted">{[m.location, m.status !== 'active' ? m.status.replace('_', ' ') : null, `${m.candidate_total} candidates`].filter(Boolean).join(' · ')}</div></button>)}
          <div className="row between" style={{ padding: '8px 12px' }}><label className="check small"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />Include closed</label><button type="button" className="btn xs" onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}>Done</button></div>
        </div>)}
    </div>
  );
}

export function CandidateForm({ candidate, presetMandateId, startInQuick, onClose, onSaved }: { candidate?: Candidate; presetMandateId?: string; startInQuick?: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = !!candidate; const today = useToday(); const cfg = useConfig(); const mandates = useMandates();
  const [draft, setDraft, clearDraft] = useDraft<Form>(editing ? `cand-${candidate!.id}` : 'cand-new', editing ? fromCand(candidate!) : blank(presetMandateId));
  const [f, setF] = useState<Form>(editing || !presetMandateId ? draft : { ...draft, mandate_id: presetMandateId });
  const [tab, setTab] = useState<'quick' | 'form'>(startInQuick && !editing ? 'quick' : 'form');
  const [text, setText] = useState(''); const [parse, setParse] = useState<ParseResult<CandidateInput> | null>(null); const [parsing, setParsing] = useState(false);
  const [dirty, setDirty] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [dup, setDup] = useState<{ id: string; name: string } | null>(null); const [dupOk, setDupOk] = useState(false);
  const { run, busy } = useAction();
  const sources = cfg.labels('source');
  const srcOptions = f.source && !sources.includes(f.source) ? [f.source, ...sources] : sources;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { const n = { ...f, [k]: v }; setF(n); setDraft(n); setDirty(true); setDup(null); setDupOk(false); if (errors[k as string]) setErrors({ ...errors, [k as string]: '' }); };
  const flag = (k: string) => (parse && parse.ambiguous[k]) || (parse && parse.inferred.includes(k) ? 'Inferred — please confirm' : undefined);
  const miss = (k: string) => !!parse && parse.missing.includes(k) && !(f as unknown as Record<string, unknown>)[k];
  const openMandates = (mandates.data ?? []);

  async function understand() {
    if (!text.trim()) return; setParsing(true);
    const r = await parseCandidate(text, { today, sources, mandates: openMandates.filter((m) => m.status !== 'cancelled').map((m) => ({ id: m.id, title: m.title, company: m.company_name })) });
    setParsing(false); setParse(r);
    const n: Form = { ...f };
    for (const [k, v] of Object.entries(r.fields)) { if (v === undefined || v === null) continue; if (k === 'open_to_relocate') n.relocate = v ? 'yes' : 'no'; else (n as unknown as Record<string, unknown>)[k] = v; }
    setF(n); setDraft(n); setDirty(true); setTab('form'); setErrors({});
  }
  async function save() {
    const err = validateCandidate(f); setErrors(err); if (Object.keys(err).length) { setTab('form'); return; }
    if (!editing && !dupOk && (f.email.trim() || f.phone.trim())) {
      const probe = f.email.trim() || f.phone.trim().replace(/\D/g, '').slice(-10);
      const r = await api.searchCandidates({ q: probe, limit: 5 }).catch(() => null);
      const hit = r?.rows.find((c) => (f.email.trim() && c.email?.toLowerCase() === f.email.trim().toLowerCase()) || (f.phone.trim() && c.phone && c.phone.replace(/\D/g, '').slice(-10) === f.phone.replace(/\D/g, '').slice(-10)));
      if (hit) { setDup({ id: hit.id, name: hit.name }); return; }
    }
    const id = await run(() => api.saveCandidate({ id: f.id, name: f.name, current_company: f.current_company, designation: f.designation, phone: f.phone, email: f.email, source: f.source, current_ctc: f.current_ctc,
      expected_ctc: f.expected_ctc, additional_benefits: f.additional_benefits, notice_period: f.notice_period, current_location: f.current_location, open_to_relocate: f.relocate === '' ? null : f.relocate === 'yes', mandate_id: f.mandate_id || undefined, notes: f.notes } as never),
      { success: editing ? 'Candidate updated' : 'Candidate added', invalidate: ALL_RECRUITMENT_KEYS });
    if (id) { clearDraft(); setDirty(false); onSaved(id); }
  }
  return (
    <Modal drawer dirty={dirty} onClose={onClose} title={editing ? `Edit — ${candidate!.name}` : 'New candidate'}
      footer={<><button className="btn" onClick={onClose} type="button">Cancel</button><button className="btn primary" onClick={save} disabled={busy} type="button">{busy ? <span className="spinner" /> : editing ? 'Save changes' : dup ? 'Save anyway' : 'Confirm & add candidate'}</button></>}>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'quick', label: <><Icon n="spark" size={15} /> Describe it</> }, { value: 'form', label: 'Candidate form' }]} />
      {tab === 'quick' && (
        <div className="stack">
          <div className="dim small">Type or paste what you know. I'll fill the form for you to review — nothing is saved until you confirm.</div>
          <TextArea autoFocus rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Rahul Sharma, currently VP Operations at ABC Ltd, Mumbai, current CTC 65 lakhs, expecting 80 lakhs, notice period 90 days, sourced through LinkedIn."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) understand(); }} />
          <div className="row"><button className="btn primary" onClick={understand} disabled={parsing || !text.trim()} type="button">{parsing ? <><span className="spinner" /> Reading…</> : <><Icon n="spark" size={15} /> Fill the form</>}</button><span className="tiny muted"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span></span></div>
        </div>)}
      {tab === 'form' && (
        <div className="stack">
          {parse && <ParseBanner r={parse as never} onDismiss={() => setParse(null)} />}
          {dup && <div className="banner warn" role="alert"><div><b>Possible duplicate:</b> <Link to={`/talent/${dup.id}`} target="_blank">{dup.name}</Link> already has the same {f.email ? 'email' : 'phone number'}. Open it, or press “Save anyway”.</div><button className="btn sm" onClick={() => setDupOk(true)} type="button">{dupOk ? 'OK ✓' : 'It is a different person'}</button></div>}
          <div className="form-grid">
            <Field label={editing ? 'Also associate with another mandate' : 'Associated mandate'} full error={errors.mandate_id} flag={flag('mandate_id')} missing={miss('mandate_id')} hint="Search the existing mandates. To create a new mandate use Mandates → New mandate.">
              <MandatePicker value={f.mandate_id} onChange={(id) => set('mandate_id', id)} mandates={openMandates} /></Field>
            <Field label="Candidate name" required error={errors.name} flag={flag('name')} full><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
            <Field label="Current company" flag={flag('current_company')} missing={miss('current_company')}><TextInput value={f.current_company} onChange={(e) => set('current_company', e.target.value)} maxLength={120} /></Field>
            <Field label="Current designation" flag={flag('designation')} missing={miss('designation')}><TextInput value={f.designation} onChange={(e) => set('designation', e.target.value)} maxLength={120} /></Field>
            <Field label="Phone number" error={errors.phone} missing={miss('phone')}><TextInput type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={24} /></Field>
            <Field label="Email ID" error={errors.email} missing={miss('email')}><TextInput type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={160} /></Field>
            <Field label="Source" flag={flag('source')} missing={miss('source')}><Select value={f.source} onChange={(e) => set('source', e.target.value)} options={srcOptions} placeholder="Select…" /></Field>
            <Field label="Current location" flag={flag('current_location')} missing={miss('current_location')}><TextInput value={f.current_location} onChange={(e) => set('current_location', e.target.value)} maxLength={120} /></Field>
            <Field label="Current CTC" missing={miss('current_ctc')}><TextInput value={f.current_ctc} onChange={(e) => set('current_ctc', e.target.value)} maxLength={80} placeholder="e.g. 65 lakhs" /></Field>
            <Field label="Expected CTC" missing={miss('expected_ctc')}><TextInput value={f.expected_ctc} onChange={(e) => set('expected_ctc', e.target.value)} maxLength={80} placeholder="e.g. 80 lakhs" /></Field>
            <Field label="Additional benefits"><TextInput value={f.additional_benefits} onChange={(e) => set('additional_benefits', e.target.value)} maxLength={200} placeholder="Car, ESOPs, …" /></Field>
            <Field label="Notice period" missing={miss('notice_period')}><TextInput value={f.notice_period} onChange={(e) => set('notice_period', e.target.value)} maxLength={60} placeholder="e.g. 90 days" /></Field>
            <Field label="Open to relocate?"><div className="opt-row">{([['yes', 'Yes'], ['no', 'No'], ['', 'Not known']] as const).map(([v, l]) => <button key={l} type="button" className={`opt ${f.relocate === v ? 'on' : ''}`} onClick={() => set('relocate', v)}>{l}</button>)}</div></Field>
            <Field label="Notes" full><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={4000} /></Field>
          </div>
        </div>)}
    </Modal>
  );
}
