// 두 환경의 판단 일치 + 비교 기준: ① 같은 상태(보유·현금·규칙·계획·시세)를 넣으면 시뮬 엔진의 판단(evaluate)과 모의계좌 엔진의 할 일(preview items)이 같다.
// ② 지수+현금(같은 투자 비중) 비교선이 지수와 현금 사이에 있고, 투자 비중 100%면 지수와 같다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { evaluate, normalizeRules } from '../lib/core-rules.js';
import { buildEngine } from '../lib/core-risk.js';
import { rehearse } from '../lib/paper-trading.js';
import { compareRuleSets, WINDOWS, PRESET_SETS } from '../lib/strategy-review.js';

function candles(n = 520, start = 70000, seed = 5) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0003 + (r() - 0.5) * 0.025; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const series = { '005930': candles(520, 70000, 5), '000660': candles(520, 200000, 9), '069500': candles(520, 40000, 13), 'KRW=X': candles(520, 1400, 3) };
const readMarket = async s => ({ candles: series[s] || candles(520, 100, 21) });
const T0 = Date.parse('2026-11-09T01:30:00Z');
const positions = [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 300, price: 70000, value: 21_000_000, valueKrw: 21_000_000 }, { symbol: '000660', name: 'SK하이닉스', market: 'KR', currency: 'KRW', qty: 20, price: 200000, value: 4_000_000, valueKrw: 4_000_000 }];
const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { const p = positions.find(x => x.symbol === code)?.price || 40000; return { code, market: 'KR', currency: 'KRW', price: p, upper: p * 1.3, lower: p * 0.7, halted: false }; }, async balance() { return { cash: 25_000_000, total: 50_000_000, stock: 25_000_000, positions, cashUsd: 0, stockUsd: 0 }; }, async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { throw new Error('no'); }, async cancel() { }, async orders() { return []; } };
const plan = { '005930': { pct: 20, name: '삼성전자' }, '000660': { pct: 20, name: 'SK하이닉스' }, '069500': { pct: 20, name: 'KODEX 200' } };
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };

test('같은 상태 → 같은 판단: 모의계좌 엔진의 할 일은 시뮬 엔진 evaluate 의 할 일과 종목·방향·금액이 같다', async () => {
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-cons-'))), readMarket, now: () => T0, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const pv = await pl.preview({ rules, plan });
  // 시뮬 쪽: 같은 시세로 같은 엔진을 만들어 같은 날짜에 evaluate
  const syms = ['005930', '000660', '069500'], cs = Object.fromEntries(syms.map(s => [s, series[s]])), meta = Object.fromEntries(syms.map(s => [s, { name: plan[s].name, currency: 'KRW', market: 'KR' }]));
  const today = '2026-11-09', eng = buildEngine(cs, meta, series['KRW=X'], { from: '2025-10-05' });
  const risk = Object.fromEntries(syms.map(s => [s, eng.riskAt(s, today)]));
  const e = evaluate({ positions: positions.map(p => ({ symbol: p.symbol, name: p.name, currency: 'KRW', valueKrw: p.valueKrw })), cashKrw: 25_000_000, rules: normalizeRules(rules).rules, plan: Object.fromEntries(syms.map(s => [s, { pct: 20, name: plan[s].name, currency: 'KRW' }])), risk, portVar: h => eng.portVarAt(h, today), trades30: 0 });
  const a = e.actions.map(x => [x.symbol, x.kind === 'reduce' ? 'SELL' : 'BUY', Math.round(x.amountKrw)]), b = pv.items.map(i => [i.symbol, i.side, i.amountKrw]);
  assert.ok(a.length >= 1, '할 일이 있어야 비교가 된다: ' + JSON.stringify(e.checks));
  assert.deepEqual(b.map(x => x.slice(0, 2)), a.map(x => x.slice(0, 2)));
  // 금액: 모의계좌 쪽은 호가·1주 단위로 내림 → 시뮬 금액보다 크지 않고 한 주 값 안에서 같다
  for (let i = 0; i < a.length; i++) { const px = positions.find(p => p.symbol === a[i][0])?.price || 40000; assert.ok(b[i][2] <= a[i][2] + 1 && b[i][2] >= a[i][2] - px, `${a[i][0]} ${a[i][2]} vs ${b[i][2]}`); }
  assert.equal(pv.evaluation.okCount, e.okCount); assert.equal(pv.evaluation.urgent, e.urgent);
});

test('지수+현금 비교선: 투자 비중 60%면 지수 수익률의 60%, 100%면 지수와 같다 · 전략 검토 표에 mix 행이 있다', () => {
  const basket = [{ symbol: '005930', name: '삼성전자', currency: 'KRW' }, { symbol: '000660', name: 'SK하이닉스', currency: 'KRW' }];
  const bench = { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: series['069500'] };
  const from = series['005930'].at(-130).date, to = series['005930'].at(-1).date;
  const r60 = rehearse({ basket, capitalKrw: 10_000_000, rules, plan: { '005930': 30, '000660': 30 }, candlesBySymbol: series, fxCandles: series['KRW=X'], from, to, benchmark: bench });
  assert.ok(r60.ok); assert.equal(r60.mix.share, 0.6); assert.ok(Math.abs(r60.metrics.mix.ret - 0.6 * r60.metrics.bench.ret) < 1e-9); assert.ok(r60.series.every(p => Number.isFinite(p.mix)));
  const r100 = rehearse({ basket, capitalKrw: 10_000_000, rules: { ...rules, minCash: 0, maxSingle: 50 }, plan: { '005930': 50, '000660': 50 }, candlesBySymbol: series, fxCandles: series['KRW=X'], from, to, benchmark: bench });
  assert.ok(Math.abs(r100.metrics.mix.ret - r100.metrics.bench.ret) < 1e-9);
  const cmp = compareRuleSets({ basket, plan: { '005930': 30, '000660': 30 }, candlesBySymbol: series, fxCandles: series['KRW=X'], benchmark: bench, to, ruleSets: [PRESET_SETS[1]], windows: [WINDOWS[0]] });
  assert.ok(cmp.mix.w3 && Number.isFinite(cmp.mix.w3.ret)); assert.ok(cmp.findings.some(f => f.key === 'mix'));
});

test('지수+현금: 국내·미국이 섞인 계획은 국가 비중대로 KODEX·S&P500 을 섞는다(이름·비중·경로)', () => {
  const us = candles(520, 150, 17), basket = [{ symbol: '005930', name: '삼성전자', currency: 'KRW' }, { symbol: 'SPYX', name: '미국주', currency: 'USD' }];
  const cs = { ...series, SPYX: us };
  const indexes = { KR: { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: series['069500'] }, US: { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: candles(520, 500, 23) } };
  const from = series['005930'].at(-130).date, to = series['005930'].at(-1).date;
  const r = rehearse({ basket, capitalKrw: 10_000_000, rules, plan: { '005930': 30, SPYX: 50 }, candlesBySymbol: cs, fxCandles: series['KRW=X'], from, to, benchmark: indexes.KR, indexes });
  assert.ok(r.ok); assert.equal(r.mix.name, '국가 비중·현금 일치 지수 투자 (KODEX 200 30% + S&P500 ETF 50% + 현금 20%)'); assert.ok(Math.abs(r.mix.share - 0.8) < 1e-9);
  // 경로 검산: 첫날 100, 마지막 = 20 + 30×KODEX비율 + 50×(S&P500×환율)비율
  const kr = series['069500'], usx = indexes.US.candles, fx = series['KRW=X'], at = (arr, d) => arr.filter(c => c.date <= d).at(-1).close;
  const d0 = r.from, d1 = r.to, want = 20 + 30 * at(kr, d1) / at(kr, d0) + 50 * (at(usx, d1) * at(fx, d1)) / (at(usx, d0) * at(fx, d0));
  assert.ok(Math.abs(r.series.at(-1).mix - want) < 1e-6, `${r.series.at(-1).mix} vs ${want}`); assert.ok(Math.abs(r.series[0].mix - 100) < 1e-9);
  // 미국 지수가 없으면 국내 지수로 모은다
  const r2 = rehearse({ basket, capitalKrw: 10_000_000, rules, plan: { '005930': 30, SPYX: 50 }, candlesBySymbol: cs, fxCandles: series['KRW=X'], from, to, benchmark: indexes.KR, indexes: { KR: indexes.KR } });
  assert.equal(r2.mix.name, '국가 비중·현금 일치 지수 투자 (KODEX 200 80% + 현금 20%)');
});
