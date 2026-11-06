// 시장 대응 연구 파일 두 개를 만든다(공개 일봉 전체 기간, 개인 자료 없음).
//  data/shock-study.json      과거 비슷한 충격 이후 분포, 대응 규칙 비교, 중간선거, 전체 기간 규칙 비교
//  data/risk-model-report.json 모델 표본 외 정확도: 변동성 예측, VaR 초과율, 국면 모형·변동성 목표 비중, 방향 예측
// 사용: node scripts/build-market-research.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, START, RULES, ANALOG_VERSION, indexFeatures, eventIndexes } from '../lib/shock-analogs.js';
import { MODEL_VERSION, fitGarch, garchHorizonVar, ewmaVariance, fitHmm2, hmmFilter, quantile } from '../lib/risk-models.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=-1500000000&period2=9999999999&interval=1d&events=history`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], seen = new Set(), tz = res.meta.gmtoffset || 0;
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
const SYMBOLS = ['^GSPC', '^IXIC', '^SOX', '^KS11', '^VIX', '005930.KS', '000660.KS'];
const raw = {}; for (const s of SYMBOLS) { raw[s] = await history(s); await sleep(300); }
const F = Object.fromEntries(Object.entries(raw).map(([k, c]) => [k, indexFeatures(c)]));
const vixF = F['^VIX'], vixAt = new Map(vixF.dates.map((d, i) => [d, i]));
const vixChange = d => { const j = vixAt.get(d); return j > 0 ? vixF.cl[j] / vixF.cl[j - 1] - 1 : null; };

const r1 = v => Number.isFinite(v) ? Math.round(v * 1000) / 10 : null;
const stat = a => { a = a.filter(Number.isFinite); if (!a.length) return { n: 0 }; const s = [...a].sort((x, y) => x - y), m = a.reduce((x, y) => x + y, 0) / a.length; return { n: a.length, mean: r1(m), median: r1(quantile(s, 0.5)), p10: r1(quantile(s, 0.1)), p90: r1(quantile(s, 0.9)), hit: Math.round(a.filter(v => v > 0).length / a.length * 100), worst: r1(s[0]), best: r1(s.at(-1)) }; };
const fwd = (f, i, h) => i + h < f.n ? f.cl[i + h] / f.cl[i] - 1 : null;
const lowAhead = (f, i, h) => { if (i + h >= f.n) return null; let m = Infinity; for (let k = i + 1; k <= i + h; k++) m = Math.min(m, f.cl[k]); return m / f.cl[i] - 1; };
function runRule(f, i0, h, weight, volSeries) {
  let w = 1, v = 1, peak = 1, mdd = 0;
  for (let k = i0 + 1; k <= Math.min(f.n - 1, i0 + h); k++) { const t = weight(f, k - 1, volSeries?.[k - 1]); if (Math.abs(t - w) > 0.05) { v *= 1 - Math.abs(t - w) * 0.002; w = t; } v *= 1 + w * f.ret[k]; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  return { ret: v - 1, mdd };
}

// ── 1) 충격 조건별 통계 ───────────────────────────────────────
const conditions = {};
for (const c of CONDITIONS) {
  const f = F[c.index], ev = eventIndexes(f, c, vixChange, { from: START[c.index] });
  const done = ev.filter(i => i + 120 < f.n);
  const response = Object.fromEntries(Object.entries(RULES).map(([id, r]) => { const rs = done.map(i => runRule(f, i, 120, r.weight)); return [id, { ret: stat(rs.map(x => x.ret)), mdd: stat(rs.map(x => x.mdd)) }]; }));
  const deploy = { lump: [], split3: [], waitMa20: [] };
  for (const i of done) { const end = f.cl[i + 120]; deploy.lump.push(end / f.open[i + 1] - 1); deploy.split3.push([1, 5, 10].reduce((a, d) => a + end / f.open[i + d] / 3, 0) - 1); let j = i + 1; while (j < i + 119 && !(f.cl[j] > f.ma20[j])) j++; deploy.waitMa20.push(end / f.open[j + 1] - 1); }
  conditions[c.id] = { id: c.id, index: c.index, label: c.label, from: START[c.index], n: ev.length,
    r5: stat(ev.map(i => fwd(f, i, 5))), r20: stat(ev.map(i => fwd(f, i, 20))), r60: stat(ev.map(i => fwd(f, i, 60))), r120: stat(ev.map(i => fwd(f, i, 120))), low60: stat(ev.map(i => lowAhead(f, i, 60))),
    response, deploy: Object.fromEntries(Object.entries(deploy).map(([k, a]) => [k, stat(a)])),
    events: ev.slice(-8).map(i => ({ date: f.dates[i], day: r1(f.ret[i]), r60: r1(fwd(f, i, 60)) })) };
}

// ── 2) 미국 중간선거(선거일 종가 기준) ─────────────────────────
const MIDTERMS = [['1946-11-05', 1], ['1950-11-07'], ['1954-11-02', 1], ['1958-11-04'], ['1962-11-06'], ['1966-11-08'], ['1970-11-03'], ['1974-11-05'], ['1978-11-07'], ['1982-11-02'], ['1986-11-04'], ['1990-11-06'], ['1994-11-08', 1], ['1998-11-03'], ['2002-11-05'], ['2006-11-07', 1], ['2010-11-02'], ['2014-11-04'], ['2018-11-06'], ['2022-11-08']];
const sp = F['^GSPC'], idxOf = (f, d) => f.dates.findIndex(x => x >= d);
const midterms = MIDTERMS.map(([d, lost]) => { const i = idxOf(sp, d); return { date: d, lostBoth: !!lost, r60: r1(fwd(sp, i, 60)), r250: r1(fwd(sp, i, 250)), low60: r1(lowAhead(sp, i, 60)) }; });
const mid = rows => ({ r60: stat(rows.map(x => x.r60 / 100)), r250: stat(rows.map(x => x.r250 / 100)) });

// ── 3) 전체 기간 규칙 비교 ─────────────────────────────────────
function fullRun(f, from, weight, volSeries) {
  const i0 = Math.max(220, idxOf(f, from)), years = (f.n - 1 - i0) / 252; let w = 1, v = 1, peak = 1, mdd = 0; const d = [];
  for (let k = i0 + 1; k < f.n; k++) { const t = weight(f, k - 1, volSeries?.[k - 1]); if (Math.abs(t - w) > 0.05) { v *= 1 - Math.abs(t - w) * 0.002; w = t; } const r = w * f.ret[k]; v *= 1 + r; d.push(r); peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const m = d.reduce((a, b) => a + b, 0) / d.length, sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
  return { from: f.dates[i0], cagr: r1(v ** (1 / years) - 1), vol: r1(sd * Math.sqrt(252)), sharpe: Math.round(m / sd * Math.sqrt(252) * 100) / 100, mdd: r1(mdd) };
}

// ── 4) 모델 표본 외 정확도 ─────────────────────────────────────
// GARCH는 직전 1000일로 60거래일마다 다시 적합하고, 그 사이에는 고정 모수로 앞으로만 갱신한다.
function garchForecasts(f, from) {
  const r = f.cl.map((v, i) => i ? Math.log(v / f.cl[i - 1]) : 0), start = Math.max(1010, idxOf(f, from));
  const vol1 = new Array(f.n).fill(null), vol20 = new Array(f.n).fill(null), var95 = new Array(f.n).fill(null), var99 = new Array(f.n).fill(null);
  let fit = null, h = null, zs = null;
  for (let t = start; t < f.n; t++) { // t일 종가까지 자료로 t+1일 이후를 예측
    if (!fit || (t - start) % 60 === 0) { fit = fitGarch(r.slice(t - 999, t + 1)); h = fit.nextVar; zs = [...fit.z].sort((a, b) => a - b); }
    else { const e = r[t] - fit.mu; h = fit.omega + fit.alpha * e * e + fit.beta * h; }
    const g = { ...fit, nextVar: h };
    vol1[t] = Math.sqrt(h * 252); vol20[t] = Math.sqrt(garchHorizonVar(g, 20) / 20 * 252);
    var95[t] = -(fit.mu + Math.sqrt(h) * quantile(zs, 0.05)); var99[t] = -(fit.mu + Math.sqrt(h) * quantile(zs, 0.01));
  }
  return { r, start, vol1, vol20, var95, var99 };
}
function kupiec(breaches, n, p) { const x = breaches, ph = x / n; if (!n) return null; const ll0 = (n - x) * Math.log(1 - p) + x * Math.log(p), ll1 = (n - x) * Math.log(Math.max(1e-12, 1 - ph)) + (x ? x * Math.log(ph) : 0); const lr = -2 * (ll0 - ll1); return { rate: Math.round(ph * 1000) / 10, lr: Math.round(lr * 100) / 100, pass: lr < 3.84 }; }
function modelReport(symbol, from) {
  const f = F[symbol], g = garchForecasts(f, from), r = g.r, ew = ewmaVariance(r.slice(1)).map(v => v); // ew[t] ↔ r[t+1]까지 → 다음 날
  const rows = { naive: [], ewma: [], garch: [] }, absErr = { naive: [], ewma: [], garch: [] };
  const breach = { hist95: [0, 0], ewma95: [0, 0], garch95: [0, 0], hist99: [0, 0], ewma99: [0, 0], garch99: [0, 0] };
  const z95 = 1.6449, z99 = 2.3263;
  for (let t = g.start; t < f.n - 20; t++) {
    const rv = r.slice(t + 1, t + 21).reduce((a, x) => a + x * x, 0) / 20 * 252; // 다음 20일 실현 분산(연율)
    const fc = { naive: f.vol20[t] ** 2, ewma: ew[t] * 252, garch: g.vol20[t] ** 2 };
    if (t % 5 === 0) for (const k of Object.keys(fc)) { if (!(fc[k] > 0) || !(rv > 0)) continue; rows[k].push(rv / fc[k] - Math.log(rv / fc[k]) - 1); absErr[k].push(Math.abs(Math.sqrt(rv) - Math.sqrt(fc[k]))); }
    const next = r[t + 1], hist = r.slice(t - 249, t + 1).sort((a, b) => a - b), s = Math.sqrt(ew[t]);
    const chk = (k, v) => { breach[k][0] += next < -v ? 1 : 0; breach[k][1]++; };
    chk('hist95', -quantile(hist, 0.05)); chk('hist99', -quantile(hist, 0.01)); chk('ewma95', z95 * s); chk('ewma99', z99 * s); chk('garch95', g.var95[t]); chk('garch99', g.var99[t]);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const vol = { qlike: Object.fromEntries(Object.entries(rows).map(([k, a]) => [k, Math.round(avg(a) * 1000) / 1000])), mae: Object.fromEntries(Object.entries(absErr).map(([k, a]) => [k, r1(avg(a))])) };
  vol.garchVsNaive = r1(1 - vol.qlike.garch / vol.qlike.naive);
  const varTest = Object.fromEntries(Object.entries(breach).map(([k, [b, n]]) => [k, kupiec(b, n, k.endsWith('99') ? 0.01 : 0.05)]));
  // 국면 모형: 직전 1500일로 250일마다 적합, 그 사이 앞으로만 거름. 고변동 확률 0.5 넘으면 현금.
  const pStress = new Array(f.n).fill(null); let hm = null, p0 = 0.5;
  for (let t = g.start; t < f.n; t++) {
    if (!hm || (t - g.start) % 250 === 0) { const fit = fitHmm2(r.slice(t - 1499, t + 1)); if (fit.ok) { hm = fit.params; p0 = fit.pStressNow; pStress[t] = p0; continue; } }
    if (hm) { p0 = hmmFilter([r[t]], hm, p0)[0]; pStress[t] = p0; }
  }
  const fromDate = f.dates[g.start];
  const strat = {
    hold: fullRun(f, fromDate, RULES.hold.weight),
    volTargetRealized: fullRun(f, fromDate, RULES.volTarget.weight),
    volTargetGarch: fullRun(f, fromDate, RULES.volTarget.weight, g.vol20),
    trend: fullRun(f, fromDate, RULES.trend.weight),
    combinedGarch: fullRun(f, fromDate, RULES.combined.weight, g.vol20),
    hmmCash: fullRun(f, fromDate, (ff, k) => pStress[k] === null ? 1 : pStress[k] > 0.5 ? 0 : 1)
  };
  // 국면 구분력: 고변동 판정 뒤 20일 실현 변동성
  const sep = { stress: [], calm: [] };
  for (let t = g.start; t < f.n - 20; t += 5) { if (pStress[t] === null) continue; const rv = Math.sqrt(r.slice(t + 1, t + 21).reduce((a, x) => a + x * x, 0) / 20 * 252); (pStress[t] > 0.5 ? sep.stress : sep.calm).push(rv); }
  // 방향 예측: 직전 20일 수익률 부호로 다음 20일 부호를 맞히는지(단순 모멘텀) — 모델이 방향을 맞힌다는 근거가 있는지 확인
  let hit = 0, tot = 0; for (let t = g.start; t < f.n - 20; t += 20) { const past = f.cl[t] / f.cl[t - 20] - 1, next = f.cl[t + 20] / f.cl[t] - 1; if (past !== 0 && next !== 0) { tot++; if (Math.sign(past) === Math.sign(next)) hit++; } }
  const upShare = (() => { let u = 0, n = 0; for (let t = g.start; t < f.n - 20; t += 20) { n++; if (f.cl[t + 20] > f.cl[t]) u++; } return Math.round(u / n * 100); })();
  return { from: fromDate, to: f.dates.at(-1), vol, varTest, strategies: strat, regime: { stressVol: r1(avg(sep.stress)), calmVol: r1(avg(sep.calm)), stressShare: Math.round(sep.stress.length / (sep.stress.length + sep.calm.length) * 100) }, direction: { momentumHit: Math.round(hit / tot * 100), baseUpShare: upShare, n: tot } };
}
const models = {
  '^GSPC': modelReport('^GSPC', '1960-01-01'), '^IXIC': modelReport('^IXIC', '1980-01-01'), '^SOX': modelReport('^SOX', '1999-01-01'),
  '^KS11': modelReport('^KS11', '2002-01-01'), '005930.KS': modelReport('005930.KS', '2005-01-01'), '000660.KS': modelReport('000660.KS', '2005-01-01')
};

const fullPeriod = Object.fromEntries(['^GSPC', '^IXIC', '^SOX', '^KS11', '005930.KS', '000660.KS'].map(s => [s, Object.fromEntries(Object.entries(RULES).map(([id, r]) => [id, fullRun(F[s], { '^GSPC': '1950-01-01', '^IXIC': '1990-01-01', '^SOX': '1995-01-01', '^KS11': '1998-01-01' }[s] || '2001-01-01', r.weight)]))]));
const generatedAt = new Date().toISOString(), lastDates = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, f.dates.at(-1)]));
writeFileSync(resolve(root, 'data/shock-study.json'), JSON.stringify({ version: ANALOG_VERSION, generatedAt, lastDates, cost: '비중 변경 금액의 0.2%', horizon: 120, conditions, midterms: { rows: midterms, all: mid(midterms), lostBoth: mid(midterms.filter(m => m.lostBoth)) }, fullPeriod, rules: Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.label])) }));
writeFileSync(resolve(root, 'data/risk-model-report.json'), JSON.stringify({ version: MODEL_VERSION, generatedAt, lastDates, models }));
console.log('conditions', Object.values(conditions).map(c => `${c.id}:${c.n}`).join(' '));
for (const [k, m] of Object.entries(models)) console.log(k, m.from, 'QLIKE', JSON.stringify(m.vol.qlike), 'GARCH 개선', m.vol.garchVsNaive + '%', '| VaR95', JSON.stringify({ h: m.varTest.hist95.rate, e: m.varTest.ewma95.rate, g: m.varTest.garch95.rate }), 'VaR99', JSON.stringify({ h: m.varTest.hist99.rate, e: m.varTest.ewma99.rate, g: m.varTest.garch99.rate }), '\n   ', Object.entries(m.strategies).map(([s, v]) => `${s} ${v.sharpe}/${v.mdd}/${v.cagr}`).join(' | '), '\n    regime', JSON.stringify(m.regime), 'direction', JSON.stringify(m.direction));
