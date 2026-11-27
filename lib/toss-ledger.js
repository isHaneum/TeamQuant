// 토스 거래내역 → 원금·실현손익 합계(순수 함수 · 2026-11-26 · TL1). lib/real-record.js 가 토스 실계좌 기록의 원금을 추정(RR2) 대신 실제 입출금으로 센다.
// 입력: GET /api/v1/transactions(토스 Open API 1.2.28) 의 Transaction 배열. 출력: 합계만(거래 한 건씩의 행·주문번호·계좌번호는 내지 않는다).
// 문서에서 가져온 전제(1.2.28 · 2026-11-26 확인):
//   · 금액(filledPrice·amount·commission·tax·netAmount)은 그 거래 currency 단위이고 부호가 없다. 방향은 transactionType 으로 정한다. 정산 금액은 netAmount 를 쓴다(문서: 직접 계산하지 말 것).
//   · exchangeRate = 1 USD 당 원. USD 결제 완료 거래에만 있고 비어 있을 수 있다(없으면 원화로 바꾸지 않고 unknowns 에 적는다 — 0 으로 두지 않는다).
//   · 취소(isCancellation:true): 원래 유형을 유지하고 원거래는 목록에 나오지 않는다 → 원거래 + 취소 = 계좌에 남는 효과 0 이므로 취소 행은 모든 합계에서 뺀다(cancellations 로만 센다).
//     반대 방향 새 거래로 처리한 경우는 isCancellation:false 로 둘 다 나오므로 그대로 더한다(문서 설명).
//   · 미결제(settled:false)는 매매(BUY·SELL)뿐이고 단가·환율·시각이 비어 있으며 국내는 결제 뒤 여러 건으로 바뀔 수 있다 → 결제 뒤에 센다(pending 으로만 센다).
//   · DEPOSIT·WITHDRAWAL 중 assetClass 가 있는 것(채권 만기 원리금 · 채권 이자 세금)은 은행 입출금이 아니라 종목에서 나온 돈이라 원금에 넣지 않는다(securityCashKrw · 손익 쪽).
//   · EXCHANGE_IN·EXCHANGE_OUT(환전)은 계좌 안 통화 이동이라 원금이 아니다(환전 차이는 손익의 '그 밖'으로 남는다).
//   · SECURITIES_TRANSFER_IN·_OUT(타사 이관·주식배당 등)은 문서상 amount 가 null 이다 → 금액이 있을 때만 원금 ±, 없으면 unknowns(transfer_no_value) · 그 종목 평균 단가는 모름으로 둔다.
// 실현손익(이동평균법): 종목(통화 + symbol, 없으면 isinCode)별로 결제 처리 시각(transactionTime) 순서대로 매수 금액(amount)을 더해 평균 단가를 만들고,
//   매도 한 건의 실현손익 = 매도 금액 − 평균 단가 × 수량(그 통화) → 미국은 그 매도 거래 환율로 원화 → − 그 매도의 수수료·세금(원화). 매수 수수료·세금은 tradeCostsKrw 에만(실현손익에 넣지 않음).
//   같은 시각이면 매수·입고를 매도·출고보다 먼저 센다(결제 처리 시각은 체결 시각이 아니다). 월('YYYY-MM')·연('YYYY')은 그 매도의 처리 시각 KST 날짜.
//   amount 기준이라 옵션(1계약 = 100주)·채권도 같은 식으로 맞는다. 평균 단가는 산 날 환율이 아니라 달러 그대로 → 매수 뒤 환율 변화는 실현손익이 아니라 '그 밖'으로 간다(RR2 와 같은 뜻).
// 이상한 값(모르는 유형·통화, 숫자가 아닌 금액, 음수, 날짜 모양이 아님)은 0 으로 두지 않고 던진다 — 원금을 틀리게 보여 주느니 추정(RR2)으로 돌아간다.
export const TOSS_LEDGER_VERSION = 'TL1-2026-11-26';
export const TX_TYPES = ['BUY', 'SELL', 'SECURITIES_TRANSFER_IN', 'SECURITIES_TRANSFER_OUT', 'DEPOSIT', 'WITHDRAWAL', 'EXCHANGE_IN', 'EXCHANGE_OUT', 'DIVIDEND', 'INTEREST', 'FEE'];
export class LedgerError extends Error { constructor(message) { super(`거래내역 형식 오류: ${message}`); this.code = 'invalid_transaction'; } }
const DEC = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/, YMD = /^\d{4}-\d{2}-\d{2}$/, EPS = 1e-9;
/** 부호 없는 10진 숫자(문자열 · 쉼표 허용) 또는 null. 공백·16진·음수·NaN 은 던진다. */
function dec(v, field, nullable) {
  if (v === null || v === undefined) { if (nullable) return null; throw new LedgerError(`${field} 없음`); }
  const s = typeof v === 'string' ? v.replace(/,/g, '').trim() : null;
  if (s !== null && !DEC.test(s)) throw new LedgerError(`${field} 숫자 아님`);
  const n = s !== null ? Number(s) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n) || n < 0) throw new LedgerError(`${field} 숫자 아님`);
  return n;
}
const kstDate = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const RANK = { DEPOSIT: 0, EXCHANGE_IN: 1, EXCHANGE_OUT: 1, SECURITIES_TRANSFER_IN: 2, BUY: 3, SELL: 4, SECURITIES_TRANSFER_OUT: 5, DIVIDEND: 6, INTEREST: 6, FEE: 7, WITHDRAWAL: 8 };

function parseRow(t, i) {
  if (!t || typeof t !== 'object') throw new LedgerError(`${i}번째 행`);
  if (!TX_TYPES.includes(t.transactionType)) throw new LedgerError('거래 유형');
  if (t.currency !== 'KRW' && t.currency !== 'USD') throw new LedgerError('통화');
  if (typeof t.settled !== 'boolean' || typeof t.isCancellation !== 'boolean') throw new LedgerError('결제·취소 여부');
  if (typeof t.settlementDate !== 'string' || !YMD.test(t.settlementDate) || !Number.isFinite(Date.parse(t.settlementDate))) throw new LedgerError('결제일');
  let ms = null;
  if (t.transactionTime !== null && t.transactionTime !== undefined) { ms = typeof t.transactionTime === 'string' ? Date.parse(t.transactionTime) : NaN; if (!Number.isFinite(ms)) throw new LedgerError('거래 시각'); }
  const rate = dec(t.exchangeRate, 'exchangeRate', true);
  if (rate !== null && !(rate > 0)) throw new LedgerError('환율');
  const key = typeof t.symbol === 'string' && t.symbol ? t.symbol : typeof t.isinCode === 'string' && t.isinCode ? t.isinCode : null;
  return {
    i, type: t.transactionType, currency: t.currency, settled: t.settled, cancel: t.isCancellation, assetClass: t.assetClass ?? null, key,
    // 처리 시각이 없으면(미결제 · 그 밖 이상한 경우) 결제일 KST 자정
    ms: ms ?? Date.parse(`${t.settlementDate}T00:00:00+09:00`),
    quantity: dec(t.quantity, 'quantity', true), amount: dec(t.amount, 'amount', true), net: dec(t.netAmount, 'netAmount', true),
    commission: dec(t.commission, 'commission', false), tax: dec(t.tax, 'tax', false), rate,
  };
}

/**
 * @param transactions 토스 거래내역 배열(여러 페이지를 이은 것 · 순서 무관)
 * @param now          () => ms — asOf 에 쓴다
 * @returns 합계만. 원화 숫자는 원 단위 정수(Math.round). 달러 거래는 그 거래 환율로 바꾼 값.
 */
export function ledgerFromTransactions(transactions, { now = () => Date.now() } = {}) {
  if (!Array.isArray(transactions)) throw new LedgerError('목록 아님');
  const rows = transactions.map(parseRow);
  const counts = Object.fromEntries(TX_TYPES.map(t => [t, 0])); let cancellations = 0, pending = 0;
  const unknown = new Map(); // reason|type|currency → {reason, type, currency, count, symbols:Set}
  const flag = (reason, r) => { const k = `${reason}|${r.type}|${r.currency}`; const u = unknown.get(k) || { reason, type: r.type, currency: r.currency, count: 0, symbols: new Set() }; u.count++; if (r.key) u.symbols.add(r.key); unknown.set(k, u); };
  const live = [];
  for (const r of rows) { if (r.cancel) { cancellations++; continue; } if (!r.settled) { pending++; continue; } counts[r.type]++; live.push(r); }
  // 목록은 최신순(미결제 먼저)이라 같은 시각·같은 순위면 목록에서 뒤에 있는 것이 먼저 일어난 것으로 본다
  live.sort((a, b) => a.ms - b.ms || RANK[a.type] - RANK[b.type] || b.i - a.i);
  const krw = (r, v) => (r.currency === 'KRW' ? v : r.rate ? v * r.rate : null);
  const cashOf = r => { const v = r.net ?? r.amount; if (v === null) throw new LedgerError(`${r.type} 금액 없음`); return v; };
  const pos = new Map(), P = r => { const k = `${r.currency}:${r.key}`; if (!pos.has(k)) pos.set(k, { qty: 0, cost: 0, costUnknown: false }); return pos.get(k); };
  const close = p => { if (p.qty < EPS) { p.qty = 0; p.cost = 0; p.costUnknown = false; } };
  let deposits = 0, withdrawals = 0, transfersIn = 0, transfersOut = 0, securityCash = 0, dividends = 0, interest = 0, fees = 0, tradeCosts = 0, realized = 0, realizedSells = 0, realizedUnknownSells = 0;
  const realizedByMonth = {}, realizedByYear = {}, principalByMonth = {};
  const addP = (r, v) => { const m = kstDate(r.ms).slice(0, 7); principalByMonth[m] = (principalByMonth[m] || 0) + v; };
  for (const r of live) {
    const fee = r.commission + r.tax;
    switch (r.type) {
      case 'DEPOSIT': case 'WITHDRAWAL': {
        const v = krw(r, cashOf(r)), sign = r.type === 'DEPOSIT' ? 1 : -1;
        if (v === null) { flag('usd_no_rate', r); break; }
        if (r.assetClass) { securityCash += sign * v; break; } // 채권 만기 원리금·채권 이자 세금 = 종목에서 나온 돈
        if (sign > 0) deposits += v; else withdrawals += v; addP(r, sign * v); break;
      }
      case 'EXCHANGE_IN': case 'EXCHANGE_OUT': break;
      case 'DIVIDEND': case 'INTEREST': case 'FEE': {
        const v = krw(r, cashOf(r)); if (v === null) { flag('usd_no_rate', r); break; }
        if (r.type === 'DIVIDEND') dividends += v; else if (r.type === 'INTEREST') interest += v; else fees += v; break;
      }
      case 'BUY': case 'SECURITIES_TRANSFER_IN': {
        if (!(r.quantity > 0)) throw new LedgerError(`${r.type} 수량`);
        if (r.type === 'BUY' && r.amount === null) throw new LedgerError('BUY 금액 없음');
        if (r.type === 'BUY') { const c = krw(r, fee); if (c === null) { if (fee > 0) flag('usd_no_rate_fee', r); } else tradeCosts += c; }
        if (!r.key) { flag('no_symbol', r); break; }
        const p = P(r); p.qty += r.quantity;
        if (r.amount !== null) { p.cost += r.amount; if (r.type === 'SECURITIES_TRANSFER_IN') { const v = krw(r, r.amount); if (v === null) flag('usd_no_rate', r); else { transfersIn += v; addP(r, v); } } }
        else { p.costUnknown = true; flag('transfer_no_value', r); }
        break;
      }
      case 'SELL': case 'SECURITIES_TRANSFER_OUT': {
        if (!(r.quantity > 0)) throw new LedgerError(`${r.type} 수량`);
        if (r.type === 'SELL' && r.amount === null) throw new LedgerError('SELL 금액 없음');
        if (r.type === 'SECURITIES_TRANSFER_OUT') { if (r.amount === null) flag('transfer_no_value', r); else { const v = krw(r, r.amount); if (v === null) flag('usd_no_rate', r); else { transfersOut += v; addP(r, -v); } } }
        if (!r.key) { if (r.type === 'SELL') { realizedUnknownSells++; flag('no_symbol', r); } break; }
        const p = P(r), matched = Math.min(r.quantity, p.qty), avg = p.qty > 0 ? p.cost / p.qty : null, wasUnknown = p.costUnknown;
        if (r.quantity > p.qty + EPS) flag('exceeds_holding', r); // 기록 밖에서 들어온 주식(조회 기간 · 입고 누락)
        if (r.type === 'SELL') {
          const c = krw(r, fee); if (c === null) { if (fee > 0) flag('usd_no_rate_fee', r); } else tradeCosts += c;
          const rateOk = r.currency === 'KRW' || r.rate;
          if (wasUnknown || avg === null || matched + EPS < r.quantity || !rateOk) { realizedUnknownSells++; if (!rateOk) flag('usd_no_rate', r); else if (wasUnknown) flag('cost_unknown', r); }
          else {
            const v = krw(r, r.amount - avg * matched) - (c ?? 0), m = kstDate(r.ms);
            realized += v; realizedSells++; realizedByMonth[m.slice(0, 7)] = (realizedByMonth[m.slice(0, 7)] || 0) + v; realizedByYear[m.slice(0, 4)] = (realizedByYear[m.slice(0, 4)] || 0) + v;
          }
        }
        if (avg !== null) p.cost -= avg * matched; p.qty -= matched; close(p);
        break;
      }
    }
  }
  const round = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, Math.round(v)]));
  const unknowns = [...unknown.values()].map(u => ({ ...u, symbols: [...u.symbols].slice(0, 20) }));
  const PRINCIPAL_REASONS = new Set(['transfer_no_value']), principalUnknown = unknowns.some(u => PRINCIPAL_REASONS.has(u.reason) || (u.reason === 'usd_no_rate' && ['DEPOSIT', 'WITHDRAWAL', 'SECURITIES_TRANSFER_IN', 'SECURITIES_TRANSFER_OUT'].includes(u.type)));
  const dates = live.map(r => kstDate(r.ms)).sort();
  return {
    version: TOSS_LEDGER_VERSION, method: 'transactions', asOf: new Date(now()).toISOString(), firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
    principalKrw: Math.round(deposits - withdrawals + transfersIn - transfersOut), depositsKrw: Math.round(deposits), withdrawalsKrw: Math.round(withdrawals), transfersInKrw: Math.round(transfersIn), transfersOutKrw: Math.round(transfersOut), principalByMonth: round(principalByMonth),
    realizedKrw: Math.round(realized), realizedByMonth: round(realizedByMonth), realizedByYear: round(realizedByYear), realizedSells, realizedUnknownSells,
    dividendsKrw: Math.round(dividends), interestKrw: Math.round(interest), feesKrw: Math.round(fees), tradeCostsKrw: Math.round(tradeCosts), securityCashKrw: Math.round(securityCash),
    counts, cancellations, pending, principalComplete: !principalUnknown, realizedComplete: realizedUnknownSells === 0, unknowns,
  };
}
