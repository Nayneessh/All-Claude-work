import { useNavigate } from 'react-router-dom';
import type { Joiner } from '../../domain/analytics';
import { fmtDateShort } from '../../lib/time';
import { Chip, Empty } from '../../ui/kit';

const LVL = { overdue: { tone: 'red', label: 'Date passed' }, today: { tone: 'red', label: 'Joins today' }, soon: { tone: 'amber', label: 'This week' }, upcoming: { tone: 'green', label: 'Upcoming' } } as const;
/** Candidates expected to join in the next 30 days, with an alert chip that escalates as the date approaches. */
export function JoinersTable({ rows, stageLabel }: { rows: Joiner[]; stageLabel: (k: string) => string }) {
  const nav = useNavigate();
  if (!rows.length) return <Empty title="No joinings expected in the next 30 days">Set a joining date on an offered or selected candidate and it appears here.</Empty>;
  return (
    <div className="scroll-x"><table className="t"><thead><tr><th>Candidate</th><th>Company</th><th>Designation</th><th>Mandate</th><th>Joining</th><th>Status</th><th>Alert</th></tr></thead>
      <tbody>{rows.map(({ row: r, daysUntil, level }) => (
        <tr key={r.association_id} className="click" onClick={() => nav(`/talent/${r.candidate_id}`)}>
          <td><b>{r.name}</b></td><td className="small">{r.mandate_company ?? '—'}</td><td className="small dim">{r.designation ?? '—'}</td><td className="small">{r.mandate_title}</td>
          <td><b>{fmtDateShort(r.joining_date)}</b> <span className="tiny muted">{daysUntil === 0 ? 'today' : daysUntil > 0 ? `in ${daysUntil}d` : `${-daysUntil}d ago`}</span></td>
          <td className="small">{stageLabel(r.stage)}{r.joining_status ? <span className="muted"> · {r.joining_status.replace('_', ' ')}</span> : ''}</td><td><Chip tone={LVL[level].tone}>{LVL[level].label}</Chip></td></tr>))}</tbody></table></div>
  );
}
