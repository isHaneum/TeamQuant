// 모의계좌 엔진 2단계: 미국 종목(달러·환율·미국 장 시간), 기본 계획, 날마다 한 점(marks). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { createKisClient, marketOpen, roundTick, TR, marketOf } from '../lib/kis-orders.js';

function fakeBroker({ cash = 50_000_000, positions = [], prices = { KR: 70000, US: 180 } } = {}) {
  const orders = []; let seq = 500; const state = { cash, positions, prices, placed: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787', product: '01', baseUrl: 'fake' }),
    async price(code) { const us = marketOf(code) === 'US'; return { code, market: us ? 'US' : 'KR', currency: us ? 'USD' : 'KRW', exchange: us ? 'NASD' : 'KRX', price: us ? state.prices.US : state.prices.KR, upper: us ? null : state.prices.KR * 1.3, lower: us ? null : state.prices.KR * 0.7, halted: false }; },
    async balance() { const kr = state.positions.filter(p => p.currency !== 'USD'), us = state.positions.filter(p => p.currency === 'USD'); return { cash: state.cash, total: state.cash + kr.reduce((a, p) => a + p.valueKrw, 0), stock: kr.reduce((a, p) => a + p.valueKrw, 0), positions: state.positions, cashUsd: 0, stockUsd: us.reduce((a, p) => a + (p.value || 0), 0), usError: null }; },
    async buyingPower(code, px) { return { code, maxQty: 1e6, cashQty: 1e6, cashAmt: 1e9 }; },
    async place({ code, side, qty, price, exchange }) { state.placed.push({ code, side, qty, price, exchange }); const odno = String(++seq); orders.push({ market: marketOf(code), odno, orgno: '', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, cancelled: false, status: 'open' }); return { odno, orgno: '', exchange }; },
    async cancel({ odno }) { const o = orders.find(x => x.odno === odno); if (o) { o.cancelled = true; o.status = 'cancelled'; } return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state, orders };
}
function candles(n = 520, start = 100, seed = 7) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0003 + (r() - 0.5) * 0.03; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; }
const readMarket = async sym => ({ candles: sym === 'KRW=X' ? candles(520, 1400, 3).map(c => ({ ...c, close: 1400 + (c.close - 1400) * 0.05 })) : candles(520, marketOf(sym) === 'US' ? 180 : 70000, sym.length) });
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-paper-us-'));
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };
const kstMonday1030 = () => Date.parse('2026-11-09T01:30:00Z'); // 한국 장중 · 미국 장전
const usTuesday1100ET = () => Date.parse('2026-11-10T16:00:00Z'); // 11:00 ET(EST) = 한국 01:00 수요일 · 한국 장 닫힘
const plan = { '005930': { pct: 20, name: '삼성전자' }, 'NVDA': { pct: 20, name: '엔비디아' }, 'SPY': { pct: 10, name: 'S&P500 ETF' } };

test('시장별 장 시간: 한국 장중에는 국내만, 미국 장중에는 미국만 나간다 · 미국 주문은 달러 지정가·환율로 원화 환산', async () => {
  const b = fakeBroker({ cash: 50_000_000 });
  let pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  const r = await pl.run({ rules, plan });
  assert.deepEqual(r.skipped, []);
  const kr = r.items.find(i => i.symbol === '005930'), nv = r.items.find(i => i.symbol === 'NVDA');
  assert.ok(kr.ok, JSON.stringify(kr.blocks)); assert.ok(!nv.ok && nv.blocks.some(t => /미국 (장 시작 전|주말)/.test(t)), JSON.stringify(nv.blocks));
  assert.ok(r.sent.every(s => s.market === 'KR'));
  // 미국 장중
  const b2 = fakeBroker({ cash: 50_000_000 });
  pl = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: usTuesday1100ET, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  const r2 = await pl.run({ rules, plan });
  const nv2 = r2.items.find(i => i.symbol === 'NVDA'), kr2 = r2.items.find(i => i.symbol === '005930');
  assert.ok(nv2.ok, JSON.stringify(nv2.blocks)); assert.ok(!kr2.ok);
  assert.ok(r2.fx > 1000 && nv2.fx === r2.fx); assert.equal(nv2.currency, 'USD'); assert.equal(nv2.price, roundTick(180, 'BUY', 'US'));
  assert.ok(Math.abs(nv2.amountKrw - nv2.qty * nv2.price * r2.fx) < 1, '원화 환산 금액');
  assert.ok(b2.state.placed.some(p => p.code === 'NVDA' && p.exchange === 'NASD'));
  const sentUs = r2.sent.find(s => s.symbol === 'NVDA'); assert.equal(sentUs.status, 'sent'); assert.equal(sentUs.currency, 'USD');
});

test('기본 계획: 요청에 계획이 없으면 defaultPlan 을 쓰고 planSource 가 default 다 · 날마다 한 점(marks)이 남는다', async () => {
  const b = fakeBroker({ cash: 10_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, defaultPlan: () => ({ '005930': { pct: 30, name: '삼성전자' } }), limits: { maxOrderKrw: 5_000_000, maxDailyKrw: 20_000_000 } });
  const pv = await pl.preview({ rules });
  assert.equal(pv.planSource, 'default'); assert.equal(pv.planSize, 1); assert.ok(pv.items.some(i => i.symbol === '005930'));
  const pv2 = await pl.preview({ rules, plan }); assert.equal(pv2.planSource, 'request');
  const st = await pl.status(); assert.equal(st.marks.length, 1); assert.equal(st.marks[0].date, '2026-11-09'); assert.ok(st.marks[0].total > 0); assert.equal(st.hasDefaultPlan, true);
});

test('미국 장 시간 계산(서머타임 자동)', () => {
  assert.equal(marketOpen(new Date('2026-11-10T16:00:00Z'), 'US').open, true);   // 11:00 EST
  assert.match(marketOpen(new Date('2026-11-10T14:00:00Z'), 'US').reason, /장 시작 전/); // 09:00 EST
  assert.match(marketOpen(new Date('2026-11-10T20:55:00Z'), 'US').reason, /마감 10분 전/); // 15:55 EST
  assert.equal(marketOpen(new Date('2026-07-14T14:00:00Z'), 'US').open, true);   // 10:00 EDT
  assert.match(marketOpen(new Date('2026-11-08T16:00:00Z'), 'US').reason, /주말/);
  assert.equal(roundTick(180.456, 'BUY', 'US'), 180.45); assert.equal(roundTick(180.451, 'SELL', 'US'), 180.46);
});

test('한투 클라이언트(미국): 시세 거래소 탐색 → 주문 거래소 코드, 매수 tr_id, 본문 필드, 잔고 합치기', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); if (url.includes('tokenP')) return { ok: true, json: async () => ({ access_token: 'T', expires_in: 86400 }) };
    const u = new URL(url); const h = { get: () => '' };
    if (u.pathname.endsWith('/quotations/price')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: { last: u.searchParams.get('EXCD') === 'NAS' ? '' : '181.25', base: '180' } }) }; // NAS 에 없고 NYS 에 있음
    if (u.pathname.endsWith('/trading/order')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', msg1: 'ok', output: { ODNO: '77', ORD_TMD: '233001' } }) };
    if (u.pathname.endsWith('/overseas-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [{ ovrs_pdno: 'KO', ovrs_item_name: 'COCA-COLA', ovrs_cblc_qty: '10', now_pric2: '70.5', ovrs_stck_evlu_amt: '705', pchs_avg_pric: '68', ovrs_excg_cd: 'NYSE' }], output2: {} }) };
    if (u.pathname.endsWith('/inquire-present-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output2: [{ crcy_cd: 'USD', frcr_dncl_amt_2: '1234.5' }] }) };
    if (u.pathname.endsWith('/domestic-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [], output2: [{ dnca_tot_amt: '1000', prvs_rcdl_excc_amt: '1000', scts_evlu_amt: '0', tot_evlu_amt: '1000' }] }) };
    return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: {} }) }; };
  const env = { KIS_MODE: 'vps', KIS_APP_KEY: 'k'.repeat(36), KIS_APP_SECRET: 's'.repeat(180), KIS_ACCOUNT_NO: '50222787' };
  const c = createKisClient({ env, fetch, now: () => 0 });
  const p = await c.price('KO'); assert.equal(p.exchange, 'NYSE'); assert.equal(p.price, 181.25); assert.equal(p.currency, 'USD');
  const r = await c.place({ code: 'KO', side: 'BUY', qty: 2, price: 181.25 }); assert.equal(r.odno, '77'); assert.equal(r.exchange, 'NYSE');
  const call = calls.at(-1); assert.equal(call.init.headers.tr_id, TR.buyUS.vps); const body = JSON.parse(call.init.body);
  assert.deepEqual([body.OVRS_EXCG_CD, body.PDNO, body.ORD_QTY, body.OVRS_ORD_UNPR, body.ORD_DVSN, body.ORD_SVR_DVSN_CD], ['NYSE', 'KO', '2', '181.25', '00', '0']);
  await c.place({ code: 'KO', side: 'SELL', qty: 1, price: 181.25 }); assert.equal(calls.at(-1).init.headers.tr_id, TR.sellUS.vps); assert.equal(JSON.parse(calls.at(-1).init.body).SLL_TYPE, '00');
  const bal = await c.balance(); assert.equal(bal.positions.length, 1); assert.equal(bal.positions[0].currency, 'USD'); assert.equal(bal.positions[0].value, 705); assert.equal(bal.cashUsd, 1234.5); assert.equal(bal.cash, 1000);
});

test('재조정 모드: 오른 종목도 계획까지 팔고, 묶음 안에서는 30일 매매 상한에 막히지 않으며, 묶음은 1회로 센다', async () => {
  // 보유 4종목이 각 11% 인데 계획은 2~3% → 재조정이면 팔아서 맞춘다. 보통 모드(letWinnersRun)는 팔지 않는다.
  const pos = ['005930', '000660', '035420', '069500'].map(sym => ({ symbol: sym, name: sym, currency: 'KRW', market: 'KR', qty: 100, valueKrw: 11_000_000, value: 11_000_000, price: 110000 }));
  const bigPlan = Object.fromEntries(['005930', '000660', '035420', '069500', '005380', '105560', '207940', '329180', '012450', '055550', '086790', '003670'].map((sym, i) => [sym, { pct: i < 4 ? 2.5 : 7, name: sym }]));
  const mk = () => fakeBroker({ cash: 56_000_000, positions: pos.map(p => ({ ...p })), prices: { KR: 110000, US: 180 } });
  const b1 = mk(); const normal = createPaperLive({ client: b1.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, limits: { maxOrderKrw: 15_000_000, maxDailyKrw: 60_000_000 } });
  const n = await normal.preview({ rules, plan: bigPlan });
  // 보통 모드(오른 종목 두기)는 위험 배수만큼만 조금 줄이고 계획(2.5%)까지 되팔지 않는다
  assert.ok(n.items.filter(i => i.side === 'SELL').every(i => (i.qty || 0) < 30), '보통 모드 매도는 소폭: ' + JSON.stringify(n.items.filter(i => i.side === 'SELL').map(i => i.qty)));
  const b2 = mk(); const pl = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, limits: { maxOrderKrw: 15_000_000, maxDailyKrw: 60_000_000 } });
  const r = await pl.run({ rules: { ...rules, maxTrades30: 8 }, plan: bigPlan, rebalance: true });
  assert.ok(r.rebalance); const sells = r.items.filter(i => i.side === 'SELL'), buys = r.items.filter(i => i.side === 'BUY');
  assert.equal(sells.length, 4, '네 종목 모두 계획까지 줄임'); assert.ok(sells.every(i => i.qty >= 60), '계획(2.5%)까지 크게 줄임: ' + JSON.stringify(sells.map(i => i.qty))); assert.ok(buys.length >= 6);
  assert.ok(r.items.every(i => !i.blocks.some(t => /30일 매매 횟수/.test(t))), '묶음 안에서 매매 상한에 막히지 않음: ' + JSON.stringify(r.items.filter(i => !i.ok).map(i => i.blocks)));
  assert.ok(r.sent.length >= 10 && r.sent.every(o => o.batch && o.batch.startsWith('RB-')));
  // 다음 미리보기: 묶음 전체가 1회로만 센다(보통 주문 0 + 묶음 1)
  const pv = await pl.preview({ rules, plan: bigPlan }); assert.equal(pv.trades30, 1, String(pv.trades30));
});

test('호출 간격: 모의 서버 제한(초당 1건)에 맞춰 호출 사이를 띄우고, 초과 응답이면 한 번 쉬었다 다시 보낸다', async () => {
  const times = []; let over = 1; const sleeps = [];
  const fetch = async (url) => { times.push(Date.now()); if (url.includes('tokenP')) return { ok: true, json: async () => ({ access_token: 'T' }) };
    if (over-- > 0) return { ok: true, headers: { get: () => '' }, json: async () => ({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }) };
    return { ok: true, headers: { get: () => '' }, json: async () => ({ rt_cd: '0', output: { stck_prpr: '70000' } }) }; };
  const env = { KIS_MODE: 'vps', KIS_APP_KEY: 'k'.repeat(36), KIS_APP_SECRET: 's'.repeat(180), KIS_ACCOUNT_NO: '50222787' };
  const c = createKisClient({ env, fetch, now: () => 0, minGapMs: 50, sleep: async ms => { sleeps.push(ms); } });
  const p = await c.price('005930'); assert.equal(p.price, 70000);
  assert.ok(sleeps.some(ms => ms >= 50 + 400), '초과 응답 뒤 쉬었다 재시도: ' + JSON.stringify(sleeps));
  await c.price('005930'); assert.ok(sleeps.length >= 2, '연속 호출 사이 간격');
});

test('재조정 실행은 열린 주문을 먼저 취소하고, 묶음 안에서는 30일 매매 횟수를 묻지 않는다', async () => {
  const b = fakeBroker({ cash: 50_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  const r1 = await pl.run({ rules: { ...rules, maxTrades30: 1 }, plan: { '005930': { pct: 10 } } }); assert.equal(r1.sent.length, 1); assert.equal(r1.sent[0].status, 'sent');
  const r2 = await pl.run({ rules: { ...rules, maxTrades30: 1 }, plan: { '005930': { pct: 20 }, '000660': { pct: 10 } }, rebalance: true });
  assert.ok(b.orders.find(o => o.odno === r1.sent[0].odno).cancelled, '열린 주문 취소됨');
  assert.ok(r2.items.length >= 1 && r2.items.every(i => !i.blocks.some(t => /30일 매매 횟수/.test(t))), JSON.stringify(r2.items.map(i => i.blocks)));
  assert.ok(r2.sent.length >= 1 && r2.sent.every(o => o.batch));
});
