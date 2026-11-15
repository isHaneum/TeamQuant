// 결정 36(2026-11-15): 계획(목표 비중) 변경 한도 30일 2회 · 바꾸기 전 예상 거래대금 · 모의계좌 엔진은 한도를 넘는 계획 파일을 받아들이지 않는다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSig, planChangeGate, planDiff, planTurnover, planChangeSize, PLAN_CHANGE_MAX, PLAN_CHANGE_DAYS } from '../lib/rule-presets.js';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';
import { publicSnapshot } from '../lib/paper-public.js';

const DAY = 864e5, T0 = Date.parse('2026-11-16T01:30:00Z');

test('계획 변경 한도: 30일 안에 2번까지 · 다시 가능한 날은 가장 오래된 변경에서 30일 뒤', () => {
  assert.equal(PLAN_CHANGE_MAX, 2); assert.equal(PLAN_CHANGE_DAYS, 30);
  assert.deepEqual(planChangeGate([], { now: T0 }), { ok: true, used: 0, max: 2, days: 30, left: 2, allowedAt: null });
  const one = [{ at: new Date(T0 - 3 * DAY).toISOString() }]; assert.equal(planChangeGate(one, { now: T0 }).ok, true); assert.equal(planChangeGate(one, { now: T0 }).left, 1);
  const two = [...one, { at: new Date(T0 - DAY).toISOString() }], g = planChangeGate(two, { now: T0 });
  assert.equal(g.ok, false); assert.equal(g.used, 2); assert.equal(g.allowedAt, new Date(T0 - 3 * DAY + 30 * DAY).toISOString());
  assert.equal(planChangeGate(two, { now: T0 + 27 * DAY + 1 }).ok, true, '가장 오래된 변경이 30일을 넘기면 다시 된다');
  assert.equal(planChangeGate([{ at: new Date(T0 - 31 * DAY).toISOString() }, { at: 'x' }], { now: T0 }).used, 0, '30일 넘은 기록과 읽을 수 없는 시각은 세지 않는다');
});

test('계획 지문 · 바뀌는 비중: 이름과 설명은 변경이 아니고 비중 · 끝까지 살 비중 · 정리 여부는 변경이다', () => {
  const a = { '005930': { pct: 3, targetPct: 5, name: '삼성전자', why: 'x' }, SPY: { pct: 28.6 }, '105560': { pct: 0, exit: true } };
  assert.equal(planSig(a), planSig({ SPY: 28.6, '105560': { pct: 0, exit: true, name: 'KB금융' }, '005930.KS': { pct: 3, targetPct: 5, name: '다른 이름', why: 'y' } }));
  assert.notEqual(planSig(a), planSig({ ...a, '005930': { pct: 4.4, targetPct: 5 } }));
  assert.notEqual(planSig(a), planSig({ ...a, '005930': { pct: 3, targetPct: 7 } }));
  assert.notEqual(planSig(a), planSig({ ...a, '105560': { pct: 0 } }), '정리 표시가 빠지면 다른 계획이다');
  assert.deepEqual(planDiff(a, { ...a, '005930': { pct: 4.39, name: '삼성전자' }, NVDA: { pct: 2.84, name: '엔비디아' } }), [{ symbol: 'NVDA', name: '엔비디아', fromPct: 0, toPct: 2.84 }, { symbol: '005930', name: '삼성전자', fromPct: 3, toPct: 4.39 }]);
});

test('예상 거래대금: 보유와 목표의 차이를 더한다 · 계획에 없는 보유는 그대로 · 정리 종목은 전량 매도', () => {
  const positions = [{ symbol: '005930', name: '삼성전자', valueKrw: 3_000_000 }, { symbol: '105560', name: 'KB금융', valueKrw: 1_000_000 }, { symbol: 'TSLA', name: '테슬라', valueKrw: 2_000_000 }];
  const t = planTurnover({ positions, cashKrw: 94_000_000, plan: { '005930': { pct: 4.4 }, '105560': { pct: 0, exit: true }, SPY: { pct: 10, name: 'S&P500 ETF' }, MSFT: { pct: 0 } } });
  assert.equal(t.totalKrw, 100_000_000); assert.equal(t.buyKrw, 1_400_000 + 10_000_000); assert.equal(t.sellKrw, 1_000_000); assert.equal(t.tradedKrw, 12_400_000); assert.equal(t.tradedPct, 12.4);
  assert.deepEqual(t.items.map(i => i.symbol), ['SPY', '005930', '105560'], 'TSLA(계획에 없음)와 비중 0(정리 아님)은 넣지 않는다');
  assert.equal(planTurnover({ positions: [], cashKrw: 0, plan: { SPY: 10 } }), null);
  // 계획이 바뀌는 크기는 보유와 무관하다: 3→4.4 와 3→1.6 이면 비중 차이 합계 2.8%
  assert.deepEqual(planChangeSize({ A: 3, B: 3, C: 10 }, { A: 4.4, B: 1.6, C: 10 }, 100_000_000), { changePct: 2.8, changeKrw: 2_800_000 });
  assert.deepEqual(planChangeSize({ A: 3 }, { A: 3 }), { changePct: 0, changeKrw: null });
});

function engine({ max = 2 } = {}) {
  const state = { t: T0, doc: null, next: null };
  const mk = (version, pct) => ({ version, weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '005930': { pct, targetPct: 5, tranche: 1, name: '삼성전자', currency: 'KRW', role: 'satellite' } } });
  state.doc = mk('A', 3);
  const series = () => { const out = []; for (let t = Date.parse('2025-06-01'); t <= Date.parse('2027-03-31'); t += DAY) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), open: 70000, close: 70000 }); } return out; };
  const readMarket = async s => ({ candles: s === 'KRW=X' ? series().map(c => ({ ...c, open: 1400, close: 1400 })) : series() });
  const pos = [{ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', qty: 43, price: 70000, value: 3_010_000, valueKrw: 3_010_000 }];
  const client = { settings: () => ({ mode: 'vps', accountMasked: '****0000' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: 70000, upper: 0, lower: 0, halted: false }; },
    async balance() { return { cash: 96_990_000, total: 100_000_000, stock: 3_010_000, positions: pos, cashUsd: 0, stockUsd: 0 }; }, async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
  const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-pg-'))), readMarket, now: () => state.t, defaultPlanDoc: () => state.doc, nextPlanDoc: () => state.next, planChangeMax: max, planChangeDays: 30 });
  return { pl, state, mk };
}

test('모의계좌 엔진: 30일 안 세 번째 계획 파일은 받아들이지 않고 지금 계획으로 운용 · 한도가 풀리면 적용 · 이름만 바뀐 것은 세지 않는다', async () => {
  const { pl, state, mk } = engine();
  let st = await pl.status(); assert.equal(st.defaultPlanVersion, 'A'); assert.deepEqual([st.planChange.used, st.planChange.left, st.planChange.pending, st.planChange.candidate], [0, 2, null, null]); assert.ok(st.planChange.since);
  state.doc = { ...mk('A', 3), note: '설명만 바꿈' }; st = await pl.status(); assert.equal(st.planChange.used, 0, '설명만 바뀐 것은 변경이 아니다'); assert.equal(st.planDoc.note, '설명만 바꿈');
  state.t += DAY; state.doc = mk('B', 3.5); st = await pl.status(); assert.equal(st.defaultPlanVersion, 'B'); assert.equal(st.planChange.used, 1);
  state.t += DAY; state.doc = mk('C', 4); st = await pl.status(); assert.equal(st.defaultPlanVersion, 'C'); assert.equal(st.planChange.used, 2); assert.ok(st.planChange.allowedAt);
  state.t += DAY; state.doc = mk('D', 4.5); st = await pl.status();
  assert.equal(st.defaultPlanVersion, 'C', '세 번째는 받아들이지 않는다'); assert.equal(st.planDoc.version, 'C'); assert.match(st.planVersionNow, /^C/); assert.equal(pl.planDoc().weights['005930'].pct, 4);
  assert.equal(st.planChange.pending.version, 'D'); assert.equal(st.planChange.pending.allowedAt, new Date(T0 + DAY + 30 * DAY).toISOString());
  assert.deepEqual(st.planChange.pending.diff, [{ symbol: '005930', name: '삼성전자', fromPct: 4, toPct: 4.5 }]);
  assert.equal(st.planChange.pending.turnover.tradedKrw, 14_500_000 - 3_010_000, '대기 계획대로 맞출 때 사고파는 금액(지수 10% + 삼성전자 4.5% − 보유)');
  assert.equal((await pl.preview({})).planSize, 2); assert.equal(pl._ledger().planChanges.length, 2);
  state.doc = mk('C', 4); st = await pl.status(); assert.equal(st.planChange.pending, null, '파일을 지금 계획으로 되돌리면 대기가 사라진다');
  state.doc = mk('D', 4.5); state.t = T0 + DAY + 30 * DAY + 1; st = await pl.status();
  assert.equal(st.defaultPlanVersion, 'D', '가장 오래된 변경이 30일을 넘기면 받아들인다'); assert.equal(st.planChange.pending, null); assert.equal(st.planChange.used, 2);
});

test('모의계좌 엔진: 후보 계획은 적용하지 않고 예상 거래대금만 보인다 · 공개 파일에 실린다 · 한도 0 이면 파일을 그대로 쓴다', async () => {
  const { pl, state, mk } = engine();
  state.next = { ...mk('N', 4.4), label: '후보', note: '설명' };
  const st = await pl.status(); assert.equal(st.defaultPlanVersion, 'A'); assert.equal(st.planChange.used, 0);
  assert.equal(st.planChange.candidate.version, 'N'); assert.equal(st.planChange.candidate.label, '후보');
  assert.equal(st.planChange.candidate.turnover.tradedKrw, 14_400_000 - 3_010_000); assert.equal(st.planChange.candidate.turnover.changePct, 1.4); assert.equal(st.planChange.candidate.turnover.changeKrw, 1_400_000); assert.equal(st.planChange.candidate.turnover.baseTradedKrw, 10_000_000 + 10_000, '지금 계획대로: 지수 1,000만 원 매수 + 삼성전자 1만 원 매도(사는 금액과 파는 금액을 더한다)');
  const pub = publicSnapshot(st, { asOf: new Date(state.t).toISOString() });
  assert.equal(pub.planChange.candidate.version, 'N'); assert.equal(pub.planChange.max, 2); assert.equal(pub.planChange.candidate.turnover.changeKrw, 1_400_000); assert.deepEqual(pub.planChange.candidate.diff, [{ symbol: '005930', name: '삼성전자', fromPct: 3, toPct: 4.4 }]);
  assert.doesNotMatch(JSON.stringify(pub.planChange), /odno|orgno|ledger|\*\*\*\*/);
  state.next = mk('A', 3); assert.equal((await pl.status()).planChange.candidate, null, '지금 계획과 같은 후보는 보이지 않는다');
  const off = engine({ max: 0 }); off.state.doc = off.mk('Z', 9); const s2 = await off.pl.status(); assert.equal(s2.planDoc.version, 'Z'); assert.equal(s2.planChange, null); assert.equal(off.pl._ledger().planAdopted, undefined);
});

test('후보 계획 파일(data/paper-plan.next.json): 지금 계획과 종목이 같고 개별 종목 합계가 같으며 한도 안이다', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), f = join(root, 'data/paper-plan.next.json'); if (!existsSync(f)) return;
  const next = JSON.parse(readFileSync(f, 'utf8')), plan = JSON.parse(readFileSync(join(root, 'data/paper-plan.json'), 'utf8'));
  if (next.basedOn !== plan.version) return; // 계획이 바뀐 뒤의 옛 후보는 엔진이 지금 계획과 비교해 보여 줄 뿐이다
  assert.deepEqual(Object.keys(next.weights).sort(), Object.keys(plan.weights).sort()); assert.notEqual(next.version, plan.version);
  const sat = d => Object.values(d.weights).filter(w => w.role === 'satellite'), sum = d => sat(d).reduce((a, w) => a + w.pct, 0);
  assert.ok(Math.abs(sum(next) - sum(plan)) < 0.06, `${sum(next)} vs ${sum(plan)}`);
  for (const w of sat(next)) { assert.ok(w.pct > 0 && w.pct <= plan.caps.single && w.targetPct <= plan.caps.single && w.targetPct >= w.pct, JSON.stringify(w)); }
  for (const [k, w] of Object.entries(plan.weights)) if (w.role !== 'satellite') assert.equal(next.weights[k].pct, w.pct, `${k}: 지수·정리 종목은 그대로`);
  assert.ok(String(next.note || '').length > 10 && String(next.label || '').length > 0);
});
