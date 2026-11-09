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
