// "과거 비슷한 충격 이후" 조건과 대응 규칙. scripts/build-market-research.mjs가 전체 기간 통계를 만들고,
// 화면은 같은 조건 함수로 "지금 해당하는 조건"을 찾아 그 통계를 보여 준다(같은 정의, 같은 계산).
export const ANALOG_VERSION = 'A1-2026-11-06';

export function indexFeatures(candles) {
  const n = candles.length, cl = candles.map(c => Number(c.close)), pre = [0];
  for (const v of cl) pre.push(pre.at(-1) + v);
  const ma = (i, p) => i + 1 >= p ? (pre[i + 1] - pre[i + 1 - p]) / p : null;
  const ret = cl.map((v, i) => i ? v / cl[i - 1] - 1 : 0);
  const vol20 = cl.map((_, i) => { if (i < 21) return null; let m = 0; for (let k = i - 19; k <= i; k++) m += ret[k]; m /= 20; let v = 0; for (let k = i - 19; k <= i; k++) v += (ret[k] - m) ** 2; return Math.sqrt(v / 19 * 252); });
  const hi = new Array(n).fill(null), dq = [];
  for (let i = 0; i < n; i++) { while (dq.length && cl[dq.at(-1)] <= cl[i]) dq.pop(); dq.push(i); if (dq[0] <= i - 252) dq.shift(); hi[i] = cl[dq[0]]; }
  return { n, cl, ret, vol20, dates: candles.map(c => c.date), open: candles.map(c => Number(c.open) > 0 ? Number(c.open) : Number(c.close)),
    ma20: cl.map((_, i) => ma(i, 20)), ma60: cl.map((_, i) => ma(i, 60)), ma200: cl.map((_, i) => ma(i, 200)),
    dd: cl.map((v, i) => v / hi[i] - 1), back20: cl.map((v, i) => i >= 20 ? v / cl[i - 20] - 1 : null) };
}
const gap = (f, i) => f.ma200[i - 1] ? f.cl[i - 1] / f.ma200[i - 1] - 1 : null;

// vix(i의 날짜) → 그날 VIX 하루 변화율(없으면 null)
export const CONDITIONS = [
  { id: 'sp-shock-up', index: '^GSPC', label: 'S&P 500 −2% 이하 + VIX +15% 이상 (200일선보다 3% 넘게 위)', test: (f, i, vix) => f.ret[i] <= -0.02 && vix >= 0.15 && gap(f, i) > 0.03 },
  { id: 'sp-shock-edge', index: '^GSPC', label: 'S&P 500 −2% 이하 + VIX +15% 이상 (200일선 ±3% 안)', test: (f, i, vix) => f.ret[i] <= -0.02 && vix >= 0.15 && Math.abs(gap(f, i)) <= 0.03 },
  { id: 'sp-shock-down', index: '^GSPC', label: 'S&P 500 −2% 이하 + VIX +15% 이상 (200일선보다 3% 넘게 아래)', test: (f, i, vix) => f.ret[i] <= -0.02 && vix >= 0.15 && gap(f, i) < -0.03 },
  { id: 'sp-drop4', index: '^GSPC', label: 'S&P 500 하루 −4% 이하', test: (f, i) => f.ret[i] <= -0.04 },
  { id: 'vix-jump50', index: '^GSPC', label: 'VIX 하루 +50% 이상', test: (f, i, vix) => vix >= 0.5 },
  { id: 'nq-drop3-up', index: '^IXIC', label: '나스닥 −3% 이하 (200일선 위)', test: (f, i) => f.ret[i] <= -0.03 && gap(f, i) > 0 },
  { id: 'nq-drop3-down', index: '^IXIC', label: '나스닥 −3% 이하 (200일선 아래)', test: (f, i) => f.ret[i] <= -0.03 && gap(f, i) <= 0 },
  { id: 'nq-drop5', index: '^IXIC', label: '나스닥 하루 −5% 이하', test: (f, i) => f.ret[i] <= -0.05 },
  { id: 'sox-drop5-up', index: '^SOX', label: '반도체지수 −5% 이하 (200일선 위)', test: (f, i) => f.ret[i] <= -0.05 && gap(f, i) > 0 },
  { id: 'sox-drop8', index: '^SOX', label: '반도체지수 하루 −8% 이하', test: (f, i) => f.ret[i] <= -0.08 },
  { id: 'sox-bear35', index: '^SOX', label: '반도체지수 1년 고점 대비 −35% 이하', gap: 60, test: (f, i) => f.dd[i] <= -0.35 },
  { id: 'ks-drop4-up', index: '^KS11', label: '코스피 −4% 이하 (200일선 위)', test: (f, i) => f.ret[i] <= -0.04 && gap(f, i) > 0 },
  { id: 'ks-drop4-down', index: '^KS11', label: '코스피 −4% 이하 (200일선 아래)', test: (f, i) => f.ret[i] <= -0.04 && gap(f, i) <= 0 },
  { id: 'ks-crash', index: '^KS11', label: '코스피 1년 고점 −30% 이하 + 20일 −15% 이하', gap: 60, test: (f, i) => f.dd[i] <= -0.3 && f.back20[i] <= -0.15 },
  { id: 'ks-fast20', index: '^KS11', label: '코스피 20거래일 −20% 이하', gap: 60, test: (f, i) => f.back20[i] <= -0.2 }
];
export const START = { '^GSPC': '1950-01-01', '^IXIC': '1972-01-01', '^SOX': '1995-01-01', '^KS11': '1998-01-01' };

// 대응 규칙(전날 종가로 정한 비중을 그날 수익률에 적용). 검증과 화면이 같은 함수를 쓴다.
export const RULES = {
  hold: { label: '그냥 보유', weight: () => 1 },
  volTarget: { label: '변동성 목표 15%', weight: (f, k, vol = f.vol20[k]) => Math.min(1, 0.15 / (vol || 0.15)) },
  trend: { label: '200일선 아래면 현금', weight: (f, k) => f.cl[k] > f.ma200[k] ? 1 : 0 },
  combined: { label: '200일선 + 변동성 목표', weight: (f, k, vol = f.vol20[k]) => f.cl[k] > f.ma200[k] ? Math.min(1, 0.15 / (vol || 0.15)) : 0 }
};

export function eventIndexes(f, cond, vixChange = () => null, { from = '0000', gapDays } = {}) {
  const g = gapDays ?? cond.gap ?? 20, out = []; let last = -1e9;
  for (let i = 220; i < f.n; i++) if (f.dates[i] >= from && i - last >= g && cond.test(f, i, vixChange(f.dates[i]))) { out.push(i); last = i; }
  return out;
}

/** 지금(최근 lookback 거래일 안에) 해당하는 조건 */
export function activeConditions(featuresByIndex, vixChange = () => null, lookback = 5) {
  const out = [];
  for (const c of CONDITIONS) {
    const f = featuresByIndex[c.index]; if (!f || f.n < 221) continue;
    for (let i = f.n - 1; i >= Math.max(220, f.n - lookback); i--) if (c.test(f, i, vixChange(f.dates[i]))) { out.push({ id: c.id, index: c.index, label: c.label, date: f.dates[i] }); break; }
  }
  return out;
}
