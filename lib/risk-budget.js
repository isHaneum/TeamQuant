// 위험 예산 계산(브라우저·Node 공용 · 순수 함수). "얼마를 담을지"를 기대수익이 아니라 위험으로 정하기 위한 도구.
// - shrinkCov: 표본 공분산을 '상관이 모두 같다'는 목표로 줄인다(Ledoit·Wolf 2003/2004). 종목 수에 비해 자료가 짧을 때 표본 상관의 우연을 덜어낸다.
// - riskStats: 포트폴리오 변동성, 비교선 대비 추적오차, 종목별 위험 기여(합 1).
// - sleeveWeights: 개별 종목 묶음의 합계 비중은 그대로 두고 종목 사이 배분만 바꾼다(균등 · 변동성 역수 · 잔차분산 역수 · 위험 기여 균등 · 추적오차 최소).
// 기대수익(알파)은 넣지 않는다 — 이 프로젝트의 검증(G2 · 카드 과거 검증)에서 표본 외로 구분되는 알파가 없었기 때문이다(결정 35).
export const RISK_BUDGET_VERSION = 'RB1-2026-11-15';

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const mv = (M, v) => M.map(row => dot(row, v));
export const quad = (M, v) => dot(v, mv(M, v));

/** rows: T×N 수익률(행 = 기간). 반환 {cov, sample, delta(0~1 · 줄인 정도), avgCorr, n, t} */
export function shrinkCov(rows) {
  const T = rows.length, N = rows[0]?.length || 0; if (T < 8 || N < 2) throw new Error('자료가 너무 짧습니다.');
  const mean = Array.from({ length: N }, (_, j) => rows.reduce((a, r) => a + r[j], 0) / T), X = rows.map(r => r.map((v, j) => v - mean[j]));
  const S = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0) / T));
  const sd = S.map((r, i) => Math.sqrt(r[i])); let rsum = 0; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) rsum += S[i][j] / (sd[i] * sd[j]);
  const rbar = rsum / (N * (N - 1) / 2), F = S.map((r, i) => r.map((v, j) => i === j ? v : rbar * sd[i] * sd[j]));
  let pi = 0, rho = 0, gamma = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let pij = 0, tii = 0, tjj = 0;
    for (const x of X) { const c = x[i] * x[j] - S[i][j]; pij += c * c; tii += (x[i] * x[i] - S[i][i]) * c; tjj += (x[j] * x[j] - S[j][j]) * c; }
    pij /= T; tii /= T; tjj /= T; pi += pij; gamma += (F[i][j] - S[i][j]) ** 2;
    rho += i === j ? pij : rbar / 2 * (sd[j] / sd[i] * tii + sd[i] / sd[j] * tjj);
  }
  const delta = gamma > 0 ? Math.max(0, Math.min(1, (pi - rho) / gamma / T)) : 0;
  return { cov: S.map((r, i) => r.map((v, j) => delta * F[i][j] + (1 - delta) * v)), sample: S, delta, avgCorr: rbar, n: N, t: T };
}

/** w, wb: 길이 N 비중(현금은 넣지 않는다 · 합이 1보다 작아도 된다). 반환 {vol, te, rc[], arc[]} — 변동성·추적오차는 자료 주기 단위(연 환산은 호출 쪽) */
export function riskStats(cov, w, wb = null) {
  const sw = mv(cov, w), v = dot(w, sw), a = wb ? w.map((x, i) => x - wb[i]) : null, sa = a ? mv(cov, a) : null, av = a ? dot(a, sa) : 0;
  return { vol: Math.sqrt(Math.max(0, v)), te: Math.sqrt(Math.max(0, av)), rc: w.map((x, i) => v > 0 ? x * sw[i] / v : 0), arc: a ? a.map((x, i) => av > 0 ? x * sa[i] / av : 0) : null };
}
/** 유효 개수(1 ÷ Σ 몫²). 비중이나 위험 기여 몫을 넣는다(음수는 0으로). */
export const effectiveN = shares => { const p = shares.map(x => Math.max(0, x)), s = p.reduce((a, b) => a + b, 0); return s > 0 ? 1 / p.reduce((a, x) => a + (x / s) ** 2, 0) : 0; };

// 합 = total, 0 ≤ s_i ≤ cap 인 집합으로의 사영(이분법).
function project(v, total, cap) { let lo = Math.min(...v) - cap - 1, hi = Math.max(...v) + 1; for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2, s = v.reduce((a, x) => a + Math.min(cap, Math.max(0, x - mid)), 0); if (s > total) lo = mid; else hi = mid; } const t = (lo + hi) / 2; return v.map(x => Math.min(cap, Math.max(0, x - t))); }
// raw 에 비례해 나누되 상한을 넘는 것은 상한에 고정하고 나머지를 다시 비례 배분한다(고정한 것은 끝까지 고정).
const capped = (raw, total, cap) => { const fixed = new Set(); let s = []; for (let k = 0; k <= raw.length; k++) { const freeRaw = raw.reduce((a, x, i) => a + (fixed.has(i) ? 0 : x), 0), left = total - fixed.size * cap; s = raw.map((x, i) => fixed.has(i) ? cap : freeRaw > 0 ? x / freeRaw * left : 0); const over = s.map((x, i) => !fixed.has(i) && x > cap + 1e-12); if (!over.some(Boolean)) break; over.forEach((o, i) => { if (o) fixed.add(i); }); } return s; };

/**
 * 개별 종목 묶음 배분. cov: N×N, sat: 개별 종목의 열 번호들, idxOf: 각 개별 종목이 속한 시장 지수의 열 번호들(같은 길이),
 * total: 묶음 합계 비중, cap: 종목 상한. 능동 위치 = 종목을 사고 그만큼 자기 시장 지수를 덜 가진 것(비교선이 국가 비중을 맞춘 지수이므로).
 * method: 'equal' | 'invVol' | 'invResVar' | 'erc' | 'minTE'
 */
export function sleeveWeights(method, cov, sat, idxOf, { total, cap = 1 } = {}) {
  const n = sat.length, D = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { const i = sat[a], j = sat[b], p = idxOf[a], q = idxOf[b]; return cov[i][j] - cov[i][q] - cov[p][j] + cov[p][q]; }));
  if (method === 'equal') return capped(new Array(n).fill(1), total, cap);
  if (method === 'invVol') return capped(sat.map(i => 1 / Math.sqrt(cov[i][i])), total, cap);
  if (method === 'invResVar') return capped(D.map((r, a) => 1 / r[a]), total, cap);
  if (method === 'erc') { let s = new Array(n).fill(total / n); for (let k = 0; k < 500; k++) { const g = mv(D, s), rc = s.map((x, i) => x * g[i]), m = rc.reduce((a, b) => a + b, 0) / n; s = capped(s.map((x, i) => x * Math.sqrt(m / Math.max(rc[i], 1e-18))), total, cap); } return s; }
  if (method === 'minTE') { let s = new Array(n).fill(total / n); const step = 0.5 / Math.max(...D.map((r, i) => r[i])) / n; for (let k = 0; k < 4000; k++) { const g = mv(D, s); s = project(s.map((x, i) => x - step * 2 * g[i]), total, cap); } return s; }
  throw new Error(`모르는 방법: ${method}`);
}
