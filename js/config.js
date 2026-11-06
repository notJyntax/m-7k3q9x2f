// 배포할 때 채우는 값. 아래 두 Supabase 값과 VAPID 공개키는 "공개돼도 되는" 값이에요
// (보안은 DB의 접근 규칙이 지켜요). 비밀키(service_role, VAPID 비공개키)는 절대 여기에 넣지 마세요.
// 비워 두면 앱은 "혼자 쓰는(이 기기에만 저장) 모드"로 동작해요.
export const CONFIG = {
  SUPABASE_URL: 'https://zutwkqljnblwlrmbkatw.supabase.co',        // 예: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_BBLg-Wsul-B3g7z7-Nz7EA_TvjBMEmF',   // Project Settings → API → anon public (publishable) key
  VAPID_PUBLIC_KEY: 'BCt63aDdeoQ6ZtnZ5Tb7Cp2YgUSWCCVgTz_RgjC8quXG7IrIgTIcP5m0OQLSt7yxF0wvHBBAicIdQE0l1Wleqtg',    // npm run keys 가 출력하는 공개키 (공개돼도 됨)
};
