// 결정 37(2026-11-15): 근거 카드 구조 질문(⑥ 수요·돈 내는 곳 ⑦ 중국 경쟁) · 같은 깨짐 조건 묶음은 하나만 · 분기 자료 이상은 판정 보류 · 구조로 막힌 종목은 더 사지 않는다. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkEntry, judgeStructure, applyStructure, STRUCTURE_RULES, LABELS } from '../lib/structure-cards.js';
import { buildCard, buildPlan } from '../lib/thesis-cards.js';
import { createPaperLive, createLedgerStore } from '../lib/paper-live.js';

const J = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const fact = (t = '사실') => ({ text: t, url: 'https://example.com/a', date: '2026-10-01', period: '3Q26', kind: 'fact' });
const entry = (over = {}) => ({ name: '가', cluster: 'memory', asOf: '2026-11-15',
  demand: { grade: 'tail', driver: 'AI 메모리', payer: 'corporate', pricing: 'market', text: '수요는 구조적으로 늘고 돈은 기업 설비투자가 낸다.', facts: [fact(), fact()] },
  china: { grade: 'mid', competitors: ['CXMT'], chinaRevenuePct: 19.7, defense: ['tech', 'policy'], text: '중국 경쟁자가 범용 제품에서 점유율을 늘린다.', facts: [fact(), fact()] },
  breaks: [{ id: 'b1', text: 'CXMT 점유율 15% 이상', metric: '점유율', threshold: '15% 이상', source: 'Omdia', every: '분기', now: 'clear', evidence: '7.6%' }], ...over });
const passCard = (key, over = {}) => ({ key, name: key, market: 'KR', currency: 'KRW', sector: 'IT', verdict: 'pass', why: ['성장'], breaks: ['b'], review: null, growth: { rank: 0.9 }, value: { pct: 0.2 }, ...over });

test('구조 판정: 수요 역풍 · 중국 경쟁 높음 · 깨짐 조건 충족 · 답이 오래됨 · 답 없음이면 막고, 이유를 남긴다', () => {
  assert.deepEqual(checkEntry('A', entry()), []);
  const ok = judgeStructure(entry(), { today: '2026-11-15' }); assert.equal(ok.ok, true); assert.equal(ok.why.length, 2); assert.match(ok.why[0], /^수요: 순풍 — AI 메모리 · 돈 내는 곳 기업 투자/); assert.match(ok.why[1], /^중국: 중간 — 경쟁 CXMT · 중국 매출 19.7% · 방어선 기술·정책/);
  const head = judgeStructure(entry({ demand: { ...entry().demand, grade: 'head' } }), { today: '2026-11-15' }); assert.equal(head.ok, false); assert.match(head.reasons[0], /수요 역풍/);
  const high = judgeStructure(entry({ china: { ...entry().china, grade: 'high' } }), { today: '2026-11-15' }); assert.equal(high.ok, false); assert.match(high.reasons.join(), /중국 경쟁 높음/);
  const met = judgeStructure(entry({ breaks: [{ ...entry().breaks[0], now: 'met', evidence: '16%' }] }), { today: '2026-11-15' }); assert.equal(met.ok, false); assert.match(met.reasons[0], /깨짐 조건 충족: CXMT 점유율 15% 이상 \(16%\)/); assert.deepEqual(met.breaksMet, ['b1']);
  assert.equal(judgeStructure(entry({ breaks: [{ ...entry().breaks[0], now: 'unknown' }] }), { today: '2026-11-15' }).ok, true, '확인 전(unknown)은 막지 않는다');
  const old = judgeStructure(entry(), { today: '2027-03-01' }); assert.equal(old.stale, true); assert.equal(old.ok, false); assert.match(old.reasons.at(-1), /106일 지남\(기준 100일\)/);
  const none = judgeStructure(null, { today: '2026-11-15' }); assert.equal(none.ok, false); assert.equal(none.missing, true);
});

test('구조 답 형식: 질문마다 출처(URL)·날짜가 있는 사실 2개 이상 · 등급·돈 내는 곳·방어선은 정해진 값 · 깨짐 조건은 숫자 기준과 확인처', () => {
  const one = entry(); one.china.facts = [fact()]; assert.match(checkEntry('A', one).join(), /사실 1개/);
  const nourl = entry(); nourl.demand.facts = [fact(), { text: 'x', date: '2026-10' }]; assert.match(checkEntry('A', nourl).join(), /출처나 날짜가 빠진/);
  assert.match(checkEntry('A', entry({ demand: { ...entry().demand, grade: 'good' } })).join(), /demand.grade/);
  assert.match(checkEntry('A', entry({ china: { ...entry().china, defense: ['luck'] } })).join(), /china.defense/);
  assert.match(checkEntry('A', entry({ breaks: [{ text: '애매함', now: 'clear' }] })).join(), /깨짐 조건 형식/);
  assert.match(checkEntry('A', entry({ breaks: [] })).join(), /깨짐 조건 없음/);
  assert.ok(Object.keys(LABELS.payer).includes('public') && STRUCTURE_RULES.reviewDays === 100);
});

test('카드에 붙이기: 통과만 대기로 내리고(올리지는 않음), 왜·깨짐 조건에 두 줄을 더한다 · 답이 없는 통과 종목은 대기', () => {
  const a = applyStructure(passCard('A'), entry(), { today: '2026-11-15' }); assert.equal(a.verdict, 'pass'); assert.equal(a.verdictBase, 'pass'); assert.equal(a.why.length, 3); assert.ok(a.breaks.includes('구조: CXMT 점유율 15% 이상')); assert.equal(a.structure.cluster, 'memory');
  const b = applyStructure(passCard('B'), entry({ china: { ...entry().china, grade: 'high' } }), { today: '2026-11-15' }); assert.equal(b.verdict, 'wait'); assert.match(b.why.at(-1), /^구조 → 대기: 중국 경쟁 높음/);
  const c = applyStructure(passCard('C', { verdict: 'fail' }), entry({ demand: { ...entry().demand, grade: 'head' } }), { today: '2026-11-15' }); assert.equal(c.verdict, 'fail', '탈락은 그대로');
  const d = applyStructure(passCard('D'), null, { today: '2026-11-15' }); assert.equal(d.verdict, 'wait'); assert.equal(d.structure.missing, true);
  const e = applyStructure(passCard('E', { verdict: 'wait' }), null, { today: '2026-11-15' }); assert.equal(e.verdict, 'wait'); assert.equal(e.why.length, 1, '답이 없으면 줄을 더하지 않는다');
});

test('계획: 같은 깨짐 조건 묶음에서는 점수가 높은 하나만 · 묶음 정보가 없으면 예전과 같다 · 구조로 대기된 통과 종목은 따로 적는다', () => {
  const s = (cl, ok = true) => ({ cluster: cl, ok, grades: { demand: 'tail', china: 'mid' }, asOf: '2026-11-15', reasons: ok ? [] : ['중국 경쟁 높음'] });
  const cards = [passCard('hynix', { growth: { rank: 0.9 }, value: { pct: 0.13 }, structure: s('memory') }), passCard('samsung', { sector: 'IT2', growth: { rank: 0.94 }, value: { pct: 0.18 }, structure: s('memory') }), passCard('nvda', { growth: { rank: 0.88 }, value: { pct: 0 }, structure: s('ai-compute') }),
    passCard('lly', { sector: 'HC', growth: { rank: 0.96 }, value: { pct: 0.3 }, structure: s('glp1') }), { ...passCard('hanmi', { sector: 'HC' }), verdict: 'wait', verdictBase: 'pass', structure: s('kr-pharma', false) }];
  const p = buildPlan(cards); assert.deepEqual(p.picked, ['nvda', 'hynix', 'lly']); assert.deepEqual(p.rejected.cluster, [{ key: 'samsung', cluster: 'memory', by: 'hynix' }]); assert.deepEqual(p.rejected.structure, ['hanmi']);
  assert.match(p.weights.hynix.why.at(-1), /같은 묶음\(메모리\)에서 하나/); assert.equal(p.weights.hynix.structure.cluster, 'memory');
  const plain = buildPlan(cards.map(({ structure, ...c }) => c).filter(c => c.verdict === 'pass')); assert.deepEqual(plain.picked, ['nvda', 'hynix', 'samsung', 'lly'], '묶음 정보가 없으면 둘 다 담는다(섹터 상한 안)'); assert.deepEqual(plain.rejected.cluster, []);
  assert.deepEqual(buildPlan(cards, { rules: { ...p.rules, satellitePct: 50, corePct: { US: 25, KR: 10 }, cashPct: 15, maxNames: 10, minNames: 8, maxSingle: 7, maxSector: 15, tranches: [0.6, 0.2, 0.2], exclude: [], oneCluster: false } }).rejected.cluster, []);
});

test('카드: 분할·재작성으로 분기 자료가 깨지면(영업이익 > 매출 · 매출이 앞뒤 분기의 절반 미만) 자동 판정을 보류한다', () => {
  const quarters = [], months = []; let t = Date.parse('2019-12-31'), rev = 100;
  for (let i = 0; i < 28; i++) { const end = new Date(t).toISOString().slice(0, 10), pub = new Date(t + 45 * 864e5).toISOString().slice(0, 10); quarters.push([end, pub, rev, rev * 0.2, rev * 0.16, rev * 4]); rev *= 1.04; t += 91.3 * 864e5; }
  for (let d = Date.parse('2020-06-30'); d <= Date.parse('2026-10-31'); d += 30.4 * 864e5) months.push([new Date(d).toISOString().slice(0, 10), 100, 2000]);
  const co = { name: 'T', market: 'KR', sector: 'HC', currency: 'KRW', shares: 10, quarters: quarters.map((q, i) => (i === 24 ? [q[0], q[1], q[2] * 0.25, q[2] * 0.3, q[4], q[5]] : q)), months };
  const c = buildCard('X', co, { growthRank: 0.98 }, { asOf: '2026-10-31' }); assert.equal(c.verdict, 'nodata'); assert.deepEqual(c.dataIssue, [quarters[24][0]]); assert.match(c.why[0], /^분기 자료 이상/);
  const clean = buildCard('Y', { ...co, quarters }, { growthRank: 0.98 }, { asOf: '2026-10-31' }); assert.notEqual(clean.verdict, 'nodata'); assert.equal(clean.dataIssue, undefined);
});

test('엔진: 구조 질문에서 막힌 종목(structure.ok=false)은 15% 내려가도 나눠 사기 단계를 올리지 않는다', async () => {
  const flat = close => { const out = []; for (let t = Date.parse('2025-06-01'); t <= Date.parse('2026-12-31'); t += 864e5) { const d = new Date(t); if (d.getUTCDay() && d.getUTCDay() !== 6) out.push({ date: d.toISOString().slice(0, 10), open: close, close }); } return out; };
  const mk = card => { const state = { t: Date.parse('2026-11-16T01:30:00Z'), price: 59000 };
    const client = { settings: () => ({ mode: 'vps', accountMasked: '****0000' }), async price(code) { return { code, market: 'KR', currency: 'KRW', exchange: 'KRX', price: code === '128940' ? state.price : 70000, upper: 0, lower: 0, halted: false }; },
      async balance() { const v = 43 * state.price; return { cash: 100_000_000 - v, total: 100_000_000, stock: v, positions: [{ symbol: '128940', name: '한미약품', market: 'KR', currency: 'KRW', qty: 43, price: state.price, value: v, valueKrw: v }], cashUsd: 0, stockUsd: 0 }; },
      async buyingPower() { return { maxQty: 1e6, cashQty: 1e6 }; }, async place() { return { odno: '1', orgno: '' }; }, async cancel() { return {}; }, async orders() { return []; } };
    const doc = { version: 'T1', weights: { '069500': { pct: 10, name: 'KODEX 200', currency: 'KRW', role: 'core' }, '128940': { pct: 3, targetPct: 5, tranche: 1, name: '한미약품', currency: 'KRW', role: 'satellite' } } };
    const pl = createPaperLive({ client, store: createLedgerStore(mkdtempSync(join(tmpdir(), 'tq-sq-'))), readMarket: async s => ({ candles: flat(s === 'KRW=X' ? 1400 : 70000) }), now: () => state.t, defaultPlan: () => Object.fromEntries(Object.entries(doc.weights).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }])), defaultPlanVersion: () => 'T1', defaultPlanDoc: () => doc, thesisCard: () => card, limits: { maxOrderKrw: 30_000_000, maxDailyKrw: 100_000_000 } });
    pl._ledger().orders.push({ at: '2026-11-13T01:00:00.000Z', symbol: '128940', name: '한미약품', market: 'KR', currency: 'KRW', side: 'BUY', qty: 43, price: 70000, filledQty: 43, avgPrice: 70000, status: 'filled', why: 't' });
    return pl; };
  const base = { key: '128940', asOf: '2026-10-30', growth: { lastQuarter: '2026-06-30' }, value: { pct: 0.2 } };
  assert.equal((await mk({ ...base, verdict: 'wait', verdictBase: 'pass', structure: { ok: false, reasons: ['중국 경쟁 높음'] } }).status()).tranche['128940'].step, 1, '구조로 막힌 종목은 올리지 않는다');
  assert.equal((await mk({ ...base, verdict: 'pass', structure: { ok: true } }).status()).tranche['128940'].step, 2, '구조 통과면 15% 하락으로 2단계');
});

test('자료 계약(data/structure-cards.json · data/thesis-cards.json): 모든 답이 형식을 지키고, 통과·대기 카드는 모두 구조 답이 있다 · 계획 PP4 의 위성은 구조 통과이고 묶음이 겹치지 않는다', () => {
  if (!existsSync(new URL('../data/structure-cards.json', import.meta.url))) return;
  const S = J('../data/structure-cards.json'), T = J('../data/thesis-cards.json');
  const errs = Object.entries(S.companies).flatMap(([k, e]) => checkEntry(k, e)); assert.deepEqual(errs, []);
  assert.equal(T.structureVersion, S.version, '구조 답을 고치면 node scripts/build-thesis-plan.mjs 를 다시 돌린다');
  const need = T.cards.filter(c => ['pass', 'wait'].includes(c.verdictBase || c.verdict)).map(c => c.key), missing = need.filter(k => !S.companies[k]); assert.deepEqual(missing, [], '통과·대기 카드는 구조 답이 있어야 한다');
  for (const c of T.cards.filter(x => S.companies[x.key])) { assert.ok(c.structure && c.structure.version, c.key); if (c.verdictBase === 'pass' && c.structure.ok === false) assert.equal(c.verdict, 'wait', c.key); }
  if (!existsSync(new URL('../data/paper-plan.pp4.json', import.meta.url))) return;
  const P = J('../data/paper-plan.pp4.json'), sats = Object.entries(P.weights).filter(([, w]) => w.role === 'satellite');
  assert.equal(P.structure.version, S.version); const clusters = sats.map(([k]) => S.companies[k]?.cluster); assert.equal(new Set(clusters).size, clusters.length, `같은 묶음이 겹침: ${clusters}`);
  for (const [k] of sats) assert.equal(judgeStructure(S.companies[k], { today: S.asOf }).ok, true, `${k}: 구조 통과가 아닌데 위성`);
  for (const [k, w] of Object.entries(P.weights).filter(([, w]) => w.role === 'exit')) assert.match(w.why.at(-1), /^전환: /, `${k}: 정리 이유`);
});
