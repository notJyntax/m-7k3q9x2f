// 작성자 표시: 예전에 만든 픽셀 캐릭터(design/miniroom/room.js 의 GIRL·BOY)의 머리 + 상체 위쪽을 잘라 동그란 프로필로 쓴다.
// 작성자(writer) = 곱슬머리 남자, 리스너(listener) = 긴 머리 여자. 화면의 0·1 이 아니라 실제 역할로 고른다.
const HEAD = {
  listener: { m: ['.....HHHHHH.....', '...HHHHHHHHHH...', '..HHHHhHHHhHHH..', '.HHHHHHHHHHHHHH.', '.HHHHhHHHHhHHHH.', 'HHHHHHHHHHHHHHHH', 'HHHSSHHSSHHSSHHH',
    'HHSSSSSSSSSSSSHH', 'HHSSESSSSSSESSHH', 'HHSSESSSSSSESSHH', 'HHSBBSSSSSSBBSHH', 'HH.SSSSSSSSSS.HH', 'HH..MMMMMMMM..HH', 'HH.MmMMmMMmMMM.H', 'H.MMmMMmMMmMMMM.', '..SMMMMMMMMMMMS.'],
  p: { H: '#3b3036', h: '#5a4a52', S: '#f7e3dc', B: '#f0a8b2', E: '#1a1416', M: '#f6b8c6', m: '#eb9cb0' } },   // 리스너: 분홍 니트
  writer: { m: ['....hHH.HHh.....', '...HHHHHHHHHH...', '..HhHHHhHHHhHH..', '.HHHHHHHHHHHHHH.', '.HhHHhHHHhHHhHH.', 'HHHHHHHHHHHHHHHH', 'HHHSSHHSSHHSSHHH',
    '.HSSSSSSSSSSSSH.', '.HSSESSSSSSESSH.', '.HSSESSSSSSESSH.', '..SBBSSSSSSBBS..', '...SSSSSSSSSS...', '....KKKKKKKK....', '...KkKKkKKkKKK..', '..KKkKKkKKkKKKK.', '..SKKKKKKKKKKKS.'],
  p: { H: '#5a4136', h: '#7d5d4c', S: '#f7e3dc', B: '#f0a8b2', E: '#1a1416', K: '#8a5a3c', k: '#a8744f' } },
};
const NS = 'http://www.w3.org/2000/svg';
// role: 'writer' | 'listener', num: 화면에 쓰는 0·1 (읽어 주기·배경색용), size: px
export function avatar(role, num, size = 22) {
  const d = HEAD[role] || HEAD.writer;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-1.5 -1.5 19 18.5'); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');   // 머리 + 니트 입은 상체 조금 (아래쪽이 동그라미 끝에 닿게)
  d.m.forEach((row, y) => [...row].forEach((k, x) => {
    if (k === '.' || !d.p[k]) return;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1); r.setAttribute('fill', d.p[k]);
    svg.append(r);
  }));
  const wrap = document.createElement('span');
  wrap.className = 'av u' + num; wrap.style.setProperty('--av', size + 'px'); wrap.title = num === '0' ? '0 (me)' : '1';
  wrap.append(svg);
  return wrap;
}
