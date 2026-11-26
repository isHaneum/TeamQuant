// 결정 60(2026-11-24): 모의계좌 가설 기록·200일선·정리·자동 깨짐.
// ① 가설 카드의 보유·수익은 잔고와 체결 흐름에서(판 뒤 '52주 보유'로 보이던 틀린 기록) ② 열린 가설 종목은 200일선 규칙 제외 ③ 200일선은 끝난 세션 종가로만
// ④ 깨짐·종료 가설의 남은 보유는 정리(exit) ⑤ 기계가 확인하는 자동 깨짐 조건(stops) · 검증 · fail-closed ⑥ 공개 스냅샷 필드.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { marketOf } from '../lib/kis-orders.js';
import { publicSnapshot } from '../lib/paper-public.js';

const NOW = Date.parse('2026-11-24T16:00:00Z'); // 11:00 ET 화요일(미국 장중) · KST 11-25 01:00 · 오늘 뉴욕 봉(11-24)은 미완성
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-d60-'));
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 5, maxTrades30: 8, trendUS: true, noLeverage: false };

function fakeBroker({ cash = 50_000_000, positions = [], usPrice = 100, balanceFails = false } = {}) {
  const orders = []; let seq = 700; const state = { cash, positions, usPrice };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { const us = marketOf(code) === 'US'; return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NASD' : 'KRX', price: us ? state.usPrice : 70000, upper: us ? null : 91000, lower: us ? null : 49000, halted: false }; },
    async balance() { if (balanceFails) throw new Error('잔고 조회 실패(시험)'); const kr = state.positions.filter(p => p.currency !== 'USD'), us = state.positions.filter(p => p.currency === 'USD'); return { cash: state.cash, total: state.cash + kr.reduce((a, p) => a + p.valueKrw, 0), stock: kr.reduce((a, p) => a + p.valueKrw, 0), positions: state.positions, cashUsd: 0, stockUsd: us.reduce((a, p) => a + (p.value || 0), 0), usError: null }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6, cashAmt: 1e9 }; },
    async place({ code, side, qty, price }) { const odno = String(++seq); orders.push({ market: marketOf(code), odno, orgno: '', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); return { odno, orgno: '' }; },
    async cancel({ odno }) { return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state };
}
const usPos = (symbol, qty, price) => ({ symbol, name: symbol, market: 'US', currency: 'USD', exchange: 'NASD', qty, price, value: qty * price, avgCost: price });

// 평일 봉: until 까지 n 개 · 기준값 주변 ±0.5% 잡음(변동성 > 0 이어야 규칙이 계산된다). done = 마지막 '끝난' 봉(until 전날)의 종가, partial = until 봉(오늘 · 미완성).
function bars({ until = '2026-11-24', n = 320, base = 100, done = null, partial = null, seed = 11 } = {}) {
  const dates = []; let t = Date.parse(until + 'T00:00:00Z'); while (dates.length < n) { const d = new Date(t); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.unshift(d.toISOString().slice(0, 10)); t -= 864e5; }
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = dates.map(date => { const close = base * (1 + (r() - 0.5) * 0.01); return { date, open: close, close }; });
  if (done !== null) out[out.length - 2] = { ...out[out.length - 2], open: done, close: done };
  if (partial !== null) out[out.length - 1] = { ...out[out.length - 1], open: partial, close: partial };
  return out;
}
const reader = (map = {}) => async sym => ({ candles: sym === 'KRW=X' ? bars({ base: 1400, seed: 3 }) : map[sym] || bars({ seed: sym.length + 5 }) });
const make = ({ broker = fakeBroker(), map = {}, now = NOW, plan = null } = {}) => ({ broker, pl: createPaperLive({ client: broker.client, store: createLedgerStore(tmp()), readMarket: reader(map), now: () => now, defaultPlan: () => plan, defaultPlanVersion: () => (plan ? 'PP1' : null), limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } }) });
const fill = (pl, o) => pl._ledger().orders.push({ key: 'k' + Math.random(), market: 'US', currency: 'USD', status: 'filled', remaining: 0, odno: null, orgno: '', ...o });

test('결정 60 ①: 규칙이 판 가설은 보유 0주 · 판매 평균가·실현 수익·판 이유로 보인다(전에는 산 수량 52주로 보임)', async () => {
  const { pl } = make();
  const h = pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: '공포 뒤 추가 하락', approve: true });
  fill(pl, { at: new Date(NOW + 60e3).toISOString(), symbol: 'SPXU', name: 'SPXU', side: 'BUY', qty: 52, price: 40.99, filledQty: 52, avgPrice: 40.87, why: '계획 비중보다 적음' });
  fill(pl, { at: new Date(NOW + 35 * 60e3).toISOString(), symbol: 'SPXU', name: 'SPXU', side: 'SELL', qty: 52, price: 38.75, filledQty: 52, avgPrice: 38.88884615, why: '200일선 아래(미국 규칙)' });
  const x = (await pl.status()).hypotheses.find(v => v.id === h.id);
  assert.equal(x.qty, 0, '보유 0주(잔고에 없음)'); assert.equal(x.heldQty, 0); assert.equal(x.state, 'sold');
  assert.equal(x.boughtQty, 52); assert.equal(x.soldQty, 52); assert.equal(x.entryPrice, 40.87); assert.ok(Math.abs(x.exitPrice - 38.88884615) < 1e-9);
  assert.ok(Math.abs(x.returnPct - (38.88884615 / 40.87 - 1)) < 1e-9, '현금흐름 수익 ≈ −4.85%: ' + x.returnPct); assert.ok(Math.abs(x.realizedPct - x.returnPct) < 1e-12);
  assert.equal(x.lastSellWhy, '200일선 아래(미국 규칙)'); assert.equal(x.price, null);
});

test('결정 60 ①: 일부 판 뒤 보유 · 잔고를 못 읽으면 보유·수익은 모름(null)으로 둔다', async () => {
  const { pl } = make({ broker: fakeBroker({ positions: [usPos('SPXU', 32, 39)] }) });
  const h = pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true });
  fill(pl, { at: new Date(NOW + 60e3).toISOString(), symbol: 'SPXU', side: 'BUY', qty: 52, price: 41, filledQty: 52, avgPrice: 40.87 });
  fill(pl, { at: new Date(NOW + 120e3).toISOString(), symbol: 'SPXU', side: 'SELL', qty: 20, price: 38.8, filledQty: 20, avgPrice: 38.9, why: '시험' });
  const x = (await pl.status()).hypotheses.find(v => v.id === h.id);
  assert.equal(x.state, 'partial'); assert.equal(x.heldQty, 32); assert.ok(Math.abs(x.returnPct - ((20 * 38.9 + 32 * 39) / (52 * 40.87) - 1)) < 1e-9, String(x.returnPct));
  const { pl: pl2 } = make({ broker: fakeBroker({ balanceFails: true }) });
  const h2 = pl2.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true });
  fill(pl2, { at: new Date(NOW + 60e3).toISOString(), symbol: 'SPXU', side: 'BUY', qty: 52, price: 41, filledQty: 52, avgPrice: 40.87 });
  const y = (await pl2.status()).hypotheses.find(v => v.id === h2.id);
  assert.equal(y.heldQty, null); assert.equal(y.state, 'unknown'); assert.equal(y.returnPct, null, '잔고를 모르면 수익을 지어내지 않는다');
});

test('결정 60 ②: 열린 가설 종목은 끝난 세션 종가가 200일선 아래여도 계획대로 산다(가설은 자기 깨짐 조건으로)', async () => {
  const map = { SPXU: bars({ done: 90, partial: 89 }) }; // 끝난 봉·오늘 봉 모두 200일선(≈100) 아래
  const { pl } = make({ map, broker: fakeBroker({ usPrice: 90 }) });
  pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true });
  const pv = await pl.preview({ rules, plan: { SPY: { pct: 10, name: 'SPY' } } });
  assert.ok(pv.items.some(i => i.symbol === 'SPXU' && i.side === 'BUY'), '가설 종목 매수 항목이 있다: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side, i.why])));
});

test('결정 60 ③: 200일선은 끝난 세션 종가로만 — 장중 미완성 봉이 아래로 내려가도 팔지 않고, 끝난 종가가 아래면 판다', async () => {
  const plan = { SPY: { pct: 10, name: 'SPY' } };
  // 계획 밖 보유(가설 아님) QQQ: 끝난 봉 104(위) · 오늘 장중 92(아래) → 유지
  let b = fakeBroker({ positions: [usPos('QQQ', 50, 92)], usPrice: 92 });
  let { pl } = make({ broker: b, map: { QQQ: bars({ done: 104, partial: 92 }) } });
  let pv = await pl.preview({ rules, plan });
  assert.ok(!pv.items.some(i => i.symbol === 'QQQ'), '장중 봉만 아래 → 유지: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side])));
  // 끝난 봉 92(아래) · 오늘 장중 104(위) → 판다(장중 반등으로 하루에 판정이 바뀌지 않는다)
  b = fakeBroker({ positions: [usPos('QQQ', 50, 104)], usPrice: 104 });
  ({ pl } = make({ broker: b, map: { QQQ: bars({ done: 92, partial: 104 }) } }));
  pv = await pl.preview({ rules, plan });
  assert.ok(pv.items.some(i => i.symbol === 'QQQ' && i.side === 'SELL'), '끝난 종가가 아래 → 매도: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side])));
});

test('결정 60 ④: 깨짐으로 표시한 가설의 남은 보유는 재조정에서 전량 정리된다 · 기본 계획에 있는 종목이면 정리하지 않는다', async () => {
  const b = fakeBroker({ positions: [usPos('SPXU', 52, 40)], usPrice: 40 });
  const { pl } = make({ broker: b, map: { SPXU: bars({ base: 40, done: 40.5, partial: 40 }) } });
  const h = pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true });
  pl.hypothesis('break', { id: h.id, note: '시험' });
  const pv = await pl.preview({ rules, plan: { SPY: { pct: 10, name: 'SPY' } }, rebalance: true });
  const s = pv.items.find(i => i.symbol === 'SPXU');
  assert.ok(s && s.side === 'SELL' && s.qty === 52, '깨진 가설 보유 전량 매도: ' + JSON.stringify(pv.items.map(i => [i.symbol, i.side, i.qty])));
  const pv2 = await pl.preview({ rules, plan: { SPY: { pct: 10, name: 'SPY' }, SPXU: { pct: 3, name: 'SPXU' } }, rebalance: true });
  assert.ok(!pv2.items.some(i => i.symbol === 'SPXU' && i.side === 'SELL' && i.qty === 52), '기본 계획 종목은 계획이 정한다: ' + JSON.stringify(pv2.items.map(i => [i.symbol, i.side, i.qty])));
});

test('결정 60 ⑤: 자동 깨짐 조건 검증 — 모르는 종류·종목 형식·범위 밖 값·닫힌 가설·목록 없음은 400', () => {
  const { pl } = make();
  const err = fn => { try { fn(); } catch (e) { return e; } return null; };
  let e = err(() => pl.hypothesis('add', { symbol: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'trailing', pct: 10 }] })); assert.equal(e?.status, 400); assert.match(e.message, /모르는 종류/);
  const h = pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'selfReturn', le: -35 }, { kind: 'close', symbol: 'spy', below: 623 }] });
  assert.deepEqual(h.stops, [{ kind: 'selfReturn', le: -35 }, { kind: 'close', symbol: 'SPY', below: 623 }], '정규화(대문자 · 쓰는 키만)');
  for (const bad of [[{ kind: 'close', symbol: 'BAD SYM!', below: 1 }], [{ kind: 'close', symbol: '^FOO', below: 1 }], [{ kind: 'close', symbol: 'SPY', below: 1, atOrAbove: 2 }], [{ kind: 'close', symbol: 'SPY' }], [{ kind: 'selfReturn', le: 5 }], [{ kind: 'recoverHigh', symbol: 'SPY', days: 3 }], [{ kind: 'recoverHigh', symbol: 'SPY', days: 2.5 }], Array.from({ length: 7 }, () => ({ kind: 'selfReturn', le: -10 }))]) {
    e = err(() => pl.hypothesis('stops', { id: h.id, stops: bad })); assert.equal(e?.status, 400, JSON.stringify(bad));
  }
  assert.equal(err(() => pl.hypothesis('stops', { id: h.id }))?.status, 400, '목록 없음');
  const set = pl.hypothesis('stops', { id: h.id, stops: [{ kind: 'close', symbol: '^VIX', below: 20 }, { kind: 'recoverHigh', symbol: 'SPY', days: 20 }] });
  assert.deepEqual(set.stops, [{ kind: 'close', symbol: '^VIX', below: 20 }, { kind: 'recoverHigh', symbol: 'SPY', days: 20 }]);
  assert.ok(pl._ledger().hypLog.some(l => l.event === 'stops' && /VIX 종가 20 아래/.test(l.note)));
  pl.hypothesis('break', { id: h.id });
  assert.equal(err(() => pl.hypothesis('stops', { id: h.id, stops: [] }))?.status, 400, '닫힌 가설에는 못 둔다');
});

const backdate = (pl, id, at = '2026-11-20T15:00:00Z') => { pl._ledger().hypotheses.find(h => h.id === id).openedAt = at; };

test('결정 60 ⑤: close 조건은 끝난 세션 종가로만 깨진다(오늘 장중 봉 무시) · 깨지면 자동 깨짐 기록', async () => {
  let { pl } = make({ map: { SPY: bars({ base: 650, done: 650, partial: 600 }) } });
  let h = pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: 'SPY', below: 623 }] }); backdate(pl, h.id);
  assert.deepEqual(await pl.checkHypStops(), [], '장중 600 은 무시(끝난 봉 650)'); assert.equal(pl._ledger().hypotheses[0].status, 'open');
  ({ pl } = make({ map: { SPY: bars({ base: 650, done: 610, partial: 640 }) } }));
  h = pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: 'SPY', below: 623 }] }); backdate(pl, h.id);
  const before = (await pl.status()).planVersionNow; // status 도 자동 깨짐을 본다(10분 간격 · 첫 호출은 바로)
  const x = pl._ledger().hypotheses[0];
  assert.equal(x.status, 'broken'); assert.match(x.closeNote, /^자동 제외: SPY 종가 623 아래 \(2026-11-23 SPY 종가 610\)/); // 2026-11-26 화면 말: 자동 깨짐 → 자동 제외 assert.equal(x.autoBroken.close, 610); assert.equal(x.autoBroken.date, '2026-11-23');
  assert.ok(!/\+H:/.test(before), '열린 가설이 없어져 계획 버전에서 빠진다(→ 자동 실행이 재조정): ' + before);
  assert.ok(pl._ledger().hypLog.some(l => l.event === 'auto-broken'));
});

test('결정 60 ⑤: selfReturn · recoverHigh · VIX — 조건 그대로 깨지고, 오래된 봉·가설 전 봉·이상한 VIX 값이면 아무것도 바꾸지 않는다(fail-closed)', async () => {
  // selfReturn: 10주 @100 매수, 끝난 종가 60 → −40% ≤ −35 → 깨짐 · 70(−30%)이면 그대로
  for (const [done, broken] of [[60, true], [70, false]]) {
    const { pl } = make({ map: { TQQQ: bars({ base: 100, done, partial: 100 }) } });
    const h = pl.hypothesis('add', { symbol: 'TQQQ', name: 'TQQQ', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'selfReturn', le: -35 }] }); backdate(pl, h.id);
    fill(pl, { at: '2026-11-20T15:30:00Z', symbol: 'TQQQ', side: 'BUY', qty: 10, price: 100, filledQty: 10, avgPrice: 100 });
    await pl.checkHypStops(); const x = pl._ledger().hypotheses[0];
    assert.equal(x.status === 'broken', broken, `selfReturn done=${done}`); if (broken) { assert.match(x.closeNote, /이 종목 수익 -40% · TQQQ 종가 60/); assert.equal(x.autoBroken.returnPct, -40); }
  }
  // recoverHigh: 직전 20개 끝난 봉 최고 ≈ 650.x → 끝난 종가 660 이면 회복(깨짐) · 600 이면 그대로
  for (const [done, broken] of [[660, true], [600, false]]) {
    const { pl } = make({ map: { SPY: bars({ base: 650, done, partial: 700 }) } });
    const h = pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true, stops: [{ kind: 'recoverHigh', symbol: 'SPY', days: 20 }] }); backdate(pl, h.id);
    await pl.checkHypStops(); assert.equal(pl._ledger().hypotheses[0].status === 'broken', broken, `recoverHigh done=${done}`);
  }
  // VIX 20 아래: 끝난 종가 18 → 깨짐 · 200(다른 시세가 섞인 값)이면 그대로
  for (const [done, broken] of [[18, true], [200, false]]) {
    const { pl } = make({ map: { '^VIX': bars({ base: 25, done, partial: 25 }) } });
    const h = pl.hypothesis('add', { symbol: 'SPXU', name: 'SPXU', capPct: 3, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: '^VIX', below: 20 }] }); backdate(pl, h.id);
    await pl.checkHypStops(); assert.equal(pl._ledger().hypotheses[0].status === 'broken', broken, `VIX done=${done}`);
  }
  // 오래된 봉(마지막 끝난 봉이 11-10) → 조건이 맞아도 그대로
  { const { pl } = make({ map: { SPY: bars({ until: '2026-11-11', base: 650, done: 500, partial: 500 }) } });
    const h = pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: 'SPY', below: 623 }] }); backdate(pl, h.id, '2026-11-01T15:00:00Z');
    await pl.checkHypStops(); assert.equal(pl._ledger().hypotheses[0].status, 'open', '5일 넘은 봉으로는 깨지 않는다'); }
  // 가설을 연 날 전의 봉 → 그대로(오늘 연 가설: 마지막 끝난 봉 11-23 < 연 날 11-24)
  { const { pl } = make({ map: { SPY: bars({ base: 650, done: 500, partial: 500 }) } });
    pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: 'SPY', below: 623 }] });
    await pl.checkHypStops(); assert.equal(pl._ledger().hypotheses[0].status, 'open', '연 날 전의 종가로는 깨지 않는다'); }
});

test('결정 60 ④⑤: 자동으로 깨진 가설의 보유는 다음 재조정에서 정리된다', async () => {
  const b = fakeBroker({ positions: [usPos('UPRO', 30, 80)], usPrice: 80 });
  const { pl } = make({ broker: b, map: { SPY: bars({ base: 650, done: 600, partial: 600 }), UPRO: bars({ base: 80, done: 80, partial: 80 }) } });
  const h = pl.hypothesis('add', { symbol: 'UPRO', name: 'UPRO', capPct: 5, thesis: 't', approve: true, stops: [{ kind: 'close', symbol: 'SPY', below: 623 }] }); backdate(pl, h.id);
  assert.equal((await pl.checkHypStops()).length, 1);
  const pv = await pl.preview({ rules, plan: { SPY: { pct: 10, name: 'SPY' } }, rebalance: true });
  assert.ok(pv.items.some(i => i.symbol === 'UPRO' && i.side === 'SELL' && i.qty === 30), JSON.stringify(pv.items.map(i => [i.symbol, i.side, i.qty])));
});

test('결정 60 ⑥: 공개 스냅샷 — 보유·매도 흐름과 자동 깨짐 조건은 싣고, 주문 번호 꼴 숫자는 지우며, 모르는 수익은 0 이 아니라 null', () => {
  const s = { version: 'L6', account: '****2787', balance: { cash: 1, total: 1, stock: 0, positions: [] }, marks: [], recentOrders: [], ordersToday: [], runs: [], auto: [],
    hypotheses: [{ id: 'H1', symbol: 'SPXU', name: 'SPXU', currency: 'USD', market: 'US', capPct: 3, horizonMonths: 3, thesis: 't', breakIf: 'VIX 20 아래', evidence: [], openedAt: '2026-11-23T08:07:30Z', closesAt: '2027-02-22T15:00:00Z', status: 'open',
      entryPrice: 40.87, price: null, qty: 0, heldQty: 0, boughtQty: 52, soldQty: 52, buyCost: 2125.24, sellProceeds: 2022.22, exitPrice: 38.89, realizedPct: -0.0485, returnPct: -0.0485, state: 'sold', lastSellWhy: '200일선 아래 0000033593', indexPct: null, excessPct: null, daysOpen: 1, expired: false,
      stops: [{ kind: 'close', symbol: '^VIX', below: 20 }], stopLabels: ['^VIX 종가 20 아래'], autoBroken: null }] };
  const pub = publicSnapshot(s, { asOf: '2026-11-24T00:00:00Z' }), h = pub.hypotheses[0];
  assert.equal(h.heldQty, 0); assert.equal(h.soldQty, 52); assert.equal(h.state, 'sold'); assert.equal(h.exitPrice, 38.89); assert.equal(h.price, null, 'null 은 null'); assert.equal(h.indexPct, null);
  assert.deepEqual(h.stops, [{ kind: 'close', symbol: '^VIX', le: null, below: 20, atOrAbove: null, days: null }]); assert.deepEqual(h.stopLabels, ['^VIX 종가 20 아래']);
  assert.ok(!JSON.stringify(pub).includes('0000033593'), '주문 번호 꼴 숫자 없음'); assert.ok(!('buyCost' in h) && !('sellProceeds' in h), '금액 합계는 싣지 않는다');
});
