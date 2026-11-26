// 홈 '지수 대비 수익률'·'내 종목 소식' 계산(lib/index-compare.js)과 규칙 화면 지수 선(lib/report-card.js alignedIndex).
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthsAgo, indexCompare, pickNews } from '../lib/index-compare.js';
import { alignedIndex } from '../lib/report-card.js';

const c = (date, close) => ({ date, close });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('monthsAgo: n개월 전 같은 날 · 그 달에 없는 날이면 마지막 날', () => {
  assert.equal(monthsAgo('2026-11-26', 1), '2026-10-26');
  assert.equal(monthsAgo('2026-11-26', 3), '2026-08-26');
  assert.equal(monthsAgo('2026-03-31', 1), '2026-02-28');
  assert.equal(monthsAgo('2026-01-15', 6), '2025-07-15');
});

test('indexCompare: 시작 = 100 · 휴장일은 직전 종가 · S&P500은 원화(지수 × 달러 환율)', () => {
  const points = [{ date: '2026-11-02', own: 200 }, { date: '2026-11-03', own: 210 }, { date: '2026-11-04', own: 220 }];
  const spx = [c('2026-11-02', 100), c('2026-11-04', 110)]; // 11-03 휴장 → 11-02 종가
  const fx = [c('2026-11-02', 1000), c('2026-11-03', 1010), c('2026-11-04', 1000)];
  const kospi = [c('2026-11-02', 50), c('2026-11-03', 55), c('2026-11-04', 60)];
  const r = indexCompare({ points, spx, kospi, fx });
  assert.equal(r.from, '2026-11-02'); assert.equal(r.to, '2026-11-04');
  r.line.forEach((x, i) => near(x.own, [100, 105, 110][i], `내 계좌 선 ${i}`));
  near(r.line[1].spx, 101, '휴장일 S&P500 = 직전 종가 × 그날 환율');
  near(r.line[2].spx, 110, '11-04 S&P500 원화 기준');
  near(r.own, 10, '내 계좌 +10%'); near(r.spx, 10, 'S&P500 +10%'); near(r.kospi, 20, '코스피 +20%');
  near(r.vsSpx, 0, 'S&P500 대비'); near(r.vsKospi, -10, '코스피 대비');
});

test('indexCompare: 자료가 모자라거나 오래되면 그 선만 null · 점이 2개 미만이면 null', () => {
  const points = [{ date: '2026-11-20', own: 1 }, { date: '2026-11-25', own: 1.1 }];
  const stale = [c('2026-11-10', 100), c('2026-11-12', 101)]; // 마지막 봉이 7일 넘게 오래됨
  const r = indexCompare({ points, spx: stale, kospi: [], fx: stale });
  assert.equal(r.spx, null); assert.equal(r.kospi, null); assert.equal(r.vsSpx, null);
  assert.ok(r.line.every(x => x.spx === null && x.kospi === null)); near(r.own, 10, '내 계좌 선은 남는다');
  const noBase = indexCompare({ points, kospi: [c('2026-11-24', 10), c('2026-11-25', 11)] });
  assert.equal(noBase.kospi, null, '시작일에 지수 값이 없으면 null');
  assert.equal(indexCompare({ points: [points[0]] }), null);
  assert.equal(indexCompare({ points: [{ date: '2026-11-20', own: 0 }, { date: '2026-11-21', own: -1 }] }), null);
});

test('indexCompare usLag: 한국 날짜로 찍은 평가점이면 미국은 전날까지의 마지막 종가', () => {
  const points = [{ date: '2026-11-03', own: 100 }, { date: '2026-11-04', own: 100 }];
  const spx = [c('2026-11-02', 100), c('2026-11-03', 120), c('2026-11-04', 150)];
  const fx = [c('2026-11-02', 1), c('2026-11-03', 1), c('2026-11-04', 1)];
  near(indexCompare({ points, spx, fx }).spx, 25, '같은 날 종가(150/120)');
  near(indexCompare({ points, spx, fx, usLag: true }).spx, 20, '전날 종가(120/100)');
});

test('pickNews: 공시 > 큰 움직임 > 오늘 기사 2건 이상 · 최대 3개 · 원인을 단정하는 말 없음', () => {
  const today = '2026-11-26', at = '2026-11-26T01:00:00Z';
  const positions = ['A', 'B', 'C', 'D', 'E'].map(s => ({ symbol: s, name: `종목${s}` }));
  const briefs = new Map([
    ['A', { available: true, asOf: today, price: { dayReturn: 1, moveRatio: 1 }, allNews: [{ publishedAt: at, title: 'a1', link: 'https://x/1' }, { publishedAt: at, title: 'a2', link: 'https://x/2' }] }],
    ['B', { available: true, asOf: today, price: { dayReturn: -5, moveRatio: 3, typicalMove: 1.5 } }],
    ['C', { available: true, asOf: today, price: { dayReturn: 0.2, moveRatio: 1 }, disclosures: [{ date: '2026-11-24', title: '주요사항보고서', link: 'https://d/1' }] }],
    ['D', { available: true, asOf: today, price: { dayReturn: 9, moveRatio: 1 }, disclosures: [{ date: '2026-11-10', title: '오래된 공시' }] }],
    ['E', { available: false }]
  ]);
  const r = pickNews(positions, briefs, today);
  assert.deepEqual(r.map(x => x.symbol), ['C', 'B', 'A'], '공시 → 큰 움직임 → 기사');
  assert.equal(r[0].disc.title, '주요사항보고서'); assert.equal(r[1].big, true); assert.equal(r[2].news.count, 2);
  assert.equal(pickNews(positions, briefs, today, 2).length, 2);
  assert.doesNotMatch(JSON.stringify(r), /때문|덕분|탓|영향/);
});

test('alignedIndex: 첫날 = 100 · 휴장일은 직전 종가 · fxCandles 로 원화 환산 · 첫날 값이 없으면 null', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];
  const idx = [c('2026-11-02', 200), c('2026-11-04', 220)];
  const plain = alignedIndex(dates, idx).map(x => x.value);
  near(plain[0], 100, '첫날'); near(plain[1], 100, '휴장일은 직전 종가'); near(plain[2], 110, '220/200');
  const fx = [c('2026-11-02', 1000), c('2026-11-03', 1100), c('2026-11-04', 1200)];
  const krw = alignedIndex(dates, idx, { fxCandles: fx }).map(x => x.value);
  near(krw[1], 110, '휴장일: 직전 종가 × 그날 환율'); near(krw[2], 132, '220×1200 / 200×1000');
  assert.equal(alignedIndex(['2026-11-01', ...dates], idx), null, '첫날 이전 자료가 없으면 null');
  assert.equal(alignedIndex([], idx), null);
});
