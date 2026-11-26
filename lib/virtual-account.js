// 가상 모의계좌(결정 62 · 2026-11-24) — 브라우저·Node 공용 · 증권사 없이 누구나 자기 계좌를 만든다.
// 사용자: "가상체결 방식으로 · 정확도는 코드에서 잘 처리하고, 실시간도 잘 보장해야겠지."
// 절차는 팀 모의계좌와 같은 엔진(core-rules evaluate · preTradeCheck, core-risk buildEngine)이고, 다른 것은 체결뿐이다:
//   · 장중: 그 순간의 현재가(네이버 증권 · 시각·지연 표시가 붙은 값)에 호가 차이 절반 + 충격 비용만큼 불리하게, 호가 단위로 맞춰 바로 체결한다.
//   · 장 밖 · 시세가 낡음: 주문을 '대기'로 두고, 그 뒤 처음 열린 세션의 시가(일봉)로 체결한다(그 사이 화면을 안 봤어도 같은 결과 — 결정론적).
//   · 비용: 수수료 · 국내 주식 매도 거래세 · 미국 매도 SEC 수수료 · 달러 종목은 원화를 자동 환전(환율 ± 환전 스프레드).
//   · 1주 단위(미국 소수점 없음) · 매도 먼저, 그 돈으로 매수 · 현금이 모자라면 살 수 있는 만큼만.
// 장부는 이 브라우저(localStorage)에만 있다. 실제 주문은 없다. 비용 값은 아래 COSTS 에 모아 두고 화면에 그대로 보인다.
import { evaluate, preTradeCheck, normalizeRules, planPctOf, DEFAULT_RULES } from './core-rules.js';
import { buildEngine } from './core-risk.js';

export const VA_VERSION = 'VA1-2026-11-24';
// 비용 가정(편도). 근거: 국내 온라인 수수료 0.015% 안팎(증권사별) · 증권거래세 0.20%(2026-01-01 매도분부터 · 코스피 0.05%+농특세 0.15% · 코스닥 0.20% · 언론 기사 기준) · ETF 매도 거래세 없음 ·
// 미국 수수료 0.1%(토스 기준) · SEC Section 31 수수료 매도 금액의 0.00206%($20.60/100만 달러 · 2026-04-04부터 · SEC Fee Rate Advisory 2026-2) · 호가 차이 절반은 대형 종목·ETF 기준 근사 · 환전 스프레드 0.25%.
export const COSTS = {
  KR: { commission: 0.00015, sellTax: { stock: 0.002, etf: 0 }, halfSpreadBp: { stock: 5, etf: 3 } },
  US: { commission: 0.001, secFee: 0.0000206, halfSpreadBp: { stock: 3, etf: 2 } },
  impactBp: 2, fxSpread: 0.0025, quoteMaxAgeSec: 180, openWindowMin: { KR: 10, US: 15 }, openSpreadMult: { KR: 2, US: 3 },
};
export const isKrCode = s => /^\d[\dA-Z]{5}$/.test(String(s || '').split('.')[0]);
export const marketOf = s => (isKrCode(s) ? 'KR' : 'US');
const ETF_RE = /ETF|KODEX|TIGER|ACE|RISE|SOL|HANARO|KOSEF|ARIRANG|PLUS|SPDR|iShares|Vanguard|Invesco|Trust|ProShares|Direxion|Global X|S&P\s?500|나스닥100/i;
const ETF_US = new Set(['SPY', 'IVV', 'VOO', 'QQQ', 'IAU', 'GLD', 'GLDM', 'SPYM', 'TLT', 'IEF', 'SCHD', 'VTI', 'BOTZ', 'ROBO', 'UPRO', 'SPXU', 'TQQQ', 'SQQQ', 'SOXX', 'SMH', 'XLK', 'XLE', 'XLF', 'DIA', 'IWM', 'EFA', 'EEM']);
export const kindOf = (symbol, name = '') => (ETF_US.has(String(symbol).toUpperCase()) || ETF_RE.test(name) ? 'etf' : 'stock');
/** 호가 단위: 미국 0.01 · 국내 주식은 가격대별 · 국내 ETF 는 2,000원 미만 1원 · 이상 5원. */
export function tickSize(price, market, kind = 'stock') { if (market === 'US') return 0.01; if (kind === 'etf') return price < 2000 ? 1 : 5; return price < 2000 ? 1 : price < 5000 ? 5 : price < 20000 ? 10 : price < 50000 ? 50 : price < 200000 ? 100 : price < 500000 ? 500 : 1000; }
const etParts = d => { const o = {}; for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) o[p.type] = p.value; return { ymd: `${o.year}-${o.month}-${o.day}`, h: Number(o.hour) % 24, m: Number(o.minute), wd: o.weekday }; };
const kstParts = d => { const k = new Date(d.getTime() + 9 * 3600e3); return { ymd: k.toISOString().slice(0, 10), h: k.getUTCHours(), m: k.getUTCMinutes(), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][k.getUTCDay()] }; };
/** 정규장(휴장일은 모른다 — 휴장일에는 현재가가 '장 마감'이라 장중 체결이 일어나지 않고, 대기 주문은 다음 일봉 시가로 간다). */
export function sessionState(at, market) {
  const p = market === 'US' ? etParts(at) : kstParts(at), hm = p.h * 60 + p.m, [o, c] = market === 'US' ? [570, 960] : [540, 930];
  const weekday = !['Sat', 'Sun'].includes(p.wd);
  return { market, date: p.ymd, weekday, open: weekday && hm >= o && hm < c, beforeOpen: !weekday || hm < o, minutes: hm };
}
/** 대기 주문이 체결될 세션의 날짜(현지): 장 시작 전이면 그날, 아니면 다음 날 이후 첫 일봉. */
export const sessionAfter = (iso, market) => { const s = sessionState(new Date(iso), market); return { date: s.date, inclusive: s.weekday && s.beforeOpen }; };

/** 현재가가 체결에 쓸 만한가: 장중 표시 · 가격 > 0 · 체결 시각이 COSTS.quoteMaxAgeSec + 지연 분 안. */
export function quoteUsable(q, now, market) {
  if (!q || !(q.price > 0)) return { ok: false, why: '시세 없음' };
  if (q.status !== 'OPEN') return { ok: false, why: '장 마감' };
  if (!sessionState(new Date(now), market).open) return { ok: false, why: '장 마감' };
  const at = Date.parse(q.at || q.fetchedAt || ''), age = Number.isFinite(at) ? (now - at) / 1000 : Infinity, limit = COSTS.quoteMaxAgeSec + (Number(q.delayMin) || 0) * 60;
  if (Number(q.delayMin) > 0) return { ok: false, why: `지연 시세(${q.delayMin}분) — 다음 장 시가로` }; // 결정 64: 지연 값으로 바로 체결하면 이미 지나간 가격으로 사고팔 수 있다
  if (age > limit) return { ok: false, why: `시세가 ${Math.round(age / 60)}분 전 값` };
  const s = sessionState(new Date(now), market), [o] = market === 'US' ? [570] : [540];
  return { ok: true, delayMin: 0, atOpen: s.minutes - o < COSTS.openWindowMin[market] };
}
/** 체결가: 현재가(또는 시가)에서 호가 차이 절반 + 충격만큼 불리하게, 호가 단위로 불리한 쪽 반올림. */
export function execPrice(price, side, market, kind, { atOpen = false } = {}) {
  const half = COSTS[market].halfSpreadBp[kind] ?? COSTS[market].halfSpreadBp.stock, bp = half * (atOpen ? COSTS.openSpreadMult[market] : 1) + COSTS.impactBp, raw = price * (1 + (side === 'BUY' ? 1 : -1) * bp / 1e4), t = tickSize(raw, market, kind);
  const n = side === 'BUY' ? Math.ceil(raw / t - 1e-9) : Math.floor(raw / t + 1e-9), p = n * t;
  return market === 'US' ? Math.round(p * 100) / 100 : Math.round(p);
}

export function createAccount({ startKrw, planSource = 'team', now = Date.now(), id = null }) {
  const cap = Math.round(Number(startKrw));
  if (!(cap >= 1_000_000 && cap <= 10_000_000_000)) throw new Error('시작 자금은 100만~100억 원 사이로 정해 주세요.');
  return { version: VA_VERSION, id: id || `VA${now.toString(36)}`, createdAt: new Date(now).toISOString(), startKrw: cap, cashKrw: cap, planSource, positions: {}, orders: [], marks: [], checks: [], feesKrw: 0, taxKrw: 0, fxCostKrw: 0, slipKrw: 0 };
}
const r2 = v => Math.round(v * 100) / 100;

/**
 * 한 주문 체결(장부를 바꾼다). price = 기준가(현재가 또는 시가, 현지 통화) · fx = 원/달러 중간값.
 * 매수는 현금(수수료·환전 포함) 안에서 살 수 있는 만큼만 · 매도는 보유 수량까지. 0주면 'unfilled'.
 */
export function fill(acc, o, { price, fx, at, source }) {
  const m = marketOf(o.symbol), kind = o.kind || kindOf(o.symbol, o.name), usd = m === 'US';
  if (!(price > 0)) return { status: 'unfilled', why: '가격 없음' };
  if (usd && !(fx > 0)) return { status: 'unfilled', why: '환율 없음' };
  const px = execPrice(price, o.side, m, kind, { atOpen: Boolean(o.atOpen) }), c = COSTS[m], fxB = usd ? fx * (1 + COSTS.fxSpread) : 1, fxS = usd ? fx * (1 - COSTS.fxSpread) : 1;
  const pos = acc.positions[o.symbol] || { qty: 0, costKrw: 0, name: o.name, currency: usd ? 'USD' : 'KRW', kind };
  let qty = Math.floor(Number(o.qty) || 0), note = '';
  if (o.side === 'BUY') {
    const unit = px * (1 + c.commission) * fxB, afford = Math.floor(acc.cashKrw / unit + 1e-9);
    if (qty > afford) { qty = afford; note = '현금에 맞춰 수량 줄임'; }
    if (!(qty > 0)) return { status: 'unfilled', why: afford <= 0 ? '현금 부족' : '1주 미만' };
    const gross = qty * px, fee = gross * c.commission, krw = (gross + fee) * fxB;
    acc.cashKrw -= krw; pos.qty += qty; pos.costKrw += krw; acc.feesKrw += fee * fxB; if (usd) acc.fxCostKrw += (gross + fee) * (fxB - fx);
    acc.slipKrw += qty * (px - price) * fxB;
    acc.positions[o.symbol] = pos;
    return { status: 'filled', qty, price: px, ref: price, at, source, feeKrw: fee * fxB, taxKrw: 0, amountKrw: krw, fx: usd ? fx : null, note };
  }
  if (qty > pos.qty) { qty = pos.qty; note = '보유 수량까지만'; }
  if (!(qty > 0)) return { status: 'unfilled', why: '팔 수량 없음' };
  const gross = qty * px, fee = gross * c.commission, tax = usd ? gross * c.secFee : gross * (c.sellTax[kind] ?? c.sellTax.stock), krw = (gross - fee - tax) * fxS;
  const costOut = pos.costKrw * qty / pos.qty;
  acc.cashKrw += krw; pos.qty -= qty; pos.costKrw -= costOut; acc.feesKrw += fee * fxS; acc.taxKrw += tax * fxS; if (usd) acc.fxCostKrw += (gross - fee - tax) * (fx - fxS);
  acc.slipKrw += qty * (price - px) * fxS;
  if (pos.qty <= 0) delete acc.positions[o.symbol]; else acc.positions[o.symbol] = pos;
  return { status: 'filled', qty, price: px, ref: price, at, source, feeKrw: fee * fxS, taxKrw: tax * fxS, amountKrw: krw, realizedKrw: krw - costOut, fx: usd ? fx : null, note };
}

/**
 * 주문 넣기: 그 시장의 현재가를 쓸 수 있으면 바로 체결, 아니면 대기(다음 세션 시가). 매도 먼저.
 * items: [{symbol, name, side, qty, why}] · quotes: {symbol: quote} · fx: 원/달러
 */
export function place(acc, items, { quotes = {}, fx = null, now = Date.now(), checkId = null } = {}) {
  const out = [], at = new Date(now).toISOString();
  for (const it of [...items].sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1))) {
    const m = marketOf(it.symbol), q = quotes[it.symbol], u = quoteUsable(q, now, m);
    const o = { id: `o${now.toString(36)}${acc.orders.length.toString(36)}`, at, symbol: it.symbol, name: it.name || it.symbol, side: it.side, qty: Math.floor(it.qty), kind: kindOf(it.symbol, it.name), market: m, why: it.why || '', check: checkId, status: 'queued' };
    if (u.ok) { o.atOpen = u.atOpen; const f = fill(acc, o, { price: q.price, fx, at, source: u.atOpen ? '현재가(개장 직후 · 호가 차이 넓게)' : '현재가' }); Object.assign(o, f.status === 'filled' ? { status: 'filled', fill: f } : { status: 'unfilled', reason: f.why }); }
    else o.waitWhy = u.why;
    acc.orders.push(o); out.push(o);
  }
  if (acc.orders.length > 2000) acc.orders.splice(0, acc.orders.length - 2000);
  return out;
}

/**
 * 대기 주문 처리. 먼저 '주문 뒤 처음 열린 세션의 시가'가 일봉에 있으면 그 값으로(화면을 안 본 동안 열린 장), 없으면 지금 쓸 수 있는 현재가로.
 * candles: {symbol: [{date, open, close}]} 현지 날짜 · fxCandles: [{date, open, close}] · 시가 체결의 환율은 그날 환율 시가(없으면 종가).
 */
export function processQueue(acc, { candles = {}, fxCandles = [], quotes = {}, fx = null, now = Date.now() } = {}) {
  const done = [], q = acc.orders.filter(o => o.status === 'queued').sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1));
  const fxOn = d => { const c = fxCandles.filter(x => x.date <= d && (x.open > 0 || x.close > 0)).at(-1); return c ? (c.open > 0 ? c.open : c.close) : null; };
  for (const o of q) {
    const s = sessionAfter(o.at, o.market), bar = (candles[o.symbol] || []).find(c => (s.inclusive ? c.date >= s.date : c.date > s.date) && (c.open > 0 || c.close > 0));
    const nowS = sessionState(new Date(now), o.market), barStarted = bar && (bar.date < nowS.date || (bar.date === nowS.date && !nowS.beforeOpen));
    let f = null;
    if (barStarted) { o.atOpen = true; f = fill(acc, o, { price: bar.open > 0 ? bar.open : bar.close, fx: o.market === 'US' ? (fxOn(bar.date) || fx) : null, at: new Date(now).toISOString(), source: `${bar.date} 시가` }); }
    else { const u = quoteUsable(quotes[o.symbol], now, o.market); if (u.ok) { o.atOpen = u.atOpen; f = fill(acc, o, { price: quotes[o.symbol].price, fx, at: new Date(now).toISOString(), source: '현재가(예약 뒤)' }); } }
    if (!f) continue;
    if (f.status === 'filled') { o.status = 'filled'; o.fill = f; } else { o.status = 'unfilled'; o.reason = f.why; }
    done.push(o);
  }
  return done;
}

/** 평가: 현재가(쓸 수 있으면) 또는 마지막 종가로. prices: {symbol: 현지 가격} · fx 중간값. */
export function valuation(acc, { prices = {}, fx = null } = {}) {
  const rows = Object.entries(acc.positions).map(([symbol, p]) => { const px = prices[symbol] ?? null, usd = p.currency === 'USD', v = px > 0 ? p.qty * px * (usd ? (fx || 0) : 1) : null; return { symbol, name: p.name, currency: p.currency, kind: p.kind, qty: p.qty, price: px, valueKrw: v, costKrw: p.costKrw, pnlKrw: v === null ? null : v - p.costKrw }; });
  const known = rows.every(r => r.valueKrw !== null), stock = rows.reduce((a, r) => a + (r.valueKrw || 0), 0), total = acc.cashKrw + stock;
  for (const r of rows) r.weightPct = total > 0 && r.valueKrw !== null ? r.valueKrw / total * 100 : null;
  return { complete: known, totalKrw: total, cashKrw: acc.cashKrw, stockKrw: stock, rows, retPct: (total / acc.startKrw - 1) * 100 };
}
export function mark(acc, totalKrw, now = Date.now()) { const d = kstParts(new Date(now)).ymd, m = { date: d, totalKrw: Math.round(totalKrw), at: new Date(now).toISOString() }, i = acc.marks.findIndex(x => x.date === d); if (i >= 0) acc.marks[i] = m; else acc.marks.push(m); if (acc.marks.length > 800) acc.marks.splice(0, acc.marks.length - 800); return m; }

const isoWeek = ymd => { const t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
/** 점검할 때인가: 처음 · 그 주(KST) 첫 점검 · 수동. 급함(evaluate.urgent)은 decide 결과로 따로 본다. */
export function checkDue(acc, now = Date.now()) { const last = acc.checks.at(-1); if (!last) return { due: true, why: '처음 시작' }; const wk = isoWeek(kstParts(new Date(now)).ymd); return isoWeek(String(last.at).slice(0, 10)) < wk ? { due: true, why: '주간 점검' } : { due: false, why: `이번 주 점검 끝(${String(last.at).slice(0, 10)})` }; }

/**
 * 오늘 점검(팀 모의계좌와 같은 규칙 엔진): 할 일 → 매매 전 확인 → 통과한 것만 주문 목록(수량)으로.
 * plan: {symbol: {pct, name, currency, capExempt?}} · candlesBySymbol: 현지 일봉 2년 · fxCandles · prices·fx: 지금 값(평가·수량 계산)
 */
export function decide(acc, { plan, rules = DEFAULT_RULES, candlesBySymbol = {}, fxCandles = [], prices = {}, fx = null, now = Date.now() }) {
  const R = normalizeRules(rules).rules, today = kstParts(new Date(now)).ymd;
  const syms = [...new Set([...Object.keys(plan || {}), ...Object.keys(acc.positions)])].filter(s => (candlesBySymbol[s] || []).length > 30);
  const meta = Object.fromEntries(syms.map(s => { const cur = marketOf(s) === 'US' ? 'USD' : 'KRW'; return [s, { name: plan?.[s]?.name || acc.positions[s]?.name || s, currency: cur, market: cur === 'USD' ? 'US' : 'KR' }]; }));
  const cs = Object.fromEntries(syms.map(s => [s, candlesBySymbol[s].filter(c => c.close > 0)]));
  const engine = buildEngine(cs, meta, fxCandles.filter(c => c.close > 0), { from: new Date(now - 400 * 864e5).toISOString().slice(0, 10) });
  const pxOf = s => prices[s] > 0 ? prices[s] : cs[s]?.at(-1)?.close || null, krwOf = s => { const p = pxOf(s); return p ? p * (meta[s].currency === 'USD' ? (fx || 0) : 1) : null; };
  const positions = syms.map(s => ({ symbol: s, name: meta[s].name, currency: meta[s].currency, valueKrw: (acc.positions[s]?.qty || 0) * (krwOf(s) || 0) }));
  const P = {}; for (const [k, v] of Object.entries(plan || {})) if (syms.includes(k)) P[k] = v;
  // 200일선 규칙은 팀 모의계좌와 같게: 계획의 핵심 지수·위성 종목에는 쓰지 않는다(결정 28·47) — 계획 밖 보유에만.
  const risk = Object.fromEntries(syms.map(s => { const r = engine.riskAt(s, today); return [s, r && ['core', 'satellite'].includes(plan?.[s]?.role) ? { ...r, trendApplies: false } : r]; })), portVar = h => engine.portVarAt(h, today);
  const d30 = now - 30 * 864e5, trades30 = new Set(acc.orders.filter(o => o.status === 'filled' && Date.parse(o.at) >= d30).map(o => o.check || o.id)).size;
  const e = evaluate({ positions, cashKrw: acc.cashKrw, rules: R, plan: P, risk, portVar, trades30 });
  // 아직 체결 안 된 예약 매수는 곧 현금을 쓰므로 미리 빼고 본다(같은 현금으로 두 번 사지 않게).
  const queuedBuyKrw = acc.orders.filter(o => o.status === 'queued' && o.side === 'BUY').reduce((s, o) => s + o.qty * (krwOf(o.symbol) || 0), 0);
  const orders = [], blocked = []; let settling = acc.cashKrw - queuedBuyKrw; const view = positions.map(p => ({ ...p }));
  for (const a of e.actions) {
    const side = a.kind === 'reduce' ? 'SELL' : 'BUY', order = { symbol: a.symbol, name: a.name, currency: meta[a.symbol].currency, side, amountKrw: Math.round(a.amountKrw) };
    const chk = preTradeCheck({ positions: view, cashKrw: settling, rules: R, plan: P, portVar, trades30 }, order, risk[a.symbol]);
    const why = (a.why || [])[0] || (side === 'SELL' ? '목표 비중보다 많음' : '목표 비중보다 적음');
    // 2026-11-26: 같은 종목에 아직 체결 안 된 예약 주문이 있으면 다시 내지 않는다(예약은 보유에 안 잡혀, 장 밖에 다시 점검하면 같은 주문이 두 번 나갔다 · 팀 모의계좌의 '끝나지 않은 주문' 막음과 같은 뜻).
    const pend = acc.orders.find(o => o.status === 'queued' && o.symbol === a.symbol);
    if (pend) { blocked.push({ symbol: a.symbol, name: a.name, side, amountKrw: order.amountKrw, why: `예약 주문이 이미 있음(${pend.side === 'SELL' ? '매도' : '매수'} ${pend.qty}주 · 다음 장 시가에 체결)` }); continue; }
    if (chk.error || !chk.ok) { blocked.push({ symbol: a.symbol, name: a.name, side, amountKrw: order.amountKrw, why: chk.error || chk.failed.map(c => `${c.label}(${c.detail})`).join(', ') }); continue; }
    const unit = krwOf(a.symbol); if (!(unit > 0)) { blocked.push({ symbol: a.symbol, name: a.name, side, amountKrw: order.amountKrw, why: '가격 없음' }); continue; }
    let qty = Math.floor(order.amountKrw / unit + 1e-9); if (side === 'SELL') { qty = Math.min(qty, acc.positions[a.symbol]?.qty || 0); if (planPctOf(P[a.symbol]) === 0 && P[a.symbol]?.exit) qty = acc.positions[a.symbol]?.qty || 0; }
    if (!(qty > 0)) { blocked.push({ symbol: a.symbol, name: a.name, side, amountKrw: order.amountKrw, why: side === 'SELL' ? '팔 수량 없음' : '1주 미만' }); continue; }
    orders.push({ symbol: a.symbol, name: a.name, side, qty, why });
    settling += side === 'SELL' ? order.amountKrw : -order.amountKrw;
    const vp = view.find(p => p.symbol === a.symbol); if (vp) vp.valueKrw = Math.max(0, vp.valueKrw + (side === 'SELL' ? -order.amountKrw : order.amountKrw));
  }
  return { evaluation: { okCount: e.okCount, known: e.known, urgent: Boolean(e.urgent), checks: e.checks }, orders, blocked, missing: Object.keys(plan || {}).filter(s => !syms.includes(s)) };
}
/** 점검 기록(주문 묶음 = 30일 매매 횟수 1회). */
export function recordCheck(acc, { now = Date.now(), why, orders = [], blocked = [], evaluation = null }) { const c = { id: `c${now.toString(36)}`, at: new Date(now + 9 * 3600e3).toISOString().replace('Z', '+09:00'), why, n: orders.length, blocked: blocked.length, ok: evaluation ? `${evaluation.okCount}/${evaluation.known}` : null }; acc.checks.push(c); if (acc.checks.length > 300) acc.checks.splice(0, acc.checks.length - 300); return c; }

/** 팀 기본 계획(data/paper-plan.json)을 계획 형태로: 핵심 지수는 한 종목 상한 예외 · 정리 종목은 pct 0 · exit. */
export function planFromDoc(doc) { const out = {}; for (const [k, v] of Object.entries(doc?.weights || {})) { const pct = Number(v.pct); if (!(pct > 0) && !v.exit) continue; out[k] = { pct: pct > 0 ? pct : 0, name: v.name || k, currency: v.currency || (isKrCode(k) ? 'KRW' : 'USD'), ...(v.role ? { role: v.role } : {}), ...(v.role === 'core' && v.sector === 'index' ? { capExempt: true } : {}), ...(v.exit ? { exit: true } : {}) }; } return out; }

/** 가져오기 검사(결정 63 · 보안 검토 L1·L2): 형식·숫자 범위·문자열 길이가 맞는 장부만 받는다 — 남이 준 파일로 화면에 HTML 이 끼어들거나 카드가 깨지지 않게. */
export function validateAccount(a) {
  const bad = m => { throw new Error('가상계좌 파일 오류: ' + m); };
  const str = (v, n) => typeof v === 'string' && v.length <= n, fin = v => typeof v === 'number' && Number.isFinite(v), SYM = /^[0-9A-Z.^-]{1,12}$/;
  if (!a || typeof a !== 'object' || Array.isArray(a) || a.version !== VA_VERSION) bad('버전이 다름');
  if (!(fin(a.startKrw) && a.startKrw > 0) || !fin(a.cashKrw) || !str(a.createdAt, 40) || !Number.isFinite(Date.parse(a.createdAt)) || !str(a.id, 40) || !['team', 'mine'].includes(a.planSource)) bad('기본 값');
  for (const k of ['feesKrw', 'taxKrw', 'fxCostKrw', 'slipKrw']) if (a[k] !== undefined && !fin(a[k])) bad(k);
  if (!a.positions || typeof a.positions !== 'object' || Array.isArray(a.positions) || Object.keys(a.positions).length > 200) bad('보유');
  for (const [k, p] of Object.entries(a.positions)) { if (!SYM.test(k) || !p || !(fin(p.qty) && p.qty > 0) || !fin(p.costKrw) || !str(p.name ?? '', 80) || !['KRW', 'USD'].includes(p.currency)) bad(`보유 ${String(k).slice(0, 12)}`); }
  if (!Array.isArray(a.orders) || a.orders.length > 2000 || !Array.isArray(a.marks) || a.marks.length > 800 || !Array.isArray(a.checks) || a.checks.length > 300) bad('목록');
  for (const o of a.orders) {
    if (!o || typeof o !== 'object' || !SYM.test(o.symbol) || !['BUY', 'SELL'].includes(o.side) || !(Number.isInteger(o.qty) && o.qty >= 0 && o.qty <= 1e9) || !['queued', 'filled', 'unfilled', 'cancelled'].includes(o.status) || !['KR', 'US'].includes(o.market) || !str(o.at, 40) || !str(o.name ?? '', 80) || !str(o.why ?? '', 200)) bad('주문');
    for (const k of ['waitWhy', 'reason', 'check', 'id', 'kind']) if (o[k] !== undefined && o[k] !== null && !str(o[k], 80)) bad('주문 문자열');
    if (o.fill !== undefined) { const f = o.fill; if (!f || !(Number.isInteger(f.qty) && f.qty > 0) || !fin(f.price) || !str(f.source ?? '', 40) || !str(f.at ?? '', 40) || !str(f.note ?? '', 80)) bad('체결'); for (const k of ['ref', 'feeKrw', 'taxKrw', 'amountKrw', 'realizedKrw']) if (f[k] !== undefined && !fin(f[k])) bad('체결 숫자'); if (f.fx !== undefined && f.fx !== null && !fin(f.fx)) bad('체결 환율'); }
  }
  for (const m of a.marks) if (!m || !str(m.date, 10) || !fin(m.totalKrw)) bad('날짜별 기록');
  for (const c of a.checks) if (!c || !str(c.at, 40) || !str(c.why ?? '', 40) || !str(c.id ?? '', 40)) bad('점검 기록');
  return a;
}
export { r2 };
