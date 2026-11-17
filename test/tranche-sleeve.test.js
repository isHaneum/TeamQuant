// 결정 27: 위성 묶음 성과(지수와 따로 비교) · 나눠 사기 단계 올리기(15% 하락 · 새 실적 카드 통과) · 올리지 않는 조건(카드 탈락 · 이슈) · 뉴스·가격 급락은 주의까지만. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';
import { gradeNews, newsLevel, createIssueWatch } from '../lib/issue-watch.js';

function setup({ price = 70000, card = null, dip = null } = {}) {
  const flat = close => { const out = []; for (let t = Date.parse('2025-06-01'); t <= Date.parse('2026-12-31'); t += 864e5) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), open: close, close }); } return out; };
  const readMarket = async s => ({ candles: flat(s === 'KRW=X' ? 1400 : s === '^VIX' ? 20 : 70000) }); // 지수는 그대로(0%) · VIX 20(공포 예비 규칙 비발동)
  const state = { t: Date.parse('2026-11-16T01:30:00Z'), price, card, dip };
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: code === '005930' ? state.price : 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { const v = 43 * state.price; return { cash: 100_000_000 - v, total: 100_000_000, stock: v, positions: [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 43, price: state.price, value: v, valueKrw: v }], cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const doc = { version: 'T1', weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct: 3, targetPct: 5, tranche: 1, name: '삼성전자', currency: 'KRW', role: 'satellite' } } };
  const plan = () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }]));
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-tr-'))), readMarket, now: () => state.t, defaultPlan: plan, defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, thesisCard: () => state.card, dipCard: () => state.dip, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
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
  const b = setup({ price: 70000, card: card() }); await b.pl.status(); b.pl.setIssue({ symbol: '005930', level: 'caution', reason: '유상증자', date: '2026-11-16' }); b.state.price = 59000; assert.equal((await b.pl.status()).tranche['005930'].step, 1);
});

test('결정 45: 기록(note) 이슈는 매수를 막지 않는다 · 주의가 있으면 기록이 덧쓰지 않는다 · 공개 파일에 등급 그대로', async () => {
  const { pl, state } = setup({ price: 70000, card: card() }); await pl.status();
  const r = pl.setIssue({ symbol: '005930', name: '삼성전자', level: 'note', reason: '뉴스(소송·과징금): 담합 소송 기각 요청 거부', source: '뉴스', date: '2026-11-16' }); assert.equal(r.applied, true); assert.equal(r.issue.noAdd, false);
  state.price = 59000; const st = await pl.status(); assert.equal(st.tranche['005930'].step, 2, '기록은 나눠 사기를 막지 않는다'); assert.equal(st.issues[0].level, 'note');
  const pv = await pl.preview({ rules: { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 }, rebalance: true }); const buy = pv.items.find(x => x.symbol === '005930'); assert.ok(buy && buy.ok, '기록은 매수 확인을 막지 않는다 ' + JSON.stringify(buy?.blocks));
  pl.setIssue({ symbol: '005930', level: 'caution', reason: '유상증자: 주요사항보고서', source: 'DART', date: '2026-11-17' }); assert.equal((await pl.status()).issues[0].level, 'caution');
  assert.equal(pl.setIssue({ symbol: '005930', level: 'note', reason: '뉴스(파업): 노조 파업', source: '뉴스', date: '2026-11-18' }).applied, false, '주의가 걸려 있으면 기록이 덧쓰지 않는다'); assert.equal((await pl.status()).issues[0].level, 'caution');
  assert.equal(publicSnapshot(await pl.status()).issues[0].level, 'caution');
});

test('결정 45: 하락 매수 검증 카드 — 보류/금지면 15% 하락에도 올리지 않고, 허용이면 올리며 30% 하락에서 3단계 · 기한이 지난 카드는 없는 것으로 본다 · 공개 파일에 판정', async () => {
  const dipCard = over => ({ asOf: '2026-11-15', verdict: 'allow', cause: 'customer', reason: '근거 유지', until: '2026-12-15', facts: [], ...over });
  const h = setup({ price: 59000, card: card(), dip: dipCard({ verdict: 'hold' }) }); assert.equal((await h.pl.status()).tranche['005930'].step, 1, '보류');
  const f = setup({ price: 59000, card: card(), dip: dipCard({ verdict: 'forbid' }) }); assert.equal((await f.pl.status()).tranche['005930'].step, 1, '금지');
  const a = setup({ price: 59000, card: card(), dip: dipCard() }); let st = await a.pl.status(); assert.equal(st.tranche['005930'].step, 2); assert.match(st.tranche['005930'].log[0].reason, /검증 카드 허용\(2026-11-15\)/);
  assert.deepEqual(st.dipCards['005930'], { verdict: 'allow', asOf: '2026-11-15', cause: 'customer', reason: '근거 유지', until: '2026-12-15', expired: false });
  a.state.price = 48000; st = await a.pl.status(); assert.equal(st.tranche['005930'].step, 3); assert.match(st.tranche['005930'].log.at(-1).reason, /30% 하락/);
  const pub = publicSnapshot(st); assert.equal(pub.dipCards['005930'].verdict, 'allow'); assert.equal(pub.dipCards['005930'].reason, '근거 유지');
  const e = setup({ price: 59000, card: card(), dip: dipCard({ verdict: 'forbid', until: '2026-11-01' }) }); st = await e.pl.status(); assert.equal(st.tranche['005930'].step, 2, '기한 지난 금지 카드는 효력 없음'); assert.equal(st.dipCards['005930'].expired, true);
});

test('뉴스·가격 급락: 회사 이름 + 위험 낱말만 · 주의까지만 넘긴다', async () => {
  assert.equal(gradeNews('삼성전자', '삼성전자, 3분기 실적 호조'), null); assert.equal(gradeNews('삼성전자', '검찰, 삼성전자 압수수색'), '수사'); assert.equal(gradeNews('삼성전자', 'SK하이닉스 수출 규제 우려'), null);
  assert.equal(gradeNews('엔비디아 (NVDA)', '미 상무부, 엔비디아 대중 수출 통제 강화'), '규제·제재');
  const got = [], engine = { setIssue: e => { got.push(e); return { applied: true }; } };
  const w = createIssueWatch({ engine, gapMs: 0, symbols: () => [{ symbol: 'NVDA', market: 'US', name: '엔비디아 (NVDA)' }, { symbol: '005930', market: 'KR', name: '삼성전자' }], fetchKR: async () => [], fetchUS: async () => [],
    priceDrop: async s => s.symbol === '005930' ? { date: '2026-11-16', dropPp: -9.4 } : { date: '2026-11-16', dropPp: -2 },
    news: async s => s.symbol === 'NVDA' ? [{ title: '젠슨 황 "수요 강하다"', date: '2026-11-16' }, { title: '미 상무부, 엔비디아 대중 수출 통제 강화', date: '2026-11-16', link: 'https://a.example/1' }, { title: '엔비디아 수출 통제 대상 확대', date: '2026-11-16', link: 'https://b.example/2' }] : [{ title: '삼성전자 노조 파업 예고', date: '2026-11-16', link: 'https://a.example/3' }] }); // 삼성전자 파업 기사는 1곳뿐 → 주의 아님(결정 32)
  const r = await w.scan(); assert.deepEqual(got.map(e => [e.symbol, e.level, e.source]), [['NVDA', 'caution', '뉴스'], ['005930', 'caution', '시세']]); assert.match(got[1].reason, /지수 대비 -9\.4%p/); assert.equal(r.events.length, 2);
});

test('결정 45: 소송·과징금·파업 기사는 기록(note)으로 넘기고, 전에 걸린 같은 종류의 주의는 기록으로 내린다', async () => {
  assert.equal(gradeNews('SK하이닉스', '美 법원, 삼성·SK하이닉스·마이크론 D램 담합 소송 기각 요청 거부'), '소송·과징금'); assert.equal(newsLevel('소송·과징금'), 'note'); assert.equal(newsLevel('파업'), 'note'); assert.equal(newsLevel('경영진'), 'caution'); assert.equal(newsLevel('규제·제재'), 'caution');
  const got = [], cleared = [];
  const issues = [{ symbol: '000660', level: 'caution', noAdd: true, source: '뉴스', reason: '뉴스(과징금): 美 법원, 삼성·SK하이닉스·마이크론 D램 담합 소송 기각 요청 거부', date: '2026-11-16', sources: 2 }];
  const engine = { setIssue: e => { got.push(e); return { applied: true }; }, clearIssue: (s, why) => { cleared.push([s, why]); issues.length = 0; return { cleared: true }; }, issues: () => issues };
  const w = createIssueWatch({ engine, gapMs: 0, symbols: () => [{ symbol: '000660', market: 'KR', name: 'SK하이닉스' }], fetchKR: async () => [], fetchUS: async () => [], priceDrop: async () => null,
    news: async () => [{ title: 'SK하이닉스 담합 소송 본안 진행', date: '2026-11-17', link: 'https://a.example/1' }, { title: 'SK하이닉스 D램 담합 집단소송 계속', date: '2026-11-17', link: 'https://b.example/2' }] });
  const r = await w.scan();
  assert.equal(cleared.length, 1); assert.match(cleared[0][1], /기록/);
  assert.deepEqual(got.map(e => [e.symbol, e.level]), [['000660', 'note'], ['000660', 'note']], '내려진 기록 + 새 기사도 기록');
  assert.ok(r.events.some(e => e.level === 'note'));
});

test('200일선 규칙: 위성 종목은 200일 평균 아래여도 산다 · 같은 조건의 지수(핵심)는 사지 않는다(결정 28)', async () => {
  const down = (start) => { const out = []; let p = start; for (let t = Date.parse('2025-06-01'); t <= Date.parse('2026-11-16'); t += 864e5) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { p *= 0.999; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } } return out; };
  const readMarket = async s => ({ candles: s === 'KRW=X' ? down(1400).map(c => ({ ...c, open: 1400, close: 1400 })) : down(300) }); // 미국 두 종목 모두 내리막(200일 평균 아래)
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'US', currency: 'USD', exchange: 'NASD', price: 200, upper: null, lower: null, halted: false }; }, async balance() { return { cash: 100_000_000, total: 100_000_000, stock: 0, positions: [], cashUsd: 0, stockUsd: 0 }; }, async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const doc = { version: 'T1', weights: { SPY: { pct: 10, name: 'S&P500 ETF', currency: 'USD', role: 'core' }, NVDA: { pct: 3, targetPct: 5, tranche: 1, name: '엔비디아', currency: 'USD', role: 'satellite' } } };
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-200-'))), readMarket, now: () => Date.parse('2026-11-16T15:30:00Z'), defaultPlan: () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }])), defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  const pv = await pl.preview({ rules: { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8, trendUS: true }, rebalance: true });
  assert.ok(pv.items.some(i => i.symbol === 'NVDA' && i.side === 'BUY' && i.ok), JSON.stringify(pv.items.map(i => [i.symbol, i.side, i.ok, i.blocks])));
  assert.ok(!pv.items.some(i => i.symbol === 'SPY' && i.side === 'BUY'), '지수는 200일선 아래면 사지 않는다');
});
