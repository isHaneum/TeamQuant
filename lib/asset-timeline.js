// 월별 주식 자산 추이: 지금 보유 수량에서 실제 체결을 시간 역순으로 되돌려 각 월말 보유 수량을 복원하고,
// 그 날의 마지막 종가(달러 종목은 그 날 환율)로 평가한다. 계좌 기록을 지어내지 않기 위해
// 체결 이력이 닿지 않는 달, 시세가 없는 달, 수량이 맞지 않는 달은 값을 비워 둔다. 현금은 포함하지 않는다.

export const koreaDay = v => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));

// candles는 날짜 오름차순. date 당일 또는 그 이전 마지막 종가.
export function closeOn(candles, date) {
  if (!Array.isArray(candles) || !candles.length) return null;
  let lo = 0, hi = candles.length - 1, found = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found === null) return null;
  const v = candles[found].close; return Number.isFinite(v) && v > 0 ? v : null;
}

// 오늘을 포함해 최근 count개의 월말 날짜. 이번 달은 오늘 날짜로 끝난다.
export function monthEnds(today, count = 12) {
  const [y, m] = today.split('-').map(Number), out = [today];
  for (let k = 1; k < count; k++) {
    const end = new Date(Date.UTC(y, m - k, 0)); // m-k월의 0일 = 이전 달 말일
    out.unshift(end.toISOString().slice(0, 10));
  }
  return out;
}

// 주문 이력에서 체결된 것만 날짜·수량·금액으로 정리한다.
export function fillsFrom(orders = []) {
  return orders.flatMap(o => {
    const e = o?.execution, q = e?.filledQuantity;
    if (!(q > 0) || !['BUY', 'SELL'].includes(o.side)) return [];
    const price = e.averageFilledPrice ?? (e.filledAmount != null ? e.filledAmount / q : null);
    const amount = e.filledAmount ?? (price != null ? price * q : null);
    return [{ symbol: o.symbol, currency: o.currency, side: o.side, quantity: q, price, amount, date: koreaDay(e.filledAt || o.orderedAt), fees: (e.commission ?? 0) + (e.tax ?? 0) }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

const toKrw = (amount, currency, rate) => currency === 'KRW' ? amount : Number.isFinite(rate) && rate > 0 ? amount * rate : null;

/**
 * @param positions 현재 보유 [{symbol,currency,quantity,cost,value}] (cost·value는 종목 통화)
 * @param orders    정규화된 주문 이력(체결 포함)
 * @param candlesBySymbol {symbol: [{date,close}]}
 * @param fxCandles USD→KRW 일봉 [{date,close}]
 * @param fxNow     현재 환율
 * @param today     YYYY-MM-DD (한국 날짜)
 * @param coverageFrom 체결 이력이 빠짐없이 들어 있는 시작일. 이보다 앞선 월말은 복원하지 않는다.
 */
export function buildAssetTimeline({ positions = [], orders = [], candlesBySymbol = {}, fxCandles = [], fxNow = null, today, coverageFrom = null, months = 12 }) {
  const fills = fillsFrom(orders), warnings = [];
  const fxAt = date => closeOn(fxCandles, date) ?? fxNow;
  const nowCost = positions.reduce((s, p) => s + (toKrw(p.cost, p.currency, fxNow) ?? NaN), 0);
  const nowValue = positions.reduce((s, p) => s + (toKrw(p.value, p.currency, fxNow) ?? NaN), 0);
  const symbols = new Map(positions.map(p => [p.symbol, { currency: p.currency, quantity: p.quantity }]));
  for (const f of fills) if (!symbols.has(f.symbol)) symbols.set(f.symbol, { currency: f.currency, quantity: 0 });
  if (fills.some(f => f.amount === null)) warnings.push('체결 금액이 없는 주문이 있어 일부 달의 원금이 비어 있습니다.');

  const points = monthEnds(today, months).map((date, i, all) => {
    const month = date.slice(0, 7), isToday = i === all.length - 1;
    if (isToday) return { month, date, value: Number.isFinite(nowValue) ? nowValue : null, principal: Number.isFinite(nowCost) ? nowCost : null, current: true };
    if (coverageFrom && date < coverageFrom) return { month, date, value: null, principal: null, reason: '체결 이력 조회 범위 밖' };
    const later = fills.filter(f => f.date > date);
    let value = 0, missing = [], mismatch = false;
    for (const [symbol, info] of symbols) {
      const q = info.quantity - later.filter(f => f.symbol === symbol).reduce((s, f) => s + (f.side === 'BUY' ? f.quantity : -f.quantity), 0);
      if (q < -1e-6) { mismatch = true; continue; }
      if (q <= 1e-9) continue;
      const close = closeOn(candlesBySymbol[symbol], date), krw = close === null ? null : toKrw(q * close, info.currency, fxAt(date));
      if (krw === null) missing.push(symbol); else value += krw;
    }
    let principal = nowCost;
    for (const f of later) { const a = f.amount === null ? null : toKrw(f.amount, f.currency, fxAt(f.date)); principal = a === null ? NaN : principal - (f.side === 'BUY' ? a : -a); }
    if (mismatch) return { month, date, value: null, principal: null, reason: '보유 수량이 체결 이력과 맞지 않음' };
    if (missing.length) return { month, date, value: null, principal: Number.isFinite(principal) ? principal : null, reason: '시세 없음: ' + missing.join(', ') };
    return { month, date, value, principal: Number.isFinite(principal) ? principal : null };
  });
  if (points.some(p => p.reason?.startsWith('보유 수량'))) warnings.push('일부 달은 보유 수량이 체결 이력과 맞지 않아(액면분할·입고 등) 비워 두었습니다.');

  const valid = points.filter(p => p.value !== null);
  const first = valid[0], last = points.at(-1);
  // 기간 투자 손익 = 마지막 평가액 - 처음 평가액 - (그 사이 순매수). 원금 선을 이렇게 정의했으므로 (평가액-원금)의 변화와 같다.
  const periodGain = first && last.value !== null && first.principal !== null && last.principal !== null ? (last.value - last.principal) - (first.value - first.principal) : null;
  return { points, warnings, fills: fills.length, periodGain, from: first?.date ?? null };
}
