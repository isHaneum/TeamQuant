// 긴급 대응 감시(결정 26): 공시 등급 규칙 · 엔진 반영(주의 = 추가 매수 정지, 긴급 = 계획 비중 절반 + 계획 버전 변경) · 핵심 지수 제외 · 같은 공시 한 번만 · 조회 실패는 건너뜀. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeDisclosure, createIssueWatch, fetchSecFilings } from '../lib/issue-watch.js';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';

test('등급: 국내 제목 · 미국 8-K 항목', () => {
  const kr = t => gradeDisclosure({ market: 'KR', title: t }).level;
  assert.equal(kr('횡령ㆍ배임혐의발생'), 'urgent'); assert.equal(kr('감사보고서제출(의견거절)'), 'urgent'); assert.equal(kr('주권매매거래정지'), 'urgent'); assert.equal(kr('단일판매ㆍ공급계약해지'), 'urgent');
  assert.equal(kr('[기재정정]횡령ㆍ배임사실확인'), 'urgent'); assert.equal(kr('불성실공시법인지정예고'), 'caution'); assert.equal(kr('불성실공시법인지정'), 'urgent');
  assert.equal(kr('주요사항보고서(유상증자결정)'), 'caution'); assert.equal(kr('소송등의제기ㆍ신청'), 'caution'); assert.equal(kr('대표이사변경'), 'caution');
  assert.equal(kr('분기보고서 (2026.09)'), 'watch'); assert.equal(kr('단일판매ㆍ공급계약체결'), 'watch'); assert.equal(kr('현금ㆍ현물배당결정'), 'watch');
  const us = (form, items) => gradeDisclosure({ market: 'US', form, items }).level;
  assert.equal(us('8-K', '4.02,9.01'), 'urgent'); assert.equal(us('8-K', '1.03'), 'urgent'); assert.equal(us('8-K', '5.02,9.01'), 'caution'); assert.equal(us('8-K', '2.02,9.01'), 'watch'); assert.equal(us('10-Q', ''), 'watch');
});

test('SEC 조회: 8-K 만 · 기간 안 · 개인 이메일 없는 User-Agent', async () => {
  let headers = null;
  const fetchImpl = async (url, init) => { headers = init.headers; return { ok: true, json: async () => ({ filings: { recent: { form: ['8-K', '10-Q', '8-K'], filingDate: ['2026-11-11', '2026-11-10', '2026-10-01'], items: ['5.02,9.01', '', '2.02'], accessionNumber: ['0001-26-000001', '0001-26-000002', '0001-26-000003'], primaryDocument: ['a.htm', 'b.htm', 'c.htm'] } } }) }; };
  const r = await fetchSecFilings(1045810, { days: 5, now: new Date('2026-11-12T00:00:00Z'), fetchImpl });
  assert.deepEqual(r.map(x => [x.date, x.form, x.items]), [['2026-11-11', '8-K', '5.02,9.01']]); assert.match(r[0].link, /edgar\/data\/1045810\/000126000001\/a\.htm/);
  assert.ok(!/@/.test(headers['User-Agent']) && /TeamQuant/.test(headers['User-Agent']));
});

function setup() {
  const candles = (start, seed) => { const out = []; let t = Date.parse('2024-11-01'), p = start, s = seed; while (out.length < 520) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { s = (s * 16807) % 2147483647; p *= 1 + 0.0004 + (s / 2147483647 - 0.5) * 0.02; out.push({ date: d.toISOString().slice(0, 10), open: p, close: p }); } t += 864e5; } return out; };
  const readMarket = async s => ({ candles: candles(s === 'KRW=X' ? 1400 : 70000, s.length + 3) });
  const pos = [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000 }];
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****2787' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: 93_000_000, total: 100_000_000, stock: 7_000_000, positions: pos, cashUsd: 0, stockUsd: 0 }; }, async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const state = { t: Date.parse('2026-11-09T01:30:00Z') };
  const doc = { version: 'T1', weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct: 7, name: '삼성전자', currency: 'KRW', role: 'satellite' }, '000660': { pct: 7, name: 'SK하이닉스', currency: 'KRW', role: 'satellite' } } };
  const plan = () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }]));
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-iss-'))), readMarket, now: () => state.t, defaultPlan: plan, defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  return { pl, state };
}
const rules = { maxSingle: 25, minCash: 10, dailyLoss: 2.5, maxTrades30: 8 };

test('엔진: 주의 = 그 종목 추가 매수만 막고 계획 버전은 그대로 · 긴급 = 계획 비중 절반이라 버전이 바뀌고 보유를 줄인다 · 핵심 지수에는 걸리지 않는다 · 같은 공시는 한 번만 · 기한이 지나면 풀린다', async () => {
  const { pl, state } = setup(); const v0 = (await pl.status()).planVersionNow;
  assert.equal(pl.setIssue({ symbol: '069500', level: 'urgent', reason: 'x', date: '2026-11-09' }).applied, false, '핵심 지수 제외');
  assert.equal(pl.setIssue({ symbol: '000660', name: 'SK하이닉스', level: 'caution', reason: '유상증자: 주요사항보고서', source: 'DART', date: '2026-11-09' }).applied, true);
  assert.equal(pl.setIssue({ symbol: '000660', level: 'caution', reason: '유상증자: 주요사항보고서', source: 'DART', date: '2026-11-09' }).applied, false, '같은 공시는 한 번만');
  let st = await pl.status(); assert.equal(st.planVersionNow, v0, '주의는 재조정을 부르지 않는다'); assert.equal(st.issues.length, 1); assert.equal(st.issues[0].factor, 1);
  let pv = await pl.preview({ rules, rebalance: true }); const hy = pv.items.find(i => i.symbol === '000660'); assert.ok(hy && hy.side === 'BUY' && !hy.ok && hy.blocks.some(b => /이슈 대응: 추가 매수 정지\(주의/.test(b)), JSON.stringify(hy));
  assert.ok(pv.items.find(i => i.symbol === '069500')?.ok, '다른 종목 매수는 그대로');
  assert.equal(pl.setIssue({ symbol: '005930', name: '삼성전자', level: 'urgent', reason: '횡령·배임: 횡령ㆍ배임혐의발생', source: 'DART', date: '2026-11-09' }).applied, true);
  st = await pl.status(); assert.notEqual(st.planVersionNow, v0); assert.match(st.planVersionNow, /\+I:[0-9a-f]{8}$/);
  pv = await pl.preview({ rules, rebalance: true }); const ss = pv.items.find(i => i.symbol === '005930'); assert.ok(ss && ss.side === 'SELL' && ss.qty === 50, '7% → 3.5%: 절반 매도 ' + JSON.stringify(ss));
  pl.setIssue({ symbol: '005930', level: 'urgent', reason: '거래정지 관련: 주권매매거래정지', source: 'DART', date: '2026-11-10' }); assert.equal((await pl.status()).issues.find(i => i.symbol === '005930').factor, 0.5, '겹쳐 줄이지 않는다');
  const pub = publicSnapshot(await pl.status(), { asOf: '2026-11-09T02:00:00Z' }); assert.equal(pub.issues.length, 2); assert.deepEqual(Object.keys(pub.issues[0]).sort(), ['at', 'date', 'factor', 'level', 'name', 'reason', 'source', 'symbol', 'until']);
  state.t += 31 * 864e5; st = await pl.status(); assert.equal(st.issues.length, 0); assert.equal(st.planVersionNow, v0, '기한이 지나면 계획이 원래대로');
  assert.equal(pl.clearIssue('005930').cleared, true);
});

test('감시: 위성 종목 공시를 읽어 주의·긴급만 엔진에 넘긴다 · 조회 실패 종목은 건너뛰고 나머지는 계속', async () => {
  const got = [], engine = { setIssue: e => { got.push(e); return { applied: true }; } };
  const w = createIssueWatch({ engine, gapMs: 0, now: () => Date.parse('2026-11-12T00:00:00Z'), symbols: () => [{ symbol: '005930', market: 'KR', name: '삼성전자' }, { symbol: 'NVDA', market: 'US', name: '엔비디아' }, { symbol: 'GE', market: 'US', name: 'GE' }],
    fetchKR: async () => [{ date: '2026-11-11', title: '분기보고서 (2026.09)', link: 'k1' }, { date: '2026-11-11', title: '소송등의제기ㆍ신청', link: 'k2' }],
    fetchUS: async sym => { if (sym === 'GE') throw new Error('SEC 응답 503'); return [{ date: '2026-11-11', form: '8-K', items: '4.02', title: '8-K 4.02', link: 'u1' }, { date: '2026-11-10', form: '8-K', items: '2.02', title: '8-K 2.02', link: 'u2' }]; } });
  const r = await w.scan(); assert.equal(r.checked, 2); assert.equal(r.failed, 1); assert.deepEqual(r.events.map(e => [e.symbol, e.level]), [['005930', 'caution'], ['NVDA', 'urgent']]);
  assert.deepEqual(got.map(e => [e.symbol, e.level, e.source, e.date]), [['005930', 'caution', 'DART', '2026-11-11'], ['NVDA', 'urgent', 'SEC', '2026-11-11']]); assert.match(got[1].reason, /재무제표 신뢰 불가/);
});
