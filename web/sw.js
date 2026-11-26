/* MARSA service worker – receives Web Push messages and shows system notifications.
 * Sound and vibration of a system notification are controlled by the device and browser settings. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const receipt = (pid, ev) => pid ? fetch('/api/push/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid, ev }) }).catch(() => {}) : Promise.resolve();

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'مَرسى | MARSA', body: e.data ? e.data.text() : '' }; }
  const crit = !!d.critical;
  const opts = {
    body: d.body || '', tag: d.tag || 'marsa', renotify: true, requireInteraction: crit, silent: false,
    icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', lang: 'ar', dir: 'rtl', timestamp: Date.now(),
    vibrate: crit ? [400, 150, 400, 150, 800] : [200, 100, 200],
    data: { url: d.url || '/', pid: d.pid || null },
    actions: d.test ? [] : [{ action: 'open', title: 'فتح الإنذار' }, { action: 'ack', title: 'تأكيد الاستلام' }]
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'مَرسى | MARSA', opts).then(() => receipt(d.pid, 'shown')),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ type: 'marsa-push', data: d })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}; let url = data.url || '/';
  if (e.action === 'ack') url += (url.includes('?') ? '&' : '?') + 'do=ack';
  e.waitUntil(Promise.all([receipt(data.pid, 'clicked'), self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) { c.postMessage({ type: 'marsa-open', url }); return c.focus(); }
    return self.clients.openWindow(url);
  })]));
});
self.addEventListener('notificationclose', e => { const d = e.notification.data || {}; e.waitUntil(receipt(d.pid, 'closed')); });
