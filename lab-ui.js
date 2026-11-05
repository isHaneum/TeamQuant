// 전략 테스트 한 화면: ① 방식 → ② 종목 → ③ 기간 → 결과(그냥 들고 있기·시장과 비교).
// 기존 4단계 화면(원칙 승인·과거 검증·투자금 계산·모의 운용)은 지우지 않고 "더보기"에서 연다.
import { PRESETS, CUSTOM_EXAMPLES, strategyConfig, periodStart, runLabTest, findBestFit, josa } from '/lib/strategy-lab.js';
import { resolveStockInput, stockName } from '/lib/instruments.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
const pp = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/lab.css?v=20261105'; document.head.append(css);
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'quicktest'; nav.textContent = '전략 테스트'; $('.overview-nav nav').append(nav);
const page = document.createElement('section'); page.className = 'view'; page.dataset.page = 'quicktest'; page.id = 'quicktest';
page.innerHTML = `
<div class="page-head"><div><h1>전략 테스트</h1><p>"이 방식대로 사고팔았다면 얼마였을까?"를 과거 시세로 확인합니다. 실제 주문은 하지 않습니다.</p></div></div>
<p class="lt-guide"><b>무엇을 살지</b>는 "포트폴리오" 화면의 종목 성적표(PER·ROE·배당 등)로, <b>언제 사고팔지</b>는 여기서 정합니다. 방식이 고민되면 종목을 고른 뒤 <b>4가지 방식 한 번에 비교</b>를 누르십시오.</p>
<div class="lt">
  <form class="lt-form" id="lt-form">
    <fieldset><legend><b>1</b> 어떻게 사고팔까요?</legend>
      <div class="lt-presets">${PRESETS.map((p, i) => `<label class="lt-preset"><input type="radio" name="lt-preset" value="${p.id}" ${i ? '' : 'checked'}><span><strong>${esc(p.title)}</strong><em>${esc(p.how)}</em><small>${esc(p.when)}</small></span></label>`).join('')}
        <label class="lt-preset"><input type="radio" name="lt-preset" value="custom"><span><strong>직접 쓰기</strong><em>문장으로 조건을 적습니다. 아래 예시를 눌러 고쳐 쓰면 쉽습니다.</em></span></label></div>
      <div class="lt-custom" id="lt-custom" hidden><textarea id="lt-text" rows="3" placeholder="예: 5일선이 20일선을 돌파하면 매수, 하향 돌파하면 매도. 손절 7%"></textarea>
        <div class="lt-examples">${CUSTOM_EXAMPLES.map(x => `<button type="button" data-lt-example="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <p class="lt-hint">쓸 수 있는 조건: 이동평균(5일선·20일선…), RSI, 최고가·최저가 돌파, 손절 %, 익절 %. 뉴스·실적 같은 조건은 아직 계산하지 못합니다.</p></div>
      <label class="lt-stop" id="lt-stop-wrap">손실 제한 <select id="lt-stop"><option value="0">없음</option><option value="5">-5%에서 팔기</option><option value="8">-8%에서 팔기</option><option value="10">-10%에서 팔기</option></select></label>
    </fieldset>
    <fieldset><legend><b>2</b> 어떤 종목으로?</legend>
      <div class="lt-chips" id="lt-holdings"><span class="lt-hint">계좌를 불러오면 내 보유 종목이 여기에 나옵니다.</span></div>
      <label class="lt-search">직접 찾기<input id="lt-symbol" list="symbols" autocomplete="off" placeholder="예: 삼성전자, 현대차, NVDA"></label>
    </fieldset>
    <fieldset><legend><b>3</b> 얼마 동안?</legend>
      <div class="lt-seg" role="radiogroup">${[[3, '최근 3개월'], [6, '6개월'], [12, '1년']].map(([m, l], i) => `<label><input type="radio" name="lt-period" value="${m}" ${i === 2 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </fieldset>
    <button class="primary lt-run" id="lt-run" type="submit">테스트하기</button>
    <button class="secondary lt-run lt-compare" id="lt-compare" type="button">4가지 방식 한 번에 비교</button>
    <p class="lt-status" id="lt-status" role="status"></p>
  </form>
  <div class="lt-result" id="lt-result">
    <div class="lt-empty"><h3>이렇게 쓰면 됩니다</h3><ol><li>사고파는 방식을 하나 고릅니다. 처음이라면 "오르는 흐름 따라가기"를 그대로 두십시오.</li><li>내 보유 종목을 누르거나 종목 이름을 적습니다.</li><li>기간을 고르고 <b>테스트하기</b>를 누릅니다.</li></ol><p>결과는 항상 <b>그냥 사서 들고 있었을 때</b>와 비교합니다. 이 방식이 들고 있기보다 낫지 않다면 굳이 사고팔 이유가 없다는 뜻입니다.</p></div>
  </div>
</div>`;
document.querySelector('main').append(page);

let holdings = [], selected = null, run = 0;
const cache = new Map();
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
function candlesFor(symbol) {
  if (cache.has(symbol)) return cache.get(symbol);
  const p = (async () => {
    const code = symbol.split('.')[0];
    if (/^\d[\dA-Z]{5}$/.test(code)) {
      const tries = /\.(KS|KQ)$/.test(symbol) ? [symbol] : [code + '.KS', code + '.KQ'];
      for (const s of tries) { try { const d = await getJson(`/api/market?symbol=${s}&range=2y`); if (d.currency === 'KRW') return { ...d, index: s.endsWith('.KQ') ? ['^KQ11', '코스닥'] : ['^KS11', '코스피'] }; } catch {} }
      throw new Error('시세를 찾지 못했습니다.');
    }
    return { ...await getJson(`/api/market?symbol=${encodeURIComponent(symbol.replace(/\./g, '-'))}&range=2y`), index: ['^GSPC', 'S&P 500'] };
  })();
  cache.set(symbol, p); p.catch(() => cache.delete(symbol)); return p;
}
const indexFor = s => { if (!cache.has(s)) { const p = getJson(`/api/market?symbol=${encodeURIComponent(s)}&range=2y`); cache.set(s, p); p.catch(() => cache.delete(s)); } return cache.get(s); };

function renderHoldings() {
  const box = $('#lt-holdings');
  if (!holdings.length) return;
  box.innerHTML = holdings.map(h => `<button type="button" data-symbol="${esc(h.symbol)}" class="${selected?.symbol === h.symbol ? 'on' : ''}">${esc(h.name)}</button>`).join('') + (holdings.length > 1 ? '<button type="button" data-all class="lt-all">보유 종목 전체에 적용</button>' : '');
  box.querySelectorAll('[data-symbol]').forEach(b => b.onclick = () => { selected = holdings.find(h => h.symbol === b.dataset.symbol); $('#lt-symbol').value = ''; renderHoldings(); });
  box.querySelector('[data-all]')?.addEventListener('click', () => void runAll());
}
window.addEventListener('teamquant:asset-snapshot', e => { holdings = (e.detail?.positions || []).map(p => ({ symbol: p.symbol, name: p.name })); if (!selected && holdings[0]) selected = holdings[0]; renderHoldings(); });
window.addEventListener('teamquant:asset-clear', () => { holdings = []; selected = null; $('#lt-holdings').innerHTML = '<span class="lt-hint">계좌를 불러오면 내 보유 종목이 여기에 나옵니다.</span>'; });

const presetValue = () => page.querySelector('[name="lt-preset"]:checked').value;
page.querySelectorAll('[name="lt-preset"]').forEach(r => r.onchange = () => { const custom = presetValue() === 'custom'; $('#lt-custom').hidden = !custom; $('#lt-stop-wrap').hidden = custom; if (custom) $('#lt-text').focus(); });
page.querySelectorAll('[data-lt-example]').forEach(b => b.onclick = () => { $('#lt-text').value = b.dataset.ltExample; $('#lt-text').focus(); });
$('#lt-symbol').oninput = () => { if ($('#lt-symbol').value.trim()) { selected = null; renderHoldings(); } };

async function chosenSymbol() {
  const typed = $('#lt-symbol').value.trim();
  if (!typed) { if (selected) return selected; throw new Error('종목을 고르거나 이름을 적어 주십시오.'); }
  if (/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(typed)) return { symbol: typed.toUpperCase(), name: typed.toUpperCase() };
  const symbol = await resolveStockInput(typed); return { symbol, name: stockName(symbol) };
}
function setup() {
  const preset = presetValue(), text = preset === 'custom' ? $('#lt-text').value : '';
  if (preset === 'custom' && !text.trim()) throw new Error('직접 쓰기를 골랐다면 조건 문장을 적어 주십시오. 예시를 눌러도 됩니다.');
  const months = Number(page.querySelector('[name="lt-period"]:checked').value);
  return { ...strategyConfig({ preset, text, stopLossPct: $('#lt-stop').value }), months, from: periodStart(today(), months) };
}
async function testOne(stock, s) {
  const data = await candlesFor(stock.symbol), idx = await indexFor(data.index[0]).catch(() => null);
  return { stock, indexName: data.index[1], ...runLabTest(data.candles, idx?.candles || [], s.config, s.from) };
}

function curveSvg(t) {
  const c = t.curve, W = 720, H = 240, L = 44, R = 10, T = 12, B = 26;
  const vals = c.flatMap(p => [p.strategy, p.hold]), lo = Math.min(...vals) * 0.98, hi = Math.max(...vals) * 1.02;
  const X = i => L + i / Math.max(1, c.length - 1) * (W - L - R), Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  const path = k => c.map((p, i) => `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
  const pos = new Map(c.map((p, i) => [p.date, i]));
  const marks = t.result.trades.filter(x => pos.has(x.date)).map(x => { const i = pos.get(x.date); return `<circle class="${x.side === '매수' ? 'buy' : 'sell'}" cx="${X(i)}" cy="${Y(c[i].strategy)}" r="4.5"><title>${esc(`${x.date} ${x.side} ${x.price.toLocaleString('ko-KR')}`)}</title></circle>`; }).join('');
  const ticks = [lo, (lo + hi) / 2, hi].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const dates = [0, Math.floor(c.length / 2), c.length - 1].map(i => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === c.length - 1 ? 'end' : 'middle'}">${c[i].date.slice(2).replaceAll('-', '.')}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="전략과 그냥 보유의 자산 변화 (시작=100)">${ticks}<line class="base" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/><polyline class="hold" points="${path('hold')}"/><polyline class="strat" pathLength="1" points="${path('strategy')}"/>${marks}${dates}</svg>`;
}
function renderOne(t, s) {
  const r = t.result.summary, trades = t.result.trades.slice(-12).reverse();
  $('#lt-result').innerHTML = `<article class="lt-card">
    <p class="lt-eyebrow">${esc(t.stock.name)} · ${esc(s.label)} · ${esc(r.startDate)} ~ ${esc(r.endDate)}</p>
    <h3 class="lt-verdict ${tone(t.edge)}">${esc(t.verdict)}</h3>${t.note ? `<p class="lt-sub">${esc(t.note)}</p>` : ''}
    <div class="lt-tiles"><div class="main"><span>이 방식대로 했다면</span><b class="${tone(r.totalReturn)}">${pct(r.totalReturn)}</b><small>비용 포함 · 매매 ${r.tradeCount}번${r.positionOpen ? ' + 보유 중' : ''}</small></div>
      <div><span>그냥 들고 있었다면</span><b class="${tone(t.hold.return)}">${pct(t.hold.return)}</b><small>첫날 사서 끝까지</small></div>
      <div><span>${esc(t.indexName)}</span><b class="${tone(t.market)}">${pct(t.market)}</b><small>같은 기간 시장</small></div>
      <div><span>중간 최대 손실</span><b>${pct(r.maxDrawdown)}</b><small>들고 있기 ${pct(t.hold.maxDrawdown)}</small></div></div>
    <figure class="lt-chart">${curveSvg(t)}<figcaption><span><i class="strat"></i>이 방식</span><span><i class="hold"></i>그냥 보유</span><span><i class="dot buy"></i>산 날</span><span><i class="dot sell"></i>판 날</span><span class="lt-muted">시작=100 · 주식을 들고 있던 기간 ${t.inMarket}%</span></figcaption></figure>
    <h4>이 방식의 규칙</h4><ul class="lt-rules"><li><b>살 때</b> ${esc(s.definition.entryRule)}</li><li><b>팔 때</b> ${esc(s.definition.exitRule)}</li><li><b>기타</b> ${esc(s.definition.riskRule)}</li></ul>
    ${s.warnings.length ? `<p class="lt-warn">${s.warnings.map(esc).join(' ')}</p>` : ''}
    <h4>실제로 사고판 날 ${trades.length ? `(최근 ${trades.length}건)` : ''}</h4>
    ${trades.length ? `<ol class="lt-trades">${trades.map(x => `<li><span class="${x.side === '매수' ? 'buy' : 'sell'}">${x.side}</span><b>${esc(x.date)}</b> ${x.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${x.pnl === null ? '' : ` · <em class="${tone(x.pnl)}">이번 거래 ${x.pnl > 0 ? '+' : ''}${Math.round(x.pnl).toLocaleString('ko-KR')}</em>`}<small>${esc(x.reason)}</small></li>`).join('')}</ol>` : '<p class="lt-muted">이 기간에는 사고판 날이 없습니다.</p>'}
    <p class="lt-muted">과거 결과이며 앞으로도 같다는 보장은 없습니다. 1,000만원으로 시작해 신호 다음 날 시가에 사고판다고 가정했습니다.</p>
  </article>`;
}
function renderAll(rows, s) {
  const ok = rows.filter(r => !r.error), better = ok.filter(r => r.edge >= 2).length, worse = ok.filter(r => r.edge <= -2).length;
  $('#lt-result').innerHTML = `<article class="lt-card"><p class="lt-eyebrow">보유 종목 ${rows.length}개 · ${esc(s.label)} · 최근 ${s.months}개월</p>
    <h3 class="lt-verdict">${ok.length ? `${ok.length}종목 중 ${better}종목은 이 방식이 낫고, ${worse}종목은 그냥 들고 있는 편이 나았습니다.` : '계산한 종목이 없습니다.'}</h3>
    <div class="table-wrap"><table class="lt-table"><thead><tr><th>종목</th><th>이 방식</th><th>그냥 보유</th><th>차이</th><th>매매</th></tr></thead><tbody>${rows.map(r => r.error ? `<tr><td>${esc(r.stock.name)}</td><td colspan="4" class="lt-muted">${esc(r.error)}</td></tr>` : `<tr data-symbol="${esc(r.stock.symbol)}"><td><button type="button" class="text-button">${esc(r.stock.name)}</button></td><td class="${tone(r.result.summary.totalReturn)}">${pct(r.result.summary.totalReturn)}</td><td class="${tone(r.hold.return)}">${pct(r.hold.return)}</td><td class="${tone(r.edge)}"><b>${pp(r.edge)}</b></td><td>${r.result.summary.tradeCount}번</td></tr>`).join('')}</tbody></table></div>
    <p class="lt-muted">종목 이름을 누르면 그 종목의 자세한 결과를 봅니다.</p></article>`;
  $('#lt-result').querySelectorAll('tr[data-symbol] button').forEach(b => b.onclick = () => { const r = ok.find(x => x.stock.symbol === b.closest('tr').dataset.symbol); renderOne(r, s); });
}

async function start(job) {
  const id = ++run; $('#lt-run').disabled = true; $('#lt-compare').disabled = true; $('#lt-status').textContent = '과거 시세로 계산 중…';
  $('#lt-result').innerHTML = '<div class="lt-card"><div class="shimmer lt-skel"></div><div class="shimmer lt-skel short"></div></div>';
  try { await job(id); if (id === run) $('#lt-status').textContent = ''; }
  catch (e) { if (id === run) { $('#lt-status').textContent = e.message; $('#lt-result').innerHTML = `<div class="lt-card"><p class="lt-warn">${esc(e.message)}</p></div>`; } }
  finally { if (id === run) { $('#lt-run').disabled = false; $('#lt-compare').disabled = false; } }
}
function renderFit(stock, fit, months) {
  if (!fit.available) throw new Error(fit.message);
  $('#lt-result').innerHTML = `<article class="lt-card"><p class="lt-eyebrow">${esc(stock.name)} · 4가지 방식 비교 · 최근 ${months}개월</p>
    <h3 class="lt-verdict ${fit.fitsHold ? 'flat' : 'up'}">${fit.fitsHold ? '이 종목은 그냥 들고 있기가 가장 나았습니다.' : `"${esc(fit.best.title)}"${josa(fit.best.title, '이', '가')} 가장 잘 맞았습니다.`}</h3><p class="lt-sub">${esc(fit.advice)}</p>
    <div class="table-wrap"><table class="lt-table"><thead><tr><th>방식</th><th>수익률</th><th>그냥 보유 대비</th><th>매매</th><th>지금 상태</th></tr></thead><tbody>${fit.rows.map(r => `<tr><td>${esc(r.title)}</td><td class="${tone(r.return)}">${pct(r.return)}</td><td class="${tone(r.edge)}"><b>${pp(r.edge)}</b></td><td>${r.trades}번</td><td>${r.holding ? '매수 상태' : '관망'}</td></tr>`).join('')}<tr><td>그냥 들고 있기</td><td class="${tone(fit.best.hold)}">${pct(fit.best.hold)}</td><td>기준</td><td>—</td><td>보유</td></tr></tbody></table></div>
    <p class="lt-muted">${esc(fit.caveat)} 방식 하나를 골라 왼쪽에서 "테스트하기"를 누르면 사고판 날까지 자세히 볼 수 있습니다.</p></article>`;
}
$('#lt-compare').onclick = () => void start(async id => { const months = Number(page.querySelector('[name="lt-period"]:checked').value), stock = await chosenSymbol(), data = await candlesFor(stock.symbol), idx = await indexFor(data.index[0]).catch(() => null);
  const fit = findBestFit(data.candles, idx?.candles || [], periodStart(today(), months)); if (id === run) renderFit(stock, fit, months); });
$('#lt-form').onsubmit = e => { e.preventDefault(); void start(async id => { const s = setup(), stock = await chosenSymbol(), t = await testOne(stock, s); if (id === run) renderOne(t, s); }); };
async function runAll() {
  await start(async id => { const s = setup(), rows = [];
    for (const h of holdings) { try { rows.push(await testOne(h, s)); } catch (e) { rows.push({ stock: h, error: e.message }); } if (id !== run) return; }
    renderAll(rows, s); });
}
