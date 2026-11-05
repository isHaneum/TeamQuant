import { fetchCompanyBrief } from '../lib/dart.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'GET 요청만 지원합니다.' }); }
  try {
    const data = await fetchCompanyBrief(String(request.query.code || ''));
    response.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    return response.status(200).json(data);
  } catch (error) { return response.status(error.status || 502).json({ error: error.message }); }
}
