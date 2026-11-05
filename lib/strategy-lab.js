// 전략 테스트(한 화면): 고른 방식으로 사고팔았을 때를 "그냥 들고 있기"·시장 지수와 같은 기간으로 비교한다.
// 계산은 기존 백테스트 엔진(runBacktest)을 그대로 쓴다. 거래 비용(수수료·슬리피지 각 0.1%)을 넣는다.
import { runBacktest, createStrategyDefinition } from './backtest.js';
import { parseNaturalStrategy } from './natural-language.js';

export const PRESETS = [
  { id: 'trend', title: '오르는 흐름 따라가기', how: '짧은 평균선(20일)이 긴 평균선(60일)을 위로 뚫으면 사고, 아래로 뚫으면 팝니다.', when: '한 방향으로 오래 오르는 장에서 유리 · 오르내림이 잦으면 불리', config: { strategyType: 'ma_cross', fastPeriod: 20, slowPeriod: 60 } },
  { id: 'fast-trend', title: '빠르게 따라가기', how: '5일 평균선이 20일 평균선을 위로 뚫으면 사고, 아래로 뚫으면 팝니다.', when: '반응은 빠르지만 거래가 잦아 비용이 늘어납니다', config: { strategyType: 'ma_cross', fastPeriod: 5, slowPeriod: 20 } },
  { id: 'dip', title: '많이 빠졌을 때 사기', how: 'RSI가 30 아래(과하게 떨어짐)였다가 회복하면 사고, 70 위(과하게 오름)에서 꺾이면 팝니다.', when: '일정 범위에서 오르내리는 장에서 유리 · 계속 빠지는 장에선 위험', config: { strategyType: 'rsi_reversal', rsiPeriod: 14, rsiBuy: 30, rsiSell: 70 } },
  { id: 'breakout', title: '신고가 돌파 사기', how: '최근 20일 최고가를 넘으면 사고, 최근 10일 최저가를 깨면 팝니다.', when: '강하게 치고 오르는 종목에 유리 · 가짜 돌파에 자주 걸릴 수 있음', config: { strategyType: 'breakout', entryLookback: 20, exitLookback: 10 } }
];
export const CUSTOM_EXAMPLES = ['5일선이 20일선을 돌파하면 매수, 하향 돌파하면 매도. 손절 7%', 'RSI 14가 25 이하에서 반등하면 매수, 75 이상에서 꺾이면 매도', '최근 40일 최고가를 돌파하면 매수, 20일 최저가 이탈 시 매도. 익절 20%'];

// 프리셋 또는 직접 쓴 문장을 엔진 설정으로 바꾼다.
export function strategyConfig({ preset, text, stopLossPct = 0 }) {
  if (text && text.trim()) {
    const parsed = parseNaturalStrategy(text);
    return { config: parsed.config, warnings: parsed.warnings, definition: createStrategyDefinition(parsed.config), label: '직접 쓴 방식' };
  }
  const p = PRESETS.find(x => x.id === preset) || PRESETS[0];
  const config = { ...p.config, stopLossPct: Number(stopLossPct) || 0, positionPct: 100 };
  return { config, warnings: [], definition: createStrategyDefinition(config), label: p.title };
}

export function periodStart(today, months) {
  const [y, m, d] = today.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 - months, d));
  return t.toISOString().slice(0, 10);
}

const round = (v, n = 2) => Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null;
function drawdown(values) { let peak = -Infinity, worst = 0; for (const v of values) { peak = Math.max(peak, v); worst = Math.min(worst, v / peak - 1); } return worst * 100; }

/**
 * @param candles 종목 일봉(전략 계산 준비 기간 포함, 오름차순)
 * @param indexCandles 시장 지수 일봉
 * @param config 엔진 설정
 * @param from 평가 시작일
 */
export function runLabTest(candles, indexCandles, config, from, capital = 10_000_000) {
  const result = runBacktest(candles, { ...config, initialCapital: capital, evaluationStartDate: from });
  const window = candles.filter(c => c.date >= from), first = window[0], last = window.at(-1);
  const hold = { return: round((last.close / first.close - 1) * 100), maxDrawdown: round(drawdown(window.map(c => c.close))) };
  const idx = (indexCandles || []).filter(c => c.date >= first.date && c.date <= last.date);
  const market = idx.length > 1 ? round((idx.at(-1).close / idx[0].close - 1) * 100) : null;
  // 엔진은 최대 낙폭을 양수 크기로 준다. 화면에서는 손실이므로 음수로 맞춘다.
  result.summary.maxDrawdown = Number.isFinite(result.summary.maxDrawdown) ? -Math.abs(result.summary.maxDrawdown) : null;
  const s = result.summary, edge = round(s.totalReturn - hold.return);
  const inMarket = round(result.decisions.filter(d => d.position === '보유').length / Math.max(1, result.decisions.length) * 100, 0);
  let verdict;
  if (s.tradeCount === 0 && !s.positionOpen) verdict = '이 기간에는 사라는 신호가 한 번도 나오지 않아 현금으로만 있었습니다.';
  else if (edge >= 2) verdict = `이 방식이 그냥 들고 있기보다 ${edge}%p 나았습니다.`;
  else if (edge <= -2) verdict = `그냥 들고 있는 편이 ${Math.abs(edge)}%p 나았습니다.`;
  else verdict = '그냥 들고 있기와 거의 같은 결과입니다.';
  const safer = Number.isFinite(s.maxDrawdown) && s.maxDrawdown < 0 && hold.maxDrawdown < 0 && Math.abs(s.maxDrawdown) < Math.abs(hold.maxDrawdown) - 3;
  return {
    result, hold, market, edge, inMarket, verdict,
    note: safer ? `대신 중간 최대 손실은 ${s.maxDrawdown}%로 그냥 보유(${hold.maxDrawdown}%)보다 작았습니다.` : null,
    curve: result.equity.map(e => ({ date: e.date, strategy: e.value / capital * 100, hold: e.close / result.equity[0].close * 100 }))
  };
}

// 이 종목에 과거 가장 잘 맞았던 사고파는 방식. 지난 결과에 맞춘 것이므로 "앞으로도 맞는다"는 뜻이 아니다.
export function findBestFit(candles, indexCandles, from) {
  const rows = [];
  for (const p of PRESETS) {
    try { const t = runLabTest(candles, indexCandles, { ...p.config, positionPct: 100 }, from); rows.push({ id: p.id, title: p.title, return: t.result.summary.totalReturn, edge: t.edge, trades: t.result.summary.tradeCount, holding: t.result.summary.positionOpen, hold: t.hold.return, lastSignal: t.result.signals.at(-1) || null }); }
    catch { /* 자료 부족 방식은 건너뛴다 */ }
  }
  if (!rows.length) return { available: false, rows, message: '가격 자료가 부족해 비교하지 못했습니다.' };
  rows.sort((a, b) => b.edge - a.edge);
  const best = rows[0], hold = best.hold;
  let advice;
  if (best.edge < 2) advice = `어떤 사고팔기 방식도 그냥 들고 있기(${hold > 0 ? '+' : ''}${hold}%)보다 낫지 않았습니다. 이 종목은 타이밍을 노리기보다 정해 둔 금액을 꾸준히 사서 보유하는 편이 맞았습니다.`;
  else advice = `"${best.title}"${josa(best.title, '이', '가')} 그냥 들고 있기보다 ${best.edge}%p 나았습니다. 이 방식대로라면 지금은 ${best.holding ? '주식을 들고 있을 때(매수 상태)' : '현금으로 기다릴 때(관망)'}입니다${best.lastSignal ? ` · 마지막 신호 ${best.lastSignal.date} ${best.lastSignal.side}` : ''}.`;
  return { available: true, rows, best, advice, fitsHold: best.edge < 2, caveat: '지난 1년에 가장 잘 맞았던 방식입니다. 시장 분위기가 바뀌면 다른 방식이 맞을 수 있으니 참고로만 쓰십시오.' };
}

// 받침에 맞는 조사: josa('SK하이닉스', '은', '는') → '는'. 한글이 아니면 받침 없음으로 본다.
export function josa(word, withBatchim, without) {
  const ch = String(word || '').trim().replace(/["')\]]+$/, '').slice(-1), code = ch.charCodeAt(0) - 0xac00;
  if (/\d/.test(ch)) return '013678'.includes(ch) ? withBatchim : without; // 영·일·삼·육·칠·팔
  return code >= 0 && code <= 11171 && code % 28 ? withBatchim : without;
}
