// 새 버전 자동 적용: 올릴 때마다 붙는 버전 번호(version.json)를 서버에서 확인해서, 지금 실행 중인 코드의 번호와 다르면
// 캐시를 비우고 새로고침한다. 앱을 열 때, 다시 앞으로 돌아올 때, 열어 둔 채로 5분마다 확인한다.
export function startUpdateCheck({ build, fetchFn = fetch, reload = () => location.reload(), clearCaches, busy = () => false, store = sessionStorage, doc = document, intervalMs = 5 * 60e3, setIv = setInterval, onStatus = () => {}, delayMs = 0, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)) }) {
  if (!build || build === 'dev') return { check: async () => 'dev' }; // 개발 중에는 끈다
  const KEY = 'svcmon.update.tries';
  async function check() { const r = await run(); onStatus(r); return r; }
  async function run() {
    if (doc.visibilityState === 'hidden') return 'hidden';
    let latest;
    try {
      const res = await fetchFn('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return 'offline';
      latest = (await res.json()).v;
    } catch { return 'offline'; }
    if (!latest || latest === build) { store.removeItem(KEY); return 'current'; }
    if (busy()) return 'busy';                       // 입력 중이면 방해하지 않고 다음에
    if (delayMs > 0) {                               // 새로 고치기 전에 잠깐 알려서, 새로고침 버튼의 표시가 보이게 한다
      onStatus('found'); await sleep(delayMs);
      if (busy()) return 'busy';
    }
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

// 새로고침 버튼: 아직 반영되지 않은 새 버전이 있으면 지금 바로 적용한다. (자동 확인과 달리 "입력 중"이나 시도 횟수에 막히지 않는다)
// 쓰던 글이 있어서 물어봐야 하면 beforeReload 가 false 를 돌려주는 것으로 취소할 수 있다.
export async function refreshNow({ build, fetchFn = fetch, reload = () => location.reload(), clearCaches, updateSW, beforeReload = async () => true }) {
  let latest;
  try {
    const res = await fetchFn('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return 'offline';
    latest = (await res.json()).v;
  } catch { return 'offline'; }
  if (!latest || !build || build === 'dev' || latest === build) return 'current';
  if (!(await beforeReload())) return 'cancelled';
  try { await (clearCaches ? clearCaches() : globalThis.caches?.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))); } catch { /* 계속 */ }
  // 서비스워커를 지우면(unregister) 푸시 알림 구독도 같이 사라지므로 지우지 않고, 새 버전을 확인만 시킨다 (파일은 sw.js 가 항상 서버에 물어봐서 최신으로 받는다)
  try { await (updateSW ? updateSW() : navigator.serviceWorker?.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.update())))); } catch { /* 계속 */ }
  reload();
  return 'reloading';
}
