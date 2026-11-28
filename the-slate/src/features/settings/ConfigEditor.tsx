import { useState } from 'react';
import { api } from '../../data/api';
import { K, useAction, useConfig } from '../../data/hooks';
import type { ConfigKind, ConfigOption, StageKind } from '../../domain/types';
import { slug } from '../../lib/format';
import { Chip, Loading, Select, TextInput } from '../../ui/kit';

const STAGE_KINDS: { value: StageKind; label: string }[] = [{ value: 'progress', label: 'In progress' }, { value: 'hold', label: 'On hold' }, { value: 'selected', label: 'Selected' }, { value: 'offered', label: 'Offered' }, { value: 'joined', label: 'Joined' }, { value: 'rejected', label: 'Rejected (needs reason)' }, { value: 'dropped', label: 'Dropped (needs reason)' }];

/** Edit one configurable list. Nothing is ever hard-deleted: switching an option off hides it from new choices but keeps all history intact. */
export function ConfigEditor({ kind, noun, help }: { kind: ConfigKind; noun: string; help?: string }) {
  const cfg = useConfig(); const { run, busy } = useAction(); const [label, setLabel] = useState('');
  const rows = cfg.by(kind, false);
  if (cfg.loading) return <Loading />;
  const inv = [K.config];
  const save = (o: ConfigOption, patch: Partial<{ label: string; sort_order: number; active: boolean; meta: Record<string, unknown> }>) => run(() => api.saveConfig({ id: o.id, kind, label: patch.label ?? o.label, sort_order: patch.sort_order ?? o.sort_order, active: patch.active ?? o.active, meta: patch.meta ?? o.meta }), { invalidate: inv });
  const swap = async (i: number, d: -1 | 1) => { const a = rows[i], b = rows[i + d]; if (!a || !b) return; await run(async () => { await api.saveConfig({ id: a.id, kind, label: a.label, sort_order: b.sort_order, active: a.active, meta: a.meta }); await api.saveConfig({ id: b.id, kind, label: b.label, sort_order: a.sort_order === b.sort_order ? a.sort_order + d : a.sort_order, active: b.active, meta: b.meta }); }, { invalidate: inv }); };
  async function add() {
    const l = label.trim(); if (!l) return; let key = slug(l); const keys = new Set(cfg.all.filter((o) => o.kind === kind).map((o) => o.key)); for (let i = 2; keys.has(key); i++) key = `${slug(l)}_${i}`;
    const max = Math.max(0, ...rows.map((r) => r.sort_order));
    await run(() => api.saveConfig({ kind, label: l, key, sort_order: max + 10, meta: kind === 'pipeline_stage' ? { kind: 'progress', funnel: true } : {} }), { success: `${noun} added`, invalidate: inv }); setLabel('');
  }
  return (
    <div className="stack">
      {help && <div className="small dim">{help}</div>}
      <div className="stack-s">{rows.map((o, i) => (
        <div key={o.id} className="row wrap" style={{ opacity: o.active ? 1 : .55 }}>
          <div className="stack-s"><button className="btn xs" disabled={i === 0 || busy} onClick={() => swap(i, -1)} aria-label="Move up">▲</button><button className="btn xs" disabled={i === rows.length - 1 || busy} onClick={() => swap(i, 1)} aria-label="Move down">▼</button></div>
          <div className="grow" style={{ minWidth: 160 }}><TextInput defaultValue={o.label} maxLength={80} aria-label={`${noun} name`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== o.label) save(o, { label: v }); else e.target.value = o.label; }} /></div>
          {kind === 'pipeline_stage' && <><Select aria-label="Stage type" value={o.meta.kind ?? 'progress'} options={STAGE_KINDS} onChange={(e) => save(o, { meta: { ...o.meta, kind: e.target.value, funnel: !['hold', 'rejected', 'dropped'].includes(e.target.value) && (o.meta.funnel ?? true) } })} style={{ width: 190 }} />
            <label className="check small"><input type="checkbox" checked={!!o.meta.funnel} onChange={(e) => save(o, { meta: { ...o.meta, funnel: e.target.checked } })} />In funnel</label></>}
          <label className="check small"><input type="checkbox" checked={o.active} onChange={(e) => save(o, { active: e.target.checked })} />Active</label>
          {!o.active && <Chip>hidden</Chip>}
        </div>))}</div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}><div className="grow"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Add a ${noun.toLowerCase()}…`} maxLength={80} /></div><button className="btn primary" disabled={busy || !label.trim()} type="submit">Add</button></form>
    </div>
  );
}
