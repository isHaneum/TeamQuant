import { fetchNews } from '../lib/news.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'private, no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({error:'GET 요청만 지원합니다.'});
  }
  try { return response.status(200).json(await fetchNews(request.query.query, request.query.sort || 'date')); }
  catch (error) { return response.status(error.status || 502).json({error:error.message}); }
}
