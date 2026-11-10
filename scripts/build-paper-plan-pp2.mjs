// 모의계좌 교체 후보 계획 PP2(data/paper-plan.pp2.json)를 근거와 함께 만든다. 사용: node scripts/build-paper-plan-pp2.mjs [--cache DIR] [--out FILE]
// 기본 계획(data/paper-plan.json)은 덮어쓰지 않는다. PP1 → PP2 전환은 사용자가 정한다.
//
// 목표(2026-11-10 사용자): "장보다 적게 버는 건 의미가 없다." PP1 의 원칙(위험을 고르게, 현금 15%)은 손실을 줄이는 쪽이라 상승장에서 지수에 뒤진다.
// PP2 = 핵심 + 위성, "시장 수익이 바닥선":
//  1. 핵심(≈90%): 앱의 비교선과 같은 비율(국내 31 : 미국 54 = PP1 byCountry)로 지수 ETF만 산다. 종목을 고르지 않는다.
//     A안: 국내 상장 S&P500 ETF(원화·KST 장중 주문) — 아직 체결된 적이 없는 미국 주문 경로(cashUsd 0) 의존을 없앤다.
//     B안: 미국 상장 S&P500 ETF(달러·미국 장중 주문). 두 안을 같은 엔진으로 돌려 숫자를 그대로 적는다.
//  2. 위성(≤15%, 종목당 ≤5%): 앱에서 승인된 종목 가설만. 2026-11-10 현재 승인 가설 0건 → 위성은 비어 있다. 종목을 지어 넣지 않는다.
//  3. 현금: 규칙이 허용하는 최저(C3 현금 최소 10%). 5%·3% 변형은 숫자만 보고하고, 규칙 변경은 사용자가 '규칙' 화면에서 정한다.
//  4. 한 종목 ≤ 14.5%: 규칙 C3 한 종목 25% 와 주문 보호(1회 15,000,000원 ÷ 총자산 약 1억)를 함께 지키기 위해 같은 지수 ETF 를 여러 운용사 상품으로 나눈다(우회이며, 규칙을 바꾸면 2종목으로 줄일 수 있다).
//  5. 검증은 PP1 과 같은 엔진(lib/paper-trading.rehearse, lib/strategy-review.compareRuleSets)으로: 2020~2026 각 해·최근 12개월, PP2 vs PP1 vs 그냥 보유 vs 지수+현금, 충격 시나리오. 숫자는 좋게 고르지 않는다.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rehearse } from '../lib/paper-trading.js';
import { compareRuleSets, WINDOWS as REVIEW_WINDOWS } from '../lib/strategy-review.js';
import { DEFAULT_RULES, RULES_VERSION } from '../lib/core-rules.js';
import { krwReturns, ewmaSigma } from '../lib/core-risk.js';

export const PLAN_VERSION = 'PP2-2026-11-10';
export const CORE_SPLIT = { KR: 31, US: 54 }; // 앱 비교선(지수+현금)의 국가 비중 = PP1 byCountry
export const PER_NAME_CAP = 14.5; // 규칙 C3 한 종목 25% 안쪽 + 주문 보호 1회 15,000,000원(총자산 약 1억 기준)
export const SATELLITE = { maxTotalPct: 15, maxEachPct: 5, weights: {}, note: '승인된 종목 가설만 넣는다. 2026-11-10 현재 승인 가설 0건 → 비어 있음. 위성이 핵심(지수)보다 더 벌었는지가 이 계좌가 측정하는 것이다.' };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ETF 사실(날짜·출처는 sources 에). 추적오차율은 운용사 페이지에 그래프로만 있어 숫자를 확인하지 못했고, 대신 야후 종가로 12개월 수익률 차이를 계산해 붙인다.
export const ETFS = {
  KR200: [
    { symbol: '069500', name: 'KODEX 200', index: 'KOSPI200', fee: '연 0.15%', listed: '2002-10-14', feeSource: 'https://m.samsungfund.com/sheet/20260206/2ETF01_20260131.pdf (2026-01-31 기준 자료; 검색 색인 요약으로 확인, PDF 본문은 이미지)' },
    { symbol: '102110', name: 'TIGER 200', index: 'KOSPI200', fee: '연 0.05%', listed: '2008-04-03', feeSource: 'https://www.funetf.co.kr/product/etf/view/KR7102110004 (2026-11-10 확인)' },
    { symbol: '148020', name: 'RISE 200', index: 'KOSPI200', fee: '연 0.017%(2025-07-30 보도; 운용사 페이지는 JS 렌더라 직접 확인 못 함)', listed: '2011-10-20', feeSource: 'https://www.heraldk.com/article/2025073017281493808 · https://www.riseetf.co.kr/prod/finderDetail/4435 (2026-11-10 확인)' }
  ],
  SP500_KR: [
    { symbol: '360750', name: 'TIGER 미국S&P500', index: 'S&P500', fee: '연 0.0068%', listed: '2020-08-07', fx: '환노출', feeSource: 'https://www.funetf.co.kr/product/etf/view/KR7360750004 (2026-11-10 확인, 순자산 20.4조원 26.11.09)' },
    { symbol: '379800', name: 'KODEX 미국S&P500TR', index: 'S&P500', fee: '연 0.0099%(2024-04 인하 보도) · Trackinsight 0.05%: 출처 불일치', listed: '2021-04-09', fx: '환노출·분배금 재투자(TR)', feeSource: 'https://www.smarttoday.co.kr/ko-kr/articles/64345 · https://www.trackinsight.com/en/fund/379800 (2026-11-10 확인)' },
    { symbol: '360200', name: 'ACE 미국S&P500', index: 'S&P500', fee: '연 0.0047%(0.07%→인하 보도)', listed: '2020-08-07', fx: '환노출', feeSource: 'https://www.dailian.co.kr/news/view/1521860/ · https://stockanalysis.com/quote/krx/360200/ (2026-11-10 확인)' },
    { symbol: '379780', name: 'RISE 미국S&P500', index: 'S&P500', fee: '연 0.0047%', listed: '2021-04-09', fx: '환노출', feeSource: 'https://kbam.co.kr/prod/finderDetail/44B3 (운용사 페이지, 2026-11-10 확인: 총보수 연 0.0047%, 상장 2021-04-09, 기초지수 S&P 500 Index(KRW), 순자산 1조 4,952억원 26.11.10)' }
  ],
  SP500_US: [
    { symbol: 'SPY', name: 'S&P500 ETF(SPDR)', index: 'S&P500', fee: '연 0.0945%', listed: '1993-01-22', fx: 'USD', feeSource: 'https://www.etf.com/sections/news/voo-vs-spy-vs-ivv-which-sp-500-etf-should-you-buy-2026 (2차 출처, 2026-11-10 확인)' },
    { symbol: 'VOO', name: 'S&P500 ETF(Vanguard)', index: 'S&P500', fee: '연 0.03%', listed: '2010-09-07', fx: 'USD', feeSource: '같은 2차 출처' },
    { symbol: 'IVV', name: 'S&P500 ETF(iShares)', index: 'S&P500', fee: '연 0.03%', listed: '2000-05-15', fx: 'USD', feeSource: '같은 2차 출처' },
    { symbol: 'SPYM', name: 'S&P500 ETF(SPDR Portfolio, 구 SPLG)', index: 'S&P500', fee: '연 0.02%', listed: '2005-11-08', fx: 'USD', feeSource: '같은 2차 출처. 야후는 2026-11-10 현재 SPLG 를 더 주지 않고 SPYM 으로 준다(개명 확인)' }
  ]
};
export const YAHOO = { '069500': '069500.KS', '102110': '102110.KS', '148020': '148020.KS', '360750': '360750.KS', '379800': '379800.KS', '360200': '360200.KS', '379780': '379780.KS' };
const SCENARIOS = [ // 비중 × 충격(%). 과거 비슷한 크기: 2022 반도체 −35~−45%, 2020-03 코스피 −35%, 2022 S&P −25%, 2022 TLT −31%
  { id: 'semi', name: '반도체 −30%', shock: a => a.sector === 'semi' ? -30 : a.index === 'KOSPI200' ? -12 : a.index === 'S&P500' ? -8 : a.sector === 'platform' ? -8 : 0 },
  { id: 'kospi', name: '코스피 −20%', shock: a => a.index === 'KOSPI200' ? -20 : a.country === 'KR' && a.sector !== 'index' ? -22 : 0 },
  { id: 'us', name: '미국 주식 −20%', shock: a => a.index === 'S&P500' ? -20 : a.fxUnderlying === 'USD' && !['bond', 'index'].includes(a.sector) ? -24 : a.country === 'KR' ? -8 : 0 },
  { id: 'krw', name: '원화 +10% 강세(달러 자산 −10%)', shock: a => a.fxUnderlying === 'USD' ? -10 : 0 },
  { id: 'rates', name: '장기금리 급등(장기채 −15%, 성장주 −10%)', shock: a => a.sector === 'bond' ? -15 : ['semi', 'platform', 'bio'].includes(a.sector) ? -10 : a.sector === 'finance' ? 3 : -4 }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;
const shiftDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
export async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1420070400&period2=9999999999&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}

/** 핵심 비중: 투자 비중(100 − 현금)을 국내 31 : 미국 54 로 나누고, 같은 지수 ETF 여러 개에 균등 분할(한 종목 ≤ cap). variant: 'A'(국내 상장) | 'B'(미국 상장) | 'S'(2종목, 상한 없음) */
export function coreWeights({ cashPct = 10, variant = 'A', cap = PER_NAME_CAP } = {}) {
  const invested = 100 - cashPct, tot = CORE_SPLIT.KR + CORE_SPLIT.US;
  const kr = invested * CORE_SPLIT.KR / tot, us = invested * CORE_SPLIT.US / tot;
  const usList = variant === 'B' ? ETFS.SP500_US : ETFS.SP500_KR;
  // 같은 지수 ETF n개에 0.1% 단위로 내림 분할하고, 남는 0.1% 조각은 한 종목에 몰지 않고 돌아가며 얹어 합이 정확히 (100 − 현금)이 되게 한다
  const split = (amount, list, n) => { const each = Math.floor(amount / n * 10) / 10, w = {}; list.slice(0, n).forEach(e => { w[e.symbol] = each; }); let left = Math.round((amount - each * n) * 10); const keys = Object.keys(w); for (let i = 0; left > 0; i = (i + 1) % keys.length, left--) w[keys[i]] = r1(w[keys[i]] + 0.1); return w; };
  const w = {};
  if (variant === 'S') { w[ETFS.KR200[0].symbol] = r1(kr); w[usList[0].symbol] = r1(us); }
  else { Object.assign(w, split(us, usList, Math.min(usList.length, Math.ceil(us / cap - 1e-9)))); Object.assign(w, split(kr, ETFS.KR200, Math.min(ETFS.KR200.length, Math.ceil(kr / cap - 1e-9)))); }
  const sum = Object.values(w).reduce((a, b) => a + b, 0), keys = Object.keys(w); let left = Math.round((invested - sum) * 10);
  for (let i = 0; left !== 0; i = (i + 1) % keys.length) { w[keys[i]] = r1(w[keys[i]] + (left > 0 ? 0.1 : -0.1)); left += left > 0 ? -1 : 1; }
  const over = Object.entries(w).filter(([, v]) => v > cap + 1e-9).map(([k, v]) => `${k} ${v}%`);
  return { weights: w, cashPct, invested, note: over.length ? `한 종목 상한 ${cap}% 초과: ${over.join(', ')} (같은 지수 ETF 가 더 없어 나누지 못함 → 규칙·주문 보호 한도 변경 필요)` : null };
}

function metricsOf(path) { let peak = -Infinity, mdd = 0; for (const v of path) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); } return { ret: r1((path.at(-1) / path[0] - 1) * 100), mdd: r1(mdd * 100) }; }
const lastLE = (arr, date) => { let lo = 0, hi = arr.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].date <= date) { f = m; lo = m + 1; } else hi = m - 1; } return f; };
/** 지수선: dates 위에서 각 부분(종가 배열, 통화)의 첫날 대비 비율 × 비중 + 현금. 원화 환산은 그 날(없으면 직전) 환율. */
export function indexLine(dates, parts, fx, cashPct = 0) {
  const fxAt = d => { const k = lastLE(fx, d); return k >= 0 ? fx[k].close : fx[0]?.close ?? 1; };
  const at = (c, d) => { const k = lastLE(c, d); return k < 0 ? null : c[k].close; };
  const vals = parts.map(p => dates.map(d => { const v = at(p.candles, d); return v === null ? null : v * (p.currency === 'USD' ? fxAt(d) : 1); }));
  if (vals.some(v => v[0] === null || v.some(x => x === null))) return null;
  const path = dates.map((d, i) => cashPct / 100 + parts.reduce((a, p, j) => a + p.share / 100 * vals[j][i] / vals[j][0], 0));
  return metricsOf(path);
}

/**
 * 계획을 만든다(순수 함수: 같은 입력이면 같은 결과). 시세는 밖에서 넣는다.
 * @param candles {symbol: [{date, open, close}]} 현지 통화 일봉(PP2 ETF 전부 + PP1 종목)
 * @param fx USD→KRW 일봉 · pp1 data/paper-plan.json 내용 · snapshot data/paper-live-public.json 내용(전환 비용 추정용)
 */
export function buildPP2({ candles, fx, today, pp1, snapshot = null, windows = null, reviewWindows = REVIEW_WINDOWS, capitalKrw = 100_000_000, log = () => {} }) {
  const y = +today.slice(0, 4);
  const WINDOWS = windows || [{ id: 'recent12m', label: '최근 12개월', from: `${y - 1}-${today.slice(5)}` }, { id: 'ytd', label: `${y}년`, from: `${y}-01-01` }, ...[2020, 2021, 2022, 2023, 2024, 2025].map(yy => ({ id: `y${yy}`, label: `${yy}년`, from: `${yy}-01-01`, to: `${yy}-12-31` }))];
  const need = s => { if (!Array.isArray(candles[s]) || candles[s].length < 30) throw new Error(`${s}: 시세가 없습니다`); return candles[s]; };
  const meta = {}; for (const g of ['KR200', 'SP500_KR', 'SP500_US']) for (const e of ETFS[g]) meta[e.symbol] = { ...e, group: g, currency: g === 'SP500_US' ? 'USD' : 'KRW', country: g === 'KR200' ? 'KR' : 'US', sector: 'index', sectorName: '지수 ETF', fxUnderlying: g === 'KR200' ? null : 'USD' };
  for (const s of Object.keys(meta)) need(s);
  const kodex = need('069500'), spy = need('SPY');
  const vol1y = s => { const r = krwReturns(candles[s], meta[s]?.currency || pp1.weights[s]?.currency || 'KRW', fx).slice(-252).map(x => x.r); const v = ewmaSigma(r).at(-1) * Math.sqrt(252); return Number.isFinite(v) ? Math.round(v * 1000) / 10 : null; };
  // 12개월 가격 수익률 차이(ETF − 기준). 기준: S&P500 ETF 는 SPY×환율, 코스피200 ETF 는 KODEX 200. 분배금 제외 가격 기준이라 TR(재투자) ETF 는 +, 분배형은 배당 시점에 −가 섞인다.
  const ret12 = (c, usd) => { const k = lastLE(c, today), j = lastLE(c, shiftDays(today, -365)); if (k < 0 || j < 0) return null; const f = d => usd ? fx[lastLE(fx, d)]?.close || 1 : 1; return c[k].close * f(c[k].date) / (c[j].close * f(c[j].date)) - 1; };
  const refUS = ret12(spy, true), refKR = ret12(kodex, false);
  // ── 변형(계획 × 규칙) ──
  const A = coreWeights({ cashPct: 10, variant: 'A' }), A5 = coreWeights({ cashPct: 5, variant: 'A' }), A3 = coreWeights({ cashPct: 3, variant: 'A' }), B = coreWeights({ cashPct: 10, variant: 'B' }), S = coreWeights({ cashPct: 10, variant: 'S' });
  const pp1W = Object.fromEntries(Object.entries(pp1.weights).map(([k, v]) => [k, v.pct]));
  for (const s of Object.keys(pp1W)) need(s);
  const basketOf = w => Object.keys(w).map(s => ({ symbol: s, name: meta[s]?.name || pp1.weights[s]?.name || s, currency: meta[s]?.currency || pp1.weights[s]?.currency || 'KRW' }));
  const VARIANTS = [
    { id: 'A', label: 'PP2-A 국내 상장 ETF · 현금 10%', plan: A.weights, cashPct: 10, rules: DEFAULT_RULES, main: true },
    { id: 'A_c5', label: 'PP2-A · 현금 5% (규칙 현금 최소 5%로 변경 필요)', plan: A5.weights, cashPct: 5, rules: { ...DEFAULT_RULES, minCash: 5 }, note: A5.note },
    { id: 'A_c3', label: 'PP2-A · 현금 3% (규칙 현금 최소 3%로 변경 필요)', plan: A3.weights, cashPct: 3, rules: { ...DEFAULT_RULES, minCash: 3 }, note: A3.note },
    { id: 'A_dl5', label: 'PP2-A · 현금 10% · 하루 손실 한도 5% (진단: 어느 규칙이 묶는가)', plan: A.weights, cashPct: 10, rules: { ...DEFAULT_RULES, dailyLoss: 5 } },
    { id: 'B', label: 'PP2-B 미국 상장 ETF(SPY·VOO·IVV·SPYM) · 현금 10%', plan: B.weights, cashPct: 10, rules: DEFAULT_RULES },
    { id: 'S', label: 'PP2-S 2종목(KODEX 200 + TIGER 미국S&P500) · 지금 규칙(한 종목 25%에 잘림)', plan: S.weights, cashPct: 10, rules: DEFAULT_RULES },
    { id: 'S_ms60', label: 'PP2-S 2종목 · 한 종목 상한 60%로 변경 시', plan: S.weights, cashPct: 10, rules: { ...DEFAULT_RULES, maxSingle: 60 } },
    { id: 'PP1', label: `PP1 (${pp1.version}) · 현금 ${pp1.cashPct}%`, plan: pp1W, cashPct: pp1.cashPct, rules: DEFAULT_RULES }
  ];
  const firstDate = s => candles[s][0]?.date;
  // PP1 파일에 실린 숫자(참고): PP1 빌더는 상장 전 종목(329180, 2021-09-17 상장)이 있는 2020~2022 창도 계산했다. 여기서는 모든 변형에 같은 기준(시작 180일 전부터 시세가 있어야 함)을 적용하므로 PP1 도 그 창은 계산하지 않고, 실린 숫자만 옮겨 둔다.
  const pp1Published = Object.fromEntries((pp1.validation?.windows || []).filter(w => w.ok && w.plan?.rule).map(w => [w.id, { rule: w.plan.rule, hold: w.plan.hold }]));
  const trim = (w, to) => Object.fromEntries(Object.keys(w).map(s => [s, candles[s].filter(c => c.date <= to)]));
  const benchKR = { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: kodex };
  const windowsOut = [], variantRows = {};
  for (const W of WINDOWS) {
    const to = W.to || today, row = { id: W.id, label: W.label, from: W.from, to, variants: {}, pp1Published: pp1Published[W.id] || null };
    for (const V of VARIANTS) {
      const late = Object.keys(V.plan).filter(s => firstDate(s) > shiftDays(W.from, -180));
      if (late.length) { row.variants[V.id] = { ok: false, reason: `상장 전·시세 부족: ${late.map(s => `${meta[s]?.name || s}(${firstDate(s)})`).join(', ')}` }; continue; }
      const r = rehearse({ basket: basketOf(V.plan), capitalKrw, rules: V.rules, plan: V.plan, candlesBySymbol: trim(V.plan, to), fxCandles: fx, from: W.from, to, benchmark: benchKR, label: V.id });
      if (!r.ok) { row.variants[V.id] = { ok: false, reason: r.reason }; continue; }
      const dates = r.series.map(x => x.date);
      const mix = indexLine(dates, [{ candles: kodex, currency: 'KRW', share: (100 - V.cashPct) * CORE_SPLIT.KR / 85 }, { candles: spy, currency: 'USD', share: (100 - V.cashPct) * CORE_SPLIT.US / 85 }], fx, V.cashPct);
      row.variants[V.id] = { ok: true, days: r.days, rule: { ret: r1(r.metrics.rule.ret * 100), mdd: r1(r.metrics.rule.mdd * 100) }, hold: { ret: r1(r.metrics.hold.ret * 100), mdd: r1(r.metrics.hold.mdd * 100) }, indexMix: mix, trades: r.activity.trades, blocked: r.activity.blockedTotal, blockedBy: r.activity.blocked, costPct: Math.round(r.activity.costPct * 100) / 100, cashAvgPct: Math.round(r.activity.cashAvgPct), frictionPct: mix ? r1(r1(r.metrics.rule.ret * 100) - mix.ret) : null };
      if (!row.from0) { row.from0 = r.from; row.to0 = r.to; row.kodex200 = r.metrics.bench ? { ret: r1(r.metrics.bench.ret * 100), mdd: r1(r.metrics.bench.mdd * 100) } : null; row.spyKrw = indexLine(dates, [{ candles: spy, currency: 'USD', share: 100 }], fx, 0); row.spy = indexLine(dates, [{ candles: spy, currency: 'USD', share: 100 }], fx.map(c => ({ ...c, close: 1 })), 0); row.index85 = indexLine(dates, [{ candles: kodex, currency: 'KRW', share: 85 * CORE_SPLIT.KR / 85 }, { candles: spy, currency: 'USD', share: 85 * CORE_SPLIT.US / 85 }], fx, 15); row.index100 = indexLine(dates, [{ candles: kodex, currency: 'KRW', share: CORE_SPLIT.KR / 85 * 100 }, { candles: spy, currency: 'USD', share: CORE_SPLIT.US / 85 * 100 }], fx, 0); }
    }
    const a = row.variants.A, p1 = row.variants.PP1;
    log(`${W.label}: PP2-A 규칙 ${a.ok ? `${a.rule.ret}% / 최대손실 ${a.rule.mdd}% · 현금평균 ${a.cashAvgPct}% · 지수+현금(10%) ${a.indexMix?.ret}%` : a.reason} · PP1 규칙 ${p1.ok ? `${p1.ret ?? p1.rule.ret}%` : p1.reason} · KODEX200 ${row.kodex200?.ret}% · SPY(원화) ${row.spyKrw?.ret}%`);
    windowsOut.push(row);
  }
  // 화면(paper-ui planDocHtml) 호환용 표: 주 변형 A 만 PP1 과 같은 꼴로
  const uiWindows = windowsOut.map(w => w.variants.A.ok ? { id: w.id, label: w.label, from: w.from0, to: w.to0, days: w.variants.A.days, ok: true, plan: { rule: w.variants.A.rule, hold: w.variants.A.hold }, pp1: w.variants.PP1.ok ? { rule: w.variants.PP1.rule, hold: w.variants.PP1.hold } : null, pp1Published: w.pp1Published, indexMix: w.variants.A.indexMix, kodex200: w.kodex200, spy: w.spyKrw, spyUsd: w.spy, trades: w.variants.A.trades, costPct: w.variants.A.costPct, cashAvgPct: w.variants.A.cashAvgPct } : { id: w.id, label: w.label, ok: false, reason: w.variants.A.reason });
  // ── 규칙 묶음 × 기간 표(lib/strategy-review): 현금 10/5/3 각각 자기 계획으로, 그리고 C3 + 세 프리셋 ──
  const cutAll = Object.fromEntries(Object.keys(A.weights).map(s => [s, candles[s].filter(c => c.date <= today)]));
  const rv = compareRuleSets({ basket: basketOf(A.weights), plan: A.weights, capitalKrw, candlesBySymbol: cutAll, fxCandles: fx, benchmark: benchKR, to: today, current: { label: 'C3 지금 규칙(현금 10%)', rules: DEFAULT_RULES }, windows: reviewWindows });
  const cashRows = [['A_c5', 'C3 · 현금 5%', A5.weights, { ...DEFAULT_RULES, minCash: 5 }], ['A_c3', 'C3 · 현금 3%', A3.weights, { ...DEFAULT_RULES, minCash: 3 }]].map(([id, label, plan, rules]) => compareRuleSets({ basket: basketOf(plan), plan, capitalKrw, candlesBySymbol: cutAll, fxCandles: fx, benchmark: benchKR, to: today, ruleSets: [{ id, label, rules }], windows: reviewWindows }).rows[0]);
  const review = { version: rv.version, to: rv.to, windows: rv.windows, rows: [...rv.rows, ...cashRows].map(r => ({ id: r.id, label: r.label, rules: { maxSingle: r.rules.maxSingle, minCash: r.rules.minCash, dailyLoss: r.rules.dailyLoss, maxTrades30: r.rules.maxTrades30 }, cells: r.cells })), hold: rv.hold, bench: rv.bench, findings: rv.findings, note: '프리셋 행(보수·중간·적극)은 fitPlan 이 계획을 그 규칙의 한 종목 상한·현금 최소에 맞춘 뒤의 결과. 이 표의 지수+현금(mix) 열은 통화 기준이라 A안(전부 원화)에선 뜻이 달라 빼고, 위 windows 의 indexMix(국내 31 : 미국 54 + 현금)를 쓴다.' };
  // ── 충격 시나리오 ──
  const attr = s => meta[s] || (pp1.weights[s] ? { ...pp1.weights[s], fxUnderlying: pp1.weights[s].currency === 'USD' ? 'USD' : null, index: pp1.weights[s].sector === 'index' ? (pp1.weights[s].currency === 'USD' ? 'S&P500' : 'KOSPI200') : null } : { sector: 'unknown', country: /^\d{6}$/.test(s) ? 'KR' : 'US', fxUnderlying: /^\d{6}$/.test(s) ? null : 'USD', index: null });
  const lossOf = (wt) => sc => r1(Object.entries(wt).reduce((x, [s, p]) => x + p / 100 * sc.shock(attr(s)), 0));
  const equal = Object.fromEntries(Object.keys(A.weights).map(s => [s, r1(90 / Object.keys(A.weights).length)]));
  const current = {}; if (snapshot?.balance?.positions && snapshot.balance.total > 0) for (const p of snapshot.balance.positions) current[p.symbol] = p.valueKrw / snapshot.balance.total * 100;
  const scenarios = SCENARIOS.map(sc => ({ id: sc.id, name: sc.name, planPct: lossOf(A.weights)(sc), equalPct: lossOf(equal)(sc), kodexOnlyPct: lossOf({ '069500': 100 })(sc), currentPct: lossOf(current)(sc), pp1Pct: lossOf(pp1W)(sc), bPct: lossOf(B.weights)(sc) }));
  // ── 전환 비용 추정(공개 스냅샷의 보유 → PP2-A 목표) ──
  let switchover = null;
  if (snapshot?.balance) {
    const total = snapshot.balance.total, held = Object.fromEntries((snapshot.balance.positions || []).map(p => [p.symbol, { name: p.name, valueKrw: p.valueKrw }]));
    const orders = [];
    for (const [s, h] of Object.entries(held)) { const target = total * (A.weights[s] || 0) / 100; if (h.valueKrw - target > 10000) orders.push({ symbol: s, name: h.name, side: 'SELL', amountKrw: Math.round(h.valueKrw - target) }); }
    for (const [s, p] of Object.entries(A.weights)) { const target = total * p / 100, have = held[s]?.valueKrw || 0; if (target - have > 10000) orders.push({ symbol: s, name: meta[s].name, side: 'BUY', amountKrw: Math.round(target - have) }); }
    const sell = orders.filter(o => o.side === 'SELL').reduce((a, o) => a + o.amountKrw, 0), buy = orders.filter(o => o.side === 'BUY').reduce((a, o) => a + o.amountKrw, 0), L = snapshot.limits || {};
    switchover = { asOf: snapshot.asOf, totalKrw: total, orders, sellKrw: sell, buyKrw: buy, turnoverKrw: sell + buy, turnoverPct: r1((sell + buy) / total * 100), costKrw: Math.round((sell + buy) * 0.003), limits: { maxOrderKrw: L.maxOrderKrw ?? null, maxDailyKrw: L.maxDailyKrw ?? null, ordersOverMaxOrder: L.maxOrderKrw ? orders.filter(o => o.amountKrw > L.maxOrderKrw).map(o => `${o.name} ${o.amountKrw.toLocaleString('ko-KR')}원`) : [], sessionsByDailyCap: L.maxDailyKrw ? Math.ceil((sell + buy) / L.maxDailyKrw) : null }, note: '재조정 묶음은 매도 먼저, 그 돈으로 매수. 비용은 편도 0.2% + 미끄러짐 0.1% 가정(엔진과 같음). 하루 한도 때문에 한 장(세션)에 다 못 보내면 다음 장으로 넘어가고, 그 사이 시장이 움직인 만큼은 계획과 달라진다.' };
  }
  // ── 비중 문서 ──
  const weights = {};
  for (const [s, p] of Object.entries(A.weights)) {
    const m = meta[s], own12 = ret12(candles[s], false), ref = m.group === 'KR200' ? refKR : refUS, diff = own12 !== null && ref !== null ? r1((own12 - ref) * 100) : null;
    const why = [`벤치마크 그대로(시장 수익이 바닥선): ${m.index} 를 추종하는 지수 ETF`, `핵심 ${m.country === 'KR' ? `국내 ${CORE_SPLIT.KR}` : `미국 ${CORE_SPLIT.US}`}/85 를 같은 지수 ETF ${m.group === 'KR200' ? ETFS.KR200.length : ETFS.SP500_KR.length}개로 나눔(한 종목 ≤ ${PER_NAME_CAP}%: 규칙 한 종목 25%·주문 보호 1회 1,500만원)`, `총보수 ${m.fee} · 상장 ${m.listed}${m.fx ? ` · ${m.fx}` : ''}`];
    if (diff !== null) why.push(`12개월 가격 수익률 − 기준(${m.group === 'KR200' ? 'KODEX 200' : 'SPY×환율'}) = ${diff > 0 ? '+' : ''}${diff}%p (분배금 제외 가격 기준)`);
    weights[s] = { pct: p, name: m.name, currency: m.currency, country: m.country, sector: 'index', sectorName: '지수 ETF', index: m.index, fxUnderlying: m.fxUnderlying, vol1y: vol1y(s), why, exposure: [], facts: { fee: m.fee, listed: m.listed, fx: m.fx || null, source: m.feeSource, ret12mPct: own12 === null ? null : r1(own12 * 100), ref12mPct: ref === null ? null : r1(ref * 100), diff12mPct: diff } };
  }
  const byCountry = { KR: r1(Object.values(weights).filter(w => w.country === 'KR').reduce((a, w) => a + w.pct, 0)), US: r1(Object.values(weights).filter(w => w.country === 'US').reduce((a, w) => a + w.pct, 0)) };
  const okA = windowsOut.filter(w => w.variants.A.ok), med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
  const summary = {
    windowsComputed: { A: okA.length, PP1: windowsOut.filter(w => w.variants.PP1.ok).length, B: windowsOut.filter(w => w.variants.B.ok).length, total: windowsOut.length },
    medianRuleRet: med(okA.map(w => w.variants.A.rule.ret)), medianRuleMdd: med(okA.map(w => w.variants.A.rule.mdd)), medianIndexMixRet: med(okA.map(w => w.variants.A.indexMix?.ret).filter(Number.isFinite)), medianFrictionPct: med(okA.map(w => w.variants.A.frictionPct).filter(Number.isFinite)), medianCashAvgPct: med(okA.map(w => w.variants.A.cashAvgPct)),
    sameWindows: okA.map(w => ({ id: w.id, A: w.variants.A.rule.ret, A_mdd: w.variants.A.rule.mdd, PP1: w.variants.PP1.ok ? w.variants.PP1.rule.ret : null, PP1_mdd: w.variants.PP1.ok ? w.variants.PP1.rule.mdd : null, B: w.variants.B.ok ? w.variants.B.rule.ret : null, indexMix: w.variants.A.indexMix?.ret ?? null, kodex200: w.kodex200?.ret ?? null, spyKrw: w.spyKrw?.ret ?? null })),
    aBeatsPP1Ret: okA.filter(w => w.variants.PP1.ok && w.variants.A.rule.ret > w.variants.PP1.rule.ret).length, aWorseMdd: okA.filter(w => w.variants.PP1.ok && w.variants.A.rule.mdd < w.variants.PP1.rule.mdd).length, aBeatsIndexMix: okA.filter(w => w.variants.A.indexMix && w.variants.A.rule.ret > w.variants.A.indexMix.ret).length, comparable: okA.filter(w => w.variants.PP1.ok).length,
    worstScenarioPct: Math.min(...scenarios.map(s => s.planPct)), worstScenario: scenarios.reduce((a, b) => b.planPct < a.planPct ? b : a).name
  };
  const out = {
    version: PLAN_VERSION, generatedAt: new Date().toISOString(), asOf: today, rulesVersion: RULES_VERSION, status: 'candidate', replaces: pp1.version,
    caps: { single: PER_NAME_CAP, satelliteTotal: SATELLITE.maxTotalPct, satelliteEach: SATELLITE.maxEachPct, cashMin: 10 },
    method: [
      '핵심 + 위성. 핵심(90%)은 지수 ETF 만: 국내 31 : 미국 54(앱 비교선과 같은 비율). 종목을 고르지 않는다 → 시장 수익이 바닥선',
      `A안(이 파일): 미국 노출을 국내 상장 S&P500 ETF(원화, KST 장중)로. B안(미국 상장 SPY 등)은 validation.windows.variants.B 에 숫자만`,
      `위성 ≤ ${SATELLITE.maxTotalPct}%(종목당 ≤ ${SATELLITE.maxEachPct}%): 승인된 종목 가설만. 지금 0건 → 비어 있음`,
      `현금 10% = 규칙 C3 현금 최소. 5%·3% 는 validation.windows.variants.A_c5/A_c3 에 숫자만(규칙 변경은 사용자 결정)`,
      `한 종목 ≤ ${PER_NAME_CAP}%: 규칙 한 종목 25% 와 주문 보호 1회 15,000,000원을 지키기 위해 같은 지수 ETF 를 운용사별로 나눔(우회. 규칙을 바꾸면 2종목으로 줄일 수 있음: variants.S_ms60)`,
      `운용은 규칙 ${RULES_VERSION}(주 1회 점검, 한 종목 25%, 현금 10%, 하루 손실 2.5%, 30일 8회, 미국 200일선 — A안은 전부 원화 종목이라 200일선 규칙이 걸리지 않음)`
    ],
    weights, cashPct: 10, satellite: SATELLITE, concentration: { byCountry, bySector: { '지수 ETF': r1(100 - 10) }, byIndex: { KOSPI200: byCountry.KR, 'S&P500': byCountry.US }, cash: 10, names: Object.keys(weights).length },
    variants: Object.fromEntries(VARIANTS.map(v => [v.id, { label: v.label, plan: v.plan, cashPct: v.cashPct, rules: { maxSingle: v.rules.maxSingle, minCash: v.rules.minCash, dailyLoss: v.rules.dailyLoss }, note: v.note || null }])),
    validation: {
      windows: uiWindows, windowsAll: windowsOut, review, scenarios, summary, switchover,
      honesty: [
        '핵심의 바닥선은 "지수 수익 − ETF 비용 − 엔진 마찰". 마찰 = 주 1회 점검·밴드 10%·다음 시가 체결·비용 0.2%+0.1%·현금 10%·하루 손실 한도 축소. 크기는 windows[].variants.A.frictionPct(= 규칙 수익률 − 같은 비중 지수+현금)와 cashAvgPct(실제 현금 평균; 10%보다 크면 하루 손실 한도가 묶은 것)',
        '위성이 수익을 더한다는 증거는 없다(Goyal–Welch–Zafirov RFS 2024, 저장소 요인 연구 2026-11-06). 이 계좌는 그것을 측정하기 위해 있다. 위성이 비어 있으면 계좌 = 핵심 = 지수 − 마찰',
        `PP1 → PP2 전환은 다음 장에서 전면 재조정(국내 ${(snapshot?.balance?.positions || []).length}종목 중 KODEX 200 외 매도, ETF ${Object.keys(weights).length - 1}개 매수). 추정 회전·비용은 switchover`,
        '2020~2025 는 규칙(2026-11-06)과 계획(2026-11-10) 이전 구간이라 표본 외가 아니다. 진짜 표본 외는 장부다. 국내 상장 S&P500 ETF 는 2020-08·2021-04 상장이라 A안의 2020·2021 창은 계산할 수 없다(상장 전 시세를 지어 넣지 않음)',
        'PP1 재계산은 2023~2026 창만 가능하다(HD현대중공업 329180 이 2021-09-17 상장). PP1 파일에 실린 2020~2022 숫자는 그 종목 없이(상장 뒤 매수) 계산된 것이라 같은 기준이 아니다 → windows[].pp1Published 에 참고로만 둔다',
        '"장" 이 무엇인지는 사용자가 정해야 한다. 2025년 KODEX 200 +90.4% vs SPY(원화) +14.4%: 국내 31 : 미국 54 핵심은 코스피200 단독보다 크게 뒤진다. 핵심 비율을 바꾸는 것은 지수 예측이 아니라 비교 기준의 선택이다'
      ],
      note: `A안을 규칙 ${RULES_VERSION} 대로 운용했을 때의 수익률·최대 손실. 지수+현금은 같은 투자 비중의 KODEX 200 + SPY(원화). 2020~2021 창은 국내 상장 S&P500 ETF 상장 전이라 계산하지 않았다. 숫자는 그대로 적었다.`
    },
    sources: [
      'TIGER 미국S&P500 360750: 총보수 연 0.0068%, 상장 2020-08-07, 기초지수 S&P 500, 순자산 20.4조원(26.11.09) — https://www.funetf.co.kr/product/etf/view/KR7360750004 (2026-11-10 확인)',
      'TIGER 200 102110: 총보수 연 0.05%, 상장 2008-04-03 — https://www.funetf.co.kr/product/etf/view/KR7102110004 (2026-11-10 확인)',
      'KODEX 200 069500: 총보수 연 0.15%, 상장 2002-10-14 — https://m.samsungfund.com/sheet/20260206/2ETF01_20260131.pdf (검색 색인 요약; PDF 본문이 이미지라 직접 확인 못 함, 2026-11-10)',
      'KODEX 미국S&P500TR 379800: 상장 2021-04-09; 총보수 0.0099%(2024 인하 보도 smarttoday 64345) vs 0.05%(trackinsight) 출처 불일치 — https://www.trackinsight.com/en/fund/379800 (2026-11-10 확인)',
      'ACE 미국S&P500 360200: 상장 2020-08-07(stockanalysis); 총보수 0.07%→0.0047% 인하 보도 — https://www.dailian.co.kr/news/view/1521860/ (2026-11-10 확인)',
      'RISE 미국S&P500 379780: 총보수 연 0.0047%, 상장 2021-04-09, 기초지수 S&P 500 Index(KRW), 환노출, 순자산 1조 4,952억원(26.11.10) — https://kbam.co.kr/prod/finderDetail/44B3 (운용사 페이지, 2026-11-10 확인)',
      'RISE 200 148020: 총보수 연 0.017%(2025-07-30 보도), 상장 2011-10-20(운용사 목록) — https://www.heraldk.com/article/2025073017281493808 · https://www.riseetf.co.kr/prod/finderDetail/4435 (2026-11-10 확인; 운용사 상품 페이지 본문은 JS 렌더라 수치 직접 확인 못 함)',
      'SPY 0.0945% · VOO 0.03% · IVV 0.03% · SPLG(현 SPYM) 0.02% — https://www.etf.com/sections/news/voo-vs-spy-vs-ivv-which-sp-500-etf-should-you-buy-2026 (2차 출처, 2026-11-10 확인; 야후 차트 API 는 SPLG 를 더 주지 않고 SPYM 으로 준다)',
      '야후 차트 API 2026-11-10: 360750.KS·360200.KS 2020-08-07~, 379800.KS·379780.KS 2021-04-09~, 069500.KS·102110.KS·148020.KS 2015-01-02 이전~ (모두 2026-11-10 종가까지)',
      'data/paper-plan.json PP1-2026-11-09 (비교 대상) · data/paper-live-public.json 2026-11-10 (전환 비용 추정) · lib/paper-trading.js rehearse · lib/strategy-review.js compareRuleSets',
      'Goyal–Welch–Zafirov, RFS 2024 · docs/DECISIONS.md 2026-11-06 요인 연구·성장 전망 전략 검증'
    ]
  };
  return out;
}

async function main() {
  const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const cacheDir = opt('--cache', join(tmpdir(), 'tq-pp2-candles')), outFile = resolve(root, opt('--out', 'data/paper-plan.pp2.json'));
  mkdirSync(cacheDir, { recursive: true });
  const pp1 = JSON.parse(readFileSync(resolve(root, 'data/paper-plan.json'), 'utf8'));
  let snapshot = null; try { snapshot = JSON.parse(readFileSync(resolve(root, 'data/paper-live-public.json'), 'utf8')); } catch { console.log('공개 스냅샷을 읽지 못해 전환 비용 추정을 건너뜁니다'); }
  const get = async (sym, yahooSym) => { const f = join(cacheDir, `${yahooSym.replace(/[^A-Za-z0-9.=-]/g, '_')}.json`); if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')); const c = await history(yahooSym); writeFileSync(f, JSON.stringify(c)); await sleep(1100); return c; };
  const fx = await get('KRW=X', 'KRW=X'), candles = {};
  const syms = new Set([...Object.values(ETFS).flat().map(e => e.symbol), ...Object.keys(pp1.weights)]);
  for (const s of syms) { const cur = YAHOO[s] ? 'KRW' : (pp1.weights[s]?.currency || 'USD'); candles[s] = await get(s, YAHOO[s] || (cur === 'KRW' ? `${s}.KS` : s)); console.log(`${s}: ${candles[s][0].date} ~ ${candles[s].at(-1).date} (${candles[s].length}일)`); }
  const today = new Date().toISOString().slice(0, 10);
  const out = buildPP2({ candles, fx, today, pp1, snapshot, log: console.log });
  writeFileSync(outFile, JSON.stringify(out));
  console.log('\n비중', Object.entries(out.weights).map(([s, v]) => `${v.name} ${v.pct}%`).join(' · '), `· 현금 ${out.cashPct}%`);
  console.log('요약', JSON.stringify(out.validation.summary));
  if (out.validation.switchover) console.log('전환', JSON.stringify({ ...out.validation.switchover, orders: out.validation.switchover.orders.length }));
  console.log(`→ ${outFile}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
