import { useNavigate } from 'react-router-dom';
import type { Candidate } from '../../domain/types';
import { initials, maskEmail, maskMoney, maskPhone } from '../../lib/format';
import { Chip } from '../../ui/kit';

const tone = (s: string) => (s === 'joined' ? 'gold' : s === 'offered' || s === 'selected' ? 'green' : s === 'rejected' || s === 'dropped' ? 'red' : s === 'on_hold' ? 'info' : undefined);
export function CandidateCard({ c, mask, stageLabel }: { c: Candidate; mask: boolean; stageLabel: (k: string) => string }) {
  const nav = useNavigate(); const a = c.assocs ?? [];
  const money = (v: string | null) => (v ? (mask ? maskMoney(v) : v) : '—');
  return (
    <button className="ccard" onClick={() => nav(`/talent/${c.id}`)} aria-label={`Open ${c.name}`}>
      <div className="row"><div className="avatar">{initials(c.name)}</div><div className="grow"><div className="bold trunc" style={{ fontSize: 15 }}>{c.name}</div><div className="small dim trunc">{[c.designation, c.current_company].filter(Boolean).join(' · ') || 'Role not recorded'}</div></div></div>
      <div className="small dim row wrap gap-s"><span>📍 {c.current_location ?? '—'}</span>{c.source && <><span>·</span><span>{c.source}</span></>}{c.notice_period && <><span>·</span><span>⏳ {c.notice_period}</span></>}</div>
      <div className="small row wrap gap-l"><span><span className="muted">Current </span><b>{money(c.current_ctc)}</b></span><span><span className="muted">Expected </span><b className="gold">{money(c.expected_ctc)}</b></span></div>
      {(c.phone || c.email) && <div className="tiny muted trunc">{[c.phone && (mask ? maskPhone(c.phone) : c.phone), c.email && (mask ? maskEmail(c.email) : c.email)].filter(Boolean).join(' · ')}</div>}
      <div className="row wrap gap-s">{a.length === 0 && <Chip>Talent pool only</Chip>}
        {a.slice(0, 2).map((x) => <Chip key={x.association_id} tone={tone(x.status)} title={`${x.mandate_title} — ${x.mandate_company ?? ''}`}><span className="trunc" style={{ maxWidth: 150 }}>{x.mandate_title}</span> · {stageLabel(x.stage)}</Chip>)}{a.length > 2 && <Chip>+{a.length - 2} more</Chip>}</div>
    </button>
  );
}
