// ipo.mjs — pre-registered event study (see PREREG-H.md). Node 18+, no deps.
// Data: Yahoo chart v8 (prices, splits), SEC XBRL companyconcept (share counts). Cached in ./cache.
// Usage: node ipo.mjs   -> writes ipo.json and ipo.out next to this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const CACHE = DIR + 'cache' + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const YUA = { 'User-Agent': 'Mozilla/5.0' };
const SUA = { 'User-Agent': 'ipo-research-script' };
const LAST_DATA = '2026-11-20';

// ---------- universe (PREREG appendix A, frozen 2026-11-22 18:21 KST) ----------
const EVENTS = [
  ['Anthropic', 'ANT', '2026-11-19', 81340, 'IT'],
  ['SpaceX', 'SPCX', '2026-06-12', 75000, 'IND'],
  ['Alibaba', 'BABA', '2014-09-19', 21767, 'IT'],
  ['Facebook', 'META', '2012-05-18', 16007, 'IT'],
  ['Rivian', 'RIVN', '2021-11-10', 11934, 'CD'],
  ['Uber', 'UBER', '2019-05-10', 8100, 'IND'],
  ['Medline', 'MDLN', '2025-12-17', 6265, 'HC'],
  ['Cerebras', 'CBRS', '2026-05-14', 5550, 'IT'],
  ['Arm', 'ARM', '2023-09-14', 4871, 'IT'],
  ['Coupang', 'CPNG', '2021-03-11', 4550, 'CD'],
  ['Lineage', 'LINE', '2024-07-25', 4437, 'RE'],
  ['DiDi', 'DIDIY', '2021-06-30', 4435, 'IND'],
  ['Kenvue', 'KVUE', '2023-05-04', 3802, 'CS'],
  ['Airbnb', 'ABNB', '2020-12-10', 3490, 'CD'],
  ['Snap', 'SNAP', '2017-03-02', 3400, 'IT'],
  ['DoorDash', 'DASH', '2020-12-09', 3366, 'CD'],
  ['Snowflake', 'SNOW', '2020-09-16', 3360, 'IT'],
  ['Citizens Financial', 'CFG', '2014-09-24', 3010, 'FIN'],
  ['Avantor', 'AVTR', '2019-05-17', 2898, 'HC'],
  ['Synchrony', 'SYF', '2014-07-31', 2875, 'FIN'],
  ['Plains GP', 'PAGP', '2013-10-16', 2816, 'EN'],
  ['AXA Equitable', 'EQH', '2018-05-10', 2745, 'FIN'],
  ['Nu Holdings', 'NU', '2021-12-09', 2602, 'FIN'],
  ['GlobalFoundries', 'GFS', '2021-10-28', 2585, 'IT'],
  ['First Data', 'FDC', '2015-10-15', 2560, 'IT'],
].map(([name, sym, day0, proceeds, sector]) => ({ name, sym, day0, proceeds, sector }));

// ---------- candidate pools (fixed before results) ----------
// [sym, inSectorFrom, inSectorUntil]: GICS membership dates (2018-09-28 Comm Services split; 2023-03-17 payments -> Financials, ADP -> Industrials)
const POOLS = {
  IT: [['AAPL'], ['MSFT'], ['IBM'], ['GOOGL', null, '2018-09-28'], ['META', null, '2018-09-28'], ['ORCL'], ['INTC'], ['CSCO'], ['QCOM'],
    ['V', null, '2023-03-17'], ['MA', null, '2023-03-17'], ['PYPL', null, '2023-03-17'], ['HPQ'], ['EBAY', null, '2018-09-28'], ['TXN'], ['ADBE'], ['CRM'], ['NVDA'], ['AVGO'], ['ACN'],
    ['AMD'], ['MU'], ['PLTR'], ['AMAT'], ['NOW'], ['LRCX'], ['KLAC'], ['ANET'], ['INTU'], ['APP']],
  CD: [['AMZN'], ['TSLA'], ['HD'], ['NKE'], ['MCD'], ['LOW'], ['SBUX'], ['BKNG'], ['TJX'], ['GM'], ['F'], ['ABNB'], ['CMG'], ['MAR'], ['ORLY'], ['DASH'],
    ['CMCSA', null, '2018-09-28'], ['DIS', null, '2018-09-28'], ['NFLX', null, '2018-09-28']],
  IND: [['BA'], ['HON'], ['UNP'], ['RTX'], ['MMM'], ['LMT'], ['CAT'], ['UPS'], ['GE'], ['DE'], ['GD'], ['NOC'], ['ETN'], ['ADP', '2023-03-17'], ['UBER'], ['GEV'], ['PH'], ['TT'], ['WM'], ['CSX'], ['FDX'], ['ITW']],
  HC: [['JNJ'], ['UNH'], ['PFE'], ['MRK'], ['ABBV'], ['LLY'], ['ABT'], ['TMO'], ['AMGN'], ['MDT'], ['ISRG'], ['DHR'], ['BMY'], ['GILD'], ['CVS'], ['SYK'], ['BSX'], ['VRTX']],
  CS: [['PG'], ['WMT'], ['KO'], ['PEP'], ['COST'], ['PM'], ['MDLZ'], ['MO'], ['CL'], ['EL']],
  FIN: [['BRK-B'], ['JPM'], ['WFC'], ['BAC'], ['C'], ['GS'], ['MS'], ['AXP'], ['SCHW'], ['BLK'], ['USB'], ['AIG'], ['MET'], ['PNC'], ['SPGI'], ['V', '2023-03-17'], ['MA', '2023-03-17'], ['PYPL', '2023-03-17']],
  RE: [['PLD'], ['AMT'], ['EQIX'], ['WELL'], ['SPG'], ['PSA'], ['O'], ['DLR'], ['CCI'], ['CBRE'], ['CSGP']],
  EN: [['XOM'], ['CVX'], ['SLB'], ['COP'], ['OXY'], ['KMI'], ['EOG'], ['PSX'], ['HAL'], ['MPC'], ['EPD'], ['NOV'], ['WMB']],
};
const SECTOR_ETF = { IT: 'XLK', CD: 'XLY', IND: 'XLI', HC: 'XLV', CS: 'XLP', FIN: 'XLF', RE: 'XLRE', EN: 'XLE' };
// Company changed CIK: Google Inc. (Alphabet's first 10-Q was filed 2015-10-29), BlackRock (new holdco 2024-10), Exxon (new holdco CIK in 2026)
const CIK_OVERRIDE = [{ sym: 'GOOGL', before: '2015-10-30', cik: 1288776 }, { sym: 'BLK', before: '2024-10-01', cik: 1364742 }, { sym: 'XOM', before: '2026-06-01', cik: 34088 }];
// Multi-class issuers whose XBRL share totals are only tagged per class (no non-dimensional total). Read by hand from SEC filings (fix of data retrieval, rule unchanged).
// GOOGL: 10-Q/10-K cover counts (A+B[+C]). V: diluted weighted-average class A as-converted (10-Q EPS note) or as-converted total (Note: Stockholders' Equity). BRK: Class A equivalent = A + B/1500 (10-Q cover), priced with BRK-A.
const MANUAL_SHARES = [
  { sym: 'GOOGL', day0: '2012-05-18', val: 326006437, end: '2012-04-19', filed: '2012-04-25', src: '10-Q 0001193125-12-182401 cover' },
  { sym: 'GOOGL', day0: '2015-10-15', val: 685535249, end: '2015-07-17', filed: '2015-07-23', src: '10-Q 0001288776-15-000035 cover' },
  { sym: 'GOOGL', day0: '2017-03-02', val: 691420327, end: '2017-01-26', filed: '2017-02-03', src: '10-K 0001652044-17-000008 cover' },
  { sym: 'V', day0: '2015-10-15', val: 2448e6, end: '2015-06-30', filed: '2015-07-23', src: '10-Q 0001403161-15-000010 diluted wtd class A (as-converted)' },
  { sym: 'V', day0: '2017-03-02', val: 2421e6, end: '2016-12-31', filed: '2017-02-02', src: '10-Q 0001403161-17-000011 diluted wtd class A (as-converted)' },
  { sym: 'V', day0: '2020-09-16', val: 2203e6, end: '2020-06-30', filed: '2020-07-31', src: '10-Q 0001403161-20-000048 as-converted total' },
  { sym: 'V', day0: '2021-10-28', val: 2174e6, end: '2021-06-30', filed: '2021-07-29', src: '10-Q 0001403161-21-000042 as-converted total' },
  { sym: 'BRK-B', day0: '2014-07-31', val: 1644360, end: '2014-04-24', filed: '2014-05-02', src: '10-Q 0001193125-14-180321 cover' },
  { sym: 'BRK-B', day0: '2014-09-24', val: 1642363, end: '2014-07-25', filed: '2014-08-01', src: '10-Q 0001193125-14-291724 cover' },
  { sym: 'BRK-B', day0: '2018-05-10', val: 1645062, end: '2018-04-27', filed: '2018-05-07', src: '10-Q 0001193125-18-153460 cover' },
  { sym: 'BRK-B', day0: '2021-12-09', val: 1488922, end: '2021-10-27', filed: '2021-11-08', src: '10-Q 0001564590-21-055032 cover' },
];
const STALE_DAYS = 400; // share data older than this vs cutoff is treated as missing

// ---------- data helpers ----------
async function yahoo(sym) {
  const f = CACHE + `y_${sym}.json`;
  let j;
  if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    const p1 = Math.floor(Date.UTC(2011, 5, 1) / 1000), p2 = Math.floor(Date.UTC(2026, 10, 22) / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=split%2Cdiv`;
    await sleep(250);
    const r = await fetch(url, { headers: YUA });
    j = await r.json();
    fs.writeFileSync(f, JSON.stringify(j));
  }
  const res = j?.chart?.result?.[0];
  if (!res || !res.timestamp) return null;
  const q = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose || q.close;
  const m = new Map();
  res.timestamp.forEach((t, i) => {
    const d = new Date((t + (res.meta.gmtoffset ?? -18000)) * 1000).toISOString().slice(0, 10);
    if (q.close[i] != null && adj[i] != null) m.set(d, { c: q.close[i], a: adj[i] });
  });
  const splits = Object.values(res.events?.splits || {}).map(s => ({ d: new Date(s.date * 1000).toISOString().slice(0, 10), r: s.numerator / s.denominator }));
  return { sym, m, splits, first: [...m.keys()][0] };
}
let T2C = null;
function cikOf(sym, asOf) {
  const o = CIK_OVERRIDE.find(o => o.sym === sym && asOf < o.before);
  if (o) return o.cik;
  if (!T2C) { const j = JSON.parse(fs.readFileSync(CACHE + 'sec_company_tickers.json', 'utf8')); T2C = {}; for (const x of Object.values(j)) T2C[x.ticker] = x.cik_str; }
  return T2C[sym] ?? T2C[sym.replace('-', '.')] ?? null;
}
async function secConcept(cik, tax, concept) {
  const c = String(cik).padStart(10, '0');
  const f = CACHE + `sec_${c}_${concept}.json`;
  if (fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8'); return t === 'null' ? null : JSON.parse(t); }
  await sleep(130);
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${c}/${tax}/${concept}.json`, { headers: SUA });
  if (!r.ok) { fs.writeFileSync(f, 'null'); return null; }
  const t = await r.text(); fs.writeFileSync(f, t); return JSON.parse(t);
}
// Share count known before day0: latest 10-Q/10-K period ending <= cutoff, as first filed.
async function sharesAsOf(sym, cutoff, day0) {
  const man = MANUAL_SHARES.find(m => m.sym === sym && m.day0 === day0);
  if (man) return { val: man.val, end: man.end, filed: man.filed, concept: 'manual: ' + man.src };
  if (sym === 'V' || sym === 'BRK-B' || (sym === 'GOOGL' && day0 >= '2015-10-30')) {
    // multi-class: XBRL totals unreliable; only manual values are used
    if (!(sym === 'GOOGL' && day0 < '2015-10-30')) return null;
  }
  const cik = cikOf(sym, day0);
  if (!cik) return null;
  const staleBefore = new Date(new Date(cutoff + 'T00:00:00Z').getTime() - STALE_DAYS * 864e5).toISOString().slice(0, 10);
  for (const [tax, con] of [['us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'], ['us-gaap', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'], ['us-gaap', 'WeightedAverageLimitedPartnershipUnitsOutstanding'], ['dei', 'EntityCommonStockSharesOutstanding']]) {
    const j = await secConcept(cik, tax, con);
    const facts = j ? Object.values(j.units || {}).flat() : [];
    const ok = facts.filter(x => x.filed < day0 && x.end <= cutoff && x.end >= staleBefore && /10-[QK]/.test(x.form || ''));
    if (!ok.length) continue;
    const maxEnd = ok.reduce((a, x) => x.end > a ? x.end : a, '');
    const cand = ok.filter(x => x.end === maxEnd).sort((a, b) => a.filed < b.filed ? -1 : 1);
    const same = cand.filter(x => x.filed === cand[0].filed).sort((a, b) => (a.start || '') > (b.start || '') ? -1 : 1);
    const pick = same[0];
    // filer tagged share count in thousands (e.g. COP 2013: 1,237,157) -> scale
    const val = pick.val < 2e7 ? pick.val * 1000 : pick.val;
    return { val, end: pick.end, filed: pick.filed, concept: con + (val !== pick.val ? ' (x1000 scale fix)' : ''), cik };
  }
  return null;
}
const splitFactorAfter = (splits, date) => splits.filter(s => s.d > date).reduce((p, s) => p * s.r, 1);

// ---------- stats ----------
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const median = a => { const b = [...a].sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function lgamma(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const v of c) s += v / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function betacf(a, b, x) { const qab = a + b, qap = a + 1, qam = a - 1; let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d; for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c; aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break; } return h; }
function ibeta(a, b, x) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b; }
function tTest(a) { const n = a.length, m = mean(a), s = sd(a), t = m / (s / Math.sqrt(n)), df = n - 1; return { t, df, p: ibeta(df / 2, 0.5, df / (df + t * t)) }; }
function binom2(k, n) { const lc = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1); let lo = 0, hi = 0; for (let i = 0; i <= n; i++) { const p = Math.exp(lc(n, i) - n * Math.log(2)); if (i <= k) lo += p; if (i >= k) hi += p; } return Math.min(1, 2 * Math.min(lo, hi)); }
function summarize(vals) {
  const n = vals.length; if (n < 2) return { n };
  const neg = vals.filter(x => x < 0).length, nz = vals.filter(x => x !== 0).length, tt = tTest(vals);
  const se = sd(vals) / Math.sqrt(n), tc = tCrit(n - 1, 0.05), tp = tCrit(n - 1, 0.4); // tp: one-sided 20% -> 80% power
  // info only (not part of the decision rule): 95% CI and minimum detectable mean at 80% power
  return { n, mean: mean(vals), median: median(vals), sd: sd(vals), shareNeg: neg / n, t: tt.t, p_t: tt.p, signNeg: neg, signP: binom2(neg, nz), ci95: [mean(vals) - tc * se, mean(vals) + tc * se], mde80: (tc + tp) * se };
}
// two-sided critical t for level alpha (bisection on the p-value)
function tCrit(df, alpha) { let lo = 0, hi = 50; for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; const p = ibeta(df / 2, 0.5, df / (df + mid * mid)); if (p > alpha) lo = mid; else hi = mid; } return (lo + hi) / 2; }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- main ----------
const WINDOWS = { pre: [-10, -1], post: [0, 5], late: [6, 20] };
const LOCK = [-5, 5];
const ycache = {};
async function Y(sym) { if (!(sym in ycache)) ycache[sym] = await yahoo(sym); return ycache[sym]; }
const spy = await Y('SPY');
const spyDates = [...spy.m.keys()].filter(d => d <= LAST_DATA);
const idx = new Map(spyDates.map((d, i) => [d, i]));
const firstOnOrAfter = d => spyDates.find(x => x >= d);
const prevMonthEnd = day0 => { const ym = day0.slice(0, 7); let best = null; for (const d of spyDates) { if (d.slice(0, 7) < ym) best = d; else break; } return best; };
function winRet(series, i0, a, b) {
  const s = i0 + a - 1, e = i0 + b;
  if (!series || s < 0 || e >= spyDates.length) return null;
  const p0 = series.m.get(spyDates[s]), p1 = series.m.get(spyDates[e]);
  return p0 && p1 ? p1.a / p0.a - 1 : null;
}

const out = { generated: new Date().toISOString(), lastData: LAST_DATA, prereg: 'PREREG-H.md', events: [] };
for (const ev of EVENTS) {
  const d0 = firstOnOrAfter(ev.day0), i0 = idx.get(d0);
  const ipo = await Y(ev.sym);
  const notes = [];
  if (!ipo) notes.push(`no Yahoo data for ${ev.sym}`);
  else if (ipo.first !== ev.day0) notes.push(`Yahoo first date for ${ev.sym} = ${ipo.first}`);
  const cutoff = prevMonthEnd(ev.day0);
  const caps = [];
  for (const [sym, from, until] of POOLS[ev.sector]) {
    if (sym === ev.sym) continue;
    if (from && ev.day0 < from) continue;
    if (until && ev.day0 >= until) continue;
    const y = await Y(sym); if (!y) { notes.push(`no price ${sym}`); continue; }
    const px = y.m.get(cutoff); if (!px) continue; // not listed yet
    const sh = await sharesAsOf(sym, cutoff, ev.day0); if (!sh) { notes.push(`no shares ${sym}`); continue; }
    let price = px.c, fac = splitFactorAfter(y.splits, sh.filed);
    if (sym === 'BRK-B') { const a = await Y('BRK-A'); price = a?.m.get(cutoff)?.c; fac = 1; } // Class A-equivalent shares x BRK-A price
    if (!price) continue;
    caps.push({ sym, cap: price * sh.val * fac, sharesEnd: sh.end, filed: sh.filed, concept: sh.concept });
  }
  caps.sort((a, b) => b.cap - a.cap);
  const Ld = new Date(ev.day0 + 'T00:00:00Z'); Ld.setUTCDate(Ld.getUTCDate() + 180);
  const Lday = firstOnOrAfter(Ld.toISOString().slice(0, 10)) || null;
  const iL = Lday ? idx.get(Lday) : undefined;
  const rec = { ...ev, day0Used: d0, cutoff, lockupDay: Lday, ranking: caps.slice(0, 8).map(c => ({ sym: c.sym, capB: +(c.cap / 1e9).toFixed(1), sharesPeriodEnd: c.sharesEnd })), notes, windows: {} };
  if (process.env.RANK_ONLY) { console.log(`${ev.name} ${ev.sector} cutoff ${cutoff} ${notes.join('; ')}\n  ${caps.slice(0, 8).map(c => `${c.sym} ${(c.cap / 1e9).toFixed(0)}B(${c.sharesEnd})`).join(', ')}`); continue; }
  const etf = await Y(SECTOR_ETF[ev.sector]);
  const defs = { ...Object.fromEntries(Object.entries(WINDOWS).map(([k, w]) => [k, { i: i0, w }])), lock: { i: iL, w: LOCK } };
  for (const [k, { i, w }] of Object.entries(defs)) {
    if (i === undefined || i + w[1] >= spyDates.length || i + w[0] - 1 < 0) { rec.windows[k] = { complete: false }; continue; }
    const m = winRet(spy, i, w[0], w[1]);
    const peers = [];
    for (const c of caps) { if (peers.length === 5) break; const r = winRet(await Y(c.sym), i, w[0], w[1]); if (r != null) peers.push({ sym: c.sym, r }); }
    const pr = peers.length ? mean(peers.map(p => p.r)) : null;
    const er = winRet(etf, i, w[0], w[1]);
    const ir = k === 'lock' ? winRet(ipo, i, w[0], w[1]) : null;
    rec.windows[k] = { complete: true, start: spyDates[i + w[0] - 1], end: spyDates[i + w[1]], spy: m, peers: peers.map(p => p.sym), peerRets: peers.map(p => +p.r.toFixed(5)), peerRet: pr, AR: pr - m, etfAR: er != null ? er - m : null, ipoAR: ir != null ? ir - m : null };
  }
  out.events.push(rec);
}

if (process.env.RANK_ONLY) process.exit(0);
function clusterVals(key) {
  const evs = out.events.filter(e => e.windows[key]?.complete && e.name !== 'Anthropic');
  const groups = [];
  for (const e of evs) {
    const ie = idx.get(key === 'lock' ? e.lockupDay : e.day0Used);
    const g = groups.find(g => g.sector === e.sector && Math.abs(g.i - ie) <= 10);
    if (g) g.items.push(e); else groups.push({ sector: e.sector, i: ie, items: [e] });
  }
  const avg = (items, f) => items.every(e => e.windows[key][f] != null) ? mean(items.map(e => e.windows[key][f])) : null;
  return groups.map(g => ({ names: g.items.map(e => e.name).join('+'), sector: g.sector, AR: avg(g.items, 'AR'), spy: avg(g.items, 'spy'), etfAR: avg(g.items, 'etfAR'), ipoAR: avg(g.items, 'ipoAR') }));
}
const spyAdj = spyDates.map(d => spy.m.get(d).a);
const iStart = spyDates.findIndex(d => d >= '2012-01-03');
function uncond(w) { const L = w[1] - w[0] + 1, arr = []; for (let s = iStart; s + L < spyDates.length; s++) arr.push(spyAdj[s + L] / spyAdj[s] - 1); return arr; }
const rng = mulberry32(20261122);
function mcPercentile(dist, n, obs, draws = 10000) { let below = 0; for (let k = 0; k < draws; k++) { let s = 0; for (let j = 0; j < n; j++) s += dist[Math.floor(rng() * dist.length)]; if (s / n <= obs) below++; } return below / draws; }

out.results = {};
for (const [key, w] of [...Object.entries(WINDOWS), ['lock', LOCK]]) {
  const cv = clusterVals(key);
  const ar = summarize(cv.map(x => x.AR));
  const etf = summarize(cv.filter(x => x.etfAR != null).map(x => x.etfAR));
  const ipoAR = summarize(cv.filter(x => x.ipoAR != null).map(x => x.ipoAR));
  const sp = cv.map(x => x.spy), dist = uncond(w);
  const spyRes = { ...summarize(sp), uncondMean: mean(dist), uncondMedian: median(dist), uncondShareNeg: dist.filter(x => x < 0).length / dist.length, mcPercentileOfEventMean: mcPercentile(dist, sp.length, mean(sp)) };
  const pass = ar.n >= 2 && ar.mean < 0 && ar.p_t < 0.05 && ar.median < -0.01;
  out.results[key] = { window: w, clusters: cv, peerAR: ar, sectorEtfAR: etf, ipoStockAR: key === 'lock' ? ipoAR : undefined, spy: spyRes, decisionCriterionMet: ['pre', 'post', 'lock'].includes(key) ? pass : 'info-only' };
}
out.decision = (out.results.pre.decisionCriterionMet || out.results.post.decisionCriterionMet || out.results.lock.decisionCriterionMet) ? 'ENTER_ENGINE_RULE' : 'NOTE_ONLY';

// ---------- Part A (descriptive, Anthropic week) ----------
const partA = {};
const span = (y, d1, d2) => { const a = y?.m.get(d1), b = y?.m.get(d2); return a && b ? b.a / a.a - 1 : null; };
for (const s of ['^GSPC', '^NDX', 'SPY', 'QQQ', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'ORCL', 'META', 'AAPL', 'AVGO', 'AMD', 'IGV', 'SMH', 'XLK', 'RSP']) {
  const y = await Y(s); if (!y) continue;
  partA[s] = { wk_1106_1113: span(y, '2026-11-06', '2026-11-13'), wk_1113_1120: span(y, '2026-11-13', '2026-11-20'), pre10_1104_1118: span(y, '2026-11-04', '2026-11-18'), d0d1_1118_1120: span(y, '2026-11-18', '2026-11-20'), ytd_1231_1120: span(y, '2025-12-31', '2026-11-20') };
}
const antY = await Y('ANT');
partA.ANT = { ipoPrice: 83, closes: antY ? Object.fromEntries([...antY.m].map(([d, v]) => [d, v.c])) : null };
out.partA = partA;
fs.writeFileSync(DIR + 'ipo.json', JSON.stringify(out, null, 1));

// ---------- text output ----------
const log = []; const P = s => { log.push(s); console.log(s); };
const pct = x => x == null ? '   n/a ' : ((x * 100).toFixed(2) + '%').padStart(7);
P(`IPO event study (PREREG-H) — data through ${LAST_DATA}; generated ${out.generated}`);
P('AR = equal-weight top-5 sector peers (adjclose) minus SPY, simple window returns.\n');
for (const e of out.events) {
  P(`${e.name} [${e.sector}] $${e.proceeds}M day0 ${e.day0Used} capCutoff ${e.cutoff} lockup ${e.lockupDay}${e.notes.length ? '  NOTE: ' + e.notes.join('; ') : ''}`);
  P(`  cap rank: ${e.ranking.map(r => r.sym + ' ' + r.capB + 'B').join(', ')}`);
  for (const k of ['pre', 'post', 'late', 'lock']) {
    const w = e.windows[k];
    if (!w.complete) { P(`  ${k.padEnd(4)} incomplete`); continue; }
    P(`  ${k.padEnd(4)} ${w.start}->${w.end} peers[${w.peers.join(',')}] peerAR ${pct(w.AR)} SPY ${pct(w.spy)} etfAR ${pct(w.etfAR)}${k === 'lock' ? ' ipoAR ' + pct(w.ipoAR) : ''}`);
  }
}
P('\n=== RESULTS (cluster level; Anthropic excluded) ===');
for (const [k, r] of Object.entries(out.results)) {
  const a = r.peerAR, s = r.spy, e = r.sectorEtfAR;
  P(`[${k}] window ${JSON.stringify(r.window)}  n=${a.n}`);
  P(`  peer AR: mean ${pct(a.mean)} median ${pct(a.median)} sd ${pct(a.sd)} shareNeg ${(a.shareNeg * 100).toFixed(0)}% t ${a.t.toFixed(2)} p_t ${a.p_t.toFixed(3)} | sign ${a.signNeg}/${a.n} neg p_sign ${a.signP.toFixed(3)} -> criterion met: ${r.decisionCriterionMet}`);
  P(`  peer AR (info): 95% CI [${pct(a.ci95[0])}, ${pct(a.ci95[1])}]  min detectable |mean| at 80% power ${pct(a.mde80)}`);
  P(`  sector-ETF AR (info): n=${e.n} mean ${pct(e.mean)} median ${pct(e.median)} shareNeg ${(e.shareNeg * 100).toFixed(0)}% t ${e.t?.toFixed(2)} p ${e.p_t?.toFixed(3)}`);
  if (r.ipoStockAR) { const q = r.ipoStockAR; P(`  IPO stock AR (info): n=${q.n} mean ${pct(q.mean)} median ${pct(q.median)} shareNeg ${((q.shareNeg || 0) * 100).toFixed(0)}% t ${q.t?.toFixed(2)} p ${q.p_t?.toFixed(3)}`); }
  P(`  SPY: event mean ${pct(s.mean)} median ${pct(s.median)} shareNeg ${(s.shareNeg * 100).toFixed(0)}% | all-window mean ${pct(s.uncondMean)} median ${pct(s.uncondMedian)} shareNeg ${(s.uncondShareNeg * 100).toFixed(0)}% | event-mean percentile (MC) ${(s.mcPercentileOfEventMean * 100).toFixed(1)}%`);
}
P(`\nDECISION (pre-registered rule): ${out.decision}`);
P('\n=== Part A (Anthropic week, descriptive) ===');
for (const [s, v] of Object.entries(partA)) if (v && 'wk_1113_1120' in v) P(`${s.padEnd(6)} 11/06->11/13 ${pct(v.wk_1106_1113)} | 11/13->11/20 ${pct(v.wk_1113_1120)} | 11/04->11/18 ${pct(v.pre10_1104_1118)} | 11/18->11/20 ${pct(v.d0d1_1118_1120)} | YTD ${pct(v.ytd_1231_1120)}`);
fs.writeFileSync(DIR + 'ipo.out', log.join('\n') + '\n');
