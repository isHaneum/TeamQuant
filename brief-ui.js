// 내 자산 홈: 왼쪽은 숫자 요약 · 월별 자산 · 오늘 시장 이유 · 매매 성적표, 오른쪽은 보유 종목.
// 실제 보유·주문 자료는 이 탭의 메모리에서만 쓰고 저장·전송하지 않는다(시세·뉴스·공시 조회에는 종목 이름·코드만 보낸다).
import { composeBrief } from '/lib/market-brief.js';
import { adviseDca } from '/lib/dca-advisor.js';
import { buildAssetTimeline, koreaDay } from '/lib/asset-timeline.js';
import { reviewTrades } from '/lib/trade-review.js';
import { marketReasons, marketQuery } from '/lib/market-reasons.js';
import { privateRead } from '/bridge-client.js';
import { stockName } from '/lib/instruments.js';

const $ = s => root?.querySelector(s) || document.querySelector(s); // 홈에 붙기 전에도 리포트 영역 안에서 찾는다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
const pp = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : '—';
const toneClass = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const won = v => { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e8 ? `${s}${(a / 1e8).toFixed(a >= 1e10 ? 0 : 2)}억원` : a >= 1e4 ? `${s}${Math.round(a / 1e4).toLocaleString('ko-KR')}만원` : `${s}${Math.round(a).toLocaleString('ko-KR')}원`; };
const signedWon = v => Number.isFinite(v) ? (v > 0 ? '+' : '') + won(v) : '—';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const today = () => koreaDay(Date.now());

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/brief.css?v=home-20261105'; document.head.append(css);

const root = document.createElement('section'); root.className = 'hm'; root.id = 'report';
root.innerHTML = `
<div class="hm-main">
  <div class="hm-kpis" id="hm-kpis">${['지금 평가액', '넣은 돈 (매입 원금)', '평가 손익', '오늘 변동'].map(l => `<div><span>${l}</span><b class="shimmer">&nbsp;</b><small>&nbsp;</small></div>`).join('')}</div>
  <article class="hm-card" id="hm-trend">
    <header><div><h3>월별 주식 자산</h3><p>막대는 월말 평가액, 선은 그때까지 넣은 돈입니다. 막대가 선보다 높으면 이익입니다.</p></div></header>
    <div id="hm-trend-chart" class="hm-chart"><p class="hm-note">계좌를 불러오면 최근 1년 체결 내역으로 월별 자산을 계산합니다.</p></div>
    <p class="hm-note" id="hm-trend-note"></p>
  </article>
  <article class="hm-card" id="hm-why">
    <header><div><h3>오늘 시장은 왜 움직였나</h3><p>장 마감 기사에 실제로 나온 이유를 모았습니다. 제목을 누르면 원문이 열립니다.</p></div></header>
    <div class="hm-why-grid" id="hm-why-body"><p class="hm-note">보유 종목이 있는 시장(국내·미국)의 기사를 찾습니다.</p></div>
  </article>
  <article class="hm-card" id="hm-grade">
    <header><div><h3>내 매매 성적표</h3><p>최근 1년 동안 실제로 사고판 것이 잘한 선택이었는지, 같은 날 시장 지수를 샀을 때와 비교합니다.</p></div></header>
    <div id="hm-grade-body"><p class="hm-note">계좌를 불러오면 자동으로 채점합니다.</p></div>
  </article>
</div>
<aside class="hm-side">
  <div class="hm-side-head"><h3>보유 종목</h3><span id="hm-count"></span></div>
  <ol id="hm-list" class="hm-list"><li class="hm-empty">계좌를 불러오는 중입니다.</li></ol>
  <p class="hm-note">종목을 누르면 오늘 움직인 이유, 실적, 공시를 봅니다.</p>
</aside>`;
const dialog = document.createElement('dialog'); dialog.className = 'hm-dialog'; dialog.innerHTML = '<div class="hm-dialog-head"><div><strong id="hm-d-title"></strong><small id="hm-d-sub"></small></div><button type="button" class="text-button" id="hm-d-close">닫기 ✕</button></div><div id="hm-d-body" class="rp"></div>';
document.body.append(dialog);
dialog.querySelector('#hm-d-close').onclick = () => dialog.close();
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

// 홈(#overview)은 다른 모듈이 나중에 만든다. 생긴 뒤에 붙이고, 예전 구성은 지우지 않고 맨 아래에 접어 둔다.
const more = document.createElement('details'); more.className = 'rp-more hm-more'; more.innerHTML = '<summary>예전 화면 도구 (모의 자산 · 목표 계획 · 관측 이력)</summary>';
function mount() {
  const home = document.querySelector('#overview'), head = home?.querySelector(':scope > .page-head');
  if (!home || !head) return false;
  if (!root.isConnected) head.after(root);
  for (const node of [...home.children]) if (node !== head && node !== root && node !== more && !node.matches('p.muted[role="status"]')) more.append(node);
  if (!more.isConnected) home.append(more);
  home.classList.add('hm-home');
  return true;
}
if (!mount()) {
  const watcher = new MutationObserver(() => { if (mount()) watcher.disconnect(); });
  watcher.observe(document.body, { childList: true, subtree: true });
}
window.addEventListener('teamquant:page', () => { if (root.isConnected) mount(); });

let snapshot = null, briefs = new Map(), epoch = 0, reasons = {}, dca = null;
const series = new Map();

async function getJson(url, signal) {
  const r = await fetch(url, { signal }); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d;
}
async function marketFor(position, signal) {
  const key = position.symbol;
  if (series.has(key)) return series.get(key);
  const p = (async () => {
    if (position.currency === 'KRW' && /^\d[\dA-Z]{5}$/.test(position.symbol)) {
      for (const suffix of ['.KS', '.KQ']) {
        try { const d = await getJson(`/api/market?symbol=${position.symbol}${suffix}&range=1y`, signal); if (d.currency === 'KRW') return { ...d, index: suffix === '.KS' ? ['^KS11', '코스피'] : ['^KQ11', '코스닥'] }; } catch (e) { if (e.name === 'AbortError') throw e; }
      }
      throw new Error('시세를 찾지 못했습니다.');
    }
    const d = await getJson(`/api/market?symbol=${encodeURIComponent(position.symbol.replace(/\./g, '-'))}&range=1y`, signal);
    return { ...d, index: ['^GSPC', 'S&P 500'] };
  })();
  series.set(key, p); p.catch(() => series.delete(key));
  return p;
}
const indexCache = new Map();
function indexSeries(symbol, signal) {
  if (!indexCache.has(symbol)) { const p = getJson(`/api/market?symbol=${encodeURIComponent(symbol)}&range=1y`, signal); indexCache.set(symbol, p); p.catch(() => indexCache.delete(symbol)); }
  return indexCache.get(symbol);
}
const valueKrw = (amount, currency, fx) => currency === 'KRW' ? amount : fx?.midRate ? amount * fx.midRate : null;

function decompositionBar(move) {
  if (!move?.available) return '<p class="rp-muted">시장 지수와 같은 날 자료가 없어 시장 몫을 나누지 못했습니다.</p>';
  const total = Math.abs(move.expected) + Math.abs(move.own) || 1, m = Math.abs(move.expected) / total * 100;
  return `<div class="rp-split" aria-label="오늘 움직임 구성"><div class="rp-split-bar"><span class="mkt" style="--w:${m.toFixed(1)}%"></span><span class="own" style="--w:${(100 - m).toFixed(1)}%"></span></div>
  <div class="rp-split-legend"><span><i class="mkt"></i>시장 몫 ${pct(move.expected)}</span><span><i class="own"></i>종목 고유 ${pct(move.own)}</span><span class="rp-muted">시장 ${pct(move.market)} · 민감도 ${move.beta}배</span></div></div>`;
}

function gauge(price) {
  if (!price?.typicalMove) return '';
  const ratio = Math.min(3, price.moveRatio || 0), w = ratio / 3 * 100;
  const label = ratio < 0.6 ? '평소보다 작음' : ratio < 1.5 ? '평소 수준' : ratio < 2.5 ? '평소보다 큼' : '이례적으로 큼';
  return `<div class="rp-gauge"><div class="rp-gauge-track"><span style="--w:${w.toFixed(0)}%"></span><i style="left:${(1 / 3 * 100).toFixed(1)}%"></i></div><small>오늘 움직임: <b>${label}</b> (평소 하루 ±${price.typicalMove}%)</small></div>`;
}

function chart(b, stockCandles, indexCandles, avgCost) {
  const c = stockCandles.slice(-60); if (c.length < 10) return '';
  const idx = new Map(indexCandles.map(x => [x.date, x.close])), base = c[0].close, ib = idx.get(c[0].date);
  const W = 640, H = 170, P = 10;
  const s = c.map(x => x.close / base * 100), m = ib ? c.map(x => idx.has(x.date) ? idx.get(x.date) / ib * 100 : null) : [];
  const vals = [...s, ...m.filter(v => v !== null)], avg = avgCost > 0 ? avgCost / base * 100 : null;
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.25;
  // 평균 매입가가 가격 범위 근처일 때만 축에 포함한다. 멀면 축을 늘리지 않고 글로 알린다.
  const avgInView = avg !== null && avg >= lo0 - pad && avg <= hi0 + pad;
  const lo = Math.min(lo0, avgInView ? avg : lo0), hi = Math.max(hi0, avgInView ? avg : hi0), span = hi - lo || 1;
  const avgNote = avg !== null && !avgInView ? `<span class="rp-muted">내 평균 매입가는 그래프 ${avg < lo0 ? '아래' : '위'}(현재가 대비 ${pct((avgCost / c.at(-1).close - 1) * 100)})</span>` : '';
  const X = i => P + i / (c.length - 1) * (W - P * 2), Y = v => P + (hi - v) / span * (H - P * 2);
  const path = arr => arr.map((v, i) => v === null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const marks = [...(b.disclosures || []).map(d => ({ date: d.date, label: d.label, kind: 'd' })), ...(b.news || []).map(n => ({ date: n.date, label: n.categoryLabel, kind: 'n' }))]
    .map(x => ({ ...x, i: c.findIndex(k => k.date >= x.date) })).filter(x => x.i >= 0);
  return `<figure class="rp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 60거래일 ${esc(b.name)}와 시장 비교">
    ${avgInView ? `<line class="avg" x1="${P}" x2="${W - P}" y1="${Y(avg)}" y2="${Y(avg)}"/><text class="avg-t" x="${W - P}" y="${Y(avg) - 4}" text-anchor="end">내 평균 매입가</text>` : ''}
    ${m.length ? `<polyline class="mkt" points="${path(m)}"/>` : ''}<polyline class="stk ${toneClass(b.price.month)}" pathLength="1" points="${path(s)}"/>
    ${marks.map(x => `<circle class="mark ${x.kind}" cx="${X(x.i)}" cy="${Y(s[x.i])}" r="4"><title>${esc(x.date + ' ' + x.label)}</title></circle>`).join('')}
  </svg><figcaption><span><i class="stk"></i>${esc(b.name)}</span>${m.length ? `<span><i class="mkt"></i>${esc(b.marketName)}</span>` : ''}<span><i class="mark"></i>공시·기사</span><span class="rp-muted">최근 60거래일, 시작일=100</span>${avgNote}</figcaption></figure>`;
}

function finTable(f) {
  if (!f) return '<p class="rp-muted">실적 자료 없음 (ETF·해외 종목이거나 DART 미제공)</p>';
  const row = (label, a, g) => { if (!a) return ''; const cur = a.current, prev = a.previous, max = Math.max(Math.abs(cur || 0), Math.abs(prev || 0)) || 1;
    const fmt = v => v === null ? '—' : `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억`;
    return `<div class="rp-fin-row"><span>${label}</span><div class="rp-fin-bars"><b class="prev" style="--w:${(Math.abs(prev || 0) / max * 100).toFixed(0)}%"></b><b class="cur ${toneClass(g)}" style="--w:${(Math.abs(cur || 0) / max * 100).toFixed(0)}%"></b></div><em class="${toneClass(g)}">${fmt(cur)} · ${pct(g)}</em></div>`; };
  return `<div class="rp-fin"><p class="rp-muted">${esc(f.year)}년 ${esc(f.period)} · ${esc(f.basis)} · 회색=전년 같은 기간</p>${row('매출', f.accounts.revenue, f.growth.revenue)}${row('영업이익', f.accounts.operatingIncome, f.growth.operatingIncome)}${row('순이익', f.accounts.netIncome, f.growth.netIncome)}</div>`;
}


const CONF = { high: '근거 강함', medium: '근거 보통', low: '참고' };
const scopeOf = currency => currency === 'USD' ? 'US' : 'KR';
const nameOf = symbol => snapshot?.positions?.find(p => p.symbol === symbol)?.name || stockName(symbol);

// ── 숫자 요약 ───────────────────────────────────────────────
function renderKpis(positions) {
  const sum = key => positions.reduce((s, p) => s + (p[key] ?? NaN), 0);
  const value = sum('valueKrw'), cost = sum('costKrw'), gain = value - cost, daily = sum('dailyKrw');
  const ok = list => list.filter(b => b?.available);
  const done = ok([...briefs.values()]), total = positions.reduce((s, p) => s + (p.valueKrw || 0), 0);
  const weighted = done.length === positions.length && total ? done.reduce((s, b) => s + (positions.find(p => p.symbol === b.symbol)?.valueKrw || 0) / total * b.price.dayReturn, 0) : null;
  const dayPct = Number.isFinite(daily) && value ? daily / (value - daily) * 100 : weighted;
  const when = snapshot?.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  const tiles = [
    ['지금 평가액', won(value), `${positions.length}종목 · ${when} 조회 · 현금 제외`, ''],
    ['넣은 돈 (매입 원금)', won(cost), positions.some(p => p.currency === 'USD') ? '달러 종목은 현재 환율로 환산' : '지금 보유 종목을 산 금액', ''],
    ['평가 손익', signedWon(gain), cost ? `수익률 ${pct(gain / cost * 100)}` : '', toneClass(gain)],
    ['오늘 변동', Number.isFinite(daily) ? signedWon(daily) : Number.isFinite(dayPct) ? pct(dayPct) : '계산 중…', Number.isFinite(daily) ? pct(dayPct) : '보유 비중 기준', toneClass(Number.isFinite(daily) ? daily : dayPct)]
  ];
  $('#hm-kpis').innerHTML = tiles.map(([l, v, s, t], i) => `<div style="--i:${i}"><span>${l}</span><b class="${t}">${esc(v)}</b><small>${esc(s)}</small></div>`).join('');
}

// ── 보유 종목(오른쪽) ────────────────────────────────────────
function oneLiner(b) {
  if (!b) return '<span class="hm-muted">오늘 움직임 분석 중…</span>';
  if (!b.available) return esc(b.headline);
  const c = b.causes[0], r = reasons[scopeOf(b.currency)], theme = r?.themes?.slice(0, 2).map(t => t.label).join(', ');
  if (b.price.moveRatio !== null && b.price.moveRatio < 0.6) return '평소 범위의 작은 움직임';
  if (c?.kind === 'market') return `${esc(b.marketName)} ${pct(b.move.market)} 흐름에 따라 ${b.price.dayReturn < 0 ? '하락' : '상승'}${theme ? ` · 시장 이유: <b>${esc(theme)}</b>` : ''}`;
  if (c && c.kind !== 'unknown' && c.fits !== false && c.confidence !== 'low') return esc(c.title.replace(/^\d{4}-\d{2}-\d{2} /, ''));
  return '시장과 따로 움직임 · 같은 시점의 관련 기사·공시 없음';
}
function renderList(positions) {
  const list = [...positions].sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0));
  const verdicts = new Map((dca?.items || []).map(x => [x.symbol, x]));
  $('#hm-count').textContent = `${list.length}종목`;
  $('#hm-list').innerHTML = list.map((p, i) => {
    const b = briefs.get(p.symbol), day = b?.available ? b.price.dayReturn : null, v = verdicts.get(p.symbol);
    return `<li style="--i:${i}"><button type="button" data-symbol="${esc(p.symbol)}">
      <div class="hm-row"><strong>${esc(p.name)}</strong><span class="hm-day ${toneClass(day)}">${day === null ? '' : pct(day)}</span></div>
      <div class="hm-row hm-sub"><span>${won(p.valueKrw)}</span><span class="${toneClass(p.returnPct)}">내 수익 ${pct(p.returnPct)}</span></div>
      <div class="hm-weight" title="보유 비중"><i style="--w:${Math.max(2, p.weightPct || 0).toFixed(1)}%"></i><small>${Number.isFinite(p.weightPct) ? p.weightPct.toFixed(0) + '%' : ''}</small></div>
      <p class="hm-reason">${oneLiner(b)}</p>
      ${v ? `<span class="hm-tag v-${v.verdict}">적립: ${esc(v.label)}</span>` : ''}
    </button></li>`;
  }).join('') || '<li class="hm-empty">보유 주식이 없습니다.</li>';
  $('#hm-list').querySelectorAll('button[data-symbol]').forEach(btn => btn.onclick = () => openDetail(btn.dataset.symbol));
}

// ── 종목 상세(대화상자) ──────────────────────────────────────
function openDetail(symbol) {
  const b = briefs.get(symbol), p = snapshot?.positions?.find(x => x.symbol === symbol);
  $('#hm-d-title').textContent = p?.name || symbol;
  $('#hm-d-sub').textContent = `${symbol}${b?.available ? ` · 오늘 ${pct(b.price.dayReturn)}` : ''}${p ? ` · 내 수익 ${pct(p.returnPct)}` : ''}`;
  $('#hm-d-body').innerHTML = !b ? '<p class="hm-note">아직 분석 중입니다. 잠시 뒤 다시 눌러 주십시오.</p>' : !b.available ? `<p class="hm-note">${esc(b.headline)}</p>` : detailHtml(b, p);
  $('#hm-d-body').querySelectorAll('[data-count]').forEach(countUp);
  if (!dialog.open) dialog.showModal();
}
function detailHtml(b, p) {
  const r = reasons[scopeOf(b.currency)], v = dca?.items?.find(x => x.symbol === b.symbol);
  const marketBox = b.causes[0]?.kind === 'market' && r?.available ? `<div class="hm-mkt-box"><b>${esc(b.marketName)}가 ${pct(b.move.market)} 움직인 이유 · 장 마감 기사</b><p>${esc(r.summary)}</p>${r.articles.slice(0, 2).map(a => safeUrl(a.link) ? `<a href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>` : '').join('')}</div>` : '';
  return `<article class="rp-card open hm-detail-card"><div class="rp-detail"><div class="rp-detail-inner">
    <h4>오늘 움직임 나누기</h4>${decompositionBar(b.move)}${gauge(b.price)}
    <h4>왜 움직였나</h4>${marketBox}<ul class="rp-causes">${b.causes.map(c => `<li class="c-${c.confidence}"><span class="rp-conf">${CONF[c.confidence]}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>${c.link && safeUrl(c.link) ? `<a href="${esc(safeUrl(c.link))}" target="_blank" rel="noopener noreferrer">${c.kind === 'disclosure' ? '공시 원문' : '기사 보기'}${c.source ? ' · ' + esc(c.source) : ''}</a>` : ''}</div></li>`).join('') || '<li><div><b>시장과 비슷하게 움직였습니다</b></div></li>'}</ul>
    ${chart(b, b.candles || [], b.indexCandles || [], p?.avgCost)}
    <h4>큰 흐름</h4><div class="rp-context">${b.context.map(x => `<div class="${toneClass(x.tone)}"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div>
    <h4>실적</h4>${finTable(b.financials)}
    ${b.disclosures.length || b.news.length ? `<h4>최근 공시·기사</h4><ul class="rp-list">${b.disclosures.map(d => `<li><span class="rp-tag d">공시</span>${esc(d.date)} ${safeUrl(d.link) ? `<a href="${esc(safeUrl(d.link))}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a>` : esc(d.title)}</li>`).join('')}${b.news.map(n => `<li><span class="rp-tag n">${esc(n.categoryLabel)}</span>${esc(n.date)} ${safeUrl(n.link) ? `<a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</li>`).join('')}</ul>` : ''}
    ${v ? `<h4>적립식이라면: ${esc(v.label)}</h4><ul class="hm-lines">${v.reasons.map(x => `<li class="${toneClass(x.tone)}">${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <div class="rp-checks"><h4>지금 점검할 것</h4><ol>${b.checks.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
    <p class="rp-muted">${esc(b.caveat)}</p>
  </div></div></article>`;
}
function countUp(node) {
  const target = Number(node.dataset.count); if (!Number.isFinite(target) || reduceMotion) return;
  const t0 = performance.now(), dur = 700;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3, v = target * e; node.textContent = `${v > 0 ? '+' : ''}${v.toFixed(2)}%`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ── 오늘 시장 이유 ───────────────────────────────────────────
function renderWhy() {
  const cols = ['KR', 'US'].filter(s => reasons[s]);
  if (!cols.length) return;
  $('#hm-why-body').innerHTML = cols.map(s => {
    const r = reasons[s];
    if (r.error) return `<div class="hm-why-col"><div class="hm-why-idx"><span>${esc(r.name)}</span></div><p class="hm-note">${esc(r.error)}</p></div>`;
    return `<div class="hm-why-col"><div class="hm-why-idx"><span>${esc(r.name)} ${r.asOf ? `<small>${esc(r.asOf)} 종가</small>` : ''}</span><b class="${toneClass(r.change)}">${pct(r.change)}</b></div>
      <p class="hm-why-sum">${esc(r.summary)}</p>
      ${r.themes.length ? `<div class="hm-chips">${r.themes.slice(0, 5).map(t => `<span>${esc(t.label)} <small>${t.count}</small></span>`).join('')}</div>` : ''}
      <ol class="hm-articles">${r.articles.map(a => `<li>${safeUrl(a.link) ? `<a href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>` : esc(a.title)}${a.description ? `<p>${esc(a.description)}</p>` : ''}<small>${esc(a.sourceHost || '')}${a.publishedAt ? ' · ' + new Date(a.publishedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</small></li>`).join('')}</ol></div>`;
  }).join('');
}
async function loadReasons(positions, run, signal) {
  const scopes = [...new Set(positions.map(p => scopeOf(p.currency)))];
  await Promise.all(scopes.map(async s => {
    const [sym, name] = s === 'KR' ? ['^KS11', '코스피'] : ['^GSPC', 'S&P 500'];
    try {
      const [idx, news] = await Promise.all([indexSeries(sym, signal).catch(() => null), getJson(`/api/news?query=${encodeURIComponent(marketQuery(s))}&sort=date`, signal)]);
      const c = idx?.candles || [], change = c.length > 1 ? (c.at(-1).close / c.at(-2).close - 1) * 100 : null;
      if (run !== epoch) return;
      reasons[s] = { name, change, asOf: c.at(-1)?.date, ...marketReasons(news.items, { scope: s, direction: Math.sign(change || 0) }) };
    } catch (e) { if (e.name === 'AbortError' || run !== epoch) return; reasons[s] = { name, error: `기사를 불러오지 못했습니다 (${e.message}).`, themes: [] }; }
  }));
  if (run !== epoch) return;
  renderWhy(); renderList(current());
}

// ── 월별 자산 그래프 ─────────────────────────────────────────
function trendSvg(points) {
  const W = 760, H = 270, L = 64, R = 12, T = 16, B = 34, n = points.length, band = (W - L - R) / n;
  const vals = points.flatMap(p => [p.value, p.principal]).filter(Number.isFinite), max = Math.max(...vals, 1) * 1.08;
  const Y = v => T + (1 - v / max) * (H - T - B), ticks = [0, .25, .5, .75, 1].map(k => max * k);
  const label = (p, i) => { const [y, m] = p.month.split('-'); return i === 0 || m === '01' ? `${y.slice(2)}.${+m}월` : `${+m}월`; };
  const line = points.map((p, i) => Number.isFinite(p.principal) ? [L + band * (i + .5), Y(p.principal)] : null);
  const segs = []; let cur = []; for (const pt of line) { if (pt) cur.push(pt); else if (cur.length) { segs.push(cur); cur = []; } } if (cur.length) segs.push(cur);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 주식 평가액과 넣은 돈">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ytick" x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${won(t).replace('원', '')}</text>`).join('')}
    ${points.map((p, i) => { const x = L + band * i + band * .2, w = band * .6;
      const bar = Number.isFinite(p.value) ? `<rect class="bar ${p.current ? 'now ' : ''}${Number.isFinite(p.principal) ? toneClass(p.value - p.principal) : ''}" x="${x}" y="${Y(p.value)}" width="${w}" height="${Math.max(1, Y(0) - Y(p.value))}" rx="4" style="--i:${i}"/>` : `<rect class="bar none" x="${x}" y="${Y(max * .12)}" width="${w}" height="${Y(0) - Y(max * .12)}" rx="4"/>`;
      return `${bar}<text class="xtick" x="${L + band * (i + .5)}" y="${H - 12}" text-anchor="middle">${label(p, i)}</text><rect class="hit" data-i="${i}" tabindex="0" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"><title>${esc(readout(p))}</title></rect>`; }).join('')}
    ${segs.map(s => `<polyline class="principal" points="${s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`).join('')}
    ${line.map(pt => pt ? `<circle class="principal-dot" cx="${pt[0]}" cy="${pt[1]}" r="3"/>` : '').join('')}
  </svg>`;
}
function readout(p) {
  const [y, m] = p.month.split('-'), head = p.current ? `지금 (${+m}월 ${+p.date.slice(8)}일)` : `${y}년 ${+m}월 말`;
  if (!Number.isFinite(p.value)) return `${head} · 자료 없음${p.reason ? ' (' + p.reason + ')' : ''}`;
  const gain = Number.isFinite(p.principal) ? p.value - p.principal : null;
  return `${head} · 평가액 ${won(p.value)} · 넣은 돈 ${won(p.principal)}${gain === null ? '' : ` · 손익 ${signedWon(gain)}${p.principal > 0 ? ` (${pct(gain / p.principal * 100)})` : ''}`}`;
}
function renderTrend(t, report) {
  const box = $('#hm-trend-chart');
  box.innerHTML = `<p class="hm-readout" id="hm-readout">${esc(readout(t.points.at(-1)))}</p>${trendSvg(t.points)}<div class="hm-legend"><span><i class="bar up"></i>월말 평가액 (넣은 돈보다 많음)</span><span><i class="bar down"></i>넣은 돈보다 적음</span><span><i class="line"></i>넣은 돈</span></div>`;
  const out = $('#hm-readout'), def = out.textContent;
  box.querySelectorAll('.hit').forEach(h => { const show = () => { out.textContent = readout(t.points[+h.dataset.i]); box.querySelectorAll('.hit').forEach(x => x.classList.toggle('on', x === h)); };
    h.addEventListener('mouseenter', show); h.addEventListener('focus', show); h.addEventListener('mouseleave', () => { out.textContent = def; h.classList.remove('on'); }); });
  const notes = [];
  if (Number.isFinite(t.periodGain) && t.from) notes.push(`${t.from.slice(0, 7).replace('-', '년 ')}월 말 이후 투자 손익 <b class="${toneClass(t.periodGain)}">${signedWon(t.periodGain)}</b> (넣고 뺀 돈은 빼고 계산)`);
  notes.push(`최근 1년 체결 ${t.fills}건으로 계산 · 현금 제외 · 달러 종목은 그 달 환율 적용`);
  if (!report.paginationComplete) notes.push('주문이 많아 일부만 조회되어 앞쪽 달은 비워 두었습니다.');
  notes.push(...t.warnings.map(esc));
  $('#hm-trend-note').innerHTML = notes.join(' · ');
}

// ── 매매 성적표 ──────────────────────────────────────────────
function renderGrade(r) {
  const body = $('#hm-grade-body');
  if (!r.available) { body.innerHTML = `<p class="hm-note">최근 1년 동안 채점할 체결이 없습니다${r.pending ? ` (최근 3일 안 체결 ${r.pending}건은 결과를 보기엔 일러 제외)` : ''}.</p>`; return; }
  const tile = (title, s, good) => !s.count ? `<div><span>${title}</span><b>없음</b><small>&nbsp;</small></div>` : `<div><span>${title} ${s.count}건</span><b class="${toneClass(s.edge)}">${s.edge === null ? '비교 불가' : '지수 대비 ' + pp(s.edge)}</b><small>${good} ${s.good}/${s.compared}건</small></div>`;
  const pick = (label, x, kind) => x ? `<li><span>${label}</span><b>${esc(nameOf(x.symbol))}</b> ${esc(x.date)} ${x.side === 'BUY' ? '매수' : '매도'} → 지금 ${pct(x.stock)} <small>(같은 기간 ${esc(x.indexName || '지수')} ${pct(x.market)})</small><em class="${kind}">${x.side === 'BUY' ? `지수보다 ${pp(x.edge)}` : x.edge < 0 ? `판 뒤 지수보다 ${Math.abs(x.edge).toFixed(1)}%p 더 오름` : `판 뒤 지수보다 ${x.edge.toFixed(1)}%p 덜 오름`}</em></li>` : '';
  const sortedRows = [...r.rows].sort((a, b) => b.date.localeCompare(a.date));
  body.innerHTML = `<div class="hm-verdict ${r.score >= 2 ? 'up' : r.score <= -2 ? 'down' : 'flat'}"><b>${esc(r.verdict || '비교 자료 부족')}</b>${Number.isFinite(r.score) ? `<span>매매 전체 평균 지수 대비 ${pp(r.score)}</span>` : ''}</div>
  <div class="hm-grade-grid">${tile('매수', r.buys, '지수보다 더 오른 매수')}${tile('매도', r.sells, '판 뒤 지수보다 덜 오른 매도')}<div><span>수수료·세금</span><b>${won(r.fees)}</b><small>최근 1년 체결 합계</small></div></div>
  <ul class="hm-lines">${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
  <ul class="hm-picks">${pick('가장 잘한 매수', r.best, 'up')}${r.worst && r.worst !== r.best && r.worst.edge < 0 ? pick('가장 아쉬운 매수', r.worst, 'down') : ''}${pick('가장 잘한 매도', r.goodSell, 'up')}${pick('가장 아쉬운 매도', r.regret, 'down')}</ul>
  <details class="hm-trades"><summary>체결별 채점 보기 (${r.rows.length}건${r.pending ? ` · 최근 ${r.pending}건 보류` : ''})</summary><div class="table-wrap"><table><thead><tr><th>날짜</th><th>종목</th><th>매매</th><th>체결가 → 지금</th><th>같은 기간 지수</th><th>판정</th></tr></thead><tbody>${sortedRows.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(nameOf(x.symbol))}</td><td>${x.side === 'BUY' ? '매수' : '매도'}</td><td class="${toneClass(x.stock)}">${pct(x.stock)}</td><td>${pct(x.market)}</td><td class="${toneClass(x.edge)}">${x.edge === null ? '—' : x.edge > 0 ? (x.side === 'BUY' ? '잘 샀음' : '잘 팔았음') : (x.side === 'BUY' ? '지수가 나았음' : '판 뒤 더 오름')}</td></tr>`).join('')}</tbody></table></div>
  <p class="hm-note">매수는 "산 가격 → 지금 가격"을 같은 날 시장 지수를 샀을 때와 비교합니다. 매도는 판 뒤에 그 종목이 지수보다 더 올랐으면 아쉬운 매도로 봅니다. 배당과 환율 변화는 넣지 않았습니다.</p></details>`;
}

async function loadHistory(positions, run, signal) {
  const to = today(), from = new Date(Date.parse(to) - 365 * 86400000).toISOString().slice(0, 10);
  let report;
  try { report = await privateRead('order-history', { from, to, status: 'CLOSED', symbol: '' }, { signal }); }
  catch (e) {
    if (e.name === 'AbortError' || run !== epoch) return;
    const msg = `<p class="hm-note">주문 이력을 불러오지 못해 계산하지 못했습니다 (${esc(e.message)}). 설정에서 PC 연결을 확인하십시오.</p>`;
    $('#hm-trend-chart').innerHTML = msg; $('#hm-grade-body').innerHTML = msg; return;
  }
  if (run !== epoch) return;
  $('#hm-trend-chart').innerHTML = '<div class="shimmer hm-chart-skel"></div>';
  const currencies = new Map(positions.map(p => [p.symbol, p.currency]));
  for (const o of report.orders) if (!currencies.has(o.symbol) && o.execution?.filledQuantity > 0) currencies.set(o.symbol, o.currency);
  const candlesBySymbol = {}, indexes = new Map();
  await Promise.all([...currencies].map(async ([symbol, currency]) => {
    try { const d = await marketFor({ symbol, currency }, signal); candlesBySymbol[symbol] = d.candles; const idx = await indexSeries(d.index[0], signal).catch(() => null); if (idx) indexes.set(symbol, { name: d.index[1], candles: idx.candles }); }
    catch (e) { if (e.name === 'AbortError') throw e; }
  }));
  const fxCandles = [...currencies.values()].includes('USD') ? (await getJson('/api/market?symbol=KRW%3DX&range=1y', signal).catch(() => null))?.candles || [] : [];
  if (run !== epoch) return;
  const oldest = report.orders.map(o => koreaDay(o.orderedAt)).sort()[0];
  const timeline = buildAssetTimeline({ positions, orders: report.orders, candlesBySymbol, fxCandles, fxNow: snapshot.fx?.midRate ?? null, today: to, coverageFrom: report.paginationComplete ? from : oldest, months: 12 });
  renderTrend(timeline, report);
  renderGrade(reviewTrades(report.orders, { candlesBySymbol, indexFor: s => indexes.get(s), priceNow: Object.fromEntries(positions.map(p => [p.symbol, p.price])), fxNow: snapshot.fx?.midRate ?? 1, today: to }));
}

// ── 종목별 오늘 리포트 ───────────────────────────────────────
async function loadBriefs(positions, run, signal) {
  const tasks = positions.map(p => async () => {
    const errors = [];
    try {
      const data = await marketFor(p, signal);
      const [idx, news, dart] = await Promise.all([
        indexSeries(data.index[0], signal).catch(() => { errors.push('시장 지수'); return null; }),
        getJson(`/api/news?query=${encodeURIComponent(p.name)}&sort=date`, signal).catch(() => { errors.push('기사'); return null; }),
        p.currency === 'KRW' && /^\d{6}$/.test(p.symbol) ? getJson(`/api/dart?code=${p.symbol}`, signal).catch(() => { errors.push('공시·실적'); return null; }) : null
      ]);
      if (run !== epoch) return;
      const b = composeBrief({ name: p.name, symbol: p.symbol, currency: p.currency, marketName: data.index[1], candles: data.candles, indexCandles: idx?.candles || [],
        news: news?.items || [], disclosures: Array.isArray(dart?.disclosures) ? dart.disclosures : [], financials: dart?.financials && !dart.financials.error ? dart.financials : null,
        holding: { weightPct: p.weightPct, returnPct: p.returnPct, avgCost: p.avgCost, quantity: p.quantity } });
      Object.assign(b, { marketName: data.index[1], candles: data.candles, indexCandles: idx?.candles || [], errors });
      briefs.set(p.symbol, b);
    } catch (e) {
      if (e.name === 'AbortError' || run !== epoch) return;
      briefs.set(p.symbol, { name: p.name, symbol: p.symbol, available: false, headline: `시세를 가져오지 못했습니다 (${e.message}).` });
    }
  });
  for (let k = 0; k < tasks.length; k += 3) { await Promise.all(tasks.slice(k, k + 3).map(t => t())); if (run !== epoch) return; renderList(positions); }
  dca = adviseDca(positions, Object.fromEntries(briefs), null);
  renderList(positions); renderKpis(positions);
}

function current() {
  if (!snapshot?.positions) return [];
  const fx = snapshot.fx;
  const positions = snapshot.positions.map(p => ({ ...p, valueKrw: valueKrw(p.value, p.currency, fx), costKrw: valueKrw(p.cost, p.currency, fx), dailyKrw: p.dailyPnl == null ? null : valueKrw(p.dailyPnl, p.currency, fx) }));
  const total = positions.reduce((s, p) => s + (p.valueKrw || 0), 0);
  for (const p of positions) p.weightPct = total ? (p.valueKrw || 0) / total * 100 : null;
  return positions;
}

async function build() {
  if (!snapshot?.positions) return;
  const run = ++epoch, controller = new AbortController(); build.controller?.abort(); build.controller = controller;
  briefs = new Map(); reasons = {}; dca = null;
  const positions = current();
  document.querySelector('#overview')?.classList.add('hm-loaded');
  renderKpis(positions); renderList(positions);
  $('#hm-trend-chart').innerHTML = '<div class="shimmer hm-chart-skel"></div>'; $('#hm-grade-body').innerHTML = '<div class="shimmer rp-line"></div><div class="shimmer rp-line short"></div>';
  $('#hm-why-body').innerHTML = '<div class="shimmer rp-line"></div><div class="shimmer rp-line short"></div>';
  if (!positions.length) return;
  await Promise.allSettled([loadBriefs(positions, run, controller.signal), loadReasons(positions, run, controller.signal), loadHistory(positions, run, controller.signal)]);
}

window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; void build(); });
window.addEventListener('teamquant:asset-clear', () => {
  epoch++; build.controller?.abort(); snapshot = null; briefs = new Map(); reasons = {}; dca = null; series.clear();
  document.querySelector('#overview')?.classList.remove('hm-loaded'); if (dialog.open) dialog.close();
  $('#hm-list').innerHTML = '<li class="hm-empty">화면의 자산 정보를 지웠습니다.</li>'; $('#hm-count').textContent = '';
  $('#hm-trend-chart').replaceChildren(); $('#hm-trend-note').replaceChildren(); $('#hm-grade-body').replaceChildren(); $('#hm-why-body').replaceChildren();
});
