// 크기 정하기 비교(결정 35 · 2026-11-15): 지금 계획(PP3)의 개별 종목 묶음을 "3% 균등"으로 둘 때와 위험 기준으로 나눌 때를 같은 자료로 잰다.
// 재는 것은 위험뿐이다(변동성 · 비교선 대비 추적오차 · 종목별 위험 기여 · 예측과 실제의 차이 · 매매량). 수익은 비교하지 않는다 —
// 종목을 2026년에 골랐으므로 과거 수익을 보면 미래를 본 결과가 된다(위험 수치에도 같은 치우침이 조금 남는다: 살아남고 커진 회사들이다).
// 자료: 공개 일봉(수정 종가)을 원화로 바꿔 주간 수익률로. 미국·한국 장 마감 시각이 달라 하루 단위 상관은 낮게 나오므로 주간을 쓴다.
// 사용: node scripts/research/sizing-study.mjs  → data/sizing-study.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shrinkCov, riskStats, sleeveWeights, effectiveN, quad, RISK_BUDGET_VERSION } from '../../lib/risk-budget.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), sleep = ms => new Promise(r => setTimeout(r, ms));
const plan = JSON.parse(readFileSync(join(root, 'data/paper-plan.json'), 'utf8'));
const ysym = s => /^\d{6}$/.test(s) ? `${s}.KS` : s, isUS = s => !/^\d{6}$/.test(s);
const held = Object.entries(plan.weights).filter(([, v]) => v.pct > 0).map(([symbol, v]) => ({ symbol, name: v.name, role: v.role, pct: v.pct / 100, us: isUS(symbol) }));
const core = held.filter(h => h.role === 'core'), sats = held.filter(h => h.role !== 'core'), order = [...core, ...sats], N = order.length;
const coreIdx = { US: order.findIndex(h => h.role === 'core' && h.us), KR: order.findIndex(h => h.role === 'core' && !h.us) };
if (coreIdx.US < 0 || coreIdx.KR < 0) throw new Error('계획에 미국·국내 지수가 하나씩 있어야 합니다.');
const satCols = sats.map(h => order.indexOf(h)), idxOf = sats.map(h => h.us ? coreIdx.US : coreIdx.KR), SAT_TOTAL = sats.reduce((a, h) => a + h.pct, 0), CAP = (plan.caps?.single || 7) / 100;

async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1420070400&period2=9999999999&interval=1d&events=div%2Csplit`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose, tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), close: adj?.[i] ?? q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
const fridayOf = d => { const t = new Date(d + 'T00:00:00Z'), wd = t.getUTCDay(); t.setUTCDate(t.getUTCDate() + ((5 - wd + 7) % 7)); return t.toISOString().slice(0, 10); };
const fx = await history('KRW=X'), fxBy = new Map(fx.map(c => [c.date, c.close])), fxDates = fx.map(c => c.date);
const fxOn = d => { let lo = 0, hi = fxDates.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (fxDates[m] <= d) { f = m; lo = m + 1; } else hi = m - 1; } return f < 0 ? null : fxBy.get(fxDates[f]); };
const weekly = {}; // symbol → Map(금요일 → 그 주 마지막 원화 가격)
for (const h of order) { const c = await history(ysym(h.symbol)), m = new Map(); for (const x of c) { const f = h.us ? fxOn(x.date) : 1; if (f) m.set(fridayOf(x.date), x.close * f); } weekly[h.symbol] = m; await sleep(250); }
const lastDay = fx.at(-1).date, weeks = [...new Set(Object.values(weekly).flatMap(m => [...m.keys()]))].sort().filter(w => w <= fridayOf(lastDay));
const first = weeks.findIndex(w => order.every(h => weekly[h.symbol].has(w)));
const W = weeks.slice(first), px = order.map(h => { let last = null; return W.map(w => (last = weekly[h.symbol].get(w) ?? last)); });
const R = W.slice(1).map((_, t) => order.map((_, i) => Math.log(px[i][t + 1] / px[i][t]))), RW = W.slice(1); // 주간 로그 수익률(행 = 주)

const WIN = 156, STEP = 4, YEAR = 52, METHODS = [['equal', '균등(지금)'], ['invVol', '변동성 역수'], ['invResVar', '잔차분산 역수'], ['erc', '위험 기여 균등'], ['minTE', '추적오차 최소']];
const build = (method, cov) => { const s = sleeveWeights(method, cov, satCols, idxOf, { total: SAT_TOTAL, cap: CAP }), w = new Array(N).fill(0), wb = new Array(N).fill(0); core.forEach(h => { w[order.indexOf(h)] = h.pct; wb[order.indexOf(h)] = h.pct; }); s.forEach((x, a) => { w[satCols[a]] = x; wb[idxOf[a]] += x; }); return { s, w, wb }; };
const ann = x => x * Math.sqrt(YEAR), pct = (x, d = 1) => Math.round(x * 100 * 10 ** d) / 10 ** d;

// ① 지금 시점(최근 156주)의 위험 분해
const now = shrinkCov(R.slice(-WIN)), snapshot = {};
for (const [id, label] of METHODS) {
  const { s, w, wb } = build(id, now.cov), st = riskStats(now.cov, w, wb), satArc = satCols.map(i => st.arc[i]), d = satCols.map((i, a) => { const p = idxOf[a]; return Math.sqrt(now.cov[i][i] - 2 * now.cov[i][p] + now.cov[p][p]); });
  // 종목별 능동 위험 몫: 종목을 사고 자기 지수를 줄인 위치 하나하나의 기여(합 1)
  const D = satCols.map((i, a) => satCols.map((j, b) => now.cov[i][j] - now.cov[i][idxOf[b]] - now.cov[idxOf[a]][j] + now.cov[idxOf[a]][idxOf[b]])), g = D.map(r => r.reduce((x, v, k) => x + v * s[k], 0)), av = s.reduce((x, v, k) => x + v * g[k], 0), share = s.map((v, k) => v * g[k] / av);
  snapshot[id] = { label, volPct: pct(ann(st.vol)), tePct: pct(ann(st.te), 2), weightsPct: Object.fromEntries(sats.map((h, a) => [h.symbol, pct(s[a], 2)])), activeSharePct: Object.fromEntries(sats.map((h, a) => [h.symbol, pct(share[a])])), maxActiveSharePct: pct(Math.max(...share)), effectiveBets: Math.round(effectiveN(share) * 10) / 10, satRiskOfTotalPct: pct(satCols.reduce((x, i) => x + st.rc[i], 0)), satWeightOfInvestedPct: pct(SAT_TOTAL / w.reduce((a, b) => a + b, 0)) };
  if (id === 'equal') snapshot.names = Object.fromEntries(sats.map((h, a) => [h.symbol, { name: h.name, volPct: pct(ann(Math.sqrt(now.cov[satCols[a]][satCols[a]]))), activeVolPct: pct(ann(d[a])) }]));
}
// ② 걸어가며 재기: 4주마다 그때까지의 156주로 배분을 정하고 다음 4주를 본다
const run = (method, { band = null } = {}) => {
  let hold = null, cash = 0, benchW = null; const act = [], port = [], fc = [], turn = [];
  for (let t = WIN; t < R.length; t++) {
    if ((t - WIN) % STEP === 0) {
      const { cov } = shrinkCov(R.slice(t - WIN, t)), { w, wb } = build(method, cov), tot = hold ? hold.reduce((a, b) => a + b, 0) + cash : 1, cur = hold ? hold.map(x => x / tot) : null;
      const drift = cur ? Math.max(...satCols.map(i => Math.abs(cur[i] - w[i]) / w[i])) : Infinity;
      if (!band || drift > band) { turn.push(cur ? (w.reduce((a, x, i) => a + Math.abs(x - cur[i]), 0) + Math.abs((1 - w.reduce((a, b) => a + b, 0)) - cash / tot)) / 2 : 0); hold = w.map(x => x * tot); cash = tot - hold.reduce((a, b) => a + b, 0); } else turn.push(0);
      benchW = wb; fc.push({ t, te: Math.sqrt(quad(cov, w.map((x, i) => x - wb[i]))), vol: Math.sqrt(quad(cov, w)) });
    }
    const tot = hold.reduce((a, b) => a + b, 0) + cash, r = R[t].map(x => Math.exp(x) - 1), next = hold.map((x, i) => x * (1 + r[i])), p = (next.reduce((a, b) => a + b, 0) + cash) / tot - 1, b = benchW.reduce((a, x, i) => a + x * r[i], 0);
    hold = next; port.push(p); act.push(p - b);
  }
  const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  // 예측과 실제: 배분을 정할 때 예측한 추적오차 vs 그 뒤 4주의 실제(제곱 평균)
  let f2 = 0, r2 = 0; fc.forEach(({ t, te }) => { const seg = act.slice(t - WIN, t - WIN + STEP); if (seg.length === STEP) { f2 += te * te; r2 += seg.reduce((a, x) => a + x * x, 0) / STEP; } });
  let rel = 1, peak = 1, mdd = 0; for (const a of act) { rel *= 1 + a; peak = Math.max(peak, rel); mdd = Math.min(mdd, rel / peak - 1); }
  const years = act.length / YEAR;
  return { from: RW[WIN], to: RW.at(-1), weeks: act.length, tePct: pct(ann(sd(act)), 2), volPct: pct(ann(sd(port))), teForecastPct: pct(ann(Math.sqrt(f2 / fc.length)), 2), teRealizedOverForecast: Math.round(Math.sqrt(r2 / f2) * 100) / 100, relDrawdownPct: pct(mdd), turnoverPerYearPct: pct(turn.reduce((a, b) => a + b, 0) / years), rebalances: turn.filter(x => x > 0).length };
};
const walk = Object.fromEntries(METHODS.map(([id, label]) => [id, { label, ...run(id) }]));
walk.equalBand25 = { label: '균등 · 25% 넘게 벗어날 때만 맞춤', ...run('equal', { band: 0.25 }) };
walk.ercBand25 = { label: '위험 기여 균등 · 25% 넘게 벗어날 때만 맞춤', ...run('erc', { band: 0.25 }) };

const out = { version: RISK_BUDGET_VERSION, generatedAt: new Date().toISOString(), planVersion: plan.version, data: { from: W[0], to: W.at(-1), weeks: R.length, window: WIN, stepWeeks: STEP, source: 'Yahoo Finance 일봉 수정 종가 → 원화 → 주간' }, universe: order.map(h => ({ symbol: h.symbol, name: h.name, role: h.role, pct: pct(h.pct) })), shrink: { delta: Math.round(now.delta * 100) / 100, avgCorr: Math.round(now.avgCorr * 100) / 100 }, snapshot, walk,
  notes: ['수익은 비교하지 않는다(종목을 2026년에 골랐다).', '비교선 = 국가 비중을 맞춘 지수(SPY·KODEX 200) + 같은 현금.', '능동 위험 몫 = 종목을 사고 그만큼 자기 시장 지수를 덜 가진 위치의 추적오차 기여.', '공분산은 표본을 같은-상관 목표로 줄인 값(Ledoit·Wolf).'] };
writeFileSync(join(root, 'data/sizing-study.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ data: out.data, shrink: out.shrink }));
console.log('names', JSON.stringify(snapshot.names));
for (const [id] of METHODS) console.log(id.padEnd(10), 'vol', snapshot[id].volPct, 'TE', snapshot[id].tePct, 'maxShare', snapshot[id].maxActiveSharePct, 'bets', snapshot[id].effectiveBets, 'satRisk', snapshot[id].satRiskOfTotalPct, JSON.stringify(snapshot[id].weightsPct));
console.log('equal active shares', JSON.stringify(snapshot.equal.activeSharePct));
for (const [id, v] of Object.entries(walk)) console.log(id.padEnd(12), JSON.stringify({ te: v.tePct, fc: v.teForecastPct, ratio: v.teRealizedOverForecast, vol: v.volPct, relDD: v.relDrawdownPct, turn: v.turnoverPerYearPct, reb: v.rebalances, from: v.from }));
