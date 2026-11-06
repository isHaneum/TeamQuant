// 복합 요인 연구용 자료 만들기(공개 자료만). 결과: .research/factor-data.json (저장소·배포 제외 폴더)
// - 한국: OpenDART 분기·반기·사업보고서 주요 계정(매출·영업이익·순이익·자본총계). 공개 시점 = 법정 제출 기한(분기·반기 +45일, 사업 +90일)으로 가정.
// - 미국: SEC EDGAR XBRL companyfacts. 같은 기간 값 중 가장 먼저 제출된 값과 그 제출일을 쓴다(그때 실제로 알 수 있던 값).
// - 시세: Yahoo 일봉(2010~), 지수·VIX·미 10년 금리·원/달러.
// - 주식 수: 지금 시가총액 ÷ 지금 주가(네이버). 분할 조정 주가와 곱해 과거 시가총액을 근사(자사주·증자 변화는 무시).
// DART 키는 앱 서버와 같은 방식(.env.local)으로 환경 변수에 올리고 출력하지 않는다.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { fetchFundamentals } from '../../lib/fundamentals.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const f of ['.env', '.env.local']) { try { process.loadEnvFile(join(root, f)); } catch {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'TeamQuant academic research prototype';

import { KR, US, KOSDAQ } from './universe.mjs';

async function yahoo(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1262304000&period2=9999999999&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 ' + UA }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => [new Date((t + tz) * 1000).toISOString().slice(0, 10), q.close[i]]).filter(([d, c]) => c > 0 && !seen.has(d) && seen.add(d));
    } catch (e) { if (k === 2) { console.warn('시세 실패', symbol, e.message); return null; } await sleep(1500); }
  }
}

// ── 한국: OpenDART ───────────────────────────────────────────
const catalog = JSON.parse(await readFile(join(root, 'data/stocks.json'), 'utf8'));
const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };
const REPORTS = [['11013', '03-31', 45, 'Q1'], ['11012', '06-30', 45, 'Q2'], ['11014', '09-30', 45, 'Q3'], ['11011', '12-31', 90, 'FY']];
const plusDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
async function dart(params) {
  const url = new URL('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json'); url.search = new URLSearchParams({ crtfc_key: process.env.DART_API_KEY, ...params }).toString();
  for (let k = 0; k < 3; k++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); const d = await r.json(); if (d.status === '013') return []; if (d.status !== '000') throw new Error('DART ' + d.status); return d.list || []; } catch (e) { if (k === 2) throw e; await sleep(1000); } }
}
function pickKr(list, annual) {
  const rows = list.filter(r => r.fs_div === 'CFS').length ? list.filter(r => r.fs_div === 'CFS') : list.filter(r => r.fs_div === 'OFS');
  const nm = r => String(r.account_nm || '').replace(/\s/g, '');
  const is = rows.filter(r => !r.sj_div || ['IS', 'CIS'].includes(r.sj_div)), bs = rows.filter(r => r.sj_div === 'BS');
  const find = (arr, re) => arr.find(r => re.test(nm(r)));
  const val = r => r ? num(r.thstrm_amount) : null;
  return { revenue: val(find(is, /^(매출액|수익\(매출액\)|영업수익|매출)$/)), operatingIncome: val(find(is, /^영업이익(\(손실\))?$/)), netIncome: val(find(is, /^(당기순이익(\(손실\))?|분기순이익(\(손실\))?|반기순이익(\(손실\))?)$/)), equity: val(find(bs, /^자본총계$/)) };
}
async function krFundamentals(code) {
  const corp = catalog.find(x => x.code === code)?.corpCode; if (!corp) return { error: 'corp_code 없음' };
  const quarters = [];
  for (let y = 2013; y <= 2026; y++) {
    const year = {};
    for (const [rc, mmdd, lag, q] of REPORTS) {
      const end = `${y}-${mmdd}`; if (Date.parse(plusDays(end, lag)) > Date.now()) continue;
      const list = await dart({ corp_code: corp, bsns_year: String(y), reprt_code: rc }); await sleep(120);
      if (list.length) year[q] = { end, available: plusDays(end, lag), ...pickKr(list, q === 'FY') };
    }
    for (const q of ['Q1', 'Q2', 'Q3']) if (year[q]) quarters.push({ period: `${y}${q}`, ...year[q] });
    if (year.FY) { // 4분기 3개월 = 연간 − (1~3분기)
      const parts = ['Q1', 'Q2', 'Q3'].map(q => year[q]);
      const q4 = k => year.FY[k] != null && parts.every(p => p?.[k] != null) ? year.FY[k] - parts.reduce((a, p) => a + p[k], 0) : null;
      quarters.push({ period: `${y}Q4`, end: year.FY.end, available: year.FY.available, revenue: q4('revenue'), operatingIncome: q4('operatingIncome'), netIncome: q4('netIncome'), equity: year.FY.equity });
    }
  }
  return { quarters };
}

// ── 미국: SEC EDGAR ──────────────────────────────────────────
const TAGS = { ocf: ['NetCashProvidedByUsedInOperatingActivities'], revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerIncludingAssessedTax'], operatingIncome: ['OperatingIncomeLoss'], netIncome: ['NetIncomeLoss', 'ProfitLoss'], equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] };
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
function secSeries(g, tags, instant) {
  // 기간(start~end)마다 가장 먼저 제출된 값. 여러 태그를 합칠 때 앞선 태그 우선.
  const byKey = new Map();
  for (const t of tags) for (const x of g[t]?.units?.USD || []) {
    if (instant ? x.start : !x.start) continue;
    const key = instant ? x.end : `${x.start}|${x.end}`, cur = byKey.get(key);
    if (!cur || (cur.tag === t && x.filed < cur.filed)) { if (!cur || cur.tag === t) byKey.set(key, { start: x.start, end: x.end, val: x.val, filed: x.filed, tag: t }); }
  }
  return [...byKey.values()];
}
async function usFundamentals(ticker, cik) {
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) return { error: 'SEC ' + r.status };
  const j = await r.json(), g = j.facts['us-gaap'] || {}, out = { entity: j.entityName };
  const quarterly = {};
  for (const [k, tags] of Object.entries(TAGS)) {
    if (k === 'equity') { out.equity = secSeries(g, tags, true).map(x => ({ end: x.end, val: x.val, available: x.filed })).sort((a, b) => a.end.localeCompare(b.end)); continue; }
    const all = secSeries(g, tags, false), q = all.filter(x => days(x.start, x.end) > 75 && days(x.start, x.end) < 105), y = all.filter(x => days(x.start, x.end) > 340 && days(x.start, x.end) < 380);
    const map = new Map(q.map(x => [x.end, { end: x.end, val: x.val, available: x.filed }]));
    for (const a of y) { // 4분기 = 연간 − 같은 회계연도 안 세 분기
      if (map.has(a.end)) continue;
      const inside = q.filter(x => x.start >= a.start && x.end < a.end).sort((p, s) => p.end.localeCompare(s.end));
      if (inside.length === 3) map.set(a.end, { end: a.end, val: a.val - inside.reduce((s, x) => s + x.val, 0), available: a.filed });
    }
    quarterly[k] = [...map.values()].sort((a, b) => a.end.localeCompare(b.end));
  }
  return { ...out, ...quarterly };
}

const parseCap = s => { if (!s) return null; const usd = /USD/.test(s); let v = 0; const jo = /([\d,.]+)조/.exec(s), eok = /([\d,.]+)억/.exec(s); if (jo) v += Number(jo[1].replace(/,/g, '')) * 1e12; if (eok) v += Number(eok[1].replace(/,/g, '')) * 1e8; return v ? { value: v, usd } : null; };

const out = { generatedAt: new Date().toISOString(), note: '공개 자료. 한국 공개 시점은 법정 기한 가정, 미국은 SEC 최초 제출일.', kr: {}, us: {}, macro: {} };
if (!process.env.DART_API_KEY) console.warn('DART 키가 없어 한국 재무를 건너뜁니다.');
for (const [code, name] of Object.entries(KR)) {
  const f = process.env.DART_API_KEY ? await krFundamentals(code).catch(e => ({ error: e.message })) : { error: 'no key' };
  const px = await yahoo(code + (KOSDAQ.has(code) ? '.KQ' : '.KS')); const fund = await fetchFundamentals(code).catch(() => null); const cap = parseCap(fund?.marketCap);
  out.kr[code] = { name, prices: px, sharesNow: cap && fund?.price ? cap.value / fund.price : null, ...f };
  console.log('KR', code, name, 'quarters', f.quarters?.length ?? f.error, 'prices', px?.length);
}
for (const [t, cik] of Object.entries(US)) {
  const f = await usFundamentals(t, cik).catch(e => ({ error: e.message })); await sleep(250);
  const px = await yahoo(t); const fund = await fetchFundamentals(t).catch(() => null); const cap = parseCap(fund?.marketCap);
  out.us[t] = { name: f.entity || t, prices: px, sharesNow: cap && fund?.price ? cap.value / fund.price : null, ...f };
  console.log('US', t, f.entity, 'rev q', f.revenue?.length, 'oi q', f.operatingIncome?.length, 'ni q', f.netIncome?.length, 'eq', f.equity?.length, 'prices', px?.length, f.error || '');
}
for (const s of ['^KS11', '^GSPC', '^VIX', '^TNX', 'KRW=X', 'CL=F']) out.macro[s] = await yahoo(s);
mkdirSync(join(root, '.research'), { recursive: true });
writeFileSync(join(root, '.research/factor-data.json'), JSON.stringify(out));
console.log('저장', join(root, '.research/factor-data.json'));
