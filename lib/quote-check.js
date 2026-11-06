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
