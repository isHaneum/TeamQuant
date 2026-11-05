import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBeta, alignedReturns, decomposeMove, composeBrief, classifyHeadline, clusterNews, summarizePortfolio } from '../lib/market-brief.js';
import { analyzeHabits, priorReturn } from '../lib/trading-habits.js';
import { adviseDca, judgeHolding } from '../lib/dca-advisor.js';
import { classifyDisclosure, pickAccounts, candidatePeriods } from '../lib/dart.js';

const start = Date.UTC(2025, 0, 1);
const date = i => new Date(start + i * 86400000).toISOString().slice(0, 10);
// 지수는 결정적 파동, 종목은 지수의 beta배 + 고유 잡음, 마지막 날 수익률을 따로 지정한다.
function series(n, { beta = 1.5, lastMarket = -2, lastOwn = 0, noise = 0.3 } = {}) {
  const idx = [], stk = []; let m = 100, s = 100;
  for (let i = 0; i < n; i++) {
    const r = i === n - 1 ? lastMarket : Math.sin(i / 3) * 1.2;
    const own = i === n - 1 ? lastOwn : Math.cos(i * 1.7) * noise;
    if (i) { m *= 1 + r / 100; s *= 1 + (beta * r + own) / 100; }
    idx.push({ date: date(i), close: m, volume: 1000 }); stk.push({ date: date(i), open: s, close: s, volume: i === n - 1 ? 3000 : 1000 });
  }
  return { idx, stk };
}

test('베타 추정은 종목이 시장보다 크게 움직이는 정도를 복원한다', () => {
  const { idx, stk } = series(200, { beta: 1.5 });
  const fit = estimateBeta(alignedReturns(stk, idx));
  assert.ok(Math.abs(fit.beta - 1.5) < 0.1, `beta ${fit.beta}`);
  assert.equal(fit.reliable, true);
  assert.equal(estimateBeta(alignedReturns(stk.slice(0, 20), idx.slice(0, 20))).reliable, false);
});

test('시장 하락이 대부분이면 시장 영향을 첫 원인으로 쓰고 회사 문제로 단정하지 않는다', () => {
  const { idx, stk } = series(200, { beta: 1.2, lastMarket: -3, lastOwn: -0.2 });
  const move = decomposeMove(stk, idx);
  assert.ok(move.marketShare >= 0.9);
  const brief = composeBrief({ name: '테스트전자', symbol: 'T', marketName: '코스피', candles: stk, indexCandles: idx });
  assert.equal(brief.causes[0].kind, 'market');
  assert.match(brief.headline, /코스피 전체 흐름/);
  assert.match(brief.checks[0], /시장 전체 하락/);
  assert.equal(brief.price.volumeRatio, 3);
});

test('종목 고유 움직임은 방향이 맞는 같은 시점 공시를 높은 신뢰 원인으로 연결한다', () => {
  const { idx, stk } = series(200, { beta: 1, lastMarket: 0.1, lastOwn: 6 });
  const last = stk.at(-1).date;
  const brief = composeBrief({ name: '테스트전자', symbol: 'T', marketName: '코스피', candles: stk, indexCandles: idx,
    disclosures: [{ date: last, title: '단일판매ㆍ공급계약체결', kind: 'contract', label: '공급 계약', link: 'https://dart.fss.or.kr/x' }, { date: '2024-01-01', title: '오래된 공시', kind: 'contract', label: '공급 계약' }],
    news: [{ title: '테스트전자, 대규모 수주에 급등', description: '', link: 'https://a.example/1', sourceHost: 'a.example', publishedAt: `${last}T01:00:00Z` },
      { title: '테스트전자 공급 계약 체결 소식', description: '', link: 'https://b.example/2', sourceHost: 'b.example', publishedAt: `${last}T02:00:00Z` },
      { title: '다른회사 실적 발표', description: '', link: 'https://c.example/3', sourceHost: 'c.example', publishedAt: `${last}T03:00:00Z` }] });
  assert.equal(brief.causes[0].kind, 'disclosure');
  assert.equal(brief.causes[0].confidence, 'high');
  assert.equal(brief.causes.filter(c => c.kind === 'disclosure').length, 1, '오래된 공시는 제외');
  assert.ok(brief.causes.some(c => c.kind === 'news' && c.title.includes('2건')), '다른 회사 기사는 묶지 않음');
  assert.match(brief.headline, /원인 후보/);
});

test('주가 방향과 반대인 공시·본문 언급 기사는 한 줄 판단의 원인으로 쓰지 않는다', () => {
  const { idx, stk } = series(200, { beta: 1, lastMarket: -4, lastOwn: 12 });
  const last = stk.at(-1).date;
  const brief = composeBrief({ name: '테스트전자', symbol: 'T', marketName: '코스피', candles: stk, indexCandles: idx,
    disclosures: [{ date: last, title: '주요사항보고서(유상증자결정)', kind: 'dilution', label: '유상증자' }],
    news: [{ title: '반도체 업황 급락 우려', description: '테스트전자 등 관련주', link: 'https://a.example/1', publishedAt: `${last}T01:00:00Z` }] });
  assert.doesNotMatch(brief.headline, /유상증자/);
  assert.match(brief.headline, /확인된 원인은 없습니다/);
  assert.equal(brief.causes.at(-1).fits, false);
  assert.match(brief.causes.at(-1).title, /주가 방향과 반대/);
  assert.ok(!brief.causes.some(c => c.kind === 'news'), '제목에 회사 이름이 없는 기사는 제외');
});

test('원인을 찾지 못하면 그렇다고 말하고, 평소 범위의 작은 움직임은 대응하지 말라고 안내한다', () => {
  const { idx, stk } = series(200, { beta: 1, lastMarket: 0, lastOwn: -5 });
  const unknown = composeBrief({ name: '테스트전자', symbol: 'T', candles: stk, indexCandles: idx });
  assert.equal(unknown.causes.at(-1).kind, 'unknown');
  const calm = series(200, { beta: 1, lastMarket: 0.05, lastOwn: 0.05 });
  const small = composeBrief({ name: '테스트전자', symbol: 'T', candles: calm.stk, indexCandles: calm.idx });
  assert.match(small.headline, /평소 하루 변동/);
  assert.match(small.checks[0], /사고팔 이유는 약합니다/);
});

test('기사 분류는 주제와 방향을 구분하고, 회사 이름이 없는 기사는 묶지 않는다', () => {
  assert.deepEqual(classifyHeadline('A사 3분기 영업이익 사상 최대'), { category: 'earnings', categoryLabel: '실적', tone: 1 });
  assert.equal(classifyHeadline('A사 유상증자 결정에 급락').tone, -1);
  assert.equal(clusterNews([{ title: '코스피 하락', publishedAt: '2025-07-19T00:00:00Z' }], '테스트전자', '2025-07-19').length, 0);
});

test('포트폴리오 요약은 시장 영향 종목이 다수면 그렇게 말한다', () => {
  const a = series(200, { lastMarket: -2, lastOwn: 0 });
  const briefs = ['A', 'B'].map(s => composeBrief({ name: s + '전자', symbol: s, candles: a.stk, indexCandles: a.idx }));
  const sum = summarizePortfolio(briefs, [{ symbol: 'A', valueKrw: 100 }, { symbol: 'B', valueKrw: 300 }]);
  assert.match(sum.headline, /대부분 시장 전체 흐름/);
  assert.equal(sum.down, 2);
});

function order(side, symbol, at, price, qty = 1) {
  return { symbol, side, currency: 'KRW', orderedAt: at, execution: { filledQuantity: qty, averageFilledPrice: price, filledAt: at, commission: 10, tax: side === 'SELL' ? 5 : 0 } };
}
test('매매 습관: 오른 뒤 사기, 짧은 보유, 팔았다 다시 사기를 실제 체결로 계산한다', () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({ date: date(i), close: 100 + i * 3 }));
  assert.ok(priorReturn(candles, date(30)) > 7);
  const orders = [order('BUY', 'X', `${date(20)}T01:00:00Z`, 140), order('SELL', 'X', `${date(22)}T01:00:00Z`, 144),
    order('BUY', 'X', `${date(25)}T01:00:00Z`, 150), order('SELL', 'X', `${date(27)}T01:00:00Z`, 154),
    order('BUY', 'X', `${date(30)}T01:00:00Z`, 160), order('SELL', 'X', `${date(31)}T01:00:00Z`, 162),
    order('BUY', 'X', `${date(33)}T01:00:00Z`, 166),
    { symbol: 'X', side: 'BUY', currency: 'KRW', orderedAt: `${date(34)}T01:00:00Z`, execution: { filledQuantity: 0, averageFilledPrice: null } }];
  const h = analyzeHabits(orders, { candlesBySymbol: { X: candles } });
  assert.equal(h.metrics.trades, 7, '미체결 주문 제외');
  assert.equal(h.metrics.chaseShare, 100);
  assert.equal(h.metrics.shortHoldShare, 100);
  assert.equal(h.metrics.churnCount, 3);
  assert.equal(h.metrics.fees.KRW.amount, 85);
  assert.ok(h.flags.some(f => f.key === 'chase') && h.flags.some(f => f.key === 'short') && h.flags.some(f => f.key === 'churn'));
});

test('매매 습관: 기간 이전 보유분 매도는 보유 기간 계산에서 제외한다', () => {
  const h = analyzeHabits([order('SELL', 'Y', '2025-02-01T00:00:00Z', 100, 3)]);
  assert.equal(h.metrics.matchedSells, 0);
  assert.equal(h.metrics.unmatchedSellQty, 3);
  assert.equal(analyzeHabits([]).available, false);
});

test('적립식: 실적 악화·비중 초과·지수형 상품을 구분하고 하락만으로 교체하지 않는다', () => {
  const brief = (rev, op, fromHigh = -5) => ({ financials: { growth: { revenue: rev, operatingIncome: op } }, price: { annualVolatility: 30, fromHigh } });
  assert.equal(judgeHolding({ symbol: 'A', name: 'A', weightPct: 20 }, brief(-10, -40)).verdict, 'review');
  assert.equal(judgeHolding({ symbol: 'B', name: 'B', weightPct: 20 }, brief(10, 20, -40)).verdict, 'keep');
  assert.equal(judgeHolding({ symbol: 'C', name: 'C', weightPct: 60 }, brief(10, 20)).verdict, 'cap');
  assert.equal(judgeHolding({ symbol: 'D', name: 'KODEX 200', weightPct: 20 }, null).fund, true);
  const advice = adviseDca([{ symbol: 'A', name: 'A', valueKrw: 100 }, { symbol: 'K', name: 'KODEX 200', valueKrw: 100 }], { A: brief(-10, -40) },
    { available: true, metrics: { churnCount: 3, tradesPerWeek: 4 } });
  assert.equal(advice.fundShare, 50);
  assert.ok(advice.summary.some(s => /신규 적립을 멈추고/.test(s)));
  assert.ok(advice.summary.some(s => /평균 단가가 분산/.test(s)));
});

test('DART: 공시 유형 분류와 분기 실적 계정 선택', () => {
  assert.equal(classifyDisclosure('단일판매ㆍ공급계약체결').kind, 'contract');
  assert.equal(classifyDisclosure('연결재무제표기준영업(잠정)실적(공정공시)').kind, 'earnings');
  assert.equal(classifyDisclosure('임원ㆍ주요주주특정증권등소유상황보고서').kind, 'other');
  const picked = pickAccounts([
    { fs_div: 'CFS', sj_div: 'IS', account_nm: '매출액', thstrm_amount: '200', frmtrm_amount: '100', thstrm_add_amount: '350', frmtrm_add_amount: '180' },
    { fs_div: 'CFS', sj_div: 'IS', account_nm: '영업이익', thstrm_amount: '20', frmtrm_amount: '-', thstrm_add_amount: '30' },
    { fs_div: 'OFS', sj_div: 'IS', account_nm: '매출액', thstrm_amount: '1', frmtrm_amount: '1' }]);
  assert.equal(picked.basis, '연결');
  assert.equal(picked.accounts.revenue.current, 200);
  assert.equal(picked.accounts.revenue.cumulative, 350);
  assert.equal(picked.accounts.operatingIncome.previous, null);
  assert.equal(candidatePeriods(new Date('2026-11-05'))[0].reprt_code, '11014');
});
