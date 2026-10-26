(() => {
  'use strict';
  const ROOT = document.querySelector('#adminApp');
  if (!ROOT) return;

  let exitLogs = [];
  let db = null;
  let activeDetail = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g,' ').trim();

  function adminApp() {
    if (!window.firebase?.apps?.length) return null;
    return firebase.apps.find(app => {
      try { return !!app.auth().currentUser?.email; } catch (_) { return false; }
    }) || null;
  }

  async function ensureDb() {
    if (db) return db;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const app = adminApp();
      if (app) { db = app.firestore(); return db; }
      await new Promise(r => setTimeout(r,300));
    }
    return null;
  }

  async function loadRepairLogs() {
    const d = await ensureDb();
    if (!d) return;
    try {
      const snap = await d.collection('stageExitLogs').get();
      exitLogs = snap.docs.map(x => ({id:x.id,...x.data()}));
    } catch (e) { console.warn('[grading-view] stageExitLogs load failed',e); }
  }

  function findDetail() {
    const candidates = [...ROOT.querySelectorAll('.admin-detail,.detail-panel,aside')];
    return candidates.find(el => {
      const t = textOf(el);
      return t.length > 80 && /(역사|인물|사건|AI|점수|기술|능력치|제출)/.test(t);
    }) || null;
  }

  function extractIdentityFromDetail(detail) {
    const t = textOf(detail);
    const out = {};
    let m = t.match(/(\d{1,2})\s*반\s*(\d{1,3})\s*번/);
    if (m) { out.classNo = m[1]; out.studentNo = m[2]; }
    m = t.match(/(?:학번|번호)\s*[:：]?\s*(\d{1,8})/);
    if (m) out.studentNo ||= m[1];
    m = t.match(/(?:이름|성명)\s*[:：]?\s*([가-힣A-Za-z]{2,20})/);
    if (m) out.name = m[1];
    return out;
  }

  function scoreMatch(log, id) {
    const x = log.identity || {};
    let s = 0;
    if (id.name && x.name && id.name === x.name) s += 4;
    if (id.studentNo && x.studentNo && String(id.studentNo) === String(x.studentNo)) s += 4;
    if (id.classNo && x.classNo && String(id.classNo) === String(x.classNo)) s += 2;
    return s;
  }

  function bestRepairFor(detail) {
    const id = extractIdentityFromDetail(detail);
    const matches = exitLogs.filter(l => l.postSubmitImage?.dataUrl).map(l => ({l,s:scoreMatch(l,id)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);
    return matches[0]?.l || null;
  }

  function ensureTools(detail) {
    if (!detail || detail.querySelector('.grading-view-tools')) return;
    const tools = document.createElement('div');
    tools.className = 'grading-view-tools';
    tools.innerHTML = `
      <button type="button" class="grading-open-btn">📝 채점 카드로 보기</button>
      <span>학생 최종 결과물을 한 화면에서 읽고 AI 초벌평가까지 이어서 확인합니다.</span>`;
    detail.insertAdjacentElement('afterbegin',tools);
    tools.querySelector('.grading-open-btn').addEventListener('click', () => openGradingMode(detail));
  }

  async function injectRepairImage(detail) {
    detail.querySelector('.grading-repair-image')?.remove();
    if (!exitLogs.length) await loadRepairLogs();
    const log = bestRepairFor(detail);
    if (!log?.postSubmitImage?.dataUrl) return;
    const box = document.createElement('section');
    box.className = 'grading-repair-image';
    box.innerHTML = `<div class="grading-repair-label">최종 제출 후 보완된 초상화</div><img src="${esc(log.postSubmitImage.dataUrl)}" alt="학생이 보완 제출한 캐릭터 초상화"><small>보완 이미지 저장: ${new Date(log.postSubmitImage.updatedAtMs || Date.now()).toLocaleString('ko-KR')}</small>`;
    const anchor = detail.querySelector('h2,h3,.detail-title') || detail.firstElementChild;
    anchor?.insertAdjacentElement('afterend',box);
  }

  function addModeToolbar(detail) {
    detail.querySelector('.grading-mode-toolbar')?.remove();
    const bar = document.createElement('div');
    bar.className = 'grading-mode-toolbar';
    bar.innerHTML = `
      <div><span>TEACHER REVIEW</span><b>학생 결과물 채점 카드</b></div>
      <div class="grading-mode-actions">
        <button type="button" data-act="ai">✨ AI 초벌평가</button>
        <button type="button" data-act="print">🖨️ 인쇄 / PDF</button>
        <button type="button" data-act="close">✕ 닫기</button>
      </div>`;
    detail.insertAdjacentElement('afterbegin',bar);
    bar.querySelector('[data-act="close"]').addEventListener('click',closeGradingMode);
    bar.querySelector('[data-act="print"]').addEventListener('click',()=>window.print());
    bar.querySelector('[data-act="ai"]').addEventListener('click',()=>{
      const btn = detail.querySelector('#runAiGrade,button[id*="Ai" i],button[id*="ai" i]') || [...detail.querySelectorAll('button')].find(b=>/AI.*(평가|초벌)/i.test(textOf(b)));
      if (btn) { btn.scrollIntoView({behavior:'smooth',block:'center'}); btn.click(); }
      else alert('이 학생의 AI 초벌평가 버튼을 찾지 못했습니다. 상세 화면의 AI 평가 영역을 확인해주세요.');
    });
  }

  async function openGradingMode(detail) {
    activeDetail = detail;
    document.body.classList.add('grading-card-open');
    detail.classList.add('grading-card-mode');
    addModeToolbar(detail);
    await injectRepairImage(detail);
    detail.scrollTop = 0;
  }

  function closeGradingMode() {
    if (!activeDetail) return;
    activeDetail.classList.remove('grading-card-mode');
    activeDetail.querySelector('.grading-mode-toolbar')?.remove();
    document.body.classList.remove('grading-card-open');
    activeDetail = null;
  }

  function decorate() {
    const detail = findDetail();
    if (detail) ensureTools(detail);
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeDetail) closeGradingMode(); });
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(()=>{queued=false;decorate();});
  };
  new MutationObserver(queue).observe(ROOT,{childList:true,subtree:true});
  loadRepairLogs().finally(queue);
  queue();
})();
