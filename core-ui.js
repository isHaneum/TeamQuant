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
import { classify } from '/lib/sectors.js';
import { mountCandles } from '/lib/candlestick-view.js';
import { attachStockSearch, quoteOf } from '/stock-search-ui.js';
import { reviewRules, RULE_LEVELS, RULE_LOCK_DAYS, levelOf, levelRules, changeGate, applyChange, PLAN_CHANGE_MAX, PLAN_CHANGE_DAYS, planSig, planChangeGate, planDiff, planTurnover, planChangeSize } from '/lib/rule-presets.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const swon = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = n => new Date(Date.now() - n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
// 화면 날짜는 'MM-DD'(다른 해는 YYYY-MM-DD) · 기준 시각은 'MM-DD HH:mm'(한국 시간).
const md = d => { const s = String(d || '').slice(0, 10); return s && s.slice(0, 4) === today().slice(0, 4) ? s.slice(5) : s; };
const kdt = t => { const ms = Date.parse(t); if (!Number.isFinite(ms)) return ''; const s = new Date(ms + 9 * 3600e3).toISOString(); return `${md(s.slice(0, 10))} ${s.slice(11, 16)}`; };
const marketOf = p => p.currency === 'USD' ? 'US' : 'KR';
// 200일선 규칙은 지수 ETF 에만(결정 28·47): 실계좌·예시 홈 점검이 개별 종목(알파벳·엔비디아)에 "0%로 줄이기"를 띄우던 것을 고침(2026-11-18). 모의계좌는 paper-live 가 계획 역할로 같은 판단을 한다.
const isIndexEtf = p => classify(p.symbol, p.name) === 'index';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/core.css?v=20261126a'; document.head.append(css);
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
    try { const d = await fetchCandles(p.symbol, p.currency, '2y'); S.candles[p.symbol] = d.candles; S.risk[p.symbol] = assetRisk(d.candles, { market: marketOf(p), trendUS: isIndexEtf(p) }); S.series[p.symbol] = krwReturns(d.candles, p.currency, S.fxCandles); }
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
// 2026-11-26 쉬운 말 정리: 칩마다 있던 ⓘ 대신 칩 글자에 숫자를 바로 쓴다(어긴 규칙은 ✕ 목록에만). '계좌 하루 95% 손실' 띠는 '나쁜 날 하루 손실' 칩으로 합쳤다.
// 위쪽 메뉴와 같은 곳으로 가는 '규칙'·'모의투자' 버튼은 지웠고, '새로 넣을 돈'은 규칙 › 종목별 목표 비중으로 옮겼다.
const CHECK_TIP = '할 일 금액은 내가 정한 규칙으로 계산한 결과이며, 실행 여부는 내가 정합니다.\n내 규칙과 목표 비중으로 지금 계좌를 점검합니다.\n목표 비중은 내가 종목마다 정한 비율입니다(없으면 지금 비중). 규칙 비중은 여기에 한 종목 최대 비중·변동성·현금 최소 비중·하루 손실 한도를 적용한 값이고, 할 일 금액은 규칙 비중으로 계산합니다.\n비중 맞추기: 매주 마지막 거래일 종가에 1번. 하루 손실이 한도의 1.25배를 넘거나, 레버리지 상품이 있거나, 한 종목이 상한의 1.2배를 넘으면 바로.\n목표 금액과 10% 넘게 차이 날 때만 맞춥니다.\n과거에 적용한 결과는 규칙 화면에 있습니다(덜 잃는 대신 덜 벌었음).';
const VAR_TIP = '20거래일에 하루쯤은 이보다 더 잃을 수 있는 금액입니다. 지금 보유에 최근 500거래일의 하루 움직임을 요즘 변동성에 맞춰 넣어 계산했습니다.\n과거에 이 값을 넘은 날 비율은 규칙 › 근거 자료에 있습니다(목표 5%).';
const PAPER_TIP = '이 점검은 이 화면에서 팀 모의계좌의 규칙·목표 비중으로 다시 계산한 값입니다. 실제 주문은 팀 모의계좌 자동 매매가 정하고(뉴스·공시 주의, 분할 매수 단계 포함), 결과는 모의투자 화면에 있습니다.';
const CASH_IN_TIP = '새로 들어온 돈을 목표보다 모자란 종목부터 나눕니다. 떨어졌거나 덜 산 종목에 자연히 더 들어갑니다. 한 종목 최대 비중·현금 최소 비중·하루 손실 한도를 지키고 남는 돈은 현금으로 둡니다.\n무작위 6종목 포트폴리오 120개로 2016~2026년을 돌려 보니 매달 같은 비중으로 나눠 살 때와 수익·손실은 비슷하고 매매는 약 40% 적었습니다.';
// 2026-11-27 보완 2: 맞춤 시점 줄('내 규칙: 이번 주 금요일 종가 기준')은 제목 ⓘ(CHECK_TIP '매주 마지막 거래일 종가에 1번')와 같은 말이라 뺐다.
// 즉시 점검 조건일 때만 짧은 상태 라벨 '즉시 점검'을 보인다(조건은 같은 ⓘ 에 있음).
// 칩 글자: 규칙 이름(또는 짧은 이름) + 숫자. 지킨 규칙·확인 못 한 규칙만 칩으로 보인다.
function chipText(c, e, rules, t30) {
  if (c.id === 'maxSingle') { const xs = e.rows.filter(r => !r.capExempt); return xs.length ? `가장 큰 종목 ${Math.max(...xs.map(r => r.currentPct)).toFixed(1)}% · 한도 ${rules.maxSingle}%` : `${c.label} · 지수 ETF는 예외`; }
  if (c.id === 'minCash') return e.cashKnown ? `현금 ${e.cashPct.toFixed(1)}% · 기준 ${rules.minCash}%` : `${c.label} · 현금 입력 전`;
  if (c.id === 'dailyLoss') return e.varNow?.ok && e.total > 0 ? `나쁜 날 하루 손실 −${won(e.varNow.var95)}(${(e.varNow.var95 / e.total * 100).toFixed(2)}%) · 한도 ${rules.dailyLoss}%` : `${c.label} · 시세 부족`;
  if (c.id === 'maxTrades30') return Number.isFinite(t30) ? `30일 매매 ${t30}번 · 상한 ${rules.maxTrades30}번` : `${c.label} · 체결 내역 못 읽음`;
  return c.label;
}
function renderToday() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let card = document.getElementById('core-today');
  if (!card) { card = document.createElement('article'); card.className = 'hm-card core-today'; card.id = 'core-today'; const top = document.getElementById('home-top'); if (top) top.after(card); else host.prepend(card); } // 홈 맨 위 두 칸 바로 아래(brief-ui placeCards 와 같은 자리)
  if (!S.positions.length) { card.hidden = true; return; } card.hidden = false;
  const ready = Object.keys(S.risk).length > 0, { planSaved, rules } = current();
  // 불러오는 동안에도 최종 모양(제목 · 줄 2개 · 칩 줄)으로 그려 아래 카드가 밀리지 않게 한다.
  if (!ready) { card.innerHTML = `<header class="ct-hero"><h2>규칙 점검 중</h2></header><div class="shimmer ct-skel"></div><div class="shimmer ct-skel ct-skel-line"></div><div class="shimmer ct-skel ct-skel-line"></div>`; return; }
  const s = state(), e = evaluate(s), paper = !!S.snap?.paper, la = paper ? (S.mock?.auto || []).at(-1) : null;
  const bad = e.checks.filter(c => c.ok === false), rest = e.checks.filter(c => c.ok !== false); card.classList.toggle('ct-has-bad', bad.length > 0);
  card.innerHTML = `<header class="ct-hero"><h2>규칙 ${e.known}개 중 ${e.okCount}개 지킴 ${tip(CHECK_TIP)}</h2>${e.urgent ? '<span class="ct-when urgent">즉시 점검</span>' : ''}</header>
    ${bad.length ? `<ul class="ct-broken">${bad.map(c => `<li><b>${esc(c.label)}</b><span>${esc(String(c.detail || '').split(String.fromCharCode(10))[0].slice(0, 140))}${c.id === 'dailyLoss' ? tip(VAR_TIP) : ''}</span></li>`).join('')}</ul>` : '<p class="ct-allgood">오늘 어긴 규칙이 없습니다.</p>'}
    ${planSaved ? '' : `<p class="ct-note">목표 비중 없음 · 지금 비중으로 점검 ${tip(`한 종목 ${rules.maxSingle}%를 넘는 몫은 잘라 목표로 봤습니다.`)} <button type="button" class="text-button" data-core-go="rules" data-core-open="rl-plan">목표 비중 정하기</button></p>`}
    ${rest.length ? `<div class="ct-checks">${rest.map(c => `<span class="ct-chip ${c.ok === true ? 'ok' : 'na'}">${c.ok === true ? '✓' : '?'} ${esc(chipText(c, e, rules, s.trades30))}${c.id === 'dailyLoss' ? tip(VAR_TIP) : ''}</span>`).join('')}</div>` : ''}
    ${e.known < e.checks.length ? `<p class="ct-unknown">${e.checks.length - e.known}개는 자료가 없어 확인 못 함</p>` : ''}
    ${paper ? `<p class="ct-none ct-auto">자동 주문${la ? ` · 마지막 ${esc(la.at ? md(kday(la.at)) : '')} · 주문 ${la.sent ?? 0}건 · 막힘 ${la.blocked ?? 0}건` : ' · 기록 없음'} ${tip(PAPER_TIP)}</p>` : e.actions.length ? `<p class="ct-acts-title">규칙 계산 결과</p><ol class="ct-actions">${e.actions.slice(0, 6).map(a => `<li class="${a.kind}"><b>${esc(a.text)}</b>${a.why?.length ? `<small>${esc(a.why.join(' · '))}</small>` : ''}</li>`).join('')}</ol>` : '<p class="ct-none">할 일 없음 · 목표 비중대로 유지</p>'}
    <div class="ct-links"><button type="button" class="secondary" data-core-go="precheck">종목·주문 점검</button></div>`;
}
// '새로 넣을 돈'(규칙 › 종목별 목표 비중 안 · 예시·실계좌만): 들어온 돈을 목표보다 모자란 종목부터 나눈 목록만 보여 준다(주문 없음).
document.addEventListener('submit', e => {
  if (e.target?.id !== 'ct-cash') return; e.preventDefault();
  const amt = Number(document.getElementById('ct-cash-in').value), box = document.getElementById('ct-cash-out'), a = allocateCash(state(), amt);
  if (!a.ok) { box.innerHTML = `<p class="cr-err">${esc(a.error)}</p>`; return; }
  box.innerHTML = a.buys.length ? `<ol class="ct-alloc">${a.buys.map(b => `<li><b>${esc(b.name)} ${won(b.amountKrw)}</b><small>${esc(b.why)}</small></li>`).join('')}</ol>${a.keepCashKrw >= 10000 ? `<p class="cr-muted">현금으로 둘 돈 ${won(a.keepCashKrw)}${a.note ? ' · ' + esc(a.note) : ''}</p>` : ''}` : `<p class="cr-muted">${a.note ? esc(a.note) : `지금은 목표보다 모자란 종목이 없어 ${won(amt)}을 현금으로 둡니다.`}</p>`;
});
// data-core-go: 그 화면으로 간다. data-core-open: 간 뒤 그 접힘을 열고 그 자리로 내린다(홈 '목표 비중 정하기' → 규칙 › 종목별 목표 비중).
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-core-go]'); if (!b) return;
  document.querySelector(`[data-view="${b.dataset.coreGo}"]`)?.click();
  const fold = b.dataset.coreOpen ? document.getElementById(b.dataset.coreOpen) : null;
  if (fold) { fold.open = true; setTimeout(() => fold.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }
});
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'home') renderToday(); });

// ── ① 규칙 ───────────────────────────────────────────────────
// 2026-11-13 개편(결정 34 · 사용자 의견: "왜 이 규칙이고, 얼마나 위험하고, 과거 시장에 넣으면 어땠는지를 보여 달라 · 매번 바꿀 수 있으면 안 된다").
// 2026-11-26 쉬운 말 정리: 지금 규칙(이유는 규칙 이름 ⓘ · 과거 숫자 열) → 월급 적립(접힘) → 내 계좌 위험 → 과거에 적용한 결과 → 규칙 지킨 기록 → (한 카드 안 접힘) 규칙 바꾸기 · 종목별 목표 비중 · 근거 자료.
// '왜 이 규칙인가' 카드는 '지금 규칙' 표와 같은 규칙을 한 번 더 늘어놓아 지웠다(이유는 ⓘ, 숫자는 '과거 숫자' 열). 질문형 제목은 쓰지 않는다.
// 계좌마다 규칙은 한 벌이다. 모의계좌 화면은 모의계좌의 규칙(PC 장부, 저장한 적 없으면 기본 규칙)을 읽기 전용으로, 예시·실계좌 화면은 이 브라우저에 저장한 규칙을 보인다.
// 화면의 과거 숫자는 전부 data/core-validation.json · data/strategy-evidence.json · data/paper-rehearsal.json 에서 읽는다(문구에 숫자를 박지 않는다).
let evidence = null, strat = null, rehearsal = null, sizing = null, structure = null;
const RL = { pf: 'demo', pick: null, pc: null };
const acct = () => (S.snap?.paper ? 'paper' : S.snap?.demo ? 'demo' : S.snap ? 'real' : 'none');
const kday = t => new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const guard = (name, fn) => { try { return fn(); } catch (e) { console.warn('[규칙 화면]', name, e); return null; } };
const sg = v => (v > 0 ? '+' : '') + v;
fetch('/data/strategy-evidence.json?v=E1').then(r => r.ok ? r.json() : null).then(d => { strat = d; renderRules(); }).catch(() => {});
fetch('/data/sizing-study.json?v=RB1').then(r => r.ok ? r.json() : null).then(d => { sizing = d; renderRules(); }).catch(() => {});
fetch('/data/structure-cards.json?v=SQ1').then(r => r.ok ? r.json() : null).then(d => { structure = d; renderRules(); }).catch(() => {});
fetch('/data/core-validation.json?v=' + RULES_VERSION).then(r => r.ok ? r.json() : null).then(d => { evidence = d; renderRules(); }).catch(() => {});
fetch('/data/paper-rehearsal.json').then(r => r.ok ? r.json() : null).then(d => { rehearsal = d; renderRules(); }).catch(() => {});

// 버튼 이름(앞에 '예시 포트폴리오:'가 붙음)과 문장 속 이름(내 종목이 아니라는 '예시'를 붙임)을 나눈다.
const PF_BTN = { demo: '6종목', kr: '국내 대형주 5종목', us: '미국 기술주 5종목', etf: '지수·채권 ETF 4종목' };
const PF_NAMES = { demo: '예시 6종목', kr: '예시 국내 대형주 5종목', us: '예시 미국 기술주 5종목', etf: '예시 지수·채권 ETF 4종목' };
// 규칙 이름 ⓘ 에 붙이는 '규칙을 둔 이유'(예전 '왜 이 규칙인가' 카드의 이유 열 · '하는 일' 열 중 help 에 없는 것).
const RULE_WHY = { dailyLoss: '흔들림이 커지면 다음 날 비중을 줄입니다.', maxSingle: '한 종목이 무너져도 계좌가 버팁니다. 넘는 만큼만 줄입니다.', maxTrades30: '자주 맞추면 매매만 늘어납니다. 넘으면 주문 점검에서 막습니다.', trendUS: '긴 하락에서 미국 지수 ETF를 비웁니다.' };
const ADV = new Set(['perAssetVol', 'volTarget']);
const ruleValue = (d, v) => (d.type === 'bool' ? (v ? '켬' : '끔') : `${v}${d.unit || ''}`);
// 규칙 바꾼 기록의 영어 키 → 화면 이름
const ruleName = k => RULE_DEFS.find(d => d.id === k)?.label || { cadence: '점검 주기', sectorCap: '섹터 상한', init: '처음 저장', plan: '목표 비중' }[k] || k;
const RULES_TIP = '오늘 점검과 주문 점검이 이 규칙으로 계산합니다. 손실을 줄이는 한도이지 사고팔라는 지시가 아닙니다. 예시 자산·내 계좌 규칙은 이 브라우저(프로필별)에만, 팀 모의계좌 규칙은 팀 PC에 저장됩니다.';
const dcaSaved = (() => { try { return Number(JSON.parse(localStorage.getItem('teamQuantDcaGuide') || 'null')?.monthly) > 0; } catch { return false; } })();

const rulesPage = addView('rules', '규칙', `<div class="page-head"><div><h1>규칙</h1><p id="rl-sub"></p></div></div>
<div class="rl">
  <article class="cr-card" id="rl-now"><div class="shimmer ct-skel"></div></article>
  <details class="cr-card rl-fold rl-dca-fold" id="rl-dca-fold" ${dcaSaved ? '' : 'open'}><summary><b>월급 적립</b></summary><div id="rl-dca"><div class="shimmer ct-skel"></div></div></details>
  <article class="cr-card" id="rl-risk"><header><h3>내 계좌 위험 ${tip("'나쁜 날 하루 손실'은 20거래일에 하루쯤은 이보다 더 잃을 수 있는 금액입니다. 최근 500거래일 움직임을 요즘 변동성에 맞춰 계산한 값이라 급락장에서는 더 클 수 있습니다.\n한도는 그날 손실을 막지 못하고 다음 날 비중을 줄입니다.\n과거 기록은 '과거에 적용한 결과'에서 고른 예시 포트폴리오에 같은 규칙을 2012년부터 날마다 적용한 결과입니다.")}</h3></header><div id="rl-risk-body"><div class="shimmer ct-skel"></div></div></article>
  <article class="cr-card" id="rl-past"><header><h3>과거에 적용한 결과 ${tip('오늘 점검과 같은 계산을 2012-01-02부터 날마다 적용한 결과입니다. 1억 원, 종목마다 같은 비중, 남는 돈은 이자 없는 현금, 비용 0.2%.\n기본 규칙은 2012~2019년 자료로 정하고 2020년 이후로 확인했습니다.\n내 종목이 아닌 예시 포트폴리오 4개이고, 지금 살아남은 종목이라 수익률이 실제보다 높게 나옵니다. 과거 결과가 앞으로를 보장하지 않습니다.')}</h3><div class="rl-pfpick"><span class="rl-pf-label">예시 포트폴리오:</span><div class="rl-seg" id="rl-pf" role="group" aria-label="예시 포트폴리오">${Object.entries(PF_BTN).map(([k, l]) => `<button type="button" data-pf="${k}">${l}</button>`).join('')}</div></div></header>
    <div id="rl-past-body"><div class="shimmer ct-skel"></div></div>
    <details class="rl-in" id="rl-recent"><summary>내 계좌 최근 1·3·6개월 ${tip('같은 기간을 세 가지로 비교합니다. 내가 실제로 한 것(체결 기록으로 날마다 보유를 되돌림), 기간 첫날 보유를 그냥 보유했을 때, 오늘 점검을 주 1번 따랐을 때.\n주식 부분만 비교하고 현금 이자는 넣지 않습니다. "규칙대로"의 목표 비중은 기간 첫날 비중입니다.')}</summary><div id="rl-recent-body"></div></details>
  </article>
  <article class="cr-card" id="cr-review"><header><h3>규칙 지킨 기록 ${tip("팀 모의계좌의 날마다 기록(총자산·현금·주문·막힌 이유)으로 규칙을 지켰는지 봅니다. 예측이 아닌 지난 기록이고 20거래일은 지나야 의미가 있습니다.\n'주문 오류 점검'은 주문이 제대로 처리됐는지이고, 규칙을 지켰는지와는 다릅니다.")}</h3></header><div id="cr-review-body"><p class="cr-muted">불러오는 중…</p></div></article>
  <div class="cr-card rl-folds">
  <details class="rl-fold" id="rl-change"><summary><b>규칙 바꾸기</b><small id="rl-change-state"></small></summary>
    <div id="rl-levels" class="rl-levels"></div><p class="rl-cap" id="rl-levels-note"></p>
    <div id="rl-custom" hidden><form id="cr-form" class="cr-rules"></form><details class="cr-adv"><summary id="cr-adv-sum">변동성 규칙 (기본 끔)</summary><div id="cr-adv"></div></details></div>
    <p class="cr-err" id="cr-err" role="alert"></p>
    <div class="cr-actions"><button type="button" class="primary" id="rl-review-change">변경 내용 확인</button><span class="cr-muted" id="cr-saved"></span></div>
    <div id="rl-confirm" hidden></div>
    <div id="rl-pc" hidden></div>
  </details>
  <details class="rl-fold" id="rl-plan"><summary><b>종목별 목표 비중</b><small id="rl-plan-state"></small></summary>
    <div id="cr-cash"></div>
    <div class="rl-planhead"><span class="cr-muted">종목마다 총자산(주식 + 현금)에서 차지할 목표 비중 ${tip('오늘 점검은 이 목표에 규칙(200일선·하루 손실 한도)을 적용해 지금 보유와 비교합니다. 규칙 때문에 줄였어도 조건이 풀리면 다시 목표까지 사도록 알려 줍니다.\n목표 비중은 ' + PLAN_CHANGE_DAYS + '일에 ' + PLAN_CHANGE_MAX + '번까지 바꿀 수 있고(처음 저장은 세지 않음), 바꾸기 전에 사고팔 금액을 보여 주고 이유를 받습니다. 실적 발표나 큰 이슈에는 대응하되 매번 바꾸지는 않게 하는 한도입니다.')}</span><button type="button" class="text-button" id="cr-fill">지금 비중으로 채우기</button></div>
    <div id="cr-plan"></div><p class="cr-err" id="rl-plan-err" role="alert"></p>
    <div class="cr-actions" id="rl-plan-actions"><button type="button" class="primary" id="rl-plan-save">목표 비중 저장</button><span class="cr-muted" id="rl-plan-saved"></span></div>
    <div id="rl-plan-confirm" hidden></div><div id="rl-plan-hist"></div>
  </details>
  <details class="rl-fold" id="rl-raw"><summary><b>근거 자료</b><small>이 화면 숫자의 출처</small></summary>
    <h4 class="rl-h4">기본 규칙 과거 결과 ${tip('같은 계산을 2012년부터 날마다 적용한 결과 중 2020~2026년(기본값을 정할 때 안 쓴 확인 기간)입니다. 현금 이자는 0으로 둬 낮게 잡았습니다. 지금 살아남은 종목이라 실제보다 좋게 나옵니다.')}</h4><div id="cr-evidence"><div class="shimmer ct-skel"></div></div>
    <h4 class="rl-h4">적립 방식 비교 ${tip('대형주 54개(한국 25 · 미국 29)에서 6종목씩 무작위로 뽑은 포트폴리오 120개를, 1,000만 원으로 시작해 매달 50만 원씩 넣으며 2016년부터 돌린 결과입니다. 방식은 2016~2020년 자료로 정하고, 표에는 2021년 이후(확인 기간)만 보입니다. 지금 살아남은 대형주만이라 실제보다 좋게 나옵니다.')}</h4><div id="cr-strategy"><div class="shimmer ct-skel"></div></div>
  </details>
  </div>
</div>`);
// 월급 적립(결정 41): 따로 불러와서, 실패해도 규칙 화면의 다른 카드는 그대로 둔다. 매달 넣을 돈을 저장해 두었으면 한 줄로 접어 둔다.
import('/dca-guide-ui.js').then(m => m.mountDcaGuide(document.querySelector('#rl-dca'), { fold: document.querySelector('#rl-dca-fold') })).catch(e => { console.warn('[월급 적립]', e); document.querySelector('#rl-dca-fold')?.remove(); });

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

// 규칙 표의 '과거 숫자' 열(예전 '왜 이 규칙인가' 카드의 숫자). 자료(evidence·strat)를 받기 전에는 null.
function pastNums(c) {
  if (!evidence || !strat) return null;
  const V = variantOf(c.level) || 'C', demo = evidence.portfolios.demo, P = strat.playbook.policies, br = demo.variants[V].dailyLossBreach, lossOf = evidence.variants.find(v => v.id === V)?.rules?.dailyLoss;
  const fixed = '<span class="cr-muted">정한 값 · 과거 확인 없음</span>';
  return {
    dailyLoss: variantOf(c.level) ? `하루 ${lossOf}% 넘게 잃은 날: 그냥 보유 ${br.hold}% → 규칙대로 <b>${br.rule}%</b>` : `기본 규칙(2.5%) 기준: 그냥 보유 ${br.hold}% → 규칙대로 <b>${br.rule}%</b>`,
    maxSingle: `최대 하락폭(중간값) ${P.P1.check.mddMed}% → <b>${P.P2.check.mddMed}%</b> (25% 기준)`,
    // 변형 E = B 를 매일 점검, B = 주 1번(data/core-validation.json variants).
    maxTrades30: `매일 맞추면 매매 연 ${demo.variants.E.trading.tradesPerYear}회 · 주 1번이면 연 <b>${demo.variants.B.trading.tradesPerYear}회</b>`,
    // 예전 숫자(미국 기술주 5종목에 켜고 끈 결과)는 이 규칙이 개별 종목에도 걸리던 때의 것이라 지금 규칙(미국 지수 ETF만)과 맞지 않아 보이지 않는다.
    trendUS: '<span class="cr-muted">지금 규칙으로 다시 계산 전</span>',
    minCash: fixed, noLeverage: fixed
  };
}
// '쓰지 않기로 한 방법'(예전 '왜 이 규칙인가' 카드 아래 접힘): 지금 규칙 카드 안으로 옮겼다.
function notUsedHtml() {
  if (!strat) return '';
  const P = strat.playbook.policies, ic = (m) => strat.factors[m].composite.check.ic, mac = strat.macro, dip = strat.events.dip20, run = strat.events.run30?.checkHealthy;
  return `<details class="rl-in"><summary>쓰지 않기로 한 방법</summary><ul class="cr-facts">
      <li><b>주가 예측:</b> 재무·주가 지표로 다음 달을 맞히는 정도 한국 ${ic('KR')}, 미국 ${ic('US')} (0이면 못 맞힘).</li>
      <li><b>지수 방향 예측:</b> 다음 달 방향을 맞힌 비율 코스피 ${mac.KOSPI.directionHit}% (늘 "오른다"고 하면 ${mac.KOSPI.upShare}%), S&amp;P500 ${mac.SP500.directionHit}% (${mac.SP500.upShare}%).</li>
      <li><b>떨어지면 더 사기:</b> 넣어도 최대 하락폭(중간값) ${P.P2.check.mddMed}% → ${P.P3.check.mddMed}%, 연 수익 ${P.P2.check.cagrMed}% → ${P.P3.check.cagrMed}%. 고점 대비 −20% 뒤에도 평균 ${dip.healthy.furtherDrop}% 더 빠졌습니다.</li>
      ${run ? `<li><b>오르면 팔기:</b> 3개월(60거래일)에 +30% 오른 뒤 6개월(120거래일) 동안 지수 대비 ${sg(run.ex120)}%p, 지수를 이긴 비율 ${run.hit120}%. 뚜렷한 되돌림이 없어 상한을 넘는 만큼만 줄입니다.</li>` : ''}
    </ul></details>`;
}
function renderNow() {
  const box = $('#rl-now'); if (!box) return; const c = ruleCtx(), lv = RULE_LEVELS.find(l => l.id === c.level);
  // 2026-11-27 보완 2: 어느 계좌 규칙인지는 짧은 이름만(설명 문장 없음).
  $('#rl-sub').textContent = c.kind === 'paper' ? '팀 모의계좌 · 보기만' : c.kind === 'real' ? '내 계좌' : c.kind === 'demo' ? '예시 자산' : '';
  const status = c.kind === 'paper'
    ? `${c.savedAt ? `저장 ${esc(md(kday(c.savedAt)))}` : '기본 규칙'}${c.since ? ` · ${esc(md(c.since))}부터 변경 ${c.changes}회` : ''}`
    : c.confirmedAt ? `확정 ${esc(md(kday(c.confirmedAt)))} · ${c.locked ? `${esc(md(kday(c.lockedUntil)))}부터 바꿀 수 있음` : '지금 바꿀 수 있음'}` : '확정 전 · 기본 규칙';
  const past = guard('past-nums', () => pastNums(c)), pastCell = id => past ? (past[id] || '<span class="cr-muted">—</span>') : '<span class="cr-muted">불러오는 중…</span>';
  const rows = RULE_DEFS.filter(d => !ADV.has(d.id) || (d.id === 'perAssetVol' && c.rules.perAssetVol) || (d.id === 'volTarget' && c.rules.perAssetVol)).map(d => `<tr><td>${esc(d.label)} ${tip(RULE_WHY[d.id] ? `${d.help}\n${RULE_WHY[d.id]}` : d.help)}</td><td><b>${esc(ruleValue(d, c.rules[d.id]))}</b></td><td>${pastCell(d.id)}</td></tr>`).join('');
  const caps = c.kind === 'paper' ? c.mock?.planDoc?.caps : null;
  const capRow = caps ? `<tr><td>살 때 한도 ${tip('팀 모의계좌가 종목을 살 때 쓰는 한도입니다. 이 한도까지만 사고, 산 뒤 올라서 커진 것은 한 종목 최대 비중까지 둡니다.')}</td><td class="rl-wrap"><b>종목 ${caps.single}% · 섹터 ${caps.sector}% · 개별 합 ${caps.satellite}% · 현금 ${caps.cashMin}% 이상</b></td><td><span class="cr-muted">정한 값 · 과거 확인 없음</span></td></tr>` : '';
  // 확정 뒤 '규칙 바꾸기' 버튼은 아래 '규칙 바꾸기' 접힘과 같은 일이라 지웠다(잠금 날짜는 상태 줄과 접힘 옆 글에 있음).
  const buttons = c.kind === 'paper'
    ? `<button type="button" class="secondary" data-demo-start>예시 자산으로 바꿔서 직접 정하기</button>`
    : c.kind === 'none' || c.confirmedAt ? ''
      : `<button type="button" class="primary" id="rl-confirm-now">이 규칙으로 확정</button><button type="button" class="secondary" id="rl-open-change">값 고쳐서 확정</button>`;
  // 2026-11-27: 잠금 사실은 누르기 전에 늘 보이게 확정 버튼 바로 위에 둔다(튜토리얼을 끈 사람도 본다 · .rl-note 는 간결 화면이 가려서 rl-cap).
  // 보완 2(같은 날 · R6): 줄글 3문장 대신 '28일 잠금 ⓘ' 라벨. 날짜·이유 10자·저장 위치는 ⓘ 안, 날짜는 확인 표 '잠금' 줄에도 있다.
  const lockNote = (c.kind === 'demo' || c.kind === 'real') && !c.confirmedAt ? `<p class="rl-cap">${RULE_LOCK_DAYS}일 잠금 ${tip(`확정하면 ${RULE_LOCK_DAYS}일 동안 바꿀 수 없습니다(${md(kday(Date.now() + RULE_LOCK_DAYS * 864e5))}부터 다시 바꿀 수 있음). 그 뒤에는 이유를 10자 이상 적어야 합니다. 잠금은 이 브라우저에만 저장됩니다.`, '잠금')}</p>` : '';
  box.innerHTML = `<header><h3>지금 규칙 ${tip(`${RULES_TIP}\n${c.readOnly ? '팀 모의계좌가 실제로 쓰는 규칙입니다. 팀 PC에서만 바꿀 수 있고, 바꾸면 이유와 함께 공개 자료에 남습니다.\n내 규칙은 이 카드 맨 아래 [예시 자산으로 바꿔서 직접 정하기]에서 정합니다(예시 종목 6개).' : `확정하면 ${RULE_LOCK_DAYS}일 동안 못 바꾸고, 그 뒤에는 이유를 적어야 바꿀 수 있습니다. 바꾼 지 20거래일이 안 된 성과로는 새 규칙을 평가할 수 없어서입니다. 스스로 한 약속이라 이 브라우저의 저장 기록을 지우면 풀립니다.`}`)}</h3><span class="rl-badge ${lv ? 'ok' : 'warn'}">${lv ? `${esc(lv.label)} · 과거 자료로 확인함` : '직접 정함 · 과거 확인 없음'}</span></header>
    <p class="rl-cap">${status}</p>
    <div class="table-wrap"><table class="cr-table rl-rules"><thead><tr><th>규칙</th><th>값</th><th>과거 숫자 ${tip('같은 계산을 과거 자료에 적용해 잰 숫자입니다. "정한 값"은 비교 자료 없이 정한 것입니다. 지금 살아남은 대형주로 만든 예시 포트폴리오라 실제보다 좋게 나옵니다.')}</th></tr></thead><tbody>${rows}${capRow}</tbody></table></div>
    ${guard('not-used', notUsedHtml) || ''}
    ${lockNote}${buttons ? `<div class="cr-actions">${buttons}</div>` : ''}`;
}

// 계획의 위험 분해(결정 35): 개별 종목 묶음이 계좌 위험에서 차지하는 몫, 지수와 다르게 움직이는 정도(추적오차)가 어느 종목에서 나오는지, 위험을 같게 나누면 비중이 어떻게 되는지.
// 계산 결과 파일(scripts/research/sizing-study.mjs)을 읽기만 한다 — 계획은 바꾸지 않는다. 모의계좌이고 파일의 계획 버전이 지금 계획과 같을 때만 보인다. 수익 비교는 없다.
function sizingHtml() {
  if (acct() !== 'paper' || !sizing?.snapshot?.equal || !sizing.snapshot.erc || sizing.planVersion !== S.mock?.planDoc?.version) return '';
  // 계획이 위험 기여 균등(PP4c · 2026-11-16 적용)이면 지금 = erc, 비교 = 균등. 균등 계획(PP3)이면 반대.
  const ercPlan = Object.values(S.mock?.planDoc?.weights || {}).some(w => w.sizing === 'erc'), eq = sizing.snapshot.equal, er = sizing.snapshot.erc, cur = ercPlan ? er : eq, alt = ercPlan ? eq : er;
  const nm = sizing.snapshot.names || {}, wk = sizing.walk || {}, wb = ercPlan ? [wk.erc, wk.ercBand25] : [wk.equal, wk.equalBand25], syms = Object.keys(cur.weightsPct).sort((a, b) => cur.activeSharePct[b] - cur.activeSharePct[a]);
  const top = syms.slice(0, 3), topSum = top.reduce((a, s) => a + cur.activeSharePct[s], 0), short = s => String(nm[s]?.name || s).replace(/\s*\(.*\)$/, ''), satW = Object.values(cur.weightsPct).reduce((a, b) => a + b, 0);
  const rows = syms.map(s => `<tr><td>${esc(short(s))}</td><td>${Number(S.mock?.planDoc?.weights?.[s]?.pct ?? cur.weightsPct[s]).toFixed(1)}%</td><td><b>${cur.activeSharePct[s].toFixed(0)}%</b></td><td>${alt.weightsPct[s].toFixed(1)}%</td></tr>`).join('');
  const near = Math.abs(eq.volPct - er.volPct) < 1 ? '(거의 같음)' : '';
  return `<div class="rl-sizing"><h4 class="rl-h4">종목별 위험 몫 ${tip('최근 3년 주간 수익률(원화)로 계산했습니다. "지수와 다르게 움직이는 정도"는 지수로만 담은 경우(국내·미국·현금 비율은 이 계좌와 같게, 국내는 KODEX 200, 미국은 S&P500 ETF로만)와의 차이가 한 해에 흔들리는 폭입니다. 종목별 위험 몫은 그 흔들림에 각 종목이 보탠 비율입니다. 수익을 예측한 값이 아닙니다.')}</h4>
    <p class="rl-cap">개별 ${syms.length}종목 · 비중 ${satW.toFixed(0)}% · 위험 몫 <b>${cur.satRiskOfTotalPct.toFixed(0)}%</b> · 지수와 차이 연 ${cur.tePct.toFixed(1)}% · ${ercPlan ? `종목당 위험 몫 <b>${(100 / syms.length).toFixed(0)}%</b>` : `그중 <b>${topSum.toFixed(0)}%</b>가 ${top.map(s => esc(short(s))).join(' · ')}`}</p>
    <details class="rl-in"><summary>${ercPlan ? '같은 비중과 비교' : '위험을 같게 나누면'}</summary>
      <div class="table-wrap"><table class="cr-table rl-size"><thead><tr><th>종목</th><th>목표 비중</th><th>위험 몫</th><th>${ercPlan ? '같은 비중이면' : '위험을 같게 나누면'}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="rl-cap">${ercPlan ? '같은 비중과 비교' : '위험을 같게 나누면'}: 지수와 다르게 움직이는 정도 연 ${eq.tePct.toFixed(2)}% → <b>${er.tePct.toFixed(2)}%</b> · 가장 큰 종목 위험 몫 ${eq.maxActiveSharePct.toFixed(0)}% → ${er.maxActiveSharePct.toFixed(0)}% · 계좌 변동성 ${eq.volPct.toFixed(1)}% → ${er.volPct.toFixed(1)}%${near}</p>
      <details class="rl-in"><summary>자세히</summary><ul class="cr-facts">
      ${wk.equal && wk.erc ? `<li>${esc(wk.equal.from.slice(0, 4))}~${esc(wk.equal.to.slice(0, 4))}년에 4주마다 다시 계산해 본 실제 값: ${wk.equal.tePct.toFixed(2)}% → <b>${wk.erc.tePct.toFixed(2)}%</b>. 계산으로 낸 값은 실제의 ${(1 / (ercPlan ? wk.erc : wk.equal).teRealizedOverForecast).toFixed(2)}배로 조금 높게 나왔습니다.</li>` : ''}
      ${wb[0] && wb[1] ? `<li>4주마다 다 맞추면 ${wb[0].rebalances}번 · 한 해 사고판 금액 총자산의 ${wb[0].turnoverPerYearPct.toFixed(0)}%, 25% 넘게 벗어날 때만 맞추면 ${wb[1].rebalances}번 · ${wb[1].turnoverPerYearPct.toFixed(0)}%이고 지수와 다르게 움직이는 정도는 같습니다(${wb[1].tePct.toFixed(2)}%).</li>` : ''}
      <li>수익은 비교하지 않았습니다. 종목을 2026년에 골랐기 때문에 과거 수익을 보면 답을 알고 본 결과가 됩니다. ${ercPlan ? '목표 비중은 위험을 같게 나눈 비중입니다(2026-11-16 적용).' : '목표 비중은 그대로 같은 비중입니다.'}</li>${S.mock?.planChange?.candidate ? '<li>위험을 같게 나눈 비중은 "종목별 목표 비중"에 다음 계획 후보로 올라와 있습니다(적용 전 · 사고팔 금액 표시).</li>' : ''}</ul></details>
    </details></div>`;
}
function renderRisk() {
  const box = $('#rl-risk-body'); if (!box) return; const c = ruleCtx(), pf = pfData(), V = variantOf(c.level) || 'C';
  let live = '<p class="cr-muted">보유 자료를 불러오면 지금 위험을 계산합니다.</p>', tiles = '';
  if (S.positions.length && Object.keys(S.risk).length) { const e = guard('evaluate', () => evaluate(state()));
    if (e?.varNow?.ok && e.total > 0) { const now = e.varNow.var95 / e.total * 100, over = now > c.rules.dailyLoss * 1.001, after = e.varTarget?.ok ? e.varTarget.var95 : null;
      live = `<p class="rl-cap">지금 나쁜 날 하루 손실 <b>−${won(e.varNow.var95)}</b> · 총자산의 ${now.toFixed(2)}% · 한도 ${c.rules.dailyLoss}% ${over ? '<b class="rl-bad">어김</b>' : '지킴'}</p>`;
      tiles = `<div><span>나쁜 날 하루 손실(지금)</span><b>−${won(e.varNow.var95)}</b><small>총자산의 ${now.toFixed(2)}%</small></div><div><span>목표대로 맞추면</span><b>${after === null ? '—' : '−' + won(after)}</b><small>${after === null ? '' : `총자산의 ${(after / e.total * 100).toFixed(2)}% · 한도 ${c.rules.dailyLoss}%`}</small></div>`; } }
  if (pf) { const r = pf.variants[V], h = pf.hold;
    tiles += `<div><span>과거 최대 하락폭</span><b>${r.all.mdd}%</b><small>그냥 보유 ${h.all.mdd}%</small></div><div><span>과거 가장 나빴던 1년</span><b>${r.all.worst12}%</b><small>그냥 보유 ${h.all.worst12}%</small></div>`; }
  const br = pf ? pf.variants[V].dailyLossBreach : null, lossOf = evidence?.variants?.find(v => v.id === V)?.rules?.dailyLoss;
  box.innerHTML = `${live}<div class="rl-tiles">${tiles}</div>
    ${pf ? `<p class="rl-cap">과거 기록: ${esc(PF_NAMES[RL.pf])} · ${variantOf(c.level) ? '지금 규칙' : '기본 규칙(직접 정한 규칙은 과거 결과 없음)'} · ${esc(evidence.from.slice(0, 4))}~${esc(pf.to.slice(0, 4))}년${br ? ` · 하루 ${lossOf}% 넘게 잃은 날 ${br.hold}% → ${br.rule}%` : ''}</p>` : ''}
    ${guard('sizing', sizingHtml) || ''}`;
}

function renderPast() {
  const box = $('#rl-past-body'); if (!box) return; document.querySelectorAll('#rl-pf [data-pf]').forEach(b => b.classList.toggle('on', b.dataset.pf === RL.pf));
  const pf = pfData(); if (!pf) return; const c = ruleCtx(), V = variantOf(c.level) || 'C', r = pf.variants[V], h = pf.hold, names = Object.keys(h.all.crisis || {});
  const better = names.filter(n => r.all.crisis?.[n] && r.all.crisis[n].ret > h.all.crisis[n].ret).length;
  // 2026-11-27 보완 2: 문장 대신 숫자 라벨(어떻게 셌는지는 ⓘ).
  const s = rehearsal?.summary, head = s && V === 'C' ? `<p class="rl-cap">${s.cells}번 중 그냥 보유보다 덜 빠짐 <b>${Math.round(s.shareSmallerMddThanHold * s.cells)}번</b> · 수익 더 높음 <b>${Math.round(s.shareBetterRetThanHold * s.cells)}번</b> ${tip(`기간 ${rehearsal.windows.length}개 × 예시 포트폴리오 ${Object.keys(rehearsal.portfolios).length}개, ${s.cells}번 적용한 결과입니다.\n기간: ${rehearsal.windows.map(w => w.label).join(' · ')}. 기본 규칙 기준이고, 수익 차이의 중간값은 ${s.medianRetDiffVsHoldPct.toFixed(1)}%p, 최대 하락폭 차이의 중간값은 ${s.medianMddDiffVsHoldPct.toFixed(1)}%p입니다.`)}</p>` : '';
  const dates = { '코로나 급락': '2020-02~03', '2022 하락장': '2022-01~10', '2026 하반기': '2026-06~' };
  // '덜 잃는 대신 덜 벌었습니다'는 숫자가 그럴 때만, 전체 기간 제목 옆 ⓘ 에 쓴다(최대 하락폭이 작고 연 수익도 낮을 때 · 숫자는 바로 아래 타일).
  const tradeOff = r.all.mdd > h.all.mdd && r.all.cagr < h.all.cagr ? tip('덜 잃는 대신 덜 벌었습니다.') : '';
  box.innerHTML = `${head}
    ${variantOf(c.level) ? '' : `<p class="cr-note">기본 규칙 결과 ${tip('직접 정한 규칙은 과거 결과가 없어 기본 규칙 결과를 보여 줍니다.')}</p>`}
    <div class="rl-pastgrid"><div>
      <p class="rl-cap">하락장 ${names.length}번 중 <b>${better}번</b> 덜 잃음 · ${esc(PF_NAMES[RL.pf])}</p>
      <div class="table-wrap"><table class="cr-table rl-crisis"><thead><tr><th>구간</th><th>그냥 보유</th><th>규칙대로</th></tr></thead><tbody>${names.map(n => `<tr><td>${esc(n)} <small class="cr-muted">${esc(dates[n] || '')}</small></td><td>${h.all.crisis[n].ret}%<small class="cr-muted"> 최대 하락폭 ${h.all.crisis[n].mdd}%</small></td><td><b>${r.all.crisis?.[n]?.ret ?? '—'}%</b><small class="cr-muted"> 최대 하락폭 ${r.all.crisis?.[n]?.mdd ?? '—'}%</small></td></tr>`).join('')}</tbody></table></div>
    </div><div>
      <p class="rl-cap">${esc(evidence.from.slice(0, 4))}~${esc(pf.to.slice(0, 4))}년 전체 ${tradeOff}</p>
      <div class="rl-tiles two"><div><span>최대 하락폭</span><b>${r.all.mdd}%</b><small>그냥 보유 ${h.all.mdd}%</small></div><div><span>연 수익</span><b>${r.all.cagr}%</b><small>그냥 보유 ${h.all.cagr}%</small></div><div><span>매매 ${tip('한 번에 낸 비중 맞추기 주문은 1번으로 셉니다.')}</span><b>연 ${r.trading.tradesPerYear}회</b><small>매매 횟수 상한을 넘긴 기간 ${r.trading.over30DayLimitShare}%</small></div></div>
    </div></div>`;
}

// ── 규칙 지킨 기록: 팀 모의계좌의 기록(PC 가 연결돼 있으면 실시간, 아니면 하루 1번 공개 자료)을 그 계좌 자신의 규칙으로 잰다.
// 규칙 화면을 열 때마다(teamquant:page) 다시 불러오므로 '다시 불러오기' 버튼은 지웠다. 대신 기준 시각을 글자로 보인다.
async function mockStatus() { try { const s = await privateRead('paper-live-status'); return { ...s, live: true }; } catch { } try { const r = await fetch('/data/paper-live-public.json', { cache: 'no-store' }); if (r.ok) return { ...(await r.json()), live: false }; } catch { } return null; }
let reviewRun = 0;
async function renderReview() {
  const box = $('#cr-review-body'); if (!box) return; const id = ++reviewRun, kind = acct();
  const st = await mockStatus(); if (id !== reviewRun) return; RL.pc = st?.live ? st : null; guard('pc', renderPcBlock);
  // 예시·내 계좌: 내 줄만 위에 보이고, 팀 모의계좌 기록은 '팀 모의계좌 기록' 접힘 안에 둔다(남의 계좌 숫자가 내 것처럼 보이지 않게).
  const own = kind === 'demo' || kind === 'real' ? guard('own', () => { const e = S.positions.length && Object.keys(S.risk).length ? evaluate(state()) : null, c = ruleCtx(); return `<p class="rl-cap">${e ? `오늘 규칙 ${e.known}개 중 <b>${e.okCount}개</b> 지킴` : '오늘 점검은 보유 자료를 불러온 뒤 계산합니다'} · 규칙 변경 ${c.changes}회</p>`; }) || '' : '';
  if (!st) { box.innerHTML = `${own}<p class="cr-muted">팀 모의계좌 기록을 받지 못했습니다.</p>`; return; }
  const rules = normalizeRules(st.prefs?.rules || {}).rules; let indexPct = null;
  if (Number.isFinite(st.benchmark?.benchRetPct)) indexPct = st.benchmark.benchRetPct / 100;
  else { try { const m0 = st.marks?.[0]; if (m0) { const d = await fetchCandles('069500', 'KRW', '1y'); const cs = (d.candles || []).filter(x => x.close > 0), base = cs.find(x => x.date >= m0.date); indexPct = base ? cs.at(-1).close / base.close - 1 : null; } } catch { } }
  if (id !== reviewRun) return;
  const r = reviewRules(st, rules, { indexPct }), hist = (st.prefsHistory || []).filter(x => !(x.changed || []).includes('init'));
  const asOf = st.live ? '실시간' : `하루 1번 공개${st.asOf ? ` · ${kdt(st.asOf)} 기준` : ''}`;
  const team = `<p class="rl-cap">${own ? '팀 모의계좌 · ' : ''}자동 매매 <b>${r.days}일째</b> · 하루 한도(${rules.dailyLoss}%) 넘은 날 <b>${r.dailyBreaches}일</b> / ${Math.max(0, r.days - 1)}일 · 30일 매매 <b>${r.trades30}번</b>${tip('한 번에 낸 비중 맞추기 주문은 1번으로 셉니다.')} (상한 ${rules.maxTrades30}번) · 규칙 변경 <b>${hist.length}회</b> <small class="cr-muted">${esc(asOf)}</small></p>
    <ul class="cr-find">${r.findings.map(f => `<li><span class="ct-chip ${f.tone > 0 ? 'ok' : f.tone < 0 ? 'bad' : 'na'}">${f.tone > 0 ? '좋음' : f.tone < 0 ? '주의' : '참고'}</span><div><b>${esc(f.text)}</b>${f.tip ? tip(f.key === 'blocked' ? f.tip.replace(/\(\d+(?= \d+건)/g, '') : f.tip) : ''}${f.suggest ? `<small>${esc(f.suggest)}</small>` : ''}</div></li>`).join('')}</ul>
    ${hist.length ? `<details class="rl-in"><summary>규칙을 바꾼 기록 ${hist.length}건</summary><ul class="cr-facts">${hist.slice().reverse().map(x => `<li>${esc(md(kday(x.at)))} · ${esc((x.changed || []).map(ruleName).join(', '))} · 이유: ${esc(x.reason || '(없음)')}</li>`).join('')}</ul></details>` : ''}`;
  box.innerHTML = `${own}${own ? `<details class="rl-in" id="cr-team"><summary>팀 모의계좌 기록 ${tip(`${kind === 'demo' ? '예시 자산' : '내 계좌'}는 날마다 기록이 없어 오늘 시점만 보입니다. 이 기록은 같은 방식으로 자동 매매 중인 팀 모의계좌 것입니다.`)}</summary>${team}</details>` : team}
    <div class="cr-actions"><button type="button" class="text-button" data-core-go="paper">모의투자에서 보기</button></div>`;
}

// ── 규칙 바꾸기(예시·실계좌): 수준을 고르거나 숫자를 직접 넣고 → 변경 내용 확인 → 확정. 확정 뒤 28일은 잠긴다(lib/rule-presets.js changeGate).
function ruleInput(d, v) {
  if (d.type === 'bool') return `<label class="cr-rule bool"><span>${esc(d.label)}${tip(d.help)}</span><input type="checkbox" name="${d.id}" ${v ? 'checked' : ''}></label>`;
  return `<label class="cr-rule"><span>${esc(d.label)}${tip(d.help)}</span><span class="cr-in"><input type="number" name="${d.id}" value="${v}" min="${d.min}" max="${d.max}" step="${d.step}" inputmode="decimal"><em>${esc(d.unit)}</em></span></label>`;
}
function renderChange({ keepForm = false } = {}) {
  const fold = $('#rl-change'); if (!fold) return; const c = ruleCtx();
  fold.hidden = c.readOnly && !RL.pc; if (c.kind === 'none') fold.hidden = true;
  $('#rl-change-state').textContent = RL.prefillNote && RL.pick === 'custom' ? RL.prefillNote : c.readOnly ? '팀 모의계좌 규칙은 팀 PC에서만' : c.locked ? `${md(kday(c.lockedUntil))}부터 가능` : c.confirmedAt ? '지금 바꿀 수 있음 · 이유 필요' : '아직 확정 전';
  if (RL.pick === null) RL.pick = c.level;
  const pf = pfData(), card = (id, title, sub, num) => `<label class="rl-level ${RL.pick === id ? 'on' : ''}"><input type="radio" name="rl-level" value="${id}" ${RL.pick === id ? 'checked' : ''}><b>${esc(title)}</b><span>${esc(sub)}</span><small>${num}</small></label>`;
  // 2026-11-27(F2-16): 수준 카드에는 연 수익 숫자를 두지 않고, 어느 기간·대상·비용의 과거 결과인지 한 줄을 붙인다.
  $('#rl-levels').innerHTML = RULE_LEVELS.map(l => { const v = pf?.variants?.[l.variant]; return card(l.id, l.label, l.note, v ? `최대 하락폭 ${v.all.mdd}% · 매매 연 ${v.trading.tradesPerYear}회 · 매매 횟수 상한을 넘긴 기간 ${v.trading.over30DayLimitShare}%` : '과거 자료를 불러오는 중'); }).join('') + card('custom', '직접 입력', '숫자를 하나씩 정함', '<span class="rl-badge warn">과거 확인 없음</span>');
  // 기간 · 대상 · 비용은 라벨로 보이고, 생존 편향·보장 없음은 ⓘ(LEGAL 5.2 수익률 배지 ⓘ)에 둔다(2026-11-27 보완 2).
  const lvNote = $('#rl-levels-note'); if (lvNote) lvNote.innerHTML = pf && Number.isFinite(evidence?.cost) ? `과거 결과 ${esc(String(pf.from).slice(0, 4))}~${esc(String(pf.to).slice(0, 4))} ${tip(`${pf.label} · ${pf.from}~${pf.to} · 비용 ${+(evidence.cost * 100).toFixed(2)}%\n지금 살아남은 종목이라 실제보다 좋게 나옵니다. 과거 결과는 앞으로의 수익을 보장하지 않습니다.`)}` : '';
  $('#rl-custom').hidden = RL.pick !== 'custom';
  const adv = $('#cr-adv-sum'); if (adv) adv.textContent = c.rules.perAssetVol ? '변동성 규칙 (켬)' : '변동성 규칙 (기본 끔)';
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
    if (e0 && e1) { today = `지킴 ${e0.okCount}/${e0.known} → <b>${e1.okCount}/${e1.known}</b> · 할 일 ${e0.actions.length}건 → <b>${e1.actions.length}건</b>`; if (e1.varNow?.ok && e1.total > 0) risk = `<tr><td>나쁜 날 하루 손실</td><td>총자산의 ${(e1.varNow.var95 / e1.total * 100).toFixed(2)}% · 새 한도 ${cand.dailyLoss}%</td></tr>`; } }
  const lv = levelOf(cand), until = md(kday(Date.now() + RULE_LOCK_DAYS * 864e5)), blocked = !g.ok && (g.code === 'locked' || g.code === 'same');
  box.hidden = false;
  box.innerHTML = `<div class="rl-confirm"><h4>변경 내용 확인</h4><table class="cr-table"><tbody>
      <tr><td>바뀌는 값</td><td>${diff}</td></tr><tr><td>오늘 점검</td><td>${today}</td></tr>${risk}
      <tr><td>과거 자료 확인</td><td>${lv === 'custom' ? '없음 · 직접 정한 값' : `있음 · ${esc(RULE_LEVELS.find(l => l.id === lv).label)}`}</td></tr>
      <tr><td>잠금</td><td>${RULE_LOCK_DAYS}일 · <b>${esc(until)}</b>부터 다시 바꿀 수 있습니다</td></tr></tbody></table>
    ${blocked ? `<p class="cr-err">${esc(g.why)}</p>` : `${g.first ? '' : `<label class="ck-field"><span>바꾸는 이유 (10자 이상 · 기록에 남음)</span><input id="rl-reason" maxlength="300" placeholder="예: 11월 기록에서 하루 한도를 넘은 날이 3일이라 한 단계 낮춤"></label>`}
      <div class="cr-actions"><button type="button" class="primary" id="rl-commit">확정</button><button type="button" class="text-button" id="rl-cancel">취소</button><span class="cr-err" id="rl-commit-err"></span></div>`}</div>`;
  // 2026-11-27 첫 규칙 3단계(tutorial-ui.js): 확인 표가 실제로 보였을 때만 알린다(①을 '확인만 함'으로 센다).
  window.dispatchEvent(new CustomEvent('teamquant:rules-preview', { detail: { blocked } }));
}
function commitChange() {
  const c = ruleCtx(), { rules: cand } = candidateRules(), reason = $('#rl-reason')?.value || '', res = applyChange(c.saved, cand, { reason });
  if (!res.ok) { $('#rl-commit-err').textContent = res.why; return; }
  if (!save({ ...res.value, plan: c.saved?.plan || null })) { $('#rl-commit-err').textContent = '이 브라우저에 저장하지 못했습니다(저장 공간이 막혀 있음).'; return; }
  window.dispatchEvent(new Event('teamquant:rules-confirmed')); // 저장이 된 뒤에만(첫 규칙 3단계 ① '확정함')
  RL.pick = null; RL.prefillNote = ''; $('#rl-confirm').hidden = true; $('#rl-change').open = false; renderRules(); renderToday(); S.loading = loadAll(); $('#cr-saved').textContent = '확정했습니다';
}
// 다른 화면(모의투자 › 과거 시세로 테스트의 '이 규칙을 규칙 화면에 넣기')이 넘긴 규칙을 '규칙 바꾸기 › 직접 입력'에 채워 둔다.
// 저장은 하지 않는다: 확정은 여기서 '변경 내용 확인 → 확정'을 거쳐야 하고(28일 잠금 · 이유 · 바꾼 기록), 잠겨 있거나 팀 모의계좌면 채우지 않는다.
// 받는 길: window 'teamquant:rules-prefill'(detail {label, rules, prefs, at}) 또는 규칙 화면을 열 때 sessionStorage 'teamQuantRulesPrefill'(5분 안).
const PREFILL_KEY = 'teamQuantRulesPrefill';
function applyPrefill(detail) {
  const at = Date.parse(detail?.at || ''); if (!detail?.rules || !Number.isFinite(at) || Date.now() - at > 5 * 60e3 || RL.prefillAt === detail.at) return;
  const fold = $('#rl-change'), state = $('#rl-change-state'); if (!fold || !state) return;
  RL.prefillAt = detail.at; try { sessionStorage.removeItem(PREFILL_KEY); } catch { }
  const c = ruleCtx();
  if (c.readOnly) { state.textContent = '팀 모의계좌 규칙은 팀 PC에서만'; return; }
  if (c.locked) { fold.open = true; state.textContent = `${md(kday(c.lockedUntil))}부터 바꿀 수 있어 채우지 않았습니다`; return; }
  RL.pick = 'custom'; fold.open = true; $('#rl-confirm').hidden = true; renderChange();
  for (const d of RULE_DEFS) { if (!(d.id in detail.rules)) continue; const el = rulesPage.querySelector(`#rl-custom [name="${d.id}"]`); if (!el) continue; if (d.type === 'bool') el.checked = Boolean(detail.rules[d.id]); else el.value = detail.rules[d.id]; }
  RL.prefillNote = `규칙 화면에 '${detail.label || '고른'}' 규칙을 채워 두었습니다. 확정해야 바뀝니다.`; state.textContent = RL.prefillNote;
  fold.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const storedPrefill = () => { try { return JSON.parse(sessionStorage.getItem(PREFILL_KEY) || 'null'); } catch { return null; } };
window.addEventListener('teamquant:rules-prefill', e => guard('prefill', () => applyPrefill(e.detail)));
// 팀 PC 에 연결돼 있을 때만: 팀 모의계좌의 규칙을 바꾼다. 서버가 28일 제한과 이유를 강제하고, 저장하면 다음 장에 전체 비중 맞추기 주문이 나간다.
const PC_SAVE_LABEL = '팀 모의계좌에 저장 (다음 장에 비중 맞추기 주문)';
let pcArmed = false;
function renderPcBlock() {
  const box = $('#rl-pc'); if (!box) return; const st = RL.pc; box.hidden = !st; if (!st) return; renderChange({ keepForm: true });
  const next = st.prefsNextChangeAt && Date.parse(st.prefsNextChangeAt) > Date.now() ? md(kday(st.prefsNextChangeAt)) : null;
  // 주문이 나간다는 경고라 간결 화면에서도 보이게 둔다(cr-note).
  box.innerHTML = `<div class="rl-confirm"><h4>팀 모의계좌 규칙 (이 PC) ${tip('팀 모의계좌 자동 매매가 쓰는 규칙입니다. 저장하면 다음 장에 전체 비중 맞추기 주문이 나갑니다(오른 종목도 목표 비중으로 되돌림).\n저장 뒤 정해진 기간에는 다시 못 바꾸고, 바꿀 때마다 이유가 공개 자료에 남습니다.')}</h4>
    <p class="cr-note">저장하면 다음 장에 전체 비중 맞추기 주문이 나갑니다${next ? ` · <b>${esc(next)}</b>부터 바꿀 수 있음` : ''} · ${st.prefs?.savedAt ? `마지막 저장 ${esc(md(kday(st.prefs.savedAt)))}` : '저장한 적 없음(기본 규칙)'}</p>
    <div class="pp-form"><label class="ck-field"><span>바꾸는 이유</span><input id="cq-reason" maxlength="300" placeholder="예: 20거래일 기록에서 하루 한도 초과 0일 · 한도 유지 확인"></label><label class="ck-field"><span>기대하는 결과</span><input id="cq-expect" maxlength="300" placeholder="예: 한도 초과일 10% 아래"></label></div>
    <div class="cr-actions"><button type="button" class="secondary" id="cq-pc" ${next ? 'disabled' : ''}>${PC_SAVE_LABEL}</button><span class="cr-muted" id="cq-pc-state"></span></div></div>`;
  pcArmed = false;
}
async function savePc() {
  const st = $('#cq-pc-state'), btn = $('#cq-pc'), { rules: cand, errors } = candidateRules(); if (errors.length || !cand) { st.textContent = errors.join(' ') || '규칙을 골라 주세요.'; return; }
  if (!pcArmed) { pcArmed = true; btn.textContent = '한 번 더 누르면 저장 · 다음 장에 비중 맞추기 주문'; return; }
  st.textContent = 'PC에 보내는 중…';
  try { const r = await privateRead('paper-live-prefs', { rules: cand, cadence: 'weekly', sectorCap: null, prefs: { level: levelOf(cand) }, reason: $('#cq-reason')?.value.trim() || '', expected: $('#cq-expect')?.value.trim() || '' }); st.textContent = `저장 ${kdt(r.savedAt) || String(r.savedAt).slice(0, 16).replace('T', ' ')}${r.changed?.length && !r.changed.includes('init') ? ' · 바뀐 규칙 ' + r.changed.map(ruleName).join(', ') + ' (기록에 남음)' : ''}`; void renderReview(); }
  catch (e) { st.textContent = e?.status === 503 ? 'PC에 모의투자 키가 없습니다.' : (e?.message || 'PC 연결이 필요합니다(설정에서 연결).'); pcArmed = false; btn.textContent = PC_SAVE_LABEL; }
}

// ── 종목별 목표 비중 · 현금
function renderPlan(plan, saved) {
  const c = ruleCtx(), box = $('#cr-plan'); if (!box) return;
  if (c.kind === 'paper') { const w = Object.entries(c.mock?.planDoc?.weights || {}).filter(([, v]) => v.pct > 0).sort((a, b) => b[1].pct - a[1].pct);
    $('#rl-plan-state').textContent = w.length ? `${w.length}종목 · 합계 ${w.reduce((a, [, v]) => a + v.pct, 0).toFixed(1)}% · 보기만${c.mock?.planChange ? ` · ${c.mock.planChange.days}일 변경 ${c.mock.planChange.used}/${c.mock.planChange.max}` : ''}` : '';
    box.innerHTML = w.length ? `<div class="table-wrap"><table class="cr-table"><thead><tr><th>종목</th><th>목표</th><th>구분</th></tr></thead><tbody>${w.map(([k, v]) => `<tr><td><b>${esc(v.name || k)}</b> <small class="cr-muted">${esc(k)}</small></td><td>${v.pct}%${v.targetPct ? ` <small class="cr-muted">(분할 매수가 끝나면 ${v.targetPct}%)</small>` : ''}</td><td>${v.role === 'core' ? '지수 ETF' : v.role === 'satellite' ? '개별 종목' : esc(v.role || '')}</td></tr>`).join('')}</tbody></table></div><p class="rl-note">팀 모의계좌의 목표 비중입니다. 종목을 고른 기준은 모의투자 화면에 있습니다.</p>${guard('structure', () => structureHtml(c)) || ''}${planChangeHtml(c.mock.planChange)}` : '<p class="cr-muted">팀 모의계좌 목표 비중을 받지 못했습니다.</p>';
    $('#rl-plan-confirm').hidden = true; $('#rl-plan-hist').innerHTML = '';
    $('#cr-fill').hidden = true; $('#rl-plan-actions').hidden = true; return; }
  $('#cr-fill').hidden = false; $('#rl-plan-actions').hidden = false;
  const rows = [...new Set([...S.positions.map(p => p.symbol), ...Object.keys(plan)])];
  if (!rows.length) { box.innerHTML = '<p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 보유 종목이 나옵니다.</p>'; $('#rl-plan-state').textContent = ''; return; }
  const total = S.positions.reduce((a, p) => a + p.valueKrw, 0) + (Number.isFinite(S.cash) ? S.cash : 0);
  box.innerHTML = `${saved ? '' : '<p class="cr-note">저장한 목표가 없어 지금 비중으로 채워 두었습니다. 고친 뒤 저장해 주세요.</p>'}
    <div class="table-wrap"><table class="cr-table"><thead><tr><th>종목</th><th>지금</th><th>목표</th><th></th></tr></thead><tbody>${rows.map(s => { const p = S.positions.find(x => x.symbol === s), v = plan[s], name = p?.name || v?.name || stockName(s), now = p && total ? p.valueKrw / total * 100 : 0;
      const core = isIndexEtf({ symbol: s, name }); return `<tr data-sym="${esc(s)}" data-name="${esc(name)}" data-cur="${esc(p?.currency || v?.currency || 'KRW')}" data-core="${core ? 1 : 0}"><td><b>${esc(name)}</b>${isLeveraged({ symbol: s, name }) ? '<small class="bad">레버리지·인버스</small>' : core ? ' <small class="cr-muted">지수 ETF · 상한 예외</small>' : ''}</td><td>${now.toFixed(1)}%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="${Number.isFinite(planPctOf(v)) ? planPctOf(v) : 0}" min="0" max="100" step="0.5" inputmode="decimal"><em>%</em></span></td><td>${p ? '' : '<button type="button" class="text-button cr-del">빼기</button>'}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>합계</td><td></td><td id="cr-plan-sum"></td><td></td></tr></tfoot></table></div>
    <form id="cr-add" class="cr-addrow"><input id="cr-add-sym" list="symbols" placeholder="종목 추가 (예: KODEX 200, SPY)" autocomplete="off"><button type="submit" class="secondary">추가</button></form>`;
  const sum = () => { const t = [...document.querySelectorAll('.cr-plan-in')].reduce((a, i) => a + (Number(i.value) || 0), 0); $('#cr-plan-sum').textContent = `${t.toFixed(1)}% · 현금 ${(100 - t).toFixed(1)}%`; $('#rl-plan-state').textContent = `${document.querySelectorAll('.cr-plan-in').length}종목 · 합계 ${t.toFixed(1)}% · 현금 ${(100 - t).toFixed(1)}%${saved ? planGateText(c.saved) : ' · 저장 전'}`; };
  document.querySelectorAll('.cr-plan-in').forEach(i => i.oninput = () => { sum(); $('#rl-plan-confirm').hidden = true; }); sum(); $('#rl-plan-hist').innerHTML = planHistHtml(c.saved);
  document.querySelectorAll('.cr-del').forEach(b => b.onclick = () => { b.closest('tr').remove(); sum(); });
  $('#cr-add').onsubmit = async ev => { ev.preventDefault(); const t = $('#cr-add-sym').value.trim(); if (!t) return; try { const sym = /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t) ? t.toUpperCase() : (await resolveStockInput(t)).split('.')[0]; const tr = document.createElement('tr'); const name = /^[A-Z]/.test(sym) ? sym : stockName(sym); tr.dataset.sym = sym; tr.dataset.name = name; tr.dataset.cur = /^[A-Z]/.test(sym) ? 'USD' : 'KRW'; tr.innerHTML = `<td><b>${esc(name)}</b></td><td>0.0%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="5" min="0" max="100" step="0.5"><em>%</em></span></td><td><button type="button" class="text-button cr-del">빼기</button></td>`; $('#cr-plan tbody').append(tr); tr.querySelector('.cr-plan-in').oninput = sum; tr.querySelector('.cr-del').onclick = () => { tr.remove(); sum(); }; $('#cr-add-sym').value = ''; sum(); } catch (e2) { $('#rl-plan-err').textContent = e2.message; } };
}
function readPlan(rules) {
  const plan = {}, errors = [];
  for (const tr of document.querySelectorAll('#cr-plan tbody tr')) { const v = Number(tr.querySelector('.cr-plan-in')?.value), core = tr.dataset.core === '1'; if (v > 0) plan[tr.dataset.sym] = { pct: v, name: tr.dataset.name, currency: tr.dataset.cur, ...(core ? { capExempt: true } : {}) }; if (!core && v > rules.maxSingle) errors.push(`${tr.dataset.name} 목표 ${v}%가 한 종목 최대 비중 ${rules.maxSingle}%를 넘습니다.`); }
  const sum = Object.values(plan).reduce((a, v) => a + v.pct, 0); if (sum > 100 - rules.minCash + 0.05) errors.push(`목표 합계 ${sum.toFixed(1)}%가 (100 − 현금 최소 ${rules.minCash}%)를 넘습니다.`);
  return { plan, errors };
}
// 계획 변경 한도(결정 36): 처음 저장은 바로 되고, 그 뒤에는 30일 안에 2번까지 · 바꾸기 전에 사고파는 금액을 보이고 이유를 받는다(lib/rule-presets.js planChangeGate).
// 한도를 넣기 전에 저장한 기록(v 없음)은 세지 않는다. 브라우저 저장소를 지우면 풀리는 자기 약속 장치다(규칙 잠금과 같다).
const planChangesOf = saved => (saved?.history || []).filter(h => h.kind === 'plan' && h.v === 2 && !h.first);
const planGateText = saved => { const g = planChangeGate(planChangesOf(saved)); return ` · ${PLAN_CHANGE_DAYS}일 변경 ${g.used}/${g.max}${g.ok ? '' : ` · ${md(kday(g.allowedAt))}부터 가능`}`; };
const manwon = v => `${Math.round(v / 1e4).toLocaleString('ko-KR')}만 원`;
const planEstimate = plan => planTurnover({ positions: S.positions, cashKrw: Number.isFinite(S.cash) ? S.cash : 0, plan });
const shortName = n => String(n || '').replace(/\s*\(.*\)$/, '');
function planHistHtml(saved) {
  const h = (saved?.history || []).filter(x => x.kind === 'plan'); if (!h.length) return '';
  return `<details class="rl-in"><summary>목표 비중을 바꾼 기록 ${h.length}건</summary><ul class="cr-facts">${h.slice().reverse().map(x => `<li>${esc(md(kday(x.at)))} · ${x.first ? '처음 저장' : x.v === 2 ? `변경${Number.isFinite(x.tradedPct) ? ` · 바뀐 크기 총자산의 ${x.tradedPct}%` : ''} · 이유: ${esc(x.reason || '(없음)')}` : '변경(한도를 넣기 전)'}</li>`).join('')}</ul></details>`;
}
// 구조 질문(결정 37): 지금 계획의 개별 종목과 후보 계획에 새로 들어오는 종목마다 ⑥ 수요·돈 내는 곳 ⑦ 중국 경쟁 · 깨짐 조건 상태 · 출처를 보인다. data/structure-cards.json 을 읽기만 한다.
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '출처'; } };
function structureHtml(c) {
  const S = structure; if (!S?.companies || !S.labels) return '';
  // 수요 등급의 비유(순풍·역풍)는 화면에서 쉬운 말로 바꿔 보인다(용어표 #198 · 자료 파일 값은 그대로).
  const L = { ...S.labels, demand: { ...S.labels.demand, tail: '늘어남', head: '줄어듦' } }, w = c.mock?.planDoc?.weights || {}, pc = c.mock?.planChange || {}, cand = pc.pending || pc.candidate || null, clName = cl => L.cluster?.[cl] || cl;
  const held = Object.entries(w).filter(([, v]) => v.role === 'satellite' && v.pct > 0).map(([k]) => k), incoming = (cand?.diff || []).filter(d => d.toPct > 0 && !(w[d.symbol]?.pct > 0)).map(d => d.symbol);
  const keys = [...new Set([...held, ...incoming])].filter(k => S.companies[k]); if (!keys.length) return '';
  const blocked = e => [...(S.rules.exclude.demand.includes(e.demand.grade) ? [`수요 ${L.demand[e.demand.grade]}`] : []), ...(S.rules.exclude.china.includes(e.china.grade) ? [`중국 경쟁 ${L.china[e.china.grade]}`] : []), ...(e.breaks || []).filter(b => b.now === 'met').map(() => '제외 조건 해당'), ...(e.asOf && (Date.now() - Date.parse(e.asOf)) / 864e5 > (S.rules.reviewDays || 100) ? [`${S.rules.reviewDays || 100}일 넘게 다시 확인 안 함`] : [])];
  const chip = now => `<span class="ct-chip ${now === 'met' ? 'bad' : now === 'clear' ? 'ok' : 'na'}">${esc(L.now[now] || now)}</span>`;
  const facts = (e, q) => (e[q].facts || []).map(f => `<li>${esc(f.text)} <small class="cr-muted">(${esc(f.period || '')}${f.kind === 'estimate' ? ' · 전망' : ''} · <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(f.url))}</a> ${esc(f.date)})</small></li>`).join('');
  const byCluster = {}; for (const k of held) { const cl = S.companies[k]?.cluster; if (cl) (byCluster[cl] = byCluster[cl] || []).push(S.companies[k].name); }
  const dup = Object.entries(byCluster).filter(([, v]) => v.length > 1), stop = held.filter(k => S.companies[k] && blocked(S.companies[k]).length);
  const rows = keys.map(k => { const e = S.companies[k], r = blocked(e), isNew = incoming.includes(k);
    return `<tr><td><b>${esc(e.name)}</b><small class="cr-muted">테마 ${esc(clName(e.cluster))}${isNew ? ' · 후보에 새로' : ''}</small></td>
      <td><b>${esc(L.demand[e.demand.grade])}</b> · ${esc(e.demand.driver)}<small>돈 내는 곳 ${esc(L.payer[e.demand.payer] || '')} · 값은 ${esc(L.pricing[e.demand.pricing] || '')}</small></td>
      <td><b>${esc(L.china[e.china.grade])}</b> · ${esc((e.china.competitors || []).slice(0, 2).join(', ') || '뚜렷한 경쟁자 없음')}<small>중국 매출 ${e.china.chinaRevenuePct == null ? '확인 안 됨' : `${e.china.chinaRevenuePct}%`} · 지키는 힘 ${esc((e.china.defense || []).map(d => L.defense[d] || d).join('·'))}</small></td>
      <td class="sq-breaks">${(e.breaks || []).map(b => `<div>${chip(b.now)} ${esc(b.text)}${b.evidence ? `<small class="cr-muted">${esc(b.evidence)}</small>` : ''}</div>`).join('')}</td>
      <td>${r.length ? `<span class="rl-badge warn">제외</span><small>${esc(r.join(' · '))}</small>` : '<span class="rl-badge ok">통과</span>'}</td></tr>
      <tr class="sq-more"><td colspan="5"><details class="rl-in"><summary>${esc(e.name)} 근거 자료 ${(e.demand.facts || []).length + (e.china.facts || []).length}건 · ${esc(md(e.asOf))} 기준</summary><p><b>수요</b> ${esc(e.demand.text)}</p><ul class="cr-facts">${facts(e, 'demand')}</ul><p><b>중국</b> ${esc(e.china.text)}</p><ul class="cr-facts">${facts(e, 'china')}</ul>${(e.unverified || []).length ? `<p class="cr-muted">확인하지 못한 것: ${esc(e.unverified.join(' · '))}</p>` : ''}</details></td></tr>`; }).join('');
  const lead = `개별 ${held.length}종목 중 <b>${held.length - stop.length}종목</b> 통과${stop.length ? ` · 제외된 종목: ${stop.map(k => `<b>${esc(S.companies[k].name)}</b>(${esc(blocked(S.companies[k]).join(' · '))})`).join(', ')}` : ''}${dup.length ? ` · 같은 테마에 여러 종목: ${dup.map(([cl, v]) => `${esc(clName(cl))}(${esc(v.join('·'))})`).join(', ')} — 다음 계획 후보에는 점수가 높은 하나만 담습니다` : ''}`;
  return `<div class="rl-sizing rl-sq"><h4 class="rl-h4">10년 수요·중국 경쟁 점검 ${tip(`인구구조 변화·중국의 부상을 보고 종목마다 두 가지를 봅니다.\n1) 10년 뒤 주력 제품 수요가 인구·구조 변화로 느는지, 그 돈은 누가 내고 값은 누가 정하는지.\n2) 같은 것을 만드는 중국 기업이 있는지, 중국 매출 비중과 지키는 힘(기술·인허가 대 정책)은 무엇인지.\n수요 줄어듦 · 중국 경쟁 높음 · 제외 조건 해당이면 다음 계획에서 뺍니다. 사람이 출처·날짜를 붙여 한 판단이라 과거로 확인할 수 없고 ${S.rules.reviewDays}일마다 다시 봅니다. 수익 예측이 아닙니다.`)}</h4>
    <p class="rl-cap">${lead}</p><div class="table-wrap"><table class="cr-table rl-sqt"><thead><tr><th>종목</th><th>수요 · 돈 내는 곳</th><th>중국 경쟁</th><th>제외 조건</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="rl-cap">${esc(md(S.asOf))} 기준 · 제외 조건이 "확인 전"이면 빼지 않습니다(다음 점검에서 확인).</p></div>`;
}
function planChangeHtml(pc) {
  if (!pc) return '';
  // 계획 버전 코드(PP3·PP4c 같은 내부 이름)는 화면에 쓰지 않는다. 기록은 날짜로만 보인다(바뀐 종목 수는 공개 자료에 없음).
  const tv = t => (t ? `사고팔 금액 약 <b>${Number.isFinite(t.changeKrw) ? manwon(t.changeKrw) : '—'}</b> · 총자산의 ${t.changePct}% ${tip(`지금 보유에서 새 계획까지 맞추는 금액은 ${manwon(t.tradedKrw)}${Number.isFinite(t.baseTradedKrw) ? `이고, 지금 계획까지도 ${manwon(t.baseTradedKrw)}이 남아 있습니다(아직 덜 산 종목 포함).` : '입니다.'}`)}` : '사고팔 금액은 잔고를 읽은 뒤 계산합니다');
  const table = (d, why = {}) => `<details class="rl-in"><summary>바뀌는 비중 ${d.length}종목</summary><div class="table-wrap"><table class="cr-table rl-size"><thead><tr><th>종목</th><th>지금 목표</th><th>바꾸면</th></tr></thead><tbody>${d.map(x => `<tr><td>${esc(shortName(x.name))}${x.toPct === 0 && why[x.symbol] ? `<small class="cr-muted rl-why-line">${esc(String(why[x.symbol]).replace(/^전환: /, ''))}</small>` : ''}</td><td>${x.fromPct}%</td><td><b>${x.toPct}%</b></td></tr>`).join('')}</tbody></table></div></details>`;
  const pend = pc.pending, cand = pc.candidate;
  return `<div class="rl-sizing"><h4 class="rl-h4">계획 변경 ${tip(`팀 기본 계획(목표 비중)은 ${pc.days}일 안에 ${pc.max}번까지 바꿀 수 있습니다. 실적 발표나 큰 이슈에는 대응하되 매번 바꾸지는 않게 하는 한도입니다.\n한도를 넘는 계획은 받아들이지 않고 지금 계획으로 자동 매매를 이어 가다가 한도가 풀리면 적용합니다. 공시 대응과 분할 매수는 규칙이 정한 움직임이라 세지 않습니다.${pc.since ? ` ${md(kday(pc.since))}부터 셉니다.` : ''}`)}</h4>
    <p class="rl-cap">최근 ${pc.days}일 <b>${pc.used}/${pc.max}회</b> 사용${pc.allowedAt ? ` · ${esc(md(kday(pc.allowedAt)))}부터 다시 바꿀 수 있음` : ` · ${pc.left}회 남음`}</p>
    ${pend ? `<p class="cr-err">새 계획이 대기 중입니다. 한도를 다 써서 ${pend.allowedAt ? esc(md(kday(pend.allowedAt))) : '한도가 풀리는 날'}부터 적용됩니다. ${tv(pend.turnover)}</p>${pend.diff?.length ? table(pend.diff, pend.reasons) : ''}` : ''}
    ${cand ? `<p class="rl-cap"><b>다음 계획 후보</b> ${tip('아직 적용하지 않은 계획입니다. 적용하면 변경 1회를 쓰고 다음 장에 비중 맞추기 주문이 나갑니다. 금액은 지금 보유와 후보 비중의 차이를 단순히 더한 값입니다(1주 단위 · 주문 한도 · 규칙 적용 전).')} ${cand.label ? `${esc(cand.label)} · ` : ''}${tv(cand.turnover)}</p>${cand.note ? `<p class="rl-note">${esc(cand.note)}</p>` : ''}${cand.diff?.length ? table(cand.diff, cand.reasons) : ''}` : ''}
    ${pc.changes?.length ? `<details class="rl-in"><summary>계획을 바꾼 기록 ${pc.changes.length}건</summary><ul class="cr-facts">${pc.changes.slice().reverse().map(x => `<li>${esc(md(kday(x.at)))} · 계획 변경</li>`).join('')}</ul></details>` : ''}</div>`;
}
function savePlan() {
  const c = ruleCtx(); if (c.readOnly) return; const { plan, errors } = readPlan(c.rules), box = $('#rl-plan-confirm'); $('#rl-plan-err').textContent = errors.join(' '); $('#rl-plan-saved').textContent = ''; box.hidden = true; if (errors.length) return;
  const prevPlan = c.saved?.plan || null; if (!prevPlan) return commitPlan(plan, { first: true });
  if (planSig(prevPlan) === planSig(plan)) { $('#rl-plan-err').textContent = '바뀐 값이 없습니다.'; return; }
  const g = planChangeGate(planChangesOf(c.saved));
  if (!g.ok) { $('#rl-plan-err').textContent = `${PLAN_CHANGE_DAYS}일 안에 ${g.max}번 바꿨습니다. ${md(kday(g.allowedAt))}부터 바꿀 수 있습니다.`; return; }
  const diff = planDiff(prevPlan, plan), t1 = planEstimate(plan), t0 = planEstimate(prevPlan), size = planChangeSize(prevPlan, plan, t1?.totalKrw ?? null);
  box.dataset.sig = planSig(plan); box.hidden = false;
  box.innerHTML = `<div class="rl-confirm"><h4>목표 비중 변경 확인</h4><table class="cr-table"><tbody>
      <tr><td>바뀌는 비중</td><td>${diff.map(d => `${esc(shortName(d.name))} ${d.fromPct}% → <b>${d.toPct}%</b>`).join(' · ') || '없음'}</td></tr>
      <tr><td>사고팔 금액 ${tip('지금 보유와 새 목표의 차이를 단순히 더한 값입니다. 1주 단위, 주문 한도, 200일선 같은 규칙을 적용하기 전이라 실제 할 일과 다를 수 있습니다.')}</td><td>${t1 ? `목표가 바뀌는 만큼 약 <b>${manwon(size.changeKrw)}</b> · 총자산의 ${size.changePct}%<br><small class="cr-muted">지금 보유에서 새 목표까지 ${manwon(t1.tradedKrw)}${t0 ? ` · 지금 목표까지 ${manwon(t0.tradedKrw)}` : ''}</small>` : `비중 차이 합계 ${size.changePct}% · 보유 자료가 없어 금액은 계산하지 못했습니다`}</td></tr>
      <tr><td>변경 횟수</td><td>${PLAN_CHANGE_DAYS}일 안 <b>${g.used + 1}번째</b> · ${g.max}번까지</td></tr></tbody></table>
    <label class="ck-field"><span>바꾸는 이유 (10자 이상 · 기록에 남음)</span><input id="rl-plan-reason" maxlength="300" placeholder="예: 3분기 실적에서 매출 성장이 꺾여 비중을 줄임"></label>
    <div class="cr-actions"><button type="button" class="primary" id="rl-plan-commit">확정</button><button type="button" class="text-button" id="rl-plan-cancel">취소</button><span class="cr-err" id="rl-plan-commit-err"></span></div></div>`;
}
function commitPlan(plan, { first = false } = {}) {
  const c = ruleCtx(); if (c.readOnly) return; const reason = first ? '' : String($('#rl-plan-reason')?.value || '').trim();
  if (!first) { const g = planChangeGate(planChangesOf(c.saved)); if (!g.ok) { $('#rl-plan-commit-err').textContent = `${md(kday(g.allowedAt))}부터 바꿀 수 있습니다.`; return; } if (reason.length < 10) { $('#rl-plan-commit-err').textContent = '바꾸는 이유를 10자 이상 적어 주세요.'; return; } }
  const prev = c.saved || { rules: c.rules }, t = planEstimate(plan), entry = { at: new Date().toISOString(), kind: 'plan', v: 2, first, changed: ['plan'], reason: reason.slice(0, 300), tradedPct: first ? (t?.tradedPct ?? null) : planChangeSize(c.saved?.plan, plan).changePct };
  if (!save({ ...prev, rules: c.rules, plan, history: [...(prev.history || []), entry].slice(-20) })) { $('#rl-plan-err').textContent = '이 브라우저에 저장하지 못했습니다(저장 공간이 막혀 있음).'; return; }
  $('#rl-plan-confirm').hidden = true; renderRules(); S.loading = loadAll(); $('#rl-plan-saved').textContent = '저장했습니다';
}
function renderCash() {
  const box = $('#cr-cash'); if (!box) return; if (acct() === 'paper' || acct() === 'none') { box.innerHTML = ''; return; }
  // '새로 넣을 돈'(홈에서 옮김 · 결과 목록은 주문이 아님): 폼 id(ct-cash)로 문서 전체의 submit 처리기가 받는다.
  // 다시 그려도 같은 계좌면 넣은 금액과 계산 결과를 남긴다(다른 계좌로 바뀌면 지운다).
  const same = RL.cashFor === acct(), prevIn = same ? (document.getElementById('ct-cash-in')?.value || '') : '', keep = same ? (document.getElementById('ct-cash-out')?.innerHTML || '') : ''; RL.cashFor = acct();
  box.innerHTML = `<div class="rl-cash"><span>현금 ${tip('현금 최소 비중과 비중 계산에 씁니다. 증권사에서 예수금을 받아 오지 못해 직접 적습니다. PC에 연결돼 있으면 그 PC에만 저장됩니다. 현금은 규칙이 아니라 사실이라 언제든 고칠 수 있습니다.')}</span>${Number.isFinite(S.cash) ? `<b>${won(S.cash)}</b><small class="cr-muted">${esc(S.cashSource)}</small>` : '<small class="cr-muted">현금 입력 전 · 현금 규칙 확인 못 함</small>'}
    <form id="cr-cash-form" class="cr-addrow"><input id="cr-cash-in" type="number" min="0" step="any" inputmode="numeric" placeholder="지금 현금(원)"><button type="submit" class="secondary">현금 저장</button></form></div><p class="cr-muted" id="cr-cash-state" role="status"></p>
    <form class="ct-cash" id="ct-cash"><label for="ct-cash-in">새로 넣을 돈 ${tip(CASH_IN_TIP)}</label><input id="ct-cash-in" type="number" min="10000" step="any" inputmode="numeric" placeholder="예: 500000" value="${esc(prevIn)}"><button type="submit" class="secondary">어디에 살지 계산</button></form><div id="ct-cash-out">${keep}</div>`;
  $('#cr-cash-form').onsubmit = async ev => { ev.preventDefault(); const amount = Number($('#cr-cash-in').value); if (!(amount >= 0)) return;
    if (S.snap?.demo) { S.cash = amount; S.cashSource = '예시(저장 안 함)'; renderRules(); renderToday(); return; }
    try { const c = await privateRead('cash-set', { amount, note: '규칙 화면' }); S.cash = c?.latest?.amount ?? amount; S.cashSource = 'PC 기록'; window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: { amount: S.cash, recordedAt: new Date().toISOString() } })); renderRules(); renderToday(); }
    catch (e2) { $('#cr-cash-state').textContent = `PC에 저장하지 못했습니다: ${e2.message}`; } };
}

// ── 근거 자료(예전 '검증 자료 원표' · "근거" · "세부 전략 근거" 표를 전체 폭으로)
function renderEvidence() {
  const box = $('#cr-evidence'); if (!box || !evidence) return;
  const C = 'C', rows = Object.values(evidence.portfolios).map(p => ({ label: p.label, h: p.hold.check, r: p.variants[C].check, t: p.variants[C].trading, v: p.variants[C].var }));
  box.innerHTML = `<div class="table-wrap"><table class="cr-table cr-ev"><thead><tr><th>예시 포트폴리오</th><th>최대 하락폭</th><th>위험 대비 수익</th><th>연 수익</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.label)}</td><td>${x.h.mdd}% → <b>${x.r.mdd}%</b></td><td>${x.h.sharpe} → <b>${x.r.sharpe}</b></td><td>${x.h.cagr}% → ${x.r.cagr}%</td></tr>`).join('')}</tbody></table></div>
    <ul class="cr-facts"><li>나쁜 날 하루 손실을 넘은 날 ${Math.min(...rows.map(x => x.v.rule95.rate))}~${Math.max(...rows.map(x => x.v.rule95.rate))}% (목표 5%)</li><li>비중 맞추기 연 ${Math.min(...rows.map(x => x.t.tradesPerYear))}~${Math.max(...rows.map(x => x.t.tradesPerYear))}번 · 매매 횟수 상한을 넘긴 기간 ${Math.max(...rows.map(x => x.t.over30DayLimitShare))}% 이하</li></ul>`;
}
function renderStrategyEvidence() {
  const box = $('#cr-strategy'); if (!box || !strat) return;
  const P = strat.playbook.policies, NAME = { P0: '매달 똑같이 나눠 사고 팔지 않기', P1: '새 돈은 모자란 종목부터', P2: '+ 한 종목 25% 넘는 만큼만 덜기', P3: '+ 떨어지면 더 사기', P4: '+ 하루 손실 한도 2.5% (주 1번)' };
  box.innerHTML = `<div class="table-wrap"><table class="cr-table"><thead><tr><th>적립 방식</th><th>연 수익(중간값)</th><th>최대 하락폭(중간값 / 하위 10%)</th><th>단순 적립보다 덜 빠진 비율</th></tr></thead><tbody>${['P0', 'P1', 'P2', 'P3', 'P4'].map(id => `<tr><td>${esc(NAME[id])}</td><td>${P[id].check.cagrMed}%</td><td>${P[id].check.mddMed}% / ${P[id].check.mddWorst10}%</td><td>${P[id].check.beatsP0Mdd}%</td></tr>`).join('')}</tbody></table></div>`;
}

function renderRules() {
  guard('now', renderNow); guard('risk', renderRisk); guard('past', renderPast);
  guard('change', () => renderChange({ keepForm: $('#rl-change')?.open && RL.pick === 'custom' })); guard('pc', renderPcBlock);
  guard('plan', () => { if ($('#rl-plan')?.open && (document.activeElement?.closest?.('#cr-plan') || $('#rl-plan-confirm')?.hidden === false)) return; const { plan, planSaved } = current(); renderPlan(plan, planSaved); });
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
  if (t.id === 'rl-plan-cancel') { $('#rl-plan-confirm').hidden = true; return; }
  if (t.id === 'rl-plan-commit') { const { plan, errors } = readPlan(ruleCtx().rules); if (errors.length || planSig(plan) !== $('#rl-plan-confirm').dataset.sig) return savePlan(); return commitPlan(plan); }
  if (t.id === 'cr-fill') { const p = initialPlan(S.positions, S.cash, ruleCtx().rules); renderPlan(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { pct: v }])), false); }
});
rulesPage.addEventListener('change', e => { if (e.target.name === 'rl-level') { RL.pick = e.target.value; RL.prefillNote = ''; $('#rl-confirm').hidden = true; renderChange({ keepForm: true }); } });
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'rules') { renderRules(); void renderReview(); const p = storedPrefill(); if (p) guard('prefill', () => applyPrefill(p)); } });

// ── ③ 주문 점검 ───────────────────────────────────────────
const preP = addView('precheck', '종목·주문 점검', `<div class="page-head"><div><h1>종목·주문 점검 ${tip('주문을 넣기 전에 내 규칙에 맞는지, 이 돈이 하루에 얼마까지 흔들릴 수 있는지 봅니다. 실제 주문은 하지 않습니다.')}</h1><p>종목을 고르면 시세와 흐름 · 금액을 넣으면 내 규칙으로 점검</p></div></div>
<div class="cp" id="cp-wrap"><form class="cp-form cr-card" id="cp-form">
  <label class="cp-l">종목</label><div class="cp-chips" id="cp-chips"></div><div class="cp-search"><input id="cp-sym" autocomplete="off" placeholder="이름·종목코드로 찾기 (예: 현대, 005380, NVDA)" aria-autocomplete="list"><div class="cp-sugg" id="cp-sugg" hidden role="listbox"></div></div>
  <div class="cp-seg" role="radiogroup" aria-label="매수·매도"><label><input type="radio" name="cp-side" value="BUY" checked><span>매수</span></label><label><input type="radio" name="cp-side" value="SELL"><span>매도</span></label></div>
  <label class="cp-l" for="cp-amt">금액(원)</label><input id="cp-amt" type="number" min="1000" step="any" inputmode="numeric" placeholder="예: 1000000">
  <button type="submit" class="primary" id="cp-run">규칙 점검</button><p class="cp-state" id="cp-state" role="status"></p></form>
  <div class="cp-result" id="cp-result"><div id="cp-stock"></div><div id="cp-check"><div class="cr-card cp-empty"><p>종목 선택 전 ${tip("종목을 고르면 시세·차트가, 금액을 넣고 '규칙 점검'을 누르면 점검 결과가 여기 나옵니다.")}</p></div></div></div></div>`);
let cpSel = null;
// 종목을 고르기 전에는 한 열(넓은 빈 칸을 두지 않음), 고르면 넓은 화면에서 주문 칸 | 시세·결과 두 열.
const cpPicked = () => document.getElementById('cp-wrap')?.classList.add('cp-picked');
function renderPrecheckChips() { const box = $('#cp-chips'); if (!box) return; box.innerHTML = S.positions.map(p => `<button type="button" data-sym="${esc(p.symbol)}" class="${cpSel?.symbol === p.symbol ? 'on' : ''}">${esc(p.name)}</button>`).join('') || '<span class="cr-muted">보유 종목 없음</span>'; box.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => { cpSel = S.positions.find(p => p.symbol === b.dataset.sym); $('#cp-sym').value = ''; renderPrecheckChips(); void showStockPanel(cpSel); }); }
async function chosen() {
  const t = $('#cp-sym').value.trim();
  if (!t) { if (cpSel) return cpSel; throw new Error('종목을 고르거나 적어 주세요.'); }
  if (/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t)) return { symbol: t.toUpperCase(), name: t.toUpperCase(), currency: 'USD' };
  const s = await resolveStockInput(t); return { symbol: s.split('.')[0], name: stockName(s), currency: 'KRW' };
}
$('#cp-sym').oninput = () => { if ($('#cp-sym').value.trim()) { cpSel = null; renderPrecheckChips(); } };
// 주문 점검: 종목 검색 제안은 공용 모듈(stock-search-ui.js). 고르면 오늘 등락·1년 차트 패널을 연다.
attachStockSearch($('#cp-sym'), { onPick: o => { cpSel = o; renderPrecheckChips(); void showStockPanel(o); } });
let panelRun = 0;
async function showStockPanel(o) {
  const host = $('#cp-stock'); if (!host || !o) return; const run = ++panelRun; cpPicked();
  host.innerHTML = `<article class="cr-card cp-stockcard"><header><h3>${esc(o.name)} <small class="cr-muted">${esc(o.symbol)}${o.currency === 'USD' ? ' · 미국' : ''}</small></h3><span class="cp-quote" id="cp-quote">시세 확인 중…</span></header><div id="cp-chart" class="cp-chart"><div class="shimmer ct-skel"></div></div></article>`;
  const [qv, d] = await Promise.all([quoteOf(o.symbol), fetchCandles(o.symbol, o.currency, '2y').catch(() => null)]);
  if (run !== panelRun) return;
  const qEl = $('#cp-quote'); if (qEl) qEl.innerHTML = qv && Number.isFinite(qv.price) ? `<b>${o.currency === 'USD' ? '$' + qv.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : won(qv.price)}</b> <span class="${qv.pct > 0 ? 'up' : qv.pct < 0 ? 'down' : ''}">${qv.pct > 0 ? '+' : ''}${(qv.pct ?? 0).toFixed(2)}%</span> <small class="cr-muted">${qv.status === 'OPEN' ? '장중' : '장 마감'} · ${esc(qv.source || '')}</small>` : '<small class="cr-muted">오늘 시세를 받지 못했습니다</small>';
  const ch = $('#cp-chart'); if (!ch) return;
  if (d?.candles?.length) { try { mountCandles(ch, d, { name: o.name, unit: o.currency === 'USD' ? '달러' : '원' }); const y1 = ch.querySelector('[data-period="1Y"]'); if (y1) y1.click(); } catch (e) { ch.innerHTML = `<p class="cr-muted">차트를 그리지 못했습니다 (${esc(e.message)})</p>`; } }
  else ch.innerHTML = '<p class="cr-muted">시세를 불러오지 못했습니다.</p>';
}

$('#cp-form').onsubmit = async ev => {
  ev.preventDefault(); const st = $('#cp-state'), box = $('#cp-check'); st.textContent = '계산 중…';
  try {
    if (S.loading) await S.loading;
    const o = await chosen(), side = preP.querySelector('[name="cp-side"]:checked').value, amt = Number($('#cp-amt').value);
    if (!(amt >= 1000)) throw new Error('금액을 1,000원 이상으로 넣어 주세요.');
    let risk = S.risk[o.symbol], extra = {};
    if (!risk) { const d = await fetchCandles(o.symbol, o.currency, '2y'); o.currency = d.currency === 'USD' ? 'USD' : o.currency; risk = assetRisk(d.candles, { market: marketOf(o), trendUS: isIndexEtf(o) }); extra = { [o.symbol]: krwReturns(d.candles, o.currency, S.fxCandles) }; }
    const s = state(extra), r = preTradeCheck(s, { ...o, side, amountKrw: amt }, risk);
    if (r.error) throw new Error(r.error);
    const maxBuy = side === 'BUY' ? maxBuyAmount(s, o, risk) : null;
    const blockers = maxBuy === 0 ? preTradeCheck(s, { ...o, side: 'BUY', amountKrw: 1000 }, risk).failed.filter(c => c.id !== 'maxTrades30').map(c => c.label) : [];
    const g = grid(extra), single = portfolioRiskAt(g, [{ symbol: o.symbol, valueKrw: amt }], g.dates.length - 1);
    const mc = risk?.ok ? simulateGarch(risk.garch, 20, { paths: 2000, seed: 5, drift: false }) : null;
    cpPicked();
    // '실제 주문은 하지 않습니다'는 화면 제목 ⓘ 에 있어 결과 카드에서는 되풀이하지 않는다.
    box.innerHTML = `<article class="cr-card cp-out">
      <div class="cp-verdict ${r.ok ? 'ok' : 'bad'}"><b>${r.ok ? '규칙 지킴' : '규칙 어김'}</b><span>${esc(o.name)} ${side === 'BUY' ? '매수' : '매도'} ${won(amt)}${r.ok ? '' : ` · ${r.failed.map(c => c.label).join(', ')}`}</span></div>
      ${maxBuy !== null ? `<p class="cp-max">규칙을 지키며 더 살 수 있는 금액 <b>${won(maxBuy)}</b>${tip('현금·한 종목 최대 비중·목표 비중·200일선·현금 최소 비중·하루 손실 한도·레버리지 규칙을 모두 지키는 가장 큰 금액입니다. 30일 매매 횟수는 금액과 상관없어 따로 보여 줍니다.')}${blockers.length ? `<small>${esc(blockers.join('·'))} 때문에 지금은 더 살 수 없음</small>` : ''}</p>` : ''}
      <div class="table-wrap"><table class="cr-table"><thead><tr><th>규칙</th><th>결과</th><th>내용</th></tr></thead><tbody>${r.checks.map(c => `<tr><td>${esc(c.label)}</td><td><span class="ct-chip ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '지킴' : c.ok === false ? '어김' : '확인 못 함'}</span></td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>
      <div class="cp-loss">
        <div><span>이 금액의 나쁜 날 하루 손실 ${tip('20거래일에 하루쯤은 이보다 더 잃을 수 있는 금액입니다. 이 종목의 최근 500거래일 하루 움직임을 요즘 변동성에 맞춰 계산했습니다(계좌와 같은 방식).')}</span><b>${single.ok ? '−' + won(single.var95) : '—'}</b></div>
        <div><span>주문 뒤 계좌의 나쁜 날 하루 손실</span><b>${Number.isFinite(r.after.var95) ? '−' + won(r.after.var95) : '—'}</b><small>${Number.isFinite(r.after.var95) ? `총자산의 ${(r.after.var95 / r.after.total * 100).toFixed(2)}% · 한도 ${s.rules.dailyLoss}%` : ''}</small></div>
        <div><span>한 달 뒤 이 금액의 예상 범위 ${tip('과거 하루 움직임으로 20거래일(약 한 달) 뒤를 2,000번 가정한 범위입니다(10번 중 9번은 이 안). 오르거나 내린다고 가정하지 않았습니다(평균 수익 0).')}</span><b>${mc ? `${swon(amt * mc.p05)} ~ ${swon(amt * mc.p95)}` : '—'}</b></div>
      </div>
      ${o.currency === 'USD' && S.fx ? `<p class="cr-muted">달러 환율 ${S.fx.toLocaleString('ko-KR')}원 기준 · 손실 범위에 환율 움직임 포함</p>` : ''}</article>`;
    st.textContent = '';
  } catch (e) { st.textContent = e.message; }
};

// ── ④ 성적표 ─────────────────────────────────────────────────
// 2026-11-13(결정 34): 성적표 탭을 없애고 규칙 화면의 접힘 "내 계좌 최근 1·3·6개월"로 옮겼다. 화면(view)은 예전 주소로 들어온 경우를 위해 남기고 곧바로 규칙 화면으로 보낸다.
const repP = addView('report', '내 계좌 최근 기간', `<div id="rp-wrap"><div class="cp-seg rp-period" role="radiogroup" aria-label="기간">${[[30, '1개월'], [91, '3개월'], [182, '6개월']].map(([d, l], i) => `<label><input type="radio" name="rp-p" value="${d}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><div id="rp-body"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div></div>`);
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
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="세 가지 경로(첫날 = 100)">${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`).join('')}<line class="b" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${keys.map(([k]) => `<polyline class="l-${k}" points="${path(k)}"/>`).join('')}<text x="${L}" y="${H - 6}">${series[0].date}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${series.at(-1).date}</text></svg>
    <div class="rp-legend">${keys.map(([k, l]) => `<span><i class="l-${k}"></i>${l}</span>`).join('')}<span class="cr-muted">첫날을 100으로 맞춤 · 입출금 효과 뺌 ${tip('중간에 넣거나 뺀 돈은 수익으로 치지 않고 이어 붙였습니다(입출금 효과를 뺀 수익률).')}</span></div>`;
}
// 성적표와 홈 '지수와 비교'가 같이 쓰는 자료 준비: 기간 안에 사고판 종목까지 일봉을 받아 둔다. 이미 받은 체결 내역(S.orders)과 일봉(S.candles)을 다시 쓴다.
async function reportInputs(days) {
  const from = daysAgo(days), to = today(), fills = fillsFrom(S.orders);
  const syms = new Set([...S.positions.map(p => p.symbol), ...fills.filter(f => f.date > from).map(f => f.symbol)]);
  for (const s of syms) if (!S.candles[s]) { const f = fills.find(x => x.symbol === s); try { S.candles[s] = (await fetchCandles(s, f?.currency || 'KRW', '2y')).candles; } catch {} }
  const meta = Object.fromEntries([...syms].map(s => { const p = S.positions.find(x => x.symbol === s), f = fills.find(x => x.symbol === s), cur = p?.currency || f?.currency || 'KRW'; return [s, { market: cur === 'USD' ? 'US' : 'KR', currency: cur }]; }));
  const cs = Object.fromEntries([...syms].filter(s => S.candles[s]).map(s => [s, S.candles[s]]));
  return { from, to, meta, cs };
}
/**
 * 홈 '지수와 비교'(home-top)가 부르는 내 계좌 선. 규칙 화면 '내 계좌 최근 1·3·6개월'의 '내 매매' 선과 같은 계산이다
 * (reportCard().series[].actual: 체결 내역으로 날마다 보유를 되돌린 주식 부분 · 현금 빼고 · 중간 입출금 효과 뺌 · 첫날 = 100).
 * 규칙 계산(engine)은 부르지 않고, 이미 받은 S.orders 를 다시 써서 증권사 조회를 늘리지 않는다.
 * 팀 모의계좌는 공개 자료의 날마다 총자산(marks)으로 만든다(공개 자료에는 주문이 일부만 있어 reportCard 를 쓸 수 없음).
 * @returns {ok:true, kind, from, to, points:[{date, own}], notes[], benchmark?} 또는 {ok:false, kind, reason}
 */
export async function accountPath(days = 91) {
  try { if (S.loading) await S.loading; } catch { }
  const kind = acct();
  if (kind === 'paper') {
    const from = daysAgo(days), marks = (S.mock?.marks || []).filter(m => m.total > 0 && m.date >= from);
    if (marks.length < 2) return { ok: false, kind, reason: '거래일이 이틀 넘게 쌓이면 비교합니다.' };
    const t0 = marks[0].total;
    return { ok: true, kind, from: marks[0].date, to: marks.at(-1).date, points: marks.map(m => ({ date: m.date, own: m.total / t0 * 100 })), notes: [], benchmark: S.mock?.benchmark || null };
  }
  if (!S.positions.length) return { ok: false, kind, reason: '계좌를 연결하면 지수와 비교합니다.' };
  if (!S.orders) return { ok: false, kind, reason: '체결 내역을 못 읽어 비교하지 못했습니다.' };
  const { from, to, cs } = await reportInputs(days);
  const rc = reportCard({ positions: S.positions.map(p => ({ ...p })), orders: S.orders, candlesBySymbol: cs, fxCandles: S.fxCandles, fxNow: S.fx, from, to, rules: current().rules });
  if (!rc.ok) return { ok: false, kind, reason: rc.reason };
  return { ok: true, kind, from: rc.from, to: rc.to, points: rc.series.map(p => ({ date: p.date, own: p.actual })), notes: rc.notes.filter(n => !n.startsWith('규칙 계산 도구')) };
}
// 홈이 원화 기준 S&P500(지수 × 달러 환율)을 그릴 때 쓰는 달러 환율 일봉(KRW=X) · 계좌 자료를 다 받았는지 기다릴 약속.
export const coreFx = () => S.fxCandles;
export const coreLoading = () => S.loading;
async function renderReport() {
  const id = ++repRun, body = $('#rp-body');
  if (S.snap?.paper) { body.innerHTML = `<p class="cr-muted">팀 모의계좌는 이 비교를 하지 않습니다 ${tip(`자동 매매 ${S.mock?.days ?? S.mock?.marks?.length ?? '며칠'}일째이고 공개 자료에 주문이 일부만 있어서입니다. 기록은 '규칙 지킨 기록'과 모의투자 화면에 있습니다.`)}</p>`; return; }
  if (!S.positions.length) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div>'; return; }
  body.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div></div>';
  try { if (S.loading) await S.loading; } catch { }
  if (!S.orders) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">체결 내역을 불러오지 못했습니다. 설정 › 내 PC 연결을 확인해 주세요.</p></div>'; return; }
  const days = Number(document.querySelector('[name="rp-p"]:checked').value);
  const { from, to, meta, cs } = await reportInputs(days);
  if (id !== repRun) return;
  await new Promise(r => setTimeout(r, 0));
  const engine = buildEngine(cs, meta, S.fxCandles, { from: daysAgo(days + 30) });
  const rc = reportCard({ positions: S.positions.map(p => ({ ...p })), orders: S.orders, candlesBySymbol: cs, fxCandles: S.fxCandles, fxNow: S.fx, from, to, engine, rules: current().rules });
  if (id !== repRun) return;
  if (!rc.ok) { body.innerHTML = `<div class="cr-card"><p class="cr-muted">${esc(rc.reason)}</p></div>`; return; }
  const a = rc.actual, h = rc.hold, r = rc.rule, diff = a.pnl - h.pnl, best = [...rc.byTrade].filter(t => Number.isFinite(t.effectKrw)).sort((x, y) => y.effectKrw - x.effectKrw);
  // 숫자 먼저: 두 줄로(내 매매 · 규칙대로).
  const verdict = `${a.trades ? `내 매매: 그냥 보유보다 ${swon(diff)}` : '내 매매: 이 기간 매매 없음(그냥 보유와 같음)'}<br>규칙대로였다면 최대 하락폭 ${pct(r.mdd)} · 그냥 보유 ${pct(h.mdd)}`;
  body.innerHTML = `<article class="cr-card rp-card">
    <p class="cr-muted">${esc(md(rc.from))} 종가 ~ ${esc(md(rc.to))} · 시작 평가액 ${won(rc.startValue)}</p>
    <h3 class="rp-verdict">${verdict}</h3>
    <div class="rp-tiles">
      <div class="me"><span>내가 한 것</span><b class="${tone(a.pnl)}">${swon(a.pnl)}</b><small>${pct(a.ret)} · 최대 하락폭 ${pct(a.mdd)}<br>매매 ${a.trades}번 · 수수료·세금 ${won(a.fees)}</small></div>
      <div><span>그냥 보유</span><b class="${tone(h.pnl)}">${swon(h.pnl)}</b><small>${pct(h.ret)} · 최대 하락폭 ${pct(h.mdd)}</small></div>
      <div><span>규칙대로였다면 ${tip('기간 첫날 비중을 목표로 두고, 매주 마지막 거래일 종가에(급하면 바로) 오늘 점검의 할 일대로 맞췄다고 계산했습니다. 비용 0.2%. 실제 현금 기록이 없어 현금 최소 비중은 빼고 주식만 봅니다.')}</span><b class="${tone(r.pnl)}">${swon(r.pnl)}</b><small>${pct(r.ret)} · 최대 하락폭 ${pct(r.mdd)}<br>맞춘 횟수 ${r.rebalances}번</small></div>
    </div>
    <figure class="rp-chart">${lineSvg(rc.series)}</figure>
    ${best.length ? `<h4>매매별 손익 효과 ${tip('체결가에서 기간 마지막 종가까지 움직인 만큼입니다. 산 것은 산 뒤 오른 만큼 이득, 판 것은 판 뒤 오른 만큼 놓친 것으로 셉니다.')}</h4><div class="table-wrap"><table class="cr-table"><thead><tr><th>날짜</th><th>종목</th><th>매매</th><th>금액</th><th>손익 효과</th></tr></thead><tbody>${[...best.slice(0, 3), ...best.slice(-3).filter(t => !best.slice(0, 3).includes(t))].map(t => `<tr><td>${esc(md(t.date))}</td><td>${esc(t.name)}</td><td>${t.side === 'BUY' ? '매수' : '매도'} ${t.quantity}주</td><td>${won(t.amountKrw)}</td><td class="${tone(t.effectKrw)}"><b>${swon(t.effectKrw)}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="cr-muted">이 기간 매매가 없습니다.</p>'}
    ${rc.notes.length ? `<ul class="cr-facts">${rc.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </article>`;
}
