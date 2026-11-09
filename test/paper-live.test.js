// 모의계좌 실행 엔진·한투 클라이언트·키 파일 적재 검증. 네트워크 없음(가짜 fetch·가짜 증권사), 합성 시세, 임시 장부 폴더.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { createKisClient, tickSize, roundTick, marketOpen, TR } from '../lib/kis-orders.js';
import { parseKeyFile, pickKisSet, applyKeyFiles } from '../lib/key-files.js';

// ── 가짜 증권사: 주문을 받아 목록에 넣고, 체결은 테스트가 조작 ──
function fakeBroker({ cash = 50_000_000, positions = [], price = 70000, failPrice = false, failPlace = null } = {}) {
  const orders = []; let seq = 100;
  const state = { cash, positions, price, failPrice, failPlace, placed: [] };
  const client = {
    settings: () => ({ mode: 'vps', accountMasked: '****2787', product: '01', baseUrl: 'fake' }),
    async price(code) { if (state.failPrice) { const e = new Error('시세 서버 오류'); e.code = 'network'; throw e; } return { code, price: state.price, upper: state.price * 1.3, lower: state.price * 0.7, halted: false, asOf: 'x' }; },
    async balance() { return { cash: state.cash, total: state.cash + state.positions.reduce((a, p) => a + p.valueKrw, 0), stock: state.positions.reduce((a, p) => a + p.valueKrw, 0), positions: state.positions }; },
    async buyingPower(code, px) { return { code, maxQty: Math.floor(state.cash / px), cashQty: Math.floor(state.cash / px), cashAmt: state.cash, ordCash: state.cash }; },
    async place({ code, side, qty, price }) { state.placed.push({ code, side, qty, price }); if (state.failPlace) { const e = new Error(state.failPlace); e.code = state.failPlace === 'network' ? 'network' : 'kis_error'; throw e; } const odno = String(++seq); orders.push({ odno, orgno: '00950', code, side, qty, filled: 0, remaining: qty, price, avgPrice: null, time: '101500', cancelled: false, status: 'open' }); return { odno, orgno: '00950', time: '101500', msg: '정상' }; },
    async cancel({ odno }) { const o = orders.find(x => x.odno === odno); if (o) { o.cancelled = true; o.status = 'cancelled'; } return { odno }; },
    async orders() { return orders.map(o => ({ ...o })); }
  };
  return { client, state, orders, fill(odno, qty) { const o = orders.find(x => x.odno === odno); o.filled += qty; o.remaining = o.qty - o.filled; o.status = o.remaining ? 'partial' : 'filled'; o.avgPrice = o.price; } };
}
// 합성 시세: 2년치 평일, 완만한 추세 + 잡음(결정론)
function candles(n = 520, start = 60000) { const out = []; let t = Date.parse('2024-11-01'), p = start, s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; while (out.length < n) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 1 + 0.0003 + (r() - 0.5) * 0.03; out.push({ date: d.toISOString().slice(0, 10), open: p * (1 + (r() - 0.5) * 0.004), close: p }); } t += 864e5; } return out; }
const readMarket = async () => ({ candles: candles() });
const monday1030 = () => Date.parse('2026-11-09T01:30:00Z'); // KST 10:30 월요일
const saturday = () => Date.parse('2026-11-07T01:30:00Z');
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-paper-live-'));
const plan = { '005930': { pct: 20, name: '삼성전자' }, '000660': { pct: 20, name: 'SK하이닉스' }, 'NVDA': { pct: 20, name: '엔비디아' } };
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };

test('장이 닫혀 있으면(주말) 할 일은 나오지만 모두 보류되고 아무것도 보내지 않는다', async () => {
  const b = fakeBroker(); const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: saturday });
  const r = await pl.run({ rules, plan });
  assert.equal(r.market.open, false); assert.ok(r.items.length >= 1); assert.ok(r.items.every(i => !i.ok && i.blocks.some(t => /주말/.test(t))));
  assert.equal(r.sent.length, 0); assert.equal(b.state.placed.length, 0);
  assert.deepEqual(r.skipped, ['NVDA']); // 미국 종목은 모의 국내 주문에서 뺀다
});

test('장중: 통과한 주문만 보내고 장부에 주문번호가 남는다 · 같은 날 다시 실행해도 중복 제출하지 않는다 · 재시작 뒤에도 장부가 남는다', async () => {
  const dir = tmp(), b = fakeBroker({ cash: 5_000_000 }), lim = { maxOrderKrw: 1_000_000, maxDailyKrw: 3_000_000 };
  let pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: monday1030, limits: lim });
  const pv = await pl.preview({ rules, plan });
  assert.ok(pv.items.length >= 2, '계획 2종목 매수 할 일');
  const r = await pl.run({ rules, plan });
  const ok = r.items.filter(i => i.ok);
  assert.ok(ok.length >= 1); assert.equal(r.sent.length, ok.length); assert.ok(r.sent.every(s => s.status === 'sent' && s.odno));
  assert.ok(r.sent.every(s => s.amountKrw <= 1_000_000), '주문 보호 한도 안');
  assert.ok(b.state.placed.every(p => Number.isInteger(p.qty) && p.qty > 0 && p.price === roundTick(p.price, p.side)));
  // 두 번째 실행: 끝나지 않은 주문이 있는 종목은 막힌다
  const r2 = await pl.run({ rules, plan });
  assert.equal(r2.sent.length, 0); assert.ok(r2.items.filter(i => ok.some(o => o.symbol === i.symbol)).every(i => i.blocks.some(t => /끝나지 않은 주문/.test(t))));
  assert.equal(b.state.placed.length, ok.length, '증권사에 두 번 가지 않음');
  // 재시작: 새 엔진이 같은 장부를 읽는다
  pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: monday1030, limits: lim });
  const st = await pl.status();
  assert.equal(st.ordersToday.length, ok.length); assert.ok(existsSync(st.ledgerPath));
  // 부분 체결 → 상태 구분
  b.fill(r.sent[0].odno, 1); const st2 = await pl.status();
  assert.equal(st2.ordersToday.find(o => o.odno === r.sent[0].odno).status, r.sent[0].qty === 1 ? 'filled' : 'partial');
});

test('응답이 끊겨 주문번호를 못 받은 주문은 unknown 으로 남고, 재조회가 증권사 목록에서 번호를 찾아 붙인다(재주문 없음)', async () => {
  const dir = tmp(), b = fakeBroker({ cash: 5_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(dir), readMarket, now: monday1030, limits: { maxOrderKrw: 1_000_000 } });
  // 가짜 증권사: 주문은 접수됐는데 응답만 실패
  const origPlace = b.client.place; b.client.place = async x => { await origPlace(x); const e = new Error('시간 초과'); e.code = 'network'; throw e; };
  const r = await pl.run({ rules, plan });
  assert.ok(r.sent.length >= 1); assert.ok(r.sent.every(s => s.status === 'unknown' || s.status === 'sent'));
  const led = JSON.parse(readFileSync(createLedgerStore(dir).path('2787'), 'utf8'));
  assert.ok(led.orders.every(o => o.odno), '재조회가 주문번호를 붙임: ' + JSON.stringify(led.orders.map(o => [o.status, o.odno])));
  const r2 = await pl.run({ rules, plan });
  assert.equal(r2.sent.length, 0); assert.equal(b.state.placed.length, r.sent.length);
});

test('현재가를 못 받으면 그 종목은 주문하지 않는다(fail-closed) · 증권사 거부는 rejected 로 남는다', async () => {
  const b = fakeBroker({ cash: 5_000_000, failPrice: true });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday1030 });
  const r = await pl.run({ rules, plan });
  assert.ok(r.items.length >= 1); assert.ok(r.items.every(i => !i.ok && i.blocks.some(t => /현재가를 받지 못해/.test(t)))); assert.equal(b.state.placed.length, 0);
  const b2 = fakeBroker({ cash: 5_000_000, failPlace: '주문가능금액 부족' });
  const pl2 = createPaperLive({ client: b2.client, store: createLedgerStore(tmp()), readMarket, now: monday1030, limits: { maxOrderKrw: 1_000_000 } });
  const r2 = await pl2.run({ rules, plan });
  assert.ok(r2.sent.length >= 1); assert.ok(r2.sent.every(s => s.status === 'rejected' && /부족/.test(s.error)));
});

test('킬 스위치: 켜면 열린 주문을 취소하고 새 주문을 막는다', async () => {
  const b = fakeBroker({ cash: 5_000_000 });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday1030, limits: { maxOrderKrw: 1_000_000 } });
  const r = await pl.run({ rules, plan }); assert.ok(r.sent.length >= 1);
  const k = await pl.kill(true);
  assert.equal(k.killSwitch, true); assert.equal(k.cancelled.length, r.sent.length); assert.ok(k.cancelled.every(c => c.ok));
  assert.ok(b.orders.every(o => o.cancelled));
  const r2 = await pl.run({ rules, plan }); assert.equal(r2.sent.length, 0); assert.ok(r2.items.every(i => i.blocks.some(t => /킬 스위치/.test(t))));
  await pl.kill(false); const st = await pl.status(); assert.equal(st.killSwitch, false); assert.ok(st.recentOrders.every(o => o.status === 'cancelled'));
});

test('보유 종목이 계획보다 많으면 매도 주문이 먼저 나가고, 수량은 보유를 넘지 않는다', async () => {
  const b = fakeBroker({ cash: 1_000_000, price: 70000, positions: [{ symbol: '005930', name: '삼성전자', qty: 100, valueKrw: 7_000_000, currency: 'KRW' }] });
  const pl = createPaperLive({ client: b.client, store: createLedgerStore(tmp()), readMarket, now: monday1030, limits: { maxOrderKrw: 5_000_000, maxDailyKrw: 10_000_000 } });
  const r = await pl.run({ rules, plan: { '005930': { pct: 20 } } });
  const sell = r.items.find(i => i.side === 'SELL'); assert.ok(sell, '매도 할 일'); assert.ok(sell.qty <= 100);
  assert.ok(b.state.placed.some(p => p.side === 'SELL'));
});

test('한투 클라이언트: 모의 tr_id·본문을 만들고, 실전 모드에서는 만들지 않는다', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); const body = { rt_cd: '0', msg1: 'ok', output: { ODNO: '0001234', KRX_FWDG_ORD_ORGNO: '00950', ORD_TMD: '101501', stck_prpr: '71000', stck_mxpr: '92000', stck_llam: '50000', temp_stop_yn: 'N' } };
    if (url.includes('tokenP')) return { ok: true, json: async () => ({ access_token: 'T', expires_in: 86400 }) };
    return { ok: true, headers: { get: () => '' }, json: async () => body }; };
  const env = { KIS_MODE: 'vps', KIS_APP_KEY: 'k'.repeat(36), KIS_APP_SECRET: 's'.repeat(180), KIS_ACCOUNT_NO: '50222787' };
  const c = createKisClient({ env, fetch, now: () => 0 });
  const r = await c.place({ code: '005930', side: 'BUY', qty: 3, price: 71000 });
  assert.equal(r.odno, '0001234'); const call = calls.at(-1);
  assert.ok(call.url.startsWith('https://openapivts.koreainvestment.com:29443/uapi/domestic-stock/v1/trading/order-cash'));
  assert.equal(call.init.headers.tr_id, TR.buy.vps); const b = JSON.parse(call.init.body);
  assert.deepEqual([b.CANO, b.PDNO, b.ORD_DVSN, b.ORD_QTY, b.ORD_UNPR, b.EXCG_ID_DVSN_CD], ['50222787', '005930', '00', '3', '71000', 'KRX']);
  await c.place({ code: '005930', side: 'SELL', qty: 1, price: 71000 }); assert.equal(calls.at(-1).init.headers.tr_id, TR.sell.vps);
  const p = await c.price('005930'); assert.equal(p.price, 71000); assert.equal(p.halted, false);
  // 잔고: 당일 매수로 결제 전이면 예수금총금액이 아니라 가수도정산금액을 현금으로 본다
  const bal = createKisClient({ env, fetch: async url => url.includes('tokenP') ? { ok: true, json: async () => ({ access_token: 'T' }) } : { ok: true, headers: { get: () => '' }, json: async () => ({ rt_cd: '0', output1: [{ pdno: '005930', prdt_name: '삼성전자', hldg_qty: '57', prpr: '193000', evlu_amt: '11001000', pchs_avg_pric: '193200' }], output2: [{ dnca_tot_amt: '100000000', prvs_rcdl_excc_amt: '88987600', scts_evlu_amt: '11001000', tot_evlu_amt: '99988600' }] }) }, now: () => 0 });
  const bb = await bal.balance(); assert.equal(bb.cash, 88987600); assert.equal(bb.cashRaw, 100000000); assert.equal(bb.positions[0].qty, 57);
  await assert.rejects(() => c.place({ code: '005930', side: 'BUY', qty: 0, price: 1 }), /올바르지/);
  assert.throws(() => createKisClient({ env: { ...env, KIS_MODE: 'prod' }, fetch }), /모의투자/);
  assert.throws(() => createKisClient({ env: { KIS_MODE: 'vps' }, fetch }), /설정되지/);
  // 증권사가 rt_cd≠0 을 주면 KisError
  const bad = createKisClient({ env, fetch: async url => url.includes('tokenP') ? { ok: true, json: async () => ({ access_token: 'T' }) } : { ok: true, headers: { get: () => '' }, json: async () => ({ rt_cd: '1', msg1: '주문가능금액 부족', msg_cd: 'APBK0919' }) }, now: () => 0 });
  await assert.rejects(() => bad.place({ code: '005930', side: 'BUY', qty: 1, price: 70000 }), /부족/);
});

test('호가 단위·장 시간', () => {
  assert.deepEqual([1999, 4999, 19999, 49999, 199999, 499999, 500000].map(tickSize), [1, 5, 10, 50, 100, 500, 1000]);
  assert.equal(roundTick(71234, 'BUY'), 71200); assert.equal(roundTick(71234, 'SELL'), 71300); assert.equal(roundTick(1_554_000, 'BUY'), 1_554_000);
  assert.equal(marketOpen(new Date('2026-11-09T01:30:00Z')).open, true);          // 월 10:30 KST
  assert.match(marketOpen(new Date('2026-11-09T06:25:00Z')).reason, /마감 10분 전/); // 15:25 KST
  assert.match(marketOpen(new Date('2026-11-08T03:00:00Z')).reason, /주말/);
  assert.match(marketOpen(new Date('2026-11-09T23:30:00Z')).reason, /장 시작 전/); // 화 08:30 KST
});

test('키 파일: 실전·모의 키가 한 파일에 있을 때 모의 모드는 simul* 만 쓰고, 없으면 실전 키로 대신하지 않는다', () => {
  const text = `app=${'S'.repeat(180)}\nappkey=${'K'.repeat(36)}\nKIS_ACCOUNT_NO=10172259\nKIS_ACCOUNT_PRODUCT_CODE=01\n\nsimulappkey=${'P'.repeat(36)}\nsimulappsecret=${'Q'.repeat(180)}\n`;
  const parsed = parseKeyFile(text);
  const vps = pickKisSet(parsed, 'vps'); assert.equal(vps.appKey, 'P'.repeat(36)); assert.equal(vps.appSecret, 'Q'.repeat(180)); assert.equal(vps.account, null);
  const prod = pickKisSet(parsed, 'prod'); assert.equal(prod.appKey, 'K'.repeat(36)); assert.equal(prod.appSecret, 'S'.repeat(180)); assert.equal(prod.account, '10172259');
  const files = { 'hantu.key': text, 'dart.key': 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n', 'live-only.key': `appkey=${'K'.repeat(36)}\nappsecret=${'S'.repeat(180)}\n` };
  const readFile = p => { if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; };
  const env = { KIS_MODE: 'vps', KIS_KEY_FILE: 'hantu.key', KIS_PAPER_ACCOUNT_NO: '50222787', DART_KEY_FILE: 'dart.key' };
  const s = applyKeyFiles(env, { readFile });
  assert.equal(env.KIS_APP_KEY, 'P'.repeat(36)); assert.equal(env.KIS_APP_SECRET, 'Q'.repeat(180)); assert.equal(env.KIS_ACCOUNT_NO, '50222787'); assert.equal(env.KIS_ACCOUNT_PRODUCT_CODE, '01');
  assert.equal(env.DART_API_KEY, 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
  assert.deepEqual([s.kis.configured, s.kis.accountMasked, s.dart.configured], [true, '****2787', true]);
  assert.ok(!JSON.stringify(s).includes('PPPP') && !JSON.stringify(s).includes('a1b2c3'), '요약에 키 값이 없음');
  // 모의 키가 없는 파일 + vps → 설정 안 됨, 실전 키는 env 에 올라가지 않음
  const env2 = { KIS_MODE: 'vps', KIS_KEY_FILE: 'live-only.key', KIS_PAPER_ACCOUNT_NO: '50222787' };
  const s2 = applyKeyFiles(env2, { readFile }); assert.equal(s2.kis.configured, false); assert.equal(env2.KIS_APP_KEY, undefined); assert.match(s2.kis.reason, /모의투자 키/);
  // 이미 있는 값은 덮어쓰지 않음 · 파일이 없으면 이유만
  const env3 = { KIS_MODE: 'prod', KIS_KEY_FILE: 'missing.key', DART_API_KEY: 'given', DART_KEY_FILE: 'dart.key' };
  const s3 = applyKeyFiles(env3, { readFile }); assert.equal(env3.DART_API_KEY, 'given'); assert.equal(s3.dart.from, 'env'); assert.match(s3.kis.reason, /읽지 못했/);
});
