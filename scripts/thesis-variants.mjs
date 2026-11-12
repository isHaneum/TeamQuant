// 카드 기준을 구성 요소별로 쪼갠 탐색(결정 30 · 2026-11-12). 네트워크 없음. scripts/thesis-backtest.mjs 와 같은 방법(월말 · 그때 알 수 있던 자료 · 통과 동일가중 − 같은 시장 전체 동일가중, 다음 달).
// 주의: 변형 8개 × 시장 2 × 구간 2 = 32칸을 한꺼번에 본다. 이 정도 수를 보면 t 2 근처는 우연으로도 나온다(Harvey·Liu·Zhu 2016 은 새 기준에 t 3 을 요구). 여기 결과로 기준을 바꾸지 않는다 — 어느 요소가 일을 하는지 방향만 본다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCard, CARD_RULES as R } from '../lib/thesis-cards.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), hist = JSON.parse(readFileSync(join(root, 'data/company-history.json'), 'utf8')).companies;
const dates = [...new Set(Object.values(hist).flatMap(c => Object.keys(c.pred || {})))].sort();
const growth = c => c.growth?.ttm != null && c.growth.ttm >= R.minGrowth && c.growth.rank >= R.minRank && !c.breakNow.length, quality = c => (c.growth?.oi == null || c.growth.oi >= 0) && c.growth?.roe != null && c.growth.roe >= R.minRoe, cheap = c => c.value?.pct != null && c.value.pct <= R.maxValuePct;
const V = {
  '전체 기준(지금)': (c, x) => c.verdict === 'pass',
  '성장만': (c, x) => growth(c),
  '성장+질': (c, x) => growth(c) && quality(c),
  '가격만(자기 과거 70% 이하)': (c, x) => cheap(c),
  '성장+질, 비싼 것만(대기)': (c, x) => c.verdict === 'wait',
  '전체 기준 + 6개월 주가 오름': (c, x) => c.verdict === 'pass' && x.mom6 > 0,
  '전체 기준 + 6개월 주가 내림': (c, x) => c.verdict === 'pass' && x.mom6 <= 0,
  '성장 예측 상위 20%만': (c, x) => c.growth?.rank >= 0.8,
};
const rows = Object.fromEntries(Object.keys(V).map(k => [k, []]));
for (const d of dates) for (const market of ['KR', 'US']) {
  const all = [], pick = Object.fromEntries(Object.keys(V).map(k => [k, []]));
  for (const [k, c] of Object.entries(hist)) { if (c.market !== market || !c.pred?.[d]) continue; const i = c.months.findIndex(m => m[0] === d); if (i < 6 || i + 1 >= c.months.length || !(c.months[i][1] > 0)) continue;
    const fwd = c.months[i + 1][1] / c.months[i][1] - 1, x = { mom6: c.months[i][1] / c.months[i - 6][1] - 1 }, card = buildCard(k, c, { growthRank: c.pred[d][0] }, { asOf: d }); all.push(fwd);
    for (const [name, f] of Object.entries(V)) if (f(card, x)) pick[name].push(fwd); }
  if (all.length < 10) continue; const mean = a => a.reduce((s, v) => s + v, 0) / a.length, base = mean(all);
  for (const name of Object.keys(V)) if (pick[name].length) rows[name].push({ date: d, market, n: pick[name].length, ex: (mean(pick[name]) - base) * 100 });
}
const r2 = x => Math.round(x * 100) / 100;
const stat = rs => { const n = rs.length; if (n < 12) return null; const m = rs.reduce((a, r) => a + r.ex, 0) / n, sd = Math.sqrt(rs.reduce((a, r) => a + (r.ex - m) ** 2, 0) / (n - 1)); return { months: n, avgN: r2(rs.reduce((a, r) => a + r.n, 0) / n), exPp: r2(m), t: r2(m / (sd / Math.sqrt(n))) }; };
const out = { version: 'TV1-2026-11-12', generatedAt: new Date().toISOString(), note: '탐색용. 32칸을 한꺼번에 본 결과라 t 2 근처는 우연과 구분되지 않는다. 기준 변경의 근거로 쓰지 않는다.', variants: {} };
const fmt = s => s ? `${s.exPp > 0 ? '+' : ''}${s.exPp}%p (t ${s.t}, ${s.avgN}종목)` : '—';
console.log('변형 | 2021~ 국내 | 2021~ 미국 | 전체 국내 | 전체 미국');
for (const [name, rs] of Object.entries(rows)) { const cell = (mk, from) => stat(rs.filter(r => r.market === mk && r.date >= from)); const v = { '2021~': { KR: cell('KR', '2021-01-01'), US: cell('US', '2021-01-01') }, all: { KR: cell('KR', '0'), US: cell('US', '0') } }; out.variants[name] = v;
  console.log(`${name} | ${fmt(v['2021~'].KR)} | ${fmt(v['2021~'].US)} | ${fmt(v.all.KR)} | ${fmt(v.all.US)}`); }
if (!process.argv.includes('--print')) writeFileSync(join(root, 'data/thesis-variants.json'), JSON.stringify(out, null, 1));
