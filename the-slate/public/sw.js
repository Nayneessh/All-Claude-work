/* THE SLATE service worker — web push only. It deliberately has no fetch/cache handler, so a deploy is never held back by a stale cache. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'THE SLATE', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = (e.notification.data && e.notification.data.url) || '/';
  try { const u = new URL(url, self.location.origin); if (u.searchParams.get('slate')) url = '/slate'; else if (u.searchParams.get('alarm')) url = '/mandates'; else url = u.pathname + u.search; } catch (_) { url = '/'; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
