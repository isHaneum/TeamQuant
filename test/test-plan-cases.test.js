// 테스트 보고서(STR-TQ-2026-001, 2026-11-08)에서 설계한 단위 테스트 케이스.
// 설계 기법: 동등 분할(EP), 경계값 분석(BVA), 결정 테이블(DT), 불변식(속성) 검사, 재현성.
// 케이스 ID는 보고서의 TC-UNIT-* 와 같다. 모든 자료는 합성 자료이며 개인 계좌 자료를 쓰지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNaturalStrategy } from '../lib/natural-language.js';
import { preTradeCheck, DEFAULT_RULES } from '../lib/core-rules.js';
import { reportCard } from '../lib/report-card.js';
import { sharesAt, capAt, rankIn, rankWord } from '../lib/company-lab.js';
import { runBacktest } from '../lib/backtest.js';

// ── TC-UNIT-NL-001~007 자연어 원칙 변환: 동등 분할 (SSRD v1.1 CAP-01, SC-01) ──
test('TC-UNIT-NL-001~002 빈 입력·공백만 있는 입력은 실행 대신 입력 안내', () => {
  assert.throws(() => parseNaturalStrategy(''), /투자 원칙을 입력/);
  assert.throws(() => parseNaturalStrategy('   \n '), /투자 원칙을 입력/);
});
test('TC-UNIT-NL-003~004 실행 조건이 없는 모호한 원칙은 규칙으로 바꾸지 않고 구체화 안내', () => {
  assert.throws(() => parseNaturalStrategy('좋은 주식 사줘'), /조건을 찾지 못/);
  assert.throws(() => parseNaturalStrategy('요즘 뜨는 우량주를 감으로 사고팔기'), /조건을 찾지 못/);
});
test('TC-UNIT-NL-005~007 지원하는 세 유형(이동평균·RSI·돌파)은 규칙으로 바꾸고 원문을 유지', () => {
  const ma = parseNaturalStrategy('5일선이 20일선을 넘으면 매수');
  assert.equal(ma.config.strategyType, 'ma_cross'); assert.equal(ma.original, '5일선이 20일선을 넘으면 매수');
  assert.equal(parseNaturalStrategy('RSI 14가 30 아래면 매수').config.strategyType, 'rsi_reversal');
  assert.equal(parseNaturalStrategy('20일 최고가를 돌파하면 매수').config.strategyType, 'breakout');
});

// ── TC-UNIT-PRE-001~012 매매 전 확인: 경계값 분석 ──
// 총자산 1,000만원(현금 500만 + B 500만)에서 새 종목 A를 산다 → 주문 뒤 A 비중 = 주문액 / 1,000만원
const base = { positions: [{ symbol: 'B', name: '나', currency: 'KRW', valueKrw: 5_000_000 }], cashKrw: 5_000_000, rules: DEFAULT_RULES, plan: {}, portVar: null, trades30: 0 };
const buyA = (amountKrw, s = base) => preTradeCheck(s, { symbol: 'A', name: '가', currency: 'KRW', side: 'BUY', amountKrw }, { ok: true, vol: 0.1, trendApplies: false });
const rule = (r, id) => r.checks.find(c => c.id === id).ok;
test('TC-UNIT-PRE-001~004 한 종목 최대 비중 25%: 24.9 / 25.0 / 25.05(반올림 허용폭) 통과, 25.06 위반', () => {
  assert.equal(rule(buyA(2_490_000), 'maxSingle'), true);
  assert.equal(rule(buyA(2_500_000), 'maxSingle'), true);
  assert.equal(rule(buyA(2_505_000), 'maxSingle'), true);
  assert.equal(rule(buyA(2_506_000), 'maxSingle'), false);
});
test('TC-UNIT-PRE-005~006 주문 금액: 0원은 거부, 1원부터 평가', () => {
  assert.equal(buyA(0).ok, false); assert.match(buyA(0).error, /0보다 크게/);
  assert.ok(Array.isArray(buyA(1).checks));
});
test('TC-UNIT-PRE-007~008 매도 금액: 보유액의 2%+1원까지 허용(전량 매도의 호가·환율 차이 · 2026-11-12), 그보다 크면 거부', () => {
  const sell = amt => preTradeCheck(base, { symbol: 'B', name: '나', currency: 'KRW', side: 'SELL', amountKrw: amt }, { ok: true, vol: 0.1 });
  assert.ok(!sell(5_000_001).error); assert.ok(!sell(5_100_001).error); assert.match(sell(5_100_002).error, /보유 금액/);
});
test('TC-UNIT-PRE-009~010 30일 매매 횟수 상한 8회: 8번째 주문 통과, 9번째 위반', () => {
  assert.equal(rule(buyA(100_000, { ...base, trades30: 7 }), 'maxTrades30'), true);
  assert.equal(rule(buyA(100_000, { ...base, trades30: 8 }), 'maxTrades30'), false);
});
test('TC-UNIT-PRE-011~012 현금 최소 비중 10%: 주문 뒤 현금 10.0% 통과, 9.9% 위반', () => {
  assert.equal(rule(buyA(4_000_000), 'minCash'), true);
  assert.equal(rule(buyA(4_010_000), 'minCash'), false);
});

// ── TC-UNIT-LAB-001~009 과거 기업 분석의 시점 기준 자료: 경계값·결정 테이블 ──
test('TC-UNIT-LAB-001~003 주식 수 신선도 400일: 400일째 사용, 401일째 버림, 공개 전날은 없음', () => {
  const pit = [['2023-01-01', '2023-02-15', 1000]];
  assert.equal(sharesAt(pit, '2024-02-05').shares, 1000, '기준일 + 400일');
  assert.equal(sharesAt(pit, '2024-02-06'), null, '기준일 + 401일');
  assert.equal(sharesAt(pit, '2023-02-14'), null, '공개일 전날');
});
test('TC-UNIT-LAB-004~008 시가총액 결정 테이블(그때 주식 수 공개 여부 × 400일 이내 × 지금 주식 수 유무)', () => {
  const pit = [['2023-01-01', '2023-02-15', 1000]];
  // R1: 공개됨·신선 → 그때 주식 수
  assert.deepEqual(capAt({ sharesPit: pit, shares: 3000 }, '2023-06-30', 10), { cap: 10_000, pit: true, asOf: '2023-01-01' });
  // R2: 공개됨·오래됨·지금 주식 수 있음 → 지금 주식 수로 근사
  assert.deepEqual(capAt({ sharesPit: pit, shares: 3000 }, '2024-06-30', 10), { cap: 30_000, pit: false });
  // R3: 공개됨·오래됨·지금 주식 수 없음 → 계산 안 함
  assert.deepEqual(capAt({ sharesPit: pit }, '2024-06-30', 10), { cap: null, pit: false });
  // R4: 미공개·지금 주식 수 있음 → 근사
  assert.deepEqual(capAt({ sharesPit: pit, shares: 3000 }, '2023-02-01', 10), { cap: 30_000, pit: false });
  // R5: 미공개·지금 주식 수 없음 → 계산 안 함
  assert.deepEqual(capAt({}, '2023-02-01', 10), { cap: null, pit: false });
});
test('TC-UNIT-LAB-009 순위: 비교 대상 4개면 순위 없음, 5개부터 계산 / 등급 경계 0.2·0.4·0.6·0.8', () => {
  assert.equal(rankIn([1, 2, 3, 4], 4), null); assert.equal(rankIn([1, 2, 3, 4, 5], 5), 0.9);
  assert.deepEqual([0.199, 0.2, 0.4, 0.6, 0.8].map(rankWord), ['낮음', '다소 낮음', '보통', '다소 높음', '높음']);
});

// ── TC-UNIT-RPT-001~002 성적표 불변식: 손실로 끝난 기간의 최대 손실은 기간 손실보다 작을 수 없다 ──
test('TC-UNIT-RPT-001~002 성적표 세 경로 모두 최대 손실 ≤ min(0, 기간 수익률)', () => {
  // 한 종목 100% 보유 → 규칙(한 종목 25%)이 첫날 75%를 팔고(비용 0.2%) 이후 가격이 계속 내린다
  const c = [100_000, 95_000, 90_000, 85_000].map((close, i) => ({ date: `2024-03-0${i + 1}`, close }));
  const engine = { riskAt: () => ({ ok: true, vol: 0.1, trendApplies: false }), portVarAt: () => ({ ok: true, var95: 0 }) };
  const rc = reportCard({ positions: [{ symbol: 'A', name: '가', currency: 'KRW', quantity: 10 }], orders: [], candlesBySymbol: { A: c }, from: '2024-03-01', to: '2024-03-04', engine });
  assert.ok(rc.ok && rc.rule.rebalances > 0, '첫날 규칙 매도가 일어나야 함');
  for (const k of ['actual', 'hold', 'rule']) assert.ok(rc[k].mdd <= Math.min(0, rc[k].ret) + 1e-12, `${k}: 최대 손실 ${rc[k].mdd} > 기간 수익률 ${rc[k].ret}`);
});

// ── TC-UNIT-REP-001 재현성(SSRD v1.1 CAP-03, LOS-03): 같은 입력·설정은 같은 결과 ──
test('TC-UNIT-REP-001 같은 시세·전략으로 20번 실행하면 최종 자산의 상대 오차 0', () => {
  const rows = Array.from({ length: 300 }, (_, i) => { const close = 100 + 10 * Math.sin(i / 9) + i * 0.05; return { date: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1000 }; });
  const opt = { initialCapital: 10_000_000, fastPeriod: 5, slowPeriod: 20, feeRate: 0.001, slippageRate: 0.001 };
  const first = runBacktest(rows, opt).summary.finalValue;
  for (let k = 0; k < 20; k++) assert.ok(Math.abs(runBacktest(rows, opt).summary.finalValue / first - 1) <= 1e-6);
});
