// 홈 '종목별 수익률' 카드(2026-11-26 사용자 요청: 넓은 화면 오른쪽 맨 위에 종목별 수익률 · 그래프). brief-ui.js 가 같은 보유 스냅샷으로 부른다.
// 줄마다: 이름(누르면 종목 상세) · 비중 · 가운데 0 선에서 좌우로 뻗는 수익률 막대 · 수익률과 원 손익 · 오늘 등락. 계산은 lib/holdings-view.js(node 시험).
// 매수·매도 권유를 하지 않는다. 브라우저에 남기는 것은 고른 정렬 하나뿐이다(보유 정보는 저장하지 않음).
import { tip } from '/tooltip-ui.js';
import { holdingsView } from '/lib/holdings-view.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MINUS = '−';
const tone = v => !Number.isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const pct = (v, d = 2) => { if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(d)); return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${Math.abs(r).toFixed(d)}%`; };
const weight = v => !Number.isFinite(v) ? '—' : v > 0 && v < 0.5 ? '1% 미만' : `${v < 10 ? v.toFixed(1) : v.toFixed(0)}%`;
const scaleText = v => `${Number.isInteger(v) ? v : Number(v.toPrecision(3))}%`;
const SORT_KEY = 'tq:home-holdings:sort', LIMIT = 10;
const SORTS = [['weight', '비중순'], ['return', '수익률순']];
let sort = (() => { try { return localStorage.getItem(SORT_KEY) === 'return' ? 'return' : 'weight'; } catch { return 'weight'; } })();
let expanded = false, last = null;

const TIP = '수익률: 매입 평균가 대비 · 손익: 원화(미국 주식은 오늘 환율로 바꾼 값이고, 수익률은 달러 기준이라 환율 변화가 빠져 있음) · 오늘: 전날 종가 대비 등락 · 비중: 현금을 아는 경우 현금 포함 총자산 대비.\n막대: 가운데 세로선이 0%, 오른쪽(빨강) 이익 · 왼쪽(파랑) 손실. 막대 끝 눈금은 보이는 종목 중 가장 큰 수익률에 맞춘 값입니다.';
const head = (body = '') => `<header><h3 id="hh-title">종목별 수익률 ${tip(TIP)}</h3>${body}</header>`;

/**
 * @param host  #hm-holdings
 * @param state 'none'(계좌 확인 중) | 'clear'(지움) | 'ok'
 * @param data  {positions, fxRate, cashKrw, dayPct, total:{pnl,returnPct,basis}, asOf, won, signedWon}
 */
export function renderHoldings(host, state, data = null) {
  if (!host) return;
  last = { host, state, data };
  if (!host.dataset.hhBound) { host.dataset.hhBound = '1'; host.addEventListener('click', onClick); }
  if (state !== 'ok') { expanded = false; host.innerHTML = head() + `<p class="hm-empty">${state === 'clear' ? '화면의 자산 정보를 지웠습니다.' : '계좌를 불러오는 중입니다.'}</p>`; return; }
  const { positions = [], fxRate = null, cashKrw = null, dayPct = {}, total = null, asOf = '', won, signedWon } = data;
  if (!positions.length) { host.innerHTML = head() + `<p class="hm-empty">보유 주식이 없습니다.${Number.isFinite(cashKrw) ? ` 현금 ${esc(won(cashKrw))}` : ''}</p>`; return; }
  const v = holdingsView(positions, { fxRate, cashKrw, dayPct, sort, limit: LIMIT, expanded });
  const seg = `<div class="ht-seg" role="group" aria-label="정렬">${SORTS.map(([k, label]) => `<button type="button" data-hh-sort="${k}" aria-pressed="${k === sort}">${label}</button>`).join('')}</div>`;
  const n = v.rows.length + v.hidden;
  // 2026-11-27 보완 2: '미국 주식 수익률은 달러 기준'은 제목 ⓘ(TIP)와 같은 말이라 뺐다.
  const meta = [asOf ? `${asOf} 기준` : '', `${n}종목${v.cash ? ' + 현금' : ''}`].filter(Boolean).join(' · ');
  const row = r => {
    const bar = v.bars.get(r.symbol), w = bar ? bar.widthPct.toFixed(1) : '0';
    return `<tr><th scope="row"><button type="button" class="ht-name hh-name" data-open-stock="${esc(r.symbol)}" title="${esc(r.name)}">${esc(r.name)}</button><small>비중 ${weight(r.weightPct)}</small></th>
      <td class="hh-bar" aria-hidden="true"><span class="hh-track">${bar && bar.side !== 'flat' ? `<i class="${bar.side}" style="--w:${w}%"></i>` : ''}</span></td>
      <td class="num"><b class="${tone(r.returnPct)}">${pct(r.returnPct)}</b><small class="${tone(r.pnlKrw)}">${Number.isFinite(r.pnlKrw) ? esc(signedWon(r.pnlKrw)) : '원가 모름'}</small></td>
      <td class="num hh-day ${tone(r.dayPct)}">${pct(r.dayPct, 1)}</td></tr>`;
  };
  const cashRow = v.cash ? `<tr class="hh-cash"><th scope="row">현금<small>비중 ${weight(v.cash.weightPct)}</small></th><td class="hh-bar" aria-hidden="true"></td><td class="num" colspan="2"><small>${esc(won(v.cash.valueKrw))}</small></td></tr>` : '';
  // 합계: 계좌 띠의 '평가 손익(보유 중)'과 같은 값(holdingsReturn)을 먼저 쓴다. 없으면 줄 손익의 합.
  const useR = total && Number.isFinite(total.pnl), tPnl = useR ? total.pnl : v.total.pnlKrw, tPct = useR ? total.returnPct : v.total.returnPct;
  const tTip = useR && total.basis === 'purchase_fx' ? '토스 계좌 합계와 같은 계산입니다(미국 주식 원금은 산 날 환율). 그래서 위 줄 손익의 합과 조금 다를 수 있습니다.' : `지금 가진 종목의 손익 합계입니다(판 종목·현금 제외)${v.total.counted < v.total.of ? ` · 원가를 아는 ${v.total.counted}/${v.total.of}종목만` : ''}.`;
  const more = v.hidden > 0 ? `<button type="button" class="text-button hh-more" data-hh-more aria-expanded="false">나머지 ${v.hidden}개 보기</button>` : expanded && n > LIMIT ? `<button type="button" class="text-button hh-more" data-hh-more aria-expanded="true">접기</button>` : '';
  host.innerHTML = head(seg) + `<p class="ht-meta">${esc(meta)}</p>
    <table class="hh">
      <caption class="tq-vh">종목별 매입 평균가 대비 수익률 · ${sort === 'return' ? '수익률 높은 순' : '비중 큰 순'}</caption>
      <colgroup><col><col class="hh-c-bar"><col class="hh-c-ret"><col class="hh-c-day"></colgroup>
      <thead><tr><th scope="col">종목 · 비중</th><th scope="col" class="hh-axis-h"><span class="tq-vh">수익률 막대(글자 값과 같음)</span><span class="hh-axis" aria-hidden="true"><span>${MINUS}${scaleText(v.scale)}</span><span>0</span><span>+${scaleText(v.scale)}</span></span></th><th scope="col" class="num">수익률 · 손익</th><th scope="col" class="num">오늘</th></tr></thead>
      <tbody>${v.rows.map(row).join('')}${cashRow}</tbody>
      <tfoot><tr><th scope="row">보유 전체 평가 손익 ${tip(tTip)}</th><td class="hh-bar" aria-hidden="true"></td><td class="num"><b class="${tone(tPnl)}">${Number.isFinite(tPnl) ? esc(signedWon(tPnl)) : '—'}</b><small class="${tone(tPct)}">${pct(tPct)}</small></td><td></td></tr></tfoot>
    </table>${more}`;
}

function onClick(e) {
  const s = e.target.closest?.('[data-hh-sort]');
  if (s) { const k = s.dataset.hhSort; if (k !== sort && SORTS.some(([x]) => x === k)) { sort = k; try { localStorage.setItem(SORT_KEY, k); } catch { /* 기억 못 해도 이번 화면은 바뀐다 */ } redraw('[data-hh-sort="' + k + '"]'); } return; }
  if (e.target.closest?.('[data-hh-more]')) { expanded = !expanded; redraw('[data-hh-more]'); return; }
  const b = e.target.closest?.('[data-open-stock]');
  if (b) window.dispatchEvent(new CustomEvent('teamquant:open-stock', { detail: { symbol: b.dataset.openStock } }));
}
// 다시 그린 뒤 누른 버튼에 초점을 되돌린다(키보드 사용자가 자리를 잃지 않게).
function redraw(focusSel) { if (!last) return; renderHoldings(last.host, last.state, last.data); last.host.querySelector(focusSel)?.focus(); }
