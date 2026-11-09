// 전략 검토: 같은 종목·같은 기간에 규칙만 바꿔 절차를 다시 돌리고, 그냥 보유·지수와 나란히 놓는다(브라우저·Node 공용).
// 예측이 아니라 측정이다. 한 기간의 1등을 고르면 그 기간에 맞춘 규칙이 되므로, 여러 기간(3·6·12·18개월)을 한 번에 보여 주고
// "모든 기간에서 보유보다 최대 손실이 작았는가"처럼 기간을 가로지르는 사실만 결론으로 적는다.
import { rehearse } from './paper-trading.js';
import { presetRules } from './rule-presets.js';

export const REVIEW_VERSION = 'SR1-2026-11-09';
/** 세 질문의 세 조합(대각선). 사용자가 쓰는 규칙은 호출하는 쪽이 'current' 로 넣는다. */
export const PRESET_SETS = [
  { id: 'cons', label: '보수 (5% · 8섹터 · 월 1회)', q: { lossMonthly: 5, sectors: 8, cadence: 'monthly' } },
  { id: 'mid', label: '중간 (10% · 5섹터 · 주 1회)', q: { lossMonthly: 10, sectors: 5, cadence: 'weekly' } },
  { id: 'aggr', label: '적극 (20% · 3섹터 · 급할 때만)', q: { lossMonthly: 20, sectors: 3, cadence: 'urgent' } }
].map(s => { const p = presetRules(s.q); return { ...s, rules: p.rules, prefs: { ...p.prefs, sectorCap: p.sectorCap, cadence: p.cadence } }; });
export const WINDOWS = [{ id: 'w3', label: '3개월', days: 91 }, { id: 'w6', label: '6개월', days: 182 }, { id: 'w12', label: '1년', days: 365 }, { id: 'w18', label: '18개월', days: 540 }];

/** 계획 비중을 규칙에 맞춘다: 한 종목 상한으로 자르고, 합이 (100 − 현금 최소)를 넘으면 비율로 줄인다. 계획이 없으면 null(균등). */
export function fitPlan(plan, rules) {
  if (!plan) return null; const out = {}; for (const [k, v] of Object.entries(plan)) { const x = Number(v); if (x > 0) out[k] = Math.min(x, rules.maxSingle); }
  const sum = Object.values(out).reduce((a, b) => a + b, 0), room = 100 - rules.minCash;
  if (sum > room && sum > 0) for (const k of Object.keys(out)) out[k] = Math.round(out[k] * room / sum * 10) / 10;
  return out;
}
const shift = (to, n) => new Date(Date.parse(to) - n * 864e5).toISOString().slice(0, 10);
const r1 = v => Math.round(v * 10) / 10;
function cell(r) {
  if (!r?.ok) return { ok: false, reason: r?.reason || '계산 불가' };
  const m = r.metrics, a = r.activity;
  return { ok: true, ret: r1(m.rule.ret * 100), mdd: r1(m.rule.mdd * 100), hold: r1(m.hold.ret * 100), holdMdd: r1(m.hold.mdd * 100), bench: m.bench ? r1(m.bench.ret * 100) : null, benchMdd: m.bench ? r1(m.bench.mdd * 100) : null,
    vsHold: r1(r.diff.vsHoldPct), mddVsHold: r1(r.diff.mddVsHoldPct), mix: m.mix ? r1(m.mix.ret * 100) : null, mixMdd: m.mix ? r1(m.mix.mdd * 100) : null, vsMix: r1(r.diff.vsMixPct ?? NaN), trades: a.trades, blocked: a.blockedTotal, cashAvg: Math.round(a.cashAvgPct), breaches: a.breaches, costPct: r1(a.costPct), days: r.days };
}

/**
 * 규칙 묶음 × 기간 표.
 * @param basket [{symbol,name,currency}] · plan {symbol: %} (없으면 균등) · candlesBySymbol · fxCandles · benchmark {symbol,name,currency,candles}
 * @param ruleSets [{id,label,rules}] 기본: current(있으면) + 세 프리셋 · windows 기본 WINDOWS · to 끝 날짜(YYYY-MM-DD)
 */
export function compareRuleSets({ basket, plan = null, capitalKrw = 10_000_000, candlesBySymbol, fxCandles = [], benchmark = null, indexes = null, to, current = null, ruleSets = null, windows = WINDOWS }) {
  const sets = ruleSets || [...(current ? [{ id: 'current', label: current.label || '지금 규칙', rules: current.rules, prefs: current.prefs || null }] : []), ...PRESET_SETS];
  const rows = sets.map(s => ({ id: s.id, label: s.label, rules: s.rules, prefs: s.prefs || null, cells: {} }));
  const hold = {}, bench = {}, mix = {};
  for (const w of windows) {
    const from = shift(to, w.days);
    for (const row of rows) {
      const r = rehearse({ basket, capitalKrw, rules: row.rules, plan: fitPlan(plan, row.rules), candlesBySymbol, fxCandles, from, to, benchmark, indexes, label: row.label });
      row.cells[w.id] = cell(r);
      if (r.ok && !hold[w.id]) { hold[w.id] = { ret: r1(r.metrics.hold.ret * 100), mdd: r1(r.metrics.hold.mdd * 100) }; bench[w.id] = r.metrics.bench ? { ret: r1(r.metrics.bench.ret * 100), mdd: r1(r.metrics.bench.mdd * 100), name: r.benchmark?.name } : null; mix[w.id] = r.metrics.mix ? { ret: r1(r.metrics.mix.ret * 100), mdd: r1(r.metrics.mix.mdd * 100), name: r.mix?.name } : null; }
    }
  }
  return { version: REVIEW_VERSION, to, windows: windows.map(w => ({ ...w, from: shift(to, w.days) })), rows, hold, bench, mix, findings: findings(rows, windows, hold, mix) };
}

/** 기간을 가로지르는 사실만 적는다. 숫자는 표에 있고, 여기선 '몇 기간 중 몇 번' 꼴로 센다. */
export function findings(rows, windows, hold, mix = {}) {
  const ws = windows.map(w => w.id).filter(id => hold[id]);
  if (!ws.length) return [{ key: 'none', text: '계산할 수 있는 기간이 없습니다.' }];
  const out = [];
  const count = (row, f) => ws.filter(id => row.cells[id]?.ok && f(row.cells[id])).length;
  const safer = rows.map(r => ({ r, n: count(r, c => c.mddVsHold > 0.05) })), richer = rows.map(r => ({ r, n: count(r, c => c.vsHold > 0.05) }));
  const allSafer = safer.filter(x => x.n === ws.length).map(x => x.r.label), allRicher = richer.filter(x => x.n === ws.length).map(x => x.r.label);
  out.push({ key: 'mdd', text: allSafer.length ? `모든 기간(${ws.length}개)에서 그냥 보유보다 최대 손실이 작았던 규칙: ${allSafer.join(', ')}.` : `어느 규칙도 모든 기간에서 보유보다 최대 손실이 작지는 않았습니다. 기간별로 엇갈립니다.` });
  out.push({ key: 'ret', text: allRicher.length ? `모든 기간에서 보유보다 수익률이 높았던 규칙: ${allRicher.join(', ')}.` : `어느 규칙도 모든 기간에서 보유보다 수익률이 높지는 않았습니다. 상승장에서 현금을 남기는 규칙은 보유보다 덜 벌고, 이것은 이 규칙의 알려진 비용입니다.` });
  // 지수+현금(같은 투자 비중)보다 손실이 작았는가: 손실이 작은 이유가 단지 현금 때문인지 가른다
  const mixWs = ws.filter(id => mix[id]); if (mixWs.length) { const beatMix = rows.map(r => ({ r, n: mixWs.filter(id => r.cells[id]?.ok && r.cells[id].mdd > mix[id].mdd + 0.05).length })).filter(x => x.n === mixWs.length).map(x => x.r.label); out.push({ key: 'mix', text: beatMix.length ? `같은 투자 비중의 지수+현금보다도 모든 기간에서 최대 손실이 작았던 규칙: ${beatMix.join(', ')}. 현금 비중만으로 설명되지 않는 효과입니다.` : `같은 투자 비중의 지수+현금보다 모든 기간에서 최대 손실이 작았던 규칙은 없습니다. 손실이 작았다면 주로 현금 비중 덕입니다.` }); }
  const byLoss = rows.map(r => ({ r, mdd: ws.map(id => r.cells[id]?.ok ? r.cells[id].mdd : null).filter(v => v !== null) })).filter(x => x.mdd.length);
  if (byLoss.length >= 2) { const worst = x => Math.min(...x.mdd); const best = [...byLoss].sort((a, b) => worst(b) - worst(a))[0]; out.push({ key: 'worst', text: `가장 나쁜 기간의 최대 손실이 가장 작았던 규칙은 ${best.r.label}(${worst(best).toFixed(1)}%)입니다.` }); }
  const trades = rows.map(r => ({ r, t: ws.map(id => r.cells[id]?.ok ? r.cells[id].trades : null).filter(v => v !== null) }));
  const busiest = [...trades].sort((a, b) => Math.max(...b.t) - Math.max(...a.t))[0]; if (busiest && Math.max(...busiest.t) > 0) out.push({ key: 'trades', text: `매매가 가장 잦았던 규칙은 ${busiest.r.label}(18개월 기준 최대 ${Math.max(...busiest.t)}회). 매매가 잦을수록 비용과 실수가 늘어납니다.` });
  out.push({ key: 'caution', text: '한 기간의 1등을 고르면 그 기간에 맞춘 규칙이 됩니다. 여러 기간에서 손실이 일관되게 작은 쪽을 고르고, 수익률 차이는 그 기간의 시장 방향이 만든 것으로 보십시오. 네 기간은 서로 겹치므로(3개월은 6개월 안에 있음) 독립적인 네 번의 검증이 아니라 하나의 긴 기간을 네 창으로 본 것입니다. 지수+현금 선은 국가 비중과 현금만 맞춘 것이지 주식·채권 구성까지 같은 위험 수준은 아닙니다.' });
  return out;
}
