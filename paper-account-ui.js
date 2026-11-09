// 모의계좌 우선: 실제 계좌(토스·한투 실전)가 연결되지 않았을 때는 한투 모의계좌(팀 공용, 가상 1억)를 기본 자산으로 보여 준다.
// 출처는 두 가지다. ① PC(짝지은 브라우저 또는 PC 자신)의 paper-live-status → 실시간. ② 저장소에 올린 data/paper-live-public.json → 누구나, PC 없이.
// 실제 계좌 자료가 들어오면 그 자료가 우선이고, 화면에서 지우면 다시 모의계좌로 돌아온다. 상단 표시로 실계좌·모의계좌·예시를 늘 구분한다.
import { privateRead } from '/bridge-client.js';
import { publicSnapshot, assetSnapshotFrom } from '/lib/paper-public.js';

const $ = s => document.querySelector(s);
export const ACCOUNT_LABEL = { real: '실계좌 조회 · 주문 없음', paper: '모의계좌 · 실제 돈 아님', demo: '예시 자산 · 가짜 보유', none: '모의투자 · 실제 주문 없음' };
export const kindOf = snap => !snap ? 'none' : snap.paper ? 'paper' : snap.demo ? 'demo' : 'real';
const state = { kind: 'none', loading: null, timer: null, cache: null, cacheAt: 0 };

/** 모의계좌 공개 스냅샷. fresh=true 면 PC 를 먼저 묻고(실시간), 안 되면 저장소 파일. 60초 캐시. */
export async function loadMockAccount({ fresh = true, maxAge = 60_000 } = {}) {
  if (state.cache && Date.now() - state.cacheAt < maxAge && (!fresh || state.cache.live)) return state.cache;
  let pub = null;
  if (fresh) { try { const s = await privateRead('paper-live-status'); pub = publicSnapshot(s, { asOf: new Date().toISOString() }); pub.live = true; } catch { /* PC 없음·키 없음 → 공개 파일 */ } }
  if (!pub) { const r = await fetch('/data/paper-live-public.json', { cache: 'no-store' }); if (!r.ok) throw new Error('공개 모의계좌 자료가 아직 없습니다.'); pub = await r.json(); pub.live = false; }
  state.cache = pub; state.cacheAt = Date.now(); return pub;
}
export const mockCached = () => state.cache;

function setKind(k) { state.kind = k; document.body.dataset.account = k; const m = $('.mode'); if (m && document.querySelector('.view.active')?.dataset.page !== 'toss') m.textContent = ACCOUNT_LABEL[k] || ACCOUNT_LABEL.none; }
async function activate() {
  if (state.kind !== 'none' || state.loading || !sessionStorage.getItem('teamQuantSession') || $('#app')?.hidden) return;
  const st = $('#hm-connect-state'); if (st) st.textContent = '실제 계좌가 없어 모의계좌를 불러옵니다…';
  state.loading = (async () => {
    try {
      const pub = await loadMockAccount(); if (state.kind !== 'none') return;
      const snap = assetSnapshotFrom(pub);
      window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot', { detail: snap }));
      window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: { amount: snap.demoCash, note: '모의계좌 예수금' } }));
    } catch (e) { if (st) st.textContent = `${e.message} 실제 계좌를 연결하거나 예시 자산을 켜십시오.`; }
    finally { state.loading = null; }
  })();
}
function schedule(ms = 600) { clearTimeout(state.timer); state.timer = setTimeout(() => void activate(), ms); }

window.addEventListener('teamquant:asset-snapshot', e => { clearTimeout(state.timer); setKind(kindOf(e.detail)); });
window.addEventListener('teamquant:asset-clear', () => { setKind('none'); schedule(900); });
// 토스 조회가 실패했을 때(PC 없음·키 없음·연결 안 됨)가 "실제 계좌가 없다"는 신호다. 성공하면 실계좌 스냅샷이 먼저 온다.
window.addEventListener('teamquant:connection', e => { if (e.detail?.status === 'error' && state.kind === 'none') schedule(); });
window.addEventListener('teamquant:page', () => { const m = $('.mode'); if (!m) return; m.textContent = document.querySelector('.view.active')?.dataset.page === 'toss' ? '실제 자산 조회 · 주문 없음' : ACCOUNT_LABEL[state.kind] || ACCOUNT_LABEL.none; });
document.body.dataset.account = 'none';
