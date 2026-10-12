# HISTORY: CHARACTER BUILD v4.5 — AI 검토 상태 UX 패치

현재 v4.4가 정상 작동한다면 Firebase/OpenAI 설정은 건드리지 않습니다.

## GitHub에서 교체/추가할 파일

### 기존 파일 교체
- `/index.html`
- `/admin.html`

### 새 파일 추가
- `/student-ui-patch.js`
- `/admin-ui-patch.js`
- `/ui-patch.css`

Commit하면 Vercel이 자동 재배포합니다.

## 변경 내용
- 학생 최종 점검 화면의 AI 안내를 `제출 후 교사 검토 안내`로 명확화
- 관리자 목록에서 제출 완료 + AI 미평가 학생을 `AI 대기` 배지로 표시
- AI 초벌평가 통계 카드에 대기 인원 표시
- 선택 학생 상세 화면에 `AI 초벌평가 대기` 안내 카드 표시
- AI 평가 완료 후 기존 점수 표시 방식은 그대로 유지

`config.js`, `firestore.rules`, Vercel 환경변수, OpenAI API 설정은 수정하지 않습니다.
