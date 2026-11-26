// 시장(2026-11-13 · 결정 33): 오늘 장이 어땠는지 한 화면에 — 지수 · 투자자별 순매수 · 내 종목 · 업종 · 종목 순위.
// "매매 전 확인" 탭을 대신한다. 종목을 누르면 종목·주문 점검으로 넘어가 시세·차트·규칙 점검을 본다. 섹터·이슈·뉴스 화면도 같은 묶음의 작은 탭으로 모았다.
// 자료: /api/market-overview (공개 시세 페이지 값을 추린 것). 순위·등락은 사실 나열이고 매수·매도 권유가 아니다.
// 2026-11-26: 내 종목을 지수 바로 아래 전체 폭으로, 순매수는 숫자 한 줄(막대는 접힘), 받기 전에는 자리표시, 실패하면 카드마다 '다시 시도'.
import { getJson } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';
import { quoteOf } from '/stock-search-ui.js';
import { coreHoldings, openStock } from '/core-ui.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/market.css?v=20261126'; document.head.append(css);
const num = (v, d = 0) => Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const tone = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const sign = (v, d = 2) => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%` : '—';
const eok = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${num(v)}억`;
const signedEok = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${eok(Math.abs(v))}` : '—';
const NAME = { USDKRW: '달러 환율' }; // 시장 개요의 이름 중 앱 표기와 다른 것
const RETRY = '<p class="cr-muted">불러오지 못했습니다 · <button type="button" class="text-button" data-mk-retry>다시 시도</button></p>';
const RETRY_INLINE = '불러오지 못했습니다 · <button type="button" class="text-button" data-mk-retry>다시 시도</button>';

// ── 화면 ─────────────────────────────────────────────────────
const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'market'; nav.textContent = '시장'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'market'; page.id = 'core-market';
page.innerHTML = `<div class="page-head"><div><h1>시장 ${tip('지수·환율, 투자자별 순매수, 업종별 등락, 종목 순위는 네이버 증권 공개 시세를 그대로 옮긴 것입니다. 장중에는 1분마다 새로 받습니다. 사실 나열이며 매수·매도 권유가 아닙니다.')}</h1><p id="mk-line">불러오는 중…</p>
  <div class="mk-flowline"><span class="mk-flowhead">투자자별 순매수 ${tip('오늘 그 시장에서 개인·외국인·기관이 산 금액 − 판 금액(억 원)입니다. 빨강 = 더 많이 삼, 파랑 = 더 많이 팖. 많이 샀다고 주가가 오르는 것은 아닙니다.')}</span><span id="mk-flow-line">불러오는 중…</span>
    <details class="mk-flowmore"><summary>막대로 보기</summary><div id="mk-flow"></div></details></div></div><button type="button" class="secondary" id="mk-refresh">새로고침</button></div>
<div class="mk-idx" id="mk-idx">${'<div class="mk-tile mk-skel shimmer" aria-hidden="true"></div>'.repeat(5)}</div>
<article class="cr-card mk-mine"><header><h3>내 종목 오늘 ${tip('보유(또는 예시 자산·팀 모의계좌) 종목의 오늘 등락입니다(미국 종목은 지난밤). 누르면 종목·주문 점검에서 시세·차트를 봅니다.')}</h3></header><div id="mk-mine"><p class="cr-muted">불러오는 중…</p></div></article>
<div class="mk-two wide">
  <article class="cr-card"><header><h3>업종별 오늘 등락 ${tip("업종별 오늘 평균 등락과 오른·내린 종목 수입니다. 업종을 누르면 '종목' 칸에 그 업종 종목이 시가총액 순으로 나옵니다.")}</h3><button type="button" class="text-button" id="mk-sec-all">전체 보기</button></header><div id="mk-sec"><div class="shimmer mk-skel-row"></div></div></article>
  <article class="cr-card"><header><h3>종목</h3><div class="mk-seg" id="mk-mkt"><button type="button" data-mkt="KOSPI" class="on">코스피</button><button type="button" data-mkt="KOSDAQ">코스닥</button></div></header>
    <div class="mk-seg mk-tabs2" id="mk-tabs"></div><div id="mk-list"><div class="shimmer mk-skel-row"></div></div></article>
</div>`;
document.querySelector('main').append(page);

// ── 묶음 탭: 시장 · 종목·주문 점검 · 섹터 · 이슈 · 뉴스 ────────────────
export const MARKET_VIEWS = [['market', '오늘 장'], ['precheck', '종목·주문 점검'], ['sectors', '섹터'], ['issues', '이슈'], ['news', '뉴스']];
for (const [id] of MARKET_VIEWS) { const v = document.querySelector(`.view[data-page="${id}"]`); if (!v || v.querySelector('.mk-sub')) continue;
  const bar = document.createElement('div'); bar.className = 'mk-sub'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', '시장 메뉴');
  bar.innerHTML = MARKET_VIEWS.filter(([k]) => document.querySelector(`.view[data-page="${k}"]`)).map(([k, l]) => `<button type="button" role="tab" data-mk-go="${k}" class="${k === id ? 'on' : ''}" aria-selected="${k === id}">${l}</button>`).join('');
  v.prepend(bar); }
document.addEventListener('click', e => { const b = e.target.closest?.('[data-mk-go]'); if (b) document.querySelector(`[data-view="${b.dataset.mkGo}"]`)?.click(); });

// ── 그리기 ────────────────────────────────────────────────────
const S = { market: 'KOSPI', tab: 'cap', data: null, industry: null, showAll: false, run: 0, timer: null };
const TABS = [['cap', '시가총액 상위'], ['up', '상승'], ['down', '하락'], ['volume', '거래량']];
function renderIdx(d) { $('#mk-idx').innerHTML = d.indices.map(i => `<article class="mk-tile"><span>${esc(NAME[i.key] || i.name)} <small class="${i.open ? 'live' : ''}">${i.open ? '장중' : '장 마감'}</small></span><b>${num(i.price, 2)}</b><em class="${tone(i.pct)}">${i.change > 0 ? '▲' : i.change < 0 ? '▼' : ''} ${num(Math.abs(i.change), 2)} (${sign(i.pct)})</em></article>`).join(''); }
function renderLine(d) { const k = d.indices.find(i => i.key === 'KOSPI'), up = d.sectors.filter(s => s.pct > 0).length, dn = d.sectors.filter(s => s.pct < 0).length;
  $('#mk-line').innerHTML = `${k ? `코스피 <b class="${tone(k.pct)}">${sign(k.pct)}</b> · ` : ''}오른 업종 <b>${up}</b> · 내린 업종 <b>${dn}</b> <small class="cr-muted">${esc(new Date(d.asOf).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }))} 기준${d.errors?.length ? ` · 못 받은 자료: ${esc(d.errors.join(', '))}` : ''}</small>`; }
// 순매수: 숫자 한 줄(시장마다 외국인 · 기관 · 개인). 막대는 '막대로 보기' 안에.
function renderFlow(d) { const max = Math.max(1, ...d.flows.flatMap(f => [f.personal, f.foreign, f.institution].map(v => Math.abs(v || 0))));
  const mkt = m => m === 'KOSPI' ? '코스피' : '코스닥';
  $('#mk-flow-line').innerHTML = d.flows.length ? d.flows.map(f => `<span class="mk-flowmkt"><b>${mkt(f.market)}</b> ${[['외국인', f.foreign], ['기관', f.institution], ['개인', f.personal]].map(([n, v]) => `${n} <em class="${tone(v)}">${signedEok(v)}</em>`).join(' · ')}</span>`).join('') : '자료를 받지 못했습니다.';
  $('#mk-flow').innerHTML = d.flows.length ? d.flows.map(f => `<div class="mk-flow"><b>${mkt(f.market)}</b>${[['개인', f.personal], ['외국인', f.foreign], ['기관', f.institution]].map(([n, v]) => `<div class="mk-bar"><span>${n}</span><i><u class="${tone(v)}" style="width:${Math.max(2, Math.abs(v || 0) / max * 100).toFixed(1)}%"></u></i><em class="${tone(v)}">${signedEok(v)}</em></div>`).join('')}</div>`).join('') : '<div class="cr-muted">자료를 받지 못했습니다.</div>'; }
function renderSec(d) { const all = d.sectors, max = Math.max(0.5, ...all.map(s => Math.abs(s.pct)));
  const row = s => `<button type="button" class="mk-row ${S.industry?.no === s.no ? 'on' : ''}" data-ind="${s.no}" data-name="${esc(s.name)}"><span>${esc(s.name)}</span><i><u class="${tone(s.pct)}" style="width:${(Math.abs(s.pct) / max * 100).toFixed(1)}%"></u></i><em class="${tone(s.pct)}">${sign(s.pct)}</em><small>오름 ${s.up} · 내림 ${s.down}</small></button>`;
  const list = S.showAll ? all : [...all.slice(0, 7), ...all.slice(-7)];
  $('#mk-sec').innerHTML = all.length ? `<div class="mk-rows ${S.showAll ? 'all' : ''}">${S.showAll ? list.map(row).join('') : `<p class="mk-cap">많이 오른 업종</p>${all.slice(0, 7).map(row).join('')}<p class="mk-cap">많이 내린 업종</p>${all.slice(-7).reverse().map(row).join('')}`}</div>` : '<p class="cr-muted">자료를 받지 못했습니다.</p>';
  $('#mk-sec-all').textContent = S.showAll ? '오른·내린 7개씩 보기' : `전체 ${all.length}개 보기`; }
function stockRows(list) { return list.length ? `<div class="pp-scroll"><table class="mk-table"><thead><tr><th>종목</th><th>현재가</th><th>등락</th><th class="mk-val">거래대금</th></tr></thead><tbody>${list.map(s => `<tr data-open="${esc(s.code)}" data-name="${esc(s.name)}" tabindex="0" role="button"><td>${esc(s.name)} <small class="cr-muted">${esc(s.code)}</small></td><td>${num(s.price)}</td><td class="${tone(s.pct)}">${sign(s.pct)}</td><td class="mk-val">${eok(s.valueEok)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="cr-muted">자료를 받지 못했습니다.</p>'; }
function renderList() { const d = S.data; if (!d) return; const tabs = [...TABS, ...(S.industry ? [['ind', `업종 · ${S.industry.name}`]] : [])];
  $('#mk-tabs').innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${esc(l)}</button>`).join('');
  $('#mk-list').innerHTML = S.tab === 'ind' ? (S.industry?.stocks ? stockRows(S.industry.stocks) : '<p class="cr-muted">불러오는 중…</p>') : stockRows(d.lists[S.tab] || []);
  for (const b of document.querySelectorAll('#mk-mkt [data-mkt]')) b.classList.toggle('on', b.dataset.mkt === S.market); $('#mk-mkt').hidden = S.tab === 'ind'; }
// 내 종목 오늘: 비중 순 표 + 합계 한 줄(평가액 비중으로 가중한 오늘 등락).
async function renderMine() { const box = $('#mk-mine'), hs = coreHoldings(); if (!hs.length) { box.innerHTML = '<p class="cr-muted">보유 종목 없음 · <button type="button" class="text-button" data-demo-start>예시 자산 켜기</button></p>'; return; }
  const total = hs.reduce((a, p) => a + (p.valueKrw || 0), 0), qs = await Promise.all(hs.map(p => quoteOf(p.symbol)));
  const rows = hs.map((p, i) => ({ ...p, q: qs[i] })).sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0));
  const known = rows.filter(r => Number.isFinite(r.q?.pct) && r.valueKrw > 0), base = known.reduce((a, r) => a + r.valueKrw, 0), avg = base > 0 ? known.reduce((a, r) => a + r.valueKrw * r.q.pct, 0) / base : null;
  box.innerHTML = `<div class="pp-scroll"><table class="mk-table"><thead><tr><th>종목</th><th>현재가</th><th>오늘</th><th>비중</th></tr></thead><tbody>${rows.map(r => `<tr data-open="${esc(r.symbol)}" data-name="${esc(r.name)}" data-cur="${esc(r.currency || 'KRW')}" tabindex="0" role="button"><td>${esc(r.name)}</td><td>${r.q && Number.isFinite(r.q.price) ? (r.currency === 'USD' ? '$' + num(r.q.price, 2) : num(r.q.price)) : '—'}</td><td class="${tone(r.q?.pct)}">${r.q ? sign(r.q.pct) : '—'}</td><td>${total > 0 && r.valueKrw ? (r.valueKrw / total * 100).toFixed(0) + '%' : '—'}</td></tr>`).join('')}</tbody>${Number.isFinite(avg) ? `<tfoot><tr><td>합계 ${tip('평가액 비중으로 가중한 오늘 등락입니다. 미국 종목은 지난밤 등락입니다.')}</td><td></td><td class="${tone(avg)}">${sign(avg)}</td><td>100%</td></tr></tfoot>` : ''}</table></div>`; }
function renderAll() { const d = S.data; if (!d) return; renderIdx(d); renderLine(d); renderFlow(d); renderSec(d); renderList(); }

async function load({ quiet = false } = {}) { const run = ++S.run; if (!quiet) $('#mk-line').textContent = '불러오는 중…';
  try { const d = await getJson(`/api/market-overview?market=${S.market}&t=${Math.floor(Date.now() / 30000)}`); if (run !== S.run) return; S.data = d; renderAll(); }
  catch (e) { if (run === S.run && !S.data) { $('#mk-line').textContent = `시장 자료를 받지 못했습니다 (${e.message})`; for (const id of ['#mk-idx', '#mk-sec', '#mk-list']) $(id).innerHTML = RETRY; $('#mk-flow-line').innerHTML = RETRY_INLINE; } }
  void renderMine(); }
async function pickIndustry(no, name) { S.industry = { no: Number(no), name, stocks: null }; S.tab = 'ind'; renderSec(S.data); renderList();
  try { const r = await getJson(`/api/market-overview?industry=${Number(no)}`); if (S.industry?.no === Number(no)) { S.industry.stocks = r.stocks; renderList(); } } catch { if (S.industry?.no === Number(no)) { S.industry.stocks = []; renderList(); } } }

page.addEventListener('click', e => {
  if (e.target.closest?.('[data-mk-retry]')) return void load();
  const ind = e.target.closest?.('[data-ind]'); if (ind) return void pickIndustry(ind.dataset.ind, ind.dataset.name);
  const tab = e.target.closest?.('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; return renderList(); }
  const mkt = e.target.closest?.('[data-mkt]'); if (mkt && mkt.dataset.mkt !== S.market) { S.market = mkt.dataset.mkt; if (S.tab === 'ind') S.tab = 'cap'; return void load(); }
  const row = e.target.closest?.('[data-open]'); if (row) openStock({ symbol: row.dataset.open, name: row.dataset.name, currency: row.dataset.cur || 'KRW' });
});
page.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches?.('[data-open]')) e.target.click(); });
$('#mk-refresh').onclick = () => load();
$('#mk-sec-all').onclick = () => { S.showAll = !S.showAll; if (S.data) renderSec(S.data); };
const active = () => document.querySelector('.view.active')?.dataset.page === 'market';
window.addEventListener('teamquant:page', () => { clearInterval(S.timer); if (!active()) return; void load({ quiet: !!S.data }); S.timer = setInterval(() => { if (active() && !document.hidden && S.data?.indices?.some(i => i.open)) void load({ quiet: true }); }, 60000); });
window.addEventListener('teamquant:core-ready', () => { if (active()) void renderMine(); });
