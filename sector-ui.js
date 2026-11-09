// 섹터 화면 + 홈 '내 섹터 분포' 카드.
//   섹터 타일(수익률·52주 경로·이슈 수) → 고른 섹터의 대표 회사 수익률, 정책·정치 이슈(날짜·출처), 국가별 방향, 지켜볼 일정
//   오른쪽: 내 보유의 섹터 분포(집중도·상한 초과·검토안)와 공통(거시·정치) 이슈.
// 수익률은 data/sectors.json(빌드 때 계산)을 먼저 보여 주고, 고른 섹터만 /api/market으로 오늘 기준을 다시 계산한다.
// 이슈는 사람이 적은 자료(lib/sectors.js)다. 오를지 내릴지는 적지 않는다 — 거시·정책 변수로 방향을 맞힌 근거가 없기 때문이다.
import { SECTORS, COMMON_ISSUES, ACTOR_NAME, SECTOR_ASOF, classify, sectorById, sectorExposure, issuesFor, returnsFrom } from '/lib/sectors.js';
import { candles as fetchCandles, getStyle, fundamentals } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${(Math.abs(v) * 100).toFixed(d)}%` : '—';
const tone = v => v > 0.0005 ? 'up' : v < -0.0005 ? 'down' : '';
const manwon = v => Number.isFinite(v) ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원` : '—';
const STYLE_NAME = { balanced: '균형', growth: '성장', value: '가치', dividend: '배당' };
const HORIZONS = [['w1', '1주'], ['m1', '1개월'], ['m3', '3개월'], ['m6', '6개월'], ['ytd', '올해'], ['y1', '1년']];
const KIND_TIP = { 정책: '법·규제·보조금', 정치: '선거·의회·정부 발언', 무역: '관세·수출통제·협정', 실적: '회사 실적·수주', 시장: '시장 움직임' };

const style = document.createElement('style'); style.textContent = `
#core-sectors .cr-card{overflow:hidden;min-width:0}
.sc-note{font-size:13px;color:var(--ck-sub);background:var(--ck-soft);border-radius:12px;padding:10px 14px;margin:0 0 14px;line-height:1.6}
.sc-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px}
.sc-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px;margin:0 0 18px}
.sc-tile{border:1px solid var(--ck-line);border-radius:16px;background:#fff;padding:12px 14px;text-align:left;font:inherit;cursor:pointer;display:grid;gap:4px;min-width:0;transition:border-color .15s,box-shadow .15s}
.sc-tile:hover{border-color:#c5ccd6}.sc-tile[aria-pressed=true]{border-color:var(--ck-ink);box-shadow:0 0 0 1px var(--ck-ink) inset}
.sc-tile .n{font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center;gap:6px}.sc-tile .n small{font-weight:500;font-size:11px;color:var(--ck-sub);white-space:nowrap}
.sc-tile .r{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.3px}.sc-tile .r.up{color:var(--ck-up)}.sc-tile .r.down{color:var(--ck-down)}
.sc-tile .s{font-size:12px;color:var(--ck-sub);display:flex;gap:8px;flex-wrap:wrap}.sc-tile svg{width:100%;height:28px;display:block;margin-top:2px}.sc-tile polyline{fill:none;stroke-width:1.6}
.sc-tile .m{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;border-radius:999px;padding:1px 8px;background:#eef3fc;color:#1849a8;font-weight:600;white-space:nowrap}
.sc-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.sc-head p{margin:4px 0 0;font-size:13.5px;color:var(--ck-sub);line-height:1.6;max-width:720px}
.sc-scroll{overflow-x:auto;max-width:100%}.sc-table{width:100%;border-collapse:collapse;font-size:13px;min-width:560px}.sc-table th{font-size:11.5px;color:var(--ck-sub);font-weight:600;text-align:right;padding:7px 6px;border-bottom:1px solid var(--ck-line);white-space:nowrap}.sc-table th:first-child{text-align:left}
.sc-table td{padding:7px 6px;border-bottom:1px solid #f0f2f5;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sc-table td:first-child{text-align:left;font-weight:600;white-space:normal}.sc-table td small{display:inline-block;margin-left:5px;font-weight:500;font-size:11px;color:var(--ck-sub)}
.sc-table .up{color:var(--ck-up)}.sc-table .down{color:var(--ck-down)}.sc-table tr.grp td{background:var(--ck-soft);font-weight:600}.sc-table .mine{background:#eef3fc;color:#1849a8;border-radius:999px;padding:0 7px;font-size:11px;font-weight:600}
.sc-issues{list-style:none;margin:0;padding:0;display:grid;gap:12px}.sc-issues li{display:grid;grid-template-columns:92px minmax(0,1fr);gap:4px 12px;padding:12px 0;border-top:1px solid var(--ck-line)}.sc-issues li:first-child{border-top:0;padding-top:4px}
.sc-issues time{font-size:12.5px;color:var(--ck-sub);font-variant-numeric:tabular-nums}.sc-issues .tags{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:4px}
.sc-actor{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 7px;background:#eef0f3;color:#2b3648}.sc-actor.US{background:#e8eefc;color:#1d3f94}.sc-actor.EU{background:#eaf3ff;color:#174d8a}.sc-actor.KR{background:#e9f7ef;color:#0f6b3b}.sc-actor.CN{background:#fdecec;color:#9b1c1c}.sc-actor.JP{background:#f6ecf9;color:#6b2d84}.sc-actor.IMO{background:#eef0f3}
.sc-kind{font-size:11.5px;color:var(--ck-sub);border:1px solid var(--ck-line);border-radius:6px;padding:1px 7px}
.sc-eff{display:inline-block;width:8px;height:8px;border-radius:50%;background:#9aa3af}.sc-eff.p{background:var(--ck-ok)}.sc-eff.m{background:var(--ck-bad)}
.sc-issues b{font-size:14.5px;line-height:1.45;display:block}.sc-issues p{margin:4px 0 0;font-size:13px;color:#3b4350;line-height:1.6}.sc-issues .hits{margin-top:5px;font-size:12px;color:var(--ck-sub)}.sc-issues .hits .mine{color:#1849a8;font-weight:700}
.sc-issues a{font-size:12px;color:var(--ck-sub);text-decoration:underline;margin-left:8px}
.sc-stance{width:100%;border-collapse:collapse;font-size:13px}.sc-stance th{text-align:left;padding:8px 10px 8px 0;vertical-align:top;white-space:nowrap;width:60px}.sc-stance td{padding:8px 0;border-bottom:1px solid #f0f2f5;line-height:1.6;color:#3b4350}
.sc-watch{margin:0;padding-left:18px;font-size:13.5px;display:grid;gap:5px;line-height:1.5}.sc-watch b{font-weight:600;margin-right:6px;font-variant-numeric:tabular-nums}
.sc-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px}.sc-sum>div{background:var(--ck-soft);border-radius:12px;padding:10px 12px;min-width:0}.sc-sum span{display:block;font-size:11.5px;color:var(--ck-sub)}.sc-sum b{display:block;font-size:17px;margin:3px 0 1px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.sc-sum small{font-size:11.5px;color:var(--ck-sub);line-height:1.4;display:block}.sc-sum b.bad{color:var(--ck-bad)}
.sc-bars{list-style:none;margin:0;padding:0;display:grid;gap:8px}.sc-bars li{display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr) 44px 60px;gap:8px;align-items:center;font-size:13px}.sc-bars .n{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sc-bars i{display:block;height:8px;border-radius:999px;background:#e6e8ec;position:relative;overflow:hidden}.sc-bars i::after{content:'';position:absolute;inset:0;width:var(--w);background:var(--ck-ink);border-radius:999px}.sc-bars i.over::after{background:var(--ck-bad)}.sc-bars i.idx::after{background:#9aa3af}
.sc-bars b{text-align:right;font-variant-numeric:tabular-nums}.sc-bars small{font-size:11.5px;color:var(--ck-sub);text-align:right;white-space:nowrap}.sc-bars small.up{color:var(--ck-up)}.sc-bars small.down{color:var(--ck-down)}
.sc-plan{margin-top:12px;border-top:1px solid var(--ck-line);padding-top:10px;font-size:13px;line-height:1.6}.sc-plan ul{margin:6px 0 0;padding-left:18px}.sc-plan li b{font-variant-numeric:tabular-nums}
.sc-mine-issues{margin:12px 0 0;font-size:13px;color:#3b4350;line-height:1.6;border-top:1px solid var(--ck-line);padding-top:10px}.sc-mine-issues span{color:var(--ck-sub)}
.sc-state{font-size:12.5px;color:var(--ck-sub);min-height:16px;margin:0}
#home-sectors .sc-sum{grid-template-columns:repeat(3,minmax(0,1fr))}#home-sectors .hm-note{margin-top:8px}
@media(max-width:760px){.sc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-tile .r{font-size:19px}.sc-sum{grid-template-columns:1fr 1fr}.sc-issues li{grid-template-columns:1fr}.sc-bars li{grid-template-columns:minmax(60px,auto) minmax(0,1fr) 42px}.sc-bars small{display:none}}`; document.head.append(style);

const S = { data: null, positions: [], cash: null, fx: null, hints: new Map(), sel: 'semi', horizon: 'm1', live: {}, liveState: '' };

// ── 화면 ────────────────────────────────────────────────────
const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'sectors'; nav.textContent = '섹터'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'sectors'; page.id = 'core-sectors';
page.innerHTML = `<div class="page-head"><div><h1>섹터 ${tip('주요 섹터의 수익률, 대표 회사, 정책·정치 이슈를 한 곳에 모았습니다. 수익률은 섹터 ETF와 대표 회사의 공개 일봉으로 계산하고, 이슈는 날짜와 출처를 붙여 사람이 적습니다. 어느 섹터가 오를지는 적지 않습니다. 금리·정책 같은 거시 변수로 수익률 방향을 맞힌 근거가 없기 때문입니다(Goyal–Welch–Zafirov 2024, 이 저장소 요인 연구 2026-11-06). 쓰임새는 "내 돈이 어떤 정책·정치 이슈에 얼마나 걸려 있나"를 보는 것입니다.')}</h1><p>섹터별 수익률 · 대표 회사 · 정책과 정치 이슈 · 내 보유의 섹터 분포</p></div></div>
<div class="sc-top"><div class="cp-seg" role="radiogroup" id="sc-h">${HORIZONS.map(([k, l]) => `<label><input type="radio" name="sc-h" value="${k}" ${k === 'm1' ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><span class="cr-muted" id="sc-asof"></span></div>
<div class="sc-tiles" id="sc-tiles" role="group" aria-label="섹터"></div>
<div class="cr-grid"><div class="cr-main" id="sc-detail"></div>
<aside class="cr-side"><article class="cr-card" id="sc-mine"><header><h3>내 섹터 분포 ${tip('보유 종목을 섹터로 묶어 주식 안의 비중을 봅니다. 가장 큰 섹터가 성향별 상한(균형 40% · 성장 50% · 배당 35%)을 넘으면 상한까지 줄이는 검토안을 보여 줍니다. 줄인 돈은 현금으로 두는 안이며, 어느 섹터를 사라는 뜻이 아닙니다. 지수 ETF는 그 자체가 분산이라 상한을 적용하지 않습니다.')}</h3></header><div id="sc-mine-body"></div></article>
<article class="cr-card" id="sc-common"><header><h3>공통 이슈 ${tip('섹터를 가리지 않고 시장 전체에 걸리는 정치·무역·시장 사건입니다. 날짜와 출처를 함께 둡니다.')}</h3></header><ul class="sc-issues" id="sc-common-body"></ul><p class="cr-muted" style="margin-top:10px">자료 기준일 ${SECTOR_ASOF} · 이슈는 사람이 갱신합니다. 출처를 눌러 원문을 확인하십시오.</p></article></aside></div>`;
document.querySelector('main').append(page);

function sparkSvg(arr, cls = '') { if (!arr || arr.length < 3) return ''; const min = Math.min(...arr), max = Math.max(...arr), w = 100, h = 28, pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - 2 - (max === min ? h / 2 : (v - min) / (max - min) * (h - 4))).toFixed(1)}`).join(' '); const last = arr.at(-1) >= arr[0]; return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" stroke="${last ? '#e0353b' : '#2f6fe4'}" class="${cls}"/></svg>`; }
const retOf = (id) => { const o = S.data?.sectors?.[id]; return o?.etf?.KR?.ret || o?.basket?.KR || null; };
const retLabel = id => { const o = S.data?.sectors?.[id]; return o?.etf?.KR?.ret ? o.etf.KR.name : o?.basket?.KR ? '국내 대표 회사 평균' : ''; };
const mySymbols = () => new Set(S.positions.map(p => String(p.symbol).toUpperCase().split('.')[0]));
const isMine = sym => mySymbols().has(String(sym).toUpperCase().split('.')[0]);

function renderTiles() {
  const host = $('#sc-tiles'); if (!host) return;
  const exp = exposure();
  host.innerHTML = SECTORS.map(s => { const r = retOf(s.id), v = r?.[S.horizon], mine = exp.rows.find(x => x.id === s.id), spark = S.data?.sectors?.[s.id]?.etf?.KR?.spark || S.data?.sectors?.[s.id]?.companies?.[s.companies[0].symbol]?.spark;
    return `<button type="button" class="sc-tile" data-sec="${s.id}" aria-pressed="${s.id === S.sel}"><span class="n">${esc(s.name)}${mine ? `<small class="m">내 보유 ${mine.pct.toFixed(0)}%</small>` : `<small>${s.issues.length}건</small>`}</span><span class="r ${tone(v)}">${pct(v)}</span>${sparkSvg(spark)}<span class="s"><span>3M ${pct(r?.m3)}</span><span>1Y ${pct(r?.y1)}</span></span></button>`; }).join('');
  host.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { S.sel = b.dataset.sec; renderTiles(); renderDetail(); });
  $('#sc-asof').textContent = S.data ? `수익률 기준 ${S.data.asOf} · 국내 섹터 ETF(없으면 대표 회사 평균) · 현지 통화` : '수익률 자료를 불러오는 중';
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
  host.innerHTML = `<article class="cr-card"><div class="sc-head"><div><h3>${esc(s.name)}</h3><p>${esc(s.desc)}</p></div><div class="cr-actions" style="margin:0"><button type="button" class="secondary" id="sc-live">오늘 기준으로 다시 계산</button></div></div><p class="sc-state" id="sc-live-state">${esc(S.liveState)}</p>
    <h4>수익률 ${tip('섹터 ETF, 대표 회사의 단순 평균, 회사별 수익률입니다. 각 종목의 현지 통화 기준이라 미국 종목은 환율 변화가 빠져 있습니다. 고점 대비는 최근 1년 최고 종가 대비 지금 위치입니다.')}</h4>
    <div class="sc-scroll"><table class="sc-table"><thead><tr><th>구분</th>${HORIZONS.map(([, l]) => `<th>${l}</th>`).join('')}<th>1년 고점 대비</th></tr></thead><tbody>
    ${d.etf?.KR ? rowHtml(d.etf.KR.name, etfRet('KR'), { sub: 'ETF', grp: true, mine: isMine(d.etf.KR.symbol) }) : ''}${d.etf?.US ? rowHtml(d.etf.US.name, etfRet('US'), { sub: 'ETF', grp: true, mine: isMine(d.etf.US.symbol) }) : ''}
    ${d.basket?.KR ? rowHtml(`국내 대표 ${d.basket.KR.n}개 평균`, d.basket.KR, { grp: true }) : ''}${krCos.map(c => rowHtml(c.name, ret(c.symbol), { sub: c.symbol.split('.')[0], mine: isMine(c.symbol) })).join('')}
    ${d.basket?.US ? rowHtml(`미국 대표 ${d.basket.US.n}개 평균`, d.basket.US, { grp: true }) : ''}${usCos.map(c => rowHtml(c.name, ret(c.symbol), { sub: c.symbol, mine: isMine(c.symbol) })).join('')}</tbody></table></div></article>
  <article class="cr-card"><header><h3>주요 이슈 ${tip('정책(법·규제·보조금), 정치(선거·의회), 무역(관세·수출통제), 실적(회사 실적·수주)으로 나눕니다. 점은 그 사건이 이 섹터 회사들에 좋은 쪽(초록)인지 나쁜 쪽(주황)인지 양쪽 다인지(회색)를 뜻할 뿐, 주가가 오른다·내린다는 뜻이 아닙니다.')}</h3><span class="cr-muted">${issues.length}건 · 최신순</span></header>
    <ul class="sc-issues">${issues.map(i => issueHtml(i)).join('')}</ul></article>
  <article class="cr-card"><header><h3>국가별 방향 ${tip('각 나라·기구가 이 섹터에서 지금 무엇을 하고 있는지 사실 위주로 적었습니다. 출처가 없는 일반론은 "출처 없음"으로 표시했습니다.')}</h3></header>
    <table class="sc-stance">${['US', 'EU', 'KR', 'CN', 'JP'].map(k => `<tr><th><span class="sc-actor ${k}">${ACTOR_NAME[k]}</span></th><td>${esc(s.stances[k])}</td></tr>`).join('')}</table></article>
  <article class="cr-card"><header><h3>지켜볼 일정</h3></header><ul class="sc-watch">${s.watch.map(w => `<li><b>${esc(w.when)}</b>${esc(w.what)}</li>`).join('')}</ul></article>`;
  $('#sc-live').onclick = () => void recomputeLive(s);
}
function issueHtml(i, withSector = false) {
  const eff = i.effect === '+' ? 'p' : i.effect === '−' ? 'm' : '';
  const hits = (i.hits || []).map(h => { const c = SECTORS.flatMap(x => x.companies).find(x => x.symbol === h); const name = c?.name || h; return isMine(h) ? `<span class="mine">${esc(name)}(내 보유)</span>` : esc(name); });
  return `<li><time>${esc(i.date)}</time><div><div class="tags"><span class="sc-actor ${esc(i.actor)}">${esc(ACTOR_NAME[i.actor] || i.actor)}</span><span class="sc-kind" title="${esc(KIND_TIP[i.kind] || '')}">${esc(i.kind)}</span><i class="sc-eff ${eff}" title="${i.effect === '+' ? '회사에 유리한 쪽' : i.effect === '−' ? '회사에 불리한 쪽' : '양쪽 다·불확실'}"></i>${withSector && i.sectorName ? `<span class="sc-kind">${esc(i.sectorName)}</span>` : ''}</div><b>${esc(i.title)}</b><p>${esc(i.text)}</p>${hits.length ? `<div class="hits">관련: ${hits.join(' · ')}</div>` : ''}<a href="${esc(i.source)}" target="_blank" rel="noopener noreferrer">출처</a></div></li>`;
}
async function recomputeLive(s) {
  const st = $('#sc-live-state'); S.liveState = '오늘 시세를 받는 중…'; if (st) st.textContent = S.liveState;
  const items = [...s.companies, s.etf.KR, s.etf.US].filter(Boolean); const out = S.live[s.id] = { ...(S.live[s.id] || {}) }; let ok = 0, fail = 0;
  await Promise.all(items.map(async it => { try { const c = await fetchCandles(it.symbol, it.currency, '2y'); const r = returnsFrom((c.candles || []).map(x => ({ date: x.date, close: x.close }))); if (r) { out[it.symbol] = r; ok++; } else fail++; } catch { fail++; } }));
  S.liveState = `오늘 기준 ${ok}개 다시 계산${fail ? ` · ${fail}개는 시세를 받지 못해 자료 파일 값` : ''} · 대표 회사 평균 행은 자료 파일 기준`;
  if (S.sel === s.id) renderDetail();
}

// ── 내 섹터 분포(홈·섹터 화면 공용) ─────────────────────────
function prefCap() { try { const ses = sessionStorage.getItem('teamQuantSession') || 'guest'; const suf = S.kind === 'paper' ? ':paper' : S.kind === 'demo' ? ':demo' : ''; for (const k of [`teamQuantRules:${ses}${suf}`, `teamQuantRules:${ses}`]) { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.prefs?.sectorCap > 0) return v.prefs.sectorCap; } } catch { } return null; }
function exposure() { return sectorExposure(S.positions.map(p => ({ ...p, hint: S.hints.get(p.symbol) || '' })), { cashKrw: S.cash, style: getStyle(), cap: prefCap() }); }
function exposureHtml(exp, { compact = false } = {}) {
  if (!exp.rows.length) return '<p class="cr-muted">계좌를 연결하거나 예시 자산을 켜면 보유 종목을 섹터로 묶어 보여 줍니다.</p>';
  const mine = issuesFor(S.positions.map(p => p.symbol)), styleName = STYLE_NAME[getStyle()] || '균형';
  const top = exp.top, topOver = top && top.pct > exp.cap && top.id !== 'index' && top.id !== 'bond', capFrom = prefCap() ? '세 질문' : styleName;
  const bars = exp.rows.map(r => { const ret = retOf(r.id)?.m1; const over = r.pct > exp.cap && r.id !== 'index' && r.id !== 'bond'; return `<li title="${esc(r.symbols.map(x => x.name).join(', '))}"><span class="n">${esc(r.name)}</span><i class="${over ? 'over' : r.id === 'index' || r.id === 'bond' ? 'idx' : ''}" style="--w:${Math.min(100, r.pct).toFixed(1)}%"></i><b>${r.pct.toFixed(0)}%</b><small class="${tone(ret)}">${Number.isFinite(ret) ? `1M ${pct(ret, 0)}` : ''}</small></li>`; }).join('');
  const plan = exp.over.length ? `<div class="sc-plan"><b>검토안 (${styleName} 성향 · 섹터 상한 ${exp.cap}%)</b><ul>${exp.over.map(o => `<li>${esc(o.name)} <b>${o.pct.toFixed(0)}% → ${exp.cap}%</b> · 약 <b>${manwon(o.cutKrw)}</b> 줄이기</li>`).join('')}</ul><span class="cr-muted">줄인 돈(전체의 ${exp.cutPctOfTotal.toFixed(0)}%)은 현금으로 둡니다. 다시 넣을 때는 매매 전 확인을 거칩니다. 어느 섹터를 사라는 뜻이 아닙니다.</span></div>`
    : `<div class="sc-plan"><span class="cr-muted">모든 섹터가 ${styleName} 성향 상한 ${exp.cap}% 안에 있습니다.${exp.rows.filter(r => r.id !== 'index' && r.id !== 'bond').length <= 1 ? ' 다만 섹터가 하나뿐이라 그 섹터 이슈에 전부 걸려 있습니다.' : ''}</span></div>`;
  const issues = mine.length ? `<div class="sc-mine-issues"><span>내 종목에 직접 걸린 이슈 ${mine.length}건 · 최근</span><br>${esc(mine[0].date)} ${esc(mine[0].sectorName)} · ${esc(mine[0].title)}${compact ? '' : mine.slice(1, 3).map(i => `<br>${esc(i.date)} ${esc(i.sectorName)} · ${esc(i.title)}`).join('')}</div>` : '';
  return `<div class="sc-sum"><div><span>가장 큰 섹터</span><b class="${topOver ? 'bad' : ''}">${top ? `${esc(top.name)} ${top.pct.toFixed(0)}%` : '—'}</b><small>상한 ${exp.cap}% (${capFrom})</small></div><div><span>유효 섹터 수</span><b>${exp.effective ? exp.effective.toFixed(1) : '—'}개</b><small>비중을 고르게 봤을 때 ${tip('비중 제곱합의 역수(허핀달 지수의 역수)입니다. 두 섹터에 반반이면 2.0, 한 섹터에 몰리면 1.0에 가깝습니다.')}</small></div><div><span>섹터 이슈</span><b>${mine.length}건</b><small>내 종목에 직접</small></div></div><ul class="sc-bars">${bars}</ul>${compact ? '' : plan}${compact ? (exp.over.length ? `<div class="sc-plan"><b>${esc(exp.over[0].name)} ${exp.over[0].pct.toFixed(0)}% → ${exp.cap}%</b> 검토 · 약 ${manwon(exp.over[0].cutKrw)}<span class="cr-muted"> (자세한 검토안은 섹터 화면)</span></div>` : '') : ''}${issues}`;
}
function renderMine() { const b = $('#sc-mine-body'); if (b) b.innerHTML = exposureHtml(exposure()); renderHome(); }
function renderCommon() { const b = $('#sc-common-body'); if (b) b.innerHTML = [...COMMON_ISSUES].sort((a, b) => b.date.localeCompare(a.date)).map(i => issueHtml(i)).join(''); }

// 홈 카드
function renderHome() {
  const host = document.querySelector('#overview .hm-main'); if (!host) return;
  let card = document.getElementById('home-sectors');
  if (!card) { card = document.createElement('article'); card.className = 'hm-card'; card.id = 'home-sectors'; const anchor = document.getElementById('core-today') || document.getElementById('hm-kpis'); if (anchor) anchor.after(card); else host.prepend(card); }
  if (!S.positions.length) { card.hidden = true; return; } card.hidden = false;
  const exp = exposure();
  card.innerHTML = `<header style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0;display:flex;align-items:center">내 섹터 분포 ${tip('보유 종목을 섹터로 묶어 어디에 몰려 있는지, 성향별 상한을 넘는 섹터가 있는지, 내 종목에 직접 걸린 정책·정치 이슈가 몇 건인지 봅니다. 자세한 수익률·이슈·국가별 방향은 섹터 화면에 있습니다.')}</h3><button type="button" class="text-button" id="home-sectors-go">섹터 화면</button></header><div style="margin-top:10px">${exposureHtml(exp, { compact: true })}</div>`;
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
page.querySelectorAll('[name="sc-h"]').forEach(r => r.onchange = () => { S.horizon = r.value; renderTiles(); });
renderTiles(); renderDetail(); renderCommon(); renderMine(); void loadData();
