import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { num, annualSummary, fromKorea, fromUs, normalizeSymbol } from '../lib/fundamentals.js';
import { scoreStock, factors } from '../lib/stock-score.js';
import { explainMove } from '../lib/move-explain.js';
import { advisePortfolio, weightRule } from '../lib/portfolio-advice.js';
import { createCashStore, validateCashInput } from '../lib/cash-store.js';
import { createLocalBridge } from '../lib/local-bridge.js';

// 합성 자료만 사용한다.
const finance = { trTitleList: [{ key: '2024', title: '2024.12.', isConsensus: 'N' }, { key: '2025', title: '2025.12.', isConsensus: 'N' }, { key: '2026', title: '2026.12.', isConsensus: 'Y' }],
  rowList: [{ title: '매출액', columns: { 2024: { value: '1,000' }, 2025: { value: '1,200' }, 2026: { value: '1,500' } } }, { title: '영업이익', columns: { 2024: { value: '100' }, 2025: { value: '150' } } },
    { title: 'ROE', columns: { 2024: { value: '12.0' }, 2025: { value: '18.5' }, 2026: { value: '25' } } }, { title: '부채비율', columns: { 2025: { value: '45.2' } } }, { title: '영업이익률', columns: { 2025: { value: '12.5' } } }] };

test('숫자 표기를 읽는다', () => {
  assert.equal(num('9.04배'), 9.04); assert.equal(num('22,292원'), 22292); assert.equal(num('+55.32%'), 55.32); assert.equal(num('N/A'), null); assert.equal(num('-'), null);
  assert.deepEqual(normalizeSymbol('005930.KS'), { code: '005930', market: 'KR' }); assert.deepEqual(normalizeSymbol('brk-b'), { code: 'BRK.B', market: 'US' });
  assert.throws(() => normalizeSymbol('<script>'));
});

test('연간 재무는 확정 연도만 쓰고 성장률을 계산한다', () => {
  const a = annualSummary(finance);
  assert.equal(a.year, '2025.12'); assert.equal(a.roe, 18.5); assert.equal(a.revenueGrowth, 20); assert.equal(a.operatingIncomeGrowth, 50); assert.equal(a.debtRatio, 45.2);
  assert.equal(a.estimateRoe, 25);
});

test('국내·해외 응답을 같은 모양으로 정리한다', () => {
  const kr = fromKorea({ stockName: '가나전자', stockEndType: 'stock', totalInfos: [{ code: 'lastClosePrice', value: '10,000' }, { code: 'per', value: '8.0배' }, { code: 'dividendYieldRatio', value: '3.5%' }], consensusInfo: { priceTargetMean: '13,000', recommMean: '4.0' } }, { financeInfo: finance });
  assert.equal(kr.per, 8); assert.equal(kr.dividendYield, 3.5); assert.equal(kr.targetPrice, 13000); assert.equal(kr.annual.roe, 18.5);
  const us = fromUs({ stockName: 'ABC', closePrice: '100', stockItemTotalInfos: [{ code: 'per', value: '150.0배' }, { code: 'dividendYieldRatio', value: 'N/A' }, { code: 'industryGroupKor', value: '소프트웨어' }] }, null, null);
  assert.equal(us.per, 150); assert.equal(us.dividendYield, null); assert.equal(us.sector, '소프트웨어');
});

test('투자 성향에 따라 같은 종목도 판단이 달라진다', () => {
  const cheapDividend = { per: 7, dividendYield: 5, price: 100, targetPrice: 120, annual: { roe: 12, revenueGrowth: 2, debtRatio: 60 } };
  const pricyGrowth = { per: 90, dividendYield: 0, price: 100, targetPrice: 140, annual: { roe: 20, revenueGrowth: 45, operatingIncomeGrowth: 60, debtRatio: 80 } };
  assert.equal(scoreStock(cheapDividend, { style: 'dividend' }).stance, 'buy');
  assert.ok(scoreStock(pricyGrowth, { style: 'growth' }).score > scoreStock(pricyGrowth, { style: 'value' }).score);
  const big = scoreStock(cheapDividend, { style: 'dividend', weightPct: 40 });
  // 2026-11-27 LEGAL 4.3 사실형 라벨. 한도의 출처를 그대로 적는다: 내 규칙이 없으면 '성향 기준', 있으면 '내 한도'.
  assert.match(big.label, /^지표 좋음 · 비중 \d+% \(성향 기준 \d+% 넘음\)$/);
  assert.equal(scoreStock({ per: null }, {}).stance, 'unknown'); assert.equal(scoreStock({ per: null }, {}).label, '지표 부족');
  // 배당 성향에서는 배당이 없는 성장주를 감점한다.
  assert.ok(scoreStock(pricyGrowth, { style: 'dividend' }).factors.find(f => f.key === 'dividend').tone < 0);
  assert.match(scoreStock(cheapDividend, { style: 'balanced', weightPct: 26, weightLimit: 25, limitMine: true }).label, /^지표 좋음 · 비중 26% \(내 한도 25% 넘음\)$/);
  assert.ok(factors({ per: -3, annual: {} }).some(f => f.value === '계산 불가'));
});

const brief = (over = {}) => ({ available: true, marketName: '코스피', price: { dayReturn: -2.11, typicalMove: 1.56, moveRatio: 1.35 }, move: { available: true, marketShare: 0.2, market: -0.5, beta: 1.1, expected: -0.55 }, causes: [], ...over });

test('평소 수준 움직임에는 원인을 단정하지 않고, 모순된 문장을 내지 않는다', () => {
  const e = explainMove(brief({ causes: [{ kind: 'news', title: '실적 관련 기사 1건', detail: '분기 매출 급증에도 주가 약세', fits: null }, { kind: 'unknown', title: '뚜렷한 개별 원인을 찾지 못했습니다' }] }));
  assert.match(e.conclusion, /평소 수준의 하락/); assert.match(e.conclusion, /단정할 필요가 없습니다/);
  assert.doesNotMatch(e.conclusion, /찾지 못했습니다/);
  assert.equal(e.evidence.length, 1); assert.equal(e.evidence[0].fit, 'neutral');
});

test('시장·업종·공시가 이끈 움직임을 구분한다', () => {
  assert.match(explainMove(brief({ move: { available: true, marketShare: 0.8, market: -4, beta: 1.5, expected: -6 }, price: { dayReturn: -7, typicalMove: 2, moveRatio: 3.5 } }), { market: { themes: [{ label: '정치·선거' }] } }).conclusion, /코스피 전체 움직임.*정치·선거/);
  assert.match(explainMove(brief({ price: { dayReturn: -6, typicalMove: 2, moveRatio: 3 } }), { sectorName: '반도체', sectorToday: -8.5 }).conclusion, /반도체 업종 전체가/);
  assert.match(explainMove(brief({ causes: [{ kind: 'disclosure', title: '2026-11-05 공시: 공급계약', detail: '단일판매 공급계약 체결', fits: true }] })).conclusion, /공시입니다: 공급계약/);
});

test('현금·집중·업종 기준으로 방향을 제안한다', () => {
  const holdings = [{ name: 'A', valueKrw: 600, sector: '반도체', country: '국내', dividendYield: 1, stance: 'buy' }, { name: 'B', valueKrw: 300, sector: '반도체', country: '국내', dividendYield: 0, stance: 'trim' }, { name: 'C', valueKrw: 100, sector: '음료', country: '해외', dividendYield: 3 }];
  const a = advisePortfolio(holdings, { cash: 50 });
  assert.equal(Math.round(a.cashPct), 5);
  assert.ok(a.checks.find(c => c.key === 'cash').tone < 0);
  assert.match(a.checks.find(c => c.key === 'single').title, /A 60%/);
  assert.match(a.checks.find(c => c.key === 'sector').title, /반도체 업종 90%/);
  // 2026-11-27 보완 2(사용자 지시 "줄글 설명 제거"): 비중 점검 목록은 문장이 아니라 상태 줄('✕ 규칙 · 지금 값 · 한도 (기준)')이다. 뜻·숫자·기준 이름은 그대로.
  assert.ok(a.actions.includes('✕ 한 종목 최대 비중 · A 60%, B 30% · 한도 25% (성향 기준)'), a.actions.join(' | '));
  assert.ok(a.actions.includes('✕ 현금 최소 비중 · 현금 5% · 최소 10% (성향 기준)')); // 내 규칙이 없으면 '내 규칙'이라고 쓰지 않는다
  assert.ok(a.actions.includes('✕ 섹터 상한 · 반도체 90% · 상한 40%'), a.actions.join(' | '));
  assert.ok(!a.actions.some(x => /[.]$|니다$/.test(x)), '문장으로 끝나지 않음');
  // 2026-11-27(LEGAL 2.1): 종목 이름별 매수 후보·매도 검토 줄을 내지 않는다(지표 요약은 표의 열에만).
  assert.ok(!a.actions.some(x => /지표 상위|지표가 약한|더 살지/.test(x)));
  assert.equal(a.dividend, 6 + 0 + 3);
  assert.equal(advisePortfolio(holdings, {}).cashPct, null);
  // 내 규칙이 있으면 그 한도·문구를 쓴다
  const m = advisePortfolio(holdings, { cash: 50, rules: { maxSingle: 20, minCash: 10 } });
  assert.ok(m.actions.some(x => /한도 20% \(내 규칙\)/.test(x))); assert.ok(m.actions.some(x => /현금 최소 비중 · 현금 \d+% · 최소 10% \(내 규칙\)/.test(x)));
});

test('비중 기준: 비중 점검과 종목 점검 표가 같은 한도·분모를 쓴다', () => {
  // 내 규칙 + 현금을 앎 → 내 한도 · 총자산 대비(규칙 화면과 같음)
  assert.deepEqual(weightRule({ stocks: 700, cash: 300, style: 'balanced', rules: { maxSingle: 20, minCash: 5 } }), { single: 20, mine: true, base: 1000, baseName: '총자산' });
  // 내 규칙 + 현금 모름 → 내 한도 · 주식 합계 대비
  assert.deepEqual(weightRule({ stocks: 700, cash: null, rules: { maxSingle: 20, minCash: 5 } }), { single: 20, mine: true, base: 700, baseName: '주식' });
  // 내 규칙 없음(팀 모의계좌) → 성향 기준값 · 주식 합계 대비
  assert.deepEqual(weightRule({ stocks: 700, cash: 300, style: 'growth', rules: null }), { single: 30, mine: false, base: 700, baseName: '주식' });
  // 같은 분모로 점검: 총자산 1000 중 A 300 = 30% > 내 한도 25% → 비중 점검과 라벨이 함께 넘음
  const w = weightRule({ stocks: 700, cash: 300, rules: { maxSingle: 25, minCash: 5 } }), pctA = 300 / w.base * 100;
  const label = scoreStock({ per: 7, dividendYield: 5, price: 100, targetPrice: 120, annual: { roe: 12, revenueGrowth: 2, debtRatio: 60 } }, { style: 'dividend', weightPct: pctA, weightLimit: w.single, limitMine: w.mine }).label;
  assert.equal(label, '지표 좋음 · 비중 30% (내 한도 25% 넘음)');
  const adv = advisePortfolio([{ name: 'A', valueKrw: 300 }, { name: 'B', valueKrw: 200 }, { name: 'C', valueKrw: 200 }], { cash: 300, rules: { maxSingle: 25, minCash: 5 } });
  assert.match(adv.checks.find(c => c.key === 'single').title, /A 30%/);
});

test('현금 기록은 PC 폴더에 이어 붙이고 공개 폴더·클라우드는 거부한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tq-cash-'));
  const store = createCashStore({ directory: dir, env: {} });
  assert.equal((await store.get()).latest, null);
  await store.set({ amount: 1500000, note: 'CMA' }); const v = await store.set({ amount: 2000000 });
  assert.equal(v.latest.amount, 2000000); assert.equal(v.entries.length, 2);
  assert.equal(JSON.parse(await readFile(join(dir, 'cash-ledger.json'))).entries[0].note, 'CMA');
  assert.throws(() => validateCashInput({ amount: -1 })); assert.throws(() => validateCashInput({ amount: 1, account: '123' }));
  await assert.rejects(createCashStore({ directory: dir, env: { VERCEL: '1' } }).get());
  await assert.rejects(createCashStore({ directory: join(dir, 'x'), env: {}, publicRoots: [dir] }).set({ amount: 1 }));
});

test('현금 기록은 PC 연결 인증 뒤에만 열린다', async () => {
  let saved = null;
  const b = createLocalBridge({ port: 8766, env: {}, cash: { get: async () => ({ latest: saved }), set: async body => { saved = body; return { latest: body }; } } });
  const local = { method: 'POST', headers: { host: '127.0.0.1:8766', origin: 'http://127.0.0.1:8766', 'x-teamquant-action': 'bridge-local' } }, remote = { method: 'POST', headers: { host: '127.0.0.1:8766', origin: 'https://teamquant.vercel.app' } };
  assert.equal((await b.handle(remote, 'cash-get')).status, 401);
  assert.equal((await b.handle(remote, 'cash-set', { amount: 1 })).status, 401);
  assert.equal(saved, null);
  assert.equal((await b.handle(local, 'cash-set', { amount: 5 })).status, 200);
  assert.equal((await b.handle(local, 'cash-get')).body.latest.amount, 5);
});
