import { useCallback, useEffect, useRef, useState } from 'react';
import { getMeta, setMeta } from '@/data/db';
import { cancelNotifications, haptic, scheduleNotification } from '@/services/platform';

/**
 * Rest timer. State is an absolute end time persisted in the database, so it survives navigation, screen-off and even the app
 * being killed mid-rest. A native notification is scheduled for the end so you are told even with the screen locked.
 */
export interface RestState { endAt: number | null; total: number; label: string; startedAt: number | null }
const NOTIF_ID = 90_001;
const empty: RestState = { endAt: null, total: 0, label: '', startedAt: null };

let audio: AudioContext | null = null;
export function unlockAudio(): void {
  try { audio ??= new AudioContext(); void audio.resume(); } catch { /* audio is optional */ }
}
function beep(times = 3): void {
  try {
    if (!audio) return;
    const ctx = audio;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.28);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.28 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.28 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.28);
      o.stop(ctx.currentTime + i * 0.28 + 0.22);
    }
  } catch { /* ignore */ }
}

export function useRestTimer(opts: { sound: boolean; vibrate: boolean }) {
  const [state, setState] = useState<RestState>(empty);
  const [now, setNow] = useState(Date.now());
  const firedFor = useRef<number | null>(null);

  useEffect(() => { void getMeta<RestState>('rest_timer', empty).then((s) => { if (s.endAt && s.endAt > Date.now() - 60_000) setState(s); }); }, []);
  useEffect(() => {
    if (!state.endAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [state.endAt]);

  const remaining = state.endAt ? Math.max(0, Math.ceil((state.endAt - now) / 1000)) : 0;
  const finished = !!state.endAt && now >= state.endAt;

  useEffect(() => {
    if (finished && state.endAt && firedFor.current !== state.endAt) {
      firedFor.current = state.endAt;
      if (opts.sound) beep();
      if (opts.vibrate) void haptic('success');
    }
  }, [finished, state.endAt, opts.sound, opts.vibrate]);

  const persist = useCallback((s: RestState) => { setState(s); void setMeta('rest_timer', s); }, []);
  const start = useCallback((seconds: number, label = '') => {
    if (seconds <= 0) return;
    unlockAudio();
    const endAt = Date.now() + seconds * 1000;
    setNow(Date.now());
    persist({ endAt, total: seconds, label, startedAt: Date.now() });
    void scheduleNotification(NOTIF_ID, 'Rest over', label ? `Next: ${label}` : 'Time for your next set', new Date(endAt));
  }, [persist]);
  const adjust = useCallback((delta: number) => {
    setState((s) => {
      if (!s.endAt) return s;
      const endAt = Math.max(Date.now() + 1000, s.endAt + delta * 1000);
      const next = { ...s, endAt, total: Math.max(1, s.total + delta) };
      void setMeta('rest_timer', next);
      void scheduleNotification(NOTIF_ID, 'Rest over', s.label ? `Next: ${s.label}` : 'Time for your next set', new Date(endAt));
      return next;
    });
  }, []);
  const stop = useCallback(() => { persist(empty); void cancelNotifications([NOTIF_ID]); }, [persist]);

  return { active: !!state.endAt, remaining, total: state.total, label: state.label, finished, start, adjust, stop };
}
export type RestTimer = ReturnType<typeof useRestTimer>;
