function sma(values, endIndex, period) {
  if (endIndex + 1 < period) return null;
  let total = 0;
  for (let index = endIndex - period + 1; index <= endIndex; index += 1) total += values[index];
  return total / period;
}

function rsi(values, endIndex, period) {
  if (endIndex < period) return null;
  let gains = 0, losses = 0;
  for (let index = endIndex - period + 1; index <= endIndex; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = (gains / period) / (losses / period);
  return 100 - 100 / (1 + relativeStrength);
}

function previousHigh(values, endIndex, period) {
  if (endIndex < period) return null;
  return Math.max(...values.slice(endIndex - period, endIndex));
}

function previousLow(values, endIndex, period) {
  if (endIndex < period) return null;
  return Math.min(...values.slice(endIndex - period, endIndex));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function maxDrawdown(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  }
  return Math.abs(worst);
}

function stableHash(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createStrategyDefinition(options = {}) {
  const type = options.strategyType || "ma_cross";
  const common = {
    type,
    stopLossPct: number(options.stopLossPct, 0),
    takeProfitPct: number(options.takeProfitPct, 0),
    positionPct: number(options.positionPct, 100)
  };
  let parameters, name, entryRule, exitRule, warmup;
  if (type === "rsi_reversal") {
    parameters = { rsiPeriod: number(options.rsiPeriod, 14), rsiBuy: number(options.rsiBuy, 30), rsiSell: number(options.rsiSell, 70) };
    name = "RSI 과매도 반전";
    entryRule = `RSI(${parameters.rsiPeriod})가 ${parameters.rsiBuy} 이하에서 다시 상향 돌파하면 매수`;
    exitRule = `RSI(${parameters.rsiPeriod})가 ${parameters.rsiSell} 이상에서 다시 하향 돌파하면 매도`;
    warmup = parameters.rsiPeriod + 1;
  } else if (type === "breakout") {
    parameters = { entryLookback: number(options.entryLookback, 20), exitLookback: number(options.exitLookback, 10) };
    name = "가격 돌파";
    entryRule = `종가가 직전 ${parameters.entryLookback}거래일 최고가를 돌파하면 매수`;
    exitRule = `종가가 직전 ${parameters.exitLookback}거래일 최저가를 하향 돌파하면 매도`;
    warmup = Math.max(parameters.entryLookback, parameters.exitLookback);
  } else {
    parameters = { fastPeriod: number(options.fastPeriod, 20), slowPeriod: number(options.slowPeriod, 60), rsiPeriod: number(options.rsiPeriod, 14), rsiFilterMax: options.rsiFilterMax === undefined ? null : number(options.rsiFilterMax, 70) };
    name = "이동평균 교차";
    entryRule = `${parameters.fastPeriod}일 이동평균이 ${parameters.slowPeriod}일 이동평균을 상향 돌파하면 매수${parameters.rsiFilterMax === null ? "" : ` · RSI(${parameters.rsiPeriod}) ${parameters.rsiFilterMax} 미만`}`;
    exitRule = `${parameters.fastPeriod}일 이동평균이 ${parameters.slowPeriod}일 이동평균을 하향 돌파하면 매도`;
    warmup = Math.max(parameters.slowPeriod, parameters.rsiFilterMax === null ? 0 : parameters.rsiPeriod + 1);
  }
  const snapshot = { ...common, parameters };
  const riskRules = [];
  if (common.stopLossPct > 0) riskRules.push(`종가 기준 ${common.stopLossPct}% 손실 시 다음 거래일 청산`);
  if (common.takeProfitPct > 0) riskRules.push(`종가 기준 ${common.takeProfitPct}% 수익 시 다음 거래일 청산`);
  riskRules.push(`가용 현금의 ${common.positionPct}% 투입`);
  return { id: `TQ-${type.replaceAll("_", "-").toUpperCase()}-${stableHash(snapshot)}`, name, type, parameters, entryRule, exitRule, riskRule: riskRules.join(" · "), warmup, snapshot };
}

export function validateStrategy(strategy) {
  const { snapshot, parameters } = strategy;
  if (snapshot.positionPct <= 0 || snapshot.positionPct > 100) throw new Error("투입 비중은 0% 초과 100% 이하여야 합니다.");
  if (snapshot.stopLossPct < 0 || snapshot.takeProfitPct < 0) throw new Error("손절·익절 값은 0 이상이어야 합니다.");
  if (strategy.type === "ma_cross") {
    if (!Number.isInteger(parameters.fastPeriod) || !Number.isInteger(parameters.slowPeriod) || parameters.fastPeriod < 2 || parameters.fastPeriod >= parameters.slowPeriod) throw new Error("단기 이동평균은 장기 이동평균보다 짧아야 합니다.");
  } else if (strategy.type === "rsi_reversal") {
    if (!Number.isInteger(parameters.rsiPeriod) || parameters.rsiPeriod < 2) throw new Error("RSI 기간은 2 이상이어야 합니다.");
    if (parameters.rsiBuy <= 0 || parameters.rsiBuy >= parameters.rsiSell || parameters.rsiSell >= 100) throw new Error("RSI 매수 기준은 매도 기준보다 낮아야 합니다.");
  } else if (strategy.type === "breakout") {
    if (!Number.isInteger(parameters.entryLookback) || !Number.isInteger(parameters.exitLookback) || parameters.entryLookback < 2 || parameters.exitLookback < 2) throw new Error("돌파 기간은 2거래일 이상이어야 합니다.");
  } else throw new Error("지원하지 않는 전략 유형입니다.");
}

export function evaluateStrategy(strategy, closes, index, hasPosition) {
  const p = strategy.parameters;
  if (strategy.type === "rsi_reversal") {
    const current = rsi(closes, index, p.rsiPeriod), previous = rsi(closes, index - 1, p.rsiPeriod);
    if (current === null || previous === null) return { indicators: {}, action: "WARMUP", reason: "RSI 계산 기간 확보 중" };
    const indicators = { rsi: round(current, 2), previousRsi: round(previous, 2) };
    if (!hasPosition && previous <= p.rsiBuy && current > p.rsiBuy) return { indicators, action: "BUY", reason: `RSI가 ${p.rsiBuy}을 상향 돌파` };
    if (hasPosition && previous >= p.rsiSell && current < p.rsiSell) return { indicators, action: "SELL", reason: `RSI가 ${p.rsiSell}을 하향 돌파` };
    return { indicators, action: "HOLD", reason: hasPosition ? "RSI 매도 조건 미충족" : "RSI 매수 조건 미충족" };
  }
  if (strategy.type === "breakout") {
    const high = previousHigh(closes, index, p.entryLookback), low = previousLow(closes, index, p.exitLookback);
    if (high === null || low === null) return { indicators: {}, action: "WARMUP", reason: "돌파 기준 기간 확보 중" };
    const indicators = { close: round(closes[index]), entryHigh: round(high), exitLow: round(low) };
    if (!hasPosition && closes[index] > high) return { indicators, action: "BUY", reason: `${p.entryLookback}일 최고가 돌파` };
    if (hasPosition && closes[index] < low) return { indicators, action: "SELL", reason: `${p.exitLookback}일 최저가 하향 돌파` };
    return { indicators, action: "HOLD", reason: hasPosition ? "청산 돌파 조건 미충족" : "진입 돌파 조건 미충족" };
  }
  const fast = sma(closes, index, p.fastPeriod), slow = sma(closes, index, p.slowPeriod);
  const prevFast = sma(closes, index - 1, p.fastPeriod), prevSlow = sma(closes, index - 1, p.slowPeriod);
  if ([fast, slow, prevFast, prevSlow].some((value) => value === null)) return { indicators: {}, action: "WARMUP", reason: "이동평균 계산 기간 확보 중" };
  const filterRsi = p.rsiFilterMax === null ? null : rsi(closes, index, p.rsiPeriod);
  const indicators = { fastSma: round(fast), slowSma: round(slow), previousFastSma: round(prevFast), previousSlowSma: round(prevSlow), ...(filterRsi === null ? {} : { rsi: round(filterRsi, 2) }) };
  if (!hasPosition && prevFast <= prevSlow && fast > slow) {
    if (p.rsiFilterMax !== null && filterRsi >= p.rsiFilterMax) return { indicators, action: "HOLD", reason: `이동평균 상향 돌파, RSI ${round(filterRsi,2)}로 필터 기준 ${p.rsiFilterMax} 미충족` };
    return { indicators, action: "BUY", reason: p.rsiFilterMax === null ? "단기 이동평균이 장기 이동평균을 상향 돌파" : `이동평균 상향 돌파, RSI ${round(filterRsi,2)}로 필터 통과` };
  }
  if (hasPosition && prevFast >= prevSlow && fast < slow) return { indicators, action: "SELL", reason: "단기 이동평균이 장기 이동평균을 하향 돌파" };
  return { indicators, action: "HOLD", reason: hasPosition ? "매도 교차 조건 미충족" : "매수 교차 조건 미충족" };
}

export function runBacktest(candles, options = {}) {
  const initialCapital = number(options.initialCapital, 10_000_000), feeRate = number(options.feeRate, 0.001), slippageRate = number(options.slippageRate, 0.001);
  const strategy = createStrategyDefinition(options);
  validateStrategy(strategy);
  if (!Array.isArray(candles) || candles.length < strategy.warmup + 2) throw new Error("선택한 기간에 전략 계산용 데이터가 부족합니다.");
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) throw new Error("초기 자금은 0보다 커야 합니다.");
  if (feeRate < 0 || slippageRate < 0 || feeRate + slippageRate >= 0.1) throw new Error("거래 비용 설정을 확인하십시오.");

  const closes = candles.map((candle) => Number(candle.close));
  let cash = initialCapital, shares = 0, entry = null, pending = null;
  const trades = [], equity = [], signals = [], decisions = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (options.evaluationStartDate && candle.date < options.evaluationStartDate) continue;
    let execution = null;
    if (pending && Number.isFinite(candle.open) && candle.open > 0) {
      if (pending.side === "BUY" && shares === 0) {
        const executionPrice = candle.open * (1 + slippageRate), budget = cash * (strategy.snapshot.positionPct / 100), unitCost = executionPrice * (1 + feeRate);
        shares = Math.floor(budget / unitCost);
        if (shares > 0) {
          const gross = shares * executionPrice, fee = gross * feeRate;
          cash -= gross + fee;
          entry = { date: candle.date, price: executionPrice, shares, cost: gross + fee };
          execution = { side: "매수", price: round(executionPrice), shares };
          trades.push({ side: "매수", signalDate: pending.signalDate, reason: pending.reason, date: candle.date, price: round(executionPrice), shares, fee: round(fee), pnl: null });
        }
      } else if (pending.side === "SELL" && shares > 0) {
        const executionPrice = candle.open * (1 - slippageRate), gross = shares * executionPrice, fee = gross * feeRate, pnl = gross - fee - entry.cost;
        cash += gross - fee;
        execution = { side: "매도", price: round(executionPrice), shares, pnl: round(pnl) };
        trades.push({ side: "매도", signalDate: pending.signalDate, reason: pending.reason, date: candle.date, price: round(executionPrice), shares, fee: round(fee), pnl: round(pnl) });
        shares = 0;
        entry = null;
      }
      pending = null;
    }

    equity.push({ date: candle.date, value: round(cash + shares * candle.close), close: round(candle.close) });
    const evaluation = evaluateStrategy(strategy, closes, index, shares > 0);
    let action = evaluation.action, reason = evaluation.reason;
    if (action === 'BUY' && options.entryAllowedByDate && options.entryAllowedByDate[candle.date] !== true) {
      action = 'HOLD'; reason = '시장 조건 미충족: 코스피 60일 평균 이하 또는 자료 없음, 신규 매수 보류';
    }
    if (shares > 0 && entry && index < candles.length - 1) {
      const positionReturn = (candle.close / entry.price - 1) * 100;
      if (strategy.snapshot.stopLossPct > 0 && positionReturn <= -strategy.snapshot.stopLossPct) {
        action = "SELL"; reason = `손절 기준 -${strategy.snapshot.stopLossPct}% 도달 (${round(positionReturn)}%)`;
      } else if (strategy.snapshot.takeProfitPct > 0 && positionReturn >= strategy.snapshot.takeProfitPct) {
        action = "SELL"; reason = `익절 기준 +${strategy.snapshot.takeProfitPct}% 도달 (${round(positionReturn)}%)`;
      }
    }
    if ((action === "BUY" || action === "SELL") && index < candles.length - 1) {
      pending = { side: action, signalDate: candle.date, reason };
      signals.push({ date: candle.date, side: action === "BUY" ? "매수" : "매도", reason, indicators: evaluation.indicators });
    }
    decisions.push({ date: candle.date, close: round(candle.close), indicators: evaluation.indicators, position: shares > 0 ? "보유" : "현금", decision: action === "BUY" ? "매수 신호" : action === "SELL" ? "매도 신호" : action === "WARMUP" ? "계산 준비" : "관망", reason, scheduledExecution: (action === "BUY" || action === "SELL") && index < candles.length - 1 ? candles[index + 1].date : null, execution });
  }

  if (!equity.length) throw new Error('평가 기간에 거래일이 없습니다.');
  const finalValue = equity.at(-1).value, totalReturn = finalValue / initialCapital - 1;
  const elapsedDays = Math.max(1, (Date.parse(candles.at(-1).date) - Date.parse(equity[0].date)) / 86_400_000);
  const cagr = (finalValue / initialCapital) ** (365.25 / elapsedDays) - 1, benchmarkReturn = equity.at(-1).close / equity[0].close - 1;
  const closedTrades = trades.filter((trade) => trade.side === "매도"), wins = closedTrades.filter((trade) => trade.pnl > 0).length;
  return {
    strategy,
    settings: { initialCapital, feeRate, slippageRate },
    summary: { startDate: equity[0].date, endDate: equity.at(-1).date, finalValue: round(finalValue), totalReturn: round(totalReturn * 100), cagr: round(cagr * 100), maxDrawdown: round(maxDrawdown(equity.map((item) => item.value)) * 100), benchmarkReturn: round(benchmarkReturn * 100), tradeCount: closedTrades.length, signalCount: signals.length, winRate: closedTrades.length ? round((wins / closedTrades.length) * 100) : null, positionOpen: shares > 0 },
    equity, trades, signals, decisions
  };
}
