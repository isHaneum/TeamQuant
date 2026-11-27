// 토스 거래내역 → 원금·실현손익(2026-11-26 · TL1): ① 입출금 = 원금 · 환전·채권 현금은 원금 아님 ② 원화 매매 이동평균 · 일부 매도 뒤 평균 단가 · KST 월·연 ③ 달러 매매 환율 · 환율 없음
// ④ 배당·이자·수수료 합계 ⑤ 취소 행은 원거래와 함께 0 · 미결제는 결제 뒤 ⑥ 모르는 값(환율·입고 금액) ⑦ 이상한 값은 던짐 ⑧ 리더: GET 만 · 쪽 넘김 · 429 한 번 · 쪽 상한
// ⑨ real-record: 거래내역 원금(6시간 캐시 · 실패면 지난 합계) · 한 번도 못 읽으면 추정 그대로. 합성 자료만 · 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ledgerFromTransactions, TX_TYPES } from '../lib/toss-ledger.js';
import { createTossReader, TOSS_TX_TYPES } from '../lib/toss.js';
import { createTossRecordReader } from '../lib/toss-record-reader.js';
import { createRealRecord, TX_REFRESH_MS, TX_EARLY_MS, TX_PRINCIPAL_NOTE } from '../lib/real-record.js';
import { createLedgerStore } from '../lib/paper-live.js';

const tx = (type, o = {}) => ({ transactionType: type, marketCountry: o.currency === 'USD' ? 'US' : 'KR', currency: 'KRW', symbol: null, assetClass: null, isinCode: null, quantity: null, filledPrice: null, amount: null,
  commission: '0', tax: '0', netAmount: null, exchangeRate: null, settlementDate: '2026-09-10', settled: true, transactionTime: '2026-09-10T06:30:00+09:00', isCancellation: false, ...o });
const cash = (type, amount, o = {}) => tx(type, { amount, netAmount: amount, ...o });
const trade = (type, symbol, qty, amount, time, o = {}) => tx(type, { symbol, assetClass: 'STOCK', quantity: String(qty), filledPrice: null, amount, netAmount: amount, transactionTime: time, settlementDate: time.slice(0, 10), ...o });
const L = (rows, now = Date.parse('2026-11-26T03:00:00Z')) => ledgerFromTransactions(rows, { now: () => now });

test('① 원금 = 은행 입금 − 출금(달러는 그 거래 환율) · 환전·채권 만기·채권 세금은 원금 아님', () => {
  const l = L([
    cash('DEPOSIT', '4000000'), cash('WITHDRAWAL', '500000', { transactionTime: '2026-10-20T06:30:00+09:00', settlementDate: '2026-10-20' }),
    cash('EXCHANGE_OUT', '1385200'), cash('EXCHANGE_IN', '1000', { currency: 'USD', exchangeRate: '1385.2' }),
    cash('DEPOSIT', '100', { currency: 'USD', exchangeRate: '1400' }),
    cash('WITHDRAWAL', '180', { assetClass: 'BOND', isinCode: 'KR103501GA34', tax: '180' }), cash('DEPOSIT', '1000', { currency: 'USD', assetClass: 'BOND', isinCode: 'US912810TV08', exchangeRate: '1385.2' }),
  ]);
  assert.equal(l.method, 'transactions'); assert.equal(l.principalKrw, 4_000_000 - 500_000 + 140_000);
  assert.deepEqual([l.depositsKrw, l.withdrawalsKrw, l.transfersInKrw, l.transfersOutKrw], [4_140_000, 500_000, 0, 0]);
  assert.equal(l.securityCashKrw, Math.round(1000 * 1385.2 - 180), '채권 현금은 손익 쪽');
  assert.deepEqual(l.principalByMonth, { '2026-09': 4_140_000, '2026-10': -500_000 });
  assert.equal(l.counts.EXCHANGE_IN, 1); assert.equal(l.counts.EXCHANGE_OUT, 1); assert.equal(l.counts.DEPOSIT, 3);
  assert.deepEqual([l.firstDate, l.lastDate, l.asOf], ['2026-09-10', '2026-10-20', '2026-11-26T03:00:00.000Z']);
  assert.equal(l.principalComplete, true); assert.deepEqual(l.unknowns, []);
  assert.deepEqual(TX_TYPES, TOSS_TX_TYPES, '리더와 같은 유형 목록');
});

test('② 원화 매매: 이동평균 단가 · 일부 매도 뒤 평균 단가 유지 · 다시 사면 새 평균 · 매도 수수료·세금 차감 · 월·연은 KST', () => {
  const l = L([
    // 목록 순서는 최신순 — 함수가 시각 순으로 다시 센다
    trade('SELL', '005930', 20, '1500000', '2027-01-01T00:30:00+09:00', { commission: '3000', tax: '2700' }), // UTC 로는 2026-12-31
    trade('BUY', '005930', 5, '300000', '2026-10-05T06:30:00+09:00', { commission: '600' }),
    trade('SELL', '005930', 5, '400000', '2026-10-02T06:30:00+09:00', { commission: '800', tax: '720' }),
    trade('BUY', '005930', 10, '800000', '2026-09-20T06:30:00+09:00', { commission: '1600' }),
    trade('BUY', '005930', 10, '700000', '2026-09-15T06:30:00+09:00', { commission: '1400' }),
  ]);
  // 평균 75,000 → 5주 매도: 400,000 − 375,000 − 1,520 = 23,480 · 남은 15주 평균 75,000 + 5주 60,000 → 20주 평균 71,250 → 1,500,000 − 1,425,000 − 5,700 = 69,300
  assert.equal(l.realizedKrw, 23_480 + 69_300); assert.equal(l.realizedSells, 2); assert.equal(l.realizedUnknownSells, 0); assert.equal(l.realizedComplete, true);
  assert.deepEqual(l.realizedByMonth, { '2026-10': 23_480, '2027-01': 69_300 }); assert.deepEqual(l.realizedByYear, { 2026: 23_480, 2027: 69_300 });
  assert.equal(l.tradeCostsKrw, 1400 + 1600 + 1520 + 600 + 5700); assert.equal(l.principalKrw, 0, '매매는 원금이 아니다');
  // 같은 시각이면 매수를 먼저(결제 처리 시각은 체결 시각이 아니다)
  const same = L([trade('SELL', '000660', 1, '120', '2026-09-30T06:30:00+09:00'), trade('BUY', '000660', 1, '100', '2026-09-30T06:30:00+09:00')]);
  assert.equal(same.realizedKrw, 20); assert.deepEqual(same.unknowns, []);
});

test('③ 달러 매매: 평균 단가는 달러 · 매도 거래 환율로 원화 · 환율 없는 매도는 모름(0 아님)', () => {
  const l = L([
    trade('BUY', 'AAPL', 3, '567.36', '2026-10-01T06:30:00+09:00', { currency: 'USD', commission: '0.57', exchangeRate: '1386' }),
    trade('BUY', 'AAPL', 1, '200', '2026-10-03T06:30:00+09:00', { currency: 'USD', commission: '0.2' }), // 결제 완료인데 환율 null(문서 예시에 있음)
    trade('SELL', 'AAPL', 2, '420', '2026-10-10T06:30:00+09:00', { currency: 'USD', commission: '0.42', tax: '0.01', exchangeRate: '1400' }),
    trade('SELL', 'AAPL', 2, '380', '2026-10-12T06:30:00+09:00', { currency: 'USD' }),
  ]);
  // 평균 191.84 → (420 − 383.68) × 1400 − 0.43 × 1400 = 50,848 − 602
  assert.equal(l.realizedKrw, 50_246); assert.equal(l.realizedSells, 1); assert.equal(l.realizedUnknownSells, 1); assert.equal(l.realizedComplete, false);
  assert.deepEqual(l.realizedByMonth, { '2026-10': 50_246 });
  assert.equal(l.tradeCostsKrw, Math.round(0.57 * 1386 + 0.43 * 1400));
  assert.deepEqual(l.unknowns.map(u => [u.reason, u.type, u.currency, u.count, u.symbols]), [['usd_no_rate_fee', 'BUY', 'USD', 1, ['AAPL']], ['usd_no_rate', 'SELL', 'USD', 1, ['AAPL']]]);
  assert.equal(l.principalComplete, true, '매매의 환율 없음은 원금과 무관');
});

test('④ 배당·이자·수수료 합계(세후 정산 금액 · 달러는 그 거래 환율)', () => {
  const l = L([
    cash('DIVIDEND', '3610', { symbol: '005930', assetClass: 'STOCK', tax: '556', netAmount: '3054' }), cash('DIVIDEND', '12.5', { currency: 'USD', symbol: 'AAPL', assetClass: 'STOCK', exchangeRate: '1384.8' }),
    cash('INTEREST', '1230', { tax: '180', netAmount: '1050' }), cash('INTEREST', '21.25', { currency: 'USD', assetClass: 'BOND', exchangeRate: '1384.5' }),
    cash('FEE', '0.5', { currency: 'USD', exchangeRate: '1384.5' }),
  ]);
  assert.deepEqual([l.dividendsKrw, l.interestKrw, l.feesKrw], [3054 + 17_310, Math.round(1050 + 21.25 * 1384.5), Math.round(0.5 * 1384.5)]);
  assert.equal(l.principalKrw, 0);
});

test('⑤ 취소 행은 원거래와 함께 효과 0(모든 합계에서 뺌) · 반대 방향 새 거래는 둘 다 셈 · 미결제는 결제 뒤에 셈', () => {
  const l = L([
    cash('DEPOSIT', '1000000', { isCancellation: true }), cash('WITHDRAWAL', '300000', { isCancellation: true }),
    trade('BUY', '005930', 10, '700000', '2026-09-15T10:00:00+09:00', { isCancellation: true }),
    cash('DEPOSIT', '200000'), cash('WITHDRAWAL', '200000', { transactionTime: '2026-09-11T06:30:00+09:00' }),
    trade('BUY', '005930', 2, '140000', '2026-09-16T06:30:00+09:00'),
    tx('SELL', { symbol: '005930', assetClass: 'STOCK', quantity: '2', amount: '150000', netAmount: '149000', settled: false, transactionTime: null, settlementDate: '2026-11-28' }),
  ]);
  assert.equal(l.cancellations, 3); assert.equal(l.pending, 1);
  assert.deepEqual([l.principalKrw, l.depositsKrw, l.withdrawalsKrw], [0, 200_000, 200_000]);
  assert.equal(l.realizedKrw, 0); assert.equal(l.realizedSells, 0, '결제 전 매도는 아직 실현손익 아님'); assert.equal(l.counts.BUY, 1, '취소된 매수는 세지 않는다'); assert.equal(l.counts.SELL, 0);
});

test('⑥ 모르는 값: 환율 없는 달러 입금 · 금액 없는 증권 입고(원금 미완) · 그 주식 매도는 실현손익 모름 · 기록보다 많이 판 매도', () => {
  const l = L([
    cash('DEPOSIT', '1000000'), cash('DEPOSIT', '50', { currency: 'USD' }),
    tx('SECURITIES_TRANSFER_IN', { symbol: '035420', assetClass: 'STOCK', quantity: '10', transactionTime: '2026-09-12T10:30:00+09:00' }),
    trade('SELL', '035420', 5, '1000000', '2026-09-20T06:30:00+09:00'),
    trade('SELL', '000270', 3, '300000', '2026-09-21T06:30:00+09:00'),
    tx('SECURITIES_TRANSFER_IN', { symbol: '005380', assetClass: 'STOCK', quantity: '1', amount: '250000', transactionTime: '2026-09-13T10:30:00+09:00' }),
  ]);
  assert.equal(l.principalKrw, 1_000_000 + 250_000, '금액 있는 입고만 원금'); assert.equal(l.transfersInKrw, 250_000); assert.equal(l.principalComplete, false);
  const by = Object.fromEntries(l.unknowns.map(u => [`${u.reason}:${u.type}`, u.count]));
  assert.deepEqual(by, { 'usd_no_rate:DEPOSIT': 1, 'transfer_no_value:SECURITIES_TRANSFER_IN': 1, 'cost_unknown:SELL': 1, 'exceeds_holding:SELL': 1 });
  assert.equal(l.realizedUnknownSells, 2); assert.equal(l.realizedKrw, 0);
  // 출력은 합계만 — 거래 행·주문번호·계좌번호 없음
  assert.deepEqual(Object.keys(l).sort(), ['asOf', 'cancellations', 'counts', 'depositsKrw', 'dividendsKrw', 'feesKrw', 'firstDate', 'interestKrw', 'lastDate', 'method', 'pending', 'principalByMonth', 'principalComplete', 'principalKrw', 'realizedByMonth', 'realizedByYear', 'realizedComplete', 'realizedKrw', 'realizedSells', 'realizedUnknownSells', 'securityCashKrw', 'tradeCostsKrw', 'transfersInKrw', 'transfersOutKrw', 'unknowns', 'version', 'withdrawalsKrw']);
  assert.ok(!JSON.stringify(l).includes('transactionType'));
});

test('⑦ 이상한 값은 0 이 아니라 던진다', () => {
  const ok = cash('DEPOSIT', '1000');
  for (const bad of [{ amount: '-5', netAmount: '-5' }, { amount: ' ', netAmount: ' ' }, { netAmount: '0x10', amount: '16' }, { amount: null, netAmount: null }, { transactionType: 'FOO' }, { currency: 'JPY' }, { settled: 'yes' }, { isCancellation: null },
    { settlementDate: '2026/09/10' }, { transactionTime: 'yesterday' }, { commission: null }, { exchangeRate: '0', currency: 'USD' }, { exchangeRate: 'abc', currency: 'USD' }])
    assert.throws(() => L([{ ...ok, ...bad }]), e => e.code === 'invalid_transaction', JSON.stringify(bad));
  assert.throws(() => L([trade('BUY', '005930', 0, '100', '2026-09-15T06:30:00+09:00')]), e => e.code === 'invalid_transaction', '수량 0');
  assert.throws(() => L([trade('SELL', '005930', 1, null, '2026-09-15T06:30:00+09:00')]), e => e.code === 'invalid_transaction', '매도 금액 없음');
  assert.throws(() => L(null), e => e.code === 'invalid_transaction');
  assert.equal(L([{ ...ok, amount: '1,000', netAmount: '1,000' }]).principalKrw, 1000, '쉼표 숫자');
  assert.deepEqual(L([]).firstDate, null);
});

test('⑧ 리더 read.transactions: GET /api/v1/transactions 만(계좌 머리글) · nextCursor 로 끝까지 · 간격 · 429 한 번 재시도 · 쪽 상한 · 응답 모양 검사', async () => {
  const calls = [], sleeps = []; let time = 1_000_000, limited = 0, mode = 'normal';
  const page = (n, more) => ({ transactions: [cash('DEPOSIT', String(n))], hasNext: more, nextCursor: more ? `cur_${n}` : null });
  const reader = createTossReader({ now: () => time, sleep: async ms => { sleeps.push(ms); }, credentials: async () => ({ clientId: 'fake-id', clientSecret: 'fake-secret' }),
    fetchImpl: async (url, options) => { calls.push({ url, options });
      if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'fake-token', expires_in: 86400 }) };
      if (url.endsWith('/accounts')) return { ok: true, json: async () => ({ result: [{ accountNo: 'private-no', accountSeq: 7, accountType: 'BROKERAGE' }] }) };
      if (url.includes('/transactions') && limited > 0) { limited--; return { ok: false, status: 429, headers: { get: k => (k === 'retry-after' ? '2' : null) }, json: async () => ({}) }; }
      const cur = new URL(url).searchParams.get('cursor');
      const result = mode === 'endless' ? page(Number((cur || 'cur_0').split('_')[1]) + 1, true) : mode === 'noCursor' ? { transactions: [], hasNext: true, nextCursor: null } : mode === 'noArray' ? { hasNext: false }
        : !cur ? page(1, true) : cur === 'cur_1' ? page(2, true) : page(3, false);
      return { ok: true, json: async () => ({ result }) }; } });
  limited = 1;
  const rows = await reader.transactions({ types: ['DEPOSIT', 'WITHDRAWAL'], from: '2026-01-01' });
  assert.deepEqual(rows.map(r => r.amount), ['1', '2', '3']);
  const tq = calls.filter(c => c.url.includes('/api/v1/transactions'));
  assert.equal(tq.length, 4, '3쪽 + 429 다시 1번');
  const q = new URL(tq.at(-1).url).searchParams; assert.equal(q.get('limit'), '100'); assert.equal(q.get('transactionTypes'), 'DEPOSIT,WITHDRAWAL'); assert.equal(q.get('from'), '2026-01-01'); assert.equal(q.get('cursor'), 'cur_2'); assert.equal(q.get('to'), null);
  assert.equal(new URL(tq[0].url).searchParams.get('cursor'), null, '첫 쪽은 커서 없음');
  assert.ok(tq.every(c => c.options.method === 'GET' && !('body' in c.options) && c.options.headers['X-Tossinvest-Account'] === '7'));
  assert.ok(calls.every(c => c.options.method === 'GET' || c.url.endsWith('/oauth2/token')), 'POST 는 토큰 발급뿐');
  assert.ok(calls.every(c => !c.url.includes('/orders')), '주문 경로에 닿지 않는다');
  assert.ok(sleeps.includes(2000), 'Retry-After 2초'); assert.ok(sleeps.filter(ms => ms !== 2000).every(ms => ms > 0 && ms <= 400), `쪽 사이 간격: ${sleeps}`);
  limited = 2; await assert.rejects(reader.transactions(), e => e.code === 'rate_limited', '두 번 연속 429 면 실패');
  mode = 'endless'; await assert.rejects(reader.transactions({ maxPages: 3 }), e => e.code === 'too_many_pages', '쪽 상한을 넘으면 반쪽 목록을 주지 않는다');
  mode = 'noCursor'; await assert.rejects(reader.transactions(), e => e.code === 'invalid_response');
  mode = 'noArray'; await assert.rejects(reader.transactions(), e => e.code === 'invalid_response');
  for (const bad of [{ from: '2026-1-1' }, { from: '2026-02-01', to: '2026-01-01' }, { types: ['BUY', 'FOO'] }, { types: [] }, { limit: 0 }, { limit: 101 }, { maxPages: 101 }]) await assert.rejects(reader.transactions(bad), Error, JSON.stringify(bad));
  const rr = createTossRecordReader({ read: reader }); assert.equal(typeof rr.transactions, 'function', '기록 리더가 그대로 넘긴다');
  const noTx = async () => ({}); noTx.orders = async () => ({ orders: [] }); assert.equal(typeof createTossRecordReader({ read: noTx }).transactions, 'undefined');
});

// ⑨ real-record 통합
const pos = (symbol, currency, quantity, price, avgCost = price) => ({ symbol, name: symbol, currency, quantity, price, value: quantity * price, avgCost });
function fakeToss(st) {
  const read = async () => ({ positions: st.positions.map(p => ({ ...p })), fx: { midRate: st.rate }, cashKnown: false, fetchedAt: '2026-11-27T06:00:00.000Z' });
  read.orders = async () => ({ orders: [] });
  read.cash = async c => st.cash[c];
  if (st.tx !== undefined) read.transactions = async opts => { st.txCalls.push(opts); if (st.txFail) { const e = new Error('조회 실패'); e.code = st.txFail; throw e; } return st.tx.map(r => ({ ...r })); };
  return read;
}
function flat(close) { const out = []; for (let t = Date.parse('2025-11-01'); t <= Date.parse('2027-03-31'); t += 864e5) out.push({ date: new Date(t).toISOString().slice(0, 10), open: close, close }); return out; }
const readMarket = async s => ({ candles: flat(s === 'KRW=X' ? 1300 : 100) });
const store = () => createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-txl-')), { prefix: 'real' });
const at = d => Date.parse(`${d}T06:00:00Z`);
const history = [
  cash('DEPOSIT', '3000000', { transactionTime: '2026-08-01T09:00:00+09:00', settlementDate: '2026-08-01' }), cash('WITHDRAWAL', '400000', { transactionTime: '2026-10-01T09:00:00+09:00', settlementDate: '2026-10-01' }),
  trade('BUY', '005930', 10, '700000', '2026-08-05T06:30:00+09:00'), trade('SELL', '005930', 10, '750000', '2026-09-05T06:30:00+09:00'),
  cash('DIVIDEND', '10000', { symbol: 'AAPL', assetClass: 'STOCK' }), cash('DEPOSIT', '999999', { isCancellation: true }),
];

test('⑨ real-record: 원금은 거래내역(입금 − 출금) · 총손익 = 총자산 − 원금 · 6시간에 한 번만 읽음 · 실패면 지난 합계 · 응답에 거래 행 없음', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100, 80), pos('000660', 'KRW', 10, 70000)], rate: 1400, cash: { KRW: 500_000, USD: 250 }, tx: history, txCalls: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status();
  assert.equal(s.error, null); assert.equal(s.balance.total, 2_950_000); assert.equal(s.marks.length, 1); assert.equal(s.chainCheck.ok, true);
  assert.deepEqual(st.txCalls, [{}], '전체 기간 · 전체 유형 한 번');
  const p = s.principal;
  assert.deepEqual({ krw: p.krw, method: p.method, since: p.since, deposits: p.deposits, withdrawals: p.withdrawals, transfersIn: p.transfersIn, transfersOut: p.transfersOut, complete: p.complete, cancellations: p.cancellations, estimatedKrw: p.estimatedKrw, fetchError: p.fetchError },
    { krw: 2_600_000, method: 'transactions', since: '2026-08-01', deposits: 3_000_000, withdrawals: 400_000, transfersIn: 0, transfersOut: 0, complete: true, cancellations: 1, estimatedKrw: 2_670_000, fetchError: null });
  assert.equal(p.asOf, new Date(t).toISOString()); assert.equal(p.note, TX_PRINCIPAL_NOTE); assert.deepEqual(p.byMonth, { '2026-08': 3_000_000, '2026-10': -400_000 });
  const r = s.returns;
  assert.deepEqual([r.method, r.totalPnlKrw, r.returnPct, r.realizedKrw, r.unrealizedKrw, r.dividendsKrw, r.interestKrw, r.feesKrw, r.otherKrw], ['transactions', 350_000, 13.46, 50_000, 280_000, 10_000, 0, 0, 10_000]);
  assert.deepEqual(r.realizedByMonth, { '2026-09': 50_000 }); assert.deepEqual(r.realizedByYear, { 2026: 50_000 });
  assert.deepEqual([r.since, r.asOf, r.twrSince, r.totalKrw], ['2026-08-01', '2026-11-27', '2026-11-27', 2_950_000]); assert.equal(r.twrPct, 0);
  for (const k of ['realizedUnknownSells', 'note', 'twrPct']) assert.ok(k in r, `기존 필드 ${k} 유지`);
  const text = JSON.stringify(s); assert.ok(!text.includes('transactionType') && !text.includes('settlementDate') && !text.includes('isCancellation'), '응답에 거래 행 없음');
  // 6시간 안에는 다시 읽지 않는다 · 지나면 읽는다 · 실패하면 지난 합계 + fetchError
  t += 3600e3; s = await rec.status(); assert.equal(st.txCalls.length, 1);
  t += TX_REFRESH_MS; st.txFail = 'rate_limited'; s = await rec.status(); assert.equal(st.txCalls.length, 2);
  assert.equal(s.principal.method, 'transactions'); assert.equal(s.principal.krw, 2_600_000); assert.equal(s.principal.fetchError, 'rate_limited'); assert.equal(s.returns.method, 'transactions');
  t += 60e3; s = await rec.status(); assert.equal(st.txCalls.length, 2, '실패도 6시간에 한 번');
  t += TX_REFRESH_MS; st.txFail = null; st.tx = [...history, cash('DEPOSIT', '100000', { transactionTime: '2026-11-27T09:00:00+09:00', settlementDate: '2026-11-27' })]; s = await rec.status();
  assert.equal(s.principal.krw, 2_700_000); assert.equal(s.principal.fetchError, null);
});

test('⑨ real-record 대체 경로: 한 번도 못 읽으면 추정(estimated) 그대로 + 사유 코드 · 형식 오류도 같음 · transactions 없는 리더는 예전 그대로', async () => {
  const t = at('2026-11-27'), base = { positions: [pos('AAPL', 'USD', 10, 100, 80), pos('000660', 'KRW', 10, 70000)], rate: 1400, cash: { KRW: 500_000, USD: 250 } };
  let st = { ...base, tx: history, txCalls: [], txFail: 'upstream_failed' };
  let s = await createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t }).status();
  assert.equal(s.principal.method, 'estimated'); assert.equal(s.principal.krw, 2_670_000); assert.equal(s.principal.fetchError, 'upstream_failed');
  assert.deepEqual([s.returns.method, s.returns.dividendsKrw, s.returns.interestKrw, s.returns.feesKrw, s.returns.totalPnlKrw], ['estimated', null, null, null, 280_000]);
  st = { ...base, tx: [{ ...cash('DEPOSIT', '1000'), amount: 'oops', netAmount: 'oops' }], txCalls: [] };
  s = await createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t }).status();
  assert.equal(s.principal.method, 'estimated'); assert.equal(s.principal.fetchError, 'invalid_transaction', '이상한 행은 원금을 틀리게 하지 않고 추정으로');
  st = { ...base, txCalls: [] };
  s = await createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t }).status();
  assert.equal(s.principal.method, 'estimated'); assert.ok(!('fetchError' in s.principal)); assert.equal(s.returns.method, 'estimated');
});

test('⑩ real-record: 읽은 뒤 새 추정 입출금이 보이면 10분 뒤 일찍 다시 읽음(넣은 돈이 손익으로 오래 보이지 않게) · 기록보다 많이 판 매도는 원금 미완', async () => {
  let t = Date.parse('2026-11-27T14:50:00Z'); // 23:50 KST
  const st = { positions: [pos('AAPL', 'USD', 10, 100, 80), pos('000660', 'KRW', 10, 70000)], rate: 1400, cash: { KRW: 500_000, USD: 250 }, tx: history, txCalls: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status(); assert.equal(st.txCalls.length, 1); assert.equal(s.principal.complete, true);
  t += 20 * 60e3; s = await rec.status(); assert.equal(st.txCalls.length, 1, '다음 날 첫 평가점에 입출금이 없으면 다시 읽지 않는다');
  st.cash.KRW += 1_000_000; t += 60e3; s = await rec.status(); assert.equal(st.txCalls.length, 2, '새 추정 입출금 → 일찍 다시 읽음');
  t += 60e3; s = await rec.status(); assert.equal(st.txCalls.length, 2, '같은 입출금으로는 다시 읽지 않는다');
  st.cash.KRW += 500_000; t += 60e3; s = await rec.status(); assert.equal(st.txCalls.length, 2, `${TX_EARLY_MS / 60e3}분 안에는 다시 읽지 않는다`);
  t += TX_EARLY_MS; s = await rec.status(); assert.equal(st.txCalls.length, 3);
  // 거래내역 밖에서 들어온 주식(기록보다 많이 판 매도)은 원금을 '일부 모름'으로
  st.tx = [...history, trade('SELL', '035420', 5, '1000000', '2026-11-20T06:30:00+09:00')]; t += TX_REFRESH_MS; s = await rec.status();
  assert.equal(st.txCalls.length, 4); assert.equal(s.principal.complete, false); assert.ok(s.principal.unknowns.some(u => u.reason === 'exceeds_holding'));
});
