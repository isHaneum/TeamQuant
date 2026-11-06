// 과거 기업 분석(전략 테스트)과 성장 전망(포트폴리오)이 함께 쓰는 순수 함수. 브라우저와 node 테스트에서 같이 쓴다.
// 원칙: 분석일 d에 쓰는 값은 모두 '공개일 ≤ d'인 자료에서만 나온다.
// 분기 행: [기말, 공개일, 매출, 영업이익, 순이익, 자본]  월 행: [월말, 종가, 지수]  주식 수 행: [기준일, 공개일, 주식 수(지금 단위)]

export const bs = (arr, d, key = x => x[0]) => { let lo = 0, hi = arr.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (key(arr[m]) <= d) { f = m; lo = m + 1; } else hi = m - 1; } return f; };
const ttm = (arr, k) => arr.length === 4 && arr.every(x => Number.isFinite(x[k])) ? arr.reduce((s, x) => s + x[k], 0) : null;
const growth = (x, y) => x != null && y > 0 ? x / y - 1 : null;

// 그 날짜까지 공개된 분기만으로 최근 4분기 합계와 성장률
export function knownAt(quarters, d) {
  const q = quarters.filter(x => x[1] <= d); if (q.length < 8) return null;
  const a = q.slice(-4), b = q.slice(-8, -4), z = q.slice(-12, -8);
  const span = arr => (Date.parse(arr[3][0]) - Date.parse(arr[0][0])) / 864e5 < 300; if (!span(a) || !span(b)) return null;
  const rev = ttm(a, 2), revP = ttm(b, 2), revPP = z.length === 4 ? ttm(z, 2) : null, oi = ttm(a, 3), oiP = ttm(b, 3), ni = ttm(a, 4), eq = a[3][5];
  return { quarters: a, lastEnd: a[3][0], lastAvail: a[3][1], rev, oi, ni, eq, revG: growth(rev, revP), revGPrev: growth(revP, revPP), oiG: oi != null && oiP > 0 ? oi / oiP - 1 : null,
    margin: rev > 0 && oi != null ? oi / rev : null, marginPrev: revP > 0 && oiP != null ? oiP / revP : null, roe: eq > 0 && ni != null ? ni / eq : null };
}
// 실제 결과: 마지막으로 알려진 분기 다음 nq개 분기(결과 공개 여부와 무관하게 '그 뒤에 실제로 일어난 일')
export function outcomeAfter(quarters, lastEnd, nq) {
  const after = quarters.filter(x => x[0] > lastEnd).slice(0, nq); if (after.length < nq) return null;
  const last4 = after.slice(-4);
  return { rev: ttm(last4, 2), oi: ttm(last4, 3), ni: ttm(last4, 4), end: after.at(-1)[0], knownAt: after.map(x => x[1]).sort().at(-1) };
}
export function monthAt(months, d) { const i = bs(months, d); return i < 0 ? null : { i, date: months[i][0], close: months[i][1], idx: months[i][2] }; }
// 분석일에 공개돼 있던 주식 수 중 기준일이 가장 늦은 것. 400일 넘게 묵었으면 없음.
export function sharesAt(sharesPit, d) {
  let x = null; for (const e of sharesPit || []) if (e[1] <= d && (!x || e[0] > x[0])) x = e;
  return x && (Date.parse(d) - Date.parse(x[0])) / 864e5 <= 400 ? { shares: x[2], asOf: x[0], available: x[1] } : null;
}
// 시가총액: 그때 공개된 주식 수가 있으면 그것, 없으면 지금 주식 수(근사)
export function capAt(c, d, close) {
  const s = sharesAt(c.sharesPit, d);
  if (s) return { cap: close * s.shares, pit: true, asOf: s.asOf };
  return c.shares ? { cap: close * c.shares, pit: false } : { cap: null, pit: false };
}
// 같은 집단 안 순위(0~1, 클수록 큰 값)
export function rankIn(values, v) {
  const vals = values.filter(Number.isFinite); if (!Number.isFinite(v) || vals.length < 5) return null;
  return (vals.filter(x => x < v).length + 0.5 * vals.filter(x => x === v).length) / vals.length;
}
export const topPct = r => Number.isFinite(r) ? `상위 ${Math.max(1, Math.round((1 - r) * 100))}%` : '—';
export const rankWord = r => !Number.isFinite(r) ? null : r >= 0.8 ? '높음' : r >= 0.6 ? '다소 높음' : r >= 0.4 ? '보통' : r >= 0.2 ? '다소 낮음' : '낮음';
export const symKey = s => String(s || '').trim().replace(/^A(?=\d{6}$)/, '').split('.')[0].toUpperCase();

export const LABELS = { revG: '최근 1년 매출 성장', revGPrev: '1년 전 매출 성장', accel: '성장 가속', oiG: '영업이익 성장', niG: '순이익 성장', margin: '영업이익률', marginChg: '영업이익률 변화', roe: 'ROE', ocfMargin: '영업현금흐름/매출',
  eyPit: 'PER', psrPit: 'PSR(시장이 매긴 매출 배수)', logCapPit: '회사 규모', mom: '12개월 주가 흐름', vol: '주가 변동성', dd52: '52주 고점 대비' };
const p100 = (v, d = 0) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
// 모델 근거 한 줄: [특징, 기여, 값] → '▲ PSR 16.3배'
export function driverText(feat, contrib, value, currency = 'KRW') {
  const arrow = contrib >= 0 ? '▲' : '▼', label = LABELS[feat] || feat;
  if (!Number.isFinite(value)) return `${arrow} ${label}`;
  const fmt = {
    revG: p100, revGPrev: p100, oiG: p100, niG: p100, mom: p100, dd52: p100,
    accel: v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%p`, marginChg: v => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%p`,
    margin: v => `${(v * 100).toFixed(1)}%`, roe: v => `${(v * 100).toFixed(1)}%`, ocfMargin: v => `${(v * 100).toFixed(1)}%`, vol: v => `연 ${(v * 100).toFixed(0)}%`,
    psrPit: v => `${v.toFixed(1)}배`, eyPit: v => v > 0 ? `${(1 / v).toFixed(0)}배` : '적자',
    logCapPit: v => { const c = Math.exp(v); return currency === 'USD' ? (c >= 1e12 ? `${(c / 1e12).toFixed(1)}T$` : `${(c / 1e9).toFixed(0)}B$`) : c >= 1e12 ? `${(c / 1e12).toFixed(1)}조원` : `${(c / 1e8).toFixed(0)}억원`; },
  }[feat];
  return `${arrow} ${label} ${fmt ? fmt(value) : value}`;
}
