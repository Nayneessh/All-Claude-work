import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

/** Live (auto-updating) read from the local database. `loading` is true until the first result arrives. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[], initial?: T): { data: T | undefined; loading: boolean } {
  const [seen, setSeen] = useState(false);
  const data = useLiveQuery(async () => { const r = await fn(); return { r }; }, deps);
  useEffect(() => { if (data) setSeen(true); }, [data]);
  return { data: data ? data.r : initial, loading: !seen && !data };
}

/** Ticks every `ms` while mounted — used for running clocks. */
export function useNow(ms = 1000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setN(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return n;
}
