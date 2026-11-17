// 미니룸: 두 사람(픽셀 캐릭터)과 고양이 두 마리(턱시도·태비)가 늘 같이 사는 작은 방.
// 창밖 하늘·스탠드·방 밝기는 실제 시각을 따르고, 벽시계도 실제 시각을 가리킨다.
// 화면을 다시 그려도 방이 처음부터 다시 시작하지 않도록, canvas 하나를 만들어 두고 계속 옮겨 붙여 쓴다 (app.js 의 roomCard).
// 내 캐릭터가 왼쪽, 상대가 오른쪽. 여자 = 리스너, 남자 = 작성자 (app.js 에서 정한다).

const pad = (rows, w) => rows.map((r) => (r + '.'.repeat(w)).slice(0, w));
// 두 캐릭터는 몸·얼굴 크기가 같다 (16 × 21칸). 눈은 8·9번째 줄.
const GIRL = pad(['.....HHHHHH.....', '...HHHHHHHHHH...', '..HHHHhHHHhHHH..', '.HHHHHHHHHHHHHH.', '.HHHHhHHHHhHHHH.', 'HHHHHHHHHHHHHHHH', 'HHHSSHHSSHHSSHHH',
  'HHSSSSSSSSSSSSHH', 'HHSSESSSSSSESSHH', 'HHSSESSSSSSESSHH', 'HHSBBSSSSSSBBSHH', 'HH.SSSSSSSSSS.HH', 'HH..MMMMMMMM..HH', 'HH.MmMMmMMmMMM.H', 'H.MMmMMmMMmMMMM.',
  '..SMMMMMMMMMMMS.', '...mmmmmmmmmm...', '...XXXXXXXXXX...', '..XxXXXXXXXXxX..', '....SS....SS....', '....FF....FF....'], 16);
const BOY = pad(['....hHH.HHh.....', '...HHHHHHHHHH...', '..HhHHHhHHHhHH..', '.HHHHHHHHHHHHHH.', '.HhHHhHHHhHHhHH.', 'HHHHHHHHHHHHHHHH', 'HHHSSHHSSHHSSHHH',
  '.HSSSSSSSSSSSSH.', '.HSSESSSSSSESSH.', '.HSSESSSSSSESSH.', '..SBBSSSSSSBBS..', '...SSSSSSSSSS...', '....KKKKKKKK....', '...KkKKkKKkKKK..', '..KKkKKkKKkKKKK.',
  '..SKKKKKKKKKKKS.', '...kkkkkkkkkk...', '....PPPPPPPP....', '....PPP..PPP....', '....PPP..PPP....', '....FF....FF....'], 16);
const TUX = pad(['.KK......KK.....', '.KPK....KPK.....', '.KKKKKKKKKK.....', '.KKKKKKKKKKK....', '.KKEKKKKEKK...KK', '.KKWWNWWKKK...K.', '.KBWWWWWWBKK.KK.', '..KKWWWWKKKKKK..', '..KKWWKKKKKKKK..', '..WW.WW...WW.WW.'], 16);
const TAB = pad(['.OO......OO.....', '.OPO....OPO.....', '.OTOTOTOTOO.....', '.OOTOOOTOOOO....', '.OOEOOOOEOO...TO', '.OLLLNLLLOO...O.', '.OOLLLLLLOOO.OT.', '..OTLLLLOTOTOO..', '..OTOOOOTOOTOO..', '..OL.OL...OL.OL.'], 16);
const HEART = ['HH.HH', 'HHHHH', 'HHHHH', '.HHH.', '..H..'], FISH = ['.BBB.B', 'BBBBBB', '.BBB.B'], ZZ = ['ZZZ', '..Z', '.Z.', 'ZZZ'], PLANE = ['W.....', 'WWW...', 'WWWWWW', '.WWW..', '..W...'];
const PG = { H: '#3b3036', h: '#5a4a52', S: '#f7e3dc', B: '#f0a8b2', E: '#1a1416', M: '#eadbc4', m: '#d8c4a6', X: '#b8976f', x: '#c9a982', F: '#3a3134' };   // 베이지 니트 + 진한 베이지 치마
const PB = { H: '#5a4136', h: '#7d5d4c', S: '#f7e3dc', B: '#f0a8b2', E: '#1a1416', K: '#8a5a3c', k: '#a8744f', P: '#e3d2b4', F: '#4a3f45' };  // 곱슬머리 + 갈색 니트 + 베이지 바지
const PT = { K: '#26232a', P: '#e9a9b3', E: '#d8e070', W: '#f4f1ec', N: '#f0a0ae', B: '#f3c0c6' };   // 턱시도
const PA = { O: '#8a7f71', T: '#3e3832', P: '#c99f98', E: '#c8c86a', L: '#d9d0c2', N: '#9a5f57', B: '#d9b0aa' };   // 회갈색 고등어 태비

export function createRoom({ left = 'girl' } = {}) {
  const S = 3, LW = 200, LH = 110, FY = 100;
  // 보이는 부분(배경을 잘라 캐릭터가 크게 보이게). wide = 폰(x 32~152), tight = PC 사이드바처럼 좁은 곳(x 48~136, 캐릭터·고양이 중심)
  const VIEWS = { wide: [32, 40, 120, 68], tight: [48, 56, 88, 50] };
  let [CX, CY, CW, CH] = VIEWS.wide, view = 'wide';
  const canvas = document.createElement('canvas');
  canvas.width = CW * S; canvas.height = CH * S; canvas.style.aspectRatio = `${CW} / ${CH}`; canvas.className = 'room-cv'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Mini room');
  const cx = canvas.getContext('2d'); cx.imageSmoothingEnabled = false;
  const me = left === 'girl' ? { m: GIRL, p: PG } : { m: BOY, p: PB }, them = left === 'girl' ? { m: BOY, p: PB } : { m: GIRL, p: PG };
  const A = { x: 71, y: FY - 21 }, B = { x: 89, y: FY - 21 };
  const mood = { me: '', them: '' };   // 각자 고른 상태 이모지 → 표정·소품 (app.js 가 넣어 준다)
  // 평소에는 가만히: 들썩임·깜박임·걷기 없음. 움직이는 것은 보낸 동작(Kiss·Hug·Pat)뿐
  const st = { cur: 1, busy: false, away: false, hearts: [], la: 0, lb: 0, blushA: false, blushB: false, happy: null, hand: null, spk: null, night: null };
  // 고양이 둘은 사람 오른쪽 바닥에 나란히 앉아 있다 (사람 쪽을 본다)
  const cats = [{ m: TUX, p: PT, x: 107, y: FY - 6, dir: -1 }, { m: TAB, p: PA, x: 120, y: FY - 6, dir: -1 }];
  const R = (x, y, w, h, c, a = 1) => { cx.globalAlpha = a; cx.fillStyle = c; cx.fillRect(x * S, y * S, w * S, h * S); cx.globalAlpha = 1; };
  const spr = (map, pal, x, y, o = {}) => { const w = map[0].length; cx.globalAlpha = o.a ?? 1; map.forEach((row, r) => { for (let c = 0; c < w; c++) { let k = row[o.flip ? w - 1 - c : c]; if (k === '.') continue; if (o.blink && k === 'E' && r === o.er) k = o.bk; const col = o.blush && k === 'B' ? '#ff7f9a' : pal[k]; if (!col) continue; cx.fillStyle = col; cx.fillRect((x + c) * S, (y + r) * S, S, S); } }); cx.globalAlpha = 1; };
  // 테두리: 어두운 배경에서도 검은 고양이가 보이게, 그림 둘레에 1칸 옅은 선
  const sil = (map, x, y, flip, col, a) => { const w = map[0].length; cx.globalAlpha = a; cx.fillStyle = col; map.forEach((row, r) => { for (let c = 0; c < w; c++) { if (row[flip ? w - 1 - c : c] === '.') continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cx.fillRect((x + c + dx) * S, (y + r + dy) * S, S, S); } }); cx.globalAlpha = 1; };
  const mono = (map, col, x, y, a = 1) => { cx.globalAlpha = a; cx.fillStyle = col; map.forEach((row, r) => [...row].forEach((k, c) => { if (k !== '.') cx.fillRect((x + c) * S, (y + r) * S, S, S); })); cx.globalAlpha = 1; };
  const spark = (x, y, col) => { cx.fillStyle = col; [[0, 2], [1, 3], [3, 0], [3, 1], [5, 1], [6, 2]].forEach(([a, b]) => cx.fillRect((x + a) * S, (y + b) * S, S, S)); };
  const isNight = () => st.night ?? (() => { const h = new Date().getHours(); return h < 6 || h >= 19; })();
  // 배경은 "터미널 속 세상": 앱 테마 색(--bg·--line2·--ok …)을 그대로 읽어 선으로만 그린다 (캐릭터·고양이만 제 색)
  let T = null, Tt = 0;
  const tok = () => { const cs = getComputedStyle(canvas), g = (n, f) => cs.getPropertyValue(n).trim() || f;
    return { bg: g('--bg', '#0b0d10'), pn: g('--panel', '#13161b'), p2: g('--panel2', '#181c22'), ln: g('--line', '#232830'), l2: g('--line2', '#2c323c'), tx: g('--text', '#e6e8ec'), sub: g('--sub', '#8b93a1'), mu: g('--mute', '#5d6572'), ac: g('--accent', '#5b9dff'), ok: g('--ok', '#3ecf8e'), wn: g('--warn', '#f5b84d'), cr: g('--crit', '#ff6b6b') }; };
  const box = (x, y, w, h, c, a = 1) => { R(x, y, w, 1, c, a); R(x, y + h - 1, w, 1, c, a); R(x, y, 1, h, c, a); R(x + w - 1, y, 1, h, c, a); };
  const line = (x0, y0, x1, y1, c, a = 1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) R(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), 1, 1, c, a); };
  const txt = (t, x, y, c, px = 5, a = 1) => { cx.globalAlpha = a; cx.fillStyle = c; cx.font = `500 ${px * S}px 'JetBrains Mono', ui-monospace, monospace`; cx.textBaseline = 'top'; cx.fillText(t, x * S, y * S); cx.globalAlpha = 1; };
  function room() {
    if (!T || performance.now() - Tt > 1000) { T = tok(); Tt = performance.now(); }
    const n = isNight(), now = new Date(), hr = now.getHours(), mi = now.getMinutes();
    R(0, 0, LW, LH, T.bg);
    for (let y = 4; y < 62; y += 6) for (let x = 3; x < LW; x += 6) R(x, y, 1, 1, T.l2, 0.55);   // 벽: 점 격자
    R(0, 63, LW, 1, T.l2);   // 바닥선
    for (const y of [68, 75, 84, 96]) R(0, y, LW, 1, T.ok, 0.07 + (y - 64) / 600);   // 바닥: 원근 격자
    for (let x = -100; x <= 300; x += 16) line(92 + (x - 92) * 0.35, 64, x, LH - 1, T.ok, 0.1);
    txt('~/room $', 35, 42, T.mu, 4); if (st.cur) R(56, 43, 2, 3, T.ok, 0.8);   // 프롬프트 + 깜박이는 커서
    // 창 = 터미널 창 (제목줄 + 하늘)
    const wx = 47, wy = 46;
    R(wx, wy, 30, 16, T.pn); box(wx, wy, 30, 16, T.l2); R(wx + 1, wy + 1, 28, 3, T.p2); [T.cr, T.wn, T.ok].forEach((c, i) => R(wx + 2 + i * 3, wy + 2, 2, 1, c, 0.8));
    if (n) { [[5, 8], [19, 9], [9, 12], [25, 12], [14, 6], [4, 13]].forEach(([x, y]) => R(wx + x, wy + y, 1, 1, T.tx, 0.8)); box(wx + 21, wy + 6, 4, 4, T.wn, 0.9); R(wx + 22, wy + 7, 2, 2, T.pn); }
    else { const c = hr >= 17 ? T.wn : T.ac; box(wx + 21, wy + 6, 5, 5, c, 0.9); R(wx + 22, wy + 7, 3, 3, c, 0.25); R(wx + 4, wy + 11, 8, 1, T.sub, 0.6); R(wx + 6, wy + 10, 4, 1, T.sub, 0.6); R(wx + 13, wy + 13, 6, 1, T.sub, 0.5); }
    // 시계 = 숫자 시각
    box(83, 47, 24, 10, T.l2); txt(`${String(hr).padStart(2, '0')}${st.cur ? ':' : ' '}${String(mi).padStart(2, '0')}`, 85.3, 48.6, T.ok, 5);
    // 책장 = 파일들
    R(112, 56, 26, 1, T.l2); [[T.ac, 4, 8], [T.sub, 3, 10], [T.wn, 4, 7], [T.ok, 3, 9], [T.mu, 4, 8]].reduce((x, [c, w, h]) => { box(x, 56 - h, w, h, c, 0.75); R(x + 1, 57 - h, w - 2, h - 2, c, 0.15); return x + w + 1; }, 113);
    box(141, 50, 5, 6, T.l2); line(142, 49, 141, 45, T.ok, 0.8); line(144, 49, 145, 43, T.ok, 0.8); line(143, 49, 143, 42, T.ok, 0.8);
    // 책상 + 모니터 (심전도)
    R(126, 72, 26, 1, T.l2); R(128, 73, 1, 26, T.l2); R(150, 73, 1, 26, T.l2); R(130, 58, 18, 12, T.pn); box(130, 58, 18, 12, T.l2); R(138, 70, 2, 2, T.l2); R(135, 71, 8, 1, T.l2);
    if (st.ecg) { cx.fillStyle = T.ok; [[0, 3], [2, 3], [3, 1], [4, 6], [5, 3], [7, 3], [9, 3], [10, 2], [11, 3], [13, 3], [14, 3]].forEach(([a, b]) => cx.fillRect((132 + a) * S, (60 + b) * S, S, S)); }
    else { R(132, 61, 1, 3, T.ok); R(133, 62, 1, 1, T.ok); R(132, 64, 1, 1, T.ok); if (st.cur) R(135, 64, 3, 1, T.ok); }
    // 스탠드 (밤에는 은은한 빛)
    box(35, 46, 7, 4, T.l2); R(38, 50, 1, 46, T.l2); R(35, 96, 7, 1, T.l2); if (n) { R(32, 42, 14, 18, T.wn, 0.06); R(36, 47, 5, 2, T.wn, 0.5); }
    // 소파
    R(56, 66, 64, 18, T.p2, 0.9); box(56, 66, 64, 10, T.l2); box(58, 76, 60, 8, T.l2); box(54, 70, 4, 14, T.l2); box(118, 70, 4, 14, T.l2); box(60, 67, 18, 5, T.sub, 0.5); box(98, 67, 18, 5, T.sub, 0.5);
    // 러그 = 점선 상자
    for (let x = 52; x < 125; x += 3) { R(x, 92, 2, 1, T.ac, 0.45); R(x, 103, 2, 1, T.ac, 0.45); } for (let y = 92; y < 104; y += 3) { R(52, y, 1, 2, T.ac, 0.45); R(124, y, 1, 2, T.ac, 0.45); } R(53, 93, 71, 10, T.ac, 0.05);
    // 고양이 방석
    R(33, 98, 19, 6, T.p2); box(33, 98, 19, 6, T.l2);
  }
  // ── 상태 이모지 → 표정·소품·자세 (16×21 캐릭터 위에 덧그린다. 눈은 4·11번째 칸, 8·9번째 줄) ──
  const NOTE = ['..XX', '..X.', 'XXX.', 'XX..'], PUFF = ['.XX.', 'XXXX', '.XX.'], VEIN = ['X.X', '.X.', 'X.X'];
  const pose = (md) => ({ slump: ['😮‍💨', '🤒', '😢'].includes(md) ? 1 : 0, blush: ['😄', '😌', '🤒'].includes(md) });
  function face(md, pal, x, y, side) {
    if (!md) return;
    const P = (c, r, col, a = 1) => R(x + c, y + r, 1, 1, col, a), E = pal.E, Sk = pal.S, out = side === 'left' ? -1 : 1;
    const clr = () => [4, 11].forEach((c) => { P(c, 8, Sk); P(c, 9, Sk); });
    const eyes = (pts) => { clr(); pts.forEach(([c, r]) => { P(c, r, E); P(15 - c, r, E); }); };
    const mouth = (col) => { P(7, 11, col); P(8, 11, col); };
    const t = 4;   // 소품(눈물·김·음표)은 움직이지 않는 한 장면으로
    switch (md) {
      case '🙂': mouth('#d08a92'); break;
      case '😄': eyes([[3, 9], [4, 8], [5, 8], [6, 9]]); mouth('#b2475b'); break;
      case '😌': eyes([[3, 8], [4, 9], [5, 9], [6, 8]]); break;
      case '😮‍💨': eyes([[3, 9], [4, 9], [5, 9]]); P(8, 11, '#9b7f7a'); if (t % 24 < 10) mono(PUFF, T.sub, side === 'left' ? x - 4 - (t % 24 >> 1) : x + 16 + (t % 24 >> 1), y + 9, 0.5 - (t % 24) / 24); break;
      case '😡': P(3, 6, E); P(4, 7, E); P(12, 6, E); P(11, 7, E); mouth(E); R(x + 2, y + 7, 12, 5, '#ff4d4d', 0.14); mono(VEIN, T.cr, side === 'left' ? x - 2 : x + 15, y - 1); break;
      case '😢': eyes([[4, 9], [3, 8]]); P(8, 11, '#9b7f7a'); { const tc = side === 'left' ? 4 : 11, ty = 10 + ((t >> 2) % 3); P(tc, ty, '#8fd0ff'); P(tc, ty + 1, '#5fb4f0'); } break;
      case '😰': mouth('#9b7f7a'); R(side === 'left' ? x - 1 : x + 15, y + 4, 2, 2, '#9fd8ff'); P(side === 'left' ? 0 : 15, 3, '#9fd8ff'); break;
      case '🤒': eyes([[3, 9], [4, 9], [5, 9]]); P(9, 11, '#ffffff'); P(10, 11, '#ffffff'); P(11, 11, '#ff5c5c'); R(x + 4, y + 2, 8, 2, '#9fd8ff'); R(x + 4, y + 3, 8, 1, '#7fc0ea'); break;
      case '💻': eyes([[4, 9]]); R(x + 3, y + 8, 10, 4, T.ac, 0.12); R(x + 4, y + 14, 8, 3, '#b9c0c8'); P(7, 15, '#eef1f4'); P(8, 15, '#eef1f4'); R(x + 3, y + 17, 10, 1, '#8b939e'); break;
      case '🍚': { const ch = (t >> 2) & 1; R(x + 5, y + 13, 6, 1, '#ffffff'); R(x + 4, y + 14, 8, 1, '#f4f1ec'); R(x + 5, y + 15, 6, 2, '#f4f1ec'); R(x + 5, y + 15, 6, 1, '#7c9cb8'); (ch ? [[12, 14], [11, 13], [10, 12]] : [[12, 14], [12, 13], [12, 12]]).forEach(([c, r]) => { P(c, r, '#a0743f'); P(c + 1, r, '#a0743f'); }); P(7, 11, ch ? '#b2475b' : '#d08a92'); break; }
      case '🚇': eyes([[4, 9]]); R(x + 4, y - 1, 8, 1, '#2b2d35'); R(x + 2, y, 2, 1, '#2b2d35'); R(x + 12, y, 2, 1, '#2b2d35'); R(x + 1, y + 1, 1, 5, '#2b2d35'); R(x + 14, y + 1, 1, 5, '#2b2d35'); R(x, y + 6, 2, 3, '#3a3d47'); R(x + 14, y + 6, 2, 3, '#3a3d47'); R(x + 9, y + 14, 3, 4, '#1f2228'); R(x + 10, y + 15, 1, 2, T.ac);
        if (t % 30 < 18) mono(NOTE, T.ac, side === 'left' ? x - 6 : x + 17, y + 3 - (t % 30 >> 2), 0.85); break;
      case '☕': eyes([[3, 8], [4, 9], [5, 9], [6, 8]]); { const mx = side === 'left' ? 1 : 10; R(x + mx, y + 14, 4, 3, '#f4f1ec'); R(x + mx + 1, y + 14, 2, 1, '#6b4a3a'); P(side === 'left' ? 0 : 14, 15, '#f4f1ec'); const ph = (t >> 2) % 4; P(mx + 1 + (ph & 1), 12 - ph, T.sub, 0.7); P(mx + 2 - (ph & 1), 10 - ph, T.sub, 0.5); } break;
    }
  }
  // 받는 사람 얼굴: 눈을 감고 웃는다 (‿ ‿)
  const happyEyes = (pal, x, y) => { [4, 11].forEach((c) => { R(x + c, y + 8, 1, 2, pal.S); }); [[3, 8], [4, 9], [5, 9], [6, 8]].forEach(([c, r]) => { R(x + c, y + r, 1, 1, pal.E); R(x + 15 - c, y + r, 1, 1, pal.E); }); };
  const HAND = ['.XX.', 'XXXX', 'XXXX'];
  function draw() {
    if (!canvas.isConnected) return;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, canvas.width, canvas.height); cx.setTransform(1, 0, 0, 1, -CX * S, -CY * S); room();
    const pa = pose(mood.me), pb = st.away ? pose('') : pose(mood.them);
    const ax = A.x + st.la, bx = B.x - st.lb, ay = A.y + pa.slump, by = B.y + pb.slump;
    spr(me.m, me.p, ax, ay, { blush: st.blushA || pa.blush });
    if (st.happy === 'A') happyEyes(me.p, ax, ay); else face(mood.me, me.p, ax, ay, 'left');
    spr(them.m, them.p, bx, by, { blink: st.away, er: 8, bk: 'S', blush: st.blushB || pb.blush, a: st.away ? 0.5 : 1 });
    if (st.happy === 'B') happyEyes(them.p, bx, by); else if (!st.away) face(mood.them, them.p, bx, by, 'right');
    if (st.away) mono(ZZ, T.mu, B.x + 16, B.y - 6);
    for (const k of cats) { sil(k.m, k.x, k.y, k.dir < 0, T.mu, 0.55); spr(k.m, k.p, k.x, k.y, { flip: k.dir < 0 }); }
    if (st.hand) { sil(HAND, st.hand.x, st.hand.y, false, st.hand.ol, 0.9); mono(HAND, st.hand.c, st.hand.x, st.hand.y); }
    if (st.spk) spark(st.spk.x, st.spk.y, '#ffd6a8');
    st.hearts.forEach((hh) => mono(HEART, '#ff7aa8', hh.x, hh.y, hh.a ?? 1));
  }
  // 1초마다: 배경 시계·커서만 (캐릭터·고양이는 그대로)
  const timer = setInterval(() => { st.cur ^= 1; draw(); }, 1000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // fromThem = 상대가 보낸 것 (오른쪽 사람 → 왼쪽 사람). 내가 보낸 것은 왼쪽(나) → 오른쪽(상대)
  const roles = (fromThem) => (fromThem ? { snd: 'B', rcv: 'A' } : { snd: 'A', rcv: 'B' });
  const setLean = (who, v) => { if (who === 'A') st.la = v; else st.lb = v; };
  const blush = (who, v) => { if (who === 'A') st.blushA = v; else st.blushB = v; };
  const headOf = (who) => (who === 'A' ? { x: A.x + st.la, y: A.y } : { x: B.x - st.lb, y: B.y });
  async function leanTo(who, to) { const cur = who === 'A' ? st.la : st.lb, d = Math.sign(to - cur); for (let v = cur; v !== to; v += d) { setLean(who, v + d); draw(); await sleep(60); } }
  return {
    canvas,
    // Kiss: 보낸 사람이 기울여 볼에 쪽 → 받는 사람 볼 옆에서 하트가 떠오르고, 받는 사람은 눈을 감고 볼이 빨개진다
    async kiss(fromThem = false) {
      if (st.busy || st.away) return; st.busy = true; const { snd, rcv } = roles(fromThem);
      await leanTo(snd, 3); blush(rcv, true); st.happy = rcv;
      const h0 = headOf(rcv), hx = rcv === 'B' ? h0.x + 1 : h0.x + 10;
      for (let i = 0; i <= 11; i++) { st.hearts = [{ x: hx, y: h0.y + 8 - i * 2, a: Math.min(1, 1.6 - i / 8) }]; draw(); await sleep(80); }
      st.hearts = []; await sleep(250); st.happy = null; blush(rcv, false); await leanTo(snd, 0); st.busy = false; draw();
    },
    // Hug: 둘이 서로 기울여 꼭 붙고, 둘 다 볼이 빨개지며 머리 위로 하트 셋이 하나씩
    async hug(fromThem = false) {
      if (st.busy || st.away) return; st.busy = true; const { snd, rcv } = roles(fromThem);
      await leanTo(snd, 3); await leanTo(rcv, 2); blush('A', true); blush('B', true); st.happy = rcv;
      const mid = Math.round((A.x + st.la + B.x - st.lb) / 2) + 6;
      for (let i = 0; i < 3; i++) { st.hearts = [...st.hearts, { x: mid - 7 + i * 6, y: A.y - 8 - (i % 2) * 2 }]; draw(); await sleep(260); }
      await sleep(700); st.hearts = []; st.happy = null; blush('A', false); blush('B', false); await leanTo(rcv, 0); await leanTo(snd, 0); st.busy = false; draw();
    },
    // Pat (쓰담쓰담): 보낸 사람이 손을 뻗어 받는 사람 머리 위를 좌우로 세 번 쓰다듬는다. 받는 사람은 눈을 감고 웃는다
    async pat(fromThem = false) {
      if (st.busy || st.away) return; st.busy = true; const { snd, rcv } = roles(fromThem);
      await leanTo(snd, 2); st.happy = rcv; blush(rcv, true);
      const pal = snd === 'A' ? me.p : them.p, h0 = headOf(rcv), path = [3, 5, 7, 9, 7, 5, 3, 5, 7, 9, 7, 5, 3, 5, 7, 9, 7, 5];
      for (const dx of path) { st.hand = { x: h0.x + dx, y: h0.y - 2 + (dx === 3 || dx === 9 ? 1 : 0), c: pal.S, ol: pal.F }; draw(); await sleep(70); }
      st.hand = null; st.spk = { x: h0.x + 4, y: h0.y - 7 }; draw(); await sleep(450);
      st.spk = null; st.happy = null; blush(rcv, false); await leanTo(snd, 0); st.busy = false; draw();
    },
    setView(v) { if (!VIEWS[v] || v === view) return; view = v; [CX, CY, CW, CH] = VIEWS[v]; canvas.width = CW * S; canvas.height = CH * S; canvas.style.aspectRatio = `${CW} / ${CH}`; cx.imageSmoothingEnabled = false; draw(); },
    setAway(v) { st.away = !!v; draw(); },
    setMoods(meEmoji, themEmoji) { mood.me = meEmoji || ''; mood.them = themEmoji || ''; draw(); },
    // 누른 곳이 내 캐릭터인가 / 상대 캐릭터인가
    hit(ev) {
      const r = canvas.getBoundingClientRect(), x = CX + (ev.clientX - r.left) / r.width * CW, y = CY + (ev.clientY - r.top) / r.height * CH;
      const inY = y >= A.y - 3 && y <= A.y + 22;
      return inY && x >= A.x - 1 && x <= A.x + 16 ? 'me' : inY && x >= B.x && x <= B.x + 17 ? 'them' : null;
    },
    destroy() { clearInterval(timer); },
  };
}
