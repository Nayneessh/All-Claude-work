import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSwitchableProvider, getAiMode, saveAiMode, type AiMode } from '@/ai';
import { createLocalRepo } from '@/data/local';
import { DEMO_USERS, ensureBaseData } from '@/data/demo';
import { createSupabaseRepo } from '@/data/supabase';
import type { Repo } from '@/data/repo';
import type { UserProfile } from '@/domain/types';
import type { Ctx } from '@/services/ctx';
import { EMPTY_WORLD, loadWorld, type World } from './world';

export interface Runtime {
  repo: Repo;
  mode: 'local' | 'cloud';
  ready: boolean;
  user: UserProfile | null;
  /** Signed in to Supabase but an administrator has not activated the account yet. */
  awaitingActivation: boolean;
  ctx: Ctx | null;
  aiMode: AiMode;
  setAiMode(m: AiMode): void;
  signInDemo(userId: string): void;
  signIn(email: string, password: string): Promise<string | undefined>;
  signUp(email: string, password: string): Promise<string | undefined>;
  signOut(): Promise<void>;
  authError?: string;
  world: World;
  reload(): void;
  loading: boolean;
}

const Ctx_ = createContext<Runtime | null>(null);
export const useRuntime = (): Runtime => {
  const r = useContext(Ctx_);
  if (!r) throw new Error('Runtime not available');
  return r;
};

const env = import.meta.env as Record<string, string | undefined>;
const CLOUD_URL = env.VITE_SUPABASE_URL;
const CLOUD_KEY = env.VITE_SUPABASE_ANON_KEY;
export const IS_CLOUD = Boolean(CLOUD_URL && CLOUD_KEY);
const USER_KEY = 'rip.user';

export function RuntimeProvider({ children }: { children: ReactNode }): ReactNode {
  const supa = useMemo<SupabaseClient | null>(() => (IS_CLOUD ? createClient(CLOUD_URL!, CLOUD_KEY!, { auth: { persistSession: true, autoRefreshToken: true } }) : null), []);
  const repo = useMemo<Repo>(() => (supa ? createSupabaseRepo(supa) : createLocalRepo()), [supa]);

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const [aiMode, setAiModeState] = useState<AiMode>(() => getAiMode(IS_CLOUD));
  const aiRef = useRef(aiMode);
  aiRef.current = aiMode;
  const [world, setWorld] = useState<World>(EMPTY_WORLD);
  const [loading, setLoading] = useState(false);

  const ai = useMemo(() => createSwitchableProvider(() => aiRef.current, async () => (await supa?.auth.getSession())?.data.session?.access_token), [supa]);

  // Session bootstrap
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supa) {
        await ensureBaseData(repo);
        let id: string | null = null;
        try { id = localStorage.getItem(USER_KEY); } catch { /* storage unavailable: sign in again */ }
        if (alive) { setUser(DEMO_USERS.find((u) => u.id === id) ?? null); setReady(true); }
        return;
      }
      const { data } = await supa.auth.getSession();
      await adopt(data.session?.user.id);
      if (alive) setReady(true);
    })();
    const sub = supa?.auth.onAuthStateChange((_e, s) => { void adopt(s?.user.id); });
    async function adopt(uid?: string): Promise<void> {
      if (!alive) return;
      if (!uid) { setUser(null); setAwaiting(false); return; }
      const p = await repo.get('profiles', uid).catch(() => undefined);
      if (!alive) return;
      if (p && p.active) { setUser(p); setAwaiting(false); } else { setUser(null); setAwaiting(true); }
    }
    return () => { alive = false; sub?.data.subscription.unsubscribe(); };
  }, [supa, repo]);

  const ctx = useMemo<Ctx | null>(() => (user ? { repo, ai, user, now: () => new Date() } : null), [repo, ai, user]);

  // World (everything visible to this user) — reloaded when anything changes.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reload = useCallback(() => {
    if (!user) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { setWorld(await loadWorld(repo, user)); } finally { setLoading(false); }
    }, 40);
  }, [repo, user]);
  useEffect(() => { if (user) { reload(); return repo.onChange(reload); } setWorld(EMPTY_WORLD); return undefined; }, [repo, user, reload]);

  const value: Runtime = {
    repo, mode: IS_CLOUD ? 'cloud' : 'local', ready, user, awaitingActivation: awaiting, ctx, aiMode, authError, world, reload, loading,
    setAiMode(m) { saveAiMode(m); setAiModeState(m); },
    signInDemo(id) { try { localStorage.setItem(USER_KEY, id); } catch { /* session-only */ } setUser(DEMO_USERS.find((u) => u.id === id) ?? null); },
    async signIn(email, password) {
      const { error } = await supa!.auth.signInWithPassword({ email, password });
      setAuthError(error?.message);
      return error?.message;
    },
    async signUp(email, password) {
      const { error } = await supa!.auth.signUp({ email, password });
      setAuthError(error?.message);
      return error?.message;
    },
    async signOut() {
      if (supa) await supa.auth.signOut(); else { try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ } }
      setUser(null); setAwaiting(false);
    },
  };
  return <Ctx_.Provider value={value}>{children}</Ctx_.Provider>;
}
