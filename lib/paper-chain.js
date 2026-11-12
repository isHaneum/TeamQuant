// 기록 해시 체인(순수 함수 · 입출력 없음 · Node 전용: node:crypto). 모의계좌 장부의 하루 마감 평가를 전날 항목의 해시와 묶어 sha256 으로 봉인한다.
// 왜: 운용 기록의 신뢰는 "그날 적은 것이 나중에 바뀌지 않았다"에서 온다. 공개 파일(data/paper-live-public.json)만 가진 사람이 모든 해시를 다시 계산해
// 그 사실을 확인할 수 있어야 한다(검증에 PC·장부·키가 필요하면 검증이 아니다). 과거 날짜는 되메우지 않는다 — 되메운 항목은 그날 적은 것이 아니므로 시각을 꾸미는 일이 된다.
// 봉인하는 것: 날짜 · 총자산 · 현금 · 주식 · 정산 전 미국 매수대금 · 환율 · 보유(종목·수량) · 그날(KST) 확인된 체결(종목·방향·수량·평균가). 계좌번호·주문번호·증권사 문구는 들어가지 않는다.
// 2026-11-12 검토 반영(체인 공개 0일 상태에서 바꿈 · CHAIN_VERSION 유지): fx 는 없으면 null(0 아님), 체결은 체결 수량이 있으면 상태와 무관하게 들어가고 날짜는 확인한 KST 날짜(filledAt · 없으면 at)로 고른다.
import { createHash } from 'node:crypto';

export const CHAIN_VERSION = 'CH1-2026-11-12';
/** 총자산 정의(2026-11-12 결정 (19)·(20)). 화면 ⓘ·CLI verify·docs/record-definition.md 가 같은 문장을 쓴다. */
export const TOTAL_DEFINITION = '총자산 = 원화 예수금 + 국내 주식 평가 + 미국 주식 평가×환율 + 외화예수금×환율 − 정산 전 미국 매수대금(모의계좌 · 외화예수금이 없을 때만)';

const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
// null·undefined 는 null 로 남긴다(Number(null) 은 0 이라 '환율 없음'이 '환율 0'으로 봉인되는 것을 막는다).
const num = v => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 결정적 JSON: 객체 키를 재귀적으로 정렬하고 숫자는 그대로 적는다(undefined 값은 JSON 처럼 뺀다). 같은 내용이면 키 순서가 달라도 같은 문자열. */
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(x => canonical(x === undefined ? null : x)).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
/** 항목 해시 = sha256(prevHash + '|' + canonical(payload)). 첫 항목(genesis)의 prevHash 는 빈 문자열. */
export const hashOf = (prevHash, payload) => sha256(`${prevHash || ''}|${canonical(payload)}`);

/**
 * 하루 항목. mark = {date,total,cash,stock,funding?,fx?}, positions = [{symbol,qty}], fills = 장부 주문 전체(체결 수량이 있고 체결을 확인한 KST 날짜(filledAt · 없으면 at)가 mark.date 인 것만 들어간다).
 * @returns {{date:string, prevHash:string, payload:object, hash:string}}
 */
export function entryFor({ prevHash = '', mark, positions = [], fills = [] }) {
  if (!mark || typeof mark.date !== 'string') throw new Error('평가점(mark.date)이 없습니다.');
  const payload = {
    date: mark.date, total: num(mark.total), cash: num(mark.cash), stock: num(mark.stock), funding: num(mark.funding) || 0, fx: num(mark.fx),
    positions: positions.filter(p => p && p.symbol).map(p => ({ symbol: String(p.symbol), qty: num(p.qty) })).sort((a, b) => cmp(a.symbol, b.symbol)),
    // 체결 수량 기준: 상태가 filled/partial 이거나 체결 수량이 있으면(일부 체결 뒤 소멸·취소된 주문도 산 만큼은 체결) 들어간다. 날짜는 체결을 확인한 KST 날짜(filledAt · 없으면 주문 시각) = 평가점 날짜 —
    // 거래일(미국은 뉴욕 날짜)로 고르면 KST 자정 뒤 미국 체결이 이미 닫힌 전날 항목에 속해 어느 항목에도 못 들어간다. 주문번호·증권사 문구는 넣지 않는다.
    fills: fills.filter(o => o && (o.filledAt || o.at) && (['filled', 'partial'].includes(o.status) || (num(o.filledQty) ?? 0) > 0) && kstDate(o.filledAt || o.at) === mark.date).map(o => ({ symbol: String(o.symbol), side: o.side, qty: num(o.filledQty ?? o.qty), avgPrice: num(o.avgPrice ?? o.price) })).sort((a, b) => cmp(a.symbol, b.symbol) || cmp(a.side, b.side))
  };
  return { date: mark.date, prevHash: prevHash || '', payload, hash: hashOf(prevHash, payload) };
}

/**
 * 하루 봉인(장부 {marks, chain, chainBreaks} 의 세 배열만 만진다 · 입출력 없음). 모의계좌 엔진(lib/paper-live.js)과 실계좌 기록(lib/real-record.js)이 같은 규칙으로 봉인하도록 여기에 둔다.
 * 오늘 평가점 m 과 보유·그날 체결을 전날 항목의 해시와 묶어 체인에 넣는다. 같은 날은 교체(그날 마지막 평가가 봉인). 지난 날짜의 항목은 어떤 경우에도 다시 쓰지 않는다 —
 * 봉인 뒤 그 날짜의 평가점이 바뀐 것이 보이면(total·cash·stock·funding 비교) chainBreaks 에 {date, at, note} 만 적는다. 체인은 자르지 않는다(검증에 전체가 필요).
 * @returns {boolean} 봉인했는가(지난 날짜의 평가가 다시 온 경우 false)
 */
export function sealEntry(ledger, m, { positions = [], fills = [], at = new Date().toISOString() } = {}) {
  const chain = ledger.chain, last = chain.at(-1), noted = d => ledger.chainBreaks.some(b => b.date === d);
  for (const e of chain) { if (e.date === m.date) continue; const mk = ledger.marks.find(x => x.date === e.date); if (!mk) continue; const diff = ['total', 'cash', 'stock'].filter(k => e.payload[k] !== mk[k]); if ((e.payload.funding || 0) !== (mk.funding || 0)) diff.push('funding'); if (diff.length && !noted(e.date)) ledger.chainBreaks.push({ date: e.date, at, note: `봉인 뒤 평가점이 바뀜(${diff.join(',')}) · 체인 항목은 그대로 둠` }); }
  if (last && last.date > m.date) { if (!noted(m.date)) ledger.chainBreaks.push({ date: m.date, at, note: '지난 날짜의 평가가 다시 와서 봉인하지 않음' }); return false; }
  const sameDay = Boolean(last && last.date === m.date), e = entryFor({ prevHash: sameDay ? (chain.at(-2)?.hash ?? '') : (last?.hash ?? ''), mark: m, positions, fills });
  if (sameDay) chain[chain.length - 1] = e; else chain.push(e);
  return true;
}

/**
 * 체인 검증: 항목마다 저장된 payload 로 해시를 다시 계산하고, 이전 항목과의 연결(prevHash)·날짜 증가를 확인한다.
 * 첫 항목의 prevHash 는 검사하지 않는다(공개 파일은 최근 400일만 실을 수 있으므로 조상이 잘려 있을 수 있다).
 * @returns {{ok:boolean, days:number, brokenAt:string|null, reason:string|null}}
 */
export function verifyChain(entries) {
  if (!Array.isArray(entries)) return { ok: false, days: 0, brokenAt: null, reason: '체인이 배열이 아닙니다.' };
  const bad = (e, reason) => ({ ok: false, days: entries.length, brokenAt: e?.date ?? null, reason });
  let prev = null;
  for (const e of entries) {
    if (!e || typeof e !== 'object' || !e.payload || typeof e.payload !== 'object' || typeof e.hash !== 'string') return bad(e, '항목 형식이 올바르지 않습니다.');
    if (e.payload.date !== e.date) return bad(e, '항목 날짜와 봉인된 날짜가 다릅니다.');
    if (prev && !(e.date > prev.date)) return bad(e, `날짜가 증가하지 않습니다(${prev.date} → ${e.date}).`);
    if (prev && e.prevHash !== prev.hash) return bad(e, '이전 항목과의 연결(prevHash)이 끊어졌습니다.');
    if (hashOf(e.prevHash, e.payload) !== e.hash) return bad(e, '해시가 내용과 맞지 않습니다(봉인 뒤 변경).');
    prev = e;
  }
  return { ok: true, days: entries.length, brokenAt: null, reason: null };
}

/**
 * 표시 숫자(marks)와 봉인 값(payload)의 대조. verifyChain 은 체인 안의 일관성만 보므로 화면·CLI 가 읽는 marks 를 고친 공개 파일도 체인만으로는 '정상'이 된다(2026-11-12 검토).
 * 같은 날짜의 평가점이 있는 항목마다 total·cash·stock·funding 을 비교한다(평가점이 잘려 없는 날짜는 비교하지 않는다).
 * @returns {{ok:boolean, compared:number, mismatches:Array<{date:string, keys:string[]}>}}
 */
export function verifyAgainstMarks(entries, marks) {
  const ms = Array.isArray(marks) ? marks : [], mismatches = []; let compared = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.payload || typeof e.payload !== 'object') continue; const m = ms.find(x => x && x.date === e.date); if (!m) continue; compared++;
    const keys = ['total', 'cash', 'stock'].filter(k => num(m[k]) !== e.payload[k]); if ((num(m.funding) || 0) !== (e.payload.funding || 0)) keys.push('funding');
    if (keys.length) mismatches.push({ date: e.date, keys });
  }
  return { ok: mismatches.length === 0, compared, mismatches };
}
