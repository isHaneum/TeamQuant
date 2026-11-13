import test from 'node:test';
import assert from 'node:assert/strict';
import { presetRules, nearestPreset, reviewRules, LOSS_OPTIONS, SECTOR_OPTIONS, CADENCE_OPTIONS } from '../lib/rule-presets.js';
import { normalizeRules } from '../lib/core-rules.js';

test('세 질문 → 규칙: 허용 손실·섹터 수·점검 주기가 숫자로 바뀌고 모두 규칙 범위 안이다', () => {
  for (const l of LOSS_OPTIONS) for (const s of SECTOR_OPTIONS) for (const c of CADENCE_OPTIONS) {
    const p = presetRules({ lossMonthly: l.id, sectors: s.id, cadence: c.id });
    assert.deepEqual(normalizeRules(p.rules).errors, [], JSON.stringify(p.rules));
    assert.equal(p.rules.maxTrades30, c.trades30); assert.equal(p.sectorCap, s.cap); assert.ok(p.explain.length >= 4);
  }
  const mid = presetRules({ lossMonthly: 10, sectors: 5, cadence: 'weekly' });
  assert.equal(mid.rules.dailyLoss, 2.2); assert.equal(mid.rules.maxSingle, 20); assert.equal(mid.rules.minCash, 10); assert.equal(mid.rules.volTarget, 21);
  const cons = presetRules({ lossMonthly: 5, sectors: 8, cadence: 'monthly' });
  assert.equal(cons.rules.dailyLoss, 1.1); assert.equal(cons.rules.maxSingle, 15); assert.equal(cons.rules.minCash, 20); assert.equal(cons.rules.maxTrades30, 4);
  const aggr = presetRules({ lossMonthly: 20, sectors: 3, cadence: 'urgent' });
  assert.equal(aggr.rules.dailyLoss, 4.4); assert.equal(aggr.rules.maxSingle, 25); assert.equal(aggr.rules.minCash, 5);
  // 모르는 값은 기본(10 · 5 · 주 1회)
  assert.deepEqual(presetRules({}).prefs, { lossMonthly: 10, sectors: 5, cadence: 'weekly' });
});

test('가장 가까운 프리셋을 되찾고, 손으로 고친 규칙은 custom 으로 표시한다', () => {
  const p = presetRules({ lossMonthly: 5, sectors: 3, cadence: 'monthly' });
  const n = nearestPreset(p.rules); assert.deepEqual([n.lossMonthly, n.sectors, n.cadence, n.custom], [5, 3, 'monthly', false]);
  const c = nearestPreset({ ...p.rules, dailyLoss: 3.3 }); assert.equal(c.custom, true);
});

test('기록으로 규칙 점검: 운용 일수·한도 초과일·매매 횟수(묶음 1회)·현금 평균·막힌 이유', () => {
  const marks = []; let t = 100_000_000; for (let i = 0; i < 25; i++) { t *= i === 10 ? 0.96 : 1.002; marks.push({ date: `2026-11-${String(10 + i).padStart(2, '0')}`, total: Math.round(t), cash: Math.round(t * 0.4), stock: Math.round(t * 0.6) }); }
  const now = new Date().toISOString();
  const status = { marks, recentOrders: [{ at: now, status: 'filled', batch: 'RB-1' }, { at: now, status: 'filled', batch: 'RB-1' }, { at: now, status: 'filled' }, { at: now, status: 'rejected' }], runs: [{ blockedReasons: { '30일 매매 횟수': 5, '장 시작 전입니다(09:00 KST).': 2 } }, { blockedReasons: { '30일 매매 횟수': 1 } }] };
  const r = reviewRules(status, { dailyLoss: 2.5, maxTrades30: 8, minCash: 10 }, { indexPct: 0.03 });
  assert.equal(r.days, 25); assert.equal(r.dailyBreaches, 1); assert.equal(r.trades30, 2); assert.ok(Math.abs(r.cashAvgPct - 40) < 0.01);
  assert.deepEqual(r.blockedTop[0], ['30일 매매 횟수', 6]);
  const keys = r.findings.map(f => f.key); assert.ok(keys.includes('change') && keys.includes('dailyLoss') && keys.includes('trades') && keys.includes('cash') && keys.includes('blocked'));
  assert.ok(r.findings.find(f => f.key === 'trades').suggest.includes('6건'));
  assert.ok(r.findings.find(f => f.key === 'cash').suggest, '현금이 최소보다 25%p 넘게 많음 → 제안');
  const short = reviewRules({ marks: marks.slice(0, 3), recentOrders: [], runs: [] }, { dailyLoss: 2.5, maxTrades30: 8, minCash: 10 });
  assert.ok(short.findings.some(f => f.key === 'short'));
});

// ── 결정 34(2026-11-13): 규칙 수준과 변경 잠금 ──
import { RULE_LEVELS, RULE_LOCK_DAYS, levelOf, levelRules, changeGate, applyChange } from '../lib/rule-presets.js';
import { DEFAULT_RULES as D0 } from '../lib/core-rules.js';
import { readFileSync as readF } from 'node:fs';
const DAY = 864e5, T0 = Date.parse('2026-11-13T03:00:00Z');

test('수준: 기본 = 검증에서 고른 기본 규칙(C), 안정 = 하루 손실 한도만 1.5%(B) · 자료 파일에 그 변형이 묶음 4개 모두 있다 · 다른 값은 직접 조정', () => {
  assert.deepEqual(levelRules('base'), D0); assert.equal(levelRules('steady').dailyLoss, 1.5); assert.deepEqual({ ...levelRules('steady'), dailyLoss: D0.dailyLoss }, D0);
  assert.equal(levelOf(D0), 'base'); assert.equal(levelOf({ ...D0, dailyLoss: 1.5 }), 'steady'); assert.equal(levelOf({ ...D0, dailyLoss: 2.2 }), 'custom'); assert.equal(levelOf({ ...D0, maxSingle: 20 }), 'custom'); assert.equal(levelOf(null), 'base');
  const v = JSON.parse(readF(new URL('../data/core-validation.json', import.meta.url), 'utf8'));
  for (const L of RULE_LEVELS) { const def = v.variants.find(x => x.id === L.variant); assert.ok(def && def.weekly === true, L.id); assert.equal(def.rules.dailyLoss, levelRules(L.id).dailyLoss);
    for (const p of Object.values(v.portfolios)) { const r = p.variants[L.variant]; assert.ok(Number.isFinite(r.all.mdd) && Number.isFinite(r.all.worst12) && Number.isFinite(r.all.cagr) && r.all.crisis && Number.isFinite(r.trading.tradesPerYear) && Number.isFinite(r.dailyLossBreach.rule), '화면이 읽는 필드'); assert.ok(Number.isFinite(p.hold.all.mdd) && p.hold.all.crisis); } }
});

test('변경 잠금: 처음 확정은 언제나 · 확정 뒤 28일 안에는 못 바꿈 · 28일 뒤에도 이유 10자 이상 · 같은 값은 변경이 아님 · 예전 저장분(확정 기록 없음)은 한 번 바로 확정', () => {
  assert.equal(RULE_LOCK_DAYS, 28);
  const first = applyChange(null, D0, { now: T0 }); assert.ok(first.ok && first.first); assert.equal(first.value.level, 'base'); assert.equal(first.value.history.length, 1); assert.equal(first.value.history[0].kind, 'confirm');
  const saved = first.value, next = { ...D0, dailyLoss: 1.5 };
  const early = changeGate(saved, next, { now: T0 + 27 * DAY, reason: '하루 한도를 넘은 날이 많아서 낮춤' }); assert.equal(early.ok, false); assert.equal(early.code, 'locked'); assert.match(early.why, /2026-12-11부터/); assert.deepEqual(early.changed, ['dailyLoss']);
  assert.equal(changeGate(saved, D0, { now: T0 + 40 * DAY, reason: '같은 값을 다시 저장해 본다' }).code, 'same');
  assert.equal(changeGate(saved, next, { now: T0 + 28 * DAY, reason: '짧음' }).code, 'reason');
  const ok = applyChange(saved, next, { now: T0 + 28 * DAY, reason: '하루 한도를 넘은 날이 많아서 낮춤' }); assert.ok(ok.ok && !ok.first); assert.equal(ok.value.level, 'steady'); assert.equal(ok.value.history.length, 2);
  assert.deepEqual(ok.value.history[1], { at: new Date(T0 + 28 * DAY).toISOString(), kind: 'change', changed: ['dailyLoss'], before: { dailyLoss: 2.5 }, after: { dailyLoss: 1.5 }, reason: '하루 한도를 넘은 날이 많아서 낮춤' });
  assert.equal(changeGate(ok.value, D0, { now: T0 + 29 * DAY, reason: '다시 되돌리고 싶어서 바꿔 본다' }).code, 'locked', '바꾼 날부터 다시 28일');
  const legacy = { rules: { ...D0, dailyLoss: 2.2 }, savedAt: '2026-11-09T00:00:00Z' }, g = changeGate(legacy, D0, { now: T0 }); assert.ok(g.ok && g.first, '확정 기록이 없는 예전 저장분');
  assert.equal(changeGate(saved, { ...D0, dailyLoss: 99 }, { now: T0 + 40 * DAY, reason: '범위를 벗어난 값을 넣어 본다' }).code, 'invalid');
  let v = saved; for (let k = 1; k <= 25; k++) v = applyChange(v, { ...D0, dailyLoss: k % 2 ? 1.5 : 2.5 }, { now: T0 + k * 28 * DAY, reason: '이력이 20건까지만 남는지 확인' }).value; assert.equal(v.history.length, 20);
});
