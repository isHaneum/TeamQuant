// 결정 E 시험: 변동성·비용·세금에서 유도한 임계값(PREREG-E.md 먼저). 공개 일봉만.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), CACHE = join(HERE, 'cache'); mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(sym) {
  const f = join(CACHE, sym.replace(/[^A-Za-z0-9]/g, '_') + '.json'); if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=473385600&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div`;
  const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) })).json(); await sleep(400);
  const x = j.chart.result?.[0]; if (!x) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: x.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }), q = x.indicators.quote[0], adj = x.indicators.adjclose?.[0]?.adjclose;
  const rows = x.timestamp.map((t, i) => { const c = q.close[i], a = adj?.[i]; const k = a > 0 && c > 0 ? a / c : 1; return { d: fmt.format(new Date(t * 1000)), o: (q.open[i] > 0 ? q.open[i] : c) * k, c: (c > 0 ? c : null) * k }; }).filter(r => r.c > 0);
  const seen = new Set(), out = rows.filter(r => !seen.has(r.d) && seen.add(r.d));
  writeFileSync(f, JSON.stringify(out)); return out;
}
const lastBefore = (rows, d) => { let lo = 0, hi = rows.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].d <= d) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? null : rows[k]; };
const vix = await get('^VIX'); const fearOf = d => lastBefore(vix, d)?.c ?? null;
const INDEX = [['^SP500TR', 'S&P500 총수익', '1990-01-02', true], ['^NDX', '나스닥100', '1990-01-02', true], ['^KS11', '코스피', '1997-01-02', false]];
const STOCKS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'JPM', 'JNJ', 'XOM', 'PG', 'KO', 'INTC', 'CSCO', 'GE', 'F', 'PFE', 'WMT', '005930.KS', '000660.KS', '005380.KS', '035420.KS'];
const SHORT = ['PLTR', 'TEM'];
const COST = 0.001, TAX = 0.22, PREMIUM = 0.04, W0 = 0.8, CASH_RATE = 0.02, CONTRIB = 0.01;
const RULES = ['H', 'RB', 'NT', 'V1', 'V2', 'F'];
// 변동성: 60일(연율)과 250일(연율) — 로그수익률 표준편차
function volSeries(rows) { const lr = rows.map((r, i) => (i ? Math.log(r.c / rows[i - 1].c) : 0)); const v60 = new Array(rows.length).fill(null), v250 = new Array(rows.length).fill(null);
  const roll = (n, out) => { let s = 0, s2 = 0; for (let i = 0; i < rows.length; i++) { s += lr[i]; s2 += lr[i] * lr[i]; if (i >= n) { s -= lr[i - n]; s2 -= lr[i - n] * lr[i - n]; } if (i >= n) { const m = s / n, var_ = Math.max(0, s2 / n - m * m); out[i] = Math.sqrt(var_ * 252); } } };
  roll(60, v60); roll(250, v250); return { v60, v250 }; }
export const noTradeBand = (kappa, w, gamma) => Math.cbrt(3 * kappa * w * w * (1 - w) * (1 - w) / (2 * gamma));
export const gammaOf = (w, sigma) => PREMIUM / (w * sigma * sigma);
function run(rows, vols, rule, from, to, hasVix) {
  if (rule === 'F' && !hasVix) return null;
  const i0 = rows.findIndex(r => r.d >= from); if (i0 < 0) return null; const R = []; for (let j = i0; j < rows.length && rows[j].d < to; j++) R.push(rows[j]); if (R.length < 250) return null;
  let ath = R[0].c; for (let k = 0; k < i0; k++) if (rows[k].c > ath) ath = rows[k].c;
  let bU = W0 / R[0].c, bCost = W0, dU = 0, C = 1 - W0, trades = 0, flags = {}, pending = [], lastMonth = R[0].d.slice(0, 7), sells = 0, gainAtSell = [];
  const path = [], A = () => (bU > 0 ? bCost / bU : R[0].c), z = rule === 'V2' ? 1.645 : 1;
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    for (const p of pending) {
      if (p.type === 'buyBase') { const amt = Math.min(p.amt, C); if (amt > 1e-12) { bU += amt * (1 - COST) / r.o; bCost += amt; C -= amt; trades++; } }
      else if (p.type === 'buyDip') { const amt = Math.min(p.amt, C); if (amt > 1e-12) { dU += amt * (1 - COST) / r.o; C -= amt; trades++; } }
      else if (p.type === 'sellDip') { if (dU > 0) { C += dU * r.o * (1 - COST); dU = 0; trades++; } }
      else if (p.type === 'toWeight') { const W = (bU + dU) * r.o + C, tgt = p.frac * W, cur = (bU + dU) * r.o;
        if (cur > tgt) { const s = cur - tgt, u = s / r.o, a = A(), g = Math.max(0, 1 - a / r.o); const fromDip = Math.min(dU, u); dU -= fromDip; const fromBase = u - fromDip; if (fromBase > 0) { bCost *= (bU - fromBase) / bU; bU -= fromBase; } C += s * (1 - COST) - (p.taxed ? s * g * TAX : 0); trades++; sells++; gainAtSell.push(g); }
        else if (tgt > cur) { const b = Math.min(tgt - cur, C); if (b > 1e-12) { bU += b * (1 - COST) / r.o; bCost += b; C -= b; trades++; } } }
    }
    pending = [];
    const mon = r.d.slice(0, 7); if (mon !== lastMonth) { lastMonth = mon; C += CONTRIB; pending.push({ type: 'buyBase', amt: CONTRIB }); }
    C *= 1 + CASH_RATE / 252;
    const prevAth = ath; if (r.c > ath) ath = r.c; const a = A(), last = i + 1 >= R.length, W = (bU + dU) * r.c + C, w = (bU + dU) * r.c / W;
    const v60 = vols.v60[i0 + i], v250 = vols.v250[i0 + i];
    if (!last) {
      if (rule === 'RB') { if (w < 0.65 || w > 0.95) pending.push({ type: 'toWeight', frac: W0, taxed: true }); }
      if (rule === 'NT' && v250 > 0) { const gamma = gammaOf(W0, v250), g = Math.max(0, 1 - a / r.c), dBuy = noTradeBand(COST, W0, gamma), dSell = noTradeBand(COST + TAX * g, W0, gamma); if (w < W0 - dBuy || w > W0 + dSell) pending.push({ type: 'toWeight', frac: W0, taxed: true }); }
      if ((rule === 'V1' || rule === 'V2') && v60 > 0) { const u = v60 * Math.sqrt(63 / 252);
        if (dU > 0 && r.c >= a) { pending.push({ type: 'sellDip' }); flags = {}; }
        else for (const k of [1, 2, 3]) if (r.c <= a * Math.exp(-k * z * u) && !flags[k] && C > 1e-9) { flags[k] = true; pending.push({ type: 'buyDip', amt: Math.min(C, (W * 0.2) / 3) }); break; } }
      if (rule === 'F') { const v = fearOf(r.d); if (i > 0 && r.c >= prevAth && dU > 0) { pending.push({ type: 'sellDip' }); flags = {}; } else if (v !== null) for (const [k, th] of [[1, 30], [2, 40], [3, 50]]) if (v >= th && !flags[k] && C > 1e-9) { flags[k] = true; pending.push({ type: 'buyDip', amt: Math.min(C, (W * 0.2) / 3) }); } }
    }
    path.push(W);
  }
  const gs = gainAtSell.sort((p, q) => p - q);
  return { wealth: path.at(-1), path, trades, R, sells, medGain: gs.length ? gs[Math.floor(gs.length / 2)] : null };
}
const mdd = p => { let pk = -Infinity, m = 0; for (const v of p) { pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return m; };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const yrs = R => (Date.parse(R.at(-1).d) - Date.parse(R[0].d)) / 864e5 / 365.25;
function evalAsset(rows, from, hasVix) {
  const vols = volSeries(rows), first = rows.find(r => r.d >= from)?.d || rows[0].d, last = rows.at(-1).d, base = {}; for (const ru of RULES) base[ru] = run(rows, vols, ru, first, '9999', hasVix); if (!base.H) return null;
  const out = { from: first, to: last, whole: {}, rolling: {}, halves: {} }, y = yrs(base.H.R);
  for (const ru of RULES) { const x = base[ru]; if (!x) continue; out.whole[ru] = { vsHPct: r1((x.wealth / base.H.wealth - 1) * 100), vsHPerYrPct: r2((Math.pow(x.wealth / base.H.wealth, 1 / y) - 1) * 100), mdd: r1(mdd(x.path) * 100), trades: x.trades, sells: x.sells, medGainAtSell: x.medGain === null ? null : r1(x.medGain * 100) }; }
  const y0 = +first.slice(0, 4) + (first.slice(5) > '01-15' ? 1 : 0), y1 = +last.slice(0, 4) - 10, mid = rows[Math.floor((rows.findIndex(r => r.d >= first) + rows.length) / 2)].d;
  for (const ru of RULES.filter(r => r !== 'H')) { if (!base[ru]) continue;
    const ex = []; for (let yy = y0; yy <= y1; yy++) { const a = run(rows, vols, ru, `${yy}-01-01`, `${yy + 10}-01-01`, hasVix), b = run(rows, vols, 'H', `${yy}-01-01`, `${yy + 10}-01-01`, hasVix); if (a && b) ex.push(a.wealth / b.wealth - 1); }
    const s = [...ex].sort((p, q) => p - q);
    out.rolling[ru] = { windows: ex.length, beatHShare: ex.length ? r1(ex.filter(z => z > 0).length / ex.length * 100) : null, medianVsHPct: ex.length ? r1(s[Math.floor(s.length / 2)] * 100) : null, worstVsHPct: ex.length ? r1(s[0] * 100) : null, bestVsHPct: ex.length ? r1(s.at(-1) * 100) : null };
    const h = []; for (const [a, b] of [[first, mid], [mid, '9999']]) { const x = run(rows, vols, ru, a, b, hasVix), k = run(rows, vols, 'H', a, b, hasVix); h.push(x && k ? r1((x.wealth / k.wealth - 1) * 100) : null); } out.halves[ru] = { split: mid, first: h[0], second: h[1] };
  }
  return out;
}
const out = { prereg: 'PREREG-E.md', index: {}, stock: {}, short: {} };
for (const [sym, name, from, hasVix] of INDEX) { const rows = await get(sym); if (rows) out.index[sym] = { name, ...evalAsset(rows, from, hasVix) }; }
for (const sym of STOCKS) { const rows = await get(sym); if (!rows || rows.length < 15 * 250) continue; out.stock[sym] = evalAsset(rows, rows[0].d, !sym.endsWith('.KS')); }
for (const sym of SHORT) { const rows = await get(sym); if (rows && rows.length > 300) out.short[sym] = evalAsset(rows, rows[0].d, true); }
const med = a => { const s = a.filter(v => Number.isFinite(v)).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
out.verdict = {};
for (const ru of RULES.filter(r => r !== 'H')) {
  const idx = Object.entries(out.index).filter(([, m]) => m.rolling[ru]); const idxFail = idx.filter(([, m]) => !(m.rolling[ru].beatHShare >= 70)).map(([s, m]) => `${s} ${m.rolling[ru].beatHShare}%`);
  const st = Object.entries(out.stock).filter(([, m]) => m.rolling[ru]); const beat = st.filter(([, m]) => m.rolling[ru].beatHShare >= 70).length, share = r1(beat / Math.max(1, st.length) * 100);
  const medYr = r2(med(st.map(([, m]) => m.whole[ru].vsHPerYrPct))), h1 = med(st.map(([, m]) => m.halves[ru].first)), h2 = med(st.map(([, m]) => m.halves[ru].second));
  out.verdict[ru] = { indexPass: idx.length > 0 && idxFail.length === 0, indexFails: idxFail, stockShareBeat70: share, stockPass: share >= 70 && h1 > 0 && h2 > 0 && medYr >= -2, stockMedianVsHPerYr: medYr, stockMedianHalves: [r1(h1), r1(h2)], stockWin: `${st.filter(([, m]) => m.whole[ru].vsHPct > 0).length}/${st.length}`, medianMdd: r1(med(st.map(([, m]) => m.whole[ru].mdd))), medianSells: med(st.map(([, m]) => m.whole[ru].sells)) };
}
writeFileSync(join(HERE, 'mathrule.json'), JSON.stringify(out, null, 1));
const line = (ru, m) => { const w = m.whole[ru]; if (!w) return `  ${ru.padEnd(3)} —`; const ro = m.rolling[ru], h = m.halves[ru]; return `  ${ru.padEnd(3)} 보유 대비 ${w.vsHPct >= 0 ? '+' : ''}${w.vsHPct}% (연 ${w.vsHPerYrPct}%p) MDD ${w.mdd}% 매매 ${w.trades} 매도 ${w.sells}${w.medGainAtSell !== null ? `(매도 시 이익률 중앙 ${w.medGainAtSell}%)` : ''}${ro ? ` | 10년창 이김 ${ro.beatHShare}% 중앙 ${ro.medianVsHPct}% 최악 ${ro.worstVsHPct}% | 반기 ${h.first}/${h.second}` : ''}`; };
for (const [s, m] of Object.entries(out.index)) { console.log(`\n=== ${m.name} ${m.from}~${m.to}`); for (const ru of RULES) console.log(line(ru, m)); }
console.log('\n=== 개별 종목(보유 대비 연 %p / 10년창 이김 % / 매도 횟수)');
for (const [s, m] of Object.entries(out.stock)) console.log(`  ${s.padEnd(10)} ${m.from.slice(0, 4)}~ MDD(H) ${m.whole.H.mdd}% | ` + RULES.filter(r => r !== 'H' && m.whole[r]).map(ru => `${ru} ${m.whole[ru].vsHPerYrPct >= 0 ? '+' : ''}${m.whole[ru].vsHPerYrPct}/${m.rolling[ru].beatHShare}/${m.whole[ru].sells}`).join(' · '));
console.log('\n=== 짧은 종목(참고)'); for (const [s, m] of Object.entries(out.short)) console.log(`  ${s} ${m.from}~ ` + RULES.filter(r => m.whole[r]).map(ru => `${ru} ${m.whole[ru].vsHPct}%/${m.whole[ru].mdd}%`).join(' · '));
console.log('\n판정:', JSON.stringify(out.verdict, null, 1));
