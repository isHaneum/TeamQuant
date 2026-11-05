// 실제 주문·체결 이력으로 매매 습관을 점검한다 (브라우저 메모리에서만 계산, 저장·전송하지 않음).
// 입력 주문은 lib/toss-orders.js normalizeOrder 형식. 체결된 주문만 사용한다.

const round = (v, d = 1) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const day = iso => String(iso).slice(0, 10);
const DAY = 86400000;

export const HABIT_THRESHOLDS = { chasePct: 7, panicPct: -7, shortHoldDays: 7, churnDays: 10, lookbackDays: 5 };

function fills(orders) {
  return (orders || []).filter(o => o?.execution?.filledQuantity > 0 && Number.isFinite(o.execution.averageFilledPrice))
    .map(o => ({ symbol: o.symbol, name: o.name || o.symbol, side: o.side, currency: o.currency, qty: o.execution.filledQuantity, price: o.execution.averageFilledPrice,
      at: o.execution.filledAt || o.orderedAt, date: day(o.execution.filledAt || o.orderedAt), fee: (o.execution.commission || 0) + (o.execution.tax || 0), feeKnown: o.execution.commission !== null && o.execution.tax !== null }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

// 주문일 직전 n거래일 동안의 수익률(%). 주문 당일 가격은 쓰지 않는다.
export function priorReturn(candles, date, n = HABIT_THRESHOLDS.lookbackDays) {
  if (!candles?.length) return null;
  const before = candles.filter(c => c.date < date);
  if (before.length < n + 1) return null;
  const last = before.at(-1).close, base = before.at(-1 - n).close;
  return (last / base - 1) * 100;
}
// 주문일 이후 n거래일 뒤 종가와 체결가 비교(%).
export function afterReturn(candles, date, price, n = 20) {
  if (!candles?.length || !price) return null;
  const after = candles.filter(c => c.date > date);
  if (after.length < n) return null;
  return (after[n - 1].close / price - 1) * 100;
}

export function analyzeHabits(orders, { candlesBySymbol = {}, from, to, thresholds = HABIT_THRESHOLDS } = {}) {
  const rows = fills(orders);
  if (!rows.length) return { available: false, message: '체결된 주문이 없어 매매 습관을 계산할 수 없습니다.' };
  const start = from || rows[0].date, end = to || rows.at(-1).date;
  const weeks = Math.max(1, (Date.parse(end) - Date.parse(start)) / DAY / 7);
  const buys = rows.filter(r => r.side === 'BUY'), sells = rows.filter(r => r.side === 'SELL');

  // 오른 뒤 사기 / 떨어진 뒤 팔기
  const buyCtx = buys.map(b => ({ ...b, prior: priorReturn(candlesBySymbol[b.symbol], b.date) })).filter(b => b.prior !== null);
  const sellCtx = sells.map(s => ({ ...s, prior: priorReturn(candlesBySymbol[s.symbol], s.date), after: afterReturn(candlesBySymbol[s.symbol], s.date, s.price) }));
  const chase = buyCtx.filter(b => b.prior >= thresholds.chasePct), panic = sellCtx.filter(s => s.prior !== null && s.prior <= thresholds.panicPct);

  // 보유 기간: 기간 내 매수 수량을 선입선출로 매도에 맞춘다. 기간 이전 보유분은 알 수 없음으로 둔다.
  const lots = new Map(), holds = [], realized = [];
  let unmatchedSellQty = 0;
  for (const r of rows) {
    const q = lots.get(r.symbol) || [];
    if (r.side === 'BUY') { q.push({ qty: r.qty, price: r.price, at: r.at }); lots.set(r.symbol, q); continue; }
    let remaining = r.qty;
    while (remaining > 1e-9 && q.length) {
      const lot = q[0], used = Math.min(lot.qty, remaining);
      holds.push({ symbol: r.symbol, days: (Date.parse(r.at) - Date.parse(lot.at)) / DAY, qty: used });
      realized.push({ symbol: r.symbol, returnPct: (r.price / lot.price - 1) * 100, currency: r.currency });
      lot.qty -= used; remaining -= used; if (lot.qty <= 1e-9) q.shift();
    }
    unmatchedSellQty += remaining;
  }
  const shortHolds = holds.filter(h => h.days < thresholds.shortHoldDays);

  // 팔았다가 다시 사기
  const churn = [];
  for (const s of sells) {
    const re = buys.find(b => b.symbol === s.symbol && b.at > s.at && (Date.parse(b.at) - Date.parse(s.at)) / DAY <= thresholds.churnDays);
    if (re) churn.push({ symbol: s.symbol, name: s.name, soldAt: s.price, reboughtAt: re.price, changePct: (re.price / s.price - 1) * 100 });
  }

  const fees = {};
  for (const r of rows) { fees[r.currency] ||= { amount: 0, complete: true }; fees[r.currency].amount += r.fee; if (!r.feeKnown) fees[r.currency].complete = false; }
  const afterSells = sellCtx.filter(s => s.after !== null);
  const share = (a, b) => b ? round(a / b * 100, 0) : null;

  const metrics = {
    period: { from: start, to: end, weeks: round(weeks) },
    trades: rows.length, buys: buys.length, sells: sells.length, tradesPerWeek: round(rows.length / weeks), symbols: new Set(rows.map(r => r.symbol)).size,
    chaseShare: share(chase.length, buyCtx.length), chaseCount: chase.length, buysWithPrice: buyCtx.length,
    panicShare: share(panic.length, sellCtx.filter(s => s.prior !== null).length), panicCount: panic.length,
    medianHoldDays: holds.length ? round([...holds.map(h => h.days)].sort((a, b) => a - b)[holds.length >> 1]) : null,
    shortHoldShare: share(shortHolds.length, holds.length), matchedSells: holds.length, unmatchedSellQty: round(unmatchedSellQty, 4),
    churnCount: churn.length, churn: churn.slice(0, 5),
    afterSellAvg: afterSells.length ? round(afterSells.reduce((s, x) => s + x.after, 0) / afterSells.length) : null, afterSellCount: afterSells.length,
    winRate: realized.length ? share(realized.filter(r => r.returnPct > 0).length, realized.length) : null,
    fees
  };

  const flags = [];
  if (metrics.tradesPerWeek >= 3) flags.push({ key: 'frequent', level: 'warn', title: '매매가 잦습니다', detail: `주당 평균 ${metrics.tradesPerWeek}회 체결했습니다. 거래가 많을수록 수수료·세금과 판단 실수가 쌓입니다.`, rule: '매매는 주 1~2회 정해진 요일에만 합니다.' });
  if (metrics.chaseShare !== null && metrics.buysWithPrice >= 3 && metrics.chaseShare >= 40) flags.push({ key: 'chase', level: 'warn', title: '오른 뒤에 따라 사는 편입니다', detail: `매수 ${metrics.buysWithPrice}건 중 ${metrics.chaseCount}건(${metrics.chaseShare}%)이 직전 5거래일 ${thresholds.chasePct}% 이상 오른 뒤였습니다.`, rule: '최근 일주일 7% 넘게 오른 종목은 하루 기다렸다가 절반만 삽니다.' });
  if (metrics.panicShare !== null && metrics.panicCount >= 2 && metrics.panicShare >= 40) flags.push({ key: 'panic', level: 'warn', title: '떨어진 뒤에 파는 편입니다', detail: `매도 중 ${metrics.panicShare}%가 직전 5거래일 ${Math.abs(thresholds.panicPct)}% 이상 하락한 뒤였습니다.`, rule: '하락 매도 전에 리포트에서 시장 탓인지, 회사 탓인지 먼저 확인합니다.' });
  if (metrics.shortHoldShare !== null && metrics.matchedSells >= 3 && metrics.shortHoldShare >= 50) flags.push({ key: 'short', level: 'warn', title: '사고 나서 금방 팝니다', detail: `기간 내 사고판 물량의 ${metrics.shortHoldShare}%를 ${thresholds.shortHoldDays}일 안에 팔았습니다. 보유 기간 중앙값 ${metrics.medianHoldDays}일.`, rule: '살 때 최소 보유 기간과 팔 조건을 미리 적어 둡니다.' });
  if (metrics.churnCount >= 2) flags.push({ key: 'churn', level: 'warn', title: '팔았다가 다시 사는 일이 있습니다', detail: `${metrics.churnCount}번 매도 후 ${thresholds.churnDays}일 안에 같은 종목을 다시 샀습니다.`, rule: '판 종목은 최소 2주 동안 다시 사지 않습니다.' });
  if (metrics.afterSellAvg !== null && metrics.afterSellCount >= 3 && metrics.afterSellAvg > 5) flags.push({ key: 'early', level: 'info', title: '판 뒤에 더 오른 경우가 많았습니다', detail: `매도 20거래일 뒤 주가가 매도가보다 평균 ${metrics.afterSellAvg}% 높았습니다(${metrics.afterSellCount}건).`, rule: '팔기 전에 "가격 말고 바뀐 사실이 있는가"를 확인합니다.' });
  if (!flags.length) flags.push({ key: 'ok', level: 'good', title: '두드러진 충동 매매 패턴은 없습니다', detail: '조회 기간의 체결 내역에서 경고 기준을 넘는 항목이 없습니다.', rule: '지금처럼 정한 원칙을 유지합니다.' });

  return { available: true, metrics, flags, warnings: flags.filter(f => f.level === 'warn').length,
    scope: '조회 기간에 체결된 주문만 사용합니다. 기간 이전에 산 물량은 보유 기간 계산에서 제외합니다. 앱 밖 거래·입출금은 포함하지 않습니다.' };
}
