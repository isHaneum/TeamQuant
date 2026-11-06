// 생존 편향 점검용: 그해 SEC에 연간 재무를 낸 미국 기업 전부(이후 상장폐지·인수된 기업 포함). 결과: .research/sec-universe.json
// SEC frames API: 개념 × 연도마다 모든 제출 기업의 값 1개. 주의: 같은 기간을 여러 번 제출했으면 '가장 나중' 값이라
// 재작성(사업 매각 반영 등)이 섞인다. 이 영향은 growth-universe.py가 98개 기업(최초 제출값)과 비교해 따로 잰다.
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'TeamQuant academic research prototype';
const DURATION = { rev1: 'RevenueFromContractWithCustomerExcludingAssessedTax', rev2: 'Revenues', rev3: 'SalesRevenueNet', rev4: 'RevenueFromContractWithCustomerIncludingAssessedTax', oi: 'OperatingIncomeLoss', ni: 'NetIncomeLoss', ocf: 'NetCashProvidedByUsedInOperatingActivities' };
const INSTANT = { eq: 'StockholdersEquity' };
const YEARS = Array.from({ length: 17 }, (_, i) => 2009 + i);

async function frame(tag, period) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error('SEC ' + r.status);
      return (await r.json()).data.map(x => [x.cik, x.val, x.end, x.accn]);
    } catch (e) { if (k === 2) { console.warn('실패', tag, period, e.message); return null; } await sleep(2000); }
  }
}
const out = { generatedAt: new Date().toISOString(), note: 'SEC frames(연간, 가장 나중 제출값). [cik, 값, 기말, 접수번호]', names: {}, data: {} };
for (const y of YEARS) {
  out.data[y] = {};
  for (const [k, tag] of Object.entries(DURATION)) { out.data[y][k] = await frame(tag, `CY${y}`); await sleep(150); }
  for (const [k, tag] of Object.entries(INSTANT)) { out.data[y][k] = await frame(tag, `CY${y}Q4I`); await sleep(150); }
  console.log(y, Object.entries(out.data[y]).map(([k, v]) => `${k}:${v?.length ?? 'x'}`).join(' '));
}
writeFileSync(join(root, '.research/sec-universe.json'), JSON.stringify(out));
console.log('저장 .research/sec-universe.json');
