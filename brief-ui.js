// 내 자산 홈: 보유 종목 종합 리포트 · 매매 습관 점검 · 적립식 점검.
// 실제 보유·주문 자료는 이 탭의 메모리에서만 쓰고 저장·전송하지 않는다(시세·뉴스·공시 조회에는 종목 이름·코드만 보낸다).
import { composeBrief, summarizePortfolio } from '/lib/market-brief.js';
import { analyzeHabits } from '/lib/trading-habits.js';
import { adviseDca } from '/lib/dca-advisor.js';
import { privateRead } from '/bridge-client.js';

const $ = s => root.querySelector(s); // 리포트 영역 안에서만 찾는다(홈에 붙기 전에도 동작).
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
const toneClass = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/brief.css?v=20261105'; document.head.append(css);

const root = document.createElement('section'); root.className = 'rp'; root.id = 'report';
root.innerHTML = `
<header class="rp-hero">
  <div><p class="rp-eyebrow" id="rp-date">오늘의 내 주식 리포트</p><h2 id="rp-headline">보유 종목을 불러오면 오늘 왜 움직였는지 정리해 드립니다.</h2>
  <p class="rp-sub" id="rp-sub">시장 지수 · 공시 · 기사 · 실적을 함께 보고, 확인된 근거만 원인 후보로 보여줍니다.</p></div>
  <div class="rp-market" id="rp-market"></div>
</header>
<div class="rp-cards" id="rp-cards"></div>
<section class="rp-block" id="rp-habits"><div class="rp-block-head"><div><h3>내 매매 습관 점검</h3><p>최근 90일 실제 체결 내역으로 "감으로 사고판" 패턴이 있는지 봅니다.</p></div><button class="secondary" id="rp-habits-run">점검하기</button></div><div id="rp-habits-body"></div></section>
<section class="rp-block" id="rp-dca"><div class="rp-block-head"><div><h3>적립식이라면, 계속 이 종목들로 갈까?</h3><p>가격이 아니라 실적·비중·변동성·매매 습관으로 판단합니다.</p></div></div><div id="rp-dca-body"><p class="rp-muted">리포트가 준비되면 보여드립니다.</p></div></section>
<p class="rp-caveat">시장 몫은 과거 1년 동조성으로 추정한 값이고, 기사·공시는 같은 시점에 나온 원인 후보입니다. 매수·매도 권유가 아니며 실제 주문을 하지 않습니다.</p>`;
// 홈(#overview)은 다른 모듈이 나중에 만든다. 생긴 뒤에 붙이고, 기존 구성은 지우지 않고 "자산 상세"로 접는다.
const more = document.createElement('details'); more.className = 'rp-more'; more.innerHTML = '<summary>자산 상세 · 원칙 · 기록</summary>';
function mount() {
  const home = document.querySelector('#overview'), head = home?.querySelector(':scope > .page-head');
  if (!home || !head) return false;
  if (!root.isConnected) head.after(root);
  for (const node of [...home.children]) if (node !== head && node !== root && node !== more && !node.matches('p.muted[role="status"]')) more.append(node);
  if (!more.isConnected) home.append(more);
  return true;
}
if (!mount()) {
  const watcher = new MutationObserver(() => { if (mount()) watcher.disconnect(); });
  watcher.observe(document.body, { childList: true, subtree: true });
}
// 다른 모듈이 홈에 패널을 더 붙이면 계속 상세로 모은다.
window.addEventListener('teamquant:page', () => { if (root.isConnected) mount(); });

let snapshot = null, briefs = new Map(), habits = null, epoch = 0;
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

function valueKrw(p, fx) { return p.currency === 'KRW' ? p.value : fx?.midRate ? p.value * fx.midRate : null; }

function skeleton(p, i) {
  return `<article class="rp-card is-loading" style="--i:${i}" data-symbol="${esc(p.symbol)}"><div class="rp-card-top"><div><strong>${esc(p.name)}</strong><small>${esc(p.symbol)}</small></div><span class="rp-chip shimmer">&nbsp;</span></div><div class="shimmer rp-line"></div><div class="shimmer rp-line short"></div></article>`;
}

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
function cardHtml(b, i, extra) {
  if (!b.available) return `<article class="rp-card" style="--i:${i}"><div class="rp-card-top"><div><strong>${esc(b.name)}</strong><small>${esc(b.symbol)}</small></div></div><p class="rp-muted">${esc(b.headline)}</p></article>`;
  const h = b.holding || {};
  return `<article class="rp-card tone-${toneClass(b.tone)}" style="--i:${i}" data-symbol="${esc(b.symbol)}">
  <button class="rp-card-main" aria-expanded="false">
    <div class="rp-card-top"><div><strong>${esc(b.name)}</strong><small>${esc(b.symbol)} · 비중 ${Number.isFinite(h.weightPct) ? h.weightPct.toFixed(0) + '%' : '—'} · 내 수익률 <span class="${toneClass(h.returnPct)}">${pct(h.returnPct)}</span></small></div>
      <span class="rp-chip ${toneClass(b.price.dayReturn)}" data-count="${b.price.dayReturn}">${pct(b.price.dayReturn)}</span></div>
    <p class="rp-headline">${esc(b.headline.replace(/^.*? [+-−]?[\d.]+% · /, ''))}</p>
    ${decompositionBar(b.move)}${gauge(b.price)}
    <span class="rp-open">자세히 보기</span>
  </button>
  <div class="rp-detail"><div class="rp-detail-inner">
    <h4>왜 움직였나</h4><ul class="rp-causes">${b.causes.map(c => `<li class="c-${c.confidence}"><span class="rp-conf">${CONF[c.confidence]}</span><div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p>${c.link && safeUrl(c.link) ? `<a href="${esc(safeUrl(c.link))}" target="_blank" rel="noopener noreferrer">${c.kind === 'disclosure' ? '공시 원문' : '기사 보기'}${c.source ? ' · ' + esc(c.source) : ''}</a>` : ''}</div></li>`).join('') || '<li><div><b>시장과 비슷하게 움직였습니다</b></div></li>'}</ul>
    ${extra.chart}
    <h4>큰 흐름</h4><div class="rp-context">${b.context.map(x => `<div class="${toneClass(x.tone)}"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div>
    <h4>실적</h4>${finTable(b.financials)}
    ${b.disclosures.length || b.news.length ? `<h4>최근 공시·기사</h4><ul class="rp-list">${b.disclosures.map(d => `<li><span class="rp-tag d">공시</span>${esc(d.date)} ${safeUrl(d.link) ? `<a href="${esc(safeUrl(d.link))}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a>` : esc(d.title)}</li>`).join('')}${b.news.map(n => `<li><span class="rp-tag n">${esc(n.categoryLabel)}</span>${esc(n.date)} ${safeUrl(n.link) ? `<a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</li>`).join('')}</ul>` : ''}
    <div class="rp-checks"><h4>지금 점검할 것</h4><ol>${b.checks.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
    ${extra.errors.length ? `<p class="rp-muted">일부 자료를 가져오지 못했습니다: ${esc(extra.errors.join(' · '))}</p>` : ''}
  </div></div></article>`;
}

function countUp(node) {
  const target = Number(node.dataset.count); if (!Number.isFinite(target) || reduceMotion) return;
  const t0 = performance.now(), dur = 700;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3, v = target * e; node.textContent = `${v > 0 ? '+' : ''}${v.toFixed(2)}%`; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function wire(card) {
  const btn = card.querySelector('.rp-card-main'); if (!btn) return;
  btn.onclick = () => { const open = card.classList.toggle('open'); btn.setAttribute('aria-expanded', String(open)); btn.querySelector('.rp-open').textContent = open ? '접기' : '자세히 보기'; };
  card.querySelectorAll('[data-count]').forEach(countUp);
}

async function build() {
  if (!snapshot?.positions?.length) return;
  const run = ++epoch, controller = new AbortController(); build.controller?.abort(); build.controller = controller;
  const positions = snapshot.positions.map(p => ({ ...p, valueKrw: valueKrw(p, snapshot.fx) }));
  const total = positions.reduce((s, p) => s + (p.valueKrw || 0), 0);
  for (const p of positions) p.weightPct = total ? (p.valueKrw || 0) / total * 100 : null;
  briefs = new Map();
  $('#rp-cards').innerHTML = positions.map(skeleton).join('');
  $('#rp-headline').textContent = `보유 ${positions.length}종목의 오늘 움직임을 분석하고 있습니다…`;
  $('#rp-date').textContent = `오늘의 내 주식 리포트 · ${new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}`;

  const markets = new Map();
  const tasks = positions.map((p, i) => async () => {
    const errors = [];
    try {
      const data = await marketFor(p, controller.signal);
      const [idx, news, dart] = await Promise.all([
        indexSeries(data.index[0], controller.signal).catch(e => { errors.push('시장 지수'); return null; }),
        getJson(`/api/news?query=${encodeURIComponent(p.name)}&sort=date`, controller.signal).catch(() => { errors.push('기사'); return null; }),
        p.currency === 'KRW' && /^\d{6}$/.test(p.symbol) ? getJson(`/api/dart?code=${p.symbol}`, controller.signal).catch(() => { errors.push('공시·실적'); return null; }) : null
      ]);
      if (run !== epoch) return;
      if (idx) markets.set(data.index[0], { name: data.index[1], candles: idx.candles });
      const b = composeBrief({ name: p.name, symbol: p.symbol, currency: p.currency, marketName: data.index[1], candles: data.candles, indexCandles: idx?.candles || [],
        news: news?.items || [], disclosures: Array.isArray(dart?.disclosures) ? dart.disclosures : [], financials: dart?.financials && !dart.financials.error ? dart.financials : null,
        holding: { weightPct: p.weightPct, returnPct: p.returnPct, avgCost: p.avgCost, quantity: p.quantity } });
      b.marketName = data.index[1]; b.candles = data.candles;
      briefs.set(p.symbol, b);
      render(p.symbol, cardHtml(b, i, { chart: chart(b, data.candles, idx?.candles || [], p.avgCost), errors }));
    } catch (e) {
      if (e.name === 'AbortError' || run !== epoch) return;
      const b = { name: p.name, symbol: p.symbol, available: false, headline: `시세를 가져오지 못했습니다 (${e.message}).` };
      briefs.set(p.symbol, b); render(p.symbol, cardHtml(b, i, { chart: '', errors }));
    }
  });
  for (let k = 0; k < tasks.length; k += 3) { await Promise.all(tasks.slice(k, k + 3).map(t => t())); if (run !== epoch) return; }

  const list = positions.map(p => briefs.get(p.symbol)).filter(Boolean), sum = summarizePortfolio(list, positions);
  $('#rp-headline').textContent = sum.headline;
  $('#rp-sub').textContent = Number.isFinite(sum.weightedReturn) ? `보유 비중대로 합치면 오늘 ${pct(sum.weightedReturn)} (현금 제외, 조회 시점 가격 기준)` : '현금 제외, 조회 시점 가격 기준';
  $('#rp-market').innerHTML = [...markets.values()].map(m => { const c = m.candles, r = c.length > 1 ? (c.at(-1).close / c.at(-2).close - 1) * 100 : null; return `<div class="rp-index ${toneClass(r)}"><span>${esc(m.name)}</span><b data-count="${r}">${pct(r)}</b></div>`; }).join('');
  $('#rp-market').querySelectorAll('[data-count]').forEach(countUp);
  renderDca(positions);
}

function render(symbol, html) {
  const old = [...$('#rp-cards').children].find(n => n.dataset.symbol === symbol); if (!old) return;
  const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); const card = tpl.content.firstElementChild;
  card.dataset.symbol = symbol; old.replaceWith(card); wire(card);
}

function renderDca(positions) {
  if (!positions?.length) return;
  const advice = adviseDca(positions, Object.fromEntries(briefs), habits);
  const ICON = { keep: '●', watch: '◐', cap: '◑', review: '○' };
  $('#rp-dca-body').innerHTML = `<ul class="rp-dca-summary">${advice.summary.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
  <div class="rp-dca-grid">${advice.items.map((x, i) => `<article class="rp-dca-item v-${x.verdict}" style="--i:${i}"><header><span class="rp-verdict">${ICON[x.verdict]} ${esc(x.label)}</span><strong>${esc(x.name)}</strong><small>${Number.isFinite(x.weightPct) ? '비중 ' + x.weightPct + '%' : ''}</small></header><ul>${x.reasons.map(r => `<li class="${toneClass(r.tone)}">${esc(r.text)}</li>`).join('')}</ul></article>`).join('')}</div>
  <details class="rp-rules"><summary>적립식에서 종목을 바꾸는 기준</summary><ol>${advice.switchRules.map(r => `<li>${esc(r)}</li>`).join('')}</ol><p class="rp-muted">${esc(advice.caveat)}</p></details>`;
}

async function runHabits() {
  const btn = $('#rp-habits-run'), body = $('#rp-habits-body'); btn.disabled = true; body.innerHTML = '<div class="shimmer rp-line"></div><div class="shimmer rp-line short"></div>';
  const owner = sessionStorage.getItem('teamQuantSession');
  try {
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), from = new Date(Date.parse(to) - 90 * 86400000).toISOString().slice(0, 10);
    const report = await privateRead('order-history', { from, to, status: 'CLOSED', symbol: '' });
    if (owner !== sessionStorage.getItem('teamQuantSession')) return;
    const symbols = [...new Set(report.orders.map(o => o.symbol))].slice(0, 12), candlesBySymbol = {};
    await Promise.all(symbols.map(async s => { try { const d = await marketFor({ symbol: s, currency: report.orders.find(o => o.symbol === s).currency }); candlesBySymbol[s] = d.candles; } catch {} }));
    habits = analyzeHabits(report.orders, { candlesBySymbol, from, to });
    if (!habits.available) { body.innerHTML = `<p class="rp-muted">${esc(habits.message)}</p>`; return; }
    const m = habits.metrics, fee = Object.entries(m.fees).map(([c, f]) => `${c === 'KRW' ? Math.round(f.amount).toLocaleString('ko-KR') + '원' : '$' + f.amount.toFixed(2)}${f.complete ? '' : '+'}`).join(' · ') || '—';
    body.innerHTML = `<div class="rp-stats">${[['체결', `${m.trades}건`, `주당 ${m.tradesPerWeek}회`], ['오른 뒤 매수', m.chaseShare === null ? '—' : `${m.chaseShare}%`, '직전 5일 +7% 이상'], ['짧은 보유', m.shortHoldShare === null ? '—' : `${m.shortHoldShare}%`, '7일 안에 매도'], ['수수료·세금', fee, '조회 기간 합계']].map(([a, b, c], i) => `<div style="--i:${i}"><span>${a}</span><b>${esc(b)}</b><small>${c}</small></div>`).join('')}</div>
    <ul class="rp-flags">${habits.flags.map((f, i) => `<li class="f-${f.level}" style="--i:${i}"><b>${esc(f.title)}</b><p>${esc(f.detail)}</p><p class="rp-rule">나만의 규칙 제안: ${esc(f.rule)}</p></li>`).join('')}</ul>
    <p class="rp-muted">${esc(habits.scope)} ${report.paginationComplete ? '' : '일부 주문만 조회되었습니다.'}</p>`;
    renderDca(snapshot?.positions?.map(p => ({ ...p, valueKrw: valueKrw(p, snapshot.fx) })));
  } catch (e) { body.innerHTML = `<p class="rp-muted">주문 이력을 불러오지 못했습니다: ${esc(e.message)} · 설정에서 PC 연결을 확인하십시오.</p>`; }
  finally { btn.disabled = false; btn.textContent = '다시 점검'; }
}
$('#rp-habits-run')?.addEventListener('click', runHabits);

window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; void build(); });
window.addEventListener('teamquant:asset-clear', () => { epoch++; build.controller?.abort(); snapshot = null; habits = null; briefs = new Map(); series.clear();
  $('#rp-cards').replaceChildren(); $('#rp-market').replaceChildren(); $('#rp-habits-body').replaceChildren(); $('#rp-dca-body').innerHTML = '<p class="rp-muted">리포트가 준비되면 보여드립니다.</p>';
  $('#rp-headline').textContent = '보유 종목을 불러오면 오늘 왜 움직였는지 정리해 드립니다.'; });
