// 긴급 대응 감시(PC 서버 전용 · 2026-11-12 결정 26). 위성 종목의 공시를 10분마다 읽어 등급을 매기고, 엔진에 "추가 매수 정지"(주의) 또는 "절반 축소"(긴급)를 건다.
// 왜 공시인가: 뉴스 해석은 오탐이 많고 이미 가격에 반영된 뒤다. 공시 유형은 사실이고 근거 카드의 깨짐 조건(횡령·배임·감사의견·거래정지·계약 해지…)과 바로 대응된다. 뉴스·발언(예: 경영자 발언)은 v1 에서 다루지 않는다.
// 행동은 엔진이 제한한다(lib/paper-live.js setIssue): 위성 종목만 · 추가 매수 정지 또는 계획 비중 절반 · 핵심 지수는 건드리지 않음 · 주문은 평소의 주문 보호를 그대로 거친다. 이 파일은 주문을 만들지 않는다.
// 판정은 규칙(정규식·8-K 항목 번호)이다. AI 판정은 붙이지 않았다 — 같은 입력에 같은 결과가 나오고 비용이 없다. 한계: 제목만 보므로 규모(유상증자 금액 등)는 모른다 → 규모가 필요한 것은 '주의'로만 둔다.
export const ISSUE_WATCH_VERSION = 'IW1-2026-11-12';
const KR_URGENT = [[/횡령|배임/, '횡령·배임'], [/의견\s*거절|감사의견.*(한정|부적정)|감사보고서.*(거절|한정|부적정)/, '감사의견 문제'], [/상장폐지|관리종목|매매거래\s*정지|거래정지/, '거래정지·상장폐지 관련'], [/회생절차|파산|부도|영업정지/, '회생·부도·영업정지'], [/불성실공시법인\s*지정(?!\s*예고)/, '불성실공시법인 지정'], [/(단일판매|공급계약).*해지/, '주요 계약 해지']];
const KR_CAUTION = [[/유상증자/, '유상증자'], [/전환사채|신주인수권부사채|교환사채/, '주식 관련 사채 발행'], [/소송|가처분/, '소송'], [/불성실공시법인\s*지정\s*예고|조회공시/, '거래소 조회·예고'], [/영업\(?잠정\)?실적.*정정|정정.*(실적|매출)/, '실적 정정'], [/최대주주\s*변경|대표이사\s*변경/, '지배구조 변경'], [/감자/, '감자']];
// 미국 8-K 항목: 4.02 재무제표 신뢰 불가 · 1.03 파산 · 3.01 상장 유지 요건 미달 통지 → 긴급. 4.01 감사인 변경 · 5.02 임원 사임·해임 · 2.06 대규모 손상 · 1.02 주요 계약 종료 · 2.04 채무 조기상환 사유 → 주의.
const US_URGENT = { '4.02': '재무제표 신뢰 불가(8-K 4.02)', '1.03': '파산·관리(8-K 1.03)', '3.01': '상장 유지 요건 미달 통지(8-K 3.01)' };
const US_CAUTION = { '4.01': '감사인 변경(8-K 4.01)', '5.02': '임원 사임·선임(8-K 5.02)', '2.06': '대규모 손상(8-K 2.06)', '1.02': '주요 계약 종료(8-K 1.02)', '2.04': '채무 조기상환 사유(8-K 2.04)' };

/** 공시 한 건 → { level: 'urgent' | 'caution' | 'watch', reason }. market 'KR' 은 제목, 'US' 는 form·items. */
export function gradeDisclosure({ market, title = '', form = '', items = '' } = {}) {
  if (market === 'US') {
    if (!/^8-K/.test(form)) return { level: 'watch', reason: form || '공시' };
    const its = String(items).split(',').map(s => s.trim()).filter(Boolean), u = its.find(i => US_URGENT[i]), c = its.find(i => US_CAUTION[i]);
    return u ? { level: 'urgent', reason: US_URGENT[u] } : c ? { level: 'caution', reason: US_CAUTION[c] } : { level: 'watch', reason: `8-K ${its.join(', ')}` };
  }
  const t = String(title); // 기재정정은 원 공시와 같은 등급으로 본다(제목에 원 공시 이름이 들어 있다)
  for (const [re, reason] of KR_URGENT) if (re.test(t)) return { level: 'urgent', reason };
  for (const [re, reason] of KR_CAUTION) if (re.test(t)) return { level: 'caution', reason };
  return { level: 'watch', reason: '일반 공시' };
}

/** SEC 최근 제출 목록(8-K 만). User-Agent 는 SEC 요구 사항(연락처 형식) — 개인 이메일을 쓰지 않는다 · 연구 스크립트와 같은 이름(주소 형식은 SEC 가 403 으로 거부함 · 2026-11-12 확인). */
export async function fetchSecFilings(cik, { days = 5, now = new Date(), fetchImpl = fetch } = {}) {
  const url = `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'TeamQuant academic research prototype', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`SEC 응답 ${r.status}`);
  const f = (await r.json()).filings?.recent || {}, from = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10), out = [];
  for (let i = 0; i < (f.form || []).length; i++) { if (!/^8-K/.test(f.form[i]) || !(f.filingDate[i] >= from)) continue; const acc = String(f.accessionNumber[i] || '');
    out.push({ date: f.filingDate[i], form: f.form[i], items: f.items?.[i] || '', title: `${f.form[i]} ${f.items?.[i] || ''}`.trim(), link: acc ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${f.primaryDocument?.[i] || ''}` : null }); }
  return out;
}

/**
 * @param engine  { setIssue({symbol, level, reason, source, date, link}) → {applied, …} }  (paper-live)
 * @param symbols () → [{symbol, market:'KR'|'US', name}]  감시 대상(위성 종목)
 * @param fetchKR (code, {days, now}) → [{date,title,link}]   · fetchUS (symbol, {days, now}) → [{date,form,items,title,link}]
 * 조회 실패는 그 종목만 건너뛴다(다음 주기에 다시). 같은 공시는 엔진이 한 번만 받는다(열쇠 = 종목·날짜·제목).
 */
export function createIssueWatch({ engine, symbols, fetchKR, fetchUS, now = () => Date.now(), days = 3, gapMs = 400, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  async function scan() {
    const out = { checked: 0, failed: 0, events: [] }, at = new Date(now());
    for (const s of symbols() || []) {
      let list; try { list = s.market === 'US' ? await fetchUS(s.symbol, { days, now: at }) : await fetchKR(s.symbol, { days, now: at }); out.checked++; } catch { out.failed++; continue; }
      for (const d of list || []) { const g = gradeDisclosure({ market: s.market, ...d }); if (g.level === 'watch') continue;
        const r = engine.setIssue({ symbol: s.symbol, name: s.name, level: g.level, reason: `${g.reason}: ${String(d.title).slice(0, 80)}`, source: s.market === 'US' ? 'SEC' : 'DART', date: d.date, link: d.link || null });
        if (r?.applied) out.events.push({ symbol: s.symbol, level: g.level, reason: g.reason, date: d.date }); }
      if (gapMs) await sleep(gapMs);
    }
    return out;
  }
  return { scan };
}
