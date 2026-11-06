// 오늘 장 대응(시장 화면 맨 위): 지수별 규칙 비중·할 일·다음 신호·모델 수치·과거 비슷한 때, 그리고 내 종목 대응.
// 계산은 모두 이 브라우저에서 한다(보유 종목·금액은 서버로 보내지 않음). 서버에는 종목 코드로 시세·현재가만 묻는다.
import { marketResponse, holdingsPlan } from '/lib/market-response.js';
import { candles as heldCandles } from '/lib/client-data.js';
import { tip } from '/tooltip-ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p1 = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '—';
const a1 = v => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const fmt = (v, cur) => !Number.isFinite(v) ? '—' : cur === 'USD' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('ko-KR');
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const time = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : ''; };
const INDICES = [['^KS11', '코스피', 'KR'], ['^GSPC', 'S&P 500', 'US'], ['^IXIC', '나스닥', 'US'], ['^SOX', '반도체지수', 'US']];
const RULE_TIP = '규칙은 공개 일봉 전체 기간 표본 외 검증으로 시장별로 골랐습니다.\n미국: 종가가 200일선 위일 때만, 비중 = min(1, 15% ÷ 예측 변동성)\n한국: 비중 = min(1, 15% ÷ 예측 변동성) (200일선 규칙은 코스피에서 오히려 나빴음)\n결정은 종가로, 반영은 다음 거래일. 비중 차이가 5%p 넘을 때만 맞춥니다. 방향(오를지)은 예측하지 않습니다.';

const host = document.getElementById('issues');
const box = document.createElement('div'); box.className = 'mr'; box.id = 'mr';
box.innerHTML = `<article class="mr-card" id="mr-today"><header><h3>오늘 장 대응 ${tip(RULE_TIP)}</h3><div class="mr-tabs" id="mr-tabs" role="tablist"></div></header><div id="mr-body"><div class="shimmer mr-skel"></div><div class="shimmer mr-skel short"></div></div></article>
<article class="mr-card" id="mr-mine"><header><h3>내 종목 대응 ${tip('보유 종목마다 같은 규칙을 적용한 금액입니다. 지금 금액을 계획 금액으로 보고 계산했습니다. 하루 95% 손실은 종목별 합이라 분산 효과를 빼서 크게 잡힌 값입니다. 주문은 하지 않습니다.')}</h3><span class="mr-muted" id="mr-mine-note"></span></header><div id="mr-mine-body"><p class="mr-muted">계좌를 연결하거나 예시 자산을 켜면 종목별로 계산합니다.</p></div></article>`;
host.querySelector('.page-head').after(box);
host.querySelector('.page-head h1').firstChild.textContent = '시장 ';
host.querySelector('.page-head p').textContent = '오늘 장 대응 · 큰 사건 · 브리핑';
const navBtn = document.querySelector('.sidebar [data-view="issues"], .overview-nav [data-view="issues"]'); if (navBtn) navBtn.textContent = '시장';

const cache = new Map();
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
function once(key, make, ttl = 0) { const c = cache.get(key); if (c && (!ttl || Date.now() - c.at < ttl)) return c.p; const p = make(); cache.set(key, { p, at: Date.now() }); p.catch(() => cache.delete(key)); return p; }
const research = () => Promise.all([once('study', () => getJson('/data/shock-study.json?v=A1')), once('report', () => getJson('/data/risk-model-report.json?v=R1'))]);
const series = s => once('s:' + s, () => getJson(`/api/market?symbol=${encodeURIComponent(s)}&range=5y`), 10 * 60000);
const quote = s => once('q:' + s, () => getJson(`/api/quote?symbol=${encodeURIComponent(s)}`), 60000).catch(() => null);
const idle = () => new Promise(r => setTimeout(r, 0));

let selected = '^KS11', results = new Map(), positions = [], running = 0, mineDirty = false, lastIdx = 0;

function modelTiles(r, report) {
  const m = r.models, rep = report?.models?.[r.symbol], cur = r.currency, price = r.price;
  const volTip = `${m.volModel === 'ewma' ? 'EWMA(λ=0.94)' : 'GARCH(1,1)'}로 다음 20거래일 변동성을 예측했습니다.${rep ? `\n표본 외 검증(${rep.from.slice(0, 4)}~): 예측 오차(QLIKE) GARCH ${rep.vol.qlike.garch} · EWMA ${rep.vol.qlike.ewma} · 최근 20일 그대로 ${rep.vol.qlike.naive}. 이 자산에서 더 정확했던 쪽을 씁니다.` : ''}`;
  const hmmTip = m.hmm ? `2상태 국면 모형(HMM)이 본 오늘의 '고변동 국면' 확률입니다. 고변동 국면 연 변동성 ${a1(m.hmm.stressVol)}, 평온 국면 ${a1(m.hmm.calmVol)}.${rep ? `\n검증: 고변동 판정 뒤 20일 실현 변동성 평균 ${rep.regime.stressVol}% vs 평온 ${rep.regime.calmVol}%. 국면 확률만으로 사고팔기는 자산마다 결과가 달라 비중 규칙에는 쓰지 않습니다.` : ''}` : '';
  const varTip = `GARCH로 걸러낸 실제 잔차 분포(필터드 역사적 시뮬레이션)로 계산했습니다.${rep ? `\n검증: 95% 기준을 넘은 날 ${rep.varTest.garch95.rate}%(목표 5%), 99% 기준 ${rep.varTest.garch99.rate}%(목표 1%).` : ''}`;
  return `<div class="mr-tiles">
    <div><span>예측 변동성(20일) ${tip(volTip)}</span><b>연 ${Math.round(m.vol.forecast * 100)}%</b><small>장기 평균 ${Math.round(m.vol.longRun * 100)}% · 최근 20일 ${Math.round(m.vol.realized20 * 100)}%</small></div>
    ${m.hmm ? `<div><span>고변동 국면 확률 ${tip(hmmTip)}</span><b>${Math.round(m.hmm.pStress * 100)}%</b><small>평균 지속 ${Math.round(m.hmm.duration)}거래일</small></div>` : ''}
    <div><span>하루 95% 범위 ${tip(varTip)}</span><b>${p1(m.day95[0])} ~ ${p1(m.day95[1])}</b><small>${fmt(price * (1 + m.day95[0]), cur)} ~ ${fmt(price * (1 + m.day95[1]), cur)} · 최악 5% 평균 −${a1(m.var95.ES)}</small></div>
    <div><span>20일 뒤 90% 범위 ${tip('GARCH 경로를 실제 잔차로 3,000번 모의했습니다. 방향을 예측하지 않으려고 평균 수익은 0으로 두었습니다. 흔들림의 크기를 보는 숫자입니다.')}</span><b>${p1(m.mc20.p05)} ~ ${p1(m.mc20.p95)}</b><small>−10% 넘게 더 빠질 확률 ${Math.round(m.mc20.probDown10 * 100)}%</small></div>
  </div>`;
}
function analogTable(r, study) {
  if (!r.analogs.length) return '';
  const ruleId = r.useTrend ? 'combined' : 'volTarget';
  return `<h4>과거 비슷한 때 ${tip(`최근 5거래일 안에 아래 조건이 나왔습니다. 같은 조건이 과거에 나온 뒤의 결과입니다(같은 조건은 20거래일에 한 번만 셈). 120일 열은 그날 종가부터 그냥 보유했을 때와 이 화면의 규칙을 따랐을 때의 평균과 최악입니다. 비용 0.2% 포함.\n자료: ${study.lastDates?.[r.symbol] || ''}까지 공개 일봉.`)}</h4>
  <div class="table-wrap"><table class="mr-table"><thead><tr><th>조건</th><th>표본</th><th>60일 뒤 중앙값</th><th>오른 비율</th><th>그 사이 추가 하락</th><th>120일: 보유</th><th>120일: 규칙</th></tr></thead><tbody>
  ${r.analogs.map(a => { const s = a.stats, h = s.response?.hold?.ret, q = s.response?.[ruleId]?.ret; return `<tr><td>${esc(a.label)}<small>${esc(a.date)} 발생</small></td><td>${s.n}</td><td class="${tone(s.r60.median)}">${s.r60.median > 0 ? '+' : ''}${s.r60.median}%</td><td>${s.r60.hit}%</td><td>평균 ${s.low60.mean}%<small>최악 ${s.low60.worst}%</small></td><td>${h ? `평균 ${h.mean}%<small>최악 ${h.worst}%</small>` : '—'}</td><td>${q ? `평균 ${q.mean}%<small>최악 ${q.worst}%</small>` : '—'}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function renderBody() {
  const r = results.get(selected), el = $('#mr-body');
  if (!r) { el.innerHTML = '<div class="shimmer mr-skel"></div><div class="shimmer mr-skel short"></div>'; return; }
  if (!r.ok) { el.innerHTML = `<p class="mr-warn">${esc(r.reason || r.error || '계산하지 못했습니다.')}</p>`; return; }
  const [study, report] = r._research, rep = report?.models?.[r.symbol], w = Math.round(r.weight * 100), d = r.data, dir = rep?.direction;
  const strat = rep?.strategies, ruleKey = r.useTrend ? 'combinedGarch' : 'volTargetGarch';
  const evidence = strat ? `${rep.from.slice(0, 4)}년~ 표본 외: 그냥 보유 샤프 ${strat.hold.sharpe}·최대 손실 ${strat.hold.mdd}% → 이 규칙 샤프 ${strat[ruleKey].sharpe}·최대 손실 ${strat[ruleKey].mdd}% (연 수익 ${strat.hold.cagr}% → ${strat[ruleKey].cagr}%)` : '';
  el.innerHTML = `<div class="mr-top"><div><b class="mr-price">${fmt(r.price, r.currency)}</b> <span class="${tone(r.levels.day)}">${p1(r.levels.day)}</span>
      <span class="mr-chip ${d.status === 'open' ? 'live' : ''}">${d.status === 'open' ? '장중' : '종가'} · ${esc(d.asOf)}${d.quoteAt ? ` · ${esc(time(d.quoteAt))} 확인` : ''}</span>
      ${tip(`출처: ${d.source}${d.notes.length ? '\n' + d.notes.join('\n') : ''}\n현재가는 네이버 증권, 과거 일봉은 Yahoo Finance(둘 다 비공식 경로)입니다.`)}</div>
      <div class="mr-levels"><span>20일선 ${fmt(r.levels.ma20, r.currency)} <em class="${tone(r.levels.gap20)}">${p1(r.levels.gap20)}</em></span><span>200일선 ${fmt(r.levels.ma200, r.currency)} <em class="${tone(r.levels.gap200)}">${p1(r.levels.gap200)}</em></span><span>1년 고점 대비 <em class="down">${p1(r.levels.fromHigh)}</em></span></div></div>
    <div class="mr-verdict"><div class="mr-weight"><span>규칙 비중</span><b>${w}%</b><small>계획 대비 · ${esc(r.rule)}</small></div>
      <p>${w === 0 ? `규칙상 지금은 <b>현금으로 기다릴 때</b>입니다.` : w >= 95 ? '규칙상 <b>계획대로 보유</b>합니다.' : `규칙상 계획의 <b>${w}%만 주식</b>으로, 나머지는 현금으로 둡니다.`} ${evidence ? tip(evidence) : ''}</p></div>
    <div class="mr-cols">
      <section><h4>오늘 할 일</h4><ol>${r.today.map(x => `<li>${esc(x)}</li>`).join('')}</ol></section>
      <section><h4>하지 말 것</h4><ul>${r.avoid.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
      <section><h4>다음 신호</h4><ul class="mr-triggers">${r.triggers.map(t => `<li><b>${esc(t.when)}</b><span>→ ${esc(t.then)}</span>${Number.isFinite(t.distance) ? `<small>지금부터 ${t.distance > 0 ? '+' : ''}${t.distance}%</small>` : ''}</li>`).join('')}</ul></section>
    </div>
    ${modelTiles(r, report)}
    ${analogTable(r, study)}
    ${dir ? `<p class="mr-muted mr-dir">방향은 예측하지 않습니다 ${tip(`표본 외 확인: 지난 20거래일 방향으로 다음 20거래일 방향을 맞힌 비율 ${dir.momentumHit}%. 같은 기간 20거래일 뒤 오른 구간 비율이 ${dir.baseUpShare}%라, 방향을 맞히는 힘은 사실상 없습니다. 모델은 흔들림의 크기와 손실 위험을 재는 데 씁니다.`)}</p>` : ''}`;
}
function renderTabs() {
  $('#mr-tabs').innerHTML = INDICES.map(([s, n]) => { const r = results.get(s); return `<button type="button" role="tab" data-mr="${esc(s)}" aria-selected="${s === selected}" class="${s === selected ? 'on' : ''}"><span>${esc(n)}</span>${r?.ok ? `<em class="${tone(r.levels.day)}">${p1(r.levels.day)}</em><i>비중 ${Math.round(r.weight * 100)}%</i>` : '<i>계산 중</i>'}</button>`; }).join('');
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
  renderTabs();
  for (const [s, n, m] of INDICES) { const r = await computeIndex(s, n, m, vix, research_); if (id !== running) return; results.set(s, r); renderTabs(); if (s === selected) renderBody(); }
  window.dispatchEvent(new CustomEvent('teamquant:market-response', { detail: Object.fromEntries([...results].map(([k, v]) => [k, v.ok ? { weight: v.weight, headline: v.headline } : null])) }));
}

// ── 내 종목 대응 ─────────────────────────────────────────────
let mineRun = 0;
async function loadMine() {
  const id = ++mineRun, el = $('#mr-mine-body');
  if (!positions.length) { el.innerHTML = '<p class="mr-muted">계좌를 연결하거나 예시 자산을 켜면 종목별로 계산합니다.</p>'; $('#mr-mine-note').textContent = ''; return; }
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
  $('#mr-mine-note').textContent = ok.length ? `규칙대로면 주식 ${won(plan.keep)} · 현금으로 ${won(plan.toCash)}` : '';
  el.innerHTML = `<div class="table-wrap"><table class="mr-table mr-mine-table"><thead><tr><th>종목</th><th>현재가</th><th>예측 변동성</th><th>규칙 비중</th><th>지금 → 규칙상</th><th>하루 95% 손실</th><th>다음 신호</th></tr></thead><tbody>
    ${rows.map(r => !r.ok ? `<tr><td>${esc(r.name)}</td><td colspan="6" class="mr-muted">${esc(r.reason)}</td></tr>` : `<tr><td><b>${esc(r.name)}</b><small>${esc(r.rule)}</small></td>
      <td>${fmt(r.price, r.currency)} <span class="${tone(r.levels.day)}">${p1(r.levels.day)}</span><small>${r.data.status === 'open' ? '장중' : '종가'}${r.data.notes.some(n => n.includes('보정')) ? ' · 현재가 보정' : ''}</small></td>
      <td>연 ${Math.round(r.models.vol.forecast * 100)}%<small>평균 ${Math.round(r.models.vol.longRun * 100)}%</small></td>
      <td><b>${Math.round(r.weight * 100)}%</b></td>
      <td>${won(r.valueKrw)} → <b>${won(r.valueKrw * r.weight)}</b></td>
      <td>${won(r.valueKrw * r.models.var95.VaR)}<small>−${a1(r.models.var95.VaR)}</small></td>
      <td><small class="mr-next">${esc(r.triggers[0]?.when || '')} → ${esc(r.triggers[0]?.then || '')}</small></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="4">합계</td><td>${won(plan.now)} → <b>${won(plan.keep)}</b></td><td>${won(plan.oneDayLoss95)}</td><td></td></tr></tfoot></table></div>`;
}

// 스냅샷의 평가액(value)은 종목 통화라, 해외 종목은 스냅샷 환율로 원화로 바꾼다.
const toKrw = (v, cur, fx) => !Number.isFinite(v) ? null : cur === 'USD' ? (fx?.midRate ? v * fx.midRate : null) : v;
window.addEventListener('teamquant:asset-snapshot', e => { const snap = e.detail || {}; positions = (snap.positions || []).map(p => ({ ...p, valueKrw: Number.isFinite(p.valueKrw) ? p.valueKrw : toKrw(p.value, p.currency, snap.fx) })); if (document.querySelector('.view.active')?.dataset.page === 'issues') void loadMine(); else mineDirty = true; });
window.addEventListener('teamquant:asset-clear', () => { positions = []; void loadMine(); });
function onShow() { if (document.querySelector('.view.active')?.dataset.page !== 'issues') return; if (Date.now() - lastIdx > 5 * 60000) { lastIdx = Date.now(); void loadIndices(); } if (mineDirty) { mineDirty = false; void loadMine(); } }
window.addEventListener('teamquant:page', onShow);
document.getElementById('iss-refresh')?.addEventListener('click', () => { cache.forEach((v, k) => { if (k.startsWith('q:')) cache.delete(k); }); lastIdx = Date.now(); void loadIndices(); void loadMine(); });
setInterval(() => { if (document.visibilityState === 'visible' && document.querySelector('.view.active')?.dataset.page === 'issues') { cache.forEach((v, k) => { if (k.startsWith('q:')) cache.delete(k); }); lastIdx = Date.now(); void loadIndices(); } }, 5 * 60000);
renderTabs();
