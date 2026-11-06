// 포트폴리오 › 성장 전망(모델): 보유 종목 중 연구 기업(98개)에 든 종목의 다음 1년 매출·영업이익 성장 순위 전망과 근거, 주의할 점.
// 자료: data/growth-outlook.json(growth-model.py가 오늘까지 공개된 결과로 다시 학습해 만든 최신 월말 판단), data/growth-ledger.json(판단 기록부).
// 주가 방향은 판단하지 않는다(초과수익 예측은 표본 외에서 실패).
import { tip } from '/tooltip-ui.js';
import { topPct, rankWord, driverText, symKey } from '/lib/company-lab.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p0 = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—';
let O = null, L = null, S = null, snapshot = null;
const pp = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p` : '—', pc = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` : '—';
const card = document.createElement('article'); card.className = 'pf-card gr-card'; card.id = 'pf-growth';
card.innerHTML = '<header><h3>성장 전망 (모델) <span id="gr-tip"></span></h3><p class="pf-muted" id="gr-sub">불러오는 중…</p></header><div id="gr-body"><p class="pf-muted">계좌를 불러오면 표시합니다.</p></div>';
const $ = s => card.querySelector(s);

function mount() { const main = document.querySelector('#portfolio .pf-main'); if (!main) return false; if (!card.isConnected) main.querySelector('.pf-card')?.after(card); return card.isConnected; }
if (!mount()) { const mo = new MutationObserver(() => { if (mount()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }

const get = f => fetch(`/data/${f}.json?v=G2S1`).then(r => r.ok ? r.json() : null).catch(() => null);
Promise.all([get('growth-outlook'), get('growth-ledger'), get('growth-strategy')]).then(([o, l, st]) => { O = o; L = l; S = st; head(); render(); }).catch(() => { $('#gr-sub').textContent = '성장 전망 자료를 불러오지 못했습니다.'; });

function head() {
  if (!O) return;
  const v = O.validation, asOf = Object.values(O.companies)[0]?.asOf, n = Object.values(O.companies).reduce((a, c) => (a[c.market] = (a[c.market] || 0) + 1, a), {});
  const done = (L?.entries || []).filter(e => e.actual), hit = done.filter(e => e.expected && e.actual.revGrowth > e.expected.p25 && e.actual.revGrowth < e.expected.p75).length;
  $('#gr-tip').innerHTML = tip(`연구 기업 ${Object.keys(O.companies).length}개(한국 ${n.KR}·미국 ${n.US}) 안에서 다음 1년 매출 성장 순위를 매깁니다. 기준 ${asOf} 월말, 결과가 ${O.trainedOnOutcomesThrough}까지 공개된 자료로 학습(${O.version}).\n`
    + `검증(2021~2025 표본 외, 같은 달·같은 시장 순위 상관): 이 모델 ${v.growth.ic} (95% ${v.growth.ci95.join('~')}), '올해 성장률 그대로' ${v.persist.ic}. 영업이익 성장 ${v.oi?.ic ?? '—'}. 연도별 ${Object.entries(v.byYear).filter(([y]) => y >= 2021).map(([y, x]) => `${y} ${x}`).join(' · ')}.\n`
    + `재무만 쓰면 ${v.financialOnly.ic}로 단순 기준과 차이가 없었습니다. 우위의 상당 부분은 주가에 담긴 시장의 기대(PSR·주가 흐름)라서, 이 전망이 좋다고 주가가 오른다는 뜻이 아닙니다(초과수익 예측 ${v.excess.ic}).\n`
    + `범위: 2021~2025년 같은 시장에서 같은 순위 구간(5등분)이던 기업들의 실제 1년 매출 성장 중앙값과 가운데 절반.\n`
    + `기록부: 판단 ${L?.entries?.length ?? 0}건을 바꾸지 않고 남겨 두고, 결과가 공개되면 채웁니다. 지금까지 결과 확인 ${done.length}건${done.length ? `, 가운데 절반 범위 안 ${hit}건` : ''}.`
    + (S ? strategyText(S) : ''));
  $('#gr-sub').textContent = `${asOf} 기준 · 매매 신호 아님 · 연구 기업 98개 안의 순위`;
}
// 이 전망으로 종목을 골랐다면(growth-strategy.mjs, 실행 전에 고정한 가설) → 화면에 '매매 신호 아님'을 쓰는 근거
function strategyText(S) {
  const c = S.combined?.check, p = S.combined?.pick, us = S.markets?.US?.check?.y2022, span = S.markets?.US?.check?.span;
  if (!c?.H1_TOP_ALL || !span) return '';
  return `\n전략 검증(${span[0]}~${span[1]}, 매월 교체, 배당·거래 비용 포함, 한국·미국 평균): 성장 상위 20%만 보유하면 같은 시장 연구 기업 전체보다 연 ${pp(c.H1_TOP_ALL.annual)}(95% ${pp(c.H1_TOP_ALL.ci95[0])}~${pp(c.H1_TOP_ALL.ci95[1])}), 하위 20%를 빼면 ${pp(c.H2_EXBOT_ALL.annual)}로 둘 다 0과 구별되지 않았습니다. `
    + `2017~2020년에는 상위 20%가 연 ${pp(p?.H1_TOP_ALL?.annual)} 앞섰지만 그 뒤 사라졌습니다. 하락장에서는 성장 상위가 더 빠졌습니다(2022년 미국 ${pc(us?.TOP)}, 전체 ${pc(us?.ALL)}). 그래서 이 전망으로 종목을 고르거나 팔지 않습니다.`;
}
function render() {
  if (!O) return;
  const list = (snapshot?.positions || []).slice().sort((a, b) => (b.value || 0) - (a.value || 0));
  if (!snapshot) { $('#gr-body').innerHTML = '<p class="pf-muted">계좌를 불러오면 표시합니다.</p>'; return; }
  if (!list.length) { $('#gr-body').innerHTML = '<p class="pf-muted">보유 주식이 없습니다.</p>'; return; }
  const inU = list.filter(p => O.companies[symKey(p.symbol)]), out = list.filter(p => !O.companies[symKey(p.symbol)]);
  const rows = inU.map(p => {
    const c = O.companies[symKey(p.symbol)], r = c.range, cur = c.market === 'US' ? 'USD' : 'KRW';
    return `<tr><td><b>${esc(p.name)}</b><small>${esc(c.sector)} · 최근 분기 ${esc(c.lastQuarterEnd)}</small></td>
      <td><b>${rankWord(c.growthRank)}</b><small>${c.market === 'KR' ? '한국' : '미국'} ${c.groupSize}개 중 ${topPct(c.growthRank)}</small></td>
      <td>${r ? `<b>${p0(r.p50)}</b><small>가운데 절반 ${p0(r.p25)}~${p0(r.p75)} ${tip(`2021~2025년 같은 시장에서 이 순위 구간이던 사례 ${r.n}건의 실제 다음 1년 매출 성장. 같은 달 중앙값보다 많이 성장한 비율 ${r.aboveMedian}%.`)}</small>` : '—'}</td>
      <td>${c.oiRank != null ? `<b>${rankWord(c.oiRank)}</b><small>${topPct(c.oiRank)}</small>` : '<span class="pf-muted">—</span>'}</td>
      <td class="gr-why">${c.drivers.slice(0, 3).map(([f, v, x]) => `<span>${esc(driverText(f, v, x, cur))}</span>`).join('')}</td>
      <td class="gr-flags">${c.flags.length ? c.flags.map(f => `<span>${esc(f)}</span>`).join('') : '<span class="pf-muted">—</span>'}</td></tr>`;
  }).join('');
  $('#gr-body').innerHTML = `${inU.length ? `<div class="table-wrap"><table class="pf-table gr-table"><thead><tr><th>종목</th><th>매출 성장 전망</th><th>과거 같은 순위의 실제 성장</th><th>영업이익 성장 전망</th><th>판단 근거 ${tip('영향이 컸던 특징(LightGBM 기여도). ▲는 성장 순위를 올렸고 ▼는 내렸습니다. PSR·주가 흐름이 근거라면 시장이 이미 그 성장을 기대하고 있다는 뜻입니다.')}</th><th>주의</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${out.length ? `<p class="pf-muted gr-out">연구 기업 밖이라 전망 없음: ${out.map(p => esc(p.name)).join(', ')}</p>` : ''}`;
}
window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; render(); });
window.addEventListener('teamquant:asset-clear', () => { snapshot = null; render(); });
