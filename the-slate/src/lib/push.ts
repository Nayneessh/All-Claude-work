import { api } from '../data/api';
import { supabase } from './supabase';

const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
export type PushState = 'unsupported' | 'denied' | 'default' | 'granted' | 'subscribed';

export function pushSupported(): boolean { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') return 'subscribed';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}
/** Asks permission (must be called from a click), subscribes this browser, and stores the subscription so the server job can reach it even when the app is closed. */
export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) return { ok: false, message: 'This browser does not support push notifications. On iPhone/iPad, add THE SLATE to your Home Screen first (Share → Add to Home Screen), then enable here.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'Notification permission was not granted. Allow notifications for this site in your browser settings, then try again.' };
  await registerServiceWorker(); const reg = await navigator.serviceWorker.ready;
  const key = await api.vapidKey(); if (!key) return { ok: false, message: 'Push is not configured on the server (no VAPID key).' };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) as BufferSource }));
  const j = sub.toJSON(); if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return { ok: false, message: 'The browser returned an incomplete subscription.' };
  await api.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, userAgent: navigator.userAgent.slice(0, 200) });
  return { ok: true, message: 'This device will now receive reminders, even when THE SLATE is closed.' };
}
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription();
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}
/** Sends a test push through the server (uses the existing send-reminders function's test mode). */
export async function sendTestPush(): Promise<{ ok: number; total: number }> {
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { test: true } });
  if (error) throw new Error(error.message); return data as { ok: number; total: number };
}
