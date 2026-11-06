// 저장소 추상화: 같은 인터페이스로 (1) 공유 db 기능, (2) 이 기기 안에만 저장하는 로컬 모드.
// 경로 '@' 는 "내 비공개 컬렉션" (data/users/<내 id>) 을 뜻한다. 원문 한탄은 여기에만 저장된다.
import { lsGet, lsSet } from './util.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function makeLocal(key) {
  let data = lsGet(key, {}) || {};
  const subs = new Map();
  const save = () => lsSet(key, data); // 즉시 저장: 탭을 바로 닫아도 방금 쓴 내용이 남도록
  const rows = (c) => Object.entries(data[c] || {}).map(([id, v]) => ({ id, ...v }));
  const emit = (c) => (subs.get(c) || []).forEach((f) => f(rows(c)));
  return {
    kind: 'local',
    watch(c, cb) {
      const a = subs.get(c) || [];
      a.push(cb);
      subs.set(c, a);
      queueMicrotask(() => cb(rows(c)));
      return () => subs.set(c, (subs.get(c) || []).filter((f) => f !== cb));
    },
    async set(c, id, v) { (data[c] ??= {})[id] = clone(v); save(); emit(c); },
    async del(c, id) { if (data[c]) delete data[c][id]; save(); emit(c); },
  };
}

// Supabase 백엔드. 공유 문서는 put_shared(RPC)로만 쓰고, 개인('@') 문서는 본인 행(owner)만 읽고 쓴다.
// 구독은 "바뀌었다는 신호"를 받으면 그 컬렉션을 다시 읽는 방식이라 구현이 단순하고 놓치는 변경이 없다.
function makeSupabase(sb, uid) {
  const retry = async (fn) => {
    try { return await fn(); } catch (e) {
      if (e?.name === 'TypeError' || /fetch|network/i.test(e?.message || '')) { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
      throw e;
    }
  };
  const ok = ({ error }) => { if (error) throw error; };
  const watchTable = (table, match, rowOf, cb, onErr) => {
    let alive = true, timer = null, seq = 0, delivered = false;
    const load = async () => {
      const mine = ++seq;
      const { data, error } = await sb.from(table).select('id,data').match(match.eq);
      if (!alive || mine !== seq) return;
      if (error) { onErr?.(error); if (!delivered) { delivered = true; cb([]); } return; } // 처음부터 실패해도 화면은 열리게 한다
      delivered = true;
      cb(data.map(rowOf));
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(load, 120); };
    const ch = sb.channel(`${table}:${match.key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: match.filter }, soon)
      .subscribe((status) => { if (status === 'SUBSCRIBED') load(); if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onErr?.(new Error(status)); });
    load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', load);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', load); sb.removeChannel(ch); };
  };
  const rowOf = (d) => ({ id: d.id, ...d.data });
  return {
    kind: 'cloud',
    shared: {
      watch: (c, cb, onErr) => watchTable('shared_docs', { key: c, filter: `coll=eq.${c}`, eq: { coll: c } }, rowOf, cb, onErr),
      set: (c, id, v) => retry(async () => ok(await sb.rpc('put_shared', { p_coll: c, p_id: id, p_data: clone(v) }))),
      del: (c, id) => retry(async () => ok(await sb.from('shared_docs').delete().match({ coll: c, id }))),
    },
    priv: {
      watch: (c, cb, onErr) => watchTable('private_docs', { key: uid, filter: `owner=eq.${uid}`, eq: { owner: uid } }, rowOf, cb, onErr),
      set: (c, id, v) => retry(async () => ok(await sb.from('private_docs').upsert({ owner: uid, id, data: clone(v) }, { onConflict: 'owner,id' }))),
      del: (c, id) => retry(async () => ok(await sb.from('private_docs').delete().match({ owner: uid, id }))),
    },
  };
}

/**
 * @param {{sb:any, uid:string|null, localKey?:string}} o
 * sb(Supabase 클라이언트)가 없으면 전부 이 기기(로컬)에만 저장한다.
 */
export function createStore({ sb, uid, localKey = 'svcmon.v1' }) {
  const local = makeLocal(localKey);
  const remote = sb && uid ? makeSupabase(sb, uid) : null;
  const route = (c) => (remote ? (c === '@' ? remote.priv : remote.shared) : local);
  const path = (c) => (remote ? c : c === '@' ? 'data/users/local' : c);
  const cache = {};
  const subs = {};
  const emit = (c) => (subs[c] || new Set()).forEach((f) => f(cache[c] || []));
  let q = Promise.resolve();
  const run = (fn) => { const p = q.then(fn); q = p.catch(() => {}); return p; }; // 쓰기는 한 번에 하나씩
  // 클라우드에서는 쓰기가 성공하면 화면에 바로 반영한다(서버 알림을 기다리지 않고).
  const mine = (c, fn, apply) => run(async () => { await fn(); if (remote) { apply(cache[c] ||= []); emit(c); } });

  const api = {
    mode: remote ? 'cloud' : 'local',
    privateIsCloud: !!remote,
    rows: (c) => cache[c] || [],
    get: (c, id) => (cache[c] || []).find((r) => r.id === id) || null,
    watch(c, cb, onErr) {
      (subs[c] ||= new Set()).add(cb);
      const un = route(c).watch(path(c), (rows) => { cache[c] = rows; cb(rows); }, onErr);
      return () => { subs[c]?.delete(cb); un(); };
    },
    set: (c, id, v) => mine(c, () => route(c).set(path(c), id, v), (list) => { const i = list.findIndex((r) => r.id === id); const row = { id, ...clone(v) }; i < 0 ? list.push(row) : (list[i] = row); }),
    del: (c, id) => mine(c, () => route(c).del(path(c), id), (list) => { const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); }),
    patch(c, id, f) {
      const cur = api.get(c, id) || {};
      const { id: _drop, ...rest } = cur;
      return api.set(c, id, { ...rest, ...f });
    },
  };
  return api;
}
