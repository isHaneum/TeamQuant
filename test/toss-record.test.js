// 토스 실계좌 읽기 전용 기록(결정 24): ① 래퍼는 조회만(주문 함수 없음) · 토스 환율 우선 · 미국 보유+환율 없음 → total null · 체결만 골라 ref 로
// ② 현금을 모르는 계좌는 보유 기준 시간가중 지수(index)로 비교 — 적립 입금·추가 매수는 수익이 아니다 ③ 환율이 없으면 보류(fail-closed). 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTossRecordReader } from '../lib/toss-record-reader.js';
import { createRealRecord } from '../lib/real-record.js';
import { createLedgerStore } from '../lib/paper-live.js';
import { compare } from '../lib/paper-benchmark.js';

const pos = (symbol, currency, quantity, price) => ({ symbol, name: symbol, currency, quantity, price, value: quantity * price, avgCost: price });
function fakeToss(state) {
  const read = async () => ({ positions: state.positions.map(p => ({ ...p })), fx: state.rate ? { midRate: state.rate } : null, cashKnown: false, fetchedAt: '2026-11-12T06:00:00.000Z' });
  read.orders = async q => { state.queries.push(q); return { orders: state.orders || [] }; };
  return read;
}
function flat(close) { const out = []; for (let t = Date.parse('2025-11-01'); t <= Date.parse('2026-11-30'); t += 864e5) out.push({ date: new Date(t).toISOString().slice(0, 10), open: close, close }); return out; }
const readMarket = async s => ({ candles: flat(s === 'KRW=X' ? 1300 : 100) });

test('① 래퍼: 조회만 · 토스 환율 우선 · 미국 보유인데 환율이 없으면 total null · 체결 수량이 있는 주문만 ref 로 · 부분 체결 표시', async () => {
  const st = { positions: [pos('AAPL', 'USD', 10, 100), pos('005930', 'KRW', 10, 70000)], rate: 1400, queries: [], orders: [
    { ref: 'a'.repeat(64), symbol: 'AAPL', side: 'BUY', currency: 'USD', quantity: 5, execution: { filledQuantity: 5, averageFilledPrice: 99.5 } },
    { ref: 'b'.repeat(64), symbol: '005930', side: 'SELL', currency: 'KRW', quantity: 10, execution: { filledQuantity: 4, averageFilledPrice: 70100 } },
    { ref: 'c'.repeat(64), symbol: 'MSFT', side: 'BUY', currency: 'USD', quantity: 1, execution: { filledQuantity: 0, averageFilledPrice: null } }] };
  const r = createTossRecordReader({ read: fakeToss(st) });
  assert.equal(r.settings().readOnly, true); assert.equal(r.settings().ledgerKey, 'toss'); assert.equal(typeof r.place, 'undefined'); assert.equal(typeof r.cancel, 'undefined');
  const b = await r.balance({ fx: 1300 }); assert.equal(b.fx, 1400, '토스 매매기준율이 먼저'); assert.equal(b.total, 10 * 100 * 1400 + 700000); assert.equal(b.cashKnown, false); assert.equal(b.cash, 0);
  assert.equal(b.positions.find(p => p.symbol === 'AAPL').valueKrw, 1400000); assert.equal(b.positions.find(p => p.symbol === 'AAPL').market, 'US');
  st.rate = null; assert.equal((await r.balance({ fx: 1300 })).fx, 1300, '토스 환율이 없으면 넘긴 환율'); assert.equal((await r.balance({})).total, null, '둘 다 없으면 total null');
  const o = await r.orders('20261112'); assert.deepEqual(st.queries.at(-1), { status: 'CLOSED', from: '2026-11-12', to: '2026-11-12' });
  assert.deepEqual(o.map(x => [x.code, x.market, x.status, x.filled]), [['AAPL', 'US', 'filled', 5], ['005930', 'KR', 'partial', 4]]); assert.ok(o.every(x => /^[ab]{64}$/.test(x.odno)));
  await assert.rejects(() => r.orders('2026-11-12'), /YYYYMMDD/);
});

test('② 기록: 적립 입금(같은 가격에 추가 매수)은 수익이 아니다 · 가격 변화만 보유 기준 시간가중 지수에 들어가 지수 대비에 쓰인다 · 장부는 real-toss.json', async () => {
  let t = Date.parse('2026-11-10T06:00:00Z'); const dir = mkdtempSync(join(tmpdir(), 'tq-toss-'));
  const st = { positions: [pos('AAPL', 'USD', 10, 100), pos('005930', 'KRW', 1, 1_000_000)], rate: 1300, queries: [] };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: createLedgerStore(dir, { prefix: 'real' }), readMarket, now: () => t });
  const s1 = await rec.status(); assert.equal(s1.label, '토스'); assert.equal(s1.source, 'toss'); assert.equal(s1.balance.cashKnown, false); assert.equal(s1.balance.total, 2_300_000);
  assert.equal(s1.marks.at(-1).index, 1); assert.ok(existsSync(join(dir, 'real-toss.json')));
  const w = s1.baseline.benchmark.weights; assert.equal(w.US, 56.5); assert.equal(w.KR, 43.5); assert.equal(w.cash, 0);
  t += 864e5; st.positions[0] = pos('AAPL', 'USD', 20, 100); // 입금해 같은 가격에 10주 더 삼
  const s2 = await rec.status(); assert.equal(s2.balance.total, 3_600_000); assert.equal(s2.marks.at(-1).index, 1, '추가 매수는 수익이 아니다');
  t += 864e5; st.positions[0] = pos('AAPL', 'USD', 20, 110); // 가격 +10%
  const s3 = await rec.status(); const idx = (20 * 110 * 1300 + 1_000_000) / (20 * 100 * 1300 + 1_000_000);
  assert.ok(Math.abs(s3.marks.at(-1).index - idx) < 1e-7, `${s3.marks.at(-1).index} vs ${idx}`);
  assert.equal(s3.benchmark.basis, 'twr'); assert.equal(s3.benchmark.ownRetPct, Math.round((idx - 1) * 1e4) / 100); assert.equal(s3.benchmark.benchRetPct, 0); assert.equal(s3.chainCheck.ok, true);
  assert.ok((3_860_000 / 2_300_000 - 1) * 100 > 60, '총자산 비율로 쟀다면 +67% 로 부풀었을 것');
  // 같은 날 다시 조회해도 지수는 전날 기준으로 다시 계산(같은 날 교체)
  const s3b = await rec.status(); assert.equal(s3b.marks.length, 3); assert.ok(Math.abs(s3b.marks.at(-1).index - idx) < 1e-7);
});

test('② 비교: 평가점에 index 가 없으면(모의·한투) 예전처럼 총자산 비율 · 둘 다 있으면 index 비율', () => {
  const series = [{ date: '2026-11-10', value: 1 }, { date: '2026-11-11', value: 1.02 }];
  const a = compare({ marks: [{ date: '2026-11-10', total: 100 }, { date: '2026-11-11', total: 110 }], series }); assert.equal(a.ownRetPct, 10); assert.equal(a.basis, 'total');
  const b = compare({ marks: [{ date: '2026-11-10', total: 100, index: 1 }, { date: '2026-11-11', total: 150, index: 1.01 }], series }); assert.equal(b.ownRetPct, 1); assert.equal(b.diffPp, -1); assert.equal(b.basis, 'twr');
});

test('③ 보류: 미국 보유가 있는데 토스·Yahoo 환율이 모두 없으면 평가점·봉인·기준선을 만들지 않는다', async () => {
  const t = Date.parse('2026-11-10T06:00:00Z'), st = { positions: [pos('AAPL', 'USD', 10, 100)], rate: null, queries: [] };
  const noFx = async s => { if (s === 'KRW=X') throw new Error('환율 장애'); return readMarket(s); };
  const rec = createRealRecord({ reader: createTossRecordReader({ read: fakeToss(st) }), store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-toss-')), { prefix: 'real' }), readMarket: noFx, now: () => t });
  const s = await rec.status(); assert.equal(s.markStale, true); assert.equal(s.staleReason, 'fx_missing'); assert.equal(s.marks.length, 0); assert.equal(s.chain.length, 0); assert.equal(s.baseline, null);
});
