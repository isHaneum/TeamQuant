// 구조 질문 답 묶기(결정 37 · 2026-11-15): 조사 결과 파일(JSON)들을 하나로 합쳐 형식을 검사하고 data/structure-cards.json 을 쓴다.
// 답 자체는 사람(과 조사 보조)이 출처·날짜를 붙여 쓴 것이다 — 이 스크립트는 고치지 않고 형식만 본다. 형식이 틀리면 쓰지 않고 멈춘다.
// 사용: node scripts/research/build-structure-cards.mjs <조사 파일1.json> [<조사 파일2.json> ...]
//   각 파일 = { companies: { key: { name, cluster, asOf, demand, china, breaks, unverified, dataNote? } } } · 같은 key 가 두 번 나오면 멈춘다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEntry, publicStructure, STRUCTURE_VERSION } from '../../lib/structure-cards.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), files = process.argv.slice(2);
if (!files.length) { console.error('조사 파일을 하나 이상 주십시오.'); process.exit(1); }
const companies = {}, unverified = [];
for (const f of files) { const d = JSON.parse(readFileSync(f, 'utf8')); for (const [k, e] of Object.entries(d.companies || {})) { if (companies[k]) { console.error(`중복: ${k}`); process.exit(1); } companies[k] = e; } }
const errs = Object.entries(companies).flatMap(([k, e]) => checkEntry(k, e)); if (errs.length) { console.error('형식 오류:\n  ' + errs.join('\n  ')); process.exit(1); }
const asOf = Object.values(companies).map(e => e.asOf).sort().at(-1);
const doc = { version: STRUCTURE_VERSION, asOf, generatedAt: new Date().toISOString(),
  questions: { demand: '⑥ 10년 뒤 이 회사 주력 제품의 수요는 인구·구조 변화로 늘어나는가, 그 돈은 누가 내고 값은 누가 정하는가', china: '⑦ 같은 것을 만드는 중국 기업이 있는가, 점유율은 어느 쪽으로 가는가, 중국 매출 비중과 방어선(기술·인허가 대 정책)은 무엇인가' },
  companies: Object.fromEntries(Object.entries(companies).sort(([a], [b]) => (a < b ? -1 : 1))) };
const out = { ...publicStructure(doc), generatedAt: doc.generatedAt, note: '답은 출처·날짜가 붙은 사람 판단이다. 수익 예측이 아니고 과거로 검증할 수 없다. 깨짐 조건의 now: clear = 아님 · met = 충족 · unknown = 확인 전.' };
writeFileSync(join(root, 'data/structure-cards.json'), JSON.stringify(out, null, 1));
for (const [k, e] of Object.entries(out.companies)) for (const u of e.unverified || []) unverified.push(`${k} ${e.name}: ${u}`);
console.log(`저장: data/structure-cards.json · ${Object.keys(out.companies).length}개 기업 · ${asOf}`); console.log(`확인하지 못한 것 ${unverified.length}건`);
