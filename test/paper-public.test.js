// 공개 스냅샷: 계좌번호·경로·주문 번호가 빠지고, 화면 모듈이 읽는 자산 스냅샷·시뮬 입력으로 바뀐다.
// 운용 상태·투자 비중·미집행 사유 helpers 는 화면(paper-ui)과 홈 배너(brief-ui)가 같은 답을 내게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSnapshot, assetSnapshotFrom, tossOrdersFrom, planBasketFrom, heldBasketFrom, runState, invested, nextChecks, lastAuto, lastAutoFor, planAppliedFor, planGaps, plannedNotHeld, heldNotPlanned, orderStatusLabel, kstStamp, MARKET_NAME } from '../lib/paper-public.js';

const status = {
  version: 'L3', account: '****2787', ledgerPath: 'C:\\x\\kis-vps-2787.json', fx: 1450, killSwitch: false, limits: { maxOrderKrw: 1, maxDailyKrw: 2 },
  markets: { KR: { open: false, reason: '장 마감' }, US: { open: false, reason: 'x' } }, market: { open: false, reason: '장 마감' },
  balance: { cash: 20_000_000, cashUsd: 1000, total: 100_000_000, stock: 78_550_000, usError: 'oops', positions: [
    { symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 100, price: 70000, value: 7_000_000, valueKrw: 7_000_000, avgCost: 68000 },
    { symbol: 'SPY', name: 'S&P500 ETF', market: 'US', currency: 'USD', qty: 10, price: 500, value: 5000, valueKrw: 7_250_000, avgCost: 480 }] },
  ordersToday: [{ at: '2026-11-09T03:21:00Z', key: 'k', odno: '0000123', orgno: '91252', symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', side: 'BUY', qty: 100, price: 69000, amountKrw: 6_900_000, why: '계획', status: 'filled', filledQty: 100, avgPrice: 68000, brokerMsg: '정상' }],
  recentOrders: [{ at: '2026-11-09T03:21:00Z', odno: '0000123', symbol: '005930', name: '삼성전자', currency: 'KRW', side: 'BUY', qty: 100, price: 69000, amountKrw: 6_900_000, status: 'filled', filledQty: 100, avgPrice: 68000 }, { at: '2026-11-09T04:00:00Z', odno: '9', symbol: '069500', name: 'KODEX 200', currency: 'KRW', side: 'SELL', qty: 100, price: 50000, amountKrw: 5e6, status: 'sent', filledQty: 0 }],
  runs: [{ at: '2026-11-09T03:21:00Z', blockedReasons: { '장 시작 전': 1 }, actions: 5, sent: 4, rejected: 0, unknown: 0, blocked: 1, planSource: 'default', rebalance: true, batch: 'RB-1' }],
  auto: [{ key: 'KR:2026-11-09', at: '2026-11-09T04:02:00Z', reason: '첫 운용', rebalance: true, sent: 9, blocked: 2, items: 11, note: '증권사 응답 ODNO 0000123 KIS-VPS 2787', orders: [{ odno: '0000123' }] }],
  marks: [{ date: '2026-11-09', total: 99_940_000, cash: 20_000_000, stock: 79_940_000 }],
  prefs: { rules: { maxSingle: 15 }, cadence: 'monthly', sectorCap: 20, prefs: { lossMonthly: 5 }, savedAt: '2026-11-09T05:00:00Z' },
  hypotheses: [{ id: 'H1', symbol: '000660', name: 'SK하이닉스', currency: 'KRW', market: 'KR', capPct: 3, horizonMonths: 6, thesis: 'HBM', breakIf: 'x', evidence: ['a'], openedAt: '2026-11-09T05:00:00Z', closesAt: '2027-05-09T05:00:00Z', status: 'open', entryPrice: null, price: 100, returnPct: null, indexPct: 0.01, excessPct: null, daysOpen: 0, expired: false }],
  planVersionNow: 'PP1+R:abc', defaultPlanVersion: 'PP1', hasDefaultPlan: true, planVersion: { KR: 'PP1+R:abc', US: null },
  settings: { auto: true, accountMasked: '****2787', keyFile: 'C:\\k\\kis-vps.key' },
  integrity: { ok: true, items: [{ key: 'duplicates', label: '의도하지 않은 중복 주문', count: 0, target: 0 }, { key: 'leftOpen', label: '마감 뒤 남은 미체결', count: 1, target: 0 }], notFound: 0, rejected: 0, pending: 1, leftOpen: 1, orders: 17 },
  planDoc: { version: 'PP1', asOf: '2026-11-09', cashPct: 15, method: ['m'], weights: { '005930': { pct: 2.5, name: '삼성전자', currency: 'KRW', sectorName: '반도체', why: ['변동성 역수'], exposure: ['2026-06-04 지방선거'] }, SPY: { pct: 8, name: 'S&P500 ETF', currency: 'USD', why: ['지수 ETF'] } }, validation: { windows: [] } },
  // 비교선: 정의·숫자만 옮기고 그 밖의 키(note 에 경로·주문번호가 섞인 상황을 가정)는 버린다
  benchmark: { version: 'BM1-2026-11-12', label: '국가 비중·현금 일치 지수 투자', weights: { KR: 10.5, US: 8, cash: 81.5 }, legs: { KR: { symbol: '069500', name: 'KODEX 200', currency: 'KRW' }, US: { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' } }, ownRetPct: 1.2, benchRetPct: 0.7, diffPp: 0.5, days: 2, from: '2026-11-09', asOf: '2026-11-10', error: null, note: 'ledger C:\\x\\kis-vps-2787.json ODNO 0000123' }
};

test('공개 스냅샷: 계좌번호·장부 경로·주문 번호·증권사 응답이 빠지고 잔고·보유·기록·계획·규칙·가설은 남는다', () => {
  const pub = publicSnapshot(status, { asOf: '2026-11-09T07:00:00Z' });
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('2787') && !text.includes('kis-vps') && !text.includes('0000123') && !text.includes('91252') && !text.includes('정상') && !text.includes('oops') && !text.includes('ODNO') && !text.includes('keyFile'));
  assert.equal(pub.public, true); assert.equal(pub.asOf, '2026-11-09T07:00:00Z'); assert.equal(pub.since, '2026-11-09'); assert.equal(pub.days, 1);
  assert.equal(pub.balance.positions.length, 2); assert.ok(Math.abs(pub.balance.positions[0].weightPct - 7) < 0.01);
  assert.equal(pub.balance.usError, true);
  assert.equal(pub.recentOrders[0].filledQty, 100); assert.equal(pub.recentOrders[0].odno, undefined);
  assert.equal(pub.prefs.cadence, 'monthly'); assert.equal(pub.hypotheses[0].thesis, 'HBM'); assert.equal(pub.planDoc.version, 'PP1');
  assert.equal(pub.runs[0].blockedReasons['장 시작 전'], 1); assert.equal(pub.auto[0].reason, '첫 운용');
  // 잔고를 못 읽은 상태는 메시지만 바뀐다
  assert.ok(publicSnapshot({ ...status, error: '잔고 조회 실패: token' }).error.includes('마지막 기록'));
  assert.equal(publicSnapshot({}).balance, null);
});

test('공개 스냅샷(PUB2): 자동 실행은 요약만(메모·주문 목록 제거, 시장은 키에서), 설정은 auto 플래그만, 계획 버전·적용 여부·계획 근거(why/exposure)·점검 항목이 실린다', () => {
  const pub = publicSnapshot(status);
  assert.deepEqual(pub.auto[0], { key: 'KR:2026-11-09', at: '2026-11-09T04:02:00Z', market: 'KR', reason: '첫 운용', rebalance: true, sent: 9, blocked: 2, items: 11 });
  assert.deepEqual(pub.settings, { auto: true }); assert.deepEqual(pub.planVersion, { KR: 'PP1+R:abc', US: null });
  assert.equal(pub.planApplied, null, '서버가 주지 않으면 null');
  assert.deepEqual(pub.planDoc.weights['005930'].why, ['변동성 역수']); assert.deepEqual(pub.planDoc.weights['005930'].exposure, ['2026-06-04 지방선거']);
  assert.equal(pub.integrity.items[1].key, 'leftOpen'); assert.equal(pub.integrity.items[1].count, 1); assert.equal(pub.integrity.leftOpen, 1);
  // planApplied 는 boolean 또는 {applied, at, version} 둘 다 받고, 그 밖의 필드(메모)는 버린다
  const pa = publicSnapshot({ ...status, planApplied: { KR: true, US: { applied: false, at: '2026-11-09T14:38:00Z', version: 'PP1', reason: 'broker said ODNO 1' } } }).planApplied;
  assert.deepEqual(pa.KR, { applied: true, at: null, version: null }); assert.deepEqual(pa.US, { applied: false, at: '2026-11-09T14:38:00Z', version: 'PP1' });
  assert.ok(!JSON.stringify(pa).includes('ODNO'));
  // settings.auto 가 boolean 이 아니면 null, items 가 배열이면 길이만
  assert.deepEqual(publicSnapshot({ settings: { auto: 'yes' }, auto: [{ key: 'US:2026-11-09', at: '2026-11-09T14:38:00Z', items: [{ odno: 1 }, {}] }] }).auto[0].items, 2);
  assert.equal(publicSnapshot({ settings: { auto: 'yes' } }).settings.auto, null);
});

test('공개 스냅샷(결정 21): 비교선은 정의(이름·국가 비중·현금·다리)와 지수 대비 숫자만 · 그 밖의 키는 버림 · error 는 숫자열 스크럽 · 없으면 null · startTotal/total 은 그대로(PUB2 호환)', () => {
  const pub = publicSnapshot(status);
  assert.deepEqual(pub.benchmark, { version: 'BM1-2026-11-12', label: '국가 비중·현금 일치 지수 투자', weights: { KR: 10.5, US: 8, cash: 81.5 }, legs: { KR: { symbol: '069500', name: 'KODEX 200', currency: 'KRW' }, US: { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' } }, ownRetPct: 1.2, benchRetPct: 0.7, diffPp: 0.5, days: 2, from: '2026-11-09', asOf: '2026-11-10', error: null });
  assert.ok(!('note' in pub.benchmark) && !JSON.stringify(pub.benchmark).includes('2787'));
  assert.equal(pub.startTotal, 99_940_000); assert.equal(pub.total, 99_940_000);
  const held = publicSnapshot({ benchmark: { label: 'x', weights: { KR: 20 }, ownRetPct: 1, benchRetPct: null, diffPp: null, error: '지수 시세를 읽지 못해 비교를 보류 ODNO 0000123' } }).benchmark;
  assert.deepEqual(held.weights, { KR: 20, US: 0, cash: 0 }); assert.deepEqual(held.legs, { KR: null, US: null }); assert.equal(held.diffPp, null); assert.equal(held.error, '지수 시세를 읽지 못해 비교를 보류 ODNO …');
  assert.equal(publicSnapshot({}).benchmark, null); assert.equal(publicSnapshot({ benchmark: 'x' }).benchmark, null);
});

test('자산 스냅샷 변환: 토스 모양의 보유·체결(demo+paper 표식) · 현금은 달러 예수금을 환율로 합친다 · paperMeta 에 운용 상태·투자 비중·마지막 자동 실행', () => {
  const pub = publicSnapshot(status, { asOf: '2026-11-09T07:00:00Z' }), snap = assetSnapshotFrom(pub, { now: Date.parse('2026-11-09T07:00:00Z') });
  assert.equal(snap.demo, true); assert.equal(snap.paper, true); assert.ok(snap.source.includes('실제 돈 아님'));
  assert.equal(snap.positions.length, 2); const s = snap.positions[0];
  assert.deepEqual([s.symbol, s.quantity, s.price, s.cost, s.value], ['005930', 100, 70000, 6_800_000, 7_000_000]); assert.ok(Math.abs(s.returnPct - 2.941) < 0.01);
  assert.equal(snap.demoCash, 20_000_000 + 1000 * 1450); assert.equal(snap.fx.midRate, 1450);
  assert.equal(snap.demoOrders.orders.length, 1, '체결된 주문만'); assert.equal(snap.demoOrders.orders[0].execution.averageFilledPrice, 68000);
  assert.equal(snap.paperMeta.days, 1); assert.equal(snap.paperMeta.cadence, 'monthly');
  assert.deepEqual(snap.paperMeta.run, { state: 'running', label: '진행 중', lastMarkDate: '2026-11-09' });
  assert.ok(Math.abs(snap.paperMeta.investedPct - 78.55) < 0.01); assert.equal(snap.paperMeta.planInvestedPct, 85); assert.equal(snap.paperMeta.lastAutoAt, '2026-11-09T04:02:00Z');
  assert.equal(tossOrdersFrom([{ status: 'sent', filledQty: 0 }]).length, 0);
});

test('시뮬 입력: 기본 계획은 비중 그대로, 지금 보유는 바구니만', () => {
  const pub = publicSnapshot(status), pb = planBasketFrom(pub);
  assert.deepEqual(pb.basket.map(b => b.symbol), ['005930', 'SPY']); assert.deepEqual(pb.plan, { '005930': 2.5, SPY: 8 }); assert.equal(pb.cashPct, 15); assert.equal(pb.version, 'PP1');
  assert.deepEqual(heldBasketFrom(pub).map(b => b.currency), ['KRW', 'USD']);
  assert.deepEqual(planBasketFrom(null), { basket: [], plan: {}, cashPct: 100, version: null });
});

test('운용 상태: 플래그 우선, 없으면 7일 안 자동 실행으로 추정 · 평가 2일 넘으면 PC 서버 꺼짐 · 킬 스위치 · live 면 늘 신선', () => {
  const pub = publicSnapshot(status), t0 = Date.parse('2026-11-10T05:00:00Z');
  assert.equal(runState(pub, t0).state, 'running'); assert.equal(runState(pub, t0).inferred, false);
  assert.equal(runState({ ...pub, settings: { auto: false } }, t0).state, 'stopped');
  assert.equal(runState({ ...pub, killSwitch: true }, t0).state, 'killed');
  assert.equal(runState(pub, Date.parse('2026-11-13T05:00:00Z')).state, 'offline', '마지막 평가 11-09, 지금 11-13 → 4일');
  assert.equal(runState({ ...pub, live: true }, Date.parse('2026-11-13T05:00:00Z')).state, 'running', 'PC 실시간 응답이면 서버가 켜진 것');
  const noFlag = { ...pub, settings: null };
  assert.equal(runState(noFlag, t0).state, 'running'); assert.equal(runState(noFlag, t0).inferred, true);
  assert.equal(runState({ ...noFlag, auto: [], marks: [{ date: '2026-11-10' }] }, t0).state, 'unknown', '자동 실행 기록도 플래그도 없으면 미확인');
  assert.equal(runState(null).state, 'unknown'); assert.equal(runState(pub, t0).lastAuto.market, 'KR');
});

test('투자 비중·다음 점검·시각 표기', () => {
  const pub = publicSnapshot(status);
  assert.deepEqual(invested(pub), { nowPct: 78.55, planPct: 85 }); assert.deepEqual(invested(null), { nowPct: null, planPct: null });
  // 2026-11-10 (화) 14:00 KST: 국내는 다음 날 09:00, 미국은 당일 23:30 KST(겨울)
  const nc = nextChecks(pub, Date.parse('2026-11-10T05:00:00Z'));
  assert.deepEqual(nc.checks.map(c => c.kst), ['2026-11-11 (수) 09:00', '2026-11-10 (화) 23:30']); assert.equal(nc.cadence, 'monthly'); assert.ok(nc.cadenceLabel.includes('월 1회'));
  // 금요일 밤 → 월요일; 여름(서머타임)에는 미국 22:30 KST
  assert.deepEqual(nextChecks(null, Date.parse('2026-11-13T15:00:00Z')).checks.map(c => c.kst), ['2026-11-16 (월) 09:00', '2026-11-16 (월) 22:30'.replace('22:30', '23:30')]);
  assert.equal(nextChecks(null, Date.parse('2026-07-14T05:00:00Z')).checks[1].kst, '2026-07-14 (화) 22:30');
  assert.equal(nextChecks(null).cadenceLabel, '정기 주문은 주 1회(금요일)');
  assert.equal(kstStamp('2026-11-09T14:38:30.225Z'), '2026-11-09 23:38'); assert.equal(kstStamp(''), ''); assert.equal(kstStamp('garbage'), 'garbage');
  assert.equal(MARKET_NAME.US, '미국');
});

test('주문 상태 글자: expired 는 소멸(마감), 모르는 상태는 그대로', () => {
  assert.equal(orderStatusLabel('expired'), '소멸(마감)'); assert.equal(orderStatusLabel('sent'), '보냄(미체결)'); assert.equal(orderStatusLabel('filled'), '체결'); assert.equal(orderStatusLabel('weird'), 'weird'); assert.equal(orderStatusLabel(undefined), '—');
});

// 2026-11-09 실제 상황: 국내 재조정은 나갔고, 미국은 23:38 KST 자동 실행이 하루 한도 합산 때문에 전부 차단됐다.
const live = publicSnapshot({
  balance: { cash: 62_669_084, cashUsd: 0, total: 100_555_484, stock: 37_886_400, positions: [
    { symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', qty: 138, price: 50000, valueKrw: 6_900_000 },
    { symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 13, price: 70000, valueKrw: 910_000 },
    { symbol: '999999', name: '옛 보유', market: 'KR', currency: 'KRW', qty: 3, price: 1000, valueKrw: 3000 }] },
  recentOrders: [{ at: '2026-11-09T04:02:00Z', odno: '1', symbol: '069500', name: 'KODEX 200', currency: 'KRW', side: 'SELL', qty: 100, price: 50000, status: 'expired', filledQty: 0 }, { at: '2026-11-09T14:38:00Z', odno: '2', symbol: 'TLT', name: '미국 장기채 ETF', currency: 'USD', side: 'BUY', qty: 10, price: 90, status: 'rejected', filledQty: 0 }],
  runs: [{ at: '2026-11-09T03:54:46Z', blockedReasons: {}, sent: 4, blocked: 9, rebalance: false }, { at: '2026-11-09T14:38:26Z', blockedReasons: { '장이 끝났습니다': 4, '오늘 주문 합계가 한도 60,000,000원을 넘습니다.': 5 }, sent: 0, blocked: 9, rebalance: true }],
  auto: [{ key: 'KR:2026-11-09', at: '2026-11-09T03:54:50Z', reason: '계획 변경(PP1-2026-11-09)', rebalance: false, sent: 3, blocked: 9, items: 13 }, { key: 'US:2026-11-09', at: '2026-11-09T14:38:30Z', reason: '계획 변경(PP1-2026-11-09)', rebalance: true, sent: 0, blocked: 9, items: 9 }],
  marks: [{ date: '2026-11-09', total: 99_378_704 }, { date: '2026-11-10', total: 100_555_484 }],
  planVersionNow: 'PP1-2026-11-09', defaultPlanVersion: 'PP1-2026-11-09', hasDefaultPlan: true,
  planDoc: { version: 'PP1-2026-11-09', cashPct: 15, weights: { '069500': { pct: 7, name: 'KODEX 200', currency: 'KRW', why: ['지수'] }, '005930': { pct: 2.5, name: '삼성전자', currency: 'KRW' }, '105560': { pct: 5.5, name: 'KB금융', currency: 'KRW' }, SPY: { pct: 8, name: 'S&P500 ETF', currency: 'USD' }, TLT: { pct: 14.5, name: '미국 장기채 ETF', currency: 'USD' }, NVDA: { pct: 3.5, name: '엔비디아', currency: 'USD' } } }
});

test('미집행 사유: 시장별 계획·보유 비중 차이가 10%p 넘으면 마지막 자동 실행의 차단 이유를 붙인다 · 계획 중 미보유는 마지막 주문 → 자동 실행 → 아직 집행 전 순으로 설명 · 계획에 없는 보유는 정리 대상', () => {
  const g = planGaps(live), us = g.find(x => x.market === 'US'), kr = g.find(x => x.market === 'KR');
  assert.equal(us.planPct, 26); assert.equal(us.heldPct, 0); assert.equal(us.gapPct, 26);
  assert.ok(us.reason.startsWith('2026-11-09 23:38 자동 실행에서 미국 주문 9건 전부 차단 — 오늘 주문 합계가 한도 60,000,000원을 넘습니다.'), us.reason);
  assert.equal(kr.planPct, 15); assert.equal(kr.reason, null, '국내는 7.8% 보유 vs 15% 계획 → 10%p 미만');
  const nh = plannedNotHeld(live);
  assert.deepEqual(nh.map(n => n.symbol), ['TLT', 'SPY', '105560', 'NVDA'], '목표 비중 내림차순');
  assert.equal(nh[0].reason, '2026-11-09 23:38 매수 10주 거부', '마지막 주문 기록이 있으면 그것');
  assert.ok(nh[1].reason.startsWith('2026-11-09 23:38 자동 실행 차단 — 오늘 주문 합계'), '주문 기록이 없으면 그 시장 자동 실행');
  assert.equal(nh[2].market, 'KR'); assert.ok(nh[2].reason.includes('자동 실행 뒤에도 미보유'), nh[2].reason);
  assert.deepEqual(heldNotPlanned(live), ['999999']);
  assert.deepEqual(plannedNotHeld({ planDoc: { weights: { QQQ: { pct: 5, name: 'q' } } } })[0].reason, '아직 집행 전');
  assert.deepEqual(planGaps(null).map(x => x.reason), [null, null]);
  assert.equal(lastAuto(live).market, 'US'); assert.equal(lastAutoFor(live, 'KR').sent, 3); assert.equal(lastAutoFor(live, 'US').topBlock, '오늘 주문 합계가 한도 60,000,000원을 넘습니다.'); assert.equal(lastAutoFor({}, 'KR'), null);
});

test('계획 적용 여부: 서버 planApplied 우선, 없으면 planVersion[시장]과 지금 버전 비교, 실행했지만 전부 차단이면 미적용', () => {
  assert.deepEqual(planAppliedFor(live, 'KR'), { applied: true, label: '적용', at: '2026-11-09T03:54:50Z', source: 'version' }, '공개 파일에 planVersion 이 없어도 자동 실행 이유의 버전으로 판단');
  assert.equal(planAppliedFor(live, 'US').applied, false); assert.equal(planAppliedFor(live, 'US').label, '미적용(실행했으나 전부 차단)');
  assert.equal(planAppliedFor({ ...live, planVersion: { KR: 'PP0', US: null } }, 'KR').label, '미적용(이전 버전)');
  assert.deepEqual(planAppliedFor({ ...live, planApplied: { KR: { applied: false, at: null, version: null }, US: { applied: true, at: '2026-11-10T14:40:00Z', version: 'PP1-2026-11-09' } } }, 'US'), { applied: true, label: '적용', at: '2026-11-10T14:40:00Z', source: 'server' });
  assert.equal(planAppliedFor({}, 'KR').label, '—');
  // 운용 상태: 플래그 없는 공개 파일 → 11-09 자동 실행으로 추정, 평가 11-10 → 진행 중
  assert.deepEqual([runState(live, Date.parse('2026-11-10T06:00:00Z')).state, runState(live, Date.parse('2026-11-10T06:00:00Z')).inferred], ['running', true]);
  assert.ok(Math.abs(invested(live).nowPct - 37.68) < 0.01);
});
