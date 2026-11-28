import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../data/api';
import { K, useConfig, useMandates, useSettings } from '../../data/hooks';
import { distinct } from '../../domain/mandateFilters';
import { Empty, ErrorBox, Icon, Loading, Select, TextInput, useDebounced } from '../../ui/kit';
import { CandidateCard } from './CandidateCard';
import { CandidateForm } from './CandidateForm';

const PAGE = 24;
export default function TalentPage() {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const cfg = useConfig(); const mandates = useMandates(); const { settings } = useSettings();
  const [text, setText] = useState(sp.get('q') ?? ''); const dq = useDebounced(text, 250);
  const [limit, setLimit] = useState(PAGE); const [creating, setCreating] = useState<null | 'quick' | 'form'>(null);
  const f = { q: dq, mandate: sp.get('mandate') ?? '', status: sp.get('status') ?? '', stage: sp.get('stage') ?? '', source: sp.get('source') ?? '', location: sp.get('location') ?? '' };
  const setF = (patch: Partial<typeof f>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); setLimit(PAGE); };
  useEffect(() => { setF({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  const q = useQuery({ queryKey: [...K.candidates, f, limit], queryFn: () => api.searchCandidates({ ...f, limit }), placeholderData: keepPreviousData });
  const stageLabel = (k: string) => cfg.allStages.find((s) => s.key === k)?.label ?? k;
  const locations = distinct((q.data?.rows ?? []).map((c) => c.current_location));
  const activeFilters = f.mandate || f.status || f.stage || f.source || f.location;

  return (
    <div className="stack">
      <div className="row wrap"><h1>Talent Pool</h1><span className="muted">{q.data ? `${q.data.total} candidate${q.data.total === 1 ? '' : 's'}` : ''}</span>
        <div className="right row"><button className="btn" onClick={() => setCreating('quick')}><Icon n="spark" size={15} /> Describe a candidate</button><button className="btn primary" onClick={() => setCreating('form')}><Icon n="plus" size={15} /> New candidate</button></div></div>
      <div className="search-hero"><div className="grow"><TextInput autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name, company, designation, mandate, location…" aria-label="Search candidates" /></div>
        {(text || activeFilters) && <button className="btn" onClick={() => { setText(''); setSp(new URLSearchParams(), { replace: true }); }}>Clear</button>}</div>
      <div className="filters">
        <Select aria-label="Mandate" value={f.mandate} onChange={(e) => setF({ mandate: e.target.value })} options={(mandates.data ?? []).map((m) => ({ value: m.id, label: `${m.title} — ${m.company_name ?? ''}` }))} placeholder="Mandate: any" />
        <Select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value })} options={[{ value: 'active', label: 'In process' }, { value: 'selected', label: 'Selected' }, { value: 'offered', label: 'Offered' }, { value: 'joined', label: 'Joined' }, { value: 'rejected', label: 'Rejected' }, { value: 'dropped', label: 'Dropped' }, { value: 'on_hold', label: 'On hold' }]} placeholder="Status: any" />
        <Select aria-label="Stage" value={f.stage} onChange={(e) => setF({ stage: e.target.value })} options={cfg.allStages.map((s) => ({ value: s.key, label: s.label }))} placeholder="Stage: any" />
        <Select aria-label="Source" value={f.source} onChange={(e) => setF({ source: e.target.value })} options={cfg.labels('source')} placeholder="Source: any" />
        <Select aria-label="Location" value={f.location} onChange={(e) => setF({ location: e.target.value })} options={locations.length ? locations : f.location ? [f.location] : []} placeholder="Location: any" />
      </div>
      {q.isLoading && <Loading />}{q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.data && (q.data.rows.length === 0
        ? <Empty title={text || activeFilters ? 'No candidates match' : 'No candidates yet'}>{text || activeFilters ? 'Try fewer words or clear a filter.' : 'Add your first candidate — or describe them in a sentence.'}</Empty>
        : <><div className="grid auto" style={{ opacity: q.isPlaceholderData ? .6 : 1 }}>{q.data.rows.map((c) => <CandidateCard key={c.id} c={c} mask={settings.maskSensitive} stageLabel={stageLabel} />)}</div>
          {q.data.rows.length < q.data.total && <div className="center"><button className="btn" onClick={() => setLimit(limit + PAGE)}>Show more ({q.data.total - q.data.rows.length} remaining)</button></div>}</>)}
      {creating && <CandidateForm startInQuick={creating === 'quick'} onClose={() => setCreating(null)} onSaved={(id) => { setCreating(null); nav(`/talent/${id}`); }} />}
    </div>
  );
}
