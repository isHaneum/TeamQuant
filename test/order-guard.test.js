import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOrder, intentKey, auditEntry } from '../lib/order-guard.js';

const base = { symbol: '005930', side: 'BUY', qty: 5, limitPrice: 70000, currency: 'KRW', at: '2026-11-06T01:30:00Z', mode: 'paper' };
const ctx = { equityKrw: 10_000_000, positions: [{ symbol: '005930', qty: 10, valueKrw: 700000 }], todayOrders: [], dayPnlPct: -0.5, lastPrice: 70100, marketOpenAt: '2026-11-06T00:00:00Z' };

test('정상 모의 주문은 통과하고 감사 기록을 남긴다', () => {
  const r = checkOrder(base, ctx);
  assert.equal(r.ok, true, r.blocks.join(' ')); assert.equal(r.amountKrw, 350000);
  const a = auditEntry(base, r, { decidedBy: 'human', reason: '눌림목 신호 승인' });
  assert.equal(a.ok, true); assert.equal(a.key, intentKey(base));
});

test('실계좌·킬 스위치·일 손실 한도는 막는다', () => {
  assert.match(checkOrder({ ...base, mode: 'live' }, ctx).blocks.join(), /실계좌/);
  assert.match(checkOrder(base, { ...ctx, killSwitch: true }).blocks.join(), /킬 스위치/);
  assert.match(checkOrder(base, { ...ctx, dayPnlPct: -3.2 }).blocks.join(), /일 손실 한도/);
});

test('금액·비중·수량 한도', () => {
  assert.match(checkOrder({ ...base, qty: 20 }, ctx).blocks.join(), /1회 주문 금액/);
  assert.match(checkOrder(base, { ...ctx, todayOrders: [{ key: 'x', amountKrw: 2_800_000, at: base.at }] }).blocks.join(), /오늘 주문 합계/);
  assert.match(checkOrder({ ...base, qty: 13 }, { ...ctx, limits: { maxOrderKrw: 5_000_000 }, positions: [{ symbol: '005930', qty: 30, valueKrw: 2_100_000 }] }).blocks.join(), /한 종목 비중/);
  assert.match(checkOrder({ ...base, side: 'SELL', qty: 11 }, ctx).blocks.join(), /보유 수량/);
  assert.match(checkOrder({ ...base, qty: 1.5 }, ctx).blocks.join(), /정수/);
});

test('중복·가격 폭·장 시작 직후·거래정지', () => {
  const key = intentKey(base);
  assert.match(checkOrder(base, { ...ctx, todayOrders: [{ key, amountKrw: 350000, at: '2026-11-06T01:25:00Z' }] }).blocks.join(), /중복/);
  assert.match(checkOrder({ ...base, limitPrice: 75000 }, ctx).blocks.join(), /허용 폭/);
  assert.match(checkOrder({ ...base, at: '2026-11-06T00:02:00Z' }, ctx).blocks.join(), /장 시작 뒤/);
  assert.match(checkOrder(base, { ...ctx, halted: true }).blocks.join(), /거래정지/);
  assert.match(checkOrder(base, { ...ctx, limitUp: true }).blocks.join(), /상한가/);
  assert.equal(checkOrder({ ...base, currency: 'USD', limitPrice: 100, qty: 1 }, { ...ctx, lastPrice: 100 }).ok, false);
});
