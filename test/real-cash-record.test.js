// 실계좌 기록에 현금 넣기(2026-11-26 · TR2/RR2): ① 토스 리더 read.cash 는 GET buying-power 만(주문 경로 없음) ② cash = 원화 + 달러 × 환율 · total = 주식 + 현금 ③ 현금 조회 실패 → 평가점 없음(fail-closed)
// ④ 입금은 수익이 아니라 추정 입출금 ⑤ 매도는 주식 → 현금(총자산 그대로) + 실현손익 ⑥ 실현손익 월·연 ⑦ 시간가중 비교선은 입금에 흔들리지 않음 ⑧ 옛 평가점(현금 없음)은 그대로 · 원금은 첫 현금 평가점부터
// ⑨ 미체결 매수 주문이 잡은 금액은 출금처럼 보였다가 다음 날 되돌아옴 ⑩ 한투 리더는 예전 그대로. 합성 자료만 · 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTossReader } from '../lib/toss.js';
import { createTossRecordReader, TOSS_CASH_NOTE, TOSS_HOLDINGS_ONLY_NOTE } from '../lib/toss-record-reader.js';
import { createRealRecord, FLOW_FLOOR_KRW } from '../lib/real-record.js';
import { createLedgerStore } from '../lib/paper-live.js';

const pos = (symbol, currency, quantity, price, avgCost = price) => ({ symbol, name: symbol, currency, quantity, price, value: quantity * price, avgCost });
function fakeToss(st, { cash = true } = {}) {
  const read = async () => ({ positions: st.positions.map(p => ({ ...p })), fx: st.rate ? { midRate: st.rate } : null, cashKnown: false, fetchedAt: '2026-11-27T06:00:00.000Z' });
  read.orders = async q => { st.queries.push(q); return { orders: st.orders || [] }; };
  if (cash) read.cash = async c => { if (st.cashFail?.[c]) { const e = new Error('조회 실패'); e.code = st.cashFail[c]; throw e; } return st.cash[c]; };
  return read;
}
const order = (ref, symbol, side, currency, qty, price, commission = null) => ({ ref: ref.repeat(64), symbol, side, currency, quantity: qty, execution: { filledQuantity: qty, averageFilledPrice: price, commission, tax: null } });
function flat(close) { const out = []; for (let t = Date.parse('2025-11-01'); t <= Date.parse('2027-03-31'); t += 864e5) out.push({ date: new Date(t).toISOString().slice(0, 10), open: close, close }); return out; }
const readMarket = async s => ({ candles: flat(s === 'KRW=X' ? 1300 : 100) });
const store = () => createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-cash-')), { prefix: 'real' });
const at = d => Date.parse(`${d}T06:00:00Z`); // 15:00 KST · 뉴욕도 같은 날짜
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('① 토스 리더 read.cash: GET /api/v1/buying-power 만(계좌 머리글 · 쉼표 숫자) · 주문 경로·본문 없음 · 계좌는 read() 가 찾은 것을 다시 씀 · 간격·429 한 번 재시도 · 이상한 값은 0 이 아니라 실패', async () => {
  const calls = [], sleeps = []; let time = 1_000_000, bp = { KRW: '1,234,567', USD: '987.65' }, limited = 0;
  const reader = createTossReader({ now: () => time, sleep: async ms => { sleeps.push(ms); }, credentials: async () => ({ clientId: 'fake-id', clientSecret: 'fake-secret' }),
    fetchImpl: async (url, options) => { calls.push({ url, options });
      if (url.includes('buying-power') && limited > 0) { limited--; return { ok: false, status: 429, headers: { get: k => (k === 'retry-after' ? '2' : null) }, json: async () => ({}) }; }
      const data = url.endsWith('/oauth2/token') ? { access_token: 'fake-token', expires_in: 86400 } : url.endsWith('/accounts') ? { result: [{ accountNo: 'private', accountSeq: 7, accountType: 'BROKERAGE' }] }
        : url.includes('buying-power?currency=') ? { result: { cashBuyingPower: bp[url.split('currency=')[1]] } } : url.includes('exchange-rate') ? { result: { midRate: '1300', validFrom: 'time' } }
        : { result: { items: [{ symbol: 'AAPL', name: 'Example', currency: 'USD', quantity: '1', averagePurchasePrice: '100', lastPrice: '120', marketValue: { purchaseAmount: '100', amount: '120' }, profitLoss: { amount: '20', rate: '.2' } }] } };
      return { ok: true, json: async () => data }; } });
  const snap = await reader(); assert.equal(snap.cashKnown, false, '화면용 보유 조회는 그대로 현금 없음(보유 기록 형식 유지)'); assert.ok(calls.every(c => !c.url.includes('buying-power')), 'read() 는 현금을 읽지 않는다');
  assert.equal(await reader.cash('KRW'), 1234567); assert.equal(await reader.cash('USD'), 987.65);
  const bps = calls.filter(c => c.url.includes('buying-power'));
  assert.deepEqual(bps.map(c => c.url.split('/api/v1/')[1]), ['buying-power?currency=KRW', 'buying-power?currency=USD']);
  assert.ok(bps.every(c => c.options.method === 'GET' && !('body' in c.options) && c.options.headers['X-Tossinvest-Account'] === '7'));
  assert.ok(calls.every(c => c.options.method === 'GET' || c.url.endsWith('/oauth2/token')), 'POST 는 토큰 발급뿐');
  assert.ok(calls.every(c => !c.url.includes('/orders')), '주문 경로에 닿지 않는다');
  assert.equal(calls.filter(c => c.url.endsWith('/accounts')).length, 1, '60초 안이면 read() 가 찾은 계좌를 다시 쓴다');
  assert.ok(sleeps.length === 2 && sleeps.every(ms => ms > 0 && ms <= 400), `직전 요청과 간격: ${sleeps}`);
  time += 61e3; limited = 1; sleeps.length = 0; assert.equal(await reader.cash('KRW'), 1234567, '429 면 한 번 다시'); assert.ok(sleeps.includes(2000), 'Retry-After 2초');
  assert.equal(calls.filter(c => c.url.endsWith('/accounts')).length, 2, '60초가 지나면 계좌를 다시 찾는다');
  limited = 2; await assert.rejects(reader.cash('KRW'), e => e.code === 'rate_limited', '두 번 연속 429 면 실패');
  for (const bad of [null, '', 'abc', '-5', undefined, ' ', '0x10', '12abc']) { bp.KRW = bad; await assert.rejects(reader.cash('KRW'), e => e.code === 'invalid_response', `값 ${bad}`); } // 공백·16진은 Number() 로는 0·16 이 되지만 실패여야 한다
  bp.KRW = '1E+7'; assert.equal(await reader.cash('KRW'), 1e7, '10진 지수 표기는 숫자');
  await assert.rejects(reader.cash('JPY'), /KRW 또는 USD/);
  assert.ok(!JSON.stringify(snap).includes('private'));
});

test('② 현금 포함: cash = 원화 + 달러 × 토스 환율 · total = 주식 + 현금 · cashKnown · 평가점·체인·비교선 현금 비중 · 시작 원금 = 현금 + 매입금액', async () => {
  const st = { positions: [pos('AAPL', 'USD', 10, 100, 80), pos('005930', 'KRW', 10, 70000)], rate: 1400, cash: { KRW: 500_000, USD: 250 }, queries: [] };
  const r = createTossRecordReader({ read: fakeToss(st) });
  const b = await r.balance({ fx: 1300 });
  assert.equal(b.cashKnown, true); assert.equal(b.fx, 1400, '토스 매매기준율 먼저'); assert.equal(b.cashKrw, 500_000); assert.equal(b.cashUsd, 250);
  assert.equal(b.cash, 500_000 + 250 * 1400); assert.equal(b.stockKrw, 10 * 100 * 1400 + 700_000); assert.equal(b.total, b.stockKrw + b.cash); assert.equal(b.note, TOSS_CASH_NOTE);
  assert.equal(typeof r.place, 'undefined'); assert.equal(typeof r.cancel, 'undefined');
  // 미국 보유가 없어도 달러 현금이 있으면 환율이 있어야 한다(없으면 total null → 보류)
  const usdOnly = createTossRecordReader({ read: fakeToss({ positions: [pos('005930', 'KRW', 1, 70000)], rate: null, cash: { KRW: 0, USD: 10 }, queries: [] }) });
  assert.equal((await usdOnly.balance({})).total, null); assert.equal((await usdOnly.balance({ fx: 1300 })).total, 70000 + 13000);

  const rec = createRealRecord({ reader: r, store: store(), readMarket, now: () => at('2026-11-27') });
  const s = await rec.status();
  assert.equal(s.error, null); assert.equal(s.markStale, false); assert.equal(s.balance.cashKnown, true); assert.equal(s.balance.total, 2_950_000); assert.equal(s.balance.cash, 850_000); assert.equal(s.balance.cashKrw, 500_000);
  const m = s.marks[0]; assert.deepEqual([m.total, m.cash, m.stock, m.cashKrw, m.cashUsd, m.cashKnown, m.index], [2_950_000, 850_000, 2_100_000, 500_000, 250, true, 1]);
  assert.equal(s.chain[0].payload.cash, 850_000); assert.equal(s.chain[0].payload.total, 2_950_000); assert.equal(s.chainCheck.ok, true);
  assert.deepEqual(s.baseline.benchmark.weights, { KR: 23.7, US: 47.5, cash: 28.8 }, '현금이 비교선 현금 비중으로 들어간다');
  // 평가손익 = 10 × (100 − 80) × 1400 = 280,000 → 시작 원금 = 2,950,000 − 280,000(현금 850,000 + 매입금액 1,820,000)
  assert.equal(m.unrealizedKrw, 280_000);
  assert.deepEqual({ krw: s.principal.krw, method: s.principal.method, since: s.principal.since, startKrw: s.principal.startKrw, flowsKrw: s.principal.flowsKrw }, { krw: 2_670_000, method: 'estimated', since: '2026-11-27', startKrw: 2_670_000, flowsKrw: 0 });
  assert.deepEqual([s.returns.totalPnlKrw, s.returns.realizedKrw, s.returns.unrealizedKrw, s.returns.otherKrw, s.returns.returnPct], [280_000, 0, 280_000, 0, 10.49]);
  assert.deepEqual(s.cashTracking.from, '2026-11-27'); assert.equal(s.cashTracking.baselineWithCash, true); assert.equal(s.cashTracking.holdingsOnlyMarks, 0);
  assert.match(s.principal.note, /추정/); assert.ok(!JSON.stringify(s).includes('private'));
});

test('③ 현금 조회 실패 → 평가점·봉인·기준선 없음(fail-closed) · 원화는 cash_failed, 달러는 us_cash_failed · 다음 정상 조회는 적는다 · 실패한 날은 마지막 정상 평가점 그대로', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100)], rate: 1300, cash: { KRW: 100_000, USD: 50 }, queries: [], cashFail: { KRW: 'upstream_failed' } };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status();
  assert.equal(s.error, null); assert.equal(s.markStale, true); assert.equal(s.staleReason, 'cash_failed'); assert.deepEqual(s.marks, []); assert.equal(s.chain.length, 0); assert.equal(s.baseline, null);
  assert.equal(s.balance.total, null, '현금 없는 총자산을 내지 않는다'); assert.equal(s.balance.cashKnown, false); assert.equal(s.balance.cashKrwError, 'upstream_failed'); assert.equal(s.principal, null); assert.equal(s.returns, null);
  st.cashFail = { USD: 'rate_limited' }; s = await rec.status(); assert.equal(s.staleReason, 'us_cash_failed'); assert.equal(s.balance.cashUsdError, 'rate_limited'); assert.equal(s.marks.length, 0);
  st.cashFail = null; t += 3600e3; s = await rec.status(); assert.equal(s.markStale, false); assert.equal(s.marks.length, 1); const total1 = s.marks[0].total; assert.equal(total1, 1_300_000 + 100_000 + 65_000);
  t += 864e5; st.cashFail = { KRW: 'invalid_response' }; s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.marks.length, 1); assert.equal(s.marks[0].total, total1); assert.equal(s.chain.length, 1);
  // 리더가 아예 현금을 못 읽는 모양(read.cash 없음)은 예전처럼 보유 주식만(cashKnown:false) — 실패와 구별
  const old = await createTossRecordReader({ read: fakeToss(st, { cash: false }) }).balance({}); assert.equal(old.cashKnown, false); assert.equal(old.cash, 0); assert.equal(old.total, 1_300_000); assert.equal(old.note, TOSS_HOLDINGS_ONLY_NOTE);
});

test('④⑦ 입금은 수익이 아니라 추정 입출금 · 출금도 · 1,000원 미만 나머지는 손익 · 시간가중 비교선은 입금에 흔들리지 않는다', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100)], rate: 1300, cash: { KRW: 0, USD: 0 }, queries: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status(); assert.equal(s.marks[0].total, 1_300_000);
  t += 864e5; st.cash.KRW = 1_000_000; s = await rec.status(); // 같은 가격에 100만 원 입금
  let m = s.marks.at(-1); assert.equal(m.total, 2_300_000); assert.equal(m.flowKrw, 1_000_000, '입금으로 추정'); assert.equal(m.index, 1, '입금은 수익이 아니다');
  assert.equal(s.principal.krw, 2_300_000); assert.equal(s.returns.totalPnlKrw, 0); assert.deepEqual(s.principal.flows, [{ date: '2026-11-28', krw: 1_000_000 }]);
  t += 864e5; st.positions[0] = pos('AAPL', 'USD', 10, 110, 100); s = await rec.status(); // 가격 +10%
  m = s.marks.at(-1); const idx = 2_430_000 / 2_300_000; assert.equal(m.flowKrw, 0); near(m.index, idx);
  assert.equal(s.benchmark.basis, 'twr'); assert.equal(s.benchmark.ownRetPct, Math.round((idx - 1) * 1e4) / 100); assert.equal(s.benchmark.benchRetPct, 0); assert.equal(s.benchmark.diffPp, s.benchmark.ownRetPct);
  assert.ok((2_430_000 / 1_300_000 - 1) * 100 > 80, '총자산 비율이었다면 +87% 로 부풀었을 것');
  assert.deepEqual([s.returns.totalPnlKrw, s.returns.unrealizedKrw, s.returns.returnPct, s.returns.twrPct], [130_000, 130_000, 5.65, 5.65]);
  t += 864e5; st.cash.KRW += 500; s = await rec.status(); // 작은 이자(1,000원 미만) → 입출금이 아니라 손익
  m = s.marks.at(-1); assert.ok(500 < FLOW_FLOOR_KRW); assert.equal(m.flowKrw, 0); near(m.index, idx * 2_430_500 / 2_430_000); const idx4 = m.index;
  t += 864e5; st.cash.KRW -= 400_000; s = await rec.status(); // 40만 원 출금
  m = s.marks.at(-1); assert.equal(m.flowKrw, -400_000); assert.equal(m.index, idx4, '출금은 손실이 아니다'); assert.equal(s.principal.krw, 1_900_000); assert.equal(s.principal.flowsKrw, 600_000);
  assert.deepEqual([s.returns.totalPnlKrw, s.returns.realizedKrw, s.returns.unrealizedKrw, s.returns.otherKrw], [130_500, 0, 130_000, 500], '이자 500원은 그 밖(other)');
  assert.equal(s.chainCheck.ok, true); assert.equal(s.chain.length, 5);
});

test('⑤ 매도는 주식 → 현금(총자산 그대로 · 입출금 0) · 실현손익 = 수량 × (체결가 − 전 평가점 평균 매입가) × 환율 · 수수료는 출금이 아니라 비용 · 다 판 종목은 판 값으로', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100, 80)], rate: 1300, cash: { KRW: 0, USD: 0 }, queries: [], orders: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status(); assert.equal(s.principal.krw, 1_300_000 - 260_000);
  // 같은 가격에 4주 매도 · 수수료 $1
  t += 864e5; st.positions = [pos('AAPL', 'USD', 6, 100, 80)]; st.cash.USD = 399; st.orders = [order('a', 'AAPL', 'SELL', 'USD', 4, 100, 1)]; s = await rec.status();
  let m = s.marks.at(-1); assert.equal(m.total, 1_298_700); assert.equal(m.flowKrw, 0, '판 돈은 입출금이 아니다 · 수수료도'); near(m.index, 1_298_700 / 1_300_000);
  assert.equal(m.realizedKrw, 4 * 20 * 1300); assert.deepEqual(s.chain.at(-1).payload.fills, [{ symbol: 'AAPL', side: 'SELL', qty: 4, avgPrice: 100 }]);
  assert.deepEqual([s.returns.totalPnlKrw, s.returns.realizedKrw, s.returns.unrealizedKrw, s.returns.otherKrw], [258_700, 104_000, 156_000, -1_300]);
  // 나머지 6주를 $105 에 다 팖(전 평가점은 $100) → 판 때까지 오른 것은 수익, 입출금 0
  t += 864e5; st.positions = []; st.cash.USD = 399 + 630; st.orders = [order('b', 'AAPL', 'SELL', 'USD', 6, 105)]; s = await rec.status();
  m = s.marks.at(-1); assert.equal(m.flowKrw, 0); near(m.index, 1_298_700 / 1_300_000 * (1_337_700 / 1_298_700)); assert.equal(m.realizedKrw, 6 * 25 * 1300); assert.equal(m.unrealizedKrw, 0);
  assert.deepEqual([s.returns.realizedKrw, s.returns.unrealizedKrw, s.returns.totalPnlKrw], [104_000 + 195_000, 0, 1_337_700 - 1_040_000]);
  const json = JSON.stringify(s); assert.ok(!json.includes('a'.repeat(64)) && !json.includes('b'.repeat(64)), '주문 ref 는 응답에 없다');
});

test('⑥ 실현손익 월·연: 매도를 확인한 날(KST) 기준으로 나눈다 · 평가점이 빈 날(PC 꺼짐)이 있으면 그 날짜들도 조회한다', async () => {
  let t = at('2026-11-29'); const st = { positions: [pos('AAPL', 'USD', 10, 100, 50)], rate: 1000, cash: { KRW: 0, USD: 0 }, queries: [], orders: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  await rec.status();
  t = at('2026-11-30'); st.positions = [pos('AAPL', 'USD', 9, 100, 50)]; st.cash.USD = 100; st.orders = [order('a', 'AAPL', 'SELL', 'USD', 1, 100)]; await rec.status();
  t = at('2026-12-01'); st.positions = [pos('AAPL', 'USD', 7, 110, 50)]; st.cash.USD = 320; st.orders = [order('b', 'AAPL', 'SELL', 'USD', 2, 110)]; await rec.status();
  t = at('2027-01-04'); st.positions = [pos('AAPL', 'USD', 6, 120, 50)]; st.cash.USD = 440; st.orders = [order('c', 'AAPL', 'SELL', 'USD', 1, 120)]; st.queries.length = 0; const s = await rec.status();
  assert.deepEqual(s.returns.realizedByMonth, { '2026-11': 50_000, '2026-12': 120_000, '2027-01': 70_000 });
  assert.deepEqual(s.returns.realizedByYear, { 2026: 170_000, 2027: 70_000 }); assert.equal(s.returns.realizedKrw, 240_000);
  assert.deepEqual(s.marks.map(m => m.flowKrw ?? null), [null, 0, 0, 0], '매도만 있었으므로 입출금 0');
  assert.deepEqual([s.principal.krw, s.returns.unrealizedKrw, s.returns.totalPnlKrw, s.returns.otherKrw], [500_000, 420_000, 660_000, 0]);
  assert.deepEqual(st.queries.map(q => q.from), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'], '빈 날은 오늘에 가까운 7일까지 오래된 날부터');
  st.queries.length = 0; t += 3600e3; await rec.status(); assert.deepEqual(st.queries.map(q => q.from), ['2027-01-03', '2027-01-04'], '끝난 빈 날은 다시 조회하지 않는다(어제는 다시)');
});

test('⑧ 옛 평가점(현금 없음 · 매도 뒤 판 돈이 안 보임)은 그대로 두고 · 지수는 이어지고 · 원금은 첫 현금 평가점부터 · 비교 구간의 보유 기준 평가점 수를 알려 준다', async () => {
  let t = at('2026-11-22'); const st = { positions: [pos('AAPL', 'USD', 10, 100, 100)], rate: 1300, cash: { KRW: 0, USD: 0 }, queries: [], orders: [] }, keep = store();
  let rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st, { cash: false }) }), store: keep, readMarket, now: () => t });
  let s = await rec.status(); assert.equal(s.balance.cashKnown, false); assert.equal(s.principal, null); assert.equal(s.returns, null);
  t = at('2026-11-23'); st.positions = [pos('AAPL', 'USD', 4, 100, 100)]; st.orders = [order('a', 'AAPL', 'SELL', 'USD', 6, 100)]; s = await rec.status(); // 6주 매도 → 옛 기록은 총자산 1,300,000 → 520,000(판 돈이 안 보임)
  assert.equal(s.marks.at(-1).total, 520_000); assert.equal(s.marks.at(-1).index, 1, '옛 방식도 매도를 손실로 세지 않았다'); const oldMarks = JSON.stringify(s.marks);
  // 서버가 새 코드로 다시 뜸(같은 장부) → 현금이 보인다
  t = at('2026-11-24'); st.cash.USD = 600; st.orders = []; rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: keep, readMarket, now: () => t }); s = await rec.status();
  assert.equal(JSON.stringify(s.marks.slice(0, 2)), oldMarks, '지난 평가점은 고치지 않는다'); assert.equal(s.chainCheck.ok, true); assert.equal(s.chainBreaks.length, 0);
  let m = s.marks.at(-1); assert.equal(m.total, 1_300_000); assert.equal(m.cashKnown, true); assert.equal(m.index, 1, '경계 하루는 보유 기준으로 잇는다'); assert.equal(m.flowKrw, undefined, '전 평가점의 현금을 몰라 입출금을 세지 않는다');
  assert.deepEqual([s.principal.since, s.principal.krw, s.returns.totalPnlKrw], ['2026-11-24', 1_300_000, 0]);
  assert.deepEqual(s.cashTracking, { from: '2026-11-24', holdingsOnlyMarks: 2, baselineWithCash: false, note: s.cashTracking.note }); assert.match(s.cashTracking.note, /보유 주식만/);
  t = at('2026-11-25'); st.cash.KRW = 200_000; s = await rec.status(); m = s.marks.at(-1); assert.equal(m.flowKrw, 200_000); assert.equal(m.index, 1); assert.equal(s.principal.krw, 1_500_000);
  assert.equal(s.benchmark.basis, 'twr'); assert.equal(s.benchmark.ownRetPct, 0, '판 돈의 이동·입금 모두 손익이 아니다'); assert.equal(s.benchmark.from, '2026-11-22');
});

test('⑨ 미체결 매수 주문이 잡은 금액: 그 평가점은 출금처럼 보이고 다음 평가점에서 입금으로 되돌아와 원금은 다시 같다 · 지수는 그대로', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100)], rate: 1000, cash: { KRW: 0, USD: 1000 }, queries: [], orders: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  let s = await rec.status(); assert.equal(s.principal.krw, 2_000_000);
  t += 864e5; st.cash.USD = 500; s = await rec.status(); assert.equal(s.marks.at(-1).flowKrw, -500_000); assert.equal(s.marks.at(-1).index, 1); // 5주 매수 주문이 $500 를 잡아 둠(아직 체결 전)
  t += 864e5; st.positions = [pos('AAPL', 'USD', 15, 100)]; st.orders = [order('a', 'AAPL', 'BUY', 'USD', 5, 100)]; s = await rec.status();
  assert.equal(s.marks.at(-1).flowKrw, 500_000); assert.equal(s.marks.at(-1).index, 1); assert.equal(s.principal.krw, 2_000_000, '합은 0'); assert.equal(s.returns.totalPnlKrw, 0);
});

test('⑩ 한투 리더(cashKnown 없음)는 예전 그대로: 지수·원금·현금 추적 없음', async () => {
  const reader = { settings: () => ({ mode: 'prod', readOnly: true, accountMasked: '****5678' }), orders: async () => [],
    balance: async () => ({ cash: 1_000_000, stock: 500_000, stockKrw: 500_000, totalKrwOnly: 1_500_000, stockUsd: 0, cashUsd: 0, usCostKrw: null, fx: 1300, total: 1_500_000, usError: null, cashUsdError: null, note: 'n', positions: [{ symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 5, valueKrw: 500_000 }] }) };
  const rec = createRealRecord({ reader, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-cash-')), { prefix: 'kis-prod' }), readMarket, now: () => at('2026-11-27') });
  const s = await rec.status(); assert.equal(s.marks[0].index, undefined); assert.equal(s.marks[0].holdings, undefined); assert.equal(s.principal, null); assert.equal(s.returns, null); assert.equal(s.cashTracking, null);
});

test('⑪ 주식 분할(체결 없이 수량 정수배 · 평가액 연속)은 입금·손실이 아니다 · 정수배가 아닌 수량 증가(타사 입고)는 입출금', async () => {
  let t = at('2026-11-27'); const st = { positions: [pos('AAPL', 'USD', 10, 100)], rate: 1000, cash: { KRW: 0, USD: 0 }, queries: [], orders: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: store(), readMarket, now: () => t });
  await rec.status();
  t += 864e5; st.positions = [pos('AAPL', 'USD', 20, 51, 50)]; let s = await rec.status(); // 2:1 분할 뒤 +2%
  let m = s.marks.at(-1); assert.deepEqual(m.splits, ['AAPL']); assert.equal(m.flowKrw, 0); near(m.index, 1.02); assert.equal(s.principal.krw, 1_000_000);
  t += 864e5; st.positions = [pos('AAPL', 'USD', 23, 51, 50)]; s = await rec.status(); // 3주 입고
  m = s.marks.at(-1); assert.equal(m.splits, undefined); assert.equal(m.flowKrw, 153_000); near(m.index, 1.02); assert.equal(s.principal.krw, 1_153_000);
});
