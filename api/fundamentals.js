import { fetchFundamentals } from '../lib/fundamentals.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'GET 요청만 지원합니다.' }); }
  try {
    const data = await fetchFundamentals(String(request.query.symbol || ''));
    response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return response.status(200).json(data);
  } catch (error) { return response.status(error.status || 502).json({ error: error.message }); }
}
