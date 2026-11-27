// 2026-11-26 홈 '종목별 수익률' 카드 · 계좌 띠(원금 기준) 계산. 아래 숫자는 모두 지어낸 예시다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toKrw, holdingRows, sortRows, niceCeil, barScale, holdingsTotal, holdingsView, accountSummary } from '../lib/holdings-view.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
// 국내 A: 100만 원에 사서 120만 원 · 국내 B: 50만 → 40만 · 미국 C: $1,000 → $1,100(오늘 환율 1,400) · 국내 D: 원가 모름
const P = [
  { symbol: 'A', name: '가나', currency: 'KRW', quantity: 10, avgCost: 100000, price: 120000, cost: 1000000, value: 1200000, pnl: 200000, returnPct: 20, dailyPnl: 20000, dailyPct: null },
  { symbol: 'B', name: '다라', currency: 'KRW', quantity: 5, avgCost: 100000, price: 80000, cost: 500000, value: 400000, pnl: -100000, returnPct: -20, dailyPnl: null },
  { symbol: 'C', name: '마바', currency: 'USD', quantity: 10, avgCost: 100, price: 110, cost: 1000, value: 1100, pnl: 100, returnPct: 10, dailyPnl: null, dailyPct: -1.5 },
  { symbol: 'D', name: '사아', currency: 'KRW', quantity: 1, value: 200000 }
];

test('원 환산: 달러는 오늘 환율 · 환율이 없으면 null', () => {
  assert.equal(toKrw(100, 'KRW', null), 100);
  assert.equal(toKrw(10, 'USD', 1400), 14000);
  assert.equal(toKrw(10, 'USD', null), null);
  assert.equal(toKrw(NaN, 'KRW', 1), null);
});

test('줄 계산: 수익률은 매입 평균가 대비 · 손익은 원 · 오늘 등락은 증권사 값 → 시세 → 오늘 손익 순', () => {
  const { rows, stockKrw, totalKrw, cash } = holdingRows(P, { fxRate: 1400, cashKrw: 460000, dayPct: { B: 2, C: 9 } });
  const by = Object.fromEntries(rows.map(r => [r.symbol, r]));
  assert.equal(stockKrw, 1200000 + 400000 + 1540000 + 200000);
  assert.equal(totalKrw, stockKrw + 460000);
  near(by.A.dayPct, 20000 / 1180000 * 100); // 오늘 손익 ÷ 어제 평가액
  assert.equal(by.B.dayPct, 2); // 시세에서 받은 전날 종가 대비
  assert.equal(by.C.dayPct, -1.5); // 증권사 값이 먼저
  assert.equal(by.C.pnlKrw, 140000); // $100 × 1,400
  assert.equal(by.C.returnPct, 10); // 달러 기준 그대로
  assert.equal(by.D.returnPct, null); assert.equal(by.D.pnlKrw, null); // 원가 모름 → 지어내지 않음
  near(rows.reduce((s, r) => s + r.weightPct, 0) + cash.weightPct, 100);
  near(cash.weightPct, 460000 / totalKrw * 100);
});

test('현금을 모르면 비중은 주식만으로 나누고 현금 줄이 없다', () => {
  const v = holdingRows(P.slice(0, 2), { cashKrw: null });
  assert.equal(v.cash, null); assert.equal(v.cashKnown, false);
  near(v.rows[0].weightPct, 75); near(v.rows[1].weightPct, 25);
});

test('원가가 없으면 평균가 × 수량으로 계산 · 0주 종목은 뺀다', () => {
  const { rows } = holdingRows([{ symbol: 'E', name: 'E', currency: 'KRW', quantity: 2, avgCost: 50, value: 150 }, { symbol: 'F', name: 'F', currency: 'KRW', quantity: 0, value: 0 }]);
  assert.equal(rows.length, 1); near(rows[0].returnPct, 50); assert.equal(rows[0].pnlKrw, 50);
});

test('정렬: 비중순(평가액) · 수익률순 · 값 없는 줄은 뒤 · 원본 유지', () => {
  const { rows } = holdingRows(P, { fxRate: 1400 });
  assert.deepEqual(sortRows(rows, 'weight').map(r => r.symbol), ['C', 'A', 'B', 'D']);
  assert.deepEqual(sortRows(rows, 'return').map(r => r.symbol), ['A', 'C', 'B', 'D']);
  assert.deepEqual(rows.map(r => r.symbol), ['A', 'B', 'C', 'D']);
  // 환율이 없어 평가액을 모르는 미국 종목은 비중순 맨 뒤
  assert.equal(sortRows(holdingRows(P, { fxRate: null }).rows, 'weight').at(-1).symbol, 'C');
});

test('막대 눈금: 보기 좋은 올림 · 가운데 0에서 반쪽(최대 50%)', () => {
  assert.equal(niceCeil(0), 1); assert.equal(niceCeil(0.3), 0.5); assert.equal(niceCeil(7), 10); assert.equal(niceCeil(20), 20); assert.equal(niceCeil(21), 25); assert.equal(niceCeil(130), 200);
  const { rows } = holdingRows(P, { fxRate: 1400 });
  const { scale, bars } = barScale(rows);
  assert.equal(scale, 20);
  assert.deepEqual(bars.get('A'), { side: 'up', widthPct: 50 });
  assert.deepEqual(bars.get('B'), { side: 'down', widthPct: 50 });
  assert.deepEqual(bars.get('C'), { side: 'up', widthPct: 25 });
  assert.equal(bars.get('D'), null);
  assert.equal(barScale([]).scale, 1);
});

test('합계: 원가·손익을 아는 종목만 더한다', () => {
  const t = holdingsTotal(holdingRows(P, { fxRate: 1400 }).rows);
  assert.equal(t.pnlKrw, 200000 - 100000 + 140000);
  assert.equal(t.costKrw, 1000000 + 500000 + 1400000);
  near(t.returnPct, 240000 / 2900000 * 100);
  assert.equal(t.counted, 3); assert.equal(t.of, 4);
});

test('카드 보기: 앞 10개 · 나머지 개수 · 펼치면 전부 · 막대는 보이는 줄 기준', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ symbol: 'S' + i, name: 'S' + i, currency: 'KRW', quantity: 1, cost: 100, value: 100 + (i + 1) * 10, returnPct: (i + 1) * 10 }));
  const v = holdingsView(many, { limit: 10 });
  assert.equal(v.rows.length, 10); assert.equal(v.hidden, 3);
  assert.equal(v.rows[0].symbol, 'S12'); assert.equal(v.scale, 200); // 보이는 최댓값 130% → 200
  const all = holdingsView(many, { expanded: true, sort: 'return' });
  assert.equal(all.rows.length, 13); assert.equal(all.hidden, 0);
  assert.equal(holdingsView(P, { fxRate: 1400 }).hasUsd, true);
});

const H = { value: 3000000, cost: 2500000, pnl: 500000, returnPct: 20, basis: 'krw' };

test('계좌 띠 · 실계좌 기록이 있으면 원금(입출금 기준)과 그 기록의 총자산·총손익·실현 손익', () => {
  const real = { readOnly: true, balance: { total: 4000000, stock: 3000000, cash: 1000000, cashKnown: true }, principal: { krw: 3500000, method: 'transactions', since: '2025-01-02', asOf: '2026-11-26', deposits: 3800000, withdrawals: 300000 },
    returns: { totalPnlKrw: 500000, returnPct: 14.29, realizedByMonth: { '2026-11': 12000, '2026-10': -5000 }, realizedByYear: { '2026': 7000 }, since: '2025-01-02', asOf: '2026-11-26' } };
  const s = accountSummary({ kind: 'real', holdings: H, cashKrw: null, real, today: '2026-11-26' });
  assert.equal(s.principal.krw, 3500000); assert.equal(s.principal.method, 'transactions'); assert.equal(s.principal.deposits, 3800000);
  assert.equal(s.assets.krw, 4000000); assert.equal(s.assets.from, 'record'); assert.equal(s.assets.cashKrw, 1000000);
  assert.deepEqual([s.totalPnl.krw, s.totalPnl.pct], [500000, 14.29]);
  assert.deepEqual([s.realized.month, s.realized.year], [12000, 7000]);
  assert.deepEqual(s.unrealized, { krw: 500000, pct: 20 });
  // 이번 달 실현이 없으면 0(기록은 있음) · 실현 기록 자체가 없으면 null
  assert.equal(accountSummary({ kind: 'real', holdings: H, real: { ...real, returns: { ...real.returns, realizedByMonth: {} } }, today: '2026-11-26' }).realized.month, 0);
  assert.equal(accountSummary({ kind: 'real', holdings: H, real: { ...real, returns: { totalPnlKrw: 1 } }, today: '2026-11-26' }).realized, null);
});

test('계좌 띠 · 추정 원금 · 기록에 총손익이 없으면 총자산 − 원금 · 현금을 모르면 만들지 않음', () => {
  const real = { readOnly: true, balance: { total: 4000000, cashKnown: true }, principal: { krw: 3600000, method: 'estimated' } };
  const s = accountSummary({ kind: 'real', holdings: H, real });
  assert.equal(s.principal.method, 'estimated');
  assert.equal(s.totalPnl.krw, 400000); near(s.totalPnl.pct, 400000 / 3600000 * 100);
  const noCash = accountSummary({ kind: 'real', holdings: H, real: { ...real, balance: { total: 3000000, cashKnown: false } } });
  assert.equal(noCash.assets.cashKnown, false); assert.equal(noCash.totalPnl, null);
  // 못 읽은 날(markStale): 기록 총자산 대신 화면 값 + 아는 현금
  const stale = accountSummary({ kind: 'real', holdings: H, cashKrw: 500000, real: { ...real, markStale: true } });
  assert.equal(stale.assets.from, 'snapshot'); assert.equal(stale.assets.krw, 3500000); assert.equal(stale.totalPnl.krw, -100000);
});

test('계좌 띠 · 기록이 없으면 원금이라 부르지 않는다(매입 원가만) · 총손익 없음', () => {
  const s = accountSummary({ kind: 'real', holdings: H, cashKrw: 200000, real: null });
  assert.equal(s.principal, null); assert.equal(s.totalPnl, null); assert.equal(s.costKrw, 2500000);
  assert.equal(s.assets.krw, 3200000); assert.equal(s.assets.cashKnown, true);
  assert.equal(accountSummary({ kind: 'real', holdings: H, real: { principal: { krw: 0 } } }).principal, null);
});

test('계좌 띠 · 팀 모의계좌(가상 예수금 → 처음 총자산) · 예시(현금 + 매입 원가)', () => {
  const p = accountSummary({ kind: 'paper', holdings: H, cashKrw: 7500000, paper: { principalKrw: 10000000, startTotal: 9990000 } });
  assert.equal(p.principal.method, 'paper'); assert.equal(p.assets.krw, 10500000); assert.equal(p.totalPnl.krw, 500000); near(p.totalPnl.pct, 5);
  assert.equal(accountSummary({ kind: 'paper', holdings: H, cashKrw: 7500000, paper: { startTotal: 10000000 } }).principal.method, 'paper-start');
  assert.equal(accountSummary({ kind: 'paper', holdings: H, cashKrw: null, paper: { principalKrw: 10000000 } }).totalPnl, null);
  const d = accountSummary({ kind: 'demo', holdings: H, cashKrw: 3000000 });
  assert.equal(d.principal.krw, 5500000); assert.equal(d.totalPnl.krw, 500000);
});

test('계좌 띠 · 거래내역 원금이 덜 세졌거나(complete:false) 읽기 실패 · 원가 모르는 매도는 그대로 넘긴다', () => {
  const real = { balance: { total: 4000000, cashKnown: true }, principal: { krw: 3500000, method: 'transactions', complete: false, fetchError: 'rate_limited', unknowns: [{ reason: 'transfer_no_value', count: 2 }, { reason: 'cost_unknown', count: 5 }] },
    returns: { totalPnlKrw: 500000, realizedByMonth: {}, realizedByYear: {}, realizedUnknownSells: 3 } };
  const s = accountSummary({ kind: 'real', holdings: H, real, today: '2026-11-26' });
  assert.deepEqual([s.principal.complete, s.principal.unknownCount, s.principal.fetchError, s.realized.unknownSells], [false, 2, 'rate_limited', 3]);
  const ok = accountSummary({ kind: 'real', holdings: H, real: { ...real, principal: { krw: 3500000, method: 'transactions' }, returns: { realizedByMonth: {} } }, today: '2026-11-26' });
  assert.deepEqual([ok.principal.complete, ok.principal.unknownCount, ok.principal.fetchError, ok.realized.unknownSells], [true, 0, null, 0]);
  assert.equal(accountSummary({ kind: 'real', holdings: H, real: { principal: { krw: 1, method: 'estimated' } } }).principal.complete, null, '추정은 완전/미완을 말하지 않는다');
});
