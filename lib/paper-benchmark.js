// 모의계좌 비교선(순수 함수 · 입출력 없음 · 서버 전용: vercel.json 이 /lib/paper-benchmark.js 를 막는다 · 브라우저가 쓰려면 그 목록과 TC-REG-002 를 함께 고칠 것). "국가 비중·현금 일치 지수 투자": 기준선을 정한 날의 계획에서 국내·미국 비중과 현금 비중만 가져와
// 국내분은 KODEX 200, 미국분은 S&P500 ETF(원화 환산), 나머지는 현금 1.0 으로 둔 지수 투자의 날마다 가치. 절대 수익률은 시장 방향이 만들므로 헤드라인은 이 선과의 차이(%p)만 쓴다(결정 21).
// 같은 위험 수준은 아니다: 포트폴리오는 개별 종목을 들고 있고 이 선은 지수 둘과 현금뿐이다. 시뮬(lib/paper-trading.js mix)과 이름·구성 규칙을 같게 둔다.
export const BENCHMARK_VERSION = 'BM1-2026-11-12';
export const BENCHMARK_LABEL = '국가 비중·현금 일치 지수 투자';
export const BENCHMARK_LEGS = { KR: { symbol: '069500', name: 'KODEX 200', currency: 'KRW' }, US: { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' } };
export const BENCHMARK_HOLD_REASON = '지수 시세를 읽지 못해 비교를 보류';
/** 갱신에 실패했지만 전에 읽은 선이 있어 그 값으로 비교한 경우(지수 종가는 하루 한 번 바뀌므로 잠깐의 실패로 '—' 를 찍지 않는다 · 2026-11-12 검토). */
export const BENCHMARK_STALE_NOTE = '지수 시세 갱신 실패 · 마지막 읽은 값';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const pctOf = v => (v && typeof v === 'object' ? num(v.pct) : num(v));
const marketOf = (symbol, v) => (v?.currency ? (v.currency === 'USD' ? 'US' : 'KR') : /^\d{6}$/.test(String(symbol).split('.')[0]) ? 'KR' : 'US');

/** 계획 {코드: pct | {pct, currency}} → 비교선 정의. 비중은 계획의 국가 합(0.1% 단위), 현금 = 100 − 둘(음수면 0). 시각이 아닌 정의이므로 기준선의 계획에서 언제 만들어도 같은 값이다. */
export function benchmarkDefinition(plan) {
  const w = { KR: 0, US: 0 };
  for (const [k, v] of Object.entries(plan || {})) { const pct = pctOf(v); if (Number.isFinite(pct) && pct > 0) w[marketOf(k, v)] += pct; }
  const KR = r1(w.KR), US = r1(w.US);
  return { version: BENCHMARK_VERSION, label: BENCHMARK_LABEL, weights: { KR, US, cash: r1(Math.max(0, 100 - KR - US)) }, legs: { KR: { ...BENCHMARK_LEGS.KR }, US: { ...BENCHMARK_LEGS.US } } };
}

// 그 날짜 이하 마지막 봉(없으면 -1). 봉은 날짜 오름차순이어야 한다.
const lastLE = (cs, d) => { let lo = 0, hi = cs.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].date <= d) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const clean = cs => (Array.isArray(cs) ? cs : []).filter(c => c && typeof c.date === 'string' && num(c.close) > 0).map(c => ({ date: c.date.slice(0, 10), close: Number(c.close) })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const shiftDays = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10), nextDay = ymd => shiftDays(ymd, 1);
/** 봉이 from 보다 7일 넘게 뒤에서 시작하면 읽은 범위가 구간보다 짧은 것이다(주말·휴장 시작은 7일까지 봐준다). */
const startsTooLate = (cs, from) => cs.length > 0 && cs[0].date > shiftDays(from, 7);

/**
 * 비교선 가치 지수. from 에 1.0 으로 시작해 to 까지 날마다(달력일) 한 점. 국내분 = KODEX 200 종가 비율, 미국분 = SPY 종가×KRW=X 종가 비율, 현금분 = 1.0.
 * 봉이 없는 날(주말·휴장·미수신)은 마지막 값을 끌어온다. 시작값은 from 이하 마지막 종가(없으면 첫 종가 — from 뒤 7일 안에 시작하는 경우만). 비중이 있는 다리의 봉이 하나도 없거나(미국이면 환율도),
 * 봉이 from 보다 7일 넘게 뒤에서 시작하면(읽은 범위가 구간보다 짧아 기준값이 틀림 · 2026-11-12 검토) null — 비교를 보류한다.
 * @returns {Array<{date:string, value:number}>|null}
 */
export function benchmarkSeries({ from, to, weights, krCandles, usCandles, fxCandles }) {
  if (typeof from !== 'string' || typeof to !== 'string' || to < from) return null;
  const w = { KR: num(weights?.KR) || 0, US: num(weights?.US) || 0 }; const cash = num(weights?.cash) ?? Math.max(0, 100 - w.KR - w.US);
  const kr = clean(krCandles), us = clean(usCandles), fx = clean(fxCandles);
  if (w.KR > 0 && !kr.length) return null; if (w.US > 0 && (!us.length || !fx.length)) return null;
  if (w.KR > 0 && startsTooLate(kr, from)) return null; if (w.US > 0 && (startsTooLate(us, from) || startsTooLate(fx, from))) return null;
  const at = (cs, d) => { if (!cs.length) return null; const k = lastLE(cs, d); return cs[k < 0 ? 0 : k].close; };
  const krBase = at(kr, from), usBase = w.US > 0 ? at(us, from) * at(fx, from) : null;
  const out = [];
  for (let d = from; d <= to; d = nextDay(d)) {
    const krR = w.KR > 0 ? at(kr, d) / krBase : 0, usR = w.US > 0 ? (at(us, d) * at(fx, d)) / usBase : 0;
    out.push({ date: d, value: cash / 100 + (w.KR / 100) * krR + (w.US / 100) * usR });
  }
  return out;
}

/**
 * 서버용 비교선 읽기(모의계좌 엔진·실계좌 기록 공용). 정의 def 와 평가점 marks 로 첫 평가점~마지막 평가점의 비교선 가치를 읽어 compare 한다.
 * 지수 시세는 ttlMs(기본 30분) 동안 캐시하되 성공만 캐시한다(status 는 10분마다 불리고 지수 종가는 하루 한 번 바뀐다 · 실패는 다음 호출에서 다시 읽는다).
 * 지수·환율 중 하나라도 못 읽으면: 같은 구간 시작·비중으로 전에 읽은 선이 있으면 그 선으로 비교하고 error 에 BENCHMARK_STALE_NOTE 를 붙인다(다음 호출에서 다시 읽는다); 없으면 정의와 null 숫자에 BENCHMARK_HOLD_REASON. 던지지 않는다.
 * 읽는 범위는 구간 길이에 맞춘다(1y · 300일 넘으면 2y · 1500일 넘으면 5y) — 첫 평가점이 범위 밖이면 benchmarkSeries 가 보류한다. readMarket 은 주입 — 이 모듈은 네트워크를 모른다.
 * marks 는 호출자가 기준선 날부터로 잘라 넘긴다(paper-live.js benchMarks · real-record.js).
 * @returns {(def:object, marks:Array) => Promise<object|null>}  def 가 없으면 null
 */
export function createBenchmarkReader({ readMarket, now = () => Date.now(), ttlMs = 30 * 60e3 } = {}) {
  let cache = null;
  return async function benchmarkFor(def, marks) {
    if (!def) return null;
    const ms = Array.isArray(marks) ? marks : [], from = ms[0]?.date, to = ms.at(-1)?.date;
    if (!from || !to) return { ...def, ...compare({ marks: ms, series: null }), error: null };
    const base = `${from}:${def.weights.KR}:${def.weights.US}`, key = `${base}:${to}`, span = (Date.parse(to) - Date.parse(from)) / 864e5, range = span > 1500 ? '5y' : span > 300 ? '2y' : '1y';
    if (!cache || cache.key !== key || now() - cache.at > ttlMs) {
      let series = null;
      try { const [kr, us, fx] = await Promise.all([def.weights.KR > 0 ? readMarket(BENCHMARK_LEGS.KR.symbol, range) : { candles: [] }, def.weights.US > 0 ? readMarket(BENCHMARK_LEGS.US.symbol, range) : { candles: [] }, def.weights.US > 0 ? readMarket('KRW=X', range) : { candles: [] }]); series = benchmarkSeries({ from, to, weights: def.weights, krCandles: kr?.candles, usCandles: us?.candles, fxCandles: fx?.candles }); }
      catch { series = null; }
      if (series) cache = { key, base, at: now(), series };
      else if (cache && cache.base === base) return { ...def, ...compare({ marks: ms, series: cache.series }), error: BENCHMARK_STALE_NOTE }; // 마지막 읽은 선으로(날이 바뀌었으면 끌어오기) · 캐시 시각은 그대로 두어 다음 호출이 다시 읽는다
      else { cache = null; return { ...def, ...compare({ marks: ms, series: null }), error: BENCHMARK_HOLD_REASON }; }
    }
    return { ...def, ...compare({ marks: ms, series: cache.series }), error: null };
  };
}

/**
 * 절차(평가점) vs 비교선. 시작 = marks[0].total(호출자가 기준선 날부터 잘라 넘긴 첫 평가점), 지금 = 마지막 평가점. 비교선은 각 날짜 이하 마지막 점(평가점이 주말이면 금요일 값).
 * 평가점이 2개 미만이거나 비교선이 없으면 숫자는 모두 null(헤드라인에 '—' 로 나온다).
 * @returns {{ownRetPct:number|null, benchRetPct:number|null, diffPp:number|null, days:number, from:string|null, asOf:string|null}}
 */
export function compare({ marks, series }) {
  const ms = (Array.isArray(marks) ? marks : []).filter(m => m && typeof m.date === 'string' && num(m.total) > 0);
  const empty = { ownRetPct: null, benchRetPct: null, diffPp: null, days: ms.length, from: ms[0]?.date ?? null, asOf: ms.at(-1)?.date ?? null };
  if (ms.length < 2 || !Array.isArray(series) || !series.length) return empty;
  const start = ms[0], last = ms.at(-1), s = series.filter(p => p && typeof p.date === 'string' && num(p.value) > 0);
  const k0 = lastLE(s, start.date), k1 = lastLE(s, last.date); if (k0 < 0 || k1 < 0) return empty;
  // 현금을 모르는 계좌(토스)는 평가점에 보유 기준 시간가중 지수(index)가 있다 — 적립 입금이 수익으로 잡히지 않게 총자산 대신 그 비율을 쓴다(결정 24). 모의·한투 평가점에는 없다.
  const twr = num(start.index) > 0 && num(last.index) > 0, own = (twr ? last.index / start.index - 1 : last.total / start.total - 1) * 100, bench = (s[k1].value / s[k0].value - 1) * 100;
  return { ...empty, ownRetPct: r2(own), benchRetPct: r2(bench), diffPp: r2(own - bench), basis: twr ? 'twr' : 'total' };
}
