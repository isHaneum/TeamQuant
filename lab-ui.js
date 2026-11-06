// 전략 테스트 한 화면: ① 방식 → ② 종목 → ③ 기간 → 결과(그냥 들고 있기·시장과 비교).
// 2026-11-06: 상황 공부 추가. 종목의 지금 상태(과열·급락 등), 같은 상태 이후 분포, 상태별 방식 비교, 시장 국면별 성과, 같은 종목군 검증.
// 기존 4단계 화면(원칙 승인·과거 검증·투자금 계산·모의 운용)은 지우지 않고 "더보기"에서 연다.
import { PRESETS, CUSTOM_EXAMPLES, strategyConfig, periodStart, runLabTest, findBestFit, josa } from '/lib/strategy-lab.js';
import { SITUATION_STRATEGIES, runSituationTest, regimeBreakdown } from '/lib/situation-strategies.js';
import { currentSituation, groupOf, STATES, STATE_ORDER, REGIMES, GROUPS, SITUATION_VERSION } from '/lib/situation.js';
import { resolveStockInput, stockName } from '/lib/instruments.js';
import { tip } from '/tooltip-ui.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
const pp = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%p` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const SIT = SITUATION_STRATEGIES.filter(s => s.id !== 'hold');
const CONCEPTS = [
  ['모멘텀', '오르던 것이 한동안 더 오르는 경향. 추세 따라가기 방식의 근거입니다. 국면이 바뀌면 크게 틀립니다.'],
  ['평균 회귀', '많이 벗어난 가격이 평균 쪽으로 돌아오는 경향. 횡보장에서 잘 맞고, 한 방향으로 계속 가는 장에서는 손실이 커집니다.'],
  ['추적 손절', '산 뒤 가장 높았던 가격에서 일정 폭 내려오면 파는 규칙. 이익은 따라가고 큰 손실은 끊습니다.'],
  ['변동성 비중', '하루 변동이 큰 종목은 적게, 작은 종목은 많이 담아 종목마다 위험을 비슷하게 맞추는 방법.'],
  ['과적합', '지난 자료에 규칙을 너무 맞춰서, 다음 기간에는 맞지 않는 현상. 시도 횟수가 많을수록 우연히 좋은 결과가 나옵니다.'],
  ['생존 편향', '지금 살아남은 종목만 골라 연구하면 결과가 실제보다 좋게 나옵니다. 상장폐지·급락 후 사라진 종목이 빠지기 때문입니다.']
];

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/lab.css?v=20261106'; document.head.append(css);
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'quicktest'; nav.textContent = '전략 테스트'; $('.overview-nav nav').append(nav);
const page = document.createElement('section'); page.className = 'view'; page.dataset.page = 'quicktest'; page.id = 'quicktest';
const option = (value, title, help, checked) => `<label class="lt-preset"><input type="radio" name="lt-preset" value="${value}" ${checked ? 'checked' : ''}><span><strong>${esc(title)}${tip(help)}</strong></span></label>`;
page.innerHTML = `
<div class="page-head"><div><h1>전략 테스트 ${tip('무엇을 살지는 포트폴리오의 종목 성적표로, 언제 사고팔지는 여기서 정합니다. 종목을 고르면 지금 상황(과열·급락 등)과 그 상황에서 과거에 어떤 방식이 나았는지 먼저 보여 줍니다. 실제 주문은 하지 않습니다.')}</h1><p>지금 상황을 보고, 과거 시세로 매매 방식을 시험합니다</p></div></div>
<div class="lt">
  <form class="lt-form" id="lt-form">
    <fieldset><legend><b>1</b> 매매 방식</legend>
      <p class="lt-group">기본 방식</p>
      <div class="lt-presets">${PRESETS.map((p, i) => option(p.id, p.title, `${p.how}\n${p.when}`, !i)).join('')}${option('custom', '직접 쓰기', '조건을 문장으로 적습니다.')}</div>
      <p class="lt-group">상황별 방식 ${tip('과열·급락·추세·횡보 같은 상황에 맞춰 비중을 조절하는 방식입니다. 오른쪽 상황 공부의 "이 방식으로 시험"을 눌러도 골라집니다.')}</p>
      <div class="lt-presets">${SIT.map(s => option('s:' + s.id, s.title, `${s.how}\n맞는 때: ${s.when}`)).join('')}</div>
      <div class="lt-custom" id="lt-custom" hidden><textarea id="lt-text" rows="3" placeholder="예: 5일선이 20일선을 돌파하면 매수, 하향 돌파하면 매도. 손절 7%"></textarea>
        <div class="lt-examples">${CUSTOM_EXAMPLES.map(x => `<button type="button" data-lt-example="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <p class="lt-hint">예시를 눌러 고쳐 쓰면 됩니다 ${tip('쓸 수 있는 조건: 이동평균(5일선·20일선…), RSI, 최고가·최저가 돌파, 손절 %, 익절 %. 뉴스·실적 같은 조건은 아직 계산하지 못합니다.')}</p></div>
      <label class="lt-stop" id="lt-stop-wrap">손실 제한 <select id="lt-stop"><option value="0">없음</option><option value="5">-5%에서 팔기</option><option value="8">-8%에서 팔기</option><option value="10">-10%에서 팔기</option></select></label>
    </fieldset>
    <fieldset><legend><b>2</b> 종목</legend>
      <div class="lt-chips" id="lt-holdings"><span class="lt-hint">계좌를 연결하면 보유 종목이 나옵니다.</span></div>
      <label class="lt-search">직접 찾기<input id="lt-symbol" list="symbols" autocomplete="off" placeholder="예: 삼성전자, 현대차, NVDA"></label>
    </fieldset>
    <fieldset><legend><b>3</b> 기간</legend>
      <div class="lt-seg" role="radiogroup">${[[3, '최근 3개월'], [6, '6개월'], [12, '1년']].map(([m, l], i) => `<label><input type="radio" name="lt-period" value="${m}" ${i === 2 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </fieldset>
    <button class="primary lt-run" id="lt-run" type="submit">테스트하기</button>
    <button class="secondary lt-run lt-compare" id="lt-compare" type="button">모든 방식 한 번에 비교</button>
    <p class="lt-status" id="lt-status" role="status"></p>
  </form>
  <div class="lt-right">
    <div id="lt-situation"></div>
    <div class="lt-result" id="lt-result"></div>
  </div>
</div>`;
document.querySelector('main').append(page);

let holdings = [], selected = null, run = 0, sitRun = 0, lastTest = null, UNIVERSE_SIZE = {};
const cache = new Map();
async function getJson(url) { const r = await fetch(url), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `요청 실패 (${r.status})`); return d; }
function once(key, make) { if (!cache.has(key)) { const p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); } return cache.get(key); }
function candlesFor(symbol) {
  return once('c:' + symbol, async () => {
    const code = symbol.split('.')[0];
    if (/^\d[\dA-Z]{5}$/.test(code)) {
      const tries = /\.(KS|KQ)$/.test(symbol) ? [symbol] : [code + '.KS', code + '.KQ'];
      for (const s of tries) { try { const d = await getJson(`/api/market?symbol=${s}&range=2y`); if (d.currency === 'KRW') return { ...d, index: s.endsWith('.KQ') ? ['^KQ11', '코스닥'] : ['^KS11', '코스피'] }; } catch {} }
      throw new Error('시세를 찾지 못했습니다.');
    }
    return { ...await getJson(`/api/market?symbol=${encodeURIComponent(symbol.replace(/\./g, '-'))}&range=2y`), index: ['^GSPC', 'S&P 500'] };
  });
}
const indexFor = s => once('i:' + s, () => getJson(`/api/market?symbol=${encodeURIComponent(s)}&range=2y`));
const statsFile = () => once('stats', () => getJson('/data/situation-stats.json?v=' + encodeURIComponent(SITUATION_VERSION)));
statsFile().then(s => { UNIVERSE_SIZE = Object.fromEntries(Object.entries(s.universe).map(([g, l]) => [g, l.length])); }).catch(() => {});

// ── 종목 고르기 ───────────────────────────────────────────────
function renderHoldings() {
  const box = $('#lt-holdings');
  if (!holdings.length) return;
  box.innerHTML = holdings.map(h => `<button type="button" data-symbol="${esc(h.symbol)}" class="${selected?.symbol === h.symbol ? 'on' : ''}">${esc(h.name)}</button>`).join('') + (holdings.length > 1 ? '<button type="button" data-all class="lt-all">보유 종목 전체에 적용</button>' : '');
  box.querySelectorAll('[data-symbol]').forEach(b => b.onclick = () => { selected = holdings.find(h => h.symbol === b.dataset.symbol); $('#lt-symbol').value = ''; renderHoldings(); void showSituation(selected); });
  box.querySelector('[data-all]')?.addEventListener('click', () => void runAll());
}
window.addEventListener('teamquant:asset-snapshot', e => { holdings = (e.detail?.positions || []).map(p => ({ symbol: p.symbol, name: p.name })); if (!selected && holdings[0]) { selected = holdings[0]; void showSituation(selected); } renderHoldings(); });
window.addEventListener('teamquant:study', e => { const d = e.detail || {}; if (!d.symbol) return; selected = holdings.find(h => h.symbol === d.symbol) || { symbol: d.symbol, name: d.name || d.symbol }; $('#lt-symbol').value = holdings.some(h => h.symbol === d.symbol) ? '' : selected.name; renderHoldings(); void showSituation(selected); });
window.addEventListener('teamquant:asset-clear', () => { holdings = []; selected = null; $('#lt-holdings').innerHTML = '<span class="lt-hint">계좌를 불러오면 내 보유 종목이 여기에 나옵니다.</span>'; void showGuide(); });

const presetValue = () => page.querySelector('[name="lt-preset"]:checked').value;
function syncPreset() { const v = presetValue(), custom = v === 'custom'; $('#lt-custom').hidden = !custom; $('#lt-stop-wrap').hidden = custom || v.startsWith('s:'); }
page.querySelectorAll('[name="lt-preset"]').forEach(r => r.onchange = () => { syncPreset(); if (presetValue() === 'custom') $('#lt-text').focus(); });
page.querySelectorAll('[data-lt-example]').forEach(b => b.onclick = () => { $('#lt-text').value = b.dataset.ltExample; $('#lt-text').focus(); });
$('#lt-symbol').oninput = () => { if ($('#lt-symbol').value.trim()) { selected = null; renderHoldings(); } };
$('#lt-symbol').onchange = async () => { try { void showSituation(await chosenSymbol()); } catch {} };

async function chosenSymbol() {
  const typed = $('#lt-symbol').value.trim();
  if (!typed) { if (selected) return selected; throw new Error('종목을 고르거나 이름을 적어 주십시오.'); }
  if (/^[A-Za-z][A-Za-z.\-]{0,9}$/.test(typed)) return { symbol: typed.toUpperCase(), name: typed.toUpperCase() };
  const symbol = await resolveStockInput(typed); return { symbol, name: stockName(symbol) };
}
function setup() {
  const preset = presetValue(), months = Number(page.querySelector('[name="lt-period"]:checked').value), from = periodStart(today(), months);
  if (preset.startsWith('s:')) { const s = SIT.find(x => x.id === preset.slice(2)); return { situationId: s.id, label: s.title, warnings: [], months, from }; }
  const text = preset === 'custom' ? $('#lt-text').value : '';
  if (preset === 'custom' && !text.trim()) throw new Error('직접 쓰기를 골랐다면 조건 문장을 적어 주십시오. 예시를 눌러도 됩니다.');
  return { ...strategyConfig({ preset, text, stopLossPct: $('#lt-stop').value }), months, from };
}
async function testOne(stock, s) {
  const data = await candlesFor(stock.symbol), idx = await indexFor(data.index[0]).catch(() => null), ic = idx?.candles || [];
  const t = s.situationId ? runSituationTest(data.candles, ic, s.situationId, s.from) : runLabTest(data.candles, ic, s.config, s.from);
  return { stock, indexName: data.index[1], indexCandles: ic, group: groupOf({ symbol: data.symbol, currency: data.currency, instrumentType: data.instrumentType }), ...t };
}

// ── 상황 공부 ────────────────────────────────────────────────
const stLabel = st => STATES[st]?.label || st;
function strategyTable(stats, group, state) {
  const e = stats.edges?.[group]?.[state], r = stats.risk?.[group]?.[state], st = stats.states?.[group]?.[state];
  if (!e) return '<p class="lt-muted">이 상태의 표본이 없습니다.</p>';
  const rule = stats.rule?.[group]?.[state] || 'hold', ruled = SIT.find(s => s.id === rule);
  const rows = SIT.map(s => ({ s, e: e[s.id], r: r?.[s.id] })).filter(x => x.e?.n);
  const calm = rows.filter(x => x.r && x.r.mean >= 2).sort((a, b) => (b.r.mean + b.e.mean) - (a.r.mean + a.e.mean))[0];
  const lead = ruled
    ? `과거 이 상태에서는 <b>${esc(ruled.title)}</b>${josa(ruled.title, '이', '가')} 그냥 보유보다 나았습니다.`
    : `과거 이 상태에서 그냥 보유보다 확실히 나은 방식은 없었습니다. <b>꾸준히 보유·적립이 기본</b>입니다.${calm ? ` 손실 폭을 줄이는 게 우선이라면 <b>${esc(calm.s.title)}</b>${josa(calm.s.title, '이', '가')} 수익을 평균 ${Math.abs(calm.e.mean).toFixed(1)}%p 덜 얻는 대신 중간 최대 손실을 ${calm.r.mean.toFixed(1)}%p 줄였습니다.` : ''}`;
  return `<p class="lt-lead">${lead}</p>
    <div class="table-wrap"><table class="lt-table lt-edge"><thead><tr><th>방식</th><th>수익 차이 ${tip('이 상태에서 시작해 60거래일 동안 이 방식을 썼을 때 수익률 − 그냥 보유 수익률의 평균. 비용 0.2% 포함.')}</th><th>이긴 비율</th><th>최대 손실 차이 ${tip('보유 대비 중간 최대 손실이 몇 %p 작았는지(+면 손실이 작음). 현금을 오래 들고 있는 방식은 손실도 수익도 작아집니다.')}</th><th></th></tr></thead>
    <tbody>${rows.map(x => `<tr class="${x.s.id === rule ? 'pick' : ''}"><td>${esc(x.s.title)}${tip(`${x.s.how}\n맞는 때: ${x.s.when}`)}</td><td class="${tone(x.e.mean)}"><b>${pp(x.e.mean)}</b></td><td>${x.e.hit}%</td><td class="${x.r?.mean > 0 ? 'good' : ''}">${x.r ? pp(x.r.mean) : '—'}</td><td><button type="button" class="text-button" data-try="${x.s.id}">이 방식으로 시험</button></td></tr>`).join('')}</tbody></table></div>
    <p class="lt-muted">${esc(GROUPS[group])} · ${esc(stLabel(state))} 표본 ${st?.n ?? 0}개(종목 ${st?.symbols ?? 0}개) · 60거래일 · 비용 포함</p>`;
}
function distBar(f, base) {
  const lo = Math.min(f.p20, base?.mean ?? 0, -1), hi = Math.max(f.p80, base?.mean ?? 0, 1), X = v => (v - lo) / (hi - lo) * 100;
  return `<div class="lt-dist" aria-label="60거래일 뒤 지수 대비 분포"><div class="lt-dist-track"><span class="band" style="left:${X(f.p20).toFixed(1)}%;width:${(X(f.p80) - X(f.p20)).toFixed(1)}%"></span><i class="zero" style="left:${X(0).toFixed(1)}%"></i>${base ? `<i class="base" style="left:${X(base.mean).toFixed(1)}%"></i>` : ''}<i class="med" style="left:${X(f.median).toFixed(1)}%"></i></div>
    <div class="lt-dist-axis"><span>하위 20% ${pp(f.p20)}</span><span>상위 20% ${pp(f.p80)}</span></div></div>`;
}
function bindTry(box) {
  box.querySelectorAll('[data-try]').forEach(b => b.onclick = () => {
    const input = page.querySelector(`[name="lt-preset"][value="s:${b.dataset.try}"]`); if (!input) return;
    input.checked = true; syncPreset();
    if (selected || $('#lt-symbol').value.trim()) $('#lt-form').requestSubmit(); else { $('#lt-status').textContent = '종목을 고르면 바로 시험합니다.'; $('#lt-symbol').focus(); }
  });
}
let guideGroup = 'KR_STOCK', openState = null;
async function showGuide() {
  const id = ++sitRun, box = $('#lt-situation');
  let stats; try { stats = await statsFile(); } catch (e) { if (id === sitRun) box.innerHTML = `<div class="lt-card"><p class="lt-warn">상황 통계를 불러오지 못했습니다 (${esc(e.message)}).</p></div>`; return; }
  if (id !== sitRun) return;
  const base = stats.baseline[guideGroup]?.f60, wf = stats.walkForward?.groups?.[guideGroup];
  box.innerHTML = `<article class="lt-card lt-guide-card">
    <p class="lt-eyebrow">상황 공부 · 공개 시세 5년 · ${stats.symbolsUsed || 45}종목 ${tip(`같은 정의(${stats.version})로 계산한 결과입니다. 숫자는 60거래일 뒤 시장 지수 대비 초과 수익률입니다.\n${stats.notes.join('\n')}`)}</p>
    <h3 class="lt-verdict">상황마다 과거에 어떻게 됐나</h3>
    <div class="lt-seg lt-gseg" role="radiogroup">${Object.entries(GROUPS).map(([g, l]) => `<label><input type="radio" name="lt-g" value="${g}" ${g === guideGroup ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="table-wrap"><table class="lt-table lt-states"><thead><tr><th>상태</th><th>60일 뒤 지수 대비 ${tip('같은 상태가 나온 날 이후 60거래일 동안 종목 수익률 − 지수 수익률의 평균. 괄호는 평소(아무 날) 평균과의 차이입니다.')}</th><th>오른 비율</th><th>표본</th><th>나았던 방식</th></tr></thead><tbody>
    ${STATE_ORDER.map(st => { const v = stats.states[guideGroup]?.[st]; if (!v) return ''; const rule = stats.rule[guideGroup]?.[st]; return `<tr data-state="${st}" class="${openState === st ? 'open' : ''}" tabindex="0"><td><span class="lt-badge b-${st}">${esc(stLabel(st))}</span>${tip(STATES[st].rule)}</td><td><b class="${tone(v.f60.mean)}">${pp(v.f60.mean)}</b> <small class="lt-muted">(평소 대비 ${pp(v.f60.mean - (base?.mean ?? 0))})</small></td><td>${v.f60.hit}%</td><td>${v.n}</td><td>${rule && rule !== 'hold' ? esc(SIT.find(s => s.id === rule)?.title) : '그냥 보유'}</td></tr>${openState === st ? `<tr class="lt-open"><td colspan="5">${strategyTable(stats, guideGroup, st)}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>
    <p class="lt-muted">평소(아무 날) 평균 ${pp(base?.mean)} · 상태를 누르면 방식별 결과가 열립니다.${wf ? tip(`걷기식 점검: ${stats.walkForward.cutoff} 이전에 끝난 표본으로 규칙을 정하고 이후 ${wf.n}개 표본에 적용했습니다. 보유 대신 다른 방식을 고른 경우 ${wf.active}건${wf.activeEdge ? `, 평균 차이 ${pp(wf.activeEdge.mean)}` : ''}.`) : ''}</p>
    <div class="lt-concepts"><span>개념</span>${CONCEPTS.map(([t, d]) => `<em>${t}${tip(d)}</em>`).join('')}</div>
  </article>`;
  box.querySelectorAll('[name="lt-g"]').forEach(r => r.onchange = () => { guideGroup = r.value; openState = null; void showGuide(); });
  box.querySelectorAll('tr[data-state]').forEach(tr => { const toggle = () => { openState = openState === tr.dataset.state ? null : tr.dataset.state; void showGuide(); }; tr.onclick = e => { if (!e.target.closest('.tip')) toggle(); }; tr.onkeydown = e => { if (e.key === 'Enter') toggle(); }; });
  bindTry(box);
}
async function showSituation(stock) {
  const id = ++sitRun, box = $('#lt-situation');
  box.innerHTML = '<div class="lt-card"><div class="shimmer lt-skel"></div><div class="shimmer lt-skel short"></div></div>';
  try {
    const [data, stats] = await Promise.all([candlesFor(stock.symbol), statsFile()]), idx = await indexFor(data.index[0]).catch(() => null);
    if (id !== sitRun) return;
    const now = currentSituation(data.candles, idx?.candles || []), group = groupOf({ symbol: data.symbol, currency: data.currency, instrumentType: data.instrumentType });
    if (!now.available) { box.innerHTML = `<div class="lt-card"><p class="lt-warn">${esc(now.message || '상황을 판별하지 못했습니다.')}</p></div>`; return; }
    const v = stats.states[group]?.[now.state], base = stats.baseline[group]?.f60;
    box.innerHTML = `<article class="lt-card lt-sit">
      <p class="lt-eyebrow">${esc(stock.name)} · 지금 상황 · ${esc(now.date)} 종가 ${tip(`상태 정의(${now.version})\n${now.rule}\n\n정해진 규칙으로만 판단합니다. 뉴스·실적은 반영하지 않습니다.`)}</p>
      <div class="lt-sit-head"><span class="lt-badge big b-${now.state}">${esc(now.label)}</span><span class="lt-signs">${esc(now.signs.join(' · ') || '뚜렷한 신호 없음')}</span>${now.regimeLabel ? `<span class="lt-regime">${esc(data.index[1])} ${esc(now.regimeLabel)}${tip(REGIMES[now.regime].rule)}</span>` : ''}</div>
      ${v ? `<h4>같은 상태 이후 60거래일 ${tip(`${GROUPS[group]} 종목들에서 같은 상태가 나온 뒤 60거래일 동안의 지수 대비 수익률입니다. 막대는 하위 20%~상위 20% 범위, 검은 선은 중앙값, 회색 선은 평소(아무 날) 평균입니다.`)}</h4>
      <div class="lt-sit-stats"><div><span>지수 대비 평균</span><b class="${tone(v.f60.mean)}">${pp(v.f60.mean)}</b><small>평소 대비 ${pp(v.f60.mean - (base?.mean ?? 0))}</small></div><div><span>중앙값</span><b class="${tone(v.f60.median)}">${pp(v.f60.median)}</b><small>오른 비율 ${v.f60.hit}%</small></div><div><span>표본</span><b>${v.n}</b><small>${esc(GROUPS[group])} ${v.symbols}종목</small></div></div>
      ${distBar(v.f60, base)}
      <h4>이 상태에서 방식별 결과</h4>${strategyTable(stats, group, now.state)}` : `<p class="lt-muted">${esc(GROUPS[group])}의 이 상태 표본이 없습니다.</p>`}
      <button type="button" class="text-button lt-guide-link" data-guide>모든 상황 보기</button>
    </article>`;
    bindTry(box); box.querySelector('[data-guide]').onclick = () => { guideGroup = group; openState = now.state; void showGuide(); };
  } catch (e) { if (id === sitRun) box.innerHTML = `<div class="lt-card"><p class="lt-warn">${esc(e.message)}</p></div>`; }
}

// ── 결과 ─────────────────────────────────────────────────────
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
function regimeHtml(t) {
  const b = regimeBreakdown(t.curve, t.indexCandles);
  if (!b.available) return '';
  return `<h4>시장 국면별 ${tip(`${t.indexName}의 200일선 위치와 기울기로 날마다 국면을 나눴습니다.\n${Object.values(REGIMES).map(r => `${r.label}: ${r.rule}`).join('\n')}`)}</h4>
    <div class="table-wrap"><table class="lt-table"><thead><tr><th>국면</th><th>일수</th><th>이 방식</th><th>그냥 보유</th><th>차이</th></tr></thead><tbody>${b.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.days}일</td><td class="${tone(r.strategy)}">${pct(r.strategy)}</td><td class="${tone(r.hold)}">${pct(r.hold)}</td><td class="${tone(r.edge)}"><b>${pp(r.edge)}</b></td></tr>`).join('')}</tbody></table></div><p class="lt-muted">${esc(b.note)}</p>`;
}
function renderOne(t, s) {
  lastTest = { t, s };
  const r = t.result.summary, trades = t.result.trades.slice(-12).reverse(), def = t.definition || s.definition, universe = UNIVERSE_SIZE[t.group];
  $('#lt-result').innerHTML = `<article class="lt-card">
    <p class="lt-eyebrow">${esc(t.stock.name)} · ${esc(s.label)} · ${esc(r.startDate)} ~ ${esc(r.endDate)} ${tip(t.situation ? '1,000만원으로 시작해 첫날 종가에 들어가고, 이후 결정은 다음 거래일 시가에 체결한다고 가정했습니다. 거래 금액의 0.2%를 비용으로 뺐습니다. 과거 결과이며 앞으로도 같다는 보장은 없습니다.' : '1,000만원으로 시작해 신호 다음 날 시가에 사고판다고 가정했습니다. 수수료·슬리피지 각 0.1%. 과거 결과이며 앞으로도 같다는 보장은 없습니다.')}</p>
    <h3 class="lt-verdict ${tone(t.edge)}">${esc(t.verdict)}</h3>${t.note ? `<p class="lt-sub">${esc(t.note)}</p>` : ''}
    <div class="lt-tiles"><div class="main"><span>이 방식대로 했다면</span><b class="${tone(r.totalReturn)}">${pct(r.totalReturn)}</b><small>비용 포함 · 매매 ${r.tradeCount}번${r.positionOpen ? (t.situation ? ` · 지금 비중 ${r.finalWeight}%` : ' + 보유 중') : ''}</small></div>
      <div><span>그냥 들고 있었다면</span><b class="${tone(t.hold.return)}">${pct(t.hold.return)}</b><small>첫날 사서 끝까지</small></div>
      <div><span>${esc(t.indexName)}</span><b class="${tone(t.market)}">${pct(t.market)}</b><small>같은 기간 시장</small></div>
      <div><span>중간 최대 손실</span><b>${pct(r.maxDrawdown)}</b><small>들고 있기 ${pct(t.hold.maxDrawdown)}</small></div></div>
    <figure class="lt-chart">${curveSvg(t)}<figcaption><span><i class="strat"></i>이 방식</span><span><i class="hold"></i>그냥 보유</span><span><i class="dot buy"></i>산 날</span><span><i class="dot sell"></i>판 날</span><span class="lt-muted">시작=100 · ${t.situation ? '평균 주식 비중' : '주식을 들고 있던 기간'} ${t.inMarket}%</span></figcaption></figure>
    ${regimeHtml(t)}
    ${universe ? `<div class="lt-basket" id="lt-basket"><button type="button" class="secondary" id="lt-basket-run">${esc(GROUPS[t.group])} ${universe}종목에서도 확인</button>${tip('한 종목·한 기간에서 이긴 방식은 우연일 수 있습니다. 같은 종목군 전체에 같은 기간으로 적용해 몇 종목에서 나았는지 봅니다.')}</div>` : ''}
    <h4>이 방식의 규칙</h4><ul class="lt-rules"><li><b>살 때</b> ${esc(def.entryRule)}</li><li><b>팔 때</b> ${esc(def.exitRule)}</li><li><b>기타</b> ${esc(def.riskRule)}</li></ul>
    ${s.warnings?.length ? `<p class="lt-warn">${s.warnings.map(esc).join(' ')}</p>` : ''}
    <h4>실제로 사고판 날 ${trades.length ? `(최근 ${trades.length}건)` : ''}</h4>
    ${trades.length ? `<ol class="lt-trades">${trades.map(x => `<li><span class="${x.side === '매수' ? 'buy' : 'sell'}">${x.side}</span><b>${esc(x.date)}</b> ${x.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${x.pnl === null ? '' : ` · <em class="${tone(x.pnl)}">이번 거래 ${x.pnl > 0 ? '+' : ''}${Math.round(x.pnl).toLocaleString('ko-KR')}</em>`}<small>${esc(x.reason)}</small></li>`).join('')}</ol>` : '<p class="lt-muted">이 기간에는 사고판 날이 없습니다.</p>'}
  </article>`;
  $('#lt-basket-run')?.addEventListener('click', () => void runBasket(t, s));
}

async function runBasket(t, s) {
  const stats = await statsFile(), list = stats.universe[t.group] || [], box = $('#lt-basket'), id = run;
  box.innerHTML = `<p class="lt-muted">${esc(GROUPS[t.group])} ${list.length}종목 계산 중… <span id="lt-basket-n">0</span>/${list.length}</p>`;
  const rows = [], work = [...list]; let done = 0;
  const one = async symbol => { try { const r = await testOne({ symbol, name: stockName(symbol) }, s); rows.push({ name: stockName(symbol), edge: r.edge, ret: r.result.summary.totalReturn, hold: r.hold.return }); } catch { rows.push({ name: stockName(symbol), error: true }); } done++; const n = $('#lt-basket-n'); if (n) n.textContent = done; };
  await Promise.all(Array.from({ length: 4 }, async () => { while (work.length) await one(work.shift()); }));
  if (id !== run || lastTest?.t !== t) return;
  const ok = rows.filter(r => !r.error).sort((a, b) => b.edge - a.edge), better = ok.filter(r => r.edge >= 2).length, worse = ok.filter(r => r.edge <= -2).length;
  const med = ok.length ? ok.map(r => r.edge).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null, max = Math.max(1, ...ok.map(r => Math.abs(r.edge)));
  box.innerHTML = `<h4>${esc(GROUPS[t.group])} ${ok.length}종목에 같은 기간 적용</h4>
    <p class="lt-lead">${ok.length}종목 중 <b>${better}종목</b>에서 나았고 ${worse}종목에서는 그냥 보유가 나았습니다. 차이 중앙값 <b class="${tone(med)}">${pp(med)}</b>.</p>
    <div class="lt-basket-bars">${ok.map(r => `<div title="${esc(`${r.name}: 이 방식 ${pct(r.ret)} · 보유 ${pct(r.hold)}`)}"><span>${esc(r.name)}</span><span class="track"><i class="${tone(r.edge)}" style="--w:${(Math.abs(r.edge) / max * 50).toFixed(1)}%"></i></span><b class="${tone(r.edge)}">${pp(r.edge)}</b></div>`).join('')}</div>`;
}

function renderAll(rows, s) {
  const ok = rows.filter(r => !r.error), better = ok.filter(r => r.edge >= 2).length, worse = ok.filter(r => r.edge <= -2).length;
  $('#lt-result').innerHTML = `<article class="lt-card"><p class="lt-eyebrow">보유 종목 ${rows.length}개 · ${esc(s.label)} · 최근 ${s.months}개월</p>
    <h3 class="lt-verdict">${ok.length ? `${ok.length}종목 중 ${better}종목은 이 방식이 낫고, ${worse}종목은 그냥 들고 있는 편이 나았습니다.` : '계산한 종목이 없습니다.'}</h3>
    <div class="table-wrap"><table class="lt-table"><thead><tr><th>종목</th><th>이 방식</th><th>그냥 보유</th><th>차이</th><th>매매</th></tr></thead><tbody>${rows.map(r => r.error ? `<tr><td>${esc(r.stock.name)}</td><td colspan="4" class="lt-muted">${esc(r.error)}</td></tr>` : `<tr data-symbol="${esc(r.stock.symbol)}"><td><button type="button" class="text-button">${esc(r.stock.name)}</button></td><td class="${tone(r.result.summary.totalReturn)}">${pct(r.result.summary.totalReturn)}</td><td class="${tone(r.hold.return)}">${pct(r.hold.return)}</td><td class="${tone(r.edge)}"><b>${pp(r.edge)}</b></td><td>${r.result.summary.tradeCount}번</td></tr>`).join('')}</tbody></table></div>
    </article>`;
  $('#lt-result').querySelectorAll('tr[data-symbol] button').forEach(b => b.onclick = () => { const r = ok.find(x => x.stock.symbol === b.closest('tr').dataset.symbol); renderOne(r, s); });
}

async function start(job) {
  const id = ++run; $('#lt-run').disabled = true; $('#lt-compare').disabled = true; $('#lt-status').textContent = '과거 시세로 계산 중…';
  $('#lt-result').innerHTML = '<div class="lt-card"><div class="shimmer lt-skel"></div><div class="shimmer lt-skel short"></div></div>';
  try { await job(id); if (id === run) $('#lt-status').textContent = ''; }
  catch (e) { if (id === run) { $('#lt-status').textContent = e.message; $('#lt-result').innerHTML = `<div class="lt-card"><p class="lt-warn">${esc(e.message)}</p></div>`; } }
  finally { if (id === run) { $('#lt-run').disabled = false; $('#lt-compare').disabled = false; } }
}
function renderFit(stock, fit, extra, months) {
  if (!fit.available) throw new Error(fit.message);
  const rows = [...fit.rows.map(r => ({ title: r.title, ret: r.return, edge: r.edge, trades: r.trades, now: r.holding ? '매수 상태' : '관망' })), ...extra].sort((a, b) => b.edge - a.edge);
  const best = rows[0], fitsHold = best.edge < 2;
  $('#lt-result').innerHTML = `<article class="lt-card"><p class="lt-eyebrow">${esc(stock.name)} · 모든 방식 비교 · 최근 ${months}개월 ${tip(fit.caveat + ' 방식 하나를 골라 테스트하기를 누르면 사고판 날까지 볼 수 있습니다.')}</p>
    <h3 class="lt-verdict ${fitsHold ? 'flat' : 'up'}">${fitsHold ? '이 종목은 그냥 들고 있기가 가장 나았습니다.' : `"${esc(best.title)}"${josa(best.title, '이', '가')} 가장 잘 맞았습니다.`}</h3>
    <p class="lt-sub">${fitsHold ? '어떤 방식도 그냥 보유보다 2%p 이상 낫지 않았습니다. 타이밍보다 꾸준히 사서 보유하는 편이 맞았습니다.' : `그냥 보유보다 ${best.edge}%p 나았습니다. 지난 기간에 맞춘 결과라 같은 종목군에서도 확인하십시오.`}</p>
    <div class="table-wrap"><table class="lt-table"><thead><tr><th>방식</th><th>수익률</th><th>그냥 보유 대비</th><th>매매</th><th>지금 상태</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.title)}</td><td class="${tone(r.ret)}">${pct(r.ret)}</td><td class="${tone(r.edge)}"><b>${pp(r.edge)}</b></td><td>${r.trades}번</td><td>${esc(r.now)}</td></tr>`).join('')}<tr><td>그냥 들고 있기</td><td class="${tone(fit.best.hold)}">${pct(fit.best.hold)}</td><td>기준</td><td>—</td><td>보유</td></tr></tbody></table></div>
    </article>`;
}
$('#lt-compare').onclick = () => void start(async id => {
  const months = Number(page.querySelector('[name="lt-period"]:checked').value), stock = await chosenSymbol(), data = await candlesFor(stock.symbol), idx = await indexFor(data.index[0]).catch(() => null);
  const from = periodStart(today(), months), fit = findBestFit(data.candles, idx?.candles || [], from), extra = [];
  for (const s of SIT) { try { const t = runSituationTest(data.candles, idx?.candles || [], s.id, from); extra.push({ title: s.title, ret: t.result.summary.totalReturn, edge: t.edge, trades: t.result.summary.tradeCount, now: `비중 ${t.result.summary.finalWeight}%` }); } catch {} }
  if (id === run) renderFit(stock, fit, extra, months);
});
$('#lt-form').onsubmit = e => { e.preventDefault(); void start(async id => { const s = setup(), stock = await chosenSymbol(), t = await testOne(stock, s); if (id === run) renderOne(t, s); }); };
async function runAll() {
  await start(async id => { const s = setup(), rows = [];
    for (const h of holdings) { try { rows.push(await testOne(h, s)); } catch (e) { rows.push({ stock: h, error: e.message }); } if (id !== run) return; }
    renderAll(rows, s); });
}
void showGuide();
