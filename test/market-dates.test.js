import test from 'node:test';
import assert from 'node:assert/strict';
import { candleDay } from '../lib/market.js';

// 2026-11-17 교차 검증: 환율 일봉(KRW=X)은 런던 자정에 찍힌다. 서머타임에는 23:00Z 라 UTC 날짜로 붙이면 하루 앞이 된다.
test('일봉 날짜는 거래소 현지 날짜: 서머타임의 환율 일봉도 런던 날짜', () => {
  const ts = iso => Date.parse(iso) / 1000;
  assert.equal(candleDay(ts('2026-07-01T23:00:00Z'), 'Europe/London'), '2026-07-02'); // 런던 7월 2일 0시
  assert.equal(candleDay(ts('2026-11-16T00:00:00Z'), 'Europe/London'), '2026-11-16'); // 겨울(GMT)은 그대로
  assert.equal(candleDay(ts('2026-07-01T13:30:00Z'), 'America/New_York'), '2026-07-01'); // 미국 일봉은 바뀌지 않음
  assert.equal(candleDay(ts('2026-07-01T00:00:00Z'), 'Asia/Seoul'), '2026-07-01');       // 한국 일봉(09:00 KST)도 그대로
  assert.equal(candleDay(ts('2026-07-01T23:00:00Z')), '2026-07-01');                    // 시간대가 없으면 예전처럼 UTC
  assert.equal(candleDay(ts('2026-07-01T23:00:00Z'), 'Not/AZone'), '2026-07-01');        // 모르는 시간대도 UTC
});
