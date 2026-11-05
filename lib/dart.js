// OpenDART: 최근 공시 목록과 주요 재무 계정(매출·영업이익·순이익). 공개 기업 자료만 다루며 개인 정보는 없다.
import { readFile } from 'node:fs/promises';

export class DartError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

let catalog;
async function corpCodeOf(code) {
  catalog ||= JSON.parse(await readFile(new URL('../data/stocks.json', import.meta.url), 'utf8'));
  const row = catalog.find(x => x.code === code);
  if (!row) throw new DartError('DART 기업 목록에 없는 종목입니다. ETF·해외 종목은 공시·실적을 제공하지 않습니다.', 404);
  return row.corpCode;
}

const ymd = d => d.toISOString().slice(0, 10).replaceAll('-', '');
const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); if (!/^-?\d+(\.\d+)?$/.test(s)) return null; return Number(s); };

// 공시 제목으로 투자 판단에 의미 있는 유형을 분류한다.
const DISCLOSURE_RULES = [
  [/영업\(잠정\)실적|잠정실적|매출액또는손익구조/, 'earnings', '실적 발표'],
  [/단일판매|공급계약/, 'contract', '공급 계약'],
  [/유상증자/, 'dilution', '유상증자'],
  [/전환사채|신주인수권부사채|교환사채/, 'dilution', '주식 연계 채권'],
  [/자기주식.*취득|자기주식취득/, 'buyback', '자사주 매입'],
  [/자기주식.*처분/, 'treasury-sale', '자사주 처분'],
  [/현금ㆍ현물배당|현금·현물배당|배당/, 'dividend', '배당'],
  [/최대주주.*변경|경영권/, 'control', '최대주주 변경'],
  [/소송|횡령|배임|불성실공시/, 'risk', '소송·위험'],
  [/합병|분할|영업양수|영업양도|타법인주식/, 'restructure', '합병·분할·지분 거래'],
  [/시설투자|신규시설/, 'capex', '시설 투자'],
  [/분기보고서|반기보고서|사업보고서/, 'report', '정기 보고서']
];
export function classifyDisclosure(title = '') {
  for (const [re, kind, label] of DISCLOSURE_RULES) if (re.test(title)) return { kind, label };
  return { kind: 'other', label: '기타 공시' };
}

async function call(path, params, { fetchImpl, env }) {
  if (!env.DART_API_KEY) throw new DartError('DART 서버 설정이 없어 공시·실적을 조회하지 못했습니다.', 503);
  const url = new URL(`https://opendart.fss.or.kr/api/${path}`);
  url.search = new URLSearchParams({ crtfc_key: env.DART_API_KEY, ...params }).toString();
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) }); } catch { throw new DartError('DART 서버에 연결하지 못했습니다.'); }
  if (!response.ok) throw new DartError('DART 응답을 받지 못했습니다.');
  const data = await response.json();
  if (data.status === '013') return { list: [] }; // 조회 결과 없음
  if (data.status !== '000') throw new DartError(data.status === '020' ? 'DART 조회 한도를 초과했습니다.' : 'DART 조회에 실패했습니다.');
  return data;
}

export async function fetchDisclosures(code, { days = 60, now = new Date(), fetchImpl = fetch, env = process.env } = {}) {
  const corp_code = await corpCodeOf(code);
  const from = new Date(now.getTime() - days * 86400000);
  const data = await call('list.json', { corp_code, bgn_de: ymd(from), end_de: ymd(now), page_count: '40', sort: 'date', sort_mth: 'desc' }, { fetchImpl, env });
  return (data.list || []).map(item => {
    const d = String(item.rcept_dt || '');
    return {
      date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
      title: String(item.report_nm || '').replace(/\s+/g, ' ').trim(),
      filer: String(item.flr_nm || ''),
      link: /^\d{14}$/.test(item.rcept_no) ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}` : null,
      ...classifyDisclosure(item.report_nm)
    };
  }).filter(x => x.date && x.title);
}

// 가장 최근에 제출된 정기 보고서의 주요 계정을 전년 같은 기간과 비교한다.
const REPORTS = [['11014', '3분기'], ['11012', '2분기'], ['11013', '1분기'], ['11011', '연간']];
export function candidatePeriods(now = new Date()) {
  const y = now.getUTCFullYear(), out = [];
  for (const year of [y, y - 1]) for (const [reprt_code, label] of REPORTS) out.push({ year, reprt_code, label });
  return out;
}

export function pickAccounts(list = []) {
  const want = { revenue: /^(매출액|수익\(매출액\)|영업수익|매출)$/, operatingIncome: /^영업이익(\(손실\))?$/, netIncome: /^(당기순이익(\(손실\))?|분기순이익(\(손실\))?|반기순이익(\(손실\))?)$/ };
  const pick = fsDiv => {
    const rows = list.filter(r => r.fs_div === fsDiv && (!r.sj_div || ['IS', 'CIS'].includes(r.sj_div)));
    if (!rows.length) return null;
    const out = {};
    // thstrm_amount: 보고 대상 분기(3개월) 또는 연간. *_add_amount: 연초부터 누적.
    for (const [key, re] of Object.entries(want)) {
      const row = rows.find(r => re.test(String(r.account_nm || '').replace(/\s/g, '')));
      out[key] = row ? { current: num(row.thstrm_amount), previous: num(row.frmtrm_amount), cumulative: num(row.thstrm_add_amount), previousCumulative: num(row.frmtrm_add_amount), currentRange: row.thstrm_dt || null } : null;
    }
    return out;
  };
  const consolidated = pick('CFS');
  return consolidated && Object.values(consolidated).some(Boolean) ? { basis: '연결', accounts: consolidated } : { basis: '별도', accounts: pick('OFS') };
}

export async function fetchFinancials(code, { now = new Date(), fetchImpl = fetch, env = process.env } = {}) {
  const corp_code = await corpCodeOf(code);
  for (const period of candidatePeriods(now)) {
    if (period.year === now.getUTCFullYear() && period.reprt_code === '11011') continue; // 올해 사업보고서는 아직 없다
    const data = await call('fnlttSinglAcnt.json', { corp_code, bsns_year: String(period.year), reprt_code: period.reprt_code }, { fetchImpl, env });
    if (!data.list?.length) continue;
    const { basis, accounts } = pickAccounts(data.list);
    if (!accounts) continue;
    const growth = {};
    for (const [key, a] of Object.entries(accounts)) growth[key] = a && a.current != null && a.previous != null && a.previous !== 0 ? (a.current / a.previous - 1) * 100 : null;
    return { year: period.year, period: period.label, basis, accounts, growth, note: period.reprt_code === '11011' ? '연간 실적을 전년과 비교.' : '해당 분기(3개월) 실적을 전년 같은 분기와 비교.' };
  }
  return null;
}

const cache = new Map();
export async function fetchCompanyBrief(code, options = {}) {
  if (!/^\d{6}$/.test(String(code))) throw new DartError('국내 6자리 종목 코드만 지원합니다.', 400);
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  const [disclosures, financials] = await Promise.all([
    fetchDisclosures(code, options).catch(e => ({ error: e.message })),
    fetchFinancials(code, options).catch(e => ({ error: e.message }))
  ]);
  const value = { code, source: '금융감독원 OpenDART', fetchedAt: new Date().toISOString(), disclosures, financials };
  cache.set(code, { at: Date.now(), value });
  return value;
}
