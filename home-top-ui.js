// 홈 맨 위 두 칸: ① 지수 대비 수익률(같은 기간 내 계좌 · S&P500(원화 기준) · 코스피, 1·3·6개월, 시작 = 100인 선 3개) ② 오늘 시장(지수·환율 한 줄 · 기사에 많이 나온 이유 · 내 종목 소식).
// 셋째 자리(#hm-tonight)는 비워 둔다. 계산은 이 브라우저 안에서만 하고, 서버에는 지수·종목 코드로 공개 시세·기사만 묻는다.
// 체결 내역·보유는 홈(brief-ui.js)이 이미 받아 둔 것을 다시 쓰고(PC 조회를 늘리지 않음) 저장하지 않는다. 브라우저에 남기는 것은 고른 기간 하나뿐이다.
// 원인을 단정하는 말(때문·덕분·탓·영향)은 쓰지 않는다. 기사 낱말 수와 원문 링크, 등락 숫자만 보여 준다.
import { tip } from '/tooltip-ui.js';
import { reportCard } from '/lib/report-card.js';
import { koreaDay } from '/lib/asset-timeline.js';
import { monthsAgo, indexCompare, pickNews } from '/lib/index-compare.js';
import { getJson } from '/lib/client-data.js';
import { kstStamp } from '/lib/paper-public.js';
import { mockCached, loadMockAccount } from '/paper-account-ui.js';
import { homeSnapshot, homeBriefs, homeHistory, homeIndex, homeConnection, marketReasonsBoth } from '/brief-ui.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
const MINUS = '−';
const signOf = v => v > 0 ? '+' : v < 0 ? MINUS : '';
const pct1 = v => { if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(1)); return `${signOf(r)}${Math.abs(r).toFixed(1)}%`; };
const pp = v => { if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(1)); return `${signOf(r)}${Math.abs(r).toFixed(1)}%p`; };
const tone = v => !Number.isFinite(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => koreaDay(Date.now());
const day = ymd => !ymd ? '' : String(ymd).slice(0, 4) === today().slice(0, 4) ? String(ymd).slice(5, 10) : String(ymd).slice(0, 10);
const stamp = iso => { const k = kstStamp(iso); return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(k) ? `${day(k.slice(0, 10))} ${k.slice(11)}` : ''; };
const shiftDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const clip = (s, n = 40) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const link = (url, text) => { const u = safeUrl(url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text); };
const onHome = () => document.querySelector('.view.active')?.dataset.page === 'home';
const $id = id => document.getElementById(id);

// 계산(monthsAgo · indexCompare · pickNews)은 lib/index-compare.js 에 있다(node 시험용). 예전처럼 이 모듈에서도 다시 내보낸다.
export { monthsAgo, indexCompare, pickNews };

// ── ① 지수 대비 수익률 ───────────────────────────────────────
const MONTHS = [1, 3, 6], KEY = 'tq:home-top:months';
let months = (() => { try { const v = Number(localStorage.getItem(KEY)); return MONTHS.includes(v) ? v : 3; } catch { return 3; } })();
const OWN_NAME = { real: '내 계좌', paper: '팀 모의계좌', demo: '예시 자산' }, LINE_NAME = { real: '내 계좌', paper: '모의계좌', demo: '예시' };
const TIP_HOLD = '체결 기록으로 날마다 보유를 되돌려 계산했습니다.\n중간에 넣은 돈(추가 매수)은 수익으로 치지 않습니다.\n현금은 빠져 있어 토스 앱 수익률과 다를 수 있습니다.\nS&P500은 원화 기준(지수 × 달러 환율)이라 뉴스의 달러 기준 등락과 다릅니다.\n두 지수 모두 배당이 빠진 가격입니다. 짧은 기간은 운에 좌우됩니다.';
const TIP_PAPER = '팀 모의계좌가 하루 1번 기록한 총자산(현금 포함)으로 계산했습니다.\nS&P500은 원화 기준(지수 × 달러 환율)이고, 그 날짜에 아직 끝나지 않은 미국 장은 전날 종가를 씁니다.\n두 지수 모두 배당이 빠진 가격입니다. 짧은 기간은 운에 좌우됩니다.';
let cmpRun = 0, cmpTimer = 0, errorAt = 0, lastChart = null;
// 내 계좌 선: 규칙 화면 '내 계좌 최근 기간'과 같은 계산(core-ui.js accountPath)을 먼저 쓴다. 없거나 실패하면 홈이 받아 둔 체결 내역으로 같은 방식(reportCard)으로 계산한다.
const DAYS = { 1: 31, 3: 91, 6: 183 };
let accountPath = null;
import('/core-ui.js').then(m => { if (typeof m.accountPath === 'function') { accountPath = m.accountPath; scheduleCompare(); } }).catch(() => { /* 없으면 아래 계산으로 */ });

async function ownPoints(kind, snap, from, to, fx) {
  if (accountPath) {
    try { const r = await accountPath(DAYS[months]); if (r?.ok && r.points?.length) return { points: r.points, notes: r.notes || [] }; if (r?.reason) return { reason: r.reason }; } catch { /* 아래 계산으로 */ }
  }
  if (kind === 'paper') {
    const pub = mockCached() || await loadMockAccount({ fresh: false, maxAge: 10 * 60e3 }).catch(() => null);
    if (!pub) return { reason: '팀 모의계좌 기록을 받지 못했습니다 · 잠시 뒤 다시 읽습니다' };
    return { points: (pub.marks || []).filter(m => m?.date >= from && m.date <= to && m.total > 0).map(m => ({ date: m.date, own: m.total })), notes: [] };
  }
  const h = homeHistory();
  if (!h) return { wait: true }; // 홈이 체결 내역을 받는 중
  if (h.error) return { reason: '체결 내역을 못 읽어 비교하지 못했습니다' };
  if (h.empty) return { reason: '보유 주식이 없어 비교하지 않습니다' };
  const rc = reportCard({ positions: (snap.positions || []).map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.quantity })), orders: h.orders, candlesBySymbol: h.candlesBySymbol, fxCandles: fx.length ? fx : h.fxCandles, fxNow: snap.fx?.midRate ?? null, from, to });
  if (!rc.ok) return { points: [], notes: [] };
  return { points: rc.series.map(x => ({ date: x.date, own: x.actual })), notes: [...(rc.notes || []).filter(n => !/규칙 계산 도구/.test(n)), ...(h.paginationComplete ? [] : ['거래 내역을 일부만 불러와 정확하지 않을 수 있음'])] };
}

async function indexCandles(symbol) {
  try { return (await homeIndex(symbol))?.candles || []; }
  catch (e) { if (e?.name !== 'AbortError') return []; try { return (await homeIndex(symbol))?.candles || []; } catch { return []; } } // 홈이 새 계좌로 바뀌며 취소된 요청이면 한 번 더
}
function compareHead(kind) {
  const title = kind === 'real' ? '지수 대비 내 수익률' : '지수 대비 수익률';
  const seg = `<div class="ht-seg" role="group" aria-label="비교 기간">${MONTHS.map(m => `<button type="button" data-ht-months="${m}" aria-pressed="${m === months}">${m}개월</button>`).join('')}</div>`;
  return `<header><h3>${title} ${tip(kind === 'paper' ? TIP_PAPER : TIP_HOLD)}</h3>${kind === 'none' ? '' : seg}</header>`;
}
function drawCompare(kind, html) { const el = $id('ht-compare'); if (!el) return; lastChart = null; el.innerHTML = compareHead(kind) + html; }
function lineSvg(line, names, W, aria) {
  const H = 120, T = 10, B = 10, L = 2, R = Math.min(132, Math.max(104, Math.round(W * 0.3)));
  const keys = ['own', 'spx', 'kospi'].filter(k => line.some(p => Number.isFinite(p[k])));
  const vals = line.flatMap(p => keys.map(k => p[k])).filter(Number.isFinite);
  let lo = Math.min(100, ...vals), hi = Math.max(100, ...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const n = line.length, X = i => L + (n === 1 ? 0 : i / (n - 1)) * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = k => line.map((p, i) => Number.isFinite(p[k]) ? `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}` : null).filter(Boolean).join(' ');
  // 선 끝 이름표(범례 대신): 겹치지 않게 14px 간격으로 벌린다.
  const ends = keys.map(k => { let i = n - 1; while (i > 0 && !Number.isFinite(line[i][k])) i--; return { k, y: Y(line[i][k]), v: line[i][k] - 100 }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const over = ends.length ? ends.at(-1).y - (H - 4) : 0; if (over > 0) for (const e of ends) e.y -= over;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(aria)}"><line class="base" x1="${L}" x2="${(W - R).toFixed(1)}" y1="${Y(100).toFixed(1)}" y2="${Y(100).toFixed(1)}"/>${keys.map(k => `<polyline class="l-${k}" points="${path(k)}"/>`).join('')}${ends.map(e => `<text class="t-${e.k}" x="${(W - R + 6).toFixed(1)}" y="${(e.y + 4).toFixed(1)}">${esc(names[e.k])} ${esc(pct1(e.v))}</text>`).join('')}</svg>`;
}
function paintChart() {
  const host = $id('ht-compare')?.querySelector('.ht-chart'); if (!host || !lastChart) return;
  const W = Math.max(240, Math.round(host.clientWidth || 480)); if (lastChart.w === W && host.firstElementChild) return;
  lastChart.w = W; host.innerHTML = lineSvg(lastChart.line, lastChart.names, W, lastChart.aria);
}
const sizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => paintChart()) : null;

function scheduleCompare(ms = 60) { clearTimeout(cmpTimer); cmpTimer = setTimeout(() => void renderCompare(), ms); }
async function renderCompare() {
  const run = ++cmpRun, snap = homeSnapshot();
  const kind = !snap ? 'none' : snap.paper ? 'paper' : snap.demo ? 'demo' : 'real';
  if (kind === 'none') {
    // 공개 사이트는 PC 조회가 실패한 뒤 팀 모의계좌를 불러오므로 잠깐 기다린 뒤에만 빈 안내를 띄운다.
    if (homeConnection() === 'error' && !errorAt) errorAt = Date.now(); // 이 모듈이 붙기 전에 실패 소식이 온 경우
    const waiting = homeConnection() !== 'error' || Date.now() - errorAt < 3000;
    drawCompare('none', `<p class="ht-empty">${waiting ? '계좌 확인 중…' : '계좌를 연결하면 지수와 비교합니다'}</p>`);
    if (waiting && homeConnection() === 'error') scheduleCompare(3100);
    return;
  }
  const el = $id('ht-compare'); if (!el) return;
  if (!el.querySelector('.ht-chart, .ht-empty')) drawCompare(kind, '<div class="ht-skel shimmer"></div>');
  const [spx, ks, fx] = await Promise.all(['^GSPC', '^KS11', 'KRW=X'].map(indexCandles));
  if (run !== cmpRun) return;
  const to = today(), from = monthsAgo(to, months), notes = [];
  let res = null;
  try {
    const own = await ownPoints(kind, snap, from, to, fx);
    if (run !== cmpRun) return;
    if (own.wait) { if (!el.querySelector('.ht-chart')) drawCompare(kind, '<div class="ht-skel shimmer"></div>'); return; }
    if (own.reason) { drawCompare(kind, `<p class="ht-empty">${esc(own.reason)}</p>`); return; }
    // 팀 모의계좌는 한국 날짜로 찍은 평가점이라 그날 아직 안 끝난 미국 장은 전날 종가로 맞춘다.
    res = indexCompare({ points: own.points, spx, kospi: ks, fx, usLag: kind === 'paper' });
    notes.push(...own.notes.map(n => String(n).replace('체결 이력', '체결 내역')));
    if (res && res.from > shiftDays(from, 7)) notes.push(kind === 'paper' ? `${day(res.from)}부터 기록이 있어 그 뒤만 비교` : `${day(res.from)}부터 시세가 있어 그 뒤만 비교`);
  } catch { res = null; }
  if (run !== cmpRun) return;
  if (!res) { drawCompare(kind, '<p class="ht-empty">거래일이 이틀 넘게 쌓이면 비교합니다</p>'); return; }
  const name = OWN_NAME[kind], noIndex = res.spx === null && res.kospi === null;
  const vs = [res.vsSpx === null ? '' : `S&P500보다 <b class="${tone(res.vsSpx)}">${pp(res.vsSpx)}</b>`, res.vsKospi === null ? '' : `코스피보다 <b class="${tone(res.vsKospi)}">${pp(res.vsKospi)}</b>`].filter(Boolean).join(' · ');
  const basis = kind === 'paper' ? '총자산(현금 포함) · 가상 돈' : kind === 'demo' ? '현금 제외 · 실제 아님' : '현금 제외';
  drawCompare(kind, `<p class="ht-meta">${esc(day(res.from))} ~ ${esc(day(res.to))} · ${basis} · 원화 기준</p>
    <p class="ht-nums"><span>${name} <b class="${tone(res.own)}">${pct1(res.own)}</b></span><span>S&P500 <b class="${tone(res.spx)}">${pct1(res.spx)}</b></span><span>코스피 <b class="${tone(res.kospi)}">${pct1(res.kospi)}</b></span></p>
    <p class="ht-vs">${noIndex ? '지수 시세를 못 받아 내 계좌만 보여 줍니다' : vs}</p>
    <div class="ht-chart"></div>${notes.length ? `<p class="ht-note">${esc(notes.join(' · '))}</p>` : ''}`);
  const aria = `${day(res.from)}부터 ${day(res.to)}까지(시작 = 100) ${name} ${pct1(res.own)}, S&P500 ${pct1(res.spx)}, 코스피 ${pct1(res.kospi)}`;
  lastChart = { line: res.line, names: { own: LINE_NAME[kind], spx: 'S&P500', kospi: '코스피' }, aria, w: 0 };
  paintChart();
  const host = $id('ht-compare')?.querySelector('.ht-chart'); if (host && sizer) { sizer.disconnect(); sizer.observe(host); }
}
$id('ht-compare')?.addEventListener('click', e => {
  const b = e.target.closest?.('[data-ht-months]'); if (!b) return;
  const m = Number(b.dataset.htMonths); if (!MONTHS.includes(m) || m === months) return;
  months = m; try { localStorage.setItem(KEY, String(m)); } catch { /* 기억 못 해도 이번 화면은 바뀐다 */ }
  void renderCompare();
});

// ── ② 오늘 시장 ──────────────────────────────────────────────
const MARKET_TIP = 'AI 요약(있을 때): 장 마감 기사(네이버 뉴스)를 PC 프로그램에서 Claude(Opus 5.5)가 국내 15:50 · 미국 06:40에 묶은 것입니다. 기사에 나온 이유만 쓰고 인과를 확인한 것은 아닙니다. 투자 권유가 아닙니다.\n지수·환율: 네이버 증권 시세(늦을 수 있음). 미국 장이 끝났으면 간밤 종가입니다.\n기사에 많이 나온 이유: 국내·미국 장 마감 기사 제목·요약에 많이 나온 낱말을 센 것이며, 원인을 확인한 것은 아닙니다.\n평소보다 큰 움직임: 최근 60거래일 하루 움직임의 2배를 넘을 때 표시합니다.\n내 종목 소식: 3일 안 공시 · 평소의 2배 넘는 움직임 · 오늘 기사 2건 이상인 종목을 최대 3개 보여 줍니다.';
const ISSUE_KEY = { '^KS11': 'KOSPI', '^KQ11': 'KOSDAQ', '^GSPC': 'SPX', '^IXIC': 'IXIC', 'KRW=X': 'USDKRW' }, LEVEL = { urgent: '긴급', caution: '주의' };
const mk = { at: 0, data: null, failed: false, issues: null, issuesAt: 0, reasons: null, why: null, loading: null };
const fxText = v => Number.isFinite(v) ? `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}원` : '—';

async function loadMarket(force = false) {
  if (mk.loading) return mk.loading;
  if (!force && mk.at && Date.now() - mk.at < 5 * 60e3) { drawMarket(); return; }
  mk.loading = (async () => {
    const wantIssues = !mk.issues || Date.now() - mk.issuesAt > 5 * 60e3;
    const [ov, iss, rs, why] = await Promise.allSettled([
      getJson(`/api/market-overview?market=KOSPI&part=index&t=${Math.floor(Date.now() / 60e3)}`),
      wantIssues ? getJson('/api/issues?file=latest') : Promise.resolve(mk.issues),
      marketReasonsBoth(),
      getJson(`/data/market-why.json?v=${Math.floor(Date.now() / 600e3)}`) // AI 요약(없으면 실패 → 낱말 세기)
    ]);
    if (ov.status === 'fulfilled') { mk.data = ov.value; mk.failed = false; } else mk.failed = true;
    if (iss.status === 'fulfilled' && wantIssues) { mk.issues = iss.value; mk.issuesAt = Date.now(); }
    if (rs.status === 'fulfilled') mk.reasons = rs.value;
    if (why.status === 'fulfilled') mk.why = why.value;
    mk.at = Date.now();
    drawMarket();
  })().finally(() => { mk.loading = null; });
  return mk.loading;
}
// 이슈 자료의 '평소의 몇 배'(z)는 같은 거래일 값일 때만 쓴다.
function bigMoves() {
  const out = new Set(), list = mk.issues?.available === false ? [] : mk.issues?.markets || [];
  const at = Object.fromEntries((mk.data?.indices || []).map(x => [x.key, String(x.at || '').slice(0, 10)]));
  for (const m of list) { const key = ISSUE_KEY[m?.symbol]; if (key && m.available !== false && Math.abs(m.z) >= 2 && at[key] && m.date === at[key]) out.add(key); }
  return out;
}
function indexLine() {
  const d = mk.data; if (!d?.indices?.length) return `<li class="ht-empty">시장 자료를 받지 못했습니다 · 잠시 뒤 다시 읽습니다</li>`;
  const ix = Object.fromEntries(d.indices.map(x => [x.key, x])), big = bigMoves();
  const one = (key, label) => { const x = ix[key]; return x ? `<span class="ht-ix">${label} <b class="${tone(x.pct)}">${pct1(x.pct)}</b>${big.has(key) ? '<span class="ht-big">평소보다 큰 움직임</span>' : ''}</span>` : ''; };
  const kr = [one('KOSPI', '코스피'), one('KOSDAQ', '코스닥')].filter(Boolean).join(' · ');
  const usDate = String(ix.SPX?.at || ix.IXIC?.at || '').slice(0, 10), usOpen = ix.SPX?.open || ix.IXIC?.open;
  const usLabel = usOpen ? '미국 장중' : usDate && daysBetween(usDate, today()) <= 1 ? `간밤(${day(usDate)})` : usDate ? `${day(usDate)} 마감` : '미국';
  const us = [one('SPX', 'S&P500'), one('IXIC', '나스닥')].filter(Boolean).join(' · ');
  const f = ix.USDKRW;
  return [kr ? `<li>${kr} <small class="ht-sub-i">${ix.KOSPI?.open ? '장중' : '장 마감'}</small></li>` : '',
    us ? `<li><span class="ht-k">${usLabel}</span> ${us}</li>` : '',
    f ? `<li>달러 환율 <b>${fxText(f.price)}</b> <small class="${tone(f.pct)}">${pct1(f.pct)}</small>${big.has('USDKRW') ? '<span class="ht-big">평소보다 큰 움직임</span>' : ''}</li>` : ''].join('');
}
function reasonsLines() {
  const r = mk.reasons; if (!r && !mk.why) return '<li class="ht-empty">장 마감 기사 확인 중…</li>';
  const row = (label, x) => {
    if (!x) return '';
    if (x.error) return `<li><span class="ht-k">${label}</span> 기사를 불러오지 못했습니다</li>`;
    if (!x.available) return `<li><span class="ht-k">${label}</span> 장 마감 기사를 아직 못 찾았습니다</li>`;
    const top = (x.themes || []).filter(t => t.count >= 1).slice(0, 2).map(t => t.label), a = x.articles?.[0];
    return `<li><span class="ht-k">${label}</span> ${top.length ? `기사에 많이 나온 이유: <b>${esc(top.join(', '))}</b>` : '기사에서 뚜렷한 이유 낱말을 못 찾았습니다'}${a && safeUrl(a.link) ? ` · ${link(a.link, '첫 기사')}` : ''}</li>`;
  };
  // AI 요약(2026-11-26): 30시간 안 · 출처 붙은 이유가 있을 때만. 이유마다 첫 기사 하나만 건다.
  const ai = s => { const e = mk.why?.[s]; return e?.headline && e.reasons?.length && Date.now() - Date.parse(e.at || mk.why.generatedAt || 0) < 30 * 3600e3 ? e : null; };
  const aiRow = (label, e) => `<li><span class="ht-k">${label}</span> <b>${esc(e.headline)}</b> <small class="ht-ai">AI 요약${e.date ? ` · ${esc(day(e.date))}` : ''}</small><ul class="ht-why">${e.reasons.slice(0, 3).map(x => `<li>${esc(x.text)}${x.links?.[0] && safeUrl(x.links[0].url) ? ` · ${link(x.links[0].url, x.links[0].host || '기사')}` : ''}</li>`).join('')}</ul></li>`;
  const hot = (mk.issues?.issues || []).find(i => LEVEL[i?.assess?.level] && Date.now() - Date.parse(i.lastSeen || i.firstSeen) < 6 * 3600e3);
  return (ai('KR') ? aiRow('국내', ai('KR')) : row('국내', r?.KR)) + (ai('US') ? aiRow('미국', ai('US')) : row('미국', r?.US)) + (hot ? `<li><span class="ht-level l-${esc(hot.assess.level)}">${LEVEL[hot.assess.level]}</span> ${link(hot.links?.[0]?.link, clip(hot.title, 60))}</li>` : '');
}
function mineBlock() {
  const snap = homeSnapshot(), head = '<h4>내 종목 소식</h4>';
  if (!snap) return `<div class="ht-mine">${head}<p class="ht-empty">계좌를 연결하면 내 종목 소식이 보입니다</p></div>`;
  const positions = snap.positions || []; if (!positions.length) return `<div class="ht-mine">${head}<p class="ht-empty">보유 종목이 없습니다</p></div>`;
  const briefs = homeBriefs(), items = pickNews(positions, briefs, today()), pending = positions.some(p => !briefs.has(p.symbol));
  if (!items.length) return `<div class="ht-mine">${head}<p class="ht-empty">${pending ? '내 종목 소식 확인 중…' : '내 종목: 오늘 공시·큰 움직임 없음'}</p></div>`;
  return `<div class="ht-mine">${head}<ul class="ht-lines">${items.map(x => `<li><button type="button" class="ht-name" data-open-stock="${esc(x.symbol)}">${esc(x.name)}</button> <b class="${tone(x.day)}">${pct1(x.day)}</b>${x.big ? ` · 평소보다 큰 폭${Number.isFinite(x.typical) ? `(평소 ±${x.typical}%)` : ''}` : ''}${x.disc ? ` · 공시 ${link(x.disc.link, `「${clip(x.disc.title)}」`)}` : x.news ? ` · 오늘 기사 ${x.news.count}건 ${link(x.news.first.link, `「${clip(x.news.first.title)}」`)}` : ''}</li>`).join('')}</ul></div>`;
}
function drawMarket() {
  const el = $id('ht-market'); if (!el) return;
  const when = mk.data?.asOf ? `<span class="ht-when">${esc(stamp(mk.data.asOf))} 기준</span>` : '';
  el.innerHTML = `<header><h3>오늘 시장 ${tip(MARKET_TIP)}</h3>${when}</header><ul class="ht-lines">${indexLine()}${reasonsLines()}</ul>${mineBlock()}`;
}
$id('ht-market')?.addEventListener('click', e => { const b = e.target.closest?.('[data-open-stock]'); if (b) window.dispatchEvent(new CustomEvent('teamquant:open-stock', { detail: { symbol: b.dataset.openStock } })); });

// ── 이벤트 ───────────────────────────────────────────────────
let mineTimer = 0;
const redrawMine = () => { clearTimeout(mineTimer); mineTimer = setTimeout(drawMarket, 150); };
window.addEventListener('teamquant:asset-snapshot', () => { scheduleCompare(); redrawMine(); });
window.addEventListener('teamquant:asset-clear', () => { errorAt = Date.now(); scheduleCompare(); redrawMine(); }); // 지운 뒤 팀 모의계좌가 다시 뜰 때까지 잠깐 기다린다
window.addEventListener('teamquant:home-history', () => scheduleCompare());
window.addEventListener('teamquant:core-ready', () => scheduleCompare());
window.addEventListener('teamquant:connection', e => { if (e.detail?.status === 'error') errorAt = Date.now(); scheduleCompare(); });
window.addEventListener('teamquant:brief', redrawMine);
// 이슈 화면이 같은 자료를 이미 받았으면 그것을 쓴다(요청을 줄인다).
window.addEventListener('teamquant:issues', e => { if (e.detail) { mk.issues = e.detail; mk.issuesAt = Date.now(); if (mk.at) drawMarket(); } });
window.addEventListener('teamquant:page', () => { if (onHome() && Date.now() - mk.at > 5 * 60e3) void loadMarket(true); });
setInterval(() => { if (document.visibilityState === 'visible' && onHome()) void loadMarket(true); }, 5 * 60e3);
void renderCompare();
void loadMarket();
