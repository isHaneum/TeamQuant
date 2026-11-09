// 전략 검토: 규칙 묶음 × 기간 표가 리허설과 같은 숫자를 내고, 결론은 기간을 가로지르는 사실만 적는다. 합성 시세만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRuleSets, PRESET_SETS, WINDOWS, findings, fitPlan } from '../lib/strategy-review.js';
import { rehearse } from '../lib/paper-trading.js';
import { DEFAULT_RULES } from '../lib/core-rules.js';
import { rng } from '../lib/risk-models.js';

const R = rng(11); const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
const days = (n, start = '2024-06-03') => { const out = []; let t = Date.parse(start); while (out.length < n) { const d = new Date(t); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10)); t += 864e5; } return out; };
const walk = (dates, vol = 0.015, drift = 0.0002, start = 50_000) => { let p = start; return dates.map(date => { const open = p * Math.exp(vol * 0.3 * gauss()); p *= Math.exp(drift + vol * gauss()); return { date, open, close: p }; }); };
const D = days(640), TO = D.at(-1);
const basket = [{ symbol: 'A', name: '가', currency: 'KRW' }, { symbol: 'B', name: '나', currency: 'KRW' }, { symbol: 'U', name: '미국', currency: 'USD' }];
const candles = { A: walk(D, 0.015, 0.0003), B: walk(D, 0.02, 0), U: walk(D, 0.018, 0.0004, 150) };
const fx = D.map((date, k) => ({ date, open: 1350, close: 1350 + 30 * Math.sin(k / 40) }));
const bench = { symbol: 'IDX', name: '지수', currency: 'KRW', candles: walk(D, 0.01, 0.0002, 300) };

test('세 프리셋은 보수→적극 순으로 하루 손실 한도가 커지고, 표는 네 기간 × (지금 규칙 + 3) 칸을 채운다', () => {
  assert.deepEqual(PRESET_SETS.map(s => s.rules.dailyLoss), [1.1, 2.2, 4.4]);
  const r = compareRuleSets({ basket, plan: { A: 30, B: 30, U: 25 }, candlesBySymbol: candles, fxCandles: fx, benchmark: bench, to: TO, current: { label: '내 규칙', rules: DEFAULT_RULES } });
  assert.equal(r.rows.length, 4); assert.equal(r.rows[0].id, 'current'); assert.equal(r.windows.length, WINDOWS.length);
  for (const row of r.rows) for (const w of r.windows) { const c = row.cells[w.id]; assert.ok(c.ok, `${row.id}/${w.id}: ${c.reason}`); assert.ok(Number.isFinite(c.ret) && Number.isFinite(c.mdd) && c.mdd <= 0); }
  assert.ok(r.hold.w6 && Number.isFinite(r.hold.w6.ret)); assert.equal(r.bench.w6.name, '지수');
  assert.ok(r.findings.length >= 3 && r.findings.at(-1).key === 'caution');
});

test('표의 칸은 같은 입력으로 돌린 리허설과 같다(결정론)', () => {
  const r = compareRuleSets({ basket, candlesBySymbol: candles, fxCandles: fx, to: TO, ruleSets: [PRESET_SETS[1]], windows: [WINDOWS[1]] });
  const from = r.windows[0].from, direct = rehearse({ basket, capitalKrw: 10_000_000, rules: PRESET_SETS[1].rules, candlesBySymbol: candles, fxCandles: fx, from, to: TO });
  const c = r.rows[0].cells.w6; assert.equal(c.ret, Math.round(direct.metrics.rule.ret * 1000) / 10); assert.equal(c.trades, direct.activity.trades); assert.equal(c.vsHold, Math.round(direct.diff.vsHoldPct * 10) / 10);
});

test('결론: 모든 기간에서 보유보다 손실이 작은 규칙만 이름을 올리고, 없으면 엇갈린다고 적는다', () => {
  const ws = [{ id: 'a' }, { id: 'b' }], hold = { a: {}, b: {} };
  const rows = [{ label: 'X', cells: { a: { ok: true, mddVsHold: 2, vsHold: -1, mdd: -5, trades: 3 }, b: { ok: true, mddVsHold: 1, vsHold: 1, mdd: -8, trades: 2 } } }, { label: 'Y', cells: { a: { ok: true, mddVsHold: -1, vsHold: 2, mdd: -12, trades: 9 }, b: { ok: true, mddVsHold: 3, vsHold: -2, mdd: -3, trades: 1 } } }];
  const f = findings(rows, ws, hold), by = Object.fromEntries(f.map(x => [x.key, x.text]));
  assert.ok(by.mdd.includes('X') && !by.mdd.includes('Y')); assert.ok(by.ret.includes('어느 규칙도')); assert.ok(by.worst.includes('X')); assert.ok(by.trades.includes('Y'));
  assert.equal(findings(rows, ws, {})[0].key, 'none');
});

test('계획 비중 맞추기: 한 종목 상한으로 자르고, 합이 현금 최소를 침범하면 비율로 줄인다', () => {
  assert.deepEqual(fitPlan({ A: 30, B: 30, C: 25 }, { maxSingle: 25, minCash: 10 }), { A: 25, B: 25, C: 25 });
  const f = fitPlan({ A: 50, B: 45 }, { maxSingle: 50, minCash: 20 }); assert.ok(Math.abs(f.A + f.B - 80) < 0.2 && f.A > f.B);
  assert.equal(fitPlan(null, { maxSingle: 25, minCash: 10 }), null);
  assert.deepEqual(fitPlan({ A: 10, B: 0 }, { maxSingle: 25, minCash: 10 }), { A: 10 });
});
