// 결정 57(2026-11-23): 가설은 현금 여유에서 먼저 산다 — 투자 비중 + 가설 합이 (100 − 현금 최소 비중) 안이면 기본 계획을 줄이지 않는다. 넘치면 넘치는 만큼만 같은 비율로 줄인다. exit 보유는 가설이 있어도 계획에 남는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { marketOf } from '../lib/kis-orders.js';

function fakeBroker({ cash = 20_000_000, positions = [], price = 70000 } = {}) {
  const orders = []; let seq = 900; const state = { cash, positions, price, placed: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: state.price, upper: state.price * 1.3, lower: state.price * 0.7, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + p.valueKrw, 0), stock: state.positions.reduce((a, p) => a + p.valueKrw, 0), positions: state.positions, cashUsd: 0, stockUsd: 0, usError: null }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); const odno = String(++seq); orders.push({ market: marketOf(code), odno, orgno: '', code, side, qty, filled: qty, remaining: 0, price, avgPrice: price, cancelled: false, status: 'filled' }); return { odno, orgno: '' }; },
    async cancel({ odno }) { return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state, orders };
}
function candles(n = 520, start = 70000, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0005 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async sym => ({ candles: candles(520, sym === 'KRW=X' ? 1400 : 70000, sym.length + 3) });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-d57-'));
const monday = () => Date.parse('2026-11-09T01:30:00Z');
const pos = (symbol, name) => ({ symbol, name, market: 'KR', currency: 'KRW', exchange: 'KRX', qty: 285, price: 70000, value: 19_950_000, valueKrw: 19_950_000, avgCost: 70000 });
// 기본 계획: 네 종목 20% 씩 = 투자 80% · 현금 20%(한 종목 상한 25% 안). 현금 최소 비중 기본 10% → 가설 여유 10%p.
const NAMES = { '005930': '삼성전자', '069500': 'KODEX 200', '035420': 'NAVER', '105560': 'KB금융' };
const base = { ...Object.fromEntries(Object.entries(NAMES).map(([k, name]) => [k, { pct: 20, name }])), '128940': { pct: 0, exit: true, name: '한미약품' } };
const make = () => { const b = fakeBroker({ cash: 20_200_000, positions: Object.entries(NAMES).map(([k, n]) => pos(k, n)) }); return { b, pl: createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } }) }; };

test('결정 57: 가설 합이 현금 여유 안이면 기본 계획을 줄이지 않는다(핵심 지수 매도 없음) · 가설 종목은 매수 대상', async () => {
  const { pl } = make();
  pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 5, thesis: 'HBM', approve: true });
  const pv = await pl.preview({ rebalance: true }); const sells = pv.items.filter(i => i.side === 'SELL').map(i => i.symbol);
  assert.deepEqual(sells, [], '현금 20% 중 5% 로 사니 기본 종목을 팔지 않는다: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side])));
  assert.ok(pv.items.some(i => i.symbol === '000660' && i.side === 'BUY'), '가설 종목 매수');
});

test('결정 57: 가설 합이 현금 여유를 넘으면 넘치는 만큼만 기본 계획을 같은 비율로 줄인다', async () => {
  const { pl } = make();
  pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 10, thesis: 'HBM', approve: true });
  pl.hypothesis('add', { symbol: '207940', name: '삼성바이오로직스', capPct: 10, thesis: 'CDMO', approve: true });
  const pv = await pl.preview({ rebalance: true }); const sells = pv.items.filter(i => i.side === 'SELL');
  // 투자 80 + 가설 20 = 100 > 90 → 기본 계획을 10%p 만 줄임(20 → 17.5 씩) → 네 종목 모두 '계획 비중보다 많음' 매도 약 2.5%p
  assert.deepEqual(sells.map(i => i.symbol).sort(), Object.keys(NAMES).sort(), JSON.stringify(pv.items.map(i => [i.symbol, i.side, Math.round(i.amountKrw)])));
  for (const s of sells) assert.ok(s.amountKrw > 2_000_000 && s.amountKrw < 3_000_000, '각 2.5%p(약 250만 원)만 줄인다: ' + Math.round(s.amountKrw));
});

test('결정 57: exit 표시 보유는 가설이 열려 있어도 계획에 남아 정리 매도가 나간다', async () => {
  const b = fakeBroker({ cash: 73_050_000, positions: [pos('005930', '삼성전자'), { ...pos('128940', '한미약품'), qty: 100, value: 7_000_000, valueKrw: 7_000_000 }] });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 5, thesis: 'HBM', approve: true });
  const pv = await pl.preview({ rebalance: true });
  assert.ok(pv.items.some(i => i.symbol === '128940' && i.side === 'SELL'), '정리 종목 매도가 계획에서 사라지지 않는다: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side])));
});
