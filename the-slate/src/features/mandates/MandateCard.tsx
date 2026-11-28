import { BAND_META, computeBand, type ClockInfo, type BandKey } from '../../domain/mandateClock';
import type { MandateRow } from '../../domain/types';
import { fmtDateShort, relativeDays } from '../../lib/time';
import { Chip, Icon, Progress } from '../../ui/kit';
import { plural } from '../../lib/format';

const STATE: Record<string, { label: string; tone: 'green' | 'amber' | 'grey' | 'red' | 'info' }> = {
  active: { label: 'Active', tone: 'green' }, inactive: { label: 'Inactive', tone: 'amber' }, on_hold: { label: 'On hold', tone: 'info' }, overdue: { label: 'Overdue', tone: 'red' }, closed: { label: 'Closed', tone: 'grey' },
};
export const stateChip = (c: ClockInfo, m: MandateRow) => { const s = STATE[c.state]; return <Chip tone={s.tone}>{c.state === 'closed' && m.status === 'cancelled' ? 'Cancelled' : s.label}</Chip>; };
export const urgencyChip = (u: MandateRow['urgency']) => <Chip tone={u === 'Critical' ? 'red' : u === 'High' ? 'amber' : u === 'Medium' ? 'info' : 'grey'}>{u}</Chip>;
export const bandStyle = (k: BandKey) => ({ ['--band' as string]: `var(${BAND_META[k].colorVar})`, ['--band-fg' as string]: k === 'joined' ? 'var(--band-fg-joined)' : k === 'offered' ? 'var(--band-fg-offered)' : '#fff' });

export function MandateCard({ m, clock, today, onOpen }: { m: MandateRow; clock: ClockInfo; today: string; onOpen: () => void }) {
  const band = computeBand(m, clock);
  const alert = clock.alerts[0];
  return (
    <button className="mcard" onClick={onOpen} aria-label={`${m.title}, ${m.company_name ?? ''}, ${BAND_META[band.primary].label}`}>
      <div className="band" style={bandStyle(band.primary)} title={BAND_META[band.primary].hint}>
        <span className="t trunc">{m.title}</span>
        {m.confidential && <span title="Confidential mandate" aria-label="Confidential">🔒</span>}
        <span className="tag">{BAND_META[band.primary].label}</span>
      </div>
      {band.secondary.length > 0 && <div className="band-sub" aria-hidden="true">{band.secondary.map((s) => <i key={s} style={{ ['--c' as string]: `var(${BAND_META[s].colorVar})` }} title={BAND_META[s].hint} />)}</div>}
      <div className="body">
        <div className="row"><span className="co trunc">{m.company_name ?? '—'}</span><span className="right row gap-s">{urgencyChip(m.urgency)}{stateChip(clock, m)}</span></div>
        <div className="small dim row wrap gap-s"><span>📍 {m.location ?? 'Location n/a'}</span><span>·</span><span>{plural(m.positions, 'position')}</span>{m.work_mode && <><span>·</span><span>{m.work_mode}</span></>}{m.level && <><span>·</span><span>{m.level}</span></>}</div>
        <div>
          <div className="row between tiny muted"><span>{clock.clockStarted ? `30-day clock · day ${Math.min(clock.clockDay!, 99)}` : '30-day clock not started'}</span><span>{clock.clockStarted ? `${Math.min(100, Math.round(clock.clockProgress * 100))}%` : 'set a work start date'}</span></div>
          <Progress pct={clock.clockProgress * 100} tone={clock.clockExpired ? 'red' : 'gold'} />
        </div>
        <div className="facts">
          <div className="fact"><b>{clock.daysOpen}</b><span>Days open</span></div>
          <div className="fact"><b>{m.candidate_total}</b><span>Candidates</span></div>
          <div className="fact"><b>{fmtDateShort(m.target_close)}</b><span>Target close</span></div>
          <div className="fact"><b>{m.last_activity_at ? relativeDays(m.last_activity_at.slice(0, 10), today).replace('in ', '') : '—'}</b><span>Last activity</span></div>
        </div>
        {m.consultants.length > 0 && <div className="row wrap gap-s"><Icon n="link" size={14} />{m.consultants.slice(0, 3).map((c) => <Chip key={c} tone="purple">{c}</Chip>)}{m.consultants.length > 3 && <Chip tone="purple">+{m.consultants.length - 3}</Chip>}</div>}
        {alert && clock.state !== 'closed' && <div className={`alert-line ${alert.level}`}><Icon n="alert" size={14} /><span>{alert.message}</span></div>}
      </div>
    </button>
  );
}

export function BandLegend() {
  const keys: BandKey[] = ['stalled', 'critical', 'joined', 'offered', 'selected', 'shared'];
  return <div className="legend" aria-label="Colour band legend">{keys.map((k) => <span key={k} title={BAND_META[k].hint}><i style={{ ['--c' as string]: `var(${BAND_META[k].colorVar})` }} />{BAND_META[k].label}</span>)}<span className="muted">· highest priority first; other conditions show as stripes under the title</span></div>;
}
