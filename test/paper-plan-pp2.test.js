// PP2 계획 파일(data/paper-plan.pp2.json)과 빌더(scripts/build-paper-plan-pp2.mjs): 비중+현금 = 100, 모든 비중에 이유, 같은 시세면 같은 결과(결정론), 시세는 밖에서만(네트워크 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPP2, coreWeights, indexLine, ETFS, PLAN_VERSION, PER_NAME_CAP, SATELLITE } from '../scripts/build-paper-plan-pp2.mjs';
import { WINDOWS } from '../lib/strategy-review.js';
import { DEFAULT_RULES } from '../lib/core-rules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sum = o => Object.values(o).reduce((a, b) => a + (typeof b === 'number' ? b : b.pct), 0);

test('PP2 파일: 비중 + 현금 = 100, 모든 비중에 why[], 지수 ETF 만, 위성은 비어 있음, 기본 계획을 대체하지 않는 후보 상태', () => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/paper-plan.pp2.json'), 'utf8'));
  assert.equal(d.version, PLAN_VERSION); assert.equal(d.status, 'candidate');
  assert.ok(Math.abs(sum(d.weights) + d.cashPct - 100) < 1e-6, `합 ${sum(d.weights)} + 현금 ${d.cashPct}`);
  assert.equal(d.cashPct, DEFAULT_RULES.minCash, '현금은 규칙 C3 현금 최소와 같다');
  for (const [s, w] of Object.entries(d.weights)) {
    assert.ok(Array.isArray(w.why) && w.why.length >= 3 && w.why.every(x => typeof x === 'string' && x.length > 5), `${s}: why`);
    assert.ok(w.why[0].includes('벤치마크 그대로'), `${s}: 첫 이유는 벤치마크`);
    assert.ok(w.pct > 0 && w.pct <= PER_NAME_CAP + 1e-9, `${s}: ${w.pct}% ≤ ${PER_NAME_CAP}%`);
    assert.equal(w.sector, 'index'); assert.ok(['KOSPI200', 'S&P500'].includes(w.index)); assert.ok(w.facts?.source && w.facts.fee && w.facts.listed);
    assert.ok(typeof w.name === 'string' && typeof w.currency === 'string' && typeof w.country === 'string' && Array.isArray(w.exposure), `${s}: 화면 호환 필드`);
  }
  assert.deepEqual(d.satellite.weights, {}); assert.equal(d.satellite.maxEachPct, SATELLITE.maxEachPct);
  // 국내 31 : 미국 54 비율(앱 비교선)
  const kr = Object.values(d.weights).filter(w => w.country === 'KR').reduce((a, w) => a + w.pct, 0), us = Object.values(d.weights).filter(w => w.country === 'US').reduce((a, w) => a + w.pct, 0);
  assert.ok(Math.abs(kr / us - 31 / 54) < 0.02, `KR ${kr} : US ${us}`);
  assert.ok(Array.isArray(d.method) && d.method.length >= 4 && Array.isArray(d.sources) && d.sources.length >= 8);
  const v = d.validation; assert.ok(Array.isArray(v.windows) && v.windows.length === 8 && Array.isArray(v.scenarios) && v.scenarios.length === 5 && v.summary && Array.isArray(v.honesty) && v.honesty.length >= 4);
  for (const w of v.windows.filter(x => x.ok)) { assert.ok(Number.isFinite(w.plan.rule.ret) && Number.isFinite(w.plan.rule.mdd) && w.plan.rule.mdd <= 0); assert.ok(w.indexMix && Number.isFinite(w.indexMix.ret), `${w.id}: 지수+현금 선`); }
  assert.ok(v.windows.filter(x => !x.ok).every(x => /상장 전/.test(x.reason)), '계산 안 한 창은 상장 전 사유만');
  assert.ok(v.switchover && v.switchover.turnoverKrw > 0 && Array.isArray(v.switchover.orders) && v.switchover.orders.length >= 8);
  assert.ok(Object.keys(v.review.rows.length ? v.review.rows[0].cells : {}).length >= 1 && v.review.rows.some(r => r.id === 'A_c5') && v.review.rows.some(r => r.id === 'A_c3'));
  assert.notEqual(JSON.parse(readFileSync(resolve(root, 'data/paper-plan.json'), 'utf8')).version, d.version, '기본 계획 파일은 그대로');
});

test('핵심 비중: 합은 정확히 100 − 현금, 한 종목 ≤ 상한, 국내 31 : 미국 54, 0.1% 단위', () => {
  for (const [variant, cash] of [['A', 10], ['A', 5], ['A', 3], ['B', 10]]) {
    const { weights, note } = coreWeights({ cashPct: cash, variant });
    assert.ok(Math.abs(sum(weights) - (100 - cash)) < 1e-9, `${variant}/${cash}: ${sum(weights)}`);
    for (const [s, p] of Object.entries(weights)) { assert.ok(Math.abs(p * 10 - Math.round(p * 10)) < 1e-9, `${s}: 0.1% 단위`); if (cash === 10) assert.ok(p <= PER_NAME_CAP + 1e-9, `${s} ${p}%`); }
    if (cash === 10) assert.equal(note, null);
    const list = variant === 'B' ? ETFS.SP500_US : ETFS.SP500_KR;
    assert.ok(list.every(e => weights[e.symbol] !== undefined) && ETFS.KR200.every(e => weights[e.symbol] !== undefined), '같은 지수 ETF 를 모두 쓴다');
  }
  const S = coreWeights({ cashPct: 10, variant: 'S' }).weights;
  assert.deepEqual(Object.keys(S).sort(), ['069500', '360750']); assert.ok(Math.abs(sum(S) - 90) < 1e-9); assert.ok(S['360750'] > 25, '2종목안은 한 종목 25% 규칙을 넘는다(규칙 변경 필요)');
});

test('지수선: 비율 × 비중 + 현금, 달러 부분은 환율을 곱한다', () => {
  const dates = ['2025-01-02', '2025-01-03', '2025-01-06'];
  const kr = dates.map((date, i) => ({ date, open: 100, close: 100 * (1 + 0.1 * i) })), us = dates.map((date, i) => ({ date, open: 10, close: 10 })), fx = dates.map((date, i) => ({ date, open: 1000, close: 1000 * (1 + 0.05 * i) }));
  const m = indexLine(dates, [{ candles: kr, currency: 'KRW', share: 50 }, { candles: us, currency: 'USD', share: 40 }], fx, 10);
  assert.equal(m.ret, 14); assert.equal(m.mdd, 0); // 0.1 + 0.5×1.2 + 0.4×1.1 = 1.14
  assert.equal(indexLine(dates, [{ candles: kr.slice(1), currency: 'KRW', share: 100 }], fx, 0), null, '첫날 시세가 없으면 선을 그리지 않는다');
});

// 합성 시세(결정론적 난수)로 빌더를 두 번 돌려 같은 결과가 나오는지. 네트워크는 금지(fetch 를 던지게 바꿈).
function synth(symbol, start = '2022-06-01', end = '2026-11-10', seed = 1, level = 10000, drift = 0.0004, vol = 0.012) {
  let s = seed * 2654435761 % 2147483647 || 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = []; let t = Date.parse(start), p = level;
  while (t <= Date.parse(end)) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) { const open = p * (1 + (rnd() - 0.5) * vol * 0.5); p *= 1 + drift + (rnd() - 0.5) * vol * 2; out.push({ date: d.toISOString().slice(0, 10), open, close: p }); } t += 864e5; }
  return out;
}
const PP1_SMALL = { version: 'PP1-test', cashPct: 15, weights: { '069500': { pct: 40, name: 'KODEX 200', currency: 'KRW', country: 'KR', sector: 'index' }, SPY: { pct: 45, name: 'S&P500 ETF', currency: 'USD', country: 'US', sector: 'index' } }, validation: { windows: [{ id: 'y2025', ok: true, plan: { rule: { ret: 1, mdd: -1 }, hold: { ret: 2, mdd: -2 } } }] } };
const SNAP = { asOf: '2026-11-10T07:00:00.000Z', balance: { total: 100_000_000, positions: [{ symbol: '005930', name: '삼성전자', valueKrw: 5_000_000 }, { symbol: '069500', name: 'KODEX 200', valueKrw: 9_000_000 }] }, limits: { maxOrderKrw: 15_000_000, maxDailyKrw: 60_000_000 } };
function inputs() {
  const candles = {}; let k = 1;
  for (const e of Object.values(ETFS).flat()) candles[e.symbol] = synth(e.symbol, '2022-06-01', e.symbol.length === 6 ? '2026-11-10' : '2026-11-09', k++, e.symbol.length === 6 ? 20000 : 400);
  candles['005930'] = synth('005930', '2022-06-01', '2026-11-10', 99, 70000);
  const fx = synth('KRW=X', '2022-06-01', '2026-11-10', 77, 1350, 0, 0.004);
  return { candles, fx, today: '2026-11-10', pp1: structuredClone(PP1_SMALL), snapshot: structuredClone(SNAP), windows: [{ id: 'recent12m', label: '최근 12개월', from: '2025-11-10' }, { id: 'y2025', label: '2025년', from: '2025-01-01', to: '2025-12-31' }], reviewWindows: [WINDOWS[0]] };
}

test('빌더는 시세를 밖에서만 받고(네트워크 없음) 같은 입력이면 같은 결과를 낸다', { timeout: 120_000 }, () => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('빌더가 네트워크를 썼다'); };
  try {
    const pp1Before = JSON.stringify(PP1_SMALL);
    const a = buildPP2(inputs()), b = buildPP2(inputs());
    delete a.generatedAt; delete b.generatedAt;
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(PP1_SMALL), pp1Before, '입력을 바꾸지 않는다');
    assert.ok(Math.abs(sum(a.weights) + a.cashPct - 100) < 1e-6);
    for (const w of a.validation.windows) { assert.ok(w.ok, w.reason); assert.ok(Number.isFinite(w.plan.rule.ret) && Number.isFinite(w.indexMix.ret) && Number.isFinite(w.pp1.rule.ret)); }
    assert.deepEqual(a.validation.windowsAll[1].pp1Published, { rule: { ret: 1, mdd: -1 }, hold: { ret: 2, mdd: -2 } }, 'PP1 파일의 숫자는 참고로만 옮긴다');
    for (const id of ['A', 'A_c5', 'A_c3', 'A_dl5', 'B', 'S', 'S_ms60', 'PP1']) assert.ok(a.validation.windowsAll[0].variants[id]?.ok, `${id}: ${JSON.stringify(a.validation.windowsAll[0].variants[id])}`);
    const S = a.validation.windowsAll[0].variants.S, S60 = a.validation.windowsAll[0].variants.S_ms60;
    assert.ok(S.cashAvgPct > S60.cashAvgPct, `2종목안은 지금 규칙(한 종목 25%)에 잘려 현금이 남는다: ${S.cashAvgPct}% vs ${S60.cashAvgPct}%`);
    assert.equal(a.validation.scenarios.length, 5); assert.ok(a.validation.scenarios.every(s => Number.isFinite(s.planPct) && Number.isFinite(s.pp1Pct) && Number.isFinite(s.currentPct)));
    assert.equal(a.validation.scenarios.find(s => s.id === 'krw').planPct, -Math.round(Object.values(a.weights).filter(w => w.country === 'US').reduce((x, w) => x + w.pct, 0) * 0.1 * 10) / 10, '원화 강세 충격은 국내 상장이라도 달러 노출 ETF 에 걸린다');
    const sw = a.validation.switchover; assert.ok(sw.orders.some(o => o.symbol === '005930' && o.side === 'SELL' && o.amountKrw === 5_000_000)); assert.ok(sw.orders.every(o => o.symbol !== '069500' || o.side === 'BUY'), 'KODEX 200 은 팔지 않고 채운다');
    assert.equal(sw.turnoverKrw, sw.sellKrw + sw.buyKrw); assert.equal(sw.limits.sessionsByDailyCap, Math.ceil(sw.turnoverKrw / 60_000_000));
    assert.ok(a.validation.review.rows.length === 6 && a.validation.review.rows.every(r => r.cells.w3?.ok), '규칙 묶음 표: C3 + 프리셋 3 + 현금 5%·3%');
  } finally { globalThis.fetch = realFetch; }
});
