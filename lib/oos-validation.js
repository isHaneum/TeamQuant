// CAP-04 표본 외 검증: 조정 구간과 평가 구간 분리, 시도 원장, 평가 구간 재사용 판정.
// 순수 계산 모듈. 저장은 호출자가 담당하며 실제 계좌 성과와 섞지 않는다.
// 원장은 잘라내지 않는다. 오래된 기록을 지우면 평가 구간 재사용을 놓쳐 독립 검증으로 잘못 표시할 수 있다.
import { createStrategyDefinition, validateStrategy, runBacktest } from "./backtest.js";

export const MIN_TEST_DAYS = 20;

function assertCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 2) throw new Error("검증할 일봉 자료가 부족합니다.");
  for (let index = 1; index < candles.length; index += 1) {
    if (!(candles[index].date > candles[index - 1].date)) throw new Error("일봉 날짜가 오름차순이 아니거나 중복되어 구간을 나눌 수 없습니다.");
  }
}

// 조정 구간: testStart 이전 / 평가 구간: testStart 이후. 두 구간은 겹치지 않는다.
export function planSplit(candles, { tuningRatio = 0.7, testStartDate = null, warmup = 0 } = {}) {
  assertCandles(candles);
  let splitIndex;
  if (testStartDate) {
    splitIndex = candles.findIndex((candle) => candle.date >= testStartDate);
    if (splitIndex < 0) throw new Error("평가 시작일 이후 자료가 없습니다.");
  } else {
    if (!(tuningRatio > 0 && tuningRatio < 1)) throw new Error("조정 구간 비율은 0과 1 사이여야 합니다.");
    splitIndex = Math.floor(candles.length * tuningRatio);
  }
  const tuningDays = splitIndex, testDays = candles.length - splitIndex;
  if (tuningDays < warmup + 2) throw new Error(`조정 구간이 너무 짧습니다. 지표 준비 ${warmup}거래일 이상이 더 필요합니다.`);
  if (testDays < MIN_TEST_DAYS) throw new Error(`평가 구간은 ${MIN_TEST_DAYS}거래일 이상이어야 합니다. 현재 ${testDays}거래일입니다.`);
  return {
    tuning: { start: candles[0].date, end: candles[splitIndex - 1].date, days: tuningDays },
    test: { start: candles[splitIndex].date, end: candles.at(-1).date, days: testDays }
  };
}

// 조정 구간 결과는 평가 구간 자료를 보지 않는다. 평가 구간은 이전 가격을 지표 준비에만 쓴다.
export function runSplitValidation(candles, options, splitOptions = {}) {
  const strategy = createStrategyDefinition(options);
  validateStrategy(strategy);
  const split = planSplit(candles, { ...splitOptions, warmup: strategy.warmup });
  const tuningCandles = candles.filter((candle) => candle.date <= split.tuning.end);
  const tuning = runBacktest(tuningCandles, options);
  const test = runBacktest(candles, { ...options, evaluationStartDate: split.test.start });
  return { strategy: test.strategy, settings: test.settings, split, tuning, test };
}

function overlaps(a, b) { return Boolean(a && b) && a.start <= b.end && b.start <= a.end; }

// 새 시도가 독립 표본 외 결과로 인정되는지 판정한다. 같은 종목 기준, 보수적으로 판단한다.
export function assessIndependence(ledger, candidate) {
  const prior = (ledger || []).filter((entry) => entry.symbol === candidate.symbol);
  const reasons = [];
  const otherVersionsOnTest = new Set();
  let reproducedFrom = null;
  for (const entry of prior) {
    if (overlaps(entry.test, candidate.test)) {
      if (entry.strategyId !== candidate.strategyId) otherVersionsOnTest.add(entry.strategyId);
      else if (entry.test.start === candidate.test.start && entry.test.end === candidate.test.end && entry.tuning.start === candidate.tuning.start) reproducedFrom = reproducedFrom || entry;
    }
    if (overlaps(entry.tuning, candidate.test)) reasons.push(`이전 시도(${entry.strategyId})가 조정에 쓴 기간 ${entry.tuning.start}~${entry.tuning.end}이 이번 평가 구간과 겹칩니다.`);
  }
  if (otherVersionsOnTest.size) reasons.unshift(`이 평가 구간 결과를 이미 다른 전략 버전 ${otherVersionsOnTest.size}개로 확인했습니다. 결과를 보고 규칙을 바꾼 경우 독립 검증이 아닙니다.`);
  if (reproducedFrom && reproducedFrom.independent === false) reasons.push("같은 조건을 다시 실행했지만 처음 기록도 독립 검증이 아니었습니다.");
  const uniqueReasons = [...new Set(reasons)];
  return {
    independent: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    reproduction: Boolean(reproducedFrom),
    priorTrialsOnSymbol: prior.length,
    versionsOnTestWindow: otherVersionsOnTest.size + 1
  };
}

export function parameterChanges(before, after) {
  if (!before || !after) return [];
  const flat = (snapshot) => ({ type: snapshot.type, ...snapshot.parameters, stopLossPct: snapshot.stopLossPct, takeProfitPct: snapshot.takeProfitPct, positionPct: snapshot.positionPct });
  const a = flat(before), b = flat(after), keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((key) => a[key] !== b[key]).map((key) => ({ key, before: a[key] ?? null, after: b[key] ?? null }));
}

// 기존 원장을 바꾸지 않고 새 기록을 덧붙인 원장을 반환한다.
export function recordTrial(ledger, validation, { symbol, recordedAt = new Date().toISOString() } = {}) {
  if (!symbol) throw new Error("종목 정보 없이 검증 기록을 남길 수 없습니다.");
  const list = Array.isArray(ledger) ? ledger : [];
  const candidate = { symbol, strategyId: validation.strategy.id, tuning: { start: validation.split.tuning.start, end: validation.split.tuning.end }, test: { start: validation.split.test.start, end: validation.split.test.end } };
  const verdict = assessIndependence(list, candidate);
  const previous = list.filter((entry) => entry.symbol === symbol).at(-1);
  const entry = Object.freeze({
    id: `${candidate.strategyId}:${symbol}:${candidate.test.start}:${candidate.test.end}:${list.length + 1}`,
    recordedAt,
    ...candidate,
    tuning: Object.freeze({ ...candidate.tuning, days: validation.split.tuning.days }),
    test: Object.freeze({ ...candidate.test, days: validation.split.test.days }),
    strategyName: validation.strategy.name,
    snapshot: validation.strategy.snapshot,
    settings: { ...validation.settings },
    tuningReturn: validation.tuning.summary.totalReturn,
    tuningTrades: validation.tuning.summary.tradeCount,
    testReturn: validation.test.summary.totalReturn,
    testBenchmark: validation.test.summary.benchmarkReturn,
    testMaxDrawdown: validation.test.summary.maxDrawdown,
    testTrades: validation.test.summary.tradeCount,
    changesFromPrevious: previous ? parameterChanges(previous.snapshot, validation.strategy.snapshot) : [],
    independent: verdict.independent,
    reasons: Object.freeze(verdict.reasons),
    reproduction: verdict.reproduction,
    trialNumber: verdict.priorTrialsOnSymbol + 1
  });
  return { ledger: [...list, entry], entry, verdict };
}
