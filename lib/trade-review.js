// 매매 성적표: "잘 샀나, 잘 팔았나"를 같은 날 시장 지수와 비교해 판정한다.
// 매수 → 산 가격 대비 지금 수익률과, 같은 날 지수를 샀을 때의 수익률 비교.
// 매도 → 판 뒤 주가가 지수보다 더 올랐으면(더 들고 있었으면 나았음) 아쉬운 매도.
import { closeOn, fillsFrom } from './asset-timeline.js';

const round = (v, d = 1) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * @param orders 정규화된 주문 이력
 * @param candlesBySymbol {symbol:[{date,close}]}
 * @param indexFor symbol => {name, candles}
 * @param priceNow {symbol: 현재가} (없으면 마지막 종가)
 * @param fxNow USD 금액을 원화 가중치로 바꿀 때 쓰는 환율
 */
export function reviewTrades(orders, { candlesBySymbol = {}, indexFor = () => null, priceNow = {}, fxNow = 1, today, minDays = 3 } = {}) {
  const fills = fillsFrom(orders), rows = [], pending = [];
  for (const f of fills) {
    if (!(f.price > 0)) continue;
    if (today && daysBetween(f.date, today) < minDays) { pending.push(f); continue; }
    const candles = candlesBySymbol[f.symbol], now = priceNow[f.symbol] ?? candles?.at(-1)?.close;
    const idx = indexFor(f.symbol), i0 = closeOn(idx?.candles, f.date), i1 = idx?.candles?.at(-1)?.close;
    if (!(now > 0)) continue;
    const stock = (now / f.price - 1) * 100, market = i0 && i1 ? (i1 / i0 - 1) * 100 : null;
    const weight = (f.amount ?? f.price * f.quantity) * (f.currency === 'USD' ? fxNow : 1);
    // 매수: 지수보다 더 올랐으면 +. 매도: 판 뒤 지수보다 덜 올랐으면(=팔길 잘함) +.
    const edge = market === null ? null : f.side === 'BUY' ? stock - market : market - stock;
    rows.push({ ...f, now, stock: round(stock), market: round(market), edge: round(edge), weight, indexName: idx?.name ?? null });
  }
  const side = s => {
    const rs = rows.filter(r => r.side === s), withMkt = rs.filter(r => r.edge !== null), w = withMkt.reduce((n, r) => n + r.weight, 0);
    if (!rs.length) return { count: 0 };
    const avg = key => w ? withMkt.reduce((n, r) => n + r[key] * r.weight, 0) / w : null;
    const edge = avg('edge'), good = withMkt.filter(r => r.edge > 0).length;
    return { count: rs.length, compared: withMkt.length, good, stock: round(avg('stock')), market: round(avg('market')), edge: round(edge),
      grade: edge === null ? 'unknown' : edge >= 2 ? 'good' : edge <= -2 ? 'bad' : 'even' };
  };
  const buys = side('BUY'), sells = side('SELL');
  const sorted = key => [...rows].filter(r => r.side === key && r.edge !== null).sort((a, b) => b.edge - a.edge);
  const buyRank = sorted('BUY'), sellRank = sorted('SELL');
  const fees = fills.reduce((s, f) => s + f.fees * (f.currency === 'USD' ? fxNow : 1), 0);

  const lines = [];
  if (buys.count) lines.push(buys.grade === 'good' ? `산 종목들이 같은 날 시장 지수를 산 것보다 평균 ${buys.edge}%p 더 올랐습니다. 매수 타이밍·종목 선택이 좋았습니다.`
    : buys.grade === 'bad' ? `같은 날 시장 지수를 샀다면 평균 ${Math.abs(buys.edge)}%p 더 벌었습니다. 종목을 고르기보다 지수 적립이 나았던 기간입니다.`
    : buys.grade === 'even' ? `산 종목들의 성과가 시장 지수와 비슷합니다(차이 ${buys.edge}%p).` : '매수 성과를 지수와 비교할 자료가 부족합니다.');
  if (sells.count) lines.push(sells.grade === 'good' ? `판 종목들은 판 뒤 시장보다 평균 ${sells.edge}%p 덜 올랐습니다. 잘 판 편입니다.`
    : sells.grade === 'bad' ? `판 종목들이 판 뒤 시장보다 평균 ${Math.abs(sells.edge)}%p 더 올랐습니다. 너무 일찍 판 경우가 많았습니다.`
    : sells.grade === 'even' ? '판 종목들은 판 뒤 시장과 비슷하게 움직였습니다.' : '매도 성과를 지수와 비교할 자료가 부족합니다.');

  const overall = [buys, sells].filter(s => s.count && s.edge !== null);
  const score = overall.length ? overall.reduce((n, s) => n + s.edge * s.compared, 0) / overall.reduce((n, s) => n + s.compared, 0) : null;
  return {
    available: rows.length > 0, rows, pending: pending.length, buys, sells, fees: Math.round(fees), lines,
    verdict: score === null ? null : score >= 2 ? '시장보다 잘했습니다' : score <= -2 ? '시장 지수보다 못했습니다' : '시장과 비슷했습니다',
    score: round(score),
    best: buyRank[0] ?? null, worst: buyRank.at(-1) ?? null, regret: sellRank.at(-1)?.edge < 0 ? sellRank.at(-1) : null, goodSell: sellRank[0]?.edge > 0 ? sellRank[0] : null
  };
}
