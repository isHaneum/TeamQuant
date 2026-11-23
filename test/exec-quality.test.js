// 모의 엔진 체결 품질(2026-11-23 · 결정 58 후속): 주문 기록에 기준가(refPrice)가 남고, 30일 활동에 슬리피지(bp)·전량 체결률이 집계된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { marketOf } from '../lib/kis-orders.js';

function fakeBroker({ cash = 50_000_000, positions = [], price = 70000, fillAt = p => p } = {}) {
  const orders = []; let seq = 900; const state = { cash, positions, price, placed: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: state.price, upper: state.price * 1.3, lower: state.price * 0.7, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + p.valueKrw, 0), stock: state.positions.reduce((a, p) => a + p.valueKrw, 0), positions: state.positions, cashUsd: 0, stockUsd: 0, usError: null }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); const odno = String(++seq); const avg = fillAt(price); orders.push({ market: marketOf(code), odno, orgno: '', code, side, qty, filled: qty, remaining: 0, price, avgPrice: avg, cancelled: false, status: 'filled' }); return { odno, orgno: '' }; },
    async cancel({ odno }) { return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state, orders };
}
function candles(n = 520, start = 70000, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0005 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async sym => ({ candles: candles(520, sym === 'KRW=X' ? 1400 : 70000, sym.length + 3) });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-execq-'));
const monday = () => Date.parse('2026-11-09T01:30:00Z');
const base = { '005930': { pct: 20, name: '삼성전자' }, '069500': { pct: 20, name: 'KODEX 200' } };

test('체결 품질: 기준가가 주문에 남고, 지정가 완충만큼 비싸게 체결되면 슬리피지 +bp · 전량 체결률 100%', async () => {
  const b = fakeBroker({ cash: 100_000_000, fillAt: p => p }); // 지정가 그대로 체결(현재가 × 1.005 → +50bp)
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const r = await pl.run({ yes: true }); assert.ok(r.sent.length >= 1, JSON.stringify(r).slice(0, 300));
  await pl.reconcile?.(); const st = await pl.status();
  const o = st.recentOrders.find(x => x.symbol === '005930') || st.recentOrders[0];
  assert.equal(o.refPrice, 70000, '기준가 = 계산 시점 현재가'); assert.ok(o.price > 70000, '매수 지정가는 현재가 위(완충)');
  const a = st.activity30; assert.ok(a.slipN >= 1 && a.slipBp > 40 && a.slipBp < 60, '슬리피지 ≈ +50bp: ' + JSON.stringify(a));
  assert.equal(a.fillRatePct, 100);
  // 더 싸게 체결되면(체결가 = 현재가) 슬리피지 0
  const b2 = fakeBroker({ cash: 100_000_000, fillAt: () => 70000 });
  const pl2 = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  await pl2.run({ yes: true }); await pl2.reconcile?.(); const a2 = (await pl2.status()).activity30; assert.ok(a2.slipN >= 1 && Math.abs(a2.slipBp) < 1, JSON.stringify(a2));
});
