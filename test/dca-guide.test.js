// 월급 적립(결정 41): 계좌 순서·환급·상품 고르기·규칙 문장이 data/dca-guide.json 의 숫자만으로 정해지는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planGuide, accountPlan, categoryPick, isaExample, normalizeInput, pensionRate } from '../lib/dca-guide.js';
import { RULE_LOCK_DAYS } from '../lib/rule-presets.js';

const guide = JSON.parse(readFileSync(new URL('../data/dca-guide.json', import.meta.url), 'utf8'));
const tax = guide.tax;
const near = (a, b, d = 1) => assert.ok(Math.abs(a - b) <= d, `${a} ≈ ${b}`);

test('자료 파일: 모든 범주에 기준일·출처가 있고 비용은 양수, 잠금 일수는 규칙 화면과 같다', () => {
  assert.equal(guide.lockDays, RULE_LOCK_DAYS);
  for (const c of guide.categories) {
    assert.match(c.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(c.src?.u?.startsWith('https://') && c.src.d, c.id);
    assert.ok(c.items.length >= 2, c.id);
    for (const i of c.items) assert.ok(i.cost > 0 && i.cost < 1, i.name);
  }
  for (const k of ['pension', 'isa']) assert.ok(tax[k].src.length, k);
});

test('연봉 4,000만 · 매달 30만 중 노후용 20만 → 연금저축 20만(16.5% → 1년 39.6만), ISA 10만', () => {
  const r = planGuide({ monthly: 300000, salaryMan: 4000, oldAge: 200000, mix: { us500: 100 } }, guide);
  const by = id => r.plan.rows.find(x => x.id === id);
  assert.equal(r.plan.rate, 0.165);
  assert.equal(by('pension').monthly, 200000);
  assert.equal(by('pension').refundMax, 396000);
  assert.equal(by('irp').monthly, 0);
  assert.equal(by('isa').monthly, 100000);
  assert.equal(by('general').monthly, 0);
  assert.equal(r.plan.refundMax, 396000);
  assert.equal(r.plan.isaLow, true);
});

test('연봉 6,000만 · 매달 100만 중 노후용 80만 → 연금저축 50만 · IRP 25만(13.2%), 나머지 25만은 ISA', () => {
  const p = accountPlan(normalizeInput({ monthly: 1000000, salaryMan: 6000, oldAge: 800000 }, guide), tax);
  const by = id => p.rows.find(x => x.id === id);
  assert.equal(p.rate, 0.132);
  assert.equal(by('pension').monthly, 500000);
  assert.equal(by('irp').monthly, 250000);
  assert.equal(by('isa').monthly, 250000);
  assert.equal(p.refundMax, Math.round(500000 * 12 * 0.132) + Math.round(250000 * 12 * 0.132));
  assert.equal(p.isaLow, false);
});

test('월급이 없으면 공제가 0원이라 노후용 돈도 ISA로, ISA 한도를 넘는 돈만 일반 계좌로', () => {
  const p = accountPlan(normalizeInput({ monthly: 2000000, salaryMan: '', oldAge: 500000 }, guide), tax);
  const by = id => p.rows.find(x => x.id === id);
  assert.equal(p.noSalary, true);
  assert.equal(p.refundMax, 0);
  assert.equal(by('pension').monthly, 0);
  assert.equal(by('isa').monthly, Math.floor(20000000 / 12));
  assert.equal(by('general').monthly, 2000000 - Math.floor(20000000 / 12));
  assert.equal(pensionRate(0, tax), 0);
});

test('노후용이 매달 넣을 돈보다 크면 매달 넣을 돈까지만 본다', () => {
  assert.equal(normalizeInput({ monthly: 100000, salaryMan: 3000, oldAge: 900000 }, guide).oldAge, 100000);
});

test('같은 지수에서 비용이 가장 낮은 큰 상품을 고르고, 순자산 1,000억 미만은 고르지 않는다', () => {
  const us = categoryPick(guide.categories.find(c => c.id === 'us500'));
  assert.equal(us.pick.name, 'ACE 미국S&P500');
  assert.equal(us.small, 3);
  assert.equal(us.dear.name, 'SOL 미국S&P500');
  assert.equal(us.per10m, 4470);
  const kr = categoryPick(guide.categories.find(c => c.id === 'kr200'));
  assert.equal(kr.pick.name, 'RISE 200');
  assert.equal(kr.per10m, 13140);
});

test('섞는 비율은 합이 100이 아니면 비율로 맞추고, 비면 첫 범주 100%', () => {
  assert.deepEqual(normalizeInput({ monthly: 1, mix: { us500: 60, kr200: 60 } }, guide).mix, { us500: 50, kr200: 50 });
  assert.deepEqual(normalizeInput({ monthly: 1, mix: {} }, guide).mix, { us500: 100, kr200: 0 });
});

test('ISA 예시: 해외 지수 몫만 세금을 아끼고(한국 주식 ETF는 0), 비과세 한도를 넘는 이익은 9.9%', () => {
  const a = isaExample({ isaMonthly: 100000, abroadShare: 1, isaLow: false }, tax);
  assert.ok(a.profit > 0 && a.profit < 2000000);
  near(a.saved, a.profit * 0.154);
  assert.equal(isaExample({ isaMonthly: 100000, abroadShare: 0, isaLow: false }, tax).saved, 0);
  const big = isaExample({ isaMonthly: 1500000, abroadShare: 1, isaLow: false }, tax);
  assert.ok(big.profit > 2000000);
  near(big.saved, big.profit * 0.154 - (big.profit - 2000000) * 0.099);
  const low = isaExample({ isaMonthly: 1500000, abroadShare: 1, isaLow: true }, tax);
  assert.ok(low.saved > big.saved);
});

test('규칙 문장: 금액·계좌·상품이 들어가고 질문형이 없다', () => {
  const r = planGuide({ monthly: 300000, salaryMan: 4000, oldAge: 200000, mix: { us500: 70, kr200: 30 } }, guide);
  assert.match(r.rule, /300,000원/);
  assert.match(r.rule, /연금저축 200,000원/);
  assert.match(r.rule, /ISA 100,000원/);
  assert.match(r.rule, /ACE 미국S&P500/);
  assert.match(r.rule, /RISE 200/);
  assert.match(r.rule, /모자란 쪽부터/);
  assert.match(r.rule, /28일/);
  assert.doesNotMatch(r.rule, /\?|할까요/);
  assert.doesNotMatch(r.rule, /IRP ?에서는/, 'IRP 에 넣는 돈이 없으면 IRP 문장도 없다');
});

test('규칙 문장: IRP 에 넣는 돈이 있으면 30% 이상 안전자산 문장을 넣는다(법정 위험자산 70% · 교차 검증 F25)', () => {
  const r = planGuide({ monthly: 1000000, salaryMan: 6000, oldAge: 800000, mix: { us500: 100 } }, guide);
  assert.ok(r.plan.rows.find(x => x.id === 'irp').monthly > 0);
  // 2026-11-26 쉬운 말 정리: 조사는 붙여 쓴다(IRP에서는).
  assert.match(r.rule, /IRP에서는 30% 이상을 예금이나 채권형으로 둔다\(주식형은 법으로 70%까지\)/);
});

test('수수료: 매달 30만 원 × 0.015% = 45원, 비용 차이는 섞는 비율로 가중', () => {
  const r = planGuide({ monthly: 300000, mix: { us500: 50, kr200: 50 } }, guide);
  assert.equal(r.brokerMonthly, 45);
  assert.equal(r.costPer10m, Math.round(4470 * 0.5 + 13140 * 0.5));
});
