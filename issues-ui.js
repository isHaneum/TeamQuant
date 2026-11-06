// 이슈 화면: 이슈 봇(GitHub Actions, 20분마다 감시 + 하루 3번 브리핑)이 올린 결과를 보여 준다.
// 내 보유 종목과의 관련은 이 브라우저에서만 계산한다(보유 정보는 서버로 보내지 않음).
import { TOPICS, LEVELS, relatedToHoldings } from '/lib/issue-bot.js';
import { tip } from '/tooltip-ui.js';
import { fundamentals } from '/lib/client-data.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const topicLabel = id => TOPICS.find(t => t.id === id)?.label || id;
const time = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : ''; };
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? '' : m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const chg = m => `${m.change > 0 ? '+' : ''}${m.change}${m.unit === 'bp' ? 'bp' : '%'}`;
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const level = l => `<span class="iss-level l-${l}">${esc(LEVELS[l] || l)}</span>`;
const ABOUT = '이슈 봇은 20분마다 공개 뉴스 제목과 지수·환율·유가·변동성을 모아 같은 사건끼리 묶고, 하루 세 번(08:30·16:00·22:00) 브리핑을 만듭니다.\n긴급: 핵심 단어나 기사 급증이 있고 관련 시장도 평소보다 크게 움직일 때\n주의: 둘 중 하나만 있을 때\n관찰: 그 밖의 주요 사건\n원인을 단정하지 않으며 매수·매도 권유가 아닙니다. GitHub Actions 예약 실행이라 몇 분씩 늦을 수 있습니다.';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/issues.css?v=20261106'; document.head.append(css);
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'issues'; nav.textContent = '이슈';
// instruments.js의 최상위 await 때문에 이 모듈이 overview-ui보다 먼저 실행될 수 있다. 처음부터 있는 .sidebar nav에 붙인다.
($('.overview-nav nav') || $('.sidebar nav')).append(nav);
const page = document.createElement('section'); page.className = 'view'; page.dataset.page = 'issues'; page.id = 'issues';
page.innerHTML = `<div class="page-head"><div><h1>이슈 ${tip(ABOUT)}</h1><p>전쟁·선거·금리 같은 큰 사건과 오늘의 흐름</p></div><div class="iss-head-actions"><span id="iss-updated" class="iss-muted"></span><button type="button" class="secondary" id="iss-refresh">새로고침</button></div></div>
<div class="iss">
  <div class="iss-main">
    <article class="iss-card" id="iss-now"><header><h3>지금 주목할 사건</h3></header><div id="iss-now-body"><div class="shimmer iss-skel"></div></div></article>
    <article class="iss-card" id="iss-brief"><header><h3>브리핑 ${tip('국내 장 전(08:30), 국내 장 마감(16:00), 미국 장(22:00)에 만듭니다. 텔레그램을 연결하면 같은 내용이 메시지로 옵니다.')}</h3><select id="iss-brief-pick" aria-label="브리핑 고르기"></select></header><div id="iss-brief-body"></div></article>
    <article class="iss-card" id="iss-log"><header><h3>사건 기록 ${tip('봇이 본 사건을 처음 본 시각, 주제, 그때의 시장 움직임과 함께 쌓습니다. 이후 1·5·20일 반응을 계산하는 사건 연구(이유 모델)의 재료가 됩니다.')}</h3><div class="iss-filter" id="iss-filter"></div></header><div id="iss-log-body"></div></article>
  </div>
  <aside class="iss-side">
    <article class="iss-card"><header><h3>시장 움직임 ${tip('마지막 거래일 기준 하루 변화. 배 수치는 최근 60거래일 평소 하루 움직임 대비 크기입니다. 장중에는 지연 시세입니다.')}</h3></header><div id="iss-markets"></div></article>
    <article class="iss-card"><header><h3>내 종목 관련 ${tip('보유 종목 이름이나 업종이 사건 제목에 나오는지 이 브라우저에서만 확인합니다. 보유 정보는 서버로 보내지 않습니다.')}</h3></header><div id="iss-mine"><p class="iss-muted">계좌를 연결하거나 예시 자산을 켜면 보입니다.</p></div></article>
  </aside>
</div>`;
document.querySelector('main').append(page);

let latest = null, positions = [], sectors = new Map(), topicFilter = null, events = null, briefCache = new Map(), loading = null, logLimit = 15;
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);

function issueRow(i, { compact = false } = {}) {
  const link = safeUrl(i.links?.[0]?.link);
  return `<li class="iss-item">${level(i.assess.level)}<div><a ${link ? `href="${esc(link)}" target="_blank" rel="noopener noreferrer"` : ''}>${esc(i.title)}</a>
    <small>${esc(time(i.firstSeen))} 처음 · ${i.count}건 · ${i.sources}곳${i.topics.length ? ' · ' + i.topics.map(topicLabel).map(esc).join(', ') : ''}</small>
    ${!compact && i.assess.why?.length ? `<small class="iss-why">${esc(i.assess.why.join(' · '))}</small>` : ''}
    ${!compact && i.links?.length > 1 ? `<details><summary>같은 사건 기사 ${i.links.length}건</summary><ul>${i.links.map(l => safeUrl(l.link) ? `<li><a href="${esc(safeUrl(l.link))}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a> <small>${esc(l.host)}</small></li>` : '').join('')}</ul></details>` : ''}</div></li>`;
}
function renderNow() {
  const box = $('#iss-now-body');
  if (!latest?.available) { box.innerHTML = `<p class="iss-muted">이슈 봇이 아직 결과를 올리지 않았습니다. ${tip('GitHub 저장소의 Actions에서 issue-bot 작업이 처음 실행되면 이곳에 나타납니다. 직접 실행은 Actions → issue-bot → Run workflow.')}</p>`; return; }
  const hot = latest.issues.filter(i => i.assess.level !== 'watch'), rest = latest.issues.filter(i => i.assess.level === 'watch').slice(0, Math.max(0, 6 - hot.length));
  box.innerHTML = `${hot.length ? '' : '<p class="iss-calm">긴급·주의 사건이 없습니다. 주요 사건만 정리합니다.</p>'}<ol class="iss-list">${[...hot, ...rest].map(i => issueRow(i)).join('')}</ol>
    ${latest.alerts?.length ? `<h4>최근 알림</h4><ol class="iss-alerts">${latest.alerts.slice(0, 6).map(a => `<li>${level(a.level)}<span>${safeUrl(a.link) ? `<a href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>` : esc(a.title)}</span><small>${esc(ago(a.at))}${a.delivered ? ' · 텔레그램 보냄' : ''}</small></li>`).join('')}</ol>` : ''}`;
}
function renderMarkets() {
  const box = $('#iss-markets');
  if (!latest?.available) { box.innerHTML = '<p class="iss-muted">—</p>'; return; }
  const newest = latest.markets.filter(m => m.available).map(m => m.date).sort().at(-1);
  box.innerHTML = `<ul class="iss-mkts">${latest.markets.filter(m => m.available).map(m => `<li class="${Math.abs(m.z) >= 2 ? 'big' : ''}"><span>${esc(m.label)}${m.date < newest ? ` <small class="iss-stale">${esc(m.date.slice(5).replace('-', '.'))} 기준</small>` : ''}</span><b class="${tone(m.change)}">${esc(chg(m))}</b><small>${Math.abs(m.z) >= 2 ? `평소의 ${Math.abs(m.z)}배` : `${Math.abs(m.z)}배`}</small></li>`).join('')}</ul>`;
}
async function renderBrief(id) {
  const box = $('#iss-brief-body');
  let b = latest?.briefing && (!id || latest.briefing.id === id) ? latest.briefing : briefCache.get(id);
  if (!b && id) { box.innerHTML = '<div class="shimmer iss-skel"></div>'; try { const d = await getJson(`/api/issues?file=briefing&id=${encodeURIComponent(id)}`); b = d.available ? d : null; if (b) briefCache.set(id, b); } catch (e) { box.innerHTML = `<p class="iss-muted">${esc(e.message)}</p>`; return; } }
  if (!b) { box.innerHTML = '<p class="iss-muted">아직 브리핑이 없습니다. 다음 예약 시각(08:30·16:00·22:00)에 만들어집니다.</p>'; return; }
  box.innerHTML = `<p class="iss-brief-title">${esc(b.title)} <small>${esc(time(b.at))}</small></p><p class="iss-headline">${esc(b.headline)}</p>
    ${b.unusual?.length ? `<ul class="iss-unusual">${b.unusual.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <ol class="iss-list">${(b.issues || []).slice(0, 5).map(i => issueRow(i, { compact: true })).join('')}</ol>`;
}
async function loadBriefIndex() {
  const pick = $('#iss-brief-pick');
  try { const d = await getJson('/api/issues?file=briefings'); const list = d.available ? d.items : []; pick.innerHTML = list.map(x => `<option value="${esc(x.id)}">${esc(time(x.at))} ${esc(x.title)}</option>`).join(''); pick.hidden = !list.length; }
  catch { pick.hidden = true; }
}
function renderLog() {
  const box = $('#iss-log-body'), filter = $('#iss-filter');
  if (!events) { box.innerHTML = '<div class="shimmer iss-skel"></div>'; return; }
  const topics = [...new Set(events.flatMap(e => e.topics))];
  filter.innerHTML = topics.length ? `<button type="button" class="${topicFilter ? '' : 'on'}" data-topic="">전체</button>${topics.map(t => `<button type="button" class="${topicFilter === t ? 'on' : ''}" data-topic="${esc(t)}">${esc(topicLabel(t))}</button>`).join('')}` : '';
  filter.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { topicFilter = b.dataset.topic || null; logLimit = 15; renderLog(); });
  const all = events.filter(e => !topicFilter || e.topics.includes(topicFilter)), rows = all.slice(0, logLimit);
  box.innerHTML = rows.length ? `<div class="table-wrap"><table class="iss-table"><thead><tr><th>처음 본 시각</th><th>등급</th><th>사건</th><th>그때 시장 ${tip('기록한 순간의 하루 변화입니다. 사건 이후 반응은 사건 연구에서 따로 계산합니다.')}</th></tr></thead><tbody>${rows.map(e => {
    const mk = ['^KS11', '^GSPC', 'KRW=X', 'CL=F'].map(s => e.market?.[s] ? `${{ '^KS11': '코스피', '^GSPC': 'S&P', 'KRW=X': '환율', 'CL=F': '유가' }[s]} <b class="${tone(e.market[s].change)}">${e.market[s].change > 0 ? '+' : ''}${e.market[s].change}%</b>` : '').filter(Boolean).join(' · ');
    const link = safeUrl(e.links?.[0]?.link);
    return `<tr><td>${esc(time(e.firstSeen))}</td><td>${level(e.level)}</td><td>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : esc(e.title)}<small>${e.topics.map(topicLabel).map(esc).join(', ')} · ${e.sources}곳</small></td><td class="iss-mk">${mk}</td></tr>`;
  }).join('')}</tbody></table></div>${all.length > rows.length ? `<button type="button" class="text-button iss-more" id="iss-more">더 보기 (${all.length - rows.length}건)</button>` : ''}` : '<p class="iss-muted">이번 달 기록이 아직 없습니다.</p>';
  $('#iss-more')?.addEventListener('click', () => { logLimit += 30; renderLog(); });
}
function renderMine() {
  const box = $('#iss-mine');
  if (!positions.length) { box.innerHTML = '<p class="iss-muted">계좌를 연결하거나 예시 자산을 켜면 보입니다.</p>'; return; }
  if (!latest?.available) { box.innerHTML = '<p class="iss-muted">—</p>'; return; }
  const pool = [...latest.issues, ...(latest.briefing?.issues || [])], uniq = [...new Map(pool.map(i => [i.id, i])).values()];
  const per = new Map(), hits = relatedToHoldings(uniq, positions.map(p => ({ name: p.name, sector: sectors.get(p.symbol) }))).filter(h => { const n = per.get(h.holding) || 0; per.set(h.holding, n + 1); return n < 2; });
  box.innerHTML = hits.length ? `<ul class="iss-mine">${hits.slice(0, 8).map(h => `<li><b>${esc(h.holding)}</b><small>${esc(h.via)} 언급</small>${safeUrl(h.issue.links?.[0]?.link) ? `<a href="${esc(safeUrl(h.issue.links[0].link))}" target="_blank" rel="noopener noreferrer">${esc(h.issue.title)}</a>` : esc(h.issue.title)}</li>`).join('')}</ul>` : `<p class="iss-muted">지금 사건 제목에 보유 종목·업종 이름이 나오지 않습니다. ${tip('이름이 직접 나오는 경우만 찾습니다. 유가·환율처럼 간접 영향은 다음 단계(민감도 계산)에서 붙입니다.')}</p>`;
}

// 홈 맨 위 띠: 최근 6시간 안의 긴급·주의 사건 하나, 없으면 최신 브리핑 한 줄.
function placeBand() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let band = document.getElementById('iss-band');
  if (!band) { band = document.createElement('button'); band.type = 'button'; band.id = 'iss-band'; band.className = 'iss-band'; band.onclick = () => document.querySelector('[data-view="issues"]')?.click(); host.prepend(band); }
  if (!latest?.available) { band.hidden = true; return; }
  const hot = latest.issues.find(i => i.assess.level !== 'watch' && Date.now() - Date.parse(i.lastSeen || i.firstSeen) < 6 * 3600000);
  band.hidden = false; band.classList.toggle('hot', !!hot);
  band.innerHTML = hot ? `${level(hot.assess.level)}<span>${esc(hot.title)}</span><small>${esc(ago(hot.firstSeen))} · 이슈 보기</small>`
    : latest.briefing ? `<span class="iss-level l-watch">브리핑</span><span>${esc(latest.briefing.headline)}</span><small>${esc(time(latest.briefing.at))} · 이슈 보기</small>` : '';
  if (!hot && !latest.briefing) band.hidden = true;
}

async function load(force = false) {
  if (loading && !force) return loading;
  loading = (async () => {
    try { latest = await getJson('/api/issues?file=latest'); } catch (e) { latest = { available: false, error: e.message }; }
    $('#iss-updated').textContent = latest?.available ? `봇 갱신 ${ago(latest.updatedAt)}` : '';
    renderNow(); renderMarkets(); renderMine(); placeBand();
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
window.addEventListener('teamquant:page', () => { placeBand(); if (document.querySelector('.view.active')?.dataset.page === 'issues' && (!latest || Date.now() - (latest._at || 0) > 120000)) void load().then(() => { if (latest) latest._at = Date.now(); }); });
setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5 * 60000);
void load().then(() => { if (latest) latest._at = Date.now(); });
