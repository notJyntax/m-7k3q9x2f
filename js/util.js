// 작은 DOM/시간 유틸. 모든 동적 텍스트는 textContent 로만 넣는다.
export const $ = (s, r = document) => r.querySelector(s);

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === 'text') e.textContent = v;
    else if (k === 'for' || k.startsWith('data-') || k.startsWith('aria-')) e.setAttribute(k, v === true ? '' : v);
    else if (k in e) {
      try { e[k] = v; } catch { e.setAttribute(k, v); }
    } else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const pad = (n) => String(n).padStart(2, '0');
export const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(n)));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** 하루의 경계는 새벽 4시. 새벽 2시에 쓴 한탄은 "어제"에 속한다. */
const SHIFT = 4 * 3600e3;
export function dayKey(ts = Date.now()) {
  const d = new Date(ts - SHIFT);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function weekKey(ts = Date.now()) {
  const [y, m, d] = dayKey(ts).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export const monthKey = (ts = Date.now()) => dayKey(ts).slice(0, 7);
/** 0=일 … 6=토 (하루 경계 기준) */
export const weekdayOf = (ts = Date.now()) => new Date(ts - SHIFT).getDay();
export const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const hms = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const mdhm = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${hm(ts)}`; };
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function withTimeout(p, ms = 6000) {
  return Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), ms))]);
}

export const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 막혀 있어도 계속 동작 */ } };
