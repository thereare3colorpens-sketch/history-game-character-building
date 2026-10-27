(() => {
  'use strict';
  const ROOT = document.querySelector('#app');
  if (!ROOT) return;

  let pending = false;
  let pendingBtn = null;
  let startedAt = 0;
  let watchTimer = null;
  let observer = null;
  const MAX_WAIT = 30000;

  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function findFinalSubmitButton(target) {
    const btn = target?.closest?.('button,input[type="button"],input[type="submit"],a');
    if (!btn) return null;
    const t = textOf(btn) || btn.value || '';
    if (!/(최종\s*제출|제출하기|제출\s*완료)/i.test(t)) return null;
    if (/(다시|보완|이미지)/i.test(t)) return null;
    return btn;
  }

  function isSubmittedScreen() {
    const t = textOf(ROOT);
    return /(최종\s*제출.*완료|제출이\s*완료|제출되었습니다|퀘스트\s*완료|MISSION\s*COMPLETE|제출\s*완료)/i.test(t)
      || !!document.querySelector('#postSubmitImageRepair');
  }

  function ensureHint() {
    if (document.querySelector('#submitSafetyHint')) return;
    const buttons = [...ROOT.querySelectorAll('button,input[type="button"],input[type="submit"],a')];
    const btn = buttons.find(b => /(최종\s*제출|제출하기|제출\s*완료)/i.test(textOf(b) || b.value || '') && !/(다시|보완|이미지)/i.test(textOf(b) || b.value || ''));
    if (!btn) return;
    const box = document.createElement('div');
    box.id = 'submitSafetyHint';
    box.className = 'submit-safety-hint';
    box.innerHTML = `<div class="submit-safety-icon">🛡️</div><div><b>제출 버튼을 누른 뒤, 반드시 ‘제출 완료’ 표시를 확인하세요.</b><span>네트워크나 이미지 처리 때문에 몇 초 걸릴 수 있습니다. 완료 표시 전에는 창을 닫거나 홈 화면으로 나가지 마세요.</span></div>`;
    btn.insertAdjacentElement('beforebegin', box);
  }

  function statusBox() {
    let box = document.querySelector('#submitGuardStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'submitGuardStatus';
      box.className = 'submit-guard-status';
      document.body.appendChild(box);
    }
    return box;
  }

  function setStatus(kind, title, desc) {
    const box = statusBox();
    box.className = `submit-guard-status ${kind}`;
    box.innerHTML = `<div class="submit-guard-spinner">${kind === 'ok' ? '✓' : kind === 'fail' ? '!' : ''}</div><div><b>${title}</b><span>${desc || ''}</span></div>`;
    box.hidden = false;
  }

  function clearWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null;
    observer?.disconnect();
    observer = null;
  }

  function markSuccess() {
    if (!pending) return;
    pending = false;
    clearWatch();
    try { localStorage.setItem('hc:lastSubmitVerified', JSON.stringify({ at: Date.now(), path: location.pathname })); } catch (_) {}
    setStatus('ok', '제출 완료가 확인되었습니다.', '이제 창을 닫아도 안전합니다. 초상화가 누락되었다면 아래 보완 제출 기능을 이용할 수 있습니다.');
    setTimeout(() => { const b = document.querySelector('#submitGuardStatus'); if (b) b.hidden = true; }, 7000);
  }

  function failureModal() {
    document.querySelector('#submitRetryModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'submitRetryModal';
    overlay.className = 'submit-retry-backdrop';
    overlay.innerHTML = `<section class="submit-retry-card" role="dialog" aria-modal="true">
      <div class="submit-retry-badge">SUBMISSION CHECK</div>
      <h2>제출 완료를 확인하지 못했습니다.</h2>
      <p>버튼을 눌렀지만 30초 안에 완료 화면이 확인되지 않았습니다. <strong>작성 내용은 그대로 두고 다시 제출을 시도</strong>하는 것이 안전합니다.</p>
      <div class="submit-retry-guide"><b>먼저 확인하세요</b><span>① 인터넷 연결 상태 · ② 이미지 업로드가 진행 중인지 · ③ 제출 완료 화면이 이미 뒤에 떠 있지는 않은지</span></div>
      <div class="submit-retry-actions">
        <button type="button" data-act="close">조금 더 기다리기</button>
        <button type="button" class="primary" data-act="retry">다시 제출 시도</button>
      </div>
    </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="close"]').addEventListener('click', () => {
      overlay.remove();
      if (!pending) beginWatch(pendingBtn, true);
    });
    overlay.querySelector('[data-act="retry"]').addEventListener('click', () => {
      overlay.remove();
      pending = false;
      clearWatch();
      const btn = pendingBtn;
      if (btn && document.contains(btn)) btn.click();
      else alert('제출 버튼을 다시 찾지 못했습니다. 화면의 최종 제출 버튼을 한 번 더 눌러주세요.');
    });
  }

  function checkState() {
    if (!pending) return;
    if (isSubmittedScreen()) return markSuccess();
    const elapsed = Date.now() - startedAt;
    if (elapsed >= MAX_WAIT) {
      pending = false;
      clearWatch();
      setStatus('fail', '아직 제출 완료가 확인되지 않았습니다.', '작성 내용은 유지됩니다. 재시도 안내를 확인해주세요.');
      failureModal();
    } else {
      const sec = Math.max(1, Math.ceil((MAX_WAIT - elapsed) / 1000));
      setStatus('pending', '제출 내용을 저장하고 있습니다…', `완료 화면을 확인하는 중입니다. 최대 ${sec}초 정도 더 기다려주세요.`);
    }
  }

  function beginWatch(btn, resume = false) {
    if (new URLSearchParams(location.search).get('test') === '1') return;
    pendingBtn = btn || pendingBtn;
    pending = true;
    startedAt = Date.now() - (resume ? 15000 : 0);
    clearWatch();
    if (!navigator.onLine) setStatus('fail', '인터넷 연결이 끊겨 있습니다.', '연결이 복구된 뒤 다시 제출해주세요.');
    else setStatus('pending', '최종 제출을 처리하고 있습니다…', '완료 표시가 나타날 때까지 이 화면을 유지해주세요.');
    observer = new MutationObserver(checkState);
    observer.observe(ROOT, { childList: true, subtree: true, characterData: true, attributes: true });
    watchTimer = setInterval(checkState, 700);
    setTimeout(checkState, 100);
  }

  // v4.7의 이미지 확인 모달을 통과한 실제 제출 클릭을 감시한다.
  document.addEventListener('click', (ev) => {
    const btn = findFinalSubmitButton(ev.target);
    if (!btn) return;
    // 첫 클릭은 v4.7 모달에서 stopImmediatePropagation 되므로 여기까지 오지 않는다.
    // 실제 제출 클릭만 도달하며, 기존 제출 핸들러는 그대로 실행되게 막지 않는다.
    beginWatch(btn);
  }, true);

  window.addEventListener('online', () => {
    if (pending) setStatus('pending', '인터넷 연결이 복구되었습니다.', '제출 완료 여부를 다시 확인하고 있습니다…');
  });

  window.addEventListener('beforeunload', (e) => {
    if (!pending) return;
    e.preventDefault();
    e.returnValue = '';
  });

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; ensureHint(); if (pending) checkState(); });
  };
  new MutationObserver(queue).observe(ROOT, { childList: true, subtree: true });
  queue();
})();
