// 섹터 시세 자료: lib/sectors.js의 섹터 ETF·대표 회사의 공개 일봉(야후, 2년)으로
// 1주·1개월·3개월·6개월·연초 이후·1년 수익률, 1년 고점 대비, 주간 경로(52주)를 계산해 data/sectors.json에 쓴다.
// 화면(sector-ui.js)은 이 파일을 먼저 보여 주고, 고른 섹터만 /api/market으로 오늘 기준을 다시 계산한다.
// 사용: node scripts/sector-data.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTORS, SECTORS_VERSION, returnsFrom } from '../lib/sectors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) { console.error(`  ! ${symbol}: ${e.message}`); return null; } await sleep(1500); }
  }
}
// 52주 경로: 주 단위로 줄이고 시작을 100으로
function spark(closes) { const c = closes.slice(-252); if (c.length < 10) return null; const step = Math.max(1, Math.floor(c.length / 52)), pts = c.filter((_, i) => i % step === 0 || i === c.length - 1); const base = pts[0].close; return pts.map(p => Math.round(p.close / base * 1000) / 10); }
const avg = a => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
function basket(items) { const rets = items.map(i => i?.ret).filter(Boolean); if (!rets.length) return null; const keys = ['w1', 'm1', 'm3', 'm6', 'y1', 'ytd', 'offHigh']; return Object.fromEntries([...keys.map(k => [k, avg(rets.map(r => r[k]))]), ['n', rets.length]]); }

const cache = new Map(); const get = async s => { if (!cache.has(s)) { cache.set(s, await history(s)); await sleep(150); } return cache.get(s); };
const out = { version: SECTORS_VERSION, generatedAt: new Date().toISOString(), asOf: null, source: 'Yahoo Finance chart API (지연 일봉) · 각 종목 현지 통화 기준 수익률', sectors: {} };
let latest = '';
for (const S of SECTORS) {
  const o = { etf: {}, companies: {}, basket: {} };
  for (const m of ['KR', 'US']) { const e = S.etf[m]; if (!e) continue; const h = await get(e.symbol); o.etf[m] = h ? { symbol: e.symbol, name: e.name, ret: returnsFrom(h), spark: spark(h) } : { symbol: e.symbol, name: e.name, ret: null, spark: null }; if (h) latest = latest < h.at(-1).date ? h.at(-1).date : latest; }
  for (const c of S.companies) { const h = await get(c.symbol); o.companies[c.symbol] = { name: c.name, market: c.market, ret: h ? returnsFrom(h) : null, spark: h ? spark(h) : null }; }
  for (const m of ['KR', 'US']) o.basket[m] = basket(S.companies.filter(c => c.market === m).map(c => o.companies[c.symbol]));
  out.sectors[S.id] = o;
  const f = r => r ? `1M ${(r.m1 * 100).toFixed(1)}% · 3M ${(r.m3 * 100).toFixed(1)}% · 1Y ${r.y1 === null ? '—' : (r.y1 * 100).toFixed(1) + '%'}` : '—';
  console.log(`${S.name}: ETF(KR) ${f(o.etf.KR?.ret)} | 국내 바스켓 ${f(o.basket.KR)} | 미국 바스켓 ${f(o.basket.US)}`);
}
out.asOf = latest;
writeFileSync(resolve(root, 'data/sectors.json'), JSON.stringify(out));
console.log(`→ data/sectors.json (asOf ${latest})`);
