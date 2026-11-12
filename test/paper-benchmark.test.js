// 비교선(순수 함수): 계획 → 국가 비중·현금 정의 · 가치 지수(환율 환산·빈 날 끌어오기·from 에 1.0) · 절차 vs 비교선 비교 · 평가점 2개 미만이면 null · 읽기(캐시·갱신 실패 시 마지막 값·범위). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkDefinition, benchmarkSeries, compare, createBenchmarkReader, BENCHMARK_LABEL, BENCHMARK_LEGS, BENCHMARK_HOLD_REASON, BENCHMARK_STALE_NOTE } from '../lib/paper-benchmark.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const cs = pairs => pairs.map(([date, close]) => ({ date, open: close, close }));

test('정의: 계획의 국내·미국 비중 합과 현금(100 − 둘) · 통화가 있으면 통화, 없으면 6자리 코드로 국내 판정 · 다리는 KODEX 200 / S&P500 ETF', () => {
  const d = benchmarkDefinition({ '005930': { pct: 20, name: '삼성전자', currency: 'KRW' }, NVDA: { pct: 20, currency: 'USD' }, SPY: 10, '069500.KS': { pct: 5.5 }, BAD: { pct: 0 } });
  assert.equal(d.label, BENCHMARK_LABEL); assert.deepEqual(d.weights, { KR: 25.5, US: 30, cash: 44.5 });
  assert.deepEqual(d.legs, BENCHMARK_LEGS); assert.equal(d.legs.US.currency, 'USD'); assert.equal(d.legs.KR.symbol, '069500');
  assert.deepEqual(benchmarkDefinition({}).weights, { KR: 0, US: 0, cash: 100 }); assert.deepEqual(benchmarkDefinition(null).weights, { KR: 0, US: 0, cash: 100 });
  assert.deepEqual(benchmarkDefinition({ A: 70, B: 50 }).weights, { KR: 0, US: 120, cash: 0 }, '현금은 음수가 되지 않는다');
});

test('가치 지수: from 에 1.0 · 국내분은 KODEX 종가 비율 · 미국분은 SPY×환율 비율 · 현금분 1.0 · 봉이 없는 날은 마지막 값을 끌어온다', () => {
  // 11-06(금) 시작. 11-07·08 주말(봉 없음) → 끌어오기. 11-09 KODEX +10%, SPY 그대로·환율 +5%. 11-10 KODEX 봉 없음(끌어오기), SPY +10%.
  const kr = cs([['2026-11-05', 95], ['2026-11-06', 100], ['2026-11-09', 110]]);
  const us = cs([['2026-11-06', 500], ['2026-11-09', 500], ['2026-11-10', 550]]);
  const fx = cs([['2026-11-06', 1400], ['2026-11-09', 1470], ['2026-11-10', 1470]]);
  const s = benchmarkSeries({ from: '2026-11-06', to: '2026-11-10', weights: { KR: 20, US: 30, cash: 50 }, krCandles: kr, usCandles: us, fxCandles: fx });
  assert.deepEqual(s.map(p => p.date), ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  near(s[0].value, 1); near(s[1].value, 1, 1e-9); near(s[2].value, 1);
  near(s[3].value, 0.5 + 0.2 * 1.1 + 0.3 * 1.05);               // 환율 환산: 500×1470 / (500×1400) = 1.05
  near(s[4].value, 0.5 + 0.2 * 1.1 + 0.3 * (550 * 1470) / (500 * 1400)); // KODEX 봉 없음 → 1.1 유지
  // 시작값은 from 이하 마지막 종가(11-06 100, 11-05 95 아님) · from 이전 봉이 없으면 첫 봉
  near(benchmarkSeries({ from: '2026-11-08', to: '2026-11-09', weights: { KR: 100, US: 0, cash: 0 }, krCandles: kr })[1].value, 1.1);
  near(benchmarkSeries({ from: '2026-11-01', to: '2026-11-09', weights: { KR: 100, US: 0, cash: 0 }, krCandles: kr }).at(-1).value, 110 / 95);
  // 현금만이면 늘 1.0 · 봉 순서가 뒤섞여 와도 정렬해서 쓴다 · 0 이하 종가는 버린다
  assert.ok(benchmarkSeries({ from: '2026-11-06', to: '2026-11-08', weights: { KR: 0, US: 0, cash: 100 } }).every(p => p.value === 1));
  near(benchmarkSeries({ from: '2026-11-06', to: '2026-11-09', weights: { KR: 100, US: 0, cash: 0 }, krCandles: [...kr].reverse().concat([{ date: '2026-11-09', close: 0 }]) }).at(-1).value, 1.1);
});

test('가치 지수 보류(null): 비중이 있는 다리의 봉이 없거나, 미국분이 있는데 환율이 없거나, 기간이 거꾸로거나, 봉이 from 보다 7일 넘게 뒤에서 시작하면(읽은 범위가 구간보다 짧음) null', () => {
  const kr = cs([['2026-11-06', 100]]), us = cs([['2026-11-06', 500]]), fx = cs([['2026-11-06', 1400]]);
  assert.equal(benchmarkSeries({ from: '2026-11-06', to: '2026-11-07', weights: { KR: 20, US: 30, cash: 50 }, krCandles: [], usCandles: us, fxCandles: fx }), null);
  assert.equal(benchmarkSeries({ from: '2026-11-06', to: '2026-11-07', weights: { KR: 20, US: 30, cash: 50 }, krCandles: kr, usCandles: us, fxCandles: [] }), null, '환율 없음');
  assert.equal(benchmarkSeries({ from: '2026-11-06', to: '2026-11-07', weights: { KR: 20, US: 30, cash: 50 }, krCandles: kr, usCandles: null, fxCandles: fx }), null);
  assert.equal(benchmarkSeries({ from: '2026-11-08', to: '2026-11-06', weights: { KR: 100 }, krCandles: kr }), null);
  // 미국분이 0 이면 환율이 없어도 된다
  assert.equal(benchmarkSeries({ from: '2026-11-06', to: '2026-11-07', weights: { KR: 50, US: 0, cash: 50 }, krCandles: kr }).length, 2);
  // 첫 봉이 from 보다 한참 뒤(1y 범위 밖의 오래된 첫 평가점): 첫 종가를 기준으로 삼으면 틀린 수익률이 나오므로 보류. 7일 안(주말·휴장 시작)은 허용
  const late = cs([['2026-06-01', 200], ['2026-06-02', 220]]);
  assert.equal(benchmarkSeries({ from: '2025-11-01', to: '2026-06-02', weights: { KR: 100, US: 0, cash: 0 }, krCandles: late }), null);
  assert.equal(benchmarkSeries({ from: '2026-05-30', to: '2026-06-02', weights: { KR: 100, US: 0, cash: 0 }, krCandles: late }).at(-1).value, 1.1);
  assert.equal(benchmarkSeries({ from: '2025-11-01', to: '2026-06-02', weights: { KR: 0, US: 100, cash: 0 }, usCandles: late, fxCandles: cs([['2025-10-01', 1400], ['2026-06-02', 1400]]) }), null, '미국 다리도 같다');
  assert.equal(benchmarkSeries({ from: '2025-11-01', to: '2026-06-02', weights: { KR: 0, US: 100, cash: 0 }, usCandles: cs([['2025-10-01', 500], ['2026-06-02', 500]]), fxCandles: late }), null, '환율도 같다');
});

test('읽기(createBenchmarkReader): 성공만 30분 캐시 · TTL 뒤 갱신에 실패하면 마지막 읽은 선으로 비교하고 STALE 메모 · 전에 읽은 것이 없으면 HOLD 와 null · 구간이 길면 2y/5y 범위', async () => {
  let t = Date.parse('2026-11-12T00:00:00Z'), fail = false; const calls = [];
  const kr = cs([['2026-11-09', 100], ['2026-11-10', 102], ['2026-11-11', 102]]);
  const read = async (sym, range) => { calls.push([sym, range]); if (fail) throw new Error('offline'); return { candles: kr }; };
  const def = benchmarkDefinition({ '005930': { pct: 50, currency: 'KRW' } }), marks = [{ date: '2026-11-09', total: 100 }, { date: '2026-11-10', total: 100 }];
  const bf = createBenchmarkReader({ readMarket: read, now: () => t });
  const r1 = await bf(def, marks); assert.deepEqual([r1.benchRetPct, r1.diffPp, r1.error], [1, -1, null]); assert.deepEqual(calls.at(-1), ['069500', '1y']);
  t += 10 * 60e3; await bf(def, marks); assert.equal(calls.length, 1, '캐시');
  // TTL 뒤 갱신 실패: 숫자는 마지막 읽은 선으로(날이 바뀐 평가점은 끌어오기), error 는 STALE 메모 · 다음 호출은 다시 읽어 성공하면 error 없음
  t += 31 * 60e3; fail = true; const r2 = await bf(def, [...marks, { date: '2026-11-11', total: 103 }]); assert.deepEqual([r2.benchRetPct, r2.ownRetPct, r2.diffPp, r2.error, r2.days], [1, 3, 2, BENCHMARK_STALE_NOTE, 3]);
  fail = false; const r3 = await bf(def, [...marks, { date: '2026-11-11', total: 103 }]); assert.equal(r3.error, null); assert.equal(calls.length, 3);
  // 전에 읽은 것이 없는 새 읽기: HOLD 와 null
  fail = true; const r4 = await createBenchmarkReader({ readMarket: read, now: () => t })(def, marks); assert.deepEqual([r4.benchRetPct, r4.diffPp, r4.error], [null, null, BENCHMARK_HOLD_REASON]);
  // 다른 구간 시작(기준선이 다른 장부)으로 바뀌면 옛 선을 쓰지 않는다
  const r5 = await bf(def, [{ date: '2026-11-10', total: 100 }, { date: '2026-11-11', total: 100 }]); assert.equal(r5.error, BENCHMARK_HOLD_REASON);
  fail = false; await bf(def, [{ date: '2025-06-01', total: 1 }, { date: '2026-11-11', total: 1 }]); assert.equal(calls.at(-1)[1], '2y'); await bf(def, [{ date: '2021-06-01', total: 1 }, { date: '2026-11-11', total: 1 }]); assert.equal(calls.at(-1)[1], '5y');
  assert.equal(await bf(null, marks), null);
});

test('비교: 시작 = 첫 평가점 총자산, 지금 = 마지막 평가점 · 비교선은 그 날짜 이하 마지막 점 · diffPp = 절차 − 비교선 · 평가점 2개 미만·비교선 없음은 null', () => {
  const series = [{ date: '2026-11-06', value: 1 }, { date: '2026-11-07', value: 1 }, { date: '2026-11-08', value: 1 }, { date: '2026-11-09', value: 1.05 }, { date: '2026-11-10', value: 1.02 }];
  const marks = [{ date: '2026-11-06', total: 100_000_000 }, { date: '2026-11-09', total: 103_000_000 }, { date: '2026-11-10', total: 110_000_000 }];
  const r = compare({ marks, series });
  assert.deepEqual(r, { ownRetPct: 10, benchRetPct: 2, diffPp: 8, days: 3, from: '2026-11-06', asOf: '2026-11-10', basis: 'total' });
  // 마지막 평가점이 주말이면 비교선은 금요일 값(이하 마지막 점)
  const r2 = compare({ marks: [marks[0], { date: '2026-11-12', total: 101_000_000 }], series }); assert.equal(r2.benchRetPct, 2); assert.equal(r2.diffPp, -1);
  // 0.01 단위로 반올림
  assert.equal(compare({ marks: [marks[0], { date: '2026-11-10', total: 101_234_567 }], series }).ownRetPct, 1.23);
  const nul = { ownRetPct: null, benchRetPct: null, diffPp: null };
  assert.deepEqual(compare({ marks: [marks[0]], series }), { ...nul, days: 1, from: '2026-11-06', asOf: '2026-11-06' });
  assert.deepEqual(compare({ marks, series: null }), { ...nul, days: 3, from: '2026-11-06', asOf: '2026-11-10' });
  assert.deepEqual(compare({ marks, series: [] }), { ...nul, days: 3, from: '2026-11-06', asOf: '2026-11-10' });
  assert.deepEqual(compare({ marks: [], series }), { ...nul, days: 0, from: null, asOf: null });
  // 시작 평가점이 비교선 시작보다 앞이면(점이 없음) null
  assert.equal(compare({ marks: [{ date: '2026-11-01', total: 1 }, { date: '2026-11-10', total: 2 }], series }).diffPp, null);
  // total 이 없는 평가점(보류)은 세지 않는다
  assert.equal(compare({ marks: [marks[0], { date: '2026-11-07', total: null }], series }).diffPp, null);
});
