import { createContext, useContext, useEffect, useId, useState, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const paths: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  mandates: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  talent: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.2c2.6.1 4.2 1.7 4.6 4.3" /></>,
  slate: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 9 2 2 3.5-4M8 15h8" /></>,
  sop: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  plus: <path d="M12 5v14M5 12h14" />, search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  upload: <><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>, download: <><path d="M12 4v12m0 0-4-4m4 4 4-4" /><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1" /></>,
  spark: <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.1" /></>, chev: <path d="m9 6 6 6-6 6" />, down: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 5 5 9-10" />, trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>, out: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  file: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>, link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>, list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />, back: <path d="m15 6-6 6 6 6" />, x: <path d="M6 6l12 12M18 6 6 18" />,
};
export const Icon = ({ n, size = 18 }: { n: keyof typeof paths | string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden="true">{paths[n]}</svg>;

interface FieldProps { label: string; hint?: ReactNode; error?: string; flag?: string; missing?: boolean; required?: boolean; full?: boolean; children: ReactNode; htmlFor?: string }
/** Each Field publishes an id; the TextInput/TextArea/Select inside it pick it up, so every label is programmatically tied to its control. */
const FieldCtx = createContext<{ id: string; describedBy?: string } | null>(null);
/** Form field wrapper. `flag` = value was inferred/ambiguous (amber), `missing` = needs attention (gold dashed). */
export function Field({ label, hint, error, flag, missing, required, full, children, htmlFor }: FieldProps) {
  const auto = useId(); const id = htmlFor ?? auto; const dId = `${id}-d`;
  const hasDesc = !!(error || hint || flag);
  return (
    <FieldCtx.Provider value={{ id, describedBy: hasDesc ? dId : undefined }}>
      <div className={`field ${error ? 'has-err' : ''} ${flag ? 'flag' : ''} ${missing ? 'miss' : ''} ${full ? 'full' : ''}`}>
        <label htmlFor={id}>{label}{required && <span className="gold" aria-hidden="true"> *</span>}</label>
        {children}
        <div id={dId}>
          {flag && <div className="hint" style={{ color: 'var(--amber)' }}>⚑ {flag}</div>}
          {error ? <div className="err" role="alert">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
        </div>
      </div>
    </FieldCtx.Provider>
  );
}
export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => { const c = useContext(FieldCtx); return <input className="input" id={c?.id} aria-describedby={c?.describedBy} {...p} />; };
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => { const c = useContext(FieldCtx); return <textarea className="textarea" id={c?.id} aria-describedby={c?.describedBy} {...p} />; };
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }) {
  const c = useContext(FieldCtx);
  return (
    <select className="select" id={c?.id} aria-describedby={c?.describedBy} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Seg<T extends string>({ value, onChange, options, green }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; green?: boolean }) {
  return <div className={`seg ${green ? 'green' : ''}`} role="tablist">{options.map((o) => <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value} type="button">{o.label}</button>)}</div>;
}
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)} role="tab" aria-selected={t.value === value}>{t.label}</button>)}</div>;
}
export const Loading = ({ text = 'Loading…' }: { text?: string }) => <div className="loading"><span className="spinner" /><span>{text}</span></div>;
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => <div className="empty"><b>{title}</b>{children}</div>;
export const ErrorBox = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div className="banner bad" role="alert"><span>⚠</span><div className="grow"><b>Could not load this.</b> <span className="dim">{(error as Error)?.message ?? String(error)}</span></div>{retry && <button className="btn sm" onClick={retry}>Retry</button>}</div>
);
export const Chip = ({ tone, children, title }: { tone?: 'gold' | 'green' | 'red' | 'amber' | 'info' | 'purple' | 'grey'; children: ReactNode; title?: string }) => <span className={`chip ${tone ?? ''}`} title={title}>{children}</span>;
export const Progress = ({ pct, tone }: { pct: number; tone?: 'gold' | 'red' }) => <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
export function Ring({ pct, label, color }: { pct: number; label?: ReactNode; color?: string }) {
  return <div className="ring" style={{ ['--p' as string]: Math.max(0, Math.min(100, pct)), ['--ringc' as string]: color }} aria-label={`${Math.round(pct)}%`}><b>{label ?? `${Math.round(pct)}%`}</b></div>;
}
export const Section = ({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <section className="card pad"><div className="sec-head"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}<div className="right row">{actions}</div></div>{children}</section>
);
export function useDebounced<T>(v: T, ms = 250): T { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
export function useMedia(q: string): boolean { const [m, setM] = useState(() => window.matchMedia(q).matches); useEffect(() => { const x = window.matchMedia(q); const f = () => setM(x.matches); x.addEventListener('change', f); return () => x.removeEventListener('change', f); }, [q]); return m; }
