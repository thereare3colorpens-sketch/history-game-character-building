(() => {
  const CFG = window.HISTORY_APP_CONFIG || {};
  const FIREBASE_CONFIG = CFG.firebaseConfig || {};
  const PEOPLE = CFG.people || [];
  const ACTIVITY = CFG.activity || { academicYear: "2026", id: "activity", title: "역사 캐릭터 빌드", unitLabel: "역사", shortDescription: "" };
  const IMAGE_TOOLS = CFG.imageTools || [];

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

  if (activityMiniTitle) activityMiniTitle.textContent = `${ACTIVITY.academicYear} · ${ACTIVITY.unitLabel || ACTIVITY.title}`;

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
    return `${safeKey(ACTIVITY.academicYear)}__${safeKey(ACTIVITY.id)}__${ownerUid}`;
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
      activityId: String(ACTIVITY.id || ""),
      activityTitle: String(ACTIVITY.title || ""),
      unitLabel: String(ACTIVITY.unitLabel || ""),
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
    const prevDisabled = state.step === 1 || (state.textLocked && state.step === 5);
    return `<nav class="bottom-nav">
      <button id="prevBtn" class="secondary touch" ${prevDisabled ? "disabled" : ""}>← 이전</button>
      ${next ? `<button id="nextBtn" class="primary touch">${nextLabel}</button>` : ""}
    </nav>`;
  }

  function bindNav(nextHandler) {
    $("#prevBtn")?.addEventListener("click", () => {
      if (state.textLocked && state.step === 5) return;
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
    appEl.innerHTML = `<section class="hero intro-hero game-surface">
      <div class="intro-grid">
        <div>
          <div class="quest-badge">MAIN QUEST · ${escapeHtml(ACTIVITY.academicYear)}</div>
          <h1>역사를 배우고,<br><span>캐릭터를 빌드하라.</span></h1>
          <p class="hero-copy">이번 활동은 <b>인물의 전기를 외우는 과제</b>가 아닙니다. 한 역사적 인물을 입구로 삼아 그 인물과 연결된 <b>핵심 사건을 설명</b>하고, 배운 역사적 사실을 게임 캐릭터의 <b>기술·능력치</b>로 바꾸는 활동입니다.</p>
          <div class="hero-tags"><span>#${escapeHtml(ACTIVITY.unitLabel)}</span><span>#역사적사고</span><span>#게임캐릭터</span><span>#수행평가10점</span></div>
        </div>
        <div class="hero-art-wrap"><img src="./assets/hero-quest.svg" class="hero-art" alt="게임 캐릭터 카드 일러스트"></div>
      </div>

      <div class="mission-board">
        <div class="mission-title"><span>01</span><div><b>이번 미션에서 해야 할 일</b><small>결과보다 ‘역사적 근거 → 게임 표현’의 연결이 중요합니다.</small></div></div>
        <div class="mission-steps">
          <div><i>①</i><b>대표 사건 1개</b><span>선택한 인물과 연결된 가장 중요한 사건을 골라 2~3문장으로 정리</span></div>
          <div><i>②</i><b>역사적 사실 4개</b><span>그 사건 안에서 캐릭터 소재로 쓸 수 있는 사실을 한 문장씩 정리</span></div>
          <div><i>③</i><b>게임 요소 4개 이상</b><span>각 사실을 기술 또는 능력치로 자유롭게 변환하고 이유를 설명</span></div>
          <div><i>④</i><b>게임 캐릭터 초상화</b><span>글을 확정한 뒤에만 외부 AI 이미지 도구 사용 가능</span></div>
        </div>
      </div>

      <div class="example-chain">
        <div class="example-label">EXAMPLE</div>
        <div class="chain-node"><small>인물</small><b>콜럼버스</b></div><span class="chain-arrow">→</span>
        <div class="chain-node"><small>대표 사건</small><b>대항해시대</b></div><span class="chain-arrow">→</span>
        <div class="chain-node"><small>역사적 사실</small><b>서쪽으로 대서양을 횡단</b></div><span class="chain-arrow">→</span>
        <div class="chain-node accent"><small>게임 표현</small><b>기술 ‘서쪽 항로’</b></div>
      </div>

      <div class="score-board">
        <div class="score-title"><span>02</span><div><b>채점 기준 · 총 10점</b><small>그림 실력은 역사 점수에 넣지 않습니다.</small></div></div>
        <div class="score-row"><b>역사 사건·사실의 정확성</b><div class="score-bar"><span style="width:40%"></span></div><strong>4점</strong></div>
        <div class="score-row"><b>역사 사실 ↔ 게임 요소 연결</b><div class="score-bar"><span style="width:30%"></span></div><strong>3점</strong></div>
        <div class="score-row"><b>역사적 해석의 타당성·균형</b><div class="score-bar"><span style="width:20%"></span></div><strong>2점</strong></div>
        <div class="score-row"><b>설명의 완성도·명료성</b><div class="score-bar"><span style="width:10%"></span></div><strong>1점</strong></div>
      </div>

      <div class="rule-grid">
        <div class="rule-card ai-off"><div class="rule-icon">AI</div><b>STEP 1~4 · AI 사용 금지</b><span>역사 내용과 게임 요소는 자신의 생각으로 직접 작성합니다.</span></div>
        <div class="rule-card ai-on"><div class="rule-icon">IMG</div><b>STEP 5 · 이미지 AI 허용</b><span>글을 잠근 뒤 초상화 제작에만 외부 AI 도구를 사용할 수 있습니다.</span></div>
        <div class="rule-card"><div class="rule-icon">SAVE</div><b>자동 저장</b><span>입력할 때마다 이 기기와 서버에 자동 저장됩니다.</span></div>
        <div class="rule-card"><div class="rule-icon">LOG</div><b>과정 기록</b><span>STEP 1~4의 화면 이탈·붙여넣기 기록은 교사의 확인 자료로 남습니다.</span></div>
      </div>
      <div class="privacy-note"><b>화면을 벗어났다고 바로 감점하지 않습니다.</b> 오류·실수도 있을 수 있으므로 기록은 필요할 때 작성 과정을 확인하는 참고자료로만 사용합니다.</div>
    </section>${navHtml({ nextLabel: "캐릭터 생성 시작 →" })}`;
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
      <div class="activity-chip"><span>현재 활동</span><b>${escapeHtml(ACTIVITY.academicYear)} · ${escapeHtml(ACTIVITY.title)}</b></div>
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
      <label class="compact-fact"><span><b>FACT ${i + 1}</b> · 게임 요소로 바꿀 역사적 사실</span>
        <textarea data-fact="${i}" rows="2" data-field="fact-${i + 1}" placeholder="한 문장으로 쓰세요. 예: 마리 앙투아네트는 구체제 왕실의 사치와 특권을 상징하는 인물로 비판받았다.">${escapeHtml(f.text)}</textarea>
      </label>`).join("");
  }

  function renderFacts() {
    appEl.innerHTML = `<section>
      <div class="section-head game-heading">
        <div><div class="eyebrow">STEP 3 · HISTORY SOURCE</div><h2>인물보다 먼저,<br><span>사건을 잡으세요.</span></h2></div>
        <p>여러 사건을 억지로 찾을 필요 없습니다. <b>이 인물과 가장 관련 있는 큰 사건 1개</b>를 중심으로 정리하세요. 그 안에서 게임 캐릭터로 바꿀 수 있는 역사적 사실 4가지만 뽑습니다.</p>
      </div>

      <div class="event-card card">
        <div class="event-card-top"><div class="event-icon">📜</div><div><div class="card-number">MAIN EVENT</div><h3>${escapeHtml(state.selectedPerson)}와 연결되는 대표 사건</h3></div></div>
        <label>대표 사건 이름
          <input id="eventTitle" data-field="event-title" value="${escapeHtml(state.eventStudy.eventTitle)}" placeholder="예: 프랑스 혁명">
        </label>
        <label>이 사건은 어떤 사건인가요? <span class="mini-guide">2~3문장</span>
          <textarea id="eventSummary" data-field="event-summary" rows="3" placeholder="원인·전개·결과를 모두 길게 쓸 필요는 없습니다. 수업에서 배운 핵심이 드러나도록 2~3문장으로 설명하세요.">${escapeHtml(state.eventStudy.eventSummary)}</textarea>
        </label>
        <label>${escapeHtml(state.selectedPerson)}는 이 사건과 어떻게 연결되나요? <span class="mini-guide">1~2문장</span>
          <textarea id="personConnection" data-field="person-connection" rows="2" placeholder="이 인물의 역할·행동·상징성 중 사건 이해에 필요한 것만 적으세요.">${escapeHtml(state.eventStudy.personConnection)}</textarea>
        </label>
      </div>

      <div class="fact-zone">
        <div class="fact-zone-head"><div><div class="card-number">HISTORY FACT x4</div><h3>게임의 재료가 될 역사적 사실 4개</h3></div><span>각각 1문장 정도면 충분합니다.</span></div>
        <div class="fact-grid">${factInputs()}</div>
        <label class="source-note">근거 메모 <span class="optional">선택</span>
          <input id="sourceNote" data-field="source-note" value="${escapeHtml(state.eventStudy.sourceNote)}" placeholder="예: 교과서 p.134 / 수업 활동지 2쪽">
        </label>
      </div>

      <div class="tip-card"><b>💡 잘 쓴 답안은 ‘인물 정보’가 많아서 좋은 게 아닙니다.</b><span>대표 사건을 제대로 이해하고, 그 사건 속 역사적 사실을 캐릭터의 능력과 기술로 설득력 있게 바꾸면 됩니다.</span></div>
    </section>${navHtml()}`;

    $("#eventTitle").addEventListener("input", e => { state.eventStudy.eventTitle = e.target.value; queueSave(); });
    $("#eventSummary").addEventListener("input", e => { state.eventStudy.eventSummary = e.target.value; queueSave(); });
    $("#personConnection").addEventListener("input", e => { state.eventStudy.personConnection = e.target.value; queueSave(); });
    $("#sourceNote").addEventListener("input", e => { state.eventStudy.sourceNote = e.target.value; queueSave(); });
    appEl.querySelectorAll("[data-fact]").forEach(el => el.addEventListener("input", e => {
      state.eventStudy.facts[Number(e.target.dataset.fact)].text = e.target.value;
      queueSave();
    }));

    bindNav(() => {
      const e = state.eventStudy;
      if (!e.eventTitle.trim() || !e.eventSummary.trim() || !e.personConnection.trim() || !e.facts.every(f => f.text.trim())) {
        return alert("대표 사건, 사건 설명, 인물과의 연결, 역사적 사실 4개를 모두 작성해주세요.");
      }
      // 처음 진입하는 학생은 사실 1~4가 각각 하나씩 자동 연결되도록 보정
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

      <label>어떤 역사적 사실을 게임으로 바꿀까요?
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
          <b>⚠️ 글 잠금 전 마지막 점검</b>
          <p>아래 버튼을 누르면 <strong>학생 정보, 대표 사건, 역사적 사실, 기술·능력치가 모두 잠깁니다.</strong><br>잠근 뒤에는 학생이 직접 수정할 수 없고, 교사가 관리자 화면에서 잠금을 풀어야 합니다.</p>
          <ul class="lock-checklist"><li>오탈자를 확인했나요?</li><li>FACT 1~4를 모두 한 번 이상 사용했나요?</li><li>게임 효과보다 ‘역사적 근거’가 설명되어 있나요?</li></ul>
          <label class="confirm-check"><input id="lockAck" type="checkbox"> <span><b>확정 후에는 수정할 수 없다는 점을 확인했습니다.</b><br>지금 작성한 역사 글과 게임 빌드를 최종 확정하겠습니다.</span></label>
          <button id="lockBtn" class="primary lock-button" disabled>🔒 글 잠그고 초상화 퀘스트로 →</button>
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
      const ok = confirm("정말 글을 잠글까요?\n\n확정 후에는 학생 정보·역사 내용·게임 요소를 학생이 수정할 수 없습니다.\n수정이 필요하면 선생님이 관리자 화면에서 잠금을 풀어야 합니다.");
      if (!ok) return;
      state.textLocked = true;
      state.textLockedAt = new Date().toISOString();
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
    appEl.innerHTML = `<section class="panel image-step quest-panel">
      <div class="panel-icon">ART</div>
      <div class="eyebrow">STEP 5 · AI IMAGE ALLOWED</div>
      <h2>이제 캐릭터 초상화를 완성하세요.</h2>
      <p class="lead">역사 글은 이미 잠겼습니다. 지금부터는 외부 AI 이미지 사이트를 사용해도 됩니다. 역사 인물의 공개 초상화를 참고 이미지로 넣고, 게임 캐릭터처럼 재해석해 보세요.</p>

      <div class="tool-grid">${tools || `<div class="tool-note"><b>선생님이 안내한 이미지 도구를 사용하세요.</b><span>완성 이미지만 이곳에 첨부하면 됩니다.</span></div>`}</div>

      <div class="prompt-box"><b>복사해서 쓸 수 있는 추천 프롬프트</b><code>업로드한 역사 인물의 얼굴 특징과 시대 복식의 핵심 요소를 유지하고, 현대 판타지 전략 게임의 오리지널 캐릭터 초상화로 재해석해줘. 상반신 구도, 극적인 조명, 정교한 게임 일러스트, 글자와 로고 없음.</code></div>

      <label class="upload-box"><span id="uploadLabel">🖼 완성한 캐릭터 이미지 첨부</span><input id="imageInput" type="file" accept="image/*"></label>
      <p id="uploadNotice" class="notice"></p>
      ${localImageData ? `<img class="final-preview" src="${localImageData}" alt="최종 캐릭터">` : ""}

      <div class="image-optional-note"><b>이미지를 못 만들었거나 첨부 오류가 나도 제출할 수 있습니다.</b><span>수업 시간의 네트워크·사이트 오류를 고려해 이미지 첨부는 필수가 아닙니다. 그림의 미적 완성도도 역사 점수에 반영하지 않습니다.</span></div>
      <div class="tech-note"><b>왜 이미지가 빨리 올라가나요?</b><span>이 사이트가 이미지를 자동으로 작은 JPEG로 압축해 Firebase Firestore에 저장합니다.</span></div>
    </section>${navHtml({ next: true, nextLabel: "최종 확인 →" })}`;

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
    appEl.innerHTML = `<section>
      <div class="section-head game-heading">
        <div><div class="eyebrow">STEP 6 · FINAL CHECK</div><h2>최종 제출 전<br><span>캐릭터 시트를 확인하세요.</span></h2></div>
        <p>역사 글과 게임 요소는 이미 잠겨 있습니다. 초상화만 이전 버튼으로 돌아가 다시 첨부할 수 있습니다.</p>
      </div>
      <div class="character-sheet">
        <div class="sheet-profile">
          <div class="sheet-image">${localImageData ? `<img src="${localImageData}" alt="최종 캐릭터">` : `<div class="image-placeholder">NO IMAGE<br><small>이미지 미첨부</small></div>`}</div>
          <div><span class="sheet-kicker">${escapeHtml(ACTIVITY.unitLabel)}</span><h3>${escapeHtml(state.selectedPerson)}</h3><p>${escapeHtml(state.className)}반 ${escapeHtml(state.studentNumber)}번 ${escapeHtml(state.studentName)}</p></div>
        </div>
        <div class="sheet-event"><small>MAIN EVENT</small><b>${escapeHtml(e.eventTitle)}</b><p>${escapeHtml(e.eventSummary)}</p></div>
        <div class="sheet-build"><small>CHARACTER BUILD</small>${state.gameElements.map((g, i) => `<div><span>${i + 1}</span><b>[${g.kind === "skill" ? "기술" : "능력치"}] ${escapeHtml(g.name)}</b></div>`).join("")}</div>
      </div>
      <div class="submit-warning">제출 후에는 학생 화면에서 수정할 수 없습니다. 선생님에게 제출되며, 이후 교사가 10점 루브릭으로 평가합니다.</div>
      <button id="submitBtn" class="primary big">🏁 최종 제출하기</button>
    </section>${navHtml({ next: false })}`;

    $("#submitBtn").addEventListener("click", async () => {
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
    if (!state || state.step > 4 || state.textLocked || state.submitted) return;
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

  function onPaste(e) {
    if (!state || state.step > 4 || state.textLocked || state.submitted) return;
    const field = e.target?.dataset?.field || e.target?.name || "unknown";
    const charCount = e.clipboardData?.getData("text")?.length || 0;
    appendLog({ id: id("paste"), type: "paste", step: state.step, at: new Date().toISOString(), field, charCount });
  }

  function setupMonitoring() {
    const should = state && state.step <= 4 && !state.textLocked && !state.submitted;
    if (should && !monitoringOn) {
      document.addEventListener("visibilitychange", onVisibility);
      document.addEventListener("paste", onPaste);
      monitoringOn = true;
    } else if (!should && monitoringOn) {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("paste", onPaste);
      monitoringOn = false;
    }
  }

  function shouldWarnExit() {
    return Boolean(state && !state.submitted && state.step >= 2);
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
    if (remoteEnabled) setSaveText("✓ 저장됨");
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
