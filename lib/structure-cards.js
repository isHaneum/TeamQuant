// 구조 질문(결정 37 · 2026-11-15): 근거 카드의 여섯째·일곱째 질문. 순수 함수 · 네트워크 없음.
//   ⑥ 수요·돈 내는 곳: 10년 뒤 이 회사 주력 제품의 수요는 인구·구조 변화로 늘어나는가, 그 돈은 누가 내고 값은 누가 정하는가.
//   ⑦ 중국 경쟁: 같은 것을 만드는 중국 기업이 있는가, 점유율은 어느 쪽으로 가는가, 중국 매출 비중과 방어선(기술·인허가 대 정책)은 무엇인가.
// 왜: 사용자의 투자 방향(인구구조 변화 · 중국의 부상, 2026-11-15)을 종목 선정에 넣는다. 조사(docs/research-2026-11-15-demographics-china.md)에서
//     주제를 통째로 사는 상품은 지수를 이기지 못했으므로, 주제가 아니라 "그 회사의 돈이 어디서 오고 누가 위협하는가"를 종목마다 묻는다.
// 정직한 한계: 답은 2026-11-15 의 사람 판단(출처·날짜 포함)이라 과거로 검증할 수 없다(그때는 몰랐던 사실로 고르게 된다). 수익 예측이 아니라 "담지 않을 이유"와 "깨지는 조건"이다.
// 입력 형식은 data/structure-cards.json(companies[key] = { name, cluster, asOf, demand, china, breaks, unverified }).
export const STRUCTURE_VERSION = 'SQ1-2026-11-15';
export const STRUCTURE_RULES = { reviewDays: 100, exclude: { demand: ['head'], china: ['high'] }, minFacts: 2 };
export const LABELS = {
  demand: { tail: '순풍', neutral: '중립', head: '역풍' },
  china: { low: '낮음', mid: '중간', high: '높음' },
  payer: { public: '국가·공적 보험', insurer: '민간 보험·PBM', corporate: '기업 투자·IT 예산', consumer: '개인', defense: '국방 예산', mixed: '여럿' },
  pricing: { company: '회사가 정함', market: '시장이 정함', regulated: '국가가 정함' },
  defense: { tech: '기술', brand: '브랜드', network: '설치 기반·판매망', regulation: '인허가', procurement: '안보 조달', policy: '정책(수출 통제·관세)' },
  now: { clear: '아님', met: '충족', unknown: '확인 전' },
  // 묶음(cluster): 깨짐 조건이 같은 종목끼리. 계획에는 묶음마다 하나만 담는다(lib/thesis-cards.js oneCluster).
  cluster: { memory: '메모리', 'ai-compute': 'AI 가속기', cloud: '클라우드', 'cloud-software': '클라우드·소프트웨어', 'consumer-hardware': '소비자 기기', 'e-commerce': '전자상거래', payments: '결제망', 'glp1-metabolic': '비만·대사 신약', biosimilar: '바이오시밀러', cdmo: '바이오 위탁생산', 'pharma-big': '대형 제약', 'kr-pharma': '국내 제약', 'defense-aero': '방산 항공', 'civil-aero': '민항 엔진', shipbuilding: '조선', 'construction-machinery': '건설기계', holding: '지주회사', components: '전자부품', networking: '네트워크 장비', 'streaming-tv': 'TV 스트리밍', beverages: '음료' },
};
const DAY = 864e5;
const isDate = s => typeof s === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s);
const isUrl = s => typeof s === 'string' && /^https?:\/\/[^\s]+$/.test(s);

/** 한 회사의 구조 답이 형식을 지키는지(테스트·생성 스크립트가 쓴다). 반환: 문제 목록(빈 배열이면 통과). */
export function checkEntry(key, e) {
  const err = [], at = m => err.push(`${key}: ${m}`);
  if (!e || typeof e !== 'object') return [`${key}: 항목 없음`];
  if (!e.name) at('name 없음');
  if (!e.cluster || !/^[a-z0-9-]+$/.test(e.cluster)) at('cluster 형식');
  if (!isDate(e.asOf)) at('asOf 형식');
  for (const q of ['demand', 'china']) {
    const a = e[q]; if (!a) { at(`${q} 없음`); continue; }
    if (!LABELS[q][a.grade]) at(`${q}.grade "${a.grade}"`);
    if (!a.text || a.text.length < 20) at(`${q}.text 짧음`);
    const facts = (a.facts || []).filter(f => f && f.text && isUrl(f.url) && isDate(f.date));
    if (facts.length < STRUCTURE_RULES.minFacts) at(`${q}: 출처·날짜가 있는 사실 ${facts.length}개(최소 ${STRUCTURE_RULES.minFacts})`);
    if ((a.facts || []).some(f => !isUrl(f?.url) || !isDate(f?.date))) at(`${q}: 출처나 날짜가 빠진 사실`);
  }
  if (e.demand && !LABELS.payer[e.demand.payer]) at(`demand.payer "${e.demand?.payer}"`);
  if (e.demand && !LABELS.pricing[e.demand.pricing]) at(`demand.pricing "${e.demand?.pricing}"`);
  if (e.china && (!Array.isArray(e.china.defense) || !e.china.defense.length || e.china.defense.some(d => !LABELS.defense[d]))) at('china.defense');
  if (e.china && e.china.chinaRevenuePct != null && !(e.china.chinaRevenuePct >= 0 && e.china.chinaRevenuePct <= 100)) at('china.chinaRevenuePct 범위');
  if (!Array.isArray(e.breaks) || !e.breaks.length) at('깨짐 조건 없음');
  for (const b of e.breaks || []) { if (!b.text || !b.metric || !b.threshold || !b.source || !['분기', '월', '수시'].includes(b.every) || !LABELS.now[b.now]) at(`깨짐 조건 형식(${b.id || b.text || '?'})`); }
  return err;
}

/**
 * 구조 판정. today = 'YYYY-MM-DD'. 반환:
 * { ok, reasons[], stale, ageDays, grades:{demand, china}, cluster, breaksMet[], why[2], breaks[] }
 * ok=false 이유: 수요 역풍 · 중국 경쟁 높음 · 깨짐 조건 충족 · 답이 오래됨(reviewDays 초과). 답이 없으면(entry 없음) ok=false · missing=true.
 */
export function judgeStructure(entry, { today, rules = STRUCTURE_RULES } = {}) {
  if (!entry) return { ok: false, missing: true, reasons: ['구조 질문(수요·중국)에 답이 없음'], why: [], breaks: [], breaksMet: [], cluster: null, grades: null, stale: false, ageDays: null };
  const ageDays = today && entry.asOf ? Math.floor((Date.parse(today) - Date.parse(entry.asOf)) / DAY) : null;
  const stale = ageDays != null && ageDays > rules.reviewDays;
  const d = entry.demand, c = entry.china, L = LABELS, reasons = [];
  if (rules.exclude.demand.includes(d.grade)) reasons.push(`수요 ${L.demand[d.grade]}: ${d.driver || ''}`.trim());
  if (rules.exclude.china.includes(c.grade)) reasons.push(`중국 경쟁 ${L.china[c.grade]}`);
  const breaksMet = (entry.breaks || []).filter(b => b.now === 'met');
  for (const b of breaksMet) reasons.push(`깨짐 조건 충족: ${b.text}${b.evidence ? ` (${b.evidence})` : ''}`);
  if (stale) reasons.push(`구조 답이 ${ageDays}일 지남(기준 ${rules.reviewDays}일) — 다시 확인 전`);
  const comp = (c.competitors || []).slice(0, 2).join(' · ');
  const why = [
    `수요: ${L.demand[d.grade]} — ${d.driver || ''} · 돈 내는 곳 ${L.payer[d.payer] || '—'} · 값은 ${L.pricing[d.pricing] || '—'}`,
    `중국: ${L.china[c.grade]} — ${comp ? `경쟁 ${comp}` : '뚜렷한 중국 경쟁자 없음'} · 중국 매출 ${c.chinaRevenuePct == null ? '미확인' : `${c.chinaRevenuePct}%`} · 방어선 ${(c.defense || []).map(x => L.defense[x] || x).join('·')}`,
  ];
  return { ok: reasons.length === 0, missing: false, reasons, stale, ageDays, grades: { demand: d.grade, china: c.grade }, cluster: entry.cluster || null, breaksMet: breaksMet.map(b => b.id || b.text), why,
    breaks: (entry.breaks || []).map(b => ({ id: b.id || null, text: b.text, now: b.now, evidence: b.evidence || null, every: b.every })) };
}

/**
 * 근거 카드에 구조 판정을 붙인다. 정량 판정을 올리지는 않는다: pass 만 wait 로 내릴 수 있고(구조 이유), wait·fail·nodata 는 그대로 두고 정보만 붙인다.
 * 반환 카드: structure = { version, asOf, cluster, grades, ok, reasons, stale, breaks }, why 에 두 줄, breaks 에 구조 깨짐 조건, verdictBase = 원래 판정.
 */
export function applyStructure(card, entry, { today, rules = STRUCTURE_RULES } = {}) {
  const j = judgeStructure(entry, { today, rules });
  const out = { ...card, verdictBase: card.verdict, why: [...(card.why || [])], breaks: [...(card.breaks || [])] };
  out.structure = { version: STRUCTURE_VERSION, asOf: entry?.asOf || null, cluster: j.cluster, grades: j.grades, ok: j.ok, missing: j.missing, reasons: j.reasons, stale: j.stale, breaks: j.breaks };
  if (!j.missing) { out.why.push(...j.why); out.breaks.push(...(entry.breaks || []).map(b => `구조: ${b.text}`)); }
  if (card.verdict === 'pass' && !j.ok) { out.verdict = 'wait'; out.why.push(`구조 → 대기: ${j.reasons.join(' · ')}`); }
  return out;
}

/** 공개용 요약(화면이 읽는다): 라벨을 같이 실어 화면이 이 모듈을 불러오지 않게 한다. */
export function publicStructure(doc) {
  return { version: doc.version, asOf: doc.asOf, rules: STRUCTURE_RULES, labels: LABELS, questions: doc.questions, companies: doc.companies };
}
