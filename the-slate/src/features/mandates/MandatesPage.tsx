import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Icon, Loading, Empty, Select, TextInput, Seg } from '../../ui/kit';
import { Kpi } from '../../ui/charts';
import { useDebounced } from '../../ui/kit';
import { useMandates, useSettings, useToday } from '../../data/hooks';
import { mandateKpis, withClocks } from '../../domain/analytics';
import { applyMandateFilters, DEFAULT_FILTERS, distinct, type MandateFilters, type MandateSort, type MandateView } from '../../domain/mandateFilters';
import { URGENCIES } from '../../domain/types';
import { BandLegend, MandateCard } from './MandateCard';
import { MandateForm } from './MandateForm';

const VIEWS: { v: MandateView; label: string }[] = [{ v: 'open', label: 'All open' }, { v: 'idle', label: 'Idle' }, { v: 'waiting', label: 'Waiting on someone' }, { v: 'overdue', label: 'Overdue' }, { v: 'near_close', label: 'Nearing close' }, { v: 'closed', label: 'Closed' }, { v: 'all', label: 'Everything' }];
const SORTS: { value: MandateSort; label: string }[] = [{ value: 'priority', label: 'Priority' }, { value: 'idle', label: 'Most idle' }, { value: 'target', label: 'Target close' }, { value: 'days_open', label: 'Days open' }, { value: 'candidates', label: 'Candidates' }, { value: 'newest', label: 'Newest' }];

export default function MandatesPage() {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams();
  const { settings } = useSettings(); const today = useToday(); const q = useMandates();
  const [creating, setCreating] = useState<null | 'quick' | 'form'>(null);
  const f: MandateFilters = { ...DEFAULT_FILTERS, q: sp.get('q') ?? '', view: (sp.get('view') as MandateView) ?? 'open', urgency: sp.get('urgency') ?? '', company: sp.get('company') ?? '', location: sp.get('location') ?? '',
    level: sp.get('level') ?? '', consultant: sp.get('consultant') ?? '', status: sp.get('status') ?? '', sort: (sp.get('sort') as MandateSort) ?? 'priority' };
  const set = (patch: Partial<MandateFilters>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v && v !== (DEFAULT_FILTERS as never as Record<string, string>)[k]) n.set(k, String(v)); else n.delete(k); } setSp(n, { replace: true }); };
  const [text, setText] = useState(f.q); const dq = useDebounced(text, 200);
  if (dq !== f.q && dq === text) set({ q: dq });

  const rows = useMemo(() => withClocks(q.data ?? [], { today, tz: settings.timezone, inactivityDays: settings.inactivityDays, nearCloseDays: settings.nearCloseDays }), [q.data, today, settings]);
  const k = useMemo(() => mandateKpis(rows), [rows]);
  const list = useMemo(() => applyMandateFilters(rows, f, settings.inactivityDays), [rows, f.q, f.view, f.urgency, f.company, f.location, f.level, f.consultant, f.status, f.sort, settings.inactivityDays]); // eslint-disable-line react-hooks/exhaustive-deps
  const facets = useMemo(() => ({ company: distinct(rows.map((r) => r.m.company_name)), location: distinct(rows.map((r) => r.m.location)), level: distinct(rows.map((r) => r.m.level)), consultant: distinct(rows.flatMap((r) => r.m.consultants)) }), [rows]);
  const active = f.urgency || f.company || f.location || f.level || f.consultant || f.status || f.q;

  return (
    <div className="stack">
      <div className="row wrap"><h1>Mandates</h1><span className="muted">{q.data ? `${list.length} shown of ${k.total}` : ''}</span>
        <div className="right row"><button className="btn" onClick={() => setCreating('quick')}><Icon n="spark" size={15} /> Describe a mandate</button><button className="btn primary" onClick={() => setCreating('form')}><Icon n="plus" size={15} /> New mandate</button></div></div>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && <>
        <div className="kpis" aria-label="Mandate summary">
          <Kpi n={k.total} label="Total" onClick={() => set({ view: 'all' })} />
          <Kpi n={k.active} label="Active" tone="green" onClick={() => set({ view: 'active' })} />
          <Kpi n={k.critical} label="Critical" tone="red" onClick={() => set({ view: 'critical' })} />
          <Kpi n={k.inactive} label="Inactive" tone="amber" onClick={() => set({ view: 'inactive' })} sub={`no activity ${settings.inactivityDays}+ days`} />
          <Kpi n={k.onHold} label="On hold" tone="info" onClick={() => set({ view: 'on_hold' })} />
          <Kpi n={k.overdue} label="Overdue" tone="red" onClick={() => set({ view: 'overdue' })} />
          <Kpi n={k.closed} label="Closed" tone="grey" onClick={() => set({ view: 'closed' })} />
          <Kpi n={k.nearClose} label="Nearing close" tone="amber" onClick={() => set({ view: 'near_close' })} sub={`within ${settings.nearCloseDays} days`} />
        </div>
        <div className="card pad stack">
          <div className="row wrap">
            <div className="grow" style={{ minWidth: 220 }}><TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title, company, location, consultant…" aria-label="Search mandates" /></div>
            <Seg value={f.view} onChange={(v) => set({ view: v })} options={VIEWS.map((x) => ({ value: x.v, label: x.label }))} />
          </div>
          <div className="filters">
            <Select aria-label="Priority" value={f.urgency} onChange={(e) => set({ urgency: e.target.value })} options={URGENCIES} placeholder="Priority: any" />
            <Select aria-label="Company" value={f.company} onChange={(e) => set({ company: e.target.value })} options={facets.company} placeholder="Company: any" />
            <Select aria-label="Location" value={f.location} onChange={(e) => set({ location: e.target.value })} options={facets.location} placeholder="Location: any" />
            <Select aria-label="Hiring level" value={f.level} onChange={(e) => set({ level: e.target.value })} options={facets.level} placeholder="Level: any" />
            <Select aria-label="Consultant" value={f.consultant} onChange={(e) => set({ consultant: e.target.value })} options={facets.consultant} placeholder="Consultant: any" />
            <Select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'closed', label: 'Closed (filled)' }, { value: 'cancelled', label: 'Cancelled' }]} placeholder="Status: any" />
            <Select aria-label="Sort" value={f.sort} onChange={(e) => set({ sort: e.target.value as MandateSort })} options={SORTS} />
            {(active || f.view !== 'open') && <button className="btn sm" onClick={() => { setText(''); setSp(new URLSearchParams(), { replace: true }); }}>Clear filters</button>}
          </div>
          <BandLegend />
        </div>
        {list.length === 0
          ? <Empty title={k.total === 0 ? 'No mandates yet' : 'No mandates match these filters'}>{k.total === 0 ? 'Create your first mandate — or just describe it in a sentence.' : 'Try clearing a filter.'}</Empty>
          : <div className="grid auto">{list.map(({ m, clock }) => <MandateCard key={m.id} m={m} clock={clock} today={today} onOpen={() => nav(`/mandates/${m.id}`)} />)}</div>}
      </>}
      {creating && <MandateForm startInQuick={creating === 'quick'} onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); nav(`/mandates/${id}`); }} />}
    </div>
  );
}
