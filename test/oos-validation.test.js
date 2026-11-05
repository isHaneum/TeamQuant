import test from "node:test";
import assert from "node:assert/strict";
import { planSplit, runSplitValidation, recordTrial, assessIndependence, parameterChanges } from "../lib/oos-validation.js";

function candles(count, startDay = 0, wave = (i) => 100 + Math.sin(i / 3) * 12 + i * 0.1) {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, k) => {
    const i = k + startDay, close = wave(i);
    return { date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1000 };
  });
}
const ma = { fastPeriod: 3, slowPeriod: 8, feeRate: 0, slippageRate: 0, initialCapital: 1_000_000 };

test("조정 구간과 평가 구간은 겹치지 않고 전체 거래일을 나눈다", () => {
  const data = candles(100), split = planSplit(data, { tuningRatio: 0.7 });
  assert.ok(split.tuning.end < split.test.start);
  assert.equal(split.tuning.days + split.test.days, 100);
  assert.equal(split.test.start, data[70].date);
});

test("조정 구간 결과는 평가 구간 가격이 바뀌어도 같다", () => {
  const base = candles(120), altered = base.map((c, i) => i >= 84 ? { ...c, open: c.open * 3, close: c.close * 3 } : c);
  const a = runSplitValidation(base, ma, { tuningRatio: 0.7 }), b = runSplitValidation(altered, ma, { tuningRatio: 0.7 });
  assert.deepEqual(a.tuning.summary, b.tuning.summary);
  assert.notDeepEqual(a.test.summary, b.test.summary);
});

test("평가 구간은 시작일부터 성과를 계산하고 이전 가격은 지표 준비에만 쓴다", () => {
  const data = candles(120), result = runSplitValidation(data, ma, { tuningRatio: 0.7 });
  assert.equal(result.test.decisions[0].date, result.split.test.start);
  assert.notEqual(result.test.decisions[0].decision, "계산 준비");
  assert.equal(result.test.equity[0].value, ma.initialCapital);
});

test("평가 구간이 너무 짧거나 날짜가 뒤섞이면 실행하지 않는다", () => {
  assert.throws(() => planSplit(candles(40), { tuningRatio: 0.7 }), /평가 구간은 20거래일/);
  const data = candles(100); [data[10], data[11]] = [data[11], data[10]];
  assert.throws(() => planSplit(data), /오름차순/);
});

test("첫 시도와 같은 조건 재실행은 독립, 결과를 본 뒤 규칙을 바꾸면 독립 표시를 해제한다", () => {
  const data = candles(120), original = [];
  const first = recordTrial(original, runSplitValidation(data, ma), { symbol: "005930", recordedAt: "2026-11-05T00:00:00Z" });
  assert.equal(first.entry.independent, true);
  assert.equal(original.length, 0, "기존 원장을 변경하지 않음");
  assert.ok(Object.isFrozen(first.entry));

  const again = recordTrial(first.ledger, runSplitValidation(data, ma), { symbol: "005930" });
  assert.equal(again.entry.independent, true);
  assert.equal(again.entry.reproduction, true);

  const tuned = recordTrial(again.ledger, runSplitValidation(data, { ...ma, slowPeriod: 10 }), { symbol: "005930" });
  assert.equal(tuned.entry.independent, false);
  assert.match(tuned.entry.reasons[0], /다른 전략 버전 1개/);
  assert.deepEqual(tuned.entry.changesFromPrevious, [{ key: "slowPeriod", before: 8, after: 10 }]);
  assert.equal(tuned.entry.trialNumber, 3);

  const otherSymbol = recordTrial(tuned.ledger, runSplitValidation(data, { ...ma, slowPeriod: 10 }), { symbol: "000660" });
  assert.equal(otherSymbol.entry.independent, true);
});

test("이전에 조정에 쓴 기간을 평가 구간으로 쓰면 독립이 아니고, 이후 새 기간은 독립이다", () => {
  const ledger = recordTrial([], runSplitValidation(candles(120), ma), { symbol: "X" }).ledger;
  const earlier = runSplitValidation(candles(120), { ...ma, slowPeriod: 9 }, { tuningRatio: 0.3 });
  assert.equal(assessIndependence(ledger, { symbol: "X", strategyId: earlier.strategy.id, tuning: earlier.split.tuning, test: earlier.split.test }).independent, false);
  const later = runSplitValidation(candles(120, 100), { ...ma, slowPeriod: 9 }, { tuningRatio: 0.5 });
  const verdict = assessIndependence(ledger, { symbol: "X", strategyId: later.strategy.id, tuning: later.split.tuning, test: later.split.test });
  assert.equal(verdict.independent, true, verdict.reasons.join(" "));
});

test("전략 변경 이력은 바뀐 항목만 보여준다", () => {
  assert.deepEqual(parameterChanges({ type: "breakout", parameters: { entryLookback: 20, exitLookback: 10 }, stopLossPct: 7, takeProfitPct: 0, positionPct: 25 },
    { type: "breakout", parameters: { entryLookback: 30, exitLookback: 10 }, stopLossPct: 5, takeProfitPct: 0, positionPct: 25 }),
  [{ key: "entryLookback", before: 20, after: 30 }, { key: "stopLossPct", before: 7, after: 5 }]);
});
