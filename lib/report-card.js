// 성적표: 같은 기간 ① 내가 실제로 한 것 ② 기간 첫날 보유를 그냥 들고 있었다면 ③ 규칙대로 비중을 맞췄다면을 원화로 비교한다.
// 체결 이력으로 날마다 보유 수량을 되돌려 계산한다(현금 제외, 주식 부분만). 지어낸 숫자를 쓰지 않기 위해 수량이 맞지 않거나 시세가 없으면 표시한다.
import { fillsFrom, closeOn } from './asset-timeline.js';
import { evaluate, DEFAULT_RULES, BAND } from './core-rules.js';

const signed = f => f.side === 'BUY' ? f.quantity : -f.quantity;
function drawdown(path) { let peak = -Infinity, mdd = 0; for (const v of path) { if (!(v > 0)) continue; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); } return mdd; }

/**
 * @param positions [{symbol, name, currency, quantity}] 지금 보유
 * @param orders 주문 이력(토스 형식, fillsFrom으로 체결만 씀)
 * @param candlesBySymbol {symbol: [{date, close}]} 현지 통화 일봉
 * @param fxCandles USD→KRW 일봉, fxNow 현재 환율
 * @param from 기간 시작일(그날 종가 기준 보유가 출발점), to 끝 날짜
 * @param engine core-risk.buildEngine 결과({riskAt, portVarAt}). '규칙대로'는 오늘 점검(evaluate)을 그 기간에 주 1회 따랐다고 보고 다시 계산한다.
 * @param rules 사용자 규칙. 실제 현금 이력이 없으므로 현금 최소 비중은 0으로 두고 주식 부분만 비교한다.
 */
export function reportCard({ positions = [], orders = [], candlesBySymbol = {}, fxCandles = [], fxNow = null, from, to, engine = null, rules = DEFAULT_RULES, cost = 0.002 }) {
  const all = fillsFrom(orders), notes = [];
  const meta = new Map(positions.map(p => [p.symbol, { name: p.name || p.symbol, currency: p.currency, qty: p.quantity }]));
  for (const f of all) if (!meta.has(f.symbol)) meta.set(f.symbol, { name: f.symbol, currency: f.currency, qty: 0 });
  const fxAt = d => closeOn(fxCandles, d) ?? fxNow;
  const krw = (amount, cur, d) => cur === 'USD' ? (fxAt(d) ? amount * fxAt(d) : null) : amount;
  const qtyAt = (sym, d) => meta.get(sym).qty - all.filter(f => f.symbol === sym && f.date > d).reduce((a, f) => a + signed(f), 0);
  const syms = [...meta.keys()].filter(s => candlesBySymbol[s]?.length);
  const noPrice = [...meta.keys()].filter(s => !candlesBySymbol[s]?.length && (meta.get(s).qty > 0 || all.some(f => f.symbol === s && f.date > from)));
  if (noPrice.length) notes.push(`시세가 없어 뺀 종목: ${noPrice.map(s => meta.get(s).name).join(', ')}`);
  const dates = [...new Set(syms.flatMap(s => candlesBySymbol[s].map(c => c.date)))].filter(d => d >= from && d <= to).sort();
  if (dates.length < 2) return { ok: false, reason: '기간 안에 시세가 있는 거래일이 부족합니다.' };
  const start = dates[0];
  for (const s of syms) if (qtyAt(s, start) < -1e-6) notes.push(`${meta.get(s).name}: 체결 이력과 지금 수량이 맞지 않음(액면분할·입고 가능)`);
  const px = (s, d) => { const c = closeOn(candlesBySymbol[s], d); return c === null ? null : krw(c, meta.get(s).currency, d); };
  const valueOf = (qty, d) => syms.reduce((a, s) => { const q = qty(s); if (q <= 1e-9) return a; const p = px(s, d); return p === null ? a : a + q * p; }, 0);

  // ① 실제
  const period = all.filter(f => f.date > start && f.date <= to && syms.includes(f.symbol));
  const flowOn = new Map(), feeTotal = period.reduce((a, f) => a + (krw(f.fees || 0, f.currency, f.date) || 0), 0);
  for (const f of period) { const amt = krw(f.amount ?? f.price * f.quantity, f.currency, f.date); flowOn.set(f.date, (flowOn.get(f.date) || 0) + (f.side === 'BUY' ? amt : -amt)); }
  const actual = dates.map(d => valueOf(s => qtyAt(s, d), d));
  // ② 그냥 보유
  const q0 = Object.fromEntries(syms.map(s => [s, Math.max(0, qtyAt(s, start))]));
  const hold = dates.map(d => valueOf(s => q0[s], d));
  // ③ 규칙대로: 첫날 보유 비중을 계획으로 보고, 그 주 마지막 거래일 종가마다(급하면 바로) 오늘 점검의 할 일을 그대로 따른다. 비용 0.2%.
  const v0 = hold[0], R = { ...rules, minCash: 0 };
  const plan = Object.fromEntries(syms.map(s => [s, v0 ? q0[s] * (px(s, start) || 0) / v0 * 100 : 0]));
  const weekOf = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  let shares = { ...q0 }, cash = 0, rebal = 0; const ruleTrades = [];
  if (!engine) notes.push('규칙 계산 도구가 없어 규칙대로 결과는 그냥 보유와 같게 둡니다.');
  const rule = dates.map((d, k) => {
    const value = s => shares[s] * (px(s, d) || 0);
    if (engine && plan && v0) {
      const risk = Object.fromEntries(syms.map(s => [s, engine.riskAt(s, d)]));
      const e = evaluate({ positions: syms.map(s => ({ symbol: s, name: meta.get(s).name, currency: meta.get(s).currency, valueKrw: value(s) })), cashKrw: cash, rules: R, plan, risk,
        portVar: h => engine.portVarAt(h, d), trades30: ruleTrades.filter(t => Date.parse(d) - Date.parse(t) < 30 * 864e5).length });
      const weekEnd = k === dates.length - 1 || weekOf(dates[k + 1]) !== weekOf(d);
      if (k === 0 || weekEnd || e.urgent) for (const a of e.actions) {
        const p = px(a.symbol, d); if (!p) continue;
        const amt = a.kind === 'reduce' ? Math.min(a.amountKrw, value(a.symbol)) : Math.min(a.amountKrw, Math.max(0, cash) / (1 + cost));
        if (amt < 1) continue;
        if (a.kind === 'reduce') { shares[a.symbol] -= amt / p; cash += amt * (1 - cost); } else { shares[a.symbol] += amt / p; cash -= amt * (1 + cost); }
        rebal++; ruleTrades.push(d);
      }
    }
    return cash + syms.reduce((a, s) => a + value(s), 0);
  });

  // 수익률(시간가중): 실제는 그날 순매수 금액을 빼고 잇는다
  const twr = (path, flows) => { const idx = [100]; for (let k = 1; k < path.length; k++) { const prev = path[k - 1], f = flows ? flows.get(dates[k]) || 0 : 0; idx.push(prev > 0 ? idx[k - 1] * (path[k] - f) / prev : idx[k - 1]); } return idx; };
  // 규칙 경로는 첫날 맞춘 비용까지 포함하도록 출발 금액(v0) 기준으로 잰다
  const ia = twr(actual, flowOn), ih = twr(hold), ir = rule.map(v => v0 ? v / v0 * 100 : 100);
  const net = period.reduce((a, f) => a + (f.side === 'BUY' ? 1 : -1) * (krw(f.amount ?? f.price * f.quantity, f.currency, f.date) || 0), 0);
  const end = dates.at(-1);
  // 매매별 기여: 그 체결이 없었다면 끝날 평가액이 얼마나 달랐나(체결가 → 끝날 종가)
  const byTrade = period.map(f => { const pEnd = px(f.symbol, end), pFill = krw(f.price, f.currency, f.date); return { date: f.date, symbol: f.symbol, name: meta.get(f.symbol).name, side: f.side, quantity: f.quantity, amountKrw: (pFill || 0) * f.quantity, effectKrw: pEnd && pFill ? signed(f) * (pEnd - pFill) : null }; })
    .sort((a, b) => (a.effectKrw ?? 0) - (b.effectKrw ?? 0));
  return {
    ok: true, from: start, to: end, days: dates.length, startValue: hold[0], notes,
    actual: { pnl: actual.at(-1) - actual[0] - net - feeTotal, ret: ia.at(-1) / 100 - 1, mdd: drawdown(ia), trades: period.length, fees: feeTotal, netBuy: net, endValue: actual.at(-1) },
    hold: { pnl: hold.at(-1) - hold[0], ret: ih.at(-1) / 100 - 1, mdd: drawdown(ih), endValue: hold.at(-1) },
    rule: { pnl: rule.at(-1) - v0, ret: ir.at(-1) / 100 - 1, mdd: drawdown(ir), rebalances: rebal, endValue: rule.at(-1), endCash: cash },
    series: dates.map((d, k) => ({ date: d, actual: ia[k], hold: ih[k], rule: ir[k] })), byTrade
  };
}
