(() => {
  const root = document.querySelector('#adminApp');
  if (!root) return;

  function patchAiStateInTable() {
    const table = root.querySelector('.admin-table');
    if (!table) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 8) return;
      const statusText = (cells[3]?.textContent || '').trim();
      const aiCell = cells[4];
      if (!aiCell) return;

      const alreadyScored = !!aiCell.querySelector('.score-chip.ai');
      if (alreadyScored) {
        aiCell.querySelector('.ai-wait-chip')?.remove();
        return;
      }

      const submitted = statusText.includes('제출') && !statusText.includes('STEP');
      if (!submitted) return;

      if (!aiCell.querySelector('.ai-wait-chip')) {
        aiCell.innerHTML = `<span class="ai-wait-chip"><i></i>AI 대기</span>`;
      }
    });
  }

  function patchAiSummaryCard() {
    const cards = [...root.querySelectorAll('.admin-stat-card')];
    const aiCard = cards.find(card => (card.querySelector('span')?.textContent || '').includes('AI 초벌평가'));
    if (!aiCard) return;

    const table = root.querySelector('.admin-table');
    if (!table) return;
    const trs = [...table.querySelectorAll('tbody tr')];
    let waiting = 0;
    trs.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 8) return;
      const statusText = (cells[3]?.textContent || '').trim();
      const hasAi = !!cells[4]?.querySelector('.score-chip.ai');
      if (statusText.includes('제출') && !statusText.includes('STEP') && !hasAi) waiting += 1;
    });

    const small = aiCard.querySelector('small');
    if (small && waiting > 0) {
      small.innerHTML = `<span class="stat-wait-dot"></span>${waiting}명 평가 대기 · 클릭 없이 일괄평가 가능`;
    }
  }

  function patchSelectedDetail() {
    const detail = root.querySelector('.admin-detail, .detail-panel, aside');
    if (!detail) return;

    const heading = [...detail.querySelectorAll('h3')].find(h => h.textContent.includes('AI 초벌평가'));
    const runButton = detail.querySelector('#runAiGrade');
    if (!heading || !runButton) return;

    const hasResult = !!detail.querySelector('.ai-result, .score-chip.ai') || /\/10/.test((runButton.previousElementSibling?.textContent || ''));
    if (hasResult) {
      detail.querySelector('.ai-pending-panel')?.remove();
      return;
    }

    if (!detail.querySelector('.ai-pending-panel')) {
      const box = document.createElement('div');
      box.className = 'ai-pending-panel';
      box.innerHTML = `
        <div class="ai-pending-icon">✨</div>
        <div><b>AI 초벌평가 대기</b><span>학생이 최종 제출을 완료했습니다. 아래 버튼으로 이 답안을 평가하거나, 상단의 <strong>AI 일괄평가</strong>로 미평가 제출본을 한 번에 처리할 수 있습니다.</span></div>`;
      runButton.parentNode.insertBefore(box, runButton);
    }
  }

  function patch() {
    patchAiStateInTable();
    patchAiSummaryCard();
    patchSelectedDetail();
  }

  let queued = false;
  const queuePatch = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; patch(); });
  };

  new MutationObserver(queuePatch).observe(root, { childList: true, subtree: true });
  queuePatch();
})();
