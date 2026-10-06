# HISTORY: CHARACTER BUILD v3 — Firebase · GitHub · Vercel · OpenAI 연결 가이드

이 문서는 **처음 한 번만 천천히 따라 하면 되는 설치 설명서**입니다.

구조는 다음과 같습니다.

- 학생 화면: Vercel에서 열림
- 학생 자동저장/제출 데이터: Firebase Authentication + Cloud Firestore
- 학생 캐릭터 이미지: 브라우저에서 약 360KB 이하 JPEG로 압축 → Firestore 별도 문서에 저장
- 교사 관리자: `/admin.html`
- AI 초벌채점: Vercel의 `/api/grade` → OpenAI API
- 코드 보관/업데이트: GitHub

> **중요:** v3는 Firebase Storage를 사용하지 않습니다. 새 Firebase 프로젝트에서 Storage를 쓰려면 현재 Blaze 요금제가 필요하기 때문에, 수업용으로 더 간단하고 비용 부담이 적도록 이미지를 압축해 Firestore에 저장하도록 바꿨습니다.

---

# 0. 가장 먼저 바꿀 파일: `config.js`

파일을 열고 아래 3부분을 기억하세요.

## 0-1. Firebase 값

처음에는 아래처럼 비어 있습니다.

```js
firebaseConfig: {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
}
```

잠시 후 Firebase에서 복사한 값으로 바꿉니다.

## 0-2. 교사 이메일

```js
adminEmail: "teacher@example.com"
```

실제 관리자용 Google 계정으로 변경합니다.

예:

```js
adminEmail: "historyteacher@gmail.com"
```

`firestore.rules` 안의 `teacher@example.com`도 **똑같은 이메일**로 바꿔야 합니다.

## 0-3. 학년도와 활동

```js
activity: {
  academicYear: "2026",
  id: "early-modern-character-01",
  title: "대항해시대~시민혁명 역사 캐릭터 빌드",
  unitLabel: "대항해시대 ~ 시민혁명"
}
```

- 다음 학년도: `academicYear` 변경
- 같은 학년도에 새 활동: `id`를 다른 값으로 변경
- 제목만 수정하고 `id`를 그대로 두면 같은 학생/기기에서 이전 활동 자료와 섞일 수 있으므로 **새 활동마다 id는 반드시 변경**하세요.

예:

```js
academicYear: "2027",
id: "industrial-revolution-01",
title: "산업혁명 역사 캐릭터 빌드",
unitLabel: "산업혁명"
```

과거 제출물은 Firestore에 그대로 남기 때문에 관리자에서 학년도별/활동별로 확인할 수 있습니다.

---

# 1. Firebase 프로젝트 만들기

1. Firebase Console에 접속합니다.
2. **프로젝트 만들기**를 누릅니다.
3. 이름 예시: `history-character-build`
4. Google Analytics는 이 활동에 필수가 아니므로 필요 없으면 끄셔도 됩니다.
5. 프로젝트 생성을 완료합니다.

---

# 2. Firebase 웹 앱 등록

1. Firebase 프로젝트 개요에서 `</>` **웹** 아이콘을 누릅니다.
2. 앱 닉네임 예시: `history-character-web`
3. Firebase Hosting은 체크하지 않아도 됩니다. 우리는 Vercel을 사용합니다.
4. **앱 등록**을 누릅니다.
5. 다음과 비슷한 설정값이 표시됩니다.

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "history-character.firebaseapp.com",
  projectId: "history-character",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};
```

6. 이 값들을 이 프로젝트의 `config.js`에 붙여 넣습니다.

`storageBucket` 값은 v3에서 사용하지 않으므로 없어도 됩니다.

---

# 3. Firebase Authentication 켜기

학생에게 별도의 회원가입을 시키지 않고, 디벗마다 익명 Firebase 계정을 자동 생성합니다.
교사는 Google 로그인으로 관리자 페이지에 들어갑니다.

Firebase Console에서:

1. **Build / Authentication** 이동
2. **Get started**
3. `Sign-in method` 또는 로그인 제공업체 설정으로 이동
4. **Anonymous(익명)** 활성화
5. **Google** 활성화
6. Google 제공업체의 지원 이메일을 선택하고 저장

반드시 두 가지 모두 켜야 합니다.

- Anonymous: 학생
- Google: 교사 관리자

---

# 4. Cloud Firestore 만들기

1. Firebase Console → **Build / Firestore Database**
2. **Create database**
3. 일반적인 `Standard` Firestore를 사용합니다.
4. 위치는 학교와 가까운 위치를 선택하면 됩니다.
5. 처음 규칙 선택 화면이 나오면 생성한 뒤 곧바로 아래 보안 규칙으로 교체할 것이므로 테스트용 전체 공개 규칙을 장기간 사용하지 마세요.

이 프로젝트는 `submissions`와 `submissionImages` 두 컬렉션을 자동으로 만듭니다.
콘솔에서 미리 컬렉션을 만들 필요는 없습니다.

---

# 5. Firestore 보안 규칙 적용

프로젝트 파일에 `firestore.rules`가 있습니다.

먼저 파일 안의:

```text
teacher@example.com
```

을 실제 교사 Google 계정으로 바꿉니다.

예:

```text
historyteacher@gmail.com
```

그 다음:

1. Firebase Console → Firestore Database → **Rules**
2. 기존 내용을 모두 지웁니다.
3. `firestore.rules` 전체 내용을 복사해 붙여 넣습니다.
4. **Publish(게시)**

이 규칙은:

- 학생은 자기 Firebase 익명 UID로 만든 제출물만 읽고 수정 가능
- 교사 Google 계정은 전체 제출물 열람/수정 가능
- 다른 학생 자료는 읽을 수 없음

으로 동작합니다.

---

# 6. 우선 로컬/테스트 모드로 확인하기

Firebase 설정 전에는 학생 페이지 상단에 **테스트 모드**가 표시됩니다.
이때도 화면 흐름은 시험할 수 있지만 데이터는 그 기기의 브라우저에만 저장됩니다.

Firebase 값을 넣은 후에는 상단이 `✓ 저장됨`으로 표시되는지 확인하세요.

학생 테스트 순서:

1. `index.html` 열기
2. STEP 1 → STEP 6까지 가짜 답안 작성
3. 새로고침해도 내용이 남는지 확인
4. STEP 1~4 중 홈 화면/다른 탭으로 갔다가 복귀 → 이탈 기록 토스트 확인
5. 글 잠금 확인창 확인
6. 이미지 없이도 다음 단계 이동 가능한지 확인
7. 이미지 파일을 올리면 자동 압축 후 표시되는지 확인
8. 최종 제출

---

# 7. GitHub에 올리기

## 가장 쉬운 방법: GitHub 웹에서 새 저장소 만들기

1. GitHub → **New repository**
2. 이름 예시: `history-character-build`
3. Private 저장소를 권장합니다.
4. 저장소 생성
5. 이 폴더의 파일과 폴더를 전부 업로드합니다.

반드시 다음도 포함되어야 합니다.

- `api/grade.js`
- `assets/hero-quest.svg`
- `index.html`
- `admin.html`
- `student.js`
- `admin.js`
- `styles.css`
- `config.js`
- `firestore.rules`
- `package.json`
- `vercel.json`

**OpenAI API 키는 어느 파일에도 적지 않습니다. GitHub에 올리면 안 됩니다.**

---

# 8. Vercel에 배포하기

1. Vercel에 로그인
2. **Add New → Project**
3. GitHub 저장소를 선택해 Import
4. Framework Preset이 자동으로 잡히지 않으면 **Other** 선택
5. Root Directory는 저장소 최상위 그대로
6. Build Command는 비워두거나 Vercel 기본값 사용
7. Output Directory도 비워둡니다.
8. Deploy

배포가 끝나면 예를 들어:

```text
https://history-character-build.vercel.app
```

같은 주소가 생깁니다.

학생 주소:

```text
https://history-character-build.vercel.app/
```

교사 주소:

```text
https://history-character-build.vercel.app/admin.html
```

---

# 9. Vercel 주소를 Firebase 승인 도메인에 추가

관리자 Google 로그인에서 매우 자주 빠뜨리는 부분입니다.

Vercel 주소가 정해진 뒤 Firebase Console에서:

1. Authentication
2. Settings
3. Authorized domains / 승인된 도메인
4. Vercel 도메인을 추가

예:

```text
history-character-build.vercel.app
```

`https://`는 넣지 않고 도메인만 넣습니다.

나중에 개인 도메인을 연결했다면 그 도메인도 추가합니다.

---

# 10. OpenAI API 키 만들기 — AI 초벌채점용

AI 초벌평가는 **학생 브라우저가 아니라 Vercel 서버에서만** OpenAI API를 호출합니다.
따라서 API 키가 학생에게 노출되지 않습니다.

1. OpenAI Platform에 로그인
2. API 프로젝트를 만들거나 기존 프로젝트 선택
3. **API Keys**에서 새 프로젝트 API 키 생성
4. 키를 복사해 안전한 곳에 잠시 보관

주의:

- ChatGPT Plus 구독과 OpenAI API 과금은 별개입니다.
- API 키를 `config.js`, GitHub, HTML, JavaScript 클라이언트 코드에 적지 마세요.
- OpenAI Platform에서 사용 한도/알림도 설정해두는 것을 권장합니다.

---

# 11. Vercel에 AI 환경변수 넣기

Vercel 프로젝트 → **Settings → Environment Variables**에서 다음 4개를 등록합니다.

## 필수 1: OPENAI_API_KEY

```text
OPENAI_API_KEY = sk-...본인의 실제 키...
```

## 필수 2: FIREBASE_WEB_API_KEY

`config.js`의 Firebase `apiKey`와 똑같은 값입니다.

```text
FIREBASE_WEB_API_KEY = AIza...
```

이 값 자체는 Firebase 웹 설정에 포함되는 공개 식별자이지만, 서버의 교사 ID 토큰 검증에 사용합니다.

## 필수 3: ADMIN_EMAIL

`config.js`와 `firestore.rules`에 넣은 교사 이메일과 똑같이 씁니다.

```text
ADMIN_EMAIL = historyteacher@gmail.com
```

## 선택 4: OPENAI_MODEL

기본값은 코드에 `gpt-6-luna`로 되어 있습니다.

비용을 아끼면서 여러 학생을 일괄평가할 때:

```text
OPENAI_MODEL = gpt-6-luna
```

좀 더 꼼꼼한 판단을 원할 때:

```text
OPENAI_MODEL = gpt-6.1-sol
```

처음에는 Luna로 시험하고, 실제 학생 답안 5~10개를 직접 채점한 결과와 비교한 뒤 모델을 정하는 것을 권장합니다.

환경변수를 저장한 뒤에는 **Redeploy** 해야 적용됩니다.

---

# 12. AI 초벌평가 시험하기

1. 학생 화면에서 테스트 제출물 1개를 최종 제출
2. `/admin.html` 접속
3. 관리자 Google 로그인
4. 해당 학생 선택
5. **✨ AI 초벌평가 실행**
6. 다음이 표시되는지 확인
   - 역사 사건·사실 정확성 /4
   - 사실↔게임 요소 연결 /3
   - 역사 해석 /2
   - 명료성 /1
   - 총점 /10
   - 잘한 점
   - 보완할 점
   - 교사 확인 필요 여부
7. 교사가 내용을 검토한 뒤 **교사 최종점수**와 피드백을 저장

관리자 상단의 **미평가 제출본 AI 일괄평가** 버튼을 누르면 현재 필터에 보이는 제출 완료 학생 중 AI 점수가 없는 학생만 순서대로 평가합니다.

처음 실제 수업에서는 바로 전원 일괄평가하기보다 3~5명의 답안으로 채점 일관성을 먼저 확인하세요.

---

# 13. AI 채점 기준을 수업에 맞게 조정하기

`config.js`의:

```js
referenceGuide: "..."
```

부분이 AI에게 함께 전달됩니다.

새 단원에서 활동할 때 교과서의 핵심 개념을 3~6줄 정도 넣어주면 좋습니다.

예: 산업혁명

```js
referenceGuide: [
  "평가 범위는 산업혁명의 배경, 기술 혁신, 공장제 기계공업, 도시화와 노동 문제이다.",
  "제임스 와트 개인의 전기보다 증기기관 개선과 산업 변화의 연결을 중점적으로 평가한다.",
  "학생이 수업에서 다루지 않은 세부 사실을 제시하면 확신 없이 감점하지 말고 교사 확인 필요로 표시한다."
].join("\\n")
```

이 방식이면 매번 AI 프롬프트 전체를 고칠 필요가 없습니다.

---

# 14. 학년도별 / 활동별 데이터 관리

제출 데이터에는 자동으로 다음이 저장됩니다.

```text
academicYear
activityId
activityTitle
```

따라서 관리자 화면 위쪽에서:

- 2026학년도
- 2027학년도
- 특정 수행활동

등으로 필터링할 수 있습니다.

새 활동을 열기 전에 `config.js`에서 `activity.id`를 바꾸는 습관만 들이면 됩니다.

### 권장 ID 규칙

```text
2026-early-modern-01
2026-industrial-revolution-01
2027-early-modern-01
```

처럼 해도 좋습니다.

---

# 15. 수업 종료 후 백업

관리자 화면에서:

- 현재 목록 CSV
- 현재 목록 JSON

을 내려받을 수 있습니다.

수행평가 증빙용으로는 학년도/활동이 끝날 때:

1. CSV 다운로드
2. JSON 다운로드
3. 학교의 승인된 저장 공간에 보관
4. 더 이상 필요하지 않은 개인정보는 학교의 보존 기준에 따라 정리

하는 흐름을 권장합니다.

학생 이름/학번은 평가에 필요한 최소 정보만 받도록 되어 있으며 학생 이메일이나 전화번호는 수집하지 않습니다.

---

# 16. 자주 생기는 오류

## A. 학생 화면 상단에 계속 `테스트 모드`

`config.js`의 Firebase 값이 아직 `YOUR_...` 상태인지 확인합니다.

## B. 학생 화면에 `서버 저장 실패`

- Anonymous 인증을 켰는지
- Firestore를 만들었는지
- Firestore Rules를 게시했는지
확인합니다.

## C. 교사 Google 로그인 실패 / unauthorized-domain

Firebase Authentication의 **Authorized domains**에 Vercel 도메인을 추가합니다.

## D. 교사 로그인은 됐는데 자료를 못 읽음 / permission-denied

`config.js`, `firestore.rules`, Vercel의 `ADMIN_EMAIL` 세 곳의 이메일 철자와 대소문자를 확인합니다.

## E. AI 평가 버튼을 누르면 `OPENAI_API_KEY가 설정되지 않았습니다`

Vercel Environment Variables에 `OPENAI_API_KEY`를 넣고 **Redeploy** 합니다.

## F. AI 평가가 `교사 로그인 확인 실패`

Vercel 환경변수의:

- `FIREBASE_WEB_API_KEY`
- `ADMIN_EMAIL`

을 확인합니다.

## G. 학생 이미지가 안 올라감

- 원본 이미지가 15MB를 넘지 않는지 확인
- 다른 이미지로 시도
- 계속 실패하면 이미지 없이 제출 가능

v3에서는 Firebase Storage를 사용하지 않으므로 Storage 설정/규칙 문제는 발생하지 않습니다.

---

# 17. 수업 전 10분 체크리스트

- [ ] 학생 사이트가 열린다.
- [ ] 상단이 테스트 모드가 아니라 `✓ 저장됨`이다.
- [ ] STEP 2의 학번/이름 저장이 된다.
- [ ] STEP 3에서 대표 사건 1개 + FACT 4개가 입력된다.
- [ ] STEP 4에서 기술/능력치를 섞을 수 있다.
- [ ] FACT 1~4를 모두 써야 잠글 수 있다.
- [ ] 글잠금 경고가 두 번 확인된다.
- [ ] 뒤로가기 시 확인창이 뜬다.
- [ ] 홈버튼 후 복귀해도 작성내용이 남는다.
- [ ] 이미지 없이도 STEP 6으로 갈 수 있다.
- [ ] 캐릭터 이미지 첨부가 된다.
- [ ] 관리자에서 학생이 보인다.
- [ ] 학년도/활동 필터가 된다.
- [ ] AI 초벌평가 테스트 1명이 정상 동작한다.
- [ ] CSV 다운로드가 된다.

여기까지 확인되면 실제 수업에 투입할 준비가 된 상태입니다.
