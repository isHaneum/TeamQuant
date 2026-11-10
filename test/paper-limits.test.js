// 한도·소멸·계획 집행(2026-11-10 결함 수정): ① 하루 한도는 시장별 거래일(국내 KST·미국 뉴욕)로 따로 센다 — 낮의 국내 재조정이 밤의 미국 주문을 막지 않는다
// ② 거래일이 끝났는데 증권사가 아직 'open' 인 당일 주문은 재조회가 '소멸(expired)'로 닫고, 다음 날 같은 종목 주문을 막지 않는다
// ③ 자동 실행이 한도·시간 문제로 전부 막혔으면 계획 버전을 적지 않아 다음 거래일 다시 시도한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore, PAPER_LIVE_VERSION } from '../lib/paper-live.js';
import { checkOrder, intentKey, DEFAULT_LIMITS, NOT_COUNTED } from '../lib/order-guard.js';
import { systemCheck } from '../lib/paper-integrity.js';

function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const isKr = code => /^\d{6}$/.test(code);
/** 가짜 증권사: 주문은 접수되고 'open' 으로 남는다. fill(odno, qty) 로 체결시킬 수 있고, state.bpQty 로 주문 가능 수량을, state.listFail 로 조회 장애를 흉내 낸다. */
function broker({ cash = 50_000_000, positions = [] } = {}) {
  const orders = []; let seq = 700; const state = { cash, positions, placed: [], bpQty: 1e6, listFail: false, hide: false };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { const us = !isKr(code); return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NASD' : null, price: us ? 100 : 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), stock: state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), positions: state.positions, cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: state.bpQty, cashQty: state.bpQty }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); const odno = String(++seq); orders.push({ market: isKr(code) ? 'KR' : 'US', odno, orgno: '', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); return { odno, orgno: '' }; },
    async cancel({ odno }) { const o = orders.find(x => x.odno === odno); if (o) { o.cancelled = true; o.status = 'cancelled'; } return { odno }; },
    async orders() { if (state.listFail) throw new Error('조회 장애'); return state.hide ? [] : orders.map(o => ({ ...o })); }
  };
  const fill = (odno, qty) => { const o = orders.find(x => x.odno === odno); o.filled = qty; o.remaining = o.qty - qty; o.avgPrice = o.price; o.status = qty >= o.qty ? 'filled' : 'partial'; };
  return { client, state, orders, fill };
}
const readMarket = async s => ({ candles: candles(520, s === 'KRW=X' ? 1400 : isKr(s) ? 70000 : 100, s.length + 3) });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-limits-'));
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };
const KR_1302 = Date.parse('2026-11-09T04:02:00Z'), US_2338 = Date.parse('2026-11-09T14:38:00Z'); // 월요일 13:02 KST · 23:38 KST = 09:38 ET

test('엔진 버전이 L6 으로 올라갔다', () => { assert.equal(PAPER_LIVE_VERSION, 'L6-2026-11-10'); assert.deepEqual([...NOT_COUNTED], ['rejected', 'cancelled', 'expired', 'not_found']); });

test('(a) 하루 한도는 시장별: 국내가 한도 직전까지 썼어도 같은 UTC 날짜의 미국 매수는 막히지 않고, 미국 거래일 합계가 한도를 넘는 두 번째 미국 매수는 막힌다', async () => {
  let t = KR_1302; const b = broker(); const L = { maxOrderKrw: 30_000_000, maxDailyKrw: 10_000_000 };
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r1 = await pl.run({ rules, plan: { '005930': { pct: 19, name: '삼성전자' } } });
  assert.equal(r1.sent.length, 1); assert.ok(r1.sent[0].amountKrw > 9_000_000 && r1.sent[0].amountKrw < 10_000_000, '국내 약 945만 원: ' + r1.sent[0].amountKrw);
  t = US_2338; const r2 = await pl.run({ rules, plan: { NVDA: { pct: 10, name: '엔비디아' } } });
  const nv = r2.items.find(i => i.symbol === 'NVDA'); assert.ok(nv, JSON.stringify(r2.items));
  assert.ok(!nv.blocks.some(x => /오늘 주문 합계/.test(x)), '국내 945만 + 미국 500만 > 1,000만 이어도 시장이 다르면 합산하지 않는다: ' + JSON.stringify(nv.blocks));
  assert.equal(nv.ok, true, JSON.stringify(nv.blocks)); assert.equal(r2.sent.length, 1); assert.equal(r2.sent[0].market, 'US'); assert.ok(r2.sent[0].amountKrw > 4_000_000);
  t = US_2338 + 7 * 60e3; const r3 = await pl.run({ rules, plan: { NVDA: { pct: 10, name: '엔비디아' }, AAPL: { pct: 12, name: '애플' } } });
  const ap = r3.items.find(i => i.symbol === 'AAPL'); assert.ok(ap);
  assert.ok(ap.blocks.some(x => /오늘 주문 합계가 한도 10,000,000원을 넘습니다\(미국 거래일 2026-11-09 기준\)/.test(x)), '미국 500만 + 600만 > 1,000만: ' + JSON.stringify(ap.blocks));
  assert.ok(r3.items.find(i => i.symbol === 'NVDA').blocks.some(x => /끝나지 않은 주문/.test(x)));
  assert.equal(r3.sent.length, 0); assert.equal(b.state.placed.length, 2);
  // 장부에 남는 막힌 이유도 시장을 말한다
  const last = pl._ledger().runs.at(-1); assert.ok(Object.keys(last.blockedReasons).some(k => k.startsWith('오늘 주문 합계')), JSON.stringify(last.blockedReasons));
});

test('(b) 주문 보호 단독: 거래일(tradeDate)·시장으로 묶고, 한도를 쓰지 않은 상태는 빼며, tradeDate 가 없는 옛 호출은 UTC 날짜로 센다', () => {
  const ctx0 = { equityKrw: 50_000_000, positions: [], lastPrice: 70000, marketOpenAt: '2026-11-10T00:00:00Z' };
  const kr = (at, tradeDate) => ({ symbol: '005930', side: 'BUY', qty: 5, limitPrice: 70000, currency: 'KRW', at, mode: 'paper', market: 'KR', tradeDate });
  const big = over => ({ key: 'x', amountKrw: 2_900_000, status: 'sent', market: 'KR', ...over });
  const dailyBlock = r => r.blocks.find(x => /오늘 주문 합계/.test(x));
  // 11-09 23:50 KST 국내 주문(거래일 11-09)과 11-10 09:05 KST 주문(거래일 11-10)은 다른 거래일 → 합산 안 함
  const i1 = kr('2026-11-10T00:05:00Z', '2026-11-10');
  assert.equal(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-09T14:50:00Z', tradeDate: '2026-11-09' })] })), undefined);
  assert.match(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-09T14:50:00Z', tradeDate: '2026-11-10' })] })), /국내 거래일 2026-11-10 기준/);
  // 같은 KST 거래일인데 UTC 날짜가 다른 경우(08:50 KST = 전날 23:50Z)도 거래일로 묶는다 — UTC 날짜 자르기로는 놓친다
  assert.ok(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-09T23:50:00Z', tradeDate: '2026-11-10' })] })));
  // 다른 시장(미국)의 같은 날짜 문자열은 세지 않는다
  assert.equal(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-10T00:00:00Z', tradeDate: '2026-11-10', market: 'US' })] })), undefined);
  // 거부·취소·소멸·미접수는 한도를 쓰지 않았다. 상태를 모르면(옛 장부) 센다.
  for (const status of NOT_COUNTED) assert.equal(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-10T00:01:00Z', tradeDate: '2026-11-10', status })] })), undefined, status);
  assert.ok(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: [big({ at: '2026-11-10T00:01:00Z', tradeDate: '2026-11-10', status: undefined })] })));
  // 두 건 합산: 각 1,000,000 + 350,000 < 3,000,000 통과, 세 건이면 초과
  const m = n => Array.from({ length: n }, (_, k) => big({ amountKrw: 1_000_000, at: `2026-11-10T00:0${k}:00Z`, tradeDate: '2026-11-10' }));
  assert.equal(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: m(2) })), undefined); assert.ok(dailyBlock(checkOrder(i1, { ...ctx0, todayOrders: m(3) })));
  // 옛 호출(tradeDate 없음): UTC 날짜로 센다(기존 동작 유지)
  const legacy = { ...i1 }; delete legacy.tradeDate; delete legacy.market;
  assert.ok(dailyBlock(checkOrder(legacy, { ...ctx0, todayOrders: [{ key: 'x', amountKrw: 2_900_000, at: '2026-11-10T00:01:00Z' }] })));
  assert.equal(dailyBlock(checkOrder(legacy, { ...ctx0, todayOrders: [{ key: 'x', amountKrw: 2_900_000, at: '2026-11-09T23:59:00Z' }] })), undefined);
  // 중복 키: 거래일이 같으면 UTC 날짜가 달라도 같은 주문, 거래일이 다르면 다른 주문
  assert.equal(intentKey(kr('2026-11-09T23:50:00Z', '2026-11-10')), intentKey(kr('2026-11-10T00:05:00Z', '2026-11-10')));
  assert.notEqual(intentKey(kr('2026-11-10T00:05:00Z', '2026-11-10')), intentKey(kr('2026-11-10T00:05:00Z', '2026-11-11')));
  assert.equal(DEFAULT_LIMITS.maxDailyKrw, 3_000_000);
});

test('(c) 거래일이 지났는데 증권사가 아직 open 인 매도는 재조회가 소멸로 닫고, 다음 날 같은 종목 주문을 막지 않으며, 점검의 leftOpen 이 1 → 0 이 된다', async () => {
  let t = KR_1302; const L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };
  const pos = [{ symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 138, price: 70000, value: 9_660_000, valueKrw: 9_660_000 }];
  const b = broker({ cash: 50_000_000, positions: pos }); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r1 = await pl.run({ rules, plan: { '069500': { pct: 5, name: 'KODEX 200' } }, rebalance: true });
  const sell = r1.sent.find(o => o.side === 'SELL' && o.symbol === '069500'); assert.ok(sell, '계획 5% 까지 매도: ' + JSON.stringify(r1.items.map(i => [i.symbol, i.side, i.blocks])));
  assert.equal(sell.status, 'sent'); assert.ok(sell.qty >= 60);
  // 다음 날 10:30 KST: 증권사는 여전히 open → 아직 장부는 sent, 점검은 '마감 뒤 남은 미체결' 1건
  t = Date.parse('2026-11-10T01:30:00Z');
  const before = systemCheck(pl._ledger(), t); assert.equal(before.leftOpen, 1); assert.equal(before.ok, false);
  // 조회 장애면 아무것도 바꾸지 않는다(fail-closed)
  b.state.listFail = true; await assert.rejects(pl.reconcile()); assert.equal(pl._ledger().orders[0].status, 'sent'); b.state.listFail = false;
  const rc = await pl.reconcile(); assert.equal(rc.updated, 1);
  const o0 = pl._ledger().orders[0]; assert.equal(o0.status, 'expired'); assert.equal(o0.filledQty, 0); assert.equal(o0.odno, sell.odno); assert.ok(o0.expiredAt);
  assert.match(o0.note, new RegExp(`^장 마감으로 소멸\\(미체결 ${sell.qty}주\\)$`));
  const after = systemCheck(pl._ledger(), t); assert.equal(after.leftOpen, 0); assert.equal(after.expired, 1); assert.equal(after.ok, true);
  // 같은 종목에 새 주문: '끝나지 않은 주문' 으로 막히지 않고 나간다
  const r2 = await pl.run({ rules, plan: { '069500': { pct: 5, name: 'KODEX 200' } }, rebalance: true });
  const it = r2.items.find(i => i.symbol === '069500'); assert.ok(it && !it.blocks.some(x => /끝나지 않은 주문|접수 여부/.test(x)), JSON.stringify(it?.blocks));
  assert.equal(r2.sent.length, 1); assert.equal(b.state.placed.length, 2);
  assert.ok(!b.orders[0].cancelled, '소멸된 주문은 재조정 전 취소 대상이 아니다(증권사에 이미 없는 주문)');
  const st = await pl.status(); assert.equal(st.integrity.leftOpen, 0); assert.equal(st.recentOrders.filter(o => o.status === 'expired').length, 1); assert.equal(st.integrity.pending, 1);
});

test('(c-2) 일부 체결 뒤 소멸: 체결 수량은 남고 fills 로 세며, 목록에 아예 없는 지난 거래일 주문도 소멸로 닫는다', async () => {
  let t = KR_1302; const b = broker({ cash: 50_000_000 }); const L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r1 = await pl.run({ rules, plan: { '005930': { pct: 10, name: '삼성전자' } } }); assert.equal(r1.sent.length, 1);
  b.fill(r1.sent[0].odno, 30); // 30주만 체결, 나머지 open
  t = Date.parse('2026-11-10T01:30:00Z'); await pl.reconcile();
  const o0 = pl._ledger().orders[0]; assert.equal(o0.status, 'expired'); assert.equal(o0.filledQty, 30); assert.equal(o0.remaining, o0.qty - 30);
  assert.match(o0.note, new RegExp(`미체결 ${o0.qty - 30}주 · 체결 30주`));
  const st = await pl.status(); assert.equal(st.activity30.fills, 1, '체결 수량이 있으면 체결로 센다'); assert.ok(st.activity30.tradedKrw >= 30 * 70000 - 1);
  assert.equal(st.activity30.decisions, 1, '소멸된 보통 주문도 매매 결정 1회');
  // 같은 날 안이면 증권사 목록에 없어도 sent 그대로(기존 규칙), 거래일이 지나면 소멸
  t = KR_1302; const b2 = broker(); const pl2 = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r2 = await pl2.run({ rules, plan: { '005930': { pct: 10, name: '삼성전자' } } }); assert.equal(r2.sent[0].status, 'sent'); b2.state.hide = true;
  t = KR_1302 + 3600e3; await pl2.reconcile(); assert.equal(pl2._ledger().orders[0].status, 'sent');
  t = Date.parse('2026-11-10T01:30:00Z'); await pl2.reconcile(); const x = pl2._ledger().orders[0]; assert.equal(x.status, 'expired'); assert.match(x.note, /2026-11-09 주문 목록에 없음/);
});

test('(d) 자동 실행: 한도·예수금 문제로 전부 막히면 계획 버전을 적지 않아 다음 거래일 다시 시도하고, 하나라도 보내면 적는다 · status.planApplied', async () => {
  let t = Date.parse('2026-11-09T14:40:00Z'); const b = broker({ cash: 50_000_000 }); const dir = tmp(); let ver = 'T1', plan = { NVDA: { pct: 20, name: '엔비디아', currency: 'USD' } };
  const L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: () => t, defaultPlan: () => plan, defaultPlanVersion: () => ver, limits: L });
  const r1 = await pl.autoRun(); assert.ok(r1.ran && r1.market === 'US' && r1.sent === 1 && r1.applied === true, JSON.stringify(r1));
  assert.equal(pl._ledger().planVersion.US, 'T1'); assert.match(pl._ledger().auto['US:2026-11-09'].note, /1건 전송/);
  assert.deepEqual((await pl.status()).planApplied, { KR: false, US: true });
  b.fill(b.orders[0].odno, b.orders[0].qty); // 체결 → '첫 운용' 사유가 사라진다
  // 화요일: 계획이 바뀌었는데 주문 가능 수량이 0 → 전부 막힘 → 미집행
  t = Date.parse('2026-11-10T14:40:00Z'); ver = 'T2'; plan = { NVDA: { pct: 20, name: '엔비디아' }, AAPL: { pct: 10, name: '애플' } }; b.state.bpQty = 0;
  const r2 = await pl.autoRun(); assert.ok(r2.ran && /계획 변경/.test(r2.reason), JSON.stringify(r2)); assert.equal(r2.sent, 0); assert.ok(r2.blocked >= 1); assert.equal(r2.applied, false);
  assert.equal(pl._ledger().planVersion.US, 'T1', '전부 막혔으면 계획 버전을 적지 않는다'); assert.match(pl._ledger().auto['US:2026-11-10'].note, /미집행/); assert.equal(pl._ledger().auto['US:2026-11-10'].applied, false);
  assert.deepEqual((await pl.status()).planApplied, { KR: false, US: false });
  t += 10 * 60e3; assert.equal((await pl.autoRun()).ran, false, '같은 거래일엔 날짜 키가 반복을 막는다');
  // 수요일(정기 점검일 아님): 계획 변경이 아직 집행되지 않았으므로 다시 시도 → 이번엔 나간다
  t = Date.parse('2026-11-11T14:40:00Z'); b.state.bpQty = 1e6;
  const r3 = await pl.autoRun(); assert.ok(r3.ran && /계획 변경/.test(r3.reason) && r3.sent >= 1 && r3.applied === true, JSON.stringify(r3));
  assert.equal(pl._ledger().planVersion.US, 'T2'); assert.deepEqual((await pl.status()).planApplied, { KR: false, US: true });
  t = Date.parse('2026-11-12T14:40:00Z'); assert.equal((await pl.autoRun()).ran, false, '집행된 뒤 목요일엔 할 일이 없다');
});

test('(d-2) 다시 시도해도 소용없는 이유(1주 미만)로만 막혔으면 집행한 것으로 적어 매일 재조정이 반복되지 않는다', async () => {
  let t = Date.parse('2026-11-09T14:40:00Z'); const b = broker({ cash: 50_000_000 }); let ver = 'T1', plan = { NVDA: { pct: 20, name: '엔비디아' } };
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, defaultPlan: () => plan, defaultPlanVersion: () => ver, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const r0 = await pl.autoRun(); assert.ok(r0.ran && r0.sent === 1, JSON.stringify(r0)); b.fill(b.orders[0].odno, b.orders[0].qty); // 첫 운용은 끝났다
  // 화요일: 바뀐 계획의 유일한 할 일이 0.2%(약 10만 원) → 1주 미만 → 내일도 같은 결과이므로 집행으로 적는다
  t = Date.parse('2026-11-10T14:40:00Z'); ver = 'T2'; plan = { AAPL: { pct: 0.2, name: '애플' } };
  const r1 = await pl.autoRun(); assert.ok(r1.ran && /계획 변경/.test(r1.reason), JSON.stringify(r1)); assert.equal(r1.sent, 0); assert.equal(r1.applied, true, JSON.stringify(r1));
  assert.equal(pl._ledger().planVersion.US, 'T2'); assert.match(pl._ledger().auto['US:2026-11-10'].note, /집행으로 적음|할 일 없음/);
  t = Date.parse('2026-11-11T14:40:00Z'); assert.equal((await pl.autoRun()).ran, false, '다음 날(수) 다시 시도하지 않는다');
  assert.equal(b.state.placed.length, 1);
});
