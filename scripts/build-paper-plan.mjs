// 모의계좌 기본 계획(data/paper-plan.json)을 근거와 함께 만든다. 사용: node scripts/build-paper-plan.mjs
//
// 원칙(미리 정해 두고 바꾸지 않는다):
//  1. 오를 종목을 고르지 않는다. 거시·정책·정치 변수로 수익률 방향을 맞힌 근거가 없다(Goyal–Welch–Zafirov RFS 2024, 저장소 요인 연구 11-06,
//     성장 전망 전략 검증 11-06: 상위 20% 매수의 초과수익 통계적으로 확인 안 됨). 그래서 비중은 "위험을 고르게"(변동성 역수)로 정한다.
//  2. 정치·정책·세계 추세는 '노출 상한'으로만 들어간다: 한 종목 ≤ 20%(규칙 25% 안쪽), 한 섹터 ≤ 30%, 한 나라 ≤ 60%, 반도체 ≤ 25%
//     (2026-11 현재 정책 사건 위험이 가장 몰린 섹터 — 미 데이터센터 규제 논의, HBM 밀수 제재 위험, 코스피 외국인 매도의 73%가 두 종목). 현금 ≥ 15%(규칙 최소 10% + 여유).
//  3. 검증은 같은 엔진으로: 이 계획을 규칙대로 운용했을 때(lib/paper-trading.rehearse) 2020~2026 각 해·최근 12개월에서 그냥 보유·균등 비중·지수와 비교하고,
//     정해 둔 충격 시나리오(반도체 −30%, 코스피 −20%, 미국 주식 −20%, 원화 +10% 강세, 장기금리 급등)에서 손실을 계산한다. 숫자는 그대로 적고 좋게 고르지 않는다.
//  4. 섹터 지도(lib/sectors.js)의 날짜·출처 있는 이슈를 종목별 '노출 메모'로 붙인다. 예측이 아니라 "이 종목은 이런 사건에 걸려 있다"는 뜻이다.
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS, classify, sectorName, issuesFor } from '../lib/sectors.js';
import { rehearse } from '../lib/paper-trading.js';
import { DEFAULT_RULES } from '../lib/core-rules.js';
import { krwReturns, ewmaSigma } from '../lib/core-risk.js';

export const PLAN_VERSION = 'PP1-2026-11-09';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1420070400&period2=9999999999&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
// 후보: 섹터 지도의 대표 회사 중 국내 1~2 + 미국 1 씩, 지수·채권 ETF. 모의계좌(한투 vps)가 다룰 수 있는 KRX·NASD·NYSE·AMEX 만.
const UNIVERSE = [
  ['005930', '삼성전자', 'KRW'], ['000660', 'SK하이닉스', 'KRW'], ['005380', '현대차', 'KRW'], ['105560', 'KB금융', 'KRW'], ['207940', '삼성바이오로직스', 'KRW'], ['329180', 'HD현대중공업', 'KRW'], ['012450', '한화에어로스페이스', 'KRW'], ['035420', 'NAVER', 'KRW'], ['069500', 'KODEX 200', 'KRW'],
  ['SPY', 'S&P500 ETF', 'USD'], ['QQQ', '나스닥100 ETF', 'USD'], ['MSFT', '마이크로소프트', 'USD'], ['NVDA', '엔비디아', 'USD'], ['JNJ', '존슨앤드존슨', 'USD'], ['JPM', 'JP모건', 'USD'], ['LMT', '록히드마틴', 'USD'], ['TLT', '미국 장기채 ETF', 'USD']
];
const CAPS = { single: 20, sector: 30, country: 60, semi: 25, cashMin: 15 };
const SCENARIOS = [ // 섹터·통화별 충격(%). 과거 비슷한 크기: 2022 반도체 −35~−45%, 2020-03 코스피 −35%, 2022 S&P −25%, 2022 TLT −31%
  { id: 'semi', name: '반도체 −30%', shock: s => s.sector === 'semi' ? -30 : s.sector === 'index' && s.currency === 'KRW' ? -12 : s.sector === 'index' && s.currency === 'USD' ? -8 : s.sector === 'platform' ? -8 : 0 },
  { id: 'kospi', name: '코스피 −20%', shock: s => s.currency === 'KRW' ? (s.sector === 'index' ? -20 : -22) : 0 },
  { id: 'us', name: '미국 주식 −20%', shock: s => s.currency === 'USD' && s.sector !== 'bond' ? (s.sector === 'index' ? -20 : -24) : s.currency === 'KRW' ? -8 : 0 },
  { id: 'krw', name: '원화 +10% 강세(달러 자산 −10%)', shock: s => s.currency === 'USD' ? -10 : 0 },
  { id: 'rates', name: '장기금리 급등(장기채 −15%, 성장주 −10%)', shock: s => s.sector === 'bond' ? -15 : ['semi', 'platform', 'bio'].includes(s.sector) ? -10 : s.sector === 'finance' ? 3 : -4 }
];

const cache = new Map(); const get = async s => { if (!cache.has(s)) { cache.set(s, await history(s)); await sleep(120); } return cache.get(s); };
const yahoo = (sym, cur) => cur === 'KRW' ? `${sym}.KS` : sym;
const fx = await get('KRW=X');
const assets = [];
for (const [symbol, name, currency] of UNIVERSE) {
  const candles = await get(yahoo(symbol, currency));
  const r = krwReturns(candles, currency, fx).slice(-252).map(x => x.r), vol = ewmaSigma(r).at(-1) * Math.sqrt(252);
  if (!(vol > 0)) throw new Error(`${symbol}: 변동성을 계산하지 못했습니다`);
  const sector = classify(symbol, name);
  assets.push({ symbol, name, currency, country: currency === 'KRW' ? 'KR' : 'US', sector, sectorName: sectorName(sector), vol, candles });
}
// ── 비중: 변동성 역수 → 상한 적용(반복) → 투자 비중 = 100 − 현금 ──
const invested = 100 - CAPS.cashMin;
let w = Object.fromEntries(assets.map(a => [a.symbol, 1 / a.vol]));
const norm = () => { const s = Object.values(w).reduce((x, y) => x + y, 0); for (const k in w) w[k] = w[k] / s * invested; };
const groups = [
  { key: a => a.symbol, cap: CAPS.single, label: '한 종목' },
  { key: a => a.sector === 'index' || a.sector === 'bond' ? null : a.sector, cap: CAPS.sector, label: '한 섹터' },
  { key: a => a.sector === 'semi' ? 'semi-total' : null, cap: CAPS.semi, label: '반도체 합계' },
  { key: a => a.country, cap: CAPS.country, label: '한 나라' }
];
const capped = new Set();
for (let it = 0; it < 40; it++) {
  norm(); let changed = false;
  for (const g of groups) {
    const sums = {}; for (const a of assets) { const k = g.key(a); if (k) sums[k] = (sums[k] || 0) + w[a.symbol]; }
    for (const [k, s] of Object.entries(sums)) if (s > g.cap + 1e-9) { const f = g.cap / s; for (const a of assets) if (g.key(a) === k) { w[a.symbol] *= f; capped.add(a.symbol); } changed = true; }
  }
  // 상한에 걸린 종목은 고정하고 남은 비중을 나머지에 다시 나눈다
  const fixed = [...capped].reduce((x, s) => x + w[s], 0), free = assets.filter(a => !capped.has(a.symbol)), freeSum = free.reduce((x, a) => x + w[a.symbol], 0);
  if (free.length && freeSum > 0) for (const a of free) w[a.symbol] = w[a.symbol] / freeSum * Math.max(0, invested - fixed);
  if (!changed) break;
}
for (const k in w) w[k] = Math.round(w[k] * 2) / 2; // 0.5% 단위
let diff = invested - Object.values(w).reduce((x, y) => x + y, 0); if (Math.abs(diff) >= 0.5) { const k = assets.filter(a => !capped.has(a.symbol)).sort((a, b) => w[b.symbol] - w[a.symbol])[0]?.symbol || assets[0].symbol; w[k] = Math.round((w[k] + diff) * 2) / 2; }
const weights = {};
for (const a of assets) {
  const recent = issuesFor([a.symbol]).slice(0, 3).map(i => `${i.date} ${i.title}`);
  const why = [];
  why.push(`변동성 연 ${(a.vol * 100).toFixed(0)}% → 변동성 역수 비중${capped.has(a.symbol) ? ' (상한에 걸려 줄임)' : ''}`);
  if (a.sector === 'index') why.push('지수 ETF: 개별 사건 노출을 줄이는 뼈대'); if (a.sector === 'bond') why.push('장기채: 주식과 반대로 움직이던 때가 많았으나 2022처럼 함께 빠진 해도 있음');
  if (a.sector === 'semi') why.push(`반도체 합계 ≤ ${CAPS.semi}%: 2026-11 정책 사건 위험이 가장 몰린 섹터`);
  weights[a.symbol] = { pct: w[a.symbol], name: a.name, currency: a.currency, country: a.country, sector: a.sector, sectorName: a.sectorName, vol1y: Math.round(a.vol * 1000) / 10, why, exposure: recent };
}
const sumBy = f => { const m = {}; for (const a of assets) { const k = f(a); if (k) m[k] = Math.round(((m[k] || 0) + w[a.symbol]) * 10) / 10; } return m; };
const concentration = { bySector: sumBy(a => a.sectorName), byCountry: sumBy(a => a.country), semi: sumBy(a => a.sector === 'semi' ? 'semi' : null).semi || 0, cash: 100 - Object.values(w).reduce((x, y) => x + y, 0), hhi: Object.values(w).reduce((x, y) => x + (y / invested) ** 2, 0) };
concentration.effective = 1 / concentration.hhi;

// ── 검증 1: 같은 엔진으로 과거 운용(계획 vs 균등 vs 보유 vs 지수) ──
const today = new Date().toISOString().slice(0, 10), y = +today.slice(0, 4);
const WINDOWS = [{ id: 'recent12m', label: '최근 12개월', from: `${y - 1}-${today.slice(5)}` }, { id: 'ytd', label: `${y}년`, from: `${y}-01-01` }, ...[2020, 2021, 2022, 2023, 2024, 2025].map(yy => ({ id: `y${yy}`, label: `${yy}년`, from: `${yy}-01-01`, to: `${yy}-12-31` }))];
const basket = assets.map(a => ({ symbol: a.symbol, name: a.name, currency: a.currency })), candlesBySymbol = Object.fromEntries(assets.map(a => [a.symbol, a.candles]));
const equal = Object.fromEntries(assets.map(a => [a.symbol, Math.round(invested / assets.length * 10) / 10]));
const benchKR = { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: candlesBySymbol['069500'] }, benchUS = { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: candlesBySymbol.SPY };
const f = m => m ? { ret: Math.round(m.ret * 1000) / 10, mdd: Math.round(m.mdd * 1000) / 10 } : null;
const windows = [];
for (const W of WINDOWS) {
  const a = rehearse({ basket, capitalKrw: 100_000_000, rules: DEFAULT_RULES, plan: w, candlesBySymbol, fxCandles: fx, from: W.from, to: W.to || today, benchmark: benchKR, label: 'plan' });
  const b = rehearse({ basket, capitalKrw: 100_000_000, rules: DEFAULT_RULES, plan: equal, candlesBySymbol, fxCandles: fx, from: W.from, to: W.to || today, benchmark: benchUS, label: 'equal' });
  if (!a.ok || !b.ok) { windows.push({ ...W, ok: false, reason: a.reason || b.reason }); continue; }
  windows.push({ id: W.id, label: W.label, from: a.from, to: a.to, days: a.days, ok: true, plan: { rule: f(a.metrics.rule), hold: f(a.metrics.hold) }, equal: { rule: f(b.metrics.rule), hold: f(b.metrics.hold) }, kodex200: f(a.metrics.bench), spy: f(b.metrics.bench), trades: a.activity.trades, costPct: Math.round(a.activity.costPct * 100) / 100, cashAvgPct: Math.round(a.activity.cashAvgPct) });
  console.log(`${W.label}: 계획(규칙) ${f(a.metrics.rule).ret}% / 최대손실 ${f(a.metrics.rule).mdd}% · 계획(보유) ${f(a.metrics.hold).ret}% · 균등(규칙) ${f(b.metrics.rule).ret}% · KODEX200 ${f(a.metrics.bench)?.ret}% · SPY ${f(b.metrics.bench)?.ret}%`);
}
// ── 검증 2: 충격 시나리오(비중 × 충격). 비교: 균등, 코스피200 100%, 지금 모의계좌(국내 4종목 각 11%) ──
const current = { '005930': 11, '000660': 11, '069500': 11, '035420': 11 };
const lossOf = (wt, sc) => Math.round(assets.reduce((x, a) => x + (wt[a.symbol] || 0) / 100 * sc.shock(a), 0) * 10) / 10;
const scenarios = SCENARIOS.map(sc => ({ id: sc.id, name: sc.name, planPct: lossOf(w, sc), equalPct: lossOf(equal, sc), kodexOnlyPct: lossOf({ '069500': 100 }, sc), currentPct: lossOf(current, sc) }));
for (const s of scenarios) console.log(`시나리오 ${s.name}: 계획 ${s.planPct}% · 균등 ${s.equalPct}% · 코스피200만 ${s.kodexOnlyPct}% · 지금 모의계좌 ${s.currentPct}%`);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
const okW = windows.filter(x => x.ok);
const summary = { medianRuleRet: med(okW.map(x => x.plan.rule.ret)), medianRuleMdd: med(okW.map(x => x.plan.rule.mdd)), medianKodexRet: med(okW.map(x => x.kodex200?.ret).filter(Number.isFinite)), medianKodexMdd: med(okW.map(x => x.kodex200?.mdd).filter(Number.isFinite)), medianSpyRet: med(okW.map(x => x.spy?.ret).filter(Number.isFinite)), worstScenarioPct: Math.min(...scenarios.map(s => s.planPct)), worstScenario: scenarios.reduce((a, b) => b.planPct < a.planPct ? b : a).name };
const out = { version: PLAN_VERSION, generatedAt: new Date().toISOString(), asOf: today, rulesVersion: DEFAULT_RULES && 'C3-2026-11-06', caps: CAPS, method: ['변동성 역수(최근 1년 EWMA, 원화 기준) 비중', `상한: 한 종목 ${CAPS.single}% · 한 섹터 ${CAPS.sector}% · 한 나라 ${CAPS.country}% · 반도체 합계 ${CAPS.semi}% · 현금 ≥ ${CAPS.cashMin}%`, '오를 종목을 고르지 않음(거시·정책 변수의 표본 외 예측력 없음). 정책·정치는 노출 상한으로만 반영', '운용은 규칙 C3(주 1회 점검, 한 종목 25%, 현금 10%, 하루 손실 2.5%, 30일 8회, 미국 200일선)'], weights, cashPct: Math.round(concentration.cash * 10) / 10, concentration, validation: { windows, scenarios, summary, note: '2020~2025 는 규칙(2026-11-06 확정) 이전 구간이라 완전한 표본 외가 아니다. 진짜 표본 외는 모의계좌 운용 기록(장부)이다. 상승장에서는 그냥 보유보다 낮은 것이 이 규칙의 알려진 비용이다.' }, sources: ['Goyal–Welch–Zafirov, RFS 2024', 'docs/DECISIONS.md 2026-11-06 요인 연구·성장 전망 전략 검증', 'lib/sectors.js 이슈(날짜·출처)', 'data/paper-rehearsal.json 2026-11-08'] };
writeFileSync(resolve(root, 'data/paper-plan.json'), JSON.stringify(out));
console.log('\n비중', Object.entries(weights).map(([s, v]) => `${v.name} ${v.pct}%`).join(' · '), `· 현금 ${out.cashPct}%`);
console.log('집중도', JSON.stringify(concentration));
console.log('요약', JSON.stringify(summary));
console.log('→ data/paper-plan.json');
