// 결정 27: 위성 묶음 성과(지수와 따로 비교) · 나눠 사기 단계 올리기(15% 하락 · 새 실적 카드 통과) · 올리지 않는 조건(카드 탈락 · 이슈) · 뉴스·가격 급락은 주의까지만. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';
import { gradeNews, createIssueWatch } from '../lib/issue-watch.js';

function setup({ price = 70000, card = null } = {}) {
  const flat = close => { const out = []; for (let t = Date.parse('2025-06-01'); t <= Date.parse('2026-12-31'); t += 864e5) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), open: close, close }); } return out; };
  const readMarket = async s => ({ candles: flat(s === 'KRW=X' ? 1400 : 70000) }); // 지수는 그대로(0%)
  const state = { t: Date.parse('2026-11-16T01:30:00Z'), price, card };
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: code === '005930' ? state.price : 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { const v = 43 * state.price; return { cash: 100_000_000 - v, total: 100_000_000, stock: v, positions: [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 43, price: state.price, value: v, valueKrw: v }], cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const doc = { version: 'T1', weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct: 3, targetPct: 5, tranche: 1, name: '삼성전자', currency: 'KRW', role: 'satellite' } } };
  const plan = () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }]));
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-tr-'))), readMarket, now: () => state.t, defaultPlan: plan, defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, thesisCard: () => state.card, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  pl._ledger().orders.push({ at: '2026-11-13T01:00:00.000Z', symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 43, price: 70000, filledQty: 43, avgPrice: 70000, status: 'filled', why: 't' });
  return { pl, state };
}
const card = (over = {}) => ({ key: '005930', asOf: '2026-10-30', verdict: 'pass', growth: { lastQuarter: '2026-06-30' }, value: { pct: 0.6 }, ...over });

test('위성 묶음: 첫 매수 뒤 수익을 같은 기간 지수와 비교 · 공개 파일에 허용 필드만', async () => {
  const { pl, state } = setup({ price: 77000, card: card() });
  const st = await pl.status(); assert.equal(st.sleeve.n, 1); const i = st.sleeve.items[0];
  assert.ok(Math.abs(i.returnPct - 0.1) < 1e-9 && i.indexPct === 0 && Math.abs(i.excessPct - 0.1) < 1e-9, JSON.stringify(i)); assert.equal(st.sleeve.excessPp, 10); assert.equal(i.step, 1); assert.equal(i.since, '2026-11-13');
  const pub = publicSnapshot(st, { asOf: new Date(state.t).toISOString() }); assert.equal(pub.sleeve.excessPp, 10); assert.deepEqual(Object.keys(pub.sleeve.items[0]).sort(), ['excessPct', 'indexPct', 'name', 'returnPct', 'since', 'step', 'symbol', 'targetPct']);
});

test('나눠 사기: 15% 하락(카드 통과)이면 2단계 → 계획 비중 3% → 4%, 계획 버전에 +T · 같은 조건은 한 번만 · 새 분기 카드가 통과하면 3단계', async () => {
  const { pl, state } = setup({ price: 70000, card: card() });
  let st = await pl.status(); const v0 = st.planVersionNow; assert.equal(st.tranche['005930'].step, 1);
  state.price = 59000; st = await pl.status(); assert.equal(st.tranche['005930'].step, 2); assert.match(st.tranche['005930'].log[0].reason, /15% 하락/); assert.match(st.planVersionNow, /\+T:[0-9a-f]{8}$/); assert.notEqual(st.planVersionNow, v0);
  const pv = await pl.preview({ rules: { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 }, rebalance: true }); const buy = pv.items.find(x => x.symbol === '005930');
  assert.ok(buy && buy.side === 'BUY' && Math.abs(buy.amountKrw - (4_000_000 - 43 * 59000)) < 60000, JSON.stringify(buy));
  st = await pl.status(); assert.equal(st.tranche['005930'].step, 2, '같은 조건으로 다시 올리지 않는다');
  state.card = card({ asOf: '2027-01-29', growth: { lastQuarter: '2026-09-30' } }); st = await pl.status(); assert.equal(st.tranche['005930'].step, 3); assert.match(st.tranche['005930'].log.at(-1).reason, /새 분기 실적/);
  state.price = 40000; st = await pl.status(); assert.equal(st.tranche['005930'].step, 3, '3단계가 끝');
});

test('나눠 사기를 올리지 않는 조건: 카드가 탈락(근거 깨짐)이면 싸져도 더 사지 않는다 · 이슈가 걸려 있어도', async () => {
  const a = setup({ price: 59000, card: card({ verdict: 'fail' }) }); assert.equal((await a.pl.status()).tranche['005930'].step, 1);
  const b = setup({ price: 70000, card: card() }); await b.pl.status(); b.pl.setIssue({ symbol: '005930', level: 'caution', reason: '소송', date: '2026-11-16' }); b.state.price = 59000; assert.equal((await b.pl.status()).tranche['005930'].step, 1);
});

test('뉴스·가격 급락: 회사 이름 + 위험 낱말만 · 주의까지만 넘긴다', async () => {
  assert.equal(gradeNews('삼성전자', '삼성전자, 3분기 실적 호조'), null); assert.equal(gradeNews('삼성전자', '검찰, 삼성전자 압수수색'), '수사'); assert.equal(gradeNews('삼성전자', 'SK하이닉스 수출 규제 우려'), null);
  assert.equal(gradeNews('엔비디아 (NVDA)', '미 상무부, 엔비디아 대중 수출 통제 강화'), '규제·제재');
  const got = [], engine = { setIssue: e => { got.push(e); return { applied: true }; } };
  const w = createIssueWatch({ engine, gapMs: 0, symbols: () => [{ symbol: 'NVDA', market: 'US', name: '엔비디아 (NVDA)' }, { symbol: '005930', market: 'KR', name: '삼성전자' }], fetchKR: async () => [], fetchUS: async () => [],
    priceDrop: async s => s.symbol === '005930' ? { date: '2026-11-16', dropPp: -9.4 } : { date: '2026-11-16', dropPp: -2 },
    news: async s => s.symbol === 'NVDA' ? [{ title: '젠슨 황 "수요 강하다"', date: '2026-11-16' }, { title: '미 상무부, 엔비디아 대중 수출 통제 강화', date: '2026-11-16', link: 'n1' }] : [] });
  const r = await w.scan(); assert.deepEqual(got.map(e => [e.symbol, e.level, e.source]), [['NVDA', 'caution', '뉴스'], ['005930', 'caution', '시세']]); assert.match(got[1].reason, /지수 대비 -9\.4%p/); assert.equal(r.events.length, 2);
});
