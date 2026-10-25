import { Capacitor } from '@capacitor/core';
import { NATIVE } from '@/brand/tokens';

/** Thin wrappers over Capacitor with web fallbacks, so the same code runs in the browser (tests/preview) and on Android. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

export async function haptic(kind: 'light' | 'medium' | 'success' = 'light'): Promise<void> {
  try {
    if (isNative()) {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
      else await Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(kind === 'light' ? 10 : 25);
  } catch { /* haptics are a nicety; never fail an action because of them */ }
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export async function watchNetwork(cb: (online: boolean) => void): Promise<() => void> {
  const onUp = (): void => cb(true);
  const onDown = (): void => cb(false);
  window.addEventListener('online', onUp);
  window.addEventListener('offline', onDown);
  let remove: (() => void) | null = null;
  if (isNative()) {
    try {
      const { Network } = await import('@capacitor/network');
      const h = await Network.addListener('networkStatusChange', (s) => cb(s.connected));
      remove = (): void => { void h.remove(); };
    } catch { /* window events above still work */ }
  }
  return () => { window.removeEventListener('online', onUp); window.removeEventListener('offline', onDown); remove?.(); };
}

/** Android back button / app resume. Returns an unsubscribe function. */
export async function watchApp(handlers: { onResume?: () => void; onBack?: (canGoBack: boolean) => void }): Promise<() => void> {
  const offs: (() => void)[] = [];
  const vis = (): void => { if (document.visibilityState === 'visible') handlers.onResume?.(); };
  document.addEventListener('visibilitychange', vis);
  offs.push(() => document.removeEventListener('visibilitychange', vis));
  if (isNative()) {
    try {
      const { App } = await import('@capacitor/app');
      const r = await App.addListener('resume', () => handlers.onResume?.());
      offs.push(() => { void r.remove(); });
      if (handlers.onBack) {
        const b = await App.addListener('backButton', ({ canGoBack }) => handlers.onBack?.(canGoBack));
        offs.push(() => { void b.remove(); });
      }
    } catch { /* ignore */ }
  }
  return () => offs.forEach((f) => f());
}

export async function exitApp(): Promise<void> {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  await App.exitApp();
}

/** Save/share a text file: Android share sheet (Drive, Files, WhatsApp…) on device, a download in the browser. */
export async function shareFile(filename: string, text: string, mime = 'application/json'): Promise<'shared' | 'downloaded'> {
  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const w = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [w.uri], dialogTitle: 'Save or share' });
    return 'shared';
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const cur = await LocalNotifications.checkPermissions();
      if (cur.display === 'granted') return true;
      return (await LocalNotifications.requestPermissions()).display === 'granted';
    }
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

export async function scheduleNotification(id: number, title: string, body: string, at: Date, repeatsWeekly?: { weekday: number; hour: number; minute: number }): Promise<void> {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.schedule({
    notifications: [{ id, title, body, schedule: repeatsWeekly ? { on: { weekday: ((repeatsWeekly.weekday % 7) + 1) as 1, hour: repeatsWeekly.hour, minute: repeatsWeekly.minute }, allowWhileIdle: true } : { at, allowWhileIdle: true }, smallIcon: 'ic_stat_name', actionTypeId: 'WORKOUT' }],
  });
}

const SNOOZE_NOTIFICATION_ID = 90_050;

/** Adds a "Snooze" button to reminders and re-schedules the same reminder after the configured number of minutes. */
export async function setupNotificationActions(snoozeMinutes: () => number): Promise<() => void> {
  if (!isNative()) return () => undefined;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.registerActionTypes({ types: [{ id: 'WORKOUT', actions: [{ id: 'snooze', title: 'Snooze' }] }] });
    const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      if (e.actionId !== 'snooze') return;
      const at = new Date(Date.now() + Math.max(1, snoozeMinutes()) * 60_000);
      void LocalNotifications.schedule({ notifications: [{ id: SNOOZE_NOTIFICATION_ID, title: e.notification.title ?? 'Training', body: e.notification.body ?? '', schedule: { at, allowWhileIdle: true }, smallIcon: 'ic_stat_name', actionTypeId: 'WORKOUT' }] });
    });
    return () => { void handle.remove(); };
  } catch { return () => undefined; }
}

export async function cancelNotifications(ids: number[]): Promise<void> {
  if (!isNative() || !ids.length) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
}

export async function setStatusBar(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: NATIVE.nightGreen });
  } catch { /* cosmetic */ }
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try { const { SplashScreen } = await import('@capacitor/splash-screen'); await SplashScreen.hide(); } catch { /* auto-hides anyway */ }
}

// ── file store used for rolling snapshots (independent of the WebView database) ──────────────
export interface FileEntry { name: string; size: number; mtime: number }

export async function nativeWrite(dir: string, name: string, text: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  await Filesystem.writeFile({ path: `${dir}/${name}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
}
export async function nativeRead(dir: string, name: string): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const r = await Filesystem.readFile({ path: `${dir}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 });
  return typeof r.data === 'string' ? r.data : await r.data.text();
}
export async function nativeList(dir: string): Promise<FileEntry[]> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    const r = await Filesystem.readdir({ path: dir, directory: Directory.Data });
    return r.files.map((f) => ({ name: f.name, size: f.size ?? 0, mtime: f.mtime ?? 0 }));
  } catch { return []; }
}
export async function nativeRemove(dir: string, name: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  await Filesystem.deleteFile({ path: `${dir}/${name}`, directory: Directory.Data });
}
