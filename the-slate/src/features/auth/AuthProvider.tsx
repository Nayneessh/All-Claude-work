import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

interface A { user: User | null; session: Session | null; loading: boolean; recovery: boolean; signOut(): Promise<void>; clearRecovery(): void }
const C = createContext<A>({ user: null, session: null, loading: true, recovery: false, signOut: async () => {}, clearRecovery() {} });
export const useAuth = () => useContext(C);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => { setSession(s); setLoading(false); if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  const v = useMemo<A>(() => ({ user: session?.user ?? null, session, loading, recovery, clearRecovery: () => setRecovery(false),
    signOut: async () => { await supabase.auth.signOut(); try { sessionStorage.clear(); } catch { /* ignore */ } } }), [session, loading, recovery]);
  return <C.Provider value={v}>{children}</C.Provider>;
}
