// 다음 계획 후보 만들기(결정 36 · 2026-11-15): 지금 계획에서 개별 종목 합계는 그대로 두고 종목 사이 비중만 위험 기여가 같도록 나눈 것.
// 후보는 적용되지 않는다. 모의계좌 엔진이 읽어 "바꾸면 얼마나 사고파는지"만 보여 준다(lib/paper-live.js planChangeInfo).
// 적용하려면 이 파일의 내용을 data/paper-plan.json 으로 옮기고(계획 변경 1회 사용) scripts/research/sizing-study.mjs 를 다시 돌린다.
// 사용: node scripts/research/build-plan-candidate.mjs  → data/paper-plan.next.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; }, PLAN_FILE = arg('--plan') || 'data/paper-plan.json', STUDY_FILE = arg('--study') || 'data/sizing-study.json';
const plan = JSON.parse(readFileSync(join(root, PLAN_FILE), 'utf8')), study = JSON.parse(readFileSync(join(root, STUDY_FILE), 'utf8'));
if (study.planVersion !== plan.version) throw new Error(`크기 연구(${study.planVersion})가 지금 계획(${plan.version})과 다릅니다. sizing-study 를 먼저 다시 돌리십시오.`);
const erc = study.snapshot.erc.weightsPct, cap = plan.caps?.single || 7, FIRST = 0.6, r2 = v => Math.round(v * 100) / 100;
const weights = {}; let before = 0, after = 0;
for (const [k, v] of Object.entries(plan.weights)) {
  if (v.role !== 'satellite') { weights[k] = v; continue; }
  if (!(erc[k] > 0)) throw new Error(`${k}: 크기 연구에 비중이 없습니다.`);
  // 지금 단계(1차 = 끝까지 살 비중의 60%)의 비중을 위험 기여 균등 값으로, 끝까지 살 비중은 같은 비율로 키우되 종목 한도까지만.
  // 이유의 마지막 줄(크기)은 균등 계획의 문구라 바꿔 쓴다. 같은 묶음 문구는 남긴다.
  const pct = r2(erc[k]), target = r2(Math.min(cap, erc[k] / FIRST)), why = [...(v.why || [])], last = why.at(-1) || '', cl = last.match(/ · 같은 묶음\([^)]*\)에서 하나/)?.[0] || '';
  if (/^크기: /.test(last)) why[why.length - 1] = `크기: 위험 기여 균등 — 지금 ${pct}%, 끝까지 ${target}%(종목 ≤${cap}%)${cl}`;
  weights[k] = { ...v, pct, targetPct: target, sizing: 'erc', why }; before += v.pct; after += pct;
}
if (Math.abs(before - after) > 0.05) throw new Error(`개별 종목 합계가 달라졌습니다: ${before} → ${after}`);
const day = new Date().toISOString().slice(0, 10);
// 바탕이 구조 질문 계획(PP4)이면 이름·설명에 종목 선정 변화도 적는다(결정 37). 엔진은 지금 채택된 계획과 비교해 바뀌는 비중·금액을 보인다.
const sel = plan.structure ? plan.screening || {} : null, nameOf = k => plan.weights[k]?.name || k;
const selNote = sel ? `종목: 구조 질문(수요·중국)과 같은 묶음 하나 규칙으로 고름(${plan.structure.file} · ${plan.structure.asOf})${(sel.structureWait || []).length ? ` · 구조로 빠짐 ${sel.structureWait.map(nameOf).join('·')}` : ''}${(sel.cluster || []).length ? ` · 같은 묶음에서 빠짐 ${sel.cluster.map(x => `${nameOf(x.key)}(${({ memory: '메모리', 'ai-compute': 'AI 가속기', cloud: '클라우드' })[x.cluster] || x.cluster})`).join('·')}` : ''}. ` : '';
const out = { ...plan, version: `${sel ? 'PP4c' : 'PP3c'}-${day}-erc`, label: sel ? '구조 질문 + 위험 기여 균등(후보)' : '위험 기여 균등(후보)', generatedAt: new Date().toISOString(), basedOn: plan.version, basedOnFile: PLAN_FILE, studyFile: STUDY_FILE,
  note: `${selNote}크기: 개별 ${Object.keys(erc).length}종목 합계 ${r2(after)}%는 그대로 두고, 지수와 다르게 움직이는 위험을 종목마다 같게 나눴습니다(최근 3년 주간 수익률 · ${STUDY_FILE}). 수익 예측은 쓰지 않았습니다.`, weights };
writeFileSync(join(root, 'data/paper-plan.next.json'), JSON.stringify(out, null, 1));
console.log(out.version, Object.entries(weights).filter(([, v]) => v.role === 'satellite').map(([k, v]) => `${k} ${plan.weights[k].pct}→${v.pct}(끝 ${v.targetPct})`).join(' · '));
