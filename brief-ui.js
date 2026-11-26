// 홈: 계좌 띠(계좌 · 기준 시각 · 평가액 · 원금 · 손익 · 오늘) → 맨 위 두 칸(지수 대비 수익률 · 오늘 시장 — home-top-ui.js) → 규칙 점검 → 접힌 카드(월별 주식 평가액 · 매매 성적표) | 보유 종목.
// 실제 보유·주문 자료는 이 탭의 메모리에서만 쓰고 저장·전송하지 않는다(시세·뉴스·공시 조회에는 종목 이름·코드만 보낸다).
import { composeBrief } from '/lib/market-brief.js';
import { classifyHeadline, relevantTo } from '/lib/market-brief.js';
import { explainMove } from '/lib/move-explain.js';
import { scoreStock } from '/lib/stock-score.js';
import { TARGETS } from '/lib/portfolio-advice.js';
import { findBestFit, periodStart, josa } from '/lib/strategy-lab.js';
import { currentSituation, groupOf, GROUPS, SITUATION_VERSION } from '/lib/situation.js';
import { fundamentals, candles, indexSeries as sharedIndex, getStyle } from '/lib/client-data.js';
import { buildAssetTimeline, koreaDay, holdingsReturn } from '/lib/asset-timeline.js';
import { reviewTrades } from '/lib/trade-review.js';
import { kstStamp, assetSnapshotFrom } from '/lib/paper-public.js';
import { marketReasons, marketQuery } from '/lib/market-reasons.js';
import { privateRead } from '/bridge-client.js';
import { loadMockAccount, ACCOUNT_LABEL } from '/paper-account-ui.js';
import { tip } from '/tooltip-ui.js';
import '/demo-ui.js';
import { stockName } from '/lib/instruments.js';

const $ = s => root?.querySelector(s) || document.querySelector(s); // 홈에 붙기 전에도 리포트 영역 안에서 찾는다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const MINUS = '−';
const signOf = v => v > 0 ? '+' : v < 0 ? MINUS : '';
const pct = v => { if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(2)); return `${signOf(r)}${Math.abs(r).toFixed(2)}%`; };
const pp = v => { if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(1)); return `${signOf(r)}${Math.abs(r).toFixed(1)}%p`; };
const toneClass = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
// 금액: '8,500원' · '1,234만 원' · '1억 230만 원'
const won = v => { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? MINUS : ''; if (a < 1e4) return `${s}${Math.round(a).toLocaleString('ko-KR')}원`; const man = Math.round(a / 1e4); if (man < 1e4) return `${s}${man.toLocaleString('ko-KR')}만 원`; const eok = Math.floor(man / 1e4), rest = man % 1e4; return `${s}${eok.toLocaleString('ko-KR')}억${rest ? ` ${rest.toLocaleString('ko-KR')}만` : ''} 원`; };
const signedWon = v => Number.isFinite(v) ? (v > 0 ? '+' : '') + won(v) : '—';
const signedUsd = v => Number.isFinite(v) ? `${signOf(v)}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const today = () => koreaDay(Date.now());
// 날짜는 올해면 'MM-DD', 다른 해면 'YYYY-MM-DD' · 기준 시각은 'MM-DD HH:mm'(한국 시간)
const day = ymd => !ymd ? '' : String(ymd).slice(0, 4) === today().slice(0, 4) ? String(ymd).slice(5, 10) : String(ymd).slice(0, 10);
const stamp = iso => { const k = kstStamp(iso); return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(k) ? `${day(k.slice(0, 10))} ${k.slice(11)}` : ''; };
const fundSource = s => String(s || '').replace(/Yahoo Finance( chart API)?/g, '야후 파이낸스').replace(/\s*\(공개 화면용 API · 비공식\)/, '(공식 제공 아님)');
// 2026-11-06 핵심 기능만: 검증하지 않은 판단(종목 점수, 원인 결론, 맞았던 방식, 상황 통계, 점검 문구)은 종목 상세에서 뺀다.
const CORE_ONLY = true;

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/brief.css?v=home-20261126'; document.head.append(css);

const root = document.createElement('section'); root.className = 'hm'; root.id = 'report';
root.innerHTML = `
<div class="hm-connect" id="hm-connect" hidden>
  <div class="hm-connect-main"><h2>계좌를 연결하면 내 자산이 여기에 보입니다</h2>
    <p class="hm-connect-steps">PC 프로그램 실행 → PC 화면에서 연결 번호 받기 → 이 화면에 입력 ${tip("토스 API 키는 내 PC에만 저장됩니다. 처음이면 'PC 프로그램 받기'로 설치하세요. 연결 번호는 PC 화면의 설정 > 내 PC 연결에서 받고, 한 번 입력하면 30일 자동 연결됩니다.")}</p>
    <div class="hm-connect-actions"><button type="button" class="primary" id="hm-connect-go">연결 번호 입력</button><button type="button" class="secondary" data-demo-start>예시 자산으로 둘러보기</button><a class="text-button" href="/downloads/TeamQuant-PC.zip" download>PC 프로그램 받기</a></div>
    <p class="hm-connect-state" id="hm-connect-state" role="status"></p></div>
</div>
<div class="hm-band" id="hm-band">
  <div class="hm-band-id">
    <p class="hm-acct" id="hm-acct">계좌 확인 중…</p>
    <div class="hm-demo" id="hm-demo" hidden><b>${ACCOUNT_LABEL.demo}</b>${tip('공개 시세로 만든 예시 보유 종목입니다.')}<button type="button" class="text-button" data-demo-stop>예시 끄기</button></div>
    <div class="hm-demo hm-paper" id="hm-paper" hidden><b>${ACCOUNT_LABEL.paper}</b><span id="hm-paper-text"></span><button type="button" class="text-button" data-core-go="settings">내 PC 연결</button></div>
    <button type="button" class="text-button hm-refresh" id="hm-refresh" hidden>새로고침</button>
    <span class="hm-band-msg" id="hm-band-msg" role="status"></span>
  </div>
  <div class="hm-kpis" id="hm-kpis" hidden></div>
</div>
<section class="ht" id="home-top" aria-label="지수 대비 수익률과 오늘 시장">
  <article class="ht-card" id="ht-compare"><header><h3>지수 대비 수익률</h3></header><div class="ht-skel shimmer"></div></article>
  <article class="ht-card" id="ht-market"><header><h3>오늘 시장</h3></header><div class="ht-skel shimmer"></div></article>
  <section id="hm-tonight" hidden></section>
</section>
<div class="hm-main">
  <details class="hm-card hm-fold" id="hm-trend" hidden>
    <summary><h3>월별 주식 평가액 ${tip('막대: 월말 평가액 · 선: 원금(그때 가진 주식을 산 금액). 막대가 선보다 높으면 이익입니다. 최근 1년 실제 체결로 거꾸로 계산했고 현금은 넣지 않았으며, 달러 종목은 그 달 환율을 씁니다.')}</h3><span class="hm-fold-sum" id="hm-trend-sum"></span></summary>
    <div id="hm-trend-chart" class="hm-chart"></div>
    <p class="hm-note" id="hm-trend-note"></p>
  </details>
  <details class="hm-card hm-fold" id="hm-grade" hidden>
    <summary><h3>매매 성적표 ${tip('최근 1년 매수·매도를 같은 날 지수를 샀을 때와 비교합니다. 매수: 산 가격 대비 지금 수익률 vs 지수 · 매도: 판 뒤 그 종목이 지수보다 더 올랐는지. 배당·환율 변화는 넣지 않았습니다.')}</h3><span class="hm-fold-sum" id="hm-grade-sum"></span></summary>
    <div id="hm-grade-body"></div>
  </details>
</div>
<aside class="hm-side">
  <div class="hm-side-head"><h3>보유 종목 ${tip('누르면 오늘 등락 · 투자 지표 · 최근 주가 흐름 · 공시·기사를 봅니다.')}</h3><span id="hm-count"></span></div>
  <ol id="hm-list" class="hm-list"><li class="hm-empty">계좌를 불러오는 중입니다.</li></ol>
</aside>`;
const dialog = document.createElement('dialog'); dialog.className = 'hm-dialog'; dialog.innerHTML = '<div class="hm-dialog-head"><div><strong id="hm-d-title"></strong><small id="hm-d-sub"></small></div><button type="button" class="text-button" id="hm-d-close">닫기 ✕</button></div><div id="hm-d-body" class="rp"></div>';
document.body.append(dialog);
dialog.querySelector('#hm-d-close').onclick = () => dialog.close();
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

// 홈(#overview)은 다른 모듈이 나중에 만든다. 생긴 뒤에 붙이고, 예전 구성은 지우지 않고 맨 아래에 접어 둔다.
const more = document.createElement('details'); more.className = 'rp-more hm-more'; more.innerHTML = '<summary>예전 화면 도구 (가상 투자 · 목표 계획 · 조회 기록)</summary>';
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

// 다른 모듈이 홈에 끼워 넣는 카드(규칙 점검 core-ui · 섹터 sector-ui · 실계좌 기록 paper-ui)의 자리를 고정한다.
// 그 모듈들은 id로 다시 찾아 그리므로 옮겨도 계속 동작한다. 규칙 점검은 맨 위 두 칸 바로 아래 전체 폭, 나머지는 왼쪽 열에서 접힌 카드 다음.
const MAIN_ORDER = ['hm-trend', 'hm-grade', 'home-sectors', 'hm-real'];
function placeCards() {
  const main = root.querySelector('.hm-main'), top = root.querySelector('#home-top'), rules = document.getElementById('core-today');
  if (!main || !top) return;
  if (rules && root.contains(rules) && top.nextElementSibling !== rules) top.after(rules);
  const els = MAIN_ORDER.map(id => document.getElementById(id)).filter(el => el && root.contains(el));
  const ordered = els.every((el, i) => el.parentElement === main && (i === 0 || (els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  if (!ordered) for (const el of els) main.append(el);
}
const placer = new MutationObserver(placeCards);
for (const node of [root, root.querySelector('.hm-band'), root.querySelector('.hm-main')]) placer.observe(node, { childList: true });

let snapshot = null, briefs = new Map(), epoch = 0, reasons = {}, funds = new Map(), cashInfo = null, history = null, lastTrend = null;
const fitCache = new Map();
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
    return { ...d, index: ['^GSPC', 'S&P500'] };
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

// ── 홈 맨 위(home-top-ui.js)에 넘기는 값: 같은 자료를 다시 받지 않게 한다. 모두 이 탭 메모리 안의 값이다 ──
export const homeSnapshot = () => snapshot;
export const homeBriefs = () => briefs;
export const homeHistory = () => history;
export const homeConnection = () => connection;
/** 지수·환율 1년 일봉(공개 시세). 홈의 성적표·월별 그래프와 같은 요청을 함께 쓴다. */
export const homeIndex = symbol => indexSeries(symbol);
const announceHistory = () => window.dispatchEvent(new Event('teamquant:home-history'));

// 오늘 시장 이유: 국내·미국 장 마감 기사를 보유 종목과 상관없이 둘 다 찾는다. 같은 탭에서 10분 동안 다시 쓴다(공개 기사만 · 보유 정보 없음).
const REASONS_TTL = 10 * 60e3, REASONS_KEY = 'tq:home-reasons';
let reasonsJob = null;
async function reasonsFor(scope) {
  const [sym, name] = scope === 'KR' ? ['^KS11', '코스피'] : ['^GSPC', 'S&P500'];
  try {
    const [idx, news] = await Promise.all([indexSeries(sym).catch(() => null), getJson(`/api/news?query=${encodeURIComponent(marketQuery(scope))}&sort=date`)]);
    const c = idx?.candles || [], change = c.length > 1 ? (c.at(-1).close / c.at(-2).close - 1) * 100 : null;
    let found = marketReasons(news.items, { scope, direction: Math.sign(change || 0) });
    // 마감 기사가 최신 20건에 없으면 더 넓은 검색어로 한 번 더 찾는다.
    if (!found.available) { const wide = await getJson(`/api/news?query=${encodeURIComponent(scope === 'KR' ? '코스피' : '뉴욕증시')}&sort=sim`).catch(() => null); if (wide) found = marketReasons(wide.items, { scope, direction: Math.sign(change || 0) }); }
    return { name, change, asOf: c.at(-1)?.date, ...found };
  } catch (e) { return { name, error: `기사를 불러오지 못했습니다(${e.message}).`, themes: [], articles: [], available: false }; }
}
export function marketReasonsBoth({ force = false } = {}) {
  if (!force && reasonsJob && Date.now() - reasonsJob.at < REASONS_TTL) return reasonsJob.p;
  if (!force) { try { const v = JSON.parse(sessionStorage.getItem(REASONS_KEY) || 'null'); if (v?.d?.KR && v.d.US && Date.now() - v.t < REASONS_TTL) { reasonsJob = { at: v.t, p: Promise.resolve(v.d) }; return reasonsJob.p; } } catch { /* 사생활 모드 등: 다시 받는다 */ } }
  const job = { at: Date.now(), p: null };
  job.p = Promise.all([reasonsFor('KR'), reasonsFor('US')]).then(([KR, US]) => {
    const d = { KR, US };
    if (KR.error || US.error) { if (reasonsJob === job) reasonsJob = null; } else { try { sessionStorage.setItem(REASONS_KEY, JSON.stringify({ t: job.at, d })); } catch { /* 저장 못 해도 화면은 그대로 */ } }
    return d;
  });
  reasonsJob = job;
  return job.p;
}

function decompositionBar(move) {
  if (!move?.available) return '<p class="rp-muted">같은 날 지수 자료가 없어 시장 따라 움직인 만큼을 나누지 못했습니다.</p>';
  const total = Math.abs(move.expected) + Math.abs(move.own) || 1, m = Math.abs(move.expected) / total * 100;
  return `<div class="rp-split" aria-label="오늘 등락 나누기"><div class="rp-split-bar"><span class="mkt" style="--w:${m.toFixed(1)}%"></span><span class="own" style="--w:${(100 - m).toFixed(1)}%"></span></div>
  <div class="rp-split-legend"><span><i class="mkt"></i>시장 따라 ${pct(move.expected)}</span><span><i class="own"></i>이 종목만 ${pct(move.own)}</span><span class="rp-muted">시장 ${pct(move.market)} · 시장의 ${move.beta}배로 움직임</span></div></div>`;
}

function chart(b, stockCandles, indexCandles, avgCost) {
  const c = stockCandles.slice(-60); if (c.length < 10) return '';
  const idx = new Map(indexCandles.map(x => [x.date, x.close])), base = c[0].close, ib = idx.get(c[0].date);
  const W = 640, H = 170, P = 10;
  const s = c.map(x => x.close / base * 100), m = ib ? c.map(x => idx.has(x.date) ? idx.get(x.date) / ib * 100 : null) : [];
  const vals = [...s, ...m.filter(v => v !== null)], avg = avgCost > 0 ? avgCost / base * 100 : null;
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), pad = (hi0 - lo0) * 0.25;
  // 평균단가가 가격 범위 근처일 때만 축에 포함한다. 멀면 축을 늘리지 않고 글로 알린다.
  const avgInView = avg !== null && avg >= lo0 - pad && avg <= hi0 + pad;
  const lo = Math.min(lo0, avgInView ? avg : lo0), hi = Math.max(hi0, avgInView ? avg : hi0), span = hi - lo || 1;
  const avgNote = avg !== null && !avgInView ? `<span class="rp-muted">내 평균단가는 그래프 범위 밖(현재가 대비 ${pct((avgCost / c.at(-1).close - 1) * 100)})</span>` : '';
  const X = i => P + i / (c.length - 1) * (W - P * 2), Y = v => P + (hi - v) / span * (H - P * 2);
  const path = arr => arr.map((v, i) => v === null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const marks = [...(b.disclosures || []).map(d => ({ date: d.date, label: d.label, kind: 'd' })), ...(b.news || []).map(n => ({ date: n.date, label: n.categoryLabel, kind: 'n' }))]
    .map(x => ({ ...x, i: c.findIndex(k => k.date >= x.date) })).filter(x => x.i >= 0);
  return `<figure class="rp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 3개월(60거래일) ${esc(b.name)}와 ${esc(b.marketName)} 비교">
    ${avgInView ? `<line class="avg" x1="${P}" x2="${W - P}" y1="${Y(avg)}" y2="${Y(avg)}"/><text class="avg-t" x="${W - P}" y="${Y(avg) - 4}" text-anchor="end">내 평균단가</text>` : ''}
    ${m.length ? `<polyline class="mkt" points="${path(m)}"/>` : ''}<polyline class="stk ${toneClass(b.price.month)}" pathLength="1" points="${path(s)}"/>
    ${marks.map(x => `<circle class="mark ${x.kind}" cx="${X(x.i)}" cy="${Y(s[x.i])}" r="4"><title>${esc(x.date + ' ' + x.label)}</title></circle>`).join('')}
  </svg><figcaption><span><i class="stk"></i>${esc(b.name)}</span>${m.length ? `<span><i class="mkt"></i>${esc(b.marketName)}</span>` : ''}<span><i class="mark"></i>공시·기사</span><span class="rp-muted">3개월(60거래일) 전 가격 = 100</span>${avgNote}</figcaption></figure>`;
}

function finTable(f) {
  if (!f) return '<p class="rp-muted">실적 자료 없음 (ETF·해외 종목이거나 공시 자료 없음)</p>';
  const row = (label, a, g) => { if (!a) return ''; const cur = a.current, prev = a.previous, max = Math.max(Math.abs(cur || 0), Math.abs(prev || 0)) || 1;
    const fmt = v => v === null ? '—' : `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억`;
    return `<div class="rp-fin-row"><span>${label}</span><div class="rp-fin-bars"><b class="prev" style="--w:${(Math.abs(prev || 0) / max * 100).toFixed(0)}%"></b><b class="cur ${toneClass(g)}" style="--w:${(Math.abs(cur || 0) / max * 100).toFixed(0)}%"></b></div><em class="${toneClass(g)}">${fmt(cur)} · ${pct(g)}</em></div>`; };
  return `<div class="rp-fin"><p class="rp-muted">${esc(f.year)}년 ${esc(f.period)} · ${esc(f.basis)} · 회색 막대: 작년 같은 기간</p>${row('매출', f.accounts.revenue, f.growth.revenue)}${row('영업이익', f.accounts.operatingIncome, f.growth.operatingIncome)}${row('순이익', f.accounts.netIncome, f.growth.netIncome)}</div>`;
}

const scopeOf = currency => currency === 'USD' ? 'US' : 'KR';
const nameOf = symbol => snapshot?.positions?.find(p => p.symbol === symbol)?.name || stockName(symbol);

// ── 계좌 띠의 숫자 한 줄: 평가액 · 원금 · 평가 손익 · 오늘 손익 (휴대폰은 평가액과 오늘 손익만) ──
function renderKpis(positions) {
  // 2026-11-16: 원금·손익·수익률은 holdingsReturn(토스 계좌 합계 = 미국 주식 원금은 산 날 환율). 예전에는 원금도 오늘 환율로 바꿔 달러 기준이 됐다(산 뒤 원화가 강해지면 토스보다 높게 나옴).
  const R = holdingsReturn(snapshot), value = R.value, cost = R.cost, gain = R.pnl;
  const daily = positions.length && positions.every(p => Number.isFinite(p.dailyKrw)) ? positions.reduce((s, p) => s + p.dailyKrw, 0) : NaN;
  const retTip = R.basis === 'purchase_fx' ? `토스와 같은 계산입니다(평가액은 오늘 환율, 미국 주식 원금은 산 날 환율).${Number.isFinite(R.currentFxPct) ? ` 환율 변화를 빼면 ${pct(R.currentFxPct)}` : ''}${Number.isFinite(R.returnAfterCostPct) ? ` · 팔 때 수수료·세금을 빼면 ${pct(R.returnAfterCostPct)}` : ''} · 현금 제외.`
    : R.basis === 'current_fx' ? '미국 주식 원금도 산 날 환율을 몰라 오늘 환율로 계산했습니다. 그래서 산 뒤 환율 변화(환차익·환차손)는 빠져 있습니다.' : '지금 가진 주식의 평가액에서 원금을 뺀 값입니다(현금 제외).';
  const costTip = snapshot?.paper ? '팀 모의계좌가 지금 가진 주식을 산 금액(가상 돈)입니다.' : `지금 가진 주식을 산 금액입니다.${R.basis === 'purchase_fx' ? ' 미국 주식은 산 날 환율로 셉니다.' : R.basis === 'current_fx' ? ' 미국 주식은 오늘 환율로 바꿨습니다.' : ''}`;
  // 종목별 오늘 손익이 없으면(팀 모의계좌 등) 시세를 받은 종목만 비중대로 합친다. 일부만 받았으면 'N/M종목'을 붙인다.
  const done = positions.map(p => ({ p, b: briefs.get(p.symbol) })).filter(x => x.b?.available && Number.isFinite(x.b.price?.dayReturn) && x.p.valueKrw > 0);
  const doneValue = done.reduce((s, x) => s + x.p.valueKrw, 0);
  let dayAmt = null, dayPct = null, dayNote = '';
  if (Number.isFinite(daily)) { dayAmt = daily; dayPct = value - daily ? daily / (value - daily) * 100 : null; }
  else if (doneValue > 0) {
    dayPct = done.reduce((s, x) => s + x.p.valueKrw / doneValue * x.b.price.dayReturn, 0);
    dayAmt = done.reduce((s, x) => s + x.p.valueKrw * (x.b.price.dayReturn / 100) / (1 + x.b.price.dayReturn / 100), 0);
    dayNote = `${done.length < positions.length ? ` (${done.length}/${positions.length}종목)` : ''}${tip('종목별 최근 거래일 등락을 보유 비중대로 합친 값입니다.')}`;
  }
  const item = (cls, label, valueHtml, sub = '') => `<span class="hm-kpi ${cls}"><span>${label}</span> <b class="${valueHtml.tone || ''}">${esc(valueHtml.text)}</b>${sub}</span>`;
  $('#hm-kpis').innerHTML = [
    item('k-value', '평가액', { text: won(value) }, cashInfo ? ` <small>현금 포함 ${esc(won(value + cashInfo.amount))}</small>` : ''),
    item('k-cost', `원금 ${tip(costTip)}`, { text: won(cost) }),
    item('k-gain', `평가 손익 ${tip(retTip)}`, { text: signedWon(gain), tone: toneClass(gain) }, Number.isFinite(R.returnPct) ? ` <small class="${toneClass(R.returnPct)}">${pct(R.returnPct)}</small>` : ''),
    dayAmt === null ? item('k-day', '오늘 손익', { text: positions.length ? '계산 중…' : '—' }) : item('k-day', '오늘 손익', { text: signedWon(dayAmt), tone: toneClass(dayAmt) }, `${Number.isFinite(dayPct) ? ` <small class="${toneClass(dayPct)}">${pct(dayPct)}</small>` : ''}${dayNote}`)
  ].join('');
}

// ── 보유 종목(오른쪽): 한 칸 세 줄 — 이름·오늘 등락 / 평가액·수익률(손익) / 비중 ──
function renderList(positions) {
  const list = [...positions].sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0));
  $('#hm-count').textContent = list.length ? `${list.length}종목` : '';
  $('#hm-list').innerHTML = list.map((p, i) => {
    const b = briefs.get(p.symbol), dayRet = b?.available ? b.price.dayReturn : null, isUsd = p.currency === 'USD';
    const gain = Number.isFinite(p.pnl) ? (isUsd ? signedUsd(p.pnl) : signedWon(p.pnl)) : '';
    return `<li style="--i:${i}"><button type="button" data-symbol="${esc(p.symbol)}">
      <span class="hm-row"><strong>${esc(p.name)}</strong><span class="hm-day ${toneClass(dayRet)}">${dayRet === null ? '' : `오늘 ${pct(dayRet)}`}</span></span>
      <span class="hm-row hm-sub"><span>${won(p.valueKrw)}</span><span class="${toneClass(p.returnPct)}">수익률${isUsd ? '(환율 제외)' : ''} ${pct(p.returnPct)}${gain ? ` (${gain})` : ''}</span></span>
      <span class="hm-row hm-sub"><span>비중 ${Number.isFinite(p.weightPct) ? p.weightPct.toFixed(0) + '%' : '—'}</span></span>
    </button></li>`;
  }).join('') || '<li class="hm-empty">보유 주식이 없습니다.</li>';
  $('#hm-list').querySelectorAll('button[data-symbol]').forEach(btn => btn.onclick = () => openDetail(btn.dataset.symbol));
}


// ── 종목 상세(대화상자) ──────────────────────────────────────
let detailRun = 0;
async function openDetail(symbol) {
  const run = ++detailRun, b = briefs.get(symbol), p = snapshot?.positions?.find(x => x.symbol === symbol);
  $('#hm-d-title').textContent = p?.name || nameOf(symbol);
  $('#hm-d-sub').textContent = `${symbol}${b?.available ? ` · 오늘 ${pct(b.price.dayReturn)}` : ''}${p ? ` · 수익률${p.currency === 'USD' ? '(환율 제외)' : ''} ${pct(p.returnPct)}` : ''}`;
  const draw = () => { if (run !== detailRun) return; $('#hm-d-body').innerHTML = !b ? '<p class="hm-note">아직 분석 중입니다. 잠시 뒤 다시 눌러 주세요.</p>' : !b.available ? `<p class="hm-note">${esc(b.headline)}</p>` : detailHtml(b, p); };
  draw(); if (!dialog.open) dialog.showModal();
  if (!b?.available) return;
  if (!funds.has(symbol)) { try { funds.set(symbol, await fundamentals(symbol)); } catch (e) { funds.set(symbol, { error: e.message }); } draw(); }
  // 맞았던 매매 방식·상황 통계는 CORE_ONLY 에서 그리지 않으므로 받지 않는다.
  if (!CORE_ONLY && !fitCache.has(symbol)) { try { const d = await candles(symbol, b.currency), idx = await sharedIndex(d.index[0]).catch(() => null); fitCache.set(symbol, findBestFit(d.candles, idx?.candles || [], periodStart(today(), 12))); sitCache.set(symbol, { now: currentSituation(d.candles, idx?.candles || []), group: groupOf({ symbol: d.symbol, currency: d.currency, instrumentType: d.instrumentType }) }); } catch (e) { fitCache.set(symbol, { available: false, message: e.message }); } await loadSitStats(); draw(); }
}
// 지금 상황(과열·급락 등)과 같은 상태 이후 통계. 정의·숫자는 전략 테스트 화면과 같은 파일에서 온다.
const sitCache = new Map(); let sitStats = null;
async function loadSitStats() { if (sitStats) return; try { const r = await fetch('/data/situation-stats.json?v=' + encodeURIComponent(SITUATION_VERSION)); if (r.ok) sitStats = await r.json(); } catch {} }
const ppText = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : '—';
function situationSection(symbol) {
  const s = sitCache.get(symbol); if (!s?.now?.available) return '';
  const v = sitStats?.states?.[s.group]?.[s.now.state], base = sitStats?.baseline?.[s.group]?.f60, rule = sitStats?.rule?.[s.group]?.[s.now.state];
  const ruled = rule && rule !== 'hold' ? sitStats.strategies.find(x => x.id === rule)?.title : null;
  return `<section><h4>지금 상황 ${tip(`${s.now.rule}
정해진 규칙으로만 판단합니다.`)}</h4><p class="hm-sit"><span class="lt-badge b-${s.now.state}">${esc(s.now.label)}</span> <span>${esc(s.now.signs.join(' · ') || '뚜렷한 신호 없음')}</span></p>
    ${v ? `<p>${esc(GROUPS[s.group])}${josa(GROUPS[s.group], '이', '가')} 같은 상태였던 뒤 3개월(60거래일) 동안 지수 대비 평균 <b>${ppText(v.f60.mean)}</b>(평소 대비 ${ppText(v.f60.mean - (base?.mean ?? 0))}), 지수보다 나았던 비율 ${v.f60.hit}%였습니다. ${ruled ? `과거엔 ${esc(ruled)}${josa(ruled, '이', '가')} 그냥 보유보다 나았습니다.` : '이 상태에서 그냥 보유보다 확실히 나은 매매 방식은 없었습니다.'}</p>` : ''}</section>`;
}
const ROW = (label, value, note, t = 0) => `<div class="hm-kv"><span><i class="hm-dot ${t > 0 ? 'good' : t < 0 ? 'bad' : ''}"></i>${label}${note ? tip(note) : ''}</span><b>${value}</b></div>`;


// 주가 흐름: 시세만으로 계산(지수와 나란히). 예측이 아니라 지금까지의 흐름이다.
function momentumRows(b) {
  const c = (b.candles || []).filter(x => x.close > 0), ix = (b.indexCandles || []).filter(x => x.close > 0); if (c.length < 30) return [];
  const last = c.at(-1).close, at = (arr, n) => arr.length > n ? arr[arr.length - 1 - n].close : null, r = (arr, n) => { const v = at(arr, n); return v ? arr.at(-1).close / v - 1 : null; };
  const rows = [];
  for (const [n, label] of [[21, '1개월'], [63, '3개월'], [126, '6개월'], [252, '1년']]) { const a = r(c, n), i = r(ix, n); if (a === null) continue; rows.push(ROW(`수익률 ${label}`, `${pct(a * 100)}${i === null ? '' : ` <small class="hm-vs">지수 ${pct(i * 100)}</small>`}`, '', i === null ? 0 : a > i ? 1 : -1)); }
  const hi = Math.max(...c.slice(-252).map(x => x.close)); rows.push(ROW('1년 고점 대비', pct((last / hi - 1) * 100), '', last / hi - 1 > -0.1 ? 1 : -1));
  if (c.length >= 200) { const ma = c.slice(-200).reduce((a, x) => a + x.close, 0) / 200; rows.push(ROW('200일선', `${last > ma ? '위' : '아래'} (${pct((last / ma - 1) * 100)})`, '200일선(200일 평균 가격)보다 지금 가격이 위인지 아래인지와 그 차이입니다.', last > ma ? 1 : -1)); }
  if (c.length >= 61) { const lr = []; for (let k = c.length - 60; k < c.length; k++) lr.push(Math.log(c[k].close / c[k - 1].close)); const m = lr.reduce((a, x) => a + x, 0) / lr.length, sd = Math.sqrt(lr.reduce((a, x) => a + (x - m) ** 2, 0) / (lr.length - 1)) * Math.sqrt(252); rows.push(ROW('변동성(1년 기준)', `${(sd * 100).toFixed(0)}%`, '최근 60거래일 하루 등락을 1년으로 환산한 값입니다.', sd < 0.25 ? 1 : sd > 0.45 ? -1 : 0)); }
  return rows;
}

function detailHtml(b, p) {
  const f = funds.get(b.symbol), fund = f && !f.error ? f : null, r = reasons[scopeOf(b.currency)], style = getStyle();
  const e = explainMove(b, { market: r, sectorName: fund?.sector, sectorToday: fund?.sectorToday });
  const j = fund ? scoreStock(fund, { style, price: p?.price, brief: b, weightPct: p ? current().find(x => x.symbol === p.symbol)?.weightPct : null, weightLimit: TARGETS[style].single }) : null;
  const fit = fitCache.get(b.symbol);
  const FIT = { match: ['같은 방향', 'up'], opposite: ['반대 방향', 'down'], neutral: ['방향 무관', 'flat'] };
  const marketArticles = e.marketLed && r?.available ? r.articles.slice(0, 2).map(a => ({ title: a.title, link: a.link, source: a.sourceHost, label: `${b.marketName} 마감 기사`, fit: 'match' })) : [];
  const allNews = (b.allNews || []).filter(n => !e.evidence.some(x => x.link === n.link));
  const link = (url, title) => safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title);
  return `<div class="hm-detail">
    ${CORE_ONLY ? '' : j ? `<section class="hm-verdict-box ${({ buy: 's-buy', hold: 's-hold', trim: 's-trim', unknown: 's-unknown' })[j.stance]}"><span class="pf-stance ${({ buy: 's-buy', hold: 's-hold', trim: 's-trim', unknown: 's-unknown' })[j.stance]}">${esc(j.label)}</span><p>${esc(j.summary)}${j.notes.length ? ' ' + esc(j.notes.join(' ')) : ''}</p><small>${esc(j.styleLabel)} 성향 기준 ${tip('투자 성향은 내 포트폴리오 화면에서 바꿉니다. 판단 규칙도 그곳의 ⓘ에 있습니다.')}</small></section>` : fund === null && !f ? '<p class="hm-note">투자 지표를 불러오는 중…</p>' : ''}
    <section><h4>${CORE_ONLY ? `오늘 움직임 ${tip("오늘 등락을 '시장 따라 움직인 만큼'과 '이 종목만의 움직임'으로 나눴습니다. 최근 6개월(120거래일) 동안 이 종목이 지수의 몇 배로 움직였는지로 계산했고, 원인을 판단한 것은 아닙니다. 관련 기사·공시는 '최근 공시·기사'에 있습니다.")}` : `오늘 움직인 이유 ${tip(b.caveat + ' 매수·매도 권유가 아닙니다.')}`}</h4>${CORE_ONLY ? '' : `<p class="hm-conclusion">${esc(e.conclusion)}</p>`}${decompositionBar(b.move)}
      ${!CORE_ONLY && [...marketArticles, ...e.evidence].length ? `<ul class="hm-evidence">${[...marketArticles, ...e.evidence].map(x => `<li><span class="hm-fit ${FIT[x.fit][1]}">${FIT[x.fit][0]}</span><div><small>${esc(x.label)}</small>${safeUrl(x.link) ? `<a href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>` : `<b>${esc(x.title)}</b>`}</div></li>`).join('')}</ul>` : ''}</section>
    <section><h4>투자 지표 ${fund ? tip('출처: ' + fundSource(fund.source)) : ''} ${fund ? `<small>${esc(fund.sector || '')}${fund.annual?.year ? ` · ${esc(fund.annual.year)} 실적` : ''}</small>` : ''}</h4>
      ${fund ? `${fund.business ? `<details class="hm-bizbox"><summary>회사 설명</summary><p class="hm-biz">${esc(fund.business)}</p></details>` : ''}<h5 class="hm-h5">재무·가격 ${tip('증권사 지표 기준. PER은 이익 대비 가격, ROE·ROA는 돈 버는 힘, 성장은 최근 연간 매출 변화입니다.')}</h5><div class="hm-kvs">${(j?.factors || []).filter(x => x.key !== 'news').map(x => ROW(esc(x.label), esc(x.value), CORE_ONLY ? '' : esc(x.text), CORE_ONLY ? 0 : x.tone)).join('')}${Number.isFinite(fund.pbr) ? ROW('PBR', `${fund.pbr}배`, fund.pbr < 1 ? '회사 순자산(가진 재산 − 빚)보다 주가가 싼 상태입니다.' : '회사 순자산(가진 재산 − 빚) 대비 주가 수준입니다.', 0) : ''}</div><h5 class="hm-h5">주가 흐름(지수와 비교) ${tip('지금까지의 주가 흐름입니다(같은 기간 지수와 비교). 앞으로의 방향을 뜻하지 않습니다.')}</h5><div class="hm-kvs">${momentumRows(b).join('') || '<p class="hm-note">시세가 짧아 계산하지 못했습니다.</p>'}</div>${fund.peers?.length ? `<p class="hm-note">비슷한 회사: ${esc(fund.peers.join(', '))}</p>` : ''}` : f?.error ? `<p class="hm-note">투자 지표를 불러오지 못했습니다(${esc(f.error)}).</p>` : '<div class="shimmer rp-line"></div>'}</section>
    ${CORE_ONLY ? '' : `<section><h4>이 종목에 맞았던 매매 방식 ${tip('4가지 방식을 지난 1년에 적용해 그냥 보유와 비교한 차이(비용 포함)입니다. 지난 결과에 맞춘 것이라 앞으로도 같다는 보장은 없습니다.')}</h4>${!fit ? '<div class="shimmer rp-line short"></div>' : !fit.available ? `<p class="hm-note">${esc(fit.message)}</p>` : `<p>${esc(fit.advice)}</p><div class="hm-fit-rows">${fit.rows.map(x => `<span>${esc(x.title)} <b class="${toneClass(x.edge)}">${x.edge > 0 ? '+' : ''}${x.edge}%p</b></span>`).join('')}</div>`}</section>`}
    ${CORE_ONLY ? '' : situationSection(b.symbol)}
    <section><h4>최근 흐름</h4>${chart(b, b.candles || [], b.indexCandles || [], p?.avgCost)}<div class="hm-kvs">${b.context.map(x => ROW(esc(x.label), esc(x.value), '', x.tone)).join('')}</div></section>
    ${b.financials ? `<section><h4>분기 실적</h4>${finTable(b.financials)}</section>` : ''}
    ${b.disclosures.length || allNews.length ? `<section><h4>최근 공시·기사 ${tip('기사: 제목에 회사 이름이 있는 최근 기사 · 점: 제목 분위기(초록 좋음 · 주황 나쁨) · 날짜와 원문 링크')}</h4><ul class="hm-news">${b.disclosures.map(d => `<li><span class="rp-tag d">공시</span><small>${esc(d.date)}</small>${link(d.link, d.title)}</li>`).join('')}${allNews.slice(0, 8).map(n => `<li><i class="hm-dot ${n.tone > 0 ? 'good' : n.tone < 0 ? 'bad' : ''}"></i><span class="rp-tag n">${esc(n.categoryLabel)}</span><small>${esc(n.date)}</small>${link(n.link, n.title)}</li>`).join('')}</ul></section>` : ''}
    ${CORE_ONLY ? '' : `<section><h4>지금 점검할 것</h4><ol class="hm-checks">${b.checks.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>`}
  </div>`;
}

// ── 월별 주식 평가액 그래프 ────────────────────────────────────
// 그래프 폭은 상자 폭에 맞춘다(넓은 화면에서 막대 12개짜리 그래프가 지나치게 커지지 않게). 접혀 있으면 기본 폭으로 그리고 펼칠 때 다시 그린다.
const shortWon = v => v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만` : `${Math.round(v)}`;
function trendSvg(points, W) {
  const H = 220, L = 56, R = 12, T = 14, B = 30, n = points.length, band = (W - L - R) / n, every = band < 34 ? 2 : 1;
  const vals = points.flatMap(p => [p.value, p.principal]).filter(Number.isFinite), max = Math.max(...vals, 1) * 1.08;
  const Y = v => T + (1 - v / max) * (H - T - B), ticks = [0, .5, 1].map(k => max * k);
  const label = (p, i) => { const [y, m] = p.month.split('-'); return i === 0 || m === '01' ? `${y.slice(2)}.${+m}월` : `${+m}월`; };
  const line = points.map((p, i) => Number.isFinite(p.principal) ? [L + band * (i + .5), Y(p.principal)] : null);
  const segs = []; let cur = []; for (const pt of line) { if (pt) cur.push(pt); else if (cur.length) { segs.push(cur); cur = []; } } if (cur.length) segs.push(cur);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 주식 평가액과 원금">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ytick" x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${shortWon(t)}</text>`).join('')}
    ${points.map((p, i) => { const x = L + band * i + band * .2, w = band * .6;
      const bar = Number.isFinite(p.value) ? `<rect class="bar ${p.current ? 'now ' : ''}${Number.isFinite(p.principal) ? toneClass(p.value - p.principal) : ''}" x="${x}" y="${Y(p.value)}" width="${w}" height="${Math.max(1, Y(0) - Y(p.value))}" rx="3" style="--i:${i}"/>` : `<rect class="bar none" x="${x}" y="${Y(max * .12)}" width="${w}" height="${Y(0) - Y(max * .12)}" rx="3"/>`;
      const showLabel = (n - 1 - i) % every === 0;
      return `${bar}${showLabel ? `<text class="xtick" x="${L + band * (i + .5)}" y="${H - 10}" text-anchor="middle">${label(p, i)}</text>` : ''}<rect class="hit" data-i="${i}" tabindex="0" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"><title>${esc(readout(p))}</title></rect>`; }).join('')}
    ${segs.map(s => `<polyline class="principal" points="${s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`).join('')}
    ${line.map(pt => pt ? `<circle class="principal-dot" cx="${pt[0]}" cy="${pt[1]}" r="3"/>` : '').join('')}
  </svg>`;
}
function readout(p) {
  const [y, m] = p.month.split('-'), head = p.current ? `지금 (${+m}월 ${+p.date.slice(8)}일)` : `${y}년 ${+m}월 말`;
  if (!Number.isFinite(p.value)) return `${head} · 자료 없음${p.reason ? ' (' + p.reason + ')' : ''}`;
  const gain = Number.isFinite(p.principal) ? p.value - p.principal : null;
  return `${head} · 평가액 ${won(p.value)} · 원금 ${won(p.principal)}${gain === null ? '' : ` · 손익 ${signedWon(gain)}${p.principal > 0 ? ` (${pct(gain / p.principal * 100)})` : ''}`}`;
}
function renderTrend(t, report) {
  lastTrend = { t, report };
  const box = $('#hm-trend-chart'), W = Math.max(320, Math.round(box.clientWidth || 760));
  box.innerHTML = `<p class="hm-readout" id="hm-readout">${esc(readout(t.points.at(-1)))}</p>${trendSvg(t.points, W)}<div class="hm-legend"><span><i class="bar up"></i>월말 평가액 (원금보다 많음)</span><span><i class="bar down"></i>원금보다 적음</span><span><i class="line"></i>원금</span></div>`;
  const out = $('#hm-readout'), def = out.textContent;
  box.querySelectorAll('.hit').forEach(h => { const show = () => { out.textContent = readout(t.points[+h.dataset.i]); box.querySelectorAll('.hit').forEach(x => x.classList.toggle('on', x === h)); };
    h.addEventListener('mouseenter', show); h.addEventListener('focus', show); h.addEventListener('mouseleave', () => { out.textContent = def; h.classList.remove('on'); }); });
  const extra = [`최근 1년 거래 ${t.fills}건 기준`, report.paginationComplete ? '' : '거래가 많아 앞쪽 달은 비움', ...t.warnings].filter(Boolean).join(' · ');
  const hasGain = Number.isFinite(t.periodGain) && t.from;
  const since = hasGain ? (([y, m]) => `${y === today().slice(0, 4) ? '' : `${y}년 `}${+m}월 말 이후`)(t.from.slice(0, 7).split('-')) : '';
  $('#hm-trend-note').innerHTML = hasGain ? `${esc(since)} 투자 손익 <b class="${toneClass(t.periodGain)}">${signedWon(t.periodGain)}</b> ${tip('입금·추가 매수 효과는 빼고 가격이 움직여 번 돈만 계산 · ' + extra)}` : esc(extra);
  $('#hm-trend-sum').innerHTML = hasGain ? `${esc(since)} <b class="${toneClass(t.periodGain)}">${esc(signedWon(t.periodGain))}</b>` : esc(readout(t.points.at(-1)).split(' · ').slice(1, 2).join(''));
}
$('#hm-trend').addEventListener('toggle', () => { if ($('#hm-trend').open && lastTrend) renderTrend(lastTrend.t, lastTrend.report); });

// ── 매매 성적표 ──────────────────────────────────────────────
function renderGrade(r) {
  const body = $('#hm-grade-body');
  if (!r.available) { body.innerHTML = `<p class="hm-note">최근 1년 지수와 비교할 거래가 없습니다${r.pending ? `(최근 3일 거래 ${r.pending}건은 결과를 보기엔 일러 제외)` : ''}.</p>`; $('#hm-grade-sum').textContent = '비교할 거래 없음'; return; }
  const tile = (title, s, good) => !s.count ? `<div><span>${title}</span><b>없음</b><small>&nbsp;</small></div>` : `<div><span>${title} ${s.count}건</span><b class="${toneClass(s.edge)}">${s.edge === null ? '비교 못 함' : '지수 대비 ' + pp(s.edge)}</b><small>${good} ${s.good}/${s.compared}건</small></div>`;
  const pick = (label, x, kind) => x ? `<li><span>${label}</span><b>${esc(nameOf(x.symbol))}</b> ${esc(day(x.date))} ${x.side === 'BUY' ? '매수' : '매도'} → 지금 ${pct(x.stock)} <small>(같은 기간 ${esc(x.indexName || '지수')} ${pct(x.market)})</small><em class="${kind}">${x.side === 'BUY' ? `지수보다 ${pp(x.edge)}` : x.edge < 0 ? `판 뒤 지수보다 ${Math.abs(x.edge).toFixed(1)}%p 더 오름` : `판 뒤 지수보다 ${x.edge.toFixed(1)}%p 덜 오름`}</em></li>` : '';
  const sortedRows = [...r.rows].sort((a, b) => b.date.localeCompare(a.date));
  body.innerHTML = `<div class="hm-verdict ${r.score >= 2 ? 'up' : r.score <= -2 ? 'down' : 'flat'}"><b>${esc(r.verdict || '비교 자료 부족')}</b>${Number.isFinite(r.score) ? `<span>매매 전체 평균 · 지수 대비 ${pp(r.score)}</span>` : ''}</div>
  <div class="hm-grade-grid">${tile('매수', r.buys, '지수보다 더 오른 매수')}${tile('매도', r.sells, '판 뒤 지수보다 덜 오른 매도')}<div><span>수수료·세금</span><b>${won(r.fees)}</b><small>최근 1년 거래 합계</small></div></div>
  <ul class="hm-picks">${pick('가장 잘한 매수', r.best, 'up')}${r.worst && r.worst !== r.best && r.worst.edge < 0 ? pick('가장 아쉬운 매수', r.worst, 'down') : ''}${pick('가장 잘한 매도', r.goodSell, 'up')}${pick('가장 아쉬운 매도', r.regret, 'down')}</ul>
  ${r.pending ? `<p class="hm-note">최근 3일 거래 ${r.pending}건은 결과를 보기엔 일러 뺐습니다.</p>` : ''}
  <details class="hm-trades"><summary>거래별 결과 보기 (${r.rows.length}건)</summary><div class="table-wrap"><table><thead><tr><th>날짜</th><th>종목</th><th>매매</th><th>체결가 → 지금</th><th>같은 기간 지수</th><th>결과</th></tr></thead><tbody>${sortedRows.map(x => `<tr><td>${esc(day(x.date))}</td><td>${esc(nameOf(x.symbol))}</td><td>${x.side === 'BUY' ? '매수' : '매도'}</td><td class="${toneClass(x.stock)}">${pct(x.stock)}</td><td>${pct(x.market)}</td><td class="${toneClass(x.edge)}">${x.edge === null ? '—' : x.edge > 0 ? (x.side === 'BUY' ? '잘 샀음' : '잘 팔았음') : (x.side === 'BUY' ? '지수가 나았음' : '판 뒤 더 오름')}</td></tr>`).join('')}</tbody></table></div></details>`;
  $('#hm-grade-sum').innerHTML = Number.isFinite(r.score) ? `지수 대비 <b class="${toneClass(r.score)}">${esc(pp(r.score))}</b> · 거래 ${r.rows.length}건` : `거래 ${r.rows.length}건`;
}

async function loadHistory(positions, run, signal) {
  const to = today(), from = new Date(Date.parse(to) - 365 * 86400000).toISOString().slice(0, 10);
  let report;
  try { report = snapshot?.demo ? snapshot.demoOrders : await privateRead('order-history', { from, to, status: 'CLOSED', symbol: '' }, { signal }); }
  catch (e) {
    if (e.name === 'AbortError' || run !== epoch) return;
    history = { run, error: e.message }; announceHistory();
    const msg = `<p class="hm-note">거래 내역을 불러오지 못했습니다(${esc(e.message)}). 설정 > 내 PC 연결을 확인하세요.</p>`;
    $('#hm-trend-chart').innerHTML = msg; $('#hm-grade-body').innerHTML = msg;
    for (const id of ['#hm-trend-sum', '#hm-grade-sum']) $(id).textContent = '불러오지 못함';
    for (const id of ['#hm-trend', '#hm-grade']) $(id).hidden = false;
    return;
  }
  if (run !== epoch) return;
  const currencies = new Map(positions.map(p => [p.symbol, p.currency]));
  for (const o of report.orders) if (!currencies.has(o.symbol) && o.execution?.filledQuantity > 0) currencies.set(o.symbol, o.currency);
  const candlesBySymbol = {}, indexes = new Map();
  await Promise.all([...currencies].map(async ([symbol, currency]) => {
    try { const d = await marketFor({ symbol, currency }, signal); candlesBySymbol[symbol] = d.candles; const idx = await indexSeries(d.index[0], signal).catch(() => null); if (idx) indexes.set(symbol, { name: d.index[1], candles: idx.candles }); }
    catch (e) { if (e.name === 'AbortError') throw e; }
  }));
  const fxCandles = [...currencies.values()].includes('USD') ? (await indexSeries('KRW=X', signal).catch(() => null))?.candles || [] : [];
  if (run !== epoch) return;
  history = { run, orders: report.orders, paginationComplete: report.paginationComplete !== false, candlesBySymbol, fxCandles, from, to }; announceHistory();
  const oldest = report.orders.map(o => koreaDay(o.orderedAt)).sort()[0];
  const R = holdingsReturn(snapshot); // 원금선 오늘 끝점: 토스 계좌 합계가 있으면 산 날 환율 원금(없으면 달러 기준 그대로)
  const timeline = buildAssetTimeline({ positions, orders: report.orders, candlesBySymbol, fxCandles, fxNow: snapshot.fx?.midRate ?? null, today: to, coverageFrom: report.paginationComplete ? from : oldest, months: 12, costKrwNow: R.basis === 'purchase_fx' ? R.cost : null });
  for (const id of ['#hm-trend', '#hm-grade']) $(id).hidden = false;
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
      // 뉴스 종합: 제목에 회사 이름이 있는 최근 기사 전체의 분위기(좋은 소식/나쁜 소식)를 센다.
      const allNews = (news?.items || []).filter(n => n?.title && n.publishedAt && relevantTo(p.name, n.title)).map(n => ({ ...n, date: n.publishedAt.slice(0, 10), ...classifyHeadline(n.title, n.description) }));
      Object.assign(b, { marketName: data.index[1], candles: data.candles, indexCandles: idx?.candles || [], errors, allNews, newsTone: allNews.map(n => n.tone) });
      briefs.set(p.symbol, b);
      window.dispatchEvent(new CustomEvent('teamquant:brief', { detail: { symbol: p.symbol, brief: b } }));
    } catch (e) {
      if (e.name === 'AbortError' || run !== epoch) return;
      briefs.set(p.symbol, { name: p.name, symbol: p.symbol, available: false, headline: `시세를 가져오지 못했습니다(${e.message}).` });
    }
  });
  for (let k = 0; k < tasks.length; k += 3) { await Promise.all(tasks.slice(k, k + 3).map(t => t())); if (run !== epoch) return; renderList(positions); renderKpis(positions); }
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
  briefs = new Map(); history = null; lastTrend = null; announceHistory();
  const positions = current();
  document.querySelector('#overview')?.classList.add('hm-loaded');
  renderKpis(positions); renderList(positions);
  for (const id of ['#hm-trend', '#hm-grade']) $(id).hidden = true; // 자료가 올 때까지 자리를 차지하지 않는다
  for (const id of ['#hm-trend-sum', '#hm-grade-sum', '#hm-trend-note']) $(id).replaceChildren();
  $('#hm-trend-chart').innerHTML = '<div class="shimmer hm-chart-skel"></div>'; $('#hm-grade-body').innerHTML = '<div class="shimmer rp-line"></div><div class="shimmer rp-line short"></div>';
  void marketReasonsBoth().then(r => { if (run === epoch) reasons = r; });
  if (!positions.length) { history = { run, empty: true }; announceHistory(); return; }
  await Promise.allSettled([loadBriefs(positions, run, controller.signal), loadHistory(positions, run, controller.signal)]);
}

window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; void build(); });
window.addEventListener('teamquant:asset-clear', () => {
  epoch++; build.controller?.abort(); snapshot = null; briefs = new Map(); cashInfo = null; series.clear(); history = null; lastTrend = null; announceHistory();
  document.querySelector('#overview')?.classList.remove('hm-loaded'); if (dialog.open) dialog.close();
  $('#hm-list').innerHTML = '<li class="hm-empty">화면의 자산 정보를 지웠습니다.</li>'; $('#hm-count').textContent = '';
  for (const id of ['#hm-trend', '#hm-grade']) $(id).hidden = true;
  for (const id of ['#hm-trend-chart', '#hm-trend-note', '#hm-trend-sum', '#hm-grade-body', '#hm-grade-sum', '#hm-kpis']) $(id).replaceChildren();
});

window.addEventListener('teamquant:open-stock', e => { const s = e.detail?.symbol; if (s) void openDetail(s); });
window.addEventListener('teamquant:cash', e => { cashInfo = e.detail; if (snapshot) renderKpis(current()); });

// ── 연결 상태와 계좌 띠: 계좌가 없으면 빈 화면 대신 연결 안내와 예시 둘러보기를 보여 준다 ──
let connection = 'unknown';
// 팀 모의계좌 ⓘ: 진행 상태 · 투자 비중 · 마지막 자동 주문(절대 날짜, 한국 시간)까지 한 번에 보여 준다. 진행 상태는 lib/paper-public.js runState 가 정한다.
function paperText(m, at) { const ret = m.startTotal > 0 && m.total > 0 ? (m.total / m.startTotal - 1) * 100 : null; const inv = Number.isFinite(m.investedPct) ? ` · 투자 비중 ${m.investedPct.toFixed(0)}%${Number.isFinite(m.planInvestedPct) ? ` (계획 ${m.planInvestedPct.toFixed(0)}%)` : ''}` : ''; return `팀 모의계좌${m.run?.label ? ` · ${m.run.label}` : ''} · 가상 1억 원 · ${m.days || 0}일째${m.since ? ` (${day(m.since)}부터)` : ''}${ret === null ? '' : ` · 원금 대비 ${pct(ret)}(원금 = 처음 기록한 총자산)`}${inv}${m.lastAutoAt ? ` · 마지막 자동 주문 ${stamp(m.lastAutoAt)}` : ''} · ${m.live ? '실시간' : '하루 1번 공개'} ${stamp(at)} 기준 · 실계좌를 연결하면 그 자료로 바뀝니다.`; }
function syncState() {
  const none = !snapshot && connection === 'error';
  $('#hm-connect').hidden = !none; root.classList.toggle('hm-state-connect', none);
  const kind = !snapshot ? 'none' : snapshot.paper ? 'paper' : snapshot.demo ? 'demo' : 'real';
  $('#hm-demo').hidden = kind !== 'demo'; $('#hm-paper').hidden = kind !== 'paper';
  const acct = $('#hm-acct'); acct.hidden = kind === 'demo' || kind === 'paper';
  if (kind === 'none') acct.textContent = '계좌 확인 중…';
  if (kind === 'real') { const old = snapshot.provenance?.kind === 'saved_observation'; acct.innerHTML = `<b>${ACCOUNT_LABEL.real}</b> · ${old ? '마지막 조회 ' : ''}${esc(stamp(snapshot.fetchedAt))} 기준${old ? ' · 최신 조회 실패' : ''}`; }
  if (kind === 'paper') { const m = snapshot.paperMeta || {}, ret = m.startTotal > 0 && m.total > 0 ? (m.total / m.startTotal - 1) * 100 : null; $('#hm-paper-text').innerHTML = `${m.days ? ` · ${m.days}일째` : ''}${ret === null ? '' : ` · 원금 대비 <b class="${toneClass(ret)}">${pct(ret)}</b>`} · ${esc(stamp(m.asOf || snapshot.fetchedAt))} 기준 ${tip(paperText(m, snapshot.fetchedAt))}`; }
  $('#hm-refresh').hidden = !(kind === 'real' || kind === 'paper');
  $('#hm-kpis').hidden = !snapshot;
  if (none) $('#hm-connect-state').textContent = document.querySelector('#toss-status')?.textContent || '';
}
$('#hm-connect-go').onclick = () => { document.querySelector('[data-view="settings"]')?.click(); setTimeout(() => { const i = document.querySelector('#workspace-connections input:not([type="checkbox"])'); i?.focus(); i?.scrollIntoView({ block: 'center' }); }, 200); };
// 새로고침: 실계좌는 PC를 거쳐 토스를 다시 읽고, 팀 모의계좌는 PC(실시간) → 공개 자료 순서로 다시 읽는다.
let paperBusy = false;
const refreshBtn = $('#hm-refresh'), bandMsg = $('#hm-band-msg');
function setRefreshing(on) { refreshBtn.disabled = on; refreshBtn.textContent = on ? '새로고침 중…' : '새로고침'; }
refreshBtn.onclick = async () => {
  bandMsg.textContent = '';
  if (!snapshot?.paper) { const t = document.querySelector('#toss-refresh'); if (t && !t.disabled) t.click(); return; }
  if (paperBusy) return; paperBusy = true; setRefreshing(true);
  try {
    const snap = assetSnapshotFrom(await loadMockAccount({ fresh: true, maxAge: 0 }));
    window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot', { detail: snap }));
    window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: { amount: snap.demoCash, note: '모의계좌 예수금' } }));
  } catch (e) { bandMsg.textContent = `새로고침하지 못했습니다(${e.message}).`; }
  finally { paperBusy = false; setRefreshing(false); }
};
window.addEventListener('teamquant:connection', e => { connection = e.detail?.status || 'unknown'; if (!paperBusy) setRefreshing(connection === 'loading'); syncState(); });
window.addEventListener('teamquant:asset-snapshot', syncState);
window.addEventListener('teamquant:asset-clear', () => { connection = 'error'; syncState(); });

// 홈 맨 위 두 칸(지수 대비 수익률 · 오늘 시장)은 따로 그린다. 홈 뼈대(.hm)가 생긴 뒤에 붙는다.
import('/home-top-ui.js').catch(() => { for (const id of ['#ht-compare', '#ht-market']) { const c = $(id); if (c) c.hidden = true; } });
