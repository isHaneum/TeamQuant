const form = document.querySelector('#news-form');
const query = document.querySelector('#news-query');
const status = document.querySelector('#news-status');
const list = document.querySelector('#news-results');
let controller;
// 시각: 올해는 'MM-DD HH:mm', 다른 해는 'YYYY-MM-DD HH:mm'. 오늘 조회 시각은 'HH:mm'.
const two = n => String(n).padStart(2, '0');
const clock = d => `${two(d.getHours())}:${two(d.getMinutes())}`;
const stamp = iso => { const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '시각 없음'; const md = `${two(d.getMonth() + 1)}-${two(d.getDate())}`; return `${d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`} ${clock(d)}`; };

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
      ? `‘${data.query}’ · 기사 ${data.items.length}건 · ${clock(Number.isFinite(new Date(data.fetchedAt).getTime()) ? new Date(data.fetchedAt) : new Date())} 기준`
      : `‘${data.query}’ 결과 없음 · 다른 검색어로 찾아보세요`;
    for (const item of data.items) {
      const article = document.createElement('article'); article.className = 'news-item';
      const meta = document.createElement('p'); meta.className = 'muted';
      meta.textContent = `${item.sourceHost} · ${item.publishedAt ? stamp(item.publishedAt) : '시각 없음'}`;
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
// 검색어 칩: 내 보유 종목 이름(teamquant:asset-snapshot · 이 탭 메모리)으로 바꾸고, 없으면 예시 4종목. 칩 묶음에 한 번만 묶어 다시 그려도 동작한다.
// 보내는 것은 누른 종목 이름 하나뿐이다(뉴스 검색).
const chips = document.querySelector('.news-keywords');
const FALLBACK = ['삼성전자', 'SK하이닉스', 'NAVER', '카카오'];
function setChips(names = []) {
  if (!chips) return;
  const own = [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))].slice(0, 8);
  chips.replaceChildren(...(own.length ? own : FALLBACK).map(n => { const b = document.createElement('button'); b.type = 'button'; b.dataset.newsQuery = n; b.textContent = n; return b; }));
}
chips?.addEventListener('click', event => { const b = event.target.closest('[data-news-query]'); if (!b) return; query.value = b.dataset.newsQuery; searchNews(); });
window.addEventListener('teamquant:asset-snapshot', event => setChips((event.detail?.positions || []).map(p => p.name)));
window.addEventListener('teamquant:asset-clear', () => setChips());
