// 결정 52: IPO 사건 메모 — 공모액 $2.5B 이상만 · note 등급 · 락업 추정 · 네트워크 실패 시 기존 파일 유지. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventsFromCalendar, refreshIpoEvents, MIN_USD_M } from '../scripts/ipo-events.mjs';

const cal = { priced: { rows: [
  { dealID: '1', proposedTickerSymbol: 'BIG', companyName: 'Big Co', proposedExchange: 'NASDAQ Global Select', proposedSharePrice: '83.00', sharesOffered: '980,000,000', pricedDate: '11/19/2026', dollarValueOfSharesOffered: '$81,340,000,000', dealStatus: 'Priced' },
  { dealID: '2', proposedTickerSymbol: 'SML', companyName: 'Small Co', proposedSharePrice: '17.00', pricedDate: '11/13/2026', dollarValueOfSharesOffered: '$174,999,989', dealStatus: 'Priced' }] },
  upcoming: { rows: [{ dealID: '3', proposedTickerSymbol: 'UPC', companyName: 'Up Co', expectedPriceDate: '12/02/2026', dollarValueOfSharesOffered: '$3,000,000,000' }] } };

test('공모액 $2.5B 이상만 · note 등급 · 날짜·락업(+180일 추정) · 예정 건도', () => {
  const ev = eventsFromCalendar(cal, { month: '2026-11' });
  assert.equal(ev.length, 2); assert.ok(ev.every(e => e.level === 'note' && e.type === 'ipo_event' && e.sizeUsdM >= MIN_USD_M));
  const big = ev.find(e => e.ticker === 'BIG'); assert.equal(big.date, '2026-11-19'); assert.equal(big.lockupDate, '2027-05-18'); assert.equal(big.sizeUsdM, 81340); assert.match(big.rule, /NOTE_ONLY/);
  const up = ev.find(e => e.ticker === 'UPC'); assert.equal(up.status, 'upcoming'); assert.equal(up.date, '2026-12-02');
});

test('갱신: 세 달을 읽어 합치고(같은 id 는 덧씀) · 전부 실패하면 기존 파일을 지키고 errors 에 적는다', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'tq-ipo-')), 'ipo-events.json');
  const now = new Date('2026-11-22T09:00:00Z');
  const o = await refreshIpoEvents({ now, path, fetchMonthImpl: async ym => (ym === '2026-11' ? cal : { priced: { rows: [] } }) });
  assert.equal(o.monthsRead, 3); assert.equal(o.events.length, 2); assert.equal(o.events[0].ticker, 'UPC', '최근 날짜 먼저');
  const o2 = await refreshIpoEvents({ now, path, fetchMonthImpl: async () => { throw new Error('403'); } });
  assert.equal(o2.monthsRead, 0); assert.equal(o2.errors.length, 3); assert.equal(o2.events.length, 2, '기존 메모 유지');
});
