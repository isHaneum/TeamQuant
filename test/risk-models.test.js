import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logReturns, ewmaVariance, nelderMead, fitGarch, garchHorizonVar, annualVol, fitHmm2, hmmFilter, oneDayRisk, simulateGarch, rng, volTargetWeight, quantile, MODEL_VERSION } from '../lib/risk-models.js';
import { indexFeatures, CONDITIONS, RULES, eventIndexes, activeConditions, ANALOG_VERSION } from '../lib/shock-analogs.js';
import { mergeQuote, marketResponse, holdingsPlan } from '../lib/market-response.js';
import { quoteUrls, parseQuote } from '../lib/quote-check.js';
import { applyQuote, marketMove } from '../lib/issue-bot.js';

const R = rng(5); const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
function garchSeries(n, a = 0.1, b = 0.85, lr = 1e-4) { const om = (1 - a - b) * lr, r = []; let h = lr; for (let t = 0; t < n; t++) { const e = Math.sqrt(h) * gauss(); r.push(e); h = om + a * e * e + b * h; } return r; }
function candlesFrom(returns, start = 100) { let p = start; const t0 = Date.parse('2018-01-01'); return returns.map((r, i) => { const open = p; p *= Math.exp(r); return { date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), open, close: p }; }); }

test('넬더–미드와 EWMA 기본 동작', () => {
  const m = nelderMead(([x, y]) => (x - 1) ** 2 + (y + 2) ** 2, [0, 0]);
  assert.ok(Math.abs(m.x[0] - 1) < 1e-3 && Math.abs(m.x[1] + 2) < 1e-3);
  const v = ewmaVariance([0.01, -0.01, 0.02]); assert.equal(v.length, 4);
  assert.deepEqual(logReturns([100, 110]).map(x => +x.toFixed(6)), [+Math.log(1.1).toFixed(6)]);
});

test('GARCH(1,1)은 모의 자료의 지속성과 장기 변동성을 되찾는다', () => {
  const f = fitGarch(garchSeries(4000));
  assert.ok(f.ok); assert.ok(Math.abs(f.persistence - 0.95) < 0.05, `persistence ${f.persistence}`);
  assert.ok(Math.abs(f.longRunVol - Math.sqrt(1e-4 * 252)) < 0.03);
  // 다음 날 분산이 장기 분산보다 크면 h일 예측 변동성은 그 사이로 내려온다
  const hi = { ...f, nextVar: f.longRunVar * 4 }, v1 = annualVol(garchHorizonVar(hi, 1), 1), v20 = annualVol(garchHorizonVar(hi, 20), 20);
  assert.ok(v1 > v20 && v20 > f.longRunVol);
  assert.equal(fitGarch([0.01]).ok, false);
});

test('HMM은 평온·고변동 두 국면을 나누고, 고정 모수 거르기는 미래 자료를 쓰지 않는다', () => {
  const x = []; for (let t = 0; t < 900; t++) x.push((t % 450 < 300 ? 0.006 : 0.025) * gauss());
  const h = fitHmm2(x);
  assert.ok(h.ok && h.stress.vol > 2.5 * h.calm.vol);
  assert.ok(h.pStressNow > 0.8, '마지막 구간은 고변동');
  const p = hmmFilter(x, h.params), q = hmmFilter(x.slice(0, 500), h.params);
  assert.deepEqual(p.slice(0, 500), q);
});

test('FHS VaR는 정규 자료에서 이론값에 가깝고, 몬테카를로는 재현 가능하다', () => {
  const r = Array.from({ length: 3000 }, () => 0.01 * gauss()), f = fitGarch(r), v = oneDayRisk(f, 0.95);
  assert.ok(Math.abs(v.VaR - 1.645 * Math.sqrt(f.nextVar)) < 0.004);
  assert.ok(v.ES > v.VaR);
  const a = simulateGarch(f, 20, { paths: 500, seed: 3, drift: false }), b = simulateGarch(f, 20, { paths: 500, seed: 3, drift: false });
  assert.deepEqual(a, b); assert.ok(a.p05 < a.median && a.median < a.p95);
  assert.ok(Math.abs(a.median) < 0.02, '추세 0이면 중앙값은 0 근처');
  assert.equal(volTargetWeight(0.3), 0.5); assert.equal(volTargetWeight(0.1), 1); assert.equal(volTargetWeight(NaN), null);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

test('충격 조건: 정의대로 잡고 같은 조건은 간격 안에서 한 번만 센다', () => {
  const ret = Array(300).fill(0.0005); ret[250] = -0.06; ret[255] = -0.05; ret[290] = -0.045;
  const f = indexFeatures(candlesFrom(ret, 1000));
  const c = CONDITIONS.find(x => x.id === 'ks-drop4-up');
  assert.deepEqual(eventIndexes(f, c), [250], '255일째 급락은 20거래일 안이라 한 번으로 센다');
  assert.deepEqual(eventIndexes(f, CONDITIONS.find(x => x.id === 'ks-drop4-down')), [255, 290], '첫 급락으로 200일선 아래로 내려간 뒤의 급락은 다른 조건');
  const act = activeConditions({ '^KS11': f }, () => null, 15);
  assert.ok(act.some(a => a.id === 'ks-drop4-down' && a.date === f.dates[290])); assert.ok(!act.some(a => a.id === 'ks-drop4-up'), '최근 15거래일 밖의 조건은 지금 해당하지 않음');
  assert.equal(RULES.combined.weight({ cl: [1], ma200: [2] }, 0, 0.3), 0);
  assert.equal(RULES.volTarget.weight({ vol20: [0.3] }, 0), 0.5);
});

test('현재가 교차 확인: 새 날짜는 붙이고, 다르면 보정하고, 사실을 남긴다', () => {
  const c = [{ date: '2026-11-05', open: 100, close: 100 }];
  const add = mergeQuote(c, { price: 95, pct: -5, status: 'OPEN', at: '2026-11-06T03:00:00Z' }, 'KR');
  assert.equal(add.candles.length, 2); assert.equal(add.candles[1].close, 95); assert.equal(add.status, 'open');
  const fix = mergeQuote(c, { price: 101, pct: 1, status: 'CLOSE', at: '2026-11-05T07:00:00Z' }, 'KR');
  assert.equal(fix.candles[0].close, 101); assert.ok(fix.notes.some(n => n.includes('보정')));
  const same = mergeQuote(c, { price: 100.1, pct: 0.1, status: 'CLOSE', at: '2026-11-05T07:00:00Z' }, 'KR');
  assert.equal(same.candles[0].close, 100);
  assert.equal(mergeQuote(c, null).status, 'unchecked');
  const us = mergeQuote([{ date: '2026-11-05', open: 1, close: 7300 }], { price: 7353.73, pct: -4.36, status: 'CLOSE', at: '2026-11-05T21:34:08Z' }, 'US');
  assert.equal(us.candles.length, 1, '뉴욕 날짜로 비교');
});

test('네이버 시세 주소·응답 해석', () => {
  assert.match(quoteUrls('^KS11')[0], /index\/KOSPI\/basic$/); assert.match(quoteUrls('^GSPC')[0], /index\/\.INX\/basic$/);
  assert.match(quoteUrls('005930.KS')[0], /stock\/005930\/basic$/); assert.equal(quoteUrls('NVDA').length, 4);
  assert.throws(() => quoteUrls('<script>'));
  const q = parseQuote({ stockName: '코스피', closePrice: '5,107.72', compareToPreviousClosePrice: '-276.08', fluctuationsRatio: '-5.13', marketStatus: 'OPEN', localTradedAt: '2026-11-06T13:40:00+09:00' });
  assert.equal(q.price, 5107.72); assert.equal(q.pct, -5.13); assert.equal(q.status, 'OPEN'); assert.equal(q.at, '2026-11-06T04:40:00.000Z');
  assert.equal(parseQuote({ closePrice: '-' }), null);
});

test('이슈 봇 시장 숫자도 현재가로 교차 확인한다', () => {
  const c = Array.from({ length: 61 }, (_, i) => ({ date: `2026-09-${String(i).padStart(2, '0')}`, close: 100 * (1 + (i % 2 ? 0.01 : -0.01)) }));
  const m = marketMove('^KS11', '코스피', '%', c);
  const fixed = applyQuote(m, { price: 95, pct: -5.1, status: 'OPEN' }, '2026-11-06');
  assert.equal(fixed.change, -5.1); assert.equal(fixed.source, '네이버 현재가'); assert.ok(fixed.z < -2);
  assert.equal(applyQuote(m, { price: m.last, pct: m.change }, m.date).source, 'Yahoo');
});

test('오늘 장 대응: 미국은 200일선+변동성, 한국은 변동성만, 다음 신호에 가격 기준선', () => {
  const up = candlesFrom(garchSeries(700, 0.08, 0.9, 1.5e-4).map(x => x + 0.0006), 100);
  const us = marketResponse({ symbol: 'X', name: '시험 지수', market: 'US', kind: 'index', candles: up });
  assert.ok(us.ok && us.useTrend); assert.ok(us.weight >= 0 && us.weight <= 1);
  assert.ok(us.triggers.some(t => t.when.includes('200일선')));
  const down = candlesFrom([...garchSeries(500, 0.08, 0.9, 1.5e-4), ...Array(200).fill(-0.004)], 100);
  const usDown = marketResponse({ symbol: 'X', name: '시험 지수', market: 'US', kind: 'index', candles: down });
  assert.equal(usDown.weight, 0, '200일선 아래면 0');
  const kr = marketResponse({ symbol: 'Y', name: '시험 종목', market: 'KR', kind: 'stock', candles: down });
  assert.ok(kr.weight > 0 && !kr.useTrend);
  assert.ok(!kr.today.join(' ').match(/사세요|파세요/));
  assert.equal(marketResponse({ symbol: 'Z', name: 'z', market: 'KR', candles: down.slice(0, 100) }).ok, false);
  const plan = holdingsPlan([{ ok: true, valueKrw: 1000, weight: 0.5, models: { var95: { VaR: 0.05 } } }, { ok: false }]);
  assert.deepEqual([plan.now, plan.keep, plan.toCash, plan.oneDayLoss95], [1000, 500, 500, 50]);
});

test('배포된 연구 파일은 지금 정의와 같은 버전이다', () => {
  const study = JSON.parse(readFileSync(new URL('../data/shock-study.json', import.meta.url), 'utf8'));
  const report = JSON.parse(readFileSync(new URL('../data/risk-model-report.json', import.meta.url), 'utf8'));
  assert.equal(study.version, ANALOG_VERSION, 'node scripts/build-market-research.mjs로 다시 만드십시오.');
  assert.equal(report.version, MODEL_VERSION);
  for (const c of CONDITIONS) assert.ok(study.conditions[c.id], c.id);
  for (const k of Object.keys(RULES)) assert.ok(Object.values(study.conditions)[0].response[k]);
});
