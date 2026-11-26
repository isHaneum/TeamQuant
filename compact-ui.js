// 2026-11-16 간결 화면(사용자 요청): 숫자 타일의 보조 설명 중 숫자가 하나도 없는 것(예: '지금 보유 종목을 산 금액', '보유 비중 기준')을 가린다.
// 가리는 보조 설명 안에 ⓘ 가 있으면 타일 이름 옆으로 옮겨 설명은 계속 볼 수 있게 한다. 화면이 다시 그려지면(MutationObserver) 다시 적용한다.
const TILE_SMALLS = '#hm-kpis small, .rl-tiles small, #pp-kis .pp-hero small, .ov-kpis small, .lt-sit-stats small';
const plain = el => (el.textContent || '').replace(/ⓘ/g, '').replace(/(^|\s)i(?=\s|$)/g, ' ');
function apply() {
  for (const el of document.querySelectorAll(TILE_SMALLS)) {
    const hide = !/[0-9]/.test(plain(el));
    if (hide) { const tip = el.querySelector('.tip'), label = el.parentElement?.querySelector(':scope > span'); if (tip && label && !label.querySelector('.tip')) label.append(' ', tip); }
    el.classList.toggle('tq-hide', hide);
  }
}
const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/compact.css?v=20261126a'; document.head.append(link);
let timer = 0; new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 120); }).observe(document.body, { childList: true, subtree: true });
apply();
