import { readIssueFeed } from '../lib/issue-feed.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).json({ error: 'GET 요청만 지원합니다.' }); }
  try {
    const { data } = await readIssueFeed(request.query || {});
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return response.status(200).json(data === null ? { available: false } : { available: true, ...(Array.isArray(data) ? { items: data } : data) });
  } catch (error) { return response.status(error.status || 502).json({ error: error.message }); }
}
