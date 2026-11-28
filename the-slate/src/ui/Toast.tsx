import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface T { id: number; kind: 'ok' | 'err' | 'warn'; text: string; action?: { label: string; run: () => void } }
interface Ctx { ok(t: string): void; error(t: string): void; warn(t: string, action?: T['action']): void }
const C = createContext<Ctx>({ ok() {}, error() {}, warn() {} });
export const useToast = () => useContext(C);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const n = useRef(0);
  const push = useCallback((kind: T['kind'], text: string, action?: T['action'], ms = 4500) => {
    const id = ++n.current; setItems((x) => [...x.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), action ? 9000 : ms);
  }, []);
  const api = useMemo<Ctx>(() => ({ ok: (t) => push('ok', t), error: (t) => push('err', t, undefined, 7000), warn: (t, a) => push('warn', t, a) }), [push]);
  return (
    <C.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            <span>{i.kind === 'ok' ? '✓' : i.kind === 'err' ? '⚠' : 'ℹ'}</span><span className="grow">{i.text}</span>
            {i.action && <button className="btn xs" onClick={() => { i.action!.run(); setItems((x) => x.filter((y) => y.id !== i.id)); }}>{i.action.label}</button>}
          </div>
        ))}
      </div>
    </C.Provider>
  );
}
