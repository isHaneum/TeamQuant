// 모의투자 화면: 실제로 투자할 때 거치는 절차를 돈 없이 그대로 밟는다.
//   계획 비중 → (주 1회·급할 때) 오늘 점검 → 할 일마다 매매 전 확인 → 통과한 주문만 다음 거래일 시가 체결 → 날마다 평가 → 그냥 보유·지수와 비교.
// 계산은 모두 이 브라우저에서 한다(lib/paper-trading.js). 서버에는 종목 코드로 시세만 묻는다. 실제 주문은 없다.
// '오늘부터 모의투자 시작'은 시작일·자금·종목·규칙만 저장하고, 볼 때마다 시작일부터 오늘까지 같은 절차를 다시 재생한다(결정론적이라 장부를 따로 둘 필요가 없다).
import { rehearse, forwardRange, PAPER_VERSION } from '/lib/paper-trading.js';
import { normalizeRules, RULES_VERSION } from '/lib/core-rules.js';
import { candles as fetchCandles } from '/lib/client-data.js';
import { resolveStockInput, stockName, stockNames } from '/lib/instruments.js';
import { tip } from '/tooltip-ui.js';
import { attachStockSearch } from '/stock-search-ui.js';
import { fundamentals } from '/lib/client-data.js';
import { returnsFrom } from '/lib/sectors.js';
import { privateRead } from '/bridge-client.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const swon = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const pp = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%p` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = n => new Date(Date.now() - n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const session = () => sessionStorage.getItem('teamQuantSession') || 'guest';
const DEMO = [['005930', '삼성전자', 'KRW'], ['000660', 'SK하이닉스', 'KRW'], ['069500', 'KODEX 200', 'KRW'], ['NVDA', '엔비디아', 'USD'], ['KO', '코카콜라', 'USD'], ['035420', 'NAVER', 'KRW']].map(([symbol, name, currency]) => ({ symbol, name, currency }));
const CHECK_LABEL = { maxTrades30: '30일 매매 횟수', dailyLoss: '하루 손실 한도', volTarget: '계획 비중·200일선', minCash: '현금 최소 비중', maxSingle: '한 종목 최대 비중', cash: '현금 충분', noLeverage: '레버리지 금지', input: '입력값' };

const style = document.createElement('style'); style.textContent = `
#core-paper .cr-main,#core-paper .cr-side{grid-template-columns:minmax(0,1fr)}#core-paper .cr-card{overflow:hidden;min-width:0;max-width:100%}#core-paper .rp-tiles>div{min-width:0}#core-paper .rp-tiles b{overflow-wrap:anywhere}
.pp-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 14px;align-items:end}
.pp-scroll{overflow-x:auto;max-width:100%}
#pp-custom-wrap{margin-top:10px}
.pp-steps{margin:0;padding-left:22px;display:grid;gap:8px;font-size:14px;line-height:1.5}.pp-steps li small{display:block;color:var(--ck-sub);font-size:12.5px}
.pp-live{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.pp-live b{font-size:17px}
.pp-act{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:var(--ck-sub);margin:10px 0 4px}.pp-act b{color:var(--ck-ink)}
.pp-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.pp-chips button{font-size:12.5px;border:1px solid var(--ck-line);background:#fff;border-radius:999px;padding:3px 10px;cursor:pointer}.pp-chips button.on{border-color:var(--ck-ink);font-weight:700}
.pp-journal{width:100%;border-collapse:collapse;font-size:13px}.pp-journal td{padding:6px 8px;border-bottom:1px solid var(--ck-line);vertical-align:top;line-height:1.45}.pp-journal td:first-child{white-space:nowrap;color:var(--ck-sub);font-variant-numeric:tabular-nums}.pp-journal td:nth-child(2){white-space:nowrap;font-weight:600}
.pp-journal tr.차단 td:nth-child(2){color:var(--ck-bad)}.pp-journal tr.체결 td:nth-child(2){color:var(--ck-ok)}.pp-journal tr.손실 td:nth-child(2){color:var(--ck-bad)}
.pp-range{background:var(--ck-soft);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.6}.pp-range b{font-size:16px}
.pp-ref{width:100%;border-collapse:collapse;font-size:12.5px}.pp-ref th,.pp-ref td{padding:5px 6px;border-bottom:1px solid var(--ck-line);text-align:right;white-space:nowrap}.pp-ref th:first-child,.pp-ref td:first-child{text-align:left}.pp-ref th{color:var(--ck-sub);font-weight:600}
.rp-chart .l-bench{stroke:#c0821a;stroke-dasharray:2 3}
.pp-kis-sum{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--ck-sub);margin:0 0 10px}.pp-kis-sum b{color:var(--ck-ink)}.pp-kis-sum .on{color:var(--ck-bad);font-weight:700}
.pp-kis-items{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.pp-kis-items li{border:1px solid var(--ck-line);border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.5}.pp-kis-items li.ok{border-color:#abefc6;background:var(--ck-ok-bg)}.pp-kis-items li.bad{background:var(--ck-soft)}.pp-kis-items small{display:block;color:var(--ck-sub)}.pp-kis-items .st{font-weight:700}
.pp-kis-note{font-size:12.5px;color:var(--ck-sub);line-height:1.6;margin:8px 0 0}
#pp-kis-actions{flex-wrap:wrap}.pp-picked{margin-top:8px}.pp-picked button i{font-style:normal;margin-left:4px;opacity:.7}
.pp-badge{font-size:11px;font-weight:700;color:#7a4e0c;background:var(--ck-bad-bg);border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}#pp-kis-actions button{white-space:nowrap}
.pp-kis-plan{margin:10px 0}.pp-kis-plan>summary{cursor:pointer;font-size:13px;font-weight:600;color:#1849a8}.pp-kis-plan h4{margin:12px 0 6px}.pp-kis-plan .pp-ref td,.pp-kis-plan .pp-ref th{font-size:12px}.pp-kis-plan .up{color:var(--ck-up)}.pp-kis-plan .down{color:var(--ck-down)}
@media(max-width:760px){.pp-form{grid-template-columns:1fr}#core-paper .rp-tiles{grid-template-columns:1fr}.pp-live{display:grid}}`; document.head.append(style);

const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'paper'; nav.textContent = '모의투자'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'paper'; page.id = 'core-paper';
page.innerHTML = `<div class="page-head"><div><h1>모의투자 ${tip('실제로 투자할 때 거치는 절차를 돈 없이 그대로 밟습니다. 규칙 화면의 내 규칙으로 계획 비중을 정하고, 주 1회(급할 때는 바로) 오늘 점검이 낸 할 일을 매매 전 확인에 통과시킨 뒤, 통과한 주문만 다음 거래일 시가에 체결합니다(시가보다 0.1% 불리하게, 편도 비용 0.2%, 국내 주식은 1주 단위). 같은 기간 그냥 보유·지수와 비교합니다. 공개 일봉으로 계산하며 실제 주문은 없습니다. 실제 매매는 체결 지연·부분 체결·감정 때문에 이보다 나쁠 수 있고, 과거 결과가 앞으로를 보장하지 않습니다.')}</h1><p>점검 → 매매 전 확인 → 다음 거래일 시가 체결 → 날마다 평가 → 그냥 보유·지수와 비교</p></div></div>
<div class="cr-grid"><div class="cr-main">
<div class="cr-card" id="pp-setup"><header><h3>과거 데이터 시뮬 ${tip('공개 일봉으로 지난 기간을 다시 재생해 "그때 이 절차대로 했다면"을 계산합니다. 증권사 주문은 없고, 과거 자료라 좋아 보이게 만들기 쉽습니다. 실제 검증은 오른쪽 실시간 모의계좌의 기록입니다.')}</h3><span class="cr-muted" id="pp-rules"></span></header>
<div class="pp-form"><label class="ck-field unit"><span>시작 자금</span><input id="pp-capital" type="number" value="10000000" min="100000" step="100000" inputmode="numeric"><i>원</i></label>
<label class="ck-field"><span>종목</span><select id="pp-basket"><option value="demo">예시 6종목 (국내 4 · 미국 2)</option><option value="mine" disabled>내 보유 종목 (계좌 연결 또는 예시 자산 필요)</option><option value="custom">직접 입력</option></select></label>
<label class="ck-field"><span>기간</span><select id="pp-range"><option value="91">최근 3개월</option><option value="182" selected>최근 6개월</option><option value="365">최근 1년</option><option value="540">최근 18개월</option></select></label></div>
<div class="ck-field" id="pp-custom-wrap" hidden><span>종목 찾아 추가 (최대 12개)</span><input id="pp-custom" placeholder="이름·코드·티커 (예: 현대, 005380, NVDA)" autocomplete="off"><div class="cp-chips pp-picked" id="pp-picked"></div></div>
<div class="cr-actions"><button id="pp-run" class="primary">시뮬 실행</button><button id="pp-start" class="secondary">오늘부터 시뮬 기록(증권사 없이)</button><span id="pp-state" class="cr-err" role="status"></span></div></div>
<div class="cr-card" id="pp-live" hidden></div>
<div class="cr-card" id="pp-hyp"><header><h3>종목 가설 ${tip('종목을 고르는 유일한 방식입니다. 왜 이 종목인지(성장력·모멘텀 근거), 언제까지, 어떤 조건이면 틀린 것으로 볼지, 한도 몇 %인지를 적습니다. 등록하면 실시간 모의계좌의 기본 계획에 그 한도만큼 얹히고, 가설별 성적(진입가 대비 수익 vs 같은 기간 지수)이 쌓입니다. 맞은 것도 틀린 것도 지우지 않습니다.')}</h3><span class="cr-muted" id="pp-hyp-state"></span></header>
  <div id="pp-hyp-list" class="ph-list"><p class="cr-muted">PC 모의계좌에 연결되면 가설 목록이 보입니다.</p></div>
  <details id="pp-hyp-new" style="margin-top:12px"><summary class="cr-muted" style="cursor:pointer;font-weight:600">가설 추가</summary>
    <div class="pp-form" style="margin-top:10px"><label class="ck-field"><span>종목</span><input id="ph-sym" placeholder="이름·코드·티커" autocomplete="off"></label><label class="ck-field"><span>한도 (총자산 중)</span><select id="ph-cap"><option value="2">2%</option><option value="3" selected>3%</option><option value="5">5%</option></select></label><label class="ck-field"><span>기간</span><select id="ph-h"><option value="3">3개월</option><option value="6" selected>6개월</option><option value="12">12개월</option></select></label></div>
    <div id="ph-evidence" class="ph-ev"></div>
    <label class="ck-field" style="margin-top:8px"><span>가설 — 왜 이 종목인가</span><textarea id="ph-thesis" rows="3" placeholder="예: HBM 수요 증가로 2027-05까지 매출이 두 자릿수 성장하고 주가가 코스피200을 이긴다"></textarea></label>
    <label class="ck-field" style="margin-top:8px"><span>깨지는 조건 — 이러면 틀린 것으로 본다</span><input id="ph-break" placeholder="예: 분기 매출 성장이 10% 아래로 떨어지면"></label>
    <div class="cr-actions"><button type="button" class="primary" id="ph-add">가설 등록 → 모의계좌 계획에 반영</button><span class="cr-err" id="ph-err"></span></div>
  </details></div>
<div id="pp-result"></div>
</div><div class="cr-side"><article class="cr-card" id="pp-kis" hidden><header><h3>실시간 모의계좌 (한투) <span class="pp-badge">모의 · 실제 돈 아님</span> ${tip('이 PC 에 설정한 한국투자증권 모의투자 키로, 규칙 화면의 내 규칙·계획 비중에 따라 오늘 할 일을 정하고, 매매 전 확인과 주문 보호(1회·하루 한도, 호가 폭, 중복 방지)를 모두 통과한 주문만 모의계좌에 지정가로 보냅니다. 실전 계좌로는 보내지 않습니다. 장이 닫혔거나 시세·잔고를 못 읽으면 보류합니다. 장부는 PC 에만 남습니다.')}</h3><button type="button" class="text-button" id="pp-kis-refresh">새로고침</button></header><div id="pp-kis-body"><p class="cr-muted">PC 서버 연결을 확인하는 중…</p></div><div class="cr-actions" id="pp-kis-actions" hidden><button type="button" class="secondary" id="pp-kis-preview">오늘 할 일 미리보기</button><button type="button" class="primary" id="pp-kis-run" disabled>모의계좌에 주문 보내기</button><button type="button" class="text-button" id="pp-kis-kill">전체 정지</button><label class="cr-muted" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px"><input type="checkbox" id="pp-kis-rebal"> 재조정 ${tip('계획까지 맞추는 묶음 주문입니다. 오른 종목 두기 규칙을 끄고, 이 묶음은 30일 매매 횟수에 1회로 셉니다. 계획을 바꿨거나 처음 운용할 때 켭니다.')}</label></div><p class="cr-err" id="pp-kis-state" role="status"></p><div id="pp-kis-result"></div></article>
<div class="cr-card"><h3>절차</h3><ol class="pp-steps"><li>계획 비중<small>규칙의 한 종목 상한·현금 최소 비중 안에서 종목마다 균등</small></li><li>오늘 점검<small>주 마지막 거래일 종가(급할 때는 그날)에 규칙과 비교해 할 일을 냄</small></li><li>매매 전 확인<small>할 일마다 현금·비중·하루 손실 한도·매매 횟수를 확인, 하나라도 어기면 주문하지 않음</small></li><li>체결<small>다음 거래일 시가에 0.1% 불리하게, 편도 비용 0.2%, 국내 주식 1주 단위</small></li><li>평가와 비교<small>날마다 원화 환산, 같은 계획을 한 번 사서 둔 경우·지수와 비교</small></li></ol></div>
<div class="cr-card" id="pp-ref"><h3>같은 절차를 지난 기간에 돌렸다면 ${tip('scripts/paper-rehearsal.mjs가 공개 일봉으로 네 가지 포트폴리오·아홉 기간(최근 12개월·6개월·올해·2020~2025년 각각)에 같은 절차를 돌린 결과입니다. 2012~2019 자료로 고른 규칙을 그 뒤 기간에 적용한 것이지만, 규칙 자체는 2026-11-06에 확정했으므로 완전한 표본 외 검증은 오늘 이후의 모의투자부터입니다.')}</h3><div id="pp-ref-body"><p class="cr-muted">불러오는 중…</p></div></div>
</div></div>`;
document.querySelector('main').append(page);

// ── 상태 ─────────────────────────────────────────────────────
const S = { mine: [], run: 0, last: null, journalFilter: '전체', journalAll: false };
const liveKey = () => `teamQuantPaper:${session()}`;
function currentRules() { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return normalizeRules(v?.rules || {}).rules; } catch { return normalizeRules({}).rules; } }
function loadLive() { try { const v = JSON.parse(localStorage.getItem(liveKey()) || 'null'); return v?.startDate && Array.isArray(v.basket) ? v : null; } catch { return null; } }
function saveLive(v) { try { if (v) localStorage.setItem(liveKey(), JSON.stringify(v)); else localStorage.removeItem(liveKey()); } catch {} }
function rulesLine(r) { return `규칙 ${RULES_VERSION} · 한 종목 ${r.maxSingle}% · 현금 ${r.minCash}% · 하루 손실 ${r.dailyLoss}% · 30일 ${r.maxTrades30}회${r.trendUS ? ' · 미국 200일선' : ''}${r.perAssetVol ? ` · 종목 변동성 ${r.volTarget}%` : ''}`; }
$('#pp-rules').textContent = rulesLine(currentRules());

window.addEventListener('teamquant:asset-snapshot', e => { const ps = (e.detail?.positions || []).filter(p => p.symbol); S.mine = ps.map(p => ({ symbol: p.symbol, name: p.name || stockName(p.symbol), currency: p.currency || 'KRW' })); const o = $('#pp-basket option[value="mine"]'); o.disabled = !S.mine.length; o.textContent = S.mine.length ? `내 보유 종목 ${S.mine.length}개${e.detail?.demo ? ' (예시 자산)' : ''}` : '내 보유 종목 (계좌 연결 또는 예시 자산 필요)'; });
window.addEventListener('teamquant:asset-clear', () => { S.mine = []; const o = $('#pp-basket option[value="mine"]'); o.disabled = true; if ($('#pp-basket').value === 'mine') $('#pp-basket').value = 'demo'; });
$('#pp-basket').onchange = () => { $('#pp-custom-wrap').hidden = $('#pp-basket').value !== 'custom'; };
// 직접 입력: 공용 검색 제안으로 고르고 칩으로 쌓는다(쉼표 입력도 그대로 받는다)
S.custom = [];
function renderPicked() { const box = $('#pp-picked'); if (!box) return; box.innerHTML = S.custom.map(o => `<button type="button" class="on" data-rm="${esc(o.symbol)}" title="빼기">${esc(o.name)} <i aria-hidden="true">×</i></button>`).join('') || '<span class="cr-muted">아직 고른 종목이 없습니다.</span>'; box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.custom = S.custom.filter(o => o.symbol !== b.dataset.rm); renderPicked(); }); }
attachStockSearch($('#pp-custom'), { clearOnPick: true, exclude: () => new Set(S.custom.map(o => o.symbol)), onPick: o => { if (S.custom.length >= 12) { $('#pp-state').textContent = '종목은 12개까지입니다.'; return; } if (!S.custom.some(x => x.symbol === o.symbol)) S.custom.push(o); renderPicked(); } });
renderPicked();

async function basketOf() {
  const kind = $('#pp-basket').value;
  if (kind === 'demo') return DEMO;
  if (kind === 'mine') { if (!S.mine.length) throw new Error('보유 종목이 없습니다. 계좌를 연결하거나 예시 자산을 켜십시오.'); return S.mine.slice(0, 12); }
  if (S.custom.length && !$('#pp-custom').value.trim()) return S.custom.map(o => ({ symbol: o.symbol, name: o.name, currency: o.currency }));
  const parts = [...S.custom.map(o => o.symbol), ...$('#pp-custom').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)];
  if (!parts.length) throw new Error('종목을 하나 이상 골라 주십시오.');
  if (parts.length > 12) throw new Error('종목은 12개까지입니다.');
  const out = [];
  for (const p of parts) {
    // 이름·6자리 코드는 서버 조회 없이도 풀 수 있게 이름 사전으로 먼저 찾는다(시세 조회가 코스피→코스닥 순으로 시장을 정한다).
    const byName = /^\d{6}$/.test(p) ? p : Object.keys(stockNames).find(k => stockNames[k].replace(/\s/g, '').toLowerCase() === p.replace(/\s/g, '').toLowerCase());
    let symbol = byName || null;
    if (!symbol) { try { symbol = await resolveStockInput(p); } catch { if (/^[A-Z][A-Z.\-]{0,6}$/i.test(p)) symbol = p.toUpperCase(); else throw new Error(`'${p}'을(를) 찾지 못했습니다. 이름·6자리 코드·미국 티커로 입력하십시오.`); } }
    const code = symbol.split('.')[0], currency = /^\d{6}$/.test(code) ? 'KRW' : 'USD';
    if (!out.some(b => b.symbol === symbol)) out.push({ symbol, name: stockName(symbol) === symbol && currency === 'KRW' ? p : stockName(symbol), currency });
  }
  return out;
}
async function loadCandles(basket) {
  const out = {}, failed = [];
  await Promise.all(basket.map(async b => { try { out[b.symbol] = (await fetchCandles(b.symbol, b.currency, '2y')).candles; } catch (e) { failed.push(`${b.name}(${e.message})`); } }));
  return { candles: out, failed };
}

async function run({ live = null } = {}) {
  const id = ++S.run, state = $('#pp-state'), result = $('#pp-result'); state.textContent = '';
  try {
    const capital = live ? live.capitalKrw : Number($('#pp-capital').value);
    if (!(capital >= 100000)) throw new Error('시작 자금은 10만원 이상이어야 합니다.');
    const basket = live ? live.basket : await basketOf(), rules = live ? normalizeRules(live.rules || {}).rules : currentRules();
    const from = live ? live.startDate : daysAgo(Number($('#pp-range').value));
    result.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div><p class="cr-muted">시세를 받아 절차를 재생하는 중…</p></div>';
    const krw = basket.filter(b => b.currency === 'KRW').length, benchDef = krw * 2 >= basket.length ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW' } : { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' };
    const [{ candles, failed }, fx, bench] = await Promise.all([loadCandles(basket), fetchCandles('KRW=X', 'USD', '2y').then(d => d.candles).catch(() => []), fetchCandles(benchDef.symbol, benchDef.currency, '2y').then(d => d.candles).catch(() => null)]);
    if (id !== S.run) return;
    await new Promise(r => setTimeout(r, 0));
    const r = rehearse({ basket, capitalKrw: capital, rules, candlesBySymbol: candles, fxCandles: fx, from, to: today(), benchmark: bench ? { ...benchDef, candles: bench } : null, label: live ? '모의투자' : '리허설' });
    if (id !== S.run) return;
    if (!r.ok) { result.innerHTML = `<div class="cr-card"><p class="cr-muted">${esc(r.reason)}${live ? ' 시작일 다음 거래일부터 체결이 기록됩니다.' : ''}</p></div>`; return; }
    const fr = forwardRange({ positions: r.end.positions, cashKrw: r.end.cash, candlesBySymbol: candles, fxCandles: fx });
    S.last = { r, fr, failed, live: !!live }; S.journalFilter = '전체'; S.journalAll = false;
    render();
  } catch (e) { if (id === S.run) { state.textContent = e.message; result.innerHTML = ''; } }
}

function lineSvg(series, hasBench) {
  const W = 720, H = 220, L = 40, R = 10, T = 10, B = 24, keys = [['rule', '절차대로'], ['hold', '그냥 보유'], ...(hasBench ? [['bench', '지수']] : [])];
  const vals = series.flatMap(p => keys.map(([k]) => p[k])).filter(Number.isFinite), lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
  const X = i => L + i / Math.max(1, series.length - 1) * (W - L - R), Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  const path = k => series.map((p, i) => Number.isFinite(p[k]) ? `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}` : '').filter(Boolean).join(' ');
  return `<div class="rp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="절차대로·그냥 보유·지수(시작=100)">${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`).join('')}<line class="b" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${keys.map(([k]) => `<polyline class="l-${k === 'rule' ? 'actual' : k}" points="${path(k)}"/>`).join('')}<text x="${L}" y="${H - 6}">${series[0].date}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${series.at(-1).date}</text></svg>
  <div class="rp-legend">${keys.map(([k, l]) => `<span><i class="l-${k === 'rule' ? 'actual' : k}"></i>${l}</span>`).join('')}<span class="cr-muted">시작=100 · 원화</span></div></div>`;
}

function render() {
  const { r, fr, failed, live } = S.last, m = r.metrics, a = r.activity, body = $('#pp-result');
  const better = r.diff.vsHoldPct, mddBetter = r.diff.mddVsHoldPct;
  const verdict = `절차대로 <b class="${tone(m.rule.ret)}">${pct(m.rule.ret)}</b> · 그냥 보유 ${pct(m.hold.ret)}${m.bench ? ` · ${esc(r.benchmark.name)} ${pct(m.bench.ret)}` : ''}<br><span class="cr-muted">보유보다 수익률 ${pp(better)}, 최대 손실은 ${Math.abs(mddBetter) < 0.05 ? '같음' : mddBetter > 0 ? `${mddBetter.toFixed(1)}%p 작음` : `${(-mddBetter).toFixed(1)}%p 큼`}</span>`;
  const tile = (label, mm, me = false) => `<div class="${me ? 'me' : ''}"><span class="cr-muted">${label}</span><br><b>${won(mm.end)}</b><br><span class="${tone(mm.ret)}">${pct(mm.ret)}</span> · 최대 손실 ${pct(mm.mdd)}</div>`;
  const blocked = Object.entries(a.blocked).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${CHECK_LABEL[k] || k} ${v}건`).join(', ');
  const steps = ['전체', '점검', '주문', '체결', '차단', '미체결', '손실'];
  const rows = r.journal.filter(j => S.journalFilter === '전체' || j.step === S.journalFilter), shown = S.journalAll ? rows : rows.slice(0, 60);
  const holdRows = r.end.positions.filter(p => p.qty > 0).sort((x, y) => y.valueKrw - x.valueKrw).map(p => `<tr><td>${esc(p.name)}</td><td>${p.currency === 'USD' ? p.qty.toFixed(4) : p.qty.toLocaleString('ko-KR')}</td><td>${won(p.valueKrw)}</td><td>${p.weightPct.toFixed(1)}%</td><td class="${tone(p.pnlKrw)}">${swon(p.pnlKrw)}</td></tr>`).join('');
  body.innerHTML = `<div class="cr-card"><header><h3>${live ? '시뮬 기록(증권사 없이)' : '시뮬 결과'} <span class="cr-muted">${r.from} ~ ${r.to} · ${r.days}거래일</span></h3></header>
  <p class="rp-verdict">${verdict}</p>
  <div class="rp-tiles">${tile('절차대로', m.rule, true)}${tile('그냥 보유', m.hold)}${m.bench ? tile(esc(r.benchmark.name), m.bench) : '<div><span class="cr-muted">지수</span><br><b>—</b></div>'}</div>
  <div class="pp-act"><span>점검 <b>${a.decisionDays}</b>회${a.urgentDays ? ` (급한 날 ${a.urgentDays})` : ''}</span><span>체결 <b>${a.trades}</b>회</span><span>매매 전 확인에서 막힘 <b>${a.blockedTotal}</b>건${blocked ? ` <small>(${esc(blocked)})</small>` : ''}</span><span>1주 미만·현금 부족으로 못 산 주문 <b>${a.unfilled}</b>건</span><span>비용 <b>${won(a.feesKrw + a.slippageKrw)}</b> (자금의 ${a.costPct.toFixed(2)}%)</span><span>현금 평균 <b>${a.cashAvgPct.toFixed(0)}%</b></span><span>하루 ${r.rules.dailyLoss}% 넘게 잃은 날 <b>${a.breaches}</b>일 (${a.breachPct.toFixed(1)}%)</span></div>
  ${lineSvg(r.series, !!m.bench)}
  ${failed.length ? `<p class="cr-note">시세를 받지 못한 종목: ${esc(failed.join(', '))}</p>` : ''}${r.missing.length ? `<p class="cr-note">시세가 없어 뺀 종목: ${esc(r.missing.join(', '))}</p>` : ''}</div>
  <div class="cr-card"><header><h3>지금 장부 <span class="cr-muted">${r.to} 종가</span></h3><span class="cr-muted">총 ${won(r.end.total)} · 현금 ${won(r.end.cash)} (${(r.end.cash / r.end.total * 100).toFixed(0)}%)</span></header>
  ${holdRows ? `<div class="pp-scroll"><table class="cr-table"><thead><tr><th>종목</th><th>수량</th><th>평가액</th><th>비중</th><th>손익</th></tr></thead><tbody>${holdRows}</tbody></table></div>` : '<p class="cr-muted">보유 종목 없음(전부 현금)</p>'}
  <div class="pp-range" style="margin-top:12px">${fr.ok ? `앞으로 ${fr.horizon}거래일(약 3개월) 범위 ${tip('지금 보유 비중의 원화 일간 수익률(최근 2년)에 GARCH 변동성 모형을 맞추고 잔차를 다시 뽑아 2,000개 경로를 만든 뒤 5%·50%·95% 지점을 보여줍니다. 추세(평균)는 넣지 않으므로 오를지 내릴지의 예측이 아니라 흔들림의 크기입니다. 규칙에 따른 중간 매매는 반영하지 않습니다.')}<br><b>${swon(fr.p05Krw)} ~ ${swon(fr.p95Krw)}</b> <span class="cr-muted">(가운데 ${swon(fr.medianKrw)} · 10% 넘게 빠질 확률 ${(fr.probDown10 * 100).toFixed(0)}% · 투자 비중 ${fr.investedPct.toFixed(0)}% · 예측 변동성 연 ${(fr.annualVol * 100).toFixed(0)}%)</span>` : `<span class="cr-muted">앞으로 범위: ${esc(fr.reason)}</span>`}</div></div>
  <div class="cr-card"><header><h3>절차 기록 <span class="cr-muted">${r.journal.length}건</span></h3></header>
  <div class="pp-chips">${steps.map(s => `<button type="button" data-jf="${s}" class="${S.journalFilter === s ? 'on' : ''}">${s}${s === '전체' ? '' : ` ${r.journal.filter(j => j.step === s).length}`}</button>`).join('')}</div>
  <table class="pp-journal" style="table-layout:fixed;width:100%"><colgroup><col style="width:92px"><col style="width:58px"><col></colgroup><tbody>${shown.map(j => `<tr class="${esc(j.step)}"><td>${j.date}</td><td>${esc(j.step)}</td><td>${esc(j.text)}</td></tr>`).join('') || '<tr><td colspan="3" class="cr-muted">기록 없음</td></tr>'}</tbody></table>
  ${rows.length > shown.length ? `<div class="cr-actions"><button type="button" class="secondary" id="pp-more">나머지 ${rows.length - shown.length}건 더 보기</button></div>` : ''}
  <p class="cr-muted" style="margin-top:10px">공개 일봉으로 계산한 모의 결과이며 실제 주문·수익 보증이 아닙니다. 체결은 다음 거래일 시가에 ${(r.slippage * 100).toFixed(1)}% 불리하게, 편도 비용 ${(r.cost * 100).toFixed(1)}%로 가정했습니다. 실제 매매는 체결 지연·부분 체결·감정 때문에 이보다 나쁠 수 있습니다. 엔진 ${PAPER_VERSION}.</p></div>`;
  body.querySelectorAll('[data-jf]').forEach(b => b.onclick = () => { S.journalFilter = b.dataset.jf; S.journalAll = false; render(); });
  const more = $('#pp-more'); if (more) more.onclick = () => { S.journalAll = true; render(); };
}

// ── 오늘부터 모의투자 ─────────────────────────────────────────
function renderLive() {
  const live = loadLive(), card = $('#pp-live'); card.hidden = !live; $('#pp-start').textContent = live ? '새 모의투자로 바꾸기' : '오늘부터 모의투자 시작';
  if (!live) return;
  card.innerHTML = `<div class="pp-live"><div><b>모의투자 진행 중</b><br><span class="cr-muted">시작 ${live.startDate} · 자금 ${won(live.capitalKrw)} · 종목 ${live.basket.length}개 (${esc(live.basket.map(b => b.name).join(', '))})<br>${esc(rulesLine(normalizeRules(live.rules || {}).rules))} — 시작할 때의 규칙으로 고정</span></div><div class="cr-actions"><button type="button" class="primary" id="pp-live-run">오늘까지 다시 계산</button><button type="button" class="secondary" id="pp-live-stop">끝내기</button></div></div>`;
  $('#pp-live-run').onclick = () => void run({ live });
  $('#pp-live-stop').onclick = () => { saveLive(null); S.last = null; $('#pp-result').innerHTML = ''; renderLive(); $('#pp-state').textContent = '모의투자를 끝냈습니다. 기록은 이 브라우저에서 지워졌습니다.'; };
}
$('#pp-run').onclick = () => void run();
$('#pp-start').onclick = async () => {
  try {
    const capital = Number($('#pp-capital').value); if (!(capital >= 100000)) throw new Error('시작 자금은 10만원 이상이어야 합니다.');
    const basket = await basketOf();
    if (loadLive() && !confirm('진행 중인 모의투자를 지우고 오늘부터 새로 시작합니다. 계속하시겠습니까?')) return;
    const live = { version: PAPER_VERSION, startDate: today(), startedAt: new Date().toISOString(), capitalKrw: capital, basket, rules: currentRules() };
    saveLive(live); renderLive(); void run({ live });
    $('#pp-state').textContent = `${live.startDate}부터 시작. 볼 때마다 시작일부터 오늘까지 같은 절차를 다시 재생합니다.`;
  } catch (e) { $('#pp-state').textContent = e.message; }
};
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page !== 'paper') return; $('#pp-rules').textContent = rulesLine(currentRules()); renderLive(); const live = loadLive(); if (live && !S.last) void run({ live }); });
window.addEventListener('teamquant:state', () => { S.last = null; renderLive(); });
renderLive();

// ── 참고: 같은 절차를 지난 기간에 돌렸다면 ───────────────────
(async () => {
  const el = $('#pp-ref-body');
  try {
    const d = await (await fetch('/data/paper-rehearsal.json')).json(), s = d.summary, p = d.portfolios.demo, ws = d.windows;
    const row = w => { const x = p.windows[w.id]; if (!x?.ok) return ''; return `<tr><td>${esc(w.label)}</td><td class="${tone(x.metrics.rule.ret)}">${pct(x.metrics.rule.ret)}</td><td>${pct(x.metrics.hold.ret)}</td><td>${x.metrics.bench ? pct(x.metrics.bench.ret) : '—'}</td><td>${pct(x.metrics.rule.mdd, 0)} / ${pct(x.metrics.hold.mdd, 0)}</td></tr>`; };
    el.innerHTML = `<p class="cr-muted">네 포트폴리오 × 아홉 기간(${s.cells}칸), 자금 ${won(d.capitalKrw)}, ${d.generatedAt.slice(0, 10)} 계산.</p>
    <ul class="ct-actions" style="margin:6px 0 10px"><li>수익률은 그냥 보유보다 중앙값 <b>${pp(s.medianRetDiffVsHoldPct)}</b> (보유를 이긴 칸 ${(s.shareBetterRetThanHold * 100).toFixed(0)}%)</li><li>최대 손실은 중앙값 <b>${s.medianMddDiffVsHoldPct.toFixed(1)}%p</b> 작음 (더 작은 칸 ${(s.shareSmallerMddThanHold * 100).toFixed(0)}%)</li><li>지수보다 ${pp(s.medianRetDiffVsBenchPct)} · 비용 자금의 ${s.medianCostPct.toFixed(2)}% · 매매 연 ${s.medianTradesPerYear.toFixed(0)}회 · 현금 평균 ${s.medianCashAvgPct.toFixed(0)}%</li></ul>
    <p class="cr-muted" style="margin:0 0 6px">${esc(p.label)} (지수 ${esc(p.benchmark.name)})</p><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>기간</th><th>절차</th><th>보유</th><th>지수</th><th>최대 손실 절차/보유</th></tr></thead><tbody>${ws.map(row).join('')}</tbody></table></div>`;
  } catch { el.innerHTML = '<p class="cr-muted">참고 자료를 불러오지 못했습니다.</p>'; }
})();

// ── 한투 모의계좌(PC 서버의 paper-live) ──────────────────────
// 이 PC 서버에 모의투자 키가 있을 때만 카드가 보인다. 미리보기는 보내지 않고, 보내기는 두 번 눌러야 나간다(대화상자 없이).
const K = { status: null, preview: null, armed: false };
function savedPlan() { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return v?.plan && Object.keys(v.plan).length ? v.plan : null; } catch { return null; } }
const KR_EXAMPLE_PLAN = { '005930': { pct: 20, name: '삼성전자' }, '000660': { pct: 20, name: 'SK하이닉스' }, '069500': { pct: 20, name: 'KODEX 200' }, '035420': { pct: 20, name: 'NAVER' } };
let PLAN_DOC = null; // data/paper-plan.json (근거·검증 포함)
async function loadPlanDoc() { if (PLAN_DOC !== null) return PLAN_DOC; try { const r = await fetch('/data/paper-plan.json'); PLAN_DOC = r.ok ? await r.json() : false; } catch { PLAN_DOC = false; } return PLAN_DOC; }
function planForKis() { const p = savedPlan(); if (p) return { plan: p, label: '규칙 화면의 내 계획', source: 'saved' }; if (PLAN_DOC) return { plan: null, label: `검증된 기본 계획 ${PLAN_DOC.version} (${Object.keys(PLAN_DOC.weights).length}종목 · 현금 ${PLAN_DOC.cashPct}%)`, source: 'default' }; return { plan: KR_EXAMPLE_PLAN, label: '예시 계획(국내 4종목 각 20%)', source: 'example' }; }
function planDocHtml(d) { if (!d) return ''; const w = Object.values(d.weights).sort((a, b) => b.pct - a.pct), v = d.validation || {}, wins = (v.windows || []).filter(x => x.ok), sc = v.scenarios || [];
  const row = x => `<tr><td>${esc(x.label)}</td><td class="${x.plan.rule.ret >= 0 ? 'up' : 'down'}">${x.plan.rule.ret > 0 ? '+' : ''}${x.plan.rule.ret}%</td><td>${x.plan.rule.mdd}%</td><td>${x.plan.hold.ret > 0 ? '+' : ''}${x.plan.hold.ret}%</td><td>${x.kodex200 ? (x.kodex200.ret > 0 ? '+' : '') + x.kodex200.ret + '%' : '—'}</td><td>${x.spy ? (x.spy.ret > 0 ? '+' : '') + x.spy.ret + '%' : '—'}</td></tr>`;
  return `<details class="pp-kis-plan"><summary>계획 근거와 검증 보기 (${esc(d.version)} · ${esc(d.asOf)})</summary>
  <h4>방법</h4><ul class="pp-steps">${(d.method || []).map(m => `<li>${esc(m)}</li>`).join('')}</ul>
  <h4>비중</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>비중</th><th>섹터</th><th>변동성(연)</th><th>이유 · 노출</th></tr></thead><tbody>${w.map(x => `<tr><td>${esc(x.name)}<br><small class="cr-muted">${esc(x.currency)} · ${esc(x.country)}</small></td><td>${x.pct}%</td><td>${esc(x.sectorName)}</td><td>${x.vol1y}%</td><td style="white-space:normal;text-align:left;min-width:260px"><small>${(x.why || []).map(esc).join(' · ')}${x.exposure?.length ? '<br>노출: ' + x.exposure.map(esc).join(' / ') : ''}</small></td></tr>`).join('')}<tr><td>현금</td><td>${d.cashPct}%</td><td colspan="3"></td></tr></tbody></table></div>
  <h4>같은 규칙으로 과거에 돌렸다면 ${tip('이 계획을 규칙 C3 대로 운용했을 때(주 1회 점검·매매 전 확인·다음 시가 체결·비용 포함)의 수익률과 최대 손실. 그냥 보유는 같은 비중을 한 번 사서 둔 경우. 2020~2025는 규칙 확정 이전 구간이라 완전한 표본 외가 아닙니다. 상승장에서 보유보다 낮은 것은 이 규칙의 알려진 비용입니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>기간</th><th>계획(규칙)</th><th>최대 손실</th><th>계획(보유)</th><th>KODEX 200</th><th>S&P500</th></tr></thead><tbody>${wins.map(row).join('')}</tbody></table></div>
  <h4>충격 시나리오 ${tip('섹터·통화별 충격을 비중에 곱한 즉시 손실(%)입니다. 과거 비슷한 크기: 2022 반도체 −35~−45%, 2020-03 코스피 −35%, 2022 S&P −25%, 2022 장기채 −31%. 예측이 아니라 노출의 크기입니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>시나리오</th><th>이 계획</th><th>균등 비중</th><th>코스피200만</th><th>지금 모의계좌</th></tr></thead><tbody>${sc.map(x => `<tr><td>${esc(x.name)}</td><td class="down">${x.planPct}%</td><td>${x.equalPct}%</td><td>${x.kodexOnlyPct}%</td><td>${x.currentPct}%</td></tr>`).join('')}</tbody></table></div>
  <p class="cr-muted">${esc(v.note || '')}</p></details>`; }
function kisSummary(s) { const b = s.balance; return `<div class="pp-kis-sum"><span>계좌 <b>${esc(s.account || '—')}</b></span><span>장 <b>${s.market?.open ? '열림' : '닫힘'}</b>${s.market?.open ? '' : ` <span class="cr-muted">(${esc(s.market?.reason || '')})</span>`}</span>${b ? `<span>예수금 <b>${won(b.cash)}</b></span><span>평가 <b>${won(b.total)}</b></span><span>보유 <b>${b.positions.length}종목</b></span>` : ''}<span>킬 스위치 <b class="${s.killSwitch ? 'on' : ''}">${s.killSwitch ? '켜짐' : '꺼짐'}</b></span><span>한도 1회 <b>${won(s.limits?.maxOrderKrw)}</b> · 하루 <b>${won(s.limits?.maxDailyKrw)}</b></span></div>`; }
function kisOrdersTable(list, title) { if (!list?.length) return ''; return `<h4>${esc(title)}</h4><div class="pp-scroll"><table class="pp-journal"><tbody>${list.slice().reverse().map(o => `<tr class="${o.status === 'filled' ? '체결' : /rejected|not_found/.test(o.status) ? '차단' : ''}"><td>${esc(String(o.at).slice(11, 19))}</td><td>${o.side === 'BUY' ? '매수' : '매도'}</td><td>${esc(o.name)} ${o.qty}주 @${o.currency === 'USD' ? '$' + Number(o.price).toFixed(2) : won(o.price)}${o.filledQty ? ` · 체결 ${o.filledQty}주` : ''}<br><small class="cr-muted">${esc(o.status)}${o.odno ? ' #' + esc(o.odno) : ''}${o.error ? ' · ' + esc(o.error) : ''}${o.note ? ' · ' + esc(o.note) : ''}</small></td></tr>`).join('')}</tbody></table></div>`; }
function kisItems(r) { const lab = r.planSource === 'default' && PLAN_DOC ? `검증된 기본 계획 ${PLAN_DOC.version}` : planForKis().label; return `<p class="pp-kis-note">${esc(String(r.at).slice(0, 16).replace('T', ' '))} 기준 · 계획: ${esc(lab)} · 규칙 ${r.evaluation.okCount}/${r.evaluation.known} 충족 · 할 일 ${r.items.length}건${r.skipped?.length ? ` · 해외 종목은 뺌(${esc(r.skipped.join(', '))})` : ''}${r.noData?.length ? ` · 시세 부족: ${esc(r.noData.join(', '))}` : ''}</p>${r.items.length ? `<ul class="pp-kis-items">${r.items.map(i => `<li class="${i.ok ? 'ok' : 'bad'}"><span class="st">${i.ok ? '통과' : '차단'}</span> · ${esc(i.name)} ${i.side === 'BUY' ? '매수' : '매도'} ${i.qty ?? '—'}주 @${i.currency === 'USD' ? '$' + (i.price ?? 0).toFixed(2) : won(i.price)} = ${won(i.amountKrw)}<small>${esc(i.why)}</small>${i.blocks.length ? `<small>${i.blocks.map(esc).join(' · ')}</small>` : ''}${i.warnings?.length ? `<small>! ${i.warnings.map(esc).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : '<p class="cr-muted">오늘은 규칙상 할 일이 없습니다.</p>'}${r.sent?.length ? kisOrdersTable(r.sent, '방금 보낸 주문') : ''}`; }
async function kisRefresh() {
  const card = $('#pp-kis'), body = $('#pp-kis-body'); if (!card) return;
  try { const s = await privateRead('paper-live-status'); if (s.planDoc) PLAN_DOC = s.planDoc; else await loadPlanDoc(); K.status = s; card.hidden = false; $('#pp-kis-actions').hidden = false; const pl = planForKis(); const m0 = s.marks?.[0], m1 = s.marks?.at(-1); const prog = m0 && m1 && s.marks.length > 1 ? `<p class="pp-kis-note">운용 ${s.marks.length}일 · 시작 ${won(m0.total)} → 지금 ${won(m1.total)} (${pct(m1.total / m0.total - 1)})</p>` : ''; body.innerHTML = kisSummary(s) + (s.error ? `<p class="cr-err">${esc(s.error)}</p>` : '') + `<p class="pp-kis-note">계획: ${esc(pl.label)}${s.markets?.US ? ` · 미국 장 ${s.markets.US.open ? '열림' : '닫힘'}` : ''}</p>` + prog + planDocHtml(pl.source === 'default' ? PLAN_DOC : null) + kisOrdersTable(s.ordersToday, '오늘 주문'); $('#pp-kis-kill').textContent = s.killSwitch ? '정지 해제' : '전체 정지'; renderHyp(s.hypotheses || []); }
  catch (e) { if (e?.status === 503) { card.hidden = false; $('#pp-kis-actions').hidden = true; body.innerHTML = `<p class="cr-muted">${esc(e.message || '이 PC 에 모의투자 키가 없습니다.')}</p>`; } else card.hidden = true; renderHyp(null); }
}
async function kisPreview() { const st = $('#pp-kis-state'); st.textContent = '잔고·시세를 읽고 할 일을 정하는 중…'; K.armed = false; $('#pp-kis-run').textContent = '모의계좌에 주문 보내기'; try { const { plan } = planForKis(); const r = await privateRead('paper-live-preview', { rules: currentRules(), rebalance: $('#pp-kis-rebal')?.checked === true, ...(plan ? { plan } : {}) }); K.preview = r; $('#pp-kis-result').innerHTML = kisItems(r); const n = r.items.filter(i => i.ok).length; $('#pp-kis-run').disabled = n === 0; st.textContent = n ? `통과 ${n}건. "모의계좌에 주문 보내기"를 두 번 누르면 보냅니다.` : (r.items.length ? '통과한 주문이 없어 보낼 것이 없습니다.' : ''); } catch (e) { st.textContent = e?.message || '미리보기에 실패했습니다.'; } }
async function kisRun() { const st = $('#pp-kis-state'), btn = $('#pp-kis-run'); if (!K.preview) return; if (!K.armed) { K.armed = true; btn.textContent = `정말 보내기 (${K.preview.items.filter(i => i.ok).length}건)`; st.textContent = '한 번 더 누르면 모의계좌에 지정가 주문이 나갑니다. 실전 계좌가 아닙니다.'; return; } K.armed = false; btn.disabled = true; btn.textContent = '보내는 중…'; try { const { plan } = planForKis(); const r = await privateRead('paper-live-run', { rules: currentRules(), rebalance: $('#pp-kis-rebal')?.checked === true, ...(plan ? { plan } : {}) }); K.preview = null; $('#pp-kis-result').innerHTML = kisItems(r); st.textContent = `보냄 ${r.sent.filter(o => o.status === 'sent').length}건 · 거부 ${r.sent.filter(o => o.status === 'rejected').length}건 · 미확인 ${r.sent.filter(o => o.status === 'unknown').length}건${r.note ? ' · ' + r.note : ''}`; await kisRefresh(); } catch (e) { st.textContent = e?.message || '주문에 실패했습니다.'; } finally { btn.textContent = '모의계좌에 주문 보내기'; } }
async function kisKill() { const st = $('#pp-kis-state'); try { const on = !K.status?.killSwitch; const r = await privateRead('paper-live-kill', { on }); st.textContent = on ? `전체 정지. 열린 주문 ${r.cancelled.length}건 취소 요청.` : '정지를 해제했습니다.'; await kisRefresh(); } catch (e) { st.textContent = e?.message || '처리하지 못했습니다.'; } }
$('#pp-kis-refresh').onclick = kisRefresh; $('#pp-kis-preview').onclick = kisPreview; $('#pp-kis-run').onclick = kisRun; $('#pp-kis-kill').onclick = kisKill;
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'paper') void kisRefresh(); });

// ── 종목 가설 ──
let phPick = null, phEvidence = [];
async function phFill(o) {
  const box = $('#ph-evidence'); box.textContent = '근거 자료를 불러오는 중…'; phEvidence = [];
  const [f, d] = await Promise.all([fundamentals(o.symbol).catch(() => null), fetchCandles(o.symbol, o.currency, '2y').catch(() => null)]);
  const ev = [];
  if (f && !f.error) { if (f.sector) ev.push(`업종 ${f.sector}`); const a = f.annual || {}; if (Number.isFinite(a.revenueGrowth)) ev.push(`매출 성장 ${a.revenueGrowth > 0 ? '+' : ''}${a.revenueGrowth.toFixed(1)}% (${a.year || '최근'})`); if (Number.isFinite(a.operatingIncomeGrowth)) ev.push(`영업이익 ${a.operatingIncomeGrowth > 0 ? '+' : ''}${a.operatingIncomeGrowth.toFixed(1)}%`); if (Number.isFinite(a.roe)) ev.push(`ROE ${a.roe.toFixed(1)}%`); const pe = f.forwardPer > 0 ? f.forwardPer : f.per; if (pe > 0) ev.push(`PER ${pe.toFixed(1)}배`); }
  if (d?.candles?.length > 30) { const r = returnsFrom(d.candles.map(c => ({ date: c.date, close: c.close }))); if (r) { ev.push(`수익률 1개월 ${pct(r.m1)} · 3개월 ${pct(r.m3)} · 1년 ${r.y1 === null ? '—' : pct(r.y1)}`); ev.push(`1년 고점 대비 ${pct(r.offHigh)}`); const c = d.candles.filter(x => x.close > 0); if (c.length >= 200) { const ma = c.slice(-200).reduce((a, x) => a + x.close, 0) / 200; ev.push(`200일선 ${c.at(-1).close > ma ? '위' : '아래'}`); } } }
  phEvidence = ev; box.innerHTML = ev.length ? `근거 자료(자동): ${ev.map(esc).join(' · ')}` : '근거 자료를 받지 못했습니다. 직접 적어 주십시오.';
  if (!$('#ph-thesis').value.trim() && ev.length) $('#ph-thesis').value = `${o.name}: ${ev.slice(0, 3).join(', ')}. 이 흐름이 이어진다고 본다. (근거를 고쳐 쓰십시오)`;
}
attachStockSearch($('#ph-sym'), { onPick: o => { phPick = o; void phFill(o); } });
function phStatusLabel(h) { return h.status === 'open' ? (h.expired ? '기한 지남 · 종료 필요' : '진행 중') : h.status === 'broken' ? '깨짐' : h.verdict === 'right' ? '종료 · 맞음' : h.verdict === 'wrong' ? '종료 · 틀림' : '종료'; }
function renderHyp(list) {
  const box = $('#pp-hyp-list'); if (!box) return; if (!list) { box.innerHTML = '<p class="cr-muted">PC 모의계좌에 연결되면 가설 목록이 보입니다.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="cr-muted">등록된 가설이 없습니다. 지금 모의계좌는 기본 계획(지수·채권·섹터 대표주)만 들고 있습니다.</p>'; return; }
  box.innerHTML = [...list].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.openedAt.localeCompare(a.openedAt)).map(h => `<div class="ph-item"><header><b>${esc(h.name)} <small class="cr-muted">${esc(h.symbol)} · 한도 ${h.capPct}% · ${h.horizonMonths}개월</small></b><span class="st ${h.status}">${esc(phStatusLabel(h))}</span></header>
    <div class="num">${h.returnPct !== null && h.returnPct !== undefined ? `진입 대비 <b class="${h.returnPct > 0 ? 'up' : h.returnPct < 0 ? 'down' : ''}">${pct(h.returnPct)}</b>` : '아직 체결 없음'}${h.indexPct !== null && h.indexPct !== undefined ? ` · 같은 기간 지수 ${pct(h.indexPct)}` : ''}${h.excessPct !== null && h.excessPct !== undefined ? ` · 지수 대비 <b>${pp(h.excessPct * 100)}</b>` : ''} · ${h.daysOpen}일째</div>
    <p>${esc(h.thesis)}</p>${h.breakIf ? `<p class="cr-muted">깨지는 조건: ${esc(h.breakIf)}</p>` : ''}${h.evidence?.length ? `<p class="cr-muted">등록 때 근거: ${h.evidence.map(esc).join(' · ')}</p>` : ''}${h.closeNote ? `<p class="cr-muted">마감 메모: ${esc(h.closeNote)}</p>` : ''}
    ${h.status === 'open' ? `<div class="acts"><button type="button" data-ph="break" data-id="${esc(h.id)}">깨짐으로 표시</button><button type="button" data-ph="right" data-id="${esc(h.id)}">종료 · 맞음</button><button type="button" data-ph="wrong" data-id="${esc(h.id)}">종료 · 틀림</button></div>` : ''}</div>`).join('');
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = async () => { const kind = b.dataset.ph, note = prompt(kind === 'break' ? '무엇이 깨졌습니까? (한 줄)' : '마감 메모 (선택)') ?? ''; try { await privateRead('paper-live-hypothesis', { op: kind === 'break' ? 'break' : 'close', item: { id: b.dataset.id, note, verdict: kind === 'right' ? 'right' : kind === 'wrong' ? 'wrong' : undefined } }); $('#pp-hyp-state').textContent = '가설을 닫았습니다. 다음 자동 실행에서 계획이 바뀝니다.'; await kisRefresh(); } catch (e) { $('#pp-hyp-state').textContent = e?.message || '처리하지 못했습니다.'; } });
}
$('#ph-add').onclick = async () => { const err = $('#ph-err'); err.textContent = ''; if (!phPick) { err.textContent = '종목을 먼저 고르십시오.'; return; }
  try { await privateRead('paper-live-hypothesis', { op: 'add', item: { symbol: phPick.symbol, name: phPick.name, capPct: Number($('#ph-cap').value), horizonMonths: Number($('#ph-h').value), thesis: $('#ph-thesis').value.trim(), breakIf: $('#ph-break').value.trim(), evidence: phEvidence } });
    $('#ph-thesis').value = ''; $('#ph-break').value = ''; $('#ph-sym').value = ''; $('#ph-evidence').textContent = ''; phPick = null; $('#pp-hyp-new').open = false; $('#pp-hyp-state').textContent = '등록했습니다. 다음 자동 실행(계획 변경)에서 모의계좌에 반영됩니다.'; await kisRefresh(); }
  catch (e) { err.textContent = e?.status === 503 ? 'PC에 모의투자 키가 없습니다.' : (e?.message || 'PC 연결이 필요합니다.'); } };
