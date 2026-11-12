// 종목 근거 카드(순수 함수 · 2026-11-12 결정 25). "왜 들고 있는가"를 성장·가치로 답하고, 깨지는 조건을 숫자로 미리 적는다. 변동성은 여기 없다 — 얼마나 담을지(계획)에서만 쓴다.
// 왜: PP1 은 섹터 대표 회사를 변동성 역수로 담아 종목별 이유가 "변동성 연 70%" 한 줄뿐이었다(사용자 지적 2026-11-12). 카드가 없는 종목은 위성에 담지 않는다.
// 정직한 한계: 자체 연구 G2(98개 기업)에서 성장 예측은 매출 성장은 맞혔지만(IC 0.41) 주가 초과수익은 맞히지 못했다(검증 구간 IC −0.03). 카드는 수익 예측이 아니라 보유 설명과 매도 기준이다.
// 입력: data/company-history.json 의 회사(quarters = [분기말, 공개일, 매출, 영업이익, 순이익, 자본] 단일 분기 값 · months = [월말, 주가, 지수] · shares = 현재 주식 수)와 data/growth-outlook.json 의 회사(growthRank 0~1).
export const CARD_VERSION = 'TC1-2026-11-12';
export const CARD_RULES = { minGrowth: 0.05, minRank: 0.6, maxValuePct: 0.7, minRoe: 0.08, oneOffRatio: 2, marginDropPp: 5, historyMonths: 60, minHistory: 24 };
const DAY = 864e5, r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000, pc = x => `${x >= 0 ? '+' : ''}${r1(x * 100)}%`;
const COL = { rev: 2, oi: 3, ni: 4, eq: 5 };

/** 공개일이 asOf 이하인 분기만(그때 알 수 있던 것). */
const known = (quarters, asOf) => (quarters || []).filter(q => q[1] <= asOf).sort((a, b) => (a[0] < b[0] ? -1 : 1));
/** 1년 전 같은 분기(분기말 ±25일). */
const yearAgo = (qs, q) => qs.find(x => Math.abs(Date.parse(q[0]) - 365 * DAY - Date.parse(x[0])) <= 25 * DAY) || null;
/** 마지막 4개 분기 합(TTM)과 1년 전 같은 4개 분기 합. 한 칸이라도 없으면 null. */
function ttm(qs, col) {
  const last = qs.slice(-4); if (last.length < 4 || (Date.parse(last[3][0]) - Date.parse(last[0][0])) > 300 * DAY) return null;
  if (last.some(q => q[col] == null)) return null;
  const prev = last.map(q => yearAgo(qs, q)); const now = last.reduce((a, q) => a + q[col], 0);
  return { now, prev: prev.every(p => p && p[col] != null) ? prev.reduce((a, p) => a + p[col], 0) : null };
}
const growthOf = t => t && t.prev > 0 ? t.now / t.prev - 1 : null;

/** 그 회사의 과거 대비 가격 위치: PER(이익이 양수일 때) 또는 PSR 의 최근 60개월 분포에서 지금 값의 백분위(0 = 가장 쌈, 1 = 가장 비쌈). 주식 수는 현재 값으로 근사(자료 한계). */
export function valuation(company, asOf) {
  const months = (company.months || []).filter(m => m[0] <= asOf && m[1] > 0).slice(-(CARD_RULES.historyMonths + 1)); if (!months.length || !(company.shares > 0)) return null;
  const at = (date, col) => { const t = ttm(known(company.quarters, date), col); return t && t.now > 0 ? t.now : null; };
  const lastNi = at(months.at(-1)[0], COL.ni), metric = lastNi ? 'PER' : 'PSR', col = lastNi ? COL.ni : COL.rev;
  const series = months.map(m => { const base = at(m[0], col); return base ? m[1] * company.shares / base : null; }).filter(v => v > 0);
  if (series.length < CARD_RULES.minHistory) return { metric, now: series.at(-1) ?? null, pct: null, median: null, n: series.length };
  const now = series.at(-1), hist = series.slice(0, -1), sorted = [...hist].sort((a, b) => a - b);
  return { metric, now: r1(now), pct: r3(hist.filter(v => v < now).length / hist.length), median: r1(sorted[Math.floor(sorted.length / 2)]), n: hist.length };
}

/**
 * 근거 카드 한 장. 다섯 질문: ① 성장 ② 가치 ③ 깨지는 조건 ④ 크기(계획이 정함 — 여기선 상한만) ⑤ 다음 점검.
 * verdict: pass(성장·가치 모두 충족 → 위성 후보) · wait(성장은 충족, 가격이 자기 과거 상위 30% → 사지 않고 대기) · fail(성장 근거 없음 → 담지 않음) · nodata(자료 없음 → 담지 않음).
 */
export function buildCard(key, company, outlook, { asOf } = {}) {
  if (!company) return { key, version: CARD_VERSION, asOf, verdict: 'nodata', why: ['재무·성장 자료가 없어 근거를 세울 수 없음 → 위성에 담지 않음(지수로 대신)'], growth: null, value: null, breaks: [], breakNow: [], review: null };
  const qs = known(company.quarters, asOf), financial = qs.slice(-4).some(q => q[COL.rev] == null), gcol = financial ? COL.oi : COL.rev, gname = financial ? '영업이익' : '매출';
  const tG = ttm(qs, gcol), g = growthOf(tG), tOi = ttm(qs, COL.oi), tNi = ttm(qs, COL.ni), tRev = ttm(qs, COL.rev), oiG = growthOf(tOi);
  const margin = tRev && tOi && tRev.now > 0 ? tOi.now / tRev.now : null, marginPrev = tRev && tOi && tRev.prev > 0 && tOi.prev != null ? tOi.prev / tRev.prev : null;
  const eq = qs.at(-1)?.[COL.eq], roe = tNi && eq > 0 ? tNi.now / eq : null;
  const yoy = qs.slice(-2).map(q => { const p = yearAgo(qs, q); return p && p[gcol] > 0 && q[gcol] != null ? q[gcol] / p[gcol] - 1 : null; });
  const rank = outlook?.growthRank ?? null, val = valuation(company, asOf), R = CARD_RULES;
  // ③ 깨지는 조건 — 숫자로 판정할 수 있는 것은 여기서 판정하고, 공시로만 알 수 있는 것은 긴급 대응이 감시한다.
  const breakNow = [];
  if (yoy.length === 2 && yoy.every(v => v != null && v < 0)) breakNow.push(`${gname} 2개 분기 연속 전년 대비 감소(${yoy.map(pc).join(', ')})`);
  if (margin != null && marginPrev != null && (marginPrev - margin) * 100 > R.marginDropPp) breakNow.push(`영업이익률 1년 새 ${r1((marginPrev - margin) * 100)}%p 하락`);
  if (tNi && tNi.now <= 0) breakNow.push('최근 4개 분기 순손실');
  const growthOk = g != null && g >= R.minGrowth && rank != null && rank >= R.minRank && !breakNow.length;
  // 질: 이익이 매출과 같이 늘고(영업이익 감소면 탈락) 자본을 잘 쓰는지(ROE). 순이익이 영업이익의 2배를 넘으면 일회성 이익(지분 매각 등)으로 PER 이 왜곡된 것이라 가치 판단을 보류한다.
  const qualityOk = (oiG == null || oiG >= 0) && roe != null && roe >= R.minRoe, oneOff = !financial && tNi && tOi && tOi.now > 0 && tNi.now > R.oneOffRatio * tOi.now;
  const valueOk = val?.pct != null && val.pct <= R.maxValuePct && !oneOff;
  const verdict = g == null || rank == null ? 'nodata' : !(growthOk && qualityOk) ? 'fail' : valueOk ? 'pass' : 'wait';
  const why = [];
  why.push(g == null ? `${gname} 성장을 계산할 분기 자료 부족` : `성장: 최근 4개 분기 ${gname} ${pc(g)}${oiG != null && !financial ? ` · 영업이익 ${pc(oiG)}` : ''}${margin != null ? ` · 영업이익률 ${r1(margin * 100)}%` : ''}${roe != null ? ` · ROE ${r1(roe * 100)}%` : ''} (기준 ${pc(R.minGrowth)} 이상)`);
  why.push(rank == null ? '성장 예측 모델 대상이 아님' : `성장 예측: 같은 시장 49개 중 상위 ${Math.max(1, Math.round((1 - rank) * 100))}% (기준 상위 ${Math.round((1 - R.minRank) * 100)}% 안) — 매출 성장은 맞히지만 주가 수익 예측은 아님`);
  why.push(!val || val.pct == null ? `가치: ${val?.metric || 'PER'} 과거 자료 부족으로 판단 보류` : `가치: ${val.metric} ${val.now}배 · 자기 과거 5년 중 ${Math.round(val.pct * 100)}번째 백분위(중간값 ${val.median}배) — ${valueOk ? '비싸지 않음' : '자기 과거 상위 30% 가격 → 대기'}`);
  if (growthOk && !qualityOk) why.push(`질: ${oiG != null && oiG < 0 ? `영업이익 ${pc(oiG)} 감소` : `ROE ${roe == null ? '—' : r1(roe * 100) + '%'} (기준 ${R.minRoe * 100}% 이상)`} → 탈락`);
  if (oneOff) why.push('순이익이 영업이익의 2배 초과 — 일회성 이익으로 PER 왜곡 → 대기');
  if (breakNow.length) why.push(`깨짐: ${breakNow.join(' · ')}`);
  const lastPub = qs.at(-1)?.[1] || null, review = lastPub ? new Date(Date.parse(lastPub) + 91 * DAY).toISOString().slice(0, 10) : null;
  return { key, version: CARD_VERSION, asOf, name: company.name, market: company.market, sector: company.sector, currency: company.currency, verdict, why,
    growth: { basis: gname, ttm: g == null ? null : r3(g), oi: oiG == null ? null : r3(oiG), margin: margin == null ? null : r3(margin), roe: roe == null ? null : r3(roe), rank, lastQuarter: qs.at(-1)?.[0] || null, flags: outlook?.flags || [] },
    value: val,
    breaks: [`${gname} 2개 분기 연속 전년 대비 감소`, `영업이익률 1년 새 ${R.marginDropPp}%p 넘게 하락`, '최근 4개 분기 순손실', '공시: 대규모 유상증자·횡령·배임·감사의견 거절·거래정지 · 주요 계약 해지 · 수출 규제로 인한 매출 영향'],
    breakNow, review };
}

export const PLAN_RULES = { satellitePct: 50, corePct: { US: 25, KR: 10 }, cashPct: 15, maxNames: 10, minNames: 8, maxSingle: 7, maxSector: 15, tranches: [0.6, 0.2, 0.2], exclude: ['005380', '000270', '012330'] };
/**
 * 계획 PP3(결정 25): 핵심 지수 35%(미국 25 · 국내 10) + 위성 50%(카드 pass 인 종목만, 성장 순위와 가격 여유의 평균 순, 종목 ≤7% · 섹터 ≤15%, 균등) + 현금 15%.
 * 나눠 사기: 위성은 목표의 60%만 먼저 산다(tranche 1). 나머지는 "매수 대기 현금"으로 두고, 다음 실적이 성장 근거를 확인하면 +20%, 가격이 자기 과거 중간값 이하이거나 첫 매수보다 15% 싸지면(근거 유지) +20%.
 * 위성이 모자라면(통과 종목 < 8) 남는 몫은 핵심 지수에 같은 비율로 얹는다 — 근거 없는 종목으로 채우지 않는다.
 * @param tranche {key: 1|2|3} 지금까지 채운 단계(없으면 1)
 */
export function buildPlan(cards, { tranche = {}, rules = PLAN_RULES } = {}) {
  const pass = cards.filter(c => c.verdict === 'pass' && !rules.exclude.includes(c.key)).map(c => ({ ...c, score: r3((c.growth.rank + (1 - c.value.pct)) / 2) })).sort((a, b) => b.score - a.score); // 순서 = 성장 예측 순위와 가격 여유(1 − 백분위)의 평균
  const each = Math.min(rules.maxSingle, rules.satellitePct / Math.max(rules.minNames, Math.min(rules.maxNames, pass.length))), perSector = Math.max(1, Math.floor(rules.maxSector / each + 1e-9));
  const picked = [], bySector = {};
  for (const c of pass) { if (picked.length >= rules.maxNames) break; if ((bySector[c.sector] || 0) >= perSector) continue; bySector[c.sector] = (bySector[c.sector] || 0) + 1; picked.push(c); }
  const target = r1(each), satTarget = r1(target * picked.length), spill = Math.max(0, rules.satellitePct - satTarget), coreSum = rules.corePct.US + rules.corePct.KR;
  const weights = {
    SPY: { pct: r1(rules.corePct.US + spill * rules.corePct.US / coreSum), name: 'S&P500 ETF', currency: 'USD', country: 'US', sector: 'index', role: 'core', why: ['핵심: 근거를 세울 수 없는 몫의 기본값 = 지수(미국)'] },
    '069500': { pct: r1(rules.corePct.KR + spill * rules.corePct.KR / coreSum), name: 'KODEX 200', currency: 'KRW', country: 'KR', sector: 'index', role: 'core', why: ['핵심: 지수(국내) — 생활비가 원화라 두되, 소득이 한국 자동차 산업에 묶여 있어 10%로 낮게'] },
  };
  for (const c of picked) { const step = Math.min(3, Math.max(1, tranche[c.key] || 1)), filled = rules.tranches.slice(0, step).reduce((a, b) => a + b, 0);
    weights[c.key] = { pct: r1(target * filled), targetPct: target, tranche: step, score: c.score, name: c.name, currency: c.currency, country: c.market, sector: c.sector, role: 'satellite', why: [...c.why, `크기: 목표 ${target}% 중 ${step}단계(${Math.round(filled * 100)}%)까지 매수 — 종목 ≤${rules.maxSingle}% · 섹터 ≤${rules.maxSector}%`], breaks: c.breaks, review: c.review }; }
  const invested = Object.values(weights).reduce((a, w) => a + w.pct, 0);
  return { weights, cashPct: r1(100 - invested), reservePct: rules.cashPct, waitingPct: r1(100 - invested - rules.cashPct), picked: picked.map(c => c.key), satelliteTargetPct: satTarget,
    rejected: { wait: cards.filter(c => c.verdict === 'wait').map(c => c.key), fail: cards.filter(c => c.verdict === 'fail').length, nodata: cards.filter(c => c.verdict === 'nodata').map(c => c.key), sectorCap: pass.filter(c => !picked.includes(c)).map(c => c.key) } };
}
