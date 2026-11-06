// 오늘 장 대응: 시세(교차 확인) + 시계열 모델(GARCH·EWMA·HMM·FHS VaR·몬테카를로) + 과거 비슷한 충격 통계 → 규칙 비중과 행동 목록.
// 규칙은 표본 외 검증(data/risk-model-report.json) 결과로 시장별로 고른다.
//  - 미국 지수·미국 주식: 200일선 + 변동성 목표 15% (나스닥 샤프 0.62→0.91, 최대 손실 −78%→−26%)
//  - 한국 지수·한국 주식: 변동성 목표 15%만 (200일선 규칙은 코스피에서 오히려 나빴음)
// 방향(오를지·내릴지)은 예측하지 않는다. 얼마나 들고 있을지만 정한다.
import { indexFeatures, activeConditions, RULES } from './shock-analogs.js';
import { logReturns, fitGarch, garchHorizonVar, ewmaVariance, fitHmm2, oneDayRisk, simulateGarch, quantile, volTargetWeight, MODEL_VERSION } from './risk-models.js';

export const RESPONSE_VERSION = 'M1-2026-11-06';
const pct1 = v => Number.isFinite(v) ? Math.round(v * 1000) / 10 : null;
const money = (v, cur) => !Number.isFinite(v) ? '—' : cur === 'USD' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('ko-KR');
const KST = 9 * 3600000;
const kstDay = ms => new Date(ms + KST).toISOString().slice(0, 10);

/**
 * Yahoo 일봉과 네이버 현재가를 맞춰 본다. 네이버 날짜가 더 새로우면 오늘 봉을 붙이고(장중이면 임시),
 * 같은 날이면 0.3% 넘게 다를 때 네이버 값을 쓴다.
 * @param quote {price, pct, status:'OPEN'|'CLOSE', at:ISO, delayMin}
 */
export function mergeQuote(candles, quote, market = 'KR') {
  const out = candles.slice(), notes = []; let status = 'close', source = 'Yahoo 일봉';
  if (!quote || !Number.isFinite(quote.price)) { notes.push('현재가 교차 확인 실패 · 일봉 마지막 값 사용'); return { candles: out, status: 'unchecked', source, notes, diffPct: null, asOf: out.at(-1)?.date }; }
  const qDate = market === 'US' ? new Date(Date.parse(quote.at) - 5 * 3600000).toISOString().slice(0, 10) : kstDay(Date.parse(quote.at));
  const last = out.at(-1), prevClose = Number.isFinite(quote.pct) ? quote.price / (1 + quote.pct / 100) : null;
  let diffPct = null;
  if (qDate > last.date) {
    // 일봉에 오늘이 아직 없음: 전날 종가가 맞는지 확인하고 오늘 값을 붙인다
    if (prevClose && Math.abs(prevClose / last.close - 1) > 0.003) notes.push(`일봉 마지막 종가(${money(last.close)})와 네이버 전일 종가(${money(prevClose)})가 ${pct1(prevClose / last.close - 1)}% 다름`);
    out.push({ date: qDate, open: last.close, close: quote.price, provisional: quote.status === 'OPEN' });
    source = '네이버 현재가 + Yahoo 일봉';
  } else if (qDate === last.date) {
    diffPct = pct1(quote.price / last.close - 1);
    if (Math.abs(quote.price / last.close - 1) > 0.003) { out[out.length - 1] = { ...last, close: quote.price, provisional: quote.status === 'OPEN' }; notes.push(`Yahoo ${money(last.close)} → 네이버 ${money(quote.price)}로 보정(${diffPct}%)`); source = '네이버 현재가 + Yahoo 일봉'; }
  } else notes.push('네이버 현재가가 일봉보다 오래됨 · 일봉 사용');
  if (quote.status === 'OPEN') { status = 'open'; notes.push('장중 값이라 종가에서 바뀔 수 있음'); }
  if (quote.delayMin) notes.push(`${quote.delayMin}분 지연 시세`);
  return { candles: out, status, source, notes, diffPct, asOf: out.at(-1).date, quoteAt: quote.at };
}

/** 모델 묶음. returns: 로그수익률 */
export function modelSet(closes, { volModel = 'garch', horizon = 20 } = {}) {
  const r = logReturns(closes), g = fitGarch(r.slice(-1000));
  if (!g.ok) return { ok: false, reason: '시세가 부족해 모델을 적합하지 못했습니다.' };
  const ew = ewmaVariance(r).at(-1), garch20 = Math.sqrt(garchHorizonVar(g, horizon) / horizon * 252), ewma20 = Math.sqrt(ew * 252);
  const realized20 = Math.sqrt(r.slice(-20).reduce((a, x) => a + x * x, 0) / 20 * 252);
  const forecast = volModel === 'ewma' ? ewma20 : garch20;
  const hmm = fitHmm2(r.slice(-1500));
  const v95 = oneDayRisk(g, 0.95), v99 = oneDayRisk(g, 0.99);
  const zs = [...g.z].sort((a, b) => a - b), s = Math.sqrt(g.nextVar);
  const up95 = Math.exp(g.mu + s * quantile(zs, 0.975)) - 1, dn95 = Math.exp(g.mu + s * quantile(zs, 0.025)) - 1;
  return { ok: true, volModel, garch: g, vol: { forecast, garch20, ewma20, realized20, longRun: g.longRunVol, halfLife: g.halfLife },
    hmm: hmm.ok ? { pStress: hmm.pStressNow, stressVol: hmm.stress.vol, calmVol: hmm.calm.vol, duration: hmm.stressDuration } : null,
    var95: v95, var99: v99, day95: [dn95, up95], // 방향을 예측하지 않으므로 추세(평균 수익)는 0으로 두고 흔들림의 크기만 본다.
    mc20: simulateGarch(g, 20, { paths: 3000, seed: 11, drift: false }), mc60: simulateGarch(g, 60, { paths: 2000, seed: 13, drift: false }) };
}

/**
 * @param o.symbol, o.name, o.market 'KR'|'US', o.kind 'index'|'stock', o.candles, o.quote, o.vixCandles, o.study, o.report, o.currency
 */
export function marketResponse(o) {
  const market = o.market || 'KR', cur = o.currency || (market === 'US' ? 'USD' : 'KRW');
  const merged = mergeQuote(o.candles, o.quote, market), c = merged.candles;
  if (c.length < 260) return { ok: false, symbol: o.symbol, name: o.name, reason: '1년 넘는 시세가 필요합니다.' };
  const f = indexFeatures(c), i = f.n - 1, price = f.cl[i];
  const best = o.report?.models?.[o.symbol]?.vol?.qlike, volModel = best && best.ewma < best.garch ? 'ewma' : 'garch';
  const m = modelSet(f.cl, { volModel }); if (!m.ok) return { ok: false, symbol: o.symbol, name: o.name, reason: m.reason };
  const above200 = f.cl[i] > f.ma200[i], useTrend = market === 'US';
  const wVol = volTargetWeight(m.vol.forecast), weight = useTrend ? (above200 ? wVol : 0) : wVol;
  const rule = useTrend ? RULES.combined.label : RULES.volTarget.label;
  const levels = { ma20: f.ma20[i], ma60: f.ma60[i], ma200: f.ma200[i], gap20: f.cl[i] / f.ma20[i] - 1, gap200: f.cl[i] / f.ma200[i] - 1, fromHigh: f.dd[i], day: f.ret[i], back20: f.back20[i] };

  // 과거 비슷한 때(지수만): 최근 5거래일 안에 해당한 조건
  let analogs = [];
  if (o.kind === 'index' && o.study) {
    let vixChange = () => null;
    if (o.vixCandles?.length) { const v = new Map(o.vixCandles.map((x, k) => [x.date, k])); vixChange = d => { const k = v.get(d); return k > 0 ? o.vixCandles[k].close / o.vixCandles[k - 1].close - 1 : null; }; }
    analogs = activeConditions({ [o.symbol]: f }, vixChange, 5).map(a => ({ ...a, stats: o.study.conditions?.[a.id] })).filter(a => a.stats?.n);
  }

  // 다음 신호(가격·변동성 기준선)
  const triggers = [];
  if (useTrend) {
    if (above200) triggers.push({ when: `종가가 200일선 ${money(levels.ma200, cur)} 아래로 마감`, then: '규칙 비중 0% (다음 거래일에 정리)', distance: pct1(-levels.gap200) });
    else triggers.push({ when: `종가가 200일선 ${money(levels.ma200, cur)} 위로 마감`, then: `규칙 비중 ${Math.round((wVol || 0) * 100)}%로 다시 들어감`, distance: pct1(-levels.gap200) });
  }
  if (wVol < 1) for (const step of [0.25, 0.5]) {
    const w2 = Math.min(1, Math.round((wVol + step) * 20) / 20); if (w2 <= wVol + 0.01) continue;
    triggers.push({ when: `예측 변동성이 연 ${Math.round(15 / w2)}% 아래로 내려옴(지금 ${Math.round(m.vol.forecast * 100)}%)`, then: `${useTrend && !above200 ? '200일선 회복 시 ' : ''}비중 ${Math.round(w2 * 100)}%까지 늘림` });
    if (w2 >= 1) break;
  }
  triggers.push({ when: `종가가 20일선 ${money(levels.ma20, cur)} ${levels.gap20 >= 0 ? '아래로' : '위로'} 마감`, then: levels.gap20 >= 0 ? '단기 흐름 약화 · 비중 규칙은 그대로, 새 돈 투입은 다음 점검일로' : '단기 반등 확인 · 비중은 변동성 규칙대로(기다렸다 사는 것이 과거 평균으론 0.4~1%p 덜 벌었음)' });
  triggers.push({ when: `하루 −${(Math.abs(m.day95[0]) * 100).toFixed(1)}%보다 크게 하락`, then: '모델이 본 하루 95% 범위를 벗어남 · 모델을 다시 계산하고 비중 재점검' });

  // 오늘 할 일·하지 말 것
  const wPct = Math.round((weight || 0) * 100), today = [], avoid = [];
  today.push(`${o.kind === 'index' ? '이 지수에 두려던 돈' : '이 종목에 두려던 금액'}의 ${wPct}%만 주식으로 둡니다(${rule}).`);
  if (merged.status === 'open') today.push(`장중입니다. 규칙은 종가 기준이므로 ${market === 'KR' ? '15:20 이후 동시호가나 내일 아침' : '미국 장 마감(한국 06:00) 뒤'}에 맞춥니다.`);
  else today.push('비중 차이가 5%p를 넘을 때만 맞추고, 다음 거래일 시가 근처에 지정가로 나눠 냅니다.');
  if (wPct < 100) today.push(`남는 ${100 - wPct}%는 현금(또는 단기 국채·MMF)으로 둡니다. 변동성이 내려가면 같은 규칙이 다시 사들입니다.`);
  const deploy = analogs[0]?.stats?.deploy;
  if (wPct === 0) today.push(useTrend && !above200 ? `새로 넣을 돈도 현금으로 둡니다. 종가가 200일선(${money(levels.ma200, cur)}) 위로 올라오면 그때 규칙 비중만큼 넣습니다.` : '새로 넣을 돈도 현금으로 둡니다.');
  else if (deploy?.lump?.n) today.push(`새로 넣을 돈은 규칙 비중(${wPct}%)만큼만 넣습니다. 과거 같은 조건(${deploy.lump.n}번)에서 120일 뒤 평균: 다음 날 한 번에 ${deploy.lump.mean}%, 3번 나눠 ${deploy.split3.mean}%, 20일선 회복 뒤 ${deploy.waitMa20.mean}%.`);
  else today.push(`새로 넣을 돈은 규칙 비중(${wPct}%)만큼만 넣습니다.`);
  avoid.push('장중 급락에 시장가로 전부 팔기(규칙은 종가로만 판단)');
  avoid.push(`규칙 비중(${wPct}%)을 넘는 물타기·레버리지`);
  if (m.hmm?.pStress > 0.5) avoid.push(`고변동 국면 확률 ${Math.round(m.hmm.pStress * 100)}%: 하루 반등만 보고 비중을 한 번에 늘리기`);

  return {
    ok: true, version: RESPONSE_VERSION, modelVersion: MODEL_VERSION, symbol: o.symbol, name: o.name, market, kind: o.kind, currency: cur,
    price, asOf: merged.asOf, data: merged, levels, models: m, weight, weightVolOnly: wVol, rule, useTrend, above200, analogs, triggers, today, avoid,
    headline: `${o.name}: ${rule} 기준 비중 ${wPct}% · 예측 변동성 연 ${Math.round(m.vol.forecast * 100)}%${m.hmm ? ` · 고변동 국면 ${Math.round(m.hmm.pStress * 100)}%` : ''}`
  };
}

// 보유 종목 묶음: 지금 금액 × 규칙 비중 = 규칙상 주식 금액, 나머지는 현금으로 옮길 금액
export function holdingsPlan(rows) {
  const ok = rows.filter(r => r.ok && Number.isFinite(r.valueKrw));
  const now = ok.reduce((a, r) => a + r.valueKrw, 0), keep = ok.reduce((a, r) => a + r.valueKrw * r.weight, 0);
  const loss95 = ok.reduce((a, r) => a + r.valueKrw * r.models.var95.VaR, 0);
  return { now, keep, toCash: now - keep, keepPct: now ? keep / now : null, oneDayLoss95: loss95 };
}
