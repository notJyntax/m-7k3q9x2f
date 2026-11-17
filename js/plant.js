// 함께 키우는 데이지 (Dashboard 의 Uptime 카드). 그림·도구·반응만 맡고, 저장은 app.js 가 한다 (onCare).
// 터미널 창 안의 도트 화분. 도구(물뿌리개·해·스포이트)가 커서/손가락을 따라다니고, 화분 위에서 누르고 있으면 칸이 찬다.
// 식물은 움직이지 않는다. 반응은 +10 글자(누가 했는지 색), 잎이 잠깐 생기 있게, 끝나면 [ OK ] 줄.
// 막대는 반반: 왼쪽 5칸 = 0(나), 오른쪽 5칸 = 1(상대). 한 사람은 자기 몫(5칸)까지만 채운다.
import { h } from './util.js';

const S = 4, W = 48, H = 36, PX = 24, HALF = 5;
const KINDS = ['water', 'light', 'feed'];
const NAME = { water: 'moisture', light: 'light', feed: 'nutrients' };
const TOOL_KIND = { water: 'water', sun: 'light', feed: 'feed' };
const DONE_WORD = { water: 'watered', light: 'sunlight', feed: 'nutrients' };
const HINTS = { water: '# hold the can over the pot to sprinkle', sun: '# hold the sun above the plant', feed: '# hold the dropper over the soil' };
const CAN = ['.....HHHH.......', '....H....H......', '.BBBBBBBBB....SS', 'HBLLBBBBBB...SS.', 'HBLBBBBBBBSSSS..', 'HBBBBBBBBBS.....', '.BBBBBBBBB......', '.DDDDDDDDD......', '..DDDDDDD.......'];
const SUN = ['.....Y.....', '..Y.....Y..', '....YYY....', '...YLLYY...', 'Y.YYLYYYY.Y', '...YYYYY...', '....YYY....', '..Y.....Y..', '.....Y.....'];
const DROPPER = ['..RRR..', '..RRR..', '...R...', '..WWW..', '..WLW..', '..WLW..', '..WLW..', '..WWW..', '...W...'];
// 데이지(둥근 꽃잎 8장 — 물방울 모양, 꽃잎 사이 틈). W 흰 꽃잎 · w 꽃잎 안쪽 크림 · Y 노란 가운데 · h 하이라이트 · d 그늘
const DAISY = ['......W......', '.W...WWW...W.', '..WW.WWW.WW..', '..WW..W..WW..', '....W.w.W....', '.WW..hYY..WW.', 'WWWWwYYYwWWWW', '.WW..YYd..WW.', '....W.w.W....', '..WW..W..WW..', '..WW.WWW.WW..', '.W...WWW...W.', '......W......'];
const DCOL = { W: '#ffffff', w: '#efe7d6', Y: '#f5c542', h: '#ffe7a3', d: '#d9a12b' };
// 그림 위에 한 줄씩 타자로 찍히는 로그(A안). 상태에 맞는 줄을 돌아가며 보여 준다. 26자 이내.
function ambientLines(M) {
  const L = [];
  if (M.wilting) L.push('> warn: soil dry 2d', '> wilt detected, need care');
  const both = KINDS.every((k) => M.mine[k] >= HALF) && KINDS.every((k) => M.theirs[k] >= HALF);
  if (both) L.push('> sync ok: 0+1 done', '> growth job queued');
  else if (KINDS.every((k) => M.mine[k] >= HALF)) L.push('> waiting for 1...');
  else if (KINDS.every((k) => M.theirs[k] >= HALF)) L.push('> 1 done, waiting for 0');
  L.push(M.stage >= 4 ? '> bloom stable' : `> root depth +0.${2 + (M.age % 7)}mm`, '> photosynth ok', `> chlorophyll ${90 + (M.age % 9)}%`, `> uptime ${M.age}d, stage ${M.stage}/4`);
  return L;
}
const hm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function createGarden({ onCare, icon }) {
  const cv = h('canvas', { class: 'pl-cv', role: 'img', 'aria-label': 'Daisy' });
  cv.width = W * S; cv.height = H * S;
  const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
  const scene = h('div', { class: 'pl-scene' }, cv);
  const cells = {}, vals = {};
  const stat = (k) => { cells[k] = h('div', { class: 'pl-cells' }); vals[k] = h('em', { text: '0%' }); return h('div', { class: 'pl-stat' }, h('span', { text: NAME[k] }), cells[k], vals[k]); };
  const meta = h('div', { class: 'pl-meta' }), today = h('div', { class: 'pl-today' }), log = h('div', { class: 'pl-log' }), hint = h('div', { class: 'pl-hint', text: HINTS.water });
  const ops = Object.keys(HINTS).map((t, i) => h('button', { type: 'button', class: 'op' + (i ? '' : ' on'), 'data-tool': t, on: { click: () => pick(t) } }, h('kbd', { text: String(i + 1) }), t));
  const who = [0, 1].map((u) => h('span', { class: 'pl-who u' + u }, h('i'), String(u)));
  // 접기: 이 기기에서만 기억 (접으면 제목 줄에 단계·나이만)
  const FOLD = 'svcmon.plant.fold';
  let folded = false; try { folded = localStorage.getItem(FOLD) === '1'; } catch { /* 없음 */ }
  const sum = h('span', { class: 'pl-sum' }), chev = h('span', { class: 'pl-chev' });
  const setFold = (v) => { folded = v; el.classList.toggle('folded', v); hd.setAttribute('aria-expanded', String(!v)); hd.title = v ? 'Show uptime' : 'Hide uptime'; chev.replaceChildren(icon ? icon(v ? 'chevD' : 'chevU') : (v ? '+' : '−')); try { localStorage.setItem(FOLD, v ? '1' : '0'); } catch { /* 없음 */ } };
  const hd = h('button', { type: 'button', class: 'pl-hd', on: { click: () => setFold(!folded) } }, chev, h('h3', { text: 'Uptime' }), h('span', { class: 'sp' }), sum, ...who);
  const el = h('div', { class: 'pl' },
    hd,
    h('div', { class: 'pl-term' },
      h('div', { class: 'pl-tt' }, h('b', { class: 'r' }), h('b', { class: 'y' }), h('b', { class: 'g' }), h('span', { text: 'garden@prod-api-02: ~/daisy' })),
      h('div', { class: 'pl-in' },
        h('div', { class: 'pl-body' }, scene, h('div', { class: 'pl-stats' }, ...KINDS.map(stat), meta, today)),
        h('div', { class: 'pl-cmd', role: 'toolbar', 'aria-label': 'Care' }, h('span', { class: 'ps', text: '~/daisy $' }), ...ops, h('span', { class: 'caret' })),
        hint),
      log));
  setFold(folded);

  let M = { stage: 0, age: 0, wilting: false, mine: { water: 0, light: 0, feed: 0 }, theirs: { water: 0, light: 0, feed: 0 }, log: [], canWrite: false };
  const amb = { i: 0, n: 0, hold: 0, gap: 20 };   // 타자 로그 상태
  const st = { tool: 'water', down: false, ptr: null, pend: { water: 0, light: 0, feed: 0 }, drops: [], pops: [], glow: 0, rays: 0, wet: 0, ok: null, tick: 0 };
  let T = null, Tt = 0;   // 색은 터미널 창 안(항상 어두움)에서 읽는다
  const tok = () => { const cs = getComputedStyle(cv), g = (n, f) => cs.getPropertyValue(n).trim() || f; return { sky: g('--pl-sky', '') || g('--bg', '#0b0d10'), ol: g('--pl-ol', ''), bg: g('--bg', '#0b0d10'), l2: g('--line2', '#2c323c'), ln: g('--line', '#232830'), ok: g('--ok', '#3ecf8e'), warn: g('--warn', '#f5b84d'), ac: g('--accent', '#5b9dff'), crit: g('--crit', '#ff6b6b'), tx: g('--text', '#e6e8ec') }; };
  const P = (x, y, c, a = 1) => { cx.globalAlpha = a; cx.fillStyle = c; cx.fillRect(Math.round(x) * S, Math.round(y) * S, S, S); cx.globalAlpha = 1; };
  const R = (x, y, w, hh, c, a = 1) => { cx.globalAlpha = a; cx.fillStyle = c; cx.fillRect(Math.round(x) * S, Math.round(y) * S, w * S, hh * S); cx.globalAlpha = 1; };
  const spr2 = (map, pal, x, y, hx, hy) => map.forEach((row, r) => [...row].forEach((k, c) => { if (k === '.' || !pal[k]) return; cx.fillStyle = pal[k]; cx.fillRect(Math.round(x + (c - hx) * 2), Math.round(y + (r - hy) * 2), 2, 2); }));
  const mine = (k) => Math.min(HALF, M.mine[k] + st.pend[k]);
  const plantTop = () => (29 - [0, 3, 6, 8, 10][M.stage] - (M.stage === 4 ? 10 : 0)) * S;

  // 디자인 D: 화분 = 진행 막대(함께 키운 날만큼 참), 줄기 + 짧은 선 잎, 꽃 = 둥근 데이지. 밝은 테마에서는 흰 부분 둘레에 옅은 테두리
  function sprite(map, col, x0, y0, wilt) {
    const at = (r, c) => map[r] && map[r][c] && map[r][c] !== '.';
    if (T.ol) map.forEach((row, r) => [...row].forEach((k, c) => { if (k === '.') return; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr]) => { if (!at(r + dr, c + dc)) P(x0 + c + dc, y0 + r + dr, T.ol); }); }));
    map.forEach((row, r) => [...row].forEach((k, c) => { if (k === '.') return; let cl = col[k]; if (wilt && (k === 'W' || k === 'w')) cl = '#d6d0c2'; P(x0 + c, y0 + r, cl); }));
  }
  function plant() {
    const wilt = M.wilting, base = 29;
    const leaf = wilt ? '#9aa36e' : st.glow > 0 ? '#5fe3a6' : T.ok, stem = wilt ? '#7c8462' : st.glow > 0 ? '#36b87e' : '#2a9f6c';
    R(PX - 8, 30, 16, 4, T.l2); R(PX - 7, 31, 14, 2, T.bg); R(PX - 7, 31, Math.max(0, Math.round(14 * Math.min(1, M.age / 14))), 2, wilt ? T.warn : T.ok);   // 진행 막대 화분
    if (st.wet > 0) R(PX - 7, 31, 14, 2, '#8fd0ff', 0.25);
    if (M.stage === 0) { P(PX, base, leaf); return; }
    const hgt = [0, 3, 6, 8, 10][M.stage], dr = wilt ? 1 : 0;
    for (let i = 0; i < hgt; i++) P(PX, base - i, stem);
    const top = base - hgt + 1;
    if (M.stage >= 2) { R(PX - 3, base - 2 + dr, 2, 1, leaf); R(PX + 2, base - 4 + dr, 2, 1, leaf); }
    if (M.stage >= 3) R(PX - 3, base - 6 + dr, 2, 1, leaf);
    if (M.stage === 1 || M.stage === 2) { P(PX - 1, top - 1 + dr, leaf); P(PX + 1, top - 1 + dr, leaf); }
    if (M.stage === 3) sprite(['WWW', 'WwW'], { W: '#efe8da', w: '#e2d8c4' }, PX - 1, top - 2 + dr, wilt);
    if (M.stage === 4) sprite(DAISY, DCOL, PX - 6, top - 12 + dr, wilt);
  }
  function draw() {
    if (!cv.isConnected) return;
    if (!T || performance.now() - Tt > 1000) { T = tok(); Tt = performance.now(); }
    R(0, 0, W, H, T.sky);   // 그림 바탕: --pl-sky (테마마다), 없으면 --bg
    for (let y = 2; y < 27; y += 4) for (let x = 2; x < W; x += 4) P(x, y, T.l2, 0.5);
    R(0, 35, W, 1, T.ln);
    if (st.rays > 0 && st.ptr) { const tx = PX * S + 2, ty = plantTop(); for (let i = 1; i < 9; i++) { const t = i / 9; cx.globalAlpha = 0.5 * st.rays; cx.fillStyle = T.warn; cx.fillRect(Math.round(st.ptr.x + (tx - st.ptr.x) * t + (i % 2 ? -3 : 3)), Math.round(st.ptr.y + (ty - st.ptr.y) * t), 2, 2); } cx.globalAlpha = 1; }
    plant();
    st.drops.forEach((d) => { cx.fillStyle = d.c || '#8fd0ff'; cx.fillRect(Math.round(d.x), Math.round(d.y), 2, d.c ? 2 : 3); });
    cx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'; cx.textBaseline = 'top';
    st.pops.forEach((t) => { cx.globalAlpha = t.a; cx.fillStyle = T.ac; cx.fillText(t.s, Math.round(t.x), Math.round(t.y)); cx.globalAlpha = 1; });
    if (!st.ok && amb.s) { const txt = amb.s.slice(0, Math.floor(amb.n)); cx.globalAlpha = 0.8; cx.fillStyle = T.bg; cx.fillRect(4, 4, cx.measureText(amb.s).width + 8, 14); cx.globalAlpha = 1; cx.fillStyle = T.tx; cx.fillText(txt + (amb.n < amb.s.length || st.tick % 16 < 8 ? '_' : ''), 8, 7); }
    if (st.ok) { const L = st.ok, txt = L.s.slice(0, Math.floor(L.n)); cx.globalAlpha = 0.85; cx.fillStyle = T.bg; cx.fillRect(4, 4, cx.measureText(L.s).width + 8, 14); cx.globalAlpha = 1; cx.fillStyle = T.ok; cx.fillText(txt.slice(0, 6), 8, 7); cx.fillStyle = T.tx; cx.fillText(txt.slice(6), 8 + cx.measureText(txt.slice(0, 6)).width, 7); }
    if (st.ptr && M.canWrite) {   // 손가락·커서 자리에 지금 든 도구
      if (st.tool === 'water') spr2(CAN, { H: '#3b6fd1', B: T.ac, L: '#a9c8ff', D: '#3b6fd1', S: T.ac }, st.ptr.x, st.ptr.y + (st.down ? 2 : 0), 15, 2);
      if (st.tool === 'sun') spr2(SUN, { Y: T.warn, L: '#fff3c4' }, st.ptr.x, st.ptr.y, 5, 4);
      if (st.tool === 'feed') spr2(DROPPER, { R: st.down ? '#d65a5a' : T.crit, W: '#cfe3f0', L: T.ok }, st.ptr.x, st.ptr.y, 3, st.down ? 7 : 8);
    }
  }
  // 막대·글자 (반반: 왼쪽 = 0 나, 오른쪽 = 1 상대)
  function paint() {
    for (const k of KINDS) {
      const a = mine(k), b = Math.min(HALF, M.theirs[k]);
      cells[k].replaceChildren(...Array.from({ length: HALF }, (_, i) => h('s', { class: i < a ? 'u0' : '' })), h('i'), ...Array.from({ length: HALF }, (_, i) => h('s', { class: i >= HALF - b ? 'u1' : '' })));
      vals[k].textContent = Math.round((a + b) * 10) + '%';
    }
    const doneMe = KINDS.every((k) => mine(k) >= HALF), doneThem = KINDS.every((k) => M.theirs[k] >= HALF);
    who[0].classList.toggle('on', doneMe); who[1].classList.toggle('on', doneThem);
    const TH = [0, 2, 5, 9, 14], next = TH.find((n) => n > M.age), prev = next ? TH[TH.indexOf(next) - 1] : 14;
    const pct = next ? (M.age - prev) / (next - prev) : 1, SEG = 10, fill = Math.round(pct * SEG);
    meta.replaceChildren(
      h('div', { class: 'pl-m1' }, ...['uptime ', h('b', { text: M.age + 'd' }), ' · stage ', h('b', { text: M.stage + '/4' }), M.wilting ? h('span', { class: 'pl-wilt', text: ' · wilting' }) : ''].filter((x) => x !== '')),
      h('div', { class: 'pl-next' }, h('span', { class: 'lb', text: next ? `next ${M.stage + 1}/4` : 'bloom' }),
        h('span', { class: 'pl-nbar' }, ...Array.from({ length: SEG }, (_, i) => h('s', { class: i < fill ? 'on' : '' }))),
        h('span', { class: 'lf', text: next ? `${next - M.age}d left` : 'done' })));
    // 오늘: 사람마다 한 줄. 다 했으면 done, 아니면 남은 것(water·light·feed)을 배지로
    const row = (u, done, left) => h('div', { class: 'pl-tr' }, h('span', { class: `k u${u}${done ? ' on' : ''}`, text: String(u) }),
      done ? h('span', { class: 'badge ok', text: 'done' }) : [h('span', { class: 'nd', text: 'needs' }), ...left.map((k) => h('span', { class: 'badge warn', text: k }))]);
    today.replaceChildren(h('span', { class: 'lb', text: doneMe && doneThem ? 'today · all 100% → growing' : 'today' }),
      row(0, doneMe, KINDS.filter((k) => mine(k) < HALF)), row(1, doneThem, KINDS.filter((k) => M.theirs[k] < HALF)));
    sum.textContent = `stage ${M.stage}/4 · ${M.age}d${M.wilting ? ' · wilting' : ''}`;
    log.replaceChildren(...(M.log.length ? M.log.slice(0, 6).map((l) => h('div', null, h('span', { class: 't', text: hm(l.ts) }), h('span', { class: 'u' + l.who, text: String(l.who) }), h('span', { text: DONE_WORD[l.k] || l.k }), h('span', { class: 'g', text: `+${l.n * 10}%` })))
      : [h('div', { class: 'pl-empty', text: '# no care yet today' })]));
  }
  const pick = (t) => { st.tool = t; ops.forEach((o) => o.classList.toggle('on', o.dataset.tool === t)); hint.textContent = HINTS[t]; };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; };
  const overPot = () => st.ptr && Math.abs(st.ptr.x - PX * S) < 34 && st.ptr.y < 30 * S;
  scene.addEventListener('pointerdown', (e) => { if (!M.canWrite) return; e.preventDefault(); try { scene.setPointerCapture(e.pointerId); } catch { /* 없음 */ } st.ptr = pos(e); st.down = true; });
  scene.addEventListener('pointermove', (e) => { st.ptr = pos(e); });
  const up = () => {
    if (!st.down) return; st.down = false;
    const k = TOOL_KIND[st.tool], n = st.pend[k];
    if (n > 0) { st.ok = { s: `[ OK ] ${NAME[k]} ${Math.round((mine(k) + Math.min(HALF, M.theirs[k])) * 10)}%`, n: 0, life: 50 }; onCare(k, n); }
  };
  scene.addEventListener('pointerup', up); scene.addEventListener('pointercancel', up);
  scene.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !st.down) st.ptr = null; });
  const onKey = (e) => { if (!el.isConnected || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return; const t = { 1: 'water', 2: 'sun', 3: 'feed' }[e.key]; if (t) pick(t); };
  document.addEventListener('keydown', onKey);
  const add = (k) => { if (mine(k) >= HALF) return; st.pend[k]++; st.glow = 16; st.pops.push({ s: '+10', x: (PX + 9) * S + Math.random() * 6, y: 29 * S, a: 1 }); paint(); };
  const timer = setInterval(() => {
    if (!cv.isConnected) return;
    st.tick++;
    const k = TOOL_KIND[st.tool];
    if (st.down && st.ptr) {
      if (st.tool === 'water') { for (let i = 0; i < 4; i++) st.drops.push({ x: st.ptr.x + 2, y: st.ptr.y + 2, vx: Math.random() * 3.4 - 1.7, v: 0.5 + Math.random() }); st.wet = 40; if (overPot() && st.tick % 3 === 0) add(k); }
      if (st.tool === 'feed') { if (st.tick % 3 === 0) st.drops.push({ x: st.ptr.x, y: st.ptr.y + 2, vx: 0, v: 1, c: T?.ok }); if (overPot() && st.tick % 6 === 0) add(k); }
    }
    if (st.tool === 'sun' && st.down && overPot() && st.ptr.y < plantTop()) { st.rays = Math.min(1, st.rays + 0.2); if (st.tick % 4 === 0) add(k); } else st.rays = Math.max(0, st.rays - 0.1);
    st.drops.forEach((d) => { d.y += d.v; d.v += 0.6; d.x += d.vx || 0; }); st.drops = st.drops.filter((d) => d.y < 30 * S);
    st.pops.forEach((t) => { t.y -= 1.4; t.a -= 0.04; }); st.pops = st.pops.filter((t) => t.a > 0);
    if (st.glow > 0) st.glow--; if (st.wet > 0) st.wet--;
    if (st.ok) { st.ok.n += 1.5; if (--st.ok.life <= 0) st.ok = null; }
    else if (amb.gap > 0) { if (--amb.gap === 0) { const L = ambientLines(M); amb.s = L[amb.i++ % L.length]; amb.n = 0; amb.hold = 70; } }
    else if (amb.s && amb.n < amb.s.length) amb.n += 0.5;
    else if (amb.s && --amb.hold <= 0) { amb.s = null; amb.gap = 30; }
    draw();
  }, 50);
  return {
    el,
    // 저장된 상태가 바뀌면 다시 그린다. 보내는 중인 칸(pend)은 저장값에 들어가면 지운다
    update(model) {
      for (const k of KINDS) if (model.mine[k] !== M.mine[k]) st.pend[k] = Math.max(0, st.pend[k] - Math.max(0, model.mine[k] - M.mine[k]));
      if (!st.down) for (const k of KINDS) if (model.mine[k] + st.pend[k] > HALF) st.pend[k] = Math.max(0, HALF - model.mine[k]);
      M = model; el.classList.toggle('ro', !M.canWrite); paint(); draw();
    },
    sent(k) { st.pend[k] = 0; },
    destroy() { clearInterval(timer); document.removeEventListener('keydown', onKey); },
  };
}
