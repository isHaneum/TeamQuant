// 이슈 화면: 이슈 봇(GitHub Actions, 20분마다 감시 + 하루 3번 브리핑)이 올린 결과를 보여 준다.
// 내 보유 종목과의 관련은 이 브라우저에서만 계산한다(보유 정보는 서버로 보내지 않음).
// 2026-11-26 정리: '내 종목 관련'을 맨 위로, 브리핑은 첫 줄과 큰 움직임만, '시장 움직임'은 오늘 장 타일에 없는 것만 보인다.
// 늘 숨겨져 있던 홈 띠(#iss-band)는 지우고, 받은 결과를 'teamquant:issues' 이벤트(와 issuesLatest())로 넘긴다(홈 '오늘 시장' 카드용).
import { TOPICS, LEVELS, MARKETS, relatedToHoldings, moveText } from '/lib/issue-bot.js';
import { tip } from '/tooltip-ui.js';
import { fundamentals } from '/lib/client-data.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const topicLabel = id => TOPICS.find(t => t.id === id)?.label || id;
const KST = 9 * 3600000;
// 'MM-DD HH:mm'(한국 시간). 올해가 아니면 'YYYY-MM-DD HH:mm'.
const time = iso => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const k = new Date(t + KST).toISOString(), y = new Date(Date.now() + KST).toISOString().slice(0, 4); return `${k.slice(0, 4) === y ? k.slice(5, 10) : k.slice(0, 10)} ${k.slice(11, 16)}`; };
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? '' : m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
// 저장된 결과에 옛 이름이 남아 있어도 지금 이름으로 보인다.
const marketName = m => MARKETS.find(x => x[0] === m.symbol)?.[1] || m.label;
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const level = l => `<span class="iss-level l-${l}">${esc(LEVELS[l] || l)}</span>`;
const ABOUT = '20분마다 공개 뉴스 제목과 지수·환율·유가·공포지수(VIX)를 모아 같은 이슈끼리 묶고, 하루 3번(08:30·16:00·22:00) 브리핑을 만듭니다.\n긴급: 큰 사건 단어나 기사 급증이 있고 관련 시장도 평소보다 크게 움직일 때\n주의: 둘 중 하나만\n참고: 그 밖의 주요 이슈\n원인을 단정하지 않고 매수·매도 권유가 아닙니다. 몇 분 늦을 수 있습니다.';
// 오늘 장 타일(지수·환율)에 이미 있는 것은 '시장 움직임'에 다시 쓰지 않는다.
const ON_TILES = new Set(['^KS11', '^KQ11', '^GSPC', '^IXIC', 'KRW=X']);
const EMPTY_MINE = '<p class="iss-muted">보유 종목 없음 · <button type="button" class="text-button" data-demo-start>예시 자산 켜기</button></p>';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/issues.css?v=20261126'; document.head.append(css);
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'issues'; nav.textContent = '이슈';
// instruments.js의 최상위 await 때문에 이 모듈이 overview-ui보다 먼저 실행될 수 있다. 처음부터 있는 .sidebar nav에 붙인다.
($('.overview-nav nav') || $('.sidebar nav')).append(nav);
const page = document.createElement('section'); page.className = 'view'; page.dataset.page = 'issues'; page.id = 'issues';
page.innerHTML = `<div class="page-head"><div><h1>이슈 ${tip(ABOUT)}</h1><p>전쟁·선거·금리 같은 큰 이슈와 오늘의 흐름</p></div><div class="iss-head-actions"><span id="iss-updated" class="iss-muted"></span><button type="button" class="secondary" id="iss-refresh">새로고침</button></div></div>
<div class="iss">
  <div class="iss-main">
    <article class="iss-card iss-mine-card"><header><h3>내 종목 관련 ${tip('기사 제목에 내 종목·업종 이름이 나온 이슈입니다. 이 브라우저에서만 확인하고 보유 정보는 서버로 보내지 않습니다.')}</h3></header><div id="iss-mine">${EMPTY_MINE}</div></article>
    <article class="iss-card" id="iss-now"><header><h3>지금 주목할 이슈</h3></header><div id="iss-now-body"><div class="shimmer iss-skel"></div></div></article>
    <article class="iss-card" id="iss-brief"><header><h3>브리핑 ${tip('08:30 장 전 · 16:00 장 마감 · 22:00 미국 장')}</h3><select id="iss-brief-pick" aria-label="브리핑 고르기"></select></header><div id="iss-brief-body"></div></article>
    <article class="iss-card" id="iss-log"><header><h3>이슈 기록 ${tip('이슈가 처음 보도된 시각·주제와 그때 시장 움직임 기록입니다.')}</h3><div class="iss-filter" id="iss-filter"></div></header><div id="iss-log-body"></div></article>
  </div>
  <aside class="iss-side">
    <article class="iss-card"><header><h3>시장 움직임 ${tip("마지막 거래일 등락입니다. '평소의 n배' = 최근 3개월(60거래일) 보통 하루 움직임과 비교한 크기. 장중에는 지연 시세입니다.")}</h3></header><div id="iss-markets"></div></article>
  </aside>
</div>`;
document.querySelector('main').append(page);

let latest = null, positions = [], sectors = new Map(), topicFilter = null, events = null, briefCache = new Map(), loading = null, logLimit = 15;
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
/** 마지막으로 받은 이슈 봇 결과(없으면 null). 홈 카드처럼 늦게 붙는 화면이 이벤트를 놓쳤을 때 쓴다. */
export const issuesLatest = () => latest;

function issueRow(i, { compact = false } = {}) {
  const link = safeUrl(i.links?.[0]?.link);
  return `<li class="iss-item">${level(i.assess.level)}<div><a ${link ? `href="${esc(link)}" target="_blank" rel="noopener noreferrer"` : ''}>${esc(i.title)}</a>
    <small>${esc(time(i.firstSeen))} 처음 보도 · 기사 ${i.count}건 · 언론사 ${i.sources}곳${i.topics.length ? ' · ' + i.topics.map(topicLabel).map(esc).join(', ') : ''}</small>
    ${!compact && i.assess.why?.length ? `<small class="iss-why">${esc(i.assess.why.join(' · '))}</small>` : ''}
    ${!compact && i.links?.length > 1 ? `<details><summary>같은 이슈 기사 ${i.links.length}건</summary><ul>${i.links.map(l => safeUrl(l.link) ? `<li><a href="${esc(safeUrl(l.link))}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a> <small>${esc(l.host)}</small></li>` : '').join('')}</ul></details>` : ''}</div></li>`;
}
function renderNow() {
  const box = $('#iss-now-body');
  if (!latest?.available) { box.innerHTML = '<p class="iss-muted">아직 모은 이슈가 없습니다.</p>'; return; }
  const hot = latest.issues.filter(i => i.assess.level !== 'watch'), rest = latest.issues.filter(i => i.assess.level === 'watch').slice(0, Math.max(0, 6 - hot.length));
  box.innerHTML = `${hot.length ? '' : '<p class="iss-calm">긴급·주의 이슈 없음</p>'}<ol class="iss-list">${[...hot, ...rest].map(i => issueRow(i)).join('')}</ol>`;
}
function renderMarkets() {
  const box = $('#iss-markets');
  if (!latest?.available) { box.innerHTML = '<p class="iss-muted">—</p>'; return; }
  const ok = latest.markets.filter(m => m.available), newest = ok.map(m => m.date).sort().at(-1), list = ok.filter(m => !ON_TILES.has(m.symbol));
  box.innerHTML = list.length ? `<ul class="iss-mkts">${list.map(m => { const big = Math.abs(m.z) >= 2; return `<li class="${big ? 'big' : ''}"><span>${esc(marketName(m))}${m.date < newest ? ` <small class="iss-stale">${esc(m.date.slice(5))} 기준</small>` : ''}</span><b class="${tone(m.change)}">${esc(moveText(m))}</b><small>${big ? `평소의 ${Math.abs(m.z)}배` : ''}</small></li>`; }).join('')}</ul>` : '<p class="iss-muted">—</p>';
}
async function renderBrief(id) {
  const box = $('#iss-brief-body');
  let b = latest?.briefing && (!id || latest.briefing.id === id) ? latest.briefing : briefCache.get(id);
  if (!b && id) { box.innerHTML = '<div class="shimmer iss-skel"></div>'; try { const d = await getJson(`/api/issues?file=briefing&id=${encodeURIComponent(id)}`); b = d.available ? d : null; if (b) briefCache.set(id, b); } catch (e) { box.innerHTML = `<p class="iss-muted">${esc(e.message)}</p>`; return; } }
  if (!b) { box.innerHTML = '<p class="iss-muted">브리핑 없음 · 다음 08:30·16:00·22:00</p>'; return; }
  // 이슈 목록은 '지금 주목할 이슈'와 겹쳐 첫 줄과 평소보다 큰 움직임만 둔다.
  box.innerHTML = `<p class="iss-brief-title">${esc(b.title)} <small>${esc(time(b.at))}</small></p><p class="iss-headline">${esc(b.headline)}</p>
    ${b.unusual?.length ? `<ul class="iss-unusual">${b.unusual.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
}
async function loadBriefIndex() {
  const pick = $('#iss-brief-pick');
  try { const d = await getJson('/api/issues?file=briefings'); const list = d.available ? d.items : []; pick.innerHTML = list.map(x => `<option value="${esc(x.id)}">${esc(time(x.at))} ${esc(x.title)}</option>`).join(''); pick.hidden = !list.length; }
  catch { pick.hidden = true; }
}
const LOG_MARKETS = { '^KS11': '코스피', '^GSPC': 'S&P500', 'KRW=X': '달러 환율', 'CL=F': '유가' };
function renderLog() {
  const box = $('#iss-log-body'), filter = $('#iss-filter');
  if (!events) { box.innerHTML = '<div class="shimmer iss-skel"></div>'; return; }
  const topics = [...new Set(events.flatMap(e => e.topics))];
  filter.innerHTML = topics.length ? `<button type="button" class="${topicFilter ? '' : 'on'}" data-topic="">전체</button>${topics.map(t => `<button type="button" class="${topicFilter === t ? 'on' : ''}" data-topic="${esc(t)}">${esc(topicLabel(t))}</button>`).join('')}` : '';
  filter.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { topicFilter = b.dataset.topic || null; logLimit = 15; renderLog(); });
  const all = events.filter(e => !topicFilter || e.topics.includes(topicFilter)), rows = all.slice(0, logLimit);
  box.innerHTML = rows.length ? `<div class="table-wrap"><table class="iss-table"><thead><tr><th>처음 보도</th><th>중요도</th><th>이슈</th><th>그때 시장 ${tip('처음 보도될 때의 하루 등락입니다.')}</th></tr></thead><tbody>${rows.map(e => {
    const mk = Object.keys(LOG_MARKETS).map(s => e.market?.[s] ? `${LOG_MARKETS[s]} <b class="${tone(e.market[s].change)}">${esc(moveText({ change: e.market[s].change, unit: '%' }))}</b>` : '').filter(Boolean).join(' · ');
    const link = safeUrl(e.links?.[0]?.link);
    return `<tr><td>${esc(time(e.firstSeen))}</td><td>${level(e.level)}</td><td>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : esc(e.title)}<small>${e.topics.map(topicLabel).map(esc).join(', ')} · 언론사 ${e.sources}곳</small></td><td class="iss-mk">${mk}</td></tr>`;
  }).join('')}</tbody></table></div>${all.length > rows.length ? `<button type="button" class="text-button iss-more" id="iss-more">더 보기 (${all.length - rows.length}건)</button>` : ''}` : '<p class="iss-muted">이번 달 기록 없음</p>';
  $('#iss-more')?.addEventListener('click', () => { logLimit += 30; renderLog(); });
}
function renderMine() {
  const box = $('#iss-mine');
  if (!positions.length) { box.innerHTML = EMPTY_MINE; return; }
  if (!latest?.available) { box.innerHTML = '<p class="iss-muted">—</p>'; return; }
  const pool = [...latest.issues, ...(latest.briefing?.issues || [])], uniq = [...new Map(pool.map(i => [i.id, i])).values()];
  const per = new Map(), hits = relatedToHoldings(uniq, positions.map(p => ({ name: p.name, sector: sectors.get(p.symbol) }))).filter(h => { const n = per.get(h.holding) || 0; per.set(h.holding, n + 1); return n < 2; });
  box.innerHTML = hits.length ? `<ul class="iss-mine">${hits.slice(0, 8).map(h => `<li><b>${esc(h.holding)}</b><small>${esc(h.via)} 언급</small>${safeUrl(h.issue.links?.[0]?.link) ? `<a href="${esc(safeUrl(h.issue.links[0].link))}" target="_blank" rel="noopener noreferrer">${esc(h.issue.title)}</a>` : esc(h.issue.title)}</li>`).join('')}</ul>` : '<p class="iss-muted">내 종목 관련 이슈 없음</p>';
}

async function load(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    try { latest = await getJson('/api/issues?file=latest'); } catch (e) { latest = { available: false, error: e.message }; }
    $('#iss-updated').textContent = latest?.available ? `${ago(latest.updatedAt)} 기준` : '';
    renderNow(); renderMarkets(); renderMine();
    window.dispatchEvent(new CustomEvent('teamquant:issues', { detail: latest }));
    void renderBrief(null); void loadBriefIndex();
    try { const d = await getJson(`/api/issues?file=events&month=${month()}`); events = d.available ? d.events : []; } catch { events = []; }
    renderLog();
  })();
  try { await loading; } finally { loading = null; }
}
$('#iss-refresh').onclick = () => void load(true);
$('#iss-brief-pick').onchange = e => void renderBrief(e.target.value);
window.addEventListener('teamquant:asset-snapshot', e => {
  positions = e.detail?.positions || []; renderMine();
  // 업종 이름은 홈·포트폴리오가 이미 받은 투자 지표 캐시를 같이 쓴다.
  for (const p of positions) if (!sectors.has(p.symbol)) fundamentals(p.symbol).then(f => { if (f?.sector) { sectors.set(p.symbol, f.sector); renderMine(); } }).catch(() => {});
});
window.addEventListener('teamquant:asset-clear', () => { positions = []; renderMine(); });
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'issues' && (!latest || Date.now() - (latest._at || 0) > 120000)) void load().then(() => { if (latest) latest._at = Date.now(); }); });
setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5 * 60000);
void load().then(() => { if (latest) latest._at = Date.now(); });
