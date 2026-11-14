// 결정 35(2026-11-15): 위험 예산 계산 — 줄인 공분산 · 위험 기여 · 묶음 배분. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shrinkCov, riskStats, sleeveWeights, effectiveN, quad } from '../lib/risk-budget.js';

// 정해진 씨앗의 난수(테스트가 매번 같은 값을 쓰게)
function rng(seed) { let s = seed >>> 0; const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; }; return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()); }
// 공통 요인 하나 + 고유 요인. vols: 종목별 고유 변동성, beta: 공통 요인 민감도
function sample(T, vols, beta, seed = 7) { const z = rng(seed); return Array.from({ length: T }, () => { const m = z() * 0.02; return vols.map((v, i) => beta[i] * m + v * z()); }); }
const sum = a => a.reduce((x, y) => x + y, 0);

test('줄인 공분산: 대칭 · 분산은 표본 그대로 · 줄인 정도 0~1 · 자료가 짧을수록 더 줄인다 · 상관이 모두 같으면 표본과 목표가 가깝다', () => {
  const vols = [0.02, 0.03, 0.04, 0.05, 0.06], beta = [1, 1, 1, 1, 1], long = shrinkCov(sample(2000, vols, beta)), short = shrinkCov(sample(40, vols, beta));
  for (const r of [long, short]) { assert.ok(r.delta >= 0 && r.delta <= 1); for (let i = 0; i < 5; i++) { assert.ok(Math.abs(r.cov[i][i] - r.sample[i][i]) < 1e-15, '대각(분산)은 건드리지 않는다'); for (let j = 0; j < 5; j++) assert.ok(Math.abs(r.cov[i][j] - r.cov[j][i]) < 1e-15); } }
  assert.ok(short.delta > long.delta, `짧은 자료 ${short.delta} > 긴 자료 ${long.delta}`);
  assert.throws(() => shrinkCov([[0.1, 0.2]]), /짧습니다/);
});

test('위험 기여: 합이 1 · 비중이 같아도 변동성이 큰 종목의 몫이 크다 · 비교선과 같으면 추적오차 0 · 유효 개수', () => {
  const { cov } = shrinkCov(sample(1500, [0.01, 0.01, 0.05], [1, 1, 1])), w = [0.2, 0.2, 0.2], st = riskStats(cov, w, w);
  assert.ok(Math.abs(sum(st.rc) - 1) < 1e-12); assert.ok(st.rc[2] > st.rc[0] * 2 && st.rc[2] > 0.5, JSON.stringify(st.rc)); assert.equal(st.te, 0);
  assert.ok(Math.abs(riskStats(cov, w).vol ** 2 - quad(cov, w)) < 1e-18);
  const act = riskStats(cov, [0.3, 0.2, 0.1], w); assert.ok(act.te > 0 && Math.abs(sum(act.arc) - 1) < 1e-12);
  assert.equal(effectiveN([1, 1, 1, 1]), 4); assert.ok(Math.abs(effectiveN([0.97, 0.01, 0.01, 0.01]) - 1.06) < 0.01); assert.equal(effectiveN([]), 0);
});

test('묶음 배분: 합계와 상한을 지킨다 · 위험 기여 균등은 능동 위험 몫이 같다 · 추적오차 최소가 가장 작다 · 균등은 변동성 큰 종목에 몫이 쏠린다', () => {
  // 열 0 = 지수, 1~4 = 개별 종목(고유 변동성이 다름)
  const { cov } = shrinkCov(sample(3000, [0.001, 0.02, 0.03, 0.05, 0.08], [1, 1, 1, 1, 1], 11)), sat = [1, 2, 3, 4], idxOf = [0, 0, 0, 0], total = 0.2, cap = 0.12;
  const D = sat.map((i, a) => sat.map((j, b) => cov[i][j] - cov[i][0] - cov[0][j] + cov[0][0])), te = s => Math.sqrt(quad(D, s)), share = s => { const g = D.map(r => r.reduce((x, v, k) => x + v * s[k], 0)), av = sum(s.map((v, k) => v * g[k])); return s.map((v, k) => v * g[k] / av); };
  const W = Object.fromEntries(['equal', 'invVol', 'invResVar', 'erc', 'minTE'].map(m => [m, sleeveWeights(m, cov, sat, idxOf, { total, cap })]));
  for (const [m, s] of Object.entries(W)) { assert.ok(Math.abs(sum(s) - total) < 1e-9, `${m} 합계 ${sum(s)}`); assert.ok(s.every(x => x >= -1e-12 && x <= cap + 1e-9), `${m} 상한 ${JSON.stringify(s)}`); }
  const es = share(W.erc); assert.ok(Math.max(...es) - Math.min(...es) < 0.01, `위험 기여 균등 ${JSON.stringify(es)}`);
  assert.ok(share(W.equal)[3] > 0.5, '균등 비중이면 변동성이 가장 큰 종목이 능동 위험의 절반을 넘는다');
  for (const m of ['equal', 'invVol', 'invResVar', 'erc']) assert.ok(te(W.minTE) <= te(W[m]) + 1e-9, `minTE ${te(W.minTE)} ≤ ${m} ${te(W[m])}`);
  assert.ok(te(W.erc) < te(W.equal));
  assert.throws(() => sleeveWeights('nope', cov, sat, idxOf, { total }), /모르는 방법/);
  const tight = sleeveWeights('invResVar', cov, sat, idxOf, { total: 0.2, cap: 0.06 }); assert.ok(Math.abs(sum(tight) - 0.2) < 1e-9 && Math.max(...tight) <= 0.06 + 1e-9, '상한에 걸린 몫은 나머지에 다시 나눈다');
});

test('크기 비교 자료(data/sizing-study.json): 화면이 읽는 필드 · 지금 계획 버전과 같을 때만 쓴다 · 수익 항목이 없다', () => {
  const s = JSON.parse(readFileSync(new URL('../data/sizing-study.json', import.meta.url), 'utf8')), plan = JSON.parse(readFileSync(new URL('../data/paper-plan.json', import.meta.url), 'utf8'));
  assert.equal(s.planVersion, plan.version, '계획이 바뀌면 node scripts/research/sizing-study.mjs 를 다시 돌린다');
  const sats = Object.entries(plan.weights).filter(([, v]) => v.pct > 0 && v.role !== 'core').map(([k]) => k);
  for (const id of ['equal', 'erc']) { const m = s.snapshot[id]; assert.ok(Number.isFinite(m.tePct) && Number.isFinite(m.volPct) && Number.isFinite(m.maxActiveSharePct) && Number.isFinite(m.satRiskOfTotalPct)); assert.deepEqual(Object.keys(m.weightsPct).sort(), [...sats].sort()); assert.ok(Math.abs(sum(Object.values(m.activeSharePct)) - 100) < 1); }
  assert.ok(s.snapshot.erc.tePct < s.snapshot.equal.tePct); assert.ok(s.snapshot.erc.maxActiveSharePct < s.snapshot.equal.maxActiveSharePct);
  for (const id of ['equal', 'erc', 'equalBand25']) { const w = s.walk[id]; assert.ok(Number.isFinite(w.tePct) && Number.isFinite(w.teForecastPct) && Number.isFinite(w.teRealizedOverForecast) && Number.isFinite(w.turnoverPerYearPct) && w.weeks > 200); }
  assert.ok(s.walk.equalBand25.rebalances < s.walk.equal.rebalances);
  assert.doesNotMatch(JSON.stringify(s), /cagr|returnPct|alpha|sharpe/i, '수익 비교는 싣지 않는다(종목을 2026년에 골랐다)');
});
