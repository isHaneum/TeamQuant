// 결정 62: 가상 모의계좌 — 체결가·비용·환전·현금 한도·대기 주문의 다음 시가 체결·평가·규칙 점검·가져오기 검사. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, fill, place, processQueue, valuation, decide, checkDue, recordCheck, planFromDoc, validateAccount, execPrice, quoteUsable, sessionState, sessionAfter, COSTS, kindOf, mark } from '../lib/virtual-account.js';

const T = iso => Date.parse(iso);
const KR_OPEN = T('2026-11-24T02:00:00Z'), KR_CLOSED = T('2026-11-24T08:00:00Z'), US_OPEN = T('2026-11-24T15:00:00Z'); // 11:00 KST · 17:00 KST · 10:00 ET
const q = (price, at, extra = {}) => ({ price, status: 'OPEN', at: new Date(at).toISOString(), delayMin: 0, ...extra });

test('장 시간: 국내 09:00~15:30 KST · 미국 09:30~16:00 ET · 주말 · 장 시작 전이면 그날 시가로', () => {
  assert.equal(sessionState(new Date(KR_OPEN), 'KR').open, true); assert.equal(sessionState(new Date(KR_CLOSED), 'KR').open, false); assert.equal(sessionState(new Date(US_OPEN), 'US').open, true);
  assert.equal(sessionState(new Date('2026-11-28T03:00:00Z'), 'KR').open, false, '토요일');
  assert.deepEqual(sessionAfter('2026-11-23T23:00:00Z', 'KR'), { date: '2026-11-24', inclusive: true }, '08:00 KST 주문 → 그날 시가');
  assert.deepEqual(sessionAfter(new Date(KR_CLOSED).toISOString(), 'KR'), { date: '2026-11-24', inclusive: false }, '17:00 KST 주문 → 다음 거래일');
});

test('체결가: 호가 차이 절반 + 충격만큼 불리하게 · 호가 단위로 불리한 쪽 · ETF 와 주식 구분', () => {
  assert.equal(execPrice(100000, 'BUY', 'KR', 'stock'), 100100, '10만 원 · 7bp → 100,070 → 100원 단위 올림'); assert.equal(execPrice(100000, 'SELL', 'KR', 'stock'), 99900);
  assert.equal(execPrice(700, 'BUY', 'US', 'etf'), 700.28); assert.equal(execPrice(700, 'SELL', 'US', 'etf'), 699.72);
  assert.equal(kindOf('SPY'), 'etf'); assert.equal(kindOf('069500', 'KODEX 200'), 'etf'); assert.equal(kindOf('005930', '삼성전자'), 'stock');
});

test('현재가 쓸 수 있나: 장중 표시 · 3분 안(지연 분 더함) · 정규장 안', () => {
  assert.equal(quoteUsable(q(100, KR_OPEN - 60e3), KR_OPEN, 'KR').ok, true);
  assert.match(quoteUsable(q(100, KR_OPEN - 600e3), KR_OPEN, 'KR').why, /10분 전/);
  assert.match(quoteUsable(q(100, KR_OPEN - 60e3, { delayMin: 15 }), KR_OPEN, 'KR').why, /지연 시세/, '결정 64: 지연 시세로는 바로 체결하지 않음');
  const op = T('2026-11-24T00:05:00Z'); assert.equal(quoteUsable(q(100, op - 30e3), op, 'KR').atOpen, true, '국내 개장 10분 안');
  assert.ok(execPrice(100000, 'BUY', 'KR', 'stock', { atOpen: true }) > execPrice(100000, 'BUY', 'KR', 'stock'), '개장 직후는 호가 차이 넓게');
  assert.equal(quoteUsable(q(100, KR_CLOSED, { status: 'CLOSE' }), KR_CLOSED, 'KR').ok, false);
});

test('국내 주식 매수·매도: 수수료 · 매도 거래세 0.20% · 원가 · 실현손익 · 현금 한도', () => {
  const a = createAccount({ startKrw: 1_000_000, now: KR_OPEN });
  const b = fill(a, { symbol: '005930', name: '삼성전자', side: 'BUY', qty: 5 }, { price: 100000, at: 'x', source: '현재가' });
  assert.equal(b.qty, 5); assert.equal(b.price, 100100); assert.ok(Math.abs(a.cashKrw - (1_000_000 - 5 * 100100 * (1 + COSTS.KR.commission))) < 1e-6);
  const s = fill(a, { symbol: '005930', name: '삼성전자', side: 'SELL', qty: 10 }, { price: 110000, at: 'y', source: '현재가' });
  assert.equal(s.qty, 5, '보유 수량까지만'); const gross = 5 * s.price; assert.equal(s.price, 109900); assert.ok(Math.abs(s.taxKrw - gross * 0.002) < 1e-6); assert.ok(s.realizedKrw > 0); assert.equal(a.positions['005930'], undefined);
  const big = fill(a, { symbol: '005930', name: '삼성전자', side: 'BUY', qty: 100 }, { price: 100000, at: 'z', source: '현재가' }); assert.ok(big.qty < 100 && big.note); assert.ok(a.cashKrw >= 0);
});

test('미국 종목: 원화 자동 환전(환율 ± 0.25%) · SEC 수수료 · 환율 없으면 체결 안 함', () => {
  const a = createAccount({ startKrw: 10_000_000, now: US_OPEN });
  assert.equal(fill(a, { symbol: 'SPY', name: 'SPY', side: 'BUY', qty: 1 }, { price: 700, fx: null }).status, 'unfilled');
  const b = fill(a, { symbol: 'SPY', name: 'SPY', side: 'BUY', qty: 2 }, { price: 700, fx: 1400, at: 'x', source: '현재가' });
  const krw = 2 * 700.28 * (1 + COSTS.US.commission) * 1400 * (1 + COSTS.fxSpread); assert.ok(Math.abs(b.amountKrw - krw) < 1e-6); assert.ok(a.fxCostKrw > 0);
  const s = fill(a, { symbol: 'SPY', name: 'SPY', side: 'SELL', qty: 2 }, { price: 700, fx: 1400, at: 'y', source: '현재가' }); assert.ok(Math.abs(s.taxKrw - 2 * s.price * COSTS.US.secFee * 1400 * (1 - COSTS.fxSpread)) < 1e-6); assert.ok(s.realizedKrw < 0, '같은 가격에 사고팔면 비용만큼 손해');
});

test('주문: 장중·현재가 있으면 바로 체결(매도 먼저) · 장 밖이면 대기 → 다음 세션 시가로 체결(화면을 안 본 동안 열린 장)', () => {
  const a = createAccount({ startKrw: 5_000_000, now: KR_CLOSED });
  const out = place(a, [{ symbol: '069500', name: 'KODEX 200', side: 'BUY', qty: 10 }, { symbol: 'SPY', name: 'SPY', side: 'BUY', qty: 1 }], { quotes: { '069500': q(40000, KR_CLOSED, { status: 'CLOSE' }) }, fx: 1400, now: KR_CLOSED });
  assert.ok(out.every(o => o.status === 'queued'));
  const candles = { '069500': [{ date: '2026-11-24', open: 39000, close: 39500 }, { date: '2026-11-25', open: 40500, close: 41000 }], SPY: [{ date: '2026-11-24', open: 701, close: 705 }] };
  const fx = [{ date: '2026-11-24', open: 1401, close: 1402 }];
  const before = processQueue(a, { candles, fxCandles: fx, now: T('2026-11-24T23:30:00Z') }); // 11-25 08:30 KST · 국내 장 시작 전 · 미국 11-24 세션은 이미 열림?
  // SPY 는 11-24 17:00 KST(= 11-24 03:00 ET, 장 시작 전) 주문 → 11-24 ET 세션 시가 701 로 체결
  assert.deepEqual(before.map(o => [o.symbol, o.fill.source]), [['SPY', '2026-11-24 시가']]);
  assert.equal(a.orders.find(o => o.symbol === '069500').status, 'queued', '국내 다음 세션(11-25)은 아직 시작 전');
  const after = processQueue(a, { candles, fxCandles: fx, now: T('2026-11-25T00:10:00Z') });
  assert.equal(after[0].fill.source, '2026-11-25 시가'); assert.equal(after[0].fill.ref, 40500);
  const live = createAccount({ startKrw: 5_000_000, now: KR_OPEN }); const r = place(live, [{ symbol: '069500', name: 'KODEX 200', side: 'BUY', qty: 3 }], { quotes: { '069500': q(40000, KR_OPEN - 30e3) }, now: KR_OPEN });
  assert.equal(r[0].status, 'filled'); assert.equal(r[0].fill.source, '현재가');
});

test('평가 · 하루 평가점 · 점검 주기(첫 운용 → 그 주 첫 점검)', () => {
  const a = createAccount({ startKrw: 2_000_000, now: KR_OPEN }); fill(a, { symbol: '069500', name: 'KODEX 200', side: 'BUY', qty: 10 }, { price: 40000 });
  const v = valuation(a, { prices: { '069500': 42000 } }); assert.ok(v.complete && v.totalKrw > 2_000_000 && v.rows[0].pnlKrw > 0);
  mark(a, v.totalKrw, KR_OPEN); mark(a, v.totalKrw + 1, KR_OPEN + 3600e3); assert.equal(a.marks.length, 1, '같은 날은 덮어씀');
  assert.equal(checkDue(a, KR_OPEN).why, '처음 시작'); recordCheck(a, { now: KR_OPEN, why: '처음 시작' }); // 2026-11-26 화면 글자: 첫 운용 → 처음 시작
  assert.equal(checkDue(a, KR_OPEN + 864e5).due, false, '같은 주'); assert.equal(checkDue(a, KR_OPEN + 7 * 864e5).due, true, '다음 주');
});

test('점검(팀 모의계좌와 같은 규칙 엔진): 계획 비중만큼 사는 주문을 수량으로 · 시세 없는 종목은 빠짐 · 정리 종목은 전량', () => {
  const series = (base, amp) => Array.from({ length: 300 }, (_, i) => { const d = new Date(Date.UTC(2025, 8, 1) + i * 864e5).toISOString().slice(0, 10); const c = base * (1 + amp * Math.sin(i / 7) + 0.0004 * i); return { date: d, open: c, close: c }; });
  const plan = planFromDoc({ weights: { SPY: { pct: 40, name: 'SPY', currency: 'USD', role: 'core', sector: 'index' }, '069500': { pct: 30, name: 'KODEX 200', currency: 'KRW', role: 'core', sector: 'index' }, NOPE: { pct: 10, name: '없음', currency: 'USD' }, OLD: { pct: 0, name: '정리', currency: 'USD', exit: true } } });
  assert.ok(plan.SPY.capExempt && plan.OLD.exit && plan.OLD.pct === 0);
  const a = createAccount({ startKrw: 100_000_000, now: US_OPEN });
  const d = decide(a, { plan, candlesBySymbol: { SPY: series(700, 0.01), '069500': series(40000, 0.01) }, fxCandles: series(1400, 0.002), prices: { SPY: 700, '069500': 40000 }, fx: 1400, now: US_OPEN });
  assert.deepEqual(d.missing.sort(), ['NOPE', 'OLD']); const spy = d.orders.find(o => o.symbol === 'SPY'), kr = d.orders.find(o => o.symbol === '069500');
  assert.ok(spy && spy.side === 'BUY' && spy.qty >= 30 && spy.qty <= 45, JSON.stringify(d)); assert.ok(kr && kr.qty >= 600 && kr.qty <= 800, JSON.stringify(kr));
});

test('가져오기 검사: 버전·숫자·보유 형식이 맞는 것만', () => {
  const a = createAccount({ startKrw: 1_000_000 }); assert.doesNotThrow(() => validateAccount(JSON.parse(JSON.stringify(a))));
  assert.throws(() => validateAccount({ ...a, version: 'X' }), /버전/); assert.throws(() => validateAccount({ ...a, positions: { '<img>': { qty: 1, costKrw: 1 } } }), /보유/);
  assert.throws(() => createAccount({ startKrw: 10 }), /시작 자금/);
});

test('결정 63: 가져오기 파일 검사 — HTML 이 든 수량 · 숫자 createdAt · 이상한 상태는 거부 · 정상 장부(체결 포함)는 통과', () => {
  const a = createAccount({ startKrw: 5_000_000, now: KR_OPEN }); place(a, [{ symbol: '069500', name: 'KODEX 200', side: 'BUY', qty: 3 }], { quotes: { '069500': q(40000, KR_OPEN - 30e3) }, now: KR_OPEN });
  const ok = JSON.parse(JSON.stringify(a)); assert.doesNotThrow(() => validateAccount(ok));
  assert.throws(() => validateAccount({ ...ok, orders: [{ ...ok.orders[0], qty: "<meta http-equiv=refresh content='0;url=https://x'>" }] }), /주문/);
  assert.throws(() => validateAccount({ ...ok, createdAt: 1 }), /기본 값/);
  assert.throws(() => validateAccount({ ...ok, orders: [{ ...ok.orders[0], status: '<b>' }] }), /주문/);
  assert.throws(() => validateAccount({ ...ok, orders: [null] }), /주문/);
  assert.throws(() => validateAccount({ ...ok, orders: [{ ...ok.orders[0], fill: { ...ok.orders[0].fill, qty: '<i>' } }] }), /체결/);
});
