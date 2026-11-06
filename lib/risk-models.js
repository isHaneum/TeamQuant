// 시계열·금융 수학 모델(브라우저·Node 공용, 외부 라이브러리 없음).
// - EWMA 변동성(RiskMetrics λ=0.94)
// - GARCH(1,1): 분산 목표화(ω=(1−α−β)·표본분산) + 가우시안 준최우추정, Nelder–Mead
// - 2상태 가우시안 HMM(국면 전환): Baum–Welch, 마지막 날 '고변동 국면' 확률
// - VaR·기대손실(ES): GARCH 표준화 잔차를 쓰는 필터드 역사적 시뮬레이션(FHS)
// - 몬테카를로: GARCH 경로 + 잔차 부트스트랩으로 h일 수익률·중간 최대 손실 분포
// 수익률은 로그수익률(일간). 결과의 변동성은 연율(√252)로도 함께 준다.
export const MODEL_VERSION = 'R1-2026-11-06';
const SQ252 = Math.sqrt(252);

export function logReturns(closes) { const r = []; for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1])); return r; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const variance = (a, m = mean(a)) => a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1);

export function ewmaVariance(returns, lambda = 0.94) {
  const out = new Array(returns.length + 1); let v = variance(returns.slice(0, Math.min(60, returns.length)));
  out[0] = v; for (let t = 0; t < returns.length; t++) { v = lambda * v + (1 - lambda) * returns[t] ** 2; out[t + 1] = v; }
  return out; // out[t]: t일까지 자료로 본 다음 날 분산
}

// Nelder–Mead(작은 차원용)
export function nelderMead(f, x0, { step = 0.5, iters = 300, tol = 1e-9 } = {}) {
  const n = x0.length; let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; pts.push(p); }
  let vals = pts.map(f);
  for (let k = 0; k < iters; k++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]); pts = idx.map(i => pts[i]); vals = idx.map(i => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const at = t => c.map((v, j) => v + t * (pts[n][j] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < vals[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
    else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else { const xc = at(fr < vals[n] ? -0.5 : 0.5), fc = f(xc);
      if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); } }
  }
  const b = vals.indexOf(Math.min(...vals)); return { x: pts[b], fx: vals[b] };
}

const sig = x => 1 / (1 + Math.exp(-x));
function garchPath(e, alpha, beta, v0) {
  const h = new Array(e.length + 1), omega = (1 - alpha - beta) * v0; h[0] = v0;
  for (let t = 0; t < e.length; t++) h[t + 1] = omega + alpha * e[t] ** 2 + beta * h[t];
  return { h, omega };
}
/** GARCH(1,1) 적합. returns: 일간 로그수익률(최소 250개 권장) */
export function fitGarch(returns) {
  if (!returns || returns.length < 100) return { ok: false, reason: '자료 부족' };
  const mu = mean(returns), e = returns.map(r => r - mu), v0 = variance(e, 0);
  const unpack = ([a, b]) => { const p = 0.999 * sig(b), alpha = p * sig(a); return { alpha, beta: p - alpha }; };
  const nll = x => { const { alpha, beta } = unpack(x), { h } = garchPath(e, alpha, beta, v0); let s = 0; for (let t = 0; t < e.length; t++) { const ht = Math.max(h[t], 1e-12); s += Math.log(ht) + e[t] ** 2 / ht; } return 0.5 * s; };
  // 시작점: α=0.08, β=0.90
  const start = [Math.log(0.08 / 0.98 / (1 - 0.08 / 0.98)), Math.log(0.98 / 0.999 / (1 - 0.98 / 0.999))];
  const best = nelderMead(nll, start, { step: 0.6, iters: 400 });
  const { alpha, beta } = unpack(best.x), { h, omega } = garchPath(e, alpha, beta, v0);
  const z = e.map((x, t) => x / Math.sqrt(Math.max(h[t], 1e-12)));
  return { ok: true, mu, alpha, beta, omega, persistence: alpha + beta, longRunVar: v0, longRunVol: Math.sqrt(v0) * SQ252, h, z, lastE: e.at(-1), nextVar: h[e.length], nll: best.fx, halfLife: Math.log(0.5) / Math.log(alpha + beta) };
}
/** h일 누적 분산(일간 분산 합). fit.nextVar = 다음 날 분산 */
export function garchHorizonVar(fit, horizon) {
  const p = fit.persistence, lr = fit.longRunVar; let s = 0;
  for (let k = 1; k <= horizon; k++) s += lr + p ** (k - 1) * (fit.nextVar - lr);
  return s;
}
export const annualVol = (dailyVar, horizon = 1) => Math.sqrt(dailyVar / horizon) * SQ252;

// ── 2상태 가우시안 HMM ───────────────────────────────────────
const npdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
export function fitHmm2(returns, { iters = 60 } = {}) {
  const x = returns, T = x.length; if (T < 120) return { ok: false, reason: '자료 부족' };
  const m0 = mean(x), s0 = Math.sqrt(variance(x));
  let mu = [m0 + 0.1 * s0 / 10, m0 - 0.1 * s0 / 10], sd = [0.7 * s0, 1.7 * s0], A = [[0.98, 0.02], [0.05, 0.95]], pi = [0.7, 0.3];
  let alpha = [], scale = [], ll = -Infinity;
  for (let it = 0; it < iters; it++) {
    // 순방향(스케일링)
    alpha = new Array(T); scale = new Array(T);
    for (let t = 0; t < T; t++) {
      const b = [npdf(x[t], mu[0], sd[0]) + 1e-300, npdf(x[t], mu[1], sd[1]) + 1e-300];
      const a = t === 0 ? [pi[0] * b[0], pi[1] * b[1]] : [0, 1].map(j => (alpha[t - 1][0] * A[0][j] + alpha[t - 1][1] * A[1][j]) * b[j]);
      const c = a[0] + a[1]; scale[t] = c; alpha[t] = [a[0] / c, a[1] / c];
    }
    // 역방향
    const beta = new Array(T); beta[T - 1] = [1, 1];
    for (let t = T - 2; t >= 0; t--) { const b = [npdf(x[t + 1], mu[0], sd[0]) + 1e-300, npdf(x[t + 1], mu[1], sd[1]) + 1e-300]; beta[t] = [0, 1].map(i => (A[i][0] * b[0] * beta[t + 1][0] + A[i][1] * b[1] * beta[t + 1][1]) / scale[t + 1]); }
    const gamma = alpha.map((a, t) => { const g = [a[0] * beta[t][0], a[1] * beta[t][1]], s = g[0] + g[1]; return [g[0] / s, g[1] / s]; });
    const xi = [[0, 0], [0, 0]];
    for (let t = 0; t < T - 1; t++) { const b = [npdf(x[t + 1], mu[0], sd[0]) + 1e-300, npdf(x[t + 1], mu[1], sd[1]) + 1e-300]; let s = 0; const m = [[0, 0], [0, 0]]; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { m[i][j] = alpha[t][i] * A[i][j] * b[j] * beta[t + 1][j]; s += m[i][j]; } for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) xi[i][j] += m[i][j] / s; }
    for (let j = 0; j < 2; j++) { const w = gamma.reduce((a, g) => a + g[j], 0); mu[j] = gamma.reduce((a, g, t) => a + g[j] * x[t], 0) / w; sd[j] = Math.max(1e-5, Math.sqrt(gamma.reduce((a, g, t) => a + g[j] * (x[t] - mu[j]) ** 2, 0) / w)); }
    for (let i = 0; i < 2; i++) { const s = xi[i][0] + xi[i][1]; A[i] = [xi[i][0] / s, xi[i][1] / s]; }
    pi = gamma[0];
    const nll = scale.reduce((a, c) => a + Math.log(c), 0);
    if (Math.abs(nll - ll) < 1e-7) { ll = nll; break; } ll = nll;
  }
  const hi = sd[1] >= sd[0] ? 1 : 0, lo = 1 - hi;
  const pHigh = alpha[T - 1][hi], next = alpha[T - 1][lo] * A[lo][hi] + alpha[T - 1][hi] * A[hi][hi];
  const params = { mu: [mu[lo], mu[hi]], sd: [sd[lo], sd[hi]], A: [[A[lo][lo], A[lo][hi]], [A[hi][lo], A[hi][hi]]] };
  return { ok: true, params, calm: { mu: mu[lo], vol: sd[lo] * SQ252, stay: A[lo][lo] }, stress: { mu: mu[hi], vol: sd[hi] * SQ252, stay: A[hi][hi] }, pStressNow: pHigh, pStressNext: next, stressDuration: 1 / Math.max(1e-6, 1 - A[hi][hi]), filtered: alpha.map(a => a[hi]), loglik: ll };
}

/** 고정된 HMM 모수로 새 자료를 앞으로만 걸러 각 날의 '고변동 국면' 확률을 낸다(미래 자료 없음). params.mu/sd/A는 [평온, 고변동] 순서 */
export function hmmFilter(x, params, pStress0 = 0.5) {
  let p = [1 - pStress0, pStress0]; const out = [], { mu, sd, A } = params;
  for (const v of x) {
    const prior = [p[0] * A[0][0] + p[1] * A[1][0], p[0] * A[0][1] + p[1] * A[1][1]];
    const post = [prior[0] * (npdf(v, mu[0], sd[0]) + 1e-300), prior[1] * (npdf(v, mu[1], sd[1]) + 1e-300)], s = post[0] + post[1];
    p = [post[0] / s, post[1] / s]; out.push(p[1]);
  }
  return out;
}

// ── VaR·ES (FHS) ─────────────────────────────────────────────
export function quantile(sorted, q) { const p = (sorted.length - 1) * q, i = Math.floor(p), f = p - i; return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * f; }
/** 다음 1일 VaR·ES(손실을 양수 비율로). fit: fitGarch 결과 */
export function oneDayRisk(fit, level = 0.95) {
  const z = [...fit.z].sort((a, b) => a - b), q = quantile(z, 1 - level), tail = z.filter(v => v <= q), s = Math.sqrt(fit.nextVar);
  const VaR = -(fit.mu + s * q), ES = -(fit.mu + s * mean(tail));
  return { level, VaR: 1 - Math.exp(-VaR), ES: 1 - Math.exp(-ES), sigma: s };
}

// 재현 가능한 난수
export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** GARCH 몬테카를로: h일 뒤 수익률 분포와 그 사이 최대 손실. 잔차는 실제 표준화 잔차에서 뽑는다(정규분포 가정 없음). */
export function simulateGarch(fit, horizon, { paths = 3000, seed = 7, drift = true } = {}) {
  const R = rng(seed), z = fit.z.filter(Number.isFinite), zm = mean(z), mu = drift ? fit.mu : 0;
  const ends = new Float64Array(paths), lows = new Float64Array(paths);
  for (let p = 0; p < paths; p++) {
    let h = fit.nextVar, cum = 0, low = 0;
    for (let k = 0; k < horizon; k++) { const e = Math.sqrt(h) * (z[Math.floor(R() * z.length)] - zm); cum += mu + e; low = Math.min(low, cum); h = fit.omega + fit.alpha * e * e + fit.beta * h; }
    ends[p] = Math.exp(cum) - 1; lows[p] = Math.exp(low) - 1;
  }
  const e = Array.from(ends).sort((a, b) => a - b), l = Array.from(lows).sort((a, b) => a - b), frac = (a, f) => a.filter(f).length / a.length;
  return { horizon, paths, p05: quantile(e, 0.05), p25: quantile(e, 0.25), median: quantile(e, 0.5), p75: quantile(e, 0.75), p95: quantile(e, 0.95),
    probUp: frac(e, v => v > 0), probDown10: frac(e, v => v <= -0.1), probDown20: frac(e, v => v <= -0.2), worstDipMedian: quantile(l, 0.5), worstDip05: quantile(l, 0.05) };
}

// 변동성 목표 비중: 다음 h일 예측 변동성(연율)으로 계산
export const volTargetWeight = (annualizedVol, target = 0.15) => Number.isFinite(annualizedVol) && annualizedVol > 0 ? Math.min(1, target / annualizedVol) : null;
