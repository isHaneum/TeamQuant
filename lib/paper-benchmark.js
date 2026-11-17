// 모의계좌 비교선(순수 함수 · 입출력 없음 · 서버 전용: vercel.json 이 /lib/paper-benchmark.js 를 막는다 · 브라우저가 쓰려면 그 목록과 TC-REG-002 를 함께 고칠 것). "국가 비중·현금 일치 지수 투자": 기준선을 정한 날의 계획에서 국내·미국 비중과 현금 비중만 가져와
// 국내분은 KODEX 200, 미국분은 S&P500 ETF(원화 환산), 나머지는 현금 1.0 으로 둔 지수 투자의 날마다 가치. 절대 수익률은 시장 방향이 만들므로 헤드라인은 이 선과의 차이(%p)만 쓴다(결정 21).
// 같은 위험 수준은 아니다: 포트폴리오는 개별 종목을 들고 있고 이 선은 지수 둘과 현금뿐이다. 시뮬(lib/paper-trading.js mix)과 이름·구성 규칙을 같게 둔다.
// BM2(2026-11-16): 미국분 환율을 계좌 평가점의 환율(marks[].fx)로 바꿨다. BM1 은 Yahoo KRW=X 일봉 종가를 써서 계좌 평가 시각의 환율과 1% 넘게 어긋났다
//   (2026-11-09: 일봉 종가 1,362.70 vs 계좌 평가점 1,346.63 → 미국 비중 54% 에서 비교 차이가 약 0.6%p 틀어짐). 같은 환율이어야 차이가 종목 선택만 잰다.
// BM3(2026-11-17 · 교차 검증 F15): 평가 시각에 이미 끝난 장의 종가만 쓴다. 평가점 날짜는 한국 날짜라 같은 날짜의 미국 종가는 다음 날 아침에야 나온다.
//   BM2 까지는 '그 날짜 이하 마지막 봉'이라 시작 평가점에 그 종가(그 시각엔 없던 미래 값)를 썼고, 시작일 미국장 하루가 비교선에서 빠졌다
//   (공개 모의계좌 11-09 시작: SPY 그날 +2.37% × 미국 54% ≈ 계좌에 1.2%p 유리). lib/performance-benchmark.js 의 '직전 완료 일봉'과 같은 규칙이다.
//   종가를 쓸 수 있는 시각: 국내 = 그날 16:00 KST, 미국 = 뉴욕 그날 17:00(서머타임 자동). 평가점 시각(at)이 없으면 그 한국 날짜 23:59:59 로 본다. 환율 일봉(평가점 환율이 없을 때만)은 날짜 기준 그대로.
// BM4(2026-11-18 · 결정 46): 평가점에 지수 가격(marks[].idx — 평가 시각에 읽은 KODEX 200·SPY 의 마지막 봉)이 있으면 그 날짜는 그 값을 쓴다. BM3 는 '끝난 장의 종가'라 장중 평가점(예: 23:50 KST, 미국 장 진행 중)에서
//   계좌는 지금 가격인데 비교선은 전날 종가였다(미국 54% 에서 하루 움직임만큼 어긋남). 평가 시각의 가격은 "그때 알 수 있던 값"이라 BM3 와 같은 뜻이고 더 정확할 뿐이므로, 지수 가격이 없는 날짜(옛 평가점)는 BM3 그대로 둔다.
//   한계: 지수 가격은 공개 시세(국내는 15~20분 지연)라 계좌 평가(증권사 실시간)와 몇 분 어긋날 수 있다.
export const BENCHMARK_VERSION = 'BM4-2026-11-18';
const NY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const nyFivePm = date => { for (const h of [21, 22]) { const t = Date.parse(`${date}T${h}:00:00Z`), p = Object.fromEntries(NY_PARTS.formatToParts(new Date(t)).map(x => [x.type, x.value])); if (p.hour === '17' && `${p.year}-${p.month}-${p.day}` === date) return t; } return NaN; };
/** 그 날짜 봉의 종가를 쓸 수 있게 되는 시각(ms). 국내 16:00 KST, 미국 뉴욕 17:00. */
export function closeAvailableAt(date, market) { return market === 'US' ? nyFivePm(date) : Date.parse(`${date}T16:00:00+09:00`); }
const endOfKstDay = d => Date.parse(`${d}T23:59:59+09:00`);
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
const clean = (cs, market = null) => (Array.isArray(cs) ? cs : []).filter(c => c && typeof c.date === 'string' && num(c.close) > 0).map(c => { const date = c.date.slice(0, 10); return { date, close: Number(c.close), ...(market ? { avail: closeAvailableAt(date, market) } : {}) }; }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
// 시각 t(ms)에 종가를 쓸 수 있던 마지막 봉(없으면 -1). avail 은 날짜 순서와 같은 순서로 커진다.
const lastAvail = (cs, t) => { let lo = 0, hi = cs.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (cs[m].avail <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const shiftDays = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10), nextDay = ymd => shiftDays(ymd, 1);
/** 봉이 from 보다 7일 넘게 뒤에서 시작하면 읽은 범위가 구간보다 짧은 것이다(주말·휴장 시작은 7일까지 봐준다). */
const startsTooLate = (cs, from) => cs.length > 0 && cs[0].date > shiftDays(from, 7);

/**
 * 비교선 가치 지수. from 에 1.0 으로 시작해 to 까지 날마다(달력일) 한 점. 국내분 = KODEX 200 종가 비율, 미국분 = SPY 종가×KRW=X 종가 비율, 현금분 = 1.0.
 * 봉이 없는 날(주말·휴장·미수신)은 마지막 값을 끌어온다. 시작값은 from 이하 마지막 종가(없으면 첫 종가 — from 뒤 7일 안에 시작하는 경우만). 비중이 있는 다리의 봉이 하나도 없거나(미국이면 환율도),
 * 봉이 from 보다 7일 넘게 뒤에서 시작하면(읽은 범위가 구간보다 짧아 기준값이 틀림 · 2026-11-12 검토) null — 비교를 보류한다.
 * fxMarks([{date, fx}] · BM2): 계좌 평가점의 환율. 첫 평가점이 from 이하이면 미국분 환산은 전부 이것으로 한다(그날 이하 마지막 평가점 값 · 출처를 섞지 않는다). 아니면 KRW=X 종가.
 * markAt({날짜: ISO 시각} · BM3): 그 날짜 평가점의 시각. 그 시각에 끝난 장의 종가만 쓴다. 없는 날짜는 그 한국 날짜 23:59:59.
 * idxMarks([{date, KR, US}] · BM4): 그 날짜 평가점이 읽어 둔 지수 가격. 있는 다리는 봉 대신 이 값을 쓴다(없는 날짜·다리는 BM3).
 * @returns {Array<{date:string, value:number}>|null}
 */
export function benchmarkSeries({ from, to, weights, krCandles, usCandles, fxCandles, fxMarks = null, markAt = null, idxMarks = null }) {
  if (typeof from !== 'string' || typeof to !== 'string' || to < from) return null;
  const w = { KR: num(weights?.KR) || 0, US: num(weights?.US) || 0 }; const cash = num(weights?.cash) ?? Math.max(0, 100 - w.KR - w.US);
  const kr = clean(krCandles, 'KR'), us = clean(usCandles, 'US'), fx = clean(fxCandles);
  const when = d => { const t = Date.parse(markAt?.[d]); return Number.isFinite(t) ? t : endOfKstDay(d); };
  const im = new Map((Array.isArray(idxMarks) ? idxMarks : []).filter(m => m && typeof m.date === 'string').map(m => [m.date.slice(0, 10), { KR: num(m.KR), US: num(m.US) }]));
  const fm = clean((Array.isArray(fxMarks) ? fxMarks : []).map(m => ({ date: m?.date, close: m?.fx }))), useMarks = fm.length > 0 && fm[0].date <= from;
  if (w.KR > 0 && !kr.length) return null; if (w.US > 0 && (!us.length || (!useMarks && !fx.length))) return null;
  if (w.KR > 0 && startsTooLate(kr, from)) return null; if (w.US > 0 && (startsTooLate(us, from) || (!useMarks && startsTooLate(fx, from)))) return null;
  const at = (cs, d) => { if (!cs.length) return null; const k = lastLE(cs, d); return cs[k < 0 ? 0 : k].close; };
  const closeAt = (cs, d, leg) => { const v = im.get(d)?.[leg]; if (v > 0) return v; if (!cs.length) return null; const k = lastAvail(cs, when(d)); return cs[k < 0 ? 0 : k].close; }; // 지수 가격: 평가점 값(BM4) → 없으면 평가 시각에 끝난 장의 종가(BM3)
  const fxAt = d => (useMarks ? at(fm, d) : at(fx, d));
  const krBase = closeAt(kr, from, 'KR'), usBase = w.US > 0 ? closeAt(us, from, 'US') * fxAt(from) : null;
  const out = [];
  for (let d = from; d <= to; d = nextDay(d)) {
    const krR = w.KR > 0 ? closeAt(kr, d, 'KR') / krBase : 0, usR = w.US > 0 ? (closeAt(us, d, 'US') * fxAt(d)) / usBase : 0;
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
  return async function benchmarkFor(defIn, marks) {
    if (!defIn) return null;
    // version 은 기준선 날 고정한 정의의 판(예: BM1-2026-11-12)이라 계산 방식이 아니다. 화면·공개 파일이 방식을 알 수 있게 method 를 붙인다(2026-11-17 재점검).
    const def = { ...defIn, method: BENCHMARK_VERSION };
    const ms = Array.isArray(marks) ? marks : [], from = ms[0]?.date, to = ms.at(-1)?.date;
    if (!from || !to) return { ...def, ...compare({ marks: ms, series: null }), error: null };
    const base = `${from}:${def.weights.KR}:${def.weights.US}`, key = `${base}:${to}`, span = (Date.parse(to) - Date.parse(from)) / 864e5, range = span > 1500 ? '5y' : span > 300 ? '2y' : '1y';
    // BM2: 시세(봉)만 캐시하고 선은 부를 때마다 지금 평가점 환율로 만든다(마지막 평가점 환율은 하루 중에도 바뀐다).
    const fxMarks = ms.filter(m => num(m?.fx) > 0).map(m => ({ date: m.date, fx: Number(m.fx) }));
    const markAt = Object.fromEntries(ms.filter(m => typeof m?.at === 'string').map(m => [m.date, m.at])); // BM3: 평가점 시각
    const legPx = v => num(v && typeof v === 'object' ? v.close : v);
    const idxMarks = ms.filter(m => m?.idx && (legPx(m.idx.KR) > 0 || legPx(m.idx.US) > 0)).map(m => ({ date: m.date, KR: legPx(m.idx.KR), US: legPx(m.idx.US) })); // BM4: 평가 시각의 지수 가격
    const build = c => benchmarkSeries({ from, to, weights: def.weights, krCandles: c.kr, usCandles: c.us, fxCandles: c.fx, fxMarks, markAt, idxMarks });
    if (!cache || cache.key !== key || now() - cache.at > ttlMs) {
      let got = null;
      try { const [kr, us, fx] = await Promise.all([def.weights.KR > 0 ? readMarket(BENCHMARK_LEGS.KR.symbol, range) : { candles: [] }, def.weights.US > 0 ? readMarket(BENCHMARK_LEGS.US.symbol, range) : { candles: [] }, def.weights.US > 0 ? readMarket('KRW=X', range) : { candles: [] }]); got = { kr: kr?.candles, us: us?.candles, fx: fx?.candles }; if (!build(got)) got = null; }
      catch { got = null; }
      if (got) cache = { key, base, at: now(), ...got };
      else if (cache && cache.base === base) { const s = build(cache); return { ...def, ...compare({ marks: ms, series: s }), error: s ? BENCHMARK_STALE_NOTE : BENCHMARK_HOLD_REASON }; } // 마지막 읽은 시세로(날이 바뀌었으면 끌어오기) · 캐시 시각은 그대로 두어 다음 호출이 다시 읽는다
      else { cache = null; return { ...def, ...compare({ marks: ms, series: null }), error: BENCHMARK_HOLD_REASON }; }
    }
    return { ...def, ...compare({ marks: ms, series: build(cache) }), error: null };
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
