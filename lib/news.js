export class NewsError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function normalizeNewsQuery(input) {
  const query = String(input || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new NewsError('종목명이나 키워드를 1~100자로 입력하세요.', 400);
  }
  return query;
}

export function plainText(input) {
  return String(input || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const named = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' '};
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] || match;
    const value = entity.slice(1,2).toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
  });
}

function safeLink(input) {
  try { const url = new URL(input); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export async function fetchNews(input, sort = 'date', {fetchImpl = fetch, env = process.env} = {}) {
  const query = normalizeNewsQuery(input);
  if (!['date','sim'].includes(sort)) throw new NewsError('검색 정렬 조건이 올바르지 않습니다.', 400);
  const provider = env.NAVER_NEWS_PROVIDER || 'hub';
  if (!['hub','legacy'].includes(provider)) throw new NewsError('뉴스 API 연결 설정을 확인해 주세요.',503);
  const clientId = provider === 'hub' ? env.NAVER_API_HUB_CLIENT_ID : env.NAVER_CLIENT_ID;
  const clientSecret = provider === 'hub' ? env.NAVER_API_HUB_CLIENT_SECRET : env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new NewsError('뉴스 검색 연결 전입니다. NAVER API HUB에서 뉴스 API 키를 발급해 서버에 설정해 주세요.', 503);
  }
  const url = new URL(provider === 'hub' ? 'https://naverapihub.apigw.ntruss.com/search/v1/news' : 'https://openapi.naver.com/v1/search/news.json');
  url.search = new URLSearchParams({query, display:'20', start:'1', sort}).toString();
  if (provider === 'hub') url.searchParams.set('format','json');
  const headers = provider === 'hub'
    ? {'X-NCP-APIGW-API-KEY-ID':clientId, 'X-NCP-APIGW-API-KEY':clientSecret}
    : {'X-Naver-Client-Id':clientId, 'X-Naver-Client-Secret':clientSecret};
  let response;
  try {
    response = await fetchImpl(url, {headers, signal:AbortSignal.timeout(8000)});
  } catch { throw new NewsError('뉴스 서버에 연결하지 못했습니다. 잠시 후 다시 검색하세요.'); }
  if (!response.ok) {
    if ([401,403].includes(response.status)) throw new NewsError('네이버 API 인증 또는 검색 권한을 확인해 주세요.');
    if (response.status === 429) throw new NewsError('뉴스 검색 한도를 초과했습니다. 잠시 후 다시 검색하세요.', 429);
    throw new NewsError('뉴스 검색 응답을 받지 못했습니다. 잠시 후 다시 검색하세요.');
  }
  let data;
  try { data = await response.json(); } catch { throw new NewsError('뉴스 검색 응답 형식이 올바르지 않습니다.'); }
  if (!Array.isArray(data.items)) throw new NewsError('뉴스 검색 결과를 확인할 수 없습니다.');
  const seen = new Set();
  const items = data.items.flatMap(item => {
    const link = safeLink(item.originallink) || safeLink(item.link);
    if (!link || seen.has(link)) return [];
    seen.add(link);
    const time = Date.parse(item.pubDate);
    return [{title:plainText(item.title), description:plainText(item.description), link,
      sourceHost:new URL(link).hostname.replace(/^www\./,''), publishedAt:Number.isFinite(time)?new Date(time).toISOString():null}];
  });
  return {query, sort, source:'네이버 뉴스 검색', fetchedAt:new Date().toISOString(), total:Number(data.total)||0, items};
}
