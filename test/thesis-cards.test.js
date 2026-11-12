// 근거 카드·계획 PP3(결정 25): 성장·가치·질로 판정 · 깨짐 조건 · 균등 크기와 나눠 사기 · 계획의 exit 종목은 엔진이 정리한다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCard, buildPlan, valuation } from '../lib/thesis-cards.js';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';

// 분기 n개: 매출이 분기마다 g 배, 영업이익률 m, 순이익 = 영업이익×0.8. 공개일 = 분기말 + 45일.
function company({ n = 28, rev0 = 100, g = 1.04, m = 0.2, price = () => 100, shares = 10, tweak = q => q } = {}) {
  const quarters = [], months = []; let t = Date.parse('2019-12-31'), rev = rev0;
  for (let i = 0; i < n; i++) { const end = new Date(t).toISOString().slice(0, 10), pub = new Date(t + 45 * 864e5).toISOString().slice(0, 10); quarters.push(tweak([end, pub, rev, rev * m, rev * m * 0.8, rev * 4], i)); rev *= g; t += 91.3 * 864e5; }
  for (let i = 0, d = Date.parse('2020-06-30'); d <= Date.parse('2026-10-31'); i++, d += 30.4 * 864e5) months.push([new Date(d).toISOString().slice(0, 10), price(i), 2000]);
  return { name: 'T', market: 'KR', sector: '정보기술', currency: 'KRW', shares, quarters, months };
}
const asOf = '2026-10-31';

test('카드: 성장·질·가치가 모두 맞으면 pass · 가격이 자기 과거 상위 30%면 wait · 성장 예측 순위가 낮으면 fail · 자료 없으면 nodata', () => {
  const flat = buildCard('A', company({ price: () => 100 }), { growthRank: 0.9 }, { asOf }); // 이익은 늘고 주가는 그대로 → PER 이 과거보다 낮다
  assert.equal(flat.verdict, 'pass'); assert.ok(flat.growth.ttm > 0.15 && flat.value.pct < 0.1, JSON.stringify([flat.growth.ttm, flat.value]));
  assert.match(flat.why[0], /^성장: 최근 4개 분기 매출 \+/); assert.match(flat.why[2], /비싸지 않음/); assert.ok(flat.breaks.length >= 4 && flat.review > '2026-10-31');
  const hot = buildCard('B', company({ price: i => 100 * 1.06 ** i }), { growthRank: 0.9 }, { asOf }); assert.equal(hot.verdict, 'wait'); assert.ok(hot.value.pct > 0.7); assert.match(hot.why[2], /대기/);
  assert.equal(buildCard('C', company(), { growthRank: 0.3 }, { asOf }).verdict, 'fail');
  const none = buildCard('D', null, null, { asOf }); assert.equal(none.verdict, 'nodata'); assert.match(none.why[0], /근거를 세울 수 없음/);
  const short = company(); short.months = short.months.slice(-10); assert.equal(valuation(short, asOf).pct, null, '과거 자료가 모자라면 백분위를 내지 않는다');
});

test('카드: 깨짐 조건 — 매출 2개 분기 연속 감소 · 이익률 급락은 fail · 순이익이 영업이익의 2배를 넘으면(일회성) wait · ROE 가 낮으면 fail', () => {
  const shrink = buildCard('A', company({ tweak: (q, i) => i >= 25 ? [q[0], q[1], q[2] * 0.6, q[3] * 0.6, q[4] * 0.6, q[5]] : q }), { growthRank: 0.9 }, { asOf });
  assert.equal(shrink.verdict, 'fail'); assert.match(shrink.breakNow.join(' '), /2개 분기 연속/);
  const margin = buildCard('B', company({ tweak: (q, i) => i >= 23 ? [q[0], q[1], q[2], q[2] * 0.1, q[2] * 0.08, q[5]] : q }), { growthRank: 0.9 }, { asOf }); assert.equal(margin.verdict, 'fail'); assert.match(margin.breakNow.join(' '), /영업이익률/);
  const oneOff = buildCard('C', company({ tweak: (q, i) => i >= 23 ? [q[0], q[1], q[2], q[3], q[3] * 5, q[5]] : q }), { growthRank: 0.9 }, { asOf }); assert.equal(oneOff.verdict, 'wait'); assert.match(oneOff.why.join(' '), /일회성/);
  assert.equal(buildCard('D', company({ m: 0.02 }), { growthRank: 0.9 }, { asOf }).verdict, 'fail');
});

test('계획: 통과 종목만 균등 · 섹터 상한 · 현대차 그룹 제외 · 1단계는 목표의 60% · 모자란 위성 몫은 지수로 · 합계 100', () => {
  const card = (key, sector, rank, pct) => ({ key, name: key, market: 'KR', currency: 'KRW', sector, verdict: 'pass', why: ['w'], breaks: [], review: null, growth: { rank }, value: { pct } });
  const cards = [...['a', 'b', 'c', 'd'].map((k, i) => card(k, 'IT', 0.9 - i * 0.01, 0.2)), ...['e', 'f', 'g', 'h', 'i'].map((k, i) => card(k, 'S' + i, 0.8, 0.3)), card('005380', 'auto', 0.99, 0), { ...card('z', 'IT', 0.99, 0.9), verdict: 'wait' }];
  const p = buildPlan(cards); assert.deepEqual(p.picked, ['a', 'b', 'e', 'f', 'g', 'h', 'i'], '같은 섹터 합 15% 까지(5.6% 씩이면 2개) · 현대차 제외 · wait 제외');
  assert.equal(p.weights.a.targetPct, 5.6); assert.equal(p.weights.a.pct, 3.4); assert.equal(p.weights.a.tranche, 1);
  const sum = Object.values(p.weights).reduce((a, w) => a + w.pct, 0) + p.cashPct; assert.ok(Math.abs(sum - 100) < 0.01); assert.equal(p.reservePct, 15);
  assert.ok(p.weights.SPY.pct > 25 && p.weights['069500'].pct > 10, '위성이 50% 에 못 미치면 남는 몫은 지수로'); assert.deepEqual(p.rejected.sectorCap, ['c', 'd']);
  assert.equal(buildPlan(cards, { tranche: { a: 3 } }).weights.a.pct, 5.6);
});

test('엔진: 계획에 pct 0 · exit 로 적힌 보유는 재조정에서 매도 대상이 된다 · exit 표시가 없는 pct 0 은 무시(전처럼 지금 비중 유지)', async () => {
  const candles = (start, seed) => { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; while (out.length < 520) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { s = (s * 16807) % 2147483647; p *= 1 + 0.0004 + (s / 2147483647 - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; };
  const readMarket = async s => ({ candles: candles(s === 'KRW=X' ? 1400 : 70000, s.length + 3) });
  const pos = [{ symbol: '105560', name: 'KB금융', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000 }, { symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000 }];
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: 86_000_000, total: 100_000_000, stock: 14_000_000, positions: pos, cashUsd: 0, stockUsd: 0 }; }, async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const t = Date.parse('2026-11-09T01:30:00Z'), mk = (maxOrderKrw = 30_000_000) => createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-exit-'))), readMarket, now: () => t, limits: { maxOrderKrw, maxDailyKrw: 100_000_000 } });
  const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };
  const a = await mk().preview({ rules, rebalance: true, plan: { '069500': { pct: 7, name: 'KODEX 200' }, '105560': { pct: 0, exit: true, name: 'KB금융' } } });
  const sell = a.items.find(i => i.symbol === '105560'); assert.ok(sell && sell.side === 'SELL' && sell.qty === 100, JSON.stringify(a.items.map(i => [i.symbol, i.side, i.qty])));
  const c = await mk(10_000_000).preview({ rules, rebalance: true, plan: { '069500': { pct: 60, name: 'KODEX 200' }, '105560': { pct: 0, exit: true, name: 'KB금융' } } });
  const big = c.items.find(i => i.symbol === '069500'); assert.ok(big && big.side === 'BUY' && big.amountKrw <= 10_000_000 && big.qty === Math.floor(10_000_000 / big.price) && big.warnings.some(w => /1회 한도/.test(w)), JSON.stringify(big));
  const b = await mk().preview({ rules, rebalance: true, plan: { '069500': { pct: 7, name: 'KODEX 200' }, '105560': { pct: 0, name: 'KB금융' } } });
  assert.ok(!b.items.some(i => i.symbol === '105560' && i.side === 'SELL'));
});
