import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFeatures, classifyAt, currentSituation, regimeAt, groupOf, SITUATION_VERSION, STATE_ORDER } from '../lib/situation.js';
import { SITUATION_STRATEGIES, simulate, runSituationTest, regimeBreakdown, strategyById } from '../lib/situation-strategies.js';
import { collectSamples, selectRule, walkForward, buildStats, stat, UNIVERSE } from '../lib/situation-study.js';

// 합성 일봉: 정해진 일별 수익률 배열 → 오름차순 캔들
function series(returns, start = 100, from = '2020-01-01') {
  let p = start; const t0 = Date.parse(from), out = [];
  returns.forEach((r, i) => { const open = p; p = p * (1 + r); out.push({ date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), open, high: Math.max(open, p), low: Math.min(open, p), close: p }); });
  return out;
}
function noise(n, seed = 7, drift = 0, size = 0.01) { let s = seed; return Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) % 2147483648; return drift + (s / 2147483648 - 0.5) * 2 * size; }); }

test('RSI와 이동평균은 직접 계산과 같다', () => {
  const c = series(noise(80)), F = computeFeatures(c), i = 70, cl = c.map(x => x.close);
  let g = 0, l = 0; for (let k = i - 13; k <= i; k++) { const d = cl[k] - cl[k - 1]; if (d > 0) g += d; else l -= d; }
  assert.ok(Math.abs(F.rsi[i] - (100 - 100 / (1 + g / l))) < 1e-6);
  const ma20 = cl.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
  assert.ok(Math.abs(F.ma20[i] - ma20) < 1e-9);
  assert.equal(F.ma200[i], null);
});

test('상황 판별: 급등은 과열, 급락은 급락, 잔잔하면 횡보', () => {
  const up = series([...noise(120), ...Array(25).fill(0.012)]);
  assert.equal(classifyAt(computeFeatures(up), up.length - 1).state, 'overheat');
  const down = series([...noise(120), ...Array(20).fill(-0.015)]);
  assert.equal(classifyAt(computeFeatures(down), down.length - 1).state, 'crash');
  const flat = series(noise(150, 3, 0, 0.004));
  assert.ok(['range', 'uptrend', 'downtrend'].includes(classifyAt(computeFeatures(flat), 149).state));
  const short = currentSituation(series(noise(30)));
  assert.equal(short.available, false);
});

test('시장 국면과 종목군 구분', () => {
  const idx = series(Array(260).fill(0.002)), G = computeFeatures(idx);
  assert.equal(regimeAt(G, 259), 'up');
  assert.equal(regimeAt(G, 100), null);
  assert.equal(groupOf({ symbol: '005930.KS', currency: 'KRW' }), 'KR_STOCK');
  assert.equal(groupOf({ symbol: '069500.KS', currency: 'KRW' }), 'ETF');
  assert.equal(groupOf({ symbol: 'NVDA', currency: 'USD' }), 'US_STOCK');
  assert.equal(groupOf({ symbol: 'QQQ', currency: 'USD', instrumentType: 'ETF' }), 'ETF');
});

test('그냥 보유 모의 결과는 가격 비율에서 첫 매수 비용만 뺀 값', () => {
  const c = series(noise(120, 11, 0.001)), F = computeFeatures(c), sim = simulate(F, strategyById('hold'), 60, 119, { capital: 1000, cost: 0.002 });
  const expected = 1000 / (1 + 0.002) * (c[119].close / c[60].close);
  assert.ok(Math.abs(sim.equity.at(-1).value - expected) < 1e-6);
  assert.equal(sim.trades.length, 1);
});

test('과열 때 절반 이익 실현: 과열에 50%, 20일선까지 식으면 100%', () => {
  const c = series([...noise(100, 5), ...Array(15).fill(0.02), ...Array(25).fill(-0.01)]), F = computeFeatures(c);
  const sim = simulate(F, strategyById('trim_rebuy'), 90, c.length - 1);
  const weights = sim.trades.map(t => t.weight);
  assert.deepEqual(weights.slice(0, 3), [100, 50, 100]);
  assert.ok(sim.trades[1].date > F.dates[90]);
});

test('결정은 다음 거래일 시가에 체결된다(미래 자료 없음)', () => {
  const c = series([...noise(100, 9), ...Array(20).fill(-0.02), ...Array(30).fill(0.01)]), F = computeFeatures(c);
  const sim = simulate(F, strategyById('mean_revert'), 80, c.length - 1);
  for (const t of sim.trades) { const i = F.dates.indexOf(t.date); assert.ok(Math.abs(t.price - F.open[i]) < 0.01 || t.date === F.dates[80]); }
});

test('상황별 방식 테스트는 기존 전략 테스트와 같은 모양으로 돌려준다', () => {
  const c = series(noise(400, 13, 0.0008, 0.015)), idx = series(noise(400, 17, 0.0005, 0.01));
  for (const s of SITUATION_STRATEGIES.filter(x => x.id !== 'hold')) {
    const t = runSituationTest(c, idx, s.id, c[200].date);
    assert.equal(typeof t.verdict, 'string');
    assert.ok(Math.abs(t.edge - (t.result.summary.totalReturn - t.hold.return)) < 0.02);
    assert.ok(t.result.summary.maxDrawdown <= 0);
    assert.equal(t.curve.length, c.length - 200);
  }
  assert.throws(() => runSituationTest(c, idx, 'nope', c[200].date));
});

test('국면별 성과를 곱하면 전체 성과와 같다', () => {
  const c = series(noise(500, 21, 0.0006, 0.012)), idx = series(noise(500, 23, 0.0004, 0.01));
  const t = runSituationTest(c, idx, 'trend_trail', c[260].date), b = regimeBreakdown(t.curve, idx);
  const prod = b.rows.reduce((a, r) => a * (1 + r.strategy / 100), 1), total = t.curve.at(-1).strategy / t.curve[0].strategy;
  assert.ok(Math.abs(prod - total) < 0.01);
});

test('선택 규칙: 표본이 충분하고 하한이 0보다 클 때만 고른다', () => {
  const mk = (n, edge, g = 'KR_STOCK', st = 'overheat', date = '2023-01-01') => Array.from({ length: n }, (_, k) => ({ group: g, state: st, date, end: '2023-04-01', edges: { a: edge + (k % 2 ? 0.001 : -0.001), b: -0.01 }, risk: { a: 0, b: 0 } }));
  assert.equal(selectRule(mk(30, 0.02)).rule.KR_STOCK.overheat, 'a');
  assert.equal(selectRule(mk(10, 0.02)).rule.KR_STOCK.overheat, 'hold');
  assert.equal(selectRule(mk(30, -0.02)).rule.KR_STOCK.overheat, 'hold');
  const wf = walkForward([...mk(30, 0.02), ...mk(5, 0.03, 'KR_STOCK', 'overheat', '2024-06-01').map(x => ({ ...x, end: '2024-09-01' }))], '2024-01-01');
  assert.equal(wf.trainN, 30); assert.equal(wf.testN, 5); assert.equal(wf.groups.KR_STOCK.active, 5);
  assert.deepEqual(stat([]), { n: 0 });
});

test('표본 수집과 통계 파일 모양', () => {
  const idx = series(noise(500, 31, 0.0004, 0.01)), list = [{ symbol: '005930.KS', group: 'KR_STOCK', candles: series(noise(500, 33, 0.0006, 0.02)) }];
  const collected = collectSamples(list, { '^KS11': idx, '^GSPC': idx });
  assert.ok(collected.samples.length > 5);
  for (const s of collected.samples) assert.ok(STATE_ORDER.includes(s.state) && Object.keys(s.edges).length === SITUATION_STRATEGIES.length - 1);
  const stats = buildStats(collected);
  assert.equal(stats.version, SITUATION_VERSION);
  assert.ok(stats.states.KR_STOCK && stats.rule.KR_STOCK);
});

test('배포된 상황 통계 파일은 지금 정의와 같은 계산에서 나왔다', () => {
  const file = JSON.parse(readFileSync(new URL('../data/situation-stats.json', import.meta.url), 'utf8'));
  assert.equal(file.version, SITUATION_VERSION, '정의를 바꿨다면 node scripts/build-situation-stats.mjs로 다시 만드십시오.');
  assert.deepEqual(file.strategies.map(s => s.id), SITUATION_STRATEGIES.map(s => s.id));
  assert.deepEqual(Object.keys(file.universe), Object.keys(UNIVERSE));
  for (const g of Object.keys(file.groups)) assert.ok(file.baseline[g] && file.states[g] && file.edges[g] && file.risk[g]);
});
