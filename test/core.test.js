import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, isLeveraged, initialPlan, multOf, evaluate, preTradeCheck, maxBuyAmount, allocateCash, DEFAULT_RULES, BAND } from '../lib/core-rules.js';
import { krwReturns, ewmaSigma, assetRisk, riskPath, portfolioRisk, buildEngine } from '../lib/core-risk.js';
import { reportCard } from '../lib/report-card.js';
import { rng } from '../lib/risk-models.js';

const R = rng(9); const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
const day = k => new Date(Date.parse('2024-01-01') + k * 86400000).toISOString().slice(0, 10);
const walk = (n, vol = 0.01, drift = 0, start = 100) => { let p = start; return Array.from({ length: n }, (_, k) => { p *= Math.exp(drift + vol * gauss()); return { date: day(k), open: p, close: p }; }); };

test('규칙 입력 검사와 레버리지 판별', () => {
  assert.deepEqual(normalizeRules({}).rules, DEFAULT_RULES);
  assert.equal(normalizeRules({ maxSingle: 3 }).errors.length, 1);
  assert.equal(normalizeRules({ maxSingle: 95, minCash: 10 }).errors.length, 1);
  assert.equal(normalizeRules({ trendUS: false }).rules.trendUS, false);
  assert.ok(isLeveraged({ symbol: 'TQQQ' }) && isLeveraged({ symbol: '122630', name: 'KODEX 레버리지' }) && isLeveraged({ name: 'KODEX 200선물인버스2X' }));
  assert.ok(!isLeveraged({ symbol: '069500', name: 'KODEX 200' }) && !isLeveraged({ symbol: 'NVDA', name: '엔비디아' }));
});

test('계획 비중은 최대 비중으로 자르고 현금 최소 비중을 남긴다', () => {
  const plan = initialPlan([{ symbol: 'A', valueKrw: 600 }, { symbol: 'B', valueKrw: 300 }], 100, DEFAULT_RULES);
  assert.equal(plan.A, 25); assert.equal(plan.B, 25);
  const p2 = initialPlan([{ symbol: 'A', valueKrw: 500 }, { symbol: 'B', valueKrw: 500 }, { symbol: 'C', valueKrw: 500 }, { symbol: 'D', valueKrw: 500 }], 0, DEFAULT_RULES);
  assert.equal(Object.values(p2).reduce((a, b) => a + b, 0), 90);
});

test('규칙 배수: 기본은 200일선·레버리지만, 종목별 변동성 규칙은 켤 때만', () => {
  assert.equal(DEFAULT_RULES.perAssetVol, false); assert.equal(DEFAULT_RULES.dailyLoss, 2.5); assert.equal(BAND, 0.10);
  assert.equal(multOf({ ok: true, vol: 0.30, trendApplies: false }, DEFAULT_RULES), 1);
  const r = { ...DEFAULT_RULES, perAssetVol: true };
  assert.equal(multOf({ ok: true, vol: 0.30, trendApplies: false }, r), 0.5);
  assert.equal(multOf({ ok: true, vol: 0.10, trendApplies: false }, r), 1);
  assert.equal(multOf({ ok: true, vol: 0.30, trendApplies: true, above200: false }, r), 0);
  assert.equal(multOf({ ok: true, vol: 0.30, trendApplies: true, above200: false }, { ...r, trendUS: false }), 0.5);
  assert.equal(multOf({ ok: true, vol: 0.1 }, r, true), 0);
  assert.equal(multOf({ ok: false }, r), null);
});

const flatVar = k => holdings => ({ ok: true, var95: holdings.reduce((a, h) => a + h.valueKrw, 0) * k });
test('오늘 점검: 비중 초과·변동성 규칙·현금·하루 손실 한도를 금액으로 낸다', () => {
  const positions = [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 4_000_000 }, { symbol: 'B', name: '나', currency: 'KRW', valueKrw: 2_000_000 }];
  const RV = { ...DEFAULT_RULES, perAssetVol: true, dailyLoss: 3 };
  const s = { positions, cashKrw: 4_000_000, rules: RV, plan: { A: 25, B: 20 }, risk: { A: { ok: true, vol: 0.30 }, B: { ok: true, vol: 0.10 } }, portVar: flatVar(0.02), trades30: 3, band: 0.05 };
  const e = evaluate(s);
  assert.equal(e.total, 10_000_000);
  const A = e.rows.find(r => r.symbol === 'A'), B = e.rows.find(r => r.symbol === 'B');
  assert.equal(A.targetPct, 12.5); assert.equal(A.action, 'reduce'); assert.equal(Math.round(A.diffKrw), -2_750_000);
  assert.equal(B.targetPct, 20); assert.equal(B.action, 'keep');
  assert.equal(e.checks.find(c => c.id === 'maxSingle').ok, false, '40% > 25%');
  assert.equal(e.checks.find(c => c.id === 'minCash').ok, true);
  assert.equal(e.checks.find(c => c.id === 'dailyLoss').ok, true, '2% of 6M = 120k < 3% of 10M');
  assert.equal(e.actions[0].kind, 'reduce');
  // 하루 손실 한도가 빡빡하면 목표를 함께 줄인다
  const tight = evaluate({ ...s, rules: { ...RV, dailyLoss: 0.5 }, portVar: flatVar(0.05) });
  assert.ok(tight.scale < 1 && tight.varTarget.var95 <= tight.total * 0.005 * 1.01);
  // 현금을 모르면 현금 규칙은 확인 불가, 비중은 주식 합계 기준
  const noCash = evaluate({ ...s, cashKrw: null });
  assert.equal(noCash.checks.find(c => c.id === 'minCash').ok, null); assert.equal(noCash.total, 6_000_000);
  // 기본 규칙(계좌 단위): 변동성 높은 종목도 계획 비중 그대로, 계좌 하루 손실 한도로 함께 줄인다
  const d = evaluate({ ...s, rules: DEFAULT_RULES, band: undefined, portVar: flatVar(0.05) });
  const dA = d.rows.find(r => r.symbol === 'A'), dB = d.rows.find(r => r.symbol === 'B');
  assert.equal(dA.mult, 1); assert.ok(Math.abs(dA.targetPct / dB.targetPct - 25 / 20) < 1e-9, '같은 비율로 축소');
  assert.ok(d.varTarget.var95 <= d.total * 0.025 * 1.01);
  // 팔아서 0이 된 계획 종목도 다시 살 수 있어야 한다
  const re = evaluate({ positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 0 }], cashKrw: 1e7, rules: DEFAULT_RULES, plan: { A: 25 }, risk: { A: { ok: true, vol: 0.2 } }, portVar: flatVar(0.01), trades30: 0 });
  assert.equal(re.rows[0].action, 'add'); assert.ok(re.actions.some(a => a.kind === 'add' && a.symbol === 'A'));
  // 급한 경우: 한 종목이 상한의 1.2배를 넘음
  assert.equal(evaluate({ ...s, positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 6e6 }] }).urgent, true);
});

test('매매 전 확인: 규칙 밖 매수를 막고, 규칙 안 최대 금액을 찾는다', () => {
  const positions = [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 1_000_000 }];
  const s = { positions, cashKrw: 9_000_000, rules: { ...DEFAULT_RULES, perAssetVol: true, dailyLoss: 3 }, plan: { A: 25 }, risk: {}, portVar: flatVar(0.02), trades30: 2 };
  const risk = { ok: true, vol: 0.30, trendApplies: false };
  const big = preTradeCheck(s, { symbol: 'A', name: '가', currency: 'KRW', side: 'BUY', amountKrw: 3_000_000 }, risk);
  assert.equal(big.ok, false); assert.ok(big.failed.some(c => c.id === 'maxSingle') && big.failed.some(c => c.id === 'volTarget'));
  const small = preTradeCheck(s, { symbol: 'A', name: '가', currency: 'KRW', side: 'BUY', amountKrw: 200_000 }, risk);
  assert.equal(small.ok, true);
  const max = maxBuyAmount(s, { symbol: 'A', name: '가', currency: 'KRW' }, risk);
  assert.ok(Math.abs(max - 380_000) <= 1000, `규칙 비중 12.5% × 1.10 + 0.05%p = 13.8% → 1,380,000원: ${max}`);
  const dflt = maxBuyAmount({ ...s, rules: DEFAULT_RULES }, { symbol: 'A', name: '가', currency: 'KRW' }, risk);
  assert.ok(Math.abs(dflt - 1_505_000) <= 1000, `기본 규칙: 한 종목 상한 25%(+0.05%p 허용) → 2,505,000원까지: ${dflt}`);
  assert.equal(preTradeCheck(s, { symbol: 'A', side: 'SELL', amountKrw: 2_000_000 }, risk).error !== undefined, true);
  const sell = preTradeCheck(s, { symbol: 'A', side: 'SELL', amountKrw: 500_000 }, risk);
  assert.equal(sell.ok, true); assert.deepEqual(sell.checks.map(c => c.id), ['maxTrades30']);
  const lev = preTradeCheck(s, { symbol: 'TQQQ', name: 'TQQQ', currency: 'USD', side: 'BUY', amountKrw: 100_000 }, { ok: true, vol: 0.6 });
  assert.ok(lev.failed.some(c => c.id === 'noLeverage'));
  assert.equal(preTradeCheck({ ...s, trades30: 8 }, { symbol: 'A', side: 'BUY', amountKrw: 1000 }, risk).failed.some(c => c.id === 'maxTrades30'), true);
});

test('원화 수익률·EWMA·종목 위험·과거 배수 경로', () => {
  const usd = [{ date: '2024-01-01', close: 100 }, { date: '2024-01-02', close: 110 }], fx = [{ date: '2024-01-01', close: 1000 }, { date: '2024-01-02', close: 1100 }];
  assert.ok(Math.abs(krwReturns(usd, 'USD', fx)[0].r - 0.21) < 1e-9);
  assert.ok(Math.abs(krwReturns(usd, 'KRW')[0].r - 0.1) < 1e-9);
  const sig = ewmaSigma(Array(200).fill(0.01)); assert.ok(Math.abs(sig.at(-1) - 0.01) < 1e-3);
  const c = walk(600, 0.02, 0.001), a = assetRisk(c, { market: 'US' });
  assert.ok(a.ok && a.vol > 0.15 && a.vol < 0.6); assert.equal(typeof a.above200, 'boolean');
  const p = riskPath(c, { market: 'KR', from: c[300].date });
  assert.ok(p.size > 250 && [...p.values()].every(v => v.mult > 0 && v.mult <= 1));
  assert.equal(assetRisk(walk(50)).ok, false);
});

test('계좌 하루 손실 범위는 상관을 반영한다(같은 종목 둘 = 두 배, 반대 종목 = 상쇄)', () => {
  const r = Array.from({ length: 600 }, (_, k) => ({ date: day(k), r: 0.01 * gauss() }));
  const neg = r.map(x => ({ date: x.date, r: -x.r }));
  const one = portfolioRisk([{ symbol: 'A', valueKrw: 1e6 }], { A: r });
  const two = portfolioRisk([{ symbol: 'A', valueKrw: 1e6 }, { symbol: 'B', valueKrw: 1e6 }], { A: r, B: r });
  const hedge = portfolioRisk([{ symbol: 'A', valueKrw: 1e6 }, { symbol: 'N', valueKrw: 1e6 }], { A: r, N: neg });
  assert.ok(one.var95 > 10000 && one.var95 < 25000, `${one.var95}`);
  assert.ok(Math.abs(two.var95 - 2 * one.var95) < 1); assert.ok(hedge.var95 < 1);
  assert.equal(portfolioRisk([{ symbol: 'X', valueKrw: 1e6 }], {}).ok, false);
});

test('성적표: 손으로 계산한 값과 같다', () => {
  // 가격: 100,000 → 110,000 → 121,000원, 둘째 날 10주 추가 매수(110,000원), 지금 20주 보유
  const c = [{ date: '2024-03-01', close: 100_000 }, { date: '2024-03-02', close: 110_000 }, { date: '2024-03-03', close: 121_000 }];
  const orders = [{ symbol: 'A', side: 'BUY', currency: 'KRW', orderedAt: '2024-03-02T03:00:00Z', execution: { filledQuantity: 10, averageFilledPrice: 110_000, filledAmount: 1_100_000, commission: 0, tax: 0, filledAt: '2024-03-02T03:00:00Z' } }];
  const engineOf = (vol, var95 = 0) => ({ riskAt: () => ({ ok: true, vol, trendApplies: false }), portVarAt: () => ({ ok: true, var95 }) });
  const base = { positions: [{ symbol: 'A', name: '가', currency: 'KRW', quantity: 20 }], orders, candlesBySymbol: { A: c }, from: '2024-03-01', to: '2024-03-03' };
  const rules100 = { ...DEFAULT_RULES, maxSingle: 100 };
  const rc = reportCard({ ...base, engine: engineOf(0.1), rules: rules100 });
  assert.ok(rc.ok);
  assert.equal(rc.startValue, 1_000_000);
  assert.equal(rc.hold.pnl, 210_000); assert.ok(Math.abs(rc.hold.ret - 0.21) < 1e-9);
  assert.equal(rc.actual.pnl, 2_420_000 - 1_000_000 - 1_100_000);
  assert.ok(Math.abs(rc.actual.ret - 0.21) < 1e-9, '시간가중 수익률은 같은 종목이면 보유와 같음');
  assert.equal(rc.byTrade[0].effectKrw, 110_000); assert.equal(rc.actual.pnl - rc.hold.pnl, 110_000);
  assert.equal(rc.rule.pnl, 210_000, '규칙에 걸리는 것이 없으면 규칙 = 보유');
  const half = reportCard({ ...base, engine: engineOf(0.3), rules: { ...rules100, perAssetVol: true } });
  assert.ok(Math.abs(half.rule.pnl - (500_000 * 0.21 - 500_000 * 0.002)) < 1, `첫날 절반 매도(비용 0.2%) 뒤 절반만 상승: ${half.rule.pnl}`);
  const capped = reportCard({ ...base, engine: engineOf(0.1) });
  // 첫날 75만원 매도(비용 1,500원), 마지막 날 종목이 상한 띠를 넘어 39,750원 추가 매도(비용 79.5원)
  assert.ok(Math.abs(capped.rule.pnl - (250_000 * 0.21 - 750_000 * 0.002 - 39_750 * 0.002)) < 1, `기본 한 종목 상한 25%: ${capped.rule.pnl}`);
  assert.equal(reportCard({ positions: [], orders: [], candlesBySymbol: {}, from: '2024-03-01', to: '2024-03-03' }).ok, false);
});

test('오른 종목은 상한까지 두고, 상한을 넘는 만큼만 덜어낸다', () => {
  const base = { cashKrw: 2_500_000, plan: { A: 15, B: 15 }, risk: { A: { ok: true, vol: 0.2 }, B: { ok: true, vol: 0.2 } }, portVar: flatVar(0.01), trades30: 0 };
  const grown = evaluate({ ...base, rules: DEFAULT_RULES, positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 900_000 }, { symbol: 'B', name: '나', currency: 'KRW', valueKrw: 600_000 }] });
  const A = grown.rows.find(r => r.symbol === 'A');
  assert.ok(A.currentPct > 15 && A.currentPct < 25); assert.equal(A.action, 'keep', '상한(25%) 안이면 팔지 않음');
  const back = evaluate({ ...base, rules: { ...DEFAULT_RULES, letWinnersRun: false }, positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 900_000 }, { symbol: 'B', name: '나', currency: 'KRW', valueKrw: 600_000 }] });
  assert.equal(back.rows.find(r => r.symbol === 'A').action, 'reduce', '끄면 계획으로 되돌림');
  const over = evaluate({ ...base, rules: DEFAULT_RULES, positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 4_000_000 }, { symbol: 'B', name: '나', currency: 'KRW', valueKrw: 600_000 }] });
  const oA = over.rows.find(r => r.symbol === 'A');
  assert.equal(oA.action, 'reduce'); assert.ok(Math.abs(oA.targetPct - 25) < 1e-9, '상한까지만');
});

test('새 돈은 모자란 종목부터, 상한·현금·손실 한도 안에서 나눈다', () => {
  const s = { positions: [{ symbol: 'A', name: '가', currency: 'KRW', valueKrw: 2_000_000 }, { symbol: 'B', name: '나', currency: 'KRW', valueKrw: 500_000 }], cashKrw: 0, rules: DEFAULT_RULES, plan: { A: 20, B: 20 }, risk: { A: { ok: true, vol: 0.2 }, B: { ok: true, vol: 0.2 } }, portVar: flatVar(0.01), trades30: 0 };
  const a = allocateCash(s, 1_000_000);
  assert.ok(a.ok); assert.equal(a.buys[0].symbol, 'B', '떨어졌거나 덜 산 종목 먼저');
  assert.ok(a.buys.reduce((x, b) => x + b.amountKrw, 0) <= 1_000_000 - 3_500_000 * 0.1 + 1);
  const tight = allocateCash({ ...s, rules: { ...DEFAULT_RULES, dailyLoss: 0.5 }, portVar: flatVar(0.02) }, 1_000_000);
  assert.ok(tight.limitedByRisk && tight.keepCashKrw > 0);
  assert.equal(allocateCash(s, 0).ok, false);
  const lev = allocateCash({ ...s, positions: [...s.positions, { symbol: 'TQQQ', name: 'TQQQ', currency: 'USD', valueKrw: 100_000 }], plan: { ...s.plan, TQQQ: 10 } }, 1_000_000);
  assert.ok(!lev.buys.some(b => b.symbol === 'TQQQ'), '레버리지 상품에는 넣지 않음');
});
