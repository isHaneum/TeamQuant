// 상황 통계: "같은 상태 이후 어떻게 됐나"와 "그 상태에서 어떤 방식이 그냥 보유보다 나았나".
// scripts/build-situation-stats.mjs가 이 함수로 data/situation-stats.json을 만들고, 화면은 그 파일만 읽는다.
// 그래서 화면 숫자와 문서 숫자가 같은 계산에서 나온다.
import { computeFeatures, classifyAt, SITUATION_VERSION, STATE_ORDER, STATES, GROUPS } from './situation.js';
import { SITUATION_STRATEGIES, simulate } from './situation-strategies.js';

export const UNIVERSE = {
  KR_STOCK: ['005930.KS', '000660.KS', '005380.KS', '035420.KS', '051910.KS', '068270.KS', '105560.KS', '055550.KS', '035720.KS', '006400.KS', '207940.KS', '012330.KS', '000270.KS', '066570.KS', '096770.KS', '017670.KS', '033780.KS', '003550.KS'],
  US_STOCK: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'KO', 'JNJ', 'XOM', 'JPM', 'PG', 'WMT', 'INTC', 'PFE', 'DIS', 'NKE', 'BA', 'CVX'],
  ETF: ['069500.KS', '229200.KS', '091160.KS', '139260.KS', 'SPY', 'QQQ', 'XLE', 'XLF', 'TLT']
};
export const indexOf = symbol => /\.(KS|KQ)$/.test(symbol) ? '^KS11' : '^GSPC';
export const HORIZON = 60, GAP = 20, WARMUP = 260;

const r2 = v => Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
// 값은 비율(0.012 = 1.2%)로 받아 %(또는 %p)로 돌려준다.
export function stat(values, overlap = 1) {
  const a = values.filter(Number.isFinite), n = a.length;
  if (!n) return { n: 0 };
  const s = [...a].sort((x, y) => x - y), q = p => s[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1) + 0.5)))];
  const mean = a.reduce((x, y) => x + y, 0) / n, sd = n > 1 ? Math.sqrt(a.reduce((x, v) => x + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) * Math.sqrt(overlap) : Infinity;
  return { n, mean: r2(mean * 100), median: r2(q(0.5) * 100), p20: r2(q(0.2) * 100), p80: r2(q(0.8) * 100), hit: Math.round(a.filter(v => v > 0).length / n * 100), lcb: Number.isFinite(se) ? r2((mean - 1.28 * se) * 100) : null };
}

/**
 * @param series [{symbol, group, candles}]  candles: 오름차순 일봉(5년 권장)
 * @param indexes {'^KS11': candles, '^GSPC': candles}
 * @returns 표본 목록. 같은 종목·같은 상태는 GAP 거래일 안에서 한 번만 센다.
 */
export function collectSamples(series, indexes, { strategies = SITUATION_STRATEGIES, horizon = HORIZON, gap = GAP } = {}) {
  const samples = [], baseline = [];
  const maps = Object.fromEntries(Object.entries(indexes).map(([k, c]) => [k, new Map(c.map(x => [x.date, x.close]))]));
  for (const { symbol, group, candles } of series) {
    if (!candles || candles.length < WARMUP + horizon + 2) continue;
    const F = computeFeatures(candles), im = maps[indexOf(symbol)], last = {};
    if (!im) continue;
    for (let i = WARMUP; i < F.n - horizon; i++) {
      const i0 = im.get(F.dates[i]), i20 = im.get(F.dates[i + 20]), i60 = im.get(F.dates[i + horizon]);
      if (!i0 || !i20 || !i60) continue;
      const f20 = (F.close[i + 20] / F.close[i] - 1) - (i20 / i0 - 1), f60 = (F.close[i + horizon] / F.close[i] - 1) - (i60 / i0 - 1);
      if (i % gap === 0) baseline.push({ group, f20, f60 });
      const { state } = classifyAt(F, i);
      if (!state || (last[state] !== undefined && i - last[state] < gap)) continue;
      last[state] = i;
      const run = s => { const e = simulate(F, s, i, i + horizon).equity; let peak = -Infinity, mdd = 0; for (const x of e) { peak = Math.max(peak, x.value); mdd = Math.min(mdd, x.value / peak - 1); } return { ret: e.at(-1).value / e[0].value - 1, mdd }; };
      const hold = run(strategies.find(s => s.id === 'hold'));
      const edges = {}, risk = {};
      for (const s of strategies) if (s.id !== 'hold') { const r = run(s); edges[s.id] = r.ret - hold.ret; risk[s.id] = r.mdd - hold.mdd; }
      samples.push({ symbol, group, state, date: F.dates[i], end: F.dates[i + horizon], f20, f60, edges, risk });
    }
  }
  return { samples, baseline };
}

// 선택 규칙: 표본 20개 이상이고 기대값 하한(평균 − 1.28 × 표준오차, 겹침 보정)이 0보다 큰 방식 중 하한이 가장 큰 것. 없으면 그냥 보유.
export function selectRule(samples, { minN = 20, overlap = HORIZON / GAP } = {}) {
  const rule = {}, table = {}, risk = {};
  for (const g of Object.keys(GROUPS)) for (const st of STATE_ORDER) {
    const rows = samples.filter(x => x.group === g && x.state === st);
    if (!rows.length) continue;
    const ids = Object.keys(rows[0].edges), stats = Object.fromEntries(ids.map(id => [id, stat(rows.map(r => r.edges[id]), overlap)]));
    (table[g] ||= {})[st] = stats;
    if (rows[0].risk) (risk[g] ||= {})[st] = Object.fromEntries(ids.map(id => [id, stat(rows.map(r => r.risk[id]), overlap)]));
    const best = ids.filter(id => stats[id].n >= minN && stats[id].lcb > 0).sort((a, b) => stats[b].lcb - stats[a].lcb)[0];
    (rule[g] ||= {})[st] = best || 'hold';
  }
  return { rule, table, risk };
}

// 걷기식 점검(1회): cutoff 이전에 끝난 표본으로 규칙을 정하고, cutoff 이후 표본에 적용해 그냥 보유와 비교한다.
export function walkForward(samples, cutoff) {
  const train = samples.filter(x => x.end < cutoff), test = samples.filter(x => x.date >= cutoff);
  const { rule } = selectRule(train), out = {};
  for (const g of Object.keys(GROUPS)) {
    const rows = test.filter(x => x.group === g); if (!rows.length) continue;
    const picked = rows.map(x => ({ id: rule[g]?.[x.state] || 'hold', edge: (rule[g]?.[x.state] || 'hold') === 'hold' ? 0 : x.edges[rule[g][x.state]] }));
    const active = picked.filter(p => p.id !== 'hold');
    out[g] = { n: rows.length, active: active.length, edge: stat(picked.map(p => p.edge)), activeEdge: active.length ? stat(active.map(p => p.edge)) : null };
  }
  return { cutoff, trainN: train.length, testN: test.length, rule, groups: out };
}

export function buildStats({ samples, baseline }, { generatedAt = new Date().toISOString(), period = null, cutoff } = {}) {
  const states = {}, base = {};
  for (const g of Object.keys(GROUPS)) {
    const b = baseline.filter(x => x.group === g);
    if (b.length) base[g] = { f20: stat(b.map(x => x.f20)), f60: stat(b.map(x => x.f60)) };
    for (const st of STATE_ORDER) {
      const rows = samples.filter(x => x.group === g && x.state === st); if (!rows.length) continue;
      (states[g] ||= {})[st] = { n: rows.length, symbols: new Set(rows.map(r => r.symbol)).size, f20: stat(rows.map(r => r.f20)), f60: stat(rows.map(r => r.f60)) };
    }
  }
  const { rule, table, risk } = selectRule(samples);
  const dates = samples.map(s => s.date).sort();
  const cut = cutoff || dates[Math.floor(dates.length * 0.6)] || null;
  return {
    version: SITUATION_VERSION, generatedAt, period, horizon: HORIZON, gap: GAP, cost: '거래 금액의 0.2%',
    universe: UNIVERSE, groups: GROUPS, stateLabels: Object.fromEntries(STATE_ORDER.map(s => [s, STATES[s].label])),
    strategies: SITUATION_STRATEGIES.map(({ id, title, family, how, when }) => ({ id, title, family, how, when })),
    baseline: base, states, edges: table, risk, rule,
    walkForward: cut ? walkForward(samples, cut) : null,
    notes: ['지금 남아 있는 대형주만 골라 생존 편향이 있습니다.', '같은 종목의 60거래일 구간이 겹쳐 표본이 독립이 아닙니다. 하한은 겹침을 보정했습니다.', '정의·종목군이 바뀌면 숫자가 달라집니다. version을 확인하십시오.']
  };
}
