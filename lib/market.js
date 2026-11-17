const ALLOWED_RANGES = new Set(["3mo", "6mo", "1y", "2y", "5y"]);
const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}(\.(KS|KQ))?$/;

// Holdings provide codes, not a DART company identity. Try the two Korean
// exchange suffixes without requiring every PC to own a DART API credential.
export async function fetchHeldMarketSeries(input,range='1y',reader=fetchMarketSeries){
  const symbol=normalizeSymbol(input);
  if(/^\d[\dA-Z]{5}$/.test(symbol)){
    for(const suffix of ['.KS','.KQ']){
      try{const data=await reader(symbol+suffix,range);if(data.currency==='KRW')return data;}catch{}
    }
    throw new Error('보유 상품의 코스피·코스닥 일봉을 확인하지 못했습니다.');
  }
  return reader(symbol.replace(/\.(?!KS$|KQ$)/g,'-'),range);
}

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

// 일봉 날짜 = 그 거래소 현지 날짜(2026-11-17 교차 검증). UTC 날짜로 붙이면 런던 자정에 찍히는 환율(KRW=X) 일봉이
// 영국 서머타임(3~10월)에는 하루 앞 날짜가 되어, 미국 종가를 다음 날 환율로 환산했다. 한국(서울 09:00 = 00:00Z)·미국(뉴욕 09:30) 일봉은 그대로.
export function candleDay(timestamp, timeZone = null) {
  if (timeZone) { try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp * 1000)); } catch { /* 모르는 시간대는 UTC */ } }
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
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
  const timeZone = result.meta?.exchangeTimezoneName || null;
  const candles = (result.timestamp || []).map((timestamp, index) => ({
    date: candleDay(timestamp, timeZone),
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
