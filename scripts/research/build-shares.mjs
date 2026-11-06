// 시점 기준 주식 수(그때 공개돼 있던 주식 수)와 액면분할 이력. 결과: .research/shares-pit.json
// 왜: 과거 시가총액을 '지금 주식 수 × 그때 주가'로 근사하면, 그 뒤의 증자·자사주 소각(미래 정보)이 과거 PSR에 섞인다.
// - 미국: SEC companyfacts의 표지 주식 수(dei:EntityCommonStockSharesOutstanding, 제출일 = 공개일).
//         없으면(다중 종류 주식 등) 희석 가중평균 주식 수, 그것도 없으면 순이익 ÷ 희석 EPS로 역산. 모두 같은 기간 최초 제출값.
// - 한국: OpenDART 주식총수현황(보통주 발행주식총수). 공개일 = 보고서 법정 기한(분기·반기 +45일, 사업 +90일).
// - 분할: Yahoo 분할 이력. 시세가 분할 조정돼 있어서, 그때 주식 수에 '그 뒤 분할 배수'를 곱해 지금 단위로 맞춘다.
// DART 키는 .env.local에서 환경 변수로만 읽고 출력하지 않는다.
// 일부만 다시: --only=kr|us, --codes=055550,034730 (기존 파일에 합침)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KR, US, KOSDAQ } from './universe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const f of ['.env', '.env.local']) { try { process.loadEnvFile(join(root, f)); } catch {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'TeamQuant academic research prototype';
const plusDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const num = v => { if (v == null) return null; const s = String(v).replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null; };

async function splits(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1262304000&period2=9999999999&interval=1mo&events=split`, { headers: { 'User-Agent': 'Mozilla/5.0 ' + UA }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0];
      return Object.values(res.events?.splits || {}).map(s => [new Date(s.date * 1000).toISOString().slice(0, 10), s.numerator / s.denominator]).sort((a, b) => a[0].localeCompare(b[0]));
    } catch (e) { if (k === 2) { console.warn('분할 이력 실패', symbol, e.message); return null; } await sleep(1500); }
  }
}

// ── 미국 ─────────────────────────────────────────────
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
function firstFiled(arr, keyFn) { const m = new Map(); for (const x of arr || []) { const k = keyFn(x); if (!m.has(k) || x.filed < m.get(k).filed) m.set(k, x); } return [...m.values()]; }
async function usShares(cik) {
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) return { error: 'SEC ' + r.status };
  const j = await r.json(), dei = j.facts.dei || {}, g = j.facts['us-gaap'] || {};
  // 표지 주식 수: 기준일(end)이 제출일 직전. 기준일마다 최초 제출값.
  const cover = firstFiled(dei.EntityCommonStockSharesOutstanding?.units?.shares, x => x.end).map(x => ({ asOf: x.end, available: x.filed, shares: x.val, src: 'cover' }));
  const wad = firstFiled((g.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares || []).filter(x => x.start && days(x.start, x.end) > 75 && days(x.start, x.end) < 105), x => x.start + x.end).map(x => ({ asOf: x.end, available: x.filed, shares: x.val, src: 'wadiluted' }));
  // 마지막 대안: 순이익 ÷ 희석 EPS(연간, |EPS| ≥ 0.1)
  const ni = firstFiled((g.NetIncomeLoss?.units?.USD || []).filter(x => x.start && days(x.start, x.end) > 340 && days(x.start, x.end) < 380), x => x.start + x.end);
  const eps = firstFiled((g.EarningsPerShareDiluted?.units?.['USD/shares'] || []).filter(x => x.start && days(x.start, x.end) > 340 && days(x.start, x.end) < 380), x => x.start + x.end);
  const implied = eps.filter(e => Math.abs(e.val) >= 0.1).map(e => { const n = ni.find(x => x.start === e.start && x.end === e.end); return n ? { asOf: e.end, available: [n.filed, e.filed].sort().at(-1), shares: n.val / e.val, src: 'ni/eps' } : null; }).filter(Boolean);
  // 세 가지를 모두 저장하고, 어느 것을 쓸지는 build-growth-panel.mjs가 일관성(튀는 값 수)을 보고 고른다
  const clean = a => a.filter(x => x.shares > 0).sort((p, q) => p.asOf.localeCompare(q.asOf));
  return { entity: j.entityName, sources: { cover: clean(cover), wadiluted: clean(wad), implied: clean(implied) }, counts: { cover: cover.length, wadiluted: wad.length, implied: implied.length } };
}

// ── 한국 ─────────────────────────────────────────────
const catalog = JSON.parse(readFileSync(join(root, 'data/stocks.json'), 'utf8'));
const REPORTS = [['11013', '03-31', 45], ['11012', '06-30', 45], ['11014', '09-30', 45], ['11011', '12-31', 90]];
async function dartShares(params) {
  const url = new URL('https://opendart.fss.or.kr/api/stockTotqySttus.json'); url.search = new URLSearchParams({ crtfc_key: process.env.DART_API_KEY, ...params }).toString();
  for (let k = 0; k < 3; k++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); const d = await r.json(); if (d.status === '013') return []; if (d.status !== '000') throw new Error('DART ' + d.status); return d.list || []; } catch (e) { if (k === 2) throw e; await sleep(1000); } }
}
async function krShares(code) {
  const corp = catalog.find(x => x.code === code)?.corpCode; if (!corp) return { error: 'corp_code 없음' };
  const series = [];
  for (let y = 2015; y <= 2026; y++) for (const [rc, mmdd, lag] of REPORTS) {
    const end = `${y}-${mmdd}`; if (Date.parse(plusDays(end, lag)) > Date.now()) continue;
    const list = await dartShares({ corp_code: corp, bsns_year: String(y), reprt_code: rc }); await sleep(110);
    // '보통주', '의결권 있는 보통주', '의결권있는 주식', '의결권이 있는 주식(보통주)' 등
    const se = x => String(x.se || '').replace(/\s/g, ''), common = list.find(x => /보통/.test(se(x)) && !/우선|없는/.test(se(x))) || list.find(x => /^의결권(이)?있는/.test(se(x)));
    const v = num(common?.istc_totqy);
    if (v > 0) series.push({ asOf: end, available: plusDays(end, lag), shares: v, src: 'dart' });
  }
  return { series };
}

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const only = arg('only'), codes = arg('codes')?.split(',');
const file = join(root, '.research/shares-pit.json');
const out = (only || codes) && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { kr: {}, us: {} };
Object.assign(out, { generatedAt: new Date().toISOString(), note: '그때 공개된 주식 수(지금 단위로 바꾸려면 asOf 뒤 분할 배수를 곱함). 미국 SEC 최초 제출값(표지·희석 가중평균·순이익÷EPS 세 가지), 한국 DART 주식총수현황 보통주.' });
const want = (mkt, k) => (!only || only === mkt) && (!codes || codes.includes(k));
if (!process.env.DART_API_KEY) console.warn('DART 키가 없어 한국 주식 수를 건너뜁니다.');
for (const [code, name] of Object.entries(KR)) {
  if (!want('kr', code)) continue;
  const s = process.env.DART_API_KEY ? await krShares(code).catch(e => ({ error: e.message })) : { error: 'no key' };
  const sp = await splits(code + (KOSDAQ.has(code) ? '.KQ' : '.KS'));
  out.kr[code] = { name, splits: sp, ...s };
  console.log('KR', code, name, '주식 수', s.series?.length ?? s.error, '분할', JSON.stringify(sp));
}
for (const [t, cik] of Object.entries(US)) {
  if (!want('us', t)) continue;
  const s = await usShares(cik).catch(e => ({ error: e.message })); await sleep(200);
  const sp = await splits(t);
  out.us[t] = { splits: sp, ...s };
  console.log('US', t, '주식 수', s.error || '', JSON.stringify(s.counts || {}), '분할', JSON.stringify(sp));
}
writeFileSync(file, JSON.stringify(out));
console.log('저장 .research/shares-pit.json');
