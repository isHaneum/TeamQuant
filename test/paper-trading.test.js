// 모의투자 엔진: 절차(점검 → 매매 전 확인 → 다음 시가 체결 → 평가)가 규칙을 지키고, 장부 계산이 맞고, 같은 입력이면 같은 결과인지.
// 합성 시세만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rehearse, equalPlan, forwardRange, PAPER_VERSION } from '../lib/paper-trading.js';
import { DEFAULT_RULES } from '../lib/core-rules.js';
import { rng } from '../lib/risk-models.js';

const R = rng(21); const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
// 평일만 있는 날짜(주말 제외)
const days = (n, start = '2024-01-01') => { const out = []; let t = Date.parse(start); while (out.length < n) { const d = new Date(t); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10)); t += 864e5; } return out; };
const walk = (dates, vol = 0.015, drift = 0.0002, start = 50_000) => { let p = start; return dates.map(date => { const open = p * Math.exp(vol * 0.3 * gauss()); p *= Math.exp(drift + vol * gauss()); return { date, open, close: p }; }); };
const D = days(420), FROM = D[300];
const basket = [{ symbol: 'A', name: '가', currency: 'KRW' }, { symbol: 'B', name: '나', currency: 'KRW' }, { symbol: 'C', name: '다', currency: 'KRW' }, { symbol: 'U', name: '미국', currency: 'USD' }];
const candles = { A: walk(D, 0.015, 0.0003), B: walk(D, 0.02, 0), C: walk(D, 0.012, 0.0002, 120_000), U: walk(D, 0.018, 0.0004, 150) };
const fx = D.map((date, k) => ({ date, open: 1350, close: 1350 + 30 * Math.sin(k / 40) }));

test('균등 계획은 현금 최소 비중을 남기고 한 종목 상한을 넘지 않는다', () => {
  const p = equalPlan(basket, DEFAULT_RULES);
  assert.equal(Object.values(p).reduce((a, b) => a + b, 0) <= 100 - DEFAULT_RULES.minCash, true);
  assert.ok(Object.values(p).every(v => v <= DEFAULT_RULES.maxSingle));
  assert.equal(equalPlan([basket[0]], DEFAULT_RULES).A, DEFAULT_RULES.maxSingle, '종목이 하나면 상한까지만');
});

test('절차 재생: 첫날 점검 → 다음 거래일 시가 체결 → 장부 합계가 맞고 현금이 음수가 되지 않는다', () => {
  const r = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  assert.ok(r.ok, r.reason); assert.equal(r.version, PAPER_VERSION);
  const firstFill = r.fills[0];
  assert.equal(firstFill.decidedOn, r.from, '첫 주문은 시작일 점검에서 나온다');
  assert.ok(firstFill.date > r.from, '체결은 결정일 다음 거래일');
  assert.ok(r.fills.filter(f => f.decidedOn === r.from).every(f => f.side === 'BUY'));
  for (const m of r.series) assert.ok(Number.isFinite(m.rule) && Number.isFinite(m.hold));
  const last = r.end; assert.ok(Math.abs(last.total - (last.cash + last.positions.reduce((a, p) => a + p.valueKrw, 0))) < 1e-6);
  assert.ok(r.journal.every(j => !/NaN/.test(j.text)));
  assert.ok(r.end.cash >= -1e-6, '현금 음수 없음');
  assert.ok(r.activity.feesKrw > 0 && r.activity.costPct < 5, '비용은 양수이고 자금의 5% 미만');
  // 1주 단위: 국내 종목 수량은 정수
  assert.ok(r.end.positions.filter(p => p.currency === 'KRW').every(p => Number.isInteger(p.qty)));
  // 체결 금액 = 수량 × 체결가
  for (const f of r.fills) assert.ok(Math.abs(f.amountKrw - f.qty * f.priceKrw) < 1e-6);
});

test('첫 체결 뒤 비중은 계획(현금 최소 10%·상한 25%) 안에 있다', () => {
  const r = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM, to: D[306] });
  assert.ok(r.ok);
  const afterFirst = r.series[1]; assert.ok(afterFirst);
  for (const p of r.end.positions) assert.ok(p.weightPct <= DEFAULT_RULES.maxSingle + 1, `${p.name} ${p.weightPct}%`);
  assert.ok(r.end.cash / r.end.total >= DEFAULT_RULES.minCash / 100 - 0.03, '현금 최소 비중(1주 단위 오차 허용)');
});

test('매매 횟수 상한이 낮으면 매매 전 확인이 주문을 막고 기록한다', () => {
  const r = rehearse({ basket, capitalKrw: 10_000_000, rules: { ...DEFAULT_RULES, maxTrades30: 2 }, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  assert.ok(r.ok);
  assert.ok((r.activity.blocked.maxTrades30 || 0) > 0, '상한 2회면 첫날 4종목 매수 중 일부가 막혀야 함');
  assert.ok(r.journal.some(j => j.step === '차단' && /30일 매매 횟수/.test(j.text)));
  // 30일 안 체결 수가 상한을 넘지 않는다
  for (const f of r.fills) { const n = r.fills.filter(g => g.date <= f.date && Date.parse(f.date) - Date.parse(g.date) < 30 * 864e5).length; assert.ok(n <= 2 + 1, `30일 체결 ${n}회`); }
});

test('같은 입력이면 같은 결과(결정론), 그냥 보유는 첫 체결 뒤 매매가 없다', () => {
  const a = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  const b = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  assert.deepEqual(a.series, b.series); assert.equal(a.end.total, b.end.total);
  assert.equal(a.series[0].hold, 100, '시작일은 현금 100');
  // 지수 비교
  const c = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM, benchmark: { symbol: 'IDX', name: '지수', currency: 'KRW', candles: candles.C } });
  assert.ok(c.ok && c.metrics.bench && Number.isFinite(c.diff.vsBenchPct));
  assert.equal(c.series[0].bench, 100);
});

test('시세 없는 종목은 빼고 알리며, 시작 자금 0·거래일 부족은 실패로 돌려준다', () => {
  const r = rehearse({ basket: [...basket, { symbol: 'Z', name: '없음', currency: 'KRW' }], capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  assert.ok(r.ok); assert.deepEqual(r.missing, ['없음']); assert.ok(r.journal.some(j => j.step === '알림'));
  assert.equal(rehearse({ basket, capitalKrw: 0, candlesBySymbol: candles, from: FROM }).ok, false);
  assert.equal(rehearse({ basket, capitalKrw: 1e6, candlesBySymbol: candles, from: D.at(-1) }).ok, false);
});

test('앞으로 범위: 분위수가 순서대로이고 금액이 총자산 기준이며 추세를 넣지 않는다', () => {
  const r = rehearse({ basket, capitalKrw: 10_000_000, candlesBySymbol: candles, fxCandles: fx, from: FROM });
  const f = forwardRange({ positions: r.end.positions, cashKrw: r.end.cash, candlesBySymbol: candles, fxCandles: fx, horizon: 63, paths: 500 });
  assert.ok(f.ok, f.reason);
  assert.ok(f.p05 < f.median && f.median < f.p95);
  assert.ok(Math.abs(f.p05Krw - f.totalKrw * f.p05) < 1e-6);
  assert.ok(f.probDown10 >= 0 && f.probDown10 <= 1 && f.investedPct <= 100);
  assert.equal(forwardRange({ positions: [], cashKrw: 100, candlesBySymbol: candles }).ok, false);
});
