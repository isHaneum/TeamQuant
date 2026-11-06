// 상황 통계 파일(data/situation-stats.json)을 다시 만든다. 공개 일봉(Yahoo, 5년)만 쓴다. 개인 자료 없음.
// 사용: node scripts/build-situation-stats.mjs [출력 경로] [--samples 표본.jsonl]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchMarketSeries } from '../lib/market.js';
import { UNIVERSE, collectSamples, buildStats } from '../lib/situation-study.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), sIdx = args.indexOf('--samples');
const samplesPath = sIdx >= 0 ? args.splice(sIdx, 2)[1] : null;
const out = resolve(args[0] || resolve(root, 'data/situation-stats.json'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(symbol) {
  for (let k = 0; k < 3; k++) { try { return (await fetchMarketSeries(symbol, '5y')).candles.filter(c => c.close > 0); } catch (e) { if (k === 2) console.warn('skip', symbol, e.message); await sleep(1000); } }
  return null;
}
const indexes = { '^KS11': await get('^KS11'), '^GSPC': await get('^GSPC') };
if (!indexes['^KS11'] || !indexes['^GSPC']) throw new Error('지수 시세를 받지 못했습니다.');
const series = [];
for (const [group, list] of Object.entries(UNIVERSE)) for (const symbol of list) { const candles = await get(symbol); if (candles) series.push({ symbol, group, candles }); await sleep(150); }
const t0 = Date.now(), collected = collectSamples(series, indexes);
const stats = buildStats(collected, { period: { KR: [indexes['^KS11'][0].date, indexes['^KS11'].at(-1).date], US: [indexes['^GSPC'][0].date, indexes['^GSPC'].at(-1).date] } });
stats.symbolsUsed = series.length;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(stats));
if (samplesPath) writeFileSync(samplesPath, collected.samples.map(s => JSON.stringify(s)).join('\n'));
console.log(`표본 ${collected.samples.length}개 · 종목 ${series.length}개 · 계산 ${Date.now() - t0}ms → ${out}`);
for (const [g, st] of Object.entries(stats.states)) for (const [s, v] of Object.entries(st)) console.log(g.padEnd(9), s.padEnd(10), 'n', String(v.n).padStart(4), '| 60d 중앙', String(v.f60.median).padStart(6), '오른 비율', v.f60.hit, '| 규칙', stats.rule[g]?.[s]);
const wf = stats.walkForward; if (wf) for (const [g, v] of Object.entries(wf.groups)) console.log('WF', g, 'cutoff', wf.cutoff, 'n', v.n, '적용', v.active, '평균 차이', v.edge.mean, '적용분', v.activeEdge?.mean ?? '-');
