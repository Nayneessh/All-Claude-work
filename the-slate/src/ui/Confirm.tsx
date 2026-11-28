import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

interface Opts { title: string; body?: ReactNode; confirm?: string; danger?: boolean }
const C = createContext<(o: Opts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(C);
/** Confirmation for destructive/irreversible actions: `if (await confirm({...})) …` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [o, setO] = useState<Opts | null>(null);
  const res = useRef<(v: boolean) => void>(() => {});
  const ask = useCallback((x: Opts) => new Promise<boolean>((r) => { res.current = r; setO(x); }), []);
  const done = (v: boolean) => { setO(null); res.current(v); };
  return (
    <C.Provider value={ask}>
      {children}
      {o && <Modal title={o.title} onClose={() => done(false)} footer={<><button className="btn" onClick={() => done(false)}>Cancel</button><button className={`btn ${o.danger ? 'danger' : 'primary'}`} onClick={() => done(true)}>{o.confirm ?? 'Confirm'}</button></>}><div className="dim">{o.body}</div></Modal>}
    </C.Provider>
  );
}
