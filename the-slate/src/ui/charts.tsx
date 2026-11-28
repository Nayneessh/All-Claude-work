import type { ReactNode } from 'react';
import type { FunnelStep } from '../domain/analytics';

export function FunnelChart({ steps, onPick }: { steps: FunnelStep[]; onPick?: (key: string) => void }) {
  const max = Math.max(1, ...steps.map((s) => s.reached));
  if (!steps.length) return null;
  return (
    <div className="funnel" role="list">
      {steps.map((s) => (
        <div className="f-row" key={s.stage_key} role="listitem" onClick={() => onPick?.(s.stage_key)} title={`${s.reached} candidate(s) reached "${s.label}"; ${s.current_count} are there now`}>
          <span className="trunc">{s.label}</span>
          <div className="f-bar"><i style={{ width: `${(s.reached / max) * 100}%` }} /></div>
          <span className="small"><b>{s.reached}</b> <span className="muted">{s.pctOfPrev !== null ? `${s.pctOfPrev}%` : ''}</span></span>
        </div>
      ))}
    </div>
  );
}
export function BarList({ rows, tone, onPick, max, suffix }: { rows: { label: string; n: number; extra?: ReactNode }[]; tone?: 'g' | 'r' | 'p'; onPick?: (label: string) => void; max?: number; suffix?: string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <div className="muted small">Nothing recorded yet.</div>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className={`b-row ${onPick ? 'click' : ''}`} onClick={() => onPick?.(r.label)}>
          <span className="b-name trunc" title={r.label}>{r.label}</span>
          <div className="b-track"><i className={tone} style={{ width: `${(r.n / m) * 100}%` }} /></div>
          <span className="small right-num"><b>{r.n}{suffix}</b>{r.extra}</span>
        </div>
      ))}
    </div>
  );
}
export function ActivityBars({ data, height = 70 }: { data: { day: string; n: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  if (!data.length) return <div className="muted small">No recorded activity in this period.</div>;
  return <div className="spark" style={{ height }} role="img" aria-label="Activity per day">{data.map((d) => <i key={d.day} style={{ height: `${Math.max(4, (d.n / max) * 100)}%` }} title={`${d.day}: ${d.n}`} />)}</div>;
}
export const Kpi = ({ n, label, tone, onClick, sub }: { n: ReactNode; label: string; tone?: 'green' | 'red' | 'amber' | 'grey' | 'info'; onClick?: () => void; sub?: ReactNode }) => {
  const cls = `kpi ${tone ? 'k-' + tone : ''}`;
  const inner = <><div className="n">{n}</div><div className="l">{label}</div>{sub && <div className="tiny muted">{sub}</div>}</>;
  return onClick ? <button className={cls} onClick={onClick}>{inner}</button> : <div className={cls}>{inner}</div>;
};
