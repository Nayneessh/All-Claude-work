import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveQuery } from 'dexie';
import { v4 as uuidv4 } from 'uuid';
import type { Profile } from '@/domain/types';
import { todayISO } from '@/domain/periods';
import type { ISODate } from '@/domain/types';
import { getMeta, setMeta } from '@/data/db';
import { configureRuntime, runtime } from '@/data/runtime';
import { seedLibrary } from '@/data/repo/exercises';
import { effectiveSettings, ensureProfile, saveProfile as saveProfileRepo, type ProfilePatch } from '@/data/repo/profile';
import { claimLocalData, pendingCount, pullAll } from '@/data/sync/engine';
import { createSyncManager, type SyncManager } from '@/data/sync/manager';
import { supabaseRemote } from '@/data/sync/supabaseRemote';
import type { Remote, SyncSnapshot } from '@/data/sync/types';
import { maybeDailySnapshot } from '@/data/backup';
import { getClient, cloudConfigured } from '@/services/supabase';
import { type AuthState, initAuth, initialAuth, signOut as authSignOut } from '@/services/auth';
import { hideSplash, isOnline, isNative, setStatusBar, watchApp, watchNetwork } from '@/services/platform';

export interface AppCtx {
  ready: boolean;
  profile: Profile | undefined;
  settings: ReturnType<typeof effectiveSettings>;
  unit: 'kg' | 'lb';
  weekStart: number;
  today: ISODate;
  auth: AuthState;
  online: boolean;
  sync: SyncSnapshot;
  syncNow: () => Promise<void>;
  saveProfile: (p: ProfilePatch) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuthData: () => Promise<void>;
  bootError: string | null;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => { const c = useContext(Ctx); if (!c) throw new Error('AppProvider missing'); return c; };

const blankSync: SyncSnapshot = { status: 'idle', pending: 0, lastSyncAt: null, lastError: null, failures: 0, conflicts: 0 };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | undefined>();
  const [auth, setAuth] = useState<AuthState>(initialAuth);
  const [online, setOnline] = useState(isOnline());
  const [sync, setSync] = useState<SyncSnapshot>(blankSync);
  const [today, setToday] = useState<ISODate>(todayISO());
  const remoteRef = useRef<Remote | null>(null);
  const onlineRef = useRef(online);
  const mgrRef = useRef<SyncManager | null>(null);
  onlineRef.current = online;

  if (!mgrRef.current) {
    mgrRef.current = createSyncManager({
      remote: () => remoteRef.current,
      online: () => onlineRef.current,
      schedule: (fn, ms) => { const t = window.setTimeout(fn, ms); return () => window.clearTimeout(t); },
      disabled: !cloudConfigured,
    });
  }
  const mgr = mgrRef.current;

  const reloadProfile = useCallback(async () => { setProfile(await ensureProfile()); }, []);

  // ── boot: device id → library → profile → text scale ────────────────────────
  useEffect(() => {
    let off: (() => void) | undefined;
    void (async () => {
      try {
        let deviceId = await getMeta<string | null>('device_id', null);
        if (!deviceId) { deviceId = uuidv4(); await setMeta('device_id', deviceId); }
        configureRuntime({ deviceId });
        try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
        await seedLibrary();
        await reloadProfile();
        await setStatusBar();
        off = await initAuth(setAuth);
        setReady(true);
        void hideSplash();
        void maybeDailySnapshot();
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
        setReady(true);
        void hideSplash();
      }
    })();
    return () => off?.();
  }, [reloadProfile]);

  // ── react to sign-in / sign-out: attach the remote, pull, claim, push ───────
  useEffect(() => {
    if (!ready) return;
    const client = getClient();
    if (auth.status === 'signed_in' && auth.userId && client) {
      configureRuntime({ userId: auth.userId });
      remoteRef.current = supabaseRemote(client);
      void (async () => {
        try {
          if (onlineRef.current) await pullAll(remoteRef.current as Remote); // learn what the account already has BEFORE claiming local rows
          await claimLocalData(auth.userId as string);
          await reloadProfile();
        } catch { /* offline or transient: claim happens on the next attempt; local data is untouched */ }
        await mgr.syncNow();
      })();
    } else {
      configureRuntime({ userId: null });
      remoteRef.current = null;
      void mgr.syncNow();
    }
  }, [auth.status, auth.userId, ready, mgr, reloadProfile]);

  useEffect(() => mgr.subscribe(setSync), [mgr]);

  // ── connectivity, resume, local-change trigger, clock ───────────────────────
  useEffect(() => {
    let offNet: (() => void) | undefined;
    let offApp: (() => void) | undefined;
    void watchNetwork((o) => { setOnline(o); onlineRef.current = o; if (o) void mgr.syncNow(); else void mgr.refresh(); }).then((f) => { offNet = f; });
    void watchApp({ onResume: () => { setToday(todayISO()); void mgr.syncNow(); void maybeDailySnapshot(); } }).then((f) => { offApp = f; });
    const clock = window.setInterval(() => setToday((d: ISODate) => { const n = todayISO(); return n === d ? d : n; }), 30_000);
    let last = -1;
    const sub = liveQuery(() => pendingCount()).subscribe((n) => { if (last >= 0 && n > last) mgr.notifyLocalChange(); else void mgr.refresh(); last = n; });
    const periodic = window.setInterval(() => void mgr.syncNow(), 120_000);
    return () => { offNet?.(); offApp?.(); window.clearInterval(clock); window.clearInterval(periodic); sub.unsubscribe(); mgr.stop(); };
  }, [mgr]);

  // reflect text scale
  useEffect(() => {
    const s = effectiveSettings(profile);
    document.documentElement.style.setProperty('--text-scale', String(s.text_scale));
  }, [profile]);

  const saveProfile = useCallback(async (p: ProfilePatch) => { setProfile(await saveProfileRepo(p)); }, []);
  const signOut = useCallback(async () => { await authSignOut(); }, []);

  const value = useMemo<AppCtx>(() => ({
    ready, profile, settings: effectiveSettings(profile), unit: profile?.units ?? 'kg', weekStart: profile?.week_start ?? 1, today, auth, online, sync,
    syncNow: async () => { await mgr.syncNow(); }, saveProfile, signOut, refreshAuthData: reloadProfile, bootError,
  }), [ready, profile, today, auth, online, sync, mgr, saveProfile, signOut, reloadProfile, bootError]);

  void runtime; void isNative;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
