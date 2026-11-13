import { fetchMarketOverview, fetchIndustryStocks } from '../lib/market-overview.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'GET 요청만 지원합니다.' }); }
  try {
    const v = request.query.industry ? await fetchIndustryStocks(request.query.industry) : await fetchMarketOverview({ market: String(request.query.market || 'KOSPI').toUpperCase() });
    response.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60'); return response.status(200).json(v);
  } catch (error) { return response.status(error.status || 502).json({ error: error.message }); }
}
