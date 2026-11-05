import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, strategyConfig, periodStart, runLabTest } from '../lib/strategy-lab.js';

// 합성 일봉: 120일 하락 후 120일 상승
function synthetic() {
  const out = []; let p = 100; const start = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 240; i++) { p *= i < 120 ? 0.995 : 1.01; const date = new Date(start + i * 86400000).toISOString().slice(0, 10); out.push({ date, open: p, high: p, low: p, close: p, volume: 1 }); }
  return out;
}

test('프리셋마다 엔진 규칙이 만들어진다', () => {
  for (const p of PRESETS) { const s = strategyConfig({ preset: p.id }); assert.ok(s.definition.entryRule && s.definition.exitRule, p.id); }
  assert.equal(strategyConfig({ preset: 'trend', stopLossPct: '8' }).config.stopLossPct, 8);
});

test('직접 쓴 문장은 자연어 변환기로 해석한다', () => {
  const s = strategyConfig({ preset: 'custom', text: '5일선이 20일선을 돌파하면 매수, 하향 돌파하면 매도. 손절 7%' });
  assert.equal(s.config.fastPeriod, 5); assert.equal(s.config.slowPeriod, 20); assert.equal(s.config.stopLossPct, 7);
});

test('기간 시작일은 오늘에서 개월 수를 뺀다', () => {
  assert.equal(periodStart('2026-11-05', 3), '2026-08-05');
  assert.equal(periodStart('2026-11-05', 12), '2025-11-05');
});

test('전략 결과를 그냥 보유와 같은 기간으로 비교한다', () => {
  const c = synthetic(), from = c[100].date;
  const t = runLabTest(c, c, strategyConfig({ preset: 'fast-trend' }).config, from);
  const hold = (c.at(-1).close / c[100].close - 1) * 100;
  assert.ok(Math.abs(t.hold.return - hold) < 0.01);
  assert.equal(t.market, t.hold.return); // 같은 시계열을 지수로 줬으므로 같다
  assert.ok(Number.isFinite(t.edge));
  assert.equal(t.curve[0].hold, 100);
  assert.ok(t.verdict.length > 0);
});
