// 결정 C 시험: 가격 사다리(떨어지면 사고 오르면 팔기) 규칙 — PREREG-C.md 를 먼저 적었다. 공개 일봉만.
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
  // 개별 종목은 배당·분할 반영(adjclose 비율로 시가도 조정) — 보유 비교가 공정하도록
  const rows = x.timestamp.map((t, i) => { const c = q.close[i], a = adj?.[i]; const k = a > 0 && c > 0 ? a / c : 1; return { d: fmt.format(new Date(t * 1000)), o: (q.open[i] > 0 ? q.open[i] : c) * k, c: (c > 0 ? c : null) * k }; }).filter(r => r.c > 0);
  const seen = new Set(), out = rows.filter(r => !seen.has(r.d) && seen.add(r.d));
  writeFileSync(f, JSON.stringify(out)); return out;
}
const INDEX = [['^SP500TR', 'S&P500 총수익', '1990-01-02'], ['^NDX', '나스닥100', '1990-01-02'], ['^KS11', '코스피', '1997-01-02']];
const STOCKS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'JPM', 'JNJ', 'XOM', 'PG', 'KO', 'INTC', 'CSCO', 'GE', 'F', 'PFE', 'WMT', '005930.KS', '000660.KS', '005380.KS', '035420.KS'];
const SHORT = ['PLTR', 'TEM'];
const COST = 0.001, W0 = 0.6, CASH_RATE = 0.02;
const RULES = ['H', 'RB', 'GRID', 'GRIDV', 'TRIM'];
function volSeries(R) { // 20일 실현 변동성(연율) · 1년(250일) 중앙값 → severe
  const lr = R.map((r, i) => (i ? Math.log(r.c / R[i - 1].c) : 0)), v = new Array(R.length).fill(null), sev = new Array(R.length).fill(false);
  for (let i = 20; i < R.length; i++) { let s = 0, m = 0; for (let k = i - 19; k <= i; k++) m += lr[k]; m /= 20; for (let k = i - 19; k <= i; k++) s += (lr[k] - m) ** 2; v[i] = Math.sqrt(s / 19 * 252); }
  for (let i = 270; i < R.length; i++) { const w = v.slice(i - 250, i).filter(x => x > 0).sort((a, b) => a - b); const med = w[Math.floor(w.length / 2)]; sev[i] = med > 0 && v[i] > 2 * med; }
  return sev;
}
function run(rows, rule, from, to) {
  const i0 = rows.findIndex(r => r.d >= from); if (i0 < 0) return null; const R = []; for (let j = i0; j < rows.length && rows[j].d < to; j++) R.push(rows[j]); if (R.length < 250) return null;
  const sevAll = volSeries(rows), sev = i => sevAll[i0 + i];
  let U = W0 / R[0].c, C = 1 - W0, ref = R[0].c, ref0 = R[0].c, cut = false, trades = 0, pending = null; const path = [];
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    if (pending) { const W = U * r.o + C; if (pending.type === 'to') { const tgt = pending.frac * W, cur = U * r.o; if (cur > tgt) { const s = cur - tgt; U -= s / r.o; C += s * (1 - COST); } else { const b = Math.min(tgt - cur, C); U += b * (1 - COST) / r.o; C -= b; } trades++; }
      else if (pending.type === 'sellPct') { const s = U * pending.pct; U -= s; C += s * r.o * (1 - COST); trades++; }
      else if (pending.type === 'buyPct') { const amt = Math.min(U * r.o * pending.pct, C); if (amt > 1e-12) { U += amt * (1 - COST) / r.o; C -= amt; trades++; } }
      ref = r.o; pending = null; }
    C *= 1 + CASH_RATE / 252;
    const W = U * r.c + C, w = U * r.c / W, last = i + 1 >= R.length;
    if (!last) {
      if (rule === 'RB' && (w < 0.45 || w > 0.75)) pending = { type: 'to', frac: W0 };
      if (rule === 'GRID' || rule === 'GRIDV') { if (r.c >= ref * 1.1 && U > 0) pending = { type: 'sellPct', pct: 0.2 }; else if (r.c <= ref * 0.9 && C > 1e-9 && !(rule === 'GRIDV' && sev(i))) pending = { type: 'buyPct', pct: 0.2 }; }
      if (rule === 'TRIM') {
        if (r.c >= ref0 * 1.1 && cut) { cut = false; ref0 = r.c; ref = r.c; } // 원래 기준의 +10% 위로 회복 → 상태 초기화
        if (r.c >= ref * 1.1 && U > 0) pending = { type: 'sellPct', pct: 0.2 };
        else if (r.c <= ref * 0.9) { if (!cut) { cut = true; pending = { type: 'sellPct', pct: 0.2 }; } else if (C > 1e-9 && !sev(i)) pending = { type: 'buyPct', pct: 0.2 }; else ref = r.c; }
      }
    }
    path.push(W);
  }
  return { wealth: path.at(-1), path, trades, R };
}
const cagr = (w, R) => Math.pow(w, 365.25 / ((Date.parse(R.at(-1).d) - Date.parse(R[0].d)) / 864e5)) - 1;
const mdd = p => { let pk = -Infinity, m = 0; for (const v of p) { pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return m; };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
function evalAsset(rows, from) {
  const first = rows.find(r => r.d >= from)?.d || rows[0].d, last = rows.at(-1).d, base = {}; for (const ru of RULES) base[ru] = run(rows, ru, first, '9999'); if (!base.H) return null;
  const out = { from: first, to: last, whole: {}, rolling: {}, halves: {} };
  for (const ru of RULES) { const x = base[ru]; out.whole[ru] = { cagr: r2(cagr(x.wealth, x.R) * 100), mdd: r1(mdd(x.path) * 100), trades: x.trades, cagrVsH: r2((cagr(x.wealth, x.R) - cagr(base.H.wealth, base.H.R)) * 100), vsHPct: r1((x.wealth / base.H.wealth - 1) * 100) }; }
  const y0 = +first.slice(0, 4) + (first.slice(5) > '01-15' ? 1 : 0), y1 = +last.slice(0, 4) - 10;
  const mid = rows[Math.floor((rows.findIndex(r => r.d >= first) + rows.length) / 2)].d;
  for (const ru of RULES.filter(r => r !== 'H')) {
    const ex = []; for (let y = y0; y <= y1; y++) { const a = run(rows, ru, `${y}-01-01`, `${y + 10}-01-01`), b = run(rows, 'H', `${y}-01-01`, `${y + 10}-01-01`); if (a && b) ex.push(a.wealth / b.wealth - 1); }
    const s = [...ex].sort((p, q) => p - q);
    out.rolling[ru] = { windows: ex.length, beatHShare: ex.length ? r1(ex.filter(z => z > 0).length / ex.length * 100) : null, medianVsHPct: ex.length ? r1(s[Math.floor(s.length / 2)] * 100) : null, worstVsHPct: ex.length ? r1(s[0] * 100) : null };
    const h = []; for (const [a, b] of [[first, mid], [mid, '9999']]) { const x = run(rows, ru, a, b), k = run(rows, 'H', a, b); h.push(x && k ? r1((x.wealth / k.wealth - 1) * 100) : null); } out.halves[ru] = { split: mid, first: h[0], second: h[1] };
  }
  return out;
}
const out = { prereg: 'PREREG-C.md', index: {}, stock: {}, short: {} };
for (const [sym, name, from] of INDEX) { const rows = await get(sym); if (rows) out.index[sym] = { name, ...evalAsset(rows, from) }; }
for (const sym of STOCKS) { const rows = await get(sym); if (!rows || rows.length < 15 * 250) { console.log('skip', sym, rows?.length); continue; } out.stock[sym] = evalAsset(rows, rows[0].d); }
for (const sym of SHORT) { const rows = await get(sym); if (rows && rows.length > 300) out.short[sym] = evalAsset(rows, rows[0].d); }
// 판정(PREREG-C)
const med = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
out.verdict = {};
for (const ru of RULES.filter(r => r !== 'H')) {
  const idxFail = Object.entries(out.index).filter(([, m]) => !(m.rolling[ru].beatHShare >= 70)).map(([s, m]) => `${s} ${m.rolling[ru].beatHShare}%`);
  const stocks = Object.entries(out.stock), beat = stocks.filter(([, m]) => m.rolling[ru].beatHShare >= 70).length, shareBeat = r1(beat / Math.max(1, stocks.length) * 100);
  const medCagr = r2(med(stocks.map(([, m]) => m.whole[ru].cagrVsH)) ?? NaN), h1 = med(stocks.map(([, m]) => m.halves[ru].first)), h2 = med(stocks.map(([, m]) => m.halves[ru].second));
  out.verdict[ru] = { indexPass: idxFail.length === 0, indexFails: idxFail, stockShareBeat70: shareBeat, stockPass: shareBeat >= 70 && h1 > 0 && h2 > 0 && medCagr >= -2, stockMedianCagrVsH: medCagr, stockMedianHalves: [r1(h1), r1(h2)], stockWinCount: `${stocks.filter(([, m]) => m.whole[ru].vsHPct > 0).length}/${stocks.length} 전체 기간에서 보유보다 나음` };
}
writeFileSync(join(HERE, 'grid.json'), JSON.stringify(out, null, 1));
const line = (ru, m) => `  ${ru.padEnd(5)} CAGR ${m.whole[ru].cagr}% (보유 대비 ${m.whole[ru].cagrVsH >= 0 ? '+' : ''}${m.whole[ru].cagrVsH}%p) MDD ${m.whole[ru].mdd}% 매매 ${m.whole[ru].trades}${m.rolling[ru] ? ` | 10년창 이김 ${m.rolling[ru].beatHShare}% 중앙 ${m.rolling[ru].medianVsHPct}% 최악 ${m.rolling[ru].worstVsHPct}% | 반기 ${m.halves[ru].first}/${m.halves[ru].second}` : ''}`;
for (const [s, m] of Object.entries(out.index)) { console.log(`\n=== ${m.name} ${m.from}~${m.to}`); for (const ru of RULES) console.log(line(ru, m)); }
console.log('\n=== 개별 종목(전체 기간 · 보유 대비 CAGR %p / 10년창 이김 %)');
for (const [s, m] of Object.entries(out.stock)) console.log(`  ${s.padEnd(10)} ${m.from.slice(0, 4)}~ H ${m.whole.H.cagr}% MDD ${m.whole.H.mdd}% | ` + RULES.filter(r => r !== 'H').map(ru => `${ru} ${m.whole[ru].cagrVsH >= 0 ? '+' : ''}${m.whole[ru].cagrVsH}/${m.rolling[ru].beatHShare}`).join(' · '));
console.log('\n=== 짧은 종목(참고)'); for (const [s, m] of Object.entries(out.short)) console.log(`  ${s} ${m.from}~ ` + RULES.map(ru => `${ru} ${m.whole[ru].cagr}%/${m.whole[ru].mdd}%`).join(' · '));
console.log('\n판정:', JSON.stringify(out.verdict, null, 1));
