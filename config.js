// =============================================================
// HISTORY: CHARACTER BUILD 설정 파일
// 1) Firebase 웹앱 설정값
// 2) 교사 이메일
// 3) 학년도 / 활동 ID / 활동명
// 만 바꾸면 다음 수업에서도 같은 사이트 구조를 재사용할 수 있습니다.
// =============================================================

window.HISTORY_APP_CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyDAV5Hu4XL_U7KTUDsvopLTThIE3rERUf8",
    authDomain: "history-class-activities.firebaseapp.com",
    projectId: "history-class-activities",
    // v3는 Cloud Storage를 쓰지 않으므로 storageBucket은 없어도 됩니다.
    messagingSenderId: "149906597015",
    appId: "1:149906597015:web:61d6a8f0587a19fa44b5d2"
  },

  // 관리자 페이지에 로그인할 실제 Google 계정
  adminEmail: "thereare3colorpens@gmail.com",

  // ★ 새 학년도에는 academicYear만 바꾸세요.
  // ★ 같은 학년도에 새 수행활동을 열 때는 id를 반드시 다른 값으로 바꾸세요.
  activity: {
    academicYear: "2026",
    id: "early-modern-character-01",
    title: "대항해시대~시민혁명 역사 캐릭터 빌드",
    unitLabel: "대항해시대 ~ 시민혁명",
    shortDescription: "역사적 인물을 통해 핵심 사건을 이해하고, 그 사실을 게임의 능력·기술로 번역하는 수행활동",

    // AI 초벌평가에 같이 전달되는 교사용 참고문입니다.
    // 여기에 그 차시의 교과서 핵심어/수업 범위를 짧게 넣으면 AI 채점이 더 안정적입니다.
    referenceGuide: [
      "평가의 중심은 인물의 사생활·전기가 아니라 인물과 연결된 핵심 역사 사건의 이해이다.",
      "대항해시대, 절대왕정, 영국 혁명, 계몽사상, 미국 독립 혁명, 프랑스 혁명 등 수업 범위의 사건과 변화를 중심으로 판단한다.",
      "학생이 교과서 수준을 넘어선 세부 지식을 적었다면 확신 없이 오답 처리하지 말고 교사 확인 필요로 표시한다."
    ].join("\n")
  },

  people: [
    "콜럼버스", "바스쿠 다 가마", "마젤란", "엘리자베스 1세", "루이 14세",
    "올리버 크롬웰", "존 로크", "몽테스키외", "볼테르", "루소",
    "조지 워싱턴", "토머스 제퍼슨", "루이 16세", "마리 앙투아네트",
    "로베스피에르", "나폴레옹"
  ],

  // 외부 초상화 제작 사이트. 정책/무료 사용량은 수시로 바뀔 수 있습니다.
  imageTools: [
    { name: "Canva AI 이미지 생성", url: "https://www.canva.com/ko_kr/ai-image-generator/" },
    { name: "Fotor AI 캐릭터 생성", url: "https://www.fotor.com/ko/features/character-generator/" }
  ]
};
