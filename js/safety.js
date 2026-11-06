/**
 * 위기 신호 휴리스틱. 가볍게 장난치는 AI 댓글이 달리면 안 되는 글을 걸러낸다.
 * 오탐(너무 넓게 잡기)이 미탐보다 낫기 때문에 보수적으로 잡는다.
 * "힘들어 죽겠다" 같은 관용구는 일부러 포함하지 않는다.
 */
const RISK_PATTERNS = [
  /자살/,
  /죽고\s*싶/,
  /죽어\s*버리고\s*싶/,
  /목숨을?\s*(끊|버리)/,
  /극단적\s*(인\s*)?선택/,
  /자해/,
  /살기\s*(싫|힘들)/,
  /살고\s*싶지\s*않/,
  /(사라지|사라져\s*버리|없어지|없어져\s*버리)고\s*싶/,
  /(사라|없어)져\s*버렸으면/,
  /(죽|뒤져)어?\s*버렸으면/,
  /죽는\s*게\s*(나을|낫)/,
  /삶을\s*끝내/,
  /생을\s*마감/,
  /숨을\s*끊/,
];

export function assessRisk(text) {
  const t = String(text ?? '');
  const hit = RISK_PATTERNS.some((re) => re.test(t));
  return { flagged: hit };
}

/** 사용자에게 보여주는 도움 안내 (한국). 번호는 바뀔 수 있어 README에서 주기적 확인을 안내한다. */
export const CRISIS_RESOURCES = [
  { name: '자살예방 상담전화', phone: '109' },
  { name: '정신건강 위기상담', phone: '1577-0199' },
];
