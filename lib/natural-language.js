const numberFrom = (text, pattern, fallback) => {
  const match = text.match(pattern);
  return match ? Number(match[1]) : fallback;
};

export function parseNaturalStrategy(input) {
  const text = String(input || "").trim();
  if (!text) throw new Error("투자 원칙을 입력해 주세요.");
  const config = { strategyType: "ma_cross", fastPeriod: 20, slowPeriod: 60, rsiPeriod: 14, rsiBuy: 30, rsiSell: 70, entryLookback: 20, exitLookback: 10, stopLossPct: 0, takeProfitPct: 0, positionPct: 100 };
  const warnings = [];
  const days = [...text.matchAll(/(\d+)\s*일/g)].map((match) => Number(match[1]));

  if (/RSI|과매도|과매수/i.test(text) && !/이동평균|이평|일선/.test(text)) {
    config.strategyType = "rsi_reversal";
    config.rsiPeriod = numberFrom(text, /RSI\s*\(?\s*(\d+)\s*\)?/i, 14);
    config.rsiBuy = numberFrom(text, /과매도[^\d]{0,12}(\d+)/, numberFrom(text, /(?:^|[.;\n])\s*매수[^\d]{0,12}(\d+)/, 30));
    config.rsiSell = numberFrom(text, /과매수[^\d]{0,12}(\d+)/, numberFrom(text, /(?:^|[.;\n])\s*매도[^\d]{0,12}(\d+)/, 70));
  } else if (/돌파|최고가|신고가/.test(text) && !/이동평균|이평|일선/.test(text)) {
    config.strategyType = "breakout";
    config.entryLookback = days[0] || 20;
    config.exitLookback = days[1] || Math.max(2, Math.round(config.entryLookback / 2));
  } else {
    config.strategyType = "ma_cross";
    if (days.length >= 2) [config.fastPeriod, config.slowPeriod] = days.slice(0, 2).sort((a,b) => a-b);
    else warnings.push("이동평균 기간 두 개를 찾지 못해 20일·60일을 적용했습니다.");
    const rsiFilter = text.match(/RSI\s*\(?\s*(\d+)\s*\)?[^\d]{0,16}(\d+)\s*(?:미만|이하)/i);
    if (rsiFilter) { config.rsiPeriod = Number(rsiFilter[1]); config.rsiFilterMax = Number(rsiFilter[2]); }
  }

  config.stopLossPct = numberFrom(text, /손절[^\d]{0,8}-?\s*(\d+(?:\.\d+)?)\s*%?/, 0);
  config.takeProfitPct = numberFrom(text, /익절[^\d]{0,8}\+?\s*(\d+(?:\.\d+)?)\s*%?/, 0);
  config.positionPct = numberFrom(text, /(?:종목당|투입|비중)[^\d]{0,10}(\d+(?:\.\d+)?)\s*%?/, 100);
  if (/뉴스|실적|저평가|우량|감정|좋아 보/.test(text)) warnings.push("뉴스·재무·주관적 표현은 현재 실행 규칙에 포함되지 않았습니다.");
  return { original: text, config, warnings };
}
