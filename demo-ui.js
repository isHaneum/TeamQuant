// 예시 자산으로 둘러보기: 계좌를 연결하지 않은 사람도 홈·포트폴리오·성적표 흐름을 체험한다.
// 공개 시세로 만든 가짜 보유 종목과 가짜 체결이며 실제 계좌가 아니다. 실제 계좌가 연결되면 그 자료로 바로 바뀐다.
import { candles } from '/lib/client-data.js';

const BOOK = [['005930', '삼성전자', 'KRW'], ['000660', 'SK하이닉스', 'KRW'], ['069500', 'KODEX 200', 'KRW'], ['NVDA', '엔비디아', 'USD'], ['KO', '코카콜라', 'USD'], ['035420', 'NAVER', 'KRW']];
// [종목, 매수/매도, 수량, 몇 거래일 전]
const FILLS = [['005930', 'BUY', 20, 230], ['005930', 'BUY', 10, 120], ['005930', 'SELL', 5, 60], ['000660', 'BUY', 3, 180], ['069500', 'BUY', 20, 200], ['069500', 'BUY', 20, 100], ['NVDA', 'BUY', 10, 150], ['KO', 'BUY', 20, 90], ['035420', 'BUY', 10, 210], ['035420', 'SELL', 10, 40]];

export let demoActive = false;
export async function buildDemo() {
  const series = Object.fromEntries(await Promise.all(BOOK.map(async ([s, , c]) => [s, (await candles(s, c)).candles])));
  const meta = Object.fromEntries(BOOK.map(([s, n, c]) => [s, { name: n, currency: c }]));
  const orders = FILLS.map(([symbol, side, q, k], i) => { const c = series[symbol].at(-k), price = c.close, cur = meta[symbol].currency, at = c.date + 'T01:00:00.000Z';
    return { ref: 'demo' + i, symbol, side, status: 'FILLED', orderType: 'LIMIT', timeInForce: 'DAY', currency: cur, quantity: q, orderAmount: null, limitPrice: price, orderedAt: at, canceledAt: null,
      execution: { filledQuantity: q, averageFilledPrice: price, filledAmount: q * price, commission: cur === 'KRW' ? Math.round(q * price * 0.00015) : 0.5, tax: side === 'SELL' && cur === 'KRW' ? Math.round(q * price * 0.0018) : 0, filledAt: at, settlementDate: null } }; });
  const qty = {}, cost = {};
  for (const o of orders) { const s = o.symbol, q = o.execution.filledQuantity; const before = qty[s] || 0; qty[s] = before + (o.side === 'BUY' ? q : -q); cost[s] = o.side === 'BUY' ? (cost[s] || 0) + o.execution.filledAmount : (cost[s] || 0) * (qty[s] / before); }
  const positions = Object.keys(qty).filter(s => qty[s] > 0).map(s => { const c = series[s], price = c.at(-1).close, prev = c.at(-2).close, q = qty[s], value = q * price;
    return { symbol: s, name: meta[s].name, currency: meta[s].currency, quantity: q, avgCost: cost[s] / q, price, cost: cost[s], value, pnl: value - cost[s], returnPct: (value / cost[s] - 1) * 100, dailyPnl: q * (price - prev) }; });
  const fx = (await candles('KRW=X', 'USD').catch(() => null))?.candles?.at(-1)?.close || 1400;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return { source: '예시 자산 (공개 시세로 만든 가짜 보유 종목)', fetchedAt: new Date().toISOString(), fx: { midRate: fx, asOf: '예시' }, positions, totals: [], cashKnown: false, demo: true,
    demoCash: 3_000_000, demoOrders: { query: { from: new Date(Date.parse(today) - 365 * 864e5).toISOString().slice(0, 10), to: today, status: 'CLOSED', symbol: '' }, orders: orders.reverse(), totals: [], pages: 1, paginationComplete: true, issue: null, fetchedAt: new Date().toISOString(), source: '예시', notice: '' } };
}
export async function startDemo(button) {
  if (button) { button.disabled = true; button.textContent = '예시 자산 준비 중…'; }
  try { const snap = await buildDemo(); demoActive = true; window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot', { detail: snap })); }
  catch (e) { if (button) button.textContent = `예시를 만들지 못했습니다 (${e.message})`; return; }
  finally { if (button) button.disabled = false; }
}
export function stopDemo() { demoActive = false; window.dispatchEvent(new Event('teamquant:asset-clear')); }
document.addEventListener('click', e => { const b = e.target.closest?.('[data-demo-start]'); if (b) void startDemo(b); const x = e.target.closest?.('[data-demo-stop]'); if (x) stopDemo(); });
// 실제 계좌 자료가 들어오면 예시는 끝난다.
window.addEventListener('teamquant:asset-snapshot', e => { if (!e.detail?.demo) demoActive = false; });
