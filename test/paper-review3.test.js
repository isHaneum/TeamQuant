// 3차 검토(2026-11-10)에서 반박된 두 가지: ① client.orders() 가 미국 목록 조회 실패를 삼키므로 "목록에 없음 → 소멸" 은 미국 행이 하나라도 있을 때만 적용한다(fail-closed)
// ② 차단 이유 요약(runs.blockedReasons)에 주문 번호가 섞여 공개 스냅샷으로 나갔다 → 엔진은 키에서 번호를 떼고, 공개 스냅샷은 긴 숫자열을 지운다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';
import { systemCheck } from '../lib/paper-integrity.js';

function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const isKr = code => /^\d{6}$/.test(code);
/** 가짜 증권사. state.usFail 이면 kis-orders.js orders() 처럼 미국 목록 조회 실패를 삼키고 국내 행만 돌려준다. 주문 번호는 실제처럼 10자리. */
function broker({ cash = 50_000_000, positions = [] } = {}) {
  const orders = []; let seq = 1234567000; const state = { cash, positions, placed: [], listFail: false, usFail: false };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { const us = !isKr(code); return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NASD' : null, price: us ? 100 : 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), stock: state.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), positions: state.positions, cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); const odno = String(++seq); orders.push({ market: isKr(code) ? 'KR' : 'US', odno, orgno: '91252', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); return { odno, orgno: '91252', msg: '모의투자 주문이 완료 되었습니다.' }; },
    async cancel({ odno }) { const o = orders.find(x => x.odno === odno); if (o) { o.cancelled = true; o.status = 'cancelled'; } return { odno }; },
    async orders() { if (state.listFail) throw new Error('조회 장애'); const all = orders.map(o => ({ ...o })); return state.usFail ? all.filter(o => o.market === 'KR') : all; }
  };
  const fill = (odno, qty) => { const o = orders.find(x => x.odno === odno); o.filled = qty; o.remaining = o.qty - qty; o.avgPrice = o.price; o.status = qty >= o.qty ? 'filled' : 'partial'; };
  return { client, state, orders, fill };
}
const readMarket = async s => ({ candles: candles(520, s === 'KRW=X' ? 1400 : isKr(s) ? 70000 : 100, s.length + 3) });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-review3-'));
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 }, L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };
const KR_1302 = Date.parse('2026-11-09T04:02:00Z'), US_2338 = Date.parse('2026-11-09T14:38:00Z');

test('미국 목록 조회가 조용히 실패하면(국내 행만 옴) 지난 거래일의 미국 주문을 소멸로 닫지 않고, 미국 행이 돌아오면 그때 체결로 맞춘다', async () => {
  let t = US_2338; const b = broker({ cash: 100_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r = await pl.run({ rules, plan: { NVDA: { pct: 5, name: '엔비디아', currency: 'USD' } }, rebalance: true });
  const o = pl._ledger().orders.find(x => x.symbol === 'NVDA'); assert.ok(o && o.status === 'sent', JSON.stringify(r.items.map(i => i.blocks)));
  b.fill(o.odno, o.qty); // 증권사는 실제로 체결했다
  // 국내 주문도 하나 있어 목록이 비어 있지는 않다(국내 행만 돌아오는 상황)
  pl._ledger().orders.push({ key: 'kr', at: '2026-11-09T04:02:00Z', symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 1, price: 70000, amountKrw: 70000, status: 'sent', odno: '1234567999', why: 't', remaining: 1 });
  b.orders.push({ market: 'KR', odno: '1234567999', orgno: '', code: '005930', side: 'BUY', qty: 1, filled: 0, remaining: 1, price: 70000, avgPrice: null, cancelled: false, status: 'open' });
  b.state.usFail = true; t = Date.parse('2026-11-10T13:00:00Z'); // 화 22:00 KST = 08:00 ET → 뉴욕 거래일 11-10, 국내도 11-10
  const rc = await pl.reconcile();
  assert.equal(o.status, 'sent', '미국 행이 없는 목록은 미국 주문 부재의 증거가 아니다: ' + o.note); assert.equal(o.filledQty, 0);
  const kr = pl._ledger().orders.find(x => x.symbol === '005930'); assert.equal(kr.status, 'expired', '국내 주문은 목록에 있고 open 이라 소멸'); assert.equal(rc.updated, 1);
  assert.equal(systemCheck(pl._ledger(), t).leftOpen, 1, '닫지 못한 미국 주문은 점검에 남는다');
  b.state.usFail = false; await pl.reconcile();
  assert.equal(o.status, 'filled'); assert.equal(o.filledQty, o.qty); assert.equal(systemCheck(pl._ledger(), t).leftOpen, 0);
  // 미국 행이 하나라도 있는 성공한 목록에 없으면 그때는 소멸
  pl._ledger().orders.push({ key: 'us2', at: '2026-11-09T14:50:00Z', symbol: 'AAPL', name: '애플', market: 'US', currency: 'USD', side: 'BUY', qty: 3, price: 100, fx: 1400, amountKrw: 420000, status: 'sent', odno: '1234560000', why: 't', remaining: 3 });
  await pl.reconcile(); const ap = pl._ledger().orders.find(x => x.symbol === 'AAPL'); assert.equal(ap.status, 'expired'); assert.match(ap.note, /주문 목록에 없음/);
});

test('차단 이유 요약과 공개 스냅샷에 주문 번호·계좌번호 꼴 숫자열이 남지 않는다', async () => {
  let t = KR_1302; const pos = [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 300, price: 70000, value: 21_000_000, valueKrw: 21_000_000 }];
  const b = broker({ cash: 50_000_000, positions: pos }); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const r1 = await pl.run({ rules, plan: { '005930': { pct: 5, name: '삼성전자' } }, rebalance: true });
  const sell = r1.sent.find(x => x.side === 'SELL'); assert.ok(sell?.odno && /^\d{10}$/.test(sell.odno));
  t += 20 * 60e3; const r2 = await pl.run({ rules, plan: { '005930': { pct: 5, name: '삼성전자' } } });
  const it = r2.items.find(i => i.symbol === '005930'); assert.ok(it.blocks.some(x => x.includes(sell.odno)), '화면(PC)용 차단 이유에는 주문 번호가 남는다');
  const st = await pl.status(); const keys = Object.keys(st.runs.at(-1).blockedReasons);
  assert.deepEqual(keys, ['삼성전자에 끝나지 않은 주문이 있습니다(sent).']);
  const text = JSON.stringify(publicSnapshot(st));
  assert.ok(!text.includes(sell.odno) && !text.includes('2787') && !text.includes('91252') && !/odno|orgno|tq-review3|완료 되었습니다/.test(text), text.slice(0, 400));
  // 옛 장부의 요약 키·증권사 오류문·메모에 섞인 번호도 공개 스냅샷에서 지워진다. 금액(쉼표)은 남는다.
  const pub = publicSnapshot({ recentOrders: [{ at: 'x', symbol: '005930', status: 'rejected', error: '주문번호 0001234567 계좌 50123456-01 거부', note: '증권사 주문 목록에 없음(성공한 조회 2회, 11분 간격)' }], runs: [{ at: 'x', blockedReasons: { '삼성전자에 끝나지 않은 주문이 있습니다(sent · 0001234567)': 1, '오늘 주문 합계가 한도 60,000,000원을 넘습니다': 9 } }] });
  assert.equal(pub.recentOrders[0].error, '주문번호 … 계좌 …-01 거부'); assert.equal(pub.recentOrders[0].note, '증권사 주문 목록에 없음(성공한 조회 2회, 11분 간격)');
  assert.deepEqual(pub.runs[0].blockedReasons, { '삼성전자에 끝나지 않은 주문이 있습니다(sent)': 1, '오늘 주문 합계가 한도 60,000,000원을 넘습니다': 9 });
});
