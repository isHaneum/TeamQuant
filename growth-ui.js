// 포트폴리오 › 매출 성장 전망(참고): 보유 종목 중 비교 기업(98개)에 든 종목의 다음 1년 매출·영업이익 성장 순위 전망과 이유, 주의할 점.
// 자료: data/growth-outlook.json(growth-model.py가 오늘까지 공개된 결과로 다시 학습해 만든 최신 월말 판단). 검증 수치·판단 기록부·전략 검증은 화면에 두지 않는다(문서).
// 주가 방향은 판단하지 않는다(지수 대비 수익 예측은 확인 기간에 실패).
import { tip } from '/tooltip-ui.js';
import { topPct, rankWord, driverText, symKey } from '/lib/company-lab.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p0 = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—';
let O = null, snapshot = null;
// 날짜: 올해는 'MM-DD', 다른 해는 그대로.
const md = d => { const s = String(d || ''); return s.slice(0, 4) === String(new Date().getFullYear()) ? s.slice(5, 10) : s; };
const card = document.createElement('article'); card.className = 'pf-card gr-card'; card.id = 'pf-growth';
card.innerHTML = '<header><h3>매출 성장 전망(참고) <span id="gr-tip"></span></h3><p class="pf-muted" id="gr-sub">불러오는 중…</p></header><div id="gr-body"><p class="pf-muted">계좌를 불러오면 표시합니다.</p></div>';
const $ = s => card.querySelector(s);

function mount() { const main = document.querySelector('#portfolio .pf-main'); if (!main) return false; if (!card.isConnected) main.querySelector('.pf-card')?.after(card); return card.isConnected; }
if (!mount()) { const mo = new MutationObserver(() => { if (mount()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }

const get = f => fetch(`/data/${f}.json?v=G2S1`).then(r => r.ok ? r.json() : null).catch(() => null);
const failed = () => { $('#gr-sub').textContent = '매출 성장 전망 자료를 불러오지 못했습니다.'; };
get('growth-outlook').then(o => { O = o; if (!O) return failed(); head(); render(); }).catch(failed);

function head() {
  if (!O) return;
  const asOf = Object.values(O.companies)[0]?.asOf, n = Object.values(O.companies).reduce((a, c) => (a[c.market] = (a[c.market] || 0) + 1, a), {}), total = Object.keys(O.companies).length;
  $('#gr-tip').innerHTML = tip(`비교 기업 ${total}개(한국 ${n.KR ?? 0} · 미국 ${n.US ?? 0}) 중 다음 1년 매출 성장 순위입니다(${md(asOf)} 기준). 주가가 오른다는 뜻이 아니며 이 순위로 사고팔지 않습니다(과거 테스트에서 효과 없음).`);
  $('#gr-sub').textContent = `${md(asOf)} 기준 · 매매 신호 아님 · 비교 기업 ${total}개 안의 순위`;
}
function render() {
  if (!O) return;
  const list = (snapshot?.positions || []).slice().sort((a, b) => (b.value || 0) - (a.value || 0));
  if (!snapshot) { $('#gr-body').innerHTML = '<p class="pf-muted">계좌를 불러오면 표시합니다.</p>'; return; }
  if (!list.length) { $('#gr-body').innerHTML = '<p class="pf-muted">보유 주식 없음</p>'; return; }
  const inU = list.filter(p => O.companies[symKey(p.symbol)]), out = list.filter(p => !O.companies[symKey(p.symbol)]);
  const rows = inU.map(p => {
    const c = O.companies[symKey(p.symbol)], r = c.range, cur = c.market === 'US' ? 'USD' : 'KRW';
    return `<tr><td><b>${esc(p.name)}</b><small>${esc(c.sector)} · 최근 분기 ${esc(c.lastQuarterEnd)}</small></td>
      <td><b>${rankWord(c.growthRank)}</b><small>${c.market === 'KR' ? '한국' : '미국'} ${c.groupSize}개 중 ${topPct(c.growthRank)}</small></td>
      <td>${r ? `<b>${p0(r.p50)}</b><small>보통 범위 ${p0(r.p25)}~${p0(r.p75)} ${tip(`2021~2025년 같은 시장에서 비슷한 순위였던 사례 ${r.n}건의 실제 다음 1년 매출 성장입니다(보통 범위 = 가운데 50%). 같은 달 중간값보다 많이 성장한 비율 ${r.aboveMedian}%.`)}</small>` : '—'}</td>
      <td>${c.oiRank != null ? `<b>${rankWord(c.oiRank)}</b><small>${topPct(c.oiRank)}</small>` : '<span class="pf-muted">—</span>'}</td>
      <td class="gr-why">${c.drivers.slice(0, 3).map(([f, v, x]) => `<span>${esc(driverText(f, v, x, cur))}</span>`).join('')}</td>
      <td class="gr-flags">${c.flags.length ? c.flags.map(f => `<span>${esc(f)}</span>`).join('') : '<span class="pf-muted">—</span>'}</td></tr>`;
  }).join('');
  $('#gr-body').innerHTML = `${inU.length ? `<div class="table-wrap"><table class="pf-table gr-table"><thead><tr><th>종목</th><th>매출 성장 전망</th><th>과거 같은 순위의 실제 성장</th><th>영업이익 성장 전망</th><th>이유 ${tip('영향이 컸던 항목입니다. ▲는 성장 순위를 올렸고 ▼는 내렸습니다. PSR·주가 흐름이 이유라면 시장이 이미 그 성장을 기대하고 있다는 뜻입니다.')}</th><th class="gr-flags">주의</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${out.length ? `<p class="pf-muted gr-out">비교 기업 밖이라 전망 없음: ${out.map(p => esc(p.name)).join(', ')}</p>` : ''}`;
}
window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; render(); });
window.addEventListener('teamquant:asset-clear', () => { snapshot = null; render(); });
