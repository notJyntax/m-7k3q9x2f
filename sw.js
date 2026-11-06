// 서비스워커: 앱이 꺼져 있어도 푸시를 받아 알림으로 보여준다. 본문은 서버가 정한 짧은 문구뿐이다.
const SHELL = 'svcmon-shell-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

// 같은 출처의 파일만, 네트워크 우선(오프라인이면 마지막 본 파일). API 요청은 건드리지 않는다.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(SHELL)).put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Service Monitor').slice(0, 60), {
    body: String(d.body || '새 알림이 있어요').slice(0, 120),
    tag: d.tag || 'svcmon', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || './');
  })());
});
