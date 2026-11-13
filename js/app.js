import { h, $, uid, pad, clamp, sum, dayKey, weekKey, monthKey, weekdayOf, hm, hms, mdhm, withTimeout, lsGet, lsSet } from './util.js';
import { createStore } from './store.js';
import * as L from './logic.js';
import { CONFIG } from './config.js';
import * as Push from './push.js';
import { startUpdateCheck, refreshNow } from './update.js';
import { BUILD } from './version.js';
import { CHANGELOG } from './changelog.js';

const SHARED = ['lines', 'reviews', 'commits', 'alerts', 'stats', 'shared', 'events', 'plan_log', 'agendas', 'agenda_comments', 'checkins', 'posts', 'post_comments', 'post_reactions', 'post_votes', 'comment_likes', 'review_replies', 'commit_replies'];

// 기본 테마(회사에서 보기 좋은 차분한 톤)와 스페셜 테마(기분 전환용). 스페셜은 강조색·버튼색까지 테마마다 달라요.
const THEMES_V2 = [['n-ink', 'Ink'], ['n-moss', 'Moss'], ['n-dusk', 'Dusk'], ['n-frost', 'Frost']];
const DEFAULT_THEME = 'n-ink';
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['warm', 'Warm Gray'], ['auto', 'Auto']];
const THEMES_FUN = [['terminal', 'Terminal'], ['excel', 'Excel']];
const SWATCH = { 'n-frost': 'linear-gradient(135deg, #ffffff 50%, #0969da 50%)', 'n-ink': 'linear-gradient(135deg, #191919 50%, #6aaaf0 50%)', 'n-moss': 'linear-gradient(135deg, #1a1f1c 50%, #7fc4a2 50%)', 'n-dusk': 'linear-gradient(135deg, #1b1d2b 50%, #b4a0f0 50%)', light: '#f4f5f7', dark: '#0f1419', warm: '#f1ede5', auto: 'linear-gradient(135deg, #f4f5f7 50%, #0f1419 50%)',
  terminal: 'linear-gradient(135deg, #161b1d 50%, #7fc4a2 50%)', excel: 'linear-gradient(135deg, #ffffff 50%, #217346 50%)' };
const ALL_THEMES = [...THEMES_V2, ...THEMES, ...THEMES_FUN];
window.matchMedia?.('(min-width: 900px)').addEventListener?.('change', () => { if (S.tab === 'syslog') renderView(); });   // PC↔폰 폭이 바뀌면 Syslog 배치를 다시 그린다
const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(t = lsGet('svcmon.theme', DEFAULT_THEME)) {
  const id = t === 'auto' ? (darkMQ?.matches ? 'dark' : 'light') : ALL_THEMES.some(([x]) => x === t) ? t : DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  if (id.startsWith('n-')) document.documentElement.dataset.ui = 'v2'; else delete document.documentElement.dataset.ui;   // n- 테마만 새 디자인, 나머지는 예전 디자인 그대로
  // 폰 상단 상태줄 색도 테마 배경에 맞춘다
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}
darkMQ?.addEventListener?.('change', () => { if (lsGet('svcmon.theme', DEFAULT_THEME) === 'auto') applyTheme(); });

const S = {
  store: null, role: 'writer', sandbox: false, cloud: false, tab: 'console', uid: null, email: '', sb: null, gate: null, canWrite: true, push: 'loading',
  ready: false, slow: false, filter: '', viewFrom: 0, idle: [], pending: [], open: new Set(), care: null,
  dirty: false, unsubs: [], timers: [], rep: { sig: '', lines: null, busy: false }, gcBusy: false,
};

// ───────── 데이터 접근 ─────────
const rows = (c) => (S.store ? S.store.rows(c) : []);
const sd = (id) => (S.store && S.store.get('shared', id)) || {};
// 리스너가 보는 상태: 마지막 갱신이 어제(4시 이전)면 CPU·MEM·CACHE 는 새 하루라서 0, 색은 green (DISK 는 주간 누적이라 그대로). 작성자 앱이 꺼져 있어도 새벽 4시에 맞게 보인다
const statusToday = () => { const st = sd('status'); return st.level && dayKey(st.ts || 0) < dayKey() ? { ...st, level: 'green', cpu: 0, mem: 0, pos: 0 } : st; };
const meta = () => (S.store && S.store.get('@', 'meta')) || {};
const logsAll = () => rows('@').filter((r) => r.type === 'log').sort((a, b) => a.ts - b.ts);
const dayLogs = (day) => logsAll().filter((l) => l.day === day);
const todayLogs = () => dayLogs(dayKey());
const keeps = () => rows('@').filter((r) => r.type === 'keep').sort((a, b) => b.ts - a.ts);
const setMeta = (f) => S.store.patch('@', 'meta', { type: 'meta', ...f });
const dayMs = (day) => new Date(day + 'T12:00:00').getTime();
const isWriter = () => S.role === 'writer';

function metrics() {
  const today = dayKey();
  const logs = todayLogs();
  const live = L.statFromLogs(logs);
  const m = meta();
  const rel = m.relief?.day === today ? m.relief : { cpu: 0, mem: 0 };
  const cpu = clamp(live.cpu * 1.0 - rel.cpu);
  const mem = clamp(live.mem * 1.0 - rel.mem);
  const wk = weekKey();
  const wrows = rows('stats').filter((r) => r.week === wk);
  const past = sum(wrows.filter((r) => r.day !== today), (r) => r.disk);
  const todayDisk = logs.length ? live.disk : wrows.find((r) => r.day === today)?.disk || 0;
  const disk = clamp((past + todayDisk) * 0.3);
  return { ...live, cpu, mem, disk, pos: clamp(live.pos), level: L.levelOf(cpu, mem, live.FATAL) }; // 상태 색은 짜증·피로(cpu, mem)만으로 정한다
}
function weekRows() {
  const wk = weekKey(), today = dayKey();
  const map = new Map(rows('stats').filter((r) => r.week === wk).map((r) => [r.day, r]));
  if (isWriter() || !S.cloud) { const logs = todayLogs(); if (logs.length) map.set(today, { day: today, week: wk, ...L.statFromLogs(logs) }); }
  return [...map.values()];
}
function weekDays() {
  const start = new Date(weekKey() + 'T12:00:00');
  return [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; });
}

// ───────── UI 부품 ─────────
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', { text: title }) : null, ...kids);
const badge = (t, c = '') => h('span', { class: 'badge ' + c, text: t });
// 버튼은 기능별로 색을 달리한다 (굵기 X): 보내기·추가=파랑, 해결·확인=초록, 삭제·중단=빨강, 보관=노랑, 설정 켜고 끄기=상태만 색, 나머지(취소·닫기·이동)=회색
const BTN_KIND = [['k-del', /^(Delete|Reject|Unshare|Clear|Cancel scheduled|Abort|Exit sandbox|Sign out|Turn off)/], ['k-ok', /^(Resolve|Approve|Deployed|I hear you|Confirm)/], ['k-keep', /^(⭐ )?(Keep|Unkeep)/], ['k-go', /^(Add|Post|Send|Reply|Commit|Run|Share|Save|Sign in|Try sandbox|Turn on)/], ['k-nt', /^(Cancel|Close|Not now|Exit|Hide|OK$)/]];
const btnKind = (label) => (BTN_KIND.find(([, re]) => re.test(String(label))) || [''])[0];
// Edit·Delete·Keep·Resolve·Share·Copy 같은 짧은 동작 버튼은 글자 대신 아이콘으로 (이름은 마우스를 올리거나 읽어 줄 때 나온다)
const ICONS = {   // 선 + 옅은 면(fill-opacity .16) + 아이콘마다 디테일 하나. 모두 24×24, 선 굵기·크기는 .ico 가 정한다
  edit: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" fill="currentColor" fill-opacity=".16"/><path d="M14.5 6.5l3 3"/><path d="M13 20.5h7"/>',
  trash: '<path d="M6 7l1 12a1.2 1.2 0 0 0 1.2 1h7.6a1.2 1.2 0 0 0 1.2-1l1-12z" fill="currentColor" fill-opacity=".16"/><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M10 11v5M14 11v5"/>',
  keep: '<path d="M7 3h10v18l-5-3.6L7 21z" fill="currentColor" fill-opacity=".16"/><path d="M10 8h4"/>', keepOn: '<path d="M7 3h10v18l-5-3.6L7 21z"/><path d="M10 8h4" stroke="var(--panel)"/>',
  resolve: '<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".16"/><path d="M8 12.5l3 3 5-6"/>',
  approve: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="currentColor" fill-opacity=".16"/><path d="M8 12.5l3 3 5-6"/>',
  reject: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="currentColor" fill-opacity=".16"/><path d="M9 9l6 6M15 9l-6 6"/>',
  share: '<path d="M5 13v5a1.2 1.2 0 0 0 1.2 1h11.6a1.2 1.2 0 0 0 1.2-1v-5z" fill="currentColor" fill-opacity=".16"/><path d="M12 15V4"/><path d="M8 8l4-4 4 4"/>',
  unshare: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/><path d="M4 4l16 16"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.4" fill="currentColor" fill-opacity=".16"/><path d="M16 8V6.4A2.4 2.4 0 0 0 13.6 4H6.4A2.4 2.4 0 0 0 4 6.4v7.2A2.4 2.4 0 0 0 6.4 16H8"/>',
  reply: '<path d="M9.5 6.5L4 12l5.5 5.5v-3.2c4.8-.3 8 .9 10.5 4.2-.6-5.6-4-9.2-10.5-9.6z" fill="currentColor" fill-opacity=".16"/>',
  comment: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 4v-4H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z" fill="currentColor" fill-opacity=".16"/><path d="M8 9h8M8 12h5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" fill="currentColor" fill-opacity=".16"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M4 4l16 16"/>',
  eyeOff: '<path d="M3 12s3.5-6 9-6c1.4 0 2.6.3 3.6.8"/><path d="M21 12s-3.5 6-9 6c-1.4 0-2.6-.3-3.6-.8"/><path d="M10 10a2.6 2.6 0 0 0 3.6 3.6"/><path d="M4 4l16 16"/>',
  inbox: '<path d="M4 13l2.2-6.5A1.5 1.5 0 0 1 7.6 5.5h8.8a1.5 1.5 0 0 1 1.4 1L20 13v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" fill="currentColor" fill-opacity=".16"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
  note: '<path d="M6 4h9l3 3v13H6z" fill="currentColor" fill-opacity=".16"/><path d="M9 11h6M9 14.5h6"/>',
  range: '<circle cx="5.5" cy="12" r="2.2" fill="currentColor" fill-opacity=".16"/><circle cx="18.5" cy="12" r="2.2" fill="currentColor" fill-opacity=".16"/><path d="M8 12h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M4 11.5L20 4l-5.5 16-3.2-6.3z" fill="currentColor" fill-opacity=".16"/><path d="M11.3 13.7L15 9.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  checks: '<path d="M2.8 12.5l4 4 7-8"/><path d="M11.5 15l1.6 1.6 7.4-8.6"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5" fill="currentColor" fill-opacity=".16"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="currentColor" fill-opacity=".16"/><circle cx="12" cy="12" r="2.6"/>',
  chevL: '<path d="M14.5 6l-6 6 6 6"/>', chevR: '<path d="M9.5 6l6 6-6 6"/>', chevU: '<path d="M6 14.5l6-6 6 6"/>', chevD: '<path d="M6 9.5l6 6 6-6"/>',
  close: '<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".16"/><path d="M9 9l6 6M15 9l-6 6"/>',
  refresh: '<circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity=".16" stroke="none"/><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.8 4.5v4.6h-4.6"/>',
  help: '<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".16"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8"/><circle cx="12" cy="17" r=".95" fill="currentColor" stroke="none"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" fill-opacity=".16"/>',
  heartOn: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor"/>',
  more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
};
const ICON_OF = { Edit: 'edit', Delete: 'trash', Keep: 'keep', '⭐ Keep': 'keep', Unkeep: 'keepOn', Resolve: 'resolve', Share: 'share', 'Share log': 'share', Unshare: 'unshare', Copy: 'copy', Reply: 'reply', Comment: 'comment', Approve: 'approve', Reject: 'reject', More: 'more', '<': 'chevL', '>': 'chevR', '×': 'close', '↻': 'refresh', '?': 'help' };
const icon = (name) => { const t = document.createElement('template'); t.innerHTML = `<svg class="ico${name === 'keepOn' ? ' on' : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`; return t.content.firstChild; };   // 고정 문자열만 사용
// 아이콘이 될 수 없는(글자가 필요한) 버튼은 앞에 작은 아이콘을 붙인다
const LEAD = [[/^Add$/, 'plus'], [/^(Post|Send|Commit)$/, 'send'], [/^Today$/, 'calendar'], [/^See$/, 'eye'], [/^(Confirm all|Mark all read)$/, 'checks'], [/^(Show|Hide) resolved/, 'resolve'], [/^(Save|Got it|OK)$/, 'check'], [/^Range$/, 'range'], [/^New agenda$/, 'plus'], [/^Memo$/, 'note'], [/^Refresh$/, 'refresh']];
const leadIcon = (label) => (typeof label === 'string' ? (LEAD.find(([re]) => re.test(label)) || [])[1] : null);
const btn = (label, fn, cls = '', extra = {}) => {
  const tg = /^(.+: )(on|off)$/.exec(String(label));
  const ic = ICON_OF[label] && /\bsmall\b/.test(cls) && !/\bprimary\b/.test(cls) ? ICON_OF[label] : null;
  return h('button', { type: 'button', class: ['btn', cls, btnKind(label), tg ? 'k-tg' : '', ic ? 'ic' : ''].filter(Boolean).join(' '), on: { click: fn }, ...(ic ? { title: extra.title || extra['aria-label'] || label, 'aria-label': extra['aria-label'] || label } : {}), ...extra }, ic ? icon(ic) : tg ? [tg[1], h('span', { class: 'k-state ' + tg[2], text: tg[2] })] : leadIcon(label) ? [icon(leadIcon(label)), label] : label);
};
// 켜짐/꺼짐 스위치 버튼: 글자(Mask: on) 대신 아이콘으로, 상태는 아이콘 모양과 강조색으로
const tglBtn = (name, title, on, fn) => h('button', { type: 'button', class: 'btn small quiet ic tgl' + (on ? ' on' : ''), title, 'aria-label': title, 'aria-pressed': String(on), on: { click: fn } }, icon(name));
// ⋯ 메뉴: 글·댓글·답글·아젠다·commit·로그의 Edit / Delete 는 이 버튼 하나 안에 둔다 (줄이 번잡하지 않게, 위치는 항상 같은 칸).
// items: [{ label, icon, fn, danger }]. 바깥을 누르거나 Esc, 스크롤, 화면을 다시 그리면 닫힌다.
const closeMenu = () => { document.getElementById('more-menu')?.remove(); };
function moreMenu(items) {
  const b = btn('More', () => {}, 'small quiet more');
  b.setAttribute('aria-haspopup', 'menu');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = document.getElementById('more-menu'), same = was && was._owner === b; closeMenu(); if (same) return;
    const m = h('div', { id: 'more-menu', class: 'more-menu', role: 'menu' }, items.map((it) => h('button', { type: 'button', role: 'menuitem', class: 'mi' + (it.danger ? ' danger' : ''), on: { click: (ev) => { ev.stopPropagation(); closeMenu(); it.fn(); } } }, icon(it.icon), h('span', { text: it.label }))));
    m._owner = b; document.body.append(m);
    const r = b.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.right - mw)) + 'px';
    m.style.top = (r.bottom + 4 + mh > innerHeight - 8 ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
    m.querySelector('.mi')?.focus();
  });
  return b;
}
document.addEventListener('click', (e) => { if (!e.target.closest?.('#more-menu')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
addEventListener('scroll', closeMenu, true); addEventListener('resize', closeMenu);
// Enter로 보내기 (한글 입력 중 Enter는 글자 확정과 겹치므로, 확정이 끝난 뒤 한 번에 보낸다)
function onEnter(el, fn, { shift = false } = {}) {
  let pend = false, endedAt = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || (shift && e.shiftKey)) return;
    e.preventDefault();
    if (e.isComposing) { pend = true; return; }
    if (e.keyCode === 229 && performance.now() - endedAt < 60) return;   // 확정 직후 따라오는 Enter (이미 compositionend에서 처리)
    fn();
  });
  el.addEventListener('compositionend', () => { endedAt = performance.now(); if (pend) { pend = false; setTimeout(fn, 0); } });
}
const empty = (t) => h('p', { class: 'empty', text: t });
const note = (t) => h('p', { class: 'note', text: t });
const meter = (name, v, fixed) => h('div', { class: 'meter' },
  h('div', { class: 'mh' }, h('b', { text: name }), h('span', { class: 'pct', text: v + '%' })),
  h('div', { class: 'bar' }, h('i', { class: fixed || (v >= 75 ? 'crit' : v >= 40 ? 'warn' : 'ok'), style: `width:${v}%` })));
// CPU 하나로 힘든 로그를 합치고, 막대 안을 색으로 나눈다: 짜증·화(Irritation) · 피로·불안(Fatigue). 좋은 말은 CPU가 아니라 바로 아래 Positive 막대에 쌓는다.
const LOAD_PARTS = [['Irritation', 'irr'], ['Fatigue', 'fat']];
const stackMeter = (name, a, b) => {
  const vals = [a | 0, b | 0], sumv = vals[0] + vals[1], total = clamp(sumv), k = sumv > 100 ? 100 / sumv : 1;
  return h('div', { class: 'meter stack' },
    h('div', { class: 'mh' }, h('b', { text: name }), h('span', { class: 'pct', text: total + '%' })),
    h('div', { class: 'bar stackbar' }, LOAD_PARTS.map(([label, cls], i) => h('i', { class: 'seg ' + cls, style: `width:${vals[i] * k}%`, title: `${label} ${vals[i]}` }))),
    h('div', { class: 'legend' }, LOAD_PARTS.map(([label, cls], i) => h('span', { class: 'lg' }, h('i', { class: 'sw2 ' + cls }), `${label} ${vals[i]}`))));
};
// 좋은 말 막대(CACHE = 좋은 일을 빠르게 꺼내 쓰도록 쌓아 둔 것): 많을수록 좋은 거라서 높아도 빨갛게 바뀌지 않고 항상 초록이다.
const GOOD_LABEL = 'CACHE';
const goodMeter = (v) => h('div', { class: 'meter' },
  h('div', { class: 'mh' }, h('b', { text: GOOD_LABEL }), h('span', { class: 'pct', text: clamp(v | 0) + '%' })),
  h('div', { class: 'bar' }, h('i', { class: 'ok', style: `width:${clamp(v | 0)}%` })));
const statusPill = (level) => h('div', { class: 'status ' + level }, h('span', { class: 'dot' }), h('b', { text: L.STATUS_TEXT[level] }));

function errText(e) {
  if (e?.code === '42501') return '이 작업은 지금 계정의 역할로는 할 수 없어요.';
  if (e?.code === 'PGRST301' || /JWT/i.test(e?.message || '')) return '로그인이 만료됐어요. 새로고침해서 다시 로그인해 주세요.';
  if (e?.code === '23514') return '내용이 너무 길어요. 조금 줄여서 다시 시도해 주세요.';
  return '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { console.warn(e); toast(errText(e)); } };
let toastT;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}
function modal({ title, body, actions, sticky = false }) {
  const root = $('#modal-root');
  const close = () => root.replaceChildren();
  root.replaceChildren(h('div', { class: 'overlay', on: { click: (e) => { if (e.target === e.currentTarget && !sticky) close(); } } },
    h('div', { class: 'dialog', role: 'dialog' }, h('h3', { text: title }), body,
      h('div', { class: 'actions' }, actions.map((a) => btn(a.label, act(async () => { if (a.close !== false) close(); await a.fn?.(close); }), a.cls || ''))))));
  return close;
}

// 글자 고치기 (본인 글만): 고치면 'edited' 표시가 붙는다
function editText({ title, text, max, onSave }) {
  const ta = h('textarea', { rows: 3, maxLength: max, 'aria-label': title });
  ta.value = text;
  modal({ title, body: h('div', { class: 'share' }, ta, h('div', { class: 'mlab', text: `${max} chars max` })),
    actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Save', cls: 'primary', fn: async () => {
      const t = ta.value.trim();
      if (!t) return toast('내용을 적어주세요');
      if (t === text.trim()) return;
      await onSave(t); S.dirty = false; renderView(); renderChrome(); toast('고쳤어요');
    } }] });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
}

// ───────── 셸 / 부팅 ─────────
function buildShell() {
  const ta = h('textarea', { id: 'cmd', rows: 1, placeholder: matchMedia?.('(pointer: coarse)').matches ? 'Enter incident note…' : 'Enter incident note…   (Enter = run · /help)', 'aria-label': 'incident note', on: {
    input: (e) => { autoGrow(e.target); syncRun(); },
  } });
  // 쓰는 맛: 입력하면 Run 이 켜지고(비어 있으면 흐리게), 입력칸 오른쪽에 ↵ 힌트, 포커스하면 ~$ 와 칸이 빛난다 (CSS)
  const run = btn('Run', act(() => { const r = onSubmit(); setTimeout(syncRun, 0); return r; }), 'primary run');
  function syncRun() { run.classList.toggle('off', !ta.value.trim()); }
  syncRun();
  onEnter(ta, () => { const r = onSubmit(); setTimeout(syncRun, 0); return r; }, { shift: true });
  const dock = h('footer', { id: 'dock', class: 'dock', hidden: true },
    h('div', { class: 'chips' }, h('span', { class: 'k', text: 'quick' }), ['WARN', 'ERROR', 'FATAL'].map((lv) => btn('+' + lv, act(() => saveLog(L.quickLine(lv), '')), 'chip lv-' + lv))),
    h('div', { class: 'prompt' }, h('span', { class: 'ps', text: '~$' }), h('div', { class: 'pbox' }, ta, h('span', { class: 'kh', 'aria-hidden': 'true', text: '↵' })), run));
  $('#app').replaceChildren(
    h('header', { class: 'top', id: 'top' }), h('div', { class: 'mood', id: 'mood', hidden: true }), h('nav', { class: 'tabs', id: 'tabs' }), h('main', { id: 'view', class: 'view' }), dock,
    h('div', { id: 'modal-root' }), h('div', { id: 'toast', class: 'toast', role: 'status', hidden: true }), h('div', { id: 'boss', class: 'boss', hidden: true }));
  $('#view').addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if (S.dirty && !(a && $('#view').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) refresh();
  }, 200));
  buildBoss();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const b = $('#boss'); b.hidden = !b.hidden; } });
}
const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };

function buildBoss() {
  const data = [['Region', 'Q1', 'Q2', 'Q3', 'Q4'], ['APAC', '1,240', '1,310', '1,402', '1,468'], ['EMEA', '980', '1,020', '1,055', '1,101'], ['AMER', '1,610', '1,688', '1,730', '1,799'], ['Total', '3,830', '4,018', '4,187', '4,368']];
  $('#boss').append(h('div', { class: 'sheet' }, h('div', { class: 'sheet-title', text: 'Q3 Capacity Planning — Draft v4' }),
    h('table', {}, data.map((r, i) => h('tr', {}, r.map((c) => h(i === 0 ? 'th' : 'td', { text: c }))))), h('p', { class: 'sheet-foot', text: 'Esc 또는 클릭하면 돌아가요' })));
  $('#boss').addEventListener('click', () => { $('#boss').hidden = true; });
}

let sbClient = null;
async function getSb() {
  if (sbClient) return sbClient;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
  const { createClient } = await import('../vendor/supabase.js');
  sbClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  sbClient.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.cloud) boot(); });
  return sbClient;
}
async function fetchMember(sb, uid) {
  const { data, error } = await sb.from('members').select('role').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data;
}
async function boot({ sandbox = false } = {}) {
  teardown();
  S.sandbox = sandbox; S.ready = false; S.slow = false; S.store = null; S.care = null; S.prev = null; S.gate = null; S.cloud = false; S.sb = null;
  renderChrome(); renderView();
  let sb = null, member = null, user = null;
  if (!sandbox) {
    try {
      sb = await getSb();
      S.sb = sb; // 로그인 화면에서도 쓰므로 여기서 바로 저장한다
      if (sb) {
        const { data } = await withTimeout(sb.auth.getSession(), 8000).then((r) => r || { data: {} });
        user = data?.session?.user || null;
        if (!user) { S.gate = viewLogin; renderChrome(); renderView(); return; }
        member = await fetchMember(sb, user.id);
        if (!member) { S.email = user.email || ''; S.gate = viewDenied; renderChrome(); renderView(); return; }
      }
    } catch (e) { console.warn(e); S.gate = () => card('Connection failed', note('서버에 연결하지 못했어요. 인터넷을 확인하고 새로고침해 주세요.'), btn('Retry', () => boot(), 'primary small')); renderChrome(); renderView(); return; }
  }
  S.sb = sb; S.uid = member ? user.id : null; S.email = user?.email || '';
  S.store = createStore({ sb: member ? sb : null, uid: S.uid, localKey: sandbox ? 'svcmon.sandbox.v1' : 'svcmon.v1' });
  S.cloud = S.store.mode === 'cloud';
  S.role = S.cloud ? member.role : lsGet('svcmon.role', 'writer');
  S.tab = isWriter() ? 'console' : 'overview';
  refreshPush();

  const colls = [...SHARED, ...(isWriter() || !S.cloud ? ['@'] : [])];
  let loaded = 0;
  const slowT = setTimeout(() => { if (!S.ready) { S.slow = true; renderView(); } }, 10000);
  S.timers.push(slowT);
  colls.forEach((c) => {
    let first = true;
    S.unsubs.push(S.store.watch(c, () => {
      if (first) { first = false; loaded += 1; if (loaded >= colls.length) onReady(); }
      schedule();
    }, () => { S.slow = true; }));
  });
}

// ───────── 로그인 (허용된 두 계정만) ─────────
function viewLogin() {
  const email = h('input', { type: 'email', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, inputMode: 'email', placeholder: '이메일', 'aria-label': '이메일', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', autocapitalize: 'none', autocorrect: 'off', spellcheck: false, placeholder: '비밀번호', 'aria-label': '비밀번호', required: true });
  const show = h('input', { type: 'checkbox', on: { change: (e) => { pw.type = e.target.checked ? 'text' : 'password'; } } });
  const msg = h('p', { class: 'note', role: 'alert', text: '' });
  let busy = false;
  const go = async () => {
    if (busy) return;
    msg.textContent = '';
    const em = email.value.trim().toLowerCase();
    if (!em || !pw.value) { msg.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }
    busy = true; msg.textContent = '로그인 중…';
    try {
      const { error } = await S.sb.auth.signInWithPassword({ email: em, password: pw.value });
      if (error) {
        const code = error.code || '';
        msg.textContent = code === 'invalid_credentials' ? '이메일 또는 비밀번호가 맞지 않아요. (비밀번호 보기를 켜서 확인해 보세요)'
          : code === 'email_not_confirmed' ? '이메일 확인이 안 된 계정이에요. 관리자에게 알려 주세요.'
          : /fetch|network/i.test(error.message || '') || !error.status ? '서버에 연결하지 못했어요. 인터넷을 확인해 주세요.'
          : `로그인하지 못했어요. (${code || error.status})`;
        return;
      }
      await boot();
    } catch (e) { console.warn(e); msg.textContent = '로그인 중 문제가 생겼어요. 새로고침 후 다시 시도해 주세요.'; } finally { busy = false; }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } };
  email.addEventListener('keydown', onKey); pw.addEventListener('keydown', onKey);
  return h('div', { class: 'page' }, h('section', { class: 'card login' }, h('h3', { text: 'Sign in' }),
    email, pw, h('label', { class: 'opt' }, show, h('span', { text: 'Show password' })), msg,
    h('div', { class: 'row' }, btn('Try sandbox', () => boot({ sandbox: true }), 'small'), h('span', { class: 'sp' }), btn('Sign in', go, 'primary'))));
}
function viewDenied() {
  return h('div', { class: 'page' }, card('Access denied', note(`${S.email || '이 계정'} 은(는) 이 앱의 허용 목록에 없어요. 허용된 이메일로 다시 로그인해 주세요.`),
    btn('Sign out', act(logout), 'primary small')));
}
async function logout() {
  try { await Push.disablePush(S.sb); } catch { /* 알림 해제에 실패해도 로그아웃은 한다 */ }
  await S.sb.auth.signOut();
}

// ───────── Push 알림 ─────────
async function refreshPush() {
  S.push = S.cloud ? await Push.pushState() : 'local';
  // 켜 둔 적이 있는데 구독만 사라진 경우(업데이트·브라우저 정리 등) 허용이 남아 있으면 조용히 다시 켠다
  if (S.push === 'off' && lsGet('svcmon.push.want', false) && globalThis.Notification?.permission === 'granted') {
    try { await Push.enablePush(S.sb); S.push = await Push.pushState(); } catch (e) { console.warn('push restore', e); }
  }
  schedule();
  if (S.ready) renderChrome();
  if (S.push === 'on') { lsSet('svcmon.push.want', true); Push.enablePush(S.sb).catch((e) => console.warn('push sync', e)); } // 이 기기의 구독이 현재 계정 것으로 저장되게 맞춘다
}
function onReady() {
  S.ready = true; S.slow = false;
  renderChrome(); renderView(); bootSplash();
  gcOnce(); syncSoon(); Push.registerSW();
  S.timers.push(setInterval(() => { gcOnce(); schedule(); }, 60_000));
  scheduleIdle();
}
function teardown() {
  S.unsubs.forEach((u) => { try { u(); } catch { /* */ } }); S.unsubs = [];
  S.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); S.timers = [];
  clearTimeout(S.idleT);
}

// ───────── 렌더 ─────────
let rq = 0;
function schedule() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; refresh(); }); }
function refresh() {
  const a = document.activeElement;
  if (a && $('#view')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { S.dirty = true; renderChrome(); return; }
  S.dirty = false; renderChrome(); renderView(); syncSoon();
}
// 열어 둔 것(답글·새 아젠다·메모 입력칸, 아젠다 댓글, 펼친 로그·Syslog 글, 업데이트 내역, 해결된 아젠다·승인 내역 목록, 달력 기간 선택)은 다른 탭으로 옮겨 갈 때 모두 접는다. 시간으로는 접지 않는다.
function collapseAll() {
  S.replyOpen?.clear(); S.agOpen?.clear(); S.open?.clear(); S.sys?.open.clear();
  S.clOpen = {}; S.agHist = false; S.planHist = false;
  if (S.cal) { S.cal.end = null; S.cal.range = false; }
}
function go(tab, keep = false) { if (S.tab !== tab && !keep) collapseAll();
  S.tab = tab; renderChrome(); renderView(); $('#view').scrollTop = 0; if (tab === 'report') ensureReport(false); }

// ── 새 항목 알림: 탭 옆 빨간 숫자 (그 탭을 열면 사라짐, 기기별로 기억) ──
const seenKey = (tab) => `svcmon.seen.${S.sandbox ? 'sb' : S.cloud ? 'c' : 'l'}.${S.role}.${tab}`;
const seenAt = (tab) => lsGet(seenKey(tab), 0);
// 상대 기기의 시계가 이 기기보다 앞서 있으면 상대가 쓴 글의 시각(ts)이 '지금'보다 미래가 되어 읽음 처리해도 계속 새 글로 남는다. 읽음 시각은 상대 글 중 가장 늦은 시각까지 포함한다.
const latestOtherTs = () => { let m = 0; for (const c of ['posts', 'post_comments', 'comment_likes', 'reviews', 'review_replies', 'lines', 'commits', 'commit_replies', 'agendas', 'agenda_comments', 'plan_log', 'checkins', 'alerts']) for (const r of rows(c)) if ((r.by == null || r.by !== roleName()) && r.ts > m && r.ts < Date.now() + 864e5) m = r.ts; return m; };   // 하루 넘게 앞선 시각은 오류로 보고 무시
const seenNow = () => Math.max(Date.now(), latestOtherTs());
const markSeen = (tab) => { if (tab) lsSet(seenKey(tab), seenNow()); };
const newReviewTalk = (since) => rows('review_replies').filter((c) => c.by !== roleName() && c.ts > since).length + rows('comment_likes').filter((l) => l.on && l.lineId && l.by !== roleName() && l.ts > since).length;
function newCounts() {
  const now = Date.now();
  if (isWriter()) {
    const sIn = seenAt('inbox');
    return {
      inbox: (pendingCheckin() ? 1 : 0) + (sd('status').dnd ? 0 : rows('commits').filter((c) => (c.by || 'listener') === 'listener' && c.deliverAt <= now && c.deliverAt > sIn).length) + rows('commits').filter((c) => c.by === 'writer' && c.ackAt > sIn).length + rows('commit_replies').filter((r) => r.by !== 'writer' && r.ts > sIn).length + rows('reviews').filter((r) => r.ts > sIn).length + newReviewTalk(sIn) + (clUnread().length ? 1 : 0),
      syslog: newSyslog(),
      plan: planNeeds() + newAgendas(),
    };
  }
  return {
    overview: rows('alerts').filter((a) => !a.ackAt).length + (checkinToday()?.status === 'answered' && checkinToday().answeredAt > seenAt('overview') ? 1 : 0) + (clUnread().length ? 1 : 0),
    queue: rows('lines').filter((l) => l.ts > seenAt('queue')).length + newReviewTalk(seenAt('queue')),
    send: rows('commits').filter((c) => c.ackAt && (c.by || 'listener') === 'listener' && c.ackAt > seenAt('send')).length + rows('commits').filter((c) => c.by === 'writer' && c.ts > seenAt('send')).length + rows('commit_replies').filter((r) => r.by !== 'listener' && r.ts > seenAt('send')).length,
    syslog: newSyslog(),
    plan: planNeeds() + newAgendas(),
  };
}
// ───────── 알림창 (PC 에서만): 지금까지 상대가 한 일을 한 곳에 모아 보여주고, 누르면 그 자리로 이동한다 ─────────
// 알림 목록은 저장된 데이터(글·댓글·좋아요·아젠다·일정·공유 로그 등)에서 그때그때 만든다. 내용(원문·댓글 글자)은 싣지 않고 종류만 보여준다.
const pcMQ = globalThis.matchMedia ? matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)') : null;
const isPC = () => !!pcMQ?.matches;
pcMQ?.addEventListener?.('change', () => { if (!isPC()) closeNotif(); renderChrome(); });
function activityFeed() {
  if (!S.store || !S.ready) return [];
  const me = roleName(), now = Date.now(), out = [], other = (x) => x.by && x.by !== me;
  const add = (ts, tab, tag, text, extra = {}) => { if (ts) out.push({ id: `${extra.mood ? 'status' : tab}|${ts}|${text}|${extra.post || extra.agenda || extra.mood || extra.line || extra.commit || ''}`, ts, tab, tag, text, ...extra }); };   // id 는 지금 보는 탭과 상관없이 항상 같아야 '읽음'이 유지된다
  posts().filter(other).forEach((p) => add(p.ts, 'syslog', 'Syslog', 'New entry', { post: p.id }));
  rows('post_comments').filter(other).forEach((c) => add(c.ts, 'syslog', 'Syslog', c.ack ? 'Entry acknowledged' : 'Feedback received', { post: c.postId }));
  rows('comment_likes').filter((l) => l.on && l.by !== me && !l.lineId).forEach((l) => (l.commitId ? add(l.ts, isWriter() ? 'inbox' : 'send', isWriter() ? 'Inbox' : 'Send', 'Ack received', { commit: l.commitId }) : l.postId ? add(l.ts, 'syslog', 'Syslog', 'Ack received', { post: l.postId }) : add(l.ts, 'plan', 'Agenda', 'Ack received', { agenda: l.agendaId })));
  rows('commit_replies').filter(other).forEach((c) => add(c.ts, isWriter() ? 'inbox' : 'send', isWriter() ? 'Inbox' : 'Send', 'Feedback received', { commit: c.commitId }));
  rows('agendas').filter(other).forEach((a) => { add(a.ts, 'plan', 'Agenda', 'New agenda', { agenda: a.id }); if (a.resolvedAt) add(a.resolvedAt, 'plan', 'Agenda', 'Agenda resolved', { agenda: a.id }); });
  rows('agenda_comments').filter(other).forEach((c) => add(c.ts, 'plan', 'Agenda', 'Feedback received', { agenda: c.agendaId }));
  rows('plan_log').forEach((l) => {
    if (l.by !== me && l.status === 'pending') add(l.ts, 'plan', 'Plan', l.action === 'remove' ? 'Removal approval request' : 'New approval request');
    if (l.by === me && l.decidedAt && (l.status === 'approved' || l.status === 'rejected')) add(l.decidedAt, 'plan', 'Plan', `Schedule ${l.action === 'remove' ? 'removal ' : ''}${l.status === 'approved' ? 'approved' : 'rejected'}`);
  });
  const mood = sd('me_' + otherRole()); if (mood.ts && (mood.emoji || mood.text)) add(mood.ts, S.tab, 'Status', 'Status changed', { mood: 'status' });
  const rea = sd('react_' + otherRole()); if (rea.ts && rea.emoji) add(rea.ts, S.tab, 'Status', 'Ack received', { mood: 'react' });
  const rtab = isWriter() ? 'inbox' : 'queue', rtag = isWriter() ? 'Inbox' : 'Queue';
  rows('review_replies').filter(other).forEach((c) => add(c.ts, rtab, rtag, 'Feedback received', { line: c.lineId }));
  rows('comment_likes').filter((l) => l.on && l.lineId && l.by !== me).forEach((l) => add(l.ts, rtab, rtag, 'Ack received', { line: l.lineId }));
  if (isWriter()) {
    rows('reviews').forEach((r) => add(r.ts, 'inbox', 'Inbox', 'New review comment', { line: r.lineId }));
    if (!sd('status').dnd) rows('commits').filter((c) => (c.by || 'listener') === 'listener' && c.deliverAt <= now).forEach((c) => add(c.deliverAt, 'inbox', 'Inbox', 'New commit', { commit: c.id }));
    rows('commits').filter((c) => c.by === 'writer' && c.ackAt).forEach((c) => add(c.ackAt, 'inbox', 'Inbox', 'Your commit was read', { commit: c.id }));
    rows('checkins').filter((c) => c.status === 'asked').forEach((c) => add(c.ts, 'inbox', 'Inbox', 'Asked what is going on'));
  } else {
    rows('lines').forEach((l) => add(l.ts, 'queue', 'Queue', 'New shared log'));
    rows('alerts').forEach((x) => add(x.ts, 'overview', 'Overview', 'Care check received'));
    rows('commits').filter((c) => c.ackAt && (c.by || 'listener') === 'listener').forEach((c) => add(c.ackAt, 'send', 'Send', 'Your commit was deployed', { commit: c.id }));
    rows('commits').filter((c) => c.by === 'writer').forEach((c) => add(c.ts, 'send', 'Send', 'New commit', { commit: c.id }));
    rows('checkins').filter((c) => c.status === 'answered' && c.answeredAt).forEach((c) => add(c.answeredAt, 'overview', 'Overview', 'Feedback received'));
  }
  return out.sort((x, y) => y.ts - x.ts).slice(0, 100);
}
// 읽음: "모두 읽음" 을 누른 시각 이전 것은 모두 읽은 것, 그 뒤 것은 하나씩 눌러서(또는 눌러 이동해서) 읽음 처리한다
// 읽음 상태는 기기가 아니라 계정(역할)의 shared 문서(notif_<역할>)에 저장한다: PC 에서 읽으면 폰에서도 읽은 것으로 보인다
const notifDocId = () => 'notif_' + roleName();
const notifDoc = () => sd(notifDocId());
const notifBase = () => notifDoc().base || 0;
const notifRead = () => new Set(notifDoc().ids || []);
const isUnreadItem = (i, base, read) => i.ts > base && !read.has(i.id);
const saveNotif = (base, ids) => (S.store ? S.store.set('shared', notifDocId(), { kind: 'notif', v: 2, base, ids }).catch((e) => console.warn('notif read', e)) : null);
// 알림 문구가 바뀌면서(영어 → Feedback/Ack 말투) 알림 id 가 달라졌다: 계정마다 처음 한 번만 지금까지의 알림을 읽은 것으로 맞춘다
function migrateNotifIds() {
  if (!S.ready || !S.store || S.notifMig || notifDoc().v === 2) return;
  S.notifMig = true; markAllRead();
}
const notifUnread = () => { migrateNotifIds(); const base = notifBase(), read = notifRead(); return activityFeed().filter((i) => isUnreadItem(i, base, read)).length; };
function markRead(id) { const ids = [...new Set([...(notifDoc().ids || []), id])].slice(-300); saveNotif(notifBase(), ids); }
function markAllRead() { saveNotif(Math.max(notifBase(), seenNow()), []); }
function closeNotif() { S.notifOpen = false; $('#notif')?.remove(); }
function toggleNotif() { if (S.notifOpen) { closeNotif(); renderChrome(); return; } S.notifOpen = true; renderNotif(); renderChrome(); }
function renderNotif() {
  $('#notif')?.remove();
  const feed = activityFeed(), base = notifBase(), read = notifRead(), unread = feed.filter((i) => isUnreadItem(i, base, read)).length;
  const redo = () => { renderNotif(); renderChrome(); };
  const list = feed.length ? feed.map((i) => { const un = isUnreadItem(i, base, read);
    return h('div', { class: 'nt-row' },
      h('button', { type: 'button', class: 'nt-i' + (un ? ' new' : '') + (i.urgent ? ' urgent' : ''), on: { click: () => { markRead(i.id); openActivity(i); } } },
        h('span', { class: 'nt-t', text: mdhm(i.ts) }), h('span', { class: 'nt-g', text: i.tag }), h('span', { class: 'nt-m', text: i.text })),
      h('span', { class: 'nt-slot' }, un ? h('button', { type: 'button', class: 'btn small quiet ic nt-read', title: 'Mark as read', 'aria-label': 'Mark as read', on: { click: () => { markRead(i.id); redo(); } } }, icon('check')) : null)); })
    : [h('p', { class: 'empty', text: 'No alerts yet' })];
  const el = h('section', { id: 'notif', class: 'notif', role: 'dialog', 'aria-label': 'Alerts' },
    h('div', { class: 'nt-h' }, h('b', { text: 'Alerts' }), h('span', { class: 'sub', text: unread ? `${unread} unread` : 'all read' }), h('span', { class: 'sp' }),
      unread ? btn('Mark all read', () => { markAllRead(); redo(); }, 'small quiet') : null, btn('Close', () => { closeNotif(); renderChrome(); }, 'small quiet')),
    h('div', { class: 'nt-l' }, list), h('p', { class: 'nt-f', text: 'Shows the type only, never the content. Tap one to jump there and mark it read.' }));
  document.body.append(el);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.notifOpen) { closeNotif(); renderChrome(); } });
document.addEventListener('pointerdown', (e) => { if (S.notifOpen && !e.target.closest?.('#notif, .bell')) { closeNotif(); renderChrome(); } });
function openActivity(i) {
  closeNotif();
  collapseAll();   // 알림에서 이동할 때는 다 접은 뒤 그 항목만 연다
  if (i.post) { const st = sysState(); st.filter = 'all'; st.q = ''; st.open.add(i.post); st.read.add(i.post); }
  if (i.agenda) (S.agOpen ??= new Set()).add(i.agenda);
  go(i.tab, true);
  if (i.mood) { i.mood === 'status' ? openTheirMood() : openTheirMood(); return; }
  setTimeout(() => {
    const el = i.commit ? document.querySelector(`[data-cid="${i.commit}"]`) : i.post ? document.querySelector(`[data-pid="${i.post}"]`) : i.agenda ? document.querySelector(`[data-aid="${i.agenda}"]`) : i.line ? document.querySelector(`[data-lid="${i.line}"]`) : null;
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('jump'); setTimeout(() => el.classList.remove('jump'), 1600); }
  }, 60);
}

const TABS_W = [['console', 'Console'], ['dash', 'Dashboard'], ['inbox', 'Inbox'], ['syslog', 'Syslog'], ['plan', 'Plan'], ['report', 'Report'], ['archive', 'Archive'], ['settings', 'Settings']];
const TABS_L = [['overview', 'Overview'], ['queue', 'Queue'], ['send', 'Send'], ['syslog', 'Syslog'], ['plan', 'Plan'], ['report', 'Report'], ['settings', 'Settings']];
function tabsFor(counts) {
  return (isWriter() ? TABS_W : TABS_L).map(([id, label]) => [id, label, counts[id] || 0]);
}
// 새로고침 버튼: 아직 반영되지 않은 새 버전이 있으면 지금 적용한다. 쓰던 글이 있으면 먼저 물어본다.
async function doRefresh() {
  const draft = () => [...document.querySelectorAll('#view input, #view textarea')].some((el) => !['checkbox', 'radio', 'search', 'file', 'button'].includes(el.type) && el.value && el.value !== el.defaultValue);
  const r = await refreshNow({ build: BUILD, beforeReload: () => (draft() ? new Promise((ok) => modal({ title: 'Refresh', body: note('새 버전이 있어요. 새로고침하면 쓰던 글이 사라져요. 지금 새로고침할까요?'), sticky: true,
    actions: [{ label: 'Cancel', cls: 'small', fn: () => ok(false) }, { label: 'Refresh', cls: 'primary', fn: () => ok(true) }] })) : true) });
  if (r === 'reloading') toast('새 버전을 적용하는 중…');
  else if (r === 'current') { S.updateReady = false; renderChrome(); toast('이미 최신 버전이에요'); }
  else if (r === 'offline') toast('서버에 연결하지 못했어요. 인터넷을 확인해 주세요.');
}
// 로고: 둥근 네모(위쪽이 옅은 두 톤) 안에 터미널 프롬프트 >_ . 고정 문자열만 사용
function logoMark() {
  const t = document.createElement('template');
  t.innerHTML = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24"><rect class="bg" x="2" y="2" width="20" height="20" rx="6"/><path class="hi" d="M2 8a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v1H2z"/><path class="fg" d="M7.5 11l3.2 2.8-3.2 2.8"/><path class="fg" d="M13 17h3.5"/></svg></span>';
  return t.content.firstChild;
}
function renderChrome() {
  const top = $('#top'), tabs = $('#tabs'), dock = $('#dock');
  if (!top) return;
  let counts = {};
  if (S.ready && S.store) {
    if (S.tab === 'syslog') { if (S.sysSince == null) S.sysSince = seenAt('syslog'); } else S.sysSince = null;   // Syslog 에 들어온 순간의 '마지막으로 본 시각'을 기억해 두었다가, 그 뒤 글에 NEW 표시를 단다
    if (S.tab === 'plan') { if (S.planSince == null) S.planSince = seenAt('plan'); } else S.planSince = null;
    if (S.tab === 'inbox' || S.tab === 'queue') { if (S.revSince == null) S.revSince = seenAt(S.tab); } else S.revSince = null;   // 리뷰 답글·좋아요의 NEW 표시도 같은 방식
    markSeen(S.tab);
    counts = newCounts();
    if (S.prev) for (const [t, label] of (isWriter() ? TABS_W : TABS_L)) if (t !== S.tab && (counts[t] || 0) > (S.prev[t] || 0)) toast(`${label}: 새 항목이 있어요`);
    S.prev = counts;
    const total = Object.values(counts).reduce((x, y) => x + y, 0);
    document.title = (total ? `(${total}) ` : '') + 'Service Monitor — prod-api-02';
  }
  const wr = isWriter();
  const lvl = S.store ? (wr ? metrics().level : (statusToday().level || 'green')) : 'green';
  top.replaceChildren(
    h('div', { class: 'brand' }, logoMark(), h('b', { text: 'Monitor' }), h('span', { class: 'env', text: 'prod-api-02' })),
    h('div', { class: 'right' },
      S.store && isPC() ? h('button', { type: 'button', class: 'btn ghost small ic bell', title: 'Alerts', 'aria-label': 'Alerts', 'aria-expanded': String(!!S.notifOpen), on: { click: toggleNotif } }, icon('inbox'), notifUnread() ? h('span', { class: 'cnt', text: notifUnread() > 99 ? '99+' : notifUnread() }) : null) : null,
      S.store ? notifyBtn() : null,
      btn('↻', doRefresh, 'ghost small refresh' + (S.updateReady ? ' has-update' : ''), { title: S.updateReady ? 'Refresh · new version available' : 'Refresh', 'aria-label': 'Refresh' }),
      btn('?', openHelp, 'ghost small', { title: 'Guide', 'aria-label': 'Guide' }),
      S.store ? h('span', { class: 'live ' + lvl, title: L.STATUS_TEXT[lvl], text: { green: 'healthy', yellow: 'degraded', red: 'outage' }[lvl] }) : null,
      S.store ? h('span', { class: 'mode', text: S.sandbox ? 'sandbox' : S.cloud ? 'shared' : 'local' }) : null));
  tabs.replaceChildren(...(S.store ? tabsFor(counts) : []).map(([id, label, n]) => h('button', { type: 'button', class: 'tab t-' + id + (S.tab === id ? ' on' : ''), on: { click: () => go(id) } }, label, n ? h('span', { class: 'cnt', text: n }) : null)));
  dock.hidden = !(S.ready && wr && S.tab === 'console' && S.canWrite);
  renderMood();
  if (S.notifOpen) { if (isPC()) renderNotif(); else closeNotif(); }
}
// ───────── 내 현재 상태(이모지): 상단 줄에 나와 상대의 상태가 보이고, 바뀌면 상대에게 알려준다 ─────────
// 맨 윗줄은 지금 하는 일(행동), 아래는 지금 기분(감정). 너무 세세한 상태는 두지 않는다.
const MOODS_ACTIVITY = [['💻', '집중'], ['🍚', '식사'], ['🚇', '이동'], ['☕', '휴식']];
const MOODS_FEELING = [['🙂', '평온'], ['😄', '신남'], ['😌', '안도'], ['😮‍💨', '지침'], ['😡', '화남'], ['😢', '우울'], ['😰', '불안'], ['🤒', '아픔']];
const otherRole = () => (isWriter() ? 'listener' : 'writer');
const moodDoc = (role) => sd('me_' + role);
const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const saveMood = (emoji, text) => S.store.set('shared', 'me_' + roleName(), { emoji, text, ts: Date.now() });
const MOOD_INFO = new Map([...MOODS_ACTIVITY.map(([e, l]) => [e, { label: l, kind: 'act' }]), ...MOODS_FEELING.map(([e, l]) => [e, { label: l, kind: 'feel' }])]);
const short = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
// 프로필 상태처럼: 동그란 이모지(행동은 강조색 테두리, 감정은 따뜻한 색 테두리) + 이름 + 상태 + 경과 시간
const REACTIONS = ['👍', '❤️', '😢', '😡', '💪', '🙏'];
const reactDoc = (role) => sd('react_' + role);
// 그 사람의 반응이 "지금 그 상태"에 대한 것일 때만 보인다 (상태가 바뀌면 이전 반응은 사라진다)
const reactOn = (role, statusTs) => { const r = reactDoc(role); return statusTs && r.emoji && r.to === statusTs ? r.emoji : ''; };
function moodChip(d, { name, me, isNew, title, onClick, react }) {
  const info = MOOD_INFO.get(d.emoji), has = !!(d.emoji || d.text);
  return h('button', { type: 'button', class: `mchip ${me ? 'me' : 'they'} ${has ? info?.kind || 'act' : 'empty'}${isNew ? ' new' : ''}`, title, on: { click: onClick } },
    h('span', { class: 'mav' }, h('span', { class: 'me-e', text: d.emoji || (me ? '＋' : '·') }), react ? h('span', { class: 'mreact', text: react, title: me ? '1 reacted' : '0 reacted' }) : null),
    h('span', { class: 'mbody' }, h('span', { class: 'mk' }, name, has && d.ts ? h('span', { class: 'ago', text: ` · ${short(d.ts)}` }) : null), h('span', { class: 'mt', text: has ? d.text || info?.label || '' : me ? 'Set status' : 'Not set' })),
    isNew ? h('span', { class: 'ndot', 'aria-label': '새 상태' }) : null);
}
function renderMood() {
  const box = $('#mood'); if (!box) return;
  if (!S.ready || !S.store) { box.hidden = true; return; }
  const me = moodDoc(roleName()), they = moodDoc(otherRole());
  if (S.prevMood == null) S.prevMood = they.ts || 0; // 처음 열 때는 알리지 않고 기준만 잡는다
  else if ((they.ts || 0) > S.prevMood) { S.prevMood = they.ts; toast(`Status changed ${they.emoji || ''}`.trim()); }
  const isNew = (they.ts || 0) > seenAt('mood');
  const theirR = reactDoc(otherRole()), onMe = reactOn(otherRole(), me.ts);
  if (S.prevReact == null) S.prevReact = theirR.ts || 0;
  else if ((theirR.ts || 0) > S.prevReact) { S.prevReact = theirR.ts; if (onMe) toast(`Ack received ${onMe}`); }
  box.hidden = false;
  // 접어 두면 이 기기 화면에서만 가려진다(상대에게는 그대로 보이고, 새 상태가 오면 점으로만 알려 준다)
  const folded = lsGet('svcmon.mood.fold', false), foldAt = lsGet('svcmon.mood.foldAt', 0);
  const fold = (v) => () => { lsSet('svcmon.mood.fold', v); if (v) lsSet('svcmon.mood.foldAt', seenNow()); renderMood(); };   // 점은 "접은 뒤에" 상대가 상태를 바꾸거나 반응했을 때만
  box.classList.toggle('folded', folded);
  // 접고 펴는 줄은 항상 맨 위 가운데(좌우 대칭): 접어도 펴도 같은 자리
  const handle = h('button', { type: 'button', class: 'mfold', title: folded ? 'Show status bar' : 'Hide status bar', 'aria-label': folded ? 'Show status bar' : 'Hide status bar', 'aria-expanded': String(!folded), on: { click: fold(!folded) } },
    icon(folded ? 'chevD' : 'chevU'), h('span', { class: 'ml', text: 'Status' }), folded && ((they.ts || 0) > foldAt || ((theirR.ts || 0) > foldAt && onMe)) ? h('span', { class: 'ndot', 'aria-label': 'New' }) : null);
  if (folded) { box.replaceChildren(handle); return; }
  box.replaceChildren(handle,
    moodChip(me, { name: '0', me: true, title: 'Set status 0', onClick: openMood, react: onMe }),
    moodChip(they, { name: '1', me: false, isNew, title: 'Status 1', onClick: openTheirMood, react: reactOn(roleName(), they.ts) }));
}
function openMood() {
  const cur = moodDoc(roleName()); let pick = cur.emoji || '';
  const text = h('input', { type: 'text', maxLength: 20, placeholder: '한마디 (선택) 예: 회의 중, 9시 이후 가능', value: cur.text || '' });
  const opt = ([e, l]) => h('button', { type: 'button', class: 'mopt' + (e === pick ? ' on' : ''), title: l, on: { click: (ev) => { if (e !== pick) text.value = ''; pick = e; body.querySelectorAll('.mopt').forEach((b) => b.classList.toggle('on', b === ev.currentTarget)); } } }, h('span', { class: 'me-e', text: e }), h('small', { text: l }));
  const body = h('div', { class: 'share' },
    h('div', { class: 'mlab', text: 'Activity' }), h('div', { class: 'mgrid' }, MOODS_ACTIVITY.map(opt)),
    h('div', { class: 'mlab', text: 'Mood' }), h('div', { class: 'mgrid' }, MOODS_FEELING.map(opt)),
    h('div', { class: 'msgrow' }, text, btn('×', () => { text.value = ''; text.focus(); }, 'small', { title: 'Clear message', 'aria-label': 'Clear message' })));
  modal({ title: 'Status 0', body,
    actions: [{ label: 'Clear', cls: 'small danger', fn: () => saveMood('', '') }, { label: 'Cancel', cls: 'small' }, { label: 'Save', cls: 'primary', fn: () => saveMood(pick, text.value.trim()) }] });
}
function openTheirMood() {
  const t = moodDoc(otherRole()); markSeen('mood');
  const has = !!(t.emoji || t.text), mine = reactOn(roleName(), t.ts);
  const rbtn = (e) => h('button', { type: 'button', class: 'ropt' + (mine === e ? ' on' : ''), title: e, on: { click: act(async () => {
    await S.store.set('shared', 'react_' + roleName(), { emoji: mine === e ? '' : e, to: t.ts, ts: Date.now() });
    close(); toast(mine === e ? 'Ack removed' : 'Ack sent');
  }) } }, e);
  const body = has ? h('div', { class: 'their' }, h('div', { class: 'big', text: t.emoji || '·' }), t.text ? h('p', { class: 'msgtext', text: t.text }) : null, h('p', { class: 'sub', text: `갱신 ${ago(t.ts)}` }),
    h('div', { class: 'reactrow' }, h('div', { class: 'mlab', text: 'React' }), h('div', { class: 'rgrid' }, REACTIONS.map(rbtn)))) : note('아직 상태를 정하지 않았어요.');
  const close = modal({ title: 'Status 1', body, actions: [{ label: 'Close', cls: 'primary' }] });
  schedule();
}

// 화면을 다시 그릴 때 쓰던 글(아직 보내지 않은 입력)이 지워지지 않게, 새 입력칸에 되돌려 준다. 탭을 옮기면 되돌리지 않는다.
const DRAFT_SEL = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]),textarea,select';
const fieldKey = (el, i) => el.id || `${el.tagName}.${el.type || ''}.${el.placeholder || ''}.${i}`;
function snapshotDrafts(root) {
  const m = new Map();
  root.querySelectorAll(DRAFT_SEL).forEach((el, i) => { if (el.tagName === 'SELECT' ? true : el.value !== '' && el.value !== el.defaultValue) m.set(fieldKey(el, i), el.value); });
  return m;
}
function restoreDrafts(root, m) {
  if (!m.size) return;
  root.querySelectorAll(DRAFT_SEL).forEach((el, i) => {
    const k = fieldKey(el, i); if (!m.has(k)) return; const v = m.get(k);
    if (el.tagName === 'SELECT') { if ([...el.options].some((o) => o.value === v)) el.value = v; } else if (el.value === '') el.value = v;
  });
}
// 입력칸의 글을 보낼 때: 먼저 비우고 보낸다(보내는 사이 화면이 다시 그려져도 보낸 글이 되살아나지 않게). 실패하면 되돌려 놓는다.
async function sendField(el, send) {
  const t = el.value.trim(); if (!t) return false;
  const id = el.id; el.value = '';
  try { await send(t); if (id && document.activeElement?.id === id) { S.dirty = false; renderView(); renderChrome(); document.getElementById(id)?.focus(); } return true; } catch (e) { const cur = (id && document.getElementById(id)) || el; if (!cur.value) cur.value = t; throw e; }
}
function renderView() {
  closeMenu();
  const view = $('#view'); if (!view) return;
  const keepTop = view.scrollTop;
  const drafts = view.dataset.tab === S.tab ? snapshotDrafts(view) : new Map();
  let node;
  if (S.gate) node = S.gate();
  else if (!S.ready) node = card('Connecting…', note(S.slow ? '연결이 늦어지고 있어요. 잠시 뒤에도 안 되면 새로고침해 주세요.' : 'prod-api-02 에 연결하는 중…'));
  else {
    const banners = [];
    if (S.updateReady) banners.push(h('div', { class: 'banner warn upd' }, h('span', { text: '앱이 업데이트됐어요. 새로고침해 주세요.' }), btn('Refresh', doRefresh, 'small primary')));   // 열려 있던 앱에 새 버전을 알린다
    if (isWriter() && S.tab !== 'inbox' && pendingCheckin()) banners.push(h('div', { class: 'banner warn' }, h('span', { text: '상대가 무슨 일 있는지 물어봤어요.' }), btn('Reply', () => openCheckinReply(pendingCheckin()), 'small primary')));
    if (!S.canWrite) banners.push(h('div', { class: 'banner warn', text: '읽기 전용이에요. 쓰려면 소유자가 "편집 가능(Contributor)"으로 초대해야 해요.' }));
    if (clUnread().length) banners.push(h('div', { class: 'banner' }, h('span', { text: `What's new · ${clUnread().length} updates` }), h('span', { class: 'row' }, btn('See', () => go(isWriter() ? 'inbox' : 'overview'), 'small'), btn('Confirm all', () => clConfirm(CHANGELOG.map((e) => e.id)), 'small quiet'))));
    if (S.sandbox) banners.push(h('div', { class: 'banner', text: '체험 모드: 이 기기에만 저장되고 상대에게 전달되지 않아요.' }, btn('Exit', () => boot(), 'small')));
    else if (!S.cloud) banners.push(h('div', { class: 'banner', text: '혼자 쓰는 모드: 공유 저장소에 연결되지 않아 이 기기에만 저장돼요.' }));
    else if (S.push === 'need-install') banners.push(h('div', { class: 'banner', text: '홈 화면에 추가하면 앱이 꺼져 있어도 알림을 받을 수 있어요.' }, btn('How to', openInstall, 'small')));
    const V = isWriter() ? VW : VL;
    node = h('div', { class: 'page' }, banners, (V[S.tab] || V[Object.keys(V)[0]])());
  }
  view.replaceChildren(node);
  view.dataset.tab = S.tab; restoreDrafts(view, drafts);
  if (S.ready && isWriter() && S.tab === 'console') { renderLog(); view.scrollTop = view.scrollHeight; } else view.scrollTop = keepTop;
}

// ───────── 작성자: 콘솔 ─────────
function logRow(l) {
  const open = S.open.has(l.id);
  const clickable = !l.idle && !l.pending;
  const row = h('div', { class: `ln lv-${l.level}${String(l.code).startsWith('OK_') ? ' pos' : ''}${l.idle ? ' idle' : ''}${l.special ? ' fx' : ''}${l.pending ? ' pend' : ''}`, on: clickable ? { click: () => { S.open.has(l.id) ? S.open.delete(l.id) : S.open.add(l.id); renderLog(); } } : {} },
    h('span', { class: 'ts', text: hms(l.ts) }), h('span', { class: 'lv', text: l.level }), h('span', { class: 'svc', text: l.service }),
    h('span', { class: 'code', text: `[${l.code}]` }), h('span', { class: 'msg', text: l.msg }), l.sharedId ? h('span', { class: 'tag', text: 'shared' }) : null);
  row.dataset.id = l.id;
  if (!open || !clickable) return row;
  return h('div', { class: 'ln-wrap' }, row, h('div', { class: 'ln-detail' },
    h('div', { class: 'raw' }, h('span', { class: 'k', text: 'raw (private)' }), h('span', { text: l.raw || '(quick entry)' })),
    h('div', { class: 'row' },
      l.sharedId ? btn('Unshare', act(() => unshareLine(l)), 'small') : btn('Share log', () => openShare(l), 'small'),
      moreMenu([{ label: 'Edit', icon: 'edit', fn: () => openReclass(l) }, { label: 'Delete', icon: 'trash', danger: true, fn: act(() => deleteLog(l)) }]))));
}
// ───────── 터미널 효과: tail -f 처럼 새 줄은 글자가 찍히며 올라오고 잠깐 밝게 깜박인다 ─────────
const reduceFx = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function tailFx(box, shown) {
  const ids = shown.map((l) => l.id);
  if (!S.logSeen) { S.logSeen = new Set(ids); return; }                                   // 처음 그릴 때(탭을 열 때)는 효과 없이 보여준다
  const fresh = shown.filter((l) => !S.logSeen.has(l.id) && !l.pending);
  ids.forEach((id) => S.logSeen.add(id));
  if (reduceFx()) return;
  fresh.slice(-3).forEach((l) => {
    const row = box.querySelector(`.ln[data-id="${l.id}"]`); if (!row) return;
    row.classList.add('tailnew'); setTimeout(() => row.classList.remove('tailnew'), 1300);
    const m = row.querySelector('.msg'); if (!m) return; const text = m.textContent; m.textContent = '';
    const step = Math.max(1, Math.ceil(text.length / 22)); let i = 0;
    const t = setInterval(() => { i += step; m.textContent = text.slice(0, i); if (i >= text.length) clearInterval(t); }, 18);
  });
}
const progressBar = (pct) => { const n = Math.round(pct / 10); return `parsing ${'█'.repeat(n)}${'░'.repeat(10 - n)} ${pct}%`; };
// 로그인 직후 잠깐 부팅 로그가 올라간다
function bootSplash() {
  if (S.bootShown || reduceFx()) return; S.bootShown = true;
  const lines = ['[  OK  ] auth session restored', '[  OK  ] connected to prod-api-02', '[  OK  ] sync store ready', '[  OK  ] services nominal'];
  const el = h('div', { class: 'boot-log' }, h('pre', {}));
  const pre = el.firstChild; document.body.append(el);
  lines.forEach((t, i) => setTimeout(() => { pre.textContent += (i ? '\n' : '') + t; }, i * 160));
  setTimeout(() => el.classList.add('out'), lines.length * 160 + 260); setTimeout(() => el.remove(), lines.length * 160 + 700);
}
function renderLog() {
  const box = $('#loglist'); if (!box) return;
  const f = S.filter.trim().toLowerCase();
  let list = [...todayLogs(), ...S.idle, ...S.pending].filter((l) => l.ts >= S.viewFrom).sort((a, b) => a.ts - b.ts);
  if (f) list = list.filter((l) => `${l.level} ${l.service} ${l.code} ${l.msg} ${l.raw || ''}`.toLowerCase().includes(f));
  const view = $('#view');
  const stick = view.scrollHeight - view.scrollTop - view.clientHeight < 90;
  const shown = list.slice(-300);
  box.replaceChildren(...(list.length ? shown.map(logRow) : [empty(f ? 'no match' : 'No entries yet. 아래 입력창에 한 줄만 적으면 돼요.')]));
  tailFx(box, shown);
  if (stick) view.scrollTop = view.scrollHeight;
}
function viewConsole() {
  const m = meta();
  const wrap = h('div', { class: 'console' });
  if (!m.introSeen) {
    wrap.append(card('Welcome', note(S.cloud
      ? '여기에 적은 원문은 내 비공개 영역에만 저장돼요. 이 앱 화면에서는 상대가 볼 수 없어요. 내가 "공유"를 누른 줄만 상대에게 가고, 공유하면 원문도 함께 보여요. 매일 새벽 4시에 그날 것이 자동으로 정리되고, 내 기록은 Archive 탭에 날짜별로 남아요.'
      : '여기에 적은 내용은 이 기기에만 저장돼요. 매일 새벽 4시에 그날 것이 자동으로 정리되고, 기록은 Archive 탭에 날짜별로 남아요.'),
    btn('OK', act(() => setMeta({ introSeen: true })), 'primary small')));
  }
  if (S.care) {
    wrap.append(h('div', { class: 'care' }, h('b', { text: '많이 힘든 것 같아서 한마디만 남겨요.' }),
      h('p', { text: '혼자 버티지 않아도 돼요. 자살예방 상담전화 109 · 정신건강 위기상담 1577-0199' }),
      h('p', { class: 'sub', text: S.care.sent ? '상대에게 "안부 확인" 신호가 갔어요. 내용은 전달되지 않아요.' : '위험 신호 알림이 꺼져 있어서 상대에게는 아무것도 가지 않았어요.' }),
      btn('Close', () => { S.care = null; schedule(); }, 'small')));
  }
  wrap.append(h('div', { class: 'toolbar' },
    h('input', { id: 'grep', class: 'grep', type: 'search', placeholder: 'grep…', value: S.filter, on: { input: (e) => { S.filter = e.target.value; renderLog(); } } }),
    btn('restart', () => openRestart(), 'ghost small'),
    btn('clear', () => { S.viewFrom = Date.now(); S.idle = []; renderLog(); }, 'ghost small')),
  h('div', { id: 'loglist', class: 'loglist' }));
  return wrap;
}
function scheduleIdle() {
  clearTimeout(S.idleT);
  S.idleT = setTimeout(() => {
    if (isWriter() && S.tab === 'console' && !document.hidden && S.ready) { S.idle.push({ id: 'i' + uid(), ts: Date.now(), ...L.idleLine() }); if (S.idle.length > 25) S.idle.shift(); renderLog(); }
    scheduleIdle();
  }, 4000 + Math.random() * 6000);
}

async function onSubmit() {
  const ta = $('#cmd'); const text = ta.value.trim();
  if (!text) return;
  ta.value = ''; autoGrow(ta);
  if (text.startsWith('/')) return runCmd(text);
  await addLog(text);
}
function runCmd(t) {
  const [c, ...a] = t.slice(1).split(/\s+/); const arg = a.join(' ');
  if (c === 'grep') { S.filter = arg; if (S.tab !== 'console') go('console'); else { $('#grep').value = arg; renderLog(); } }
  else if (c === 'clear') { S.viewFrom = Date.now(); S.idle = []; renderLog(); }
  else if (c === 'restart') openRestart();
  else if (c === 'report') go('report');
  else if (c === 'status') go('dash');
  else if (c === 'help') toast('/grep 검색어 · /clear · /restart · /status · /report');
  else toast('unknown command: ' + c);
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function addLog(raw) {
  const risk = L.assessRisk(raw);
  const p = { id: 'p' + uid(), ts: Date.now(), level: 'INFO', service: 'log-ingest', code: 'PARSE', msg: 'parsing input…', pending: true };
  S.pending.push(p); renderLog();
  const iv = setInterval(() => { const m = document.querySelector(`#loglist .ln[data-id="${p.id}"] .msg`); if (m) m.textContent = progressBar(Math.min(92, Math.round((Date.now() - p.ts) / 6))); }, 60);
  try {
    const [tr] = await Promise.all([risk.flagged ? L.crisisLine() : L.translate(raw), reduceFx() ? null : sleep(550)]);
    await saveLog(tr, raw);
    if (risk.flagged) {
      const send = meta().alertOn !== false;
      if (send) await S.store.set('alerts', 'al_' + uid(), { ts: Date.now(), day: dayKey(), kind: 'care', ackAt: null });
      S.care = { sent: send && S.store.mode === 'cloud' };
    }
  } catch (e) { console.warn(e); toast(errText(e)); }
  finally { clearInterval(iv); S.pending = S.pending.filter((x) => x !== p); schedule(); }
}
async function saveLog(tr, raw) {
  const ts = Date.now();
  await S.store.set('@', 'log_' + uid(), { type: 'log', ts, day: dayKey(ts), raw: raw || '', level: tr.level, service: tr.service, code: tr.code, msg: tr.msg, cpu: tr.cpu, mem: tr.mem, disk: tr.disk, pos: tr.pos | 0 });
  syncSoon();
}
function openShare(l) {
  const line = L.fmtLine(l, hms(l.ts));
  const note = h('input', { type: 'text', maxLength: 60, placeholder: '상대에게 한마디 (선택) 예: 회의 때문에 힘들었어' });
  modal({ title: '이 로그를 상대에게 공유할까요?', body: h('div', { class: 'share' },
    h('div', { class: 'mono', text: line }),
    l.raw ? h('div', { class: 'gloss note-by' }, h('span', { class: 'k', text: 'Raw (shared too)' }), h('span', { text: l.raw })) : null,
    note,
    h('p', { class: 'note', text: l.raw ? '공유하면 위 한 줄과 원문, 한마디가 상대 화면에 그대로 보여요.' : '공유하면 위 한 줄과 한마디가 상대 화면에 보여요.' })),
  actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Share', cls: 'primary', fn: () => shareLine(l, note.value.trim()) }] });
}
// 자동 분류가 틀렸을 때 레벨(PASS/WARN/ERROR/FATAL)을 직접 고친다. 공유한 줄이면 상대 화면의 줄도 같이 바뀐다.
// 로그 수정: 원문(내가 쓴 글)을 고치면 이 기기 안의 규칙으로 다시 변환한다. 원문이 없는 빠른 입력은 변환된 문구를 고친다. 레벨은 따로 바꿀 수 있다.
function openReclass(l) {
  const hasRaw = !!l.raw;
  let raw = l.raw || '', msg = l.msg, level = l.level, auto = null, cur = null;   // auto: 원문을 고쳐 다시 변환한 결과, cur: 레벨을 따로 바꾼 결과 (미리 보여준 걸 그대로 저장한다)
  const prev = h('div', { class: 'mono' }), chips = h('div', { class: 'chips' });
  const ta = h('textarea', { rows: 3, maxLength: hasRaw ? 200 : 120, 'aria-label': hasRaw ? 'original' : 'message' });
  ta.value = hasRaw ? raw : msg;
  const base = () => ({ ...l, ...(auto || {}) });
  const fin = () => ({ ...(auto ? { ...auto, pos: auto.pos | 0, via: undefined } : {}), ...(cur || {}), ...(hasRaw ? {} : { msg }) });
  const draw = () => { const f = fin(); prev.className = 'mono lv-' + (f.level || l.level); prev.textContent = L.fmtLine({ ...l, ...f }, hms(l.ts)); };
  const paint = () => chips.replaceChildren(...L.LEVELS.map((v) => h('button', { type: 'button', class: 'schip lv-' + v + (v === level ? ' on' : ''), 'aria-pressed': String(v === level), on: { click: () => { level = v; cur = L.reclassify(base(), { level }); if (!hasRaw && cur) { msg = cur.msg; ta.value = msg; } paint(); draw(); } } }, v)));
  ta.addEventListener('input', () => {
    if (hasRaw) { raw = ta.value; if (raw.trim()) { auto = L.mockTranslate(raw); cur = null; level = auto.level; paint(); } }
    else msg = ta.value;
    draw();
  });
  paint(); draw();
  modal({ title: 'Edit log', body: h('div', { class: 'share' }, h('div', { class: 'mlab', text: hasRaw ? 'Original (private)' : 'Message' }), ta, h('div', { class: 'mlab', text: 'Result' }), prev, h('div', { class: 'mlab', text: 'Level' }), chips),
    actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Save', cls: 'primary', fn: async () => {
      const text = (hasRaw ? raw : msg).trim(); if (!text) return toast('내용을 적어주세요');
      const f = fin(); if (hasRaw ? (text === l.raw && !cur) : (!cur && text === l.msg)) return;
      const t = { ...f, ...(hasRaw ? { raw: text } : { msg: text }) };
      await S.store.patch('@', l.id, t);
      if (l.sharedId && S.store.get('lines', l.sharedId)) await S.store.patch('lines', l.sharedId, { level: t.level ?? l.level, text: L.fmtLine({ ...l, ...t }, hms(l.ts)), ...(hasRaw ? { raw: text } : {}) });
      syncSoon(); toast('로그를 고쳤어요');
    } }] });
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
}
async function shareLine(l, note = '', silent = false) {
  const sid = 'ln_' + uid();
  await S.store.set('lines', sid, { ts: l.ts, day: l.day, level: l.level, text: L.fmtLine(l, hms(l.ts)), note, raw: l.raw || '' });
  await S.store.patch('@', l.id, { sharedId: sid });
  if (!silent) toast(l.raw ? '공유했어요. 원문도 함께 보여요.' : '공유했어요.');
}
async function unshareLine(l) {
  for (const r of rows('review_replies').filter((r) => r.lineId === l.sharedId && r.by === roleName())) await S.store.del('review_replies', r.id);
  for (const r of rows('reviews').filter((r) => r.lineId === l.sharedId)) await S.store.del('reviews', r.id);
  await S.store.del('lines', l.sharedId);
  await S.store.patch('@', l.id, { sharedId: null });
}
async function deleteLog(l) {
  if (l.sharedId) await unshareLine(l);
  await S.store.del('@', l.id);
  S.open.delete(l.id); syncSoon();
}

// ───────── restart (호흡) ─────────
function openRestart() {
  let stop = false;
  const label = h('div', { class: 'rs-label', text: 'Restarting service…' });
  const hint = h('div', { class: 'rs-hint', text: '' });
  const fill = h('i', { style: 'width:0%' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const close = modal({ title: 'systemctl restart prod-api-02', sticky: true,
    body: h('div', { class: 'rs' }, label, h('div', { class: 'bar rs-bar' }, fill), hint),
    actions: [{ label: 'Abort', cls: 'small', fn: () => { stop = true; } }] });
  (async () => {
    const phases = [['Draining connections…', '숨을 천천히 들이쉬어요', 4, 100], ['Holding state…', '잠깐 멈춰요', 7, 100], ['Releasing resources…', '길게 내쉬어요', 8, 0]];
    for (let c = 0; c < 2 && !stop; c += 1) {
      for (const [lb, hn, sec, to] of phases) {
        if (stop) break;
        label.textContent = lb; hint.textContent = hn;
        fill.style.transition = `width ${sec}s linear`; fill.style.width = to + '%';
        await sleep(sec * 1000);
      }
    }
    if (stop) return;
    const today = dayKey(); const r = meta().relief?.day === today ? meta().relief : { cpu: 0, mem: 0 };
    await setMeta({ relief: { day: today, cpu: r.cpu + 10, mem: r.mem + 10 } });
    S.idle.push({ id: 'i' + uid(), ts: Date.now(), level: 'INFO', service: 'systemd', code: 'RESTART', msg: 'service restarted (cpu/mem -10%)', idle: true });
    close(); toast('restarted — CPU/MEM 이 조금 내려갔어요'); schedule(); renderLog();
  })().catch((e) => { console.warn(e); close(); });
}

// ───────── 작성자: 대시보드/인박스/리포트/설정 ─────────
const agoEn = (ts) => { const m = Math.floor((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
// ───────── 대시보드: 단순하게 — 상태 한 줄, 미터 셋(CPU·Cache·Disk), 오늘 개수 한 줄 ─────────
function viewDash() {
  const m = metrics(), logs = todayLogs(), last = logs.length ? Math.max(...logs.map((l) => l.ts)) : 0;
  const cpu = clamp(m.cpu + m.mem);   // 짜증(Irritation) + 피로(Fatigue)
  const cls = (v, hi = 80, mid = 50) => (v >= hi ? 'r' : v >= mid ? 'y' : 'g');
  const meter1 = (name, v, c) => h('div', { class: 'ds-m' }, h('div', { class: 'ds-mh' }, h('span', { text: name }), h('b', { text: v + '%' })), h('div', { class: 'ds-bar' }, h('i', { class: c, style: `width:${clamp(v)}%` })));
  return h('div', { class: 'db' }, h('section', { class: 'card ds-card' },
    h('div', { class: 'ds-hero st-' + m.level }, h('span', { class: 'ds-dot' }), h('div', {}, h('p', { class: 'ds-t', text: L.STATUS_TEXT[m.level] }), h('p', { class: 'ds-s', text: last ? 'last event ' + agoEn(last) : 'no events yet today' }))),
    meter1('CPU', cpu, cls(cpu)), meter1('Cache', clamp(m.pos), 'g'), meter1('Disk', clamp(m.disk), cls(clamp(m.disk), 85, 65)),
    h('div', { class: 'ds-line' }, [['o', m.PASS, 'pass'], ['w', m.WARN, 'warn'], ['e', (m.ERROR | 0) + (m.FATAL | 0), 'error']].map(([c, n, t]) => h('span', {}, h('b', { class: c, text: n | 0 }), t)))));
}

function keepBtn(text, from) {
  const kept = keeps().some((k) => k.from === from);
  return kept ? badge('⭐ good-things', 'ok') : btn('⭐ Keep', act(async () => { await S.store.set('@', 'keep_' + uid(), { type: 'keep', kind: 'good', ts: Date.now(), text, from }); toast('good-things 에 남겼어요. 퇴근해도 지워지지 않아요.'); }), 'small');
}
// 공유 로그의 리뷰 댓글 아래 답글: 작성자·리스너가 서로 답글을 달고 ♡ 를 누른다
const reviewReplies = (rid) => rows('review_replies').filter((c) => c.reviewId === rid).sort((a, b) => a.ts - b.ts);
// 댓글 한 줄(공용): 윗줄 = 시각·작성자·new/edited 표시(항상 여기) + 오른쪽 고정 칸(하트 | ⋯), 아랫줄 = 내용 전체 폭. 좁은 화면에서도 칸 위치가 줄마다 같다.
// 버튼이 없는 칸에도 같은 버튼을 투명하게 깔아 둔다: 어떤 테마·화면 폭에서도 빈 칸과 채워진 칸의 너비가 같아서 하트 위치가 줄마다 같다
const cmGhost = (label) => { const g = btn(label, () => {}, 'small quiet' + (label === 'More' ? ' more' : '')); g.classList.add('cm-ghost'); g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1; return g; };
function cmtRow({ cls = '', time, by, them, text, edited, isNew, like, extra, onEdit, onDel }) {
  return h('div', { class: 'cm ' + (them ? 'them' : 'me') + (cls ? ' ' + cls : '') },
    h('div', { class: 'cm-meta' }, h('span', { class: 'cm-t', text: time }), h('span', { class: 'cm-by' + (them ? ' them' : ''), text: by }), edited ? h('span', { class: 'b-ed', text: 'edited' }) : null, isNew || (like?.dataset?.newlike === '1' ? newTag(true) : null)),
    h('div', { class: 'cm-act' }, h('span', { class: 'cm-slot like' }, like || null), extra !== undefined ? h('span', { class: 'cm-slot xtra' }, extra || null) : null, h('span', { class: 'cm-slot more' }, onEdit || onDel ? moreMenu([onEdit ? { label: 'Edit', icon: 'edit', fn: onEdit } : null, onDel ? { label: 'Delete', icon: 'trash', danger: true, fn: act(onDel) } : null].filter(Boolean)) : cmGhost('More'))),
    h('div', { class: 'cm-text', text }));
}
// ── commit 주고받기: 리스너·작성자 모두 보낼 수 있고, 받은 commit 에는 답글과 하트를 남길 수 있다 ──
// 답글 입력칸은 Reply 버튼을 눌러야 열린다 (열린 칸은 화면을 다시 그려도 유지, 보내거나 Cancel/Esc 로 닫힘)
function replyArea(key, box, send, label = 'Reply', sendLabel = 'Send') {   // 입력칸은 버튼을 눌러야 열린다 (답글·새 아젠다·댓글 모두 같은 방식)
  S.replyOpen ??= new Set();
  const close = () => { S.replyOpen.delete(key); renderView(); };
  if (!S.replyOpen.has(key)) return h('div', { class: 'row' }, btn(label, () => { S.replyOpen.add(key); renderView(); document.getElementById(box.id)?.focus(); }, 'small'));
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return h('div', { class: 'row' }, box, btn(sendLabel, send, 'small primary'), btn('Cancel', close, 'small'));
}
const commitReplies = (id) => rows('commit_replies').filter((r) => r.commitId === id).sort((a, b) => a.ts - b.ts);
// 답글은 commit 을 받은 쪽(view 'in')만 쓴다. 보낸 쪽(view 'out')은 받은 사람의 답글을 읽기만 한다 (재답장 없음)
function commitThread(c, view) {
  const me = roleName();
  const box = h('input', { type: 'text', maxLength: 200, placeholder: 'reply', id: 'cr-' + c.id, enterkeyhint: 'send', autocomplete: 'off' });
  const send = act(async () => { if (await sendField(box, (t) => S.store.set('commit_replies', 'cr_' + uid(), { commitId: c.id, by: me, text: t, ts: Date.now(), day: dayKey() }))) { S.replyOpen.delete('cr-' + c.id); renderView(); } });
  onEnter(box, send);
  const list = commitReplies(c.id);
  if (view !== 'in' && !list.length) return null;
  return h('div', { class: 'sl-thread rv-thread' },
    list.map((r) => cmtRow({ time: hm(r.ts), by: `by ${r.by === me ? '0' : '1'}`, them: r.by !== me, text: r.text, edited: r.editedAt, like: likeBtn(r, { commitId: c.id }, me),
      onEdit: r.by === me ? () => editText({ title: 'Edit reply', text: r.text, max: 200, onSave: (t) => S.store.patch('commit_replies', r.id, { text: t, editedAt: Date.now() }) }) : null, onDel: r.by === me ? () => S.store.del('commit_replies', r.id) : null })),
    view === 'in' ? replyArea('cr-' + c.id, box, send) : null);
}
// view: 'in' = 내가 받은 commit(확인·하트·답글), 'out' = 내가 보낸 commit(상태·예약 취소·삭제·상대의 답글)
function commitItem(c, view) {
  const me = roleName(), sender = c.by || 'listener', now = Date.now(), co = { ...c, by: sender };
  const head = h('div', { class: 'ih' }, h('span', { class: 'sha', text: (view === 'out' ? 'sent ' : 'commit ') + c.sha }), h('span', { class: 'sub', text: hm(c.deliverAt || c.ts) }),
    view === 'out' ? (c.deliverAt > now ? badge('Scheduled ' + mdhm(c.deliverAt)) : c.ack ? badge(sender === 'listener' ? 'deployed ✓' : 'read ✓', 'ok') : badge('delivered')) : null);
  const ackLabel = sender === 'listener' ? 'Deployed ✓' : 'Got it';
  const actions = view === 'in'
    ? h('div', { class: 'row' }, c.ack ? badge((sender === 'listener' ? 'deployed ✓ ' : 'read ✓ ') + hm(c.ackAt), 'ok') : btn(ackLabel, act(() => S.store.patch('commits', c.id, { ack: true, ackAt: Date.now() })), 'small primary'), likeBtn(co, { commitId: c.id }, me), sender === 'listener' ? keepBtn(c.text, c.id) : null)
    : h('div', { class: 'row' }, likeBtn(co, { commitId: c.id }, me), moreMenu([c.deliverAt > now ? { label: 'Cancel scheduled', icon: 'reject', danger: true, fn: act(() => S.store.del('commits', c.id)) } : { label: 'Delete', icon: 'trash', danger: true, fn: () => modal({ title: '이 메시지를 삭제할까요?', body: note('답글과 하트도 함께 사라져요.'), actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Delete', cls: 'primary', fn: act(() => S.store.del('commits', c.id)) }] }) }]));
  return h('div', { class: 'item', 'data-cid': c.id }, head, h('p', { class: 'msgtext', text: c.text }), actions, commitThread(c, view));
}
const commitComposer = (id, title, extra) => card(title, h('textarea', { id, rows: 2, maxLength: 200, placeholder: 'commit message' }), extra);
// 공유 로그의 리뷰 코멘트 한 줄(리스너가 쓰고 작성자가 읽는다): 답글 줄과 같은 모양(시각·작성자·내용, 오른쪽 고정 버튼 칸)
function reviewRow(ln, r, role) {
  const mine = role === 'listener';
  return h('div', { class: 'rv' }, cmtRow({ time: hm(r.ts), by: `by ${mine ? '0' : '1'}`, them: !mine, text: r.text, edited: r.editedAt, like: likeBtn({ ...r, by: 'listener' }, { lineId: ln.id }, role), extra: !mine ? keepBtn(r.text, r.id) : null,
    onEdit: mine ? () => editText({ title: 'Edit comment', text: r.text, max: 140, onSave: (t) => S.store.patch('reviews', r.id, { text: t, editedAt: Date.now() }) }) : null, onDel: mine ? () => S.store.del('reviews', r.id) : null }), reviewThread(ln, r));
}
function reviewThread(ln, r) {
  const me = roleName(), fresh = (x, by) => by !== me && x.ts > (S.revSince ?? Infinity);
  const box = h('input', { type: 'text', maxLength: 200, placeholder: 'reply', id: 'rr-' + r.id, enterkeyhint: 'send', autocomplete: 'off' });
  const send = act(async () => { if (await sendField(box, (t) => S.store.set('review_replies', 'rr_' + uid(), { reviewId: r.id, lineId: ln.id, by: me, text: t, ts: Date.now(), day: dayKey() }))) { S.replyOpen.delete('rr-' + r.id); renderView(); } });
  onEnter(box, send);
  return h('div', { class: 'sl-thread rv-thread' },
    reviewReplies(r.id).map((c) => cmtRow({ cls: fresh(c, c.by) ? 'fresh' : '', time: hm(c.ts), by: `by ${c.by === me ? '0' : '1'}`, them: c.by !== me, text: c.text, edited: c.editedAt, isNew: newTag(fresh(c, c.by)), extra: null, like: likeBtn(c, { lineId: ln.id }, me),
      onEdit: c.by === me ? () => editText({ title: 'Edit reply', text: c.text, max: 200, onSave: (t) => S.store.patch('review_replies', c.id, { text: t, editedAt: Date.now() }) }) : null, onDel: c.by === me ? () => S.store.del('review_replies', c.id) : null })),
    replyArea('rr-' + r.id, box, send));
}
function viewInbox() {
  const now = Date.now(), dnd = sd('status').dnd;
  const cm = rows('commits').filter((c) => (c.by || 'listener') === 'listener' && c.deliverAt <= now).sort((a, b) => b.deliverAt - a.deliverAt);
  const lines = [...rows('lines')].sort((a, b) => b.ts - a.ts).map((ln) => [ln, rows('reviews').filter((r) => r.lineId === ln.id).sort((a, b) => a.ts - b.ts)]).filter(([, rv]) => rv.length);
  const kp = keeps();
  return h('div', { class: 'grid' }, checkinCardW(), updatesCard(),
    card('Commits', dnd ? note('Do not disturb 가 켜져 있어요. 도착한 메시지는 끌 때까지 숨겨져요.')
      : cm.length ? cm.map((c) => commitItem(c, 'in')) : empty('새 커밋 없음')),
    commitComposer('wcm-text', 'Send commit', h('div', { class: 'row' }, btn('Commit', act(async () => {
      if (!$('#wcm-text').value.trim()) return toast('메시지를 적어주세요');
      await sendField($('#wcm-text'), (t) => S.store.set('commits', 'cm_' + uid(), { by: 'writer', ts: Date.now(), day: dayKey(), deliverAt: Date.now(), text: t, sha: uid().slice(-7), ack: false, ackAt: null }));
    }), 'primary'))),
    rows('commits').some((c) => c.by === 'writer') ? card('Sent', ...rows('commits').filter((c) => c.by === 'writer').sort((a, b) => b.ts - a.ts).map((c) => commitItem(c, 'out'))) : null,
    card('Code review', lines.length ? lines.map(([ln, rv]) => h('div', { class: 'item', 'data-lid': ln.id }, h('div', { class: 'mono', text: ln.text }), rv.map((r) => reviewRow(ln, r, 'writer')))) : empty('리뷰 댓글 없음')),
    card('Good things', kp.filter((k) => k.kind === 'good').length ? kp.filter((k) => k.kind === 'good').map((k) => h('div', { class: 'item' }, h('p', { class: 'msgtext', text: k.text }), h('div', { class: 'row' }, h('span', { class: 'sub', text: mdhm(k.ts) }), moreMenu([{ label: 'Delete', icon: 'trash', danger: true, fn: act(() => S.store.del('@', k.id)) }])))) : empty('아직 없음'),
      kp.some((k) => k.kind === 'learned') ? h('div', { class: 'learned' }, h('b', { text: 'Learned today' }), kp.filter((k) => k.kind === 'learned').slice(0, 7).map((k) => h('p', { class: 'msgtext', text: `${k.day} · ${k.text}` }))) : null),
    updateHistoryCard());
}

// ───────── Plan: 공유 달력 (작성자·리스너 공통) ─────────
const KINDS = { overtime: '야근', dinner: '회식', trip: '출장', meet: '약속', vacation: '휴가', etc: '기타' };
const CATCOL = { overtime: '#9a3b3b', dinner: '#8f6420', trip: '#3b5f9a', meet: '#3f7a52', vacation: '#6b4f95', etc: '#5b6573', custom: '#5b6573' };
const CATICON = {
  overtime: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  dinner: '<path d="M8 3h8l-1 7a3 3 0 0 1-6 0z"/><path d="M12 13v7M9 20h6"/>',
  trip: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M9 7V5h6v2"/>',
  meet: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  vacation: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  etc: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
};
const catIcon = (k) => { const t = document.createElement('template'); t.innerHTML = `<svg class="ci" viewBox="0 0 24 24" aria-hidden="true">${CATICON[k]}</svg>`; return t.content.firstChild; }; // 고정 문자열만 사용
const roleName = () => (isWriter() ? 'writer' : 'listener');
const p2 = (n) => String(n).padStart(2, '0');
const fmtMD = (k) => `${+k.slice(5, 7)}/${+k.slice(8, 10)}`;
const planRange = (l) => fmtMD(l.date) + (l.endDate ? '~' + fmtMD(l.endDate) : '');
const planText = (l) => `${planRange(l)} ${l.label} ${l.action === 'add' ? '추가' : '삭제'}`;
const calState = () => (S.cal ??= { y: new Date().getFullYear(), m: new Date().getMonth(), sel: dayKey() });
function planNeeds() { return rows('plan_log').filter((l) => l.status === 'pending' && l.by !== roleName()).length; }
const newAgendas = () => rows('agendas').filter((a) => a.status === 'open' && a.by !== roleName() && a.ts > seenAt('plan')).length + rows('agenda_comments').filter((c) => c.by !== roleName() && c.ts > seenAt('plan')).length + rows('comment_likes').filter((l) => l.on && l.agendaId && l.by !== roleName() && l.ts > seenAt('plan')).length;
const otherName = () => '상대';

async function addEvent({ date, endDate, kind, label, memo }) {
  const eid = 'ev_' + uid(), now = Date.now(), end = endDate && endDate > date ? endDate : null;
  await S.store.set('events', eid, { date, endDate: end, kind, label, memo: memo || '', by: roleName(), state: 'pending', ts: now });
  await S.store.set('plan_log', 'pl_' + uid(), { eventId: eid, action: 'add', by: roleName(), ts: now, status: 'pending', date, endDate: end, label, memo: memo || '' });
  return eid;
}
async function removeEvent(e) {
  const mine = e.by === roleName(), now = Date.now();
  const pend = rows('plan_log').find((l) => l.eventId === e.id && l.status === 'pending');
  if (e.state === 'pending' && mine) {
    if (pend) await S.store.patch('plan_log', pend.id, { status: 'cancelled', decidedAt: now, decidedBy: roleName() });
    await S.store.del('events', e.id);
    return;
  }
  if (e.state !== 'approved') return;
  await S.store.patch('events', e.id, { state: 'removing' });
  await S.store.set('plan_log', 'pl_' + uid(), { eventId: e.id, action: 'remove', by: roleName(), ts: now, status: 'pending', date: e.date, endDate: e.endDate || null, label: e.label, memo: e.memo || '' });
}
async function decidePlan(l, ok) {
  const now = Date.now();
  await S.store.patch('plan_log', l.id, { status: ok ? 'approved' : 'rejected', decidedAt: now, decidedBy: roleName() });
  if (!rows('events').some((e) => e.id === l.eventId)) return;
  if (l.action === 'add') { if (ok) await S.store.patch('events', l.eventId, { state: 'approved', approvedAt: now }); else await S.store.del('events', l.eventId); }
  else if (ok) await S.store.del('events', l.eventId);
  else await S.store.patch('events', l.eventId, { state: 'approved' });
}

function calendarCard() {
  const c = calState(), today = dayKey(), evs = rows('events'), endKey = c.end && c.end > c.sel ? c.end : null;
  const first = new Date(c.y, c.m, 1), dim = new Date(c.y, c.m + 1, 0).getDate(), off = first.getDay(); // 일요일 시작
  const cells = [];
  for (let i = 0; i < off; i += 1) cells.push(h('div', { class: 'cd x' }));
  for (let d = 1; d <= dim; d += 1) {
    const key = `${c.y}-${p2(c.m + 1)}-${p2(d)}`;
    const es = evs.filter((e) => e.date <= key && key <= (e.endDate || e.date));
    const inRange = endKey && key >= c.sel && key <= endKey;
    // 날짜를 누르면 그 하루를 고른다. Range 를 켠 뒤에 이 날보다 뒤의 날을 누르면 기간(끝 날짜)이 된다.
    const pick = () => { if (c.range && key > c.sel) { c.end = key; c.range = false; } else { c.sel = key; c.end = null; c.range = false; } renderView(); };
    cells.push(h('button', { type: 'button', class: 'cd' + (key === today ? ' today' : '') + (key === c.sel ? ' sel' : '') + (inRange ? ' rg' : ''), on: { click: pick } },
      h('b', { text: String(d) }),
      es.slice(0, 3).map((e) => h('span', { class: `ev${e.state === 'approved' ? '' : ' pend'}${e.state === 'removing' ? ' rem' : ''}`, style: `--c:${CATCOL[e.kind] || CATCOL.etc}`, text: e.label })),
      es.length > 3 ? h('span', { class: 'more', text: '+' + (es.length - 3) }) : null));
  }
  const move = (n) => () => { const t = new Date(c.y, c.m + n, 1); c.y = t.getFullYear(); c.m = t.getMonth(); renderView(); };
  return card('Shared calendar',
    h('div', { class: 'row' }, h('b', { text: `${c.y}년 ${c.m + 1}월` }), h('span', { class: 'sp' }),
      btn('<', move(-1), 'small', { 'aria-label': '이전 달' }), btn('Today', () => { const n = new Date(); c.y = n.getFullYear(); c.m = n.getMonth(); c.sel = dayKey(); c.end = null; c.range = false; renderView(); }, 'small'), btn('>', move(1), 'small', { 'aria-label': '다음 달' })),
    h('div', { class: 'cal' }, ['일', '월', '화', '수', '목', '금', '토'].map((t) => h('div', { class: 'ch', text: t })), cells),
    dayPanel());   // 고른 날의 일정과 등록은 달력 바로 아래에서 (멀리 스크롤하지 않게)
}
// 되돌리기 버튼이 있는 안내 (일정을 추가한 직후 몇 초 동안)
function toastUndo(msg, label, fn) {
  const t = $('#toast'); if (!t) return;
  t.replaceChildren(h('span', { text: msg }), h('button', { type: 'button', class: 'toast-act', on: { click: () => { t.hidden = true; clearTimeout(toastT); fn(); } } }, label));
  t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 6000);
}
function dayPanel() {
  const c = calState(), key = c.sel, endKey = c.end && c.end > key ? c.end : null;
  const es = rows('events').filter((e) => e.date <= key && key <= (e.endDate || e.date)).sort((a, b) => a.ts - b.ts);
  const stBadge = (e) => (e.state === 'approved' ? badge('approved', 'ok') : e.state === 'removing' ? badge('Delete pending', 'warn') : badge('Pending', 'warn'));
  const rangeText = fmtMD(key) + (endKey ? '~' + fmtMD(endKey) : '');
  // 종류를 한 번 누르면 바로 추가된다 (메모는 입력칸에 적어 두었으면 함께, 기타는 입력칸의 글자가 이름). 방금 추가한 건 Undo 로 취소.
  const add = (id) => act(async () => {
    const box = $('#cal-memo'), txt = (box?.value || '').trim();
    let label = KINDS[id], memo = txt.slice(0, 40);
    if (id === 'etc') { label = txt.slice(0, 12); memo = ''; if (!label) { toast('기타는 이름을 적고 눌러 주세요'); S.replyOpen.add('cal-memo'); renderView(); $('#cal-memo')?.focus(); return; } }
    const eid = await addEvent({ date: key, endDate: endKey, kind: id, label, memo });
    if (box) box.value = '';
    S.replyOpen?.delete('cal-memo'); c.end = null; c.range = false; renderView();
    toastUndo(`Added ${rangeText} ${label}`, 'Undo', act(async () => { const e = S.store.get('events', eid); if (e) await removeEvent(e); renderView(); }));
  });
  const memoOpen = (S.replyOpen ??= new Set()).has('cal-memo');   // 메모 입력칸도 버튼을 눌러야 열린다
  const memoBox = h('input', { id: 'cal-memo', type: 'text', maxLength: 40, placeholder: '메모 (선택) · 기타는 이름', enterkeyhint: 'done', autocomplete: 'off' });
  memoBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { S.replyOpen.delete('cal-memo'); renderView(); } });
  const memoRow = memoOpen ? h('div', { class: 'row' }, memoBox, btn('Cancel', () => { S.replyOpen.delete('cal-memo'); renderView(); }, 'small'))
    : h('div', { class: 'row' }, btn('Memo', () => { S.replyOpen.add('cal-memo'); renderView(); $('#cal-memo')?.focus(); }, 'small'));
  return h('div', { class: 'daypanel' },
    h('div', { class: 'dp-head' }, h('b', { text: rangeText }), h('span', { class: 'sub', text: c.range ? 'Tap the last day' : '' }), h('span', { class: 'sp' }),
      btn('Range', () => { c.range = !c.range; renderView(); }, 'small quiet' + (c.range ? ' on' : ''))),
    es.length ? es.map((e) => h('div', { class: 'prow' },
      h('span', { class: 'sp' }, h('b', { text: e.label }), e.memo ? h('span', { class: 'sub', text: ' · ' + e.memo }) : null, h('span', { class: 'sub', text: ` · by ${e.by === roleName() ? '0' : '1'}${e.endDate ? ' · ~' + fmtMD(e.endDate) : ''}` })),
      stBadge(e),
      (e.state === 'approved' || (e.state === 'pending' && e.by === roleName())) ? btn(e.state === 'approved' ? 'Request delete' : 'Cancel', act(() => removeEvent(e)), 'small danger') : null)) : empty('이 날은 비어 있어요'),
    memoRow,
    h('div', { class: 'cat' }, Object.entries(KINDS).map(([id, t]) => h('button', { type: 'button', class: 'catb', style: `--c:${CATCOL[id]}`, on: { click: add(id) } }, catIcon(id), t))));
}
function planChangesCard() {
  const me = roleName(), logs = rows('plan_log').sort((a, b) => b.ts - a.ts);
  const needs = logs.filter((l) => l.status === 'pending' && l.by !== me), mine = logs.filter((l) => l.status === 'pending' && l.by === me);
  const done = logs.filter((l) => l.status !== 'pending').sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0)).slice(0, 40);
  const who = (l) => `by ${l.by === me ? '0' : '1'}`;
  const el = card(`Changes${needs.length ? ` (${needs.length} to review)` : ''}`,
    needs.length ? needs.map((l) => h('div', { class: 'prow need' }, h('span', { class: 'sp' }, h('b', { text: planText(l) }), h('span', { class: 'sub', text: ` · ${who(l)} · ${mdhm(l.ts)}${l.memo ? ' · ' + l.memo : ''}` })),
      btn('Approve', act(() => decidePlan(l, true)), 'small'), btn('Reject', act(() => decidePlan(l, false)), 'small'))) : empty('확인할 변경사항 없음'),
    mine.length ? [h('h4', { text: 'Waiting for approval' }), mine.map((l) => h('div', { class: 'prow' }, h('span', { class: 'sp' }, h('b', { text: planText(l) }), h('span', { class: 'sub', text: ' · ' + mdhm(l.ts) })), badge('pending', 'warn')))] : null,
    done.length ? [
      btn(S.planHist ? 'Hide history' : `Show history (${done.length})`, () => { S.planHist = !S.planHist; renderView(); }, 'small quiet block'),
      S.planHist ? [done.map((l) => h('div', { class: 'prow' }, h('span', { class: 'sp' }, h('b', { text: planText(l) }), h('span', { class: 'sub', text: ` · ${who(l)} · ${l.decidedAt ? mdhm(l.decidedAt) : ''}${l.status === 'cancelled' ? ' 취소' : l.decidedBy === me ? ' 내가 처리' : ''}` })),
        badge(l.status === 'approved' ? 'approved' : l.status === 'rejected' ? 'rejected' : 'cancelled', l.status === 'approved' ? 'ok' : '')))] : null] : null);
  if (needs.length) el.classList.add('span-all');   // 승인할 게 있으면 맨 위에 전체 폭으로
  return el;
}
// ── Weekly Agenda: 승인 없이 각자 등록. 등록한 사람만 삭제하거나 "해결"할 수 있고, 해결하면 기록에 남는다 ──
const agendas = () => rows('agendas');
const addAgenda = (text) => S.store.set('agendas', 'ag_' + uid(), { text, by: roleName(), ts: Date.now(), status: 'open' });
const resolveAgenda = (a) => S.store.patch('agendas', a.id, { status: 'resolved', resolvedAt: Date.now() });
const removeAgenda = (a) => S.store.del('agendas', a.id);
const agComments = (id) => rows('agenda_comments').filter((c) => c.agendaId === id).sort((a, b) => a.ts - b.ts);
const addAgComment = (a, text) => S.store.set('agenda_comments', 'ac_' + uid(), { agendaId: a.id, by: roleName(), text, ts: Date.now() });
const AGICON = {
  open: '<path d="M6 21V4"/><path d="M6 4h11.5l-2.8 4.2 2.8 4.2H6z" fill="currentColor" fill-opacity=".16"/>',   // 깃발 (책갈피=Keep, 동그라미 ✓=Resolve 와 겹치지 않게)
  done: '<path d="M6 21V4"/><path d="M6 4h11.5l-2.8 4.2 2.8 4.2H6z" fill="currentColor" fill-opacity=".42"/>',
};
const agIcon = (k) => { const t = document.createElement('template'); t.innerHTML = `<svg class="agi ${k}" viewBox="0 0 24 24" aria-hidden="true">${AGICON[k]}</svg>`; return t.content.firstChild; }; // 고정 문자열만 사용
function agendaCard() {
  const me = roleName();
  const who = (a) => `by ${a.by === me ? '0' : '1'}`;
  const open = agendas().filter((a) => a.status === 'open').sort((a, b) => a.ts - b.ts);
  const solved = agendas().filter((a) => a.status === 'resolved').sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));
  const redraw = () => renderView();
  const opened = (S.agOpen ??= new Set());
  const add = act(async () => {
    const el = $('#ag-text');
    if (!el.value.trim()) return toast('아젠다를 한 줄 적어주세요');
    if (await sendField(el, addAgenda)) { S.replyOpen?.delete('ag-new'); renderView(); }
  });
  const input = h('input', { id: 'ag-text', type: 'text', maxLength: 60, placeholder: '아젠다 한 줄 (예: 휴가 일정 정하기)', enterkeyhint: 'send', autocomplete: 'off' });
  onEnter(input, add);
  const confirmDelete = (a) => modal({ title: '이 아젠다를 삭제할까요?', body: note(`"${a.text}" 은(는) 댓글과 함께 기록 없이 사라져요. 해결된 것으로 남기려면 "Resolve"를 눌러 주세요.`),
    actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Delete', cls: 'primary', fn: act(() => removeAgenda(a)) }] });
  // 댓글: 작성자·리스너 둘 다 달 수 있다. 내 댓글만 지울 수 있다.
  const thread = (a, canAdd) => {
    const list = agComments(a.id);
    const box = h('input', { type: 'text', maxLength: 120, placeholder: 'Write a comment', id: 'agc-' + a.id, enterkeyhint: 'send', autocomplete: 'off' });
    const send = act(async () => { if (await sendField(box, (t) => addAgComment(a, t))) { S.replyOpen?.delete('agc-' + a.id); renderView(); } });
    onEnter(box, send);
    return h('div', { class: 'ag-thread' },
      list.length ? list.map((c) => cmtRow({ time: mdhm(c.ts), by: `by ${c.by === me ? '0' : '1'}`, them: c.by !== me, text: c.text, edited: c.editedAt, isNew: newTag(c.by !== me && c.ts > (S.planSince ?? Infinity)), like: likeBtn(c, { agendaId: a.id }, me),
        onEdit: c.by === me ? () => editText({ title: 'Edit comment', text: c.text, max: 200, onSave: (t) => S.store.patch('agenda_comments', c.id, { text: t, editedAt: Date.now() }) }) : null, onDel: c.by === me ? () => S.store.del('agenda_comments', c.id) : null }))
        : h('p', { class: 'empty', text: 'No comments yet' }),
      canAdd ? replyArea('agc-' + a.id, box, send) : null);
  };
  // 댓글 버튼(말풍선 아이콘 + 개수): 개수가 있든 없든 버튼 폭이 같아야 옆의 Resolve·Edit·Delete 위치가 줄마다 같다 (개수 자리를 항상 비워 둔다)
  const cmtBtn = (n, fn, on) => { const b = btn('Comment', fn, 'small quiet cm-open' + (on ? ' on' : '')); b.setAttribute('aria-label', 'Comments'); b.append(h('span', { class: 'cm-n', text: n ? String(n) : '' })); return b; };
  const item = (a, kind) => {
    const n = agComments(a.id).length, isOpen = opened.has(a.id);
    return h('div', { 'data-aid': a.id, class: 'ag-wrap ' + kind },
      h('div', { class: 'ag-item ' + kind }, agIcon(kind),
        h('div', { class: 'ag-body' }, h('span', { class: 'ag-t', text: a.text }, a.editedAt ? h('span', { class: 'b-ed', text: ' edited' }) : null, newTag(a.by !== me && a.ts > (S.planSince ?? Infinity))),
          h('span', { class: 'sub', text: kind === 'done' ? `${who(a)} · ${a.resolvedAt ? 'resolved ' + mdhm(a.resolvedAt) : ''}` : `${who(a)} · ${mdhm(a.ts)}` }),
          h('div', { class: 'ag-act' },
            cmtBtn(n, () => { isOpen ? opened.delete(a.id) : opened.add(a.id); redraw(); }, isOpen),
            kind === 'open' && a.by === me ? [btn('Resolve', act(() => resolveAgenda(a)), 'small quiet'), moreMenu([{ label: 'Edit', icon: 'edit', fn: () => editText({ title: 'Edit agenda', text: a.text, max: 60, onSave: (t) => S.store.patch('agendas', a.id, { text: t, editedAt: Date.now() }) }) }, { label: 'Delete', icon: 'trash', danger: true, fn: () => confirmDelete(a) }])] : null))),
      isOpen ? thread(a, kind === 'open') : null);
  };
  return h('section', { class: 'card agenda' },
    h('h3', { text: 'Weekly Agenda' }),
    open.length ? h('div', { class: 'ag-list' }, open.map((a) => item(a, 'open'))) : empty('No agenda yet'),
    replyArea('ag-new', input, add, 'New agenda', 'Add'),
    solved.length ? [
      btn(S.agHist ? 'Hide resolved' : `Show resolved (${solved.length})`, () => { S.agHist = !S.agHist; redraw(); }, 'small quiet block'),
      S.agHist ? [h('div', { class: 'ag-list' }, solved.map((a) => item(a, 'done')))] : null] : null);
}
function viewPlanW() {
  return h('div', { class: 'grid' }, planChangesCard(), agendaCard(), calendarCard());   // 확인할 변경이 있는 카드를 맨 위에
}

// ───────── Archive (작성자: 날짜별 기록 보관함) ─────────
function viewArchive() {
  const A = (S.arch ??= { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null, raw: false });
  const byDay = {};
  logsAll().forEach((l) => (byDay[l.day] ??= []).push(l));
  const days = Object.keys(byDay).sort();
  const sel = A.sel || days[days.length - 1] || dayKey();
  const first = new Date(A.y, A.m, 1), dim = new Date(A.y, A.m + 1, 0).getDate(), off = first.getDay(); // 일요일 시작
  const cells = [];
  for (let i = 0; i < off; i += 1) cells.push(h('div', { class: 'cd x' }));
  for (let d = 1; d <= dim; d += 1) {
    const key = `${A.y}-${p2(A.m + 1)}-${p2(d)}`, ls = byDay[key];
    let dot = null;
    if (ls) { const st = L.statFromLogs(ls); dot = h('span', { class: 'adot ' + L.levelOf(st.cpu, st.mem, st.FATAL) }); }
    cells.push(h('button', { type: 'button', class: 'cd short' + (key === dayKey() ? ' today' : '') + (key === sel ? ' sel' : ''), on: { click: () => { A.sel = key; renderView(); } } }, h('b', { text: String(d) }), dot));
  }
  const move = (n) => () => { const t = new Date(A.y, A.m + n, 1); A.y = t.getFullYear(); A.m = t.getMonth(); renderView(); };
  const ls = (byDay[sel] || []).slice().sort((a, b) => a.ts - b.ts);
  const st = L.statFromLogs(ls);
  const detail = card(`${fmtMD(sel)} Log`,
    ls.length ? [note(`${ls.length} lines · WARN ${st.WARN | 0} · ERROR ${st.ERROR | 0} · FATAL ${st.FATAL | 0}`),
      h('div', { class: 'row' }, btn(A.raw ? 'Hide all raw' : 'Show all raw', () => { A.raw = !A.raw; renderView(); }, 'small' + (A.raw ? ' primary' : ''))),
      ls.map((l) => {
        const open = S.open.has(l.id);
        const row = h('div', { class: `ln lv-${l.level}${String(l.code).startsWith('OK_') ? ' pos' : ''}`, on: { click: () => { open ? S.open.delete(l.id) : S.open.add(l.id); renderView(); } } },
          h('span', { class: 'ts', text: hms(l.ts) }), h('span', { class: 'lv', text: l.level }), h('span', { class: 'svc', text: l.service }), h('span', { class: 'code', text: `[${l.code}]` }), h('span', { class: 'msg', text: l.msg }));
        return open ? h('div', { class: 'ln-wrap' }, row, h('div', { class: 'ln-detail' }, h('div', { class: 'raw' }, h('span', { class: 'k', text: 'raw (private)' }), h('span', { text: l.raw || '(quick entry)' })), h('div', { class: 'row' }, moreMenu([{ label: 'Delete', icon: 'trash', danger: true, fn: act(() => deleteLog(l)) }])))) : A.raw ? h('div', { class: 'ln-wrap' }, row, h('div', { class: 'ln-rawline' }, '↳ ' + (l.raw || '(quick entry)'))) : row;
      }),
      h('div', { class: 'row' }, btn('Delete all for this day', () => modal({ title: `${fmtMD(sel)} 기록을 모두 지울까요?`, body: note('지운 기록은 복구되지 않아요. 통계 숫자는 남아요.'), actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Delete', cls: 'primary', fn: act(async () => { for (const l of ls) await deleteLog(l); }) }] }), 'small danger'))]
      : empty('이 날은 기록이 없어요'));
  return h('div', { class: 'grid' },
    card('Archive',
      h('div', { class: 'row' }, h('b', { text: `${A.y}년 ${A.m + 1}월` }), h('span', { class: 'sp' }), btn('<', move(-1), 'small', { 'aria-label': '이전 달' }), btn('>', move(1), 'small', { 'aria-label': '다음 달' })),
      h('div', { class: 'cal' }, ['일', '월', '화', '수', '목', '금', '토'].map((t) => h('div', { class: 'ch', text: t })), cells)),
    detail);
}


// ── 리포트 (작성자·리스너 공용, 집계 숫자만 사용) ──
async function ensureReport(force) {
  const s = L.weekSummary(weekRows());
  const sig = weekKey() + JSON.stringify(s.tot);
  if (!force && S.rep.sig === sig) return;
  S.rep = { sig, lines: null, busy: true }; schedule();
  const lines = L.templateReport(s);
  S.rep = { sig, lines, busy: false }; schedule();
}
// 주간 보고: 단순하게 — 한 줄 요약(사고 수·가장 나빴던 날), 날마다 막대 하나, 조언 한 줄
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function reportCard() {
  const s = L.weekSummary(weekRows()), f = L.reportFacts(s), map = new Map(s.days.map((d) => [d.day, d])), today = dayKey(), days = weekDays();
  const inc = (r) => (r ? (r.ERROR | 0) + (r.FATAL | 0) : 0), max = Math.max(1, ...days.map((d) => inc(map.get(d))));
  const peak = s.peakDay && s.incidents ? DOW_EN[new Date(s.peakDay + 'T12:00:00').getDay()] : null;
  // 요일마다 한 줄: 요일 · 대시보드 미터와 같은 가는 막대(길이 = 사고 수, 색 = 그날 가장 나쁜 단계) · 개수
  const bars = h('div', { class: 'rp3' }, days.map((d, i) => {
    const r = map.get(d), n = inc(r), fut = d > today, worst = r ? ['FATAL', 'ERROR', 'WARN', 'PASS'].find((lv) => (r[lv] | 0) > 0) : null, fatal = r ? r.FATAL | 0 : 0;
    const c = worst === 'FATAL' || worst === 'ERROR' ? 'r' : worst === 'WARN' ? 'y' : 'g';
    const w = n ? Math.max(6, Math.round(n / max * 100)) : worst === 'WARN' ? 8 : worst === 'PASS' ? 4 : 0;
    const txt = n ? String(n) + (fatal ? ` · ${fatal} fatal` : '') : worst ? '0' : fut ? '' : '–';
    return h('div', { class: 'rp3-r' + (d === today ? ' t' : '') + (fut ? ' fut' : ''), title: r ? `${d.slice(5)} · ${L.LEVELS.map((lv) => `${lv} ${r[lv] | 0}`).join(' · ')}` : `${d.slice(5)} · ${fut ? 'upcoming' : 'no data'}` },
      h('span', { class: 'rp3-d', text: DOW_EN[(i + 1) % 7] }), h('div', { class: 'ds-bar' }, w ? h('i', { class: c, style: `width:${w}%` }) : null), h('span', { class: 'rp3-n' + (fatal ? ' f' : ''), text: txt }));
  }));
  const head = s.incidents ? `${s.incidents} incident${s.incidents === 1 ? '' : 's'} this week` : (s.days.length ? 'No incidents this week' : 'No records this week');
  const c = card('Weekly report', h('div', { class: 'rp2' }, h('p', { class: 'rp2-h', text: head }), h('p', { class: 'rp2-s', text: (peak ? `Worst day: ${peak} · ` : '') + 'Week of ' + fmtMD(weekKey()) }), bars,
    f ? h('p', { class: 'rp2-adv ' + f.advice.tone, text: f.advice.text }) : null));
  c.classList.add('rpt-card');
  return c;
}
const viewReport = () => h('div', { class: 'grid' }, reportCard());

// ── 업데이트 소식: 앱을 고칠 때마다 changelog.js 에 적어두면 작성자·리스너 화면에서 볼 수 있고, 글로 복사해 보낼 수도 있다 ──
const clAcked = () => { const a = lsGet('svcmon.cl.ack', null), old = lsGet('svcmon.seen.cl', ''); return new Set([...(Array.isArray(a) ? a : []), ...CHANGELOG.filter((e) => old && e.id <= old).map((e) => e.id)]); };   // 확인한 소식 id (예전 '읽음 시점' 기록도 이어받는다)
const clUnread = () => { const a = clAcked(); return CHANGELOG.filter((e) => !a.has(e.id)); };
const clConfirm = (ids) => { lsSet('svcmon.cl.ack', [...new Set([...clAcked(), ...ids])]); renderView(); renderChrome(); };
const clItems = (e) => h('div', { class: 'cl-list' }, e.items.map(([k, t]) => h('div', { class: 'cl-row' }, h('span', { class: 'cl-tag cl-' + k, text: k }), h('span', { text: t }))));
// 받는 쪽(Inbox·Overview)용: 접었다 펼 수 있는 항목. 오른쪽 read 표시를 누르면 확인 처리(칸이 회색으로 흐려짐), 한 번 더 누르면 되돌린다.
const clSetAck = (id, on) => { const a = clAcked(); on ? a.add(id) : a.delete(id); lsSet('svcmon.cl.ack', [...a]); lsSet('svcmon.seen.cl', ''); renderView(); renderChrome(); };
const clFold = (e, history) => {
  const acked = clAcked().has(e.id), key = (history ? 'h:' : 'u:') + e.id, open = (S.clOpen ??= {})[key] ?? (!history && !acked);
  return h('div', { class: 'item cl' + (acked ? ' acked' : '') },
    h('div', { class: 'cl-head' },
      h('button', { type: 'button', class: 'cl-toggle', 'aria-expanded': String(open), on: { click: () => { S.clOpen[key] = !open; renderView(); } } },
        h('span', { class: 'cl-caret' }, icon(open ? 'chevD' : 'chevR')), h('span', { class: 'sha', text: e.date }), h('span', { class: 'cl-t', text: e.title })),
      h('button', { type: 'button', class: 'cl-status' + (acked ? ' on' : ''), 'aria-pressed': String(acked), title: acked ? '확인함 (누르면 취소)' : '눌러서 확인 표시', on: { click: () => clSetAck(e.id, !acked) } },
        h('span', { class: 'cl-ico', 'aria-hidden': 'true', text: acked ? '✓' : '' }), h('span', { text: 'read' }))),
    open ? clItems(e) : null);
};
const updatesCard = () => { const un = clUnread(); const list = un.length ? un.slice(0, 3) : CHANGELOG.slice(0, 1);
  return card('Updates', ...list.map((e) => clFold(e, false)), un.length > 1 ? h('div', { class: 'row' }, btn('Confirm all', act(() => clConfirm(un.map((e) => e.id))), 'small')) : null); };
const updateHistoryCard = () => card('Update history', ...CHANGELOG.map((e) => clFold(e, true)));
function viewSettingsW() {
  const st = sd('status'), m = meta();
  const sw = (label, checked, fn, sub) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, on: { change: act((e) => fn(e.target.checked)) } }), h('span', {}, h('b', { text: label }), sub ? h('small', { text: sub }) : null));
  return h('div', { class: 'grid' },
    card('Notifications',
      sw('Do not disturb', !!st.dnd, (v) => S.store.patch('shared', 'status', { kind: 'status', dnd: v, ts: Date.now() }), ''),
      sw('Safety alert', m.alertOn !== false, (v) => setMeta({ alertOn: v }), '"죽고 싶다" 같은 표현이 입력되면 상대에게 안부 확인 신호만 가요(내용은 가지 않아요). 끄면 상대에게 아무것도 가지 않아요.')),
    card('Engine', note('변환 엔진: 규칙 기반 (이 기기 안에서 처리돼요. 원문이 AI 같은 외부 서비스로 나가지 않아요)'), note('내가 "공유"한 줄은 원문과 함께 상대에게 가요. 공유하지 않은 원문은 나만 볼 수 있어요. 그 밖에 상대에게 가는 건 상태 색, 집계 숫자, 달력 표시예요.')),
    pushCard(), themeCard(), modeCard());
}
const pushOn = act(async () => {
  try { await Push.enablePush(S.sb); toast('이 기기에서 알림을 켰어요.'); } catch (e) { if (e?.message === 'denied') toast('알림이 허용되지 않았어요. 기기 설정에서 허용해 주세요.'); else throw e; }
  await refreshPush();
});
const pushOff = act(async () => { lsSet('svcmon.push.want', false); await Push.disablePush(S.sb); toast('이 기기의 알림을 껐어요.'); await refreshPush(); });
/** 상단바 알림 스위치: 켜짐/꺼짐은 바로 전환, 켤 수 없는 상태는 이유를 안내 */
function notifyBtn() {
  const st = S.push, on = st === 'on';
  const click = () => {
    if (st === 'on') return pushOff();
    if (st === 'off') return pushOn();
    if (st === 'local' || !S.cloud) return toast('체험·혼자 쓰는 모드에서는 알림이 없어요. 로그인하면 쓸 수 있어요.');
    if (st === 'loading' || st == null) return toast('확인 중이에요. 잠시 후 다시 눌러 주세요.');
    if (st === 'denied') return toast('알림이 차단돼 있어요. 기기 설정에서 허용해 주세요.');
    return openInstall();
  };
  return h('button', { type: 'button', class: 'btn ghost small ic notify ' + (on ? 'is-on' : 'is-off'), title: on ? 'Notifications on (this device) · tap to turn off' : 'Notifications off (this device) · tap to turn on', 'aria-label': 'Notifications', 'aria-pressed': String(on), on: { click } }, icon(on ? 'bell' : 'bellOff'));
}
function pushCard() {
  const st = S.push, kids = [];
  const turnOn = pushOn, turnOff = pushOff;
  if (st === 'local') kids.push(note('공유 저장소에 연결되면 쓸 수 있어요 (혼자 쓰는 모드에서는 알림이 없어요).'));
  else if (st === 'loading') kids.push(note('확인 중…'));
  else if (st === 'unconfigured') kids.push(note('이 배포에는 푸시 키가 아직 설정되지 않았어요 (config.js 의 VAPID_PUBLIC_KEY).'));
  else if (st === 'need-install') kids.push(note('아이폰은 먼저 "홈 화면에 추가"를 해야 알림을 받을 수 있어요.'), btn('How to install', openInstall, 'small primary'));
  else if (st === 'unsupported') kids.push(note('이 브라우저는 푸시 알림을 지원하지 않아요. 최신 Safari(홈 화면 앱)나 Chrome을 써 주세요.'), btn('How to install', openInstall, 'small'));
  else if (st === 'denied') kids.push(note('알림이 차단돼 있어요. 기기(또는 브라우저) 설정에서 이 앱의 알림을 허용한 뒤 다시 와 주세요.'), btn('How to install', openInstall, 'small'));
  else if (st === 'on') kids.push(h('div', { class: 'row' }, badge('On (this device)', 'ok'), h('span', { class: 'sp' }), btn('Turn off', turnOff, 'small')));
  else kids.push(btn('Turn on', turnOn, 'small primary'));
  return card('Push notifications', note('알림은 기기마다 따로 켜요.'), ...kids,
    st !== 'local' && st !== 'need-install' ? btn('How to install', openInstall, 'ghost small') : null);
}
function openInstall() {
  const ios = Push.isIOS();
  const steps = (t, list) => [h('div', { class: 'hl', text: t }), h('ol', {}, list.map((x) => h('li', {}, rich(x))))];
  modal({ title: '홈 화면에 추가하고 알림 받기', body: h('div', { class: 'help' },
    h('p', { class: 'why', text: ios ? '아이폰(iOS 16.4 이상)은 Safari에서 "홈 화면에 추가"한 앱에서만 알림이 와요.' : '홈 화면에 추가하면 앱처럼 열리고 알림도 안정적으로 와요.' }),
    ...steps('아이폰 / 아이패드 (Safari)', ['Safari로 이 주소를 열기 (크롬·카카오톡 안에서는 안 돼요)', '아래 가운데 **공유** 버튼 → **홈 화면에 추가** → **추가**', '홈 화면에 생긴 **Monitor** 아이콘으로 앱 열기', '로그인 → **Settings** → **Push notifications** → **Turn on** → **허용**']),
    ...steps('안드로이드 (Chrome)', ['Chrome으로 이 주소를 열기', '오른쪽 위 **⋮** → **앱 설치** (또는 **홈 화면에 추가**)', '로그인 → **Settings** → **Push notifications** → **Turn on** → **허용**']),
    ...steps('컴퓨터 (Chrome / Edge)', ['주소창 오른쪽의 **설치** 아이콘으로 설치하거나 브라우저에서 그대로 사용', '**Settings** → **Push 알림** → **알림 켜기**']),
    h('p', { class: 'note', text: '알림이 안 오면: ① 무음/집중 모드 확인 ② 기기 설정 → 알림 → Monitor 허용 확인 ③ 앱에서 알림을 껐다가 다시 켜기.' })),
    actions: [{ label: 'Close', cls: 'primary' }] });
}
function themeCard() {
  const cur = lsGet('svcmon.theme', DEFAULT_THEME);
  const pick = (id) => () => { lsSet('svcmon.theme', id); applyTheme(id); renderView(); };
  const row = (list) => h('div', { class: 'row theme-row' }, list.map(([id, label]) => btn([h('span', { class: 'sw', style: `background:${SWATCH[id]}` }), label], pick(id), 'small' + (cur === id ? ' primary' : ''))));
  return card('Theme',
    h('h4', { text: 'New design' }), row(THEMES_V2),
    h('h4', { class: 'theme-sep', text: 'Classic' }), row(THEMES),
    h('h4', { class: 'theme-sep', text: 'Special' }), row(THEMES_FUN));
}
function modeCard() {
  const kids = [];
  if (S.sandbox) kids.push(
    h('div', { class: 'row' }, ['writer', 'listener'].map((r) => btn(r === 'writer' ? 'Writer view' : 'Listener view', () => { S.role = r; S.tab = r === 'writer' ? 'console' : 'overview'; S.prevMood = null; S.prevReact = null; renderChrome(); renderView(); }, 'small' + (S.role === r ? ' primary' : ''))), btn('Exit sandbox', () => boot(), 'small')));
  else if (S.cloud) kids.push(note(`공유 저장소에 연결됨 · ${isWriter() ? '작성자' : '리스너'} · ${S.email}`),
    h('div', { class: 'row' }, btn('Try sandbox', () => boot({ sandbox: true }), 'small'), btn('Sign out', act(logout), 'small danger')));
  else {
    kids.push(note('혼자 쓰는 모드 (이 기기에만 저장). 화면을 바꿔 볼 수 있어요.'),
      h('div', { class: 'row' }, ['writer', 'listener'].map((r) => btn(r === 'writer' ? '작성자 화면' : '리스너 화면', () => { S.role = r; lsSet('svcmon.role', r); S.tab = r === 'writer' ? 'console' : 'overview'; renderChrome(); renderView(); }, 'small' + (S.role === r ? ' primary' : '')))));
  }
  return card('Mode', ...kids);
}

// ───────── 체크인: 작성자의 CPU가 높아지면 리스너가 "무슨 일 있어?"를 물어볼 수 있다 ─────────
const CHECKIN_STEP = 10; // CPU 10%부터, 한 번 물어본 뒤에는 그 시점보다 10%가 더 쌓일 때마다 다시 물어볼 수 있다
const checkinsToday = () => rows('checkins').filter((c) => c.day === dayKey()).sort((a, b) => b.ts - a.ts);
const checkinToday = () => checkinsToday()[0] || null;
const pendingCheckin = () => checkinsToday().find((c) => c.status === 'asked') || null;
// 다음에 물어볼 수 있는 CPU: 오늘 처음이면 10%, 아니면 "마지막으로 물어본 CPU"의 다음 10% 단위
const nextAskAt = () => { const t = checkinsToday(); return t.length ? Math.floor(Math.max(...t.map((c) => c.cpu | 0)) / CHECKIN_STEP) * CHECKIN_STEP + CHECKIN_STEP : CHECKIN_STEP; };
function checkinCardL(st) {
  const ck = checkinToday(), cpu = clamp((st.cpu | 0) + (st.mem | 0)), waiting = ck?.status === 'asked'; // 좋은 말은 제외한 짜증+피로 합계
  const can = !waiting && cpu >= nextAskAt();
  if (!can && !ck) return null;
  const ask = act(async () => { await S.store.set('checkins', 'ck_' + uid(), { ts: Date.now(), day: dayKey(), status: 'asked', by: 'listener', cpu }); toast('물어봤어요. 답장이 오면 알려 드릴게요.'); });
  const kids = [];
  if (ck?.status === 'asked') kids.push(h('div', { class: 'ih' }, badge('Waiting for reply', 'warn'), h('span', { class: 'sub', text: `Asked ${hm(ck.ts)} · CPU ${ck.cpu | 0}%` })));
  else if (ck?.status === 'answered') kids.push(h('div', { class: 'gloss note-by' }, h('span', { class: 'k', text: `Reply · ${hm(ck.answeredAt || ck.ts)}` }), h('span', { text: ck.reply || '(메시지 없이 로그만 보냈어요)' })),
    ck.logs ? note(`로그 ${ck.logs}개를 공유했어요. Queue 탭에서 볼 수 있어요.`) : null);
  else if (ck) kids.push(h('div', { class: 'ih' }, badge('Not now'), h('span', { class: 'sub', text: `${hm(ck.dismissedAt || ck.ts)} · CPU ${ck.cpu | 0}%` })));
  if (can) kids.push(note(ck ? `CPU가 ${cpu}%까지 더 올랐어요 (지난번 ${ck.cpu | 0}%). 다시 물어볼 수 있어요.` : `상대의 CPU가 ${cpu}%까지 올랐어요. 무슨 일이 있는지 물어볼 수 있어요.`), btn("Ask what's up", ask, 'primary small'));
  return card('Check in', ...kids);
}
function checkinCardW() {
  const ck = pendingCheckin(); if (!ck) return null;
  return card('Check-in', h('p', { class: 'msgtext', text: '상대가 무슨 일 있는지 물어봤어요.' }), h('div', { class: 'sub', text: `Asked ${hm(ck.ts)}` }),
    h('div', { class: 'row' }, btn('Reply', () => openCheckinReply(ck), 'primary small'), btn('Not now', act(() => S.store.patch('checkins', ck.id, { status: 'dismissed', dismissedAt: Date.now() })), 'small quiet')));
}
function openCheckinReply(ck) {
  const msg = h('textarea', { rows: 3, maxLength: 200, placeholder: '무슨 일이 있었는지 한마디 (선택)' });
  const logs = todayLogs().sort((a, b) => b.ts - a.ts), picks = new Set();
  const list = logs.length ? logs.map((l) => h('label', { class: 'chk logpick' },
    h('input', { type: 'checkbox', on: { change: (e) => (e.target.checked ? picks.add(l.id) : picks.delete(l.id)) } }),
    h('span', {}, h('b', { class: 'lv-' + l.level, text: `${hms(l.ts)} ${l.level}` }), ' ', `${l.service} `, h('small', { class: 'sub', text: l.raw ? `“${l.raw}”` : l.msg })))) : [note('오늘 기록한 로그가 없어요.')];
  modal({ title: 'Reply to check-in', body: h('div', { class: 'share' }, msg, h('div', { class: 'mlab', text: 'Share logs (optional)' }), h('div', { class: 'logpicks' }, list), note('고른 로그는 원문까지 함께 상대 화면에 보여요.')),
    actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Send', cls: 'primary', close: false, fn: async (close) => {
      const text = msg.value.trim();
      if (!text && !picks.size) return toast('한마디를 쓰거나 공유할 로그를 골라 주세요');
      close();
      let n = 0;
      for (const l of logs.filter((x) => picks.has(x.id))) { if (!l.sharedId) await shareLine(l, '', true); n += 1; }
      await S.store.patch('checkins', ck.id, { status: 'answered', reply: text, logs: n, answeredAt: Date.now() });
      toast('보냈어요');
    } }] });
}

// ───────── 리스너 ─────────
function viewOverview() {
  const st = statusToday();
  const alerts = rows('alerts').filter((a) => !a.ackAt).sort((a, b) => b.ts - a.ts);
  return h('div', { class: 'grid' },
    card('Service status', st.level ? [statusPill(st.level), st.dnd ? badge('Do not disturb', 'warn') : null, h('div', { class: 'sub', text: '갱신 ' + (st.ts ? mdhm(st.ts) : '–') })] : note('아직 신호가 없어요.'),
      st.level ? [stackMeter('CPU', st.cpu, st.mem), goodMeter(st.pos), meter('DISK', st.disk | 0, 'disk')] : null),
    checkinCardL(st), updatesCard(),
    alerts.length ? card('Needs attention', alerts.map((a) => h('div', { class: 'item care-item' }, h('b', { text: '안부 확인 신호' }), h('span', { class: 'sub', text: mdhm(a.ts) }), note('내용은 전달되지 않아요. 가볍게 안부를 물어봐 주세요.'), btn('Got it', act(() => S.store.patch('alerts', a.id, { ackAt: Date.now() })), 'small primary')))) : null, updateHistoryCard());
}
function viewQueue() {
  const lines = [...rows('lines')].sort((a, b) => b.ts - a.ts);
  return h('div', { class: 'grid' },
    card('Shared log lines',
      lines.length ? lines.map((ln) => h('div', { class: 'item', 'data-lid': ln.id }, h('div', { class: 'mono lv-' + ln.level, text: ln.text }),
        ln.note ? h('div', { class: 'gloss note-by' }, h('span', { class: 'k', text: 'Note' }), h('span', { text: ln.note })) : null,
        ln.raw ? h('div', { class: 'gloss note-by' }, h('span', { class: 'k', text: 'Raw (shared)' }), h('span', { text: ln.raw })) : null,
        rows('reviews').filter((r) => r.lineId === ln.id).sort((a, b) => a.ts - b.ts).map((r) => reviewRow(ln, r, 'listener')),
        (() => {
          const box = h('input', { id: 'rv-' + ln.id, type: 'text', maxLength: 140, placeholder: 'review comment', enterkeyhint: 'send', autocomplete: 'off' });
          const send = act(async () => { if (await sendField(box, (t) => S.store.set('reviews', 'rv_' + uid(), { lineId: ln.id, ts: Date.now(), day: dayKey(), text: t }))) { S.replyOpen?.delete('rv-' + ln.id); renderView(); } });
          onEnter(box, send);
          return replyArea('rv-' + ln.id, box, send, 'Comment', 'Comment');
        })())) : empty('공유된 로그 없음')));
}
function whenTs(v) {
  const n = new Date(), now = n.getTime();
  if (v === '1h') return now + 3600e3;
  if (v === '3h') return now + 3 * 3600e3;
  if (v === 'tomorrow') { const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
  if (v === 'sat') { const d = new Date(n); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(10, 0, 0, 0); return d.getTime(); }
  return now;
}
function viewSend() {
  const mine = [...rows('commits')].filter((c) => (c.by || 'listener') === 'listener').sort((a, b) => b.deliverAt - a.deliverAt);
  const got = rows('commits').filter((c) => c.by === 'writer').sort((a, b) => b.ts - a.ts);
  return h('div', { class: 'grid' },
    card('Commit',
      h('textarea', { id: 'cm-text', rows: 2, maxLength: 200, placeholder: 'commit message' }),
      h('div', { class: 'row' }, h('select', { id: 'cm-when' }, [['now', '지금'], ['1h', '1시간 뒤'], ['3h', '3시간 뒤'], ['tomorrow', '내일 아침 9시'], ['sat', '주말 아침 10시']].map(([v, t]) => h('option', { value: v, text: t }))),
        btn('Commit', act(async () => {
          if (!$('#cm-text').value.trim()) return toast('메시지를 적어주세요');
          const deliverAt = whenTs($('#cm-when').value);
          await sendField($('#cm-text'), (t) => S.store.set('commits', 'cm_' + uid(), { by: 'listener', ts: Date.now(), day: dayKey(), deliverAt, text: t, sha: uid().slice(-7), ack: false, ackAt: null }));
        }), 'primary'))),
    card('Received', got.length ? got.map((c) => commitItem(c, 'in')) : empty('받은 메시지 없음')),
    card('Sent', mine.length ? mine.map((c) => commitItem(c, 'out')) : empty('보낸 메시지 없음')));
}
function viewPlan() {
  return h('div', { class: 'grid' }, planChangesCard(), agendaCard(), calendarCard());
}

function viewSettingsL() {
  return h('div', { class: 'grid' }, pushCard(), themeCard(), modeCard(), card('Privacy', note('이 화면에서는 작성자가 공유한 줄의 원문만 볼 수 있어요. 공유하지 않은 원문은 볼 수 없어요. 보이는 건 상태 색, 집계 숫자, 공유된 줄, 공유 달력이에요.'), note('매일 새벽 4시를 기준으로 어제의 공유 줄·리뷰·전달된 메시지가 정리돼요.')));
}

// ───────── Syslog: 둘이 쓰는 게시판 ─────────
// 회사 화면에서 이상해 보이지 않게 시스템 로그 뷰어처럼 만든다: 한 줄 로그, 고정폭 글씨, 차분한 색.
// 글 종류(태그)는 없고, 글을 쓸 때 "긴급(Urgent)"만 표시할 수 있다. 질문(Question)은 투표를 붙일 수 있다.
const posts = () => rows('posts').map(({ urgent, question, poll, status, resolvedAt, ...p }) => p);   // 긴급·질문(투표) 기능은 없앴다: 예전에 쓴 글도 평범한 글로 보인다
const sysComments = (id) => rows('post_comments').filter((c) => c.postId === id).sort((a, b) => a.ts - b.ts);
const newTag = (on) => (on ? h('span', { class: 'new-tag', text: 'new' }) : null);
const sysLikes = (cid) => rows('comment_likes').filter((l) => l.commentId === cid && l.on);
const sysVotes = (id) => rows('post_votes').filter((v) => v.postId === id && v.option != null);
const newSyslog = () => posts().filter((p) => p.by !== roleName() && p.ts > seenAt('syslog')).length + rows('post_comments').filter((c) => c.by !== roleName() && c.ts > seenAt('syslog')).length + rows('comment_likes').filter((l) => l.on && l.postId && l.by !== roleName() && l.ts > seenAt('syslog')).length;
const sysState = () => (S.sys ??= { filter: 'all', q: '', open: new Set(), read: new Set(), mask: lsGet('svcmon.sys.mask', true) });
// 목록의 글은 암호문처럼 보이고(msg=U2FsdGVkX1…), 누른 글만 진짜 내용으로 펼쳐진다. 한 번에 하나만 펼치고, 일정 시간이 지나거나 앱을 벗어나면 다시 가려진다.
// 암호문처럼 보이는 글자는 글 id 로만 만든다. 글 내용과 상관이 없어서 내용이나 길이가 새지 않고, 새로고침해도 같은 글은 같은 모양이다.
function maskText(id) {
  let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let out = 'U2FsdGVkX1', n = 14 + ((h >>> 0) % 14);
  for (let i = 0; i < n; i += 1) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out += A[h % 64]; }
  return 'msg=' + out + '…';
}
// 앱을 벗어나면(다른 탭, 화면 꺼짐) 바로 가린다. 안 보이는 탭에서는 다음 프레임 갱신이 멈추므로 곧바로 그린다.
document.addEventListener('visibilitychange', () => { if (document.hidden && S.sys?.mask && S.sys.open.size) { clearTimeout(S.sys.hideT); S.sys.open.clear(); if (S.tab === 'syslog') renderView(); } });
const syslogMuted = () => !!sd('syslog_mute_' + roleName()).muted;
const sysSev = () => 'info';

// 댓글 좋아요: 상대의 댓글에만 누를 수 있고(다시 누르면 취소). 사용자가 둘뿐이라 숫자는 없다 — 안 눌렀으면 ♡, 눌렀으면 ♥, 내 댓글은 상대가 눌렀을 때만 ♥
function likeBtn(c, scope, me) {
  const ls = sysLikes(c.id), mine = ls.some((l) => l.by === me), since = scope.postId ? S.sysSince : scope.agendaId ? S.planSince : S.revSince;
  const fresh = ls.some((l) => l.by !== me && l.ts > (since ?? Infinity));
  // 하트는 모든 댓글에 항상 있다(내 댓글에도 누를 수 있다). 하트 = 내가 눌렀는지, 옆의 작은 숫자 = 누른 사람 수. 숫자 칸은 비어 있어도 자리를 차지해서 하트 위치가 변하지 않는다.
  const heart = h('button', { type: 'button', class: 'sl-like' + (mine ? ' on' : ' off'), title: mine ? 'Unlike' : 'Like', 'aria-label': 'Like', 'aria-pressed': String(mine),
    on: { click: act(() => S.store.set('comment_likes', `cl_${c.id}_${me}`, { commentId: c.id, ...scope, by: me, on: !mine, ts: Date.now() })) } }, icon(mine ? 'heartOn' : 'heart'));
  return h('span', { class: 'lk-wrap', 'data-newlike': fresh ? '1' : '0' }, heart, h('span', { class: 'lk-n', title: ls.length ? `${ls.length} liked` : '', text: ls.length || '' }));
}
function sysThread(id, canAdd) {
  const me = roleName(), list = sysComments(id);
  const box = h('input', { type: 'text', maxLength: 200, placeholder: 'reply', id: 'sc-' + id, enterkeyhint: 'send', autocomplete: 'off' });
  const send = act(async () => { if (await sendField(box, (t) => S.store.set('post_comments', 'pc_' + uid(), { postId: id, by: me, text: t, ts: Date.now() }))) { S.replyOpen.delete('sc-' + id); renderView(); } });
  onEnter(box, send);
  return h('div', { class: 'sl-thread rv-thread' },
    list.map((c) => { const fr = c.by !== me && c.ts > (S.sysSince ?? Infinity); return cmtRow({ cls: (c.ack ? 'ack' : '') + (fr ? ' fresh' : ''), time: hm(c.ts), by: `by ${c.by === me ? '0' : '1'}`, them: c.by !== me, text: c.ack ? 'ack: I hear you' : c.text, edited: c.editedAt, isNew: newTag(fr), like: c.ack ? null : likeBtn(c, { postId: id }, me),
      onEdit: c.by === me && !c.ack ? () => editText({ title: 'Edit reply', text: c.text, max: 200, onSave: (t) => S.store.patch('post_comments', c.id, { text: t, editedAt: Date.now() }) }) : null, onDel: c.by === me ? () => S.store.del('post_comments', c.id) : null }); }),
    canAdd ? replyArea('sc-' + id, box, send) : null);
}
function sysRow(p, kept) {
  const st = sysState(), me = roleName(), sev = sysSev(p), open = st.open.has(p.id), mine = p.by === me;
  const nC = sysComments(p.id).filter((c) => !c.ack).length;
  const title = (p.text || '').split('\n')[0].slice(0, 90);
  const since = S.sysSince ?? Infinity, unread = !st.read.has(p.id);
  const newPost = !mine && p.ts > since && unread, newReply = !newPost && unread && sysComments(p.id).some((c) => c.by !== me && c.ts > since);
  const newLike = !newPost && !newReply && unread && sysComments(p.id).some((c) => sysLikes(c.id).some((l) => l.by !== me && l.ts > since));
  const line = h('div', { 'data-pid': p.id, class: `sl sev-${sev}${newPost || newReply || newLike ? ' fresh' : ''}${open ? ' open' : ''}`, on: { click: () => { if (open) st.open.delete(p.id); else { if (st.mask || sysWide()) st.open.clear(); st.open.add(p.id); st.read.add(p.id); } renderView(); } } },
    h('span', { class: 'sl-t', text: hm(p.ts) }), h('span', { class: 'sl-f', text: `user.${sev}` }), h('span', { class: 'sl-h' + (mine ? '' : ' them'), text: `by ${mine ? '0' : '1'}` }),
    h('span', { class: 'sl-m' + ((!open || sysWide()) && st.mask ? ' mask' : ''), text: open && !sysWide() ? p.text : st.mask ? maskText(p.id) : title }),   // PC 는 내용이 오른쪽 칸에 뜨므로 목록 줄은 한 줄 제목만

    h('span', { class: 'sl-b' },
      ...[[newPost ? '[new]' : newReply ? '[new reply]' : newLike ? '[new like]' : '', 'b-new'], [p.editedAt ? '[edited]' : '', 'b-ed']].filter(([t]) => t).map(([t, c]) => h('span', { class: c, text: t })),
      h('span', { class: 'b-c', text: nC ? `(${nC})` : '' }), h('span', { class: 'b-k', text: kept ? '*' : '' })));
  if (!open || sysWide()) return line;   // 넓은 화면(PC)에서는 아래로 펼치지 않고 오른쪽 칸에 보여준다
  return h('div', { class: 'sl-wrap open' }, line, sysBody(p, kept));
}
function sysDetail(p, kept) {
  const mine = p.by === roleName(), sev = sysSev(p);
  return [h('h3', { text: 'Entry' }),
    h('div', { class: 'sl-dmeta' }, h('span', { text: mdhm(p.ts) }), h('span', { text: `user.${sev}` }), h('span', { class: mine ? '' : 'them', text: `by ${mine ? '0' : '1'}` }), p.editedAt ? h('span', { class: 'b-ed', text: '[edited]' }) : null),
    h('p', { class: 'sl-text sl-dtext', text: p.text }),
    sysBody(p, kept)];
}
const sysWide = () => !!window.matchMedia?.('(min-width: 900px)').matches;
function sysBody(p, kept) {
  const mine = p.by === roleName();
  const title = (p.text || '').split('\n')[0].slice(0, 90);
  const keepBtn2 = btn(kept ? 'Unkeep' : 'Keep', act(async () => { if (kept) { for (const x of keeps().filter((x) => x.kind === 'syslog' && x.from === p.id)) await S.store.del('@', x.id); } else await S.store.set('@', 'keep_' + uid(), { type: 'keep', kind: 'syslog', ts: Date.now(), text: title, from: p.id }); }), 'small quiet');
  return h('div', { class: 'sl-body' },
    sysThread(p.id, true),
    h('div', { class: 'sl-act' }, keepBtn2,
      mine ? moreMenu([
        { label: 'Edit', icon: 'edit', fn: () => editText({ title: 'Edit entry', text: p.text, max: SYS_MAX, onSave: (t) => S.store.patch('posts', p.id, { text: t, editedAt: Date.now() }) }) },
        { label: 'Delete', icon: 'trash', danger: true, fn: () => modal({ title: '이 글을 삭제할까요?', body: note('댓글과 좋아요도 함께 사라져요.'), actions: [{ label: 'Cancel', cls: 'small' }, { label: 'Delete', cls: 'primary', fn: act(() => S.store.del('posts', p.id)) }] }) }]) : null));
}
// 새 글 쓰기: PC 는 목록 위 입력줄(여러 줄 가능, Enter 는 줄바꿈, 올리기는 Post 버튼 또는 Ctrl/⌘+Enter), 폰은 칸이 좁아서 입력줄을 누르면 팝업이 열린다.
const SYS_MAX = 20000;   // Syslog 글 최대 글자 수 (서버 규칙 010 과 같아야 한다)
function composeForm(onPosted, prefill = S.cmpDraft || '') {
  const me = roleName();
  const text = h('textarea', { id: 'sl-compose', rows: onPosted ? 6 : 1, maxLength: SYS_MAX, placeholder: 'new entry…', 'aria-label': 'new entry', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span', { class: 'tc-count', text: `${prefill.length}/${SYS_MAX}` });
  const wrap = h('div', { class: 'sl-compose' + (onPosted ? ' in-modal' : '') });
  text.value = prefill;
  const post = act(async () => {
    const t = text.value.trim(); if (!t) return;
    text.value = ''; count.textContent = `0/${SYS_MAX}`; S.cmpDraft = '';
    const saving = S.store.set('posts', 'po_' + uid(), { by: me, text: t, ts: Date.now() });   // 화면에는 저장이 끝나기 전에 바로 올라가 보인다
    if (onPosted) onPosted();
    S.dirty = false; renderView(); renderChrome(); if (!onPosted) $('#sl-compose')?.focus();   // 입력줄에 커서가 있으면 목록 갱신이 미뤄지므로 직접 다시 그린다
    toast('올렸어요');
    try { await saving; } catch (e) { toast(errText(e)); if (onPosted) openComposeModal(t); else { const el = $('#sl-compose'); if (el && !el.value) el.value = t; } }   // 저장에 실패하면 쓴 글을 다시 돌려 놓는다
  });
  text.addEventListener('input', () => { if (!onPosted) autoGrow(text); count.textContent = `${text.value.length}/${SYS_MAX}`; if (onPosted) S.cmpDraft = text.value; });   // 팝업을 실수로 닫아도 쓰던 글이 남는다
  // Enter 는 줄바꿈. Ctrl/⌘+Enter 로 올린다 (한글 입력 확정 중에는 무시)
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); post(); } else if (e.key === 'Escape' && !onPosted) text.blur(); });
  wrap.append(h('div', { class: 'tc-box' }, h('span', { class: 'tc-gut', text: '>' }), text),
    h('div', { class: 'tc-foot' }, h('span', { class: 'sp' }), h('span', { class: 'tc-hint', text: 'Enter = new line · Ctrl/⌘+Enter = post' }), count, btn('Post', post, 'small primary')));
  return { el: wrap, text };
}
function openComposeModal(prefill) {
  let close = () => {};
  const f = composeForm(() => close(), prefill);
  close = modal({ title: 'New entry', body: f.el, actions: [{ label: 'Cancel', cls: 'small' }] });
  setTimeout(() => f.text.focus(), 30);
}
function composeBar() {
  if (sysWide()) return composeForm().el;
  return h('div', { class: 'sl-compose' }, h('button', { type: 'button', class: 'tc-box tc-open', on: { click: () => openComposeModal() } }, h('span', { class: 'tc-gut', text: '>' }), h('span', { class: 'tc-ph', text: 'new entry…' })));
}
function viewSyslog() {
  const st = sysState(), me = roleName();
  const kept = new Set(keeps().filter((k) => k.kind === 'syslog').map((k) => k.from));
  const all = posts();
  const FILTERS = [['all', 'All', () => all.length], ['kept', 'Kept', () => all.filter((p) => kept.has(p.id)).length]];
  const listRows = () => {
    let list = all.slice().sort((a, b) => b.ts - a.ts);
    if (st.filter === 'kept') list = list.filter((p) => kept.has(p.id));
    const q = st.q.trim().toLowerCase(); if (q) list = list.filter((p) => (p.text || '').toLowerCase().includes(q));
    return list.length ? list.map((p) => sysRow(p, kept.has(p.id))) : [h('p', { class: 'empty', text: q || st.filter !== 'all' ? 'no match' : 'No entries yet.' })];
  };
  const listBox = h('div', { class: 'sl-list' }, listRows());
  const chips = FILTERS.map(([f, label, n]) => h('button', { type: 'button', class: 'schip' + (st.filter === f ? ' on' : ''), on: { click: () => { st.filter = f; renderView(); } } }, label, h('i', { text: n() })));
  const wide = sysWide(), sel = wide ? all.find((p) => st.open.has(p.id)) : null;
  const detail = !wide ? null : h('section', { class: 'card sl-detail' }, sel ? sysDetail(sel, kept.has(sel.id)) : [h('h3', { text: 'Entry' }), empty('목록에서 글을 누르면 여기에 열려요')]);
  return h('div', { class: 'grid' + (wide ? ' sl-split' : '') }, h('section', { class: 'card syslog' },
    h('div', { class: 'row sl-head' }, h('h3', { text: 'Syslog' }), h('span', { class: 'sl-hact' },
      st.open.size ? btn('Hide all', () => { st.open.clear(); renderView(); }, 'small quiet') : null,
      tglBtn(st.mask ? 'eyeOff' : 'eye', st.mask ? 'Mask on (hide text) · tap to show' : 'Mask off · tap to hide text', st.mask, () => { st.mask = !st.mask; lsSet('svcmon.sys.mask', st.mask); renderView(); }),
      tglBtn(syslogMuted() ? 'bellOff' : 'bell', syslogMuted() ? 'Notify off for Syslog · tap to turn on' : 'Notify on for Syslog · tap to turn off', !syslogMuted(), act(() => S.store.set('shared', 'syslog_mute_' + me, { muted: !syslogMuted(), ts: Date.now() }))))),
    h('div', { class: 'sl-chips' }, chips),
    h('input', { class: 'grep', type: 'search', placeholder: 'grep…', value: st.q, on: { input: (e) => { st.q = e.target.value; listBox.replaceChildren(...listRows()); } } }),
    composeBar(),
    listBox), detail);
}

const VW = { console: viewConsole, dash: viewDash, inbox: viewInbox, syslog: viewSyslog, plan: viewPlanW, report: viewReport, archive: viewArchive, settings: viewSettingsW };
const VL = { overview: viewOverview, queue: viewQueue, send: viewSend, syslog: viewSyslog, plan: viewPlan, report: viewReport, settings: viewSettingsL };

// ───────── 통계/상태 동기화 (작성자만) ─────────
let syncT;
function syncSoon() {
  if (!isWriter() || !S.ready || !S.canWrite) return;
  clearTimeout(syncT); syncT = setTimeout(() => syncNow().catch((e) => console.warn(e)), 900);
}
async function syncNow() {
  const st = S.store, today = dayKey(), logs = todayLogs();
  if (logs.length) {
    const s = L.statFromLogs(logs);
    if (!L.sameStat(st.get('stats', today), s)) await st.set('stats', today, { day: today, week: weekKey(), ...s });
  }
  const m = metrics(), cur = sd('status'), m5 = (v) => Math.round(v / 5) * 5;
  const next = { level: m.level, cpu: m5(m.cpu), mem: m5(m.mem), disk: m5(m.disk), pos: m5(m.pos), off: false };
  if (!cur.kind || ['level', 'cpu', 'mem', 'disk', 'pos', 'off'].some((k) => (cur[k] ?? 0) !== (next[k] ?? 0) && cur[k] !== next[k])) await st.patch('shared', 'status', { kind: 'status', ...next, dnd: !!cur.dnd, ts: Date.now() });
}

// ───────── 정리(GC) — 하루는 새벽 4시에 바뀌고, 지난 하루치는 자동 정리·기록된다 ─────────
function dayRoll() {   // 앱을 켜 둔 채 새벽 4시가 지나면 화면의 CPU·MEM·CACHE 를 새 하루로 다시 그리고, 작성자는 리스너에게 가는 상태도 0 으로 보낸다
  const today = dayKey(), prev = S.dayMark; S.dayMark = today;
  if (prev && prev !== today) refresh();   // 입력 중이면 refresh 가 알아서 미룬다
}
async function gcOnce() {
  dayRoll();
  if (S.gcBusy || !S.ready || !S.canWrite) return;
  S.gcBusy = true;
  try { await gc(); } catch (e) { console.warn('gc', e); } finally { S.gcBusy = false; }
}
async function gc() {
  const st = S.store, today = dayKey(), wk = weekKey(), now = Date.now();
  const del = (c, r) => st.del(c, r.id);
  if (isWriter() || !S.cloud) {
    const old = rows('@').filter((r) => r.type === 'log' && r.day < today);
    const byDay = {};
    old.filter((l) => l.day >= dayKey(now - 28 * 86400e3)).forEach((l) => (byDay[l.day] ??= []).push(l));
    for (const [day, ls] of Object.entries(byDay)) {
      const s = L.statFromLogs(ls);
      if (!L.sameStat(st.get('stats', day), s)) await st.set('stats', day, { day, week: weekKey(dayMs(day)), ...s });
    }
    // 기록(원문 포함)은 보관하고, 어제 지워진 공유 줄과의 연결만 끊는다
    for (const l of old.filter((l) => l.sharedId)) await st.patch('@', l.id, { sharedId: null });
  }
  const lineIds = new Set(rows('lines').filter((r) => r.day >= today).map((r) => r.id));
  for (const r of rows('lines').filter((r) => r.day < today)) await del('lines', r);
  for (const r of rows('review_replies').filter((r) => r.day < today || !lineIds.has(r.lineId))) await del('review_replies', r);
  for (const r of rows('reviews').filter((r) => r.day < today || !lineIds.has(r.lineId))) await del('reviews', r);
  for (const r of rows('alerts').filter((r) => r.day < today)) await del('alerts', r);
  for (const r of rows('commits').filter((r) => r.deliverAt <= now && dayKey(r.deliverAt) < today)) await del('commits', r);   // 어제까지의 commit (주고받은 답글·하트는 서버가 함께 지운다)
  for (const r of rows('checkins').filter((r) => r.day < today)) await del('checkins', r);
  const cutoff = dayKey(now - 28 * 86400e3);
  for (const r of rows('stats').filter((r) => r.day < cutoff)) await del('stats', r);
}


// ───────── 설명서 ─────────
const HELP_W = [
  { t: '🏁 **시작하기**', why: '회사에서 쌓인 감정을 한 줄로 털어놓는 공간. 상대에게 부담을 주지 않고, 상태만 전달.',
    how: ['**Console**에 한 줄 입력', '말하고 싶은 줄만 골라 **공유**', '새벽 4시에 자동 정리 (기록은 **Archive**에 보관)'], tip: ['공유하지 않은 원문은 나만 열람', '공유한 줄은 원문과 함께 상대에게 전달', '상태 색·숫자는 자동으로 전달'] },
  { t: '✍️ **Console**', why: '입력한 한 줄을 서버 에러 로그로 바꿔 감정을 가볍게 표현.',
    how: ['입력창에 한 줄 입력 후 **Enter**', '귀찮을 땐 **+WARN** **+ERROR** **+FATAL** 버튼 클릭', '줄 클릭 시 원문 확인 (나만 열람)'],
    tip: ['로그 문장은 영어로 변환 (이 기기 안의 규칙으로 처리, 원문이 외부 AI로 나가지 않음)', '가만히 있으면 올라오는 파란 줄은 재미 문구·안부·명언 (기록·통계에 미포함)', '위험한 표현을 쓰면 안내 문구 표시'] },
  { t: '📤 **공유**', why: '말하고 싶은 한 줄만 골라 상대에게 알림.',
    how: ['줄 클릭 후 **이 로그 공유 (리뷰 요청)**', '한마디 입력 (선택)', '**공유** 클릭 (원문도 함께 전송)'],
    tip: ['**공유 취소**로 언제든 회수', '공유한 줄은 다음 날 새벽 4시에 자동 정리', '공유 전에 상대에게 보일 원문을 화면에서 확인'] },
  { t: '🫁 **진정하기**', why: '감정이 높아졌을 때 잠깐 식히기.',
    how: ['**restart**: 호흡 타이머 (약 40초), 종료 시 CPU·MEM 소폭 하락', '**clear**: 화면만 비움 (기록은 유지)', '**grep**: 줄 검색'],
    tip: ['명령어도 사용 가능: **/restart** **/clear** **/grep** 단어'] },
  { t: '📊 **Dashboard**', why: '오늘 내 상태를 숫자와 색으로 확인. 상대 화면에도 같은 색이 전달.',
    how: ['보기 전용 (입력 없음)', '**CPU** 인내심: 짜증·화 (터지기 직전의 감정)', '**MEM** 멘탈: 피로·불안 (마음이 무거워지는 상태)', '**DISK** 이번 주 쌓인 짜증 (월요일 새벽 4시 초기화)'],
    tip: ['상태 색: green (여유) · yellow (50 이상) · red (80 이상 또는 FATAL 3줄 이상)', '**CPU**·**MEM**은 오늘 쓴 줄의 점수 합이며 새벽 4시에 초기화'] },
  { t: '📥 **Inbox**', why: '상대가 보낸 응원 메시지와 코드 리뷰 댓글 확인.',
    how: ['**배포 성공 ✓** 클릭 시 "잘 받았다" 신호만 상대에게 전송', '**⭐ 남기기**로 좋은 말 보관 (good-things)'],
    tip: ['**Settings**의 방해금지를 켜면 응원 메시지 숨김', '보관한 말은 새벽 4시 정리 뒤에도 유지'] },
  { t: '📅 **Plan**', why: '야근·회식·출장 같은 일정을 상대와 공유하고 합의.',
    how: ['달력에서 날짜 클릭', '종류 선택: **야근** **회식** **출장** **약속** **휴가** **기타**', '메모·종료일 입력 (선택, **기타**는 일정 이름 필수)', '**상대에게 전송** 클릭', '상대가 올린 변경은 **변경사항**에서 **Approve** 또는 **Reject**'],
    tip: ['점선 일정은 승인 대기, 승인되면 실선', '승인된 일정 삭제는 **삭제 요청** (상대 승인 필요)', '승인·거절 결과는 알림으로 와요 (내역은 계속 보관)', '**Weekly Agenda**: 맨 위 칸. 다음 대화의 주제를 승인 없이 바로 등록 (등록한 사람이 **해결** 또는 **삭제**, 해결된 것은 기록으로 보관). 항목마다 **Comment**로 둘 다 댓글을 달 수 있고 내 댓글만 삭제'] },
  { t: '📈 **Report**', why: '한 주를 숫자로 돌아보기.',
    how: ['보기 전용 (요일별 로그 수 표와 3줄 요약)', '**다시 작성**: 요약 문구 재생성'],
    tip: ['집계 숫자만으로 작성 (원문 미사용)', '상대도 같은 보고서 확인'] },
  { t: '🗂 **Archive**', why: '지난 기록을 날짜별로 되돌아보기. 새벽 4시 정리 뒤에도 기록은 보관.',
    how: ['달력에서 날짜 클릭 시 그날의 로그 전체 확인', '줄 클릭 시 원문 확인 (나만 열람)', '**이 날 기록 모두 삭제**로 직접 정리'],
    tip: ['달력 점 색은 그날의 상태 (green / yellow / red)', '지운 기록은 복구 불가'] },
  { t: '⚙️ **Settings · 기타**', why: '알림과 화면 설정, 알아두면 좋은 기능.',
    how: ['**Do not disturb**: 응원 메시지 숨김', '**위험 신호 알림**: 위험한 표현 입력 시 상대에게 안부 확인 신호만 전송 (내용 미전송, 끌 수 있음)', '**Theme**: Basic(Light · Dark · Warm Gray · Auto)과 기분 전환용 Special 테마 (이 기기에만 저장)'],
    tip: ['탭 옆 빨간 숫자: 새로 온 항목 (그 탭을 열면 사라짐, **Plan**은 처리할 때까지 유지)', '**Esc**: 엑셀 화면으로 위장 (한 번 더 누르면 복귀)', '**/exit**: 엑셀 화면으로 위장'] },
  { t: '🙂 **상태 표시**', why: '지금 내 상태를 이모지로 알리고, 상대의 상태를 확인.',
    how: ['화면 맨 위 **0** 칩을 눌러 이모지와 한마디 선택 후 **Save**', '**1** 칩을 누르면 상대의 상태 확인', '**Clear**로 상태 지우기'],
    tip: ['상대가 상태를 바꾸면 안내와 알림이 와요', '1 칩의 빨간 점은 새로 바뀐 상태 (눌러서 확인하면 사라져요)', '1 칩을 누르면 **React**로 👍 ❤️ 😢 😡 💪 🙏 반응을 남길 수 있어요 (상대가 상태를 바꾸면 반응은 사라져요)'] },
  { t: '💬 **Check-in**', why: '상대가 무슨 일 있는지 물어보면 가볍게 답하기.',
    how: ['화면 위쪽 안내나 **Inbox**의 **Check-in** 카드에서 **Reply**', '한마디를 쓰고, 같이 보여줄 오늘 로그를 하나 이상 골라 **Send**', '답하고 싶지 않으면 **Not now**'],
    tip: ['고른 로그는 원문까지 함께 상대에게 보여요', '로그 없이 한마디만 보내도 돼요', '내가 먼저 보내는 게 아니라 상대가 물어볼 때만 와요'] },
  { t: '🗒 **Syslog**', why: '둘이 자유롭게 글을 남기는 게시판. 시스템 로그처럼 보여서 회사에서도 부담이 적어요.',
    how: ['**Syslog** 탭에서 **new entry** 칸에 글 쓰기 (폰은 누르면 팝업, PC는 여러 줄 가능)', '**Enter**는 줄바꿈, 올리기는 **Post** 또는 **Ctrl/⌘+Enter**', '글을 누르면 열려요 (PC는 오른쪽). 댓글, **Keep**'],
    tip: ['**Notify**로 이 게시판 알림을 끄고 켤 수 있어요', '**Esc**로 엑셀 화면 위장'] },
  { t: '📲 **앱 설치 · 알림**', why: '앱이 꺼져 있어도 상대의 활동을 알림으로 받기.',
    how: ['아이폰은 Safari → **공유** → **홈 화면에 추가**', '홈 화면 앱을 열고 **Settings**의 **Push notifications**에서 **Turn on**'], tip: ['알림은 기기마다 따로 켜야 해요', '알림 문구에는 내용이 들어가지 않아요 ("새 commit이 도착했어요" 같은 안내만)', '방해금지를 켜면 commit 알림은 오지 않아요'] },
];
const HELP_L = [
  { t: '🏁 **시작하기**', why: '친구가 부담 없이 털어놓을 수 있게 하고, 나는 상태만 가볍게 확인.',
    how: ['**Overview**에서 친구 상태 확인', '**Queue**에서 공유된 줄에 댓글', '**Send**로 응원 메시지 전송'], tip: ['친구가 공유한 줄은 원문도 함께 보여요', '공유하지 않은 원문은 볼 수 없어요'] },
  { t: '👀 **Overview**', why: '친구의 현재 상태를 확인하고, 내 상태를 친구에게 알림.',
    how: ['상태 색과 **CPU** · **MEM** · **DISK** 수치 확인', '**확인 필요** 카드가 보이면 가볍게 안부 연락 후 **확인했어요** 클릭'],
    tip: ['**안부 확인 신호**는 내용 없이 신호만 도착', '**Overview** 숫자는 **확인했어요**를 누를 때까지 유지'] },
  { t: '🎫 **Queue**', why: '친구가 공유한 로그를 확인하고 짧게 반응.',
    how: ['공유된 줄과 **친구의 한마디** 확인', '공유된 줄은 친구의 원문도 함께 표시', '댓글 입력 후 **Comment** 클릭'],
    tip: ['공유된 줄은 하루가 지나면 함께 정리', '댓글은 코드 리뷰처럼 짧게'] },
  { t: '💌 **Send**', why: '친구가 힘든 시간에 맞춰 응원 메시지 전달.',
    how: ['메시지 입력', '시점 선택: 지금 / 1시간 뒤 / 3시간 뒤 / 내일 아침 9시 / 주말 아침 10시', '**Commit** 클릭', '**Sent**에서 전달 상태 확인, 예약은 **예약 취소** 가능'],
    tip: ['친구가 **배포 성공 ✓**을 누르면 "deployed ✓" 표시', '친구가 방해금지를 켜면 도착해도 숨김'] },
  { t: '📅 **Plan**', why: '친구와 일정을 공유하고 합의.',
    how: ['달력에서 날짜 클릭', '종류 선택: **야근** **회식** **출장** **약속** **휴가** **기타** (**기타**는 일정 이름 필수)', '**친구에게 전송** 클릭', '친구가 올린 변경은 **변경사항**에서 **Approve** 또는 **Reject**'],
    tip: ['점선 일정은 승인 대기, 승인되면 실선', '승인된 일정 삭제는 **삭제 요청** (친구 승인 필요)', '승인·거절 결과는 알림으로 와요 (내역은 계속 보관)', '**Weekly Agenda**: 맨 위 칸. 나도 주제를 바로 등록 가능 (등록한 사람이 **해결** 또는 **삭제**, 해결된 것은 기록으로 보관). 항목마다 **Comment**로 둘 다 댓글을 달 수 있고 내 댓글만 삭제'] },
  { t: '📈 **Report**', why: '친구의 한 주를 숫자로 확인.',
    how: ['보기 전용 (요일별 로그 수 표와 3줄 요약)'], tip: ['집계 숫자만으로 작성 (원문 미사용)'] },
  { t: '⚙️ **Settings · 기타**', why: '화면 설정과 알림 안내.',
    how: ['**Theme**: Basic(Light · Dark · Warm Gray · Auto)과 기분 전환용 Special 테마 (이 기기에만 저장)'],
    tip: ['탭 옆 빨간 숫자: 새로 온 항목 (그 탭을 열면 사라짐, **Plan**은 처리할 때까지 유지)', '다른 탭을 보는 중 새 항목이 오면 화면 아래에 짧은 안내', '어제 공유된 줄·리뷰·전달된 메시지는 새벽 4시 기준 자동 정리'] },
  { t: '🙂 **상태 표시**', why: '지금 내 상태를 이모지로 알리고, 상대의 상태를 확인.',
    how: ['화면 맨 위 **0** 칩을 눌러 이모지와 한마디 선택 후 **Save**', '**1** 칩을 누르면 상대의 상태 확인', '**Clear**로 상태 지우기'],
    tip: ['상대가 상태를 바꾸면 안내와 알림이 와요', '1 칩의 빨간 점은 새로 바뀐 상태 (눌러서 확인하면 사라져요)', '1 칩을 누르면 **React**로 👍 ❤️ 😢 😡 💪 🙏 반응을 남길 수 있어요 (상대가 상태를 바꾸면 반응은 사라져요)'] },
  { t: '💬 **Check in**', why: '친구의 CPU가 올라갔을 때 무슨 일인지 가볍게 물어보기.',
    how: ['**Overview**의 **Check in** 카드에서 **Ask what\'s up** (작성자 CPU가 10% 이상일 때)', '친구의 답장은 같은 카드에, 공유된 로그는 **Queue** 탭에서 확인', '물어본 뒤 CPU가 10% 더 쌓이면 다시 물어볼 수 있어요'],
    tip: ['답이 올 때까지는 다시 물어볼 수 없어요', '하루가 바뀌면 처음부터 다시 10%예요'] },
  { t: '🗒 **Syslog**', why: '둘이 자유롭게 글을 남기는 게시판. 시스템 로그처럼 보여서 회사에서도 부담이 적어요.',
    how: ['**Syslog** 탭에서 **new entry** 칸에 글 쓰기 (폰은 누르면 팝업, PC는 여러 줄 가능)', '**Enter**는 줄바꿈, 올리기는 **Post** 또는 **Ctrl/⌘+Enter**', '글을 누르면 열려요 (PC는 오른쪽). 댓글, **Keep**'],
    tip: ['**Notify**로 이 게시판 알림을 끄고 켤 수 있어요', '**Esc**로 엑셀 화면 위장'] },
  { t: '📲 **앱 설치 · 알림**', why: '앱이 꺼져 있어도 상대의 활동을 알림으로 받기.',
    how: ['아이폰은 Safari → **공유** → **홈 화면에 추가**', '홈 화면 앱을 열고 **Settings**의 **Push notifications**에서 **Turn on**'], tip: ['알림은 기기마다 따로 켜야 해요', '알림 문구에는 내용이 들어가지 않아요 ("새 공유 로그가 있어요" 같은 안내만)'] },
];
// **강조** 표기를 하이라이트 태그로 바꾼다 (모두 textContent 기반)
const rich = (t) => t.split(/\*\*(.+?)\*\*/).map((x, i) => (i % 2 ? h('b', { class: 'kw', text: x }) : x));
function openHelp() {
  const items = isWriter() || !S.store ? HELP_W : HELP_L;
  const block = (label, list, ord) => (list && list.length ? [h('div', { class: 'hl', text: label }), h(ord ? 'ol' : 'ul', {}, list.map((x) => h('li', {}, rich(x))))] : []);
  modal({ title: 'Guide', body: h('div', { class: 'help' }, items.map((it) => h('div', { class: 'hi' },
    h('div', { class: 'ht' }, rich(it.t)),
    h('p', { class: 'why' }, h('span', { class: 'hl', text: 'Purpose' }), ' ', rich(it.why)),
    block('Usage', it.how, true), block('Notes', it.tip, false)))), actions: [{ label: 'Close', cls: 'primary' }] });
}

// ───────── 시작 ─────────
document.title = 'Service Monitor — prod-api-02';
applyTheme();
buildShell();
boot();
// 자동 적용이 입력 중이거나 반복 실패로 보류된 새 버전이 있으면, 새로고침 버튼에 점을 띄워서 알린다
startUpdateCheck({ build: BUILD, busy: () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || ''),
  notifyOnly: true,   // 새 버전은 스스로 새로고침하지 않고, 배너·↻ 점·알림으로 알린다 (누르면 적용)
  onStatus: (st) => {
    if (st === 'running' || st === 'hidden' || st === 'offline') return;
    const need = st === 'found' || st === 'busy' || st === 'gave-up' || st === 'waiting';
    if (st === 'current') S.updToast = false;
    if (need !== !!S.updateReady) { S.updateReady = need; renderChrome(); const a = document.activeElement; if (!(a && $('#view')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) renderView(); }   // 배너도 바로 보이게 (입력 중이면 방해하지 않는다)
    if (st === 'found' && !S.updToast) { S.updToast = true; toast('앱이 업데이트됐어요. 새로고침해 주세요'); }
  } });
// 테스트/디버깅용 훅 (화면에는 노출되지 않음)
window.__svcmon = { S, gc: () => gcOnce(), boot, notif: { activityFeed, notifUnread, markRead, markAllRead, newCounts } };
