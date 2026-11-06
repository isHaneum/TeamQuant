// 연구 기업 98개의 배당 이력(Yahoo, 분할 조정 주당 배당). 결과: .research/dividends.json
// 왜: company-history의 월말 종가는 배당이 빠진 가격이라, 배당이 큰 은행·통신·유틸리티가 수익률에서 불리하게 잡힌다.
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KR, US, KOSDAQ } from './universe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'TeamQuant academic research prototype';

async function dividends(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1262304000&period2=9999999999&interval=1mo&events=div`, { headers: { 'User-Agent': 'Mozilla/5.0 ' + UA }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], tz = res.meta.gmtoffset || 0;
      return Object.values(res.events?.dividends || {}).map(x => [new Date((x.date + tz) * 1000).toISOString().slice(0, 10), x.amount]).sort((a, b) => a[0].localeCompare(b[0]));
    } catch (e) { if (k === 2) { console.warn('배당 실패', symbol, e.message); return null; } await sleep(1500); }
  }
}
const out = {};
for (const code of Object.keys(KR)) { out[code] = await dividends(code + (KOSDAQ.has(code) ? '.KQ' : '.KS')); await sleep(150); }
for (const t of Object.keys(US)) { out[t] = await dividends(t); await sleep(150); }
writeFileSync(join(root, '.research/dividends.json'), JSON.stringify(out));
const n = Object.values(out).filter(v => v?.length).length;
console.log(`배당 이력 ${n}/${Object.keys(out).length}개 종목, 실패 ${Object.values(out).filter(v => v == null).length}`);
