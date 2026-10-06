(() => {
  const CFG = window.HISTORY_APP_CONFIG || {};
  const FC = CFG.firebaseConfig || {};
  const ADMIN_EMAIL = CFG.adminEmail || "";
  const ACTIVITY = CFG.activity || {};
  const root = document.querySelector("#adminApp");

  let auth = null;
  let db = null;
  let allRows = [];
  let rows = [];
  let selected = null;
  let selectedImage = "";
  let yearFilter = "ALL";
  let gradeFilter = "ALL";
  let activityFilter = "ALL";
  let includeTest = false;
  let gradingBusy = false;

  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const awayLogs = s => s.logs?.filter(l => l.type === "away") || [];
  const pasteLogs = s => s.logs?.filter(l => l.type === "paste" || (l.type === "clipboard" && l.action === "paste")) || [];
  const clipboardLogs = s => s.logs?.filter(l => l.type === "clipboard" || l.type === "paste") || [];
  const awayMs = s => awayLogs(s).reduce((a, l) => a + (l.durationMs || 0), 0);
  const pasteCount = s => pasteLogs(s).length;
  const pasteChars = s => pasteLogs(s).reduce((a, l) => a + (l.charCount || 0), 0);
  const clipboardCount = s => clipboardLogs(s).length;
  const human = ms => { const sec = Math.round(ms / 1000), min = Math.floor(sec / 60), r = sec % 60; return min ? `${min}분 ${r}초` : `${r}초`; };

  function configured() {
    return ["apiKey", "authDomain", "projectId", "appId"].every(k => {
      const v = String(FC[k] || ""); return v && !v.includes("YOUR_") && !v.includes("YOUR_PROJECT");
    });
  }

  function blobDownload(name, text, type = "application/json") {
    const b = new Blob([text], { type });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }

  const csv = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  function gradingPacket(s) {
    return {
      academicYear: s.academicYear,
      schoolGrade: s.schoolGrade || ACTIVITY.schoolGrade || "",
      activityId: s.activityId,
      activityTitle: s.activityTitle,
      referenceGuide: s.referenceGuide || ACTIVITY.referenceGuide || "",
      pedagogyGuide: s.pedagogyGuide || ACTIVITY.pedagogyGuide || "",
      student: {
        className: s.className,
        studentNumber: s.studentNumber,
        studentName: s.studentName,
        selectedPerson: s.selectedPerson
      },
      eventStudy: s.eventStudy,
      gameElements: s.gameElements
    };
  }

  function applyFilters() {
    rows = allRows.filter(s => {
      const y = yearFilter === "ALL" || String(s.academicYear || "") === yearFilter;
      const g = gradeFilter === "ALL" || String(s.schoolGrade || "") === gradeFilter;
      const a = activityFilter === "ALL" || String(s.activityId || "") === activityFilter;
      const t = includeTest || !s.isTest;
      return y && g && a && t;
    }).sort((a, b) => {
      const ka = `${a.className || ""}-${String(a.studentNumber || "").padStart(3, "0")}`;
      const kb = `${b.className || ""}-${String(b.studentNumber || "").padStart(3, "0")}`;
      return ka.localeCompare(kb, "ko");
    });
    if (selected) selected = rows.find(r => r._docId === selected._docId) || null;
  }

  async function refresh() {
    try {
      const snap = await db.collection("submissions").get();
      allRows = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
      applyFilters();
      renderDashboard();
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="admin-login"><div><div class="eyebrow">ERROR</div><h1>데이터를 읽지 못했습니다.</h1><p>Firestore 규칙과 관리자 이메일 설정을 확인하세요.</p><pre class="error-box">${esc(e.message)}</pre></div></div>`;
    }
  }

  async function loadSelectedImage(s) {
    selectedImage = "";
    if (!s?.finalImageAttached) return;
    try {
      const snap = await db.collection("submissionImages").doc(s._docId).get();
      if (snap.exists) selectedImage = snap.data()?.imageData || "";
    } catch (e) {
      console.warn("image load failed", e);
    }
  }

  async function selectRow(s) {
    selected = s;
    await loadSelectedImage(s);
    renderDashboard();
  }

  function exportArchiveCsv() {
    const maxElems = Math.max(4, ...rows.map(s => s.gameElements?.length || 0));
    const h = ["학년도", "학년", "활동ID", "활동명", "테스트여부", "반", "번호", "이름", "인물", "대표사건", "사건설명", "인물-사건연결", "근거메모", "진행단계", "제출", "글잠금", "이미지첨부", "화면이탈횟수", "화면이탈총시간초", "클립보드시도횟수", "붙여넣기시도횟수", "붙여넣기시도글자수", "작성시작", "최종제출"];
    for (let i = 1; i <= 4; i++) h.push(`역사사실${i}`);
    for (let i = 1; i <= maxElems; i++) h.push(`요소${i}_유형`, `요소${i}_연결사실`, `요소${i}_이름`, `요소${i}_수준`, `요소${i}_효과`, `요소${i}_연결이유`, `요소${i}_한계`);
    h.push("AI_사실정확성", "AI_연결성", "AI_해석", "AI_명료성", "AI_총점", "AI_피드백", "AI_교사확인필요", "교사최종점수", "교사피드백", "평가업데이트");

    const lines = rows.map(s => {
      const ev = s.eventStudy || {};
      const a = s.assessment || {};
      const out = [s.academicYear, s.schoolGrade, s.activityId, s.activityTitle, s.isTest ? "TEST" : "", s.className, s.studentNumber, s.studentName, s.selectedPerson, ev.eventTitle, ev.eventSummary, ev.personConnection, ev.sourceNote, s.step, s.submitted ? "제출" : "작성중", s.textLocked ? "잠김" : "수정가능", s.finalImageAttached ? "있음" : "없음", awayLogs(s).length, Math.round(awayMs(s) / 1000), clipboardCount(s), pasteCount(s), pasteChars(s), s.createdAt || "", s.submittedAt || ""];
      for (let i = 0; i < 4; i++) out.push(ev.facts?.[i]?.text || "");
      for (let i = 0; i < maxElems; i++) {
        const e = s.gameElements?.[i] || {};
        const factText = ev.facts?.find(f => f.id === e.factId)?.text || "";
        out.push(e.kind === "stat" ? "능력치" : (e.kind ? "기술" : ""), factText, e.name, e.kind === "stat" ? e.level : "", e.effect, e.rationale, e.limitation);
      }
      const ai = a.aiDraft || {};
      const d = ai.details || {};
      out.push(d.historicalAccuracy ?? "", d.linkage ?? "", d.interpretation ?? "", d.clarity ?? "", ai.totalScore ?? a.aiDraftScore ?? "", ai.feedbackSummary ?? "", ai.teacherReviewNeeded ? (ai.teacherReviewNote || "확인 필요") : "", a.teacherScore ?? "", a.feedback ?? "", a.updatedAt ?? "");
      return out.map(csv).join(",");
    });

    const suffix = `${yearFilter}-${gradeFilter}-${activityFilter}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
    blobDownload(`history-character-students-${suffix}.csv`, "\ufeff" + [h.map(csv).join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
  }

  function exportAssessmentCsv() {
    const maxElems = Math.max(4, ...rows.map(s => s.gameElements?.length || 0));
    const h = [
      "학년도", "학년", "활동명", "반", "번호", "이름", "선택 인물", "대표 사건",
      "사건 설명", "인물-사건 관계"
    ];
    for (let i = 1; i <= 4; i++) h.push(`역사적 사실 ${i}`);
    for (let i = 1; i <= maxElems; i++) {
      h.push(
        `게임요소 ${i}_유형`, `게임요소 ${i}_활용 역사적 사실`, `게임요소 ${i}_이름`,
        `게임요소 ${i}_능력치 수준`, `게임요소 ${i}_효과`, `게임요소 ${i}_역사 연결 설명`, `게임요소 ${i}_한계·부작용`
      );
    }
    h.push(
      "AI_역사적 사실 정확성(4)", "AI_역사-게임 연결성(3)", "AI_역사적 해석(2)", "AI_명료성(1)",
      "AI_초벌 총점(10)", "AI_잘한 점", "AI_보완할 점", "AI_교사 확인 필요",
      "교사 최종점수(10)", "교사 피드백", "최종 제출 시각"
    );

    const lines = rows.map(s => {
      const ev = s.eventStudy || {};
      const a = s.assessment || {};
      const ai = a.aiDraft || {};
      const d = ai.details || {};
      const out = [
        s.academicYear, s.schoolGrade, s.activityTitle || s.activityId, s.className, s.studentNumber, s.studentName,
        s.selectedPerson, ev.eventTitle, ev.eventSummary, ev.personConnection
      ];
      for (let i = 0; i < 4; i++) out.push(ev.facts?.[i]?.text || "");
      for (let i = 0; i < maxElems; i++) {
        const e = s.gameElements?.[i] || {};
        const factText = ev.facts?.find(f => f.id === e.factId)?.text || "";
        out.push(
          e.kind === "stat" ? "능력치" : (e.kind ? "기술" : ""),
          factText, e.name || "", e.kind === "stat" ? (e.level ?? "") : "",
          e.effect || "", e.rationale || "", e.limitation || ""
        );
      }
      out.push(
        d.historicalAccuracy ?? "", d.linkage ?? "", d.interpretation ?? "", d.clarity ?? "",
        ai.totalScore ?? a.aiDraftScore ?? "",
        (ai.strengths || []).join(" / "), (ai.improvements || []).join(" / "),
        ai.teacherReviewNeeded ? (ai.teacherReviewNote || "확인 필요") : "",
        a.teacherScore ?? "", a.feedback ?? "", s.submittedAt || s.testSubmittedAt || ""
      );
      return out.map(csv).join(",");
    });

    const suffix = `${yearFilter}-${gradeFilter}-${activityFilter}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
    blobDownload(`수행평가-학생답안-${suffix}.csv`, "\ufeff" + [h.map(csv).join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
  }

  function exportScoreSummaryCsv() {
    const h = [
      "학년도", "학년", "활동명", "반", "번호", "이름", "선택 인물", "대표 사건",
      "AI_역사적 사실 정확성(4)", "AI_역사-게임 연결성(3)", "AI_역사적 해석(2)", "AI_명료성(1)",
      "AI_초벌 총점(10)", "AI_교사 확인 필요", "교사 최종점수(10)", "교사 피드백"
    ];
    const lines = rows.map(s => {
      const a = s.assessment || {}, ai = a.aiDraft || {}, d = ai.details || {}, ev = s.eventStudy || {};
      return [
        s.academicYear, s.schoolGrade, s.activityTitle || s.activityId, s.className, s.studentNumber, s.studentName,
        s.selectedPerson, ev.eventTitle, d.historicalAccuracy ?? "", d.linkage ?? "", d.interpretation ?? "", d.clarity ?? "",
        ai.totalScore ?? a.aiDraftScore ?? "", ai.teacherReviewNeeded ? (ai.teacherReviewNote || "확인 필요") : "",
        a.teacherScore ?? "", a.feedback ?? ""
      ].map(csv).join(",");
    });
    const suffix = `${yearFilter}-${gradeFilter}-${activityFilter}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
    blobDownload(`수행평가-점수요약-${suffix}.csv`, "\ufeff" + [h.map(csv).join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
  }

  function exportElementsCsv() {
    const h = ["학년도", "학년", "활동ID", "반", "번호", "이름", "인물", "대표사건", "요소번호", "유형", "연결역사사실", "요소이름", "능력치수준", "기술효과", "연결이유", "한계", "AI총점", "교사최종점수"];
    const lines = [];
    rows.forEach(s => {
      const ev = s.eventStudy || {}, a = s.assessment || {};
      (s.gameElements || []).forEach((e, i) => {
        const factText = ev.facts?.find(f => f.id === e.factId)?.text || "";
        lines.push([s.academicYear, s.schoolGrade, s.activityId, s.className, s.studentNumber, s.studentName, s.selectedPerson, ev.eventTitle, i + 1, e.kind === "stat" ? "능력치" : "기술", factText, e.name, e.kind === "stat" ? e.level : "", e.effect || "", e.rationale || "", e.limitation || "", a.aiDraftScore ?? "", a.teacherScore ?? ""].map(csv).join(","));
      });
    });
    const suffix = `${yearFilter}-${gradeFilter}-${activityFilter}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
    blobDownload(`history-character-elements-${suffix}.csv`, "\ufeff" + [h.map(csv).join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
  }

  function exportRawJson() {
    blobDownload(`history-character-raw-${yearFilter}-${activityFilter}.json`, JSON.stringify(rows, null, 2));
  }

  async function copyPacket(s) {
    await navigator.clipboard.writeText(JSON.stringify(gradingPacket(s), null, 2));
    alert("AI 평가용 패킷을 복사했습니다.");
  }

  function logTimeline(s) {
    const logs = [...(s.logs || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (!logs.length) return `<p class="hint">기록 없음</p>`;
    return `<div class="timeline">${logs.map(l => {
      if (l.type === "away") return `<div><b>STEP ${l.step} 화면 이탈</b><span>${human(l.durationMs || 0)} · ${esc(new Date(l.at).toLocaleTimeString("ko-KR"))}</span></div>`;
      const action = l.action === "copy" ? "복사 차단" : l.action === "cut" ? "잘라내기 차단" : "붙여넣기 차단";
      return `<div><b>STEP ${l.step} ${action}</b><span>${esc(l.field)} · ${l.charCount || 0}자 · ${esc(new Date(l.at).toLocaleTimeString("ko-KR"))}</span></div>`;
    }).join("")}</div>`;
  }

  async function callAiGrade(s, silent = false) {
    if (!s?.submitted && !(s?.isTest && s?.testSubmittedAt)) {
      if (!silent) alert("제출 완료된 학생만 AI 초벌평가를 실행할 수 있습니다. TEST 데이터는 테스트 제출 동작을 먼저 확인하세요.");
      return null;
    }
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(gradingPacket(s))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `AI 평가 실패 (${response.status})`);

    const strengths = data.strengths || [];
    const improvements = data.improvements || [];
    const feedbackSummary = [
      strengths.length ? `잘한 점: ${strengths.join(" / ")}` : "",
      improvements.length ? `보완할 점: ${improvements.join(" / ")}` : "",
      data.teacherReviewNeeded ? `교사 확인: ${data.teacherReviewNote || "추가 확인 필요"}` : ""
    ].filter(Boolean).join("\n");

    const assessment = {
      ...(s.assessment || {}),
      aiDraftScore: data.totalScore,
      aiDraft: { ...data, feedbackSummary, model: data.model || "" },
      updatedAt: new Date().toISOString()
    };
    await db.collection("submissions").doc(s._docId).set({ assessment }, { merge: true });
    return assessment;
  }

  function aiResultHtml(a) {
    const ai = a?.aiDraft;
    if (!ai) return `<p class="hint">아직 AI 초벌평가를 실행하지 않았습니다.</p>`;
    const d = ai.details || {};
    return `<div class="ai-grade-card">
      <div class="ai-score"><span>AI 초벌</span><b>${esc(ai.totalScore)}/10</b></div>
      <div class="rubric-mini"><span>사실 ${esc(d.historicalAccuracy ?? "-")}/4</span><span>연결 ${esc(d.linkage ?? "-")}/3</span><span>해석 ${esc(d.interpretation ?? "-")}/2</span><span>명료 ${esc(d.clarity ?? "-")}/1</span></div>
      <div class="grade-feedback"><b>잘한 점</b><ul>${(ai.strengths || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul><b>보완할 점</b><ul>${(ai.improvements || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>${ai.teacherReviewNeeded ? `<p class="danger-note"><b>교사 확인 필요</b><br>${esc(ai.teacherReviewNote || "")}</p>` : ""}</div>
      <small><b>중요:</b> 이 평가는 중학교 역사교사·역사교육 전문가 역할을 부여한 AI의 교사용 초벌 검토입니다. 점수가 그대로 반영되지 않을 수 있으며, 최종 점수는 교사가 학생 답안을 직접 검토한 뒤 확정합니다.<br>모델: ${esc(ai.model || "설정 모델")}</small>
    </div>`;
  }

  function renderDetail() {
    if (!selected) return `<aside class="detail-panel"><p class="empty">학생을 선택하면 세부 내용이 표시됩니다.</p></aside>`;
    const s = selected;
    const ev = s.eventStudy || {};
    const a = s.assessment || {};
    return `<aside class="detail-panel">
      <div class="detail-title"><div><h2>${esc(s.studentName)}</h2><p>${esc(s.className)}반 ${esc(s.studentNumber)}번 · ${esc(s.selectedPerson)}</p><small>${esc(s.academicYear)} · ${esc(s.schoolGrade || "-")}학년 · ${esc(s.activityTitle || s.activityId)}${s.isTest ? " · TEST" : ""}</small></div><button id="copyPacket" class="secondary small">평가용 JSON 복사</button></div>

      ${s.textLocked && !s.submitted ? `<div class="unlock-box"><b>학생 글이 잠겨 있습니다.</b><span>오잠금 등 필요한 경우에만 해제하세요.</span><button id="unlockText" class="secondary small">글잠금 해제</button></div>` : ""}

      <h3>대표 사건</h3>
      <div class="detail-block"><b>${esc(ev.eventTitle || "-")}</b><p>${esc(ev.eventSummary || "")}</p><small>인물 연결: ${esc(ev.personConnection || "")}</small>${ev.sourceNote ? `<small>근거: ${esc(ev.sourceNote)}</small>` : ""}</div>

      <h3>역사적 사실 4개</h3>
      ${(ev.facts || []).map((f, i) => `<div class="detail-block compact"><b>FACT ${i + 1}</b><p>${esc(f.text)}</p></div>`).join("")}

      <h3>게임 요소 ${s.gameElements?.length || 0}개</h3>
      ${s.gameElements?.map((e, i) => {
        const fact = ev.facts?.find(f => f.id === e.factId)?.text || "";
        return `<div class="detail-block"><b>${i + 1}. [${e.kind === "skill" ? "기술" : "능력치"}] ${esc(e.name)}</b><small>근거 FACT: ${esc(fact)}</small>${e.kind === "stat" ? `<p>수준 ${e.level}/5</p>` : `<p>${esc(e.effect)}</p>`}<p>${esc(e.rationale)}</p>${e.limitation ? `<small>한계: ${esc(e.limitation)}</small>` : ""}</div>`;
      }).join("") || ""}

      <h3>과정 기록</h3>
      <div class="signal-grid"><div><b>${awayLogs(s).length}</b><span>화면 이탈</span></div><div><b>${human(awayMs(s))}</b><span>총 이탈 시간</span></div><div><b>${clipboardCount(s)}</b><span>클립보드 차단 시도</span></div></div>
      <details class="log-details"><summary>상세 과정 로그 보기</summary>${logTimeline(s)}</details>
      <p class="danger-note">과정 신호는 자동 감점 자료가 아닙니다. 필요하면 학생에게 작성한 기술의 근거를 짧게 구두 설명하게 해 확인하세요.</p>

      <h3>AI 초벌평가</h3>
      <div class="ai-review-disclaimer"><b>교사용 초벌 검토</b><span>AI에는 ‘대한민국 중학교 역사교사 + 역사교육 전문가’ 역할과 이 활동의 루브릭을 함께 전달합니다. AI 점수는 참고값이며, <strong>학생 성적은 교사가 직접 검토한 뒤 최종 확정</strong>합니다.</span></div>
      <button id="runAiGrade" class="primary" ${gradingBusy ? "disabled" : ""}>${gradingBusy ? "AI 평가 중…" : "✨ AI 초벌평가 실행"}</button>
      ${aiResultHtml(a)}

      <h3>교사 최종평가</h3>
      <label>교사 최종점수 (10점)<input id="teacherScore" type="number" min="0" max="10" step="0.5" value="${esc(a.teacherScore ?? "")}"></label>
      <label>교사 피드백<textarea id="teacherFeedback" rows="5" placeholder="AI 초벌평가를 검토한 뒤 최종 피드백을 기록하세요.">${esc(a.feedback ?? "")}</textarea></label>
      <button id="saveAssessment" class="primary">최종평가 저장</button>

      <h3>최종 이미지</h3>
      ${selectedImage ? `<img class="admin-image" src="${selectedImage}" alt="학생 최종 캐릭터">` : `<p class="image-missing"><b>이미지 미첨부</b><span>오류 등의 이유로 이미지 없이 제출했거나 아직 이미지를 불러오지 못했습니다.</span></p>`}
    </aside>`;
  }

  function filterOptions() {
    const years = [...new Set(allRows.map(r => String(r.academicYear || "")).filter(Boolean))].sort().reverse();
    const grades = [...new Set(allRows.map(r => String(r.schoolGrade || "")).filter(Boolean))].sort();
    const activities = [...new Map(allRows.map(r => [String(r.activityId || ""), r.activityTitle || r.activityId || ""])).entries()].filter(([id]) => id);
    return { years, grades, activities };
  }

  function renderDashboard() {
    const { years, grades, activities } = filterOptions();
    const submittedCount = rows.filter(r => r.submitted || (r.isTest && r.testSubmittedAt)).length;
    const aiCount = rows.filter(r => r.assessment?.aiDraftScore != null).length;
    const teacherCount = rows.filter(r => r.assessment?.teacherScore != null).length;
    const reviewCount = rows.filter(r => r.assessment?.aiDraft?.teacherReviewNeeded).length;

    root.innerHTML = `<section class="admin-hero">
      <div class="admin-hero-copy">
        <div class="eyebrow">TEACHER DASHBOARD</div>
        <h1>역사 캐릭터 수행평가</h1>
        <p>학생 답안 확인부터 AI 초벌 검토, 교사 최종평가와 데이터 정리까지 한 화면에서 관리합니다.</p>
      </div>
      <div class="admin-hero-side">
        <div class="current-activity-badge"><span>CURRENT ACTIVITY</span><b>${esc(ACTIVITY.academicYear || "-")} · ${esc(ACTIVITY.schoolGrade || "-")}학년</b><small>${esc(ACTIVITY.title || ACTIVITY.id || "-")}</small></div>
        <button id="logout" class="admin-logout">로그아웃</button>
      </div>
    </section>

    <section class="admin-stat-grid">
      <div class="admin-stat-card purple"><span>현재 표시</span><b>${rows.length}</b><small>필터 조건에 해당하는 학생</small></div>
      <div class="admin-stat-card cyan"><span>제출 완료</span><b>${submittedCount}</b><small>${rows.length ? Math.round(submittedCount / rows.length * 100) : 0}% 완료</small></div>
      <div class="admin-stat-card gold"><span>AI 초벌평가</span><b>${aiCount}</b><small>${reviewCount ? `교사 확인 필요 ${reviewCount}명` : "검토 신호 없음"}</small></div>
      <div class="admin-stat-card green"><span>최종평가 완료</span><b>${teacherCount}</b><small>교사가 점수를 확정한 학생</small></div>
    </section>

    <section class="admin-toolbar-card">
      <div class="admin-toolbar-title"><div><span>DATA & ACTIONS</span><b>평가에 필요한 자료만 바로 내려받기</b><small>화면 이탈·클립보드 로그 같은 기술 정보는 아래 고급 백업에만 포함됩니다.</small></div></div>
      <div class="admin-toolbar-actions">
        <button id="assessmentCsv" class="admin-download primary-download"><span>📊</span><div><b>학생 답안 CSV</b><small>작성 내용 + AI 초벌 + 교사 평가</small></div></button>
        <button id="scoreCsv" class="admin-download"><span>✓</span><div><b>점수 요약 CSV</b><small>학생 정보 + AI/최종 점수만</small></div></button>
        <button id="batchAi" class="admin-download ai-download"><span>✨</span><div><b>AI 일괄평가</b><small>현재 목록의 미평가 제출본</small></div></button>
        <button id="refresh" class="admin-icon-button" title="새로고침">↻</button>
      </div>
      <details class="admin-backup-menu">
        <summary>고급 / 백업 데이터</summary>
        <div><button id="archiveCsv" class="secondary small">전체 기록 CSV</button><button id="elementsCsv" class="secondary small">게임요소 분석 CSV</button><button id="rawJson" class="secondary small">원본 JSON</button><span>과정 로그·화면 이탈·붙여넣기 기록 등은 백업 파일에서만 확인합니다.</span></div>
      </details>
    </section>

    <section class="filter-bar admin-filter-bar">
      <div class="filter-heading"><span>FILTER</span><b>학생 목록 범위</b></div>
      <label>학년도<select id="yearFilter"><option value="ALL">전체 학년도</option>${years.map(y => `<option value="${esc(y)}" ${yearFilter === y ? "selected" : ""}>${esc(y)}학년도</option>`).join("")}</select></label>
      <label>학년<select id="gradeFilter"><option value="ALL">전체 학년</option>${grades.map(g => `<option value="${esc(g)}" ${gradeFilter === g ? "selected" : ""}>${esc(g)}학년</option>`).join("")}</select></label>
      <label>활동<select id="activityFilter"><option value="ALL">전체 활동</option>${activities.map(([id, title]) => `<option value="${esc(id)}" ${activityFilter === id ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>
      <label class="test-filter"><input id="includeTest" type="checkbox" ${includeTest ? "checked" : ""}> TEST 데이터 포함</label>
    </section>

    <div class="admin-grid">
      <section class="table-card admin-table-card">
        <div class="table-card-head"><div><span>STUDENT LIST</span><b>${rows.length}명의 수행 기록</b></div><small>학생을 선택하면 오른쪽에서 답안·과정·평가를 자세히 볼 수 있습니다.</small></div>
        <table><thead><tr><th>학년도/학년</th><th>학생</th><th>인물 / 사건</th><th>진행</th><th>AI 초벌</th><th>최종점수</th><th>과정 신호</th><th></th></tr></thead><tbody>
        ${rows.map((s, i) => `<tr class="${selected?._docId === s._docId ? "selected-row" : ""}"><td>${esc(s.academicYear || "-")}<small>${esc(s.schoolGrade || "-")}학년${s.isTest ? " · TEST" : ""}</small></td><td><b>${esc(s.className)}반 ${esc(s.studentNumber)}번</b><small>${esc(s.studentName)}</small></td><td><b class="person-cell">${esc(s.selectedPerson || "-")}</b><small>${esc(s.eventStudy?.eventTitle || "-")}</small></td><td><span class="status ${s.submitted ? "done" : ""}">${s.submitted ? "제출" : (s.isTest && s.testSubmittedAt ? "TEST 제출확인" : `STEP ${s.step}`)}</span>${s.textLocked && !s.submitted ? `<small>글 잠김</small>` : ""}</td><td>${s.assessment?.aiDraftScore != null ? `<b class="score-chip ai">${esc(s.assessment.aiDraftScore)}/10</b>` : `<span class="muted-dash">—</span>`}</td><td>${s.assessment?.teacherScore != null ? `<b class="score-chip teacher">${esc(s.assessment.teacherScore)}/10</b>` : `<span class="muted-dash">—</span>`}</td><td><span class="signal-pill">이탈 ${awayLogs(s).length} · 붙여넣기 ${pasteCount(s)}</span></td><td><button class="link-btn view-button" data-view="${i}">보기</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">조건에 맞는 제출물이 없습니다.</td></tr>`}
      </tbody></table></section>
      ${renderDetail()}
    </div>`;

    root.querySelector("#refresh").onclick = refresh;
    root.querySelector("#assessmentCsv").onclick = exportAssessmentCsv;
    root.querySelector("#scoreCsv").onclick = exportScoreSummaryCsv;
    root.querySelector("#archiveCsv").onclick = exportArchiveCsv;
    root.querySelector("#elementsCsv").onclick = exportElementsCsv;
    root.querySelector("#rawJson").onclick = exportRawJson;
    root.querySelector("#logout").onclick = () => auth.signOut();
    root.querySelector("#yearFilter").onchange = e => { yearFilter = e.target.value; applyFilters(); selected = null; selectedImage = ""; renderDashboard(); };
    root.querySelector("#gradeFilter").onchange = e => { gradeFilter = e.target.value; applyFilters(); selected = null; selectedImage = ""; renderDashboard(); };
    root.querySelector("#includeTest").onchange = e => { includeTest = e.target.checked; applyFilters(); selected = null; selectedImage = ""; renderDashboard(); };
    root.querySelector("#activityFilter").onchange = e => { activityFilter = e.target.value; applyFilters(); selected = null; selectedImage = ""; renderDashboard(); };
    root.querySelectorAll("[data-view]").forEach(b => b.onclick = () => selectRow(rows[Number(b.dataset.view)]));
    root.querySelector("#copyPacket")?.addEventListener("click", () => copyPacket(selected));

    root.querySelector("#unlockText")?.addEventListener("click", async () => {
      if (!confirm("이 학생의 글잠금을 해제하고 STEP 4로 돌릴까요? 학생에게 페이지 새로고침을 안내해야 합니다.")) return;
      await db.collection("submissions").doc(selected._docId).set({ textLocked: false, step: 4, unlockedAt: new Date().toISOString() }, { merge: true });
      alert("잠금을 해제했습니다. 학생에게 페이지를 새로고침하라고 안내하세요.");
      await refresh();
    });

    root.querySelector("#runAiGrade")?.addEventListener("click", async () => {
      gradingBusy = true; renderDashboard();
      try {
        await callAiGrade(selected);
        await refresh();
        selected = rows.find(r => r._docId === selected?._docId) || selected;
        if (selected) await loadSelectedImage(selected);
        alert("AI 초벌평가를 완료했습니다. 점수와 피드백을 검토한 뒤 교사 최종점수를 입력하세요.");
      } catch (e) {
        console.error(e); alert(e.message);
      } finally { gradingBusy = false; renderDashboard(); }
    });

    root.querySelector("#batchAi").onclick = async () => {
      const targets = rows.filter(s => (s.submitted || (s.isTest && s.testSubmittedAt)) && s.assessment?.aiDraftScore == null);
      if (!targets.length) return alert("현재 목록에 AI 미평가 제출본이 없습니다.");
      if (!confirm(`${targets.length}명의 제출물을 순서대로 AI 초벌평가할까요? OpenAI API 사용량이 발생합니다.`)) return;
      gradingBusy = true; renderDashboard();
      let done = 0, fail = 0;
      for (const s of targets) {
        try { await callAiGrade(s, true); done++; } catch (e) { console.warn(e); fail++; }
      }
      gradingBusy = false;
      await refresh();
      alert(`일괄평가 완료: 성공 ${done}명 / 실패 ${fail}명`);
    };

    root.querySelector("#saveAssessment")?.addEventListener("click", async () => {
      const teacherScore = root.querySelector("#teacherScore").value;
      const feedback = root.querySelector("#teacherFeedback").value;
      const assessment = {
        ...(selected.assessment || {}),
        teacherScore: teacherScore === "" ? null : Number(teacherScore),
        feedback,
        updatedAt: new Date().toISOString()
      };
      await db.collection("submissions").doc(selected._docId).set({ assessment }, { merge: true });
      alert("교사 최종평가를 저장했습니다.");
      await refresh();
    });
  }

  function renderLogin(msg = "") {
    root.innerHTML = `<main class="admin-login"><div class="admin-login-card"><div class="eyebrow">TEACHER ONLY</div><h1>교사 관리자</h1><p>${msg || "config.js에 등록한 교사 Google 계정으로 로그인하세요."}</p><button id="login" class="primary">Google로 로그인</button><p id="loginError" class="admin-login-error" style="display:none"></p></div></main>`;
    const btn = root.querySelector("#login");
    const err = root.querySelector("#loginError");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Google 로그인 중…";
      if (err) err.style.display = "none";
      try {
        // 학생용 익명 로그인과 교사용 Google 로그인이 같은 브라우저에서 충돌하지 않도록
        // 관리자 전용 Firebase App/Auth 인스턴스를 사용합니다.
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await auth.signInWithPopup(provider);
      } catch (e) {
        console.error("Teacher login failed", e);
        if (err) {
          err.style.display = "block";
          err.textContent = `로그인 오류: ${e?.code || e?.message || "알 수 없는 오류"}`;
        }
        btn.disabled = false;
        btn.textContent = "Google로 로그인";
      }
    };
  }

  function renderSetup() {
    root.innerHTML = `<main class="admin-login"><div class="setup-card"><div class="eyebrow">SETUP REQUIRED</div><h1>Firebase 설정이 필요합니다.</h1><p>학생 화면은 테스트 모드로 열리지만, 교사가 모든 학생의 데이터를 모아 보려면 <code>config.js</code>에 Firebase 웹앱 설정값을 입력해야 합니다.</p><ol><li>Firebase Authentication에서 Anonymous와 Google 로그인 활성화</li><li>Cloud Firestore 데이터베이스 생성</li><li><code>config.js</code>의 Firebase 값과 관리자 이메일 변경</li><li><code>firestore.rules</code>의 교사 이메일 변경 후 규칙 게시</li><li>Vercel 배포 후 Firebase Authentication의 승인된 도메인에 Vercel 주소 추가</li></ol><p><b>v4는 Firebase Storage를 쓰지 않습니다.</b> 학생 이미지를 압축해 Firestore의 별도 문서에 저장하므로 Storage용 Blaze 요금제가 필요하지 않습니다.</p></div></main>`;
  }

  async function bootstrap() {
    if (!configured() || !window.firebase) return renderSetup();
    try {
      // 중요: 학생 페이지는 기본 Firebase App에서 익명 로그인을 사용합니다.
      // 관리자 페이지는 별도의 named App을 사용해 같은 기기/브라우저에서도
      // 학생 익명 세션과 교사 Google 세션이 서로 덮어쓰지 않게 분리합니다.
      const ADMIN_APP_NAME = "historyTeacherAdmin";
      let adminApp = firebase.apps.find(a => a.name === ADMIN_APP_NAME);
      if (!adminApp) adminApp = firebase.initializeApp(FC, ADMIN_APP_NAME);
      auth = adminApp.auth();
      db = adminApp.firestore();

      auth.onAuthStateChanged(async u => {
        if (!u) return renderLogin();
        if (!u.email) {
          await auth.signOut().catch(() => {});
          return renderLogin("교사용 Google 로그인이 필요합니다. 아래 버튼을 눌러 관리자 계정을 선택하세요.");
        }
        if (String(u.email || "").toLowerCase() !== String(ADMIN_EMAIL).toLowerCase()) {
          const wrong = u.email;
          await auth.signOut().catch(() => {});
          return renderLogin(`현재 계정 ${esc(wrong)}은(는) 관리자 계정이 아닙니다. config.js에 등록한 관리자 Google 계정으로 로그인하세요.`);
        }
        await refresh();
      });
    } catch (e) {
      console.error(e);
      renderLogin(`관리자 초기화 오류: ${esc(e?.code || e?.message || "알 수 없는 오류")}`);
    }
  }

  bootstrap();
})();
