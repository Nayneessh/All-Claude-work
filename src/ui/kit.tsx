import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { pushBack } from '@/app/back';

/* ───────── buttons ───────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' | 'outline'; block?: boolean; small?: boolean; icon?: IconName };
export function Button({ variant = 'outline', block, small, icon, className = '', children, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant === 'outline' ? '' : variant, block ? 'block' : '', small ? 'small' : '', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest}>{icon && <Icon name={icon} size={small ? 18 : 20} />}{children}</button>;
}
export function IconButton({ name, label, gold, ...rest }: { name: IconName; label: string; gold?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`icon-btn${gold ? ' gold' : ''}`} aria-label={label} title={label} {...rest}><Icon name={name} /></button>;
}

/* ───────── layout bits ───────── */
export const Card = ({ tone, className = '', children, ...rest }: { tone?: 'blue' | 'hl'; className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => <div className={`card ${tone ?? ''} ${className}`} {...rest}>{children}</div>;
export const Badge = ({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'dim'; children: ReactNode }) => <span className={`badge ${tone ?? ''}`}>{children}</span>;
export const Chip = ({ on, onClick, children, ...rest }: { on?: boolean; onClick?: () => void; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) => <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} {...rest}>{children}</button>;
export const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => <section className="section"><div className="head"><h3>{title}</h3>{action}</div>{children}</section>;
export const ProgressBar = ({ value, label }: { value: number; label?: string }) => <div className="bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
export const Skeleton = ({ h = 20, w = '100%' }: { h?: number; w?: number | string }) => <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
export const Loading = ({ label = 'Loading…' }: { label?: string }) => <div className="col" role="status" aria-live="polite" aria-label={label}><Skeleton h={88} /><Skeleton h={88} /><Skeleton h={56} /></div>;
export function Empty({ icon = 'dumbbell', title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty"><div className="emoji"><Icon name={icon} size={34} /></div><div className="strong" style={{ color: 'var(--text)' }}>{title}</div>{hint && <div className="small mt-1">{hint}</div>}{action && <div className="mt-4">{action}</div>}</div>;
}
export function Banner({ tone, icon, children, action }: { tone?: 'err' | 'warn' | 'info'; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return <div className={`banner ${tone ?? ''}`} role={tone === 'err' ? 'alert' : 'status'}>{icon && <Icon name={icon} size={20} />}<div className="grow small">{children}</div>{action}</div>;
}
export const ListLink = ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) => <button type="button" className="item" onClick={onClick} {...rest}>{children}<Icon name="right" className="chev" /></button>;

/* ───────── forms ───────── */
export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{children(id)}{hint && !error && <span className="tiny dim">{hint}</span>}{error && <span className="err-text" role="alert">{error}</span>}</div>;
}
export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map((o) => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}
export function Stepper({ value, onChange, step = 1, min = 0, max = 999, label, format }: { value: number | null; onChange: (v: number) => void; step?: number; min?: number; max?: number; label: string; format?: (n: number) => string }) {
  const v = value ?? min;
  return (
    <div className="row-flex gap-2" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={`${label} minus`} onClick={() => onChange(Math.max(min, Math.round((v - step) * 100) / 100))}><Icon name="minus" /></button>
      <div className="num strong center" style={{ minWidth: 56 }}>{value === null ? '—' : format ? format(value) : value}</div>
      <button type="button" className="icon-btn" aria-label={`${label} plus`} onClick={() => onChange(Math.min(max, Math.round((v + step) * 100) / 100))}><Icon name="plus" /></button>
    </div>
  );
}
/** 1–5 rating buttons. null = not answered (never stored as zero). */
export function Rating({ value, onChange, label, lowLabel, highLabel }: { value: number | null; onChange: (v: number | null) => void; label: string; lowLabel?: string; highLabel?: string }) {
  return (
    <div className="field"><span className="label">{label}</span>
      <div className="row-flex gap-2" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`chip${value === n ? ' on' : ''}`} style={{ flex: 1, justifyContent: 'center' }} aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}>{n}</button>)}
      </div>
      {(lowLabel || highLabel) && <div className="row-flex between tiny dim"><span>{lowLabel}</span><span>{highLabel}</span></div>}
    </div>
  );
}

/* ───────── sheet / dialog ───────── */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const popBack = pushBack(onClose); // Android back closes the sheet first
    return () => { window.removeEventListener('keydown', onKey); popBack(); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="grab" />
        <div className="head"><h3>{title}</h3><IconButton name="x" label="Close" onClick={onClose} /></div>
        <div className="body">{children}</div>
        {footer && <div className="foot">{footer}</div>}
      </div>
    </>
  );
}

export interface ConfirmOptions { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export function Dialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onResult, extra }: ConfirmOptions & { onResult: (ok: boolean) => void; extra?: ReactNode }) {
  useEffect(() => pushBack(() => onResult(false)), [onResult]);
  return (
    <>
      <div className="backdrop" onClick={() => onResult(false)} aria-hidden="true" />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {message && <div className="mt-3 dim">{message}</div>}
        {extra}
        <div className="row-flex mt-5"><Button block onClick={() => onResult(false)}>{cancelLabel}</Button><Button block variant={danger ? 'danger' : 'primary'} onClick={() => onResult(true)}>{confirmLabel}</Button></div>
      </div>
    </>
  );
}

/* ───────── toasts + confirm host ───────── */
interface Toast { id: number; text: string; tone?: 'ok' | 'err'; action?: { label: string; run: () => void } }
interface UiApi { toast: (text: string, o?: { tone?: 'ok' | 'err'; action?: Toast['action']; ms?: number }) => void; confirm: (o: ConfirmOptions) => Promise<boolean> }
const UiCtx = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const seq = useRef(0);
  const toast = useCallback<UiApi['toast']>((text, o = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone: o.tone, action: o.action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), o.ms ?? (o.action ? 6000 : 3200));
  }, []);
  const confirm = useCallback<UiApi['confirm']>((o) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })), []);
  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  return (
    <UiCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span className="grow">{t.text}</span>
            {t.action && <Button small variant="soft" onClick={() => { t.action?.run(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</Button>}
          </div>
        ))}
      </div>
      {dlg && <Dialog {...dlg} onResult={(ok) => { dlg.resolve(ok); setDlg(null); }} />}
    </UiCtx.Provider>
  );
}
export function useUi(): UiApi {
  const c = useContext(UiCtx);
  if (!c) throw new Error('UiProvider missing');
  return c;
}
