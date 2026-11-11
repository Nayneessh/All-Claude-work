import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import type { ScreeningStatus } from '@/domain/types';
import { STATUS_STYLE, type StatusStyle, type Tone } from './format';

/* ───── Icons (inline, 24px grid, currentColor) ───── */
const P: Record<string, string> = {
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  mandate: 'M4 4h16v4H4zM4 10h16v10H4zM8 14h8M8 17h5',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 3 3 3 0 0 0 1 3 3 3 0 0 0 3 4h1V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 3 3 3 0 0 1-1 3 3 3 0 0 1-3 4h-1V4z',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-5M17 14c2.8 0 5 2.2 5 5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  screen: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11l2 2 3-4',
  compare: 'M8 4v16M16 4v16M4 8h8M12 16h8',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  check: 'M5 12l5 5 9-10',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.500l6.100-.9z',
  scale: 'M12 4v16M5 8h14M5 8l-3 6a3.500 3.500 0 0 0 6 0zM19 8l-3 6a3.500 3.500 0 0 0 6 0z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  minus: 'M5 12h14',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.400 3.600-8 8-8s8 3.600 8 8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z',
};
export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.minus} />
    </svg>
  );
}

/* ───── Chips ───── */
export function Chip({ tone = 'neutral', icon, children, title }: { tone?: Tone; icon?: string; children: ReactNode; title?: string }): ReactNode {
  return <span className={`chip ${tone}`} title={title}>{icon && <Icon name={icon} size={12} />}{children}</span>;
}
export function StatusChip({ status, style }: { status: ScreeningStatus; style?: StatusStyle }): ReactNode {
  const s = style ?? STATUS_STYLE[status];
  return <Chip tone={s.tone} icon={s.icon}>{s.label}</Chip>;
}
export const JOB_TONE: Record<string, { tone: Tone; icon: string; label: string }> = {
  uploaded: { tone: 'neutral', icon: 'upload', label: 'Uploaded' }, queued: { tone: 'neutral', icon: 'minus', label: 'Queued' },
  extracting: { tone: 'info', icon: 'eye', label: 'Extracting' }, extracted: { tone: 'gold', icon: 'check', label: 'Extracted' },
  screening: { tone: 'info', icon: 'screen', label: 'Screening' }, completed: { tone: 'ok', icon: 'check', label: 'Completed' },
  needs_review: { tone: 'caution', icon: 'person', label: 'Needs review' }, failed: { tone: 'bad', icon: 'alert', label: 'Failed' },
};
export function JobChip({ status }: { status: string }): ReactNode {
  const j = JOB_TONE[status] ?? JOB_TONE.queued;
  return <Chip tone={j.tone} icon={j.icon}>{j.label}</Chip>;
}

/* ───── Layout pieces ───── */
export function PageHead({ title, sub, actions, crumbs }: { title: string; sub?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }): ReactNode {
  return (
    <div className="page-head">
      <div>{crumbs && <div className="crumbs">{crumbs}</div>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }): ReactNode {
  return <div className="kpi"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }): ReactNode {
  return (
    <section className={`card${flush ? ' flush' : ''}`}>
      {(title || actions) && <div className="card-head" style={flush ? { padding: '14px 18px 0' } : undefined}>{title && <h2>{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return <div className="empty"><b>{title}</b>{children}</div>;
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: (id: string) => ReactNode; wide?: boolean }): ReactNode {
  const id = useId();
  return <div className={`field${wide ? ' wide' : ''}`}><label htmlFor={id}>{label}</label>{children(id)}{hint && <span className="hint">{hint}</span>}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }): ReactNode {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

/** Single-hue horizontal bars. Names and values are always printed, so identity never depends on colour. */
export function BarList({ rows, max, tone = 'gold', unit = '' }: { rows: { name: string; value: number; label?: string }[]; max?: number; tone?: 'gold' | 'green'; unit?: string }): ReactNode {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list" role="list">
      {rows.map((r) => (
        <div className="bar-row" role="listitem" key={r.name} title={`${r.name}: ${r.label ?? r.value}${unit}`}>
          <span className="name">{r.name}</span>
          <span className="bar"><i className={tone === 'green' ? 'green' : ''} style={{ width: r.value > 0 ? `${Math.max(2, (r.value / top) * 100)}%` : 0 }} /></span>
          <span className="val">{r.label ?? r.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Score with its evidence-driven range (missing evidence scored 0 → 5) and the threshold marker. */
export function ScoreRange({ total, floor, ceiling, threshold }: { total: number; floor: number; ceiling: number; threshold: number }): ReactNode {
  return (
    <div title={`Score ${total}; range ${floor}–${ceiling}; threshold ${threshold}`}>
      <div className="range" role="img" aria-label={`Score ${total} out of 100, possible range ${floor} to ${ceiling}, threshold ${threshold}`}>
        <i style={{ left: `${floor}%`, width: `${Math.max(0, ceiling - floor)}%` }} />
        <u style={{ left: `${threshold}%` }} />
        <b style={{ left: `calc(${total}% - 1px)` }} />
      </div>
      <div className="small muted" style={{ position: 'relative', height: 18, marginTop: 4 }}><span style={{ position: 'absolute', left: 0 }}>0</span><span style={{ position: 'absolute', left: `${threshold}%`, transform: 'translateX(-50%)', color: 'var(--ok)' }}>threshold {threshold}</span><span style={{ position: 'absolute', right: 0 }}>100</span></div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }): ReactNode {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread" style={{ marginBottom: 14 }}><h2>{title}</h2><button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* ───── Toasts ───── */
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export const useToast = (): ((text: string, bad?: boolean) => void) => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }): ReactNode {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, bad }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), bad ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite">{list.map((t) => <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`} role={t.bad ? 'alert' : 'status'}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Run an async action, surface any error as a toast. */
export function useAction(): <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined> {
  const toast = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e instanceof Error ? e.message : String(e), true); return undefined; }
  }, [toast]);
}
