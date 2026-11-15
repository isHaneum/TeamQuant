// data/structure-cards.json → 문서용 마크다운 표(결정 37). 문서의 표를 손으로 옮기지 않으려고 쓴다.
// 사용: node scripts/research/structure-table.mjs [키1,키2,...]   (키를 주면 그 순서·그 종목만)
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeStructure, LABELS as L } from '../../lib/structure-cards.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), S = JSON.parse(readFileSync(join(root, 'data/structure-cards.json'), 'utf8'));
const keys = process.argv[2] ? process.argv[2].split(',') : Object.keys(S.companies);
const cell = s => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
console.log('| 종목 | 묶음 | ⑥ 수요 · 돈 내는 곳 · 값 | ⑦ 중국 경쟁 · 중국 매출 · 방어선 | 깨짐 조건(지금) | 판정 |');
console.log('|---|---|---|---|---|---|');
for (const k of keys) { const e = S.companies[k]; if (!e) continue; const j = judgeStructure(e, { today: S.asOf });
  console.log(`| ${cell(e.name)} | ${cell(L.cluster[e.cluster] || e.cluster)} | **${L.demand[e.demand.grade]}** · ${cell(e.demand.driver)} · ${L.payer[e.demand.payer]} · ${L.pricing[e.demand.pricing]} | **${L.china[e.china.grade]}** · ${cell((e.china.competitors || []).slice(0, 2).join(', ') || '뚜렷한 경쟁자 없음')} · ${e.china.chinaRevenuePct == null ? '미확인' : e.china.chinaRevenuePct + '%'} · ${(e.china.defense || []).map(d => L.defense[d]).join('·')} | ${(e.breaks || []).map(b => `${cell(b.text)}(${L.now[b.now]})`).join('<br>')} | ${j.ok ? '통과' : `**막힘** — ${cell(j.reasons.join(' · '))}`} |`); }
