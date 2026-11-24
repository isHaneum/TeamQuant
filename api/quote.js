import { fetchQuote, fetchQuotes, parseSymbolList } from '../lib/quote-check.js';

// ?symbol=X (한 종목) 또는 ?symbols=A,B,C (최대 20개 · 가상 모의계좌의 장중 체결·평가용 · 결정 62).
export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'GET 요청만 지원합니다.' }); }
  try {
    if (request.query.symbols) { if (String(request.headers['sec-fetch-site'] || '') === 'cross-site') return response.status(403).json({ error: '이 사이트 화면에서만 씁니다.' }); response.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30'); return response.status(200).json(await fetchQuotes(parseSymbolList(request.query.symbols))); } // 결정 63: 다른 사이트에서 부르는 것 막기 · 정렬된 목록 기준 15초 공유 캐시
    const q = await fetchQuote(request.query.symbol); response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60'); return response.status(200).json(q);
  } catch (error) { return response.status(error.status || 502).json({ error: error.message }); }
}
