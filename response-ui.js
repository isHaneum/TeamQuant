// 지수·내 종목 규칙 비중(이슈 화면 맨 아래 접힘): 지수별 규칙 비중·할 일·다음 신호·위험 수치·과거 비슷한 때, 그리고 내 종목 규칙 비중.
// 계산은 모두 이 브라우저에서 한다(보유 종목·금액은 서버로 보내지 않음). 서버에는 종목 코드로 시세·현재가만 묻는다.
// 2026-11-26: 이슈가 먼저 보이게 접힘 안으로 옮기고, 접힘을 열 때만 계산한다(지수 4개는 동시에, 결과는 5분 동안 다시 씀).
import { marketResponse, holdingsPlan } from '/lib/market-response.js';
import { candles as heldCandles } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p1 = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)}%` : '—';
const a1 = v => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const fmt = (v, cur) => !Number.isFinite(v) ? '—' : cur === 'USD' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('ko-KR');
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const man = v => Number.isFinite(v) ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만 원` : '—';
const KST = 9 * 3600000;
// 날짜는 'MM-DD'(올해가 아니면 YYYY-MM-DD), 시각은 'MM-DD HH:mm'(한국 시간).
const md = d => { const s = String(d || ''), y = new Date(Date.now() + KST).toISOString().slice(0, 4); return s.slice(0, 4) === y ? s.slice(5, 10) : s.slice(0, 10); };
const time = iso => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const k = new Date(t + KST).toISOString(); return `${md(k)} ${k.slice(11, 16)}`; };
const INDICES = [['^KS11', '코스피', 'KR'], ['^GSPC', 'S&P500', 'US'], ['^IXIC', '나스닥', 'US'], ['^SOX', '반도체지수', 'US']];
const RULE_TIP = '변동성이 클수록 주식을 줄이는 규칙입니다(연 변동성 15% 기준: 30%면 주식 절반).\n미국 지수는 200일선(200일 평균 가격) 아래면 주식을 비웁니다(코스피에서는 오히려 나빠 쓰지 않음).\n판단은 종가, 실행은 다음 거래일이며 비중 차이가 5%p 넘을 때만 맞춥니다.\n오를지 내릴지는 예측하지 않습니다. 규칙은 시장별로 확인 기간(규칙을 정할 때 안 쓴 기간)으로 골랐습니다.';
const EMPTY_MINE = '<p class="mr-muted">보유 종목 없음 · <button type="button" class="text-button" data-demo-start>예시 자산 켜기</button></p>';

const host = document.getElementById('issues');
const fold = document.createElement('details'); fold.className = 'mr-fold'; fold.id = 'mr-fold';
fold.innerHTML = '<summary>지수·내 종목 규칙 비중 (참고)</summary>';
const box = document.createElement('div'); box.className = 'mr'; box.id = 'mr';
box.innerHTML = `<article class="mr-card" id="mr-today"><header><h3>지수별 규칙 비중 ${tip(RULE_TIP)}</h3><div class="mr-tabs" id="mr-tabs" role="tablist"></div></header><div id="mr-body"><div class="shimmer mr-skel"></div><div class="shimmer mr-skel short"></div></div></article>
<article class="mr-card" id="mr-mine"><header><h3>내 종목 규칙 비중 ${tip('보유 종목마다 같은 규칙을 적용한 금액입니다(지금 금액을 계획 금액으로 봄). 나쁜 날 하루 손실은 종목별로 그냥 더해 실제보다 큽니다. 주문은 하지 않습니다.')}</h3><span class="mr-muted" id="mr-mine-note"></span></header><div id="mr-mine-body">${EMPTY_MINE}</div></article>`;
fold.append(box); host.append(fold);

const cache = new Map();
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
function once(key, make, ttl = 0) { const c = cache.get(key); if (c && (!ttl || Date.now() - c.at < ttl)) return c.p; const p = make(); cache.set(key, { p, at: Date.now() }); p.catch(() => cache.delete(key)); return p; }
const research = () => Promise.all([once('study', () => getJson('/data/shock-study.json?v=A1')), once('report', () => getJson('/data/risk-model-report.json?v=R1'))]);
const series = s => once('s:' + s, () => getJson(`/api/market?symbol=${encodeURIComponent(s)}&range=5y`), 10 * 60000);
const quote = s => once('q:' + s, () => getJson(`/api/quote?symbol=${encodeURIComponent(s)}`), 60000).catch(() => null);
const idle = () => new Promise(r => setTimeout(r, 0));

let selected = '^KS11', results = new Map(), positions = [], running = 0, mineDirty = false, mineLoaded = false, lastIdx = 0;

// 위험 수치: 모델 이름·검증 수치는 화면에 두지 않는다(방법은 문서에).
function modelTiles(r) {
  const m = r.models, cur = r.currency, price = r.price;
  return `<div class="mr-tiles">
    <div><span>예상 변동성(1개월) ${tip('앞으로 한 달(20거래일) 동안의 변동성을 과거 움직임으로 계산한 연 기준 값입니다. 두 계산 방식 중 과거에 이 지수에서 더 잘 맞았던 쪽을 씁니다.')}</span><b>연 ${Math.round(m.vol.forecast * 100)}%</b><small>장기 평균 ${Math.round(m.vol.longRun * 100)}% · 최근 1개월 ${Math.round(m.vol.realized20 * 100)}%</small></div>
    ${m.hmm ? `<div><span>변동성이 큰 시기일 확률 ${tip(`오늘이 변동성이 큰 시기일 확률입니다. 그런 시기의 연 변동성 ${a1(m.hmm.stressVol)}, 평온한 시기 ${a1(m.hmm.calmVol)}. 이 확률만으로 사고팔면 자산마다 결과가 달라 비중 규칙에는 쓰지 않습니다.`)}</span><b>${Math.round(m.hmm.pStress * 100)}%</b><small>평균 지속 ${Math.round(m.hmm.duration)}거래일</small></div>` : ''}
    <div><span>하루 예상 범위 ${tip('과거 움직임으로 계산한 하루 등락 범위입니다. 20번 중 19번은 이 안에 듭니다.')}</span><b>${p1(m.day95[0])} ~ ${p1(m.day95[1])}</b><small>${fmt(price * (1 + m.day95[0]), cur)} ~ ${fmt(price * (1 + m.day95[1]), cur)} · 아주 나쁜 날 평균 손실 −${a1(m.var95.ES)}</small></div>
    <div><span>한 달 뒤 예상 범위 ${tip('과거 움직임으로 한 달(20거래일) 뒤를 3,000번 가정한 범위입니다(10번 중 9번은 이 안). 방향을 예측하지 않으려고 평균 수익은 0으로 두었습니다.')}</span><b>${p1(m.mc20.p05)} ~ ${p1(m.mc20.p95)}</b><small>−10% 넘게 더 빠질 확률 ${Math.round(m.mc20.probDown10 * 100)}%</small></div>
  </div>`;
}
function analogTable(r, study) {
  if (!r.analogs.length) return '';
  const ruleId = r.useTrend ? 'combined' : 'volTarget';
  return `<h4>과거 비슷한 때 ${tip(`같은 조건이 과거에 나온 뒤의 결과입니다(같은 조건은 20거래일에 1번만 셈). 6개월(120거래일) 열은 그날 종가부터 그냥 보유했을 때와 이 화면의 규칙을 따랐을 때의 평균·최악입니다. 비용 0.2% 포함.\n자료: ${md(study.lastDates?.[r.symbol] || '')}까지 공개 시세.`)}</h4><p class="mr-muted">최근 5거래일 안에 이 조건이 나왔습니다.</p>
  <div class="table-wrap"><table class="mr-table"><thead><tr><th>조건</th><th>사례 수</th><th>3개월 뒤 중간값</th><th>3개월 뒤 오른 비율</th><th>그 사이 추가 하락</th><th>6개월 뒤: 그냥 보유</th><th>6개월 뒤: 규칙</th></tr></thead><tbody>
  ${r.analogs.map(a => { const s = a.stats, h = s.response?.hold?.ret, q = s.response?.[ruleId]?.ret; return `<tr><td>${esc(String(a.label).replace(/S&P 500/g, 'S&P500'))}<small>${esc(md(a.date))} 발생</small></td><td>${s.n}</td><td class="${tone(s.r60.median)}">${s.r60.median > 0 ? '+' : ''}${s.r60.median}%</td><td>${s.r60.hit}%</td><td>평균 ${s.low60.mean}%<small>최악 ${s.low60.worst}%</small></td><td>${h ? `평균 ${h.mean}%<small>최악 ${h.worst}%</small>` : '—'}</td><td>${q ? `평균 ${q.mean}%<small>최악 ${q.worst}%</small>` : '—'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function renderBody() {
  const r = results.get(selected), el = $('#mr-body');
  if (!r) { el.innerHTML = '<div class="shimmer mr-skel"></div><div class="shimmer mr-skel short"></div>'; return; }
  if (!r.ok) { el.innerHTML = `<p class="mr-warn">${esc(r.reason || r.error || '계산하지 못했습니다.')}</p>`; return; }
  const [study, report] = r._research, rep = report?.models?.[r.symbol], w = Math.round(r.weight * 100), d = r.data, dir = rep?.direction;
  const strat = rep?.strategies, ruleKey = r.useTrend ? 'combinedGarch' : 'volTargetGarch';
  const evidence = strat ? `${rep.from.slice(0, 4)}년~ 확인 기간: 그냥 보유 위험 대비 수익 ${strat.hold.sharpe}·최대 하락폭 ${strat.hold.mdd}% → 이 규칙 위험 대비 수익 ${strat[ruleKey].sharpe}·최대 하락폭 ${strat[ruleKey].mdd}% (연 수익 ${strat.hold.cagr}% → ${strat[ruleKey].cagr}%)` : '';
  el.innerHTML = `<div class="mr-top"><div><b class="mr-price">${fmt(r.price, r.currency)}</b> <span class="${tone(r.levels.day)}">${p1(r.levels.day)}</span>
      <span class="mr-chip ${d.status === 'open' ? 'live' : ''}">${d.status === 'open' ? '장중' : '장 마감'} · ${esc(d.quoteAt ? time(d.quoteAt) : md(d.asOf))} 기준</span>
      ${tip(`출처: ${d.source}${d.notes.length ? '\n' + d.notes.join('\n') : ''}\n현재가 네이버 증권 · 과거 시세 야후 파이낸스(둘 다 공식 제공 아님)`)}</div>
      <div class="mr-levels"><span>20일선 ${fmt(r.levels.ma20, r.currency)} <em class="${tone(r.levels.gap20)}">${p1(r.levels.gap20)}</em></span><span>200일선 ${fmt(r.levels.ma200, r.currency)} <em class="${tone(r.levels.gap200)}">${p1(r.levels.gap200)}</em></span><span>1년 고점 대비 <em class="down">${p1(r.levels.fromHigh)}</em></span></div></div>
    <div class="mr-verdict"><div class="mr-weight"><span>규칙 비중</span><b>${w}%</b><small>계획한 돈 중 주식 · ${esc(r.rule)}</small></div>
      <p>${w === 0 ? `규칙상 지금은 <b>현금으로 기다릴 때</b>입니다.` : w >= 95 ? '규칙상 <b>계획대로 보유</b>합니다.' : `규칙상 계획의 <b>${w}%만 주식</b>으로, 나머지는 현금으로 둡니다.`} ${evidence ? tip(evidence) : ''}</p></div>
    <div class="mr-cols">
      <section><h4>오늘 할 일</h4><ol>${r.today.map((x, k) => `<li>${esc(x)}${r.todayNotes?.[k] ? tip(r.todayNotes[k]) : ''}</li>`).join('')}</ol></section>
      <section><h4>하지 말 것</h4><ul>${r.avoid.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
      <section><h4>다음 신호</h4><ul class="mr-triggers">${r.triggers.map(t => `<li><b>${esc(t.when)}</b><span>→ ${esc(t.then)}</span>${Number.isFinite(t.distance) ? `<small>지금부터 ${t.distance > 0 ? '+' : ''}${t.distance}%</small>` : ''}</li>`).join('')}</ul></section>
    </div>
    ${modelTiles(r)}
    ${analogTable(r, study)}
    ${dir ? `<p class="mr-muted mr-dir">지난 한 달 방향으로 다음 한 달을 맞힌 비율 ${dir.momentumHit}% · 늘 '오른다'고만 해도 ${dir.baseUpShare}% → 맞히는 힘이 사실상 없습니다 ${tip('확인 기간으로 잰 값입니다. 모델은 변동성 크기와 손실 위험을 재는 데만 씁니다.')}</p>` : ''}`;
}
// 탭: 지수 이름과 '주식 n%'(규칙 비중)만. 오늘 등락은 오늘 장 타일에 있다.
function renderTabs() {
  $('#mr-tabs').innerHTML = INDICES.map(([s, n]) => { const r = results.get(s); return `<button type="button" role="tab" data-mr="${esc(s)}" aria-selected="${s === selected}" class="${s === selected ? 'on' : ''}"><span>${esc(n)}</span><i>${r?.ok ? `주식 ${Math.round(r.weight * 100)}%` : r ? '계산 못 함' : '계산 중'}</i></button>`; }).join('');
  $('#mr-tabs').querySelectorAll('[data-mr]').forEach(b => b.onclick = () => { selected = b.dataset.mr; renderTabs(); renderBody(); });
}

async function computeIndex(sym, name, market, vix, research) {
  try {
    const [d, q] = await Promise.all([series(sym), quote(sym)]); await idle();
    const r = marketResponse({ symbol: sym, name, market, kind: 'index', candles: d.candles, quote: q, vixCandles: vix, study: research[0], report: research[1] });
    r._research = research; return r;
  } catch (e) { return { ok: false, symbol: sym, name, reason: e.message }; }
}
async function loadIndices() {
  const id = ++running;
  let research_; try { research_ = await research(); } catch (e) { $('#mr-body').innerHTML = `<p class="mr-warn">연구 자료를 불러오지 못했습니다 (${esc(e.message)}).</p>`; return; }
  const vix = (await series('^VIX').catch(() => null))?.candles || [];
  if (id !== running) return;
  renderTabs();
  // 네 지수를 한꺼번에 받는다(하나씩 기다리지 않음). 끝나는 대로 탭과 본문을 채운다.
  await Promise.all(INDICES.map(async ([s, n, m]) => { const r = await computeIndex(s, n, m, vix, research_); if (id !== running) return; results.set(s, r); renderTabs(); if (s === selected) renderBody(); }));
  if (id !== running) return;
  window.dispatchEvent(new CustomEvent('teamquant:market-response', { detail: Object.fromEntries([...results].map(([k, v]) => [k, v.ok ? { weight: v.weight, headline: v.headline } : null])) }));
}

// ── 내 종목 규칙 비중 ─────────────────────────────────────────
let mineRun = 0;
async function loadMine() {
  const id = ++mineRun, el = $('#mr-mine-body');
  if (!positions.length) { el.innerHTML = EMPTY_MINE; $('#mr-mine-note').textContent = ''; return; }
  el.innerHTML = '<div class="shimmer mr-skel"></div>';
  let research_; try { research_ = await research(); } catch { research_ = [null, null]; }
  const rows = [];
  for (const p of positions) {
    try {
      const market = p.currency === 'USD' ? 'US' : 'KR', [d, q] = await Promise.all([heldCandles(p.symbol, p.currency, '2y'), quote(p.symbol)]); await idle();
      const r = marketResponse({ symbol: d.symbol || p.symbol, name: p.name, market, kind: 'stock', candles: d.candles, quote: q, report: research_[1], currency: p.currency });
      rows.push({ ...r, valueKrw: p.valueKrw });
    } catch (e) { rows.push({ ok: false, name: p.name, reason: e.message }); }
    if (id !== mineRun) return;
  }
  const plan = holdingsPlan(rows), ok = rows.filter(r => r.ok);
  $('#mr-mine-note').textContent = ok.length ? `규칙대로면 주식 ${man(plan.keep)} · 현금으로 ${man(plan.toCash)}` : '';
  el.innerHTML = `<div class="table-wrap"><table class="mr-table mr-mine-table"><thead><tr><th>종목</th><th>현재가</th><th>예상 변동성</th><th>규칙 비중</th><th>지금 → 규칙상</th><th>나쁜 날 하루 손실 ${tip('20거래일에 하루쯤은 이보다 더 잃을 수 있는 금액입니다.')}</th><th>다음 신호</th></tr></thead><tbody>
    ${rows.map(r => !r.ok ? `<tr><td>${esc(r.name)}</td><td colspan="6" class="mr-muted">${esc(r.reason)}</td></tr>` : `<tr><td><b>${esc(r.name)}</b><small>${esc(r.rule)}</small></td>
      <td>${fmt(r.price, r.currency)} <span class="${tone(r.levels.day)}">${p1(r.levels.day)}</span><small>${r.data.status === 'open' ? '장중' : '장 마감'}${r.data.notes.some(n => n.includes('보정')) ? ' · 현재가 보정' : ''}</small></td>
      <td>연 ${Math.round(r.models.vol.forecast * 100)}%<small>평균 ${Math.round(r.models.vol.longRun * 100)}%</small></td>
      <td><b>${Math.round(r.weight * 100)}%</b></td>
      <td>${won(r.valueKrw)} → <b>${won(r.valueKrw * r.weight)}</b></td>
      <td>${won(r.valueKrw * r.models.var95.VaR)}<small>−${a1(r.models.var95.VaR)}</small></td>
      <td><small class="mr-next">${esc(r.triggers[0]?.when || '')} → ${esc(r.triggers[0]?.then || '')}</small></td></tr>`).join('')}
    </tbody>${ok.length ? `<tfoot><tr><td colspan="4">합계</td><td>${won(plan.now)} → <b>${won(plan.keep)}</b></td><td>${won(plan.oneDayLoss95)}</td><td></td></tr></tfoot>` : ''}</table></div>`;
}

// 접힘이 열려 있고 이슈 화면일 때만 계산한다.
const isOpen = () => fold.open && document.querySelector('.view.active')?.dataset.page === 'issues';
function refresh() {
  if (!isOpen()) return;
  if (Date.now() - lastIdx > 5 * 60000) { lastIdx = Date.now(); void loadIndices(); }
  if (mineDirty || !mineLoaded) { mineDirty = false; mineLoaded = true; void loadMine(); }
}
// 스냅샷의 평가액(value)은 종목 통화라, 해외 종목은 스냅샷 환율로 원화로 바꾼다.
const toKrw = (v, cur, fx) => !Number.isFinite(v) ? null : cur === 'USD' ? (fx?.midRate ? v * fx.midRate : null) : v;
window.addEventListener('teamquant:asset-snapshot', e => { const snap = e.detail || {}; positions = (snap.positions || []).map(p => ({ ...p, valueKrw: Number.isFinite(p.valueKrw) ? p.valueKrw : toKrw(p.value, p.currency, snap.fx) })); if (isOpen()) { mineLoaded = true; void loadMine(); } else mineDirty = true; });
window.addEventListener('teamquant:asset-clear', () => { positions = []; void loadMine(); });
fold.addEventListener('toggle', refresh);
window.addEventListener('teamquant:page', refresh);
document.getElementById('iss-refresh')?.addEventListener('click', () => { cache.forEach((v, k) => { if (k.startsWith('q:')) cache.delete(k); }); if (isOpen()) { lastIdx = Date.now(); void loadIndices(); void loadMine(); } else { lastIdx = 0; mineDirty = true; } });
setInterval(() => { if (document.visibilityState === 'visible' && isOpen()) { cache.forEach((v, k) => { if (k.startsWith('q:')) cache.delete(k); }); lastIdx = Date.now(); void loadIndices(); } }, 5 * 60000);
renderTabs();
