// 현재가 교차 확인(서버 전용): 네이버 증권 공개 화면용 API에서 현재가·등락률·장 상태·시각을 받는다(비공식).
// Yahoo 일봉이 늦거나 장중 값이 다를 때 화면이 이 값으로 보정하고, 보정했다는 사실을 표시한다.
export class QuoteError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
const INDEX = { '^KS11': ['m', 'index/KOSPI'], '^KQ11': ['m', 'index/KOSDAQ'], '^GSPC': ['api', 'index/.INX'], '^IXIC': ['api', 'index/.IXIC'], '^SOX': ['api', 'index/.SOX'], '^VIX': ['api', 'index/.VIX'], '^DJI': ['api', 'index/.DJI'] };
const BASE = { m: 'https://m.stock.naver.com/api/', api: 'https://api.stock.naver.com/' };

export function quoteUrls(input) {
  const s = String(input || '').trim().toUpperCase();
  if (!/^[A-Z0-9.^\-]{1,15}$/.test(s)) throw new QuoteError('종목 코드 형식이 올바르지 않습니다.', 400);
  if (INDEX[s]) return [BASE[INDEX[s][0]] + INDEX[s][1] + '/basic'];
  const code = s.replace(/\.(KS|KQ)$/, '');
  if (/^\d[\dA-Z]{5}$/.test(code)) return [`${BASE.m}stock/${code}/basic`];
  if (/^[A-Z][A-Z.\-]{0,9}$/.test(s)) { const t = s.replace(/[.\-]/g, '.'); return ['.O', '.N', '.K', ''].map(x => `${BASE.api}stock/${t}${x}/basic`); }
  throw new QuoteError('지원하지 않는 종목입니다.', 400);
}
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
export function parseQuote(j) {
  const price = num(j?.closePrice); if (price === null || price <= 0) return null;
  const at = j.localTradedAt ? new Date(j.localTradedAt).toISOString() : null;
  return { name: j.stockName || j.indexName || null, price, change: num(j.compareToPreviousClosePrice), pct: num(j.fluctuationsRatio), status: j.marketStatus === 'OPEN' ? 'OPEN' : 'CLOSE', at, delayMin: num(j.stockExchangeType?.delayTime) || num(j.delayTime) || 0, source: '네이버 증권' };
}
export async function fetchQuote(symbol, { fetchImpl = fetch } = {}) {
  for (const url of quoteUrls(symbol)) {
    try { const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); if (!r.ok) continue; const q = parseQuote(await r.json()); if (q) return { symbol: String(symbol).toUpperCase(), ...q, fetchedAt: new Date().toISOString() }; } catch {}
  }
  throw new QuoteError('현재가를 확인하지 못했습니다.', 502);
}
// 여러 종목 한 번에(결정 62 · 보안 검토 결정 63 반영): 최대 20개.
//   · 성공은 15초, 실패는 5분 동안 같은 값을 다시 쓴다(없는 코드를 반복해 원천을 두드리지 못하게).
//   · 미국 코드는 성공한 원천 주소를 기억해 다음부터 그 주소 하나만 묻는다.
//   · 요청 하나에서 아직 모르는 미국 코드는 5개까지만 원천에 묻는다(한 요청이 원천 호출 80번이 되지 않게) — 나머지는 '잠시 뒤 다시'.
const memo = new Map(), MEMO_MS = 15_000, FAIL_MS = 300_000, usHit = new Map(), NEW_US_PER_REQ = 5;
const trim = m => { if (m.size > 500) m.delete(m.keys().next().value); };
export function parseSymbolList(raw) { const list = [...new Set(String(raw || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean))]; if (!list.length || list.length > 20 || list.some(s => !/^[A-Z0-9.^-]{1,15}$/.test(s))) throw new QuoteError('종목은 1~20개, 코드 형식으로 주십시오.', 400); return list.sort(); }
async function fetchOne(s, fetchImpl) {
  const urls = quoteUrls(s), known = usHit.get(s), order = known ? [known] : urls;
  for (const url of order) {
    try { const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }); if (!r.ok) continue; const q = parseQuote(await r.json()); if (q) { if (urls.length > 1) { usHit.set(s, url); trim(usHit); } return { symbol: s, ...q, fetchedAt: new Date().toISOString() }; } } catch {}
  }
  if (known) usHit.delete(s);
  throw new QuoteError('현재가를 확인하지 못했습니다.', 502);
}
export async function fetchQuotes(list, { fetchImpl = fetch, now = Date.now } = {}) {
  const out = {}; let fresh = 0;
  await Promise.all(list.map(async s => {
    const hit = memo.get(s); if (hit && now() - hit.t < (hit.fail ? FAIL_MS : MEMO_MS)) { out[s] = hit.v; return; }
    const multi = quoteUrls(s).length > 1 && !usHit.has(s); if (multi && ++fresh > NEW_US_PER_REQ) { out[s] = { symbol: s, error: '잠시 뒤 다시(한 번에 새 종목이 많음)' }; return; }
    try { const v = await fetchOne(s, fetchImpl); memo.set(s, { t: now(), v }); } catch (e) { memo.set(s, { t: now(), v: { symbol: s, error: e.message }, fail: true }); }
    trim(memo); out[s] = memo.get(s).v;
  }));
  return { quotes: out, at: new Date(now()).toISOString() };
}
