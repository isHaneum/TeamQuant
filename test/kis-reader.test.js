// 실계좌 읽기 전용 리더(결정 22): 실전 호스트·실전 tr_id 만 쓰고, 주문·취소 함수가 없고, GET 이 아닌 요청은 만들 수 없다. 토큰 파일 이름은 모의와 다르고 계좌는 가린 번호로만 적힌다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKisReader, guardMethod, REAL_BALANCE_NOTE } from '../lib/kis-reader.js';
import { kisReadOnlySettings } from '../lib/key-files.js';
import { TR, KIS_HOSTS } from '../lib/kis-orders.js';

const KEY = 'K'.repeat(36), SEC = 'S'.repeat(180), ACC = '12345678';
const keyText = `app=${SEC}\nappkey=${KEY}\nKIS_ACCOUNT_NO=${ACC}\nKIS_ACCOUNT_PRODUCT_CODE=01\n\nsimulappkey=${'P'.repeat(36)}\nsimulappsecret=${'Q'.repeat(180)}\n`;
const readFile = p => { if (p !== 'hantu.key') { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return keyText; };
const settings = () => kisReadOnlySettings({ KIS_REAL_READONLY: '1', KIS_KEY_FILE: 'hantu.key', KIS_MODE: 'vps' }, { readFile });

function fakeFetch(calls, { presentFails = false } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url); calls.push({ url: u, init }); const h = { get: () => '' };
    if (presentFails && u.pathname.endsWith('/inquire-present-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '조회 실패' }) };
    if (u.pathname.endsWith('/oauth2/tokenP')) return { ok: true, json: async () => ({ access_token: 'T', expires_in: 86400 }) };
    if (u.pathname.endsWith('/domestic-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [{ pdno: '005930', prdt_name: 'A', hldg_qty: '10', prpr: '70000', evlu_amt: '700000', pchs_avg_pric: '65000' }], output2: [{ dnca_tot_amt: '1000000', prvs_rcdl_excc_amt: '900000', scts_evlu_amt: '700000', tot_evlu_amt: '1600000' }] }) };
    if (u.pathname.endsWith('/overseas-stock/v1/trading/inquire-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [{ ovrs_pdno: 'SPY', ovrs_item_name: 'SPDR', ovrs_cblc_qty: '2', now_pric2: '500', ovrs_stck_evlu_amt: '1000', pchs_avg_pric: '480', ovrs_excg_cd: 'AMEX' }], output2: { frcr_pchs_amt1: '1300000' } }) };
    if (u.pathname.endsWith('/inquire-present-balance')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output2: [{ crcy_cd: 'USD', frcr_dncl_amt_2: '100' }] }) };
    if (u.pathname.endsWith('/inquire-daily-ccld')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output1: [{ odno: '0000012345', pdno: '005930', prdt_name: 'A', sll_buy_dvsn_cd: '02', ord_qty: '10', tot_ccld_qty: '10', rmn_qty: '0', ord_unpr: '70000', avg_prvs: '69900', ord_tmd: '093000' }] }) };
    if (u.pathname.endsWith('/inquire-ccnl')) return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: [{ odno: '777', pdno: 'SPY', ovrs_excg_cd: 'AMEX', sll_buy_dvsn_cd: '02', ft_ord_qty: '2', ft_ccld_qty: '2', nccs_qty: '0', ft_ord_unpr3: '500', ft_ccld_unpr3: '499.5', prcs_stat_name: '' }] }) };
    return { ok: true, headers: h, json: async () => ({ rt_cd: '0', output: [], output1: [] }) };
  };
}

test('kisReadOnlySettings: KIS_REAL_READONLY=1 일 때만 실전 이름표를 고르고 process.env 에는 아무것도 쓰지 않는다 · 계좌는 가린 번호 · 꺼져 있거나 실전 키가 없으면 값은 모두 null', () => {
  const env = { KIS_REAL_READONLY: '1', KIS_KEY_FILE: 'hantu.key', KIS_MODE: 'vps', KIS_ACCOUNT_NO: '50222787' }, before = JSON.stringify(env);
  const s = kisReadOnlySettings(env, { readFile });
  assert.equal(JSON.stringify(env), before, 'env 는 그대로');
  assert.deepEqual([s.configured, s.accountMasked, s.product, s.account, s.appKey === KEY, s.appSecret === SEC, s.reason], [true, '****5678', '01', ACC, true, true, null]);
  for (const bad of [{ KIS_KEY_FILE: 'hantu.key' }, { KIS_REAL_READONLY: '0', KIS_KEY_FILE: 'hantu.key' }, { KIS_REAL_READONLY: '1' }, { KIS_REAL_READONLY: '1', KIS_KEY_FILE: 'missing.key' }]) {
    const r = kisReadOnlySettings(bad, { readFile }); assert.equal(r.configured, false); assert.deepEqual([r.appKey, r.appSecret, r.account, r.accountMasked], [null, null, null, null]); assert.ok(r.reason);
  }
  const paperOnly = kisReadOnlySettings({ KIS_REAL_READONLY: '1', KIS_KEY_FILE: 'hantu.key' }, { readFile: () => `simulappkey=${'P'.repeat(36)}\nsimulappsecret=${'Q'.repeat(180)}\n` });
  assert.equal(paperOnly.configured, false); assert.match(paperOnly.reason, /실전 키/);
  const noAcc = kisReadOnlySettings({ KIS_REAL_READONLY: '1', KIS_KEY_FILE: 'hantu.key' }, { readFile: () => `appkey=${KEY}\nappsecret=${SEC}\n` });
  assert.equal(noAcc.configured, false); assert.match(noAcc.reason, /계좌번호/);
  assert.throws(() => createKisReader({ settings: paperOnly, fetch: async () => { throw new Error('no'); } }), /읽기 전용 설정/);
});

test('리더: 실전 호스트·실전 tr_id(TTTC8434R·TTTS3012R·CTRP6504R·TTTC0081R·TTTS3035R)만 쓰고 토큰 발급 외 모든 요청은 GET · 잔고 합산(tot_evlu_amt + 미국×환율 + 외화예수금×환율) · usCostKrw 노출 · 보정 없음', async () => {
  const calls = [], dir = mkdtempSync(join(tmpdir(), 'tq-ro-')), tokenFile = join(dir, 'kis-prod-token.json');
  const r = createKisReader({ settings: settings(), fetch: fakeFetch(calls), now: () => 1_700_000_000_000, tokenFile, minGapMs: 0, sleep: async () => { } });
  assert.deepEqual(Object.keys(r).sort(), ['balance', 'orders', 'settings'], '주문·취소 함수가 없다');
  assert.deepEqual([r.settings().mode, r.settings().readOnly, r.settings().accountMasked, r.settings().baseUrl], ['prod', true, '****5678', KIS_HOSTS.prod]);
  const b = await r.balance({ fx: 1400 });
  assert.equal(b.cash, 900_000); assert.equal(b.cashRaw, 1_000_000); assert.equal(b.stock, 700_000); assert.equal(b.totalKrwOnly, 1_600_000);
  assert.equal(b.stockUsd, 1000); assert.equal(b.cashUsd, 100); assert.equal(b.usCostKrw, 1_300_000); assert.equal(b.fx, 1400);
  assert.equal(b.total, 1_600_000 + 1000 * 1400 + 100 * 1400, '총자산 = 국내 총평가 + 미국 주식×환율 + 외화예수금×환율 (정산 전 매수대금을 빼지 않는다)');
  assert.equal(b.stockKrw, 700_000 + 1000 * 1400); assert.equal(b.note, REAL_BALANCE_NOTE);
  assert.deepEqual(b.positions.map(p => [p.symbol, p.market, p.qty, p.valueKrw]), [['005930', 'KR', 10, 700_000], ['SPY', 'US', 2, 1_400_000]]);
  const noFx = await r.balance({}); assert.equal(noFx.total, null, '해외 자산이 있는데 환율이 없으면 총자산 미정'); assert.equal(noFx.positions[1].valueKrw, null);
  const os = await r.orders('20261112'); assert.deepEqual(os.map(o => [o.market, o.code, o.status, o.filled]), [['KR', '005930', 'filled', 10], ['US', 'SPY', 'filled', 2]]);
  await assert.rejects(r.orders('2026-11-12'), /YYYYMMDD/);
  // 모든 호출: 실전 호스트, 실전 tr_id, 토큰 외에는 GET 만
  const prodHost = new URL(KIS_HOSTS.prod); assert.ok(calls.length > 5);
  for (const c of calls) { assert.equal(c.url.host, prodHost.host); if (c.url.pathname.endsWith('/oauth2/tokenP')) { assert.equal(c.init.method, 'POST'); continue; } assert.equal(c.init.method, 'GET'); assert.equal(c.init.body, undefined); }
  const trs = new Set(calls.filter(c => c.init.headers?.tr_id).map(c => c.init.headers.tr_id));
  assert.deepEqual([...trs].sort(), [TR.balance.prod, TR.balanceUS.prod, TR.presentUS.prod, TR.daily.prod, TR.dailyUS.prod].sort());
  for (const v of ['V', 'TTTC0012U', 'TTTC0011U', 'TTTC0013U', 'TTTT1002U', 'TTTT1006U', 'TTTT1004U']) assert.ok(![...trs].some(t => t === v || (v === 'V' && t.startsWith('V'))), `모의·주문 tr_id 가 섞임: ${v}`);
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/oauth2/tokenP')).length, 1, '토큰은 한 번 받아 캐시');
  // 토큰 파일: 모의(kis-vps-token.json)와 다른 이름 · 계좌는 가린 번호만
  assert.ok(existsSync(tokenFile)); assert.ok(!existsSync(join(dir, 'kis-vps-token.json')));
  const tf = JSON.parse(readFileSync(tokenFile, 'utf8')); assert.equal(tf.mode, 'prod'); assert.equal(tf.account, '****5678'); assert.ok(!readFileSync(tokenFile, 'utf8').includes(ACC));
});

test('리더: 외화예수금 조회 실패는 삼키지 않고 cashUsdError 로 표시한다(total 은 그 다리가 빠진 값 · 보류는 호출자가 정한다)', async () => {
  const r = createKisReader({ settings: settings(), fetch: fakeFetch([], { presentFails: true }), now: () => 1_700_000_000_000, minGapMs: 0, sleep: async () => { } });
  const b = await r.balance({ fx: 1400 });
  assert.equal(b.cashUsd, null); assert.equal(b.cashUsdError, 'EGW00123'); assert.equal(b.usError, null); assert.equal(b.total, 1_600_000 + 1000 * 1400, '외화예수금 100달러가 빠진 값');
  const ok = await createKisReader({ settings: settings(), fetch: fakeFetch([]), now: () => 1_700_000_000_000, minGapMs: 0, sleep: async () => { } }).balance({ fx: 1400 }); assert.equal(ok.cashUsdError, null);
});

test('리더 소스에 주문·취소 요청 경로가 없고 guardMethod 는 GET 외 모두 거부한다', () => {
  const src = readFileSync(new URL('../lib/kis-reader.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /order-cash|order-rvsecncl|trading\/order'|\.vps\b/, '주문·취소 경로와 모의 tr_id 는 리더에 없다');
  const code = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /process\.env/, '리더는 환경 변수를 읽지 않는다(설정은 주입 · 주석의 언급만 허용)');
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', undefined]) assert.throws(() => guardMethod(m), e => e.code === 'read_only' && e.status === 403);
  assert.doesNotThrow(() => guardMethod('GET'));
});
