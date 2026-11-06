// 상황 판별(정의 고정·버전 기록). 전략 테스트 배지, 종목 상세, 상황 통계 스크립트, 이슈 봇 신호 기록이 같은 함수를 쓴다.
// 정의를 바꾸면 SITUATION_VERSION을 올리고 data/situation-stats.json을 다시 만든다.
export const SITUATION_VERSION = 'S1.1-2026-11-06';

export const STATES = {
  crash: { label: '급락', rule: '20거래일 수익률 −20% 이하, 또는 1년 고점 대비 −30% 이하이면서 60거래일 수익률 −15% 이하' },
  oversold: { label: '과매도', rule: 'RSI(14) 30 이하' },
  overheat: { label: '과열', rule: 'RSI(14) 70 이상, 200일선보다 30% 이상 위, 또는 20거래일 수익률 +25% 이상' },
  uptrend: { label: '상승 추세', rule: '종가 > 20일선 > 60일선이고 60일선이 20거래일 전보다 높음' },
  downtrend: { label: '하락 추세', rule: '종가 < 20일선 < 60일선이고 60일선이 20거래일 전보다 낮음' },
  range: { label: '횡보', rule: '위 어디에도 해당하지 않음' }
};
export const STATE_ORDER = ['crash', 'oversold', 'overheat', 'uptrend', 'downtrend', 'range'];

export const REGIMES = {
  up: { label: '상승장', rule: '지수가 200일선 위이고 200일선이 20거래일 전보다 높음' },
  down: { label: '하락장', rule: '지수가 200일선 아래이고 200일선이 20거래일 전보다 낮음' },
  sideways: { label: '횡보장', rule: '상승장·하락장이 아닌 날' }
};

export const GROUPS = { KR_STOCK: '국내 대형주', US_STOCK: '미국 대형주', ETF: 'ETF' };
const KR_ETF = /^(069500|229200|091160|139260|102110|114800|122630|252670|360750|379800|133690|305720|371460|381170|161510)$/;
export function groupOf({ symbol = '', currency, instrumentType } = {}) {
  const code = String(symbol).split('.')[0];
  if (String(instrumentType).toUpperCase() === 'ETF' || KR_ETF.test(code)) return 'ETF';
  return currency === 'USD' || /^[A-Z][A-Z.\-]*$/.test(code) ? 'US_STOCK' : 'KR_STOCK';
}

// 모든 값은 그날 종가까지의 자료만 쓴다(미래 자료 없음).
export function computeFeatures(candles) {
  const n = candles.length, close = candles.map(c => Number(c.close));
  const sum = [0], sq = [0];
  for (const v of close) { sum.push(sum.at(-1) + v); sq.push(sq.at(-1) + v * v); }
  const ma = p => close.map((_, i) => i + 1 >= p ? (sum[i + 1] - sum[i + 1 - p]) / p : null);
  const ma5 = ma(5), ma20 = ma(20), ma60 = ma(60), ma200 = ma(200);
  const sd20 = close.map((_, i) => { if (i + 1 < 20) return null; const m = ma20[i]; return Math.sqrt(Math.max(0, (sq[i + 1] - sq[i + 1 - 20]) / 20 - m * m)); });
  const rsi = new Array(n).fill(null), absMove20 = new Array(n).fill(null), vol20 = new Array(n).fill(null);
  let gain = 0, loss = 0, abs = 0, r1 = 0, r2 = 0;
  const ret = close.map((v, i) => i ? v / close[i - 1] - 1 : 0);
  for (let i = 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    if (d > 0) gain += d; else loss -= d; abs += Math.abs(d); r1 += ret[i]; r2 += ret[i] * ret[i];
    if (i > 14) { const o = close[i - 14] - close[i - 15]; if (o > 0) gain -= o; else loss += o; }
    if (i > 20) { abs -= Math.abs(close[i - 20] - close[i - 21]); r1 -= ret[i - 20]; r2 -= ret[i - 20] * ret[i - 20]; }
    if (i >= 14) rsi[i] = loss <= 1e-12 ? 100 : 100 - 100 / (1 + gain / loss);
    if (i >= 20) { absMove20[i] = abs / 20; const m = r1 / 20; vol20[i] = Math.sqrt(Math.max(0, r2 / 20 - m * m)); }
  }
  const back = (k, i) => i >= k ? close[i] / close[i - k] - 1 : null;
  const r20 = close.map((_, i) => back(20, i)), r60 = close.map((_, i) => back(60, i));
  const slope60 = ma60.map((v, i) => v !== null && ma60[i - 20] ? v / ma60[i - 20] - 1 : null);
  const slope200 = ma200.map((v, i) => v !== null && ma200[i - 20] ? v / ma200[i - 20] - 1 : null);
  const gap200 = close.map((v, i) => ma200[i] ? v / ma200[i] - 1 : null);
  // 1년(252거래일) 최고 종가 — 덱으로 O(n)
  const hi252 = new Array(n).fill(null), dq = [];
  for (let i = 0; i < n; i++) {
    while (dq.length && close[dq.at(-1)] <= close[i]) dq.pop();
    dq.push(i); if (dq[0] <= i - 252) dq.shift();
    if (i >= 60) hi252[i] = close[dq[0]];
  }
  const dd = close.map((v, i) => hi252[i] ? v / hi252[i] - 1 : null);
  // 직전 20거래일 최고 종가(오늘 제외): 돌파 판단용
  const hi20prev = close.map((_, i) => i >= 20 ? Math.max(...close.slice(i - 20, i)) : null);
  return { n, dates: candles.map(c => c.date), open: candles.map(c => Number(c.open)), close, ret, ma5, ma20, ma60, ma200, sd20, rsi, absMove20, vol20, r20, r60, slope60, slope200, gap200, hi252, dd, hi20prev };
}

const r1 = v => Math.round(v * 10) / 10;
const sgn = v => (v > 0 ? '+' : '') + r1(v * 100) + '%';

export function classifyAt(F, i) {
  const c = F.close[i], rsi = F.rsi[i], r20 = F.r20[i], r60 = F.r60[i], dd = F.dd[i], gap = F.gap200[i];
  const ma20 = F.ma20[i], ma60 = F.ma60[i], slope = F.slope60[i];
  if (rsi === null || ma60 === null || r20 === null) return { state: null, signs: [], label: '자료 부족' };
  const signs = [];
  if (rsi >= 70) signs.push(`RSI ${r1(rsi)}`); if (rsi <= 30) signs.push(`RSI ${r1(rsi)}`);
  if (gap !== null && Math.abs(gap) >= 0.2) signs.push(`200일선 ${sgn(gap)}`);
  if (Math.abs(r20) >= 0.15) signs.push(`20일 ${sgn(r20)}`);
  if (dd !== null && dd <= -0.2) signs.push(`1년 고점 대비 ${sgn(dd)}`);
  let state;
  if (r20 <= -0.2 || (dd !== null && dd <= -0.3 && r60 !== null && r60 <= -0.15)) state = 'crash';
  else if (rsi <= 30) state = 'oversold';
  else if (rsi >= 70 || (gap !== null && gap >= 0.3) || r20 >= 0.25) state = 'overheat';
  else if (c > ma20 && ma20 > ma60 && slope > 0) state = 'uptrend';
  else if (c < ma20 && ma20 < ma60 && slope < 0) state = 'downtrend';
  else state = 'range';
  if (state === 'uptrend' || state === 'downtrend') signs.push(`60일선 기울기 ${sgn(slope)}`);
  return { state, label: STATES[state].label, signs };
}

export function regimeAt(F, i) {
  const c = F.close[i], m = F.ma200[i], s = F.slope200[i];
  if (m === null || s === null) return null;
  if (c > m && s > 0) return 'up';
  if (c < m && s < 0) return 'down';
  return 'sideways';
}

// 오늘(마지막 거래일) 상태 요약: 화면 배지용
export function currentSituation(candles, indexCandles = []) {
  if (!Array.isArray(candles) || candles.length < 61) return { available: false, message: '상황을 판별할 시세가 부족합니다(60거래일 이상 필요).' };
  const F = computeFeatures(candles), i = F.n - 1, s = classifyAt(F, i);
  let regime = null;
  if (indexCandles.length > 220) { const G = computeFeatures(indexCandles); regime = regimeAt(G, G.n - 1); }
  return { available: !!s.state, version: SITUATION_VERSION, date: F.dates[i], ...s, rule: s.state ? STATES[s.state].rule : '', regime, regimeLabel: regime ? REGIMES[regime].label : null,
    numbers: { rsi: F.rsi[i], gap200: F.gap200[i], r20: F.r20[i], dd: F.dd[i], vol20: F.vol20[i] } };
}
