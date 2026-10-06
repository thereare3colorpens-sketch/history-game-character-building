(() => {
  document.body.classList.add("student-app");
  const CFG = window.HISTORY_APP_CONFIG || {};
  const FIREBASE_CONFIG = CFG.firebaseConfig || {};
  const PEOPLE = CFG.people || [];
  const ACTIVITY = CFG.activity || { academicYear: "2026", id: "activity", title: "역사 캐릭터 빌드", unitLabel: "역사", shortDescription: "" };
  const IMAGE_TOOLS = CFG.imageTools || [];
  const PORTRAIT_PROMPTS = CFG.portraitPrompts || [];
  const TEST_CFG = CFG.testMode || {};
  const params = new URLSearchParams(location.search);
  const IS_TEST_SESSION = Boolean(TEST_CFG.enabled && params.get(TEST_CFG.queryKey || "test") === String(TEST_CFG.queryValue || "1"));

  const $ = (s) => document.querySelector(s);
  const appEl = $("#app");
  const progressEl = $("#progress");
  const saveStateEl = $("#saveState");
  const setupBannerEl = $("#setupBanner");
  const toastEl = $("#toast");
  const activityMiniTitle = $("#activityMiniTitle");

  const LOCAL_PREFIX = "history-character-v3-draft:";
  const LOCAL_IMAGE_PREFIX = "history-character-v3-image:";
  const DEVICE_UID_KEY = "history-character-device-id";
  const labels = ["미션", "학생 정보", "사건 정리", "캐릭터", "초상화", "제출"];
  let introTab = "guide";
  let exampleCase = "cromwell";

  let uid = "";
  let submissionId = "";
  let state = null;
  let saveTimer = null;
  let awayStarted = null;
  let monitoringOn = false;
  let remoteEnabled = false;
  let db = null;
  let allowExit = false;
  let guardInstalled = false;
  let toastTimer = null;
  let localImageData = "";

  if (activityMiniTitle) activityMiniTitle.textContent = `${ACTIVITY.academicYear} · ${ACTIVITY.schoolGrade || "-"}학년 · ${ACTIVITY.unitLabel || ACTIVITY.title}`;

  function id(prefix = "id") {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(v = "") {
    return String(v).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }

  function truncate(v = "", n = 38) {
    const s = String(v).trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function isFirebaseConfigured() {
    const required = ["apiKey", "authDomain", "projectId", "appId"];
    return required.every(k => {
      const v = String(FIREBASE_CONFIG[k] || "");
      return v && !v.includes("YOUR_") && !v.includes("YOUR_PROJECT");
    });
  }

  function safeKey(v = "") {
    return String(v).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  }

  function makeSubmissionId(ownerUid) {
    const testSuffix = IS_TEST_SESSION ? "__TEST" : "";
    return `${safeKey(ACTIVITY.academicYear)}__G${safeKey(ACTIVITY.schoolGrade || "NA")}__${safeKey(ACTIVITY.id)}__${ownerUid}${testSuffix}`;
  }

  function getDeviceUid() {
    let v = localStorage.getItem(DEVICE_UID_KEY);
    if (!v) {
      v = id("device");
      localStorage.setItem(DEVICE_UID_KEY, v);
    }
    return v;
  }

  function emptyGameElement(n, factId = "") {
    return {
      id: `element-${n}-${Math.random().toString(16).slice(2)}`,
      factId,
      kind: "skill",
      name: "",
      level: 3,
      effect: "",
      rationale: "",
      limitation: ""
    };
  }

  function blankState(ownerUid) {
    const facts = [1, 2, 3, 4].map(n => ({ id: `fact-${n}`, text: "" }));
    return {
      ownerUid,
      submissionId: makeSubmissionId(ownerUid),
      academicYear: String(ACTIVITY.academicYear || ""),
      schoolGrade: String(ACTIVITY.schoolGrade || ""),
      isTest: IS_TEST_SESSION,
      activityId: String(ACTIVITY.id || ""),
      activityTitle: String(ACTIVITY.title || ""),
      unitLabel: String(ACTIVITY.unitLabel || ""),
      referenceGuide: String(ACTIVITY.referenceGuide || ""),
      pedagogyGuide: String(ACTIVITY.pedagogyGuide || ""),
      rubricVersion: "history-character-10pt-v1",
      appVersion: "4.0",
      className: "",
      studentNumber: "",
      studentName: "",
      selectedPerson: "",
      step: 1,
      eventStudy: {
        eventTitle: "",
        eventSummary: "",
        personConnection: "",
        facts,
        sourceNote: ""
      },
      gameElements: facts.map((f, i) => emptyGameElement(i + 1, f.id)),
      finalImageAttached: false,
      finalImageName: "",
      textLocked: false,
      submitted: false,
      logs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeState(raw, ownerUid) {
    const base = blankState(ownerUid);
    const s = raw && typeof raw === "object" ? { ...base, ...raw } : base;
    s.ownerUid = ownerUid;
    s.submissionId = makeSubmissionId(ownerUid);
    s.academicYear = String(ACTIVITY.academicYear || s.academicYear || "");
    s.schoolGrade = String(ACTIVITY.schoolGrade || s.schoolGrade || "");
    s.isTest = IS_TEST_SESSION || Boolean(s.isTest);
    s.activityId = String(ACTIVITY.id || s.activityId || "");
    s.activityTitle = String(ACTIVITY.title || s.activityTitle || "");
    s.unitLabel = String(ACTIVITY.unitLabel || s.unitLabel || "");
    s.logs = Array.isArray(s.logs) ? s.logs : [];

    if (!s.eventStudy || typeof s.eventStudy !== "object") s.eventStudy = base.eventStudy;
    s.eventStudy = { ...base.eventStudy, ...s.eventStudy };
    s.eventStudy.facts = Array.isArray(s.eventStudy.facts) ? s.eventStudy.facts.slice(0, 4) : [];
    while (s.eventStudy.facts.length < 4) s.eventStudy.facts.push(base.eventStudy.facts[s.eventStudy.facts.length]);
    s.eventStudy.facts = s.eventStudy.facts.map((f, i) => ({ id: f?.id || `fact-${i + 1}`, text: f?.text || "" }));

    s.gameElements = Array.isArray(s.gameElements) ? s.gameElements : [];
    while (s.gameElements.length < 4) {
      const i = s.gameElements.length;
      s.gameElements.push(emptyGameElement(i + 1, s.eventStudy.facts[i]?.id || ""));
    }
    s.gameElements = s.gameElements.map((e, i) => ({ ...emptyGameElement(i + 1, s.eventStudy.facts[i % 4]?.id || ""), ...e }));
    s.step = Math.min(6, Math.max(1, Number(s.step) || 1));
    return s;
  }

  function safeParse(v) {
    try { return JSON.parse(v); } catch { return null; }
  }

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    const at = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const bt = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return at >= bt ? a : b;
  }

  async function loadState(ownerUid) {
    const key = LOCAL_PREFIX + makeSubmissionId(ownerUid);
    const local = safeParse(localStorage.getItem(key));
    let remote = null;
    if (remoteEnabled && db) {
      try {
        const snap = await db.collection("submissions").doc(makeSubmissionId(ownerUid)).get();
        if (snap.exists) remote = snap.data();
      } catch (e) {
        console.warn("remote load failed", e);
      }
    }
    localImageData = localStorage.getItem(LOCAL_IMAGE_PREFIX + makeSubmissionId(ownerUid)) || "";
    if (remoteEnabled && db && !localImageData) {
      try {
        const imgSnap = await db.collection("submissionImages").doc(makeSubmissionId(ownerUid)).get();
        if (imgSnap.exists) localImageData = imgSnap.data()?.imageData || "";
      } catch (e) {
        console.warn("image load failed", e);
      }
    }
    return normalizeState(newer(local, remote), ownerUid);
  }

  function setSaveText(text, cls = "") {
    saveStateEl.textContent = text;
    saveStateEl.className = `save-pill ${cls}`.trim();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add("show");
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function saveLocalNow() {
    if (!state || !uid) return;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LOCAL_PREFIX + submissionId, JSON.stringify(state));
    } catch (e) {
      console.warn("local save failed", e);
      setSaveText("기기 저장 공간 부족", "error");
    }
  }

  function queueSave() {
    if (!state || !uid) return;
    saveLocalNow();

    if (!remoteEnabled || !db) {
      setSaveText("테스트 모드 · 이 기기에 저장", "demo");
      return;
    }

    if (!navigator.onLine) {
      setSaveText("오프라인 · 기기에 저장됨", "offline");
      return;
    }

    setSaveText("저장 중…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await db.collection("submissions").doc(submissionId).set(state, { merge: true });
        setSaveText("✓ 저장됨");
      } catch (e) {
        console.warn(e);
        setSaveText("서버 저장 실패 · 기기에는 저장됨", "offline");
      }
    }, 2200);
  }

  function renderProgress() {
    progressEl.innerHTML = labels.map((label, i) => `
      <div class="progress-item ${i + 1 <= state.step ? "active" : ""} ${i + 1 === state.step ? "current" : ""}">
        <span>${i + 1}</span><small>${label}</small>
      </div>`).join("");
  }

  function navHtml({ next = true, nextLabel = "다음 퀘스트 →" } = {}) {
    const prevDisabled = state.step === 1 || (!IS_TEST_SESSION && state.textLocked && state.step === 5);
    return `<nav class="bottom-nav">
      <button id="prevBtn" class="secondary touch" ${prevDisabled ? "disabled" : ""}>← 이전</button>
      ${next ? `<button id="nextBtn" class="primary touch">${nextLabel}</button>` : ""}
    </nav>`;
  }

  function bindNav(nextHandler) {
    $("#prevBtn")?.addEventListener("click", () => {
      if (!IS_TEST_SESSION && state.textLocked && state.step === 5) return;
      state.step = Math.max(1, state.step - 1);
      queueSave();
      renderApp();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#nextBtn")?.addEventListener("click", nextHandler);
  }

  function renderApp() {
    if (!state) return;
    renderProgress();
    setupMonitoring();

    if (state.submitted) {
      appEl.innerHTML = `<section class="hero submitted game-surface">
        <div class="quest-badge">MISSION CLEAR</div>
        <h1>제출 완료!</h1>
        <p>${escapeHtml(state.studentName)}의 역사 캐릭터 빌드가 저장되었습니다.</p>
        ${localImageData ? `<img class="final-preview" src="${localImageData}" alt="최종 캐릭터">` : `<div class="image-missing">이미지는 첨부하지 않고 제출했습니다.</div>`}
        <div class="clear-stamp">+10 XP · HISTORY QUEST</div>
      </section>`;
      return;
    }

    if (state.step === 1) renderIntro();
    if (state.step === 2) renderIdentity();
    if (state.step === 3) renderFacts();
    if (state.step === 4) renderGame();
    if (state.step === 5) renderImage();
    if (state.step === 6) renderReview();
  }

  function renderIntro() {
    const guide = `<div class="intro-grid">
        <div>
          <div class="quest-badge">MAIN QUEST · ${escapeHtml(ACTIVITY.academicYear)} · ${escapeHtml(ACTIVITY.schoolGrade || "-")}학년</div>
          <h1>역사를 배우고,<br><span>캐릭터를 빌드하라.</span></h1>
          <p class="hero-copy">이번 수행평가는 <b>인물의 전기를 많이 외우는 활동</b>이 아닙니다. 한 인물을 입구로 삼아 그 인물과 연결된 <b>큰 역사 사건 1개를 제대로 설명</b>하고, 사건 속 사실을 골라 게임 캐릭터의 <b>기술·능력치</b>로 바꾸는 미션입니다.</p>
          <div class="hero-tags"><span>#${escapeHtml(ACTIVITY.unitLabel)}</span><span>#사건중심역사</span><span>#게임캐릭터</span><span>#수행평가10점</span></div>
        </div>
        <div class="hero-art-wrap"><img src="./assets/hero-quest.svg" class="hero-art" alt="게임 캐릭터 카드 일러스트"></div>
      </div>

      <div class="mission-board">
        <div class="mission-title"><span>01</span><div><b>퀘스트 진행 방법</b><small>‘역사적 사실 → 게임 표현 → 왜 그렇게 만들었는가’가 핵심입니다.</small></div></div>
        <div class="mission-steps">
          <div><i>①</i><b>대표 사건 1개</b><span>선택한 인물과 연결된 가장 중요한 사건을 충분한 문장으로 설명합니다.</span></div>
          <div><i>②</i><b>역사적 사실 4개</b><span>대표 사건 안에서 게임 요소에 활용할 역사적 사실을 4개 고릅니다.</span></div>
          <div><i>③</i><b>게임 요소 4개 이상</b><span>각 사실을 기술 또는 능력치로 자유롭게 바꾸고 연결 이유를 씁니다.</span></div>
          <div><i>④</i><b>캐릭터 초상화</b><span>역사 글을 확정한 뒤에만 AI 이미지 도구를 사용해 초상화를 만듭니다.</span></div>
        </div>
      </div>

      <div class="score-board">
        <div class="score-title"><span>02</span><div><b>채점 기준 · 총 10점</b><small>게임을 잘하거나 그림을 잘 그리는 것이 점수의 핵심은 아닙니다.</small></div></div>
        <div class="score-row"><b>역사 사건·사실의 정확성</b><div class="score-bar"><span style="width:40%"></span></div><strong>4점</strong></div>
        <div class="score-row"><b>역사 사실 ↔ 게임 요소 연결</b><div class="score-bar"><span style="width:30%"></span></div><strong>3점</strong></div>
        <div class="score-row"><b>역사적 해석의 타당성·균형</b><div class="score-bar"><span style="width:20%"></span></div><strong>2점</strong></div>
        <div class="score-row"><b>설명의 완성도·명료성</b><div class="score-bar"><span style="width:10%"></span></div><strong>1점</strong></div>
        <div class="ai-score-notice"><b>AI는 선생님의 초벌 검토를 돕는 보조 도구입니다.</b><span>AI가 제시한 점수와 피드백은 그대로 성적에 반영되지 않을 수 있으며, 최종 점수는 선생님이 제출물을 직접 확인한 뒤 확정합니다.</span></div>
      </div>

      <div class="rule-grid">
        <div class="rule-card ai-off"><div class="rule-icon">AI</div><b>글쓰기 단계 · 생성형 AI 금지</b><span>학생 정보·사건 정리·게임 빌드는 자신의 생각으로 직접 작성합니다.</span></div>
        <div class="rule-card ai-on"><div class="rule-icon">IMG</div><b>초상화 단계 · 이미지 AI 허용</b><span>글을 확정한 다음 역사 인물 사진을 게임 캐릭터 스타일로 바꾸는 용도만 허용합니다.</span></div>
        <div class="rule-card"><div class="rule-icon">SAVE</div><b>자동 저장</b><span>작성 내용은 기기와 Firebase에 자동 저장됩니다. 튕겨도 같은 기기에서 이어 쓸 수 있습니다.</span></div>
        <div class="rule-card"><div class="rule-icon">LOCK</div><b>복사·붙여넣기 차단</b><span>글쓰기 단계에서는 복사·붙여넣기·잘라내기가 차단됩니다. 화면 이탈도 과정 기록으로 남습니다.</span></div>
      </div>
      <div class="privacy-note"><b>과정 기록만으로 자동 감점하지 않습니다.</b> 기기 오류나 실수도 있을 수 있으므로 화면 이탈 기록은 필요한 경우 작성 과정을 확인하는 참고자료로만 사용합니다.</div>`;

    const caseTabs = `<div class="example-case-tabs" role="tablist" aria-label="사례 선택">
      <button id="caseCromwell" class="${exampleCase === "cromwell" ? "active" : ""}"><small>CASE 01</small><b>올리버 크롬웰</b><span>청교도 혁명</span></button>
      <button id="caseWilliam" class="${exampleCase === "william" ? "active" : ""}"><small>CASE 02</small><b>윌리엄 3세</b><span>명예혁명</span></button>
      <button id="casePaine" class="${exampleCase === "paine" ? "active" : ""}"><small>CASE 03</small><b>토머스 페인</b><span>미국 독립 혁명</span></button>
    </div>`;

    const exampleIntro = `<div class="example-copy example-copy-wide">
      <div class="quest-badge">TEACHER DEMO · HOW TO BUILD</div>
      <h2>게임을 몰라도 괜찮아요.<br><span>역사를 게임 규칙으로 바꾸는 연습</span></h2>
      <p>이 사례는 특정 게임의 규칙을 외우라는 뜻이 아닙니다. <b>역사적 사실을 정확히 설명하고</b>, 그 사실이 보여 주는 특징을 생각한 뒤, 그 특징을 <b>기술 또는 능력치</b>라는 간단한 게임 표현으로 옮기는 과정을 보여 줍니다. 사례 속 인물과 기술을 그대로 따라 쓰기보다, <b>‘왜 이런 표현이 나왔는지’</b>를 읽어 보세요.</p>
      <div class="game-glossary">
        <div><span>★ 능력치</span><b>“이 인물은 무엇을 얼마나 잘했나?”</b><p>지휘력, 설득력, 통치력처럼 인물의 강점과 약점을 별이나 점수로 표현합니다.</p></div>
        <div><span>⚡ 기술</span><b>“특정 상황에서 어떤 일이 일어나나?”</b><p>돌격, 설득, 지원 요청처럼 역사적 행동이나 영향이 작동하는 모습을 효과로 표현합니다.</p></div>
        <div><span>↔ 부작용</span><b>“강점 뒤에 어떤 한계가 있었나?”</b><p>역사 인물을 무조건 영웅으로 만들지 않고, 같은 특징이 낳은 문제나 한계도 게임 규칙으로 넣을 수 있습니다.</p></div>
      </div>
      <div class="demo-tip demo-tip-strong"><b>BUILD FORMULA</b><span><strong>① 역사적 사실</strong> → <strong>② 이 사실이 보여 주는 의미</strong> → <strong>③ 기술/능력치로 표현</strong> → <strong>④ 연결 이유를 자신의 말로 설명</strong></span></div>
      <div class="demo-reading-guide"><b>좋은 사례를 읽는 방법</b><span>게임 효과가 화려한지 보지 마세요. <strong>‘이 역사적 사실이라면 정말 이런 능력이나 효과로 표현할 수 있나?’</strong>를 따져 보는 것이 핵심입니다.</span></div>
    </div>`;

    const cromwellCase = `<div class="case-game-card case-game-card-detailed" aria-label="올리버 크롬웰 교사 시범 게임 빌드">
      <div class="case-card-glow"></div>
      <div class="case-card-header">
        <div class="case-rank"><small>DEMO</small><b>S</b></div>
        <div class="case-title-block"><span>HISTORICAL CHARACTER BUILD</span><h3>철의 신념가, 올리버 크롬웰</h3><p>전투·조직·통치의 역사적 사실을 기술과 능력치로 섞어 표현한 사례</p></div>
        <div class="case-role"><span>CASE TYPE</span><b>MIXED BUILD</b><small>기술 + 능력치 + 부작용</small></div>
      </div>
      <div class="case-event-band case-event-band-rich"><div><span>MAIN EVENT</span><b>청교도 혁명과 공화정</b><p>영국에서는 국왕의 권한과 의회의 권리를 둘러싼 갈등이 심해지면서 내전이 벌어졌습니다. 크롬웰은 이 과정에서 의회파의 중요한 군사 지도자로 활약했고, 신형군의 운영과 전투에서 큰 영향력을 보였습니다. 왕당파가 패배한 뒤 찰스 1세가 처형되고 공화정이 수립되었으며, 크롬웰은 이후 호국경으로 강한 정치적 권력을 행사했습니다. 그의 청교도적 가치와 엄격한 통치는 질서와 통제에 힘을 주었지만, 동시에 반발과 불만을 낳기도 했습니다. 따라서 크롬웰을 캐릭터로 만든다면 단순히 ‘전투를 잘하는 사람’이 아니라 군사 조직, 정치 권력, 지지 기반, 종교적 통치의 여러 면을 함께 표현할 수 있습니다.</p></div><div class="case-build-path"><span>HISTORY</span><i>→</i><span>MEANING</span><i>→</i><span>GAME</span></div></div>
      <div class="case-skill-list">
        <article class="case-skill-detail passive"><div class="case-skill-top"><span>기술 · 팀 강화</span><b>신형군의 충성</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>크롬웰은 신형군의 창설자 그 자체는 아니지만 그 운영에 큰 영향을 미쳤습니다. 신형군은 비교적 체계적인 조직과 훈련을 바탕으로 전투력을 높였고, 크롬웰의 지도력은 병사들의 결속과 충성에 중요한 영향을 주었습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>크롬웰의 힘은 혼자 강하게 싸운 데만 있지 않고, <b>조직 전체가 더 잘 움직이도록 이끄는 지휘 능력</b>에서도 찾을 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>주변 동료의 방어력과 사기를 잠시 높이는 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>왜 이렇게 연결했을까?</span><p>‘병사들의 조직력과 충성’이라는 역사적 사실을 ‘주변 아군이 강해지는 효과’로 바꾼 것입니다. 게임을 모르는 친구라면 <b>“함께 있는 동료들이 더 잘 버티게 만드는 지휘 기술”</b>이라고 이해하면 됩니다.</p></div></article>
        <article class="case-skill-detail attack"><div class="case-skill-top"><span>기술 · 돌격</span><b>철의 타격</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>크롬웰의 군사 활동에서는 기병을 활용한 빠르고 강한 공격이 중요한 역할을 했습니다. 기병의 충격력과 기동성을 이용해 적의 진형을 흔들고 전투의 흐름을 바꾸는 방식은 그의 군사적 이미지를 잘 보여 줍니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p><b>빠른 판단과 강한 돌파력</b>을 가진 군사 지도자라는 특징을 끌어낼 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>기병과 함께 앞으로 돌진해 적에게 피해를 주고, 첫 번째 적을 잠시 움직이지 못하게 하는 <b>‘돌진 기술’</b>로 표현합니다.</p></div></div><div class="case-link"><span>왜 이렇게 연결했을까?</span><p>역사의 ‘빠른 기병 공격’을 게임의 ‘빠른 돌진과 충격’으로 바꾼 것입니다. 역사적 행동과 게임 효과의 모습이 서로 닮아 있기 때문에 연결이 자연스럽습니다.</p></div></article>
        <article class="case-skill-detail defense"><div class="case-skill-top"><span>능력치 · 정치</span><b>통치력 ★★★★☆</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>크롬웰은 공화정 아래에서 호국경이 되어 강한 정치적 권위를 행사했습니다. 내전 이후 혼란스러운 상황에서 국가를 통치했지만, 그의 권력 행사는 공화정의 이상과 실제 통치 사이의 긴장을 보여 주기도 합니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>정치적 혼란 속에서 체제를 유지할 수 있는 <b>강한 통치력</b>이 있었지만, 모두의 동의를 얻은 안정적인 정치라고만 보기는 어렵습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>통치력 ★★★★☆</b>로 설정합니다. 높은 편이지만 만점은 주지 않습니다.</p></div></div><div class="case-link"><span>왜 이렇게 연결했을까?</span><p>능력치는 꼭 ‘잘했다/못했다’의 칭찬 점수가 아닙니다. 실제 역사에서 권력을 유지하고 정책을 실행한 힘은 높게 평가하되, 정치적 갈등과 한계까지 생각해 만점에서 한 칸을 뺀 것입니다.</p></div></article>
        <article class="case-skill-detail economy"><div class="case-skill-top"><span>기술 · 지원</span><b>젠트리의 지원</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>젠트리 계층은 크롬웰의 중요한 지지 기반 가운데 하나였습니다. 이들의 정치적·경제적 지원은 지방에서 세력을 확보하고 군사와 정치 활동을 이어 가는 데 도움이 되었습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>역사 인물의 힘은 개인의 능력뿐 아니라 <b>누가 그를 지지하고 어떤 자원을 제공했는가</b>에 따라서도 달라질 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>일정 시간 동안 필요한 자원을 더 쉽게 얻거나 비용을 줄여 주는 <b>‘지원 기술’</b>로 표현합니다.</p></div></div><div class="case-link"><span>왜 이렇게 연결했을까?</span><p>지지 세력이 제공한 돈·물자·지역 기반을 게임의 ‘자원 보너스’로 옮긴 것입니다. 칼을 휘두르는 행동이 아니어도 충분히 기술이 될 수 있다는 점을 보여 줍니다.</p></div></article>
        <article class="case-skill-detail ultimate"><div class="case-skill-top"><span>기술 · 강화 + 부작용</span><b>신앙의 굴레</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>크롬웰의 청교도적 신념은 통치와 정책에 큰 영향을 주었습니다. 엄격한 종교적 가치와 통제는 체제를 단단하게 유지하는 데 도움이 되기도 했지만, 지나친 엄격함은 사람들의 불만과 반발을 낳는 요인이 되기도 했습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>하나의 특징이 항상 장점으로만 작용한 것이 아니라, <b>단기적으로 힘을 주면서 장기적으로는 부담을 만들 수 있는 양면성</b>이 있었다고 해석할 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>잠시 자신과 동료를 크게 강화하지만, 효과가 끝나면 일정 시간 능력이 떨어지는 <b>‘강화 후 부작용’ 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>왜 이렇게 연결했을까?</span><p>역사적 사실의 장점과 한계를 한 기술 안에 모두 넣었습니다. 이런 표현은 인물을 무조건 영웅으로 만드는 것을 피하고, <b>역사의 복잡한 면을 게임 규칙으로 보여 주는 좋은 방법</b>입니다.</p></div></article>
      </div>
      <div class="case-judge-line"><div><span>이 사례에서 배울 점</span><b>한 인물 안에서도 기술과 능력치를 섞어 사용할 수 있습니다.</b></div><p>중요한 것은 형식을 통일하는 것이 아니라, 각각의 게임 요소가 <strong>서로 다른 역사적 사실과 설명 가능한 관계</strong>를 갖도록 만드는 것입니다.</p></div>
    </div>`;

    const williamCase = `<div class="case-game-card case-game-card-detailed case-theme-blue" aria-label="윌리엄 3세 교사 시범 게임 빌드">
      <div class="case-card-glow"></div>
      <div class="case-card-header"><div class="case-rank"><small>DEMO</small><b>A</b></div><div class="case-title-block"><span>HISTORICAL CHARACTER BUILD</span><h3>계약의 왕, 윌리엄 3세</h3><p>전투보다 정치 제도와 권력 관계를 게임 규칙으로 바꾸는 방법을 보여 주는 사례</p></div><div class="case-role"><span>CASE TYPE</span><b>CONTROL BUILD</b><small>정당성 · 의회 · 권력 제한</small></div></div>
      <div class="case-event-band case-event-band-rich"><div><span>MAIN EVENT</span><b>명예혁명과 입헌군주정의 발전</b><p>제임스 2세의 전제적 통치와 가톨릭 우대 정책에 대한 반발이 커지자 영국 의회의 유력 인사들은 네덜란드의 오라녜 공 윌리엄에게 영국으로 와 줄 것을 요청했습니다. 윌리엄은 제임스 2세의 딸 메리와 함께 영국의 왕위를 이어받았고, 이 과정에서 의회와 왕의 관계가 크게 달라졌습니다. 1689년 권리장전은 국왕이 의회의 동의 없이 법을 정지하거나 과세하는 것을 어렵게 만들고 의회의 권리를 강화했습니다. 이 사건은 왕이 마음대로 통치하는 절대왕정에서 벗어나, 법과 의회의 제약을 받는 입헌군주정이 발전하는 중요한 계기가 되었습니다. 따라서 윌리엄 3세의 사례는 ‘강한 공격 기술’이 없어도 정치 제도와 권력의 변화만으로 충분히 흥미로운 캐릭터를 만들 수 있음을 보여 줍니다.</p></div><div class="case-build-path"><span>EVENT</span><i>→</i><span>RULE</span><i>→</i><span>GAME</span></div></div>
      <div class="case-skill-list">
        <article class="case-skill-detail passive"><div class="case-skill-top"><span>능력치 · 정치</span><b>정당성 ★★★★☆</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>윌리엄은 영국 왕위를 단순히 무력으로 빼앗은 인물로만 보기 어렵습니다. 제임스 2세에 반대하던 의회 세력의 초청을 받았고, 왕위 계승권을 가진 메리와 함께 공동으로 왕위에 올랐습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>그의 권력은 개인의 군사력만이 아니라 <b>의회의 지지와 왕위 계승의 명분</b>을 함께 바탕으로 했습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>정당성 ★★★★☆</b>. 새로운 지역을 통치할 때 반발이 줄어드는 능력치로 설정합니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>정치에서 ‘사람들이 왜 그 권력을 인정하는가’를 게임의 정당성 수치로 바꾼 것입니다. 군사적 승리뿐 아니라 <b>제도와 지지 기반도 능력치가 될 수 있음</b>을 보여 줍니다.</p></div></article>
        <article class="case-skill-detail defense"><div class="case-skill-top"><span>기술 · 제도</span><b>권리장전</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>윌리엄과 메리의 즉위 뒤 권리장전이 마련되면서 국왕의 권한은 이전보다 뚜렷한 제약을 받게 되었습니다. 특히 과세와 법 집행에서 의회의 역할이 강화되면서 왕과 의회 사이의 권력 관계가 달라졌습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>정치 권력이 한 사람에게 무제한으로 집중되지 않도록 <b>규칙을 만들어 권력을 제한하는 변화</b>라고 볼 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>발동 후 일정 시간 동안 누구도 혼자서 중요한 결정을 내릴 수 없고, <b>팀의 동의가 있어야 강력한 행동을 사용할 수 있는 ‘규칙 변경’ 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>권리장전을 단순한 ‘방어막’으로 바꾸기보다, 게임 자체의 규칙을 바꾸는 기술로 표현했습니다. <b>역사에서 제도가 바뀌었다면 게임에서도 규칙이 바뀌게 하는 것</b>이 가장 직접적인 번역이기 때문입니다.</p></div></article>
        <article class="case-skill-detail economy"><div class="case-skill-top"><span>기술 · 협력</span><b>의회의 승인</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>명예혁명 이후 국왕은 의회를 무시하고 마음대로 세금을 거두거나 법을 운영하기 어려워졌습니다. 중요한 국정 운영에서 의회의 동의와 협력이 더욱 중요해졌습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>통치는 ‘왕 혼자 명령하면 끝나는 방식’에서 <b>다른 정치 세력과 협의해야 하는 방식</b>으로 이동했습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>혼자 사용하면 효과가 약하지만, 동료의 동의를 받으면 효과가 크게 증가하는 <b>협력 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>의회 동의가 중요해진 역사적 변화를 ‘협력할수록 강해지는 효과’로 바꾼 것입니다. 전투 사건이 아니어도 권력 관계의 변화를 게임 규칙으로 만들 수 있습니다.</p></div></article>
        <article class="case-skill-detail ultimate"><div class="case-skill-top"><span>능력치 · 한계까지 표현</span><b>왕권 ★★★☆☆ / 의회 협력 ★★★★★</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>윌리엄 3세는 분명 국왕이었지만 명예혁명 이후의 영국 국왕은 이전과 같은 방식으로 절대적인 권력을 행사하기 어려웠습니다. 반대로 의회는 점차 더 중요한 정치적 위치를 차지했습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>이 인물의 특징을 ‘왕이니까 모든 능력치가 높다’고 볼 수 없습니다. 오히려 <b>개인 권한은 제한되고, 제도 안에서 협력하는 능력이 더 중요해진 시대 변화</b>가 핵심입니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>왕권 ★★★☆☆</b>, <b>의회 협력 ★★★★★</b>처럼 서로 다른 두 능력치를 대비시킵니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>능력치는 인물을 칭찬하는 점수가 아니라 역사적 상황을 표현하는 도구입니다. 낮은 능력치도 실패가 아니라 <b>그 시대에 권력이 어떻게 제한되었는지 보여 주는 설명</b>이 될 수 있습니다.</p></div></article>
      </div>
      <div class="case-judge-line"><div><span>이 사례에서 배울 점</span><b>전쟁이 없어도 ‘정치 규칙의 변화’ 자체가 훌륭한 게임 재료입니다.</b></div><p>역사 사건이 제도와 권력 관계를 바꾸었다면, 공격력보다 <strong>규칙·협력·제한·정당성</strong> 같은 게임 요소를 떠올려 보세요.</p></div>
    </div>`;

    const paineCase = `<div class="case-game-card case-game-card-detailed case-theme-gold" aria-label="토머스 페인 교사 시범 게임 빌드">
      <div class="case-card-glow"></div>
      <div class="case-card-header"><div class="case-rank"><small>DEMO</small><b>A</b></div><div class="case-title-block"><span>HISTORICAL CHARACTER BUILD</span><h3>문장으로 전장을 바꾼 자, 토머스 페인</h3><p>칼이나 군대가 아니라 글과 설득이 역사에 미친 영향을 게임 요소로 만드는 사례</p></div><div class="case-role"><span>CASE TYPE</span><b>INFLUENCE BUILD</b><small>설득 · 여론 · 사기</small></div></div>
      <div class="case-event-band case-event-band-rich"><div><span>MAIN EVENT</span><b>미국 독립 혁명</b><p>북아메리카 식민지에서는 영국의 과세와 통제에 대한 불만이 커지며 독립을 둘러싼 논쟁이 확산되었습니다. 이때 토머스 페인은 1776년 소책자 『상식(Common Sense)』을 통해 왕정의 문제점을 비판하고 식민지가 영국으로부터 독립해야 한다고 주장했습니다. 그는 전문 정치인만 이해할 수 있는 어려운 표현보다 비교적 쉽고 직접적인 언어를 사용해 많은 사람에게 독립의 필요성을 전달했습니다. 독립전쟁이 어려움에 빠졌을 때는 『미국의 위기(The American Crisis)』를 통해 사람들의 사기와 의지를 북돋우려 했습니다. 따라서 페인의 사례는 역사적 영향력이 꼭 군대를 직접 지휘하는 힘에서만 나오는 것이 아니라, <b>생각을 퍼뜨리고 사람들의 판단을 변화시키는 힘</b>에서도 나올 수 있음을 보여 줍니다.</p></div><div class="case-build-path"><span>IDEA</span><i>→</i><span>PUBLIC</span><i>→</i><span>GAME</span></div></div>
      <div class="case-skill-list">
        <article class="case-skill-detail passive"><div class="case-skill-top"><span>능력치 · 설득</span><b>대중 설득력 ★★★★★</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>페인은 『상식』에서 독립 문제를 많은 사람이 이해하기 쉬운 방식으로 설명했습니다. 어려운 정치 이론만 나열하기보다 왕정에 대한 비판과 독립의 필요성을 직접적으로 전달해 독립 논의를 넓히는 데 영향을 주었습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>복잡한 생각을 <b>일반 사람들이 이해하고 공감할 수 있는 말로 바꾸는 능력</b>이 그의 중요한 특징이라고 볼 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>대중 설득력 ★★★★★</b>. 같은 주장을 해도 다른 캐릭터보다 더 많은 중립 인물을 자신의 편으로 움직일 수 있습니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>글이 사람의 생각에 영향을 주었다는 사실을 ‘설득 성공률이 높다’는 능력치로 바꾼 것입니다. 능력치는 전투력뿐 아니라 <b>말, 글, 외교, 조직 같은 역사적 힘</b>도 표현할 수 있습니다.</p></div></article>
        <article class="case-skill-detail attack"><div class="case-skill-top"><span>기술 · 여론 변화</span><b>상식의 한 장</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>1776년 『상식』은 식민지가 영국 왕에게 계속 충성해야 하는지, 아니면 독립해야 하는지에 관한 논의를 더 넓은 대중에게 전달했습니다. 책자는 독립을 지지하는 여론이 확산되는 과정에서 중요한 역할을 했습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>한 번의 군사 공격보다 <b>사람들의 생각과 선택이 한쪽으로 움직이는 변화</b>가 핵심입니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>지역에 있는 중립 인물들의 태도를 조금씩 독립 쪽으로 이동시키는 <b>‘여론 변화’ 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>실제 역사에서 소책자가 ‘적을 쓰러뜨린’ 것은 아니지만 사람들의 판단에 영향을 주었습니다. 그래서 피해량이 아니라 <b>생각의 방향을 바꾸는 효과</b>가 더 적절합니다.</p></div></article>
        <article class="case-skill-detail defense"><div class="case-skill-top"><span>기술 · 사기 회복</span><b>위기의 문장</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>독립전쟁이 힘든 시기에 페인은 『미국의 위기』를 써서 독립을 위한 싸움을 계속해야 한다고 주장했습니다. 이런 글은 전쟁이 길어지며 지치고 흔들리는 사람들에게 의지를 북돋우는 역할을 했습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>페인의 글은 새로운 공격 수단이라기보다 <b>포기하려는 사람들의 의지와 사기를 회복시키는 힘</b>으로 볼 수 있습니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p>사기가 낮아진 동료들의 사기를 회복시키고, 일정 시간 후퇴하지 않게 하는 <b>‘사기 회복’ 기술</b>로 표현합니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>역사적 글의 목적과 게임 효과의 목적을 맞춘 것입니다. ‘힘든 상황에서 다시 싸울 의지를 준다’는 공통점이 있기 때문에 자연스럽게 연결됩니다.</p></div></article>
        <article class="case-skill-detail ultimate"><div class="case-skill-top"><span>능력치 · 한계도 생각하기</span><b>직접 전투력 ★☆☆☆☆ / 영향력 ★★★★★</b></div><div class="case-three-step"><div class="case-history"><span>① 역사적 사실</span><p>페인의 대표적인 역사적 역할은 전장에서 군대를 지휘하는 장군의 역할과 달랐습니다. 그의 강점은 글과 주장으로 독립의 명분을 설명하고 사람들의 태도에 영향을 주는 데 있었습니다.</p></div><div class="case-meaning"><span>② 이 사실의 의미</span><p>역사에서 중요한 인물이라고 해서 모든 능력이 높은 것은 아닙니다. <b>어떤 방식으로 역사에 영향을 주었는지에 따라 능력치의 모양이 달라져야</b> 합니다.</p></div><div class="case-game-effect"><span>③ 게임 표현</span><p><b>직접 전투력 ★☆☆☆☆</b>, <b>사회적 영향력 ★★★★★</b>로 크게 대비시킵니다.</p></div></div><div class="case-link"><span>연결 이유</span><p>‘유명한 인물 = 모든 능력치 만점’으로 만드는 것을 피한 사례입니다. 약한 능력치를 넣는 것도 역사적 사실에 근거한다면 훌륭한 캐릭터 설계가 됩니다.</p></div></article>
      </div>
      <div class="case-judge-line"><div><span>이 사례에서 배울 점</span><b>싸우지 않은 인물도 충분히 게임 캐릭터가 될 수 있습니다.</b></div><p>사상가·작가·외교관이라면 <strong>설득, 정보 전달, 여론, 사기, 협력</strong>처럼 그 사람이 실제 역사에서 행사한 힘을 게임 효과로 바꾸면 됩니다.</p></div>
    </div>`;

    const selectedCase = exampleCase === "william" ? williamCase : (exampleCase === "paine" ? paineCase : cromwellCase);
    const example = `<div class="example-showcase example-showcase-v3">${exampleIntro}${caseTabs}<div class="example-case-stage">${selectedCase}</div><div class="example-final-guide"><div class="bad"><span>✕ 아쉬운 연결</span><b>“크롬웰은 군인이니까 공격력 ★★★★★”</b><p>틀렸다고 단정할 수는 없지만, 구체적인 역사적 사실과 해석 과정이 보이지 않습니다.</p></div><div class="good"><span>✓ 좋은 연결</span><b>“신형군의 조직과 지휘에 영향 → 조직 전체를 이끄는 힘 → 군사 지휘력 ★★★★★”</b><p>사실, 해석, 게임 표현이 차례로 이어져 왜 그런 능력치를 만들었는지 설명할 수 있습니다.</p></div></div><div class="non-gamer-finish"><b>게임을 잘하는 것이 목표가 아닙니다.</b><p>게임 이름이나 전문 용어를 많이 쓰지 않아도 됩니다. <strong>역사에서 배운 사실을 정확히 이해하고, 그 의미를 자신만의 규칙으로 표현할 수 있으면 충분합니다.</strong> 기술을 만들어도 되고 능력치를 만들어도 됩니다. 가장 중요한 것은 ‘멋진 이름’이 아니라 <strong>역사적 근거가 보이는 연결</strong>입니다.</p></div></div>`;

    appEl.innerHTML = `<section class="hero intro-hero game-surface">
      <div class="intro-tabs"><button id="guideTab" class="${introTab === "guide" ? "active" : ""}">🎮 활동 안내</button><button id="exampleTab" class="${introTab === "example" ? "active" : ""}">🧩 사례 보기</button></div>
      ${introTab === "guide" ? guide : example}
    </section>${navHtml({ nextLabel: "캐릭터 생성 시작 →" })}`;
    $("#guideTab")?.addEventListener("click", () => { introTab = "guide"; renderIntro(); });
    $("#exampleTab")?.addEventListener("click", () => { introTab = "example"; renderIntro(); });
    $("#caseCromwell")?.addEventListener("click", () => { exampleCase = "cromwell"; renderIntro(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("#caseWilliam")?.addEventListener("click", () => { exampleCase = "william"; renderIntro(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("#casePaine")?.addEventListener("click", () => { exampleCase = "paine"; renderIntro(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    bindNav(() => { state.step = 2; queueSave(); renderApp(); window.scrollTo(0, 0); });
  }

  function renderIdentity() {
    appEl.innerHTML = `<section class="panel narrow quest-panel">
      <div class="panel-icon">ID</div>
      <div class="eyebrow">STEP 2 · PLAYER DATA</div><h2>플레이어 정보를 입력하세요.</h2>
      <p class="lead">학번과 이름은 제출물을 구분하기 위해 사용합니다. 선택한 역사 인물은 다음 단계의 사건 학습을 위한 출발점입니다.</p>
      <div class="two-col">
        <label>반<input id="className" data-field="className" inputmode="numeric" value="${escapeHtml(state.className)}" placeholder="예: 3"></label>
        <label>번호<input id="studentNumber" data-field="studentNumber" inputmode="numeric" value="${escapeHtml(state.studentNumber)}" placeholder="예: 17"></label>
      </div>
      <label>이름<input id="studentName" data-field="studentName" value="${escapeHtml(state.studentName)}" autocomplete="off" placeholder="이름"></label>
      <label>선택한 역사 인물
        <input id="selectedPerson" list="peopleList" data-field="selectedPerson" value="${escapeHtml(state.selectedPerson)}" placeholder="예: 마리 앙투아네트">
        <datalist id="peopleList">${PEOPLE.map(p => `<option value="${escapeHtml(p)}"></option>`).join("")}</datalist>
      </label>
      <div class="activity-chip"><span>현재 활동</span><b>${escapeHtml(ACTIVITY.academicYear)}학년도 · ${escapeHtml(ACTIVITY.schoolGrade || "-")}학년 · ${escapeHtml(ACTIVITY.title)}</b></div>
      ${IS_TEST_SESSION ? `<div class="test-mode-card"><b>🧪 교사용 TEST MODE</b><span>이 주소에서는 글잠금과 최종제출에 묶이지 않고 앞뒤 단계로 자유롭게 이동할 수 있습니다.</span></div>` : ""}
      <p class="hint">글을 잠그기 전까지는 이전/다음 버튼으로 돌아와 수정할 수 있습니다. 같은 디벗에서는 새로고침하거나 홈 화면에 다녀와도 작성 내용이 자동 저장됩니다.</p>
    </section>${navHtml()}`;

    ["className", "studentNumber", "studentName", "selectedPerson"].forEach(k => {
      $("#" + k).addEventListener("input", e => { state[k] = e.target.value; queueSave(); });
    });

    bindNav(() => {
      if (![state.className, state.studentNumber, state.studentName, state.selectedPerson].every(v => String(v).trim())) {
        return alert("반, 번호, 이름, 역사 인물을 모두 입력해주세요.");
      }
      state.step = 3; queueSave(); renderApp(); window.scrollTo(0, 0);
    });
  }

  function factInputs() {
    return state.eventStudy.facts.map((f, i) => `
      <label class="compact-fact"><span><b>FACT ${i + 1}</b> · 게임 요소로 활용할 역사적 사실</span>
        <textarea data-fact="${i}" rows="3" data-field="fact-${i + 1}" placeholder="1~2문장으로 구체적으로 쓰세요. 예: 마리 앙투아네트는 구체제 왕실의 특권을 상징하는 인물로 비판받았다. 혁명 과정에서 왕실에 대한 불신이 커지는 배경과 연결할 수 있다.">${escapeHtml(f.text)}</textarea>
      </label>`).join("");
  }

  function renderFacts() {
    appEl.innerHTML = `<section>
      <div class="section-head game-heading">
        <div><div class="eyebrow">STEP 3 · HISTORY SOURCE</div><h2>인물보다 먼저,<br><span>사건을 잡으세요.</span></h2></div>
        <p>여러 사건을 억지로 찾을 필요 없습니다. <b>이 인물과 가장 관련 있는 큰 사건 1개</b>를 중심으로 충분히 설명하고, 그 사건 안에서 게임 요소로 활용할 역사적 사실 4개를 뽑습니다.</p>
      </div>

      <div class="event-card card">
        <div class="event-card-top"><div class="event-icon">📜</div><div><div class="card-number">MAIN EVENT</div><h3>${escapeHtml(state.selectedPerson)}와 연결되는 대표 사건</h3></div></div>
        <label>대표 사건 이름
          <input id="eventTitle" data-field="event-title" value="${escapeHtml(state.eventStudy.eventTitle)}" placeholder="예: 프랑스 혁명">
        </label>
        <label>이 사건은 어떤 사건인가요? <span class="mini-guide">4~6문장 · 최소 100자</span>
          <textarea id="eventSummary" data-field="event-summary" rows="7" placeholder="수업에서 배운 내용을 바탕으로 사건의 배경, 중요한 전개, 변화나 결과가 드러나도록 4~6문장 정도로 설명하세요. 인물의 일대기를 쓰는 칸이 아닙니다.">${escapeHtml(state.eventStudy.eventSummary)}</textarea>
          <small class="writing-guide">현재 <b id="eventSummaryCount">${state.eventStudy.eventSummary.length}</b>자 · 최소 100자</small>
        </label>
        <label>${escapeHtml(state.selectedPerson)}는 이 사건과 어떻게 연결되나요? <span class="mini-guide">2~4문장 · 최소 50자</span>
          <textarea id="personConnection" data-field="person-connection" rows="5" placeholder="이 인물이 사건에서 한 역할, 취한 행동, 또는 당시 사람들에게 어떤 상징으로 받아들여졌는지 사건 중심으로 설명하세요.">${escapeHtml(state.eventStudy.personConnection)}</textarea>
          <small class="writing-guide">현재 <b id="personConnectionCount">${state.eventStudy.personConnection.length}</b>자 · 최소 50자</small>
        </label>
      </div>

      <div class="fact-zone">
        <div class="fact-zone-head"><div><div class="card-number">HISTORY FACT x4</div><h3>게임 요소로 활용할 역사적 사실 4개</h3></div><span>각각 1~2문장, 최소 20자</span></div>
        <div class="fact-grid">${factInputs()}</div>
        <label class="source-note">근거 메모 <span class="optional">선택</span>
          <input id="sourceNote" data-field="source-note" value="${escapeHtml(state.eventStudy.sourceNote)}" placeholder="예: 교과서 p.134 / 수업 활동지 2쪽">
        </label>
      </div>

      <div class="tip-card"><b>💡 ‘마리 앙투아네트’를 골랐다고 그 사람의 생애를 조사할 필요는 없습니다.</b><span>프랑스 혁명을 제대로 설명하고, 왕실·구체제·혁명 과정과 연결되는 사실을 게임 재료로 뽑으면 충분합니다.</span></div>
    </section>${navHtml()}`;

    const count = (id, out) => { const el = $(id), target = $(out); const f = () => target.textContent = el.value.length; el.addEventListener("input", f); };
    $("#eventTitle").addEventListener("input", e => { state.eventStudy.eventTitle = e.target.value; queueSave(); });
    $("#eventSummary").addEventListener("input", e => { state.eventStudy.eventSummary = e.target.value; queueSave(); });
    $("#personConnection").addEventListener("input", e => { state.eventStudy.personConnection = e.target.value; queueSave(); });
    $("#sourceNote").addEventListener("input", e => { state.eventStudy.sourceNote = e.target.value; queueSave(); });
    count("#eventSummary", "#eventSummaryCount"); count("#personConnection", "#personConnectionCount");
    appEl.querySelectorAll("[data-fact]").forEach(el => el.addEventListener("input", e => {
      state.eventStudy.facts[Number(e.target.dataset.fact)].text = e.target.value;
      queueSave();
    }));

    bindNav(() => {
      const e = state.eventStudy;
      if (!e.eventTitle.trim() || !e.eventSummary.trim() || !e.personConnection.trim() || !e.facts.every(f => f.text.trim())) {
        return alert("대표 사건, 사건 설명, 인물과의 연결, 역사적 사실 4개를 모두 작성해주세요.");
      }
      if (e.eventSummary.trim().length < 100) return alert("대표 사건 설명을 조금 더 자세히 써주세요. 최소 100자 이상 작성합니다.");
      if (e.personConnection.trim().length < 50) return alert("인물과 사건의 연결을 조금 더 자세히 써주세요. 최소 50자 이상 작성합니다.");
      if (e.facts.some(f => f.text.trim().length < 20)) return alert("역사적 사실 4개를 각각 20자 이상, 1~2문장 정도로 작성해주세요.");
      state.gameElements.slice(0, 4).forEach((g, i) => { if (!g.factId) g.factId = e.facts[i].id; });
      state.step = 4; queueSave(); renderApp(); window.scrollTo(0, 0);
    });
  }

  function gameCard(e, i) {
    const opts = state.eventStudy.facts.map((f, idx) => `<option value="${f.id}" ${e.factId === f.id ? "selected" : ""}>FACT ${idx + 1} · ${escapeHtml(truncate(f.text, 42))}</option>`).join("");
    const factText = state.eventStudy.facts.find(f => f.id === e.factId)?.text || "";
    return `<section class="card game-card ${e.kind}">
      <div class="game-card-head">
        <div><div class="card-number">BUILD SLOT ${i + 1}</div><h3>${e.kind === "skill" ? "기술" : "능력치"} 만들기</h3></div>
        <div class="game-actions">
          <div class="segmented" aria-label="기술 또는 능력치 선택">
            <button type="button" data-kind-btn="skill" data-i="${i}" class="${e.kind === "skill" ? "selected" : ""}">⚔ 기술</button>
            <button type="button" data-kind-btn="stat" data-i="${i}" class="${e.kind === "stat" ? "selected" : ""}">★ 능력치</button>
          </div>
          ${state.gameElements.length > 4 ? `<button type="button" class="icon-btn" data-remove-element="${i}" aria-label="이 게임 요소 삭제">삭제</button>` : ""}
        </div>
      </div>

      <label>어떤 역사적 사실을 이 게임 요소에 활용할까요?
        <select data-element="${i}" data-key="factId"><option value="">선택하세요</option>${opts}</select>
      </label>
      ${factText ? `<div class="source-rune"><span>HISTORY SOURCE</span><p>${escapeHtml(factText)}</p></div>` : ""}

      <label>${e.kind === "skill" ? "기술 이름" : "능력치 이름"}
        <input data-element="${i}" data-key="name" data-field="element-${i + 1}-name" value="${escapeHtml(e.name)}" placeholder="${e.kind === "skill" ? "예: 공포정치 / 서쪽 항로 / 왕권의 방패" : "예: 군사지휘력 / 설득력 / 탐험력"}">
      </label>

      ${e.kind === "stat" ? `
        <label>능력치 수준 <strong class="level-value" data-level-for="${i}">${e.level}/5</strong>
          <input type="range" min="1" max="5" data-element="${i}" data-key="level" value="${e.level}">
        </label>` : `
        <label>게임에서 어떤 효과가 있나요?
          <textarea data-element="${i}" data-key="effect" data-field="element-${i + 1}-effect" rows="3" placeholder="게임을 잘 몰라도 됩니다. 누구에게 어떤 변화가 생기는지 쉽게 설명하세요.">${escapeHtml(e.effect)}</textarea>
        </label>`}

      <label>왜 이 역사적 사실을 이렇게 표현했나요?
        <textarea data-element="${i}" data-key="rationale" data-field="element-${i + 1}-rationale" rows="3" placeholder="역사적 사실과 기술/능력치가 어떻게 연결되는지 설명하세요.">${escapeHtml(e.rationale)}</textarea>
      </label>

      <label>약점·부작용·한계 <span class="optional">선택</span>
        <textarea data-element="${i}" data-key="limitation" data-field="element-${i + 1}-limit" rows="2" placeholder="예: 효과가 강하지만 사용 후 민심이 하락한다.">${escapeHtml(e.limitation)}</textarea>
      </label>
    </section>`;
  }

  function gameElementComplete(e) {
    return Boolean(e.factId && e.name.trim() && e.rationale.trim() && (e.kind === "stat" || e.effect.trim()));
  }

  function allFactsUsed() {
    const used = new Set(state.gameElements.map(e => e.factId).filter(Boolean));
    return state.eventStudy.facts.every(f => used.has(f.id));
  }

  function renderGame() {
    appEl.innerHTML = `<section>
      <div class="section-head game-heading">
        <div><div class="eyebrow">STEP 4 · CHARACTER BUILD</div><h2>역사적 사실을<br><span>게임의 언어로 번역하세요.</span></h2></div>
        <p><b>최소 4개</b>의 게임 요소를 만듭니다. 각 카드에서 FACT 1~4 중 하나를 선택하고, 그 사실을 <b>기술 또는 능력치</b>로 표현하세요. 두 형식은 마음대로 섞어도 됩니다.</p>
      </div>
      <div class="build-rule"><b>빌드 규칙</b><span>FACT 1~4를 각각 최소 한 번은 사용하세요.</span><span>기술은 ‘효과’를, 능력치는 ‘1~5 수준’을 정합니다.</span><span>역사적 연결 이유가 가장 중요합니다.</span></div>

      <div class="game-stack">${state.gameElements.map(gameCard).join("")}</div>
      <button id="addElementBtn" type="button" class="secondary add-element">＋ 게임 요소 하나 더 만들기</button>

      <div class="lock-box lock-danger">
        <div class="lock-icon">!</div>
        <div>
          <b>${IS_TEST_SESSION ? "🧪 TEST MODE · 잠금 없이 다음 단계로 이동" : "⚠️ 글 잠금 전 마지막 점검"}</b>
          <p>${IS_TEST_SESSION ? "테스트 주소에서는 글을 잠그지 않습니다. 초상화 단계까지 갔다가 이전 단계로 자유롭게 돌아와 수정할 수 있습니다." : "아래 버튼을 누르면 <strong>학생 정보, 대표 사건, 역사적 사실, 기술·능력치가 모두 잠깁니다.</strong><br>잠근 뒤에는 학생이 직접 수정할 수 없고, 교사가 관리자 화면에서 잠금을 풀어야 합니다."}</p>
          <ul class="lock-checklist"><li>오탈자를 확인했나요?</li><li>FACT 1~4를 모두 한 번 이상 사용했나요?</li><li>게임 효과보다 ‘역사적 근거’가 설명되어 있나요?</li></ul>
          <label class="confirm-check"><input id="lockAck" type="checkbox"> <span><b>${IS_TEST_SESSION ? "테스트 모드로 다음 단계에 진행합니다." : "확정 후에는 수정할 수 없다는 점을 확인했습니다."}</b><br>${IS_TEST_SESSION ? "실제 학생 화면에서는 이 단계에서 글이 잠깁니다." : "지금 작성한 역사 글과 게임 빌드를 최종 확정하겠습니다."}</span></label>
          <button id="lockBtn" class="primary lock-button" disabled>${IS_TEST_SESSION ? "🧪 TEST · 초상화 단계로 →" : "🔒 글 잠그고 초상화 퀘스트로 →"}</button>
        </div>
      </div>
    </section>${navHtml({ next: false })}`;

    appEl.querySelectorAll("[data-kind-btn]").forEach(btn => btn.addEventListener("click", e2 => {
      const i = Number(e2.currentTarget.dataset.i);
      state.gameElements[i].kind = e2.currentTarget.dataset.kindBtn;
      queueSave(); renderApp();
    }));

    appEl.querySelectorAll("[data-element]").forEach(el => el.addEventListener("input", ev => {
      const i = Number(ev.target.dataset.element);
      const key = ev.target.dataset.key;
      state.gameElements[i][key] = key === "level" ? Number(ev.target.value) : ev.target.value;
      if (key === "level") appEl.querySelector(`[data-level-for="${i}"]`).textContent = `${ev.target.value}/5`;
      queueSave();
      if (key === "factId") renderApp();
    }));

    appEl.querySelectorAll("[data-remove-element]").forEach(btn => btn.addEventListener("click", e2 => {
      const i = Number(e2.currentTarget.dataset.removeElement);
      if (state.gameElements.length <= 4) return;
      if (!confirm("이 게임 요소를 삭제할까요?")) return;
      state.gameElements.splice(i, 1);
      queueSave(); renderApp();
    }));

    $("#addElementBtn").addEventListener("click", () => {
      state.gameElements.push(emptyGameElement(state.gameElements.length + 1));
      queueSave(); renderApp();
      setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }), 50);
    });

    const ack = $("#lockAck");
    const lock = $("#lockBtn");
    ack.addEventListener("change", () => { lock.disabled = !ack.checked; });

    lock.addEventListener("click", () => {
      if (state.gameElements.length < 4) return alert("게임 요소를 최소 4개 작성해주세요.");
      if (!state.gameElements.every(gameElementComplete)) return alert("모든 게임 요소의 근거 사실, 이름, 연결 이유를 채워주세요. '기술'은 효과 설명도 필요합니다.");
      if (!allFactsUsed()) return alert("FACT 1~4를 각각 최소 한 번은 사용해주세요.");
      if (!IS_TEST_SESSION) {
        const ok = confirm("정말 글을 잠글까요?\n\n확정 후에는 학생 정보·역사 내용·게임 요소를 학생이 수정할 수 없습니다.\n수정이 필요하면 선생님이 관리자 화면에서 잠금을 풀어야 합니다.");
        if (!ok) return;
        state.textLocked = true;
        state.textLockedAt = new Date().toISOString();
      } else {
        state.textLocked = false;
        state.isTest = true;
      }
      state.step = 5;
      queueSave(); renderApp(); window.scrollTo(0, 0);
    });

    bindNav(() => {});
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function dataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return Math.ceil(b64.length * 3 / 4);
  }

  async function compressImage(file) {
    const img = await loadImageFromFile(file);
    const maxSide = 900;
    const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const target = 360 * 1024;
    let q = 0.78;
    let data = canvas.toDataURL("image/jpeg", q);
    while (dataUrlBytes(data) > target && q > 0.42) {
      q -= 0.08;
      data = canvas.toDataURL("image/jpeg", q);
    }
    if (dataUrlBytes(data) > 520 * 1024) throw new Error("이미지를 충분히 작게 줄이지 못했습니다.");
    return data;
  }

  async function saveImageData(dataUrl, fileName) {
    localImageData = dataUrl;
    localStorage.setItem(LOCAL_IMAGE_PREFIX + submissionId, dataUrl);
    state.finalImageAttached = true;
    state.finalImageName = fileName || "character.jpg";
    queueSave();

    if (remoteEnabled && db) {
      await db.collection("submissionImages").doc(submissionId).set({
        ownerUid: uid,
        submissionId,
        academicYear: state.academicYear,
        activityId: state.activityId,
        imageData: dataUrl,
        fileName: state.finalImageName,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }
  }

  function renderImage() {
    const tools = IMAGE_TOOLS.map(t => `<a href="${escapeHtml(t.url)}" target="_blank" rel="noreferrer"><b>${escapeHtml(t.name)} ↗</b><span>새 탭에서 만든 뒤 완성 이미지만 다시 이 사이트에 첨부하세요.</span></a>`).join("");
    const promptCards = PORTRAIT_PROMPTS.map((p, i) => `<button type="button" class="prompt-card" data-prompt-index="${i}"><span class="prompt-game">${escapeHtml(p.label)}</span><small>${escapeHtml(p.subtitle || "")}</small><b>이 프롬프트 선택·복사</b></button>`).join("");
    appEl.innerHTML = `<section class="panel image-step quest-panel">
      <div class="panel-icon">ART</div>
      <div class="eyebrow">STEP 5 · AI IMAGE ALLOWED</div>
      <h2>이제 캐릭터 초상화를 완성하세요.</h2>
      <p class="lead">역사 글은 ${IS_TEST_SESSION ? "테스트 모드라 잠기지 않았습니다." : "이미 잠겼습니다."} 이제부터는 외부 AI 이미지 사이트를 사용할 수 있습니다. <b>인터넷에서 해당 역사 인물의 실제 초상화·사진을 저장해 AI에 업로드한 뒤</b>, 아래 게임 스타일 중 하나를 골라 변환해 보세요.</p>

      <div class="image-workflow"><div><b>1</b><span>역사 인물 초상화 찾기</span></div><i>→</i><div><b>2</b><span>AI 사이트에 사진 업로드</span></div><i>→</i><div><b>3</b><span>게임 프롬프트 적용</span></div><i>→</i><div><b>4</b><span>완성 이미지 제출</span></div></div>
      <div class="tool-grid">${tools || `<div class="tool-note"><b>선생님이 안내한 이미지 도구를 사용하세요.</b><span>완성 이미지만 이곳에 첨부하면 됩니다.</span></div>`}</div>

      <div class="prompt-gallery"><div class="prompt-gallery-head"><div><div class="card-number">STYLE SELECT</div><h3>어떤 게임 캐릭터 느낌으로 만들까요?</h3></div><span>버튼을 누르면 프롬프트가 복사됩니다.</span></div><div class="prompt-card-grid">${promptCards}</div></div>
      <div id="selectedPromptBox" class="prompt-box" hidden><b id="selectedPromptTitle">선택한 프롬프트</b><code id="selectedPromptText"></code><button id="copyPromptAgain" type="button" class="secondary small">다시 복사</button></div>

      <div class="prompt-safety"><b>중요</b><span>프롬프트의 ‘업로드한 역사 인물 사진을 참고 이미지로 사용’이라는 문장을 지우지 마세요. 완전히 새로운 얼굴을 만드는 것이 아니라 <u>실제 역사 인물의 얼굴과 시대 특징을 유지한 게임 캐릭터화</u>가 목표입니다.</span></div>

      <label class="upload-box"><span id="uploadLabel">🖼 완성한 캐릭터 이미지 첨부</span><input id="imageInput" type="file" accept="image/*"></label>
      <p id="uploadNotice" class="notice"></p>
      ${localImageData ? `<img class="final-preview" src="${localImageData}" alt="최종 캐릭터">` : ""}

      <div class="image-optional-note"><b>이미지를 못 만들었거나 첨부 오류가 나도 제출할 수 있습니다.</b><span>네트워크·외부 사이트 오류를 고려해 이미지 첨부는 필수가 아닙니다. 그림의 미적 완성도도 역사 점수에 반영하지 않습니다.</span></div>
    </section>${navHtml({ next: true, nextLabel: "최종 확인 →" })}`;

    let selectedPrompt = "";
    appEl.querySelectorAll("[data-prompt-index]").forEach(btn => btn.addEventListener("click", async () => {
      const p = PORTRAIT_PROMPTS[Number(btn.dataset.promptIndex)]; if (!p) return;
      selectedPrompt = p.prompt;
      $("#selectedPromptTitle").textContent = `${p.label} 프롬프트`;
      $("#selectedPromptText").textContent = p.prompt;
      $("#selectedPromptBox").hidden = false;
      try { await navigator.clipboard.writeText(p.prompt); showToast(`${p.label} 프롬프트를 복사했습니다.`); } catch { showToast("프롬프트를 아래 상자에서 길게 눌러 복사하세요."); }
    }));
    $("#copyPromptAgain")?.addEventListener("click", async () => { if (!selectedPrompt) return; try { await navigator.clipboard.writeText(selectedPrompt); showToast("프롬프트를 다시 복사했습니다."); } catch {} });

    $("#imageInput").addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return alert("이미지 파일만 첨부할 수 있습니다.");
      if (file.size > 15 * 1024 * 1024) return alert("원본 이미지가 너무 큽니다. 15MB 이하 파일을 사용해주세요.");
      $("#uploadLabel").textContent = "이미지 압축·저장 중…";
      $("#uploadNotice").textContent = "";
      try {
        const data = await compressImage(file);
        await saveImageData(data, file.name);
        showToast("캐릭터 이미지가 저장되었습니다.");
        renderApp();
      } catch (err) {
        console.error(err);
        $("#uploadNotice").textContent = "이미지 처리에 실패했습니다. 다른 이미지를 시도하거나 이미지 없이 넘어가도 됩니다.";
        $("#uploadLabel").textContent = "🖼 완성한 캐릭터 이미지 첨부";
      }
    });

    bindNav(() => {
      if (!localImageData) {
        const ok = confirm("이미지가 첨부되지 않았습니다.\n\n오류 등으로 만들지 못한 경우 이미지 없이 제출해도 됩니다. 그대로 최종 확인으로 넘어갈까요?");
        if (!ok) return;
        state.finalImageAttached = false;
      }
      state.step = 6; queueSave(); renderApp(); window.scrollTo(0, 0);
    });
  }

  function renderReview() {
    const e = state.eventStudy;
    const checklist = [
      ["HISTORY", "대표 사건과 역사적 사실 4개가 수업 내용과 맞는가?"],
      ["BUILD", "게임 요소 4개 이상이 각각 역사적 사실과 연결되는가?"],
      ["WHY", "‘왜 이렇게 표현했는지’가 자신의 말로 설명되어 있는가?"],
      ["ART", localImageData ? "캐릭터 이미지가 정상적으로 첨부되었는가?" : "이미지 없이 제출할 사유를 확인했는가?"]
    ];
    appEl.innerHTML = `<section class="final-stage">
      <div class="final-stage-glow"></div>
      <div class="final-stage-head"><div><div class="eyebrow gold">STEP 6 · FINAL CHECK</div><h2>MISSION LOADOUT<br><span>제출 준비 완료?</span></h2><p>게임의 출전 준비 화면처럼 마지막으로 장비를 점검하세요. 이 화면의 확인이 끝나면 선생님에게 최종 제출됩니다.</p></div><div class="ready-rank"><span>READY</span><b>10</b><small>POINT RUBRIC</small></div></div>

      <div class="final-stage-grid">
        <div class="final-character-card final-loadout-card">
          <div class="final-profile-row">
            <div class="final-portrait">${localImageData ? `<img src="${localImageData}" alt="최종 캐릭터">` : `<div class="image-placeholder">NO IMAGE<br><small>이미지 미첨부</small></div>`}</div>
            <div class="final-profile-copy">
              <span class="sheet-kicker">${escapeHtml(ACTIVITY.unitLabel)}</span>
              <div class="final-player-tag">PLAYER · ${escapeHtml(state.className)}-${escapeHtml(state.studentNumber)}</div>
              <h3>${escapeHtml(state.selectedPerson)}</h3>
              <p>${escapeHtml(state.className)}반 ${escapeHtml(state.studentNumber)}번 · ${escapeHtml(state.studentName)}</p>
              <div class="final-event-chip"><small>MAIN EVENT</small><b>${escapeHtml(e.eventTitle)}</b></div>
            </div>
          </div>
          <div class="final-event-card">
            <div class="final-section-label"><span>HISTORY</span><b>대표 사건 설명</b></div>
            <p>${escapeHtml(e.eventSummary)}</p>
          </div>
          <div class="final-build-card">
            <div class="final-section-label"><span>BUILD</span><b>CHARACTER LOADOUT</b></div>
            <div class="final-build-grid">${state.gameElements.map((g, i) => `<div class="final-build-item ${g.kind}"><span>${i + 1}</span><div><small>${g.kind === "skill" ? "SKILL" : "STAT"}</small><b>${escapeHtml(g.name)}</b></div></div>`).join("")}</div>
          </div>
        </div>
        <div class="mission-check-panel"><div class="card-number">PRE-FLIGHT CHECK</div><h3>최종 점검</h3>${checklist.map((c,i)=>`<div class="mission-check"><span>${i+1}</span><div><b>${c[0]}</b><p>${c[1]}</p></div><em>CHECK</em></div>`).join("")}
          <div class="grading-notice"><b>🤖 AI 초벌 검토 안내</b><span>AI는 중학교 역사교사·역사교육 전문가의 기준을 바탕으로 선생님의 초벌 검토를 보조합니다. <strong>AI 점수가 그대로 성적이 되는 것은 아니며</strong>, 선생님이 직접 답안을 다시 확인한 뒤 최종 점수를 부여합니다.</span></div>
          ${IS_TEST_SESSION ? `<div class="test-mode-card"><b>🧪 TEST MODE</b><span>테스트 제출은 실제 최종 제출 상태로 잠기지 않습니다. 제출 버튼을 눌러 흐름을 확인한 뒤 다시 이전 단계로 이동할 수 있습니다.</span></div>` : `<div class="submit-warning">제출 후에는 학생 화면에서 수정할 수 없습니다. 필요한 내용이 있다면 지금 선생님께 질문하세요.</div>`}
          <button id="submitBtn" class="primary big final-submit">${IS_TEST_SESSION ? "🧪 테스트 제출 동작 확인" : "🏁 최종 제출하기"}</button>
        </div>
      </div>
    </section>${navHtml({ next: false })}`;

    $("#submitBtn").addEventListener("click", async () => {
      if (IS_TEST_SESSION) {
        state.testSubmittedAt = new Date().toISOString(); state.isTest = true; queueSave();
        showToast("TEST: 제출 동작을 확인했습니다. 이전 버튼으로 다시 돌아갈 수 있습니다.");
        return;
      }
      if (!confirm("최종 제출할까요?\n제출 후에는 학생 화면에서 수정할 수 없습니다.")) return;
      state.submitted = true;
      state.submittedAt = new Date().toISOString();
      queueSave();
      if (remoteEnabled && db) {
        try { await db.collection("submissions").doc(submissionId).set(state, { merge: true }); } catch (e2) { console.warn(e2); }
      }
      allowExit = true;
      renderApp(); window.scrollTo(0, 0);
    });

    bindNav(() => {});
  }

  function appendLog(log) {
    if (!state) return;
    state.logs.push(log);
    queueSave();
  }

  function onVisibility() {
    if (!state || IS_TEST_SESSION || state.step < 2 || state.step > 4 || state.textLocked || state.submitted) return;
    if (document.hidden) {
      awayStarted = Date.now();
      saveLocalNow();
    } else if (awayStarted) {
      const durationMs = Date.now() - awayStarted;
      appendLog({ id: id("away"), type: "away", step: state.step, at: new Date().toISOString(), durationMs });
      awayStarted = null;
      showToast(`화면 이탈 ${Math.max(1, Math.round(durationMs / 1000))}초가 과정 기록에 저장되었습니다.`);
    }
  }

  function onClipboard(e) {
    if (!state || IS_TEST_SESSION || state.step < 2 || state.step > 4 || state.textLocked || state.submitted) return;
    if (!["INPUT", "TEXTAREA"].includes(e.target?.tagName)) return;
    e.preventDefault();
    const field = e.target?.dataset?.field || e.target?.name || "unknown";
    const action = e.type;
    const charCount = e.clipboardData?.getData("text")?.length || 0;
    appendLog({ id: id("clipboard"), type: "clipboard", action, step: state.step, at: new Date().toISOString(), field, charCount });
    showToast(`${action === "paste" ? "붙여넣기" : action === "copy" ? "복사" : "잘라내기"}는 글쓰기 단계에서 사용할 수 없습니다.`);
  }

  function onContextMenu(e) {
    if (!state || IS_TEST_SESSION || state.step < 2 || state.step > 4 || state.textLocked || state.submitted) return;
    if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) { e.preventDefault(); showToast("글쓰기 입력칸에서는 복사·붙여넣기 메뉴를 사용할 수 없습니다."); }
  }

  function setupMonitoring() {
    const should = state && !IS_TEST_SESSION && state.step >= 2 && state.step <= 4 && !state.textLocked && !state.submitted;
    if (should && !monitoringOn) {
      document.addEventListener("visibilitychange", onVisibility);
      ["paste", "copy", "cut"].forEach(t => document.addEventListener(t, onClipboard));
      document.addEventListener("contextmenu", onContextMenu);
      monitoringOn = true;
    } else if (!should && monitoringOn) {
      document.removeEventListener("visibilitychange", onVisibility);
      ["paste", "copy", "cut"].forEach(t => document.removeEventListener(t, onClipboard));
      document.removeEventListener("contextmenu", onContextMenu);
      monitoringOn = false;
    }
  }

  function shouldWarnExit() {
    return Boolean(!IS_TEST_SESSION && state && !state.submitted && state.step >= 2);
  }

  function setupExitGuard() {
    if (guardInstalled) return;
    guardInstalled = true;
    try {
      history.replaceState({ historyCharacterGuard: true }, "", location.href);
      history.pushState({ historyCharacterGuard: true, buffer: true }, "", location.href);
    } catch {}

    window.addEventListener("popstate", () => {
      if (allowExit || !shouldWarnExit()) return;
      const ok = confirm("아직 수행활동이 끝나지 않았습니다.\n작성 내용은 자동 저장되지만, 정말 이 페이지에서 나갈까요?");
      if (ok) {
        allowExit = true;
        history.back();
      } else {
        try { history.pushState({ historyCharacterGuard: true, buffer: true }, "", location.href); } catch {}
      }
    });

    window.addEventListener("beforeunload", e => {
      saveLocalNow();
      if (!allowExit && shouldWarnExit()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Android 홈 버튼은 운영체제가 처리하므로 웹사이트가 '나가기 전' 확인창을 띄울 수 없습니다.
    // 대신 화면이 숨겨지는 즉시 로컬 저장하며, 복귀 시 이탈 시간을 기록합니다.
    window.addEventListener("pagehide", saveLocalNow);
  }

  function showLocalMode(reason) {
    remoteEnabled = false;
    setupBannerEl.hidden = false;
    setupBannerEl.innerHTML = `<b>테스트 모드</b> · ${escapeHtml(reason)} 실제 수업 전에 <code>config.js</code>의 Firebase 값을 입력하세요.`;
    setSaveText("테스트 모드 · 이 기기에 저장", "demo");
  }

  async function startWithUid(ownerUid) {
    uid = ownerUid;
    submissionId = makeSubmissionId(uid);
    state = await loadState(uid);
    state.isTest = IS_TEST_SESSION;
    state.schoolGrade = String(ACTIVITY.schoolGrade || state.schoolGrade || "");
    if (IS_TEST_SESSION && !state.studentName) { state.className = "0"; state.studentNumber = "0"; state.studentName = "교사테스트"; }
    if (IS_TEST_SESSION) { setupBannerEl.hidden = false; setupBannerEl.innerHTML = `<b>🧪 TEST MODE</b> · 단계 왕복과 수정이 자유롭고, 관리자 기본 목록에서는 테스트 데이터가 제외됩니다.`; setSaveText("TEST · 자동 저장", "demo"); }
    else if (remoteEnabled) setSaveText("✓ 저장됨");
    renderApp();
    setupExitGuard();
  }

  async function startLocal(reason) {
    showLocalMode(reason);
    await startWithUid(getDeviceUid());
  }

  async function bootstrap() {
    setupExitGuard();
    if (!isFirebaseConfigured()) {
      await startLocal("Firebase 설정값이 아직 입력되지 않았습니다.");
      return;
    }

    try {
      if (!window.firebase) throw new Error("Firebase SDK를 불러오지 못했습니다.");
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      const auth = firebase.auth();
      db = firebase.firestore();
      const credential = auth.currentUser ? { user: auth.currentUser } : await auth.signInAnonymously();
      remoteEnabled = true;
      setupBannerEl.hidden = true;
      await startWithUid(credential.user.uid);
    } catch (e) {
      console.error(e);
      await startLocal(`Firebase 연결에 실패했습니다: ${e.message || "알 수 없는 오류"}.`);
    }
  }

  window.addEventListener("online", () => { if (remoteEnabled) queueSave(); });
  bootstrap();
})();
