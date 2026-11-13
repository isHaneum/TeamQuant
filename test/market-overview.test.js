// 오늘 장(결정 33): 공개 시세 응답을 숫자로 추리기 · 한 부분이 실패해도 나머지는 보냄 · 주식만 걸러내기 · 캐시. 네트워크 없음(합성 응답).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMarketOverview, fetchIndustryStocks, pickStock, pickFlow, pickIndex, _clearMarketOverviewCache } from '../lib/market-overview.js';

const stock = (code, name, pct, type = 'stock') => ({ itemCode: code, stockName: name, closePrice: '12,345', fluctuationsRatio: String(pct), accumulatedTradingValue: '221,039', marketValue: '1,234', stockEndType: type, sosok: '0' });
const pages = {
  '/api/index/KOSPI/basic': { closePrice: '5,297.51', compareToPreviousClosePrice: '-45.22', fluctuationsRatio: '-0.85', marketStatus: 'CLOSE', localTradedAt: '2026-11-13T15:30:00+09:00' },
  '/api/index/KOSDAQ/basic': { closePrice: '901.10', compareToPreviousClosePrice: '3.10', fluctuationsRatio: '0.35', marketStatus: 'CLOSE', localTradedAt: '2026-11-13T15:30:00+09:00' },
  '/index/.INX/basic': { closePrice: '7,592.40', compareToPreviousClosePrice: '-26.98', fluctuationsRatio: '-0.35', marketStatus: 'CLOSE', localTradedAt: '2026-11-12T16:58:23-05:00' },
  '/front-api/marketIndex/productDetail': { result: { closePrice: '1,336.40', fluctuations: '-0.10', fluctuationsRatio: '-0.01', marketStatus: 'OPEN', localTradedAt: '2026-11-13T15:26:03+09:00' } },
  '/api/index/KOSPI/trend': { bizdate: '20261113', personalValue: '+36', foreignValue: '-5,640', institutionalValue: '+313' },
  '/api/stocks/industry': { groups: [{ no: 301, name: '은행', totalCount: 11, changeRate: '3.97', riseCount: 11, fallCount: 0 }, { no: 278, name: '반도체', totalCount: 150, changeRate: '-1.20', riseCount: 40, fallCount: 100 }] },
  '/api/stocks/marketValue/KOSPI': { stocks: [stock('005930', '삼성전자', -0.48), stock('000660', 'SK하이닉스', 1.2)] },
  '/api/stocks/up/KOSPI': { stocks: [stock('252670', 'KODEX 200선물인버스2X', 2.75, 'etf'), stock('002880', '디와이에이', 30)] },
  '/api/stocks/down/KOSPI': { stocks: [stock('36328K', '티와이홀딩스우', -23.17)] },
  '/api/stocks/quantTop/KOSPI': { stocks: [stock('252670', 'KODEX 200선물인버스2X', 2.75, 'etf'), stock('005930', '삼성전자', -0.48)] },
  '/api/stocks/industry/301': { groupInfo: { name: '은행' }, stocks: [{ ...stock('105560', 'KB금융', 4.1), marketValue: '600,000' }, { ...stock('055550', '신한지주', 3.5), marketValue: '400,000' }] },
};
const mk = (fail = []) => { const calls = []; return { calls, fetchImpl: async url => { const u = new URL(url); calls.push(u.pathname); if (fail.some(f => u.pathname.includes(f))) return { ok: false, status: 500, json: async () => ({}) }; const j = pages[u.pathname]; return j ? { ok: true, status: 200, json: async () => j } : { ok: false, status: 404, json: async () => ({}) }; } }; };

test('숫자 추리기: 쉼표·부호 · 거래대금은 억원 · 투자자별 순매수는 억원 그대로 · 날짜 형식', () => {
  const s = pickStock(stock('005930', '삼성전자', -0.48)); assert.deepEqual([s.code, s.price, s.pct, s.valueEok, s.capEok, s.type, s.market], ['005930', 12345, -0.48, 2210, 1234, 'stock', 'KOSPI']);
  assert.deepEqual(pickFlow('KOSPI', pages['/api/index/KOSPI/trend']), { market: 'KOSPI', date: '2026-11-13', personal: 36, foreign: -5640, institution: 313 });
  const i = pickIndex('KOSPI', '코스피', pages['/api/index/KOSPI/basic']); assert.deepEqual([i.price, i.change, i.pct, i.open], [5297.51, -45.22, -0.85, false]); assert.equal(pickIndex('X', 'x', null), null);
});

test('한눈에: 지수·환율·투자자별·업종·순위 · 상승/하락/거래량은 주식만 · 빠진 부분은 errors 에 이름만', async () => {
  _clearMarketOverviewCache(); const m = mk(['.IXIC', 'KOSDAQ/trend']), v = await fetchMarketOverview({ market: 'KOSPI', fetchImpl: m.fetchImpl, now: () => 1e12 });
  assert.deepEqual(v.indices.map(x => x.key), ['KOSPI', 'KOSDAQ', 'SPX', 'USDKRW']); assert.equal(v.flows.length, 1); assert.equal(v.flows[0].foreign, -5640);
  assert.deepEqual(v.sectors.map(s => [s.no, s.name, s.pct, s.up, s.down]), [[301, '은행', 3.97, 11, 0], [278, '반도체', -1.2, 40, 100]]);
  assert.deepEqual(v.lists.up.map(s => s.code), ['002880'], 'ETF 는 상승 상위에서 뺀다'); assert.deepEqual(v.lists.volume.map(s => s.code), ['005930']); assert.equal(v.lists.cap.length, 2); assert.equal(v.lists.down[0].code, '36328K');
  assert.deepEqual(v.errors.sort(), ['나스닥', '코스닥 투자자별']); assert.equal(v.source, '네이버 증권');
  const n = m.calls.length; await fetchMarketOverview({ market: 'KOSPI', fetchImpl: m.fetchImpl, now: () => 1e12 + 10000 }); assert.equal(m.calls.length, n, '45초 안에는 다시 부르지 않는다');
  await fetchMarketOverview({ market: 'KOSPI', fetchImpl: m.fetchImpl, now: () => 1e12 + 60000 }); assert.ok(m.calls.length > n);
});

test('입력 검사 · 전부 실패하면 오류 · 업종 종목은 시가총액 순', async () => {
  _clearMarketOverviewCache(); await assert.rejects(fetchMarketOverview({ market: 'NYSE', fetchImpl: mk().fetchImpl }), e => e.status === 400);
  await assert.rejects(fetchMarketOverview({ market: 'KOSDAQ', fetchImpl: mk(['/']).fetchImpl }), /받지 못했습니다/);
  await assert.rejects(fetchIndustryStocks('abc', { fetchImpl: mk().fetchImpl }), e => e.status === 400);
  const r = await fetchIndustryStocks('301', { fetchImpl: mk().fetchImpl }); assert.equal(r.name, '은행'); assert.deepEqual(r.stocks.map(s => s.code), ['105560', '055550']);
});
