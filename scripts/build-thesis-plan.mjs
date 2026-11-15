// 근거 카드와 계획 생성(결정 25 · 결정 37). 네트워크 없음 — data/company-history.json · data/growth-outlook.json · data/structure-cards.json 만 읽는다.
//   node scripts/build-thesis-plan.mjs            → data/thesis-cards.json 과 계획 파일을 쓴다(기본 계획 data/paper-plan.json 은 건드리지 않음)
//                                                    구조 답 파일이 있으면 PP4(구조 질문 + 같은 묶음 하나) → data/paper-plan.pp4.json, 없으면 PP3 → data/paper-plan.pp3.json
//   node scripts/build-thesis-plan.mjs --print    → 쓰지 않고 요약만
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCard, buildPlan, CARD_VERSION, CARD_RULES, PLAN_RULES } from '../lib/thesis-cards.js';
import { applyStructure, checkEntry, STRUCTURE_VERSION, STRUCTURE_RULES, LABELS as SQ } from '../lib/structure-cards.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), J = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const hist = J('company-history.json'), outlook = J('growth-outlook.json'), pp1 = J('paper-plan.json');
const asOf = Object.values(outlook.companies)[0].asOf, today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const S = existsSync(join(root, 'data', 'structure-cards.json')) ? J('structure-cards.json') : null;
if (S) { const errs = Object.entries(S.companies).flatMap(([k, e]) => checkEntry(k, e)); if (errs.length) { console.error('구조 답 형식 오류:\n  ' + errs.join('\n  ')); process.exit(1); } }
// 카드 대상: 연구 종목군 98개 + 지금 계획에 있는 개별 종목(자료가 없으면 nodata 카드가 된다 — 왜 빠지는지 남기려고).
const extra = Object.entries(pp1.weights).filter(([k, w]) => !['index', 'bond'].includes(w.sector) && !hist.companies[k]).map(([k, w]) => ({ key: k, name: w.name }));
let cards = [...Object.keys(hist.companies).map(k => buildCard(k, hist.companies[k], outlook.companies[k], { asOf })), ...extra.map(e => ({ ...buildCard(e.key, null, null, { asOf }), name: e.name }))];
// 구조 질문(결정 37): 통과 카드는 구조 답이 없거나·수요 역풍·중국 경쟁 높음·깨짐 조건 충족·답이 오래됐으면 대기로 내린다. 다른 판정은 정보만 붙인다.
if (S) cards = cards.map(c => (S.companies[c.key] || ['pass', 'wait'].includes(c.verdict)) ? applyStructure(c, S.companies[c.key], { today }) : c);
const plan = buildPlan(cards), PV = S ? 'PP4' : 'PP3';
// 전환: 지금 모의계좌가 들고 있는데 새 계획에 없는 종목은 pct 0 · exit 로 적어 엔진이 정리하게 한다(이유 = 그 종목의 카드).
let held = []; try { held = J('paper-live-public.json').balance.positions; } catch { }
const exitWhy = (c, sym) => { const cl = plan.rejected.cluster.find(x => x.key === sym); if (cl) return `전환: 카드는 통과했지만 같은 묶음(${SQ.cluster?.[cl.cluster] || cl.cluster})에서 ${cards.find(x => x.key === cl.by)?.name || cl.by}가 앞섬 → 정리`;
  if (plan.rejected.structure.includes(sym)) return `전환: 구조 질문에서 대기 → 정리 (${c.structure.reasons.join(' · ')})`;
  if (plan.rejected.sectorCap.includes(sym)) return '전환: 카드는 통과했지만 같은 섹터 상한(15%)에서 순위가 밀림 → 정리';
  return '전환: 근거 카드 미통과 → 정리해 지수·현금으로'; };
for (const p of held) { if (plan.weights[p.symbol]) continue; const c = cards.find(x => x.key === p.symbol);
  plan.weights[p.symbol] = { pct: 0, exit: true, name: p.name, currency: p.currency, country: p.market, sector: c?.sector || 'unknown', role: 'exit', why: [...(c ? c.why : ['근거 카드 대상이 아님(재무·성장 자료 없음)']), exitWhy(c, p.symbol)] }; }
const count = v => cards.filter(c => c.verdict === v).length;
const structureRows = S ? [['구조: 수요', '10년 뒤 주력 제품 수요가 인구·구조 변화로 느는가, 돈은 누가 내고 값은 누가 정하는가 — 역풍이면 담지 않음'], ['구조: 중국', '같은 것을 만드는 중국 기업과 점유율 방향, 중국 매출 비중, 방어선(기술·인허가 대 정책) — 높음이면 담지 않음'],
  ['구조: 깨짐', `종목마다 숫자로 적은 깨짐 조건(예: CXMT D램 점유율 15% 이상) — 하나라도 충족이면 담지 않음 · 답은 ${STRUCTURE_RULES.reviewDays}일마다 다시 확인`], ['같은 묶음', '깨짐 조건이 같은 종목(예: 메모리 = 삼성전자·SK하이닉스·마이크론)은 점수가 가장 높은 하나만']] : [];
const doc = { version: `${PV}-${today}`, generatedAt: new Date().toISOString(), asOf, cardVersion: CARD_VERSION, rulesVersion: pp1.rulesVersion,
  ...(S ? { structure: { version: S.version || STRUCTURE_VERSION, asOf: S.asOf, file: 'data/structure-cards.json', reviewDays: STRUCTURE_RULES.reviewDays } } : {}),
  caps: { single: PLAN_RULES.maxSingle, sector: PLAN_RULES.maxSector, satellite: PLAN_RULES.satellitePct, cashMin: PLAN_RULES.cashPct },
  method: [`핵심 지수 ${PLAN_RULES.corePct.US + PLAN_RULES.corePct.KR}%(미국 ${PLAN_RULES.corePct.US} · 국내 ${PLAN_RULES.corePct.KR}) + 위성 ${PLAN_RULES.satellitePct}%(개별 종목) + 현금 ${PLAN_RULES.cashPct}%`,
    `위성은 근거 카드 통과 종목만: 최근 4개 분기 성장 ${CARD_RULES.minGrowth * 100}% 이상 · 성장 예측 상위 ${Math.round((1 - CARD_RULES.minRank) * 100)}% · 가격이 자기 과거 5년의 ${CARD_RULES.maxValuePct * 100}번째 백분위 이하 · 깨짐 조건 없음`,
    ...(S ? ['구조 질문(수요·중국) 통과: 수요 역풍·중국 경쟁 높음·구조 깨짐 조건 충족이면 담지 않는다. 깨짐 조건이 같은 묶음은 하나만. 답은 출처·날짜가 붙은 사람 판단이라 과거로 검증하지 못한다'] : []),
    `크기는 균등(종목 ≤${PLAN_RULES.maxSingle}% · 섹터 ≤${PLAN_RULES.maxSector}%). 변동성은 종목을 고르는 근거가 아니다`,
    `나눠 사기 ${PLAN_RULES.tranches.map(t => t * 100).join('/')}%: 지금은 1단계만. 다음 실적이 성장을 확인하면 2단계, 가격이 자기 과거 중간값 이하이거나 첫 매수보다 15% 싸지면(근거 유지) 3단계. 남은 몫은 매수 대기 현금`,
    '현대차 그룹(현대차·기아·현대모비스) 제외: 소득이 이미 묶여 있음',
    '한계: 자체 연구 G2 에서 성장·가치는 표본 외 주가 초과수익을 맞히지 못했다. 카드는 보유 설명·매도 기준이고, 위성 묶음 성과는 지수와 따로 비교해 30·90일 뒤 판단한다'],
  criteria: [
    ['성장', `최근 4개 분기 매출(금융은 영업이익)이 전년보다 ${CARD_RULES.minGrowth * 100}% 이상`], ['성장 예측', `같은 시장 49개 중 상위 ${Math.round((1 - CARD_RULES.minRank) * 100)}% 안`], ['질', `영업이익이 줄지 않음 · ROE ${CARD_RULES.minRoe * 100}% 이상`],
    ['가치', `PER(적자면 PSR)이 자기 과거 5년의 ${CARD_RULES.maxValuePct * 100}번째 백분위 이하 · 순이익이 영업이익의 ${CARD_RULES.oneOffRatio}배를 넘으면 보류`], ['깨짐', `2개 분기 연속 역성장 · 영업이익률 1년 새 ${CARD_RULES.marginDropPp}%p 넘게 하락 · 순손실`],
    ['자료 이상', '최근 8개 분기에 영업이익 > 매출이거나 매출이 앞뒤 분기의 절반 미만(분할·재작성 의심)이면 판정 보류'], ...structureRows,
    ['배분', `지수 ${PLAN_RULES.corePct.US + PLAN_RULES.corePct.KR}%(미국 ${PLAN_RULES.corePct.US} · 국내 ${PLAN_RULES.corePct.KR}) · 위성 ${PLAN_RULES.satellitePct}% · 현금 ${PLAN_RULES.cashPct}%`], ['위성 크기', `${PLAN_RULES.minNames}~${PLAN_RULES.maxNames}종목 균등 · 종목 ≤${PLAN_RULES.maxSingle}% · 섹터 ≤${PLAN_RULES.maxSector}%`],
    ['나눠 사기', `목표의 ${PLAN_RULES.tranches.map(t => t * 100).join(' → +')}% · 올리는 조건: 첫 매수가보다 15% 하락 / 새 실적 카드 통과 / 가격이 자기 과거 중간값 이하`], ['사지 않음', '이슈(주의·긴급)가 걸린 종목 · 근거 카드 탈락 · 포트폴리오가 지수보다 5%p 넘게 뒤처짐 · 현대차 그룹'],
    ['이슈 대응', '공시 긴급 = 계획 비중 절반(30일) · 공시·뉴스·급락 주의 = 추가 매수 정지(14일) · 뉴스·가격으로는 팔지 않음']],
  backtest: (() => { try { const b = J('thesis-backtest.json'); return { version: b.version, from: b.from, to: b.to, note: b.note, periods: b.periods }; } catch { return null; } })(),
  weights: Object.fromEntries(Object.entries(plan.weights).map(([k, w]) => [k, { ...w, sectorName: w.sector === 'index' ? '지수 ETF' : w.sector }])), cashPct: plan.cashPct, reservePct: plan.reservePct, waitingPct: plan.waitingPct, satelliteTargetPct: plan.satelliteTargetPct,
  screening: { cards: cards.length, pass: count('pass'), wait: count('wait'), fail: count('fail'), nodata: count('nodata'), picked: plan.picked, waitList: plan.rejected.wait, sectorCap: plan.rejected.sectorCap, nodataList: plan.rejected.nodata, cluster: plan.rejected.cluster, structureWait: plan.rejected.structure, dataIssue: cards.filter(c => c.dataIssue).map(c => c.key) },
  sources: ['data/company-history.json (OpenDART · SEC 공개 재무, 공개일 기준)', `data/growth-outlook.json (${outlook.version})`, ...(S ? [`data/structure-cards.json (${S.version}, ${S.asOf} · 출처·날짜는 종목마다)`] : []), `docs/DECISIONS.md (25${S ? ', 37' : ''})`] };
const line = c => `${c.key} ${c.name || ''} [${c.verdictBase && c.verdictBase !== c.verdict ? `${c.verdictBase}→` : ''}${c.verdict}] ${c.why.slice(0, 3).join(' | ')}`;
console.log(`카드 ${cards.length}장 · 통과 ${count('pass')} · 대기 ${count('wait')} · 탈락 ${count('fail')} · 자료 없음 ${count('nodata')}${S ? ` · 구조로 대기 ${plan.rejected.structure.join(',') || '없음'} · 같은 묶음 ${plan.rejected.cluster.map(x => `${x.key}(${x.cluster}←${x.by})`).join(',') || '없음'}` : ''}`);
console.log('위성:'); for (const k of plan.picked) console.log('  ' + line(cards.find(c => c.key === k)).slice(0, 330));
console.log(`비중: ${Object.entries(plan.weights).map(([k, w]) => `${w.name} ${w.pct}`).join(' · ')} · 현금 ${plan.cashPct}(예비 ${plan.reservePct} + 매수 대기 ${plan.waitingPct})`);
console.log('지금 계획 종목 판정:'); for (const [k] of Object.entries(pp1.weights)) { const c = cards.find(x => x.key === k); if (c) console.log('  ' + line(c).slice(0, 300)); }
if (!process.argv.includes('--print')) { writeFileSync(join(root, 'data', 'thesis-cards.json'), JSON.stringify({ version: CARD_VERSION, asOf, generatedAt: doc.generatedAt, rules: CARD_RULES, ...(S ? { structureVersion: S.version, structureAsOf: S.asOf } : {}), cards }, null, 1));
  writeFileSync(join(root, 'data', `paper-plan.${PV.toLowerCase()}.json`), JSON.stringify(doc, null, 1)); console.log(`저장: data/thesis-cards.json · data/paper-plan.${PV.toLowerCase()}.json`); }
