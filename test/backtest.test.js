import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest } from "../lib/backtest.js";

function candles(values) {
  const start = Date.UTC(2025, 0, 1);
  return values.map((close, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000
  }));
}

test("상승 교차 신호는 다음 거래일 시가에 체결한다", () => {
  const data = candles([10,10,10,10,9,8,9,12,13,14,15,16,17,18,19]);
  const result = runBacktest(data, { initialCapital: 1000, fastPeriod: 2, slowPeriod: 4, feeRate: 0, slippageRate: 0 });
  const buy = result.trades.find((trade) => trade.side === "매수");
  assert.ok(buy);
  assert.notEqual(buy.signalDate, buy.date);
  const signalIndex = data.findIndex((row) => row.date === buy.signalDate);
  assert.equal(buy.date, data[signalIndex + 1].date);
});

test("비용이 있으면 최종 자산이 비용 없는 결과보다 작다", () => {
  const data = candles([10,10,9,8,7,9,12,15,16,17,18,17,15,13,11,10,12,15,18,20]);
  const free = runBacktest(data, { initialCapital: 10000, fastPeriod: 2, slowPeriod: 4, feeRate: 0, slippageRate: 0 });
  const costly = runBacktest(data, { initialCapital: 10000, fastPeriod: 2, slowPeriod: 4, feeRate: .001, slippageRate: .001 });
  assert.ok(costly.summary.finalValue < free.summary.finalValue);
});

test("단기 기간이 장기 기간보다 길면 실행을 막는다", () => {
  assert.throws(() => runBacktest(candles(Array(20).fill(10)), { fastPeriod: 10, slowPeriod: 5 }), /단기 이동평균/);
});

test("같은 전략 설정은 같은 전략 버전 ID를 만든다", () => {
  const data = candles(Array.from({ length: 40 }, (_, index) => 100 + Math.sin(index / 2) * 10));
  const options = { strategyType: "rsi_reversal", rsiPeriod: 5, rsiBuy: 35, rsiSell: 65, stopLossPct: 8 };
  const first = runBacktest(data, options);
  const second = runBacktest(data, options);
  assert.equal(first.strategy.id, second.strategy.id);
  assert.equal(first.decisions.length, data.length);
  assert.ok(first.decisions.every((decision) => decision.reason));
});

test("돌파 전략은 지표값과 판단 근거를 기록한다", () => {
  const data = candles([10,10,10,10,11,12,13,12,11,10,9,8,9,10,12,14,13,12,11,10]);
  const result = runBacktest(data, { strategyType: "breakout", entryLookback: 3, exitLookback: 2 });
  assert.ok(result.signals.length > 0);
  assert.ok(result.decisions.some((decision) => decision.indicators.entryHigh !== undefined));
  assert.ok(result.trades.every((trade) => trade.reason));
});
