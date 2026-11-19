// 화면 맨 아랫줄 위를 천천히 오가는 고양이 둘 (턱시도·태비). 눌리지 않고(pointer-events 없음) 아무것도 가리지 않는다.
// 폰: 하단 탭바 바로 위 줄 / PC: 왼쪽 메뉴를 뺀 창 맨 아래 (Console 의 입력줄이 있으면 그 위). Settings → Cats 로 끈다 (이 기기에만 저장).
import { lsGet, lsSet } from './util.js';
const pad = (rows, w = 16) => rows.map((r) => (r + '.'.repeat(w)).slice(0, w));
const TUX = pad(['.KK......KK.....', '.KPK....KPK.....', '.KKKKKKKKKK.....', '.KKKKKKKKKKK....', '.KKEKKKKEKK...KK', '.KKWWNWWKKK...K.', '.KBWWWWWWBKK.KK.', '..KKWWWWKKKKKK..', '..KKWWKKKKKKKK..']);
const TAB = pad(['.OO......OO.....', '.OPO....OPO.....', '.OTOTOTOTOO.....', '.OOTOOOTOOOO....', '.OOEOOOOEOO...TO', '.OLLLNLLLOO...O.', '.OOLLLLLLOOO.OT.', '..OTLLLLOTOTOO..', '..OTOOOOTOOTOO..']);
const LEGS = { t: ['..SS.SS...SS.SS.', '.SS..SS..SS..SS.'], a: ['..OL.OL...OL.OL.', '.OL..OL..OL..OL.'] };
const PAL = { t: { K: '#26232a', P: '#e9a9b3', E: '#d8e070', W: '#f4f1ec', N: '#f0a0ae', B: '#f3c0c6', S: '#aeb6c4' }, a: { O: '#8a7f71', T: '#3e3832', P: '#c99f98', E: '#c8c86a', L: '#d9d0c2', N: '#9a5f57', B: '#d9b0aa' } };
const PX = 3;
function svg(which, { sleep = false, closed = false, step = 0 } = {}) {
  const p = PAL[which], body = (which === 't' ? TUX : TAB).map((r) => (sleep || closed ? r.replaceAll('E', which === 't' ? 'K' : 'O') : r)), leg = pad([LEGS[which][step % 2]])[0], rows = [...body, leg, leg];   // 다리는 두 칸 높이
  const rects = rows.flatMap((r, y) => [...r].map((k, x) => (p[k] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${p[k]}"/>` : ''))).join('');
  const z = sleep ? '<text x="12.5" y="2.5" font-size="3.2" fill="#8a94a6" font-family="monospace">z</text>' : '';
  return `<svg viewBox="0 0 16 11" width="${16 * PX}" height="${11 * PX}" shape-rendering="crispEdges" aria-hidden="true">${rects}${z}</svg>`;   // 고정 문자열만 사용
}
export const catsOn = () => lsGet('cats', true) !== false;
let layer = null, timer = 0, cats = [], tick = 0;
export function setCatsOn(on) { lsSet('cats', !!on); if (on) startCats(); else stopCats(); }
const rnd = (a, b) => a + Math.random() * (b - a);
function pick(c) {
  const r = Math.random(), w = c.w, sleepy = w === 't' ? 0.35 : 0.15;
  c.mode = r < sleepy ? 'sleep' : r < sleepy + 0.25 ? 'sit' : 'walk';
  c.until = tick + Math.round(rnd(...(c.mode === 'walk' ? [50, 120] : c.mode === 'sit' ? [35, 80] : [100, 220])));
  if (c.mode === 'walk' && Math.random() < 0.5) c.dir *= -1;
}
function place() {   // 줄의 위치: 폰은 탭바 위, PC 는 메뉴 오른쪽 맨 아래(입력줄이 있으면 그 위)
  const tabs = document.getElementById('tabs'), dock = document.querySelector('.dock');
  if (!tabs) { layer.style.display = 'none'; return; }
  layer.style.display = '';
  const t = tabs.getBoundingClientRect(), phone = window.innerWidth < 760, d = dock && dock.getBoundingClientRect();
  const bottomEdge = phone ? t.top : d && d.height ? d.top : window.innerHeight;
  layer.style.left = (phone ? 0 : t.right) + 'px'; layer.style.right = '0'; layer.style.bottom = Math.max(0, window.innerHeight - bottomEdge) + 'px';
}
function frame() {
  if (!layer || document.hidden) return;
  tick += 1; if (tick % 5 === 0) place();
  const W = layer.clientWidth - 16 * PX, still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const c of cats) {
    if (tick >= c.until && tick >= c.pet) pick(c);
    const other = cats.find((o) => o !== c), near = other && Math.abs(other.x - c.x) < 18 * PX;
    if (c.mode === 'walk' && !still && !near) { c.x += c.dir * 1.6; if (c.x <= 0) { c.x = 0; c.dir = 1; } if (c.x >= W) { c.x = W; c.dir = -1; } }
    else if (c.mode === 'walk' && near) { c.x += c.dir * 0.2; if (tick % 40 === 0) c.dir *= -1; }
    const closed = tick < c.pet, look = `${c.mode}${c.mode === 'walk' ? (tick >> 2) % 2 : 0}${c.dir}${closed ? 'c' : ''}`;
    if (look !== c.look) { c.look = look; c.el.firstChild.style.setProperty('--f', c.dir < 0 ? '1' : '-1'); c.el.firstChild.innerHTML = svg(c.w, { sleep: c.mode === 'sleep', closed, step: (tick >> 2) % 2 }); }
    c.el.style.transform = `translateX(${Math.round(c.x)}px)`;
  }
}
// 쓰다듬기: 누르는 동안 납작하게 눌리고 눈을 감음, 뗄 때마다 다른 도트 반응(음표·별·발자국·물고기)이 떠올랐다 사라진다
const NOTE = ['.###', '.#.#', '.#..', '##..', '##..'], STAR = ['.#.', '###', '.#.'], PAW = ['#.#.#', '.###.', '.###.', '..#..'], FISH = ['..##...#', '########', '..##...#'], DOTS = ['#...#', '.....', '#...#'];
const FX = [
  (w) => [[NOTE, '#3b6fe0', 5, 30, 26], [NOTE, '#f0a530', 4, 56, 36]],
  (w) => [[STAR, '#f0a530', 5, 8, 34], [STAR, '#3b6fe0', 5, 46, 44], [STAR, '#f0a530', 4, 62, 24]],
  (w) => [[PAW, '#9aa6b8', 4, -22, 0], [PAW, '#9aa6b8', 3, 54, 0]],
  (w) => [[FISH, '#6aa7d8', 6, 24, 40]],
];
const NSVG = 'http://www.w3.org/2000/svg';
function sprite(rows, col, s) {
  const e = document.createElementNS(NSVG, 'svg'); e.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`); e.setAttribute('width', rows[0].length * s); e.setAttribute('height', rows.length * s); e.setAttribute('shape-rendering', 'crispEdges');
  rows.forEach((r, y) => [...r].forEach((k, x) => { if (k !== '#') return; const q = document.createElementNS(NSVG, 'rect'); q.setAttribute('x', x); q.setAttribute('y', y); q.setAttribute('width', 1); q.setAttribute('height', 1); q.setAttribute('fill', col); e.append(q); }));
  return e;
}
function fx(c, list, cls) {
  for (const [rows, col, s, x, y] of list) {
    const d = document.createElement('div'); d.className = 'cat-fx ' + cls; d.style.left = x + 'px'; d.style.bottom = y + 'px'; d.append(sprite(rows, col, s)); c.el.append(d); setTimeout(() => d.remove(), 1100);
  }
}
function wire(c) {
  let down = false;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  c.el.addEventListener('pointerdown', (e) => { e.preventDefault(); down = true; c.el.classList.add('press'); c.mode = 'sit'; c.pet = tick + 99999; c.until = c.pet; if (!still()) fx(c, [[DOTS, '#9aa6b8', 4, -10, 6], [DOTS, '#9aa6b8', 4, 50, 6]], 'dots'); });
  const up = () => {
    if (!down) return; down = false; c.el.classList.remove('press'); c.pet = tick + 12; c.until = c.pet;
    let k; do k = Math.floor(Math.random() * FX.length); while (k === c.last && FX.length > 1); c.last = k;
    if (!still()) fx(c, FX[k](c.w), k === 2 ? 'stay' : 'rise');
  };
  c.el.addEventListener('pointerup', up); c.el.addEventListener('pointercancel', up); c.el.addEventListener('pointerleave', up);
}
export function startCats() {
  if (!catsOn() || layer) return;
  layer = document.createElement('div'); layer.className = 'cat-layer'; layer.setAttribute('aria-hidden', 'true');
  cats = [{ w: 't', x: 40, dir: 1 }, { w: 'a', x: 220, dir: -1 }].map((c) => {
    const el = document.createElement('div'); el.className = 'cat'; const inner = document.createElement('div'); el.append(inner); layer.append(el);
    const k = { ...c, el, mode: 'sit', until: 0, look: '', pet: 0, last: -1 }; wire(k); return k;
  });
  document.body.append(layer); place();
  timer = setInterval(frame, 120);
  window.addEventListener('resize', place);
}
export function stopCats() { clearInterval(timer); window.removeEventListener('resize', place); layer?.remove(); layer = null; cats = []; }
