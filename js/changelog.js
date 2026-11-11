// 앱을 고칠 때마다 맨 위에 한 항목씩 추가한다 (id 는 날짜-순서, 큰 값이 최신).
// items: [종류, 내용] — 종류는 new(새 기능) · change(바뀐 것) · fix(고친 것). 내용은 명사형으로 짧게, 요점만.
export const CL_TAGS = ['new', 'change', 'fix'];
export const CHANGELOG = [
  { id: '2026-11-11-d', date: '11/11', title: 'Report · Alignment', items: [
    ['change', 'Report: 날짜·요일 칸 분리, 줄 높이·열 정렬 통일'],
    ['new', 'Report: 요일 칩 색 (Calm · Warn · Error · Fatal) + 범례'],
    ['fix', 'Syslog·Console·Archive: 종류·서비스 칸 너비 고정 (열 위치 정렬)'],
  ] },
  { id: '2026-11-11-c', date: '11/11', title: 'Updates · Syslog', items: [
    ['new', 'Updates: 배너 · Inbox 카드 · read 표시 · History'],
    ['change', 'Syslog PC: 목록은 한 줄, 내용은 오른쪽'],
    ['fix', 'Syslog: 글이 자동으로 접히던 문제 (다른 탭으로 갈 때만 접힘)'],
    ['change', '안내 문구 글꼴: 고딕으로 변경'],
  ] },
  { id: '2026-11-11-b', date: '11/11', title: 'Design · Edit · Syslog', items: [
    ['new', 'Theme: Ink · Moss · Dusk · Frost (기존 테마 유지)'],
    ['new', 'Syslog: PC 2단 보기 (목록 + 상세)'],
    ['new', 'Edit: 로그 원문 · Syslog 글/댓글 · 아젠다'],
    ['change', 'Syslog 줄: 시간·종류·작성자·개수 색 구분'],
    ['change', '버튼 색: 파랑 전송 · 초록 해결 · 빨강 삭제 · 노랑 보관'],
    ['change', 'Report: 주간 표 색 · Summary 항목화'],
    ['fix', 'Plan 아젠다: Enter 추가 (한글 입력 포함)'],
  ] },
  { id: '2026-11-11-a', date: '11/11', title: 'Review replies · Level edit', items: [
    ['new', '리뷰 답글 · 하트'],
    ['new', '로그 레벨 Edit'],
    ['change', '알림 문구 정리'],
    ['change', '하트 버튼 스타일 통일'],
  ] },
];
export const latestChangelogId = () => CHANGELOG[0]?.id ?? '';
export const unseenChangelog = (seenId) => CHANGELOG.filter((e) => !seenId || e.id > seenId);
// 메신저에 그대로 붙여 보낼 수 있는 글
export const changelogText = (entries) => entries.map((e) => `■ ${e.date} ${e.title}\n${e.items.map(([k, t]) => `[${k.toUpperCase()}] ${t}`).join('\n')}`).join('\n\n');
