// 핵심 기능 화면: ① 규칙 ② 오늘 점검(홈) ③ 주문 점검 ④ 성적표.
// 계산은 모두 이 브라우저에서 한다. 보유 금액·현금·규칙은 서버로 보내지 않고, 서버에는 종목 코드로 시세만 묻는다.
// 규칙·계획은 브라우저(프로필별)에 저장한다. 같은 엔진(lib/core-rules·core-risk·report-card)을 scripts/validate-core.mjs가 2012년부터 검증했다.
import { RULE_DEFS, DEFAULT_RULES, BAND, normalizeRules, initialPlan, planPctOf, evaluate, preTradeCheck, maxBuyAmount, allocateCash, isLeveraged, RULES_VERSION } from '/lib/core-rules.js';
import { assetRisk, krwReturns, riskGrid, portfolioRiskAt, buildEngine } from '/lib/core-risk.js';
import { simulateGarch } from '/lib/risk-models.js';
import { reportCard } from '/lib/report-card.js';
import { fillsFrom } from '/lib/asset-timeline.js';
import {candles as fetchCandles, getJson } from '/lib/client-data.js';
import { privateRead } from '/bridge-client.js';
import { resolveStockInput, stockName } from '/lib/instruments.js';
import { tip } from '/tooltip-ui.js';
import { mountCandles } from '/lib/candlestick-view.js';
import { attachStockSearch, quoteOf } from '/stock-search-ui.js';
import { reviewRules, RULE_LEVELS, RULE_LOCK_DAYS, levelOf, levelRules, changeGate, applyChange } from '/lib/rule-presets.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const swon = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = n => new Date(Date.now() - n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const marketOf = p => p.currency === 'USD' ? 'US' : 'KR';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/core.css?v=20261115a'; document.head.append(css);
const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
function addView(id, label, html) {
  const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = id; nav.textContent = label; navHost.append(nav);
  const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = id; page.id = 'core-' + id; page.innerHTML = html; document.querySelector('main').append(page); return page;
}

// ── 상태 ─────────────────────────────────────────────────────
const S = { snap: null, positions: [], fx: null, cash: null, cashSource: '', orders: null, candles: {}, risk: {}, series: {}, fxCandles: [], loading: null, epoch: 0 };
const profileKey = () => `teamQuantRules:${sessionStorage.getItem('teamQuantSession') || 'guest'}${S.snap?.paper ? ':paper' : S.snap?.demo ? ':demo' : ''}`;
function loadSaved() { try { const v = JSON.parse(localStorage.getItem(profileKey()) || 'null'); if (v?.rules) return v; } catch {} return null; }
function save(v) { try { localStorage.setItem(profileKey(), JSON.stringify({ ...v, version: RULES_VERSION, savedAt: new Date().toISOString() })); return true; } catch { return false; } }
function current() {
  if (S.snap?.paper) { const rules = normalizeRules(S.mock?.prefs?.rules || {}).rules, w = S.mock?.planDoc?.weights; const plan = w ? Object.fromEntries(Object.entries(w).filter(([, v]) => v.pct > 0).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }])) : Object.fromEntries(Object.entries(initialPlan(S.positions, S.cash, rules)).map(([k, v]) => [k, { pct: v, name: S.positions.find(p => p.symbol === k)?.name, currency: S.positions.find(p => p.symbol === k)?.currency }])); return { rules, plan, planSaved: !!w, savedAt: S.mock?.prefs?.savedAt || null }; }
  const saved = loadSaved(), rules = normalizeRules(saved?.rules || {}).rules;
  const plan = saved?.plan || Object.fromEntries(Object.entries(initialPlan(S.positions, S.cash, rules)).map(([k, v]) => [k, { pct: v, name: S.positions.find(p => p.symbol === k)?.name, currency: S.positions.find(p => p.symbol === k)?.currency }]));
  return { rules, plan, planSaved: !!saved?.plan, savedAt: saved?.savedAt || null };
}
const trades30 = () => S.snap?.paper && Number.isFinite(S.mock?.activity30?.decisions) ? S.mock.activity30.decisions : S.orders ? fillsFrom(S.orders).filter(f => f.date > daysAgo(30)).length : null;
function grid(extra = {}) { const ser = { ...S.series, ...extra }; return riskGrid(ser); }
function state(extraSeries) {
  const { rules, plan } = current(), g = grid(extraSeries), k = g.dates.length - 1;
  const planned = Object.entries(plan).filter(([s]) => !S.positions.some(p => p.symbol === s)).map(([s, v]) => ({ symbol: s, name: v?.name || stockName(s), currency: v?.currency || 'KRW', valueKrw: 0 }));
  return { positions: [...S.positions, ...planned], cashKrw: S.cash, rules, plan, risk: S.risk, portVar: h => portfolioRiskAt(g, h, k), trades30: trades30() };
}

async function loadAll() {
  const epoch = ++S.epoch;
  if (S.snap?.paper) { try { S.mock = await mockStatus(); } catch { S.mock = null; } if (epoch !== S.epoch) return; } else S.mock = null;
  const { plan } = current(), want = new Map(S.positions.map(p => [p.symbol, p]));
  for (const [s, v] of Object.entries(plan)) if (!want.has(s)) want.set(s, { symbol: s, name: v?.name || stockName(s), currency: v?.currency || 'KRW' });
  const fxP = fetchCandles('KRW=X', 'USD', '2y').then(d => { S.fxCandles = d.candles; }).catch(() => {});
  const ordersP = (async () => { try { S.orders = S.snap?.demo ? S.snap.demoOrders.orders : (await privateRead('order-history', { from: daysAgo(190), to: today(), status: 'CLOSED', symbol: '' })).orders; } catch { S.orders = null; } })();
  const cashP = (async () => { if (S.snap?.demo) { S.cash = S.snap.demoCash; S.cashSource = S.snap.paper ? '모의계좌 예수금' : '예시'; return; } if (Number.isFinite(S.cash)) return; try { const c = await privateRead('cash-get'); if (Number.isFinite(c?.latest?.amount)) { S.cash = c.latest.amount; S.cashSource = 'PC 기록 ' + String(c.latest.recordedAt || '').slice(0, 10); } } catch {} })();
  await fxP;
  await Promise.all([...want.values()].map(async p => {
    try { const d = await fetchCandles(p.symbol, p.currency, '2y'); S.candles[p.symbol] = d.candles; S.risk[p.symbol] = assetRisk(d.candles, { market: marketOf(p) }); S.series[p.symbol] = krwReturns(d.candles, p.currency, S.fxCandles); }
    catch (e) { S.risk[p.symbol] = { ok: false, reason: e.message }; }
  }));
  await Promise.all([ordersP, cashP]);
  if (epoch !== S.epoch) return;
  guard('today', renderToday); renderRules(); guard('chips', renderPrecheckChips); if (recentOpen()) void renderReport(); if ($('.view.active')?.dataset.page === 'rules') void renderReview();
  window.dispatchEvent(new Event('teamquant:core-ready'));
}
// 시장 화면(market-ui.js)이 쓰는 두 가지: 지금 보유 목록 · 종목 하나를 종목·주문 점검에서 열기.
export function coreHoldings() { return S.positions.map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency, valueKrw: p.valueKrw })); }
export function openStock(o) { if (!o?.symbol) return; const held = S.positions.find(p => p.symbol === o.symbol); document.querySelector('[data-view="precheck"]')?.click(); cpSel = held || { symbol: o.symbol, name: o.name || o.symbol, currency: o.currency || 'KRW' }; const inp = document.querySelector('#cp-sym'); if (inp) inp.value = ''; renderPrecheckChips(); void showStockPanel(cpSel); }

window.addEventListener('teamquant:asset-snapshot', e => {
  const snap = e.detail || {}; S.snap = snap; S.fx = snap.fx?.midRate || null;
  S.positions = (snap.positions || []).map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.quantity, valueKrw: p.currency === 'USD' ? (S.fx ? p.value * S.fx : null) : p.value })).filter(p => Number.isFinite(p.valueKrw));
  if (!snap.demo && /^(예시|모의계좌)/.test(S.cashSource)) { S.cash = null; S.cashSource = ''; }
  S.loading = loadAll();
});
window.addEventListener('teamquant:asset-clear', () => { Object.assign(S, { snap: null, positions: [], cash: null, cashSource: '', orders: null, risk: {}, series: {}, candles: {} }); renderToday(); renderRules(); });
window.addEventListener('teamquant:cash', e => { if (Number.isFinite(e.detail?.amount)) { S.cash = e.detail.amount; S.cashSource = e.detail.note || 'PC 기록'; renderToday(); renderRules(); } });

// ── ② 오늘 점검(홈) ──────────────────────────────────────────
const CHECK_TIP = '정해 둔 규칙과 계획 비중으로 지금 계좌를 점검합니다.\n맞추는 때: 그 주 마지막 거래일 종가(주 1회). 하루 손실이 한도의 1.25배를 넘거나, 레버리지 상품이 있거나, 한 종목이 상한의 1.2배를 넘으면 바로.\n계획 금액의 10% 넘게 차이 날 때만 맞춥니다.\n같은 엔진을 과거 시장에 돌린 결과는 규칙 화면에 있습니다(덜 잃는 대신 수익도 낮아짐).';
function weekEndNote() { const d = new Date(Date.now() + 9 * 3600e3), w = d.getUTCDay(); return w === 5 ? '오늘(금) 종가에 맞춤' : w === 6 || w === 0 ? '다음 주 금요일 종가에 맞춤' : `이번 주 금요일 종가에 맞춤`; }
function renderToday() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let card = document.getElementById('core-today');
  if (!card) { card = document.createElement('article'); card.className = 'hm-card core-today'; card.id = 'core-today'; const anchor = document.getElementById('hm-kpis'); if (anchor) anchor.after(card); else host.prepend(card); }
  if (!S.positions.length) { card.hidden = true; return; } card.hidden = false;
  const ready = Object.keys(S.risk).length > 0, { planSaved, rules } = current();
  if (!ready) { card.innerHTML = `<header><h3>오늘 점검 ${tip(CHECK_TIP)}</h3></header><div class="shimmer ct-skel"></div>`; return; }
  const e = evaluate(state()), when = e.urgent ? '지금 바로 맞출 일이 있습니다' : weekEndNote(), paper = !!S.snap?.paper, la = paper ? (S.mock?.auto || []).at(-1) : null;
  card.innerHTML = `<header><h3>오늘 점검 ${tip(CHECK_TIP)}</h3><span class="ct-when ${e.urgent ? 'urgent' : ''}">${esc(when)}</span></header>
    ${planSaved ? '' : `<p class="ct-note">아직 목표 비중을 저장하지 않아 지금 비중(한 종목 ${rules.maxSingle}% 이내)을 목표로 봤습니다. <button type="button" class="text-button" data-core-go="rules">규칙에서 정하기</button></p>`}
    <div class="ct-checks">${e.checks.map(c => `<span class="ct-chip ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '✓' : c.ok === false ? '!' : '?'} ${esc(c.label)}${tip(c.detail)}</span>`).join('')}</div>
    <p class="ct-score"><b>규칙 ${e.known}개 중 ${e.okCount}개 지킴</b>${e.known < e.checks.length ? ` · ${e.checks.length - e.known}개는 자료가 없어 확인 못 함` : ''}</p>
    ${paper ? `<p class="ct-none">할 일은 모의계좌가 스스로 정해 주문합니다${la ? ` · 마지막 자동 실행 ${esc(String(la.at || '').slice(0, 10))} · 보냄 ${la.sent ?? 0}건 · 막힘 ${la.blocked ?? 0}건` : ''} ${tip('이 화면의 칩은 브라우저가 모의계좌의 규칙과 계획으로 다시 계산한 것입니다. 실제 주문 판단은 서버의 엔진이 하고(뉴스·공시 주의, 나눠 사기 단계 포함), 그 결과는 모의투자 화면에 있습니다.')}</p>` : e.actions.length ? `<ol class="ct-actions">${e.actions.slice(0, 6).map(a => `<li class="${a.kind}"><b>${esc(a.text)}</b>${a.why?.length ? `<small>${esc(a.why.join(' · '))}</small>` : ''}</li>`).join('')}</ol>` : '<p class="ct-none">할 일 없음 · 계획대로 유지</p>'}
    <div class="ct-risk"><span>계좌 하루 95% 손실 범위 ${tip('지금 보유를 최근 500거래일의 하루 움직임(지금 변동성으로 맞춤)에 넣어 본 값입니다. 20거래일에 하루쯤은 이보다 더 잃을 수 있는 수준이고, 과거 검증에서 이 범위를 넘은 날의 비율은 규칙 화면의 검증 자료 원표에 있습니다(목표 5%).')}</span><b>${e.varNow?.ok ? `−${won(e.varNow.var95)}` : '—'}</b><small>${e.varNow?.ok ? `총자산의 ${(e.varNow.var95 / e.total * 100).toFixed(2)}% · 한도 ${current().rules.dailyLoss}%` : ''}</small></div>
    <form class="ct-cash" id="ct-cash" ${paper ? 'hidden' : ''}><label>새로 넣을 돈 ${tip('들어온 돈을 계획보다 모자란 종목부터 나눕니다. 떨어졌거나 덜 산 종목에 자연히 더 들어갑니다. 한 종목 상한·현금 최소·하루 손실 한도를 지키고 남으면 현금으로 둡니다. 무작위 6종목 포트폴리오 120개 모의 운용(2016~2026)에서 균등 적립과 수익·손실은 비슷하고 매매는 약 40% 적었습니다.')}</label><input id="ct-cash-in" type="number" min="10000" step="any" inputmode="numeric" placeholder="예: 500000"><button type="submit" class="secondary">나누기</button></form><div id="ct-cash-out"></div>
    <div class="ct-links"><button type="button" class="secondary" data-core-go="precheck">주문 점검</button><button type="button" class="secondary" data-core-go="rules">규칙</button>${paper ? '<button type="button" class="text-button" data-core-go="paper">모의투자</button>' : ''}</div>`;
}
document.addEventListener('submit', e => {
  if (e.target?.id !== 'ct-cash') return; e.preventDefault();
  const amt = Number(document.getElementById('ct-cash-in').value), box = document.getElementById('ct-cash-out'), a = allocateCash(state(), amt);
  if (!a.ok) { box.innerHTML = `<p class="cr-err">${esc(a.error)}</p>`; return; }
  box.innerHTML = a.buys.length ? `<ol class="ct-alloc">${a.buys.map(b => `<li><b>${esc(b.name)} ${won(b.amountKrw)}</b><small>${esc(b.why)}</small></li>`).join('')}</ol>${a.keepCashKrw >= 10000 ? `<p class="cr-muted">현금으로 둘 돈 ${won(a.keepCashKrw)}${a.note ? ' · ' + esc(a.note) : ''}</p>` : ''}` : `<p class="cr-muted">${a.note ? esc(a.note) : `지금은 계획보다 모자란 종목이 없어 ${won(amt)}을 현금으로 둡니다.`}</p>`;
});
document.addEventListener('click', e => { const b = e.target.closest?.('[data-core-go]'); if (b) document.querySelector(`[data-view="${b.dataset.coreGo}"]`)?.click(); });
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'home') renderToday(); });

// ── ① 규칙 ───────────────────────────────────────────────────
// 2026-11-13 개편(결정 34 · 사용자 의견: "왜 이 규칙이고, 얼마나 위험하고, 과거 시장에 넣으면 어땠는지를 보여 달라 · 매번 바꿀 수 있으면 안 된다").
// 한 줄 배치: 지금 규칙 → 왜 이 규칙인가 → 얼마나 위험한가 → 과거 시장에 넣어 보면 → 규칙을 지켰나 → (접힘) 규칙 바꾸기 · 종목별 목표 비중 · 검증 자료 원표.
// 계좌마다 규칙은 한 벌이다. 모의계좌 화면은 모의계좌의 규칙(PC 장부, 저장한 적 없으면 기본 규칙)을 읽기 전용으로, 예시·실계좌 화면은 이 브라우저에 저장한 규칙을 보인다.
// 화면의 과거 숫자는 전부 data/core-validation.json · data/strategy-evidence.json · data/paper-rehearsal.json 에서 읽는다(문구에 숫자를 박지 않는다).
let evidence = null, strat = null, rehearsal = null, sizing = null;
const RL = { pf: 'demo', pick: null, pc: null };
const acct = () => (S.snap?.paper ? 'paper' : S.snap?.demo ? 'demo' : S.snap ? 'real' : 'none');
const kday = t => new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const guard = (name, fn) => { try { return fn(); } catch (e) { console.warn('[규칙 화면]', name, e); return null; } };
const sg = v => (v > 0 ? '+' : '') + v;
fetch('/data/strategy-evidence.json?v=E1').then(r => r.ok ? r.json() : null).then(d => { strat = d; renderRules(); }).catch(() => {});
fetch('/data/sizing-study.json?v=RB1').then(r => r.ok ? r.json() : null).then(d => { sizing = d; renderRules(); }).catch(() => {});
fetch('/data/core-validation.json?v=' + RULES_VERSION).then(r => r.ok ? r.json() : null).then(d => { evidence = d; renderRules(); }).catch(() => {});
fetch('/data/paper-rehearsal.json').then(r => r.ok ? r.json() : null).then(d => { rehearsal = d; renderRules(); }).catch(() => {});

const PF_NAMES = { demo: '예시 6종목', kr: '국내 대형주 5', us: '미국 기술주 5', etf: '지수·채권 ETF 4' };
const RULE_DOES = { dailyLoss: '넘을 것 같으면 모든 종목을 같은 비율로 줄임', maxSingle: '넘는 만큼만 줄임', minCash: '급락 때 팔지 않고 버틸 돈', trendUS: '미국 종목이 200일 평균 아래면 비중 0', letWinnersRun: '올랐다고 계획 비중으로 되팔지 않음', noLeverage: '레버리지·인버스 상품은 정리', maxTrades30: '넘으면 주문 점검에서 막음', perAssetVol: '종목마다 변동성으로 비중을 줄임', volTarget: '종목별 변동성 목표' };
const ADV = new Set(['perAssetVol', 'volTarget']);
const ruleValue = (d, v) => (d.type === 'bool' ? (v ? '켬' : '끔') : `${v}${d.unit || ''}`);

const rulesPage = addView('rules', '규칙', `<div class="page-head"><div><h1>규칙 ${tip('한 번 정해 두면 오늘 점검과 주문 점검이 이 기준으로 계산합니다. 규칙은 예측이 아니라 손실을 줄이기 위한 한도이고, 매수·매도 지시가 아닙니다. 예시 자산·내 계좌의 규칙은 이 브라우저(프로필별)에만 저장되고, 모의계좌의 규칙은 운영 PC의 장부에 있습니다.')}</h1><p id="rl-sub">정해 둔 규칙과 그 근거</p></div></div>
<div class="rl">
  <article class="cr-card" id="rl-now"><div class="shimmer ct-skel"></div></article>
  <div class="rl-two">
    <article class="cr-card" id="rl-why"><header><h3>왜 이 규칙인가 ${tip('규칙마다 두는 이유와, 같은 엔진을 과거 자료에 돌려 잰 숫자입니다. "정한 값"은 비교 자료 없이 정한 것입니다. 과거 숫자는 지금 남아 있는 대형주로 만든 묶음이라 실제보다 좋게 나오는 쪽으로 치우쳐 있습니다.')}</h3></header><div id="rl-why-body"><div class="shimmer ct-skel"></div></div></article>
    <article class="cr-card" id="rl-risk"><header><h3>얼마나 위험한가 ${tip('"나쁜 날 하루"는 20거래일에 하루쯤은 이보다 더 잃을 수 있는 수준입니다(하루 95% 손실 범위 · 최근 500거래일의 움직임을 지금 변동성에 맞춰 계산). 모형 추정이라 급락장에서는 더 클 수 있습니다. 과거 기록은 아래에서 고른 묶음에 같은 규칙을 2012년부터 날마다 적용한 결과입니다.')}</h3></header><div id="rl-risk-body"><div class="shimmer ct-skel"></div></div></article>
  </div>
  <article class="cr-card" id="rl-past"><header><h3>과거 시장에 넣어 보면 ${tip('같은 엔진(오늘 점검과 같은 계산)을 2012-01-02부터 날마다 돌린 결과입니다. 1억 원, 종목마다 같은 비중, 남는 돈은 이자 0의 현금, 비용 0.2%. 기본 규칙은 2012~2019년 자료로 고르고 2020년 이후로 확인했습니다. 내 종목이 아니라 정해 둔 묶음 4개이고, 지금 남아 있는 종목이라 수익률이 부풀려져 있습니다. 과거 결과가 앞으로를 보장하지 않습니다.')}</h3><div class="rl-seg" id="rl-pf" role="group" aria-label="묶음">${Object.entries(PF_NAMES).map(([k, l]) => `<button type="button" data-pf="${k}">${l}</button>`).join('')}</div></header>
    <div id="rl-past-body"><div class="shimmer ct-skel"></div></div>
    <details class="rl-in" id="rl-recent"><summary>내 계좌 최근 1·3·6개월 ${tip('같은 기간을 세 가지로 비교합니다. 내가 실제로 한 것(체결 기록으로 날마다 보유를 되돌림), 기간 첫날 보유를 그냥 들고 있었을 때, 오늘 점검을 주 1회 따랐을 때. 주식 부분만 비교하고 현금 이자는 넣지 않습니다. "규칙대로"의 계획은 기간 첫날의 비중입니다.')}</summary><div id="rl-recent-body"></div></details>
  </article>
  <article class="cr-card" id="cr-review"><header><h3>규칙을 지켰나 ${tip('모의계좌의 날마다 기록(총자산·현금·주문·막힌 이유)으로 규칙이 실제로 어떻게 지켜졌는지 잽니다. 측정이지 예측이 아니고, 20거래일은 지나야 의미가 있습니다. "시스템 점검"은 주문이 정확히 처리됐는지이고 규칙 준수와는 다릅니다.')}</h3><button type="button" class="text-button" id="cr-review-go">다시 불러오기</button></header><div id="cr-review-body"><p class="cr-muted">불러오는 중…</p></div></article>
  <details class="cr-card rl-fold" id="rl-change"><summary><b>규칙 바꾸기</b><small id="rl-change-state"></small></summary>
    <div id="rl-levels" class="rl-levels"></div>
    <div id="rl-custom" hidden><form id="cr-form" class="cr-rules"></form><details class="cr-adv"><summary>추가 규칙</summary><div id="cr-adv"></div></details></div>
    <p class="cr-err" id="cr-err" role="alert"></p>
    <div class="cr-actions"><button type="button" class="primary" id="rl-review-change">변경 내용 확인</button><span class="cr-muted" id="cr-saved"></span></div>
    <div id="rl-confirm" hidden></div>
    <div id="rl-pc" hidden></div>
  </details>
  <details class="cr-card rl-fold" id="rl-plan"><summary><b>종목별 목표 비중</b><small id="rl-plan-state"></small></summary>
    <div id="cr-cash"></div>
    <div class="rl-planhead"><span class="cr-muted">종목마다 총자산(주식 + 현금)에서 차지할 목표 비중 ${tip('오늘 점검은 이 목표에 규칙(200일선·하루 손실 한도)을 적용한 값과 지금 보유를 비교합니다. 규칙 때문에 줄였다가도 조건이 풀리면 다시 이 목표까지 사도록 안내합니다. 목표 비중은 잠그지 않지만 고칠 때마다 기록에 남습니다.')}</span><button type="button" class="text-button" id="cr-fill">지금 비중으로 채우기</button></div>
    <div id="cr-plan"></div><p class="cr-err" id="rl-plan-err" role="alert"></p>
    <div class="cr-actions" id="rl-plan-actions"><button type="button" class="primary" id="rl-plan-save">목표 비중 저장</button><span class="cr-muted" id="rl-plan-saved"></span></div>
  </details>
  <details class="cr-card rl-fold" id="rl-raw"><summary><b>검증 자료 원표</b><small>위 숫자의 출처</small></summary>
    <h4 class="rl-h4">기본 규칙 검증 ${tip('같은 엔진을 2012년부터 날마다 돌린 결과 중 2020~2026(기본값을 고를 때 쓰지 않은 기간)입니다. 현금 이자는 0으로 둬 보수적으로 계산했습니다. 지금 남아 있는 종목으로 만든 묶음이라 생존 편향이 있습니다.')}</h4><div id="cr-evidence"><div class="shimmer ct-skel"></div></div>
    <h4 class="rl-h4">운용 방식 비교 ${tip('54개 대형주(한국 25 · 미국 29)에서 무작위로 6종목을 뽑은 포트폴리오 120개를, 1,000만 원으로 시작해 매달 50만 원씩 넣으며 2016년부터 운용한 결과입니다. 방식은 2016~2020년 자료로 고르고 표에는 2021년 이후만 보입니다. 지금 남아 있는 대형주라 생존 편향이 있습니다.')}</h4><div id="cr-strategy"><div class="shimmer ct-skel"></div></div>
  </details>
</div>`);

// 이 화면이 보는 규칙: 모의계좌는 모의계좌의 것(읽기 전용), 그 밖에는 브라우저에 저장한 것.
function ruleCtx() {
  const kind = acct();
  if (kind === 'paper') { const m = S.mock, rules = normalizeRules(m?.prefs?.rules || {}).rules, hist = (m?.prefsHistory || []).filter(x => !(x.changed || []).includes('init'));
    return { kind, rules, readOnly: true, level: levelOf(rules), mock: m, changes: hist.length, since: m?.since || m?.marks?.[0]?.date || null, savedAt: m?.prefs?.savedAt || null }; }
  const saved = loadSaved(), rules = normalizeRules(saved?.rules || {}).rules, lockedUntil = saved?.confirmedAt ? Date.parse(saved.confirmedAt) + RULE_LOCK_DAYS * 864e5 : null;
  return { kind, rules, readOnly: false, level: levelOf(rules), saved, confirmedAt: saved?.confirmedAt || null, changes: (saved?.history || []).filter(h => h.kind === 'change').length, lockedUntil, locked: lockedUntil !== null && Date.now() < lockedUntil };
}
const variantOf = level => RULE_LEVELS.find(l => l.id === level)?.variant || null;
const pfData = () => evidence?.portfolios?.[RL.pf] || null;

function renderNow() {
  const box = $('#rl-now'); if (!box) return; const c = ruleCtx(), lv = RULE_LEVELS.find(l => l.id === c.level);
  $('#rl-sub').textContent = c.kind === 'paper' ? '모의계좌가 지키는 규칙 · 읽기 전용' : c.kind === 'real' ? '내 계좌에 적용하는 규칙' : c.kind === 'demo' ? '예시 자산에 적용하는 규칙' : '정해 둔 규칙과 그 근거';
  const status = c.kind === 'paper'
    ? `모의계좌 규칙 · ${c.savedAt ? `저장 ${esc(kday(c.savedAt))}` : '기본 규칙으로 운용 중'}${c.since ? ` · ${esc(c.since)}부터 변경 ${c.changes}회` : ''}`
    : c.confirmedAt ? `확정 ${esc(kday(c.confirmedAt))} · 변경 ${c.changes}회 · ${c.locked ? `${esc(kday(c.lockedUntil))}부터 변경 가능` : '지금 변경 가능'}` : '아직 확정 전 · 기본 규칙으로 점검 중';
  const rows = RULE_DEFS.filter(d => !ADV.has(d.id) || (d.id === 'perAssetVol' && c.rules.perAssetVol) || (d.id === 'volTarget' && c.rules.perAssetVol)).map(d => `<tr><td>${esc(d.label)} ${tip(d.help)}</td><td><b>${esc(ruleValue(d, c.rules[d.id]))}</b></td><td>${esc(RULE_DOES[d.id] || '')}</td></tr>`).join('');
  const caps = c.kind === 'paper' ? c.mock?.planDoc?.caps : null;
  const capRow = caps ? `<tr><td>종목 계획 한도 ${tip('모의계좌가 종목을 고를 때 쓰는 계획(판단 기준)의 한도입니다. 살 때는 이 한도까지만 사고, 산 뒤 올라서 커지는 것은 위의 한 종목 최대 비중까지 둡니다.')}</td><td><b>종목 ${caps.single}% · 섹터 ${caps.sector}%</b></td><td>개별 종목 합 ${caps.satellite}%까지 · 현금 ${caps.cashMin}% 이상</td></tr>` : '';
  const buttons = c.kind === 'paper'
    ? `<button type="button" class="secondary" data-demo-start>예시 자산으로 직접 정해 보기</button><button type="button" class="text-button" data-core-go="paper">모의계좌 기록 보기</button>`
    : c.kind === 'none' ? '' : c.confirmedAt
      ? `<button type="button" class="secondary" id="rl-open-change" ${c.locked ? 'disabled' : ''}>${c.locked ? `${esc(kday(c.lockedUntil))}부터 바꿀 수 있음` : '규칙 바꾸기'}</button>`
      : `<button type="button" class="primary" id="rl-confirm-now">이 규칙으로 확정</button><button type="button" class="secondary" id="rl-open-change">조정해서 확정</button>`;
  box.innerHTML = `<header><h3>지금 규칙 ${tip(c.readOnly ? '팀 공용 모의계좌가 실제로 쓰는 규칙입니다. 운영 PC에서만 바꿀 수 있고, 바꾸면 이유와 함께 공개 기록에 남습니다.' : `확정하면 ${RULE_LOCK_DAYS}일 동안 바꿀 수 없고, 그 뒤에 바꿀 때는 이유를 적어야 합니다. 바꾼 뒤 20거래일이 지나기 전의 성과는 새 규칙의 평가가 아니기 때문입니다. 이 브라우저의 저장소를 지우면 풀리는 자기 약속 장치입니다.`)}</h3><span class="rl-badge ${lv ? 'ok' : 'warn'}">${lv ? `${esc(lv.label)} 수준 · 과거 검증 있음` : '직접 조정 · 과거 검증 없음'}</span></header>
    <p class="rl-lead">하루 손실이 총자산의 <b>${c.rules.dailyLoss}%</b>를 넘을 것 같으면 주식을 줄입니다.</p>
    <p class="rl-status">${status}</p>
    <div class="table-wrap"><table class="cr-table rl-rules"><thead><tr><th>규칙</th><th>값</th><th>하는 일</th></tr></thead><tbody>${rows}${capRow}</tbody></table></div>
    ${buttons ? `<div class="cr-actions">${buttons}</div>` : ''}`;
}

function renderWhy() {
  const box = $('#rl-why-body'); if (!box) return; if (!evidence || !strat) return; const c = ruleCtx();
  const V = variantOf(c.level) || 'C', demo = evidence.portfolios.demo, us = evidence.portfolios.us, P = strat.playbook.policies, br = demo.variants[V].dailyLossBreach, lossOf = evidence.variants.find(v => v.id === V)?.rules?.dailyLoss;
  const row = (name, why, num) => `<tr><td><b>${esc(name)}</b></td><td>${esc(why)}</td><td>${num}</td></tr>`;
  const fixed = '<span class="cr-muted">정한 값 · 과거 비교 없음</span>';
  const rows = [
    row(`하루 손실 한도 ${c.rules.dailyLoss}%`, '흔들림이 커지면 다음 날 비중을 줄입니다', variantOf(c.level) ? `하루 ${lossOf}% 넘게 잃은 날: 그냥 보유 ${br.hold}% → 규칙대로 <b>${br.rule}%</b>` : `기본 규칙(2.5%) 기준: 그냥 보유 ${br.hold}% → 규칙대로 <b>${br.rule}%</b>`),
    row(`한 종목 최대 ${c.rules.maxSingle}%`, '한 종목이 무너져도 계좌가 버팁니다', `가장 크게 빠졌을 때 ${P.P1.check.mddMed}% → <b>${P.P2.check.mddMed}%</b> (25% 기준)`),
    row(`주 1회 점검 · 30일 ${c.rules.maxTrades30}회`, '자주 맞추면 매매만 늘어납니다', `같은 규칙을 매일 맞추면 매매 연 ${demo.variants.B.trading.tradesPerYear}회 → <b>${demo.variants.E.trading.tradesPerYear}회</b>`),
    row(`미국 종목 200일선 ${c.rules.trendUS ? '켬' : '끔'}`, '긴 하락에서 미국 종목을 비웁니다', `미국 기술주 5종목: 켜면 ${us.variants.B.all.mdd}%, 끄면 <b>${us.variants.D.all.mdd}%</b>`),
    row(`현금 최소 ${c.rules.minCash}%`, '급락 때 팔지 않고 버틸 돈입니다', fixed),
    row('레버리지·인버스 금지', '하루 움직임이 2~3배라 위 한도가 무의미해집니다', fixed),
  ].join('');
  const ic = (m) => strat.factors[m].composite.check.ic, mac = strat.macro, dip = strat.events.dip20, run = strat.events.run30?.checkHealthy;
  box.innerHTML = `<p class="rl-lead">큰 손실을 줄이려는 규칙입니다. 수익을 늘리는 규칙이 아닙니다.</p>
    <div class="table-wrap"><table class="cr-table rl-why"><thead><tr><th>규칙</th><th>이유</th><th>과거 숫자</th></tr></thead><tbody>${rows}</tbody></table></div>
    <details class="rl-in"><summary>쓰지 않기로 한 방법</summary><ul class="cr-facts">
      <li><b>주가 예측:</b> 재무·주가 지표 묶음의 다음 달 예측력 한국 ${ic('KR')}, 미국 ${ic('US')} (0이면 예측력 없음).</li>
      <li><b>지수 방향 예측:</b> 다음 달 방향을 맞힌 비율 코스피 ${mac.KOSPI.directionHit}% (늘 "오른다"고 하면 ${mac.KOSPI.upShare}%), S&amp;P 500 ${mac.SP500.directionHit}% (${mac.SP500.upShare}%).</li>
      <li><b>떨어지면 더 사기:</b> 넣어도 가장 크게 빠졌을 때 ${P.P2.check.mddMed}% → ${P.P3.check.mddMed}%, 연 수익 ${P.P2.check.cagrMed}% → ${P.P3.check.cagrMed}%. 고점 대비 −20% 뒤에도 평균 ${dip.healthy.furtherDrop}% 더 빠졌습니다.</li>
      ${run ? `<li><b>오르면 팔기:</b> 60거래일에 +30% 오른 뒤 120일 동안 지수 대비 ${sg(run.ex120)}%p, 지수를 이긴 비율 ${run.hit120}%. 뚜렷한 되돌림이 없어 상한을 넘는 만큼만 줄입니다.</li>` : ''}
    </ul></details>`;
}

// 계획의 위험 분해(결정 35): 개별 종목 묶음이 계좌 위험에서 차지하는 몫, 지수와 다르게 움직이는 정도(추적오차)가 어느 종목에서 나오는지, 위험을 같게 나누면 비중이 어떻게 되는지.
// 계산 결과 파일(scripts/research/sizing-study.mjs)을 읽기만 한다 — 계획은 바꾸지 않는다. 모의계좌이고 파일의 계획 버전이 지금 계획과 같을 때만 보인다. 수익 비교는 없다.
function sizingHtml() {
  if (acct() !== 'paper' || !sizing?.snapshot?.equal || !sizing.snapshot.erc || sizing.planVersion !== S.mock?.planDoc?.version) return '';
  const eq = sizing.snapshot.equal, er = sizing.snapshot.erc, nm = sizing.snapshot.names || {}, wk = sizing.walk || {}, syms = Object.keys(eq.weightsPct).sort((a, b) => eq.activeSharePct[b] - eq.activeSharePct[a]);
  const top = syms.slice(0, 3), topSum = top.reduce((a, s) => a + eq.activeSharePct[s], 0), short = s => String(nm[s]?.name || s).replace(/\s*\(.*\)$/, ''), satW = Object.values(eq.weightsPct).reduce((a, b) => a + b, 0);
  const rows = syms.map(s => `<tr><td>${esc(short(s))}</td><td>${eq.weightsPct[s].toFixed(1)}%</td><td><b>${eq.activeSharePct[s].toFixed(0)}%</b></td><td>${er.weightsPct[s].toFixed(1)}%</td></tr>`).join('');
  return `<div class="rl-sizing"><h4 class="rl-h4">계획의 위험은 어디서 나오나 ${tip('최근 3년 주간 수익률(원화)로 계산했습니다. "지수와 다르게 움직이는 정도"는 같은 국가 비중의 지수만 들었을 때와의 차이가 한 해에 흔들리는 폭입니다(추적오차). 종목별 몫은 그 흔들림에 각 종목이 보탠 비율입니다. 수익을 예측한 값이 아닙니다.')}</h4>
    <p>개별 ${syms.length}종목은 비중 ${satW.toFixed(0)}%인데 계좌 위험의 <b>${eq.satRiskOfTotalPct.toFixed(0)}%</b>를 냅니다. 지수와 다르게 움직이는 정도는 연 ${eq.tePct.toFixed(1)}%이고, 그 <b>${topSum.toFixed(0)}%</b>가 ${top.map(s => esc(short(s))).join(' · ')}에서 나옵니다.</p>
    <details class="rl-in"><summary>종목별 위험 몫 · 위험을 같게 나누면</summary>
      <div class="table-wrap"><table class="cr-table rl-size"><thead><tr><th>종목</th><th>계획 비중</th><th>위험 몫</th><th>같게 나누면</th></tr></thead><tbody>${rows}</tbody></table></div>
      <ul class="cr-facts"><li>위험을 같게 나누면 지수와 다르게 움직이는 정도가 연 ${eq.tePct.toFixed(2)}% → <b>${er.tePct.toFixed(2)}%</b>, 가장 큰 종목의 몫이 ${eq.maxActiveSharePct.toFixed(0)}% → ${er.maxActiveSharePct.toFixed(0)}%입니다. 계좌 전체 변동성은 ${eq.volPct.toFixed(1)}% → ${er.volPct.toFixed(1)}%로 거의 같습니다.</li>
      ${wk.equal && wk.erc ? `<li>${esc(wk.equal.from.slice(0, 4))}~${esc(wk.equal.to.slice(0, 4))}년에 4주마다 다시 계산해 본 실제 값: ${wk.equal.tePct.toFixed(2)}% → <b>${wk.erc.tePct.toFixed(2)}%</b>. 예측은 실제의 ${(1 / wk.equal.teRealizedOverForecast).toFixed(2)}배로 조금 높게 나왔습니다.</li>` : ''}
      ${wk.equal && wk.equalBand25 ? `<li>4주마다 다 맞추면 ${wk.equal.rebalances}번 · 한 해 매매 ${wk.equal.turnoverPerYearPct.toFixed(0)}%, 25% 넘게 벗어날 때만 맞추면 ${wk.equalBand25.rebalances}번 · ${wk.equalBand25.turnoverPerYearPct.toFixed(0)}%이고 흔들림은 같습니다(${wk.equalBand25.tePct.toFixed(2)}%).</li>` : ''}
      <li>수익은 비교하지 않았습니다. 종목을 2026년에 골랐기 때문에 과거 수익을 보면 답을 알고 본 결과가 됩니다. 계획은 그대로 균등입니다.</li></ul>
    </details></div>`;
}
function renderRisk() {
  const box = $('#rl-risk-body'); if (!box) return; const c = ruleCtx(), pf = pfData(), V = variantOf(c.level) || 'C';
  let live = '<p class="cr-muted">보유 자료를 불러오면 지금 위험을 계산합니다.</p>', tiles = '';
  if (S.positions.length && Object.keys(S.risk).length) { const e = guard('evaluate', () => evaluate(state()));
    if (e?.varNow?.ok && e.total > 0) { const now = e.varNow.var95 / e.total * 100, over = now > c.rules.dailyLoss * 1.001, after = e.varTarget?.ok ? e.varTarget.var95 : null;
      live = `<p class="rl-lead">지금 보유는 나쁜 날 하루 <b>−${won(e.varNow.var95)}</b>(총자산의 ${now.toFixed(2)}%)입니다. ${over ? `한도 ${c.rules.dailyLoss}%를 넘어 <b class="rl-bad">줄일 차례</b>입니다.` : `한도 ${c.rules.dailyLoss}% 안입니다.`}</p>`;
      tiles = `<div><span>나쁜 날 하루 · 지금 보유</span><b>−${won(e.varNow.var95)}</b><small>총자산의 ${now.toFixed(2)}%</small></div><div><span>계획과 규칙대로 맞춘 뒤</span><b>${after === null ? '—' : '−' + won(after)}</b><small>${after === null ? '' : `총자산의 ${(after / e.total * 100).toFixed(2)}% · 한도 ${c.rules.dailyLoss}%`}</small></div>`; } }
  if (pf) { const r = pf.variants[V], h = pf.hold;
    tiles += `<div><span>과거 가장 크게 빠졌을 때</span><b>${r.all.mdd}%</b><small>그냥 보유 ${h.all.mdd}%</small></div><div><span>과거 가장 나빴던 1년</span><b>${r.all.worst12}%</b><small>그냥 보유 ${h.all.worst12}%</small></div>`; }
  const br = pf ? pf.variants[V].dailyLossBreach : null, lossOf = evidence?.variants?.find(v => v.id === V)?.rules?.dailyLoss;
  box.innerHTML = `${live}<div class="rl-tiles">${tiles}</div>
    ${pf ? `<p class="rl-note">과거 기록: ${esc(PF_NAMES[RL.pf])} · ${variantOf(c.level) ? '지금 규칙' : '기본 규칙(지금 규칙은 직접 조정이라 과거 결과 없음)'} · ${esc(evidence.from.slice(0, 4))}~${esc(pf.to.slice(0, 4))}${br ? ` · 하루 ${lossOf}% 넘게 잃은 날 ${br.hold}% → ${br.rule}%` : ''}</p>` : ''}
    <p class="rl-note">한도는 그날의 손실을 막지 못합니다. 다음 날 비중을 줄입니다.</p>${guard('sizing', sizingHtml) || ''}`;
}

function renderPast() {
  const box = $('#rl-past-body'); if (!box) return; document.querySelectorAll('#rl-pf [data-pf]').forEach(b => b.classList.toggle('on', b.dataset.pf === RL.pf));
  const pf = pfData(); if (!pf) return; const c = ruleCtx(), V = variantOf(c.level) || 'C', r = pf.variants[V], h = pf.hold, names = Object.keys(h.all.crisis || {});
  const better = names.filter(n => r.all.crisis?.[n] && r.all.crisis[n].ret > h.all.crisis[n].ret).length;
  const s = rehearsal?.summary, head = s && V === 'C' ? `<p class="rl-lead">기간 ${rehearsal.windows.length}개 × 묶음 ${Object.keys(rehearsal.portfolios).length}개, ${s.cells}번 넣어 보니 <b>${Math.round(s.shareSmallerMddThanHold * s.cells)}번</b>은 그냥 둔 것보다 덜 빠졌고, 수익이 더 높았던 것은 <b>${Math.round(s.shareBetterRetThanHold * s.cells)}번</b>입니다. ${tip(`기간: ${rehearsal.windows.map(w => w.label).join(' · ')}. 기본 규칙 기준이고, 수익 차이의 중앙값은 ${s.medianRetDiffVsHoldPct.toFixed(1)}%p, 가장 크게 빠졌을 때 차이의 중앙값은 ${s.medianMddDiffVsHoldPct.toFixed(1)}%p입니다.`)}</p>` : '';
  const dates = { '코로나 급락': '2020-02~03', '2022 하락장': '2022-01~10', '2026 하반기': '2026-06~' };
  box.innerHTML = `${head}
    ${variantOf(c.level) ? '' : '<p class="cr-note">아래 표는 기본 규칙의 결과입니다. 지금 규칙은 직접 조정한 값이라 과거 결과가 없습니다.</p>'}
    <div class="rl-pastgrid"><div>
      <p class="rl-cap">하락장 ${names.length}번 중 <b>${better}번</b> 덜 잃음 · ${esc(PF_NAMES[RL.pf])}</p>
      <div class="table-wrap"><table class="cr-table rl-crisis"><thead><tr><th>구간</th><th>그냥 보유</th><th>규칙대로</th></tr></thead><tbody>${names.map(n => `<tr><td>${esc(n)} <small class="cr-muted">${esc(dates[n] || '')}</small></td><td>${h.all.crisis[n].ret}%<small class="cr-muted"> 낙폭 ${h.all.crisis[n].mdd}%</small></td><td><b>${r.all.crisis?.[n]?.ret ?? '—'}%</b><small class="cr-muted"> 낙폭 ${r.all.crisis?.[n]?.mdd ?? '—'}%</small></td></tr>`).join('')}</tbody></table></div>
    </div><div>
      <p class="rl-cap">${esc(evidence.from.slice(0, 4))}~${esc(pf.to.slice(0, 4))} 통째로</p>
      <div class="rl-tiles two"><div><span>가장 크게 빠졌을 때</span><b>${r.all.mdd}%</b><small>그냥 보유 ${h.all.mdd}%</small></div><div><span>연 수익</span><b>${r.all.cagr}%</b><small>그냥 보유 ${h.all.cagr}%</small></div><div><span>매매</span><b>연 ${r.trading.tradesPerYear}회</b><small>30일 상한을 넘은 기간 ${r.trading.over30DayLimitShare}%</small></div></div>
      <p class="rl-note">수익은 그냥 보유보다 낮았습니다. 덜 잃는 대신 덜 법니다.</p>
    </div></div>`;
}

// ── 규칙을 지켰나: 모의계좌의 기록(PC 가 연결돼 있으면 실시간, 아니면 공개 파일)을 그 계좌 자신의 규칙으로 잰다.
async function mockStatus() { try { const s = await privateRead('paper-live-status'); return { ...s, live: true }; } catch { } try { const r = await fetch('/data/paper-live-public.json', { cache: 'no-store' }); if (r.ok) return { ...(await r.json()), live: false }; } catch { } return null; }
let reviewRun = 0;
async function renderReview() {
  const box = $('#cr-review-body'); if (!box) return; const id = ++reviewRun, kind = acct();
  const st = await mockStatus(); if (id !== reviewRun) return; RL.pc = st?.live ? st : null; guard('pc', renderPcBlock);
  const own = kind === 'demo' || kind === 'real' ? guard('own', () => { const e = S.positions.length && Object.keys(S.risk).length ? evaluate(state()) : null, c = ruleCtx(); return `<p class="rl-lead">${e ? `오늘 규칙 ${e.known}개 중 <b>${e.okCount}개</b> 지킴` : '오늘 점검은 보유 자료를 불러온 뒤 계산합니다'} · 규칙 변경 ${c.changes}회</p><p class="rl-note">${kind === 'demo' ? '예시 자산' : '내 계좌'}은 날마다 기록이 없어 오늘 시점만 보입니다. 아래는 같은 방식으로 자동 운용 중인 모의계좌의 기록입니다.</p>`; }) || '' : '';
  if (!st) { box.innerHTML = `${own}<p class="cr-muted">모의계좌 기록을 받지 못했습니다.</p>`; return; }
  const rules = normalizeRules(st.prefs?.rules || {}).rules; let indexPct = null;
  if (Number.isFinite(st.benchmark?.benchRetPct)) indexPct = st.benchmark.benchRetPct / 100;
  else { try { const m0 = st.marks?.[0]; if (m0) { const d = await fetchCandles('069500', 'KRW', '1y'); const cs = (d.candles || []).filter(x => x.close > 0), base = cs.find(x => x.date >= m0.date); indexPct = base ? cs.at(-1).close / base.close - 1 : null; } } catch { } }
  if (id !== reviewRun) return;
  const r = reviewRules(st, rules, { indexPct }), hist = (st.prefsHistory || []).filter(x => !(x.changed || []).includes('init'));
  box.innerHTML = `${own}<p class="${own ? 'rl-cap' : 'rl-lead'}">${own ? '모의계좌 · ' : ''}운용 <b>${r.days}일</b> · 하루 한도(${rules.dailyLoss}%) 넘은 날 <b>${r.dailyBreaches}일</b> / ${Math.max(0, r.days - 1)}일 · 매매 결정 <b>${r.trades30}회</b> (상한 ${rules.maxTrades30}회) · 규칙 변경 <b>${hist.length}회</b> <small class="cr-muted">${st.live ? 'PC 실시간' : '공개 기록'}</small></p>
    <ul class="cr-find">${r.findings.map(f => `<li><span class="ct-chip ${f.tone > 0 ? 'ok' : f.tone < 0 ? 'bad' : 'na'}">${f.tone > 0 ? '좋음' : f.tone < 0 ? '주의' : '참고'}</span><div><b>${esc(f.key === 'blocked' ? f.text.replace(/\(\d+(?= \d+건)/g, '') : f.text)}</b>${f.suggest ? `<small>${esc(f.suggest)}</small>` : ''}</div></li>`).join('')}</ul>
    ${hist.length ? `<details class="rl-in"><summary>규칙을 바꾼 기록 ${hist.length}건</summary><ul class="cr-facts">${hist.slice().reverse().map(x => `<li>${esc(kday(x.at))} · ${esc((x.changed || []).join(', '))} · 이유: ${esc(x.reason || '(없음)')}</li>`).join('')}</ul></details>` : ''}
    <div class="cr-actions"><button type="button" class="text-button" data-core-go="paper">모의투자 화면에서 자세히</button></div>`;
}
$('#cr-review-go').onclick = () => void renderReview();

// ── 규칙 바꾸기(예시·실계좌): 수준을 고르거나 숫자를 직접 넣고 → 변경 내용 확인 → 확정. 확정 뒤 28일은 잠긴다(lib/rule-presets.js changeGate).
function ruleInput(d, v) {
  if (d.type === 'bool') return `<label class="cr-rule bool"><span>${esc(d.label)}${tip(d.help)}</span><input type="checkbox" name="${d.id}" ${v ? 'checked' : ''}></label>`;
  return `<label class="cr-rule"><span>${esc(d.label)}${tip(d.help)}</span><span class="cr-in"><input type="number" name="${d.id}" value="${v}" min="${d.min}" max="${d.max}" step="${d.step}" inputmode="decimal"><em>${esc(d.unit)}</em></span></label>`;
}
function renderChange({ keepForm = false } = {}) {
  const fold = $('#rl-change'); if (!fold) return; const c = ruleCtx();
  fold.hidden = c.readOnly && !RL.pc; if (c.kind === 'none') fold.hidden = true;
  $('#rl-change-state').textContent = c.readOnly ? '모의계좌 규칙은 운영 PC에서만' : c.locked ? `${kday(c.lockedUntil)}부터 가능` : c.confirmedAt ? '지금 변경 가능 · 이유 필요' : '아직 확정 전';
  if (RL.pick === null) RL.pick = c.level;
  const pf = pfData(), card = (id, title, sub, num) => `<label class="rl-level ${RL.pick === id ? 'on' : ''}"><input type="radio" name="rl-level" value="${id}" ${RL.pick === id ? 'checked' : ''}><b>${esc(title)}</b><span>${esc(sub)}</span><small>${num}</small></label>`;
  $('#rl-levels').innerHTML = RULE_LEVELS.map(l => { const v = pf?.variants?.[l.variant]; return card(l.id, l.label, l.note, v ? `가장 크게 빠졌을 때 ${v.all.mdd}% · 연 수익 ${v.all.cagr}% · 매매 연 ${v.trading.tradesPerYear}회 · 30일 상한을 넘은 기간 ${v.trading.over30DayLimitShare}%` : '과거 자료를 불러오는 중'); }).join('') + card('custom', '직접 입력', '숫자를 하나씩 정함', '<span class="rl-badge warn">과거 검증 없음</span>');
  $('#rl-custom').hidden = RL.pick !== 'custom';
  if (!keepForm) { $('#cr-form').innerHTML = RULE_DEFS.filter(d => !ADV.has(d.id)).map(d => ruleInput(d, c.rules[d.id])).join(''); $('#cr-adv').innerHTML = RULE_DEFS.filter(d => ADV.has(d.id)).map(d => ruleInput(d, c.rules[d.id])).join(''); }
  $('#rl-review-change').hidden = c.readOnly;
}
function candidateRules() {
  if (RL.pick !== 'custom') return { rules: levelRules(RL.pick), errors: [] };
  const raw = {}; for (const d of RULE_DEFS) { const el = rulesPage.querySelector(`#rl-custom [name="${d.id}"]`); if (el) raw[d.id] = d.type === 'bool' ? el.checked : el.value; }
  return normalizeRules(raw);
}
function showConfirm() {
  const box = $('#rl-confirm'), c = ruleCtx(), { rules: cand, errors } = candidateRules(); $('#cr-err').textContent = errors.join(' '); if (errors.length || !cand) { box.hidden = true; return; }
  const g = changeGate(c.saved, cand, { reason: '확인 단계에서는 이유를 보지 않음' }), defs = Object.fromEntries(RULE_DEFS.map(d => [d.id, d]));
  const diff = g.changed.length ? g.changed.map(k => `${esc(defs[k].label)} ${esc(ruleValue(defs[k], c.rules[k]))} → <b>${esc(ruleValue(defs[k], cand[k]))}</b>`).join(' · ') : '바뀌는 값 없음';
  let today = '보유 자료를 불러온 뒤 계산합니다', risk = '';
  if (S.positions.length && Object.keys(S.risk).length) { const e0 = guard('e0', () => evaluate(state())), e1 = guard('e1', () => evaluate({ ...state(), rules: cand }));
    if (e0 && e1) { today = `지킴 ${e0.okCount}/${e0.known} → <b>${e1.okCount}/${e1.known}</b> · 할 일 ${e0.actions.length}건 → <b>${e1.actions.length}건</b>`; if (e1.varNow?.ok && e1.total > 0) risk = `<tr><td>나쁜 날 하루</td><td>총자산의 ${(e1.varNow.var95 / e1.total * 100).toFixed(2)}% · 새 한도 ${cand.dailyLoss}%</td></tr>`; } }
  const lv = levelOf(cand), until = kday(Date.now() + RULE_LOCK_DAYS * 864e5), blocked = !g.ok && (g.code === 'locked' || g.code === 'same');
  box.hidden = false;
  box.innerHTML = `<div class="rl-confirm"><h4>변경 내용 확인</h4><table class="cr-table"><tbody>
      <tr><td>바뀌는 값</td><td>${diff}</td></tr><tr><td>오늘 점검</td><td>${today}</td></tr>${risk}
      <tr><td>과거 검증</td><td>${lv === 'custom' ? '없음 · 직접 조정한 값' : `있음 · ${esc(RULE_LEVELS.find(l => l.id === lv).label)} 수준`}</td></tr>
      <tr><td>잠금</td><td>확정하면 <b>${esc(until)}</b>까지 바꿀 수 없습니다</td></tr></tbody></table>
    ${blocked ? `<p class="cr-err">${esc(g.why)}</p>` : `${g.first ? '' : `<label class="ck-field"><span>바꾸는 이유 (10자 이상 · 기록에 남음)</span><input id="rl-reason" maxlength="300" placeholder="예: 11월 기록에서 하루 한도를 넘은 날이 3일이라 한 단계 낮춤"></label>`}
      <div class="cr-actions"><button type="button" class="primary" id="rl-commit">확정</button><button type="button" class="text-button" id="rl-cancel">취소</button><span class="cr-err" id="rl-commit-err"></span></div>`}</div>`;
}
function commitChange() {
  const c = ruleCtx(), { rules: cand } = candidateRules(), reason = $('#rl-reason')?.value || '', res = applyChange(c.saved, cand, { reason });
  if (!res.ok) { $('#rl-commit-err').textContent = res.why; return; }
  if (!save({ ...res.value, plan: c.saved?.plan || null })) { $('#rl-commit-err').textContent = '이 브라우저에 저장하지 못했습니다(저장 공간 차단).'; return; }
  RL.pick = null; $('#rl-confirm').hidden = true; $('#rl-change').open = false; renderRules(); renderToday(); S.loading = loadAll(); $('#cr-saved').textContent = '확정했습니다';
}
// 운영 PC 에 연결돼 있을 때만: 모의계좌(팀 공용)의 규칙을 바꾼다. 서버가 28일 제한과 이유를 강제하고, 저장하면 다음 열린 장에 전체 재조정이 나간다.
let pcArmed = false;
function renderPcBlock() {
  const box = $('#rl-pc'); if (!box) return; const st = RL.pc; box.hidden = !st; if (!st) return; renderChange({ keepForm: true });
  const next = st.prefsNextChangeAt && Date.parse(st.prefsNextChangeAt) > Date.now() ? kday(st.prefsNextChangeAt) : null;
  box.innerHTML = `<div class="rl-confirm"><h4>모의계좌 규칙 (이 PC) ${tip('팀 공용 모의계좌가 자동 실행에 쓰는 규칙입니다. 저장하면 계획 버전이 바뀌어 다음 열린 장에 전체 재조정 주문이 나갑니다(오른 종목도 계획 비중으로 되돌림). 저장 뒤에는 서버가 정한 기간 동안 다시 바꿀 수 없고, 바꿀 때마다 이유가 공개 기록에 남습니다.')}</h4>
    <p class="rl-note">지금: ${st.prefs?.savedAt ? `저장 ${esc(kday(st.prefs.savedAt))}` : '저장한 적 없음 · 기본 규칙으로 운용'}${next ? ` · <b>${esc(next)}</b>부터 변경 가능` : ''} · 저장하면 다음 열린 장에 전체 재조정 주문이 나갑니다.</p>
    <div class="pp-form"><label class="ck-field"><span>바꾸는 이유</span><input id="cq-reason" maxlength="300" placeholder="예: 20거래일 기록에서 하루 한도 초과 0일 · 한도 유지 확인"></label><label class="ck-field"><span>기대하는 결과</span><input id="cq-expect" maxlength="300" placeholder="예: 한도 초과일 10% 아래"></label></div>
    <div class="cr-actions"><button type="button" class="secondary" id="cq-pc" ${next ? 'disabled' : ''}>위에서 고른 규칙을 모의계좌에 저장</button><span class="cr-muted" id="cq-pc-state"></span></div></div>`;
  pcArmed = false;
}
async function savePc() {
  const st = $('#cq-pc-state'), btn = $('#cq-pc'), { rules: cand, errors } = candidateRules(); if (errors.length || !cand) { st.textContent = errors.join(' ') || '규칙을 고르십시오.'; return; }
  if (!pcArmed) { pcArmed = true; btn.textContent = '한 번 더 누르면 저장 · 다음 장에 재조정'; return; }
  st.textContent = 'PC에 보내는 중…';
  try { const r = await privateRead('paper-live-prefs', { rules: cand, cadence: 'weekly', sectorCap: null, prefs: { level: levelOf(cand) }, reason: $('#cq-reason')?.value.trim() || '', expected: $('#cq-expect')?.value.trim() || '' }); st.textContent = `저장 ${String(r.savedAt).slice(0, 16).replace('T', ' ')}${r.changed?.length && !r.changed.includes('init') ? ' · 변경 ' + r.changed.join(', ') + ' (기록에 남음)' : ''}`; void renderReview(); }
  catch (e) { st.textContent = e?.status === 503 ? 'PC에 모의투자 키가 없습니다.' : (e?.message || 'PC 연결이 필요합니다(설정에서 연결).'); pcArmed = false; btn.textContent = '위에서 고른 규칙을 모의계좌에 저장'; }
}

// ── 종목별 목표 비중 · 현금
function renderPlan(plan, saved) {
  const c = ruleCtx(), box = $('#cr-plan'); if (!box) return;
  if (c.kind === 'paper') { const w = Object.entries(c.mock?.planDoc?.weights || {}).filter(([, v]) => v.pct > 0).sort((a, b) => b[1].pct - a[1].pct);
    $('#rl-plan-state').textContent = w.length ? `${w.length}종목 · 합계 ${w.reduce((a, [, v]) => a + v.pct, 0).toFixed(1)}% · 읽기 전용` : '';
    box.innerHTML = w.length ? `<div class="table-wrap"><table class="cr-table"><thead><tr><th>종목</th><th>목표</th><th>구분</th></tr></thead><tbody>${w.map(([k, v]) => `<tr><td><b>${esc(v.name || k)}</b> <small class="cr-muted">${esc(k)}</small></td><td>${v.pct}%${v.targetPct ? ` <small class="cr-muted">(끝까지 사면 ${v.targetPct}%)</small>` : ''}</td><td>${v.role === 'core' ? '지수' : v.role === 'satellite' ? '개별 종목' : esc(v.role || '')}</td></tr>`).join('')}</tbody></table></div><p class="rl-note">모의계좌의 계획(${esc(c.mock.planDoc.version || '')})입니다. 종목을 고른 기준은 모의투자 화면에 있습니다.</p>` : '<p class="cr-muted">모의계좌 계획을 받지 못했습니다.</p>';
    $('#cr-fill').hidden = true; $('#rl-plan-actions').hidden = true; return; }
  $('#cr-fill').hidden = false; $('#rl-plan-actions').hidden = false;
  const rows = [...new Set([...S.positions.map(p => p.symbol), ...Object.keys(plan)])];
  if (!rows.length) { box.innerHTML = '<p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 보유 종목이 나옵니다.</p>'; $('#rl-plan-state').textContent = ''; return; }
  const total = S.positions.reduce((a, p) => a + p.valueKrw, 0) + (Number.isFinite(S.cash) ? S.cash : 0);
  box.innerHTML = `${saved ? '' : '<p class="cr-note">저장한 목표가 없어 지금 비중으로 채워 두었습니다. 고친 뒤 저장하십시오.</p>'}
    <div class="table-wrap"><table class="cr-table"><thead><tr><th>종목</th><th>지금</th><th>목표</th><th></th></tr></thead><tbody>${rows.map(s => { const p = S.positions.find(x => x.symbol === s), v = plan[s], name = p?.name || v?.name || stockName(s), now = p && total ? p.valueKrw / total * 100 : 0;
      return `<tr data-sym="${esc(s)}" data-name="${esc(name)}" data-cur="${esc(p?.currency || v?.currency || 'KRW')}"><td><b>${esc(name)}</b>${isLeveraged({ symbol: s, name }) ? '<small class="bad">레버리지·인버스</small>' : ''}</td><td>${now.toFixed(1)}%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="${Number.isFinite(planPctOf(v)) ? planPctOf(v) : 0}" min="0" max="100" step="0.5" inputmode="decimal"><em>%</em></span></td><td>${p ? '' : '<button type="button" class="text-button cr-del">빼기</button>'}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>합계</td><td></td><td id="cr-plan-sum"></td><td></td></tr></tfoot></table></div>
    <form id="cr-add" class="cr-addrow"><input id="cr-add-sym" list="symbols" placeholder="종목 추가 (예: KODEX 200, SPY)" autocomplete="off"><button type="submit" class="secondary">추가</button></form>`;
  const sum = () => { const t = [...document.querySelectorAll('.cr-plan-in')].reduce((a, i) => a + (Number(i.value) || 0), 0); $('#cr-plan-sum').textContent = `${t.toFixed(1)}% · 현금 ${(100 - t).toFixed(1)}%`; $('#rl-plan-state').textContent = `${document.querySelectorAll('.cr-plan-in').length}종목 · 합계 ${t.toFixed(1)}% · 현금 ${(100 - t).toFixed(1)}%${saved ? '' : ' · 저장 전'}`; };
  document.querySelectorAll('.cr-plan-in').forEach(i => i.oninput = sum); sum();
  document.querySelectorAll('.cr-del').forEach(b => b.onclick = () => { b.closest('tr').remove(); sum(); });
  $('#cr-add').onsubmit = async ev => { ev.preventDefault(); const t = $('#cr-add-sym').value.trim(); if (!t) return; try { const sym = /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t) ? t.toUpperCase() : (await resolveStockInput(t)).split('.')[0]; const tr = document.createElement('tr'); const name = /^[A-Z]/.test(sym) ? sym : stockName(sym); tr.dataset.sym = sym; tr.dataset.name = name; tr.dataset.cur = /^[A-Z]/.test(sym) ? 'USD' : 'KRW'; tr.innerHTML = `<td><b>${esc(name)}</b></td><td>0.0%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="5" min="0" max="100" step="0.5"><em>%</em></span></td><td><button type="button" class="text-button cr-del">빼기</button></td>`; $('#cr-plan tbody').append(tr); tr.querySelector('.cr-plan-in').oninput = sum; tr.querySelector('.cr-del').onclick = () => { tr.remove(); sum(); }; $('#cr-add-sym').value = ''; sum(); } catch (e2) { $('#rl-plan-err').textContent = e2.message; } };
}
function readPlan(rules) {
  const plan = {}, errors = [];
  for (const tr of document.querySelectorAll('#cr-plan tbody tr')) { const v = Number(tr.querySelector('.cr-plan-in')?.value); if (v > 0) plan[tr.dataset.sym] = { pct: v, name: tr.dataset.name, currency: tr.dataset.cur }; if (v > rules.maxSingle) errors.push(`${tr.dataset.name} 목표 ${v}%가 한 종목 최대 비중 ${rules.maxSingle}%를 넘습니다.`); }
  const sum = Object.values(plan).reduce((a, v) => a + v.pct, 0); if (sum > 100 - rules.minCash + 0.05) errors.push(`목표 합계 ${sum.toFixed(1)}%가 (100 − 현금 최소 ${rules.minCash}%)를 넘습니다.`);
  return { plan, errors };
}
function savePlan() {
  const c = ruleCtx(); if (c.readOnly) return; const { plan, errors } = readPlan(c.rules); $('#rl-plan-err').textContent = errors.join(' '); if (errors.length) return;
  const prev = c.saved || { rules: c.rules }, entry = { at: new Date().toISOString(), kind: 'plan', changed: ['plan'], reason: '' };
  if (!save({ ...prev, rules: c.rules, plan, history: [...(prev.history || []), entry].slice(-20) })) { $('#rl-plan-err').textContent = '이 브라우저에 저장하지 못했습니다(저장 공간 차단).'; return; }
  renderRules(); S.loading = loadAll(); $('#rl-plan-saved').textContent = '저장했습니다';
}
function renderCash() {
  const box = $('#cr-cash'); if (!box) return; if (acct() === 'paper' || acct() === 'none') { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="rl-cash"><span>현금 ${tip('현금 최소 비중과 비중 계산에 씁니다. 계좌 API에서 예수금을 받지 못해 직접 기록합니다. PC 연결 상태면 PC에만 저장됩니다. 현금은 규칙이 아니라 사실이라 언제든 고칠 수 있습니다.')}</span>${Number.isFinite(S.cash) ? `<b>${won(S.cash)}</b><small class="cr-muted">${esc(S.cashSource)}</small>` : '<small class="cr-muted">기록 없음 · 현금 규칙을 확인할 수 없습니다</small>'}
    <form id="cr-cash-form" class="cr-addrow"><input id="cr-cash-in" type="number" min="0" step="any" inputmode="numeric" placeholder="지금 현금(원)"><button type="submit" class="secondary">기록</button></form></div><p class="cr-muted" id="cr-cash-state" role="status"></p>`;
  $('#cr-cash-form').onsubmit = async ev => { ev.preventDefault(); const amount = Number($('#cr-cash-in').value); if (!(amount >= 0)) return;
    if (S.snap?.demo) { S.cash = amount; S.cashSource = '예시(저장 안 함)'; renderRules(); renderToday(); return; }
    try { const c = await privateRead('cash-set', { amount, note: '규칙 화면' }); S.cash = c?.latest?.amount ?? amount; S.cashSource = 'PC 기록'; window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: { amount: S.cash, recordedAt: new Date().toISOString() } })); renderRules(); renderToday(); }
    catch (e2) { $('#cr-cash-state').textContent = `PC에 기록하지 못했습니다: ${e2.message}`; } };
}

// ── 검증 자료 원표(예전 "근거" · "세부 전략 근거" 표를 전체 폭으로)
function renderEvidence() {
  const box = $('#cr-evidence'); if (!box || !evidence) return;
  const C = 'C', rows = Object.values(evidence.portfolios).map(p => ({ label: p.label, h: p.hold.check, r: p.variants[C].check, t: p.variants[C].trading, v: p.variants[C].var }));
  box.innerHTML = `<div class="table-wrap"><table class="cr-table cr-ev"><thead><tr><th>묶음</th><th>가장 크게 빠졌을 때</th><th>흔들림 대비 수익</th><th>연 수익</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.label)}</td><td>${x.h.mdd}% → <b>${x.r.mdd}%</b></td><td>${x.h.sharpe} → <b>${x.r.sharpe}</b></td><td>${x.h.cagr}% → ${x.r.cagr}%</td></tr>`).join('')}</tbody></table></div>
    <ul class="cr-facts"><li>나쁜 날 하루 범위를 넘은 날 ${Math.min(...rows.map(x => x.v.rule95.rate))}~${Math.max(...rows.map(x => x.v.rule95.rate))}% (목표 5%)</li><li>맞추는 횟수 연 ${Math.min(...rows.map(x => x.t.tradesPerYear))}~${Math.max(...rows.map(x => x.t.tradesPerYear))}번 · 30일 매매 상한을 넘은 기간 ${Math.max(...rows.map(x => x.t.over30DayLimitShare))}% 이하</li></ul>`;
}
function renderStrategyEvidence() {
  const box = $('#cr-strategy'); if (!box || !strat) return;
  const P = strat.playbook.policies, NAME = { P0: '매달 똑같이 나눠 사고 팔지 않기', P1: '새 돈은 모자란 종목부터', P2: '+ 한 종목 25% 넘는 만큼만 덜기', P3: '+ 떨어지면 더 사기', P4: '+ 하루 손실 한도 2.5% (주 1회)' };
  box.innerHTML = `<div class="table-wrap"><table class="cr-table"><thead><tr><th>운용 방식</th><th>연 수익(중앙)</th><th>가장 크게 빠졌을 때(중앙 / 나쁜 10%)</th><th>단순 적립보다 덜 빠진 비율</th></tr></thead><tbody>${['P0', 'P1', 'P2', 'P3', 'P4'].map(id => `<tr><td>${esc(NAME[id])}</td><td>${P[id].check.cagrMed}%</td><td>${P[id].check.mddMed}% / ${P[id].check.mddWorst10}%</td><td>${P[id].check.beatsP0Mdd}%</td></tr>`).join('')}</tbody></table></div>`;
}

function renderRules() {
  guard('now', renderNow); guard('why', renderWhy); guard('risk', renderRisk); guard('past', renderPast);
  guard('change', () => renderChange({ keepForm: $('#rl-change')?.open && RL.pick === 'custom' })); guard('pc', renderPcBlock);
  guard('plan', () => { if ($('#rl-plan')?.open && document.activeElement?.closest?.('#cr-plan')) return; const { plan, planSaved } = current(); renderPlan(plan, planSaved); });
  guard('cash', renderCash); guard('evidence', renderEvidence); guard('strategy', renderStrategyEvidence);
  guard('recent', () => { const d = $('#rl-recent'); if (d) d.hidden = acct() === 'none'; });
}
rulesPage.addEventListener('click', e => {
  const t = e.target; const pf = t.closest?.('[data-pf]'); if (pf) { RL.pf = pf.dataset.pf; guard('risk', renderRisk); guard('past', renderPast); guard('change', () => renderChange({ keepForm: true })); return; }
  if (t.id === 'rl-open-change' || t.id === 'rl-confirm-now') { const d = $('#rl-change'); d.open = true; if (t.id === 'rl-confirm-now') { RL.pick = ruleCtx().level === 'custom' ? 'custom' : ruleCtx().level; renderChange(); showConfirm(); } d.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.id === 'rl-review-change') return showConfirm();
  if (t.id === 'rl-commit') return commitChange();
  if (t.id === 'rl-cancel') { $('#rl-confirm').hidden = true; return; }
  if (t.id === 'cq-pc') return void savePc();
  if (t.id === 'rl-plan-save') return savePlan();
  if (t.id === 'cr-fill') { const p = initialPlan(S.positions, S.cash, ruleCtx().rules); renderPlan(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { pct: v }])), false); }
});
rulesPage.addEventListener('change', e => { if (e.target.name === 'rl-level') { RL.pick = e.target.value; $('#rl-confirm').hidden = true; renderChange({ keepForm: true }); } });
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'rules') { renderRules(); void renderReview(); } });

// ── ③ 주문 점검 ───────────────────────────────────────────
const preP = addView('precheck', '종목·주문 점검', `<div class="page-head"><div><h1>종목·주문 점검 ${tip('주문을 넣기 전에 내 규칙에 맞는지, 이 돈이 하루에 얼마까지 흔들릴 수 있는지 봅니다. 실제 주문은 하지 않습니다.')}</h1><p>종목을 고르면 시세와 흐름 · 금액을 넣으면 내 규칙으로 점검</p></div></div>
<div class="cp"><form class="cp-form cr-card" id="cp-form">
  <label class="cp-l">종목</label><div class="cp-chips" id="cp-chips"></div><div class="cp-search"><input id="cp-sym" autocomplete="off" placeholder="이름·코드·티커로 찾기 (예: 현대, 005380, NVDA)" aria-autocomplete="list"><div class="cp-sugg" id="cp-sugg" hidden role="listbox"></div></div>
  <label class="cp-l">방향</label><div class="cp-seg" role="radiogroup"><label><input type="radio" name="cp-side" value="BUY" checked><span>매수</span></label><label><input type="radio" name="cp-side" value="SELL"><span>매도</span></label></div>
  <label class="cp-l" for="cp-amt">금액(원)</label><input id="cp-amt" type="number" min="1000" step="any" inputmode="numeric" placeholder="예: 1000000">
  <button type="submit" class="primary" id="cp-run">확인하기</button><p class="cp-state" id="cp-state" role="status"></p></form>
  <div class="cp-result" id="cp-result"><div id="cp-stock"></div><div id="cp-check"><div class="cr-card cp-empty"><p>종목을 고르면 시세와 차트가, 방향·금액을 넣고 확인하기를 누르면 규칙 점검 결과가 여기 뜹니다.</p></div></div></div></div>`);
let cpSel = null;
function renderPrecheckChips() { const box = $('#cp-chips'); if (!box) return; box.innerHTML = S.positions.map(p => `<button type="button" data-sym="${esc(p.symbol)}" class="${cpSel?.symbol === p.symbol ? 'on' : ''}">${esc(p.name)}</button>`).join('') || '<span class="cr-muted">보유 종목 없음</span>'; box.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => { cpSel = S.positions.find(p => p.symbol === b.dataset.sym); $('#cp-sym').value = ''; renderPrecheckChips(); void showStockPanel(cpSel); }); }
async function chosen() {
  const t = $('#cp-sym').value.trim();
  if (!t) { if (cpSel) return cpSel; throw new Error('종목을 고르거나 적어 주십시오.'); }
  if (/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t)) return { symbol: t.toUpperCase(), name: t.toUpperCase(), currency: 'USD' };
  const s = await resolveStockInput(t); return { symbol: s.split('.')[0], name: stockName(s), currency: 'KRW' };
}
$('#cp-sym').oninput = () => { if ($('#cp-sym').value.trim()) { cpSel = null; renderPrecheckChips(); } };
// 주문 점검: 종목 검색 제안은 공용 모듈(stock-search-ui.js). 고르면 오늘 등락·1년 차트 패널을 연다.
attachStockSearch($('#cp-sym'), { onPick: o => { cpSel = o; renderPrecheckChips(); void showStockPanel(o); } });
let panelRun = 0;
async function showStockPanel(o) {
  const host = $('#cp-stock'); if (!host || !o) return; const run = ++panelRun;
  host.innerHTML = `<article class="cr-card cp-stockcard"><header><h3>${esc(o.name)} <small class="cr-muted">${esc(o.symbol)}${o.currency === 'USD' ? ' · 미국' : ''}</small></h3><span class="cp-quote" id="cp-quote">시세 확인 중…</span></header><div id="cp-chart" class="cp-chart"><div class="shimmer ct-skel"></div></div></article>`;
  const [qv, d] = await Promise.all([quoteOf(o.symbol), fetchCandles(o.symbol, o.currency, '2y').catch(() => null)]);
  if (run !== panelRun) return;
  const qEl = $('#cp-quote'); if (qEl) qEl.innerHTML = qv && Number.isFinite(qv.price) ? `<b>${o.currency === 'USD' ? '$' + qv.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : won(qv.price)}</b> <span class="${qv.pct > 0 ? 'up' : qv.pct < 0 ? 'down' : ''}">${qv.pct > 0 ? '+' : ''}${(qv.pct ?? 0).toFixed(2)}%</span> <small class="cr-muted">${qv.status === 'OPEN' ? '장중' : '마감'} · ${esc(qv.source || '')}</small>` : '<small class="cr-muted">오늘 시세를 받지 못했습니다</small>';
  const ch = $('#cp-chart'); if (!ch) return;
  if (d?.candles?.length) { try { mountCandles(ch, d, { name: o.name, unit: o.currency === 'USD' ? '달러' : '원' }); const y1 = ch.querySelector('[data-period="1Y"]'); if (y1) y1.click(); } catch (e) { ch.innerHTML = `<p class="cr-muted">차트를 그리지 못했습니다 (${esc(e.message)})</p>`; } }
  else ch.innerHTML = '<p class="cr-muted">시세를 불러오지 못했습니다.</p>';
}

$('#cp-form').onsubmit = async ev => {
  ev.preventDefault(); const st = $('#cp-state'), box = $('#cp-check'); st.textContent = '계산 중…';
  try {
    if (S.loading) await S.loading;
    const o = await chosen(), side = preP.querySelector('[name="cp-side"]:checked').value, amt = Number($('#cp-amt').value);
    if (!(amt >= 1000)) throw new Error('금액을 1,000원 이상으로 넣어 주십시오.');
    let risk = S.risk[o.symbol], extra = {};
    if (!risk) { const d = await fetchCandles(o.symbol, o.currency, '2y'); o.currency = d.currency === 'USD' ? 'USD' : o.currency; risk = assetRisk(d.candles, { market: marketOf(o) }); extra = { [o.symbol]: krwReturns(d.candles, o.currency, S.fxCandles) }; }
    const s = state(extra), r = preTradeCheck(s, { ...o, side, amountKrw: amt }, risk);
    if (r.error) throw new Error(r.error);
    const maxBuy = side === 'BUY' ? maxBuyAmount(s, o, risk) : null;
    const blockers = maxBuy === 0 ? preTradeCheck(s, { ...o, side: 'BUY', amountKrw: 1000 }, risk).failed.filter(c => c.id !== 'maxTrades30').map(c => c.label) : [];
    const g = grid(extra), single = portfolioRiskAt(g, [{ symbol: o.symbol, valueKrw: amt }], g.dates.length - 1);
    const mc = risk?.ok ? simulateGarch(risk.garch, 20, { paths: 2000, seed: 5, drift: false }) : null;
    box.innerHTML = `<article class="cr-card cp-out">
      <div class="cp-verdict ${r.ok ? 'ok' : 'bad'}"><b>${r.ok ? '규칙 안' : '규칙 밖'}</b><span>${esc(o.name)} ${side === 'BUY' ? '매수' : '매도'} ${won(amt)}${r.ok ? '' : ` · ${r.failed.map(c => c.label).join(', ')}`}</span></div>
      ${maxBuy !== null ? `<p class="cp-max">규칙 안에서 지금 살 수 있는 최대 금액 <b>${won(maxBuy)}</b>${blockers.length ? `<small>지금은 ${esc(blockers.join(', '))} 때문에 1,000원도 더 살 수 없습니다.</small>` : ''}${tip('모든 매수 규칙(현금, 한 종목 상한, 계획 비중·200일선, 현금 최소, 하루 손실 한도, 레버리지)을 지키는 가장 큰 금액입니다. 매매 횟수 규칙은 금액과 무관해 따로 표시합니다.')}</p>` : ''}
      <div class="table-wrap"><table class="cr-table"><thead><tr><th>규칙</th><th>결과</th><th>내용</th></tr></thead><tbody>${r.checks.map(c => `<tr><td>${esc(c.label)}</td><td><span class="ct-chip ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '지킴' : c.ok === false ? '넘음' : '확인 불가'}</span></td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>
      <div class="cp-loss">
        <div><span>이 금액의 하루 95% 손실 ${tip('이 종목의 최근 500거래일 하루 움직임을 지금 변동성에 맞춰 본 값입니다(계좌 범위와 같은 방식).')}</span><b>${single.ok ? '−' + won(single.var95) : '—'}</b></div>
        <div><span>주문 뒤 계좌 하루 95% 손실</span><b>${Number.isFinite(r.after.var95) ? '−' + won(r.after.var95) : '—'}</b><small>${Number.isFinite(r.after.var95) ? `총자산의 ${(r.after.var95 / r.after.total * 100).toFixed(2)}% · 한도 ${s.rules.dailyLoss}%` : ''}</small></div>
        <div><span>20일 뒤 이 금액의 90% 범위 ${tip('GARCH 변동성 경로를 실제 잔차로 2,000번 모의했습니다. 평균 수익은 0으로 두어 방향을 가정하지 않습니다.')}</span><b>${mc ? `${swon(amt * mc.p05)} ~ ${swon(amt * mc.p95)}` : '—'}</b></div>
      </div>
      ${o.currency === 'USD' && S.fx ? `<p class="cr-muted">환율 ${S.fx.toLocaleString('ko-KR')}원 기준 원화 금액입니다. 원화 손실 범위에는 환율 움직임이 들어 있습니다.</p>` : ''}
      <p class="cr-muted">실제 주문은 하지 않습니다.</p></article>`;
    st.textContent = '';
  } catch (e) { st.textContent = e.message; }
};

// ── ④ 성적표 ─────────────────────────────────────────────────
// 2026-11-13(결정 34): 성적표 탭을 없애고 규칙 화면의 접힘 "내 계좌 최근 1·3·6개월"로 옮겼다. 화면(view)은 예전 주소로 들어온 경우를 위해 남기고 곧바로 규칙 화면으로 보낸다.
const repP = addView('report', '내 계좌 최근 기간', `<div id="rp-wrap"><div class="cp-seg rp-period" role="radiogroup">${[[30, '최근 1개월'], [91, '3개월'], [182, '6개월']].map(([d, l], i) => `<label><input type="radio" name="rp-p" value="${d}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><div id="rp-body"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div></div>`);
document.getElementById('rl-recent-body')?.append(document.getElementById('rp-wrap'));
document.querySelectorAll('[name="rp-p"]').forEach(r => r.onchange = () => void renderReport());
document.getElementById('rl-recent')?.addEventListener('toggle', e => { if (e.target.open) void renderReport(); });
function recentOpen() { return document.querySelector('.view.active')?.dataset.page === 'rules' && !!document.getElementById('rl-recent')?.open; }
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'report') { document.querySelector('[data-view="rules"]')?.click(); const d = document.getElementById('rl-recent'); if (d) d.open = true; } });
let repRun = 0;
function lineSvg(series) {
  const W = 720, H = 220, L = 40, R = 10, T = 10, B = 24, keys = [['actual', '내 매매'], ['hold', '그냥 보유'], ['rule', '규칙대로']];
  const vals = series.flatMap(p => keys.map(([k]) => p[k])), lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
  const X = i => L + i / Math.max(1, series.length - 1) * (W - L - R), Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  const path = k => series.map((p, i) => `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="세 가지 경로(시작=100)">${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`).join('')}<line class="b" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${keys.map(([k]) => `<polyline class="l-${k}" points="${path(k)}"/>`).join('')}<text x="${L}" y="${H - 6}">${series[0].date}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${series.at(-1).date}</text></svg>
    <div class="rp-legend">${keys.map(([k, l]) => `<span><i class="l-${k}"></i>${l}</span>`).join('')}<span class="cr-muted">시작=100 · 시간가중</span></div>`;
}
async function renderReport() {
  const id = ++repRun, body = $('#rp-body');
  if (S.snap?.paper) { body.innerHTML = `<p class="cr-muted">모의계좌는 운용 ${S.mock?.days ?? S.mock?.marks?.length ?? '며칠'}일째이고 공개 기록에는 주문 일부만 있어 이 비교를 계산하지 않습니다. 모의계좌의 기록은 위 "규칙을 지켰나"와 모의투자 화면에 있습니다.</p>`; return; }
  if (!S.positions.length) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div>'; return; }
  body.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div></div>';
  if (S.loading) await S.loading;
  if (!S.orders) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">체결 이력을 불러오지 못했습니다. 설정에서 PC 연결을 확인하십시오.</p></div>'; return; }
  const days = Number(document.querySelector('[name="rp-p"]:checked').value), from = daysAgo(days), to = today();
  const syms = new Set([...S.positions.map(p => p.symbol), ...fillsFrom(S.orders).filter(f => f.date > from).map(f => f.symbol)]);
  for (const s of syms) if (!S.candles[s]) { const f = fillsFrom(S.orders).find(x => x.symbol === s); try { S.candles[s] = (await fetchCandles(s, f?.currency || 'KRW', '2y')).candles; } catch {} }
  if (id !== repRun) return;
  const meta = Object.fromEntries([...syms].map(s => { const p = S.positions.find(x => x.symbol === s), f = fillsFrom(S.orders).find(x => x.symbol === s), cur = p?.currency || f?.currency || 'KRW'; return [s, { market: cur === 'USD' ? 'US' : 'KR', currency: cur }]; }));
  const cs = Object.fromEntries([...syms].filter(s => S.candles[s]).map(s => [s, S.candles[s]]));
  await new Promise(r => setTimeout(r, 0));
  const engine = buildEngine(cs, meta, S.fxCandles, { from: daysAgo(days + 30) });
  const rc = reportCard({ positions: S.positions.map(p => ({ ...p })), orders: S.orders, candlesBySymbol: cs, fxCandles: S.fxCandles, fxNow: S.fx, from, to, engine, rules: current().rules });
  if (id !== repRun) return;
  if (!rc.ok) { body.innerHTML = `<div class="cr-card"><p class="cr-muted">${esc(rc.reason)}</p></div>`; return; }
  const a = rc.actual, h = rc.hold, r = rc.rule, diff = a.pnl - h.pnl, best = [...rc.byTrade].filter(t => Number.isFinite(t.effectKrw)).sort((x, y) => y.effectKrw - x.effectKrw);
  const verdict = `${a.trades ? `이 기간 내 매매는 그냥 들고 있었을 때보다 ${won(Math.abs(diff))} ${diff >= 0 ? '더 벌었습니다' : '덜 벌었습니다'}` : '이 기간에는 매매가 없어 내 결과가 그냥 보유와 같습니다'}. 규칙대로였다면 최대 손실이 ${pct(r.mdd)}${h.mdd < r.mdd ? `로 그냥 보유(${pct(h.mdd)})보다 작았습니다` : h.mdd > r.mdd ? `로 그냥 보유(${pct(h.mdd)})보다 컸습니다` : `로 같았습니다`}.`;
  body.innerHTML = `<article class="cr-card rp-card">
    <p class="cr-muted">${esc(rc.from)} 종가 ~ ${esc(rc.to)} · 출발 평가액 ${won(rc.startValue)}</p>
    <h3 class="rp-verdict">${esc(verdict)}</h3>
    <div class="rp-tiles">
      <div class="me"><span>내가 한 것</span><b class="${tone(a.pnl)}">${swon(a.pnl)}</b><small>${pct(a.ret)} · 최대 손실 ${pct(a.mdd)}<br>매매 ${a.trades}번 · 수수료·세금 ${won(a.fees)}</small></div>
      <div><span>그냥 들고 있었다면</span><b class="${tone(h.pnl)}">${swon(h.pnl)}</b><small>${pct(h.ret)} · 최대 손실 ${pct(h.mdd)}</small></div>
      <div><span>규칙대로였다면 ${tip('기간 첫날 보유 비중을 계획으로 보고, 오늘 점검의 할 일을 그 주 마지막 거래일 종가마다(급하면 바로) 따랐다고 계산했습니다. 비용 0.2%. 실제 현금 이력이 없어 현금 최소 비중은 빼고 주식 부분만 봅니다.')}</span><b class="${tone(r.pnl)}">${swon(r.pnl)}</b><small>${pct(r.ret)} · 최대 손실 ${pct(r.mdd)}<br>맞춘 횟수 ${r.rebalances}번</small></div>
    </div>
    <figure class="rp-chart">${lineSvg(rc.series)}</figure>
    ${best.length ? `<h4>매매별 기여 ${tip('그 체결가에서 기간 끝 종가까지 움직인 만큼입니다. 매수는 산 뒤 오른 만큼, 매도는 판 뒤 오른 만큼을 놓친 것으로 셉니다.')}</h4><div class="table-wrap"><table class="cr-table"><thead><tr><th>날짜</th><th>종목</th><th>매매</th><th>금액</th><th>기여</th></tr></thead><tbody>${[...best.slice(0, 3), ...best.slice(-3).filter(t => !best.slice(0, 3).includes(t))].map(t => `<tr><td>${esc(t.date)}</td><td>${esc(t.name)}</td><td>${t.side === 'BUY' ? '매수' : '매도'} ${t.quantity}주</td><td>${won(t.amountKrw)}</td><td class="${tone(t.effectKrw)}"><b>${swon(t.effectKrw)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="cr-muted">이 기간 매매가 없습니다.</p>'}
    ${rc.notes.length ? `<ul class="cr-facts">${rc.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </article>`;
}
