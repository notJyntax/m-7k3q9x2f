// 한탄 → 서버 로그 번역, 통계, 주간 보고서 문구. 모두 이 기기 안의 규칙으로 처리한다 (외부 AI 호출 없음, 완전 무료).
import { assessRisk, CRISIS_RESOURCES } from './safety.js';
import { clamp, sum, lsGet, lsSet, dayKey } from './util.js';
export { assessRisk, CRISIS_RESOURCES };

// PASS = 좋은 말에서 나온 로그. (화면에서 가짜로 흐르는 서버 점검 줄만 INFO 를 쓰고, 기록·통계에는 들어가지 않는다)
export const LEVELS = ['PASS', 'WARN', 'ERROR', 'FATAL'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// ── 번역 ──
const SERVICES = [
  [/상사|팀장|부장|대표|임원|사장|이사|실장|과장|차장/, 'approval-gateway', 'E_UPSTREAM_REVIEW'],
  [/회의|미팅|보고|발표|면담/, 'meeting-scheduler', 'E_MEETING_OVERRUN'],
  [/야근|퇴근|칼퇴|주말|휴가|연차|출근/, 'overtime-daemon', 'E_OFFHOURS_LOCK'],
  [/메일|메신저|슬랙|카톡|연락|전화|알림/, 'mail-relay', 'E_INBOX_FLOOD'],
  [/동료|후배|선배|팀원|옆자리|협업|고객|거래처|클라이언트|민원/, 'peer-sync', 'E_PEER_CONFLICT'],
  [/월급|연봉|성과|평가|승진|보너스/, 'payroll-batch', 'E_REWARD_MISMATCH'],
  [/이직|퇴사|면접|이력서|사직/, 'career-daemon', 'E_CAREER_SIGNAL'],
  [/실수|버그|장애|혼났|깨졌|잘못|책임|꾸중|질책|지적/, 'incident-handler', 'E_BLAME_LOOP'],
  [/회식|술자리|술|노래방|점심|저녁|식사|밥|야식/, 'social-scheduler', 'E_SOCIAL_OVERLOAD'],
  [/졸려|잠|못 ?잤|수면|불면|새벽|꿀잠/, 'sleep-scheduler', 'E_SLEEP_DEBT'],
  [/지하철|버스|출근길|퇴근길|교통|통근|지각|막차/, 'commute-agent', 'E_COMMUTE_DELAY'],
  [/일이|업무|일정|마감|데드라인|프로젝트|할 ?일|바빠|많아/, 'task-queue', 'E_QUEUE_OVERFLOW'],
];
const FATAL_RE = /퇴사|그만\s*두|못\s*참|폭발|미치|돌아버|끝났|죽겠|터졌|터질/;
const ERROR_RE = /화나|화가|짜증|빡|열받|열 받|싫|억울|어이없|황당|무시|욕|왜 이래|진짜|너무/;
const WARN_RE = /피곤|힘들|답답|귀찮|걱정|불안|지쳐|지친|부담|한숨|스트레스/;
const ANGER_RE = /화나|화가|짜증|빡|열받|열 받|싫|억울|어이없|황당|무시|욕|왜 이래|어이가|꼴 보기/;
const TIRED_RE = /피곤|피로|힘들|지쳐|지친|지치|답답|귀찮|걱정|불안|부담|한숨|스트레스|졸려|멍|우울|무기력|막막/;

const MOCK = {
  INFO: ['Request latency noted (latency=1.8s)', 'Minor discomfort signal received, no action needed', 'Anomalous pattern logged (count=1)', 'Response time slower than usual (p50=+{n}00ms)', 'Low-priority warning raised, auto-ignored'],
  WARN: ['Approaching threshold 80% (queue={n}/10)', 'Repeated request detected (retry={n}), backoff applied', 'Response delay accumulating (p95={n}s), still monitoring', 'Memory usage trending up (+{n}%/h)', 'Retry queue starting to back up (pending={n})', 'Handler time increasing, throttling under review'],
  ERROR: ['Request rejected {n} times (status=409), upstream response delayed', 'Out-of-scope request received (scope_creep=true, count={n})', 'Timeout (30s), patience pool draining (pool={n}/10)', 'Exception: same issue reproduced (occurrences={n}), no stack trace', 'Upstream connection lost, auto-reconnect failed (attempt={n})', 'Queue overflow, requests dropped (dropped={n})'],
  FATAL: ['Core thread halted: patience pool exhausted (pool=0/10)', 'Near OOM: mental memory {n}0%, restart recommended', 'Unhandled exception: cannot absorb more, isolate service', 'Heartbeat lost: no response ({n} in a row), trying failover', 'Fatal error: cannot keep running normally, manual action needed'],
};
// 주제(서비스 코드)별 문구: 같은 말이 반복되지 않게 섞는다
const THEMED = {
  E_UPSTREAM_REVIEW: ['Approval request rejected {n} times (reason=rework)', 'Waiting on approval chain (pending={n}d)', 'Deploy blocked by delayed upstream sign-off'],
  E_MEETING_OVERRUN: ['Meeting session over planned time (overrun=+{n}0min)', 'Unnecessary sync call detected (could have been an email)', 'Schedule conflict: {n} sessions booked in the same slot'],
  E_OFFHOURS_LOCK: ['Off-hours work request received (off_hours=true)', 'Clock-out process delayed {n} times', 'Rest scheduler could not start, slot occupied'],
  E_INBOX_FLOOD: ['Inbound queue surge (unread={n}0), no filter rules', 'Notification flood detected (rate={n}0/min)', '{n} urgent flags, all confirmed non-urgent'],
  E_PEER_CONFLICT: ['Sync conflict (merge conflict, files={n})', 'Peer service mismatch: requirements differ per request', 'Peer service is not honoring the agreed interface'],
  E_REWARD_MISMATCH: ['Reward calculation mismatch (expected != actual)', 'Performance metrics do not match outcomes (diff={n}%)', 'Batch result validation failed: reward below expectation'],
  E_QUEUE_OVERFLOW: ['Task queue over limit (pending={n}0 / limit=10)', '{n} tasks in flight, not enough workers', 'Deadline timer about to expire (deadline-{n}h)'],
  E_LOAD_SPIKE: ['Load spike detected, cause unknown (load={n}.{n})', 'Throughput {n}x normal, autoscale unavailable'],
  E_CAREER_SIGNAL: ['Career process polling alternatives (interval={n}min)', 'Exit signal received, graceful shutdown under consideration', 'Long-term retention check failed (score={n}/10)'],
  E_BLAME_LOOP: ['Blame propagated downstream (hops={n}), root cause unresolved', 'Postmortem turned into trial (blameless=false)', 'Same incident reviewed {n} times, no action items'],
  E_SOCIAL_OVERLOAD: ['Social event scheduled outside business hours (attendance=forced)', 'Energy cost of event exceeds budget (cost={n}0%)', 'Optional event flagged mandatory, opt-out denied'],
  E_SLEEP_DEBT: ['Rest cycle skipped (sleep_debt={n}h), recovery pending', 'Standby mode refused, wake lock held', 'Nightly maintenance window shortened to {n}h'],
  E_COMMUTE_DELAY: ['Commute link degraded (delay=+{n}0min), reroute failed', 'Transit queue saturated, boarding retry={n}', 'Round trip consumed {n}h of capacity before startup'],
};
let lastMsg = '';
const fill = (s) => s.replace('{n}', rnd(2, 9)).replace('{n}', rnd(2, 9));
function pickMsg(level, code) {
  const pool = [...MOCK[level], ...(THEMED[code] || []), ...(THEMED[code] || [])];
  for (let i = 0; i < 6; i += 1) { const m = fill(pick(pool)); if (m !== lastMsg) { lastMsg = m; return m; } }
  return fill(pick(pool));
}

// ── 긍정적인 말은 부정적인 로그로 바꾸지 않는다 ──
// "너무/진짜" 같은 강조어는 감정이 아니므로 판단에서 뺀다. "안 좋다", "힘들지 않았다" 같은 부정 표현도 구분한다.
const POS_RE = /좋|행복|기쁘|기뻐|뿌듯|고마|감사|재밌|재미있|즐겁|즐거|웃|신나|신난|설레|설렌|최고|대박|성공|잘\s*됐|잘\s*끝|잘\s*풀|다행|편하|편했|편해|편안|평온|안도|칭찬|인정받|승진|보너스|맛있|맛났|든든|따뜻|여유|상쾌|개운|힐링|푹\s*잤|칼퇴|일찍\s*퇴근|해결됐|해결됨|완료|끝냈|도와줘|도움\s*받/;
const NEG_RE = /화나|화가|짜증|빡|열받|열 받|싫|억울|어이없|황당|무시|욕|피곤|피로|힘들|답답|귀찮|걱정|불안|지쳐|지친|지치|부담|한숨|스트레스|우울|무기력|막막|퇴사|그만\s*두|못\s*참|폭발|미치|돌아버|죽겠|터졌|터질|지옥|최악|별로|망했|망함|아쉽|속상|슬프|외롭|무서|두렵|졸려|혼났|꾸중|질책|지적/;
// 긍정처럼 보이지만 사실은 부정인 표현 (안 좋다, 재미없다, 좋은 게 없다 …)
const NOT_POS_RE = /(안|못|별로|전혀|하나도)\s*(좋|기쁘|행복|재밌|즐겁|괜찮|편하|뿌듯)|좋지\s*(않|못)|재미\s*없|맛\s*없|좋은\s*(게|거|것|일)?\s*(하나도|전혀|별로)?\s*없|기쁘지\s*않|행복하지\s*않/;
// 부정처럼 보이지만 사실은 긍정인 표현 (안 힘들었다, 힘들지 않았다 …)
const NOT_NEG_RE = /(안|하나도|전혀)\s*(힘들|피곤|짜증|지치|지쳤|답답|걱정|불안)|(힘들|피곤|짜증|답답|걱정|불안)지\s*(않|도\s*않)/;
export function sentiment(raw) {
  const t = String(raw ?? '');
  const notPos = NOT_POS_RE.test(t);
  const pos = !notPos && POS_RE.test(t) || NOT_NEG_RE.test(t);
  const neg = notPos || NEG_RE.test(t.replace(NOT_NEG_RE, ''));
  return { pos, neg };
}
const OK_CODE = { E_UPSTREAM_REVIEW: 'OK_APPROVED', E_BLAME_LOOP: 'OK_APPROVED', E_MEETING_OVERRUN: 'OK_MEETING', E_OFFHOURS_LOCK: 'OK_ON_TIME', E_PEER_CONFLICT: 'OK_PEER',
  E_REWARD_MISMATCH: 'OK_PAID', E_QUEUE_OVERFLOW: 'OK_QUEUE_CLEARED', E_SOCIAL_OVERLOAD: 'OK_SOCIAL', E_SLEEP_DEBT: 'OK_RESTED', E_COMMUTE_DELAY: 'OK_COMMUTE' };
const MOCK_POS = ['Health check passed (status=healthy)', 'All checks green, no action needed', 'Throughput above baseline (+{n}0%)', 'Latency improved (p95=-{n}00ms)', 'Error rate 0.0%, running smoothly', 'Mood sensor reading nominal (status=good)', 'Positive signal received, logged for the record'];
const THEMED_POS = {
  OK_APPROVED: ['Approval granted on first review', 'Upstream sign-off received (turnaround=fast)', 'Code review passed with no blocking comments'],
  OK_MEETING: ['Meeting finished ahead of schedule (saved {n}0min)', 'Sync call productive (action_items=resolved)'],
  OK_ON_TIME: ['Clock-out on schedule (off_hours=false)', 'Rest scheduler started on time'],
  OK_PEER: ['Peer sync clean (merge conflicts=0)', 'Peer service honoring the agreed interface'],
  OK_PAID: ['Reward calculation matches expectations', 'Batch validation passed: reward above expectation'],
  OK_QUEUE_CLEARED: ['Task queue drained (pending=0)', 'Deadline met with margin (+{n}h)'],
  OK_SOCIAL: ['Fuel level restored (meal=ok)', 'Social sync completed, morale +{n}'],
  OK_RESTED: ['Rest cycle completed (sleep_debt=0h)', 'Standby mode entered, recovery on track'],
  OK_COMMUTE: ['Commute link healthy (delay=0)', 'Arrived early, boarding retry=0'],
};
function positiveLine(t) {
  const [, service, errCode] = SERVICES.find(([re]) => re.test(t)) || [null, 'workload-svc', 'E_LOAD_SPIKE'];
  const code = OK_CODE[errCode] || 'OK_NOMINAL';
  const pool = [...MOCK_POS, ...(THEMED_POS[code] || []), ...(THEMED_POS[code] || [])];
  let msg = fill(pick(pool));
  for (let i = 0; i < 6 && msg === lastMsg; i += 1) msg = fill(pick(pool));
  lastMsg = msg;
  // 좋은 말은 스트레스(짜증·피로) 점수를 올리지 않고, CPU 막대의 초록 구간(pos)으로만 쌓인다
  const hits = (t.match(new RegExp(POS_RE.source, 'g')) || []).length;
  return { level: 'PASS', service, code, msg, cpu: 0, mem: 0, disk: 0, pos: clamp(4 + Math.max(0, hits - 1) * 2, 4, 8), via: 'rules' };
}

export function mockTranslate(raw) {
  const t = String(raw);
  const sm = sentiment(t);
  if (sm.pos && !sm.neg) return positiveLine(t);          // 좋은 말: PASS, 짜증·피로 점수 0
  let level = FATAL_RE.test(t) ? 'FATAL' : ERROR_RE.test(t) ? 'ERROR' : WARN_RE.test(t) ? 'WARN' : t.length > 80 ? 'ERROR' : 'WARN';
  if (sm.pos && sm.neg && level !== 'FATAL') level = 'WARN';  // 좋은 말과 힘든 말이 섞이면 가볍게
  const [, service, code] = SERVICES.find(([re]) => re.test(t)) || [null, 'workload-svc', 'E_LOAD_SPIKE'];
  const w = { PASS: 0, WARN: 3, ERROR: 6, FATAL: 9 }[level];
  // 짜증·화 → CPU(인내심)가 크게, 피로·불안 → MEM(멘탈)이 크게, 둘 다/둘 다 아니면 비슷하게
  const anger = ANGER_RE.test(t), tired = TIRED_RE.test(t);
  const hi = () => clamp(w + rnd(0, 2), 0, 10), lo = () => clamp(Math.round(w * 0.4) + rnd(-1, 1), 0, 10), mid = () => clamp(Math.round(w * 0.8) + rnd(-1, 1), 0, 10);
  const [cpu, mem] = anger && !tired ? [hi(), lo()] : tired && !anger ? [lo(), hi()] : [mid(), mid()];
  return { level, service, code, msg: pickMsg(level, code), cpu, mem, disk: clamp(w - 1 + rnd(0, 2), 0, 10), via: 'rules' };
}

// ── 자동 분류 고치기: 작성자가 레벨(PASS/WARN/ERROR/FATAL)만 직접 바꾼다. 서비스는 그대로 두고 코드·문구·점수를 새 레벨에 맞게 다시 만든다 ──
const CODE_OF = Object.fromEntries([...SERVICES.map(([, s, c]) => [s, c]), ['workload-svc', 'E_LOAD_SPIKE']]);
export function reclassify(l, { level }) {
  if (!LEVELS.includes(level) || level === l.level) return null;
  const errCode = CODE_OF[l.service] || (String(l.code).startsWith('OK_') ? 'E_LOAD_SPIKE' : l.code);
  if (level === 'PASS') { const code = OK_CODE[errCode] || 'OK_NOMINAL'; return { level, code, msg: fill(pick([...MOCK_POS, ...(THEMED_POS[code] || [])])), cpu: 0, mem: 0, disk: 0, pos: 4 }; }
  const w = { WARN: 3, ERROR: 6, FATAL: 9 }[level];
  return { level, code: errCode, msg: pickMsg(level, errCode), cpu: clamp(w + rnd(-1, 1), 0, 10), mem: clamp(w + rnd(-1, 1), 0, 10), disk: clamp(w - 1 + rnd(0, 1), 0, 10), pos: 0 };
}

const CANNED = {
  WARN: ['Approaching threshold (load=0.82)', 'Fatigue building up, cause unknown, tracing'],
  ERROR: ['Repeated request rejections (status=409, retry=4)', 'Handler exception: emotion processing limit exceeded'],
  FATAL: ['Core process not responding (pool=0/10)', 'Fatal error: immediate restart required'],
};
export function quickLine(level) {
  const w = { WARN: 3, ERROR: 6, FATAL: 9 }[level];
  return { level, service: 'workload-svc', code: 'E_MANUAL_FLAG', msg: pick(CANNED[level]), cpu: w, mem: w - 1, disk: Math.max(1, w - 2), via: 'quick' };
}
export const crisisLine = () => ({ level: 'FATAL', service: 'safety-monitor', code: 'E_CHECK_IN', msg: 'Signal needs a human check (auto-conversion skipped)', cpu: 9, mem: 9, disk: 6, via: 'safety' });

/** 한 줄 입력을 로그로 바꾼다. (예전 AI 변환 자리를 규칙 기반이 대신한다) */
export async function translate(raw) { return mockTranslate(raw); }

// ── 통계 ──
export function statFromLogs(logs) {
  const c = { PASS: 0, WARN: 0, ERROR: 0, FATAL: 0 };
  for (const l of logs) if (c[l.level] != null) c[l.level] += 1;
  return { ...c, cpu: sum(logs, (l) => l.cpu), mem: sum(logs, (l) => l.mem), disk: sum(logs, (l) => l.disk), pos: sum(logs, (l) => l.pos) };
}
export const sameStat = (a, b) => !!a && !!b && ['PASS', 'WARN', 'ERROR', 'FATAL', 'cpu', 'mem', 'disk'].every((k) => (a[k] | 0) === (b[k] | 0));
export const levelOf = (cpu, mem, fatal) => (fatal >= 3 || Math.max(cpu, mem) >= 80 ? 'red' : Math.max(cpu, mem) >= 50 ? 'yellow' : 'green');
export const STATUS_TEXT = { green: 'All systems operational', yellow: 'Degraded performance', red: 'Major outage' };

// ── 주간 보고서 (집계 숫자만 사용) ──
export function weekSummary(rows) {
  const days = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const tot = { PASS: 0, WARN: 0, ERROR: 0, FATAL: 0 };
  for (const d of days) for (const k of LEVELS) tot[k] += d[k] | 0;
  const incidents = tot.ERROR + tot.FATAL;
  const peak = [...days].sort((a, b) => ((b.ERROR | 0) + (b.FATAL | 0) * 2) - ((a.ERROR | 0) + (a.FATAL | 0) * 2))[0];
  return { days, tot, incidents, peakDay: peak?.day ?? null };
}
export function templateReport(s) {
  if (!s.days.length) return ['이번 주 기록된 이벤트가 없습니다.'];
  const t = s.tot, total = t.PASS + t.WARN + t.ERROR + t.FATAL;
  const out = [`이번 주 총 ${total}건 중 장애 ${s.incidents}건 (ERROR ${t.ERROR}, FATAL ${t.FATAL}), 경고 ${t.WARN}건이 기록되었습니다.`];
  if (s.peakDay) {
    const [y, m, d] = s.peakDay.split('-').map(Number);
    out.push(`부하가 가장 컸던 날은 ${m}월 ${d}일(${['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()]})입니다.`);
  }
  out.push(t.FATAL >= 3 ? '권고: 치명 오류가 반복되었습니다. 이번 주 안에 부하를 줄이고 충분한 회복 시간을 확보하는 것을 권고합니다.'
    : t.FATAL > 0 ? '권고: 치명 오류가 있었던 날 이후 최소 하루는 부하를 낮추는 것을 권고합니다.'
    : s.incidents > 0 ? '권고: 장애가 일부 있었으나 치명 수준은 아니었습니다. 주 후반 부하 관리에 유의하세요.'
    : '권고: 현재 수준의 경고는 모니터링을 유지하면 충분합니다.');
  return out;
}

// 주간 보고서를 줄글 대신 항목별로 보여주기 위한 값 (집계 숫자만 사용)
export function reportFacts(s) {
  if (!s.days.length) return null;
  const t = s.tot, total = t.PASS + t.WARN + t.ERROR + t.FATAL;
  let peak = null;
  if (s.peakDay) { const [y, m, d] = s.peakDay.split('-').map(Number); peak = `${m}/${d} (${['일', '월', '화', '수', '목', '금', '토'][new Date(y, m - 1, d).getDay()]})`; }
  const advice = t.FATAL >= 3 ? { tone: 'crit', text: '치명 오류가 반복되었습니다. 이번 주 안에 부하를 줄이고 충분한 회복 시간을 확보하세요.' }
    : t.FATAL > 0 ? { tone: 'crit', text: '치명 오류가 있었던 날 이후 최소 하루는 부하를 낮추세요.' }
    : s.incidents > 0 ? { tone: 'warn', text: '장애가 일부 있었으나 치명 수준은 아니었습니다. 주 후반 부하 관리에 유의하세요.' }
    : { tone: 'ok', text: '현재 수준의 경고는 모니터링을 유지하면 충분합니다.' };
  return { total, tot: t, incidents: s.incidents, peak, advice };
}

// ── 화면용 가짜 대기 로그 (저장되지 않음) ──
const IDLE = [
  ['INFO', 'health-check', 'GET /healthz 200 OK (3ms)'], ['INFO', 'cache-sync', 'refreshed 128 keys in 41ms'],
  ['INFO', 'scheduler', 'job nightly-compact skipped (not due)'], ['INFO', 'metrics', 'flush 64 samples to tsdb'],
  ['INFO', 'auth', 'token refresh ok (ttl=3600s)'], ['INFO', 'gateway', 'upstream pool size=12 healthy=12'],
  ['INFO', 'cdn', 'purge queue empty'], ['INFO', 'db-replica', 'replication lag 0.2s'],
];
const SPECIAL = [
  ...['Coffee level: unknown. Please verify manually.', 'Uptime today: still going. Be proud.', 'Friday is a state of mind. Please keep it running.', 'No incidents detected in the break room.', 'Tip: closing three tabs frees up about three minutes of focus.', 'A cat somewhere just knocked something off a desk. Not your problem.'].map((msg) => ['fortune-svc', 'OK', msg]),
  ...['Have you had some water in the last hour? (no reply needed)', 'Have you eaten today? Just checking in.', 'Shoulders below ears? A quick stretch is free.', 'Take three slow breaths. It takes about 20 seconds.', 'Look at something far away for 20 seconds. Your eyes will thank you.', 'How is your day going so far? (no reply needed)', 'Be kind to yourself today. That is the whole check-in.'].map((msg) => ['wellness-check', 'OK', msg]),
  ...[['We suffer more often in imagination than in reality.', 'Seneca'], ['Men are disturbed not by things, but by the views they take of them.', 'Epictetus'], ['A journey of a thousand miles begins with a single step.', 'Lao Tzu'], ['Life can only be understood backwards; but it must be lived forwards.', 'Kierkegaard'], ['He who has a why to live can bear almost any how.', 'Nietzsche'], ['One must imagine Sisyphus happy.', 'Camus'], ['No man ever steps in the same river twice.', 'Heraclitus'], ['The soul becomes dyed with the colour of its thoughts.', 'Marcus Aurelius'], ['It is not that we have a short time to live, but that we waste much of it.', 'Seneca']].map(([q, who]) => ['philosophy-svc', 'QUOTE', `\u201c${q}\u201d \u2014 ${who}`]),
];
let sinceSpecial = 0, nextSpecial = rnd(10, 12), bag = [];
export const idleLine = () => {
  sinceSpecial += 1;
  if (sinceSpecial >= nextSpecial) {
    sinceSpecial = 0; nextSpecial = rnd(10, 12);
    if (!bag.length) bag = [...SPECIAL].sort(() => Math.random() - 0.5);
    const [service, code, msg] = bag.pop();
    return { level: 'INFO', service, code, msg, idle: true, special: true };
  }
  const [level, service, msg] = pick(IDLE);
  return { level, service, code: 'OK', msg, idle: true };
};
const CODE_GLOSS = {
  E_UPSTREAM_REVIEW: '윗선 결재·검토가 늦어져 답답함', E_MEETING_OVERRUN: '회의가 너무 많거나 길어서 힘듦', E_OFFHOURS_LOCK: '야근·퇴근 지연으로 지침',
  E_INBOX_FLOOD: '메일·메신저가 몰려와 정신없음', E_PEER_CONFLICT: '동료·고객과의 마찰', E_REWARD_MISMATCH: '보상·평가에 대한 불만',
  E_QUEUE_OVERFLOW: '업무량이 넘치고 마감에 쫓김', E_CAREER_SIGNAL: '일을 계속할지 고민이 올라옴', E_BLAME_LOOP: '실수·책임 문제로 위축됨', E_SOCIAL_OVERLOAD: '모임·식사 자리 때문에 에너지가 소모됨', E_SLEEP_DEBT: '잠이 부족해 지침', E_COMMUTE_DELAY: '출퇴근길이 힘듦', E_LOAD_SPIKE: '이유는 모르지만 부담이 확 늘어남', E_MANUAL_FLAG: '이유는 적지 않았지만 힘든 순간이라고 표시함', E_CHECK_IN: '안부를 직접 확인해야 하는 신호',
};
const SERVICE_GLOSS = {
  'approval-gateway': '상사·결재 관련', 'meeting-scheduler': '회의 관련', 'overtime-daemon': '야근·퇴근 관련', 'mail-relay': '메일·메신저 관련',
  'peer-sync': '동료·고객 관련', 'payroll-batch': '보상·평가 관련', 'task-queue': '업무량·마감 관련', 'career-daemon': '진로·이직 고민', 'incident-handler': '실수·책임 관련', 'social-scheduler': '회식·모임 관련', 'sleep-scheduler': '수면 관련', 'commute-agent': '출퇴근 관련', 'workload-svc': '전반적인 업무 부담', 'safety-monitor': '안부 확인',
};
const LEVEL_GLOSS = { PASS: '좋은 일', INFO: '가벼운 불편', WARN: '조금씩 쌓이는 중', ERROR: '꽤 힘든 상태', FATAL: '한계에 가까움' };
/** 공유된 로그 한 줄("hh:mm:ss LEVEL service [CODE] msg")을 쉬운 말로 풀어준다. 원문은 쓰지 않는다. */
const OK_GLOSS = { OK_APPROVED: '결재·칭찬 쪽에서 좋은 일이 있었음', OK_MEETING: '회의가 잘 풀림', OK_ON_TIME: '제시간에 퇴근·휴식함', OK_PEER: '동료·고객과 잘 맞았음', OK_PAID: '보상·평가가 만족스러움',
  OK_QUEUE_CLEARED: '일이 잘 마무리됨', OK_SOCIAL: '식사·모임이 즐거웠음', OK_RESTED: '잘 쉬었음', OK_COMMUTE: '출퇴근이 수월했음', OK_NOMINAL: '기분 좋은 일이 있었음' };
export function gloss(text) {
  const m = String(text).match(/^\S+ (PASS|INFO|WARN|ERROR|FATAL) (\S+) \[([A-Z0-9_]+)\]/);
  if (!m) return '';
  const [, level, service, code] = m;
  if (OK_GLOSS[code]) return `${OK_GLOSS[code]} · 좋은 신호`;
  const what = CODE_GLOSS[code] || SERVICE_GLOSS[service] || '자세한 내용은 친구의 한마디를 참고';
  return `${what} · 강도: ${LEVEL_GLOSS[level]}`;
}
export const fmtLine = (l, hmsStr) => `${hmsStr} ${l.level} ${l.service} [${l.code}] ${l.msg}`;
