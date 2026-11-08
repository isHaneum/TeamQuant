// 포트폴리오 화면(예전 "보유 종목·거래"): 무엇을 더 사고 무엇을 줄일지 정하는 곳.
// 왼쪽: 보유 종목 성적표(투자 지표 + 판단), 종목별로 맞았던 매매 방식. 오른쪽: 현금 기록(PC 저장), 자산 구성, 추천 방향.
// 예전 표·주문 이력·고급 도구는 지우지 않고 맨 아래 "원자료"에 접어 둔다.
import { fundamentals, candles, indexSeries, getStyle, setStyle } from '/lib/client-data.js';
import { scoreStock, STYLES } from '/lib/stock-score.js';
import { advisePortfolio, TARGETS } from '/lib/portfolio-advice.js';
import { findBestFit, periodStart } from '/lib/strategy-lab.js';
import { privateRead } from '/bridge-client.js';
import { tip } from '/tooltip-ui.js';

const $ = s => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : '—';
const won = v => { if (!Number.isFinite(v)) return '—'; const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e8 ? `${s}${(a / 1e8).toFixed(2)}억원` : a >= 1e4 ? `${s}${Math.round(a / 1e4).toLocaleString('ko-KR')}만원` : `${s}${Math.round(a).toLocaleString('ko-KR')}원`; };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const STANCE_CLASS = { buy: 's-buy', hold: 's-hold', trim: 's-trim', unknown: 's-unknown' };

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/lab.css?v=20261106g2'; document.head.append(css);

const root = document.createElement('section'); root.className = 'pf'; root.id = 'portfolio';
root.innerHTML = `
<div class="pf-empty" id="pf-empty" hidden><b>계좌 연결 전입니다.</b><span>연결하면 보유 종목을 채점하고 다음 방향을 제안합니다.</span><button type="button" class="primary" data-go-home>연결하러 가기</button><button type="button" class="secondary" data-demo-start>예시 자산으로 둘러보기</button></div>
<div class="hm-demo" id="pf-demo" hidden><b>예시 자산</b><span>실제 계좌가 아닙니다. 현금 기록도 저장하지 않습니다.</span><button type="button" class="text-button" data-demo-stop>예시 끄기</button></div>
<div class="pf-style"><span>투자 성향 ${tip(Object.values(STYLES).map(x => `${x.label}: ${x.desc}`).join('\n'))}</span><div class="lt-seg" role="radiogroup">${Object.entries(STYLES).map(([k, s]) => `<label><input type="radio" name="pf-style" value="${k}"><span>${s.label}</span></label>`).join('')}</div></div>
<div class="pf-grid">
  <div class="pf-main">
    <article class="pf-card"><header><h3>종목 성적표 <span id="pf-how-tip"></span></h3></header>
      <div class="table-wrap"><table class="pf-table"><thead><tr><th>종목</th><th>비중</th><th>내 수익</th><th>PER</th><th>ROE</th><th>배당</th><th>매출 성장</th><th>목표가까지</th><th>판단</th></tr></thead><tbody id="pf-rows"><tr><td colspan="9" class="pf-muted">계좌를 불러오면 채점합니다.</td></tr></tbody></table></div>
    </article>
    <article class="pf-card"><header><h3>종목별로 맞았던 매매 방식 ${tip('지난 1년, 4가지 사고파는 방식과 그냥 들고 있기를 종목마다 비교했습니다. 지난 결과에 맞춘 것이라 앞으로도 같다는 보장은 없습니다. 방식 하나를 자세히 보려면 전략 테스트를 쓰십시오.')}</h3></header>
      <div id="pf-fit"><p class="pf-muted">성적표가 준비되면 계산합니다.</p></div></article>
  </div>
  <aside class="pf-side">
    <article class="pf-card"><header><h3>현금 ${tip('증권사 예수금·CMA·투자용 통장 합계입니다. 이 PC의 사용자 데이터 폴더에만 기록이 쌓이고, 서버에는 저장하지 않습니다.')}</h3></header>
      <form id="pf-cash-form" class="pf-cash"><input id="pf-cash" inputmode="numeric" autocomplete="off" placeholder="금액 (원)" aria-label="현금 (원)"><input id="pf-cash-note" maxlength="60" placeholder="메모 (선택)" aria-label="메모"><button class="primary" type="submit">기록</button></form>
      <p id="pf-cash-state" class="pf-muted" role="status"></p><ol id="pf-cash-log" class="pf-cash-log"></ol></article>
    <article class="pf-card"><header><h3>자산 구성</h3></header><div id="pf-mix"><p class="pf-muted">계좌를 불러오면 표시합니다.</p></div></article>
    <article class="pf-card pf-advice"><header><h3>추천 방향 <span id="pf-advice-tip"></span></h3></header><div id="pf-advice"><p class="pf-muted">성적표와 현금 기록으로 제안합니다.</p></div></article>
  </aside>
</div>`;
const raw = document.createElement('details'); raw.className = 'pf-raw'; raw.innerHTML = '<summary>원자료 · 보유 내역 표 · 주문·체결 이력 · 고급 도구</summary>';

function mount() {
  const page = document.querySelector('#toss'), head = page?.querySelector(':scope > .page-head');
  if (!page || !head) return false;
  if (!root.isConnected) { head.after(root); head.querySelector('h1').textContent = '내 포트폴리오'; head.querySelector('p').textContent = '무엇을 더 사고 무엇을 줄일지 정합니다'; }
  for (const node of [...page.children]) if (![head, root, raw].includes(node) && node.id !== 'toss-status') raw.append(node);
  if (!raw.isConnected) page.append(raw);
  page.classList.add('pf-page');
  return true;
}
if (!mount()) { const w = new MutationObserver(() => { if (mount()) w.disconnect(); }); w.observe(document.body, { childList: true, subtree: true }); }
window.addEventListener('teamquant:page', () => { if (root.isConnected) mount(); });

let snapshot = null, epoch = 0, cash = null, funds = new Map(), briefs = new Map(), fits = new Map(), style = getStyle();
const valueKrw = (v, c) => c === 'KRW' ? v : snapshot?.fx?.midRate ? v * snapshot.fx.midRate : null;
function positions() {
  const list = (snapshot?.positions || []).map(p => ({ ...p, valueKrw: valueKrw(p.value, p.currency) }));
  const total = list.reduce((s, p) => s + (p.valueKrw || 0), 0);
  for (const p of list) p.weightPct = total ? (p.valueKrw || 0) / total * 100 : null;
  return list.sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0));
}
function judge(p) { const f = funds.get(p.symbol); return f && !f.error ? scoreStock(f, { style, price: p.price, brief: briefs.get(p.symbol), weightPct: p.weightPct, weightLimit: TARGETS[style].single }) : null; }

function renderStyle() {
  root.querySelectorAll('[name="pf-style"]').forEach(r => { r.checked = r.value === style; });
  const w = STYLES[style].w, names = { value: '가격 수준', quality: '돈 버는 힘', growth: '성장', dividend: '배당', stability: '재무 안정', target: '목표가', trend: '최근 흐름', news: '뉴스' };
  $('#pf-how-tip').innerHTML = tip(`가격 수준(PER), 돈 버는 힘(ROE), 성장, 배당, 재무 안정, 목표가, 최근 흐름, 뉴스 분위기를 좋음·보통·나쁨으로 매긴 뒤 성향별 가중치로 평균합니다.\n+0.3 이상 → 추가 매수 검토, −0.25 이하 → 비중 축소 검토, 그 사이 → 보유 유지.\n비중이 성향별 한도를 넘으면 "좋지만 비중이 큼".\n${STYLES[style].label} 가중치: ${Object.entries(w).map(([k, v]) => `${names[k]} ×${v}`).join(', ')}\n행을 누르면 종목 상세가 열립니다. 매수·매도 지시가 아닙니다.`);
}
root.querySelectorAll('[name="pf-style"]').forEach(r => r.onchange = () => setStyle(r.value));
window.addEventListener('teamquant:style', e => { style = e.detail; renderStyle(); renderAll(); });

function cell(v, fmt, good, bad) { if (!Number.isFinite(v)) return '<td class="pf-muted">—</td>'; return `<td class="${good(v) ? 'good' : bad(v) ? 'bad' : ''}">${fmt(v)}</td>`; }
function renderTable() {
  const list = positions();
  if (!list.length) { $('#pf-rows').innerHTML = '<tr><td colspan="9" class="pf-muted">보유 주식이 없습니다.</td></tr>'; return; }
  $('#pf-rows').innerHTML = list.map(p => {
    const f = funds.get(p.symbol), a = f?.annual || {}, j = judge(p), up = f?.targetPrice && p.price ? (f.targetPrice / p.price - 1) * 100 : null;
    const q = Number.isFinite(a.roe) ? a.roe : a.roa;
    return `<tr data-symbol="${esc(p.symbol)}" tabindex="0"><td><b>${esc(p.name)}</b><small>${esc(f?.sector || (f?.error ? '지표 없음' : '…'))}</small></td><td>${Number.isFinite(p.weightPct) ? p.weightPct.toFixed(0) + '%' : '—'}</td><td class="${tone(p.returnPct)}">${pct(p.returnPct)}</td>
      ${f?.isEtf ? '<td class="pf-muted">ETF</td>' : cell(f?.forwardPer > 0 ? f.forwardPer : f?.per, v => v.toFixed(1) + '배', v => v > 0 && v < 12, v => v > 40 || v <= 0)}
      ${cell(q, v => v.toFixed(1) + '%' + (Number.isFinite(a.roe) ? '' : '<small>ROA</small>'), v => v >= 15, v => v < 5)}
      ${cell(f?.dividendYield, v => v.toFixed(2) + '%', v => v >= 3, () => false)}
      ${cell(a.revenueGrowth, v => pct(v), v => v >= 15, v => v < 0)}
      ${cell(up, v => pct(v, 0), v => v >= 15, v => v < 0)}
      <td>${j ? `<span class="pf-stance ${STANCE_CLASS[j.stance]}">${esc(j.label)}</span><small>${esc(j.summary)}</small>` : f?.error ? '<span class="pf-stance s-unknown">지표 없음</span>' : '<span class="pf-muted">채점 중…</span>'}</td></tr>`;
  }).join('');
  $('#pf-rows').querySelectorAll('tr[data-symbol]').forEach(tr => { const open = () => window.dispatchEvent(new CustomEvent('teamquant:open-stock', { detail: { symbol: tr.dataset.symbol } })); tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); }; });
}
function renderFit() {
  const list = positions(); if (!list.length) return;
  const rows = list.map(p => [p, fits.get(p.symbol)]);
  if (rows.every(([, f]) => !f)) return;
  const hold = rows.filter(([, f]) => f?.available && f.fitsHold).length;
  $('#pf-fit').innerHTML = `<p class="pf-lead">${hold === rows.length ? '모든 종목에서 사고팔기보다 <b>그냥 들고 있기</b>가 나았습니다. 매매 타이밍보다 무엇을 얼마나 담을지(위 성적표)가 더 중요했습니다.' : `${rows.length}종목 중 ${hold}종목은 그냥 들고 있기가, ${rows.filter(([, f]) => f?.available && !f.fitsHold).length}종목은 특정 매매 방식이 나았습니다.`}</p>
  <div class="table-wrap"><table class="pf-table"><thead><tr><th>종목</th><th>가장 나았던 방식</th><th>그 방식</th><th>그냥 보유</th><th>지금 상태</th></tr></thead><tbody>${rows.map(([p, f]) => !f ? `<tr><td><b>${esc(p.name)}</b></td><td colspan="4" class="pf-muted">계산 중…</td></tr>` : !f.available ? `<tr><td><b>${esc(p.name)}</b></td><td colspan="4" class="pf-muted">${esc(f.message)}</td></tr>` :
    `<tr><td><b>${esc(p.name)}</b></td><td>${f.fitsHold ? '<b>그냥 보유·적립</b>' : esc(f.best.title)}</td><td class="${tone(f.best.return)}">${pct(f.best.return)}</td><td class="${tone(f.best.hold)}">${pct(f.best.hold)}</td><td>${f.fitsHold ? '계속 보유' : f.best.holding ? '<span class="up">매수 상태</span>' : '<span class="down">관망</span>'}</td></tr>`).join('')}</tbody></table></div>
  `;
}
function renderSide() {
  const list = positions(), holdings = list.map(p => { const f = funds.get(p.symbol), j = judge(p); return { name: p.name, valueKrw: p.valueKrw, sector: f?.sector || null, country: p.currency === 'KRW' ? '국내' : '해외', dividendYield: f?.dividendYield, stance: j?.stance }; });
  const a = advisePortfolio(holdings, { cash: cash?.latest ? cash.latest.amount : null, style });
  const parts = [['국내 주식', a.countries.find(c => c.label === '국내')?.value || 0, 'kr'], ['해외 주식', a.countries.find(c => c.label === '해외')?.value || 0, 'us'], ['현금', Number.isFinite(a.cash) ? a.cash : 0, 'cash']], total = parts.reduce((s, x) => s + x[1], 0);
  $('#pf-mix').innerHTML = `<p class="pf-total">${Number.isFinite(a.cash) ? '현금 포함 총자산' : '주식 평가액'} <b>${won(Number.isFinite(a.cash) ? a.total : a.stocks)}</b></p>
    <div class="pf-bar">${parts.filter(x => x[1] > 0).map(x => `<i class="${x[2]}" style="--w:${(x[1] / total * 100).toFixed(1)}%" title="${x[0]}"></i>`).join('')}</div>
    <ul class="pf-legend">${parts.map(x => `<li><i class="${x[2]}"></i>${x[0]}${x[2] === 'cash' && !Number.isFinite(a.cash) ? '<b>—</b><span>미기록</span>' : `<b>${total ? (x[1] / total * 100).toFixed(0) : 0}%</b><span>${won(x[1])}</span>`}</li>`).join('')}</ul>
    ${a.sectors.length ? `<h4>업종 (주식 기준)</h4><ul class="pf-sectors">${a.sectors.filter(s => Number.isFinite(s.pct)).slice(0, 6).map(s => `<li><span>${esc(s.label)}</span><i style="--w:${s.pct.toFixed(1)}%"></i><b>${s.pct.toFixed(0)}%</b></li>`).join('')}</ul>` : ''}`;
  $('#pf-advice-tip').innerHTML = tip(`${STYLES[style].label} 성향 기준: 현금 ${a.targets.cash[0]}~${a.targets.cash[1]}%, 한 종목 ${a.targets.single}% 이하, 한 업종 ${a.targets.sector}% 이하.`);
  $('#pf-advice').innerHTML = `<ol class="pf-actions">${a.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ol><ul class="pf-checks">${a.checks.map(c => `<li class="t-${tone(c.tone)}"><b>${esc(c.title)}</b>${tip(c.text)}</li>`).join('')}</ul>`;
}
function renderAll() { if (!snapshot) return; renderTable(); renderFit(); renderSide(); }

// 현금 기록 (PC 저장)
function renderCash() {
  if (!cash) return;
  const l = cash.latest;
  $('#pf-cash-state').textContent = l ? `마지막 기록 ${won(l.amount)} · ${new Date(l.recordedAt).toLocaleDateString('ko-KR')}${l.note ? ' · ' + l.note : ''}` : '아직 기록이 없습니다.';
  $('#pf-cash-log').innerHTML = cash.entries.slice(-5).reverse().map(e => `<li><span>${new Date(e.recordedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span><b>${won(e.amount)}</b><small>${esc(e.note || '')}</small></li>`).join('');
  window.dispatchEvent(new CustomEvent('teamquant:cash', { detail: l ? { amount: l.amount, recordedAt: l.recordedAt } : null }));
}
async function loadCash() { if (snapshot?.demo) { cash = { latest: { amount: snapshot.demoCash, note: '예시', recordedAt: new Date().toISOString() }, entries: [] }; renderCash(); renderSide(); return; } try { cash = await privateRead('cash-get'); renderCash(); renderSide(); } catch (e) { $('#pf-cash-state').textContent = `현금 기록을 불러오지 못했습니다: ${e.message}`; } }
$('#pf-cash').addEventListener('input', e => { const d = e.target.value.replace(/[^\d]/g, ''); e.target.value = d ? Number(d).toLocaleString('ko-KR') : ''; });
$('#pf-cash-form').onsubmit = async e => {
  e.preventDefault(); const amount = Number($('#pf-cash').value.replace(/[^\d]/g, ''));
  if (!$('#pf-cash').value.trim()) { $('#pf-cash-state').textContent = '금액을 적어 주십시오.'; return; }
  if (snapshot?.demo) { cash = { latest: { amount, note: '예시', recordedAt: new Date().toISOString() }, entries: [] }; renderCash(); renderSide(); return; }
  try { cash = await privateRead('cash-set', { amount, note: $('#pf-cash-note').value.trim() }); $('#pf-cash').value = ''; $('#pf-cash-note').value = ''; renderCash(); renderSide(); }
  catch (err) { $('#pf-cash-state').textContent = `저장하지 못했습니다: ${err.message}`; }
};

async function build() {
  const run = ++epoch, list = positions(); funds = new Map(); fits = new Map();
  renderAll(); void loadCash();
  for (let k = 0; k < list.length; k += 3) {
    await Promise.all(list.slice(k, k + 3).map(async p => { try { funds.set(p.symbol, await fundamentals(p.symbol)); } catch (e) { funds.set(p.symbol, { error: e.message }); } }));
    if (run !== epoch) return; renderTable(); renderSide();
  }
  const from = periodStart(today(), 12);
  for (const p of list) {
    try { const d = await candles(p.symbol, p.currency), idx = await indexSeries(d.index[0]).catch(() => null); fits.set(p.symbol, findBestFit(d.candles, idx?.candles || [], from)); }
    catch (e) { fits.set(p.symbol, { available: false, message: e.message }); }
    if (run !== epoch) return; renderFit();
  }
}
window.addEventListener('teamquant:asset-snapshot', e => { snapshot = e.detail; void build(); });
window.addEventListener('teamquant:brief', e => { briefs.set(e.detail.symbol, e.detail.brief); if (snapshot) { renderTable(); renderSide(); } });
window.addEventListener('teamquant:asset-clear', () => { epoch++; snapshot = null; funds = new Map(); briefs = new Map(); fits = new Map(); $('#pf-rows').innerHTML = '<tr><td colspan="9" class="pf-muted">화면의 자산 정보를 지웠습니다.</td></tr>'; $('#pf-fit').innerHTML = ''; $('#pf-mix').innerHTML = ''; $('#pf-advice').innerHTML = ''; });
renderStyle();
let connection = 'unknown';
function syncState() { $('#pf-empty').hidden = !(!snapshot && connection === 'error'); $('#pf-demo').hidden = !snapshot?.demo; root.classList.toggle('pf-state-empty', !snapshot && connection === 'error'); }
window.addEventListener('teamquant:connection', e => { connection = e.detail?.status || 'unknown'; syncState(); });
window.addEventListener('teamquant:asset-snapshot', syncState);
window.addEventListener('teamquant:asset-clear', () => { connection = 'error'; cash = null; syncState(); });
root.addEventListener('click', e => { if (e.target.closest('[data-go-home]')) document.querySelector('[data-workspace="home"]')?.click(); });
