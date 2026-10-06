# v4.3 → v4.3.1 관리자 로그인 수정

학생용 익명 Firebase 로그인과 교사용 Google 로그인이 같은 브라우저 저장공간에서 충돌하던 문제를 수정했습니다.

GitHub에서 아래 두 파일만 교체하세요.
- `/admin.js`
- `/styles.css`

`config.js`, Firestore Rules, Vercel 환경변수는 수정할 필요 없습니다.

배포 후 `/admin.html`에서 Google 로그인 버튼을 다시 누르세요.
