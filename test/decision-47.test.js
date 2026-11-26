// 결정 47: 핵심 지수 ETF 는 한 종목 상한의 예외(capExempt) · 주문 보호도 같은 표시를 따른다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, preTradeCheck, allocateCash, capPctOf, DEFAULT_RULES } from '../lib/core-rules.js';
import { checkOrder } from '../lib/order-guard.js';

const rules = { ...DEFAULT_RULES, maxSingle: 25, minCash: 10, letWinnersRun: false };
const risk = { SPY: { ok: true, vol: 0.15, trendApplies: false, above200: true }, AAPL: { ok: true, vol: 0.25, trendApplies: false, above200: true } };
const positions = [{ symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', valueKrw: 28_000_000 }, { symbol: 'AAPL', name: '애플', currency: 'USD', valueKrw: 28_000_000 }];

test('capPctOf: capExempt 계획만 100, 나머지는 maxSingle', () => {
  assert.equal(capPctOf(rules, { pct: 29.2, capExempt: true }), 100); assert.equal(capPctOf(rules, { pct: 29.2 }), 25); assert.equal(capPctOf(rules, 29.2), 25); assert.equal(capPctOf(rules, undefined), 25);
});

test('오늘 점검: 핵심 지수 ETF 29.2% 목표는 잘리지 않고, 28% 보유도 상한 위반이 아니다 · 개별 종목 28% 는 위반', () => {
  const e = evaluate({ positions, cashKrw: 44_000_000, rules, plan: { SPY: { pct: 29.2, capExempt: true }, AAPL: { pct: 29.2 } }, risk, trades30: 0 });
  const spy = e.rows.find(r => r.symbol === 'SPY'), aapl = e.rows.find(r => r.symbol === 'AAPL');
  assert.equal(spy.planPct, 29.2); assert.equal(spy.capExempt, true); assert.equal(aapl.planPct, 25); assert.equal(aapl.capExempt, false);
  const chk = e.checks.find(c => c.id === 'maxSingle'); assert.equal(chk.ok, false); assert.match(chk.detail, /애플/); assert.doesNotMatch(chk.detail, /S&P500/);
  const e2 = evaluate({ positions: [positions[0]], cashKrw: 72_000_000, rules, plan: { SPY: { pct: 29.2, capExempt: true } }, risk, trades30: 0 });
  assert.equal(e2.checks.find(c => c.id === 'maxSingle').ok, true); assert.equal(e2.urgent, false);
});

test('주문 전 점검·새 돈 배분: 핵심 지수 ETF 매수는 25% 를 넘어도 통과, 개별 종목은 막힌다', () => {
  const s = { positions, cashKrw: 44_000_000, rules, plan: { SPY: { pct: 29.2, capExempt: true }, AAPL: { pct: 29.2 } }, risk, trades30: 0 };
  const buySpy = preTradeCheck(s, { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', side: 'BUY', amountKrw: 1_200_000 }, risk.SPY);
  assert.equal(buySpy.checks.find(c => c.id === 'maxSingle').ok, true); assert.match(buySpy.checks.find(c => c.id === 'maxSingle').detail, /예외/);
  const buyAapl = preTradeCheck(s, { symbol: 'AAPL', name: '애플', currency: 'USD', side: 'BUY', amountKrw: 1_200_000 }, risk.AAPL);
  assert.equal(buyAapl.checks.find(c => c.id === 'maxSingle').ok, false);
  const a = allocateCash({ ...s, positions: positions.map(p => ({ ...p, valueKrw: 20_000_000 })), cashKrw: 36_000_000 }, 10_000_000); const spy = (a.buys || []).find(b => b.symbol === 'SPY'); // SPY 20/86 = 23% → 목표 29.2% 까지 5.1M 모자람(개별 종목은 25 로 잘려 1.5M)
  assert.ok(spy && spy.amountKrw > 0, '지수 ETF 가 모자란 몫을 받는다');
});

test('주문 보호(order-guard): capExempt 주문은 한 종목 비중 검사를 건너뛰고 나머지 검사는 그대로', () => {
  const base = { symbol: 'SPY', side: 'BUY', qty: 10, limitPrice: 700, currency: 'USD', at: '2026-11-18T15:00:00Z', mode: 'paper', market: 'US', tradeDate: '2026-11-18' };
  const ctx = { limits: { maxOrderKrw: 15_000_000, maxDailyKrw: 60_000_000 }, fx: 1330, equityKrw: 100_000_000, positions: [{ symbol: 'SPY', qty: 24, valueKrw: 23_400_000 }], todayOrders: [], dayPnlPct: -0.5, lastPrice: 700, marketOpenAt: '2026-11-18T14:30:00Z' };
  assert.match(checkOrder(base, ctx).blocks.join(), /한 종목 비중/);
  const ok = checkOrder({ ...base, capExempt: true }, ctx); assert.equal(ok.ok, true, ok.blocks.join(' | '));
  assert.match(checkOrder({ ...base, capExempt: true }, { ...ctx, killSwitch: true }).blocks.join(), /전체 정지/);
});
