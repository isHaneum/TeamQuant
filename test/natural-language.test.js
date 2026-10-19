import test from "node:test";
import assert from "node:assert/strict";
import { parseNaturalStrategy } from "../lib/natural-language.js";

test("이동평균과 RSI 필터, 손절, 비중을 자연어에서 추출한다", () => {
  const parsed = parseNaturalStrategy("20일 이동평균이 60일 이동평균을 상향 돌파하고 RSI 14가 70 미만일 때 매수. 손절 8%, 종목당 비중 20%.");
  assert.equal(parsed.config.strategyType, "ma_cross");
  assert.equal(parsed.config.fastPeriod, 20);
  assert.equal(parsed.config.slowPeriod, 60);
  assert.equal(parsed.config.rsiFilterMax, 70);
  assert.equal(parsed.config.stopLossPct, 8);
  assert.equal(parsed.config.positionPct, 20);
});

test("가격 돌파 기간을 자연어에서 추출한다", () => {
  const parsed = parseNaturalStrategy("20일 최고가를 돌파하면 매수하고 10일 최저가를 깨면 매도. 손절 7%.");
  assert.equal(parsed.config.strategyType, "breakout");
  assert.equal(parsed.config.entryLookback, 20);
  assert.equal(parsed.config.exitLookback, 10);
});
