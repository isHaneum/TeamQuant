// 모의계좌 엔진 2단계: 미국 종목(달러·환율·미국 장 시간), 기본 계획, 날마다 한 점(marks). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { createKisClient, marketOpen, roundTick, TR, marketOf } from '../lib/kis-orders.js';
import { verifyChain } from '../lib/paper-chain.js';
import { publicSnapshot } from '../lib/paper-public.js';

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

test('기록 해시 체인(엔진): 하루 한 항목 · 같은 날은 교체 · 전날 해시로 연결 · 재시작 보존 · 지난 날짜 평가가 바뀌면 다시 쓰지 않고 chainBreaks 에 적음(점검 ok 는 그대로) · 옛 장부는 되메우지 않음 · 밖으로 내는 체인은 닫힌 날만 · 공개 스냅샷으로 다시 검증', async () => {
  let t = kstMonday1030(); const b = fakeBroker({ cash: 10_000_000 }); const store = createLedgerStore(tmp());
  // 옛 장부(chain 없음)에 지난 평가점이 있어도 체인은 새 코드가 처음 돈 날(오늘)부터 시작한다(되메우지 않음)
  store.save('2787', { version: 'L6-old', mode: 'vps', account: '****2787', killSwitch: false, orders: [], runs: [], marks: [{ date: '2026-11-06', total: 9_900_000, cash: 9_900_000, stock: 0 }] });
  let pl = createPaperLive({ client: b.client, store, readMarket, now: () => t });
  // 장부 체인에는 오늘 항목(자정까지 평가마다 바뀜)이 있지만 status() 가 밖으로 내는 chain/chainCheck 에는 닫힌 날만 있다 — 오늘 항목을 공개하면 같은 날짜의 해시가 커밋마다 달라져 변조와 구별되지 않는다
  let st = await pl.status(); const L = () => pl._ledger().chain; assert.equal(st.marks.length, 2); assert.equal(L().length, 1); assert.equal(L()[0].date, '2026-11-09'); assert.equal(L()[0].prevHash, ''); assert.deepEqual(st.chain, []); assert.deepEqual(st.chainCheck, { ok: true, days: 0, brokenAt: null, reason: null }); assert.deepEqual(st.chainBreaks, []);
  assert.equal(L()[0].payload.total, st.marks.at(-1).total); assert.equal(L()[0].payload.cash, 10_000_000);
  const h1 = L()[0].hash;
  // 같은 날 다시 평가(현금이 바뀜): 항목 수는 그대로 1, 내용·해시만 바뀐다(마지막 평가가 그날의 봉인) · 여전히 공개되지 않음
  b.state.cash = 9_000_000; t += 3600e3; st = await pl.status(); assert.equal(L().length, 1); assert.notEqual(L()[0].hash, h1); assert.equal(L()[0].payload.cash, 9_000_000); assert.deepEqual(st.chain, []);
  // 다음 날 · 재시작(새 인스턴스, 같은 장부): 두 번째 항목이 첫 항목 해시에 연결된다 · 어제 항목이 어제 마지막 평가 그대로 공개된다
  const h2 = L()[0].hash; t += 864e5; pl = createPaperLive({ client: b.client, store, readMarket, now: () => t }); st = await pl.status();
  assert.equal(L().length, 2); assert.equal(L()[1].date, '2026-11-10'); assert.equal(L()[1].prevHash, L()[0].hash); assert.equal(verifyChain(L()).ok, true); assert.equal(st.integrity.items.find(i => i.key === 'chain').count, 0);
  assert.deepEqual(st.chain.map(e => e.date), ['2026-11-09']); assert.equal(st.chain[0].hash, h2); assert.deepEqual(st.chainCheck, { ok: true, days: 1, brokenAt: null, reason: null });
  // 지난 날짜의 평가점이 바뀌면(보정 스크립트처럼 marks 를 고침) 체인 항목은 그대로, chainBreaks 에 적는다. 점검 항목 '기록 변경 감지'는 체인이 깨졌을 때만 세고(0) ok 는 유지 — 바로잡은 흔적은 영영 남는데 그것을 결함으로 세면 점검이 영영 '확인 필요'가 된다
  const sealed = JSON.stringify(L()[0]); pl._ledger().marks.find(m => m.date === '2026-11-09').total += 1000; t += 864e5; st = await pl.status();
  assert.equal(JSON.stringify(L()[0]), sealed, '지난 항목은 다시 쓰지 않는다'); assert.equal(L().length, 3); assert.deepEqual(st.chain.map(e => e.date), ['2026-11-09', '2026-11-10']); assert.equal(st.chainCheck.ok, true, '체인 자체는 깨지지 않았다');
  assert.equal(st.chainBreaks.length, 1); assert.equal(st.chainBreaks[0].date, '2026-11-09'); assert.match(st.chainBreaks[0].note, /total/);
  assert.deepEqual(st.integrity.items.find(i => i.key === 'chain'), { key: 'chain', label: '기록 변경 감지', count: 0, target: 0 }); assert.equal(st.integrity.ok, true); assert.equal(st.integrity.chainBreaks, 1, '흔적은 따로 센다');
  // 한 번 더 평가해도 같은 날짜의 break 는 중복으로 쌓이지 않는다 · 공개 체인에 오늘 날짜는 절대 없다
  t += 3600e3; st = await pl.status(); assert.equal(st.chainBreaks.length, 1); assert.ok(st.chain.every(e => e.date < '2026-11-11'));
  // 공개 스냅샷: 닫힌 날의 체인·검증 결과·break 가 실리고 계좌번호가 없다 · 공개 파일만으로 다시 검증되고 한 칸 바꾸면 깨진다
  const pub = publicSnapshot(st); assert.equal(pub.chain.length, 2); assert.deepEqual(pub.chainCheck, st.chainCheck); assert.equal(pub.chainBreaks.length, 1);
  assert.ok(!JSON.stringify(pub.chain).includes('2787') && !JSON.stringify(pub.chain).includes('name'));
  assert.equal(verifyChain(pub.chain).ok, true); assert.equal(pub.chain[1].hash, L()[1].hash);
  const t2 = verifyChain(pub.chain.map((e, i) => i === 1 ? { ...e, payload: { ...e.payload, total: e.payload.total + 1 } } : e)); assert.equal(t2.ok, false); assert.equal(t2.brokenAt, '2026-11-10');
});

test('기록 해시 체인(엔진): 환율을 못 읽어 평가를 보류한 날은 봉인하지 않는다 · 보유·체결이 payload 에 종목·수량으로만 들어간다 · KST 자정 뒤 미국 체결도 확인한 날(KST) 항목에 들어간다', async () => {
  const t = usTuesday1100ET; const b = fakeBroker({ cash: 50_000_000, positions: [{ symbol: 'NVDA', name: '엔비디아', market: 'US', currency: 'USD', qty: 10, value: 1800, price: 180 }] });
  const noFx = async sym => (sym === 'KRW=X' ? { candles: [] } : readMarket(sym));
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket: noFx, now: t });
  const st = await pl.status(); assert.equal(st.markStale, true); assert.equal(pl._ledger().chain.length, 0, '보류된 평가는 봉인하지 않는다'); assert.equal(st.chainCheck.ok, true);
  const b2 = fakeBroker({ cash: 50_000_000, positions: [{ symbol: 'NVDA', name: '엔비디아', market: 'US', currency: 'USD', qty: 10, value: 1800, price: 180 }] });
  const pl2 = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: t, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  const r = await pl2.run({ rules, plan: { NVDA: { pct: 20, name: '엔비디아' } } }); const sent = r.sent.find(o => o.symbol === 'NVDA'); assert.ok(sent);
  const bo = b2.orders.find(o => o.odno === sent.odno); bo.filled = bo.qty; bo.remaining = 0; bo.avgPrice = 180.1; bo.status = 'filled'; // 증권사가 체결로 돌려준다
  await pl2.status(); const e = pl2._ledger().chain.at(-1); assert.equal(e.date, '2026-11-11');
  assert.deepEqual(e.payload.positions, [{ symbol: 'NVDA', qty: 10 }]);
  // 11:00 ET 11-10 = KST 11-11 01:00: 평가점 날짜는 KST(11-11), 미국 체결의 거래일은 뉴욕(11-10)이지만 체결을 확인한 KST 날짜(filledAt)가 11-11 이라 이 항목의 fills 에 들어간다(뉴욕 거래일로 골랐다면 어느 항목에도 못 들어갔다 · 2026-11-12 검토)
  const o = pl2._ledger().orders.find(x => x.odno === sent.odno); assert.equal(o.filledAt.slice(0, 10), '2026-11-10'); assert.deepEqual(e.payload.fills, [{ symbol: 'NVDA', side: 'BUY', qty: sent.qty, avgPrice: 180.1 }]); assert.ok(!JSON.stringify(e).includes(sent.odno) && !JSON.stringify(e).includes('엔비디아'));
  // 국내 체결은 KST 거래일 = 평가점 날짜라 그날 항목에 들어간다
  const b3 = fakeBroker({ cash: 50_000_000 }); const pl3 = createPaperLive({ client: b3.client, store: createLedgerStore(tmp()), readMarket, now: kstMonday1030, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  const r3 = await pl3.run({ rules, plan: { '005930': { pct: 20, name: '삼성전자' } } }); const s3 = r3.sent.find(o => o.symbol === '005930'); assert.ok(s3);
  const bo3 = b3.orders.find(o => o.odno === s3.odno); bo3.filled = bo3.qty; bo3.remaining = 0; bo3.avgPrice = 70000; bo3.status = 'filled';
  await pl3.status(); const e3 = pl3._ledger().chain.at(-1); assert.equal(e3.date, '2026-11-09'); assert.deepEqual(e3.payload.fills, [{ symbol: '005930', side: 'BUY', qty: s3.qty, avgPrice: 70000 }]);
});

test('헤드라인 비교선(엔진): 기준선 전의 평가점(운용을 정하기 전 현금만 든 날)은 비교 구간에 들어가지 않는다 — 시작은 기준선 날 평가점', async () => {
  let t = kstMonday1030(); const b = fakeBroker({ cash: 50_000_000 }); const store = createLedgerStore(tmp());
  // KODEX 200: 11-09 → 11-10 +5%, 그 뒤 그대로. 운용은 11-11 에 정한다 → 11-09·11-10 의 지수 변동은 비교에 들어가면 안 된다
  const kodex = { '2026-11-09': 70000, '2026-11-10': 73500, '2026-11-11': 73500, '2026-11-12': 73500 };
  const rm = async (sym, range) => { const d = await readMarket(sym, range); return sym === '069500' ? { candles: [...d.candles.filter(c => c.date < '2026-11-09'), ...Object.entries(kodex).map(([date, close]) => ({ date, open: close, close }))] } : d; };
  const pl = createPaperLive({ client: b.client, store, readMarket: rm, now: () => t, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  await pl.status(); t += 864e5; await pl.status(); // 11-09·11-10: 기준선 없음(현금만) → benchmark null
  assert.equal((await pl.status()).benchmark, null); assert.ok(!pl._ledger().baseline);
  t += 864e5; await pl.run({ rules, plan: { '005930': { pct: 20, name: '삼성전자' } } }); // 11-11 운용 시작 → 기준선(KR 20 · 현금 80)
  t += 864e5; const st = await pl.status();
  assert.equal(st.baseline.from, '2026-11-11'); assert.equal(st.marks.length, 4);
  assert.deepEqual([st.benchmark.from, st.benchmark.asOf, st.benchmark.days], ['2026-11-11', '2026-11-12', 2], '구간은 기준선 날부터(평가점 4개 중 2개)');
  assert.equal(st.benchmark.benchRetPct, 0, '11-09→11-10 의 +5% 는 들어가지 않는다(marks[0] 에서 시작했다면 +1%)'); assert.equal(st.benchmark.ownRetPct, 0); assert.equal(st.benchmark.diffPp, 0);
});

test('헤드라인 비교선(엔진): 기준선에 계획의 국가 비중·현금 정의가 붙고 · status().benchmark 의 diffPp = 절차 − 비교선(환율 환산) · 30분 캐시 · 지수를 못 읽으면 정의만 남고 숫자는 null(던지지 않음) · 옛 장부의 기준선은 적재 때 정의를 만들어 저장 · 공개 스냅샷에 실림', async () => {
  let t = kstMonday1030(); const b = fakeBroker({ cash: 50_000_000 }); const store = createLedgerStore(tmp()); const reads = { '069500': 0 };
  // 지수·환율에 11-09 → 11-10 변화를 붙인다: KODEX 200 +2%, SPY 그대로, 환율 +1% → 비교선(KR 20 · US 30 · 현금 50) = 0.5 + 0.2×1.02 + 0.3×1.01 = 1.007 (+0.7%)
  const extra = { '069500': [70000, 71400], SPY: [180, 180], 'KRW=X': [1400, 1414] };
  const rm = async (sym, range) => { if (sym === '069500' && range === '1y') reads['069500']++; const d = await readMarket(sym, range); const x = extra[sym]; return x ? { candles: [...d.candles.filter(c => c.date < '2026-11-09'), { date: '2026-11-09', open: x[0], close: x[0] }, { date: '2026-11-10', open: x[1], close: x[1] }] } : d; };
  let pl = createPaperLive({ client: b.client, store, readMarket: rm, now: () => t, limits: { maxOrderKrw: 20_000_000, maxDailyKrw: 60_000_000 } });
  await pl.run({ rules, plan }); // plan: 삼성전자 20 / NVDA 20 / SPY 10 → KR 20 · US 30 · 현금 50
  let st = await pl.status();
  assert.deepEqual(st.baseline.benchmark.weights, { KR: 20, US: 30, cash: 50 }); assert.equal(st.baseline.benchmark.label, '국가 비중·현금 일치 지수 투자'); assert.equal(st.baseline.benchmark.legs.US.symbol, 'SPY'); assert.equal(st.baseline.benchmark.legs.KR.symbol, '069500');
  assert.equal(st.benchmark.diffPp, null, '평가점이 하나면 비교 없음'); assert.equal(st.benchmark.error, null); assert.equal(st.benchmark.days, 1); assert.deepEqual(st.benchmark.weights, { KR: 20, US: 30, cash: 50 });
  // 다음 날: 절차 총자산 +1%(현금 변동) vs 비교선 +0.7% → 지수 대비 +0.3%p
  b.state.cash = 50_500_000; t += 864e5; st = await pl.status();
  const own = (st.marks.at(-1).total / st.marks[0].total - 1) * 100; assert.ok(Math.abs(own - 1) < 1e-9);
  assert.equal(st.benchmark.ownRetPct, 1); assert.ok(Math.abs(st.benchmark.benchRetPct - 0.7) < 1e-9, String(st.benchmark.benchRetPct)); assert.ok(Math.abs(st.benchmark.diffPp - (st.benchmark.ownRetPct - st.benchmark.benchRetPct)) < 0.011); assert.equal(st.benchmark.diffPp, 0.3);
  assert.deepEqual([st.benchmark.from, st.benchmark.asOf, st.benchmark.days, st.benchmark.error], ['2026-11-09', '2026-11-10', 2, null]);
  // 30분 캐시: 같은 날 1분 뒤 status 는 지수를 다시 읽지 않고, 31분 뒤에는 다시 읽는다
  const n0 = reads['069500']; t += 60e3; await pl.status(); assert.equal(reads['069500'], n0); t += 31 * 60e3; await pl.status(); assert.equal(reads['069500'], n0 + 1);
  // 지수를 못 읽으면: 정의는 그대로, 숫자는 null, error 한 줄 — status() 는 던지지 않는다
  const bad = async (sym, range) => { if (sym === '069500') throw new Error('offline'); return rm(sym, range); };
  const pl2 = createPaperLive({ client: b.client, store, readMarket: bad, now: () => t }); const st2 = await pl2.status();
  assert.deepEqual(st2.benchmark.weights, { KR: 20, US: 30, cash: 50 }); assert.equal(st2.benchmark.diffPp, null); assert.equal(st2.benchmark.benchRetPct, null); assert.equal(st2.benchmark.error, '지수 시세를 읽지 못해 비교를 보류');
  // 공개 스냅샷: 정의와 숫자가 실리고 계좌번호가 없다
  const pub = publicSnapshot(st); assert.deepEqual(pub.benchmark, { version: st.benchmark.version, label: '국가 비중·현금 일치 지수 투자', weights: { KR: 20, US: 30, cash: 50 }, legs: { KR: { symbol: '069500', name: 'KODEX 200', currency: 'KRW' }, US: { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' } }, ownRetPct: 1, benchRetPct: 0.7, diffPp: 0.3, days: 2, from: '2026-11-09', asOf: '2026-11-10', error: null });
  assert.ok(!JSON.stringify(pub.benchmark).includes('2787'));
  // 옛 장부: 기준선은 있는데 benchmark 가 없으면 적재 때 계획에서 정의를 만들어 저장한다(시각이 붙은 기록이 아니라 정의이므로 되메우기가 아니다)
  const store2 = createLedgerStore(tmp()); store2.save('2787', { version: 'L6-old', mode: 'vps', account: '****2787', killSwitch: false, orders: [], runs: [], marks: [], baseline: { at: '2026-11-09T01:00:00Z', from: '2026-11-09', capitalKrw: 1e8, plan: { '005930': { pct: 30, name: '삼성전자', currency: 'KRW' }, SPY: { pct: 20, name: 'S&P500 ETF', currency: 'USD' } }, rules: {}, planVersion: 'x' } });
  createPaperLive({ client: b.client, store: store2, readMarket: rm, now: () => t });
  assert.deepEqual(store2.load('2787').baseline.benchmark.weights, { KR: 30, US: 20, cash: 50 });
  // 기준선이 없으면 benchmark 는 null(아직 운용을 정하지 않음)
  assert.equal((await createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket: rm, now: () => t }).status()).benchmark, null);
});
