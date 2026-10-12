(() => {
  const root = document.querySelector('#app');
  if (!root) return;

  function patchFinalReviewNotice() {
    const notice = root.querySelector('.grading-notice');
    if (!notice || notice.dataset.v45Patched === '1') return;
    notice.dataset.v45Patched = '1';
    notice.innerHTML = `
      <div class="grading-notice-icon" aria-hidden="true">🤖</div>
      <div class="grading-notice-copy">
        <b>제출 후 교사 검토 안내</b>
        <span>
          최종 제출이 끝난 뒤, 선생님은 <strong>AI를 활용해 역사적 사실과 게임 요소의 연결을 초벌 검토</strong>할 수 있습니다.
          AI 검토 결과는 교사의 채점을 돕기 위한 참고 자료이며, <strong>AI 점수가 그대로 수행평가 점수가 되지는 않습니다.</strong>
          선생님이 답안과 역사적 근거를 직접 확인한 뒤 최종 점수와 피드백을 결정합니다.
        </span>
      </div>`;
  }

  let queued = false;
  const queuePatch = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      patchFinalReviewNotice();
    });
  };

  new MutationObserver(queuePatch).observe(root, { childList: true, subtree: true });
  queuePatch();
})();
