// 브라우저 공용 조회 캐시: 홈·포트폴리오·종목 상세가 같은 지표·시세를 한 번만 받는다.
// 보내는 정보는 종목 코드뿐이다. 보유 수량·금액은 보내지 않는다.
const cache = new Map();
export async function getJson(url, signal) {
  const r = await fetch(url, { signal }), d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d;
}
function once(key, make) { if (!cache.has(key)) { const p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); } return cache.get(key); }

export const fundamentals = symbol => once('f:' + symbol, () => getJson(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`));
export const indexSeries = (symbol, range = '2y') => once(`i:${symbol}:${range}`, () => getJson(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${range}`));

// 국내 6자리 코드는 코스피(.KS)→코스닥(.KQ) 순으로 찾는다. 해외는 BRK.B → BRK-B.
export function candles(symbol, currency, range = '2y') {
  return once(`c:${symbol}:${range}`, async () => {
    const code = String(symbol).split('.')[0];
    if (currency !== 'USD' && /^\d[\dA-Z]{5}$/.test(code)) {
      const tries = /\.(KS|KQ)$/.test(symbol) ? [symbol] : [code + '.KS', code + '.KQ'];
      for (const s of tries) { try { const d = await getJson(`/api/market?symbol=${s}&range=${range}`); if (d.currency === 'KRW') return { ...d, index: s.endsWith('.KQ') ? ['^KQ11', '코스닥'] : ['^KS11', '코스피'] }; } catch {} }
      throw new Error('시세를 찾지 못했습니다.');
    }
    return { ...await getJson(`/api/market?symbol=${encodeURIComponent(String(symbol).replace(/\./g, '-'))}&range=${range}`), index: ['^GSPC', 'S&P 500'] };
  });
}

// 투자 성향은 화면 선택값일 뿐 금융 자료가 아니므로 브라우저에 기억한다.
export function getStyle() { try { return localStorage.getItem('teamQuantStyle') || 'balanced'; } catch { return 'balanced'; } }
export function setStyle(style) { try { localStorage.setItem('teamQuantStyle', style); } catch {} window.dispatchEvent(new CustomEvent('teamquant:style', { detail: style })); }
export function clearClientCache() { cache.clear(); }
