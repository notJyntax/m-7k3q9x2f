// 새 버전 자동 적용: 올릴 때마다 붙는 버전 번호(version.json)를 서버에서 확인해서, 지금 실행 중인 코드의 번호와 다르면
// 캐시를 비우고 새로고침한다. 앱을 열 때, 다시 앞으로 돌아올 때, 열어 둔 채로 5분마다 확인한다.
export function startUpdateCheck({ build, fetchFn = fetch, reload = () => location.reload(), clearCaches, busy = () => false, store = sessionStorage, doc = document, intervalMs = 5 * 60e3, setIv = setInterval }) {
  if (!build || build === 'dev') return { check: async () => 'dev' }; // 개발 중에는 끈다
  const KEY = 'svcmon.update.tries';
  async function check() {
    if (doc.visibilityState === 'hidden') return 'hidden';
    let latest;
    try {
      const res = await fetchFn('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return 'offline';
      latest = (await res.json()).v;
    } catch { return 'offline'; }
    if (!latest || latest === build) { store.removeItem(KEY); return 'current'; }
    if (busy()) return 'busy';                       // 입력 중이면 방해하지 않고 다음에
    const tries = Number(store.getItem(KEY) || 0);
    if (tries >= 2) return 'gave-up';                // 무한 새로고침 방지
    store.setItem(KEY, String(tries + 1));
    try { await (clearCaches ? clearCaches() : globalThis.caches?.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))); } catch { /* 캐시 비우기 실패해도 새로고침은 한다 */ }
    reload();
    return 'reloading';
  }
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') check(); });
  setIv(check, intervalMs);
  check();
  return { check };
}
