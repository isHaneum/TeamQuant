// 모의투자(paper trading) 엔진 — 브라우저·Node 공용.
// 실제로 투자할 때 거치는 절차를 공개 일봉으로 그대로 재생한다:
//   계획 비중 → (주 1회, 급할 때는 바로) 오늘 점검(evaluate) → 할 일마다 매매 전 확인(preTradeCheck)
//   → 통과한 주문만 다음 거래일 시가에 체결(비용·미끄러짐·1주 단위) → 날마다 원화 평가 → 그냥 보유·지수와 비교.
// 화면의 오늘 점검·매매 전 확인과 같은 엔진(core-rules, core-risk)을 쓰므로 결과는 "앱이 시키는 대로 했다면" 그 자체다.
// 실제 주문은 없다. 같은 입력이면 같은 결과가 나온다(결정론적). 지어낸 시세를 쓰지 않는다(시세가 없는 종목은 빼고 알린다).
import { evaluate, preTradeCheck, DEFAULT_RULES, RULES_VERSION } from './core-rules.js';
import { buildEngine, krwReturns } from './core-risk.js';
import { fitGarch, simulateGarch } from './risk-models.js';

export const PAPER_VERSION = 'P2-2026-11-09';
const weekOf = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const shiftDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
// 정렬된 배열에서 date 이하인 마지막 원소의 위치(없으면 -1)
function lastLE(arr, date) { let lo = 0, hi = arr.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].date <= date) { f = m; lo = m + 1; } else hi = m - 1; } return f; }
function drawdown(path) { let peak = -Infinity, mdd = 0; for (const v of path) { if (!(v > 0)) continue; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); } return mdd; }
function metricsOf(path) {
  const r = []; for (let k = 1; k < path.length; k++) if (path[k - 1] > 0) r.push(path[k] / path[k - 1] - 1);
  const m = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0, sd = r.length > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) : 0;
  return { end: path.at(-1), ret: path[0] > 0 ? path.at(-1) / path[0] - 1 : null, mdd: drawdown(path), vol: sd * Math.sqrt(252), worstDay: r.length ? Math.min(...r) : null, bestDay: r.length ? Math.max(...r) : null, sharpe: sd > 0 ? m / sd * Math.sqrt(252) : null };
}

/** 균등 계획: (100 − 현금 최소 비중) ÷ 종목 수, 한 종목 상한으로 자른다. */
export function equalPlan(basket, rules = DEFAULT_RULES) {
  const n = basket.length; if (!n) return {};
  const pct = Math.min(rules.maxSingle, Math.floor((100 - rules.minCash) / n * 10) / 10);
  return Object.fromEntries(basket.map(b => [b.symbol, pct]));
}

/**
 * 절차 재생(리허설). 시작일 종가에 현금 capitalKrw로 출발해 to까지 절차를 따른다.
 * @param basket [{symbol, name, currency}] 종목 바구니
 * @param candlesBySymbol {symbol: [{date, open, close}]} 현지 통화 일봉(시작일 전 120일 이상 있어야 변동성·200일선 규칙이 계산된다)
 * @param fxCandles USD→KRW 일봉
 * @param plan {symbol: 계획 %} 없으면 균등
 * @param benchmark {symbol, name, currency, candles} 비교 지수(선택) · indexes {KR:{...}, US:{...}} 국가별 지수(선택): '지수+현금' 선을 계획의 국가 비중대로 섞는다
 * @param cost 편도 비용(수수료+세금, 기본 0.2%), slippage 체결 미끄러짐(기본 0.1%: 시가보다 불리하게)
 */
export function rehearse({ basket = [], capitalKrw = 10_000_000, rules = DEFAULT_RULES, plan = null, candlesBySymbol = {}, fxCandles = [], from, to = '9999-12-31', cost = 0.002, slippage = 0.001, benchmark = null, indexes = null, label = '' }) {
  const capital = Number(capitalKrw);
  if (!(capital > 0)) return { ok: false, reason: '시작 자금을 0보다 크게 입력하십시오.' };
  const have = basket.filter(b => Array.isArray(candlesBySymbol[b.symbol]) && candlesBySymbol[b.symbol].length > 30);
  const missing = basket.filter(b => !have.includes(b)).map(b => b.name || b.symbol);
  if (!have.length) return { ok: false, reason: '시세가 있는 종목이 없습니다.' };
  const syms = have.map(b => b.symbol);
  const meta = Object.fromEntries(have.map(b => [b.symbol, { name: b.name || b.symbol, currency: b.currency || 'KRW', market: b.currency === 'USD' ? 'US' : 'KR' }]));
  const P = {}; for (const s of syms) { const v = plan?.[s]; P[s] = Number.isFinite(Number(v)) ? Number(v) : null; }
  if (syms.some(s => P[s] === null)) Object.assign(P, equalPlan(have.filter(b => P[b.symbol] === null), rules));
  const cs = Object.fromEntries(syms.map(s => [s, candlesBySymbol[s].filter(c => c.close > 0)]));
  const dates = [...new Set(syms.flatMap(s => cs[s].map(c => c.date)))].filter(d => d >= from && d <= to).sort();
  if (dates.length < 3) return { ok: false, reason: '기간 안에 시세가 있는 거래일이 부족합니다.' };
  const fxArr = fxCandles.filter(c => c.close > 0);
  const fxAt = d => { const k = lastLE(fxArr, d); return k >= 0 ? fxArr[k].close : fxArr[0]?.close ?? null; };
  const toKrw = (v, s, d) => meta[s].currency === 'USD' ? (fxAt(d) ? v * fxAt(d) : null) : v;
  const closeKrw = (s, d) => { const k = lastLE(cs[s], d); return k < 0 ? null : toKrw(cs[s][k].close, s, cs[s][k].date); };
  // 다음 거래일 시가(그 종목의 다음 봉). 시가가 없으면 종가로 본다.
  const nextOpen = (s, d) => { const k = lastLE(cs[s], d) + 1; const c = cs[s][k]; if (!c) return null; const px = c.open > 0 ? c.open : c.close; return { date: c.date, priceKrw: toKrw(px, s, c.date) }; };
  const lot = s => meta[s].currency === 'USD' ? 1e-6 : 1;
  const floorLot = (q, s) => Math.floor(q / lot(s) + 1e-9) * lot(s);
  const engine = buildEngine(cs, meta, fxArr, { from: shiftDays(dates[0], -120) });

  let cash = capital, fees = 0, slip = 0, breaches = 0, decisionDays = 0, urgentDays = 0;
  const hold = Object.fromEntries(syms.map(s => [s, { qty: 0, costKrw: 0 }]));
  const pending = [], fills = [], journal = [], marks = [], tradeDates = [], blocked = {}, whys = {};
  const log = (date, step, text, extra = {}) => journal.push({ date, step, text, ...extra });
  const won = v => `${Math.round(v).toLocaleString('ko-KR')}원`;
  log(dates[0], '시작', `${label ? label + ' · ' : ''}현금 ${won(capital)} · 종목 ${syms.length}개 · 계획 ${syms.map(s => `${meta[s].name} ${P[s]}%`).join(', ')} · 규칙 ${RULES_VERSION}`);
  if (missing.length) log(dates[0], '알림', `시세가 없어 뺀 종목: ${missing.join(', ')}`);

  let prevTotal = null;
  for (let k = 0; k < dates.length; k++) {
    const d = dates[k], last = k === dates.length - 1;
    // ① 체결: 오늘 시가로 잡힌 주문. 매도 먼저(현금을 만든 뒤 매수).
    const due = pending.filter(o => o.fillDate <= d).sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1));
    for (const o of due) {
      pending.splice(pending.indexOf(o), 1);
      const h = hold[o.symbol], name = meta[o.symbol].name;
      if (o.side === 'SELL') {
        const px = o.priceKrw * (1 - slippage), qty = Math.min(h.qty, floorLot(o.amountKrw / px, o.symbol));
        if (!(qty > 0)) { log(o.fillDate, '미체결', `${name} 매도 ${won(o.amountKrw)}: 1주 미만이라 체결하지 않음`); continue; }
        const gross = qty * px, fee = gross * cost; cash += gross - fee; fees += fee; slip += qty * o.priceKrw * slippage;
        h.costKrw *= h.qty > 0 ? (h.qty - qty) / h.qty : 0; h.qty -= qty; if (h.qty < lot(o.symbol) / 2) { h.qty = 0; h.costKrw = 0; }
        fills.push({ date: o.fillDate, decidedOn: o.decidedOn, symbol: o.symbol, name, side: 'SELL', qty, priceKrw: px, amountKrw: gross, feeKrw: fee, why: o.why });
        tradeDates.push(o.fillDate); log(o.fillDate, '체결', `${name} ${qty.toLocaleString('ko-KR')}주 매도 @${won(px)} = ${won(gross)} (비용 ${won(fee)})`);
      } else {
        const px = o.priceKrw * (1 + slippage), afford = floorLot(Math.max(0, cash) / (px * (1 + cost)), o.symbol);
        let qty = floorLot(o.amountKrw / px, o.symbol), note = '';
        if (qty > afford) { qty = afford; note = ' · 현금에 맞춰 수량 줄임'; }
        if (!(qty > 0)) { log(o.fillDate, '미체결', `${name} 매수 ${won(o.amountKrw)}: ${afford <= 0 ? '현금 부족' : '1주 미만'}이라 체결하지 않음`); continue; }
        const gross = qty * px, fee = gross * cost; cash -= gross + fee; fees += fee; slip += qty * o.priceKrw * slippage;
        h.qty += qty; h.costKrw += gross + fee;
        fills.push({ date: o.fillDate, decidedOn: o.decidedOn, symbol: o.symbol, name, side: 'BUY', qty, priceKrw: px, amountKrw: gross, feeKrw: fee, why: o.why });
        tradeDates.push(o.fillDate); log(o.fillDate, '체결', `${name} ${qty.toLocaleString('ko-KR')}주 매수 @${won(px)} = ${won(gross)} (비용 ${won(fee)})${note}`);
      }
    }
    // ② 평가: 그날 종가로 원화 환산
    const positions = syms.map(s => ({ symbol: s, name: meta[s].name, currency: meta[s].currency, valueKrw: hold[s].qty * (closeKrw(s, d) || 0) }));
    const stock = positions.reduce((a, p) => a + p.valueKrw, 0), total = cash + stock;
    if (prevTotal !== null && total / prevTotal - 1 < -rules.dailyLoss / 100) { breaches++; log(d, '손실', `하루 ${((total / prevTotal - 1) * 100).toFixed(2)}% — 한도 ${rules.dailyLoss}%를 넘은 날`); }
    marks.push({ date: d, total, cash, stock });
    prevTotal = total;
    if (last) break;
    // ③ 점검: 주 마지막 거래일(또는 첫날·급할 때)에 할 일을 정하고, 각 주문을 매매 전 확인에 통과시켜 다음 시가 주문으로 넣는다.
    const risk = Object.fromEntries(syms.map(s => [s, engine.riskAt(s, d)]));
    const recent = () => tradeDates.filter(t => Date.parse(d) - Date.parse(t) < 30 * 864e5).length + pending.length;
    const portVar = h => engine.portVarAt(h, d);
    const e = evaluate({ positions, cashKrw: cash, rules, plan: P, risk, portVar, trades30: recent() });
    const weekEnd = weekOf(dates[k + 1]) !== weekOf(d);
    if (!(k === 0 || weekEnd || e.urgent)) continue;
    decisionDays++; if (e.urgent) urgentDays++;
    log(d, '점검', `규칙 ${e.okCount}/${e.known} 충족 · 할 일 ${e.actions.length}건${e.urgent ? ' · 급함(바로 실행)' : weekEnd ? ' · 주간 점검' : ' · 시작 매수'}${e.varNow?.ok ? ` · 계좌 하루 95% 손실 ${(e.varNow.var95 / total * 100).toFixed(2)}%` : ''}`);
    // 주문은 순서대로 넣으므로, 각 주문의 매매 전 확인은 앞서 넣은 주문이 체결된 뒤의 보유·현금(정산 예정)으로 본다(실제 절차: 먼저 팔고 그 돈으로 산다).
    let settling = cash; const view = positions.map(p => ({ ...p }));
    for (const a of e.actions) {
      const side = a.kind === 'reduce' ? 'SELL' : 'BUY', order = { symbol: a.symbol, name: a.name, currency: meta[a.symbol].currency, side, amountKrw: Math.round(a.amountKrw) };
      const chk = preTradeCheck({ positions: view, cashKrw: settling, rules, plan: P, portVar, trades30: recent() }, order, risk[a.symbol]);
      if (chk.error || !chk.ok) {
        const ids = chk.error ? ['input'] : chk.failed.map(c => c.id); for (const id of ids) blocked[id] = (blocked[id] || 0) + 1;
        log(d, '차단', `${a.name} ${side === 'SELL' ? '매도' : '매수'} ${won(order.amountKrw)} — 매매 전 확인 불통과: ${chk.error || chk.failed.map(c => `${c.label}(${c.detail})`).join(', ')}`); continue;
      }
      const nx = nextOpen(a.symbol, d);
      if (!nx) { log(d, '보류', `${a.name}: 다음 거래일 시세가 없어 주문하지 않음`); continue; }
      const why = (a.why || [])[0] || (side === 'SELL' ? '계획 비중보다 많음' : '계획 비중보다 적음');
      whys[why] = (whys[why] || 0) + 1;
      pending.push({ ...order, decidedOn: d, fillDate: nx.date, priceKrw: nx.priceKrw, why });
      settling += side === 'SELL' ? order.amountKrw * (1 - cost) : -order.amountKrw * (1 + cost);
      const vp = view.find(p => p.symbol === a.symbol); if (vp) vp.valueKrw = Math.max(0, vp.valueKrw + (side === 'SELL' ? -order.amountKrw : order.amountKrw));
      log(d, '주문', `${a.name} ${side === 'SELL' ? '매도' : '매수'} ${won(order.amountKrw)} → ${nx.date} 시가 주문 (${why})`);
    }
  }
  const endDate = dates.at(-1), endPos = syms.map(s => { const v = hold[s].qty * (closeKrw(s, endDate) || 0); return { symbol: s, name: meta[s].name, currency: meta[s].currency, qty: hold[s].qty, costKrw: hold[s].costKrw, valueKrw: v, pnlKrw: v - hold[s].costKrw }; });
  const endTotal = marks.at(-1).total;
  for (const p of endPos) p.weightPct = endTotal ? p.valueKrw / endTotal * 100 : 0;
  // 그냥 보유: 같은 계획을 첫 체결일 시가에 한 번 사고 끝까지 둔다(같은 비용·미끄러짐·1주 단위).
  const holdPath = holdOnly({ syms, P, capital, cs, nextOpen, closeKrw, dates, cost, slippage, floorLot });
  // 지수: 첫날 종가부터의 비율로 같은 자금을 환산. '지수+현금'은 계획의 투자 비중만큼만 지수를 사고 나머지를 현금으로 둔 것 — 손실이 작은 이유가 그냥 현금 때문인지 가르는 비교 기준이다.
  let bench = null, mix = null;
  const ratioPath = bm => { if (!bm?.candles?.length) return null; const bc = bm.candles.filter(c => c.close > 0), bfx = d => bm.currency === 'USD' ? fxAt(d) : 1; const at = d => { const k = lastLE(bc, d); return k < 0 ? null : bc[k].close * (bfx(bc[k].date) || 1); }; const b0 = at(dates[0]); if (!b0) return null; const r = dates.map(d => { const v = at(d); return v ? v / b0 : null; }); return r.every(v => v !== null) ? r : null; };
  const br = ratioPath(benchmark); if (br) bench = { symbol: benchmark.symbol, name: benchmark.name || benchmark.symbol, path: br.map(v => capital * v), metrics: metricsOf(br.map(v => capital * v)) };
  // 지수+현금: 계획의 국가 비중(원화 종목 → 국내 지수, 달러 종목 → 미국 지수)만큼 지수를 사고 나머지는 현금. 지수가 하나뿐이면 그 지수로 모은다.
  const idx = indexes && (indexes.KR || indexes.US) ? indexes : (benchmark ? { [benchmark.currency === 'USD' ? 'US' : 'KR']: benchmark } : null);
  if (idx) {
    const share = { KR: 0, US: 0 }; for (const s of syms) share[meta[s].currency === 'USD' ? 'US' : 'KR'] += P[s] / 100;
    const parts = []; for (const k of ['KR', 'US']) { if (!(share[k] > 0)) continue; const bm = idx[k] || idx[k === 'KR' ? 'US' : 'KR']; const r = ratioPath(bm); if (!r) continue; const same = parts.find(p => p.name === (bm.name || bm.symbol)); if (same) same.share += share[k]; else parts.push({ market: k, share: share[k], name: bm.name || bm.symbol, r }); }
    const invested = Math.min(1, parts.reduce((a, p) => a + p.share, 0));
    if (parts.length) { const mp = dates.map((d, i) => capital * ((1 - invested) + parts.reduce((a, p) => a + p.share * p.r[i], 0))); mix = { name: `${parts.map(p => `${p.name} ${Math.round(p.share * 100)}%`).join(' + ')} + 현금`, share: invested, parts: parts.map(p => ({ market: p.market, share: p.share, name: p.name })), path: mp, metrics: metricsOf(mp) }; }
  }
  const rulePath = marks.map(m => m.total), yrs = (Date.parse(endDate) - Date.parse(dates[0])) / (365.25 * 864e5);
  const cashAvgPct = marks.reduce((a, m) => a + m.cash / m.total, 0) / marks.length * 100;
  const mr = metricsOf([capital, ...rulePath]), mh = metricsOf([capital, ...holdPath.path]);
  return {
    ok: true, version: PAPER_VERSION, rulesVersion: RULES_VERSION, label, from: dates[0], to: endDate, days: dates.length, years: yrs, capitalKrw: capital, plan: P, rules: { ...rules }, cost, slippage,
    end: { total: endTotal, cash, stock: endTotal - cash, positions: endPos },
    metrics: { rule: mr, hold: mh, bench: bench?.metrics || null, mix: mix?.metrics || null },
    diff: { vsHoldPct: (mr.ret - mh.ret) * 100, vsBenchPct: bench ? (mr.ret - bench.metrics.ret) * 100 : null, vsMixPct: mix ? (mr.ret - mix.metrics.ret) * 100 : null, mddVsHoldPct: (mr.mdd - mh.mdd) * 100, mddVsMixPct: mix ? (mr.mdd - mix.metrics.mdd) * 100 : null },
    activity: { decisionDays, urgentDays, trades: fills.length, blocked, blockedTotal: Object.values(blocked).reduce((a, b) => a + b, 0), whys, feesKrw: fees, slippageKrw: slip, costPct: (fees + slip) / capital * 100, cashAvgPct, breaches, breachPct: breaches / Math.max(1, dates.length - 1) * 100, unfilled: journal.filter(j => j.step === '미체결').length },
    series: dates.map((d, k) => ({ date: d, rule: rulePath[k] / capital * 100, hold: holdPath.path[k] / capital * 100, bench: bench ? bench.path[k] / capital * 100 : null, mix: mix ? mix.path[k] / capital * 100 : null })),
    benchmark: bench ? { symbol: bench.symbol, name: bench.name } : null, mix: mix ? { name: mix.name, share: mix.share } : null,
    fills, journal, missing
  };
}

function holdOnly({ syms, P, capital, cs, nextOpen, closeKrw, dates, cost, slippage, floorLot }) {
  const qty = Object.fromEntries(syms.map(s => [s, 0])), fillOn = {}; let cash = capital;
  for (const s of syms) { const nx = nextOpen(s, dates[0]); if (!nx) continue; const px = nx.priceKrw * (1 + slippage), q = floorLot(capital * P[s] / 100 / px, s); if (q > 0) { qty[s] = q; cash -= q * px * (1 + cost); fillOn[s] = nx.date; } }
  const path = dates.map(d => cash + syms.reduce((a, s) => a + (fillOn[s] && fillOn[s] <= d ? qty[s] * (closeKrw(s, d) || 0) : (fillOn[s] ? qty[s] * (nextOpen(s, dates[0])?.priceKrw || 0) * (1 + slippage) * (1 + cost) : 0)), 0));
  return { path, qty, cash };
}

/**
 * 앞으로 h거래일 범위: 지금 보유 비중의 원화 일간 수익률(최근 2년)에 GARCH를 맞추고 잔차를 다시 뽑아 경로를 만든다.
 * 추세(평균)는 넣지 않는다 — 방향 예측이 아니라 흔들림의 크기다. 결과는 금액 범위(5%·50%·95%)와 10%·20% 이상 빠질 확률.
 */
export function forwardRange({ positions = [], cashKrw = 0, candlesBySymbol = {}, fxCandles = [], horizon = 63, paths = 2000, seed = 7 }) {
  const held = positions.filter(p => p.valueKrw > 0 && candlesBySymbol[p.symbol]?.length > 120), total = positions.reduce((a, p) => a + Math.max(0, p.valueKrw), 0) + Math.max(0, cashKrw);
  if (!held.length || !(total > 0)) return { ok: false, reason: '보유 종목의 시세가 부족합니다.' };
  const series = held.map(p => ({ w: p.valueKrw / total, m: new Map(krwReturns(candlesBySymbol[p.symbol], p.currency, fxCandles).map(x => [x.date, x.r])) }));
  const dates = [...series.reduce((acc, s) => { for (const d of s.m.keys()) acc.add(d); return acc; }, new Set())].sort().slice(-500);
  const r = dates.map(d => series.reduce((a, s) => a + s.w * (s.m.get(d) || 0), 0)).map(x => Math.log(1 + x));
  const fit = fitGarch(r);
  if (!fit.ok) return { ok: false, reason: fit.reason || '모형을 맞추지 못했습니다.' };
  const sim = simulateGarch(fit, horizon, { paths, seed, drift: false });
  return { ok: true, horizon, totalKrw: total, investedPct: held.reduce((a, p) => a + p.valueKrw, 0) / total * 100, annualVol: Math.sqrt(fit.nextVar) * Math.sqrt(252),
    p05Krw: total * sim.p05, medianKrw: total * sim.median, p95Krw: total * sim.p95, p05: sim.p05, median: sim.median, p95: sim.p95, probDown10: sim.probDown10, probDown20: sim.probDown20, worstDipMedian: sim.worstDipMedian, obs: r.length };
}
