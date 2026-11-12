// 통합증거금 보정(2026-11-12): 한투 모의계좌는 미국 주식을 원화로 사도 원화 예수금을 빼지 않아 총자산이 매수금액만큼 부풀려졌다(11-11 공개 숫자 +29.9%).
// ① 외화예수금이 없고 미국 보유가 있으면 증권사 매입금액(원화)을 현금·총자산에서 뺀다 ② 달러로 샀으면 빼지 않는다 ③ '목록에 없음'으로 소멸 처리한 주문을 다시 조회해 체결이면 바로잡는다
// ④ 미국 체결 조회는 거래소를 비워 전체를 받고, 거부되면 NASD·NYSE·AMEX 로 나눠 조회한다 ⑤ 잔고가 매입금액(원화)을 돌려준다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { createKisClient } from '../lib/kis-orders.js';

function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0004 + (r() - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async s => ({ candles: candles(520, s === 'KRW=X' ? 1330 : /^\d{6}$/.test(s) ? 70000 : 100, s.length + 3).map(c => s === 'KRW=X' ? { ...c, close: 1330, open: 1330 } : c) });
const KR = [{ symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 138, price: 85000, value: 11_730_000, valueKrw: 11_730_000 }];
const US = [{ symbol: 'JNJ', name: 'JNJ', market: 'US', currency: 'USD', exchange: 'NYSE', qty: 17, price: 280.41, value: 4766.97, avgCost: 281.74 }, { symbol: 'SPY', name: 'SPY', market: 'US', currency: 'USD', exchange: 'AMEX', qty: 7, price: 759.81, value: 5318.67, avgCost: 749.01 }];
const COST_KRW = 13_409_913; // (17×281.74 + 7×749.01) × 1336.7
function broker({ cashUsd = 0, usCostKrw = COST_KRW, orders = [] } = {}) {
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787' }),
    async price(code) { const us = !/^\d{6}$/.test(code); return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NYSE' : 'KRX', price: us ? 100 : 85000, upper: 0, lower: 0, halted: false }; },
    // 모의계좌 그대로: 원화 예수금 62,669,084 는 미국 매수 뒤에도 안 줄었고, 총평가(tot_evlu_amt)는 원화 예수금 + 국내 주식만이다.
    async balance() { return { cash: 62_669_084, total: 62_669_084 + 11_730_000, stock: 11_730_000, positions: [...KR, ...US], cashUsd, stockUsd: US.reduce((a, p) => a + p.value, 0), usCostKrw, usError: null }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; },
    async place() { throw new Error('이 테스트는 주문하지 않는다'); },
    async cancel() { return {}; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return client;
}
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-fund-'));
const L = { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 };

test('① 외화예수금 0 + 미국 보유: 매입금액(원화)을 현금·총자산에서 빼고, 평가점과 미리보기 잔고가 같은 숫자를 쓴다', async () => {
  const t = Date.parse('2026-11-12T04:00:00Z'); const pl = createPaperLive({ client: broker(), store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const st = await pl.status(); const b = st.balance;
  const usKrw = (4766.97 + 5318.67) * 1330;
  assert.equal(b.cash, 62_669_084 - COST_KRW); assert.equal(b.cashRawKrw, 62_669_084); assert.equal(b.usFundingKrw, COST_KRW);
  assert.equal(b.total, Math.round(62_669_084 + 11_730_000 + usKrw - COST_KRW), '총자산 = 원화 예수금 + 국내 주식 + 미국 주식×환율 − 정산 전 매수대금');
  assert.ok(b.total < 62_669_084 + 11_730_000 + usKrw - 1_000_000, '보정 없는 값(이중 계산)보다 작아야 한다');
  const m = st.marks.at(-1); assert.equal(m.total, b.total); assert.equal(m.cash, b.cash); assert.equal(m.funding, COST_KRW);
  const pv = await pl.preview({ rules: { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 }, plan: { '069500': { pct: 20, name: 'KODEX 200' } } });
  assert.equal(pv.balance.cash, b.cash); assert.equal(pv.balance.usFundingKrw, COST_KRW); assert.equal(pv.balance.total, b.total);
});

test('② 달러로 샀으면(외화예수금 > 0) 빼지 않는다 · 미국 보유가 없으면 보정 0', async () => {
  const t = Date.parse('2026-11-12T04:00:00Z');
  const a = await createPaperLive({ client: broker({ cashUsd: 2500 }), store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L }).status();
  assert.equal(a.balance.usFundingKrw, 0); assert.equal(a.balance.cash, 62_669_084); assert.equal(a.balance.total, Math.round(62_669_084 + 11_730_000 + (4766.97 + 5318.67 + 2500) * 1330));
  assert.equal(a.marks.at(-1).funding, undefined);
  const c = broker(); c.balance = async () => ({ cash: 1000, total: 1000, stock: 0, positions: [], cashUsd: 0, stockUsd: 0, usCostKrw: 0 });
  const b = await createPaperLive({ client: c, store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L }).status(); assert.equal(b.balance.usFundingKrw, 0); assert.equal(b.balance.total, 1000);
});

test("③ '목록에 없음'으로 소멸 처리된 주문을 다시 조회해 체결이면 filled 로 바로잡고 기록을 남긴다 · 진짜 없는 주문은 그대로", async () => {
  const t = Date.parse('2026-11-12T04:00:00Z');
  const brokerRows = [{ market: 'US', odno: '9001', orgno: '', code: 'JNJ', side: 'BUY', qty: 17, filled: 17, remaining: 0, price: 281.84, avgPrice: 281.74, cancelled: false, rejected: false, status: 'filled' }];
  const pl = createPaperLive({ client: broker({ orders: brokerRows }), store: createLedgerStore(tmp()), readMarket, now: () => t, limits: L });
  const led = pl._ledger();
  led.orders.push({ at: '2026-11-10T14:36:45.843Z', symbol: 'JNJ', name: 'JNJ', market: 'US', currency: 'USD', side: 'BUY', qty: 17, price: 281.84, odno: '9001', status: 'expired', filledQty: 0, remaining: 17, note: '장 마감으로 소멸(증권사 2026-11-10 주문 목록에 없음 · 미체결 17주)', expiredAt: '2026-11-11T00:00:00Z', why: 't' });
  led.orders.push({ at: '2026-11-10T14:36:46.000Z', symbol: 'SPY', name: 'SPY', market: 'US', currency: 'USD', side: 'BUY', qty: 7, price: 749.05, odno: '9002', status: 'expired', filledQty: 0, remaining: 7, note: '장 마감으로 소멸(증권사 2026-11-10 주문 목록에 없음 · 미체결 7주)', why: 't' });
  led.orders.push({ at: '2026-11-05T14:36:46.000Z', symbol: 'LMT', name: 'LMT', market: 'US', currency: 'USD', side: 'BUY', qty: 5, price: 590, odno: '9003', status: 'expired', filledQty: 0, remaining: 5, note: '장 마감으로 소멸(증권사 2026-11-05 주문 목록에 없음 · 미체결 5주)', why: 't' });
  const st = await pl.status(); const o = Object.fromEntries(st.recentOrders.map(x => [x.symbol, x]));
  assert.equal(o.JNJ.status, 'filled'); assert.equal(o.JNJ.filledQty, 17); assert.equal(o.JNJ.avgPrice, 281.74); assert.match(o.JNJ.note, /바로잡음/); assert.equal(o.JNJ.expiredAt, undefined);
  assert.equal(o.SPY.status, 'expired', '증권사 목록에 여전히 없으면 그대로'); assert.doesNotMatch(o.SPY.note, /바로잡음/);
  assert.equal(o.LMT.status, 'expired', '4일 넘은 것은 다시 보지 않는다');
  assert.equal(st.recentOrders.length, 3);
});

test('④ 미국 체결 조회: 거래소를 비워 한 번에 받고, 거부되면 NASD·NYSE·AMEX 로 나눠 합친다(중복 제거) · ⑤ 잔고가 매입금액(원화)을 돌려준다', async () => {
  const calls = []; let rejectBlank = false;
  const row = (pdno, ex, odno) => ({ pdno, ovrs_excg_cd: ex, odno, sll_buy_dvsn_cd: '02', ft_ord_qty: '5', ft_ccld_qty: '5', nccs_qty: '0', ft_ord_unpr3: '100', ft_ccld_unpr3: '99.5', prcs_stat_name: '' });
  const fetch = async (url) => { const u = new URL(url); calls.push(u); const h = { get: () => '' };
    if (u.pathname.endsWith('tokenP')) return { ok: true, json: async () => ({ access_token: 'T', expires_in: 86400 }) };
    if (u.pathname.endsWith('/inquire-ccnl')) { const ex = u.searchParams.get('OVRS_EXCG_CD'); if (ex === '' && rejectBlank) return { ok: true, headers: h, json: async () => ({ rt_cd: '1', msg_cd: 'X', msg1: '거래소코드 필수' }) };
      const all = [row('MSFT', 'NASD', '1'), row('JNJ', 'NYSE', '2'), row('SPY', 'AMEX', '3')]; return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: ex === '' ? all : all.filter(r => r.ovrs_excg_cd === ex) }) }; }
    if (u.pathname.endsWith('/overseas-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [{ ovrs_pdno: 'JNJ', ovrs_item_name: 'JNJ', ovrs_cblc_qty: '17', now_pric2: '280.41', ovrs_stck_evlu_amt: '4766.97', pchs_avg_pric: '281.74', ovrs_excg_cd: 'NYSE' }], output2: { frcr_pchs_amt1: '6402509.3', frcr_buy_amt_smtl1: '6402509.3' } }) };
    if (u.pathname.endsWith('/inquire-present-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output2: [{ crcy_cd: 'USD', frcr_dncl_amt_2: '0' }] }) };
    if (u.pathname.endsWith('/domestic-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [], output2: [{ dnca_tot_amt: '62669084', prvs_rcdl_excc_amt: '62669084', scts_evlu_amt: '0', tot_evlu_amt: '62669084' }] }) };
    return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: [], output1: [] }) }; };
  const env = { KIS_MODE: 'vps', KIS_APP_KEY: 'k'.repeat(36), KIS_APP_SECRET: 's'.repeat(180), KIS_ACCOUNT_NO: '50222787' };
  const c = createKisClient({ env, fetch, now: () => 0, minGapMs: 0, sleep: async () => { } });
  let us = (await c.orders('20261110')).filter(x => x.market === 'US');
  assert.deepEqual(us.map(x => x.code).sort(), ['JNJ', 'MSFT', 'SPY']); assert.ok(us.every(x => x.status === 'filled' && x.avgPrice === 99.5));
  assert.equal(calls.filter(u => u.pathname.endsWith('/inquire-ccnl')).length, 1, '빈 거래소 코드로 한 번');
  rejectBlank = true; calls.length = 0; us = (await c.orders('20261110')).filter(x => x.market === 'US');
  assert.deepEqual(us.map(x => x.code).sort(), ['JNJ', 'MSFT', 'SPY']);
  assert.deepEqual(calls.filter(u => u.pathname.endsWith('/inquire-ccnl')).map(u => u.searchParams.get('OVRS_EXCG_CD')), ['', 'NASD', 'NYSE', 'AMEX']);
  const b = await c.balance(); assert.equal(b.usCostKrw, 6402509.3); assert.equal(b.cashUsd, 0); assert.equal(b.stockUsd, 4766.97); assert.ok(Math.abs(b.usCostUsd - 17 * 281.74) < 1e-6);
});
