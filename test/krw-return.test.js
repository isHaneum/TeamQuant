// 2026-11-16 사용자 보고: 토스 앱 수익률과 앱 홈 수익률이 다름. 원인: 미국 주식 원금을 오늘 환율로 바꿔 달러 기준이 됐음.
// 토스 계좌 합계 손익률(profitLoss.rate)은 미국 주식 원금을 산 날 원화로 센 값이라 그것을 쓴다. 아래 숫자는 모두 지어낸 예시다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTossHoldings } from '../lib/toss.js';
import { holdingsReturn, buildAssetTimeline } from '../lib/asset-timeline.js';

const item = (currency, cost, value) => ({ symbol: currency === 'KRW' ? '005930' : 'AAPL', name: currency, currency, quantity: '1', averagePurchasePrice: String(cost), lastPrice: String(value), marketValue: { purchaseAmount: String(cost), amount: String(value) }, profitLoss: { amount: String(value - cost), rate: String(value / cost - 1) } });
// 예시: 국내 100만 → 90만, 미국 $10,000 → $11,000, 오늘 환율 1,300, 토스 계좌 손익률 5%(산 날 환율이 더 높았던 경우).
const fake = { items: [item('KRW', 1000000, 900000), item('USD', 10000, 11000)], profitLoss: { rate: '0.05', rateAfterCost: '0.045' } };
const fx = { midRate: '1300', validFrom: '2026-11-16T09:00:00+09:00' };
const VALUE = 900000 + 11000 * 1300;

test('토스 계좌 합계 손익률을 산 날 환율 기준으로 보존한다', () => {
  const s = normalizeTossHoldings(fake, fx);
  assert.equal(s.account.basis, 'purchase_fx');
  assert.ok(Math.abs(s.account.returnPct - 5) < 1e-9);
  assert.ok(Math.abs(s.account.returnAfterCostPct - 4.5) < 1e-9);
  assert.equal(s.positions[1].returnPct.toFixed(2), '10.00'); // 종목 손익률은 그대로 달러 기준
});

test('계좌 합계가 없거나 이상하면 account 는 null(지어내지 않음)', () => {
  assert.equal(normalizeTossHoldings({ items: fake.items }, fx).account, null);
  assert.equal(normalizeTossHoldings({ ...fake, profitLoss: { rate: 'oops' } }, fx).account, null);
  assert.equal(normalizeTossHoldings({ ...fake, profitLoss: { rate: '-1.5' } }, fx).account, null);
});

test('홈 숫자: 토스 계좌 합계가 있으면 그 손익률과 산 날 환율 원금을 쓴다', () => {
  const r = holdingsReturn(normalizeTossHoldings(fake, fx));
  assert.equal(r.basis, 'purchase_fx');
  assert.ok(Math.abs(r.value - VALUE) < 1e-6);
  assert.ok(Math.abs(r.returnPct - 5) < 1e-9);
  assert.ok(Math.abs(r.cost - VALUE / 1.05) < 1e-6);
  assert.ok(Math.abs(r.pnl / r.cost * 100 - 5) < 1e-9);
  assert.ok(Math.abs(r.currentFxPct - (VALUE / 14000000 - 1) * 100) < 1e-9, '오늘 환율로만 바꾼 값(달러 기준)은 비교용으로만 남긴다');
  assert.ok(r.cost / 14000000 > 1.03, '원금이 오늘 환율 환산보다 크다(산 뒤 원화 강세)');
});

test('모의·예시처럼 계좌 합계가 없으면 달러 기준임을 basis 로 알린다', () => {
  const r = holdingsReturn(normalizeTossHoldings({ items: fake.items }, fx));
  assert.equal(r.basis, 'current_fx');
  assert.ok(Math.abs(r.returnPct - (VALUE / 14000000 - 1) * 100) < 1e-9);
  assert.equal(holdingsReturn(normalizeTossHoldings({ items: [item('KRW', 100, 110)] }, null)).basis, 'krw');
});

test('환율이 없으면 원화 금액은 만들지 않고, 토스가 준 손익률만 그대로 보인다(F19)', () => {
  const r = holdingsReturn(normalizeTossHoldings(fake, null));
  assert.ok(!Number.isFinite(r.value) && !Number.isFinite(r.cost) && !Number.isFinite(r.pnl));
  assert.equal(r.returnPct, 5);
  assert.equal(r.basis, 'purchase_fx');
  assert.ok(!Number.isFinite(holdingsReturn(normalizeTossHoldings({ items: fake.items }, null)).returnPct), '토스 합계도 없으면 수익률도 없음');
});

test('자산 추이: 오늘 원금선 끝점은 산 날 환율 원금(costKrwNow)을 쓴다', () => {
  const positions = [{ symbol: 'AAPL', currency: 'USD', quantity: 1, cost: 100, value: 120 }];
  const base = { positions, orders: [], fxCandles: [], fxNow: 1300, today: '2026-11-16', months: 2 };
  assert.equal(buildAssetTimeline(base).points.at(-1).principal, 130000);
  assert.equal(buildAssetTimeline({ ...base, costKrwNow: 142000 }).points.at(-1).principal, 142000);
  assert.equal(buildAssetTimeline({ ...base, costKrwNow: NaN }).points.at(-1).principal, 130000);
});
