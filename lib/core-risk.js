// 핵심 기능용 위험 계산(브라우저·Node 공용). 화면(오늘 점검·매매 전 확인·성적표)과 검증 스크립트가 같은 함수를 쓴다.
// - 종목 비중 배수: GARCH로 예측한 20일 변동성 → min(1, 목표 ÷ 예측). 미국 종목은 종가가 200일선 아래면 0.
// - 계좌 하루 손실 범위: 종목별 원화 수익률을 EWMA 변동성으로 지금 수준에 맞춰 늘리거나 줄인 뒤(필터드 역사적 시뮬레이션)
//   지금 보유 금액에 곱해 최근 500거래일의 '오늘이라면' 손익을 만들고, 그 분포의 하위 5%·1%를 쓴다. 종목 사이 상관이 그대로 들어간다.
import { fitGarch, garchHorizonVar } from './risk-models.js';

export const CORE_RISK_VERSION = 'K2-2026-11-06';
const SQ252 = Math.sqrt(252);

// 원화 기준 일간 수익률. USD 종목은 같은 날(없으면 직전) 환율 변화를 곱한다.
export function krwReturns(candles, currency, fxCandles = []) {
  const out = [], fx = new Map(fxCandles.map(c => [c.date, c.close])); let lastFx = null, prevFx = null;
  const fxOn = d => { if (fx.has(d)) lastFx = fx.get(d); return lastFx; };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i], f = currency === 'USD' ? fxOn(c.date) : 1;
    if (i > 0 && candles[i - 1].close > 0 && c.close > 0) {
      const r = c.close / candles[i - 1].close - 1, rf = currency === 'USD' && prevFx && f ? f / prevFx - 1 : 0;
      out.push({ date: c.date, r: (1 + r) * (1 + rf) - 1 });
    }
    if (currency === 'USD') prevFx = f;
  }
  return out;
}

// EWMA 조건부 표준편차(그날까지 자료로 본 다음 날 값). sig[t]는 r[t]를 보기 전의 예측.
export function ewmaSigma(r, lambda = 0.94) {
  const out = new Array(r.length + 1); let v = r.slice(0, Math.min(60, r.length)).reduce((a, x) => a + x * x, 0) / Math.max(1, Math.min(60, r.length));
  out[0] = Math.sqrt(v); for (let t = 0; t < r.length; t++) { v = lambda * v + (1 - lambda) * r[t] * r[t]; out[t + 1] = Math.sqrt(v); }
  return out;
}

/** 종목 하나의 지금 위험과 규칙 배수. candles: 일봉(현지 통화), market: 'KR'|'US' */
export function assetRisk(candles, { market = 'KR', volTarget = 0.15, trendUS = true } = {}) {
  const c = candles.filter(x => x.close > 0);
  if (c.length < 120) return { ok: false, reason: '시세가 120거래일보다 짧아 위험을 계산하지 못했습니다.' };
  const closes = c.map(x => x.close), r = []; for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const g = fitGarch(r.slice(-1000)), vol = Math.sqrt(garchHorizonVar(g, 20) / 20 * 252);
  const n = closes.length, ma200 = n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  const above200 = ma200 === null ? null : closes.at(-1) > ma200, volMult = Math.min(1, volTarget / vol);
  const trendApplies = market === 'US' && trendUS && above200 !== null;
  const mult = trendApplies && !above200 ? 0 : volMult;
  return { ok: true, date: c.at(-1).date, close: closes.at(-1), vol, volMult, mult, above200, ma200, trendApplies, garch: g };
}

/**
 * 과거 날짜별 규칙 배수(성적표·검증용). GARCH를 직전 1000일로 60거래일마다 다시 적합하고 그 사이엔 앞으로만 갱신한다.
 * @returns Map(date → {vol, mult}) — date의 종가까지 보고 정한 값(다음 거래일에 적용)
 */
export function riskPath(candles, { market = 'KR', from = '0000', volTarget = 0.15, trendUS = true, refit = 60 } = {}) {
  const c = candles.filter(x => x.close > 0), closes = c.map(x => x.close), r = [0];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const pre = [0]; for (const v of closes) pre.push(pre.at(-1) + v);
  const out = new Map(); let fit = null, h = null, since = 0;
  const start = Math.max(120, c.findIndex(x => x.date >= from) - 1);
  if (start < 120 || start >= c.length) return out;
  for (let t = start; t < c.length; t++) {
    if (!fit || since >= refit) { fit = fitGarch(r.slice(Math.max(1, t - 999), t + 1)); h = fit.nextVar; since = 0; }
    else { const e = r[t] - fit.mu; h = fit.omega + fit.alpha * e * e + fit.beta * h; }
    since++;
    const vol = Math.sqrt(garchHorizonVar({ ...fit, nextVar: h }, 20) / 20 * 252), ma = t >= 199 ? (pre[t + 1] - pre[t - 199]) / 200 : null;
    const volMult = Math.min(1, volTarget / vol), below = market === 'US' && trendUS && ma !== null && closes[t] <= ma;
    out.set(c[t].date, { vol, mult: below ? 0 : volMult });
  }
  return out;
}

/**
 * 계좌 손실 범위 계산 준비: 종목별 원화 수익률을 자기 EWMA 변동성으로 나눈 표준화 수익률(z)과
 * 날마다의 '다음 날 예측 변동성'을 날짜 합집합 위에 놓는다. 자료가 없는 날(휴장)은 z = 0.
 * @param series {symbol: [{date, r}]}
 */
export function riskGrid(series) {
  const dates = [...new Set(Object.values(series).flatMap(s => s.map(x => x.date)))].sort(), at = new Map(dates.map((d, k) => [d, k]));
  const z = {}, next = {};
  for (const [sym, s] of Object.entries(series)) {
    if (!s?.length) continue;
    const r = s.map(x => x.r), sig = ewmaSigma(r), zz = new Float64Array(dates.length), nn = new Float64Array(dates.length);
    s.forEach((x, k) => { const g = at.get(x.date); zz[g] = sig[k] > 0 ? x.r / sig[k] : 0; nn[g] = sig[k + 1]; });
    let last = sig[0]; for (let g = 0; g < dates.length; g++) { if (nn[g] > 0) last = nn[g]; else nn[g] = last; }
    z[sym] = zz; next[sym] = nn;
  }
  return { dates, at, z, next };
}
/**
 * k번째 날짜 종가 기준, 지금 보유(원)로 본 다음 날 손익 분포의 95%·99% 손실(원). 상관은 같은 날 z를 함께 쓰는 것으로 들어간다.
 * 각 날의 손익 = Σ 보유액 × 지금 예측 변동성 × 그날 z (필터드 역사적 시뮬레이션)
 */
export function portfolioRiskAt(grid, holdings, k, window = 500) {
  const live = holdings.filter(h => h.valueKrw > 0 && grid.z[h.symbol]), missing = holdings.filter(h => h.valueKrw > 0 && !grid.z[h.symbol]).map(h => h.symbol);
  const total = live.reduce((a, h) => a + h.valueKrw, 0);
  if (!live.length || k < 30) return { ok: false, var95: 0, var99: 0, es95: 0, total, missing };
  const from = Math.max(0, k - window + 1), w = live.map(h => h.valueKrw * grid.next[h.symbol][k]), zs = live.map(h => grid.z[h.symbol]);
  const pnl = []; for (let j = from; j <= k; j++) { let v = 0; for (let i = 0; i < live.length; i++) v += w[i] * zs[i][j]; pnl.push(v); }
  pnl.sort((a, b) => a - b);
  const q = p => { const x = (pnl.length - 1) * p, i = Math.floor(x), f = x - i; return pnl[i] + (pnl[Math.min(i + 1, pnl.length - 1)] - pnl[i]) * f; };
  const tail = pnl.filter(v => v <= q(0.05));
  return { ok: true, total, days: pnl.length, var95: Math.max(0, -q(0.05)), var99: Math.max(0, -q(0.01)), es95: Math.max(0, -tail.reduce((a, b) => a + b, 0) / tail.length), up95: q(0.95), missing };
}
/** 마지막 날 기준 계좌 하루 손실 범위(원). holdings: [{symbol, valueKrw}], series: {symbol: [{date, r}]} */
export function portfolioRisk(holdings, series, { window = 500, grid = null } = {}) {
  const g = grid || riskGrid(Object.fromEntries(holdings.filter(h => series[h.symbol]?.length > 30).map(h => [h.symbol, series[h.symbol]])));
  return portfolioRiskAt(g, holdings, g.dates.length - 1, window);
}

// 한 종목 h일 손실·이익 범위(원, 정규 근사가 아니라 GARCH 경로 몬테카를로 대신 간단한 √h 확장: 화면 보조용)
export function singleRange(valueKrw, vol, days = 20, z = 1.645) { const s = vol / SQ252 * Math.sqrt(days); return [valueKrw * (Math.exp(-z * s) - 1), valueKrw * (Math.exp(z * s) - 1)]; }

/**
 * 날짜별 규칙 계산 도구(성적표·검증 공용). candlesBySymbol: 현지 통화 일봉, meta: {symbol: {market, currency}}
 * riskAt(sym, date): 그 날 종가까지로 본 {ok, vol, trendApplies, above200}
 * portVarAt(holdings, date): 그 날 종가 기준 다음 날 계좌 손실 범위
 */
export function buildEngine(candlesBySymbol, meta, fxCandles = [], { from = '0000' } = {}) {
  const syms = Object.keys(candlesBySymbol).filter(s => candlesBySymbol[s]?.length);
  const series = Object.fromEntries(syms.map(s => [s, krwReturns(candlesBySymbol[s], meta[s]?.currency || 'KRW', fxCandles)]));
  const grid = riskGrid(series);
  const paths = Object.fromEntries(syms.map(s => [s, riskPath(candlesBySymbol[s], { market: meta[s]?.market || 'KR', from })]));
  const above = Object.fromEntries(syms.map(s => { const c = candlesBySymbol[s], m = new Map(); let sum = 0; c.forEach((x, k) => { sum += x.close; if (k >= 200) sum -= c[k - 200].close; if (k >= 199) m.set(x.date, x.close > sum / 200); }); return [s, m]; }));
  const sorted = Object.fromEntries(syms.map(s => [s, { p: [...paths[s].keys()], a: [...above[s].keys()] }]));
  const lastKey = (keys, date) => { let lo = 0, hi = keys.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (keys[m] <= date) { f = m; lo = m + 1; } else hi = m - 1; } return f < 0 ? undefined : keys[f]; };
  const riskAt = (sym, date) => {
    if (!paths[sym]) return { ok: false };
    const pk = lastKey(sorted[sym].p, date), ak = lastKey(sorted[sym].a, date);
    if (pk === undefined) return { ok: false };
    const above200 = ak === undefined ? null : above[sym].get(ak);
    return { ok: true, vol: paths[sym].get(pk).vol, trendApplies: (meta[sym]?.market || 'KR') === 'US' && above200 !== null, above200 };
  };
  const portVarAt = (holdings, date) => portfolioRiskAt(grid, holdings, lastIndex(grid.dates, date));
  return { syms, grid, series, riskAt, portVarAt };
}
function lastIndex(dates, date) { let lo = 0, hi = dates.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= date) { f = m; lo = m + 1; } else hi = m - 1; } return f; }
