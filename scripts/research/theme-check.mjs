// 주제 묶음 상품과 넓은 지수의 실제 차이(결정 36 · 2026-11-15).
// 묻는 것: "방향이 맞는 주제(고령화 · 로봇 · 중국)를 묶어서 산 상품"이 같은 기간 넓은 지수보다 나았는가.
// 재는 것: 상장일(둘 다 자료가 있는 첫날)부터 지금까지의 연 수익률(배당 포함 수정 종가)과 그 차이, 최근 5년의 차이.
// 주의: 상품 하나가 한 가지 경로다. 이 표는 "주제가 틀렸다"가 아니라 "주제를 안다는 것만으로 지수를 이겼는지"를 본다.
// 사용: node scripts/research/theme-check.mjs   (표를 출력한다 · 파일은 쓰지 않는다)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d&events=div%2Csplit`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose, tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), close: adj?.[i] ?? q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
// [주제, 상품, 이름, 비교 지수]
const ROWS = [
  ['고령화', 'AGNG', 'Global X Aging Population', 'ACWI'],
  ['고령화', 'IXJ', 'iShares Global Healthcare', 'ACWI'],
  ['고령화', 'XLV', 'Health Care Select Sector', 'SPY'],
  ['고령화', '143860.KS', 'TIGER 헬스케어', '069500.KS'],
  ['로봇', 'ROBO', 'ROBO Global Robotics & Automation', 'ACWI'],
  ['로봇', 'BOTZ', 'Global X Robotics & AI', 'ACWI'],
  ['로봇', '445290.KS', 'KODEX K-로봇액티브', '069500.KS'],
  ['중국', 'FXI', 'iShares China Large-Cap', 'ACWI'],
  ['중국', 'MCHI', 'iShares MSCI China', 'ACWI'],
  ['중국', 'KWEB', 'KraneShares CSI China Internet', 'ACWI'],
  ['중국', 'ASHR', 'Xtrackers CSI 300 China A', 'ACWI'],
];
const cache = new Map();
const get = async s => { if (!cache.has(s)) { cache.set(s, await history(s)); await sleep(300); } return cache.get(s); };
const cagr = (a, b, d0, d1) => Math.pow(b / a, 365.25 / ((Date.parse(d1) - Date.parse(d0)) / 864e5)) - 1;
const on = (h, d) => { let f = null; for (const c of h) { if (c.date <= d) f = c; else break; } return f; };
const pct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const out = [];
for (const [theme, sym, name, bench] of ROWS) {
  const a = await get(sym), b = await get(bench), start = a[0].date > b[0].date ? a[0].date : b[0].date, end = a.at(-1).date < b.at(-1).date ? a.at(-1).date : b.at(-1).date;
  const a0 = on(a, start), b0 = on(b, start), a1 = on(a, end), b1 = on(b, end), ra = cagr(a0.close, a1.close, start, end), rb = cagr(b0.close, b1.close, start, end);
  const d5 = new Date(Date.parse(end) - 5 * 365.25 * 864e5).toISOString().slice(0, 10), has5 = d5 > start, a5 = has5 ? on(a, d5) : null, b5 = has5 ? on(b, d5) : null;
  // 차이가 가장 컸던 낙폭(상품/지수 비율의 고점 대비)
  const bBy = new Map(b.map(c => [c.date, c.close])); let peak = 0, mdd = 0; for (const c of a) { if (c.date < start || !bBy.has(c.date)) continue; const r = c.close / bBy.get(c.date); if (r > peak) peak = r; mdd = Math.min(mdd, r / peak - 1); }
  out.push({ theme, sym, name, bench, start, end, years: +(((Date.parse(end) - Date.parse(start)) / 864e5) / 365.25).toFixed(1), fund: ra, index: rb, diff: ra - rb, diff5: has5 ? cagr(a5.close, a1.close, d5, end) - cagr(b5.close, b1.close, d5, end) : null, relMdd: mdd });
}
console.log('주제 | 상품 | 비교 | 시작 | 햇수 | 상품 연 | 지수 연 | 차이 | 최근5년 차이 | 지수 대비 최대 낙폭');
for (const r of out) console.log([r.theme, `${r.sym} ${r.name}`, r.bench, r.start, r.years, pct(r.fund), pct(r.index), pct(r.diff), r.diff5 == null ? '-' : pct(r.diff5), pct(r.relMdd)].join(' | '));
console.log('기준일', out[0].end);
