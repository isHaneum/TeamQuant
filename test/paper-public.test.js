// 공개 스냅샷: 계좌번호·경로·주문 번호가 빠지고, 화면 모듈이 읽는 자산 스냅샷·시뮬 입력으로 바뀐다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot, assetSnapshotFrom, tossOrdersFrom, planBasketFrom, heldBasketFrom } from '../lib/paper-public.js';

const status = {
  version: 'L3', account: '****2787', ledgerPath: 'C:\\x\\kis-vps-2787.json', fx: 1450, killSwitch: false, limits: { maxOrderKrw: 1, maxDailyKrw: 2 },
  markets: { KR: { open: false, reason: '장 마감' }, US: { open: false, reason: 'x' } }, market: { open: false, reason: '장 마감' },
  balance: { cash: 20_000_000, cashUsd: 1000, total: 100_000_000, stock: 78_550_000, usError: 'oops', positions: [
    { symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000, avgCost: 68000 },
    { symbol: 'SPY', name: 'S&P500 ETF', market: 'US', currency: 'USD', qty: 10, price: 500, value: 5000, valueKrw: 7_250_000, avgCost: 480 }] },
  ordersToday: [{ at: '2026-11-09T03:21:00Z', key: 'k', odno: '0000123', orgno: '91252', symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 100, price: 69000, amountKrw: 6_900_000, why: '계획', status: 'filled', filledQty: 100, avgPrice: 68000, brokerMsg: '정상' }],
  recentOrders: [{ at: '2026-11-09T03:21:00Z', odno: '0000123', symbol: '005930', name: '삼성전자', currency: 'KRW', side: 'BUY', qty: 100, price: 69000, amountKrw: 6_900_000, status: 'filled', filledQty: 100, avgPrice: 68000 }, { at: '2026-11-09T04:00:00Z', odno: '9', symbol: '069500', name: 'KODEX 200', currency: 'KRW', side: 'SELL', qty: 100, price: 50000, amountKrw: 5e6, status: 'sent', filledQty: 0 }],
  runs: [{ at: '2026-11-09T03:21:00Z', blockedReasons: { '장 시작 전': 1 }, actions: 5, sent: 4, rejected: 0, unknown: 0, blocked: 1, planSource: 'default', rebalance: true, batch: 'RB-1' }],
  auto: [{ key: 'KR:2026-11-09', at: '2026-11-09T04:02:00Z', reason: '첫 운용', rebalance: true, sent: 9, blocked: 2, items: 11 }],
  marks: [{ date: '2026-11-09', total: 99_940_000, cash: 20_000_000, stock: 79_940_000 }],
  prefs: { rules: { maxSingle: 15 }, cadence: 'monthly', sectorCap: 20, prefs: { lossMonthly: 5 }, savedAt: '2026-11-09T05:00:00Z' },
  hypotheses: [{ id: 'H1', symbol: '000660', name: 'SK하이닉스', currency: 'KRW', market: 'KR', capPct: 3, horizonMonths: 6, thesis: 'HBM', breakIf: 'x', evidence: ['a'], openedAt: '2026-11-09T05:00:00Z', closesAt: '2027-05-09T05:00:00Z', status: 'open', entryPrice: null, price: 100, returnPct: null, indexPct: 0.01, excessPct: null, daysOpen: 0, expired: false }],
  planVersionNow: 'PP1+R:abc', defaultPlanVersion: 'PP1', hasDefaultPlan: true,
  planDoc: { version: 'PP1', asOf: '2026-11-09', cashPct: 15, method: ['m'], weights: { '005930': { pct: 2.5, name: '삼성전자', currency: 'KRW' }, SPY: { pct: 8, name: 'S&P500 ETF', currency: 'USD' } }, validation: { windows: [] } }
};

test('공개 스냅샷: 계좌번호·장부 경로·주문 번호·증권사 응답이 빠지고 잔고·보유·기록·계획·규칙·가설은 남는다', () => {
  const pub = publicSnapshot(status, { asOf: '2026-11-09T07:00:00Z' });
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('2787') && !text.includes('kis-vps') && !text.includes('0000123') && !text.includes('91252') && !text.includes('정상') && !text.includes('oops'));
  assert.equal(pub.public, true); assert.equal(pub.asOf, '2026-11-09T07:00:00Z'); assert.equal(pub.since, '2026-11-09'); assert.equal(pub.days, 1);
  assert.equal(pub.balance.positions.length, 2); assert.ok(Math.abs(pub.balance.positions[0].weightPct - 7) < 0.01);
  assert.equal(pub.balance.usError, true);
  assert.equal(pub.recentOrders[0].filledQty, 100); assert.equal(pub.recentOrders[0].odno, undefined);
  assert.equal(pub.prefs.cadence, 'monthly'); assert.equal(pub.hypotheses[0].thesis, 'HBM'); assert.equal(pub.planDoc.version, 'PP1');
  assert.equal(pub.runs[0].blockedReasons['장 시작 전'], 1); assert.equal(pub.auto[0].reason, '첫 운용');
  // 잔고를 못 읽은 상태는 메시지만 바뀐다
  assert.ok(publicSnapshot({ ...status, error: '잔고 조회 실패: token' }).error.includes('마지막 기록'));
  assert.equal(publicSnapshot({}).balance, null);
});

test('자산 스냅샷 변환: 토스 모양의 보유·체결(demo+paper 표식) · 현금은 달러 예수금을 환율로 합친다', () => {
  const pub = publicSnapshot(status, { asOf: '2026-11-09T07:00:00Z' }), snap = assetSnapshotFrom(pub);
  assert.equal(snap.demo, true); assert.equal(snap.paper, true); assert.ok(snap.source.includes('실제 돈 아님'));
  assert.equal(snap.positions.length, 2); const s = snap.positions[0];
  assert.deepEqual([s.symbol, s.quantity, s.price, s.cost, s.value], ['005930', 100, 70000, 6_800_000, 7_000_000]); assert.ok(Math.abs(s.returnPct - 2.941) < 0.01);
  assert.equal(snap.demoCash, 20_000_000 + 1000 * 1450); assert.equal(snap.fx.midRate, 1450);
  assert.equal(snap.demoOrders.orders.length, 1, '체결된 주문만'); assert.equal(snap.demoOrders.orders[0].execution.averageFilledPrice, 68000);
  assert.equal(snap.paperMeta.days, 1); assert.equal(snap.paperMeta.cadence, 'monthly');
  assert.equal(tossOrdersFrom([{ status: 'sent', filledQty: 0 }]).length, 0);
});

test('시뮬 입력: 기본 계획은 비중 그대로, 지금 보유는 바구니만', () => {
  const pub = publicSnapshot(status), pb = planBasketFrom(pub);
  assert.deepEqual(pb.basket.map(b => b.symbol), ['005930', 'SPY']); assert.deepEqual(pb.plan, { '005930': 2.5, SPY: 8 }); assert.equal(pb.cashPct, 15); assert.equal(pb.version, 'PP1');
  assert.deepEqual(heldBasketFrom(pub).map(b => b.currency), ['KRW', 'USD']);
  assert.deepEqual(planBasketFrom(null), { basket: [], plan: {}, cashPct: 100, version: null });
});
