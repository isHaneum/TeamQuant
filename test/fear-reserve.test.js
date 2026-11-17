// 결정 46: 공포 예비 현금(VIX 30·40·50 사다리 → 핵심 지수) · 끝난 세션 종가만 · 새 최고점에서 되채움 · 평가점 지수 가격(BM4). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';

function days(from, to, f) { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { const date = d.toISOString().slice(0, 10); const c = f(date); out.push({ date, open: c, close: c }); } } return out; }
function setup() {
  const state = { t: Date.parse('2026-11-16T01:30:00Z'), vix: () => 20, spy: () => 600 }; // 뉴욕 날짜 2026-11-15(일) → 11-13(금)까지가 끝난 세션
  const readMarket = async s => ({ candles: s === '^VIX' ? days('2025-06-01', '2026-12-31', state.vix) : s === 'SPY' ? days('2021-06-01', '2026-12-31', state.spy) : days('2025-06-01', '2026-12-31', () => (s === 'KRW=X' ? 1400 : 70000)) });
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: 100_000_000, total: 100_000_000, stock: 0, positions: [], cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const doc = { version: 'T1', reservePct: 15, weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct: 3, targetPct: 5, tranche: 1, name: '삼성전자', currency: 'KRW', role: 'satellite' } } };
  const plan = () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }]));
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-fear-'))), readMarket, now: () => state.t, defaultPlan: plan, defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  return { pl, state };
}
// 합쳐진 계획은 밖으로 나오지 않으므로 주문 미리보기의 매수 금액으로 본다(총자산 1억 · 지정가 70,000원 → 1주 안 오차)
const R = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };
const buyKrw = async (pl, sym) => (await pl.preview({ rules: R, rebalance: true })).items.find(x => x.symbol === sym)?.amountKrw ?? 0;
const nearKrw = (a, b, msg = '') => assert.ok(Math.abs(a - b) <= 70000, `${msg} ${a} ≠ ${b}`);

test('VIX 30 → 1단계: 예비 15% 의 1/3(5%p)을 핵심 지수에 · 계획 버전 +F:1 · 같은 단계는 한 번만 · 40 → 2단계', async () => {
  const { pl, state } = setup();
  let st = await pl.status(); assert.equal(st.fear.step, 0); assert.equal(st.fear.vix, 20); assert.equal(st.fear.asOf, '2026-11-13'); assert.equal(st.fear.reservePct, 15); assert.doesNotMatch(st.planVersionNow, /\+F/);
  state.vix = d => (d >= '2026-11-12' ? 33 : 20); st = await pl.status(); assert.equal(st.fear.step, 1); assert.equal(st.fear.pp, 5); assert.match(st.planVersionNow, /\+F:1$/); assert.match(st.fear.log.at(-1).reason, /VIX 2026-11-13 종가 33 ≥ 30/);
  nearKrw(await buyKrw(pl, '069500'), 15_000_000, '핵심 10% + 5%p'); nearKrw(await buyKrw(pl, '005930'), 3_000_000, '위성은 그대로');
  st = await pl.status(); assert.equal(st.fear.step, 1, '같은 단계로 다시 올리지 않는다');
  state.vix = d => (d >= '2026-11-12' ? 42 : 20); st = await pl.status(); assert.equal(st.fear.step, 2); assert.equal(st.fear.pp, 10); nearKrw(await buyKrw(pl, '069500'), 20_000_000, '2단계');
});

test('오늘(장중) 봉은 쓰지 않는다: 끝난 세션의 VIX 가 30 미만이면 오늘 35 라도 0단계', async () => {
  const { pl, state } = setup(); state.t = Date.parse('2026-11-13T15:00:00Z'); // 뉴욕 금요일 장중 → 11-12 까지가 끝난 세션
  state.vix = d => (d >= '2026-11-13' ? 35 : 20); const st = await pl.status(); assert.equal(st.fear.step, 0); assert.equal(st.fear.asOf, '2026-11-12');
});

test('S&P500 ETF 새 최고점 → 단계 해제 · 비중 되돌림 · 되채움 기록 · 공개 파일에 fear', async () => {
  const { pl, state } = setup();
  state.spy = d => (d >= '2026-10-01' ? 550 : 600); state.vix = d => (d >= '2026-11-12' ? 33 : 20); let st = await pl.status(); assert.equal(st.fear.step, 1); assert.equal(st.fear.high.close, 600);
  state.vix = () => 20; state.spy = d => (d >= '2026-11-13' ? 610 : d >= '2026-10-01' ? 550 : 600); st = await pl.status(); assert.equal(st.fear.step, 0); assert.equal(st.fear.pp, 0); assert.equal(st.fear.high.close, 610); assert.equal(st.fear.log.at(-1).event, 'reset'); nearKrw(await buyKrw(pl, '069500'), 10_000_000, '되돌림'); assert.doesNotMatch(st.planVersionNow, /\+F/);
  const pub = publicSnapshot(st); assert.equal(pub.fear.step, 0); assert.equal(pub.fear.log.at(-1).event, 'reset'); assert.equal(pub.fear.high.close, 610);
});

test('BM4: 평가점에 지수 가격(idx)이 적히고 공개 파일 평가점에도 남는다', async () => {
  const { pl } = setup(); const st = await pl.status(); const m = st.marks.at(-1);
  assert.deepEqual(m.idx, { KR: { date: '2026-12-31', close: 70000 }, US: { date: '2026-12-31', close: 600 } });
  assert.deepEqual(publicSnapshot(st).marks.at(-1).idx, m.idx);
});
