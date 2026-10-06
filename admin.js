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
  let activityFilter = "ALL";
  let gradingBusy = false;

  const esc = (v = "") => String(v).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const awayLogs = s => s.logs?.filter(l => l.type === "away") || [];
  const pasteLogs = s => s.logs?.filter(l => l.type === "paste") || [];
  const awayMs = s => awayLogs(s).reduce((a, l) => a + (l.durationMs || 0), 0);
  const pasteCount = s => pasteLogs(s).length;
  const pasteChars = s => pasteLogs(s).reduce((a, l) => a + (l.charCount || 0), 0);
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
      activityId: s.activityId,
      activityTitle: s.activityTitle,
      referenceGuide: ACTIVITY.referenceGuide || "",
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
      const a = activityFilter === "ALL" || String(s.activityId || "") === activityFilter;
      return y && a;
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

  function exportCsv() {
    const maxElems = Math.max(4, ...rows.map(s => s.gameElements?.length || 0));
    const h = ["학년도", "활동ID", "활동명", "반", "번호", "이름", "인물", "대표사건", "사건설명", "인물-사건연결", "근거메모", "진행단계", "제출", "글잠금", "이미지첨부", "화면이탈횟수", "화면이탈총시간초", "붙여넣기횟수", "붙여넣기총글자수"];
    for (let i = 1; i <= 4; i++) h.push(`역사사실${i}`);
    for (let i = 1; i <= maxElems; i++) h.push(`요소${i}_유형`, `요소${i}_연결사실`, `요소${i}_이름`, `요소${i}_수준`, `요소${i}_효과`, `요소${i}_연결이유`, `요소${i}_한계`);
    h.push("AI_사실정확성", "AI_연결성", "AI_해석", "AI_명료성", "AI_총점", "AI_피드백", "교사최종점수", "교사피드백");

    const lines = rows.map(s => {
      const ev = s.eventStudy || {};
      const a = s.assessment || {};
      const out = [s.academicYear, s.activityId, s.activityTitle, s.className, s.studentNumber, s.studentName, s.selectedPerson, ev.eventTitle, ev.eventSummary, ev.personConnection, ev.sourceNote, s.step, s.submitted ? "제출" : "작성중", s.textLocked ? "잠김" : "수정가능", s.finalImageAttached ? "있음" : "없음", awayLogs(s).length, Math.round(awayMs(s) / 1000), pasteCount(s), pasteChars(s)];
      for (let i = 0; i < 4; i++) out.push(ev.facts?.[i]?.text || "");
      for (let i = 0; i < maxElems; i++) {
        const e = s.gameElements?.[i] || {};
        const factText = ev.facts?.find(f => f.id === e.factId)?.text || "";
        out.push(e.kind === "stat" ? "능력치" : (e.kind ? "기술" : ""), factText, e.name, e.kind === "stat" ? e.level : "", e.effect, e.rationale, e.limitation);
      }
      const ai = a.aiDraft || {};
      const d = ai.details || {};
      out.push(d.historicalAccuracy ?? "", d.linkage ?? "", d.interpretation ?? "", d.clarity ?? "", ai.totalScore ?? a.aiDraftScore ?? "", ai.feedbackSummary ?? "", a.teacherScore ?? "", a.feedback ?? "");
      return out.map(csv).join(",");
    });

    const suffix = `${yearFilter}-${activityFilter}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
    blobDownload(`history-character-${suffix}.csv`, "\ufeff" + [h.map(csv).join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
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
      return `<div><b>STEP ${l.step} 붙여넣기</b><span>${esc(l.field)} · ${l.charCount || 0}자 · ${esc(new Date(l.at).toLocaleTimeString("ko-KR"))}</span></div>`;
    }).join("")}</div>`;
  }

  async function callAiGrade(s, silent = false) {
    if (!s?.submitted) {
      if (!silent) alert("제출 완료된 학생만 AI 초벌평가를 실행할 수 있습니다.");
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
      <small>모델: ${esc(ai.model || "설정 모델")} · AI 점수는 교사용 초벌값이며 최종점수는 교사가 확정합니다.</small>
    </div>`;
  }

  function renderDetail() {
    if (!selected) return `<aside class="detail-panel"><p class="empty">학생을 선택하면 세부 내용이 표시됩니다.</p></aside>`;
    const s = selected;
    const ev = s.eventStudy || {};
    const a = s.assessment || {};
    return `<aside class="detail-panel">
      <div class="detail-title"><div><h2>${esc(s.studentName)}</h2><p>${esc(s.className)}반 ${esc(s.studentNumber)}번 · ${esc(s.selectedPerson)}</p><small>${esc(s.academicYear)} · ${esc(s.activityTitle || s.activityId)}</small></div><button id="copyPacket" class="secondary small">평가용 JSON 복사</button></div>

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
      <div class="signal-grid"><div><b>${awayLogs(s).length}</b><span>화면 이탈</span></div><div><b>${human(awayMs(s))}</b><span>총 이탈 시간</span></div><div><b>${pasteCount(s)}</b><span>붙여넣기</span></div></div>
      <details class="log-details"><summary>상세 과정 로그 보기</summary>${logTimeline(s)}</details>
      <p class="danger-note">과정 신호는 자동 감점 자료가 아닙니다. 필요하면 학생에게 작성한 기술의 근거를 짧게 구두 설명하게 해 확인하세요.</p>

      <h3>AI 초벌평가</h3>
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
    const activities = [...new Map(allRows.map(r => [String(r.activityId || ""), r.activityTitle || r.activityId || ""])).entries()].filter(([id]) => id);
    return { years, activities };
  }

  function renderDashboard() {
    const { years, activities } = filterOptions();
    root.innerHTML = `<header class="admin-head">
      <div><div class="eyebrow">TEACHER DASHBOARD</div><h1>역사 캐릭터 수행평가</h1><p>${rows.length}명 표시 · ${rows.filter(r => r.submitted).length}명 제출 · 전체 ${allRows.length}건 보관</p></div>
      <div class="admin-actions"><button id="refresh" class="secondary">새로고침</button><button id="csv" class="secondary">현재 목록 CSV</button><button id="rawJson" class="secondary">현재 목록 JSON</button><button id="batchAi" class="secondary">미평가 제출본 AI 일괄평가</button><button id="logout" class="ghost">로그아웃</button></div>
    </header>
    <section class="filter-bar">
      <label>학년도<select id="yearFilter"><option value="ALL">전체 학년도</option>${years.map(y => `<option value="${esc(y)}" ${yearFilter === y ? "selected" : ""}>${esc(y)}학년도</option>`).join("")}</select></label>
      <label>활동<select id="activityFilter"><option value="ALL">전체 활동</option>${activities.map(([id, title]) => `<option value="${esc(id)}" ${activityFilter === id ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>
      <div class="filter-summary"><span>현재 설정</span><b>${esc(ACTIVITY.academicYear || "-")} · ${esc(ACTIVITY.title || ACTIVITY.id || "-")}</b></div>
    </section>
    <div class="admin-grid">
      <section class="table-card"><table><thead><tr><th>학년도</th><th>학생</th><th>인물 / 사건</th><th>상태</th><th>AI</th><th>화면 이탈</th><th>붙여넣기</th><th></th></tr></thead><tbody>
        ${rows.map((s, i) => `<tr class="${selected?._docId === s._docId ? "selected-row" : ""}"><td>${esc(s.academicYear || "-")}</td><td><b>${esc(s.className)}반 ${esc(s.studentNumber)}번</b><small>${esc(s.studentName)}</small></td><td>${esc(s.selectedPerson || "-")}<small>${esc(s.eventStudy?.eventTitle || "-")}</small></td><td><span class="status ${s.submitted ? "done" : ""}">${s.submitted ? "제출" : `STEP ${s.step}`}</span>${s.textLocked && !s.submitted ? `<small>글 잠김</small>` : ""}</td><td>${s.assessment?.aiDraftScore != null ? `<b>${esc(s.assessment.aiDraftScore)}/10</b>` : "—"}</td><td>${awayLogs(s).length}회 · ${human(awayMs(s))}</td><td>${pasteCount(s)}회</td><td><button class="link-btn" data-view="${i}">보기</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">조건에 맞는 제출물이 없습니다.</td></tr>`}
      </tbody></table></section>
      ${renderDetail()}
    </div>`;

    root.querySelector("#refresh").onclick = refresh;
    root.querySelector("#csv").onclick = exportCsv;
    root.querySelector("#rawJson").onclick = exportRawJson;
    root.querySelector("#logout").onclick = () => auth.signOut();
    root.querySelector("#yearFilter").onchange = e => { yearFilter = e.target.value; applyFilters(); selected = null; selectedImage = ""; renderDashboard(); };
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
      const targets = rows.filter(s => s.submitted && s.assessment?.aiDraftScore == null);
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
    root.innerHTML = `<main class="admin-login"><div class="admin-login-card"><div class="eyebrow">TEACHER ONLY</div><h1>교사 관리자</h1><p>${msg || "config.js에 등록한 교사 Google 계정으로 로그인하세요."}</p><button id="login" class="primary">Google로 로그인</button></div></main>`;
    root.querySelector("#login").onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  }

  function renderSetup() {
    root.innerHTML = `<main class="admin-login"><div class="setup-card"><div class="eyebrow">SETUP REQUIRED</div><h1>Firebase 설정이 필요합니다.</h1><p>학생 화면은 테스트 모드로 열리지만, 교사가 모든 학생의 데이터를 모아 보려면 <code>config.js</code>에 Firebase 웹앱 설정값을 입력해야 합니다.</p><ol><li>Firebase Authentication에서 Anonymous와 Google 로그인 활성화</li><li>Cloud Firestore 데이터베이스 생성</li><li><code>config.js</code>의 Firebase 값과 관리자 이메일 변경</li><li><code>firestore.rules</code>의 교사 이메일 변경 후 규칙 게시</li><li>Vercel 배포 후 Firebase Authentication의 승인된 도메인에 Vercel 주소 추가</li></ol><p><b>v3는 Firebase Storage를 쓰지 않습니다.</b> 학생 이미지를 압축해 Firestore의 별도 문서에 저장하므로 Storage용 Blaze 요금제가 필요하지 않습니다.</p></div></main>`;
  }

  async function bootstrap() {
    if (!configured() || !window.firebase) return renderSetup();
    try {
      if (!firebase.apps.length) firebase.initializeApp(FC);
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged(async u => {
        if (!u) return renderLogin();
        if (String(u.email || "").toLowerCase() !== String(ADMIN_EMAIL).toLowerCase()) {
          return renderLogin(`현재 로그인: ${esc(u.email)} · config.js와 Firestore 규칙의 관리자 이메일을 확인하세요.`);
        }
        await refresh();
      });
    } catch (e) {
      console.error(e); renderSetup();
    }
  }

  bootstrap();
})();
