// 모의계좌 3단계: PC 저장 규칙(prefs)·점검 주기·종목 가설(계획 합치기, 성적, 닫기)·막힌 이유 기록
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { marketOf } from '../lib/kis-orders.js';

function fakeBroker({ cash = 50_000_000, positions = [], price = 70000 } = {}) {
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
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-paper-plan-'));
const monday = () => Date.parse('2026-11-09T01:30:00Z'), friday = () => Date.parse('2026-11-13T01:30:00Z');
const base = { '005930': { pct: 20, name: '삼성전자' }, '069500': { pct: 20, name: 'KODEX 200' } };

test('PC 저장 규칙: setPrefs 가 검증해 저장하고, 요청에 규칙이 없으면 그것을 쓴다 · 잘못된 값은 거부', async () => {
  const b = fakeBroker(); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base });
  assert.throws(() => pl.setPrefs({ rules: { dailyLoss: 99 } }), /사이여야/);
  const p = pl.setPrefs({ rules: { maxSingle: 15, minCash: 20, dailyLoss: 1.1, maxTrades30: 4 }, cadence: 'monthly', sectorCap: 20, prefs: { lossMonthly: 5, sectors: 8, cadence: 'monthly' } });
  assert.equal(p.cadence, 'monthly'); assert.equal(p.rules.minCash, 20);
  const pv = await pl.preview({});
  assert.ok(pv.evaluation.checks.find(c => c.id === 'minCash').detail.includes('기준 20%'), '저장된 규칙이 쓰임');
  const st = await pl.status(); assert.equal(st.prefs.cadence, 'monthly'); assert.ok(st.planVersionNow.includes('+R:'));
});

test('종목 가설: 등록하면 기본 계획에 한도만큼 얹히고 기본 계획은 비율로 줄어든다 · 성적·닫기·삭제 규칙', async () => {
  const b = fakeBroker({ cash: 100_000_000 }); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  assert.throws(() => pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 20, thesis: 'x' }), /1~10%/);
  assert.throws(() => pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 5, thesis: '' }), /근거/);
  const h = pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 5, horizonMonths: 6, thesis: 'HBM 수요로 성장', breakIf: '분기 매출 성장 10% 아래', evidence: ['매출 +65%'] });
  assert.equal(h.status, 'open'); assert.ok(h.closesAt > h.openedAt);
  assert.throws(() => pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 3, thesis: '중복' }), /이미 열려/);
  const pv = await pl.preview({}); const plan = pv.items.map(i => i.symbol);
  assert.ok(plan.includes('000660'), '가설 종목이 할 일에 들어옴: ' + plan.join(','));
  const st = await pl.status(); assert.ok(st.planVersionNow.includes('+H:')); assert.equal(st.hypotheses.length, 1); assert.equal(st.hypotheses[0].returnPct, null);
  // 자동 실행: 계획 변경(가설 추가)로 재조정 묶음이 나가고 가설 종목이 체결된다
  const r = await pl.autoRun(); assert.ok(r.ran && /계획 변경/.test(r.reason), JSON.stringify(r));
  const st2 = await pl.status(); const hy = st2.hypotheses[0];
  assert.ok(b.state.placed.some(p => p.code === '000660' && p.side === 'BUY'));
  assert.ok(hy.entryPrice > 0, '진입가는 체결 평균'); assert.ok(Number.isFinite(hy.indexPct), '같은 기간 지수');
  // 닫기 전에는 삭제 불가, 깨짐 표시 뒤 계획에서 빠진다
  assert.throws(() => pl.hypothesis('remove', { id: h.id }), /먼저/);
  pl.hypothesis('break', { id: h.id, note: '매출 성장 둔화' });
  const pv2 = await pl.preview({}); assert.ok(!pv2.items.some(i => i.symbol === '000660' && i.side === 'BUY'));
  const st3 = await pl.status(); assert.equal(st3.hypotheses[0].status, 'broken'); assert.equal(st3.hypotheses[0].closeNote, '매출 성장 둔화');
  pl.hypothesis('remove', { id: h.id }); assert.equal((await pl.status()).hypotheses.length, 0);
});

test('점검 주기: 월 1회는 금요일에 보내지 않고 그 달 처음에만, 급할 때만은 급함·계획 변경·첫 운용 외에는 보내지 않는다 · 막힌 이유가 기록된다', async () => {
  const b = fakeBroker({ cash: 100_000_000 }); const dir = tmp();
  let pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: friday, defaultPlan: () => base, defaultPlanVersion: () => 'PP1', limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  pl.setPrefs({ rules: {}, cadence: 'urgent' });
  const r1 = await pl.autoRun(); assert.ok(r1.ran && /첫 운용|계획 변경/.test(r1.reason)); // 첫 운용
  // 다음 주 금요일: 급할 때만 → 보내지 않음
  pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: () => friday() + 7 * 864e5, defaultPlan: () => base, defaultPlanVersion: () => 'PP1' });
  const r2 = await pl.autoRun(); assert.equal(r2.ran, false);
  // 월 1회: 그 달 첫 확인에 보낸다(월간 점검), 같은 달 금요일엔 다시 안 보낸다
  pl.setPrefs({ rules: {}, cadence: 'monthly' });
  const r3 = await pl.autoRun(); assert.ok(r3.ran && /월간 점검|계획 변경/.test(r3.reason), JSON.stringify(r3));
  pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: () => friday() + 14 * 864e5, defaultPlan: () => base, defaultPlanVersion: () => 'PP1' });
  const r4 = await pl.autoRun(); assert.equal(r4.ran, false, JSON.stringify(r4));
  const st = await pl.status(); assert.ok(st.runs.length >= 1 && st.runs.every(x => typeof x.blockedReasons === 'object'));
});
