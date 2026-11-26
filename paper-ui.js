// 모의투자 화면: 실제 돈 없이 규칙대로 사고팔아 본다. 탭 두 개(내 가상계좌 · 팀 모의계좌) + 접힌 '과거 시세로 테스트'.
//   과거 시세로 테스트: 목표 비중 → (주 1번·급할 때) 점검 → 낼 주문마다 주문 점검 → 통과한 주문만 다음 거래일 시가 체결 → 날마다 평가 → 그냥 보유·지수와 비교.
// 테스트 계산은 모두 이 브라우저에서 한다(lib/paper-trading.js). 서버에는 종목 코드로 시세만 묻는다. 실제 주문은 없다.
// '오늘부터 기록 시작'은 시작일·자금·종목·규칙만 저장하고, 볼 때마다 시작일부터 오늘까지 같은 규칙으로 다시 계산한다(결정론적이라 기록을 따로 둘 필요가 없다).
import { rehearse, forwardRange, PAPER_VERSION } from '/lib/paper-trading.js';
import { normalizeRules, RULES_VERSION } from '/lib/core-rules.js';
import { candles as fetchCandles } from '/lib/client-data.js';
import { resolveStockInput, stockName, stockNames } from '/lib/instruments.js';
import { tip } from '/tooltip-ui.js';
import { attachStockSearch } from '/stock-search-ui.js';
import { fundamentals } from '/lib/client-data.js';
import { returnsFrom } from '/lib/sectors.js';
import { privateRead } from '/bridge-client.js';
import { loadMockAccount } from '/paper-account-ui.js';
import { planBasketFrom, heldBasketFrom, runState, invested, nextChecks, lastAuto, planAppliedFor, planGaps, plannedNotHeld, orderStatusLabel, kstStamp, MARKET_NAME } from '/lib/paper-public.js';
import { DEFAULT_RULES, RULE_DEFS } from '/lib/core-rules.js';
import { compareRuleSets } from '/lib/strategy-review.js';
import { reviewRules, SYSTEM_CHECK_LABEL } from '/lib/rule-presets.js';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = v => Number.isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')}원` : '—';
const swon = v => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('ko-KR')}원` : '—';
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d)}%` : '—';
const pp = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%p` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const daysAgo = n => new Date(Date.now() - n * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const session = () => sessionStorage.getItem('teamQuantSession') || 'guest';
const DEMO = [['005930', '삼성전자', 'KRW'], ['000660', 'SK하이닉스', 'KRW'], ['069500', 'KODEX 200', 'KRW'], ['NVDA', '엔비디아', 'USD'], ['KO', '코카콜라', 'USD'], ['035420', 'NAVER', 'KRW']].map(([symbol, name, currency]) => ({ symbol, name, currency }));
const CHECK_LABEL = { maxTrades30: '30일 매매 횟수', dailyLoss: '하루 손실 한도', volTarget: '목표 비중·200일선', minCash: '현금 최소 비중', maxSingle: '한 종목 최대 비중', cash: '현금 충분', noLeverage: '레버리지 금지', input: '입력값' };
// 기록의 단계 값(엔진이 쓰는 이름 · CSS 클래스)은 그대로 두고 화면에 보이는 글자만 바꾼다.
const STEP_LABEL = { 차단: '막힘', 보류: '주문 안 함' };
const JOURNAL_FILTERS = [{ id: '전체', label: '전체', steps: null }, { id: '체결', label: '체결', steps: ['체결'] }, { id: '못함', label: '못 한 주문', steps: ['차단', '미체결', '보류'] }, { id: '손실', label: '손실 난 날', steps: ['손실'] }];
// 팀 PC(lib/paper-live.js)가 전에 적어 둔 이유·메모(공개 자료에 남아 있음)를 지금 쓰는 말로 읽는다. 저장된 값은 바꾸지 않는다.
const LEGACY_TERMS = [[/공포 (\d)단계\(예비 현금 투입 · 오른 종목 유지\)/g, '급락 대비 현금 $1/3 투입(오른 종목 유지)'], [/계획 변경\([^)]*\)/g, '계획 변경'], [/첫 운용/g, '처음 시작'], [/전환 잔여\(정리 종목 남음\)/g, '정리할 종목 남음'], [/전체 정지\(킬 스위치\)/g, '전체 정지'], [/킬 스위치/g, '전체 정지'], [/자동 깨짐/g, '자동 제외'], [/깨짐/g, '제외'], [/장 마감으로 소멸/g, '장 마감 취소'], [/예비 현금/g, '급락 대비 현금'], [/핵심 지수/g, '지수 ETF'], [/새 최고점/g, '최고가 경신'], [/되채움/g, '다시 채움'], [/위성 추가 매수 금지/g, '개별 종목 추가 매수 금지'], [/위성 묶음/g, '개별 종목 전체'], [/위성 종목/g, '개별 종목'], [/위성/g, '개별 종목'], [/나눠 사기/g, '분할 매수'], [/근거 카드/g, '종목 기준'], [/추가 매수 정지/g, '더 사지 않음'], [/^핵심:/g, '지수 ETF:'], [/계획 비중/g, '목표 비중'], [/가설 자체 수익|가설 수익/g, '이 종목 수익'], [/환율\(KRW=X\)/g, '달러 환율'], [/재조정/g, '비중 맞추기'], [/보류합니다/g, '하지 않습니다'], [/미충족/g, '해당 안 됨'], [/(\(8-K [\d.]+\)): 8-K [\d.,\s]+$/g, '$1'], [/미집행/g, '주문 못 함'], [/환율 미확인/g, '환율 확인 안 됨'], [/평가 보류/g, '평가 안 함'], [/미국 티커/g, '미국 종목코드']];
const thisYear = () => today().slice(0, 4);
/** 서버가 적은 짧은 글: 예전 용어는 지금 말로, 올해 날짜는 연도를 뺀다(MM-DD). */
const termFix = v => { let t = String(v ?? ''); for (const [re, to] of LEGACY_TERMS) t = t.replace(re, to); return t.replace(new RegExp(`\\b${thisYear()}-(\\d\\d-\\d\\d)`, 'g'), '$1'); };
/** 날짜: 올해면 MM-DD, 다른 해면 YYYY-MM-DD. */
const md = d => { const s = String(d || '').slice(0, 10); return s.slice(0, 4) === thisYear() ? s.slice(5) : s; };
/** 시각: 한국 시간 'MM-DD HH:mm'(다른 해면 연도까지). */
const kst = iso => { const s = kstStamp(iso); return s.slice(0, 4) === thisYear() ? s.slice(5) : s; };
const SKEL = '<div class="pp-skel" aria-hidden="true"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div></div><p class="cr-muted">불러오는 중…</p>';

// 2026-11-26: 화면 모양은 /paper.css(tokens.css 값만 씀)에 있다. 여기 <style>에는 시험(test/paper-ui-layout.test.js)이 소스에서 확인하는 규칙만 남긴다.
const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = '/paper.css?v=20261126'; document.head.append(sheet);
const style = document.createElement('style'); style.textContent = `
.pp-why{white-space:normal!important;text-align:left!important;min-width:240px;max-width:560px;font-size:var(--tq-fs-1);line-height:1.45;color:var(--tq-sub)}.pp-why b{color:var(--tq-ink);font-weight:600}
@media(max-width:760px){/* 폰 폭: 보유 표의 "담은 이유"를 가로 스크롤 뒤에 숨기지 않고 종목 줄 아래 전체 폭으로 내린다 */#pp-kis-held table.pp-ref{display:block;width:auto;min-width:0;max-width:100%}#pp-kis-held table.pp-ref thead,#pp-kis-held table.pp-ref tbody{display:block;width:auto}#pp-kis-held table.pp-ref tr{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,.5fr) minmax(0,1.1fr) minmax(0,.6fr);align-items:center;border-bottom:1px solid var(--tq-line);width:auto}#pp-kis-held table.pp-ref td,#pp-kis-held table.pp-ref th{border-bottom:0;white-space:normal;min-width:0;overflow-wrap:anywhere}#pp-kis-held table.pp-ref th:last-child,#pp-kis-held table.pp-ref td.pp-why{grid-column:1/-1;min-width:0;max-width:none;padding-top:0}}`; document.head.append(style);

const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'paper'; nav.textContent = '모의투자'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'paper'; page.id = 'core-paper';
page.innerHTML = `<div class="page-head"><div><h1>모의투자 ${tip('실제 돈 없이 규칙대로 사고팔아 보는 곳입니다.\n내 가상계좌는 이 브라우저에서, 팀 모의계좌는 한국투자증권 모의투자에서 주문합니다.\n과거 결과가 앞으로를 보장하지 않습니다.', '모의투자 설명')}</h1></div></div>
<div class="cr-grid"><div class="cr-main">
<article class="cr-card" id="pp-kis"><header><h3 class="pp-head">한국투자증권 모의투자 · <span id="pp-kis-title-state">확인 중</span> ${tip('한국투자증권 모의투자 계좌(가상 돈)이며 상시 모의투자대회에 참가 중입니다. 보유·거래·수익률을 하루 1번 공개합니다(계좌번호·주문번호 제외). 가상 체결이라 실제 거래와 가격·체결이 다를 수 있고, 따라 사라는 뜻이 아닙니다.\n팀 PC가 팀 모의계좌 규칙과 목표 비중으로 주문을 정하고, 주문 점검(규칙 · 1회·하루 한도 · 가격 범위 · 중복)을 모두 통과한 주문만 지정가로 냅니다. 실전 계좌로는 주문하지 않습니다. 장이 닫혔거나 시세·잔고를 못 읽으면 주문하지 않습니다. 기록은 팀 PC에 남고 잔고·주문 요약·계획만 하루 1번 공개합니다.', '팀 모의계좌 설명')}</h3><button type="button" class="text-button" id="pp-kis-refresh">새로고침</button></header><div id="pp-kis-body">${SKEL}</div><div class="cr-actions" id="pp-kis-actions" hidden><button type="button" class="secondary" id="pp-kis-preview">오늘 주문 미리보기</button><button type="button" class="primary" id="pp-kis-run" disabled>주문하기</button><button type="button" class="text-button" id="pp-kis-kill">전체 정지</button><label class="cr-muted pp-check"><input type="checkbox" id="pp-kis-rebal"> 비중 맞추기(리밸런싱) ${tip('목표 비중에 맞게 한 번에 사고팝니다(오른 종목도 목표로 되돌림). 30일 매매 횟수에는 1번으로 셉니다. 계획을 바꿨거나 처음 시작할 때 켭니다.')}</label></div><p class="cr-err" id="pp-kis-state" role="status"></p><div id="pp-kis-result"></div></article>
<div class="cr-card" id="pp-hyp"><header><h3>직접 고른 종목(가설) ${tip('팀 모의계좌에 개별 종목을 넣는 유일한 방법입니다. 산 이유(실적 성장·최근 주가 흐름), 기한, 제외 조건, 최대 비중을 적습니다. 계획에 넣으면 그 비중만큼 사고, 산 가격 대비 수익을 같은 기간 지수와 비교해 남깁니다. 맞은 것도 틀린 것도 지우지 않습니다.')}</h3><span class="cr-muted" id="pp-hyp-state"></span></header>
  <div id="pp-hyp-list" class="ph-list"><div class="pp-skel" aria-hidden="true"><div class="shimmer ct-skel"></div></div><p class="cr-muted">불러오는 중…</p></div>
  <details id="pp-hyp-new" class="ph-new" hidden><summary>종목 추가</summary>
    <div class="pp-form"><label class="ck-field"><span>종목</span><input id="ph-sym" placeholder="이름·종목코드" autocomplete="off"></label><label class="ck-field"><span>최대 비중 (총자산 중)</span><select id="ph-cap"><option value="2">2%</option><option value="3" selected>3%</option><option value="5">5%</option></select></label><label class="ck-field"><span>기한</span><select id="ph-h"><option value="3">3개월</option><option value="6" selected>6개월</option><option value="12">1년</option></select></label></div>
    <label class="cr-muted pp-check"><input type="checkbox" id="ph-public" checked> 팀·방문자에게 공개 ${tip('켜면 팀원과 방문자도 산 이유·근거를 봅니다(하루 1번 공개). 끄면 팀 PC에만 남습니다.')}</label>
    <div id="ph-evidence" class="ph-ev"></div>
    <label class="ck-field"><span>산 이유</span><textarea id="ph-thesis" rows="3" placeholder="예: HBM 수요가 늘어 2027-05까지 매출이 두 자릿수로 늘고 주가가 코스피200보다 나을 것으로 본다"></textarea></label>
    <label class="ck-field"><span>제외 조건 — 이러면 틀렸다고 보고 판다</span><input id="ph-break" placeholder="예: 분기 매출 성장률이 10% 아래로 떨어지면"></label>
    <div class="cr-actions"><button type="button" class="primary" id="ph-add">등록</button>${tip('등록만으로는 사지 않습니다. 목록에서 \'계획에 넣기\'를 눌러야 다음 장중에 삽니다.')}<span class="cr-err" id="ph-err"></span></div>
  </details></div>
<div class="pp-sec" id="pp-sim-head"><h2 class="tq-vh">과거 시세로 테스트</h2></div>
<div class="cr-card" id="pp-setup"><header><h3>테스트 조건 ${tip('지난 시세로 \'그때 이 규칙대로 했다면\'을 계산합니다. 기본값은 팀 모의계좌의 계획·규칙으로 6개월 전부터 계산해 그냥 보유·지수와 비교합니다. 주문은 나가지 않고, 과거 자료라 좋아 보이게 만들기 쉽습니다.\n목표 비중은 팀 기본 계획을 고르면 그 비중, 아니면 한 종목 최대 비중·현금 최소 비중 안에서 종목마다 같은 비중입니다. 매주 마지막 거래일 종가(급하면 그날)로 규칙과 비교해 주문을 정하고, 주문 점검을 통과한 주문만 다음 거래일 시가보다 0.1% 불리하게 체결합니다(매매마다 비용 0.2%, 국내 주식 1주 단위). 날마다 원화로 환산해 그냥 보유·지수와 비교합니다.')}</h3><span class="cr-muted" id="pp-rules"></span></header>
<div class="pp-form"><label class="ck-field unit"><span>시작 자금</span><input id="pp-capital" type="number" value="10000000" min="100000" step="100000" inputmode="numeric"><i>원</i></label>
<label class="ck-field"><span>종목</span><select id="pp-basket"><option value="mockplan">팀 기본 계획 (비중 그대로)</option><option value="mockheld">팀 모의계좌 지금 보유 종목</option><option value="demo">예시 6종목 (국내 4 · 미국 2)</option><option value="mine" disabled>내 보유 종목 (계좌 연결 또는 예시 자산 필요)</option><option value="custom">직접 입력</option></select></label>
<label class="ck-field"><span>기간</span><select id="pp-range"><option value="91">최근 3개월</option><option value="182" selected>최근 6개월</option><option value="365">최근 1년</option><option value="540">최근 18개월</option></select></label></div>
<div class="ck-field" id="pp-custom-wrap" hidden><span>종목 찾아 추가 (최대 12개)</span><input id="pp-custom" placeholder="이름·종목코드 (예: 현대, 005380, NVDA)" autocomplete="off"><div class="cp-chips pp-picked" id="pp-picked"></div></div>
<div class="cr-actions"><button id="pp-run" class="primary">테스트하기</button><button id="pp-start" class="secondary">오늘부터 기록 시작</button><span id="pp-state" class="cr-err" role="status"></span></div></div>
<div class="cr-card" id="pp-live" hidden></div>
<div id="pp-result"></div>
<div class="cr-card" id="pp-ref"><h3>같은 규칙을 과거에 적용한 결과 ${tip('예시 포트폴리오 4개를 9개 기간(최근 12개월·6개월·올해·2020~2025년 각 해)에 같은 규칙으로 돌린 결과입니다. 규칙은 2012~2019년 자료로 골랐지만 확정은 2026-11-06이라, 완전한 확인은 그 뒤 팀 모의계좌 기록부터입니다.')}</h3><div id="pp-ref-body"><p class="cr-muted">불러오는 중…</p></div></div>
<div class="cr-card" id="pp-howto"><h3>전략 세우는 순서</h3><ol class="pp-order"><li><b>규칙 화면</b>에서 허용 손실·분산·점검 주기를 숫자로<small>한 달 손실 5/10/20% → 하루 손실 한도·현금 최소 비중·한 종목 최대 비중</small></li><li>종목은 <b>직접 고른 종목</b>으로만<small>산 이유·기한·제외 조건·최대 비중을 적어 등록</small></li><li><b>과거 시세로 테스트</b>해 그냥 보유·지수와 비교<small>한 기간이 아니라 3·6·12·18개월 모두에서 손실이 작은 규칙을 고름</small></li><li><b>팀 모의계좌</b>로 앞으로 확인<small>같은 규칙·계획을 한국투자증권 모의투자 계좌가 자동으로 지킴 · 체결은 한국투자증권 모의 서버 기준이라 거래소 체결과 다를 수 있음</small></li><li><b>기록으로 점검</b><small>한도를 넘은 날·매매 횟수·막힌 이유를 보고 규칙을 고침</small></li></ol><div class="cr-actions"><button type="button" class="secondary" data-core-go="rules">규칙 화면</button></div></div>
</div></div>`;
document.querySelector('main').append(page);
// 결정 62: 내 가상 모의계좌(증권사 없이 · 이 브라우저) — 팀 모의계좌 카드 아래. 실패해도 화면의 나머지는 그대로.
import('/virtual-ui.js').then(m => m.mountVirtual(page)).catch(() => { });
// 2026-11-13: 과거 데이터 검증·절차 설명은 한 번 접는다 — 화면을 열면 계좌 상태(얼마 벌었나·무엇을 들고 있나)가 먼저 보이게.
{ const head = page.querySelector('#pp-sim-head'), box = document.createElement('details'); box.className = 'pp-fold'; box.id = 'pp-sim-fold'; box.innerHTML = `<summary>과거 시세로 테스트 ${tip('지난 시세로 같은 규칙을 돌려 봅니다. 계좌의 주문·잔고에는 영향이 없습니다. 과거 자료는 좋아 보이게 만들기 쉬우니 한 기간이 아니라 3·6·12·18개월 모두에서 손실이 작은 규칙을 고르세요.\n체결은 다음 거래일 시가보다 0.1% 불리하게, 매매마다 비용 0.2%로 가정합니다.\n예측하지 않고, 규칙을 세워 감정 없이 지키고, 기록을 보고 규칙을 고칩니다.', '과거 시세로 테스트 설명')}<small>주문 없음</small></summary>`; try { box.open = localStorage.getItem('teamQuantPaperFold') === '1'; } catch {} box.addEventListener('toggle', () => { try { localStorage.setItem('teamQuantPaperFold', box.open ? '1' : '0'); } catch {} }); if (head) { head.before(box); let n = head; while (n) { const next = n.nextElementSibling; box.append(n); n = next; } } }

// ── 상태 ─────────────────────────────────────────────────────
const S = { mine: [], run: 0, last: null, journalFilter: '전체', journalAll: false };
const liveKey = () => `teamQuantPaper:${session()}`;
function currentRules() { try { const v = JSON.parse(localStorage.getItem(`teamQuantRules:${session()}`) || 'null'); return normalizeRules(v?.rules || {}).rules; } catch { return normalizeRules({}).rules; } }
function loadLive() { try { const v = JSON.parse(localStorage.getItem(liveKey()) || 'null'); return v?.startDate && Array.isArray(v.basket) ? v : null; } catch { return null; } }
function saveLive(v) { try { if (v) localStorage.setItem(liveKey(), JSON.stringify(v)); else localStorage.removeItem(liveKey()); } catch {} }
function rulesLine(r) { return `규칙: 한 종목 최대 ${r.maxSingle}% · 현금 최소 ${r.minCash}% · 하루 손실 ${r.dailyLoss}% · 30일 매매 ${r.maxTrades30}번${r.trendUS ? ' · 미국 지수 200일선' : ''}${r.perAssetVol ? ` · 종목 변동성 ${r.volTarget}%` : ''}`; }
$('#pp-rules').textContent = rulesLine(currentRules());

window.addEventListener('teamquant:asset-snapshot', e => { const ps = (e.detail?.positions || []).filter(p => p.symbol); S.mine = ps.map(p => ({ symbol: p.symbol, name: p.name || stockName(p.symbol), currency: p.currency || 'KRW' })); const o = $('#pp-basket option[value="mine"]'); o.disabled = !S.mine.length; o.textContent = S.mine.length ? `내 보유 종목 ${S.mine.length}개${e.detail?.paper ? ' (팀 모의계좌)' : e.detail?.demo ? ' (예시 자산)' : ''}` : '내 보유 종목 (계좌 연결 또는 예시 자산 필요)'; });
window.addEventListener('teamquant:asset-clear', () => { S.mine = []; const o = $('#pp-basket option[value="mine"]'); o.disabled = true; if ($('#pp-basket').value === 'mine') $('#pp-basket').value = 'demo'; });
$('#pp-basket').onchange = () => { $('#pp-custom-wrap').hidden = $('#pp-basket').value !== 'custom'; };
// 직접 입력: 공용 검색 제안으로 고르고 칩으로 쌓는다(쉼표 입력도 그대로 받는다)
S.custom = [];
function renderPicked() { const box = $('#pp-picked'); if (!box) return; box.innerHTML = S.custom.map(o => `<button type="button" class="on" data-rm="${esc(o.symbol)}" title="빼기">${esc(o.name)} <i aria-hidden="true">×</i></button>`).join('') || '<span class="cr-muted">아직 고른 종목이 없습니다.</span>'; box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.custom = S.custom.filter(o => o.symbol !== b.dataset.rm); renderPicked(); }); }
attachStockSearch($('#pp-custom'), { clearOnPick: true, exclude: () => new Set(S.custom.map(o => o.symbol)), onPick: o => { if (S.custom.length >= 12) { $('#pp-state').textContent = '종목은 12개까지입니다.'; return; } if (!S.custom.some(x => x.symbol === o.symbol)) S.custom.push(o); renderPicked(); } });
renderPicked();

// ── 모의계좌(PC 실시간 또는 저장소 공개 파일)의 계획·보유를 시뮬 입력으로. 있으면 기본 선택이다 ──
S.mock = null;
function applyMockOptions(pub) {
  S.mock = pub || null; const pb = planBasketFrom(pub), held = heldBasketFrom(pub), o1 = $('#pp-basket option[value="mockplan"]'), o2 = $('#pp-basket option[value="mockheld"]');
  o1.disabled = !pb.basket.length; o1.textContent = pb.basket.length ? `팀 기본 계획 · ${pb.basket.length}종목 · 현금 ${pb.cashPct}% (비중 그대로)` : '팀 기본 계획 (자료 없음)';
  o2.disabled = !held.length; o2.textContent = held.length ? `팀 모의계좌 지금 보유 ${held.length}종목 (같은 비중)` : '팀 모의계좌 지금 보유 종목 (없음)';
  if (/^mock/.test($('#pp-basket').value) && $('#pp-basket').selectedOptions[0]?.disabled) $('#pp-basket').value = o1.disabled ? (o2.disabled ? 'demo' : 'mockheld') : 'mockplan';
  $('#pp-rules').textContent = rulesLine(simRules()) + ' · ' + rulesSource();
}
async function loadMock() { try { applyMockOptions(await loadMockAccount({ fresh: true })); } catch { applyMockOptions(null); } return S.mock; }
function mockRules() { const r = S.mock?.prefs?.rules; return r ? normalizeRules(r).rules : null; }
const usingMock = () => /^mock/.test($('#pp-basket').value) && !!mockRules();
function simRules() { return usingMock() ? mockRules() : currentRules(); }
function rulesSource() { return usingMock() ? `팀 모의계좌 규칙(${md(S.mock.prefs.savedAt)} 저장)` : '규칙 화면의 내 규칙'; }
function planOf() { return $('#pp-basket').value === 'mockplan' && S.mock ? planBasketFrom(S.mock).plan : null; }
$('#pp-basket').addEventListener('change', () => { $('#pp-rules').textContent = rulesLine(simRules()) + ' · ' + rulesSource(); });

async function basketOf() {
  const kind = $('#pp-basket').value;
  if (kind === 'demo') return DEMO;
  if (kind === 'mockplan' || kind === 'mockheld') { if (!S.mock) await loadMock(); const b = kind === 'mockplan' ? planBasketFrom(S.mock).basket : heldBasketFrom(S.mock); if (!b.length) throw new Error('팀 모의계좌 자료가 아직 없습니다. 잠시 뒤 다시 열어 주세요.'); return b.slice(0, 24); }
  if (kind === 'mine') { if (!S.mine.length) throw new Error('보유 종목이 없습니다. 계좌를 연결하거나 예시 자산을 켜 주세요.'); return S.mine.slice(0, 12); }
  if (S.custom.length && !$('#pp-custom').value.trim()) return S.custom.map(o => ({ symbol: o.symbol, name: o.name, currency: o.currency }));
  const parts = [...S.custom.map(o => o.symbol), ...$('#pp-custom').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)];
  if (!parts.length) throw new Error('종목을 하나 이상 골라 주세요.');
  if (parts.length > 12) throw new Error('종목은 12개까지입니다.');
  const out = [];
  for (const p of parts) {
    // 이름·6자리 코드는 서버 조회 없이도 풀 수 있게 이름 사전으로 먼저 찾는다(시세 조회가 코스피→코스닥 순으로 시장을 정한다).
    const byName = /^\d{6}$/.test(p) ? p : Object.keys(stockNames).find(k => stockNames[k].replace(/\s/g, '').toLowerCase() === p.replace(/\s/g, '').toLowerCase());
    let symbol = byName || null;
    if (!symbol) { try { symbol = await resolveStockInput(p); } catch { if (/^[A-Z][A-Z.\-]{0,6}$/i.test(p)) symbol = p.toUpperCase(); else throw new Error(`'${p}'을(를) 찾지 못했습니다. 이름·6자리 종목코드·미국 종목코드(예: AAPL)로 입력해 주세요.`); } }
    const code = symbol.split('.')[0], currency = /^\d{6}$/.test(code) ? 'KRW' : 'USD';
    if (!out.some(b => b.symbol === symbol)) out.push({ symbol, name: stockName(symbol) === symbol && currency === 'KRW' ? p : stockName(symbol), currency });
  }
  return out;
}
async function loadCandles(basket) {
  const out = {}, failed = [];
  await Promise.all(basket.map(async b => { try { out[b.symbol] = (await fetchCandles(b.symbol, b.currency, '2y')).candles; } catch (e) { failed.push({ name: b.name, why: e.message }); } }));
  return { candles: out, failed };
}

async function run({ live = null } = {}) {
  const id = ++S.run, state = $('#pp-state'), result = $('#pp-result'); state.textContent = '';
  try {
    const capital = live ? live.capitalKrw : Number($('#pp-capital').value);
    if (!(capital >= 100000)) throw new Error('시작 자금은 10만 원 이상이어야 합니다.');
    const basket = live ? live.basket : await basketOf(), rules = live ? normalizeRules(live.rules || {}).rules : simRules(), plan = live ? (live.plan || null) : planOf(), rulesFrom = live ? '시작할 때 고정한 규칙' : rulesSource();
    const from = live ? live.startDate : daysAgo(Number($('#pp-range').value));
    result.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div><p class="cr-muted">시세를 받아 다시 계산하는 중…</p></div>';
    const krw = basket.filter(b => b.currency === 'KRW').length, benchDef = krw * 2 >= basket.length ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW' } : { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' };
    const [{ candles, failed }, fx, kodex, spy] = await Promise.all([loadCandles(basket), fetchCandles('KRW=X', 'USD', '2y').then(d => d.candles).catch(() => []), fetchCandles('069500', 'KRW', '2y').then(d => d.candles).catch(() => null), fetchCandles('SPY', 'USD', '2y').then(d => d.candles).catch(() => null)]);
    const indexes = { KR: kodex ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: kodex } : null, US: spy ? { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: spy } : null }, bench = benchDef.symbol === 'SPY' ? spy : kodex;
    if (id !== S.run) return;
    await new Promise(r => setTimeout(r, 0));
    const r = rehearse({ basket, capitalKrw: capital, rules, plan, candlesBySymbol: candles, fxCandles: fx, from, to: today(), benchmark: bench ? { ...benchDef, candles: bench } : null, indexes, label: live ? '가상 기록' : '과거 시세로 테스트' });
    if (id !== S.run) return;
    if (!r.ok) { result.innerHTML = `<div class="cr-card"><p class="cr-muted">${esc(r.reason)}${live ? ' 시작일 다음 거래일부터 체결이 기록됩니다.' : ''}</p></div>`; return; }
    const fr = forwardRange({ positions: r.end.positions, cashKrw: r.end.cash, candlesBySymbol: candles, fxCandles: fx });
    S.last = { r, fr, failed, live: !!live, rulesFrom, inputs: { basket, plan, capital, candles, fx, benchmark: bench ? { ...benchDef, candles: bench } : null, indexes, rules } }; S.journalFilter = '전체'; S.journalAll = false; S.review = null;
    render(); scheduleReview();
  } catch (e) { if (id === S.run) { state.textContent = e.message; result.innerHTML = ''; } }
}

function lineSvg(series, hasBench) {
  const hasMix = hasBench && series.some(p => Number.isFinite(p.mix));
  const W = 720, H = 220, L = 40, R = 10, T = 10, B = 24, keys = [['rule', '규칙대로'], ['hold', '그냥 보유'], ...(hasBench ? [['bench', '지수']] : []), ...(hasMix ? [['mix', '지수로만']] : [])];
  const vals = series.flatMap(p => keys.map(([k]) => p[k])).filter(Number.isFinite), lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
  const X = i => L + i / Math.max(1, series.length - 1) * (W - L - R), Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  const path = k => series.map((p, i) => Number.isFinite(p[k]) ? `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}` : '').filter(Boolean).join(' ');
  return `<div class="rp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="규칙대로·그냥 보유·지수(시작=100)">${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`).join('')}<line class="b" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${keys.map(([k]) => `<polyline class="l-${k === 'rule' ? 'actual' : k}" points="${path(k)}"/>`).join('')}<text x="${L}" y="${H - 6}">${md(series[0].date)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${md(series.at(-1).date)}</text></svg>
  <div class="rp-legend">${keys.map(([k, l]) => `<span><i class="l-${k === 'rule' ? 'actual' : k}"></i>${l}</span>`).join('')}<span class="cr-muted">시작=100 · 원화</span></div></div>`;
}
const sg = x => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}`; // 표 숫자(이미 % 단위): +1.2 · −0.8
const mixPartsOf = name => (String(name || '').match(/\((.*)\)$/) || [])[1] || String(name || '');

function render() {
  const { r, fr, failed, live } = S.last, m = r.metrics, a = r.activity, body = $('#pp-result');
  const better = r.diff.vsHoldPct, mddBetter = r.diff.mddVsHoldPct, mixParts = mixPartsOf(r.mix?.name);
  const mddText = x => Math.abs(x) < 0.05 ? '같음' : x > 0 ? `${x.toFixed(1)}%p 작음` : `${(-x).toFixed(1)}%p 큼`;
  const verdict = `규칙대로 <b class="${tone(m.rule.ret)}">${pct(m.rule.ret)}</b> · 그냥 보유 ${pct(m.hold.ret)}${m.bench ? ` · ${esc(r.benchmark.name)} ${pct(m.bench.ret)}` : ''}${m.mix ? ` · 지수로만 ${pct(m.mix.ret)}` : ''}<br><span class="cr-muted">그냥 보유보다 수익률 ${pp(better)} · 최대 하락폭 ${mddText(mddBetter)}${m.mix ? ` ${tip(`지수로만 담은 경우(${mixParts})보다 최대 하락폭 ${mddText(r.diff.mddVsMixPct)}.`)}` : ''}</span>`;
  const tile = (label, mm, me = false) => `<div class="${me ? 'me' : ''}"><span class="cr-muted">${label}</span><br><b>${won(mm.end)}</b><br><span class="${tone(mm.ret)}">${pct(mm.ret)}</span> · 최대 하락폭 ${pct(mm.mdd)}</div>`;
  const blocked = Object.entries(a.blocked).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${CHECK_LABEL[k] || k} ${v}건`).join(', ');
  const filt = JOURNAL_FILTERS.find(f => f.id === S.journalFilter) || JOURNAL_FILTERS[0];
  const rows = r.journal.filter(j => !filt.steps || filt.steps.includes(j.step)), shown = S.journalAll ? rows : rows.slice(0, 10);
  const missing = [...new Set([...failed.map(f => f.name), ...r.missing])];
  const holdRows = r.end.positions.filter(p => p.qty > 0).sort((x, y) => y.valueKrw - x.valueKrw).map(p => `<tr><td>${esc(p.name)}</td><td>${p.currency === 'USD' ? p.qty.toFixed(4) : p.qty.toLocaleString('ko-KR')}</td><td>${won(p.valueKrw)}</td><td>${p.weightPct.toFixed(1)}%</td><td class="${tone(p.pnlKrw)}">${swon(p.pnlKrw)}</td></tr>`).join('');
  body.innerHTML = `<div class="cr-card"><header><h3>${live ? '가상 기록' : '테스트 결과'} <span class="cr-muted">${md(r.from)} ~ ${md(r.to)} · ${r.days}거래일</span></h3></header>
  <p class="rp-verdict">${verdict}</p>
  <p class="cr-muted pp-meta">종목 ${Object.keys(r.plan).length}개 · 목표 비중 합 ${Object.values(r.plan).reduce((a, b) => a + b, 0).toFixed(0)}% (나머지 현금) · 규칙: ${esc(S.last.rulesFrom || '')} · 자금 ${won(r.capitalKrw)}</p>
  <div class="rp-tiles">${tile('규칙대로', m.rule, true)}${tile('그냥 보유 (같은 종목·같은 비중)', m.hold)}${m.bench ? tile(esc(r.benchmark.name), m.bench) : '<div><span class="cr-muted">지수</span><br><b>—</b></div>'}${m.mix ? tile(`지수로만 담은 경우 ${tip(mixParts)}`, m.mix) : ''}</div>
  <div class="pp-act"><span>체결 <b>${a.trades}</b>건</span><span>주문 점검에서 막힘 <b>${a.blockedTotal}</b>건</span><span>비용 <b>${won(a.feesKrw + a.slippageKrw)}</b> (자금의 ${a.costPct.toFixed(2)}%)</span><span>하루 ${r.rules.dailyLoss}% 넘게 잃은 날 <b>${a.breaches}</b>일 (${a.breachPct.toFixed(1)}%)</span>${tip(`점검 ${a.decisionDays}번${a.urgentDays ? `(급한 날 ${a.urgentDays}번)` : ''} · 1주 미만·현금 부족으로 못 산 주문 ${a.unfilled}건 · 현금 평균 ${a.cashAvgPct.toFixed(0)}%${blocked ? `\n막힌 이유: ${blocked}` : ''}`, '테스트 숫자 더 보기')}</div>
  ${lineSvg(r.series, !!m.bench)}
  ${missing.length ? `<p class="cr-note">시세가 없어 뺀 종목: ${esc(missing.join(', '))}${failed.length ? ` ${tip(failed.map(f => `${f.name}: ${f.why}`).join('\n'))}` : ''}</p>` : ''}</div>
  <div class="cr-card"><header><h3>마지막 날 보유 <span class="cr-muted">${md(r.to)} 종가</span></h3><span class="cr-muted">총자산 ${won(r.end.total)} · 현금 ${won(r.end.cash)} (${(r.end.cash / r.end.total * 100).toFixed(0)}%)</span></header>
  ${holdRows ? `<div class="pp-scroll"><table class="cr-table"><thead><tr><th>종목</th><th>수량</th><th>평가액</th><th>비중</th><th>손익</th></tr></thead><tbody>${holdRows}</tbody></table></div>` : '<p class="cr-muted">보유 종목 없음(전부 현금)</p>'}
  <div class="pp-range">${fr.ok ? `3개월 뒤 예상 범위 ${tip(`최근 2년 움직임으로 앞으로 ${fr.horizon}거래일(약 3개월)을 2,000번 가정한 범위입니다(10번 중 9번은 이 안). 오를지 내릴지가 아니라 변동 크기이며 중간 매매는 넣지 않았습니다. 주식 비중 ${fr.investedPct.toFixed(0)}% · 예상 변동성 연 ${(fr.annualVol * 100).toFixed(0)}%.`)}<br><b>${swon(fr.p05Krw)} ~ ${swon(fr.p95Krw)}</b> <span class="cr-muted">(중간값 ${swon(fr.medianKrw)} · 10% 넘게 빠질 확률 ${(fr.probDown10 * 100).toFixed(0)}%)</span>` : `<span class="cr-muted">3개월 뒤 예상 범위: ${esc(fr.reason)}</span>`}</div></div>
  <div class="cr-card"><header><h3>테스트 기록 <span class="cr-muted">${r.journal.length}건</span></h3></header>
  <div class="pp-chips">${JOURNAL_FILTERS.map(f => `<button type="button" data-jf="${f.id}" class="${filt.id === f.id ? 'on' : ''}">${f.label}${f.steps ? ` ${r.journal.filter(j => f.steps.includes(j.step)).length}` : ''}</button>`).join('')}</div>
  <table class="pp-journal pp-fixed"><colgroup><col class="pp-c-date"><col class="pp-c-step"><col></colgroup><tbody>${shown.map(j => `<tr class="${esc(j.step)}"><td>${md(j.date)}</td><td>${esc(STEP_LABEL[j.step] || j.step)}</td><td>${esc(termFix(j.text))}</td></tr>`).join('') || '<tr><td colspan="3" class="cr-muted">기록 없음</td></tr>'}</tbody></table>
  ${rows.length > shown.length ? `<div class="cr-actions"><button type="button" class="secondary" id="pp-more">나머지 ${rows.length - shown.length}건 더 보기</button></div>` : ''}
  <p class="cr-muted pp-disc">과거 시세로 계산한 결과이며 실제 주문이 아니고 수익을 보장하지 않습니다. ${tip(`다음 거래일 시가보다 ${(r.slippage * 100).toFixed(1)}% 불리하게 체결하고 매매마다 비용 ${(r.cost * 100).toFixed(1)}%로 가정했습니다. 실제 매매는 체결 지연·일부 체결·감정 때문에 이보다 나쁠 수 있습니다.`)}</p></div>`;
  body.querySelectorAll('[data-jf]').forEach(b => b.onclick = () => { S.journalFilter = b.dataset.jf; S.journalAll = false; render(); });
  const more = $('#pp-more'); if (more) more.onclick = () => { S.journalAll = true; render(); };
  body.insertAdjacentHTML('beforeend', '<div id="pp-review"></div>'); renderReview();
}

// ── 규칙만 바꿨다면: 같은 종목·네 기간에 규칙만 바꿔 다시 계산한다(지난 기록이지 예측이 아니다) ──
function scheduleReview() { const id = S.run; setTimeout(() => { if (id !== S.run || !S.last?.inputs) return; try { const i = S.last.inputs; S.review = compareRuleSets({ basket: i.basket, plan: i.plan, capitalKrw: i.capital, candlesBySymbol: i.candles, fxCandles: i.fx, benchmark: i.benchmark, indexes: i.indexes, to: today(), current: { label: `지금 쓴 규칙`, rules: i.rules } }); } catch (e) { S.review = { error: e.message }; } renderReview(); }, 30); }
function renderReview() {
  const box = $('#pp-review'); if (!box) return; const v = S.review;
  if (!v) { box.innerHTML = `<div class="cr-card"><header><h3>규칙만 바꿨다면</h3></header><div class="shimmer ct-skel"></div><p class="cr-muted">같은 종목으로 4개 기간 × 규칙 4개를 다시 계산하는 중…</p></div>`; return; }
  if (v.error) { box.innerHTML = `<div class="cr-card"><header><h3>규칙만 바꿨다면</h3></header><p class="cr-muted">${esc(v.error)}</p></div>`; return; }
  const ws = v.windows.filter(w => v.hold[w.id]), sp = x => `${sg(x)}%`;
  const cellHtml = c => c?.ok ? `<span class="${c.ret >= 0 ? 'up' : 'down'}">${sp(c.ret)}</span><small>그냥 보유 대비 ${sg(c.vsHold)}%p · 최대 하락폭 ${sp(c.mdd)}</small><small>매매 ${c.trades}번 · 막힘 ${c.blocked}건 · 현금 ${c.cashAvg}%</small>` : `<span class="cr-muted">—</span><small>${esc(c?.reason || '')}</small>`;
  const sig = r => ws.map(w => JSON.stringify(r.cells[w.id])).join('|'), cur = v.rows.find(r => r.id === 'current'), twin = cur ? v.rows.find(r => r.id !== 'current' && sig(r) === sig(cur)) : null;
  const rows = v.rows.map(r => `<tr class="${r.id === 'current' ? 'me' : ''}"><td><b>${esc(r.label)}</b>${r.id === 'current' && twin ? `<small>결과 같음: ${esc(twin.label)}</small>` : ''}<small>하루 손실 ${r.rules.dailyLoss}% · 한 종목 최대 ${r.rules.maxSingle}% · 현금 최소 ${r.rules.minCash}% · 30일 매매 ${r.rules.maxTrades30}번</small>${r.prefs ? `<button type="button" class="secondary" data-rv-use="${esc(r.id)}">이 규칙을 규칙 화면에 넣기</button>` : ''}</td>${ws.map(w => `<td>${cellHtml(r.cells[w.id])}</td>`).join('')}</tr>`).join('');
  const hold = `<tr><td><b>그냥 보유</b><small>같은 비중을 한 번 사서 둠</small></td>${ws.map(w => `<td><span class="${v.hold[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.hold[w.id].ret)}</span><small>최대 하락폭 ${sp(v.hold[w.id].mdd)}</small></td>`).join('')}</tr>`;
  const bn = ws.map(w => v.bench[w.id]?.name).find(Boolean), bench = bn ? `<tr><td><b>${esc(bn)}</b><small>지수만 샀다면</small></td>${ws.map(w => v.bench[w.id] ? `<td><span class="${v.bench[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.bench[w.id].ret)}</span><small>최대 하락폭 ${sp(v.bench[w.id].mdd)}</small></td>` : '<td>—</td>').join('')}</tr>` : '';
  const mn = ws.map(w => v.mix?.[w.id]?.name).find(Boolean), mixRow = mn ? `<tr><td><b>지수로만 담은 경우</b><small>${esc(mixPartsOf(mn))} ${tip('국내·미국·현금 비율만 이 계좌와 같게 맞췄습니다. 주식·채권 구성까지 같은 위험은 아닙니다.')}</small></td>${ws.map(w => v.mix[w.id] ? `<td><span class="${v.mix[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.mix[w.id].ret)}</span><small>최대 하락폭 ${sp(v.mix[w.id].mdd)}</small></td>` : '<td>—</td>').join('')}</tr>` : '';
  const main = v.findings.filter(f => ['none', 'mdd', 'worst'].includes(f.key)), rest = v.findings.filter(f => !main.includes(f));
  box.innerHTML = `<div class="cr-card"><header><h3>규칙만 바꿨다면 ${tip('같은 종목에 규칙만 바꿔 3·6·12·18개월(오늘까지)을 다시 계산했습니다. 목표 비중은 각 규칙의 현금 최소·한 종목 최대 비중에 맞춰 줄였습니다. 한 기간의 1등은 그 기간에만 맞춘 규칙이 되기 쉬우니 모든 기간에서 손실이 작은 규칙을 고르세요. 예측이 아니라 지난 기록입니다.')}</h3><span class="cr-muted">${md(v.to)}까지 · 자금 ${won(S.last.inputs.capital)}</span></header>
  <div class="pp-scroll"><table class="pp-rv"><thead><tr><th>규칙</th>${ws.map(w => `<th>${w.label}<small>${md(w.from)}부터</small></th>`).join('')}</tr></thead><tbody>${rows}${hold}${mixRow}${bench}</tbody></table></div>
  <ul class="ct-actions pp-find">${main.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>${rest.length ? `<p class="cr-muted">다른 결론 ${rest.length}개 ${tip(rest.map(f => f.text).join('\n'), '다른 결론')}</p>` : ''}</div>`;
  // 규칙을 여기서 바로 저장하지 않는다: 저장하면 규칙 화면의 확정 절차(이유 적기 · 28일 잠금)를 건너뛴다(2026-11-26 검토에서 확인한 결함).
  // 채워 넣을 값만 넘기고(teamquant:rules-prefill · sessionStorage teamQuantRulesPrefill) 규칙 화면으로 옮긴다. 확정은 규칙 화면에서 한다.
  box.querySelectorAll('[data-rv-use]').forEach(b => b.onclick = () => { const row = v.rows.find(r => r.id === b.dataset.rvUse); if (!row?.prefs) return; const detail = { label: row.label, rules: row.rules, prefs: row.prefs, at: new Date().toISOString() }; try { sessionStorage.setItem('teamQuantRulesPrefill', JSON.stringify(detail)); } catch { } $('[data-view="rules"]')?.click(); window.dispatchEvent(new CustomEvent('teamquant:rules-prefill', { detail })); });
}

// ── 오늘부터 가상 기록(증권사 없이 · 볼 때마다 시작일부터 다시 계산) ──────────
function renderLive() {
  const live = loadLive(), card = $('#pp-live'); card.hidden = !live; $('#pp-start').textContent = live ? '새 기록으로 바꾸기' : '오늘부터 기록 시작';
  if (!live) return;
  card.innerHTML = `<div class="pp-live"><div><b>가상 기록 진행 중</b><br><span class="cr-muted">${md(live.startDate)} 시작 · 자금 ${won(live.capitalKrw)} · 종목 ${live.basket.length}개 (${esc(live.basket.map(b => b.name).join(', '))})<br>${esc(rulesLine(normalizeRules(live.rules || {}).rules))} · 시작할 때의 규칙으로 고정</span></div><div class="cr-actions"><button type="button" class="primary" id="pp-live-run">오늘까지 다시 계산</button><button type="button" class="secondary" id="pp-live-stop">끝내기</button></div></div>`;
  $('#pp-live-run').onclick = () => void run({ live });
  $('#pp-live-stop').onclick = () => { saveLive(null); S.last = null; $('#pp-result').innerHTML = ''; renderLive(); $('#pp-state').textContent = '가상 기록을 끝냈습니다. 이 브라우저에서 지웠습니다.'; };
}
$('#pp-run').onclick = () => void run();
$('#pp-start').onclick = async () => {
  try {
    const capital = Number($('#pp-capital').value); if (!(capital >= 100000)) throw new Error('시작 자금은 10만 원 이상이어야 합니다.');
    const basket = await basketOf();
    if (loadLive() && !confirm('진행 중인 가상 기록을 지우고 오늘부터 새로 시작합니다.')) return;
    const live = { version: PAPER_VERSION, startDate: today(), startedAt: new Date().toISOString(), capitalKrw: capital, basket, plan: planOf(), rules: simRules(), rulesFrom: rulesSource() };
    saveLive(live); renderLive(); void run({ live });
    $('#pp-state').textContent = `${md(live.startDate)}부터 시작했습니다. 볼 때마다 시작일부터 오늘까지 같은 규칙으로 다시 계산합니다.`;
  } catch (e) { $('#pp-state').textContent = e.message; }
};
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page !== 'paper') return; void loadMock(); renderLive(); const live = loadLive(); if (live && !S.last) void run({ live }); });
window.addEventListener('teamquant:state', () => { S.last = null; renderLive(); });
renderLive();

// ── 참고: 같은 규칙을 과거에 적용한 결과(예시 포트폴리오) ───────────────────
(async () => {
  const el = $('#pp-ref-body');
  try {
    const d = await (await fetch('/data/paper-rehearsal.json')).json(), s = d.summary, p = d.portfolios.demo, ws = d.windows;
    const row = w => { const x = p.windows[w.id]; if (!x?.ok) return ''; return `<tr><td>${esc(w.label)}</td><td class="${tone(x.metrics.rule.ret)}">${pct(x.metrics.rule.ret)}</td><td>${pct(x.metrics.hold.ret)}</td><td>${x.metrics.bench ? pct(x.metrics.bench.ret) : '—'}</td><td>${pct(x.metrics.rule.mdd, 0)} / ${pct(x.metrics.hold.mdd, 0)}</td></tr>`; };
    el.innerHTML = `<p class="cr-muted">예시 포트폴리오 4개 × 9개 기간(${s.cells}칸) · 자금 ${won(d.capitalKrw)} · ${md(d.generatedAt)} 계산</p>
    <ul class="ct-actions pp-find"><li>수익률: 그냥 보유보다 중간값 <b>${pp(s.medianRetDiffVsHoldPct)}</b> (그냥 보유보다 나은 칸 ${(s.shareBetterRetThanHold * 100).toFixed(0)}%)</li><li>최대 하락폭: 중간값 <b>${s.medianMddDiffVsHoldPct.toFixed(1)}%p</b> 작음 (더 작은 칸 ${(s.shareSmallerMddThanHold * 100).toFixed(0)}%)</li><li>지수 대비 ${pp(s.medianRetDiffVsBenchPct)} · 비용 자금의 ${s.medianCostPct.toFixed(2)}% · 매매 1년에 ${s.medianTradesPerYear.toFixed(0)}번 · 현금 평균 ${s.medianCashAvgPct.toFixed(0)}%</li></ul>
    <p class="cr-muted pp-meta">${esc(p.label)} (지수 ${esc(p.benchmark.name)})</p><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>기간</th><th>규칙대로</th><th>그냥 보유</th><th>지수</th><th>최대 하락폭 규칙/보유</th></tr></thead><tbody>${ws.map(row).join('')}</tbody></table></div>`;
  } catch { el.innerHTML = '<p class="cr-muted">참고 자료를 불러오지 못했습니다.</p>'; }
})();

// ── 팀 모의계좌(팀 PC의 paper-live · 없으면 하루 1번 공개 자료) ──────────────────────
// 주문 줄은 팀 PC에 연결했을 때만 보인다. 미리보기는 주문하지 않고, 주문은 두 번 눌러야 나간다(대화상자 없이).
const K = { status: null, preview: null, armed: false };
let PLAN_DOC = null; // data/paper-plan.json (근거·과거 확인 포함)
let IPO_EVENTS = null; async function loadIpoEvents() { if (IPO_EVENTS !== null) return IPO_EVENTS; try { const r = await fetch('/data/ipo-events.json'); IPO_EVENTS = r.ok ? await r.json() : false; } catch { IPO_EVENTS = false; } return IPO_EVENTS; }
// 대형 상장 일정(결정 52): 공모액 25억 달러 이상 상장을 기록으로만 보인다 — 사전 등록 사건연구에서 상장 전후·보호예수 해제의 같은 업종 대형주 수익률이 뚜렷하게 낮지 않아 매매에 연결하지 않는다.
function eventsHtml() { const d = IPO_EVENTS; if (!d || !Array.isArray(d.events) || !d.events.length) return ''; const t = tip(`공모액 ${(d.minUsdM || 2500) / 100}억 달러 이상 대형 상장의 상장일과 보호예수(락업) 해제일입니다. 2012~2026년 미국 최대 상장 23건에서 같은 업종 대형주는 상장 전·직후·해제일 어느 때도 시장보다 뚜렷하게 떨어지지 않았습니다. 그래서 기록만 하고 매매를 막거나 일으키지 않습니다. 출처: Nasdaq 상장 일정(공식 제공 아님). 해제일은 확인 전까지 상장일+180일로 추정합니다.`); const rows = d.events.slice(0, 4).map(e => `${e.date ? esc(md(e.date)) : '예정'} ${esc(e.issuer)}${e.ticker ? ` (${esc(e.ticker)})` : ''} ${Math.round(e.sizeUsdM / 100).toLocaleString('ko-KR')}억 달러${e.lockupDate ? ` · 보호예수 해제 ${esc(md(e.lockupDate))}` : ''}`).join('<br>'); return `<p class="pp-kis-note">대형 상장 일정(참고만) ${t}<br><small class="cr-muted">${rows}</small></p>`; }
async function loadPlanDoc() { if (PLAN_DOC !== null) return PLAN_DOC; try { const r = await fetch('/data/paper-plan.json'); PLAN_DOC = r.ok ? await r.json() : false; } catch { PLAN_DOC = false; } return PLAN_DOC; }
// 팀 계좌는 팀 PC의 계획(팀 기본 계획)을 따른다. 방문자 브라우저에 저장한 '내 계획'으로 이름을 바꾸지 않는다(2026-11-26 검토: 화면 이름이 실제와 달랐다).
function planForKis() { if (PLAN_DOC) return { label: `팀 기본 계획 (${md(PLAN_DOC.asOf)} 기준 · ${Object.keys(PLAN_DOC.weights || {}).length}종목 · 현금 ${PLAN_DOC.cashPct}%)`, source: 'default' }; return { label: '팀 기본 계획', source: 'none' }; }
// 근거 카드 계획(PP3~): 지금 기준을 표로 보이고, 그 기준을 과거에 적용한 결과를 기간별로 보인다(정할 때 쓴 기간 · 확인 기간). 기준은 팀 PC에서만 바꾼다.
function thesisDocHtml(d) { const w = Object.values(d.weights).sort((a, b) => b.pct - a.pct), role = x => x.role === 'core' ? '지수 ETF' : x.role === 'exit' ? '정리' : x.role === 'satellite' ? `개별 종목 · 분할 매수 ${x.tranche || 1}/3 · 목표 ${x.targetPct}%` : '—', bt = d.backtest, sc = d.screening;
  const cell = s => s ? `${sg(s.excessVsAllPp)}%p<br><small class="cr-muted">${Math.abs(Number(s.t)) < 2 ? '우연과 구별 안 됨 · ' : ''}전체보다 나은 달 ${s.hitPct}% ${tip(`t ${s.t} · ${s.months}개월 · 평균 ${s.avgPass}종목 통과`)}</small>` : '—';
  return `<details class="pp-kis-plan"><summary>계획 기준 보기 <small class="cr-muted">(재무 ${esc(md(d.asOf))} 기준)</small></summary>
  <h4>지금 기준 ${tip('이 표가 종목을 고르고 사고파는 기준 전부입니다. 기준이 바뀌면 다음 장에서 비중 맞추기 주문이 나갑니다. 기준은 팀 PC에서만 바꿀 수 있습니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><tbody>${(d.criteria || []).map(([k, v]) => `<tr><td><b>${esc(termFix(k))}</b></td><td class="pp-wrap">${esc(termFix(v))}</td></tr>`).join('')}</tbody></table></div>
  ${sc ? `<p class="pp-kis-note">심사 ${sc.cards}개 기업 · 통과 ${sc.pass} · 대기(주가에 이미 많이 반영) ${sc.wait} · 탈락 ${sc.fail} · 자료 없음 ${sc.nodata}</p>` : ''}
  <h4>이 기준을 과거에 적용한 결과 ${tip('매달 말 그때 공개된 재무와 그 달의 매출 성장 전망만으로 같은 기준을 적용해 통과 종목을 고르고, 다음 달 수익을 같은 시장 비교 기업 전체(같은 비중)와 비교한 월평균 차이입니다. 기준값은 과거 결과에 맞춰 고치지 않았습니다. 비교 기업이 지금 고른 98개라 살아남은 기업만 있고, 통과 종목이 3~7개뿐이라 우연일 수 있습니다(t가 2보다 작으면 우연과 구별 안 됨). 비용·세금은 넣지 않았습니다.')}</h4>
  ${bt ? `<div class="pp-scroll"><table class="pp-ref"><thead><tr><th>기간</th><th>국내: 통과 − 전체(월)</th><th>미국: 통과 − 전체(월)</th></tr></thead><tbody>${[['~2020', '~2020 (정할 때 쓴 기간)'], ['2021~', `2021~ (확인 기간) ${tip('규칙을 정할 때 안 쓴 기간입니다.')}`], ['all', '전체']].map(([k, lab]) => `<tr><td>${lab}</td><td>${cell(bt.periods[k]?.KR)}</td><td>${cell(bt.periods[k]?.US)}</td></tr>`).join('')}</tbody></table></div><p class="cr-muted">확인 기간(2021~)에 국내는 우연과 구별되지 않고 미국은 애매합니다. 앞으로는 팀 모의계좌의 '개별 종목 · 지수 대비'로 확인합니다.</p>` : '<p class="cr-muted">과거 확인 자료가 없습니다.</p>'}
  <h4>비중</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>비중</th><th>역할</th><th>이유</th></tr></thead><tbody>${w.map(x => `<tr><td>${esc(x.name)}<br><small class="cr-muted">${x.currency === 'USD' ? '달러' : '원화'} · ${esc(x.sectorName || x.sector || '')}</small></td><td>${x.pct}%</td><td>${role(x)}</td><td class="pp-wrap"><small>${(x.why || []).map(y => esc(termFix(y))).join(' · ')}</small></td></tr>`).join('')}<tr><td>현금</td><td>${d.cashPct}%</td><td colspan="2"><small class="cr-muted">급락 대비 ${d.reservePct ?? '—'}% + 분할 매수 대기 ${d.waitingPct ?? '—'}%</small></td></tr></tbody></table></div>
  <h4>방법</h4><ul class="pp-steps">${(d.method || []).map(m => `<li>${esc(termFix(m))}</li>`).join('')}</ul></details>`; }
function planDocHtml(d) { if (!d) return ''; if (Array.isArray(d.criteria)) return thesisDocHtml(d); const w = Object.values(d.weights).sort((a, b) => b.pct - a.pct), v = d.validation || {}, wins = (v.windows || []).filter(x => x.ok), sc = v.scenarios || [];
  const row = x => `<tr><td>${esc(x.label)}</td><td class="${x.plan.rule.ret >= 0 ? 'up' : 'down'}">${sg(x.plan.rule.ret)}%</td><td>${sg(x.plan.rule.mdd)}%</td><td>${sg(x.plan.hold.ret)}%</td><td>${x.kodex200 ? sg(x.kodex200.ret) + '%' : '—'}</td><td>${x.spy ? sg(x.spy.ret) + '%' : '—'}</td></tr>`;
  return `<details class="pp-kis-plan"><summary>계획 기준 보기 <small class="cr-muted">(${esc(md(d.asOf))} 기준)</small></summary>
  <h4>방법</h4><ul class="pp-steps">${(d.method || []).map(m => `<li>${esc(termFix(m))}</li>`).join('')}</ul>
  <h4>비중</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>비중</th><th>섹터</th><th>변동성(연)</th><th>이유 · 관련 이슈</th></tr></thead><tbody>${w.map(x => `<tr><td>${esc(x.name)}<br><small class="cr-muted">${x.currency === 'USD' ? '달러' : '원화'} · ${esc(x.country)}</small></td><td>${x.pct}%</td><td>${esc(x.sectorName)}</td><td>${x.vol1y}%</td><td class="pp-wrap"><small>${(x.why || []).map(esc).join(' · ')}${x.exposure?.length ? '<br>관련 이슈: ' + x.exposure.map(esc).join(' / ') : ''}</small></td></tr>`).join('')}<tr><td>현금</td><td>${d.cashPct}%</td><td colspan="3"></td></tr></tbody></table></div>
  <h4>같은 규칙을 과거에 적용한 결과 ${tip('이 계획을 지금 규칙대로 돌렸을 때(주 1번 점검 · 주문 점검 · 다음 거래일 시가 체결 · 비용 포함)의 수익률과 최대 하락폭입니다. 그냥 보유는 같은 비중으로 한 번 사서 둔 경우입니다. 2020~2025는 규칙을 확정하기 전 기간이라 완전한 확인은 아닙니다. 오르는 장에서 그냥 보유보다 낮은 것은 이 규칙의 알려진 비용입니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>기간</th><th>규칙대로</th><th>최대 하락폭</th><th>그냥 보유</th><th>KODEX 200</th><th>S&P500</th></tr></thead><tbody>${wins.map(row).join('')}</tbody></table></div>
  <h4>급락하면 ${tip('섹터·통화별로 한꺼번에 크게 떨어진다고 가정했을 때 이 계획이 바로 입는 손실(%)입니다. 과거 비슷한 크기: 2022 반도체 −35~−45%, 2020-03 코스피 −35%, 2022 S&P500 −25%, 2022 장기채 −31%. 예측이 아니라 손실 크기를 보는 값입니다.')}</h4><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>상황</th><th>이 계획</th><th>같은 비중</th><th>코스피200만 샀다면</th><th>지금 팀 모의계좌</th></tr></thead><tbody>${sc.map(x => `<tr><td>${esc(x.name)}</td><td class="down">${sg(x.planPct)}%</td><td>${sg(x.equalPct)}%</td><td>${sg(x.kodexOnlyPct)}%</td><td>${sg(x.currentPct)}%</td></tr>`).join('')}</tbody></table></div>
  <p class="cr-muted">${esc(v.note || '')}</p></details>`; }
// 자동 매매 띠('자세히' 안): 지금 돌아가고 있는지를 칸별로 보인다(자동 매매 · 마지막 자동 주문 · 다음 점검 · 계획 반영 · 투자 비중). 카드 제목의 상태도 여기서 쓴다.
function statusStrip(s) {
  const rs = runState(s), inv = invested(s), nc = nextChecks(s), gaps = planGaps(s), la = lastAuto(s);
  const t = $('#pp-kis-title-state'); if (t) { t.textContent = rs.label; t.className = rs.state === 'running' ? 'run' : 'stop'; }
  const ap = ['KR', 'US'].map(m => { const a = planAppliedFor(s, m); return `${MARKET_NAME[m]} <span class="${a.applied === false ? 'stop' : ''}">${esc(a.label)}</span>`; }).join(' · ');
  const f0 = v => v === null || v === undefined ? '—' : `${Number(v).toFixed(0)}%`;
  return `<div class="pp-strip">
  <div><span>자동 매매 ${tip('자동 매매가 켜져 있고 이틀 안에 기록이 있으면 \'진행 중\', 꺼졌으면 \'정지\', 이틀 넘게 기록이 없으면 \'팀 PC 꺼짐\', 전체 정지를 눌렀으면 \'전체 정지\'입니다. 설정을 읽지 못하면 최근 7일의 자동 주문 기록으로 짐작합니다.')}</span><b class="${rs.state === 'running' ? 'run' : 'stop'}">${esc(rs.label)}</b><small>${rs.lastMarkDate ? `마지막 기록 ${esc(md(rs.lastMarkDate))}` : '기록 없음'}${rs.inferred && rs.state !== 'killed' ? ' · 설정을 읽지 못해 기록으로 짐작' : ''} · ${s.live ? '실시간' : '하루 1번 공개'}</small></div>
  <div><span>마지막 자동 주문 ${tip('팀 PC가 시장마다 하루 1번 자동으로 낸 주문 기록입니다(한국 시간). \'주문\'은 모의 서버가 받은 주문 수, \'막힘\'은 주문 점검에 걸린 수입니다.')}</span>${la ? `<b>${esc(kst(la.at))}</b><small>${esc(MARKET_NAME[la.market] || la.market || '')} · ${esc(termFix(la.reason || ''))} · 주문 ${la.sent}건 · 막힘 ${la.blocked}건${la.topBlock ? `<br>주로 막힌 이유: ${esc(termFix(la.topBlock))}` : ''}</small>` : '<b>없음</b><small>아직 자동 주문 기록이 없습니다</small>'}</div>
  <div><span>다음 점검 ${tip(nc.note)}</span>${nc.checks.map(c => `<b>${esc(c.name)} ${esc(termFix(c.kst))}</b>`).join('<br>') || '<b>—</b>'}<small>${esc(nc.cadenceLabel)} · 계획을 바꿨을 때·처음 시작·급할 때는 그날 바로</small></div>
  <div><span>계획 반영 ${tip('지금 계획으로 시장별 주문이 실제로 나갔는지 보여 줍니다. \'아직\'은 안 나갔거나 실행했지만 전부 막힌 상태입니다.')}</span><b>${ap}</b></div>
  <div><span>투자 비중 ${tip('총자산 중 주식에 들어간 비율입니다(지금 / 계획). 차이가 크면 아직 못 산 종목이 있다는 뜻이고, 이유는 \'아직 못 삼\' 줄에 적습니다. 계좌 전부가 아니라 계획이 정한 만큼만 사는 것이 정상입니다.')}</span><b>지금 ${f0(inv.nowPct)} · 계획 ${f0(inv.planPct)}</b><small>${gaps.map(g => `${esc(g.name)} ${g.heldPct === null ? '—' : g.heldPct + '%'} / 계획 ${g.planPct}%`).join(' · ')}</small></div></div>`;
}
// 목표와 10%p 넘게 차이 나는 시장: 숫자 타일 바로 밑에 둔다(접어 두지 않음).
function gapHtml(s) { return planGaps(s).filter(g => g.reason).map(g => `<div class="pp-gap">${esc(g.name)}: 계획 ${g.planPct}%${g.heldPct > 0 ? ` 중 ${g.gapPct}%p` : ''} 아직 못 삼 (이유: ${esc(termFix(g.reason))}) ${tip('목표와 10%p 넘게 차이 나는 시장입니다. 이유는 그 시장의 마지막 자동 주문 기록(주문·막힘 건수, 가장 많이 막힌 이유)에서 가져왔습니다. 다음 자동 주문 때 다시 삽니다.')}</div>`).join(''); }
// 숫자 타일 밑 한 줄: 마지막 자동 주문과 다음 점검.
function statusLine(s) {
  const la = lastAuto(s), next = nextChecks(s).checks.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
  const parts = [la ? `마지막 자동 주문 <b>${esc(kst(la.at))}</b> (주문 ${la.sent}건 · 막힘 ${la.blocked}건)` : '아직 자동 주문 기록 없음', next ? `다음 점검 ${esc(next.name)} ${esc(termFix(next.kst))}` : ''].filter(Boolean);
  return `<p class="pp-line">${parts.join(' · ')}</p>`;
}
// 맨 위 숫자: 총자산 · 원금 대비 · 전날 대비(값이 있을 때만) · 지수 대비 · 현금. 원금은 서버가 준 값(모의계좌를 열 때 받은 가상 예수금), 없으면 첫 기록일의 총자산을 원금으로 보고 그렇게 적는다.
// 총자산 선: 폭에 맞춰 늘고(preserveAspectRatio none) 날짜는 SVG 밖 글자로 둔다(작은 화면에서 글자가 줄지 않게).
function sparkSvg(marks, base) { const ms = (marks || []).filter(m => m.total > 0).slice(-90); if (ms.length < 2) return ''; const W = 1000, H = 100, T = 6, B = 6, vs = ms.map(m => m.total), lo = Math.min(...vs, base || Infinity), hi = Math.max(...vs, base || -Infinity), pad = Math.max((hi - lo) * 0.15, hi * 0.001), y = v => T + (hi + pad - v) / (hi - lo + 2 * pad) * (H - T - B), x = i => i * W / (ms.length - 1);
  return `<div class="pp-spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="날마다 총자산 ${esc(md(ms[0].date))} ${won(ms[0].total)} → ${esc(md(ms.at(-1).date))} ${won(ms.at(-1).total)}">${base ? `<line x1="0" x2="${W}" y1="${y(base).toFixed(1)}" y2="${y(base).toFixed(1)}"/>` : ''}<polyline points="${ms.map((m, i) => `${x(i).toFixed(1)},${y(m.total).toFixed(1)}`).join(' ')}"/></svg><div class="pp-spark-axis"><span>${esc(md(ms[0].date))}</span>${base ? '<span>점선 = 원금</span>' : ''}<span>${esc(md(ms.at(-1).date))}</span></div></div>`; }
function heroHtml(s) {
  const b = s.balance, marks = s.marks || [], m1 = marks.at(-1), m0 = marks.at(-2), total = Number.isFinite(b?.total) ? b.total : m1?.total; if (!Number.isFinite(total)) return '';
  const principal = Number.isFinite(s.principalKrw) && s.principalKrw > 0 ? s.principalKrw : null, first = marks[0], base = principal ?? first?.total ?? null, pnl = base ? total - base : null, bm = s.benchmark;
  const day = m0 && m1 ? m1.total - m0.total : null, cashPct = b && total > 0 ? b.cash / total * 100 : null, planCash = Number.isFinite(s.planDoc?.cashPct) ? s.planDoc.cashPct : null;
  const tiles = [
    `<div><span>원금 대비 ${tip(principal ? '원금은 모의계좌를 열 때 받은 가상 예수금입니다(실제 돈 아님). 체결은 한국투자증권 모의 서버 기준이라 실제 수수료·세금과 다를 수 있습니다.' : '원금 정보가 없어 첫 기록일의 총자산을 원금으로 봤습니다.')}</span><b class="${tone(pnl)}">${swon(pnl)}</b><small class="${tone(pnl)}">${base ? pct(total / base - 1, 2) : '—'}</small><small>${principal ? '원금' : `${esc(md(first?.date))} 총자산`} ${won(base)}</small></div>`,
    day === null ? '' : `<div><span>전날 대비</span><b class="${tone(day)}">${swon(day)}</b><small class="${tone(day)}">${pct(m1.total / m0.total - 1, 2)}</small><small>${esc(md(m0.date))} → ${esc(md(m1.date))}</small></div>`,
    `<div><span>지수 대비 ${tip('같은 기간 같은 비율로 지수에만 담았을 때(국내 KODEX 200 · 미국 S&P500 ETF · 현금 비중 같게)와의 차이입니다. +면 지수보다 낫고 −면 못합니다.')}</span><b class="${tone(bm?.diffPp)}">${Number.isFinite(bm?.diffPp) ? pp(bm.diffPp) : '—'}</b><small>${Number.isFinite(bm?.diffPp) ? `이 계좌 ${pct(bm.ownRetPct / 100)} · 지수로만 ${pct(bm.benchRetPct / 100)} · ${esc(md(bm.from))}부터` : '비교 자료 없음'}</small></div>`,
    `<div><span>현금</span><b>${b ? won(b.cash) : '—'}</b><small>${cashPct === null ? '' : `${cashPct.toFixed(0)}%`}${planCash === null ? '' : ` · 계획 ${planCash}%`}</small></div>`
  ].filter(Boolean);
  return `<div class="pp-hero" style="--pp-n:${tiles.length}">
  <div><span>총자산 ${tip('주식 평가액(미국 주식은 원화 환산) + 현금입니다. 한국투자증권 모의계좌는 미국 주식을 사도 원화 예수금이 줄지 않아서, 산 금액만큼 현금에서 뺐습니다.')}</span><b>${won(total)}</b><small>${m1 ? `${esc(md(m1.date))} 기록` : ''}${s.live ? ' · 실시간' : ' · 하루 1번 공개'}</small></div>${tiles.join('')}
</div>${sparkSvg(marks, principal)}`;
}
// 보유표: 평균단가·현재가·손익. 미국 종목의 수익률은 달러 기준(환율 변화 제외)이고 손익(원)은 지금 환율로 환산한 값이다. 담은 이유는 줄마다 펼친다.
// 규칙 지킴 한 줄: 이 계좌 자신의 규칙(팀 PC에 저장한 것, 없으면 기본 규칙)으로 날마다 기록을 잰다. 자세한 것은 규칙 화면.
function adherenceHtml(s) { try { const rules = normalizeRules(s.prefs?.rules || {}).rules, r = reviewRules(s, rules), hist = (s.prefsHistory || []).filter(x => !(x.changed || []).includes('init')).length; if (!r.days) return ''; const broke = r.dailyBreaches > 0 || r.trades30 > rules.maxTrades30; return `<p class="pp-kis-note pp-adh">${broke ? '<b class="cr-err">규칙 어김</b>' : '규칙 지킴'} · 하루 손실 한도(${rules.dailyLoss}%) 넘은 날 <b class="${r.dailyBreaches ? 'cr-err' : ''}">${r.dailyBreaches}일</b> / ${Math.max(0, r.days - 1)}일 · 30일 매매 <b class="${r.trades30 > rules.maxTrades30 ? 'cr-err' : ''}">${r.trades30}</b>/${rules.maxTrades30}번 · 규칙 변경 <b>${hist}회</b> ${tip('팀 모의계좌 규칙으로 날마다 기록을 잰 값입니다. 한 번에 낸 비중 맞추기 주문은 매매 1번으로 셉니다. 20거래일이 지나기 전에는 판단하기 이릅니다.')} <button type="button" class="text-button" data-core-go="rules">규칙 보기</button></p>`; } catch { return ''; } }
function holdTable(s, { plan = true } = {}) {
  const w = s.planDoc?.weights || {}, total = s.balance?.total, ps = (s.balance?.positions || []).filter(p => p.qty > 0).sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0)); if (!ps.length) return '<p class="cr-muted">보유 종목이 없습니다.</p>';
  const px = (p, v) => !Number.isFinite(v) ? '—' : p.currency === 'USD' ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : won(v);
  const rows = ps.map(p => { const r = p.avgCost > 0 && p.price > 0 ? p.price / p.avgCost - 1 : null, pnl = r !== null && Number.isFinite(p.valueKrw) ? p.valueKrw - p.valueKrw / (1 + r) : null, wt = total > 0 && Number.isFinite(p.valueKrw) ? p.valueKrw / total * 100 : null, v = w[p.symbol]; return { p, r, pnl, wt, v }; });
  const sumV = rows.reduce((a, x) => a + (x.p.valueKrw || 0), 0), sumP = rows.reduce((a, x) => a + (x.pnl || 0), 0), cost = sumV - sumP;
  const why = v => !(v?.pct > 0) ? '<b>계획에 없음</b> · 정리 대상' : `<b>목표 ${v.pct}%${v.targetPct ? ` (분할 매수가 끝나면 ${v.targetPct}%)` : ''}</b>${v.sectorName ? ` · ${esc(v.sectorName)}` : ''}${(v.why || []).length ? `<br>${v.why.map(y => esc(termFix(y))).join('<br>')}` : ''}${v.exposure?.length ? `<br>관련 이슈: ${v.exposure.map(esc).join(' / ')}` : ''}`;
  const t1 = '수익률은 평균단가 대비입니다(미국 종목은 달러 기준이라 환율 변화가 빠짐). 손익은 지금 환율로 환산한 원화입니다.';
  return `<h4 class="pp-h4">보유 ${ps.length}종목 ${tip(plan ? `${t1} 비중은 총자산 대비이고 괄호 안은 목표 비중입니다. '담은 이유'를 누르면 계획의 근거가 열립니다.` : t1)}</h4><div class="pp-scroll"><table class="pp-hold"><thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가액</th><th>손익</th><th>수익률</th><th>${plan ? '비중(목표)' : '비중'}</th></tr></thead><tbody>${rows.map(({ p, r, pnl, wt, v }) => `<tr><td>${esc(p.name)} <small class="cr-muted">${esc(p.symbol)}</small>${plan ? '<button type="button" class="text-button" data-why aria-expanded="false">담은 이유</button>' : ''}</td><td>${p.qty}</td><td>${px(p, p.avgCost)}</td><td>${px(p, p.price)}</td><td>${won(p.valueKrw)}</td><td class="${tone(pnl)}">${swon(pnl)}</td><td class="${tone(r)}">${r === null ? '—' : pct(r, 2)}</td><td>${wt === null ? '—' : wt.toFixed(1) + '%'}${!plan ? '' : v?.pct > 0 ? ` <small class="cr-muted">(${v.pct}%)</small>` : ' <small class="cr-muted">(정리)</small>'}</td></tr><tr class="pp-whyrow" hidden><td colspan="8">${why(v)}</td></tr>`).join('')}</tbody><tfoot><tr><td>합계</td><td></td><td></td><td></td><td>${won(sumV)}</td><td class="${tone(sumP)}">${swon(sumP)}</td><td class="${tone(sumP)}">${cost > 0 ? pct(sumP / cost, 2) : '—'}</td><td>${total > 0 ? (sumV / total * 100).toFixed(1) + '%' : '—'}</td></tr></tfoot></table></div>`;
}
document.addEventListener('click', e => { const b = e.target.closest?.('.pp-hold [data-why]'); if (!b) return; const row = b.closest('tr')?.nextElementSibling; if (row) { row.hidden = !row.hidden; b.textContent = row.hidden ? '담은 이유' : '접기'; b.setAttribute('aria-expanded', row.hidden ? 'false' : 'true'); } });
function holdingsTable(s, { missOnly = false } = {}) {
  const w = s.planDoc?.weights || {}, ps = (s.balance?.positions || []).filter(p => p.qty > 0).sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0)), nh = plannedNotHeld(s), cur = c => c === 'USD' ? '달러' : '원화';
  const why = p => { const v = w[p.symbol]; if (!(v?.pct > 0)) return '<span class="stop">계획에 없음(정리 대상)</span>'; return `<b>목표 ${v.pct}%</b>${v.sectorName ? ` · ${esc(v.sectorName)}` : ''}${v.vol1y ? ` · 변동성 연 ${esc(v.vol1y)}%` : ''}${(v.why || []).length ? `<br>${v.why.map(esc).join(' · ')}` : ''}${v.exposure?.length ? `<br>관련 이슈: ${v.exposure.map(esc).join(' / ')}` : ''}`; };
  const held = ps.length ? `<details class="pp-kis-plan" open id="pp-kis-held"><summary>보유 ${ps.length}종목 ${tip('담은 이유는 팀 기본 계획의 종목별 메모입니다. 오를 종목을 고른 것이 아니라 위험을 나눠 담은 것입니다.')}</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수량</th><th>평가액</th><th>비중</th><th>담은 이유</th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.name)}<br><small class="cr-muted">${esc(p.symbol)} · ${cur(p.currency)}</small></td><td>${p.qty}</td><td>${won(p.valueKrw)}</td><td>${Number.isFinite(p.weightPct) ? p.weightPct.toFixed(1) + '%' : '—'}</td><td class="pp-why">${why(p)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  const miss = nh.length ? `<details class="pp-kis-plan" open id="pp-kis-missing"><summary>아직 안 산 종목 ${nh.length}개 (목표 합 ${nh.reduce((a, b) => a + b.pct, 0).toFixed(1)}%) ${tip('계획에는 있지만 아직 안 산 종목입니다. 목표 비중과 이유는 마지막 주문·자동 주문 기록에서 가져왔고, 다음 자동 주문(계획을 바꿨을 때·금요일) 때 다시 삽니다.')}</summary><ul class="pp-kis-items">${nh.map(n => `<li class="bad"><span class="st">${esc(n.name)}</span> <small class="cr-muted pp-inline">${esc(n.symbol)} · ${cur(n.currency)}</small> · 목표 ${n.pct}%<small>${esc(termFix(n.reason))}</small></li>`).join('')}</ul></details>` : '';
  return (missOnly ? '' : held) + miss;
}
function activityHtml(s) { const a = s.activity30; if (!a) return ''; const has = v => v !== null && v !== undefined;
  const more = [`같은 날 묶어 낸 비중 맞추기 주문은 매매 1번으로 셉니다${a.batches ? `(이번 30일 ${a.batches}번)` : ''}. 주문은 여러 건이라 주문·체결 건수를 따로 적습니다.`, has(a.turnoverPct) ? `사고판 금액 ${a.turnoverPct}%(총자산 대비)` : '', has(a.fillRatePct) ? `전량 체결 ${a.fillRatePct}%` : '', has(a.slipBp) ? `체결 가격 차이 평균 ${sg(Math.round(a.slipBp) / 100)}%(계산할 때 시세보다 불리하게 체결된 만큼 · 지정가 여유 0.5% 안에서 체결되면 보통 +0.5% 아래)` : '', a.rejected ? `거부 ${a.rejected}건` : '', a.notFound ? `확인 안 됨 ${a.notFound}건` : ''].filter(Boolean);
  return `<p class="pp-kis-note">최근 30일 · 매매 <b>${a.decisions}</b>번 · 주문 <b>${a.orders}</b>건 · 체결 <b>${a.fills}</b>건 ${tip(more.join('\n'))}</p>`; }
// 점검 항목은 서버가 주는 items[] 그대로 그린다(새 항목, 예: 마감 뒤 남은 미체결도 자동으로 보인다). 목표(target)를 넘으면 붉게.
function integrityHtml(s) { const g = s.integrity; if (!g) return ''; return `<p class="pp-kis-note">주문 오류 점검 <b class="${g.ok ? '' : 'cr-err'}">${g.ok ? '이상 없음' : '확인 필요'}</b> · ${(g.items || []).map(i => `${esc(SYSTEM_CHECK_LABEL[i.key] || i.label || i.key || '')} <b class="${(i.count || 0) > (i.target || 0) ? 'cr-err' : ''}">${i.count ?? 0}건</b>`).join(' · ')}${g.pending ? ` · 진행 중 ${g.pending}건` : ''} ${tip('주문·기록 오류 건수입니다. 모두 0건이 정상입니다. 0건이라고 안전이 증명되지는 않아 일부러 오류를 만든 테스트도 함께 돌립니다.')}</p>`; }
function sleeveHtml(s) { const v = s.sleeve; if (!v) return ''; const t = tip('개별 종목을 고른 것이 지수보다 나았는지 따로 봅니다. 종목마다 처음 산 날부터 같은 나라 지수(KODEX 200 · S&P500 ETF)와 비교하고, 많이 담은 종목을 더 크게 쳐서 합쳤습니다. 단계는 분할 매수 진행입니다(1 = 목표의 60%, 2 = 80%, 3 = 100%).'); if (!v.n) return `<p class="pp-kis-note">개별 종목 <b>—</b> <span class="cr-muted">(아직 체결된 개별 종목 없음)</span> ${t}</p>`; return `<p class="pp-kis-note">개별 종목 ${v.n}종목 · 지수 대비 <b class="${v.excessPp >= 0 ? '' : 'cr-err'}">${pp(v.excessPp)}</b> ${t}</p><details class="pp-kis-plan"><summary>개별 종목별 성적</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수익률</th><th>지수</th><th>차이</th><th>분할 매수</th></tr></thead><tbody>${v.items.map(i => `<tr><td>${esc(i.name)}<br><small class="cr-muted">${esc(md(i.since))}부터</small></td><td>${pct(i.returnPct)}</td><td>${i.indexPct == null ? '—' : pct(i.indexPct)}</td><td>${i.excessPct == null ? '—' : pct(i.excessPct)}</td><td>${i.step ?? 1}/3</td></tr>`).join('')}</tbody></table></div></details>`; }
// 급락 대비 현금(결정 46): 공포지수(VIX) 30·40·50 단계로 남겨 둔 현금을 지수 ETF에 더 산다. 개별 종목이 아니라 지수에만 쓴다.
function fearHtml(s) { const f = s.fear; if (!f) return ''; const steps = f.steps || [30, 40, 50], n = steps.length, t = tip(`총자산의 ${f.reservePct ?? 15}%는 시장 전체가 크게 빠질 때 지수를 더 사려고 남겨 둔 급락 대비 현금입니다. 공포지수(VIX) 장 마감 값이 ${steps.join('·')}을 넘을 때마다 1/${n}씩 지수 ETF(S&P500 ETF · KODEX 200)를 더 사고, S&P500 ETF가 최고가를 새로 쓰면 단계를 풀어 현금을 다시 채웁니다. 1990년 이후 S&P500·나스닥100·코스피의 10년 단위 기간 75~100%에서 이 현금을 그냥 둔 경우보다 나았고(연 +0.4~0.9%p), 처음부터 전부 투자한 경우와는 거의 같았습니다. 산 뒤 가장 크게 더 빠진 경우는 −44%(코스피 1997)입니다. 개별 종목의 하락 시 추가 매수는 이 규칙이 아니라 하락 시 추가 매수 확인이 정합니다.`); const last = (f.log || []).at(-1); return `<p class="pp-kis-note">급락 대비 현금 <b class="${f.step > 0 ? 'cr-err' : ''}">${f.step}/${n} 투입</b>${f.vix != null ? ` · 공포지수(VIX) ${Number(f.vix).toFixed(1)}${f.asOf ? ` (${esc(md(f.asOf))})` : ''}${f.stale ? ' <span class="cr-err">늦음</span>' : ''}` : ' · 공포지수(VIX) —'}${f.step > 0 ? ` · 지수 ETF에 +${f.pp}%p` : ''}${last ? `<br><small class="cr-muted">${esc(md(last.at))} ${esc(termFix(last.reason || ''))}</small>` : ''} ${t}</p>`; }
function issuesHtml(s) {
  const xs = s.issues || [], act = xs.filter(i => i.level !== 'note'), notes = xs.filter(i => i.level === 'note'), w = s.planDoc?.weights || {};
  const dc = Object.entries(s.dipCards || {}).filter(([, c]) => c && !c.expired), LAB = { allow: '허용', hold: '보류', forbid: '금지' };
  const help = tip('개별 종목의 공시(국내 금융감독원 전자공시(DART) · 미국 SEC)와 뉴스 제목(2곳 이상 보도)을 10분마다 확인합니다.\n주의(수사·규제·경영진·회계·리콜·유상증자 등): 그 종목을 14일 동안 더 사지 않습니다.\n긴급(횡령·배임·감사의견·거래정지·주요 계약 해지 등): 목표 비중을 절반으로 줄입니다.\n소송·과징금·파업 기사는 기록만 합니다.\n하락 시 추가 매수는 사람이 하루 1번 떨어진 이유·제외 조건을 보고 허용한 종목만 첫 매수가의 −15%·−30%에서 더 삽니다.', '보유 종목 이슈 설명');
  const head = act.length ? `보유 종목 이슈 <b class="cr-err">${act.length}건</b>` : '보유 종목 이슈: <b>없음</b>';
  const li = (i, cls, label, what) => `<li class="${cls}"><span class="st">${label}</span> · ${esc(i.name)} — ${what}${i.until ? ` (${esc(md(i.until))}까지)` : ''}<small>${esc(i.source || '')} ${esc(md(i.date))} · ${esc(termFix(i.reason || ''))}</small></li>`;
  const list = [...act.map(i => li(i, 'bad', i.level === 'urgent' ? '긴급' : '주의', i.level === 'urgent' ? '목표 비중 절반 · 더 사지 않음' : '더 사지 않음')), ...notes.map(i => li(i, 'ok', '기록', '매수 영향 없음')),
    ...dc.map(([k, c]) => `<li class="${c.verdict === 'allow' ? 'ok' : 'bad'}"><span class="st">하락 시 추가 매수 ${esc(LAB[c.verdict] || c.verdict)}</span> · ${esc(w[k]?.name || k)}${c.until ? ` (${esc(md(c.until))}까지)` : ''}<small>${esc(md(c.asOf))} · ${esc(termFix(c.reason || ''))}</small></li>`)];
  return `<p class="pp-kis-note pp-issue-head">${head} ${help}</p>${list.length ? `<ul class="pp-kis-items">${list.join('')}</ul>` : ''}`;
}
// 규칙 변경 기록: 항목 이름은 규칙 화면과 같은 이름(RULE_DEFS)으로 보인다(영어 키를 그대로 보이지 않음).
const PREF_LABEL = { ...Object.fromEntries(RULE_DEFS.map(d => [d.id, d.label])), cadence: '점검 주기', sectorCap: '섹터 상한', init: '처음 저장' };
function historyHtml(s) { const h = (s.prefsHistory || []).filter(x => !(x.changed || []).includes('init')); if (!h.length) return ''; return `<details class="pp-kis-plan"><summary>규칙 변경 기록 ${h.length}회</summary><ul class="pp-steps">${h.slice().reverse().map(x => `<li>${esc(md(x.at))} · ${esc((x.changed || []).map(k => PREF_LABEL[k] || k).join(', '))}<small>이유: ${esc(x.reason || '—')}${x.expected ? ' · 기대: ' + esc(x.expected) : ''}</small></li>`).join('')}</ul><p class="pp-kis-note">규칙을 바꾼 뒤 성적은 따로 셉니다(바꾸기 전과 합치지 않음). '처음 계획 그대로'는 계속 따로 계산합니다.</p></details>`; }
function baselineHtml(s) { const b = s.baseline; if (!b) return ''; return `<details class="pp-kis-plan" id="pp-baseline"><summary>처음 계획 그대로 뒀다면</summary><div id="pp-baseline-body"><p class="cr-muted">열면 ${esc(md(b.from))}부터 오늘까지 '처음 계획 그대로'(${Object.keys(b.plan || {}).length}종목 · 처음 규칙)를 다시 계산해 지금 계좌와 나란히 놓습니다.</p></div></details>`; }
async function wireBaseline(s) { const d = $('#pp-baseline'); if (!d) return; d.addEventListener('toggle', async () => { if (!d.open || d.dataset.done) return; d.dataset.done = '1'; const box = $('#pp-baseline-body'); box.innerHTML = '<div class="shimmer ct-skel"></div>'; try { const b = s.baseline, basket = Object.entries(b.plan).map(([symbol, v]) => ({ symbol, name: v.name || symbol, currency: v.currency || (/^\d{6}$/.test(symbol) ? 'KRW' : 'USD') })), plan = Object.fromEntries(Object.entries(b.plan).map(([k, v]) => [k, v.pct])); const [{ candles }, fx, bench, spy] = await Promise.all([loadCandles(basket), fetchCandles('KRW=X', 'USD', '2y').then(x => x.candles).catch(() => []), fetchCandles('069500', 'KRW', '2y').then(x => x.candles).catch(() => null), fetchCandles('SPY', 'USD', '2y').then(x => x.candles).catch(() => null)]); const r = rehearse({ basket, capitalKrw: b.capitalKrw, rules: normalizeRules(b.rules || DEFAULT_RULES).rules, plan, candlesBySymbol: candles, fxCandles: fx, from: b.from, to: today(), benchmark: bench ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: bench } : null, indexes: { KR: bench ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: bench } : null, US: spy ? { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: spy } : null }, label: '처음 계획' }); const last = s.marks?.at(-1); if (!r.ok) { box.innerHTML = `<p class="cr-muted">${esc(r.reason)} (시작일 다음 거래일부터 계산됩니다)</p>`; return; } box.innerHTML = `<div class="rp-tiles"><div class="me"><span class="cr-muted">지금 팀 모의계좌</span><br><b>${won(last?.total)}</b><br><span class="${tone(last && b.capitalKrw ? last.total / b.capitalKrw - 1 : 0)}">${pct(last && b.capitalKrw ? last.total / b.capitalKrw - 1 : null)}</span></div><div><span class="cr-muted">처음 계획 그대로(계산)</span><br><b>${won(r.end.total)}</b><br><span class="${tone(r.metrics.rule.ret)}">${pct(r.metrics.rule.ret)}</span></div><div><span class="cr-muted">그냥 보유</span><br><b>${won(r.metrics.hold.end)}</b><br><span class="${tone(r.metrics.hold.ret)}">${pct(r.metrics.hold.ret)}</span></div>${r.metrics.mix ? `<div><span class="cr-muted">지수로만 담은 경우 ${tip(mixPartsOf(r.mix.name))}</span><br><b>${won(r.metrics.mix.end)}</b><br><span class="${tone(r.metrics.mix.ret)}">${pct(r.metrics.mix.ret)}</span></div>` : ''}${r.metrics.bench ? `<div><span class="cr-muted">KODEX 200</span><br><b>${won(r.metrics.bench.end)}</b><br><span class="${tone(r.metrics.bench.ret)}">${pct(r.metrics.bench.ret)}</span></div>` : ''}</div><p class="pp-kis-note">${esc(md(r.from))} ~ ${esc(md(r.to))} · ${r.days}거래일 · 차이는 규칙·계획을 바꾼 효과와 체결 방식 차이(모의 서버 체결 vs 다음 거래일 시가 가정)에서 옵니다. ${tip('처음 계획 이전의 변화(첫 비중 맞추기 비용 등)는 넣지 않았습니다.')}</p>`; } catch (e) { box.innerHTML = `<p class="cr-muted">${esc(e.message)}</p>`; } }); }
// 지수 대비 한 줄(결정 21): 굵은 숫자는 '지수 대비' 차이(%p) 하나뿐이다. 절대 수익률은 시장 방향이 만들므로 괄호 안 보조 글자로만 둔다. 비교 숫자가 없으면(시세 확인 못 함·처음 계획 없음) '—' 와 이유를 보이고 절대 숫자는 작은 회색 글자로 남긴다.
// basis: 'plan'(팀 모의계좌 · 처음 계획의 국가 비중) | 'holdings'(실계좌 · 첫 기록일의 보유 국가 비중 — 계획이 없는 계좌에 '계획에서'라고 쓰면 거짓이다 · 2026-11-12 검토).
function progressHtml(s, { basis = 'plan' } = {}) {
  const m0 = s.marks?.[0], m1 = s.marks?.at(-1); if (!(m0 && m1 && s.marks.length > 1)) return '';
  const bm = s.benchmark || null, w = bm?.weights || null, own = m1.total > 0 && m0.total > 0 ? m1.total / m0.total - 1 : null, who = basis === 'holdings' ? '내 계좌' : '이 계좌';
  // 일수·기간은 비교 계산이 잰 기간(처음 계획 날부터)을 따른다 — s.marks 는 400개로 잘리고 처음 계획 전 기록도 들어 있어 굵은 숫자의 기간과 다를 수 있다. 비교가 없을 때만 marks 로 대신한다.
  const from = bm?.from || m0.date, asOf = bm?.asOf || m1.date, days = bm?.days || s.marks.length;
  const src = basis === 'holdings' ? `첫 기록일(${esc(from)})의 보유 국가 비중(국내 평가액 ÷ 총자산 · 미국 평가액×환율 ÷ 총자산 · 나머지 현금)에서` : `처음 계획(${esc(s.baseline?.from || from)})에서 국가 비중과 현금 비중만 가져와`;
  const tipText = `지수로만 담은 경우: ${src} 국내 ${w ? w.KR : '—'}%는 KODEX 200, 미국 ${w ? w.US : '—'}%는 S&P500 ETF(원화 환산), 현금 ${w ? w.cash : '—'}%로 둔 지수 투자입니다. 이 계좌는 개별 종목을 들고 있어 위험이 같지는 않습니다. 수익률 자체는 그 기간 시장 방향에 따라 달라서 굵은 숫자는 지수 대비 차이(%p) 하나만 둡니다. 기간: ${esc(from)} ~ ${esc(asOf)}.`;
  const info = `<span class="cr-muted" title="${esc(tipText)}">ⓘ</span>`;
  if (bm && Number.isFinite(bm.diffPp)) return `<p class="pp-kis-note">${days}일째 · 지수 대비 <b class="${tone(bm.diffPp)}">${pp(bm.diffPp)}</b> (${who} ${pct(Number.isFinite(bm.ownRetPct) ? bm.ownRetPct / 100 : own)} · 지수로만 ${pct(bm.benchRetPct / 100)})${bm.error ? ` <small class="cr-muted">${esc(termFix(bm.error))}</small>` : ''} ${info}</p>`;
  // 이유는 빠진 것에서 고른다: 비교 객체가 있으면 그 error(없으면 자료 부족) · 없는데 처음 계획은 있으면 서버가 아직 비교를 안 실은 공개 자료(갱신 전) · 둘 다 없으면 처음 계획 없음.
  const why = bm ? (bm.error || '비교할 자료 부족') : s.baseline ? '지수 비교 자료 없음 · 공개 자료 받기 전' : '처음 계획 없음';
  return `<p class="pp-kis-note">${days}일째 · 지수 대비 — <span class="cr-muted">(${esc(why)})</span> <small class="cr-muted">${who} ${pct(own)} · 시작 ${won(m0.total)} → 지금 ${won(m1.total)}</small> ${info}</p>`;
}
// 기록 검사 표시: 서버의 chainCheck(공개하는 조각 — 닫힌 날만 — 으로 확인한 결과)를 그대로 보여 준다. 브라우저에서 다시 계산하지 않는다(확인은 공개 자료만으로 팀 PC 스크립트가 한다).
// published:false(실계좌 카드): 그 기록은 공개 자료에 없으므로 공개 자료로 확인하라는 문장을 쓰면 팀 모의계좌 기록을 확인하고 실계좌를 확인했다고 믿게 된다(2026-11-12 검토). 결과 색은 기록 검사 자체(ok)만 따르고 지난 기록 변경은 따로 붉게 쓴다.
function chainHtml(s, { published = true } = {}) { const cc = s.chainCheck, ch = Array.isArray(s.chain) ? s.chain : [], breaks = (s.chainBreaks || []).length, days = cc ? cc.days : ch.length, ok = cc ? cc.ok : null, last = ch.at(-1); const how = published ? '공개 자료에는 어제까지만 올라가고 오늘 기록은 아직 잠기지 않았습니다. 지난 기록을 고치면 드러나고, 공개 자료만 있으면 누구나 다시 확인할 수 있습니다.' : '이 기록은 공개 자료에 올라가지 않아 이 PC의 기록으로만 확인할 수 있습니다.'; const tipText = `매일 마감 기록(총자산·현금·보유·그날 체결)을 전날 기록과 묶어 잠급니다. ${how} 잠근 뒤 지난 기록이 바뀌면 '지난 기록 변경'으로 남습니다. ${last?.date ? `마지막 잠금 ${last.date}` : '잠근 기록 없음'}`; return `<span>기록 <b>${days}일</b> · 기록 검사 <b class="${ok === false ? 'cr-err' : ''}">${ok === null ? '—' : ok ? '고친 흔적 없음' : '확인 필요'}</b>${ok === false && cc?.brokenAt ? ` <span class="cr-err">(${esc(md(cc.brokenAt))}부터)</span>` : ''}${breaks ? ` <span class="cr-err">· 지난 기록 변경 ${breaks}건</span>` : ''} ${tip(tipText, '기록 검사 설명')}</span>`; }
function kisSummary(s) { const b = s.balance; const fundTip = b?.usFundingKrw ? tip(`한국투자증권 모의계좌는 미국 주식을 사고팔아도 원화 예수금이 그대로입니다(산 돈을 빼지 않고 판 돈도 넣지 않음). 그래서 ${b.fundingBasis === 'broker' ? '지금 보유한 미국 종목의 증권사 매입금액(원화)만큼(체결 기록과 보유 수량이 달라 대신 씀)' : '미국 주식 순매수 금액(산 금액 − 판 금액, 주문 때 환율)만큼'} 현금·총자산에서 뺐습니다. 증권사 표시 예수금 ${won(b.cashRawKrw)}.`) : ''; return `<div class="pp-kis-sum"><span><b>팀 모의계좌</b>${s.live ? '' : ' <span class="cr-muted">(하루 1번 공개)</span>'}</span><span>국내 <b>${s.market?.open ? '장중' : '장 마감'}</b>${s.market?.open ? '' : ` <span class="cr-muted">(${esc(s.market?.reason || '')})</span>`}</span>${b ? `<span>현금 <b>${won(b.cash)}</b>${b.usFundingKrw ? ` · 미국 주식 순매수 차감 ${b.usFundingKrw > 0 ? '−' : '+'}${won(Math.abs(b.usFundingKrw))} ${fundTip}` : ''}</span><span>총자산 <b>${won(b.total)}</b></span><span>보유 <b>${b.positions.length}종목</b></span>` : ''}<span>전체 정지 <b class="${s.killSwitch ? 'on' : ''}">${s.killSwitch ? '켜짐' : '꺼짐'}</b></span><span>주문 한도 1회 <b>${won(s.limits?.maxOrderKrw)}</b> · 하루 <b>${won(s.limits?.maxDailyKrw)}</b></span>${chainHtml(s)}</div>`; }
function orderNote(o) { const label = orderStatusLabel(o.status), note = o.note ? termFix(o.note) : ''; return `${esc(note.startsWith(label) ? note : label)}${o.odno ? ' #' + esc(o.odno) : ''}${o.error ? ' · ' + esc(termFix(o.error)) : ''}${note && !note.startsWith(label) ? ' · ' + esc(note) : ''}`; }
function kisOrdersTable(list, title) { if (!list?.length) return ''; return `${title ? `<h4>${esc(title)}</h4>` : ''}<div class="pp-scroll"><table class="pp-journal"><tbody>${list.slice().reverse().map(o => `<tr class="${o.status === 'filled' ? '체결' : /rejected|not_found/.test(o.status) ? '차단' : ''}"><td>${esc(kst(o.at))}</td><td>${o.side === 'BUY' ? '매수' : '매도'}</td><td>${esc(o.name)} ${o.qty}주 @${o.currency === 'USD' ? '$' + Number(o.price).toFixed(2) : won(o.price)}${o.filledQty ? ` · 체결 ${o.filledQty}주` : ''}<br><small class="cr-muted">${orderNote(o)}</small></td></tr>`).join('')}</tbody></table></div>`; }
function kisItems(r) { const okN = r.items.filter(i => i.ok).length, badN = r.items.length - okN; return `<p class="pp-kis-note">${esc(kst(r.at))} 기준 · 규칙 ${r.evaluation.known}개 중 ${r.evaluation.okCount}개 지킴 · 주문 ${r.items.length}건${badN ? `(막힘 ${badN}건)` : ''}${r.skipped?.length ? ` · 해외 종목 ${r.skipped.length}개 뺌 ${tip(`뺀 종목: ${r.skipped.join(', ')}`)}` : ''}${r.noData?.length ? ` · 시세 없어 뺌: ${esc(r.noData.join(', '))}` : ''}</p>${r.items.length ? `<ul class="pp-kis-items">${r.items.map(i => `<li class="${i.ok ? 'ok' : 'bad'}"><span class="st">${i.ok ? '통과' : '막힘'}</span> · ${esc(i.name)} ${i.side === 'BUY' ? '매수' : '매도'} ${i.qty ?? '—'}주 @${i.currency === 'USD' ? '$' + (i.price ?? 0).toFixed(2) : won(i.price)} = ${won(i.amountKrw)}<small>${esc(termFix(i.why))}</small>${i.blocks.length ? `<small>${i.blocks.map(x => esc(termFix(x))).join(' · ')}</small>` : ''}${i.warnings?.length ? `<small>! ${i.warnings.map(esc).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : '<p class="cr-muted">오늘 낼 주문이 없습니다.</p>'}${r.sent?.length ? kisOrdersTable(r.sent, '방금 낸 주문') : ''}`; }
async function kisRefresh() {
  const card = $('#pp-kis'), body = $('#pp-kis-body'); if (!card) return;
  // 팀 PC(실시간)가 안 되면 하루 1번 공개 자료를 보기만 하게 보여 준다. 팀 모의계좌는 가상 돈이라 누가 봐도 괜찮다.
  let s; try { s = await loadMockAccount({ fresh: true, maxAge: 0 }); } catch (e) { card.hidden = false; $('#pp-kis-actions').hidden = true; body.innerHTML = `<p class="cr-muted">${esc(e.message)}</p>`; const t = $('#pp-kis-title-state'); if (t) { t.textContent = '자료 없음'; t.className = 'stop'; } renderHyp(null); return; }
  applyMockOptions(s); if (s.planDoc) PLAN_DOC = s.planDoc; else await loadPlanDoc(); await loadIpoEvents(); K.status = s; card.hidden = false; $('#pp-kis-actions').hidden = !s.live;
  const pl = planForKis(), prog = progressHtml(s), strip = statusStrip(s);
  const stale = s.markStale ? '<p class="cr-err">환율을 못 읽어 총자산은 마지막 정상 값으로 보여 줍니다. 미국 자산이 있는 동안에는 환율이 돌아올 때까지 주문하지 않습니다.</p>' : '';
  const ro = stale + (s.live ? '' : `<p class="pp-ro">보기만 · 하루 1번 공개 (${esc(kst(s.asOf))} 기준) · 주문·종목 추가는 팀 PC에서만 됩니다.</p>`);
  // 2026-11-26 순서: 얼마 벌었나(숫자) → 한 줄 상태·아직 못 산 시장 → 규칙 지킴 → 이슈 → 무엇을 들고 있나 → 아직 안 산 종목 → 주문(있을 때만) → 나머지는 '자세히' 하나에 모은다.
  const ords = s.live ? s.ordersToday : s.recentOrders, oTitle = s.live ? '오늘 주문' : '최근 주문';
  body.innerHTML = ro + heroHtml(s) + statusLine(s) + gapHtml(s) + adherenceHtml(s) + (s.error ? `<p class="cr-err">${esc(s.error)}</p>` : '') + issuesHtml(s) + holdTable(s) + holdingsTable(s, { missOnly: true })
    + (ords?.length ? `<details class="pp-kis-plan" id="pp-kis-orders"><summary>${oTitle} ${ords.length}건</summary>${kisOrdersTable(ords, '')}</details>` : '')
    + `<details class="pp-kis-plan pp-more" id="pp-kis-more"><summary>자세히 ${tip('주문 한도·전체 정지·기록 검사, 계획 이름, 지수 대비 계산, 최근 30일 매매, 개별 종목 성적, 주문 오류 점검입니다. 처음 계획 그대로 비교, 규칙 변경 기록, 계획 기준도 여기 있습니다.', '자세히 설명')}</summary>`
    + strip + kisSummary(s) + `<p class="pp-kis-note">계획: ${esc(pl.label)}${s.markets?.US ? ` · 미국 ${s.markets.US.open ? '장중' : '장 마감'}` : ''}</p>` + prog + activityHtml(s) + sleeveHtml(s) + fearHtml(s) + eventsHtml() + integrityHtml(s)
    + baselineHtml(s) + historyHtml(s) + planDocHtml(PLAN_DOC || null) + '</details>';
  wireBaseline(s);
  $('#pp-kis-kill').textContent = s.killSwitch ? '정지 해제' : '전체 정지'; renderHyp(s.hypotheses || [], !s.live);
}
async function kisPreview() { const st = $('#pp-kis-state'), btn = $('#pp-kis-run'); st.textContent = '잔고·시세를 읽고 낼 주문을 정하는 중…'; K.armed = false; btn.textContent = '주문하기'; try { const r = await privateRead('paper-live-preview', { rebalance: $('#pp-kis-rebal')?.checked === true }); K.preview = r; $('#pp-kis-result').innerHTML = kisItems(r); const n = r.items.filter(i => i.ok).length; btn.disabled = n === 0; btn.textContent = n ? `주문하기 (${n}건)` : '주문하기'; st.textContent = n ? `통과 ${n}건. '주문하기'를 두 번 누르면 냅니다.` : (r.items.length ? '통과한 주문이 없어 낼 주문이 없습니다.' : ''); } catch (e) { st.textContent = e?.message || '미리보기를 하지 못했습니다.'; } }
async function kisRun() { const st = $('#pp-kis-state'), btn = $('#pp-kis-run'); if (!K.preview) return; const n = K.preview.items.filter(i => i.ok).length; if (!K.armed) { K.armed = true; btn.textContent = `정말 주문하기 (${n}건)`; st.textContent = '한 번 더 누르면 팀 모의계좌에 지정가 주문이 나갑니다. 실전 계좌가 아닙니다.'; return; } K.armed = false; btn.disabled = true; btn.textContent = '주문하는 중…'; try { const r = await privateRead('paper-live-run', { rebalance: $('#pp-kis-rebal')?.checked === true }); K.preview = null; $('#pp-kis-result').innerHTML = kisItems(r); st.textContent = `주문 ${r.sent.filter(o => o.status === 'sent').length}건 · 거부 ${r.sent.filter(o => o.status === 'rejected').length}건 · 확인 안 됨 ${r.sent.filter(o => o.status === 'unknown').length}건${r.sent.some(o => o.status === 'expired') ? ` · 장 마감 취소 ${r.sent.filter(o => o.status === 'expired').length}건` : ''}${r.note ? ' · ' + termFix(r.note) : ''}`; await kisRefresh(); } catch (e) { st.textContent = e?.message || '주문하지 못했습니다.'; } finally { btn.textContent = '주문하기'; } }
async function kisKill() { const st = $('#pp-kis-state'); try { const on = !K.status?.killSwitch; const r = await privateRead('paper-live-kill', { on }); st.textContent = on ? `전체 정지했습니다. 열린 주문 ${r.cancelled.length}건을 취소 요청했습니다.` : '정지를 해제했습니다.'; await kisRefresh(); } catch (e) { st.textContent = e?.message || '처리하지 못했습니다.'; } }
$('#pp-kis-refresh').onclick = kisRefresh; $('#pp-kis-preview').onclick = kisPreview; $('#pp-kis-run').onclick = kisRun; $('#pp-kis-kill').onclick = kisKill;

// ── 실계좌 조회 기록(결정 22) ── PC 프로그램이 실계좌 조회 기록을 줄 때만 보인다(공개 사이트·공개 자료에는 없다 — 실계좌는 개인 자료라 공개하지 않는다).
// 조회만 하는 기록이라 카드 안에 버튼이 없다(홈의 새로고침이 이 카드도 다시 읽는다). 지수 대비·기록 검사 표시는 팀 모의계좌 카드의 progressHtml/chainHtml 을 쓰되 문구만 이 계좌에 맞춘다(비교 비중은 보유에서 · 기록은 공개되지 않음).
// 총자산을 확인하지 못하면(markStale) '확인 못 함'으로 두고 마지막 정상 평가의 날짜·값을 함께 보인다(이유: 환율 없음 · 미국 잔고 조회 실패 · 달러 예수금 조회 실패 — 실계좌 기록은 총자산을 모르면 적지 않는다).
function realHoldings(b) { const ps = (b?.positions || []).filter(p => p.qty > 0).sort((a, c) => (c.valueKrw || 0) - (a.valueKrw || 0)); if (!ps.length) return ''; return `<details class="pp-kis-plan"><summary>보유 ${ps.length}종목</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수량</th><th>평가액</th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.name)}<br><small class="cr-muted">${esc(p.symbol)} · ${p.currency === 'USD' ? '달러' : '원화'}</small></td><td>${p.qty}</td><td>${won(p.valueKrw)}</td></tr>`).join('')}</tbody></table></div></details>`; }
// 2026-11-13(결정 34): 이 카드는 모의투자 화면이 아니라 홈에 둔다 — 모의투자 화면에는 모의계좌만. 홈이 실계좌일 때만, PC가 기록을 줄 때만 보인다.
// 보유표는 뺐다(홈에 같은 계좌의 보유 목록이 있고, 기록 응답에는 평균단가·현재가가 없어 손익이 0으로 찍혔다). 조회는 25분에 한 번(읽을 때마다 토스를 조회하고 기록에 쓰므로).
const REAL = { at: 0 };
function realCard() { let card = document.getElementById('hm-real'); if (card) return card; const host = document.querySelector('#overview .hm-main'); if (!host) return null;
  card = document.createElement('article'); card.className = 'hm-card cr-card'; card.id = 'hm-real'; card.hidden = true;
  card.innerHTML = `<header><h3>실계좌 기록 (<span id="pp-real-label">토스</span>) <span class="pp-badge">조회만 하는 기록</span> ${tip('이 계좌로는 조회만 합니다. 날마다 보유 평가액을 기록해 지수와 비교하고, 기록을 잠가 나중에 고칠 수 없게 합니다. 이 기록은 이 PC에만 있고 공개되지 않습니다.')}</h3></header><div id="pp-real-body"></div>`;
  host.append(card); // 자리는 brief-ui.js placeCards 가 정한다(왼쪽 열 · 접힌 카드 다음).
  return card; }
// 2026-11-26: 카드 안의 새로고침 버튼을 홈의 새로고침과 합쳤다 — 홈에서 계좌를 새로고침하면 이 카드도 25분 제한 없이 다시 읽는다.
document.addEventListener('click', e => { if (e.target.closest?.('#home-read-holdings, #toss-refresh')) setTimeout(() => void realRefresh({ force: true }), 0); });
async function realRefresh({ force = false } = {}) {
  const card = realCard(), body = card?.querySelector('#pp-real-body'); if (!card) return;
  if (document.body.dataset.account !== 'real') { card.hidden = true; return; }
  if (!force && REAL.at && Date.now() - REAL.at < 25 * 60e3) return;
  let s; try { s = await privateRead('kis-real-status'); } catch { card.hidden = true; return; } // PC 없음·설정 없음(503) → 카드 숨김
  REAL.at = Date.now();
  if (!s || s.readOnly !== true) { card.hidden = true; return; } card.hidden = false; const lab = $('#pp-real-label'); if (lab) lab.textContent = s.label || '한국투자증권';
  const b = s.balance, notes = [s.benchmark?.basis === 'twr' ? '수익률은 입금·추가 매수 효과를 뺀 값입니다(현금 제외).' : '', b && b.usCostKrw > 0 && b.cashUsd === 0 ? (b.note || '증권사 평가 그대로입니다. 원화로 바로 산 미국 주식(통합증거금)은 다음 날 정산 전까지 평가액이 실제보다 크게 보일 수 있습니다(2026-11-12 기준 · 확인 전).') : ''].filter(Boolean);
  const lastM = s.marks?.at(-1), reason = { fx_missing: '환율을 읽지 못해', us_failed: '미국 잔고 조회에 실패해', us_cash_failed: '달러 예수금 조회에 실패해' }[s.staleReason] || '잔고를 다 읽지 못해';
  const stale = s.markStale ? `<p class="cr-err">${reason} 총자산을 확인하지 못했습니다${lastM ? ` · 마지막 정상 평가 ${esc(lastM.date)} ${won(lastM.total)}` : ' · 아직 정상 평가가 없습니다'}.</p>` : '';
  body.innerHTML = stale + `<div class="pp-kis-sum"><span><b>${esc(s.account || '실계좌')}</b></span>${b && b.cashKnown === false ? `<span>보유 평가액 <b>${s.markStale ? '확인 못 함' : won(b.total)}</b> ${tip('토스는 현금 정보를 주지 않아 보유 주식 평가액만 셉니다(토스 매매기준율로 원화 환산). 수익률은 입금·추가 매수 효과를 뺐고, 같은 날 사고판 손익과 배당 현금은 빠집니다.')}</span><span>보유 <b>${b.positions.length}종목</b></span>` : b ? `<span>총자산 <b>${s.markStale ? '확인 못 함' : won(b.total)}</b> ${tip('총자산 = 국내 총평가 + 미국 주식 평가액×환율 + 달러 예수금×환율. 현금은 정산 전 금액이라 이틀 뒤까지는 현금+주식이 총자산과 다를 수 있습니다. 증권사 평가 그대로이며 모의계좌용 미국 순매수 차감은 하지 않습니다.')}</span><span>현금 <b>${won(b.cash)}</b></span><span>보유 <b>${b.positions.length}종목</b></span>` : ''}${chainHtml(s, { published: false })}</div>` + (s.error ? `<p class="cr-err">${esc(s.error)}</p>` : '') + progressHtml(s, { basis: 'holdings' }) + `<p class="pp-kis-note">${esc(kstStamp(s.asOf))} 기준 · 25분마다 기록 · 이 PC에만 저장(공개 안 함)${notes.length ? ` ${tip(notes.join('\n'), '실계좌 기록 설명')}` : ''}</p>`;
}
window.addEventListener('teamquant:page', () => { const p = document.querySelector('.view.active')?.dataset.page; if (p === 'paper') void kisRefresh(); if (p === 'home') void realRefresh(); });
window.addEventListener('teamquant:asset-snapshot', () => setTimeout(() => { if (document.querySelector('.view.active')?.dataset.page === 'home') void realRefresh(); }, 0));

// ── 직접 고른 종목(가설) ──
let phPick = null, phEvidence = [];
async function phFill(o) {
  const box = $('#ph-evidence'); box.textContent = '근거 자료를 불러오는 중…'; phEvidence = [];
  const [f, d] = await Promise.all([fundamentals(o.symbol).catch(() => null), fetchCandles(o.symbol, o.currency, '2y').catch(() => null)]);
  const ev = [];
  if (f && !f.error) { if (f.sector) ev.push(`업종 ${f.sector}`); const a = f.annual || {}; if (Number.isFinite(a.revenueGrowth)) ev.push(`매출 성장률 ${a.revenueGrowth > 0 ? '+' : a.revenueGrowth < 0 ? '−' : ''}${Math.abs(a.revenueGrowth).toFixed(1)}% (${a.year || '최근'})`); if (Number.isFinite(a.operatingIncomeGrowth)) ev.push(`영업이익 ${a.operatingIncomeGrowth > 0 ? '+' : a.operatingIncomeGrowth < 0 ? '−' : ''}${Math.abs(a.operatingIncomeGrowth).toFixed(1)}%`); if (Number.isFinite(a.roe)) ev.push(`ROE ${a.roe.toFixed(1)}%`); const pe = f.forwardPer > 0 ? f.forwardPer : f.per; if (pe > 0) ev.push(`PER ${pe.toFixed(1)}배`); }
  if (d?.candles?.length > 30) { const r = returnsFrom(d.candles.map(c => ({ date: c.date, close: c.close }))); if (r) { ev.push(`수익률 1개월 ${pct(r.m1)} · 3개월 ${pct(r.m3)} · 1년 ${r.y1 === null ? '—' : pct(r.y1)}`); ev.push(`1년 고점 대비 ${pct(r.offHigh)}`); const c = d.candles.filter(x => x.close > 0); if (c.length >= 200) { const ma = c.slice(-200).reduce((a, x) => a + x.close, 0) / 200; ev.push(`200일선 ${c.at(-1).close > ma ? '위' : '아래'}`); } } }
  phEvidence = ev; box.innerHTML = ev.length ? `근거 자료(자동): ${ev.map(esc).join(' · ')}` : '근거 자료를 받지 못했습니다. 직접 적어 주세요.';
  if (!$('#ph-thesis').value.trim() && ev.length) $('#ph-thesis').value = `${o.name}: ${ev.slice(0, 3).join(', ')}. 이 흐름이 이어진다고 본다. (직접 고쳐 써 주세요)`;
}
attachStockSearch($('#ph-sym'), { onPick: o => { phPick = o; void phFill(o); } });
function phStatusLabel(h) { return h.status === 'proposed' ? '계획에 넣기 전' : h.status === 'open' ? (h.expired ? '기한 지남 · 끝내기 필요' : '진행 중') : h.status === 'broken' ? (h.autoBroken ? '제외됨(자동)' : '제외됨') : h.verdict === 'right' ? '종료 · 맞음' : h.verdict === 'wrong' ? '종료 · 틀림' : '종료'; }
// 결정 60: 보유·매도 흐름 한 줄 — 규칙이 판 뒤에도 '산 가격 대비'만 보이던 것(보유 0주인데 52주처럼 보임)을 고친다. 수익은 현금흐름(판 돈 + 남은 보유 평가 ÷ 산 돈 − 1).
const phPx = (v, cur) => (v === null || v === undefined ? '—' : cur === 'USD' ? '$' + Number(v).toFixed(2) : won(v));
function phFlow(h) {
  if (!h.boughtQty) return '';
  const held = h.heldQty === null || h.heldQty === undefined ? '보유 확인 못 함' : `보유 ${h.heldQty}주`;
  const sold = h.soldQty ? ` · ${h.soldQty}주 매도(평균 ${phPx(h.exitPrice, h.currency)} · 실현 ${h.realizedPct === null || h.realizedPct === undefined ? '—' : pct(h.realizedPct)}${h.lastSellWhy ? ` · 이유: ${esc(termFix(h.lastSellWhy))}` : ''})` : '';
  return `<p class="cr-muted">${h.boughtQty}주 매수(평균 ${phPx(h.entryPrice, h.currency)}) · ${held}${sold}</p>`;
}
const phTerm = h => h.closesAt ? `기한 ${md(h.closesAt)}` : h.horizonMonths === 12 ? '1년' : `${h.horizonMonths}개월`;
function renderHyp(list, readOnly = false) {
  // 보기만(공개 사이트)일 때와 자료를 못 읽었을 때는 등록 양식을 숨긴다 — 펼쳐도 등록할 수 없다.
  const box = $('#pp-hyp-list'); if (!box) return; const form = $('#pp-hyp-new'); if (form) form.hidden = readOnly || !list;
  if (!list) { box.innerHTML = '<p class="cr-muted">팀 모의계좌 자료를 불러오면 목록이 보입니다.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="cr-muted">직접 고른 종목이 없습니다. 지금은 팀 기본 계획(지수 ETF + 종목 기준을 통과한 개별 종목)만 들고 있습니다.</p>'; return; }
  const total = K.status?.total || K.status?.balance?.total || null;
  box.innerHTML = [...list].sort((a, b) => (['open', 'proposed'].includes(a.status) ? 0 : 1) - (['open', 'proposed'].includes(b.status) ? 0 : 1) || b.openedAt.localeCompare(a.openedAt)).map(h => `<div class="ph-item"><header><b>${esc(h.name)} <small class="cr-muted">${esc(h.symbol)} · 최대 ${h.capPct}% · ${esc(phTerm(h))}${h.public === false ? ' · 비공개' : ''}</small></b><span class="st ${h.status}">${esc(phStatusLabel(h))}</span></header>
    <div class="num">${h.status === 'proposed' ? `계획에 넣으면 다음 장중에 ${h.capPct}%(약 ${total ? won(total * h.capPct / 100) : '—'})를 삽니다` : h.returnPct !== null && h.returnPct !== undefined ? `${h.soldQty ? '이 종목 손익(판 것 포함)' : '산 가격 대비'} <b class="${h.returnPct > 0 ? 'up' : h.returnPct < 0 ? 'down' : ''}">${pct(h.returnPct)}</b>` : h.boughtQty ? '수익 계산 못 함(시세·잔고 확인 전)' : '아직 체결 없음'}${h.indexPct !== null && h.indexPct !== undefined ? ` · 같은 기간 지수 ${pct(h.indexPct)}` : ''}${h.excessPct !== null && h.excessPct !== undefined ? ` · 지수 대비 <b>${pp(h.excessPct * 100)}</b>` : ''} · ${h.daysOpen}일째</div>
    ${phFlow(h)}<p>${esc(h.thesis)}</p>${h.stopLabels?.length ? `<p class="cr-muted">자동 제외 조건(장 마감 종가로 자동 확인): ${h.stopLabels.map(x => esc(termFix(x))).join(' · ')}</p>` : ''}${h.breakIf ? `<p class="cr-muted">제외 조건${h.stopLabels?.length ? '(사람이 확인)' : ''}: ${esc(h.breakIf)}</p>` : ''}${h.evidence?.length ? `<p class="cr-muted">등록 때 근거 자료: ${h.evidence.map(esc).join(' · ')}</p>` : ''}${h.closeNote ? `<p class="cr-muted">종료 메모: ${esc(termFix(h.closeNote))}</p>` : ''}
    ${h.status === 'proposed' && !readOnly ? `<div class="acts"><button type="button" class="primary" data-ph="approve" data-id="${esc(h.id)}">계획에 넣기</button><button type="button" data-ph="remove" data-id="${esc(h.id)}">지우기</button></div>` : ''}
    ${h.status === 'open' && !readOnly ? `<div class="acts"><button type="button" data-ph="right" data-id="${esc(h.id)}">맞았음 · 끝내기</button><button type="button" data-ph="wrong" data-id="${esc(h.id)}">틀렸음 · 끝내기</button>${tip('끝내면 다음 자동 주문 때 계획에서 빠집니다. 팀 기본 계획에 없는 종목이면 남은 수량을 팝니다. 제외 조건에 해당하면 \'틀렸음 · 끝내기\'를 누릅니다.')}</div>` : ''}</div>`).join('');
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = async () => { const kind = b.dataset.ph; try {
    if (kind === 'approve') { if (!confirm('계획에 넣으면 다음 장중 자동 주문이 한도만큼 팀 모의계좌에서 삽니다(가상 돈).')) return; await privateRead('paper-live-hypothesis', { op: 'approve', item: { id: b.dataset.id } }); $('#pp-hyp-state').textContent = '계획에 넣었습니다. 다음 자동 주문(계획을 바꿨을 때) 때 팀 모의계좌에서 삽니다.'; }
    else if (kind === 'remove') { await privateRead('paper-live-hypothesis', { op: 'remove', item: { id: b.dataset.id } }); $('#pp-hyp-state').textContent = '계획에 넣기 전 종목을 지웠습니다.'; }
    else { const note = prompt(kind === 'break' ? '제외 이유 (한 줄)' : '종료 메모 (선택)'); if (note === null) return; await privateRead('paper-live-hypothesis', { op: kind === 'break' ? 'break' : 'close', item: { id: b.dataset.id, note, verdict: kind === 'right' ? 'right' : kind === 'wrong' ? 'wrong' : undefined } }); $('#pp-hyp-state').textContent = '끝냈습니다. 다음 자동 주문 때 계획에서 빠집니다.'; }
    await kisRefresh(); } catch (e) { $('#pp-hyp-state').textContent = e?.message || '처리하지 못했습니다.'; } });
}
$('#ph-add').onclick = async () => { const err = $('#ph-err'); err.textContent = ''; if (!phPick) { err.textContent = '종목을 먼저 골라 주세요.'; return; }
  try { await privateRead('paper-live-hypothesis', { op: 'add', item: { symbol: phPick.symbol, name: phPick.name, capPct: Number($('#ph-cap').value), horizonMonths: Number($('#ph-h').value), thesis: $('#ph-thesis').value.trim(), breakIf: $('#ph-break').value.trim(), evidence: phEvidence, public: $('#ph-public')?.checked !== false } });
    $('#ph-thesis').value = ''; $('#ph-break').value = ''; $('#ph-sym').value = ''; $('#ph-evidence').textContent = ''; phPick = null; $('#pp-hyp-new').open = false; $('#pp-hyp-state').textContent = "등록했습니다. 목록에서 '계획에 넣기'를 눌러야 삽니다."; await kisRefresh(); }
  catch (e) { err.textContent = e?.status === 503 ? '팀 PC에 모의투자 키가 없습니다.' : (e?.message || '팀 PC 연결이 필요합니다.'); } };
