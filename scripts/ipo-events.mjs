// 초대형 IPO 사건 메모(결정 52 · PREREG-H NOTE_ONLY): Nasdaq IPO 캘린더(비공식 API)에서 공모액 $2.5B 이상을 읽어 data/ipo-events.json 에 '기록(note)' 등급으로 적는다.
// 매매 차단·하락 매수 카드·주문에 연결하지 않는다(사전 등록 사건연구에서 같은 섹터 대형주의 상장 전후·락업 만료 수익률이 음수로 유의하지 않았음 · 23건 · 2012~2026).
//   node scripts/ipo-events.mjs            이번 달·지난달·다음 달 캘린더를 읽어 파일 갱신(네트워크 실패 시 기존 파일 유지)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..'), file = join(root, 'data', 'ipo-events.json');
export const MIN_USD_M = 2500, RULE = 'PREREG-H 2026-11-22: NOTE_ONLY';
const num = s => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const mdy = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const plusDays = (ymd, n) => (ymd ? new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10) : null);
/** Nasdaq 캘린더 응답(data.priced/upcoming.rows) → 사건 메모 목록(공모액 $2.5B 이상). 순수 함수(시험용). */
export function eventsFromCalendar(data, { month = '' } = {}) {
  const out = [];
  for (const [status, rows] of [['priced', data?.priced?.rows || []], ['upcoming', data?.upcoming?.rows || []]]) {
    for (const r of rows) {
      const usd = num(r.dollarValueOfSharesOffered); if (!(usd >= MIN_USD_M * 1e6)) continue;
      const date = mdy(r.pricedDate) || mdy(r.expectedPriceDate) || null;
      out.push({ type: 'ipo_event', level: 'note', id: `ipo:${r.dealID || r.proposedTickerSymbol}:${date || month}`, date, status, issuer: r.companyName, ticker: r.proposedTickerSymbol || null, exchange: r.proposedExchange || null, sizeUsdM: Math.round(usd / 1e6), priceUsd: num(r.proposedSharePrice), lockupDate: plusDays(date, 180), lockupBasis: '상장일 + 180일(추정 · 424B4 로 확인 전)', src: ['https://www.nasdaq.com/market-activity/ipos'], rule: RULE });
    }
  }
  return out;
}
async function fetchMonth(ym) { const r = await fetch(`https://api.nasdaq.com/api/ipo/calendar?date=${ym}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(`nasdaq ${r.status}`); return (await r.json()).data || {}; }
export async function refreshIpoEvents({ now = new Date(), fetchMonthImpl = fetchMonth, path = file } = {}) {
  const months = [-1, 0, 1].map(k => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1)); return d.toISOString().slice(0, 7); });
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { events: [] }, byId = new Map((prev.events || []).map(e => [e.id, e]));
  let ok = 0, fail = [];
  for (const ym of months) { try { for (const e of eventsFromCalendar(await fetchMonthImpl(ym), { month: ym })) byId.set(e.id, { ...(byId.get(e.id) || {}), ...e }); ok++; } catch (e) { fail.push(`${ym}: ${String(e.message || e).slice(0, 60)}`); } }
  const events = [...byId.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50);
  const out = { asOf: now.toISOString(), rule: RULE, minUsdM: MIN_USD_M, source: 'Nasdaq IPO calendar (unofficial API)', monthsRead: ok, errors: fail, events };
  if (ok > 0 || !existsSync(path)) writeFileSync(path, JSON.stringify(out, null, 1));
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = await refreshIpoEvents(); console.log(`IPO 사건 메모 ${o.events.length}건(공모액 $${MIN_USD_M / 1000}B 이상) · 읽은 달 ${o.monthsRead}/3${o.errors.length ? ' · 오류 ' + o.errors.join(' | ') : ''}`);
  for (const e of o.events.slice(0, 8)) console.log(` ${e.date || '예정'} ${e.issuer} (${e.ticker || '-'}) $${(e.sizeUsdM / 1000).toFixed(1)}B ${e.status} · 락업 ${e.lockupDate || '-'}`);
}
