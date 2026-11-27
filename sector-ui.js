// 섹터 화면 + 홈 '내 섹터 비중' 카드.
//   맨 위: 내 보유의 섹터 비중(상한 초과·줄일 금액·내 종목 이슈) → 섹터 타일(기간 수익률·오늘·52주 경로·이슈 수)
//   → 고른 섹터의 대표 회사 수익률, 정책·정치 이슈(날짜·출처, 한 줄씩 접힘), 나라별 정책, 지켜볼 일정. 옆 칸: 시장 전체 이슈.
// 수익률은 data/sectors.json(빌드 때 계산)을 먼저 보여 주고, 고른 섹터만 /api/market으로 오늘 기준을 다시 계산한다. '오늘'은 섹터 ETF 현재가(/api/quote).
// 이슈는 사람이 적은 자료(lib/sectors.js)다. 오를지 내릴지는 적지 않는다 — 거시·정책 변수로 방향을 맞힌 근거가 없기 때문이다.
import { SECTORS, COMMON_ISSUES, ACTOR_NAME, SECTOR_ASOF, classify, sectorById, sectorExposure, issuesFor, returnsFrom } from '/lib/sectors.js';
import { candles as fetchCandles, getStyle, fundamentals, getJson } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${(Math.abs(v) * 100).toFixed(d)}%` : '—';
const tone = v => v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : '';
const manwon = v => Number.isFinite(v) ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만 원` : '—';
// 날짜: 올해는 'MM-DD'(달만 있으면 'n월'), 다른 해는 그대로(연도만 있으면 'n년').
const md = d => { const s = String(d || ''), y = String(new Date().getFullYear()); if (s.startsWith(y + '-')) { const r = s.slice(5); return r.length === 2 ? `${Number(r)}월` : r; } return /^\d{4}$/.test(s) ? `${s}년` : s; };
const hm = iso => { const t = new Date(iso); return Number.isFinite(t.getTime()) ? t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; };
const daysSince = d => { const t = Date.parse(`${d}T00:00:00+09:00`); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : null; };
const STYLE_NAME = { balanced: '균형', growth: '성장', value: '가치', dividend: '배당' };
const HORIZONS = [['w1', '1주'], ['m1', '1개월'], ['m3', '3개월'], ['m6', '6개월'], ['ytd', '올해'], ['y1', '1년']];
const TILE_HORIZONS = [['today', '오늘'], ...HORIZONS]; // 타일 기간(표는 HORIZONS 전부)
const KIND_TIP = { 정책: '법·규제·보조금', 정치: '선거·의회·정부 발언', 무역: '관세·수출통제·협정', 실적: '회사 실적·수주', 시장: '시장 움직임' };
const EMPTY = '<p class="cr-muted">보유 종목 없음 · <button type="button" class="text-button" data-demo-start>예시 자산 켜기</button></p>';

const style = document.createElement('style'); style.textContent = `
#core-sectors .cr-card{overflow:hidden;min-width:0}
.sc-minecard{margin:0 0 var(--tq-sp-4)}
.sc-top{display:flex;justify-content:space-between;align-items:center;gap:var(--tq-sp-2) var(--tq-sp-3);flex-wrap:wrap;margin:0 0 var(--tq-sp-2)}
.sc-asof{display:inline-flex;align-items:center;flex-wrap:wrap;gap:var(--tq-sp-1);font-size:var(--tq-fs-2);color:var(--ck-sub)}.sc-asof b{font-size:var(--tq-fs-3);color:var(--ck-ink)}
.sc-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin:0 0 var(--tq-sp-4)}
.sc-tile{border:1px solid var(--ck-line);border-radius:var(--tq-r-2);background:var(--tq-paper);padding:var(--tq-sp-3);text-align:left;font:inherit;cursor:pointer;display:grid;gap:var(--tq-sp-1);min-width:0;transition:border-color .15s,box-shadow .15s}
.sc-tile:hover{border-color:var(--tq-faint)}.sc-tile[aria-pressed=true]{border-color:var(--ck-ink);box-shadow:0 0 0 1px var(--ck-ink) inset}
.sc-tile .n{font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center;gap:6px}.sc-tile .n small{font-weight:500;font-size:11px;color:var(--ck-sub);white-space:nowrap}
.sc-tile .r{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.3px}.sc-tile .r.up{color:var(--ck-up)}.sc-tile .r.down{color:var(--ck-down)}
.sc-tile .s{font-size:var(--tq-fs-1);color:var(--ck-sub);display:flex;gap:var(--tq-sp-2);flex-wrap:wrap}.sc-tile svg{width:100%;height:28px;display:block;margin-top:2px}.sc-tile polyline{fill:none;stroke-width:1.6}
.sc-tile .m{display:inline-flex;align-items:center;gap:var(--tq-sp-1);font-size:11.5px;border-radius:var(--tq-r-pill);padding:1px var(--tq-sp-2);background:var(--tq-soft);color:var(--tq-accent);font-weight:600;white-space:nowrap}
.sc-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.sc-head p{margin:var(--tq-sp-1) 0 0;font-size:13.5px;color:var(--ck-sub);line-height:1.6;max-width:720px}
.sc-scroll{overflow-x:auto;max-width:100%}.sc-table{width:100%;border-collapse:collapse;font-size:13px;min-width:560px}.sc-table th{font-size:11.5px;color:var(--ck-sub);font-weight:600;text-align:right;padding:7px 6px;border-bottom:1px solid var(--ck-line);white-space:nowrap}.sc-table th:first-child{text-align:left}
.sc-table td{padding:7px 6px;border-bottom:1px solid var(--tq-line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sc-table td:first-child{text-align:left;font-weight:600;white-space:normal}.sc-table td small{display:inline-block;margin-left:5px;font-weight:500;font-size:11px;color:var(--ck-sub)}
.sc-table .up{color:var(--ck-up)}.sc-table .down{color:var(--ck-down)}.sc-table tr.grp td{background:var(--ck-soft);font-weight:600}.sc-table .mine{background:var(--tq-soft);color:var(--tq-accent);border-radius:var(--tq-r-pill);padding:0 7px;font-size:11px;font-weight:600}
.sc-issues{list-style:none;margin:0;padding:0;display:grid;gap:0}.sc-issues li{padding:var(--tq-sp-2) 0;border-top:1px solid var(--ck-line)}.sc-issues li:first-child{border-top:0;padding-top:0}
.sc-iss summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:var(--tq-sp-1) var(--tq-sp-2)}.sc-iss summary::-webkit-details-marker{display:none}
.sc-iss summary time{font-size:var(--tq-fs-1);color:var(--ck-sub);font-variant-numeric:tabular-nums}
.sc-iss summary b{font-size:var(--tq-fs-2);line-height:1.45;flex:1 1 220px;min-width:0}
.sc-iss[open] summary b{text-decoration:underline;text-underline-offset:3px}
.sc-issues .tags{display:inline-flex;gap:var(--tq-sp-1);flex-wrap:wrap;align-items:center}
.sc-actor{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 7px;background:#eef0f3;color:#2b3648}.sc-actor.US{background:#e8eefc;color:#1d3f94}.sc-actor.EU{background:#eaf3ff;color:#174d8a}.sc-actor.KR{background:#e9f7ef;color:#0f6b3b}.sc-actor.CN{background:#fdecec;color:#9b1c1c}.sc-actor.JP{background:#f6ecf9;color:#6b2d84}.sc-actor.IMO{background:#eef0f3}
.sc-kind{font-size:11.5px;color:var(--ck-sub);border:1px solid var(--ck-line);border-radius:6px;padding:1px 7px}
.sc-issues .mine{font-size:11.5px;font-weight:700;color:var(--tq-accent)}
.sc-eff{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tq-faint)}.sc-eff.p{background:var(--ck-ok)}.sc-eff.m{background:var(--ck-bad)}
.sc-iss p{margin:var(--tq-sp-1) 0 0;font-size:13px;color:var(--tq-sub);line-height:1.6}.sc-issues .hits{margin-top:var(--tq-sp-1);font-size:var(--tq-fs-1);color:var(--ck-sub)}.sc-issues .hits .mine{font-size:inherit}
.sc-iss a{display:inline-block;margin-top:var(--tq-sp-1);font-size:var(--tq-fs-1);color:var(--ck-sub);text-decoration:underline}
.sc-src{margin:var(--tq-sp-3) 0 0;display:flex;align-items:center}
.sc-stance-fold>summary{cursor:pointer;padding:12px 0;line-height:20px;font-size:13px;font-weight:600;color:var(--tq-sub)}.sc-stance{width:100%;border-collapse:collapse;font-size:13px}.sc-stance th{text-align:left;padding:var(--tq-sp-2) 10px var(--tq-sp-2) 0;vertical-align:top;white-space:nowrap;width:60px}.sc-stance td{padding:var(--tq-sp-2) 0;border-bottom:1px solid var(--tq-line);line-height:1.6;color:var(--tq-sub);text-align:left;white-space:normal}
.sc-watch{margin:0;padding-left:18px;font-size:13.5px;display:grid;gap:5px;line-height:1.5}.sc-watch b{font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
.sc-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--tq-sp-2);margin:0 0 var(--tq-sp-3)}.sc-sum>div{background:var(--ck-soft);border-radius:var(--tq-r-2);padding:10px var(--tq-sp-3);min-width:0}.sc-sum span{display:flex;align-items:center;font-size:11.5px;color:var(--ck-sub)}.sc-sum b{display:block;font-size:17px;margin:3px 0 1px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.sc-sum small{font-size:11.5px;color:var(--ck-sub);line-height:1.4;display:block}.sc-sum b.bad{color:var(--ck-bad)}
.sc-bars{list-style:none;margin:0;padding:0;display:grid;gap:var(--tq-sp-2)}.sc-bars li{display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr) 44px 72px;gap:var(--tq-sp-2);align-items:center;font-size:13px}.sc-bars .n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sc-bars i{display:block;height:8px;border-radius:var(--tq-r-pill);background:var(--tq-line);position:relative;overflow:hidden}.sc-bars i::after{content:'';position:absolute;inset:0;width:var(--w);background:var(--ck-ink);border-radius:var(--tq-r-pill)}.sc-bars i.over::after{background:var(--ck-bad)}.sc-bars i.idx::after{background:var(--tq-faint)}
.sc-bars b{text-align:right;font-variant-numeric:tabular-nums}.sc-bars small{font-size:11.5px;color:var(--ck-sub);text-align:right;white-space:nowrap}.sc-bars small.up{color:var(--ck-up)}.sc-bars small.down{color:var(--ck-down)}
.sc-plan{margin-top:var(--tq-sp-3);border-top:1px solid var(--ck-line);padding-top:10px;font-size:13px;line-height:1.6}.sc-plan ul{margin:6px 0 0;padding-left:18px}.sc-plan li b{font-variant-numeric:tabular-nums}.sc-plan>.cr-muted{display:inline-flex;align-items:center;flex-wrap:wrap}
.sc-mine-issues{margin:var(--tq-sp-3) 0 0;font-size:13px;color:var(--tq-sub);line-height:1.6;border-top:1px solid var(--ck-line);padding-top:10px}.sc-mine-issues span{color:var(--ck-sub)}
.sc-oneline{margin:var(--tq-sp-3) 0 0;font-size:var(--tq-fs-2);color:var(--ck-sub);line-height:1.6}.sc-oneline b.bad{color:var(--ck-bad)}#home-sectors .sc-oneline{margin:0}
.sc-state{font-size:12.5px;color:var(--ck-sub);margin:0}.sc-state[hidden]{display:none}
@media(min-width:1025px){#sc-mine-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 var(--tq-sp-5);align-items:start}#sc-mine-body .sc-mine-issues{grid-column:2}#sc-mine-body>.cr-muted{grid-column:1/-1}}
@media(max-width:640px){.sc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-tile .r{font-size:19px}.sc-sum{grid-template-columns:1fr 1fr}.sc-bars li{grid-template-columns:minmax(60px,auto) minmax(0,1fr) 42px}.sc-bars small{display:none}}`; document.head.append(style);

const S = { data: null, positions: [], cash: null, fx: null, hints: new Map(), sel: 'semi', horizon: 'm1', live: {}, liveState: '', today: { at: null, pct: {}, failed: false, loading: false } };

// ── 화면 ────────────────────────────────────────────────────
const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'sectors'; nav.textContent = '섹터'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'sectors'; page.id = 'core-sectors';
page.innerHTML = `<div class="page-head"><div><h1>섹터 ${tip('섹터별 수익률 · 대표 회사 · 정책·정치 이슈입니다. 수익률은 섹터 ETF와 대표 회사의 공개 시세로 계산하고, 이슈는 날짜·출처를 붙여 직접 정리합니다. 어느 섹터가 오를지는 적지 않습니다(금리·정책 같은 큰 흐름으로 수익률 방향을 맞힌 근거가 없음). 내 돈이 어떤 이슈에 걸려 있는지 보는 화면입니다.')}</h1><p>섹터별 수익률 · 대표 회사 · 정책·정치 이슈 · 내 섹터 비중</p></div></div>
<article class="cr-card sc-minecard" id="sc-mine"><header><h3>내 섹터 비중 ${tip('보유 주식의 섹터별 비중입니다. 가장 큰 섹터가 상한(균형 40% · 성장 50% · 배당 35%)을 넘으면 상한까지 줄일 금액을 보여 줍니다. 줄인 돈은 현금으로 두는 계산이며 다른 섹터를 사라는 뜻이 아닙니다. 지수 ETF는 그 자체로 분산이라 상한에서 뺍니다.')}</h3></header><div id="sc-mine-body"></div></article>
<div class="sc-top"><div class="cp-seg" role="radiogroup" id="sc-h" aria-label="수익률 기간">${TILE_HORIZONS.map(([k, l]) => `<label><input type="radio" name="sc-h" value="${k}" ${k === 'm1' ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><span class="sc-asof" id="sc-asof"></span></div>
<div class="sc-tiles" id="sc-tiles" role="group" aria-label="섹터"></div>
<div class="cr-grid"><div class="cr-main" id="sc-detail"></div>
<aside class="cr-side"><article class="cr-card" id="sc-common"><header><h3>시장 전체 이슈 ${tip('섹터를 가리지 않고 시장 전체에 걸리는 정치·무역·시장 이슈입니다. 날짜와 출처를 함께 둡니다.')}</h3></header><ul class="sc-issues" id="sc-common-body"></ul><p class="cr-muted sc-src">${esc(md(SECTOR_ASOF))} 기준 · 직접 정리 ${tip('이슈는 사람이 직접 고칩니다. 출처를 눌러 원문을 확인하세요.')}</p></article></aside></div>`;
document.querySelector('main').append(page);

function sparkSvg(arr, cls = '') { if (!arr || arr.length < 3) return ''; const min = Math.min(...arr), max = Math.max(...arr), w = 100, h = 28, pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (max === min ? h / 2 : (v - min) / (max - min) * (h - 4))).toFixed(1)}`).join(' '); const last = arr.at(-1) >= arr[0]; return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" stroke="${last ? '#d32f2f' : '#2563eb'}" class="${cls}"/></svg>`; }
const retOf = (id) => { const o = S.data?.sectors?.[id]; return o?.etf?.KR?.ret || o?.basket?.KR || null; };
const mySymbols = () => new Set(S.positions.map(p => String(p.symbol).toUpperCase().split('.')[0]));
const isMine = sym => mySymbols().has(String(sym).toUpperCase().split('.')[0]);

// '오늘': 섹터마다 국내 섹터 ETF의 오늘 등락(현재가 한 번에 받기). 5분 안에는 다시 받지 않는다.
async function loadToday() {
  const T = S.today; if (T.loading || (T.at && Date.now() - Date.parse(T.at) < 5 * 60000)) return;
  T.loading = true; T.failed = false; renderTiles();
  const syms = SECTORS.map(s => s.etf.KR?.symbol).filter(Boolean);
  try { const r = await getJson(`/api/quote?symbols=${encodeURIComponent(syms.join(','))}`); for (const s of syms) { const q = r.quotes?.[s.toUpperCase()]; T.pct[s] = Number.isFinite(q?.pct) ? q.pct / 100 : null; } T.at = r.at || new Date().toISOString(); }
  catch { T.failed = true; }
  finally { T.loading = false; renderTiles(); }
}
function asofHtml() {
  if (S.horizon === 'today') { const T = S.today; return T.at ? `<b>오늘 ${esc(hm(T.at))} 기준</b> · 국내 섹터 ETF 현재가` : T.failed ? '오늘 시세를 받지 못했습니다' : '오늘 시세를 받는 중…'; }
  if (!S.data) return '수익률 자료를 불러오는 중';
  const days = daysSince(S.data.asOf);
  return `<b>${esc(md(S.data.asOf))} 기준</b>${days > 0 ? ` · ${days}일 전` : ''} ${tip("국내 섹터 ETF(없으면 국내 대표 회사 평균)의 수익률입니다. 고른 섹터의 표는 '오늘 시세로 다시 계산'으로 새로 받습니다.")}`;
}
function renderTiles() {
  const host = $('#sc-tiles'); if (!host) return;
  const exp = exposure();
  host.innerHTML = SECTORS.map(s => { const r = retOf(s.id), v = S.horizon === 'today' ? S.today.pct[s.etf.KR?.symbol] : r?.[S.horizon], mine = exp.rows.find(x => x.id === s.id), spark = S.data?.sectors?.[s.id]?.etf?.KR?.spark || S.data?.sectors?.[s.id]?.companies?.[s.companies[0].symbol]?.spark;
    return `<button type="button" class="sc-tile" data-sec="${s.id}" aria-pressed="${s.id === S.sel}"><span class="n">${esc(s.name)}${mine ? `<small class="m">내 보유 ${mine.pct.toFixed(0)}%</small>` : `<small>이슈 ${s.issues.length}건</small>`}</span><span class="r ${tone(v)}">${pct(v)}</span>${sparkSvg(spark)}<span class="s"><span>3개월 ${pct(r?.m3)}</span><span>1년 ${pct(r?.y1)}</span></span></button>`; }).join('');
  host.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { S.sel = b.dataset.sec; renderTiles(); renderDetail(); });
  const a = $('#sc-asof'); if (a) a.innerHTML = asofHtml();
}

function rowHtml(name, ret, { sub = '', mine = false, grp = false } = {}) {
  return `<tr class="${grp ? 'grp' : ''}"><td>${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}${mine ? ' <span class="mine">내 보유</span>' : ''}</td>${HORIZONS.map(([k]) => `<td class="${tone(ret?.[k])}">${pct(ret?.[k])}</td>`).join('')}<td class="${tone(ret?.offHigh)}">${pct(ret?.offHigh)}</td></tr>`;
}
function renderDetail() {
  const host = $('#sc-detail'), s = sectorById(S.sel); if (!host || !s) return;
  const d = S.data?.sectors?.[s.id] || { etf: {}, companies: {}, basket: {} }, live = S.live[s.id] || {};
  const ret = sym => live[sym] || d.companies?.[sym]?.ret || null;
  const etfRet = m => live[d.etf?.[m]?.symbol] || d.etf?.[m]?.ret || null;
  const krCos = s.companies.filter(c => c.market === 'KR'), usCos = s.companies.filter(c => c.market === 'US');
  const issues = [...s.issues].sort((a, b) => b.date.localeCompare(a.date));
  // 2026-11-27 보완 2: 섹터 소개 문장은 이름 옆 ⓘ, 나라별 정책 문장은 닫힌 접힘 안(누르면 보임).
  host.innerHTML = `<article class="cr-card"><div class="sc-head"><div><h3>${esc(s.name)} ${tip(s.desc, `${s.name} 설명`)}</h3></div><div class="cr-actions" style="margin:0"><button type="button" class="secondary" id="sc-live">오늘 시세로 다시 계산</button></div></div><p class="sc-state" id="sc-live-state"${S.liveState ? '' : ' hidden'}>${esc(S.liveState)}</p>
    <h4>수익률 ${tip('섹터 ETF, 대표 회사 단순 평균, 회사별 수익률입니다. 미국 종목은 달러 기준(환율 제외)입니다. 고점 대비 = 최근 1년 최고 종가에서 얼마나 내려왔는지.')}</h4>
    <div class="sc-scroll"><table class="sc-table"><thead><tr><th>구분</th>${HORIZONS.map(([, l]) => `<th>${l}</th>`).join('')}<th>1년 고점 대비</th></tr></thead><tbody>
    ${d.etf?.KR ? rowHtml(d.etf.KR.name, etfRet('KR'), { sub: 'ETF', grp: true, mine: isMine(d.etf.KR.symbol) }) : ''}${d.etf?.US ? rowHtml(d.etf.US.name, etfRet('US'), { sub: 'ETF', grp: true, mine: isMine(d.etf.US.symbol) }) : ''}
    ${d.basket?.KR ? rowHtml(`국내 대표 ${d.basket.KR.n}개 평균`, d.basket.KR, { grp: true }) : ''}${krCos.map(c => rowHtml(c.name, ret(c.symbol), { sub: c.symbol.split('.')[0], mine: isMine(c.symbol) })).join('')}
    ${d.basket?.US ? rowHtml(`미국 대표 ${d.basket.US.n}개 평균`, d.basket.US, { grp: true }) : ''}${usCos.map(c => rowHtml(c.name, ret(c.symbol), { sub: c.symbol, mine: isMine(c.symbol) })).join('')}</tbody></table></div></article>
  <article class="cr-card"><header><h3>주요 이슈 ${tip(Object.entries(KIND_TIP).map(([k, v]) => `${k}(${v})`).join(' · ') + '으로 나눕니다.\n점: 초록 = 이 섹터 회사에 유리 · 주황 = 불리 · 회색 = 둘 다.\n주가가 오른다·내린다는 뜻은 아닙니다.')}</h3><span class="cr-muted">이슈 ${issues.length}건 · 최신순</span></header>
    <ul class="sc-issues">${issues.map(i => issueHtml(i)).join('')}</ul></article>
  <article class="cr-card"><header><h3>나라별 정책 ${tip('각 나라·기구가 이 섹터에서 지금 무엇을 하고 있는지 사실 위주로 적었습니다. 출처가 없는 일반론은 "출처 없음"으로 표시했습니다.')}</h3></header>
    <details class="sc-stance-fold"><summary>${['US', 'EU', 'KR', 'CN', 'JP'].map(k => ACTOR_NAME[k]).join(' · ')}</summary><table class="sc-stance">${['US', 'EU', 'KR', 'CN', 'JP'].map(k => `<tr><th><span class="sc-actor ${k}">${ACTOR_NAME[k]}</span></th><td>${esc(s.stances[k])}</td></tr>`).join('')}</table></details></article>
  <article class="cr-card"><header><h3>지켜볼 일정</h3></header><ul class="sc-watch">${s.watch.map(w => `<li><b>${esc(w.when)}</b>${esc(w.what)}</li>`).join('')}</ul></article>`;
  $('#sc-live').onclick = () => void recomputeLive(s);
}
// 이슈 한 건: 날짜·태그·제목만 한 줄, 누르면 본문·관련 종목·출처.
function issueHtml(i, withSector = false) {
  const eff = i.effect === '+' ? 'p' : i.effect === '−' ? 'm' : '';
  const hits = (i.hits || []).map(h => { const c = SECTORS.flatMap(x => x.companies).find(x => x.symbol === h); const name = c?.name || h; return isMine(h) ? `<span class="mine">${esc(name)}(내 보유)</span>` : esc(name); });
  const mineHit = (i.hits || []).some(isMine);
  return `<li><details class="sc-iss"><summary><time>${esc(md(i.date))}</time><span class="tags"><span class="sc-actor ${esc(i.actor)}">${esc(ACTOR_NAME[i.actor] || i.actor)}</span><span class="sc-kind">${esc(i.kind)}</span><i class="sc-eff ${eff}" role="img" aria-label="${i.effect === '+' ? '회사에 유리한 쪽' : i.effect === '−' ? '회사에 불리한 쪽' : '양쪽 다·불확실'}"></i>${withSector && i.sectorName ? `<span class="sc-kind">${esc(i.sectorName)}</span>` : ''}${mineHit ? '<span class="mine">내 종목</span>' : ''}</span><b>${esc(i.title)}</b></summary><p>${esc(i.text)}</p>${hits.length ? `<div class="hits">관련: ${hits.join(' · ')}</div>` : ''}<a href="${esc(i.source)}" target="_blank" rel="noopener noreferrer">출처</a></details></li>`;
}
async function recomputeLive(s) {
  const st = $('#sc-live-state'); S.liveState = '오늘 시세를 받는 중…'; if (st) { st.textContent = S.liveState; st.hidden = false; }
  const items = [...s.companies, s.etf.KR, s.etf.US].filter(Boolean); const out = S.live[s.id] = { ...(S.live[s.id] || {}) }; let ok = 0, fail = 0;
  await Promise.all(items.map(async it => { try { const c = await fetchCandles(it.symbol, it.currency, '2y'); const r = returnsFrom((c.candles || []).map(x => ({ date: x.date, close: x.close }))); if (r) { out[it.symbol] = r; ok++; } else fail++; } catch { fail++; } }));
  S.liveState = `${ok}개 오늘 시세로 다시 계산${fail ? ` · ${fail}개는 시세를 못 받아 이전 값` : ''} · 평균 줄은 이전 값`;
  if (S.sel === s.id) renderDetail();
}

// ── 내 섹터 비중(홈·섹터 화면 공용) ─────────────────────────
function prefCap() { try { const ses = sessionStorage.getItem('teamQuantSession') || 'guest'; const suf = S.kind === 'paper' ? ':paper' : S.kind === 'demo' ? ':demo' : ''; for (const k of [`teamQuantRules:${ses}${suf}`, `teamQuantRules:${ses}`]) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.prefs?.sectorCap > 0) return v.prefs.sectorCap; } } catch { } return null; }
function exposure() { return sectorExposure(S.positions.map(p => ({ ...p, hint: S.hints.get(p.symbol) || '' })), { cashKrw: S.cash, style: getStyle(), cap: prefCap() }); }
function exposureHtml(exp) {
  if (!exp.rows.length) return EMPTY;
  const mine = issuesFor(S.positions.map(p => p.symbol)), styleName = STYLE_NAME[getStyle()] || '균형';
  const top = exp.top, topOver = top && top.pct > exp.cap && top.id !== 'index' && top.id !== 'bond', capFrom = prefCap() ? '내 규칙' : `${styleName} 성향`;
  const bars = exp.rows.map(r => { const ret = retOf(r.id)?.m1; const over = r.pct > exp.cap && r.id !== 'index' && r.id !== 'bond'; return `<li><span class="n">${esc(r.name)}${tip(r.symbols.map(x => x.name).join(', '), `${r.name} 종목`)}</span><i class="${over ? 'over' : r.id === 'index' || r.id === 'bond' ? 'idx' : ''}" style="--w:${Math.min(100, r.pct).toFixed(1)}%"></i><b>${r.pct.toFixed(0)}%</b><small class="${tone(ret)}">${Number.isFinite(ret) ? `1개월 ${pct(ret, 0)}` : ''}</small></li>`; }).join('');
  const single = exp.rows.filter(r => r.id !== 'index' && r.id !== 'bond').length <= 1;
  // 2026-11-27 보완 2: 계산 기준·줄인 돈의 행방·주의는 제목 ⓘ 안(줄은 숫자만). 이름표는 R1 숫자 + 짧은 라벨.
  const plan = exp.over.length ? `<div class="sc-plan"><b>상한 ${exp.cap}%까지 줄이면 ${tip(`${capFrom} 섹터 상한 ${exp.cap}% 기준입니다. 줄인 돈(전체의 ${exp.cutPctOfTotal.toFixed(0)}%)은 현금으로 둡니다. 다시 살 때는 종목·주문 점검을 거칩니다. 어느 섹터를 사라는 뜻이 아닙니다.`)}</b><ul>${exp.over.map(o => `<li>${esc(o.name)} <b>${o.pct.toFixed(0)}% → ${exp.cap}%</b> · 약 <b>${manwon(o.cutKrw)}</b> 줄이기</li>`).join('')}</ul></div>`
    : `<div class="sc-plan"><span class="cr-muted">모든 섹터 상한 ${exp.cap}% 안 (${capFrom})${single ? ` ${tip('섹터가 하나뿐이라 그 섹터 이슈에 전부 걸려 있습니다.')}` : ''}</span></div>`;
  const issues = mine.length ? `<div class="sc-mine-issues"><span>내 종목에 직접 걸린 이슈 ${mine.length}건 · 최근</span>${mine.slice(0, 3).map(i => `<br>${esc(md(i.date))} ${esc(i.sectorName)} · ${esc(i.title)}`).join('')}</div>` : '';
  return `<div class="sc-sum"><div><span>가장 큰 섹터</span><b class="${topOver ? 'bad' : ''}">${top ? `${esc(top.name)} ${top.pct.toFixed(0)}%` : '—'}</b><small>상한 ${exp.cap}% (${capFrom})</small></div><div><span>사실상 섹터 수 ${tip('고르게 나눴다면 섹터 몇 개에 나눈 셈인지입니다. 두 섹터에 반반이면 2, 한 섹터에 몰리면 1에 가깝습니다.')}</span><b>${exp.effective ? exp.effective.toFixed(1) : '—'}개</b></div><div><span>섹터 이슈</span><b>${mine.length}건</b><small>내 종목에 직접</small></div></div><ul class="sc-bars">${bars}</ul>${plan}${issues}`;
}
function renderMine() { const b = $('#sc-mine-body'); if (b) b.innerHTML = exposureHtml(exposure()); renderHome(); }
function renderCommon() { const b = $('#sc-common-body'); if (b) b.innerHTML = [...COMMON_ISSUES].sort((a, b) => b.date.localeCompare(a.date)).map(i => issueHtml(i)).join(''); }

// 홈 카드: 상한을 넘은 섹터가 있을 때만 한 줄(2026-11-26 홈 설계: 섹터 비중 막대는 시장 › 섹터에만 둔다). 자리는 brief-ui.js placeCards가 정한다.
function renderHome() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let card = document.getElementById('home-sectors');
  if (!card) { card = document.createElement('article'); card.className = 'hm-card'; card.id = 'home-sectors'; host.append(card); }
  const exp = S.positions.length ? exposure() : null;
  if (!exp?.over?.length) { card.hidden = true; card.replaceChildren(); return; } card.hidden = false;
  const o = exp.over[0], extra = exp.over.length > 1 ? ` 외 ${exp.over.length - 1}개` : '';
  card.innerHTML = `<p class="sc-oneline"><b class="bad">섹터 상한 넘음</b> · ${esc(o.name)} ${o.pct.toFixed(0)}% · 상한 ${exp.cap}%${extra} · 줄일 금액 약 ${manwon(o.cutKrw)} ${tip('섹터 상한은 규칙 화면의 섹터 상한(없으면 투자 성향 기본값)입니다. 줄일 금액은 상한까지 낮출 때의 금액이며 어느 섹터를 사라는 뜻이 아닙니다.')} <button type="button" class="text-button" id="home-sectors-go">섹터 자세히 ›</button></p>`;
  $('#home-sectors-go').onclick = () => { if (exp.top && sectorById(exp.top.id)) { S.sel = exp.top.id; renderTiles(); renderDetail(); } $('[data-view="sectors"]')?.click(); }; // 홈에서 오면 내 가장 큰 섹터를 먼저 보여 준다
}

// ── 자료·이벤트 ──────────────────────────────────────────────
async function loadData() { try { const r = await fetch('/data/sectors.json'); if (r.ok) S.data = await r.json(); } catch {} renderTiles(); renderDetail(); renderMine(); }
async function loadHints() { // 분류 못 한 종목만 지표 API의 업종 문자열을 물어본다(종목 코드만 보냄)
  const todo = S.positions.filter(p => classify(p.symbol, p.name) === 'unknown' && !S.hints.has(p.symbol)); if (!todo.length) return;
  await Promise.all(todo.map(async p => { try { const f = await fundamentals(p.symbol); S.hints.set(p.symbol, f?.sector || ''); } catch { S.hints.set(p.symbol, ''); } }));
  renderTiles(); renderMine();
}
window.addEventListener('teamquant:asset-snapshot', e => {
  const snap = e.detail || {}; S.fx = snap.fx?.midRate || null; S.kind = snap.paper ? 'paper' : snap.demo ? 'demo' : 'real';
  S.positions = (snap.positions || []).filter(p => p.symbol).map(p => ({ symbol: p.symbol, name: p.name || p.symbol, currency: p.currency, valueKrw: p.currency === 'USD' ? (S.fx ? p.value * S.fx : null) : p.value })).filter(p => Number.isFinite(p.valueKrw) && p.valueKrw > 0);
  if (snap.demo && Number.isFinite(snap.demoCash)) S.cash = snap.demoCash; else if (!snap.demo) S.cash = null;
  renderTiles(); renderDetail(); renderMine(); void loadHints();
});
window.addEventListener('teamquant:asset-clear', () => { S.positions = []; S.cash = null; S.kind = 'none'; renderTiles(); renderDetail(); renderMine(); });
window.addEventListener('teamquant:cash', e => { if (Number.isFinite(e.detail?.amount)) { S.cash = e.detail.amount; renderMine(); } });
window.addEventListener('teamquant:style', () => { renderTiles(); renderMine(); });
window.addEventListener('teamquant:state', () => renderMine());
page.querySelectorAll('[name="sc-h"]').forEach(r => r.onchange = () => { S.horizon = r.value; if (S.horizon === 'today') void loadToday(); renderTiles(); });
renderTiles(); renderDetail(); renderCommon(); renderMine(); void loadData();
