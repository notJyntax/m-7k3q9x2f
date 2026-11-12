// 앱을 고칠 때마다 맨 위에 한 항목씩 추가한다 (id 는 날짜-순서, 큰 값이 최신).
// items: [종류, 내용] — 종류는 new(새 기능) · change(바뀐 것) · fix(고친 것). 내용은 명사형으로 짧게, 요점만.
export const CL_TAGS = ['new', 'change', 'fix'];
export const CHANGELOG = [
  { id: '2026-11-12-a', date: '11/12', title: 'Commit·알림·정리', items: [
    ['new', 'Commit: 받은 쪽도 답글·하트 가능'],
    ['new', '작성자도 리스너에게 commit 보내기'],
    ['new', '상단바 Notify 스위치 (언제든 알림 켜기·끄기)'],
    ['fix', '읽음 처리한 알림이 다시 새 알림으로 뜨던 문제'],
    ['change', 'Shutdown 버튼 제거, 매일 새벽 4시에 자동 정리·기록'],
    ['fix', 'Deployed ✓ 같은 초록 버튼 글자가 안 보이던 문제'],
    ['new', '상태 바 접기: 맨 위 가운데 ▴/▾ 줄 (이 기기 화면에서만, 새 상태는 점으로 표시)'],
    ['fix', 'Excel 테마: 버튼 뒤 눈금선이 글자를 가리던 문제, restart·clear 같은 너비'],
    ['change', '알림 문구 전체를 영어로 통일 (푸시·Alerts 목록)'],
    ['change', '알림에서 쓰지 않는 긴급 문구 삭제'],
    ['change', 'Commit 답글은 받은 사람만 (보낸 쪽엔 Reply 없음, 재답장 없음)'],
    ['change', 'Alerts 옆 숫자 흔들림 효과 제거'],
    ['change', '답글: 원문 아래 세로선으로 이어 붙여 표시'],
    ['change', '답글 입력칸은 Reply 버튼을 눌러야 열림'],
    ['change', 'Status: 이모지를 바꾸면 한마디가 자동으로 지워짐'],
    ['new', 'Status: 한마디 옆 × 버튼으로 한 번에 지우기'],
    ['change', 'Syslog 글: 최대 20000자 (기존 500자)'],
  ] },
  { id: '2026-11-11-g', date: '11/11', title: 'Syslog', items: [
    ['change', 'Syslog 새 글: 폰은 팝업 입력, PC는 여러 줄(Enter 줄바꿈, Ctrl/⌘+Enter 등록)'],
    ['change', 'Syslog: Urgent·Question 기능 제거'],
    ['fix', '폰에서 글이 늦게 올라가 보이던 문제 (바로 반영, 실패 시 되돌림)'],
    ['fix', '폰 입력칸 16px(확대 방지)·버튼 크게, 쓰던 글 임시저장'],
    ['change', '폰 화면: 글자 크기·간격 확대, 12px 미만 글자 제거'],
    ['change', '리뷰 코멘트: 답글과 같은 줄 모양, 본인 코멘트 Edit·Delete'],
    ['change', '하트 버튼 작은 아이콘형, Reply·Comment 버튼 같은 모양'],
  ] },
  { id: '2026-11-11-f', date: '11/11', title: 'Readability · Icons · Themes', items: [
    ['change', 'Edit · Delete · Keep · Resolve · Share · Copy: 아이콘 버튼'],
    ['change', '댓글 줄: 윗줄 정보 + 오른쪽 고정 버튼 칸, 내용은 전체 폭'],
    ['fix', '모든 테마 글자 대비 보정 · 11px 미만 글자 제거'],
    ['change', 'Special 테마: Terminal · Excel만 유지'],
  ] },
  { id: '2026-11-11-e', date: '11/11', title: 'Update notice · Report', items: [
    ['new', '앱 업데이트 안내: 상단 배너 + ↻ 빨간 점 (자동 새로고침 없음)'],
    ['change', 'Report: 오늘 요일 강조, 날짜별 상태는 색 표시'],
  ] },
  { id: '2026-11-11-d', date: '11/11', title: 'Report · Alignment', items: [
    ['change', 'Report: 날짜·요일 칸 분리, 줄 높이·열 정렬 통일'],
    ['new', 'Report: 오늘 요일 강조 · 날짜별 상태 색 · 범례'],
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
