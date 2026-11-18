// 비교선(순수 함수): 계획 → 국가 비중·현금 정의 · 가치 지수(환율 환산·빈 날 끌어오기·from 에 1.0) · 절차 vs 비교선 비교 · 평가점 2개 미만이면 null · 읽기(캐시·갱신 실패 시 마지막 값·범위). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkDefinition, benchmarkSeries, compare, createBenchmarkReader, closeAvailableAt, BENCHMARK_LABEL, BENCHMARK_LEGS, BENCHMARK_HOLD_REASON, BENCHMARK_STALE_NOTE } from '../lib/paper-benchmark.js';

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
  // KODEX 봉 없음 → 1.1 유지 · BM3: SPY 11-10 종가(550)는 한국 11-11 아침에야 나오므로 한국 11-10 에는 11-09 종가(500) — 예전 기대값(550)은 그 시각에 없던 값이었다
  near(s[4].value, 0.5 + 0.2 * 1.1 + 0.3 * (500 * 1470) / (500 * 1400));
  near(benchmarkSeries({ from: '2026-11-06', to: '2026-11-11', weights: { KR: 20, US: 30, cash: 50 }, krCandles: kr, usCandles: us, fxCandles: fx }).at(-1).value, 0.5 + 0.2 * 1.1 + 0.3 * (550 * 1470) / (500 * 1400)); // 한국 11-11 에는 11-10 종가
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

test('BM2: 미국분 환율은 계좌 평가점 환율(marks.fx) — 일봉 종가와 섞지 않고, 첫 평가점이 from 보다 늦으면 일봉 종가 · 계좌가 환율만큼 오른 것은 비교선도 같이 오른다', async () => {
  const us = cs([['2026-11-09', 100], ['2026-11-10', 100]]), fx = cs([['2026-11-09', 1400], ['2026-11-10', 1400]]), w = { KR: 0, US: 100, cash: 0 };
  const s = benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, usCandles: us, fxCandles: fx, fxMarks: [{ date: '2026-11-09', fx: 1300 }, { date: '2026-11-10', fx: 1326 }] });
  assert.ok(Math.abs(s.at(-1).value - 1.02) < 1e-9, '평가점 환율 1300→1326 = +2%');
  assert.equal(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, usCandles: us, fxCandles: fx, fxMarks: [{ date: '2026-11-10', fx: 1326 }] }).at(-1).value, 1, '첫 평가점이 from 뒤면 일봉 종가(1400→1400)');
  assert.ok(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, usCandles: us, fxCandles: [], fxMarks: [{ date: '2026-11-09', fx: 1300 }] }), '평가점 환율이 있으면 환율 봉이 없어도 계산');
  const def = benchmarkDefinition({ SPY: { pct: 100, currency: 'USD' } }); assert.equal(def.version, 'BM4-2026-11-18');
  const r = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : fx }) })(def, [{ date: '2026-11-09', total: 100, fx: 1300 }, { date: '2026-11-10', total: 102, fx: 1326 }]);
  assert.deepEqual([r.benchRetPct, r.diffPp], [2, 0]);
});

test('BM3: 평가 시각에 끝난 장의 종가만 쓴다 — 지수만 든 계좌는 차이 0%p (교차 검증 F15 회귀) · 국내 16:00 KST · 미국 뉴욕 17:00(서머타임)', async () => {
  // SPY 만 든 계좌: 11-09(월) 23:50 KST 평가점의 미국 종가는 11-06(금) 600 이 마지막(11-09 종가 612 는 한국 11-10 07:00 에 나옴). 11-16 23:50 KST 는 11-13 종가 612.
  // 시가가 없는 봉으로 시험한다 — 시가가 있으면 장중 평가점은 그날 시가를 쓴다(아래 'BM4 보완' 시험)
  const us = cs([['2026-11-06', 600], ['2026-11-09', 612], ['2026-11-10', 612], ['2026-11-13', 612], ['2026-11-16', 630]]).map(({ open, ...c }) => c), def = benchmarkDefinition({ SPY: { pct: 100, currency: 'USD' } });
  const marks = [{ date: '2026-11-09', total: 100, fx: 1300, at: '2026-11-09T14:50:00Z' }, { date: '2026-11-16', total: 102, fx: 1300, at: '2026-11-16T14:50:00Z' }];
  const r = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : [] }) })(def, marks);
  assert.deepEqual([r.ownRetPct, r.benchRetPct, r.diffPp], [2, 2, 0], 'BM2 는 시작값으로 612(미래 값)를 써 비교선 +2.94% · 계좌 −0.94%p 로 나왔다');
  // 시각이 없는 평가점은 그 한국 날짜 끝(23:59:59)으로 본다 → 같은 결과
  const r2 = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : [] }) })(def, marks.map(({ at, ...m }) => m));
  assert.equal(r2.diffPp, 0);
  // 국내: 16:00 KST 전 평가점은 전날 종가, 뒤면 그날 종가
  const kr = cs([['2026-11-06', 100], ['2026-11-09', 110], ['2026-11-10', 121]]).map(({ open, ...c }) => c), w = { KR: 100, US: 0, cash: 0 };
  near(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, krCandles: kr, markAt: { '2026-11-09': '2026-11-09T01:00:00Z', '2026-11-10': '2026-11-10T09:00:00Z' } }).at(-1).value, 121 / 100); // 시작 10:00 KST → 11-06 종가
  near(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, krCandles: kr, markAt: { '2026-11-09': '2026-11-09T08:00:00Z', '2026-11-10': '2026-11-10T09:00:00Z' } }).at(-1).value, 121 / 110); // 시작 17:00 KST → 11-09 종가
  // 미국 종가가 쓰이는 시각: 겨울 = 뉴욕 17:00 EST = 22:00Z, 여름 = 17:00 EDT = 21:00Z
  assert.equal(new Date(closeAvailableAt('2026-11-16', 'US')).toISOString(), '2026-11-16T22:00:00.000Z');
  assert.equal(new Date(closeAvailableAt('2026-07-01', 'US')).toISOString(), '2026-07-01T21:00:00.000Z');
  assert.equal(new Date(closeAvailableAt('2026-11-16', 'KR')).toISOString(), '2026-11-16T07:00:00.000Z');
  // BM4: 평가점에 지수 가격이 있으면 그 날짜는 그 값(장중 평가점의 지금 가격), 없는 날짜는 BM3 그대로
  near(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, krCandles: kr, markAt: { '2026-11-09': '2026-11-09T08:00:00Z', '2026-11-10': '2026-11-10T02:00:00Z' }, idxMarks: [{ date: '2026-11-10', KR: 115 }] }).at(-1).value, 115 / 110); // 11:00 KST 평가점: BM3 라면 11-09 종가 110 → 0% 였다
  near(benchmarkSeries({ from: '2026-11-09', to: '2026-11-10', weights: w, krCandles: kr, markAt: { '2026-11-09': '2026-11-09T08:00:00Z', '2026-11-10': '2026-11-10T02:00:00Z' } }).at(-1).value, 1);
});

test('BM4 보완: 지수 가격이 없는 장중 평가점은 그날 시가 — 시작 평가점이 09:38 ET 라면 11-06 종가가 아니라 11-09 시가(재검증 2026-11-18)', async () => {
  const us = [{ date: '2026-11-06', open: 598, close: 600 }, { date: '2026-11-09', open: 606, close: 612 }, { date: '2026-11-16', open: 624, close: 630 }], def = benchmarkDefinition({ SPY: { pct: 100, currency: 'USD' } });
  const marks = [{ date: '2026-11-09', total: 100, fx: 1300, at: '2026-11-09T14:38:00Z' }, { date: '2026-11-16', total: 103, fx: 1300, at: '2026-11-16T14:50:00Z' }];
  const r = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : [] }) })(def, marks);
  assert.deepEqual([r.benchRetPct, r.diffPp], [2.97, 0.03], '606 → 624 (BM3 는 600 → 612 = +2% 로 개장 갭을 비교선에 더 줌)');
  // 장이 닫힌 시각(23:00 ET 일요일)이면 끝난 장의 종가 그대로 · 시가가 없는 봉이면 종가 규칙으로
  const r2 = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : [] }) })(def, marks.map(m => ({ ...m, at: m.date + 'T04:00:00Z' })));
  assert.equal(r2.benchRetPct, 2, '11-09 04:00Z = 11-08(일) 23:00 ET → 11-06 종가 · 11-16 04:00Z = 11-15(일) 23:00 ET → 11-09 종가 612');
  const r3 = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us.map(({ open, ...c }) => c) : [] }) })(def, marks);
  assert.equal(r3.benchRetPct, 2);
});

test('BM4 reader: 평가점 idx(KR·US 다리)를 비교선에 쓰고 method 는 BM4', async () => {
  const us = cs([['2026-11-06', 600], ['2026-11-09', 612], ['2026-11-16', 624]]), def = benchmarkDefinition({ SPY: { pct: 100, currency: 'USD' } });
  const marks = [{ date: '2026-11-09', total: 100, fx: 1300, at: '2026-11-09T14:50:00Z', idx: { US: { date: '2026-11-09', close: 606 } } }, { date: '2026-11-16', total: 103, fx: 1300, at: '2026-11-16T14:50:00Z', idx: { US: { date: '2026-11-16', close: 618 } } }];
  const r = await createBenchmarkReader({ readMarket: async sym => ({ candles: sym === 'SPY' ? us : [] }) })(def, marks);
  assert.equal(r.method, 'BM4-2026-11-18'); assert.deepEqual([r.ownRetPct, r.benchRetPct, r.diffPp], [3, 1.98, 1.02], '606 → 618 = +1.98% (BM3 는 600 → 612 = +2%)');
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
