// 서비스워커: 앱이 꺼져 있어도 푸시를 받아 알림으로 보여준다. 본문은 서버가 정한 짧은 문구뿐이다.
const SHELL = 'svcmon-shell-v2';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

// 같은 출처의 파일만, 네트워크 우선(오프라인이면 마지막 본 파일). API 요청은 건드리지 않는다.
// cache: 'no-cache' 는 "항상 서버에 새 버전이 있는지 물어본다"는 뜻이다(바뀐 게 없으면 304 로 가볍게 끝남).
// 이게 없으면 호스팅이 알려준 10분 캐시 때문에 새로 올린 화면이 폰에 늦게 보인다.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.endsWith('/version.json')) return;                 // 버전 확인은 항상 네트워크로 직접 (저장하지 않는다)
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) { const c = await caches.open(SHELL); c.put(e.request, res.clone()); prune(c, u); }
      return res;
    } catch (err) {
      // 오프라인: 같은 주소가 없으면 "?v=" 만 다른 같은 파일(마지막으로 본 것)이라도 쓴다
      const hit = (await caches.match(e.request)) || (await caches.match(e.request, { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});
// "?v=버전" 이 붙은 파일은 새 버전이 오면 같은 파일의 옛 버전 저장분을 지운다 (저장 공간이 늘어나지 않게)
async function prune(c, u) {
  if (!u.search) return;
  try { for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k); } } catch { /* 정리에 실패해도 괜찮다 */ }
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Service Monitor').slice(0, 60), {
    body: String(d.body || 'New alert').slice(0, 120),
    tag: d.tag || 'svcmon', renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' },
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
