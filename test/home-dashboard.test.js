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
  // 원금 = 그때 들고 있던 주식의 원가(이동평균): 1월 말 10주 × 100 = 1000, 2월 말 1000 + 600 = 1600, 첫 매수 전 0.
  //   예전 기대값(1월 1090 · 2월 1690)은 3월 매도를 판 금액(390)으로 되더한 값이라 틀렸다(2026-11-17 교차 검증 F18).
  assert.equal(feb.principal, 1600);
  assert.equal(jan.principal, 1000);
  assert.equal(dec.principal, 0);
  // 기간 손익 = 마지막 평가 1680 − 처음 평가 0 − 그 사이 순매수(1000 + 600 − 390) = 470 (판 이익 포함)
  assert.equal(t.periodGain, 470);
});

test('이익을 보고 판 적이 있어도 그 전 달의 넣은 돈·손익은 그때 원가 기준(F18 회귀) · 기간 손익은 판 이익까지 센다', () => {
  const orders = [order('AAA', 'BUY', 100, 10000, '2026-06-10T01:00:00Z'), order('AAA', 'SELL', 50, 20000, '2026-09-10T01:00:00Z')];
  const positions = [{ symbol: 'AAA', currency: 'KRW', quantity: 50, cost: 500000, value: 1000000 }];
  const c = { AAA: candles([['2026-06-30', 12000], ['2026-07-31', 13000], ['2026-08-31', 15000], ['2026-09-30', 20000], ['2026-10-30', 20000]]) };
  const t = buildAssetTimeline({ positions, orders, candlesBySymbol: c, today: '2026-11-17', months: 7, coverageFrom: '2026-01-01' });
  const by = Object.fromEntries(t.points.map(p => [p.month, p]));
  assert.deepEqual([by['2026-05'].value, by['2026-05'].principal], [0, 0]);              // 예전: 넣은 돈 50만 · 손익 −50만
  assert.deepEqual([by['2026-06'].value, by['2026-06'].principal], [1200000, 1000000]); // 예전: 넣은 돈 150만 · 손익 −30만
  assert.deepEqual([by['2026-09'].value, by['2026-09'].principal], [1000000, 500000]);
  assert.equal(t.periodGain, 1000000);
});

test('범위 앞부터 들고 있던 종목은 지금 원가에서 거꾸로 되돌린다 · 다 판 뒤 다시 산 종목은 그 매도 전 원금을 비운다', () => {
  const c = { AAA: candles([['2026-01-30', 120], ['2026-02-27', 130], ['2026-03-13', 150]]) };
  // 범위 앞부터 30주(평균 100) → 2월 10일 10주 매도 → 지금 20주 원가 2000
  const t1 = buildAssetTimeline({ positions: [{ symbol: 'AAA', currency: 'KRW', quantity: 20, cost: 2000, value: 3000 }], orders: [order('AAA', 'SELL', 10, 140, '2026-02-10T01:00:00Z')], candlesBySymbol: c, today: '2026-03-15', months: 3 });
  assert.equal(t1.points[0].principal, 3000);
  assert.equal(t1.points[1].principal, 2000);
  // 범위 앞 10주 → 2월 10일 10주 모두 매도 → 3월 1일 5주 매수(지금 5주 원가 500): 1월 말 원가는 알 수 없음
  const t2 = buildAssetTimeline({ positions: [{ symbol: 'AAA', currency: 'KRW', quantity: 5, cost: 500, value: 750 }], orders: [order('AAA', 'SELL', 10, 140, '2026-02-10T01:00:00Z'), order('AAA', 'BUY', 5, 100, '2026-03-01T01:00:00Z')], candlesBySymbol: c, today: '2026-03-15', months: 3 });
  assert.equal(t2.points[0].principal, null);
  assert.equal(t2.points[1].principal, 0);
  assert.ok(t2.warnings.some(w => /다 판 뒤 다시 산/.test(w)));
});

test('미국 종목 원금: 산 날 환율 원금 합(costKrwNow)에서 나눈 평균 환율 · 범위 안에서 산 미국 종목은 체결일 환율', () => {
  // AA: 범위 앞부터 보유(달러 원가 100) · BB: 2월 10일 1주 $50 매수(그날 환율 1400 → 70,000원) · 지금 원화 원금 합 220,000 → AA 평균 환율 1500
  const positions = [{ symbol: 'AA', currency: 'USD', quantity: 1, cost: 100, value: 120 }, { symbol: 'BB', currency: 'USD', quantity: 1, cost: 50, value: 60 }];
  const t = buildAssetTimeline({ positions, orders: [order('BB', 'BUY', 1, 50, '2026-02-10T01:00:00Z', 'USD')], candlesBySymbol: { AA: candles([['2026-01-30', 110]]), BB: candles([['2026-01-30', 45]]) }, fxCandles: candles([['2026-01-30', 1450], ['2026-02-10', 1400]]), fxNow: 1300, today: '2026-03-15', months: 3, costKrwNow: 220000 });
  assert.equal(t.points[0].principal, 150000);
  assert.equal(t.points[1].principal, 220000);
  assert.equal(t.points.at(-1).principal, 220000);
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

test('매매 성적표: 미국 체결은 뉴욕 날짜의 지수 종가와 비교한다(F06 회귀 · 한국 날짜로는 다음 장 종가였음)', () => {
  // 2026-11-09T16:00Z = 뉴욕 11-09 11:00 = 한국 11-10 01:00. 지수: 11-09 종가 100, 11-10 종가 102, 지금 110.
  const orders = [order('USX', 'BUY', 1, 50, '2026-11-09T16:00:00Z', 'USD')];
  const idx = { name: 'S&P500', candles: candles([['2026-11-06', 98], ['2026-11-09', 100], ['2026-11-10', 102], ['2026-11-20', 110]]) };
  const r = reviewTrades(orders, { candlesBySymbol: { USX: candles([['2026-11-20', 60]]) }, indexFor: () => idx, today: '2026-11-21' });
  assert.equal(r.rows[0].market, 10);  // 110/100 − 1 (예전: 110/102 − 1 = 7.8)
  assert.equal(r.rows[0].edge, 10);    // 주식 +20% − 지수 +10%
  assert.equal(fillsFrom(orders)[0].date, '2026-11-10');
  assert.equal(fillsFrom(orders)[0].marketDate, '2026-11-09');
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
