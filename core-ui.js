// 핵심 기능 화면: ① 규칙 ② 오늘 점검(홈) ③ 매매 전 확인 ④ 성적표.
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
import { presetRules, nearestPreset, reviewRules, LOSS_OPTIONS, SECTOR_OPTIONS, CADENCE_OPTIONS } from '/lib/rule-presets.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const swon = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = n => new Date(Date.now() - n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const marketOf = p => p.currency === 'USD' ? 'US' : 'KR';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/core.css?v=20261106'; document.head.append(css);
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
  const saved = loadSaved(), rules = normalizeRules(saved?.rules || {}).rules;
  const plan = saved?.plan || Object.fromEntries(Object.entries(initialPlan(S.positions, S.cash, rules)).map(([k, v]) => [k, { pct: v, name: S.positions.find(p => p.symbol === k)?.name, currency: S.positions.find(p => p.symbol === k)?.currency }]));
  return { rules, plan, planSaved: !!saved?.plan, savedAt: saved?.savedAt || null };
}
const trades30 = () => S.orders ? fillsFrom(S.orders).filter(f => f.date > daysAgo(30)).length : null;
function grid(extra = {}) { const ser = { ...S.series, ...extra }; return riskGrid(ser); }
function state(extraSeries) {
  const { rules, plan } = current(), g = grid(extraSeries), k = g.dates.length - 1;
  const planned = Object.entries(plan).filter(([s]) => !S.positions.some(p => p.symbol === s)).map(([s, v]) => ({ symbol: s, name: v?.name || stockName(s), currency: v?.currency || 'KRW', valueKrw: 0 }));
  return { positions: [...S.positions, ...planned], cashKrw: S.cash, rules, plan, risk: S.risk, portVar: h => portfolioRiskAt(g, h, k), trades30: trades30() };
}

async function loadAll() {
  const epoch = ++S.epoch;
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
  renderToday(); renderRules(); renderPrecheckChips(); if (cq.prefs) cqRisk(cq.prefs); if ($('.view.active')?.dataset.page === 'report') void renderReport();
}

window.addEventListener('teamquant:asset-snapshot', e => {
  const snap = e.detail || {}; S.snap = snap; S.fx = snap.fx?.midRate || null;
  S.positions = (snap.positions || []).map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.quantity, valueKrw: p.currency === 'USD' ? (S.fx ? p.value * S.fx : null) : p.value })).filter(p => Number.isFinite(p.valueKrw));
  if (!snap.demo && /^(예시|모의계좌)/.test(S.cashSource)) { S.cash = null; S.cashSource = ''; }
  S.loading = loadAll();
});
window.addEventListener('teamquant:asset-clear', () => { Object.assign(S, { snap: null, positions: [], cash: null, cashSource: '', orders: null, risk: {}, series: {}, candles: {} }); renderToday(); renderRules(); });
window.addEventListener('teamquant:cash', e => { if (Number.isFinite(e.detail?.amount)) { S.cash = e.detail.amount; S.cashSource = e.detail.note || 'PC 기록'; renderToday(); renderRules(); } });

// ── ② 오늘 점검(홈) ──────────────────────────────────────────
const CHECK_TIP = '정해 둔 규칙과 계획 비중으로 지금 계좌를 점검합니다.\n맞추는 때: 그 주 마지막 거래일 종가(주 1회). 하루 손실이 한도의 1.25배를 넘거나, 레버리지 상품이 있거나, 한 종목이 상한의 1.2배를 넘으면 바로.\n계획 금액의 10% 넘게 차이 날 때만 맞춥니다.\n2012~2026 네 가지 포트폴리오에서 같은 엔진으로 따랐을 때: 최대 손실은 그냥 보유의 절반 안팎, 위험 대비 수익은 비슷하거나 높음, 수익률은 낮아짐(규칙 화면의 근거 참고).';
function weekEndNote() { const d = new Date(Date.now() + 9 * 3600e3), w = d.getUTCDay(); return w === 5 ? '오늘(금) 종가에 맞춤' : w === 6 || w === 0 ? '다음 주 금요일 종가에 맞춤' : `이번 주 금요일 종가에 맞춤`; }
function renderToday() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let card = document.getElementById('core-today');
  if (!card) { card = document.createElement('article'); card.className = 'hm-card core-today'; card.id = 'core-today'; const anchor = document.getElementById('hm-kpis'); if (anchor) anchor.after(card); else host.prepend(card); }
  if (!S.positions.length) { card.hidden = true; return; } card.hidden = false;
  const ready = Object.keys(S.risk).length > 0, { planSaved, rules } = current();
  if (!ready) { card.innerHTML = `<header><h3>오늘 점검 ${tip(CHECK_TIP)}</h3></header><div class="shimmer ct-skel"></div>`; return; }
  const e = evaluate(state()), when = e.urgent ? '지금 바로 맞출 일이 있습니다' : weekEndNote();
  card.innerHTML = `<header><h3>오늘 점검 ${tip(CHECK_TIP)}</h3><span class="ct-when ${e.urgent ? 'urgent' : ''}">${esc(when)}</span></header>
    ${planSaved ? '' : `<p class="ct-note">아직 계획을 저장하지 않아 지금 비중(한 종목 ${rules.maxSingle}% 이내)을 계획으로 봤습니다. <button type="button" class="text-button" data-core-go="rules">계획 정하기</button></p>`}
    <div class="ct-checks">${e.checks.map(c => `<span class="ct-chip ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}">${c.ok === true ? '✓' : c.ok === false ? '!' : '?'} ${esc(c.label)}${tip(c.detail)}</span>`).join('')}</div>
    <p class="ct-score"><b>규칙 ${e.known}개 중 ${e.okCount}개 지킴</b>${e.known < e.checks.length ? ` · ${e.checks.length - e.known}개는 자료가 없어 확인 못 함` : ''}</p>
    ${e.actions.length ? `<ol class="ct-actions">${e.actions.slice(0, 6).map(a => `<li class="${a.kind}"><b>${esc(a.text)}</b>${a.why?.length ? `<small>${esc(a.why.join(' · '))}</small>` : ''}</li>`).join('')}</ol>` : '<p class="ct-none">할 일 없음 · 계획대로 유지</p>'}
    <div class="ct-risk"><span>계좌 하루 95% 손실 범위 ${tip('지금 보유를 최근 500거래일의 하루 움직임(지금 변동성으로 맞춤)에 넣어 본 값입니다. 2012~2026 검증에서 이 범위를 넘은 날은 4.5~4.9%였습니다(목표 5%).')}</span><b>${e.varNow?.ok ? `−${won(e.varNow.var95)}` : '—'}</b><small>${e.varNow?.ok ? `총자산의 ${(e.varNow.var95 / e.total * 100).toFixed(2)}% · 한도 ${current().rules.dailyLoss}%` : ''}</small></div>
    <form class="ct-cash" id="ct-cash"><label>새로 넣을 돈 ${tip('들어온 돈을 계획보다 모자란 종목부터 나눕니다. 떨어졌거나 덜 산 종목에 자연히 더 들어갑니다. 한 종목 상한·현금 최소·하루 손실 한도를 지키고 남으면 현금으로 둡니다. 무작위 6종목 포트폴리오 120개 모의 운용(2016~2026)에서 균등 적립과 수익·손실은 비슷하고 매매는 약 40% 적었습니다.')}</label><input id="ct-cash-in" type="number" min="10000" step="any" inputmode="numeric" placeholder="예: 500000"><button type="submit" class="secondary">나누기</button></form><div id="ct-cash-out"></div>
    <div class="ct-links"><button type="button" class="secondary" data-core-go="precheck">매매 전 확인</button><button type="button" class="secondary" data-core-go="report">성적표</button><button type="button" class="text-button" data-core-go="rules">규칙·계획</button></div>`;
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
let evidence = null, strat = null;
fetch('/data/strategy-evidence.json?v=E1').then(r => r.ok ? r.json() : null).then(d => { strat = d; renderStrategyEvidence(); }).catch(() => {});
function renderStrategyEvidence() {
  const box = document.getElementById('cr-strategy'); if (!box || !strat) return;
  const P = strat.playbook.policies, row = id => `<tr><td>${esc(P[id].label)}</td><td>${P[id].check.cagrMed}%</td><td>${P[id].check.mddMed}% / ${P[id].check.mddWorst10}%</td><td>${P[id].check.beatsP0Mdd}%</td></tr>`;
  const ic = (m, k) => strat.factors[m][k].check.ic, mac = strat.macro, ev = strat.events.dip20;
  box.innerHTML = `<p class="cr-muted">무작위 6종목 포트폴리오 ${strat.playbook.portfolios}개 · 1,000만원 + 매달 50만원 · 2021~2026(고를 때 안 쓴 기간)</p>
    <div class="table-wrap"><table class="cr-table"><thead><tr><th>규칙</th><th>연 수익(중앙)</th><th>최대 손실(중앙/하위10%)</th><th>그냥 적립보다 손실 작음</th></tr></thead><tbody>${['P0', 'P1', 'P2', 'P3', 'P4'].map(row).join('')}</tbody></table></div>
    <ul class="cr-facts">
      <li>예측은 쓰지 않습니다: 재무·주가 요인 묶음의 다음 달 예측력(순위 상관) 한국 ${ic('KR', 'composite')}, 미국 ${ic('US', 'composite')}로 0에 가까웠고, 2019년까지 통하던 요인도 이후엔 사라지거나 뒤집혔습니다.</li>
      <li>거시 지표(VIX·금리·환율·유가·추세)로 다음 달 지수 방향을 맞힌 비율 코스피 ${mac.KOSPI.directionHit}%(그냥 '오른다' ${mac.KOSPI.upShare}%), S&P 500 ${mac.SP500.directionHit}%(${mac.SP500.upShare}%).</li>
      <li>3개월 고점 대비 −20% 뒤 평균 ${ev.healthy.furtherDrop}% 더 빠졌고, 재무가 건강한 종목도 2020년 이후 지수보다 낫지 않았습니다(120일 ${ev.checkHealthy.ex120}%p). 그래서 '하락 시 추가 매수'는 따로 두지 않고 새 돈이 모자란 종목으로 가게 합니다.</li>
      <li>60거래일 +30% 급등 뒤에도 평균적으로 되돌리지 않았습니다. 그래서 '몇 % 오르면 판다'는 규칙은 두지 않고, 한 종목 상한을 넘는 만큼만 덜어냅니다.</li>
    </ul>`;
}
fetch('/data/core-validation.json?v=' + RULES_VERSION).then(r => r.ok ? r.json() : null).then(d => { evidence = d; renderEvidence(); renderStrategyEvidence(); }).catch(() => {});
const rulesPage = addView('rules', '규칙', `<div class="page-head"><div><h1>규칙 ${tip('한 번 정해 두면 오늘 점검·매매 전 확인·성적표가 이 기준으로 계산합니다. 이 브라우저(프로필별)에 저장되고 서버로 보내지 않습니다.')}</h1><p>내 투자 규칙과 종목별 계획 비중</p></div></div>
<div class="cr-grid"><div class="cr-main">
  <article class="cr-card" id="cr-quick"><header><h3>세 질문으로 정하기 ${tip('숫자 7개를 직접 고르는 대신 세 가지 질문에 답하면 규칙이 정해집니다. 하루 손실 한도 = 한 달 허용 손실 ÷ √21, 한 종목·섹터 상한은 나눌 섹터 수에서, 매매 횟수 상한은 점검 주기에서 나옵니다. 아래 숫자는 그대로 손볼 수 있습니다.')}</h3><span class="cr-muted" id="cr-quick-state"></span></header>
    <div class="cq">
      <div class="cq-q"><span>1. 한 달에 얼마까지 잃어도 견딜 수 있습니까?</span><div class="cp-seg" role="radiogroup"><label><input type="radio" name="cq-loss" value="5"><span>5%</span></label><label><input type="radio" name="cq-loss" value="10"><span>10%</span></label><label><input type="radio" name="cq-loss" value="20"><span>20%</span></label></div><small class="cr-muted" id="cq-loss-d"></small></div>
      <div class="cq-q"><span>2. 몇 개 섹터로 나누겠습니까?</span><div class="cp-seg" role="radiogroup"><label><input type="radio" name="cq-sec" value="3"><span>3개 안팎</span></label><label><input type="radio" name="cq-sec" value="5"><span>5개 안팎</span></label><label><input type="radio" name="cq-sec" value="8"><span>8개 이상</span></label></div><small class="cr-muted" id="cq-sec-d"></small></div>
      <div class="cq-q"><span>3. 얼마나 자주 보겠습니까?</span><div class="cp-seg" role="radiogroup"><label><input type="radio" name="cq-cad" value="weekly"><span>주 1회</span></label><label><input type="radio" name="cq-cad" value="monthly"><span>월 1회</span></label><label><input type="radio" name="cq-cad" value="urgent"><span>급할 때만</span></label></div><small class="cr-muted" id="cq-cad-d"></small></div>
    </div>
    <ul class="cq-explain" id="cq-explain"></ul>
    <div class="cq-risk" id="cq-risk"></div>
    <div class="pp-form" style="margin-top:10px"><label class="ck-field"><span>바꾸는 근거 (PC 적용 때 · 처음은 비워도 됨)</span><input id="cq-reason" placeholder="예: 11월 기록에서 하루 한도 초과일 3/15 · 허용 손실 한 단계 낮춤"></label><label class="ck-field"><span>기대 효과</span><input id="cq-expect" placeholder="예: 한도 초과일 10% 아래"></label></div>
    <div class="cr-actions"><button type="button" class="primary" id="cq-apply">이 규칙으로 저장</button><button type="button" class="secondary" id="cq-pc">PC 모의계좌에도 적용</button><span class="cr-muted" id="cq-pc-state"></span></div></article>
  <article class="cr-card"><header><h3>규칙 (세부) ${tip('세 질문으로 정한 뒤 숫자를 직접 손볼 수 있습니다. 손보면 위 선택은 "직접 조정"으로 표시됩니다.')}</h3><span class="cr-muted" id="cr-saved"></span></header><form id="cr-form" class="cr-rules"></form>
    <details class="cr-adv"><summary>추가 규칙</summary><div id="cr-adv"></div></details>
    <p class="cr-err" id="cr-err" role="alert"></p><div class="cr-actions"><button type="button" class="primary" id="cr-save">저장</button><button type="button" class="text-button" id="cr-default">기본값으로</button></div></article>
  <article class="cr-card"><header><h3>계획 비중 ${tip('종목마다 총자산(주식 + 현금)에서 차지할 목표 비중입니다. 오늘 점검은 이 계획에 규칙(200일선·하루 손실 한도)을 적용한 목표와 지금을 비교합니다. 규칙 때문에 팔았다가도 조건이 풀리면 다시 이 계획까지 사도록 안내합니다.')}</h3><button type="button" class="text-button" id="cr-fill">지금 비중으로 채우기</button></header>
    <div id="cr-plan"></div></article>
  <article class="cr-card" id="cr-review"><header><h3>기록으로 점검 ${tip('PC 실시간 모의계좌의 날마다 기록(총자산·현금·주문·막힌 이유)으로 지금 규칙이 어떻게 작동했는지 잽니다. 측정이지 예측이 아닙니다. 20거래일은 지나야 의미가 있습니다.')}</h3><button type="button" class="text-button" id="cr-review-go">다시 불러오기</button></header><div id="cr-review-body"><p class="cr-muted">PC 모의계좌 기록이 있을 때 계산합니다.</p></div></article>
</div><aside class="cr-side">
  <article class="cr-card"><header><h3>현금 ${tip('현금 최소 비중과 비중 계산에 씁니다. 계좌 API에서 예수금을 받지 못해 직접 기록합니다. PC 연결 상태면 PC에만 저장됩니다.')}</h3></header><div id="cr-cash"></div></article>
  <article class="cr-card"><header><h3>세부 전략 근거 ${tip('그때 공개돼 있던 재무(한국 OpenDART, 미국 SEC 제출일)와 시세만으로 54개 대형주를 월별로 다시 계산했습니다. 2019년까지로 고르고 2020년부터 확인했습니다. 지금 남아 있는 대형주라 생존 편향이 있습니다.')}</h3></header><div id="cr-strategy"><div class="shimmer ct-skel"></div></div></article>
  <article class="cr-card"><header><h3>근거 ${tip('같은 엔진을 2012년부터 날마다 돌린 결과입니다. 기본값은 2012~2019로 고르고 2020~2026에서 확인했습니다. 현금 이자는 0으로 둬 보수적으로 계산했습니다. 지금 남아 있는 종목으로 만든 포트폴리오라 생존 편향이 있습니다.')}</h3></header><div id="cr-evidence"><div class="shimmer ct-skel"></div></div></article>
</aside></div>`);
function ruleInput(d, v) {
  if (d.type === 'bool') return `<label class="cr-rule bool"><span>${esc(d.label)}${tip(d.help)}</span><input type="checkbox" name="${d.id}" ${v ? 'checked' : ''}></label>`;
  return `<label class="cr-rule"><span>${esc(d.label)}${tip(d.help)}</span><span class="cr-in"><input type="number" name="${d.id}" value="${v}" min="${d.min}" max="${d.max}" step="${d.step}" inputmode="decimal"><em>${esc(d.unit)}</em></span></label>`;
}
const ADV = new Set(['perAssetVol', 'volTarget']);
function renderRules() {
  const { rules, plan, planSaved, savedAt } = current();
  $('#cr-form').innerHTML = RULE_DEFS.filter(d => !ADV.has(d.id)).map(d => ruleInput(d, rules[d.id])).join('');
  $('#cr-adv').innerHTML = RULE_DEFS.filter(d => ADV.has(d.id)).map(d => ruleInput(d, rules[d.id])).join('');
  $('#cr-saved').textContent = savedAt ? `저장 ${savedAt.slice(0, 16).replace('T', ' ')}` : '저장 전 · 기본값';
  renderPlan(plan, planSaved); renderCash();
}
function renderPlan(plan, saved) {
  const rows = [...new Set([...S.positions.map(p => p.symbol), ...Object.keys(plan)])];
  if (!rows.length) { $('#cr-plan').innerHTML = '<p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 보유 종목이 나옵니다.</p>'; return; }
  const total = S.positions.reduce((a, p) => a + p.valueKrw, 0) + (Number.isFinite(S.cash) ? S.cash : 0);
  $('#cr-plan').innerHTML = `${saved ? '' : '<p class="cr-note">저장된 계획이 없어 지금 비중으로 채워 두었습니다. 고친 뒤 저장하십시오.</p>'}
    <div class="table-wrap"><table class="cr-table"><thead><tr><th>종목</th><th>지금</th><th>계획</th><th></th></tr></thead><tbody>${rows.map(s => { const p = S.positions.find(x => x.symbol === s), v = plan[s], name = p?.name || v?.name || stockName(s), now = p && total ? p.valueKrw / total * 100 : 0;
      return `<tr data-sym="${esc(s)}" data-name="${esc(name)}" data-cur="${esc(p?.currency || v?.currency || 'KRW')}"><td><b>${esc(name)}</b>${isLeveraged({ symbol: s, name }) ? '<small class="bad">레버리지·인버스</small>' : ''}</td><td>${now.toFixed(1)}%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="${Number.isFinite(planPctOf(v)) ? planPctOf(v) : 0}" min="0" max="100" step="0.5" inputmode="decimal"><em>%</em></span></td><td>${p ? '' : '<button type="button" class="text-button cr-del">빼기</button>'}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><td>합계</td><td></td><td id="cr-plan-sum"></td><td></td></tr></tfoot></table></div>
    <form id="cr-add" class="cr-addrow"><input id="cr-add-sym" list="symbols" placeholder="계획에 종목 추가 (예: KODEX 200, SPY)" autocomplete="off"><button type="submit" class="secondary">추가</button></form>`;
  const sum = () => { const t = [...document.querySelectorAll('.cr-plan-in')].reduce((a, i) => a + (Number(i.value) || 0), 0); $('#cr-plan-sum').textContent = `${t.toFixed(1)}% · 현금 ${(100 - t).toFixed(1)}%`; };
  document.querySelectorAll('.cr-plan-in').forEach(i => i.oninput = sum); sum();
  document.querySelectorAll('.cr-del').forEach(b => b.onclick = () => b.closest('tr').remove());
  $('#cr-add').onsubmit = async ev => { ev.preventDefault(); const t = $('#cr-add-sym').value.trim(); if (!t) return; try { const sym = /^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t) ? t.toUpperCase() : (await resolveStockInput(t)).split('.')[0]; const tr = document.createElement('tr'); const name = /^[A-Z]/.test(sym) ? sym : stockName(sym); tr.dataset.sym = sym; tr.dataset.name = name; tr.dataset.cur = /^[A-Z]/.test(sym) ? 'USD' : 'KRW'; tr.innerHTML = `<td><b>${esc(name)}</b></td><td>0.0%</td><td><span class="cr-in"><input type="number" class="cr-plan-in" value="5" min="0" max="100" step="0.5"><em>%</em></span></td><td><button type="button" class="text-button cr-del">빼기</button></td>`; $('#cr-plan tbody').append(tr); tr.querySelector('.cr-plan-in').oninput = sum; tr.querySelector('.cr-del').onclick = () => tr.remove(); $('#cr-add-sym').value = ''; sum(); } catch (e2) { $('#cr-err').textContent = e2.message; } };
}
function readForm() {
  const raw = {}; for (const d of RULE_DEFS) { const el = rulesPage.querySelector(`[name="${d.id}"]`); if (el) raw[d.id] = d.type === 'bool' ? el.checked : el.value; }
  const { rules, errors } = normalizeRules(raw), plan = {};
  for (const tr of document.querySelectorAll('#cr-plan tbody tr')) { const v = Number(tr.querySelector('.cr-plan-in')?.value); if (v > 0) plan[tr.dataset.sym] = { pct: v, name: tr.dataset.name, currency: tr.dataset.cur }; if (v > rules.maxSingle) errors.push(`${tr.dataset.name} 계획 ${v}%가 한 종목 최대 비중 ${rules.maxSingle}%를 넘습니다.`); }
  const sum = Object.values(plan).reduce((a, v) => a + v.pct, 0); if (sum > 100 - rules.minCash + 0.05) errors.push(`계획 합계 ${sum.toFixed(1)}%가 (100 − 현금 최소 ${rules.minCash}%)를 넘습니다.`);
  return { rules, plan, errors };
}
$('#cr-save').onclick = () => { const { rules, plan, errors } = readForm(); $('#cr-err').textContent = errors.join(' '); if (errors.length) return; if (!save({ rules, plan })) { $('#cr-err').textContent = '이 브라우저에 저장하지 못했습니다(저장 공간 차단).'; return; } renderRules(); S.loading = loadAll(); $('#cr-saved').textContent = '저장했습니다'; };
$('#cr-default').onclick = () => { const v = loadSaved(); save({ rules: DEFAULT_RULES, plan: v?.plan || null }); renderRules(); renderToday(); cqInit(); };
// ── 세 질문 카드 ──
const cq = { prefs: null };
function cqRead() { const v = k => rulesPage.querySelector(`[name="${k}"]:checked`)?.value; return { lossMonthly: Number(v('cq-loss')) || 10, sectors: Number(v('cq-sec')) || 5, cadence: v('cq-cad') || 'weekly' }; }
function cqSet(prefs) { for (const [k, val] of [['cq-loss', prefs.lossMonthly], ['cq-sec', prefs.sectors], ['cq-cad', prefs.cadence]]) { const el = rulesPage.querySelector(`[name="${k}"][value="${val}"]`); if (el) el.checked = true; } }
function cqRender(custom = false) {
  const p = presetRules(cqRead()); cq.prefs = p;
  $('#cq-loss-d').textContent = LOSS_OPTIONS.find(o => o.id === p.prefs.lossMonthly)?.desc || ''; $('#cq-sec-d').textContent = SECTOR_OPTIONS.find(o => o.id === p.prefs.sectors)?.desc || ''; $('#cq-cad-d').textContent = CADENCE_OPTIONS.find(o => o.id === p.prefs.cadence)?.desc || '';
  $('#cq-explain').innerHTML = p.explain.map(t => `<li>${esc(t)}</li>`).join('');
  $('#cr-quick-state').textContent = custom ? '지금 규칙은 직접 조정한 값입니다' : '';
  cqRisk(p);
}
// 허용 손실은 목표이지 보장이 아니다. 모델 추정(지금 보유의 하루 95% 손실 → 월 환산), 기본 계획의 과거 최대 낙폭, 충격 시나리오를 따로 보여 준다.
let PLAN_DOC_RULES = null; fetch('/data/paper-plan.json').then(r => r.ok ? r.json() : null).then(d => { PLAN_DOC_RULES = d; if (cq.prefs) cqRisk(cq.prefs); }).catch(() => {});
function cqRisk(p) {
  const box = $('#cq-risk'); if (!box) return; const parts = [];
  try { if (S.positions.length && Object.keys(S.risk).length) { const e = evaluate(state()); if (e.varNow?.ok && e.total > 0) { const d = e.varNow.var95 / e.total * 100; parts.push(`지금 보유의 하루 95% 손실 추정 <b>−${won(e.varNow.var95)}</b> (총자산의 ${d.toFixed(2)}%) → 월 환산 약 ${(d * Math.sqrt(21)).toFixed(1)}% (√21 · 날마다 독립 가정)`); } } } catch { }
  const v = PLAN_DOC_RULES?.validation; if (v) { const wins = (v.windows || []).filter(x => x.ok && x.plan?.rule), worst = wins.length ? Math.min(...wins.map(x => x.plan.rule.mdd)) : null, sc = v.scenarios || [], worstSc = sc.length ? Math.min(...sc.map(x => x.planPct)) : null; if (worst !== null) parts.push(`기본 계획 ${esc(PLAN_DOC_RULES.version)}의 2020~2026 최대 낙폭 <b>${worst}%</b>`); if (worstSc !== null) parts.push(`충격 시나리오 최악 <b>${worstSc}%</b> (${esc(sc.find(x => x.planPct === worstSc)?.name || '')})`); }
  box.innerHTML = `<p class="cr-muted"><b>한 달 ${p.prefs.lossMonthly}%는 허용 손실(목표)이지 보장이 아닙니다.</b> ${parts.length ? '모델 추정: ' + parts.join(' · ') + '.' : '보유 자료를 불러오면 모델 추정치를 함께 보여 줍니다.'} 급락장에서는 변동성과 상관이 함께 커져 추정보다 클 수 있습니다. 하루 한도는 그 날의 손실을 막는 것이 아니라 다음 날의 비중을 줄이는 장치입니다.</p>`;
}
function cqInit() { const saved = loadSaved(); const n = saved?.prefs?.lossMonthly ? { ...saved.prefs, custom: false } : nearestPreset(current().rules); cqSet(n); cqRender(n.custom); }
rulesPage.querySelectorAll('[name="cq-loss"],[name="cq-sec"],[name="cq-cad"]').forEach(r => r.onchange = () => cqRender(false));
$('#cq-apply').onclick = () => { const p = cq.prefs || presetRules(cqRead()); const saved = loadSaved(); if (!save({ rules: p.rules, plan: saved?.plan || null, prefs: { ...p.prefs, sectorCap: p.sectorCap, cadence: p.cadence } })) { $('#cr-err').textContent = '이 브라우저에 저장하지 못했습니다.'; return; } $('#cr-quick-state').textContent = '저장했습니다'; renderRules(); renderToday(); };
$('#cq-pc').onclick = async () => { const p = cq.prefs || presetRules(cqRead()), st = $('#cq-pc-state'); st.textContent = 'PC에 보내는 중…'; try { const r = await privateRead('paper-live-prefs', { rules: p.rules, cadence: p.cadence, sectorCap: p.sectorCap, prefs: p.prefs, reason: $('#cq-reason')?.value.trim() || '', expected: $('#cq-expect')?.value.trim() || '' }); st.textContent = `PC 모의계좌 규칙 저장 ${String(r.savedAt).slice(0, 16).replace('T', ' ')} · 점검 ${CADENCE_OPTIONS.find(o => o.id === r.cadence)?.label || r.cadence}${r.changed?.length && !r.changed.includes('init') ? ' · 변경 ' + r.changed.join(', ') + ' (이력에 기록)' : ''}`; void renderReview(); } catch (e) { st.textContent = e?.status === 503 ? 'PC에 모의투자 키가 없습니다.' : (e?.message || 'PC 연결이 필요합니다(설정에서 연결).'); } };
// ── 기록으로 점검 ──
async function renderReview() {
  const box = $('#cr-review-body'); if (!box) return;
  try {
    const st = await privateRead('paper-live-status'); let indexPct = null;
    try { const m0 = st.marks?.[0]; if (m0) { const d = await fetchCandles('069500', 'KRW', '1y'); const c = (d.candles || []).filter(x => x.close > 0), base = c.find(x => x.date >= m0.date) || c[0]; indexPct = base ? c.at(-1).close / base.close - 1 : null; } } catch { }
    const r = reviewRules(st, current().rules, { indexPct });
    box.innerHTML = `<p class="cr-muted">모의계좌 ${esc(st.label || st.account || '')} · 운용 ${r.days}일 · 규칙 ${st.prefs?.savedAt ? 'PC 저장 ' + String(st.prefs.savedAt).slice(0, 10) : '기본값'} · 점검 ${CADENCE_OPTIONS.find(o => o.id === (st.prefs?.cadence || 'weekly'))?.label || ''}</p>
      <ul class="cr-find">${r.findings.map(f => `<li><span class="ct-chip ${f.tone > 0 ? 'ok' : f.tone < 0 ? 'bad' : 'na'}">${f.tone > 0 ? '좋음' : f.tone < 0 ? '주의' : '참고'}</span><div><b>${esc(f.text)}</b>${f.suggest ? `<small>${esc(f.suggest)}</small>` : ''}</div></li>`).join('')}</ul>
      ${r.findings.some(f => f.suggest) ? '<p class="cr-muted">제안은 지난 기록의 측정에서 나온 것이고, 바꾸려면 위 세 질문에서 고르고 "PC 모의계좌에도 적용"을 누르십시오.</p>' : ''}`;
  } catch (e) { box.innerHTML = `<p class="cr-muted">${esc(e?.status === 503 ? 'PC에 모의투자 키가 없어 기록이 없습니다.' : 'PC 모의계좌에 연결되어 있지 않습니다. 설정에서 PC를 연결하면 기록으로 점검합니다.')}</p>`; }
}
$('#cr-review-go').onclick = renderReview;
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'rules') { cqInit(); void renderReview(); } });
cqInit();

rulesPage.addEventListener('click', e => { if (e.target.id === 'cr-fill') { const rules = readForm().rules; const p = initialPlan(S.positions, S.cash, rules); renderPlan(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { pct: v }])), false); } });
function renderCash() {
  const box = $('#cr-cash'); if (!box) return;
  box.innerHTML = `${Number.isFinite(S.cash) ? `<p class="cr-cash-now"><b>${won(S.cash)}</b><small>${esc(S.cashSource)}</small></p>` : '<p class="cr-muted">기록된 현금이 없습니다. 현금 규칙은 확인할 수 없습니다.</p>'}
    <form id="cr-cash-form" class="cr-addrow"><input id="cr-cash-in" type="number" min="0" step="any" inputmode="numeric" placeholder="지금 현금(원)"><button type="submit" class="secondary">기록</button></form><p class="cr-muted" id="cr-cash-state" role="status"></p>`;
  $('#cr-cash-form').onsubmit = async ev => { ev.preventDefault(); const amount = Number($('#cr-cash-in').value); if (!(amount >= 0)) return;
    if (S.snap?.demo) { S.cash = amount; S.cashSource = `${S.snap.paper ? '모의계좌' : '예시'}(저장 안 함)`; renderRules(); renderToday(); return; }
    try { const c = await privateRead('cash-set', { amount, note: '규칙 화면' }); S.cash = c?.latest?.amount ?? amount; S.cashSource = 'PC 기록'; window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: { amount: S.cash, recordedAt: new Date().toISOString() } })); renderRules(); renderToday(); }
    catch (e2) { $('#cr-cash-state').textContent = `PC에 기록하지 못했습니다: ${e2.message}`; } };
}
function renderEvidence() {
  const box = $('#cr-evidence'); if (!box || !evidence) return;
  const C = 'C', rows = Object.values(evidence.portfolios).map(p => ({ label: p.label, h: p.hold.check, r: p.variants[C].check, t: p.variants[C].trading, v: p.variants[C].var }));
  box.innerHTML = `<p class="cr-muted">2020~2026(기본값을 고를 때 쓰지 않은 기간) · 그냥 보유 → 규칙대로</p>
    <div class="table-wrap"><table class="cr-table cr-ev"><thead><tr><th>포트폴리오</th><th>최대 손실</th><th>위험 대비 수익</th><th>연 수익</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.label)}</td><td>${x.h.mdd}% → <b>${x.r.mdd}%</b></td><td>${x.h.sharpe} → <b>${x.r.sharpe}</b></td><td>${x.h.cagr}% → ${x.r.cagr}%</td></tr>`).join('')}</tbody></table></div>
    <ul class="cr-facts"><li>하루 95% 손실 범위를 넘은 날 ${Math.min(...rows.map(x => x.v.rule95.rate))}~${Math.max(...rows.map(x => x.v.rule95.rate))}% (목표 5%)</li><li>맞추는 횟수 연 ${Math.min(...rows.map(x => x.t.tradesPerYear))}~${Math.max(...rows.map(x => x.t.tradesPerYear))}번 · 30일 매매 상한을 넘은 기간 ${Math.max(...rows.map(x => x.t.over30DayLimitShare))}% 이하</li><li>수익률은 그냥 보유보다 낮았습니다. 큰 손실을 줄이는 규칙입니다.</li></ul>`;
}

// ── ③ 매매 전 확인 ───────────────────────────────────────────
const preP = addView('precheck', '매매 전 확인', `<div class="page-head"><div><h1>매매 전 확인 ${tip('주문을 넣기 전에 내 규칙에 맞는지, 이 돈이 하루에 얼마까지 흔들릴 수 있는지 봅니다. 실제 주문은 하지 않습니다.')}</h1><p>사거나 팔기 전에 포트폴리오 규칙과 손실 범위를 봅니다</p></div></div>
<div class="cp"><form class="cp-form cr-card" id="cp-form">
  <label class="cp-l">종목</label><div class="cp-chips" id="cp-chips"></div><div class="cp-search"><input id="cp-sym" autocomplete="off" placeholder="이름·코드·티커로 찾기 (예: 현대, 005380, NVDA)" aria-autocomplete="list"><div class="cp-sugg" id="cp-sugg" hidden role="listbox"></div></div>
  <label class="cp-l">방향</label><div class="cp-seg" role="radiogroup"><label><input type="radio" name="cp-side" value="BUY" checked><span>매수</span></label><label><input type="radio" name="cp-side" value="SELL"><span>매도</span></label></div>
  <label class="cp-l" for="cp-amt">금액(원)</label><input id="cp-amt" type="number" min="1000" step="any" inputmode="numeric" placeholder="예: 1000000">
  <button type="submit" class="primary" id="cp-run">확인하기</button><p class="cp-state" id="cp-state" role="status"></p></form>
  <div class="cp-result" id="cp-result"><div id="cp-stock"></div><div id="cp-check"><div class="cr-card cp-empty"><p>종목을 고르면 오늘 등락과 1년 흐름이 여기 뜹니다. 방향·금액을 넣고 확인하기를 누르면 포트폴리오 규칙으로 점검합니다.</p></div></div></div></div>`);
let cpSel = null;
function renderPrecheckChips() { const box = $('#cp-chips'); if (!box) return; box.innerHTML = S.positions.map(p => `<button type="button" data-sym="${esc(p.symbol)}" class="${cpSel?.symbol === p.symbol ? 'on' : ''}">${esc(p.name)}</button>`).join('') || '<span class="cr-muted">보유 종목 없음</span>'; box.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => { cpSel = S.positions.find(p => p.symbol === b.dataset.sym); $('#cp-sym').value = ''; renderPrecheckChips(); void showStockPanel(cpSel); }); }
async function chosen() {
  const t = $('#cp-sym').value.trim();
  if (!t) { if (cpSel) return cpSel; throw new Error('종목을 고르거나 적어 주십시오.'); }
  if (/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(t)) return { symbol: t.toUpperCase(), name: t.toUpperCase(), currency: 'USD' };
  const s = await resolveStockInput(t); return { symbol: s.split('.')[0], name: stockName(s), currency: 'KRW' };
}
$('#cp-sym').oninput = () => { if ($('#cp-sym').value.trim()) { cpSel = null; renderPrecheckChips(); } };
// 매매 전 확인: 종목 검색 제안은 공용 모듈(stock-search-ui.js). 고르면 오늘 등락·1년 차트 패널을 연다.
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
const repP = addView('report', '성적표', `<div class="page-head"><div><h1>성적표 ${tip('같은 기간을 세 가지로 비교합니다. 내가 실제로 한 것(체결 기록으로 날마다 보유를 되돌림), 기간 첫날 보유를 그냥 들고 있었을 때, 오늘 점검을 주 1회 따랐을 때. 주식 부분만 비교하고 현금 이자는 넣지 않습니다.')}</h1><p>내 매매 · 그냥 보유 · 규칙대로</p></div>
  <div class="cp-seg rp-period" role="radiogroup">${[[30, '최근 1개월'], [91, '3개월'], [182, '6개월']].map(([d, l], i) => `<label><input type="radio" name="rp-p" value="${d}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
<div id="rp-body"><div class="cr-card"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div></div>`);
repP.querySelectorAll('[name="rp-p"]').forEach(r => r.onchange = () => void renderReport());
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'report') void renderReport(); });
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
  if (!S.positions.length) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 계산합니다.</p></div>'; return; }
  body.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div></div>';
  if (S.loading) await S.loading;
  if (!S.orders) { body.innerHTML = '<div class="cr-card"><p class="cr-muted">체결 이력을 불러오지 못했습니다. 설정에서 PC 연결을 확인하십시오.</p></div>'; return; }
  const days = Number(repP.querySelector('[name="rp-p"]:checked').value), from = daysAgo(days), to = today();
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
