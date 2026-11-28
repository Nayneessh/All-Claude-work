import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { parseSettings } from '../lib/settings';
import { todayIn } from '../lib/time';
import { DEFAULT_SETTINGS, type ConfigKind, type ConfigOption, type Settings } from '../domain/types';
import { useAuth } from '../features/auth/AuthProvider';
import { useToast } from '../ui/Toast';
import { friendlyError } from '../lib/supabase';

export const K = {
  mandates: ['mandates'], mandate: (id: string) => ['mandate', id], pipeline: ['pipeline'], config: ['config'], settings: ['settings'], agencies: ['agencies'], mandateAgencies: ['mandate-agencies'],
  companies: ['companies'], tasks: ['tasks'], notifications: ['notifications'], candidate: (id: string) => ['candidate', id], candidates: ['candidates'],
} as const;
const STALE = 20_000;

export const useMandates = () => useQuery({ queryKey: K.mandates, queryFn: api.mandates, staleTime: STALE });
export const useMandate = (id?: string) => useQuery({ queryKey: K.mandate(id ?? ''), queryFn: () => api.mandate(id!), enabled: !!id, staleTime: STALE });
export const usePipeline = () => useQuery({ queryKey: K.pipeline, queryFn: api.pipeline, staleTime: STALE });
export const useConfigRaw = () => useQuery({ queryKey: K.config, queryFn: api.config, staleTime: 60_000 });
export const useAgencies = () => useQuery({ queryKey: K.agencies, queryFn: api.agencies, staleTime: 60_000 });
export const useMandateAgencies = () => useQuery({ queryKey: K.mandateAgencies, queryFn: api.mandateAgencies, staleTime: STALE });
export const useCompanies = () => useQuery({ queryKey: K.companies, queryFn: api.companies, staleTime: 60_000 });
export const useNotifications = () => useQuery({ queryKey: K.notifications, queryFn: api.notifications, refetchInterval: 60_000 });

export function useConfig() {
  const q = useConfigRaw();
  return useMemo(() => {
    const all = q.data ?? [];
    const by = (k: ConfigKind, activeOnly = true): ConfigOption[] => all.filter((o) => o.kind === k && (!activeOnly || o.active)).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
    return { all, loading: q.isLoading, by, labels: (k: ConfigKind) => by(k).map((o) => o.label), stages: by('pipeline_stage'), allStages: by('pipeline_stage', false) };
  }, [q.data, q.isLoading]);
}

export function useSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.settings, queryFn: api.settingsRaw, staleTime: 60_000 });
  const settings: Settings = useMemo(() => (q.data ? parseSettings(q.data.data) : DEFAULT_SETTINGS), [q.data]);
  const save = useCallback(async (patch: Partial<Settings>) => {
    await api.saveSettings(user!.id, q.data?.data ?? {}, patch as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: K.settings });
  }, [user, q.data, qc]);
  return { settings, save, loading: q.isLoading };
}
export function useToday() {
  const { settings } = useSettings();
  const [today, setToday] = useState(() => todayIn(settings.timezone));
  useEffect(() => { setToday(todayIn(settings.timezone)); const t = setInterval(() => setToday(todayIn(settings.timezone)), 60_000); return () => clearInterval(t); }, [settings.timezone]);
  return today;
}

/** Wraps a mutation: blocks double-submits, shows the error toast, optionally invalidates caches. */
export function useAction() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, o?: { success?: string; invalidate?: QueryKey[]; silentError?: boolean }): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true; setBusy(true);
    try {
      const r = await fn();
      if (o?.invalidate) await Promise.all(o.invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      if (o?.success) toast.ok(o.success);
      return r;
    } catch (e) { if (!o?.silentError) toast.error(friendlyError(e)); return undefined; }
    finally { lock.current = false; setBusy(false); }
  }, [qc, toast]);
  return { run, busy };
}
export const ALL_RECRUITMENT_KEYS: QueryKey[] = [K.mandates, K.pipeline, K.candidates, ['funnel'], ['activity'], ['candidate'], ['mandate'], ['mandate-detail'], ['cand-detail']];

/** Keeps a form draft in localStorage so an accidental refresh/navigation does not lose typing. */
export function useDraft<T>(key: string, initial: T): [T, (v: T) => void, () => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem('slate-draft:' + key); return s ? { ...initial, ...JSON.parse(s) } : initial; } catch { return initial; } });
  const set = useCallback((n: T) => { setV(n); try { localStorage.setItem('slate-draft:' + key, JSON.stringify(n)); } catch { /* ignore */ } }, [key]);
  const clear = useCallback(() => { try { localStorage.removeItem('slate-draft:' + key); } catch { /* ignore */ } }, [key]);
  return [v, set, clear];
}
