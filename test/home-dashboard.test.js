import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetTimeline, monthEnds, closeOn, fillsFrom } from '../lib/asset-timeline.js';
import { reviewTrades } from '../lib/trade-review.js';
import { marketReasons, themesOf } from '../lib/market-reasons.js';

// 합성 자료만 사용한다.
const order = (symbol, side, quantity, price, filledAt, currency = 'KRW') => ({ symbol, side, currency, orderedAt: filledAt, execution: { filledQuantity: quantity, averageFilledPrice: price, filledAmount: quantity * price, commission: 0, tax: 0, filledAt } });
const candles = (rows) => rows.map(([date, close]) => ({ date, close }));

test('monthEnds는 지난 월말들과 오늘을 돌려준다', () => {
  assert.deepEqual(monthEnds('2026-03-15', 4), ['2025-12-31', '2026-01-31', '2026-02-28', '2026-03-15']);
});

test('closeOn은 그 날 또는 직전 거래일 종가를 쓴다', () => {
  const c = candles([['2026-01-02', 10], ['2026-01-05', 11]]);
  assert.equal(closeOn(c, '2026-01-04'), 10);
  assert.equal(closeOn(c, '2026-01-01'), null);
});

test('체결을 되돌려 월말 보유 수량과 원금을 복원한다', () => {
  // 1월 10일 10주 @100 매수, 2월 10일 5주 @120 추가 매수, 3월 5일 3주 @130 매도 → 현재 12주
  const orders = [order('AAA', 'BUY', 10, 100, '2026-01-10T01:00:00Z'), order('AAA', 'BUY', 5, 120, '2026-02-10T01:00:00Z'), order('AAA', 'SELL', 3, 130, '2026-03-05T01:00:00Z')];
  const positions = [{ symbol: 'AAA', currency: 'KRW', quantity: 12, cost: 1300, value: 12 * 140 }];
  const c = { AAA: candles([['2026-01-30', 105], ['2026-02-27', 125], ['2026-03-13', 140]]) };
  const t = buildAssetTimeline({ positions, orders, candlesBySymbol: c, today: '2026-03-15', months: 4, coverageFrom: '2025-12-01' });
  const [dec, jan, feb, now] = t.points;
  assert.equal(dec.value, 0); // 12월 말엔 보유 없음
  assert.equal(jan.value, 10 * 105);
  assert.equal(feb.value, 15 * 125);
  assert.equal(now.value, 12 * 140);
  // 원금: 지금 1300 → 3월 매도(390) 되돌리면 1690, 2월 매수(600) 되돌리면 1090, 1월 매수(1000) 되돌리면 90
  assert.equal(feb.principal, 1690);
  assert.equal(jan.principal, 1090);
  // 기간 손익 = 마지막(1680-1300) - 처음(0-90) = 470
  assert.equal(t.periodGain, 470);
});

test('조회 범위 밖이나 수량이 안 맞는 달은 비워 둔다', () => {
  const positions = [{ symbol: 'AAA', currency: 'KRW', quantity: 1, cost: 100, value: 100 }];
  const orders = [order('AAA', 'SELL', 5, 100, '2026-02-10T01:00:00Z')];
  const c = { AAA: candles([['2026-01-30', 100]]) };
  const t = buildAssetTimeline({ positions, orders, candlesBySymbol: c, today: '2026-03-15', months: 3, coverageFrom: '2026-02-01' });
  assert.equal(t.points[0].value, null); // 1월 말: 조회 범위(2/1) 밖
  assert.match(t.points[0].reason, /범위 밖/);
  const t2 = buildAssetTimeline({ positions, orders: [order('AAA', 'BUY', 5, 100, '2026-02-10T01:00:00Z')], candlesBySymbol: c, today: '2026-03-15', months: 3 });
  assert.equal(t2.points[0].value, null); // 1 - 5 = 음수 수량
  assert.ok(t2.warnings.length);
});

test('달러 종목은 그 날 환율로 원화 환산한다', () => {
  const positions = [{ symbol: 'USX', currency: 'USD', quantity: 2, cost: 20, value: 30 }];
  const t = buildAssetTimeline({ positions, orders: [], candlesBySymbol: { USX: candles([['2026-02-27', 12]]) }, fxCandles: candles([['2026-02-27', 1400]]), fxNow: 1500, today: '2026-03-15', months: 2 });
  assert.equal(t.points[0].value, 2 * 12 * 1400);
  assert.equal(t.points[1].value, 30 * 1500);
});

test('매매 성적표: 지수보다 많이 오른 매수는 잘 산 매수, 판 뒤 오른 매도는 아쉬운 매도', () => {
  const orders = [order('AAA', 'BUY', 1, 100, '2026-01-05T01:00:00Z'), order('BBB', 'SELL', 1, 100, '2026-01-05T01:00:00Z')];
  const idx = { name: '코스피', candles: candles([['2026-01-05', 1000], ['2026-03-13', 1050]]) };
  const r = reviewTrades(orders, { candlesBySymbol: { AAA: candles([['2026-03-13', 130]]), BBB: candles([['2026-03-13', 140]]) }, indexFor: () => idx, today: '2026-03-15' });
  assert.equal(r.buys.edge, 25); // 30% - 5%
  assert.equal(r.buys.grade, 'good');
  assert.equal(r.sells.edge, -35); // 판 뒤 40% 올랐고 시장은 5%
  assert.equal(r.sells.grade, 'bad');
  assert.equal(r.regret.symbol, 'BBB');
  assert.equal(fillsFrom(orders).length, 2);
});

test('최근 며칠 안의 체결은 평가를 보류한다', () => {
  const r = reviewTrades([order('AAA', 'BUY', 1, 100, '2026-03-14T01:00:00Z')], { candlesBySymbol: { AAA: candles([['2026-03-13', 100]]) }, today: '2026-03-15' });
  assert.equal(r.pending, 1);
  assert.equal(r.available, false);
});

test('시장 이유는 지수 기사에서 실제로 나온 주제만 센다', () => {
  const now = Date.parse('2026-11-05T09:00:00Z');
  const items = [
    { title: '민주당 상원 장악에 코스피 급락 마감', description: '금리 인하 기대 후퇴, 외국인 순매도', link: 'https://a.example/1', publishedAt: '2026-11-05T07:00:00Z' },
    { title: '코스피, 반도체 약세에 하락', description: '', link: 'https://a.example/2', publishedAt: '2026-11-05T06:00:00Z' },
    { title: '오늘의 날씨', description: '선거', link: 'https://a.example/3', publishedAt: '2026-11-05T06:00:00Z' },
    { title: '코스피 상승 마감', description: '', link: 'https://a.example/4', publishedAt: '2026-11-01T06:00:00Z' }
  ];
  const r = marketReasons(items, { scope: 'KR', now, direction: -1 });
  assert.equal(r.articles.length, 2); // 날씨 기사·오래된 기사 제외
  assert.equal(r.articles[0].link, 'https://a.example/1');
  assert.deepEqual(r.themes.map(t => t.label).slice(0, 1), ['정치·선거']);
  assert.match(r.summary, /정치·선거/);
  assert.deepEqual(themesOf('오늘의 날씨'), []);
});
