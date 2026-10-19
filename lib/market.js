const ALLOWED_RANGES = new Set(["3mo", "6mo", "1y", "2y", "5y"]);
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}(\.(KS|KQ))?$/;

export function normalizeSymbol(value = "") {
  const symbol = String(value).trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new Error("종목 코드 형식이 올바르지 않습니다.");
  }
  return symbol;
}

export function normalizeRange(value = "1y") {
  return ALLOWED_RANGES.has(value) ? value : "1y";
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

export async function fetchMarketSeries(symbolInput, rangeInput = "1y") {
  const symbol = normalizeSymbol(symbolInput);
  const range = normalizeRange(rangeInput);
  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  endpoint.searchParams.set("range", range);
  endpoint.searchParams.set("interval", "1d");
  endpoint.searchParams.set("events", "history");
  endpoint.searchParams.set("includeAdjustedClose", "true");

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0 TeamQuantAcademicPrototype/1.0",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`시장 데이터 요청 실패 (${response.status})`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) {
    throw new Error(payload?.chart?.error?.description || "시장 데이터를 찾지 못했습니다.");
  }

  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const candles = (result.timestamp || []).map((timestamp, index) => ({
    date: new Date(timestamp * 1000).toISOString().slice(0, 10),
    open: finite(quote.open?.[index]),
    high: finite(quote.high?.[index]),
    low: finite(quote.low?.[index]),
    close: finite(quote.close?.[index]),
    adjustedClose: finite(adjusted[index]),
    volume: finite(quote.volume?.[index])
  })).filter((row) => row.open !== null && row.close !== null);

  if (candles.length < 30) {
    throw new Error("전략을 검증하기에 충분한 거래일 데이터가 없습니다.");
  }

  return {
    symbol,
    range,
    currency: result.meta?.currency || "KRW",
    exchange: result.meta?.exchangeName || "",
    timezone: result.meta?.exchangeTimezoneName || "Asia/Seoul",
    instrumentType: result.meta?.instrumentType || "EQUITY",
    fetchedAt: new Date().toISOString(),
    source: "Yahoo Finance chart API",
    sourceNotice: "지연 일봉 데이터 기반 비공식 연동. 수업용 모의 검증에만 사용",
    candles
  };
}
