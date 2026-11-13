// 결정 31(2026-11-13 · 운용 5일째에 드러난 결함): ① 위성 "같은 기간 지수"가 진입일 봉이 없을 때 1년 전 봉으로 떨어짐 ② 정리(exit) 종목의 지정가가 안 채워지면 다시 내지 않음 ③ 다른 회사 임원 기사가 우리 종목의 경영진 이슈로 잡힘. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { gradeNews, createIssueWatch, NEWS_ALIAS } from '../lib/issue-watch.js';

function setup({ lastCandle = '2026-12-31', exitQty = 0 } = {}) {
  // 지수: 2026-11-13 시가 70,000 → 그날부터 종가 77,000(+10%). 그 전은 35,000(1년 전 봉으로 떨어지면 +120%가 나온다).
  const series = () => { const out = []; for (let t = Date.parse('2025-06-01'); t <= Date.parse(lastCandle); t += 864e5) { const d = new Date(t), date = d.toISOString().slice(0, 10); if (d.getUTCDay() && d.getUTCDay() !== 6) out.push(date >= '2026-11-13' ? { date, open: date === '2026-11-13' ? 70000 : 77000, close: 77000 } : { date, open: 35000, close: 35000 }); } return out; };
  const readMarket = async s => ({ candles: s === 'KRW=X' ? series().map(c => ({ ...c, open: 1400, close: 1400 })) : series() });
  const state = { t: Date.parse('2026-11-16T01:30:00Z'), placed: [] };
  const pos = () => [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 43, price: 77000, value: 43 * 77000, valueKrw: 43 * 77000 }, ...(exitQty ? [{ symbol: '105560', name: 'KB금융', market: 'KR', currency: 'KRW', qty: exitQty, price: 100000, value: exitQty * 100000, valueKrw: exitQty * 100000 }] : [])];
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****0000' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: code === '105560' ? 100000 : 77000, upper: 0, lower: 0, halted: false }; },
    async balance() { const v = pos().reduce((a, p) => a + p.valueKrw, 0); return { cash: 100_000_000 - v, total: 100_000_000, stock: v, positions: pos(), cashUsd: 0, stockUsd: 0 }; },
    async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place(o) { state.placed.push(o); return { odno: String(state.placed.length), orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const doc = { version: 'T1', weights: { '069500': { pct: 0.01, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct: 3.3, targetPct: 5, tranche: 1, name: '삼성전자', currency: 'KRW', role: 'satellite' }, '105560': { pct: 0, exit: true, name: 'KB금융', currency: 'KRW', role: 'exit' } } };
  const plan = () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency, ...(v.exit ? { exit: true } : {}) }]));
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-d5-'))), readMarket, now: () => state.t, defaultPlan: plan, defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
  return { pl, state };
}
const buy = at => ({ at, symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 43, price: 70000, filledQty: 43, avgPrice: 70000, status: 'filled', why: 't' });

test('같은 기간 지수: 진입일 시가 기준 · 진입일 봉이 아직 없으면 비교 전(null)이고 묶음 평균에서 빠진다', async () => {
  const a = setup(); a.pl._ledger().orders.push(buy('2026-11-13T00:08:00.000Z'));
  let st = await a.pl.status(); const i = st.sleeve.items[0];
  assert.ok(Math.abs(i.indexPct - 0.1) < 1e-9 && Math.abs(i.returnPct - 0.1) < 1e-9 && Math.abs(i.excessPct) < 1e-9, JSON.stringify(i)); assert.equal(st.sleeve.excessPp, 0);
  const b = setup({ lastCandle: '2026-11-12' }); b.pl._ledger().orders.push(buy('2026-11-13T00:08:00.000Z')); // 오늘 샀고 오늘 봉은 아직 없다
  st = await b.pl.status(); assert.equal(st.sleeve.items[0].indexPct, null); assert.equal(st.sleeve.items[0].excessPct, null); assert.equal(st.sleeve.n, 0); assert.equal(st.sleeve.excessPp, null);
});

test('전환 잔여: 계획이 집행으로 적힌 뒤에도 정리 종목이 남아 있으면 다음 거래일에 재조정으로 다시 판다 · 3번까지', async () => {
  const { pl, state } = setup({ exitQty: 10 }); const L = pl._ledger(); L.orders.push(buy('2026-11-13T00:08:00.000Z'));
  const ver = (await pl.status()).planVersionNow; L.planVersion.KR = ver; L.planVersion.US = ver; // 지난 거래일에 집행으로 적힌 상태(월요일 · 주간 점검일 아님)
  const r = await pl.autoRun(); assert.equal(r.ran, true, JSON.stringify(r)); assert.match(r.reason, /전환 잔여/);
  const sell = state.placed.find(o => (o.symbol || o.code) === '105560'); assert.ok(sell && String(sell.side).toUpperCase() === 'SELL' && sell.qty === 10, JSON.stringify(state.placed));
  assert.equal(L.auto['KR:2026-11-16'].rebalance, true); assert.equal(L.residual[`KR:${ver}`], 1);
  for (const d of ['17', '18']) { state.t = Date.parse(`2026-11-${d}T01:30:00Z`); assert.match((await pl.autoRun()).reason, /전환 잔여/); }
  state.t = Date.parse('2026-11-19T01:30:00Z'); assert.equal((await pl.autoRun()).ran, false, '세 번 해도 남으면 사람이 본다');
  const none = setup(); none.pl._ledger().orders.push(buy('2026-11-13T00:08:00.000Z')); const v2 = (await none.pl.status()).planVersionNow; none.pl._ledger().planVersion.KR = v2;
  assert.equal((await none.pl.autoRun()).ran, false, '남은 것이 없으면 돌지 않는다');
});

test('뉴스: 위험 낱말의 주어가 이 회사일 때만 — 2026-11-13 실제 제목', () => {
  const watch = ['엔비디아', '젠슨 황', '젠슨황', 'SK하이닉스', '삼성전자', '셀트리온'], opt = name => ({ aliases: name === '엔비디아 (NVDA)' ? NEWS_ALIAS.NVDA : [], others: watch.filter(k => !name.startsWith(k) && !(name === '엔비디아 (NVDA)' && NEWS_ALIAS.NVDA.includes(k))) });
  const g = (name, title) => gradeNews(name, title, opt(name));
  const t1 = '젠슨 황 사임 충격에도 코스피 5,500선 터치…삼성전자·SK하이닉스 급등', t2 = '[특징주] 삼성전자·SK하이닉스 장 초반 동반 강세…엔비디아 CEO 사임에...', t3 = "젠슨 황 해임에 집단소송 '러시'... 엔비디아 보유 '서학개미'도 배상받...";
  assert.equal(g('삼성전자', t1), null); assert.equal(g('SK하이닉스', t1), null); assert.equal(g('엔비디아 (NVDA)', t1), '경영진');
  assert.equal(g('삼성전자', t2), null); assert.equal(g('SK하이닉스', t2), null); assert.equal(g('엔비디아 (NVDA)', t2), '경영진');
  assert.equal(g('엔비디아 (NVDA)', t3), '경영진'); assert.equal(g('엔비디아 (NVDA)', '젠슨 황, 의혹 속 엔비디아 CEO 전격 사임…33년 만에 퇴진'), '경영진');
  assert.equal(g('삼성전자', '검찰, 삼성전자 압수수색'), '수사'); assert.equal(g('삼성전자', '삼성전자 노조 파업 돌입'), '파업'); assert.equal(g('삼성전자', 'TSMC 회장 사임에 삼성전자 반사이익'), null);
});

test('감시: 걸려 있는 뉴스 주의의 제목이 지금 기준으로 다른 회사 기사면 푼다 · 맞는 것은 둔다', async () => {
  const issues = { '005930': { level: 'caution', source: '뉴스', date: '2026-11-13', reason: '뉴스(경영진): 젠슨 황 사임에도 코스피 1.89%·코스닥 3.47% 급등…삼성전자·SK하이닉...' }, NVDA: { level: 'caution', source: '뉴스', date: '2026-11-13', reason: "뉴스(경영진): 젠슨 황 해임에 집단소송 '러시'... 엔비디아 보유 '서학개미'도 배상받..." } }, cleared = [];
  const engine = { issues: () => Object.entries(issues).map(([symbol, v]) => ({ symbol, ...v })), clearIssue: (s, why) => { cleared.push([s, why]); delete issues[s]; return { cleared: true }; }, setIssue: () => ({ applied: false }) };
  const w = createIssueWatch({ engine, symbols: () => [{ symbol: '005930', name: '삼성전자', market: 'KR' }, { symbol: '000660', name: 'SK하이닉스', market: 'KR' }, { symbol: 'NVDA', name: '엔비디아 (NVDA)', market: 'US' }], fetchKR: async () => [], fetchUS: async () => [], news: async s => s.symbol === 'NVDA' ? [{ title: '젠슨 황, 엔비디아 CEO 사임', link: 'https://a.example/1', date: '2026-11-13' }, { title: '엔비디아 젠슨 황 사임 후폭풍', link: 'https://b.example/2', date: '2026-11-13' }] : [], gapMs: 0 });
  const out = await w.scan(); assert.deepEqual(cleared.map(c => c[0]), ['005930']); assert.match(cleared[0][1], /다른 회사 기사/); assert.ok(issues.NVDA); assert.ok(out.events.some(e => e.symbol === '005930' && e.level === 'cleared'));
});

import { marketableLimit } from '../lib/kis-orders.js';
test('지정가: 매수는 현재가 +0.5% 올림, 매도는 −0.5% 내림(호가 단위) · 허용 폭 3% 안', () => {
  assert.equal(marketableLimit(611.86, 'SELL', 'US'), 608.8); assert.equal(marketableLimit(180, 'BUY', 'US'), 180.9);
  assert.equal(marketableLimit(1_279_000, 'BUY'), 1_286_000); assert.equal(marketableLimit(213_000, 'SELL'), 211_500); assert.equal(marketableLimit(25_090, 'BUY'), 25_250);
  for (const p of [1_950, 4_990, 19_990, 49_950, 199_900, 499_000, 1_279_000]) for (const s of ['BUY', 'SELL']) { const v = marketableLimit(p, s); assert.ok(Math.abs(v / p - 1) < 0.03, `${p} ${s} ${v}`); assert.ok(s === 'BUY' ? v >= p : v <= p); }
});
test('뉴스 주의: 기준 전에 보도 1곳으로 걸린 주의는 지금 2곳 이상 보도가 없으면 푼다', async () => {
  const issues = { '005930': { level: 'caution', source: '뉴스', date: '2026-11-13', reason: '뉴스(보안 사고): 736억 들인 삼성전자 기술 유출 전 부장... 징역 6년 4개월 확정' } }, cleared = [];
  const engine = { issues: () => Object.entries(issues).map(([symbol, v]) => ({ symbol, ...v })), clearIssue: (s, why) => { cleared.push([s, why]); delete issues[s]; return { cleared: true }; }, setIssue: () => ({ applied: false }) };
  const w = createIssueWatch({ engine, symbols: () => [{ symbol: '005930', name: '삼성전자', market: 'KR' }], fetchKR: async () => [], fetchUS: async () => [], news: async () => [{ title: '736억 들인 삼성전자 기술 유출 전 부장... 징역 6년 4개월 확정', link: 'https://a.example/1' }], gapMs: 0 });
  await w.scan(); assert.equal(cleared.length, 1); assert.match(cleared[0][1], /보도 1곳/);
});
