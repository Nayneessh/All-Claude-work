import type { MC } from './analytics';

export type MandateView = 'open' | 'all' | 'active' | 'inactive' | 'on_hold' | 'overdue' | 'closed' | 'critical' | 'near_close' | 'idle' | 'waiting';
export type MandateSort = 'idle' | 'priority' | 'newest' | 'target' | 'days_open' | 'candidates';
export interface MandateFilters { q: string; view: MandateView; urgency: string; company: string; location: string; level: string; consultant: string; status: string; sort: MandateSort }
export const DEFAULT_FILTERS: MandateFilters = { q: '', view: 'open', urgency: '', company: '', location: '', level: '', consultant: '', status: '', sort: 'priority' };
const URG = { Critical: 4, High: 3, Medium: 2, Low: 1 } as const;

/** Pure filter + sort over the mandate rows loaded from the database. */
export function applyMandateFilters(rows: MC[], f: MandateFilters, inactivityDays: number): MC[] {
  const q = f.q.trim().toLowerCase();
  const out = rows.filter(({ m, clock }) => {
    const open = clock.state !== 'closed';
    switch (f.view) {
      case 'open': if (!open) return false; break;
      case 'active': if (clock.state !== 'active') return false; break;
      case 'inactive': if (clock.state !== 'inactive') return false; break;
      case 'on_hold': if (clock.state !== 'on_hold') return false; break;
      case 'overdue': if (clock.state !== 'overdue') return false; break;
      case 'closed': if (clock.state !== 'closed') return false; break;
      case 'critical': if (!open || m.urgency !== 'Critical') return false; break;
      case 'near_close': if (!clock.nearClose) return false; break;
      case 'idle': if (!(m.status === 'active' && clock.idleDays >= inactivityDays)) return false; break;
      case 'waiting': if (!open || m.waiting_count === 0) return false; break;
      case 'all': break;
    }
    if (f.urgency && m.urgency !== f.urgency) return false;
    if (f.company && m.company_name !== f.company) return false;
    if (f.location && m.location !== f.location) return false;
    if (f.level && m.level !== f.level) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.consultant && !m.consultants.includes(f.consultant)) return false;
    if (q) {
      const hay = [m.title, m.company_name, m.location, m.level, m.reporting_to, m.stakeholder, m.waiting_on, ...m.consultants].filter(Boolean).join(' ').toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const by: Record<MandateSort, (a: MC, b: MC) => number> = {
    idle: (a, b) => b.clock.idleDays - a.clock.idleDays,
    priority: (a, b) => URG[b.m.urgency] - URG[a.m.urgency] || b.clock.idleDays - a.clock.idleDays,
    newest: (a, b) => b.m.created_at.localeCompare(a.m.created_at),
    target: (a, b) => (a.m.target_close ?? '9999').localeCompare(b.m.target_close ?? '9999'),
    days_open: (a, b) => b.clock.daysOpen - a.clock.daysOpen,
    candidates: (a, b) => b.m.candidate_total - a.m.candidate_total,
  };
  return out.sort(by[f.sort]);
}
export const distinct = (vals: (string | null | undefined)[]): string[] => [...new Set(vals.filter((v): v is string => !!v && v.trim() !== ''))].sort((a, b) => a.localeCompare(b));
