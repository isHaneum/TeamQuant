const form = document.querySelector('#news-form');
const query = document.querySelector('#news-query');
const status = document.querySelector('#news-status');
const list = document.querySelector('#news-results');
let controller;

async function searchNews() {
  const keyword = query.value.trim();
  if (!keyword) { query.focus(); return; }
  controller?.abort();
  controller = new AbortController();
  const current = controller;
  status.textContent = `‘${keyword}’ 뉴스 검색 중`;
  list.replaceChildren();
  list.setAttribute('aria-busy', 'true');
  try {
    const params = new URLSearchParams({query:keyword, sort:document.querySelector('#news-sort').value});
    const response = await fetch(`/api/news?${params}`, {signal:current.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '뉴스를 불러오지 못했습니다.');
    if (current !== controller) return;
    status.textContent = data.items.length
      ? `‘${data.query}’ · ${data.items.length}건 · ${data.source} · 조회 ${new Date(data.fetchedAt).toLocaleString('ko-KR')}`
      : `‘${data.query}’ 검색 결과가 없습니다. 다른 키워드로 검색해 보세요.`;
    for (const item of data.items) {
      const article = document.createElement('article'); article.className = 'news-item';
      const meta = document.createElement('p'); meta.className = 'muted';
      meta.textContent = `${item.sourceHost} · ${item.publishedAt ? new Date(item.publishedAt).toLocaleString('ko-KR') : '게시 시각 미상'}`;
      const title = document.createElement('h2'); const link = document.createElement('a');
      const url = new URL(item.link);
      if (!['http:','https:'].includes(url.protocol)) continue;
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.title;
      title.append(link);
      const description = document.createElement('p'); description.textContent = item.description;
      article.append(meta, title, description); list.append(article);
    }
  } catch (error) {
    if (error.name !== 'AbortError' && current === controller) status.textContent = error.message;
  } finally { if (current === controller) list.setAttribute('aria-busy','false'); }
}

form.addEventListener('submit', event => {event.preventDefault(); searchNews();});
document.querySelectorAll('[data-news-query]').forEach(button => button.addEventListener('click', () => {
  query.value = button.dataset.newsQuery; searchNews();
}));
document.querySelector('#strategy-news').addEventListener('click', () => {
  const symbol = document.querySelector('#symbol').value.trim().toUpperCase();
  const names = {'005930.KS':'삼성전자', '000660.KS':'SK하이닉스', '035420.KS':'NAVER', '035720.KS':'카카오'};
  query.value = names[symbol] || symbol;
  document.querySelector('[data-view="news"]').click(); searchNews();
});
