// 안전성(2차 리뷰 P0): ① 미국 주문은 뉴욕 거래일 기준 — KST 자정을 넘겨도 같은 세션에 두 번 내지 않는다 ② 같은 규칙을 다시 저장해도 계획 버전이 안 바뀐다
// ③ 해외 자산이 있는데 환율이 없으면 평가점을 적지 않고 모든 주문을 보류한다 ④ 가설은 승인해야 계획에 들어간다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';

function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
function broker({ cash = 50_000_000, positions = [], cashUsd = 0, stockUsd = 0 } = {}) {
  const orders = []; let seq = 500; const state = { cash, positions, placed: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { const us = !/^\d{6}$/.test(code); return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NASD' : null, price: us ? 100 : 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), stock: state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), positions: state.positions, cashUsd, stockUsd }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price, at: Date.now() }); const odno = String(++seq); const us = !/^\d{6}$/.test(code); orders.push({ market: us ? 'US' : 'KR', odno, orgno: '', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); return { odno, orgno: '' }; },
    async cancel({ odno }) { const o = orders.find(x => x.odno === odno); if (o) { o.cancelled = true; o.status = 'cancelled'; } return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state, orders };
}
const readMarket = async s => ({ candles: candles(520, s === 'KRW=X' ? 1400 : s === 'NVDA' ? 100 : 70000, s.length + 3) });
const noFx = async s => { if (s === 'KRW=X') throw new Error('환율 서버 장애'); return readMarket(s); };
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-safety-'));
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 }, L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };

test('P0-1 미국 주문: 23:40 KST 에 낸 뒤 00:10 KST 에 다시 평가해도 같은 뉴욕 거래일이라 다시 내지 않고, 자동 실행 키도 같은 날로 남는다', async () => {
  let t = Date.parse('2026-11-09T14:40:00Z'); // 23:40 KST = 09:40 뉴욕(월)
  const b = broker(); const dir = tmp();
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: () => t, defaultPlan: () => ({ NVDA: { pct: 20, name: '엔비디아', currency: 'USD' } }), defaultPlanVersion: () => 'T1', limits: L });
  const r1 = await pl.autoRun(); assert.ok(r1.ran && r1.market === 'US', JSON.stringify(r1)); assert.equal(b.state.placed.length, 1);
  assert.ok(Object.keys(pl._ledger().auto).includes('US:2026-11-09'), '자동 실행 키는 뉴욕 날짜: ' + Object.keys(pl._ledger().auto));
  t = Date.parse('2026-11-09T15:10:00Z'); // 00:10 KST 다음 날, 뉴욕은 아직 11-09
  const r2 = await pl.autoRun(); assert.equal(r2.ran, false, '같은 뉴욕 거래일엔 다시 보내지 않음: ' + JSON.stringify(r2));
  const pv = await pl.preview({ rules, plan: { NVDA: { pct: 20, name: '엔비디아' } } });
  const nv = pv.items.find(i => i.symbol === 'NVDA'); assert.ok(nv, '아직 체결 전이라 같은 할 일이 다시 나온다'); assert.ok(nv.blocks.some(x => /끝나지 않은 주문/.test(x)), '뉴욕 거래일 기준으로 막혀야 한다: ' + JSON.stringify(nv.blocks));
  assert.equal(b.state.placed.length, 1);
  // 주문 보호의 하루 한도도 그 시장의 거래일로 센다(다른 날짜 주문은 포함하지 않음)
  assert.ok(Object.keys(pl._ledger().auto).every(k => k === 'US:2026-11-09'));
});

test('P0-2 같은 규칙을 다시 저장해도 계획 버전과 savedAt 이 그대로라 자동 재조정이 생기지 않는다 · 내용이 바뀌면 버전이 바뀐다', async () => {
  let t = Date.parse('2026-11-09T01:30:00Z'); const b = broker({ cash: 100_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, defaultPlan: () => ({ '005930': { pct: 20, name: '삼성전자' } }), defaultPlanVersion: () => 'T1', limits: L });
  pl.setPrefs({ rules: { maxSingle: 20 }, cadence: 'weekly' }); const v1 = (await pl.status()).planVersionNow, saved1 = pl._ledger().prefs.savedAt;
  const r1 = await pl.autoRun(); assert.ok(r1.ran);
  t += 864e5; pl.setPrefs({ rules: { maxSingle: 20 }, cadence: 'weekly', prefs: { lossMonthly: 10 } }); // 다음 거래일(화), 같은 내용 재저장
  const st = await pl.status(); assert.equal(st.planVersionNow, v1); assert.equal(pl._ledger().prefs.savedAt, saved1); assert.ok(/\+R:[0-9a-f]{8}$/.test(v1), v1);
  const r2 = await pl.autoRun(); assert.equal(r2.ran, false, '내용이 같으면 계획 변경이 아니다: ' + JSON.stringify(r2));
  pl.setPrefs({ rules: { maxSingle: 15 }, cadence: 'weekly', reason: '테스트' }); assert.notEqual((await pl.status()).planVersionNow, v1);
  const r3 = await pl.autoRun(); assert.ok(r3.ran && /계획 변경/.test(r3.reason), '내용이 바뀌면 같은 날이라도 계획 변경으로 재조정: ' + JSON.stringify(r3));
});

test('P0-3 해외 자산이 있는데 환율을 못 읽으면 새 평가점을 적지 않고(마지막 정상 평가 유지) 모든 주문을 보류한다', async () => {
  let t = Date.parse('2026-11-09T01:30:00Z'); const dir = tmp();
  const pos = [{ symbol: 'NVDA', name: '엔비디아', market: 'US', currency: 'USD', qty: 10, price: 100, value: 1000, valueKrw: null }, { symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000 }];
  const b = broker({ cash: 10_000_000, positions: pos, stockUsd: 1000 });
  const ok = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: () => t, limits: L });
  await ok.preview({ rules, plan: { '005930': { pct: 20, name: '삼성전자' }, NVDA: { pct: 20, name: '엔비디아' } } });
  const m1 = ok._ledger().marks.at(-1); assert.ok(m1.total > 17_000_000, '환율 있으면 미국 자산 포함: ' + m1.total);
  t += 864e5; const bad = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket: noFx, now: () => t, limits: L });
  const pv = await bad.preview({ rules, plan: { '005930': { pct: 20, name: '삼성전자' }, NVDA: { pct: 20, name: '엔비디아' } } });
  assert.equal(pv.fxMissing, true); assert.ok(pv.items.length >= 1); assert.ok(pv.items.every(i => !i.ok && i.blocks.some(x => /환율.*모든 주문을 보류/.test(x))), JSON.stringify(pv.items.map(i => i.blocks)));
  const marks = bad._ledger().marks; assert.equal(marks.length, 1, '새 평가점을 적지 않음'); assert.equal(marks[0].total, m1.total);
  const st = await bad.status(); assert.equal(st.markStale, true); assert.equal(st.balance.total, m1.total);
});

test('가설 승인: 등록은 승인 대기이고 계획에 없다 · 승인하면 계획 버전이 바뀌고 다음 자동 실행이 산다 · 승인 대기는 바로 지울 수 있다', async () => {
  let t = Date.parse('2026-11-09T01:30:00Z'); const b = broker({ cash: 100_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, defaultPlan: () => ({ '005930': { pct: 20, name: '삼성전자' } }), defaultPlanVersion: () => 'T1', limits: L });
  await pl.autoRun(); const v0 = (await pl.status()).planVersionNow;
  const h = pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 5, thesis: 'x' }); assert.equal(h.status, 'proposed');
  assert.equal((await pl.status()).planVersionNow, v0, '승인 전엔 계획 버전 그대로');
  t += 864e5; assert.equal((await pl.autoRun()).ran, false, '다음 날, 승인 전엔 계획 변경이 아니다'); // 화요일
  assert.throws(() => pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 3, thesis: 'dup' }), /승인 대기/);
  pl.hypothesis('approve', { id: h.id }); const st = await pl.status(); assert.notEqual(st.planVersionNow, v0); assert.equal(st.hypotheses[0].status, 'open'); assert.ok(st.hypotheses[0].approvedAt);
  const r = await pl.autoRun(); assert.ok(r.ran && /계획 변경/.test(r.reason), JSON.stringify(r)); assert.ok(b.state.placed.some(p => p.code === '000660'));
  const h2 = pl.hypothesis('add', { symbol: '035420', name: 'NAVER', capPct: 3, thesis: 'y' }); pl.hypothesis('remove', { id: h2.id }); assert.ok(!pl._ledger().hypotheses.some(x => x.id === h2.id));
  assert.throws(() => pl.hypothesis('approve', { id: h.id }), /승인 대기 중인/);
});
