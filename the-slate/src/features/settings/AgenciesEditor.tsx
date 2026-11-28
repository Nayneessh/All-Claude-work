import { useState } from 'react';
import { api } from '../../data/api';
import { K, useAction, useAgencies, useCompanies, useMandates } from '../../data/hooks';
import type { Agency } from '../../domain/types';
import { Chip, Field, Select, TextInput, Empty } from '../../ui/kit';
import { Modal } from '../../ui/Modal';

export function AgenciesEditor() {
  const ag = useAgencies(); const { run, busy } = useAction(); const [edit, setEdit] = useState<Partial<Agency> | null>(null);
  return (
    <div className="stack">
      <div className="row"><div className="small dim grow">External agencies and consultants you share mandates with. Assign them from a mandate (or the “External consultant” box when creating one).</div><button className="btn primary" onClick={() => setEdit({ kind: 'agency', active: true })}>Add</button></div>
      {(ag.data ?? []).length === 0 ? <Empty title="None yet" /> : <div className="scroll-x"><table className="t"><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Email / phone</th><th>Status</th><th /></tr></thead>
        <tbody>{ag.data!.map((a) => <tr key={a.id}><td><b>{a.name}</b></td><td><Chip tone="purple">{a.kind}</Chip></td><td className="small">{a.contact_name ?? '—'}</td><td className="small dim">{[a.email, a.phone].filter(Boolean).join(' · ') || '—'}</td><td>{a.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</td><td className="num"><button className="btn xs" onClick={() => setEdit(a)}>Edit</button></td></tr>)}</tbody></table></div>}
      {edit && <Modal title={edit.id ? 'Edit agency / consultant' : 'Add agency / consultant'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy || !edit.name?.trim()} onClick={async () => { await run(() => api.saveAgency({ ...edit, name: edit.name! }), { success: 'Saved', invalidate: [K.agencies, K.mandateAgencies, K.mandates] }); setEdit(null); }}>Save</button></>}>
        <div className="form-grid">
          <Field label="Name" required full><TextInput value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} autoFocus /></Field>
          <Field label="Type"><Select value={edit.kind ?? 'agency'} onChange={(e) => setEdit({ ...edit, kind: e.target.value as never })} options={[{ value: 'agency', label: 'Agency / firm' }, { value: 'consultant', label: 'Individual consultant' }]} /></Field>
          <Field label="Contact person"><TextInput value={edit.contact_name ?? ''} onChange={(e) => setEdit({ ...edit, contact_name: e.target.value })} maxLength={120} /></Field>
          <Field label="Email"><TextInput type="email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} maxLength={160} /></Field>
          <Field label="Phone"><TextInput value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} maxLength={30} /></Field>
          {edit.id && <label className="check full"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active</label>}
        </div></Modal>}
    </div>
  );
}

export function CompaniesEditor() {
  const co = useCompanies(); const m = useMandates(); const { run } = useAction();
  const n = (id: string) => (m.data ?? []).filter((x) => x.company_id === id).length;
  return (
    <div className="stack"><div className="small dim">Companies are created automatically when you type a new one on a mandate. Rename to fix spelling — every mandate updates.</div>
      {(co.data ?? []).length === 0 ? <Empty title="No companies yet" /> : (co.data ?? []).map((c) => <div key={c.id} className="row"><div className="grow"><TextInput defaultValue={c.name} maxLength={120} aria-label="Company name" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run(() => api.renameCompany(c.id, v), { success: 'Renamed', invalidate: [K.companies, K.mandates, K.pipeline] }); else e.target.value = c.name; }} /></div><span className="small muted" style={{ width: 90 }}>{n(c.id)} mandate{n(c.id) === 1 ? '' : 's'}</span></div>)}</div>
  );
}
