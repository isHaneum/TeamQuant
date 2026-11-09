// 시스템 점검 + 미확인 주문 정책: 합성 장부·가짜 증권사로 오류 상황을 강제로 만든다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemCheck } from '../lib/paper-integrity.js';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';

const T0 = Date.parse('2026-11-09T01:30:00Z');
const o = (over) => ({ at: new Date(T0).toISOString(), symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 10, price: 70000, amountKrw: 700000, why: '계획 비중보다 적음', status: 'filled', filledQty: 10, ...over });

test('시스템 점검: 중복 주문·미확인 뒤 재전송·이유 없는 주문·오래된 미확인을 센다', () => {
  const clean = systemCheck({ orders: [o({}), o({ symbol: '000660', at: new Date(T0 + 60e3).toISOString() })], runs: [] }, T0 + 3600e3);
  assert.equal(clean.ok, true); assert.deepEqual(clean.items.map(i => i.count), [0, 0, 0, 0]);
  const dirty = systemCheck({ orders: [
    o({}), o({ at: new Date(T0 + 30e3).toISOString() }),                                  // 같은 주문이 30초 안에 둘 → 중복 1
    o({ symbol: 'NVDA', status: 'not_found', at: new Date(T0 + 100e3).toISOString() }), o({ symbol: 'NVDA', status: 'sent', at: new Date(T0 + 200e3).toISOString() }), // 미확인 뒤 재전송 1
    o({ symbol: '069500', why: '' }),                                                       // 이유 없음 1
    o({ symbol: '035420', status: 'unknown', at: new Date(T0 - 2 * 3600e3).toISOString() }) // 2시간째 미확인 1
  ] }, T0 + 300e3);
  assert.equal(dirty.ok, false); assert.deepEqual([dirty.duplicates, dirty.resentAfterNotFound, dirty.noReason, dirty.staleUnknown], [1, 1, 1, 1]);
  // 재조정은 먼저 취소하고 다시 내므로 취소된 건은 중복이 아니다
  assert.equal(systemCheck({ orders: [o({ status: 'cancelled' }), o({ at: new Date(T0 + 30e3).toISOString() })] }).duplicates, 0);
});

// ── 가짜 증권사: 주문은 접수되지만 목록에 늦게(또는 영영) 안 나타나게 조작할 수 있다 ──
function broker({ cash = 50_000_000, hideOrders = false } = {}) {
  const orders = []; let seq = 300; const state = { cash, positions: [], price: 70000, placed: [], hideOrders, listCalls: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { return { code, market: 'KR', currency: 'KRW', price: state.price, upper: state.price * 1.3, lower: state.price * 0.7, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash, stock: 0, positions: state.positions, cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); const odno = String(++seq); orders.push({ market: 'KR', odno, orgno: '', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); const e = new Error('시간 초과'); e.code = 'network'; throw e; },
    async cancel({ odno }) { return { odno }; },
    async orders(d) { state.listCalls.push(d); return state.hideOrders ? [] : orders.map(x => ({ ...x })); }
  };
  return { client, state, orders };
}
function candles(n = 520, start = 70000) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = 11; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async () => ({ candles: candles() });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-integrity-'));
const plan = { '005930': { pct: 20, name: '삼성전자' } }, rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };

test('미확인 주문: 성공한 조회 두 번(10분 이상 간격)에서 모두 없어야 not_found 가 되고, 그 뒤에도 그날은 같은 종목에 다시 주문하지 않는다', async () => {
  let t = T0; const now = () => t; const b = broker({ hideOrders: true }); const dir = tmp();
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const r1 = await pl.run({ rules, plan }); assert.equal(r1.sent.length, 1); assert.equal(r1.sent[0].status, 'unknown');
  // 첫 재조회(바로): 없음 → 아직 unknown
  t += 60e3; await pl.reconcile(); let led = pl._ledger(); assert.equal(led.orders[0].status, 'unknown'); assert.equal(led.orders[0].misses.length, 2);
  // 5분 뒤: 아직 10분 간격이 안 됨
  t += 5 * 60e3; await pl.reconcile(); assert.equal(pl._ledger().orders[0].status, 'unknown');
  // 12분 뒤: not_found
  t += 7 * 60e3; await pl.reconcile(); led = pl._ledger(); assert.equal(led.orders[0].status, 'not_found'); assert.ok(/다시 주문하지 않습니다/.test(led.orders[0].note));
  // 같은 날 같은 종목: 차단되고 보내지 않는다
  const r2 = await pl.run({ rules, plan }); assert.equal(r2.sent.length, 0); assert.ok(r2.items.some(i => !i.ok && i.blocks.some(x => /접수 여부를 확인하지 못한/.test(x))), JSON.stringify(r2.items.map(i => i.blocks)));
  assert.equal(b.state.placed.length, 1, '증권사에 두 번 보내지 않음');
  assert.equal(pl._ledger().integrity?.resentAfterNotFound, undefined); const st = await pl.status(); assert.equal(st.integrity.resentAfterNotFound, 0); assert.equal(st.integrity.notFound, 1);
});

test('조회 자체가 실패하면 어떤 상태도 바꾸지 않는다 · 주문 목록에 나타나면 번호를 붙인다', async () => {
  let t = T0; const b = broker({ hideOrders: true }); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  await pl.run({ rules, plan });
  const orig = b.client.orders; b.client.orders = async () => { throw new Error('조회 장애'); };
  t += 30 * 60e3; await assert.rejects(pl.reconcile()); assert.equal(pl._ledger().orders[0].status, 'unknown'); assert.equal((pl._ledger().orders[0].misses || []).length, 1, '실패한 조회는 miss 로 세지 않음');
  b.client.orders = orig; b.state.hideOrders = false; await pl.reconcile(); const o0 = pl._ledger().orders[0]; assert.equal(o0.status, 'sent'); assert.ok(o0.odno);
});

test('밤에 낸 미국 주문은 자정(KST)을 넘겨도 그 주문의 날짜로 조회해 맞춘다', async () => {
  let t = Date.parse('2026-11-09T14:40:00Z'); // 23:40 KST, 미국 장 열림
  const b = broker(); b.client.price = async code => ({ code, market: 'US', currency: 'USD', exchange: 'NASD', price: 100, upper: 0, lower: 0, halted: false });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket: async s => ({ candles: candles(520, s === 'KRW=X' ? 1400 : 100) }), now: () => t, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const r = await pl.run({ rules, plan: { NVDA: { pct: 20, name: '엔비디아' } } }); assert.equal(r.sent.length, 1); assert.equal(r.sent[0].market, 'US');
  t = Date.parse('2026-11-09T16:30:00Z'); // 01:30 KST 다음 날
  b.state.listCalls = []; await pl.reconcile();
  assert.ok(b.state.listCalls.includes('20261109'), '주문의 KST 날짜로 조회: ' + b.state.listCalls.join(','));
  assert.equal(pl._ledger().orders[0].status, 'sent'); assert.ok(pl._ledger().orders[0].odno);
});

test('규칙 변경 이력: 처음은 근거 없이 저장, 바꿀 때는 근거가 있어야 하고 무엇이 바뀌었는지 남는다 · 비공개 가설은 공개 스냅샷에서 빠진다', async () => {
  const b = broker(); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => T0 });
  const p1 = pl.setPrefs({ rules: { maxSingle: 20 }, cadence: 'weekly' }); assert.deepEqual(p1.changed, ['init']);
  assert.throws(() => pl.setPrefs({ rules: { maxSingle: 15 }, cadence: 'weekly' }), /근거/);
  const p2 = pl.setPrefs({ rules: { maxSingle: 15 }, cadence: 'monthly', reason: '한도 초과일 3/15', expected: '초과일 10% 아래' }); assert.deepEqual(p2.changed, ['maxSingle', 'cadence']);
  const p3 = pl.setPrefs({ rules: { maxSingle: 15 }, cadence: 'monthly' }); assert.deepEqual(p3.changed, [], '같은 값은 변경이 아니므로 근거 없이도 통과');
  const st = await pl.status(); assert.equal(st.prefsHistory.length, 2); assert.equal(st.prefsHistory[1].reason, '한도 초과일 3/15'); assert.equal(st.prefsHistory[1].before.rules.maxSingle, 20);
  pl.hypothesis('add', { symbol: '000660', name: 'SK하이닉스', capPct: 3, thesis: '공개', public: true });
  pl.hypothesis('add', { symbol: '005930', name: '삼성전자', capPct: 3, thesis: '비공개 메모', public: false });
  const pub = publicSnapshot(await pl.status());
  assert.equal(pub.hypotheses.length, 1); assert.equal(pub.hiddenHypotheses, 1); assert.ok(!JSON.stringify(pub).includes('비공개 메모'));
  assert.equal(pub.prefsHistory.length, 2); assert.ok(pub.integrity && pub.activity30);
});

test('기준선: 처음 할 일을 정할 때 계획·규칙·총자산이 고정돼 남고, 뒤에 규칙을 바꿔도 그대로다', async () => {
  const b = broker(); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => T0, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  await pl.preview({ rules, plan }); const st = await pl.status();
  assert.equal(st.baseline.from, '2026-11-09'); assert.equal(st.baseline.plan['005930'].pct, 20); assert.equal(st.baseline.rules.maxSingle, 25); assert.equal(st.baseline.capitalKrw, 50_000_000);
  pl.setPrefs({ rules: { maxSingle: 15 }, cadence: 'weekly' }); await pl.preview({}); assert.equal((await pl.status()).baseline.rules.maxSingle, 25);
});
