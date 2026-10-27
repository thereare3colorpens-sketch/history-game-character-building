(() => {
  'use strict';
  const ROOT = document.querySelector('#adminApp');
  if (!ROOT) return;

  let bulkRunning = false;
  let bulkStop = false;

  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function detailPanel() {
    const candidates = [...ROOT.querySelectorAll('.admin-detail,.detail-panel,aside')];
    return candidates.find(el => textOf(el).length > 80 && /(역사|인물|사건|AI|점수|기술|능력치|제출)/.test(textOf(el))) || null;
  }

  function tableRows() {
    const table = ROOT.querySelector('.admin-table, table');
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr')].filter(tr => {
      const btn = [...tr.querySelectorAll('button,a')].find(b => /^(보기|상세|열기)$/i.test(textOf(b)) || /보기/.test(textOf(b)));
      return !!btn;
    });
  }

  function rowOpenButton(tr) {
    return [...tr.querySelectorAll('button,a')].find(b => /^(보기|상세|열기)$/i.test(textOf(b)) || /보기/.test(textOf(b))) || null;
  }

  function rowLabel(tr) {
    const cells = [...tr.querySelectorAll('td')];
    return textOf(cells[0] || tr).slice(0, 80);
  }

  function normalize(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

  function currentRowIndex(detail) {
    const rows = tableRows();
    const dt = normalize(textOf(detail));
    let best = -1, score = 0;
    rows.forEach((tr, idx) => {
      const cells = [...tr.querySelectorAll('td')];
      const parts = [textOf(cells[0]), textOf(cells[1])].filter(Boolean);
      let s = 0;
      parts.forEach(p => { const n = normalize(p); if (n && dt.includes(n)) s += Math.min(10, n.length); });
      if (s > score) { score = s; best = idx; }
    });
    return best;
  }

  async function waitForDetailChange(oldText, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const d = detailPanel();
      if (d && textOf(d) && normalize(textOf(d)) !== normalize(oldText)) return d;
      await sleep(120);
    }
    return detailPanel();
  }

  async function navigate(delta) {
    const current = detailPanel();
    if (!current) return;
    const rows = tableRows();
    if (!rows.length) return;
    const idx = currentRowIndex(current);
    if (idx < 0) return alert('현재 학생의 목록 위치를 찾지 못했습니다.');
    const next = idx + delta;
    if (next < 0 || next >= rows.length) return;
    const oldText = textOf(current);

    // 기존 전체화면 모드를 풀고 다음 학생의 '보기'를 실행한다.
    current.classList.remove('grading-card-mode');
    document.body.classList.remove('grading-card-open');
    current.querySelector('.grading-mode-toolbar')?.remove();
    const btn = rowOpenButton(rows[next]);
    if (!btn) return;
    btn.click();
    const newDetail = await waitForDetailChange(oldText);
    await sleep(80);
    const open = newDetail?.querySelector('.grading-open-btn');
    if (open) open.click();
    else {
      // teacher-grading-view가 버튼을 붙일 시간을 조금 더 준다.
      await sleep(350);
      newDetail?.querySelector('.grading-open-btn')?.click();
    }
  }

  function addNavigator(detail) {
    const bar = detail.querySelector('.grading-mode-toolbar');
    if (!bar || bar.querySelector('.teacher-nav-prev')) return;
    const actions = bar.querySelector('.grading-mode-actions') || bar;
    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'teacher-nav-prev'; prev.textContent = '← 이전 학생';
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'teacher-nav-next'; next.textContent = '다음 학생 →';
    prev.addEventListener('click', () => navigate(-1));
    next.addEventListener('click', () => navigate(1));
    actions.insertBefore(prev, actions.firstChild);
    actions.insertBefore(next, prev.nextSibling);

    const rows = tableRows();
    const idx = currentRowIndex(detail);
    prev.disabled = idx <= 0;
    next.disabled = idx < 0 || idx >= rows.length - 1;

    if (!detail.querySelector('.teacher-game-hud')) {
      const hud = document.createElement('section');
      hud.className = 'teacher-game-hud';
      const student = idx >= 0 ? rowLabel(rows[idx]) : '학생 결과물';
      const score = (textOf(detail).match(/\b\d+(?:\.\d+)?\s*\/\s*10\b/) || [])[0] || 'AI 미평가';
      hud.innerHTML = `<div class="hud-kicker">HISTORY CHARACTER // TEACHER REVIEW</div><div class="hud-main"><div><h1>${student}</h1><p>역사적 사실 · 게임 해석 · AI 초벌평가를 한 화면에서 검토합니다.</p></div><div class="hud-score"><span>AI REVIEW</span><b>${score}</b></div></div><div class="hud-tags"><span>HISTORICAL FACTS</span><span>CHARACTER BUILD</span><span>FINAL REVIEW</span></div>`;
      bar.insertAdjacentElement('afterend', hud);
    }
  }

  function decorateGradingMode() {
    const d = detailPanel();
    if (d?.classList.contains('grading-card-mode')) addNavigator(d);
  }

  function isSubmittedRow(tr) {
    const t = textOf(tr);
    return /제출/.test(t) && !/STEP\s*[1-6]/i.test(t);
  }
  function isAiScoredRow(tr) {
    return !!tr.querySelector('.score-chip.ai') || /\b\d+(?:\.\d+)?\s*\/\s*10\b/.test(textOf(tr));
  }

  function bulkModal() {
    let m = document.querySelector('#bulkAiGradeModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'bulkAiGradeModal';
    m.className = 'bulk-ai-backdrop';
    m.hidden = true;
    m.innerHTML = `<section class="bulk-ai-card"><div class="bulk-ai-kicker">AI BATCH REVIEW</div><h2>미평가 제출본 AI 일괄 채점</h2><p>현재 화면의 제출 완료 학생 중 AI 점수가 없는 학생을 <strong>한 명씩 순차적으로</strong> 평가합니다. 교사 최종점수는 변경하지 않습니다.</p><div class="bulk-ai-progress"><div id="bulkAiBar"></div></div><div id="bulkAiStatus">준비 중…</div><div class="bulk-ai-actions"><button type="button" id="bulkAiStop">중지</button><button type="button" id="bulkAiClose">닫기</button></div></section>`;
    document.body.appendChild(m);
    m.querySelector('#bulkAiStop').addEventListener('click', () => { bulkStop = true; });
    m.querySelector('#bulkAiClose').addEventListener('click', () => { if (!bulkRunning) m.hidden = true; });
    return m;
  }

  async function waitForAiResult(detail, before, timeout = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const t = textOf(detail);
      if (/\b\d+(?:\.\d+)?\s*\/\s*10\b/.test(t) && t !== before) return true;
      const btn = detail.querySelector('#runAiGrade');
      if (btn && !btn.disabled && /(다시|재평가|평가 완료)/.test(textOf(btn))) return true;
      await sleep(500);
    }
    return false;
  }

  async function runBulkAi() {
    if (bulkRunning) return;
    const initial = tableRows().filter(tr => isSubmittedRow(tr) && !isAiScoredRow(tr));
    if (!initial.length) return alert('현재 목록에는 AI 초벌평가가 필요한 제출본이 없습니다.');
    if (!confirm(`${initial.length}명의 미평가 제출본을 순차적으로 AI 초벌평가할까요?\n\n최종 수행평가 점수는 교사가 직접 결정합니다.`)) return;

    bulkRunning = true; bulkStop = false;
    const modal = bulkModal(); modal.hidden = false;
    const status = modal.querySelector('#bulkAiStatus');
    const bar = modal.querySelector('#bulkAiBar');
    let done = 0, failed = 0;

    const keys = initial.map(rowLabel);
    for (let i = 0; i < keys.length; i++) {
      if (bulkStop) break;
      const key = keys[i];
      status.innerHTML = `<b>${i + 1} / ${keys.length}</b> · ${key} 평가 준비 중…`;
      bar.style.width = `${Math.round((i / keys.length) * 100)}%`;

      const row = tableRows().find(r => rowLabel(r) === key);
      if (!row || isAiScoredRow(row)) { done++; continue; }
      const openBtn = rowOpenButton(row);
      if (!openBtn) { failed++; continue; }
      const old = textOf(detailPanel());
      openBtn.click();
      const detail = await waitForDetailChange(old, 8000);
      if (!detail) { failed++; continue; }
      await sleep(250);
      const aiBtn = detail.querySelector('#runAiGrade') || [...detail.querySelectorAll('button')].find(b => /AI.*(초벌|평가|채점)/i.test(textOf(b)));
      if (!aiBtn) { failed++; continue; }
      const before = textOf(detail);
      status.innerHTML = `<b>${i + 1} / ${keys.length}</b> · ${key} AI 평가 중…`;
      aiBtn.click();
      const ok = await waitForAiResult(detail, before);
      if (ok) done++; else failed++;
      bar.style.width = `${Math.round(((i + 1) / keys.length) * 100)}%`;
      await sleep(450);
    }

    bulkRunning = false;
    const stopped = bulkStop;
    bar.style.width = '100%';
    status.innerHTML = `<strong>${stopped ? '일괄평가가 중지되었습니다.' : '일괄평가가 완료되었습니다.'}</strong><br>성공 ${done}명 · 확인 필요 ${failed}명${stopped ? ' · 나머지는 미평가 상태로 유지' : ''}`;
    modal.querySelector('#bulkAiStop').disabled = true;
  }

  function installBulkButton() {
    if (document.querySelector('#bulkAiGradeBtn')) return;
    const refresh = [...ROOT.querySelectorAll('button')].find(b => /새로고침/.test(textOf(b)));
    const host = refresh?.parentElement || ROOT.firstElementChild || ROOT;
    const btn = document.createElement('button');
    btn.id = 'bulkAiGradeBtn';
    btn.className = 'bulk-ai-open-btn';
    btn.innerHTML = '✨ AI 일괄 채점';
    btn.addEventListener('click', runBulkAi);
    host.appendChild(btn);
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; installBulkButton(); decorateGradingMode(); });
  };
  new MutationObserver(queue).observe(ROOT, { childList: true, subtree: true, attributes: true });
  queue();
})();
