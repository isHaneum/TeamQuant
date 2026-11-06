import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { knownAt, outcomeAfter, sharesAt, capAt, rankIn, driverText, symKey } from '../lib/company-lab.js';

const read = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const hist = read('company-history.json'), study = read('growth-study.json'), outlook = read('growth-outlook.json'), ledger = read('growth-ledger.json'), universe = read('growth-universe.json'), strategy = read('growth-strategy.json');

// ── 시점 기준 계산(합성 자료) ──
const Q = (end, avail, rev) => [end, avail, rev, rev / 10, rev / 20, rev * 2];
const quarters = [
  Q('2019-03-31', '2019-05-15', 80), Q('2019-06-30', '2019-08-14', 80), Q('2019-09-30', '2019-11-14', 80), Q('2019-12-31', '2020-03-30', 80),
  Q('2020-03-31', '2020-05-15', 100), Q('2020-06-30', '2020-08-14', 100), Q('2020-09-30', '2020-11-14', 100), Q('2020-12-31', '2021-03-31', 100),
  Q('2021-03-31', '2021-05-15', 120), Q('2021-06-30', '2021-08-14', 120), Q('2021-09-30', '2021-11-14', 120), Q('2021-12-31', '2022-03-31', 120),
  Q('2022-03-31', '2022-05-15', 200), Q('2022-06-30', '2022-08-14', 200), Q('2022-09-30', '2022-11-14', 200), Q('2022-12-31', '2023-03-31', 200),
];

test('공개일 전 분기는 쓰지 않는다: 3월 30일에는 작년 4분기(3월 31일 공개)가 빠진다', () => {
  const before = knownAt(quarters, '2022-03-30'), after = knownAt(quarters, '2022-03-31');
  assert.equal(before.lastEnd, '2021-09-30');
  assert.equal(after.lastEnd, '2021-12-31');
  assert.equal(after.rev, 480); assert.ok(Math.abs(after.revG - 0.2) < 1e-9);
  assert.equal(knownAt(quarters, '2021-03-30'), null, '공개된 분기가 8개 미만이면 분석하지 않음');
});

test('결과는 마지막으로 알려진 분기 다음 4개 분기이고, 그 결과가 공개된 날을 함께 준다', () => {
  const o = outcomeAfter(quarters, '2021-12-31', 4);
  assert.equal(o.rev, 800); assert.equal(o.end, '2022-12-31'); assert.equal(o.knownAt, '2023-03-31');
  assert.equal(outcomeAfter(quarters, '2022-03-31', 4), null, '아직 4개 분기가 안 지났으면 결과 없음');
});

test('주식 수는 분석일에 공개된 것만, 400일 넘게 묵은 값은 버리고, 없으면 지금 주식 수로 근사', () => {
  const pit = [['2021-12-31', '2022-03-31', 1000], ['2022-03-31', '2022-05-15', 1500]];
  assert.equal(sharesAt(pit, '2022-05-14').shares, 1000);
  assert.equal(sharesAt(pit, '2022-05-15').shares, 1500);
  assert.equal(sharesAt(pit, '2022-03-30'), null);
  assert.equal(sharesAt(pit, '2023-06-30'), null, '기준일이 400일 넘게 지나면 없음');
  const c = { sharesPit: pit, shares: 3000 };
  assert.deepEqual(capAt(c, '2022-06-30', 10), { cap: 15000, pit: true, asOf: '2022-03-31' });
  assert.deepEqual(capAt(c, '2022-01-31', 10), { cap: 30000, pit: false });
});

test('보조 함수: 순위, 근거 문구, 종목 코드 맞추기', () => {
  assert.equal(rankIn([1, 2, 3, 4, 5], 5), 0.9);
  assert.equal(rankIn([1, 2], 2), null, '비교 대상이 5개 미만이면 순위 없음');
  assert.equal(driverText('psrPit', 0.15, 16.28, 'USD'), '▲ PSR(시장이 매긴 매출 배수) 16.3배');
  assert.equal(driverText('eyPit', -0.1, 0.05), '▼ PER 20배');
  assert.equal(driverText('mom', 0.07, null), '▲ 12개월 주가 흐름');
  assert.equal(symKey('A005930'), '005930'); assert.equal(symKey('nvda'), 'NVDA'); assert.equal(symKey('005930.KS'), '005930');
});

// ── 자료 파일 ──
test('기업 이력: 공개일 > 기말, 주식 수 공개일 ≥ 기준일, 월별 시세 오름차순, 모델 판단은 0~1이고 2017년부터', () => {
  const cs = Object.values(hist.companies);
  assert.equal(cs.length, hist.model.companiesByMarket.KR + hist.model.companiesByMarket.US);
  for (const c of cs) {
    for (const q of c.quarters) assert.ok(q[1] > q[0], `${c.name} ${q[0]} 공개일 ${q[1]}`);
    for (const s of c.sharesPit || []) assert.ok(s[1] >= s[0] && s[2] > 0, `${c.name} 주식 수 ${s[0]}`);
    for (let i = 1; i < c.months.length; i++) assert.ok(c.months[i][0] > c.months[i - 1][0]);
    for (const [d, p] of Object.entries(c.pred)) { assert.ok(p[0] >= 0 && p[0] <= 1 && d >= '2017-01-01', `${c.name} ${d}`); assert.ok(p[2].length <= 3); }
  }
  assert.ok(cs.filter(c => c.sharesPit?.length).length >= 90, '대부분 그때 주식 수가 있어야 한다');
});

test('G2 점검 결과가 기록돼 있다: 성장은 단순 기준보다 낫고(구간 포함), 재무만으로는 아니며, 초과수익은 실패', () => {
  const G = study.targets.fwdRevG, b = G.bootstrapCheck.models;
  assert.equal(G.chosen, 'C'); assert.equal(hist.model.variant, 'C');
  assert.ok(b.C.minusPersist.ci95[0] > 0, '그때 주식 수로 계산한 모델이 단순 기준보다 낫다(95% 구간 하한 > 0)');
  assert.ok(b.D.minusPersist.ci95[0] < 0, '재무만 쓴 모델은 단순 기준과 구별되지 않는다');
  assert.ok(G.models.C.check.ic > G.models.B.check.ic, '시가총액 특징을 빼면 떨어진다');
  for (const y of [2021, 2022, 2023, 2024, 2025]) assert.ok(G.models.C.byYear[y].ic > 0, `${y}년 IC 양수`);
  assert.ok(!G.models.C.byYear[2026], '결과 미공개인 2026년 단면은 평가하지 않음');
  assert.ok(study.targets.fwdEx12.bootstrapCheck.models[study.targets.fwdEx12.chosen].ci95[1] < 0.05, '초과수익 예측력 없음');
  assert.ok(study.manifest.inputs['growth-panel.csv'] && study.manifest.software.lightgbm);
  assert.ok(study.notes.some(n => n.includes('생존 편향')));
});

test('전체 미국 기업(상장폐지 포함) 점검: 재무만으로는 단순 기준보다 조금만 낫다', () => {
  const b = universe.bootstrapCheck;
  assert.ok(universe.firms > 3000);
  assert.ok(b.lgbmMinusPersist.ci95[0] > 0 && b.lgbmMinusPersist.mean < 0.1);
});

test('지금 전망과 기록부: 기준일·모델 버전·비교 집단이 있고, 같은 판단이 두 번 적히지 않는다', () => {
  const cs = Object.values(outlook.companies);
  assert.equal(cs.length, Object.keys(hist.companies).length);
  for (const c of cs) { assert.ok(c.growthRank >= 0 && c.growthRank <= 1 && c.asOf && c.groupSize >= 8); assert.ok(c.range.p25 <= c.range.p50 && c.range.p50 <= c.range.p75); }
  assert.ok(outlook.trainedOnOutcomesThrough <= new Date().toISOString().slice(0, 10));
  const keys = ledger.entries.map(e => `${e.asOf}|${e.modelVersion}|${e.sym}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const e of ledger.entries) { assert.ok(e.asOf && e.modelVersion && e.group && e.trainedOnOutcomesThrough); if (e.actual) assert.ok(e.actual.knownAt <= e.actual.filledAt); }
  // 범위 보정표는 순위가 높을수록 실제 성장 중앙값이 높아야 의미가 있다
  for (const m of ['KR', 'US']) assert.ok(outlook.calibration[m][4].p50 > outlook.calibration[m][0].p50);
});

test('성장 전망으로 종목 고르기는 표본 외에서 수익이 없다(화면의 "매매 신호 아님" 근거)', () => {
  const c = strategy.combined.check;
  assert.equal(strategy.modelVersion, hist.model.version, '같은 모델 판단으로 검증');
  assert.ok(c.months >= 60 && c.H1_TOP_ALL.ci95[0] < 0 && c.H2_EXBOT_ALL.ci95[0] < 0, '상위 보유·하위 제외 모두 0과 구별되지 않음');
  assert.ok(strategy.markets.US.check.y2022.TOP < strategy.markets.US.check.y2022.ALL, '2022년 미국 성장 상위가 더 빠짐');
  for (const m of ['KR', 'US']) assert.ok(Math.abs(strategy.markets[m].check.drawdownRisk.afterVolT) < 1.96, `${m}: 낙폭 정보는 지난 변동성을 넘지 않음`);
});
