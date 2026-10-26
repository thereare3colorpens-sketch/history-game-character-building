(() => {
  'use strict';
  const ROOT = document.querySelector('#app');
  if (!ROOT) return;

  const MIN_DIM = 520;
  const TARGET_MAX_BYTES = 280 * 1024;
  let bypassSubmitConfirm = false;
  let firestoreCtx = null;
  let currentImageDataUrl = '';
  let panelMounted = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function getCfg() {
    let cfg = null;
    for (const k of ['CONFIG','APP_CONFIG','HISTORY_CONFIG','HISTORY_CHARACTER_CONFIG']) {
      try { if (!cfg && typeof window[k] !== 'undefined') cfg = window[k]; } catch (_) {}
    }
    const a = cfg?.activity || {};
    return {
      academicYear: String(a.academicYear || '').trim(),
      schoolGrade: String(a.schoolGrade || '').trim(),
      activityId: String(a.id || '').trim(),
      activityTitle: String(a.title || document.querySelector('#activityMiniTitle')?.textContent || document.title || '').trim()
    };
  }

  function safeSlug(s) {
    return String(s || 'activity').trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'activity';
  }

  function activityKey(meta) {
    return [meta.academicYear || 'year', meta.schoolGrade || 'grade', meta.activityId || safeSlug(meta.activityTitle)]
      .join('__').replace(/[^a-zA-Z0-9가-힣_-]/g,'_');
  }

  function extractIdentity() {
    const out = {};
    const controls = [...document.querySelectorAll('input,select,textarea')];
    for (const el of controls) {
      const value = String(el.value || '').trim();
      if (!value) continue;
      const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      const wrap = el.closest('label,.field,.form-group,.input-group,.question,.card');
      const d = [el.name,el.id,el.placeholder,label?.textContent,wrap?.textContent].filter(Boolean).join(' ');
      if (/이름|성명|student.?name/i.test(d) && value.length <= 24) out.name ||= value;
      if (/학번|student.?no|번호/i.test(d) && /^\d{1,8}$/.test(value)) out.studentNo ||= value;
      if (/학급|반|class/i.test(d) && /^\d{1,3}$/.test(value)) out.classNo ||= value;
    }
    const t = textOf(ROOT);
    const m = t.match(/(\d{1,2})\s*반\s*(\d{1,3})\s*번/);
    if (m) { out.classNo ||= m[1]; out.studentNo ||= m[2]; }
    const nameMatch = t.match(/(?:이름|성명)\s*[:：]?\s*([가-힣A-Za-z]{2,20})/);
    if (nameMatch) out.name ||= nameMatch[1];
    return out;
  }

  function studentFirebaseApp() {
    if (!window.firebase?.apps?.length) return null;
    return firebase.apps.find(app => {
      try { const u = app.auth().currentUser; return u && (!u.email || u.isAnonymous); } catch (_) { return false; }
    }) || firebase.apps[0] || null;
  }

  async function ensureFirestore() {
    if (firestoreCtx) return firestoreCtx;
    const started = Date.now();
    while (Date.now() - started < 15000) {
      const app = studentFirebaseApp();
      let user = null;
      try { user = app?.auth().currentUser; } catch (_) {}
      if (app && user) {
        const meta = getCfg();
        const key = activityKey(meta);
        firestoreCtx = {
          app, user, meta, key,
          ref: app.firestore().collection('stageExitLogs').doc(`${key}__${user.uid}`)
        };
        return firestoreCtx;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('학생 인증 정보를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요.');
  }

  function findFinalSubmitButton(target) {
    const btn = target.closest?.('button,input[type="button"],input[type="submit"],a');
    if (!btn) return null;
    const t = (btn.textContent || btn.value || '').replace(/\s+/g,' ').trim();
    if (!/(최종\s*제출|제출하기|제출\s*완료)/i.test(t)) return null;
    if (/(다시|보완|이미지)/i.test(t)) return null;
    return btn;
  }

  function visibleCharacterPreview() {
    const imgs = [...ROOT.querySelectorAll('img')].filter(img => {
      const r = img.getBoundingClientRect();
      if (r.width < 100 || r.height < 100) return false;
      if (!img.src || /hero-quest|logo|icon|avatar/i.test(img.src)) return false;
      return true;
    });
    return imgs.sort((a,b) => (b.clientWidth*b.clientHeight) - (a.clientWidth*a.clientHeight))[0] || null;
  }

  function showSubmitCheck(btn) {
    document.querySelector('#finalImageCheckModal')?.remove();
    const preview = visibleCharacterPreview();
    const overlay = document.createElement('div');
    overlay.id = 'finalImageCheckModal';
    overlay.className = 'hc-modal-backdrop';
    overlay.innerHTML = `
      <section class="hc-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="finalCheckTitle">
        <div class="hc-confirm-badge">FINAL CHECK</div>
        <h2 id="finalCheckTitle">초상화 첨부를 마지막으로 확인해주세요.</h2>
        <p>이미지를 첨부했다면 <strong>아래 미리보기에 정상적으로 표시되는지</strong> 확인한 뒤 제출하세요. 업로드가 아직 진행 중이라면 잠시 기다렸다가 제출하는 것이 안전합니다.</p>
        <div class="hc-image-check-preview ${preview ? 'has-image' : 'no-image'}">
          ${preview ? `<img src="${esc(preview.src)}" alt="현재 첨부된 캐릭터 초상화 미리보기" />` : `<div class="hc-no-image-icon">🖼️</div><b>현재 화면에서 큰 초상화 미리보기를 찾지 못했습니다.</b><span>이미지 없이 제출해도 괜찮지만, 첨부하려던 경우 STEP 5에서 다시 확인해주세요.</span>`}
        </div>
        <div class="hc-confirm-note">최종 제출 뒤에도 <b>이미지 보완 제출</b> 기능으로 초상화만 다시 첨부할 수 있습니다. 글 내용은 변경되지 않습니다.</div>
        <div class="hc-modal-actions">
          <button type="button" class="hc-btn ghost" data-act="back">돌아가서 확인</button>
          <button type="button" class="hc-btn primary" data-act="submit">확인하고 최종 제출</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="back"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-act="submit"]').addEventListener('click', () => {
      overlay.remove();
      bypassSubmitConfirm = true;
      btn.click();
      setTimeout(() => { bypassSubmitConfirm = false; }, 500);
    });
  }

  document.addEventListener('click', (ev) => {
    const btn = findFinalSubmitButton(ev.target);
    if (!btn || bypassSubmitConfirm) return;
    // 테스트 모드에서는 기존 자유 이동을 방해하지 않는다.
    if (new URLSearchParams(location.search).get('test') === '1') return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    showSubmitCheck(btn);
  }, true);

  function isSubmittedScreen() {
    const t = textOf(ROOT);
    return /(최종\s*제출.*완료|제출이\s*완료|제출되었습니다|퀘스트\s*완료|MISSION\s*COMPLETE|제출\s*완료)/i.test(t);
  }

  async function fileToDataUrl(file) {
    if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 첨부할 수 있습니다.');
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    const maxDim = Math.max(w,h);
    if (maxDim > 960) {
      const s = 960 / maxDim; w = Math.max(MIN_DIM, Math.round(w*s)); h = Math.max(MIN_DIM, Math.round(h*s));
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0,0,w,h);
    ctx.drawImage(bitmap,0,0,w,h);
    bitmap.close?.();
    let quality = 0.84;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length * 0.75 > TARGET_MAX_BYTES && quality > 0.48) {
      quality -= 0.08;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    return data;
  }

  async function saveRepairImage(dataUrl) {
    const ctx = await ensureFirestore();
    const identity = extractIdentity();
    const payload = {
      ownerUid: ctx.user.uid,
      academicYear: ctx.meta.academicYear || '',
      schoolGrade: ctx.meta.schoolGrade || '',
      activityId: ctx.meta.activityId || '',
      activityTitle: ctx.meta.activityTitle || '',
      activityKey: ctx.key,
      identity,
      postSubmitImage: {
        dataUrl,
        mimeType: 'image/jpeg',
        updatedAtMs: Date.now(),
        source: 'post-submit-repair'
      },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      clientUpdatedAtMs: Date.now()
    };
    await ctx.ref.set(payload, { merge: true });
  }

  async function loadExistingRepair() {
    try {
      const ctx = await ensureFirestore();
      const snap = await ctx.ref.get();
      const d = snap.exists ? snap.data() : null;
      return d?.postSubmitImage?.dataUrl || '';
    } catch (_) { return ''; }
  }

  async function mountRepairPanel() {
    if (!isSubmittedScreen()) { panelMounted = false; document.querySelector('#postSubmitImageRepair')?.remove(); return; }
    if (document.querySelector('#postSubmitImageRepair')) return;
    panelMounted = true;

    const card = document.createElement('section');
    card.id = 'postSubmitImageRepair';
    card.className = 'post-submit-image-card';
    card.innerHTML = `
      <div class="post-submit-head">
        <div class="post-submit-icon">🖼️</div>
        <div><span>제출 후 보완 기능</span><h2>초상화만 다시 첨부할 수 있어요</h2></div>
      </div>
      <p class="post-submit-desc">최종 제출은 그대로 유지됩니다. <strong>글·기술·능력치·제출 시간은 수정하지 않고</strong>, 누락되거나 업로드에 실패한 캐릭터 초상화만 보완합니다.</p>
      <div class="post-submit-grid">
        <div class="post-submit-preview" id="repairPreview"><div class="empty">이미지 보완 없음</div></div>
        <div class="post-submit-controls">
          <label class="repair-file-label">이미지 선택<input id="repairImageInput" type="file" accept="image/*" /></label>
          <button id="saveRepairImage" type="button" class="hc-btn primary" disabled>이 이미지로 보완 제출</button>
          <small>이미지는 전송 전에 자동으로 축소·압축됩니다. 보완 제출은 여러 번 가능하며 가장 최근 이미지가 교사용 채점 화면에 표시됩니다.</small>
          <div id="repairStatus" class="repair-status" aria-live="polite"></div>
        </div>
      </div>`;
    ROOT.appendChild(card);

    const input = card.querySelector('#repairImageInput');
    const saveBtn = card.querySelector('#saveRepairImage');
    const preview = card.querySelector('#repairPreview');
    const status = card.querySelector('#repairStatus');

    const old = await loadExistingRepair();
    if (old) {
      currentImageDataUrl = old;
      preview.innerHTML = `<img src="${esc(old)}" alt="현재 보완 제출된 초상화"/><span class="repair-badge">현재 보완 이미지</span>`;
    }

    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      saveBtn.disabled = true; status.textContent = '이미지를 준비하고 있습니다…';
      try {
        currentImageDataUrl = await fileToDataUrl(f);
        preview.innerHTML = `<img src="${esc(currentImageDataUrl)}" alt="보완할 초상화 미리보기"/><span class="repair-badge pending">저장 전 미리보기</span>`;
        saveBtn.disabled = false; status.textContent = '미리보기를 확인한 뒤 보완 제출을 눌러주세요.';
      } catch (e) { status.textContent = e.message || '이미지를 읽지 못했습니다.'; }
    });

    saveBtn.addEventListener('click', async () => {
      if (!currentImageDataUrl) return;
      saveBtn.disabled = true; status.textContent = '이미지를 안전하게 저장하고 있습니다…';
      try {
        await saveRepairImage(currentImageDataUrl);
        preview.querySelector('.repair-badge')?.classList.remove('pending');
        if (preview.querySelector('.repair-badge')) preview.querySelector('.repair-badge').textContent = '보완 제출 완료';
        status.innerHTML = '<strong>✓ 초상화 보완 제출 완료</strong> · 기존 최종 제출 기록은 그대로 유지됩니다.';
      } catch (e) {
        status.textContent = `저장 실패: ${e.message || e}`;
        saveBtn.disabled = false;
      }
    });
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; mountRepairPanel(); });
  };
  new MutationObserver(queue).observe(ROOT,{childList:true,subtree:true,attributes:true});
  queue();
})();
