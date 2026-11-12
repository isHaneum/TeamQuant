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
import { loadMockAccount } from '/paper-account-ui.js';
import { planBasketFrom, heldBasketFrom, runState, invested, nextChecks, lastAuto, planAppliedFor, planGaps, plannedNotHeld, orderStatusLabel, kstStamp, MARKET_NAME } from '/lib/paper-public.js';
import { DEFAULT_RULES } from '/lib/core-rules.js';
import { compareRuleSets } from '/lib/strategy-review.js';

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
.rp-chart .l-bench{stroke:#c0821a;stroke-dasharray:2 3}.rp-chart .l-mix{stroke:#8a94a6;stroke-dasharray:5 3;fill:none;stroke-width:1.5}.rp-legend i.l-mix{background:#8a94a6}
.pp-kis-sum{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--ck-sub);margin:0 0 10px}.pp-kis-sum b{color:var(--ck-ink)}.pp-kis-sum .on{color:var(--ck-bad);font-weight:700}
.pp-kis-items{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}.pp-kis-items li{border:1px solid var(--ck-line);border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.5}.pp-kis-items li.ok{border-color:#abefc6;background:var(--ck-ok-bg)}.pp-kis-items li.bad{background:var(--ck-soft)}.pp-kis-items small{display:block;color:var(--ck-sub)}.pp-kis-items .st{font-weight:700}
.pp-kis-note{font-size:12.5px;color:var(--ck-sub);line-height:1.6;margin:8px 0 0}
#pp-kis-actions{flex-wrap:wrap}.pp-picked{margin-top:8px}.pp-picked button i{font-style:normal;margin-left:4px;opacity:.7}
.pp-badge{font-size:11px;font-weight:700;color:#7a4e0c;background:var(--ck-bad-bg);border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}#pp-kis-actions button{white-space:nowrap}
.pp-kis-plan{margin:10px 0}.pp-kis-plan>summary{cursor:pointer;font-size:13px;font-weight:600;color:#1849a8}.pp-kis-plan h4{margin:12px 0 6px}.pp-kis-plan .pp-ref td,.pp-kis-plan .pp-ref th{font-size:12px}.pp-kis-plan .up{color:var(--ck-up)}.pp-kis-plan .down{color:var(--ck-down)}
.pp-rv{width:100%;border-collapse:collapse;font-size:12.5px}.pp-rv th,.pp-rv td{padding:6px 6px;border-bottom:1px solid var(--ck-line);text-align:right;white-space:nowrap;vertical-align:top}.pp-rv th:first-child,.pp-rv td:first-child{text-align:left;white-space:normal;min-width:170px}.pp-rv th{color:var(--ck-sub);font-weight:600}.pp-rv th small{display:block;font-weight:400}.pp-rv td small{display:block;color:var(--ck-sub);font-size:11.5px}.pp-rv tr.me td{background:var(--ck-soft)}.pp-rv .up{color:var(--ck-up);font-weight:700}.pp-rv .down{color:var(--ck-down);font-weight:700}.pp-rv button{font-size:12px;margin-top:6px;padding:4px 10px}
.pp-order{margin:0;padding-left:20px;font-size:13.5px;line-height:1.55;display:grid;gap:7px}.pp-order small{display:block;color:var(--ck-sub);font-size:12.5px}.pp-ro{font-size:12.5px;color:#1849a8;background:#eef4ff;border-radius:8px;padding:6px 10px;margin:0 0 8px;line-height:1.5}
#core-paper .cr-grid{grid-template-columns:minmax(0,1fr)}
.pp-sec{margin:14px 0 -6px;padding-top:16px;border-top:2px solid var(--ck-line)}.pp-sec h2{margin:0;font-size:18px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.pp-sec p{margin:4px 0 0;color:var(--ck-sub);font-size:13.5px;line-height:1.5}
.pp-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 16px;background:var(--ck-soft);border-radius:12px;padding:12px 14px;margin:0 0 12px;font-size:13px;line-height:1.5}.pp-strip>div{min-width:0}.pp-strip>div>span{display:block;color:var(--ck-sub);font-size:12px}.pp-strip b{font-size:14px;overflow-wrap:anywhere}.pp-strip small{display:block;color:var(--ck-sub);font-size:12px}
#pp-kis .run{color:var(--ck-ok);font-weight:700}#pp-kis .stop{color:var(--ck-bad);font-weight:700}.pp-kis-sub{white-space:nowrap;font-weight:600}#pp-kis-title-state{font-weight:700}
.pp-gap{grid-column:1/-1;background:var(--ck-bad-bg);border-radius:8px;padding:8px 10px;color:#7a4e0c;font-size:13px;line-height:1.5}
.pp-why{white-space:normal!important;text-align:left!important;min-width:240px;max-width:560px;font-size:11.5px;line-height:1.45;color:var(--ck-sub)}.pp-why b{color:var(--ck-ink);font-weight:600}
@media(max-width:760px){.pp-form{grid-template-columns:1fr}#core-paper .rp-tiles{grid-template-columns:1fr}.pp-live{display:grid}.pp-strip{grid-template-columns:1fr}/* 폰 폭: 보유 표의 "담은 이유"를 가로 스크롤 뒤에 숨기지 않고 종목 줄 아래 전체 폭으로 내린다 */#pp-kis-held table.pp-ref{display:block;width:auto;min-width:0;max-width:100%}#pp-kis-held table.pp-ref thead,#pp-kis-held table.pp-ref tbody{display:block;width:auto}#pp-kis-held table.pp-ref tr{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,.5fr) minmax(0,1.1fr) minmax(0,.6fr);align-items:center;border-bottom:1px solid var(--ck-line);width:auto}#pp-kis-held table.pp-ref td,#pp-kis-held table.pp-ref th{border-bottom:0;white-space:normal;min-width:0;overflow-wrap:anywhere}#pp-kis-held table.pp-ref th:last-child,#pp-kis-held table.pp-ref td.pp-why{grid-column:1/-1;min-width:0;max-width:none;padding-top:0}}`; document.head.append(style);

const navHost = document.querySelector('.overview-nav nav') || document.querySelector('.sidebar nav');
const nav = document.createElement('button'); nav.className = 'nav-button'; nav.dataset.view = 'paper'; nav.textContent = '모의투자'; navHost?.append(nav);
const page = document.createElement('section'); page.className = 'view ck'; page.dataset.page = 'paper'; page.id = 'core-paper';
page.innerHTML = `<div class="page-head"><div><h1>모의투자 ${tip('실제로 투자할 때 거치는 절차를 돈 없이 그대로 밟습니다. 규칙 화면의 내 규칙으로 계획 비중을 정하고, 주 1회(급할 때는 바로) 오늘 점검이 낸 할 일을 매매 전 확인에 통과시킨 뒤, 통과한 주문만 다음 거래일 시가에 체결합니다(시가보다 0.1% 불리하게, 편도 비용 0.2%, 국내 주식은 1주 단위). 같은 기간 그냥 보유·지수와 비교합니다. 공개 일봉으로 계산하며 실제 주문은 없습니다. 실제 매매는 체결 지연·부분 체결·감정 때문에 이보다 나쁠 수 있고, 과거 결과가 앞으로를 보장하지 않습니다.')}</h1><p>위: 한투 모의 서버에 실제 주문이 나가는 계좌(가상 1억 · 실제 돈 아님) · 아래: 과거 시세로 같은 규칙을 돌려 보는 검증(주문 없음)</p></div></div>
<div class="cr-grid"><div class="cr-main">
<article class="cr-card" id="pp-kis"><header><h3>실시간 모의계좌 <span class="pp-kis-sub">(한투 모의투자 · <span id="pp-kis-title-state">확인 중</span>)</span> <span class="pp-badge">모의 · 실제 돈 아님</span> ${tip('이 PC 에 설정한 한국투자증권 모의투자 키로, 규칙 화면의 내 규칙·계획 비중에 따라 오늘 할 일을 정하고, 매매 전 확인과 주문 보호(1회·하루 한도, 호가 폭, 중복 방지)를 모두 통과한 주문만 모의계좌에 지정가로 보냅니다. 실전 계좌로는 보내지 않습니다. 장이 닫혔거나 시세·잔고를 못 읽으면 보류합니다. 장부는 PC 에만 남고, 하루 한 번 공개 스냅샷(잔고·주문 요약·계획)만 저장소에 올립니다. 제목의 상태는 아래 "운용 상태"와 같습니다.')}</h3><button type="button" class="text-button" id="pp-kis-refresh">새로고침</button></header><div id="pp-kis-body"><p class="cr-muted">PC 서버 연결을 확인하는 중…</p></div><div class="cr-actions" id="pp-kis-actions" hidden><button type="button" class="secondary" id="pp-kis-preview">오늘 할 일 미리보기</button><button type="button" class="primary" id="pp-kis-run" disabled>모의계좌에 주문 보내기</button><button type="button" class="text-button" id="pp-kis-kill">전체 정지</button><label class="cr-muted" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px"><input type="checkbox" id="pp-kis-rebal"> 재조정 ${tip('계획까지 맞추는 묶음 주문입니다. 오른 종목 두기 규칙을 끄고, 이 묶음은 30일 매매 횟수에 1회로 셉니다. 계획을 바꿨거나 처음 운용할 때 켭니다.')}</label></div><p class="cr-err" id="pp-kis-state" role="status"></p><div id="pp-kis-result"></div></article>
<article class="cr-card" id="pp-real" hidden><header><h3>실계좌(<span id="pp-real-label">토스</span>) · 읽기 전용 <span class="pp-badge">주문 기능 없음</span> ${tip('이 계좌로는 조회만 합니다. 주문은 모의계좌에서만 보냅니다.')}</h3><button type="button" class="text-button" id="pp-real-refresh">새로고침</button></header><div id="pp-real-body"><p class="cr-muted">PC 서버 연결을 확인하는 중…</p></div></article>
<div class="cr-card" id="pp-hyp"><header><h3>종목 가설 ${tip('종목을 고르는 유일한 방식입니다. 왜 이 종목인지(성장력·모멘텀 근거), 언제까지, 어떤 조건이면 틀린 것으로 볼지, 한도 몇 %인지를 적습니다. 등록하면 실시간 모의계좌의 기본 계획에 그 한도만큼 얹히고, 가설별 성적(진입가 대비 수익 vs 같은 기간 지수)이 쌓입니다. 맞은 것도 틀린 것도 지우지 않습니다.')}</h3><span class="cr-muted" id="pp-hyp-state"></span></header>
  <div id="pp-hyp-list" class="ph-list"><p class="cr-muted">PC 모의계좌에 연결되면 가설 목록이 보입니다.</p></div>
  <details id="pp-hyp-new" style="margin-top:12px"><summary class="cr-muted" style="cursor:pointer;font-weight:600">가설 추가</summary>
    <div class="pp-form" style="margin-top:10px"><label class="ck-field"><span>종목</span><input id="ph-sym" placeholder="이름·코드·티커" autocomplete="off"></label><label class="ck-field"><span>한도 (총자산 중)</span><select id="ph-cap"><option value="2">2%</option><option value="3" selected>3%</option><option value="5">5%</option></select></label><label class="ck-field"><span>기간</span><select id="ph-h"><option value="3">3개월</option><option value="6" selected>6개월</option><option value="12">12개월</option></select></label></div>
    <label class="cr-muted" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;margin-top:8px"><input type="checkbox" id="ph-public" checked> 공개 스냅샷에 포함 ${tip('모의계좌 공개 파일(저장소)에 이 가설의 문장·근거가 실립니다. 끄면 PC 장부에만 남고 팀·방문자에게는 보이지 않습니다.')}</label>
    <div id="ph-evidence" class="ph-ev"></div>
    <label class="ck-field" style="margin-top:8px"><span>가설 — 왜 이 종목인가</span><textarea id="ph-thesis" rows="3" placeholder="예: HBM 수요 증가로 2027-05까지 매출이 두 자릿수 성장하고 주가가 코스피200을 이긴다"></textarea></label>
    <label class="ck-field" style="margin-top:8px"><span>깨지는 조건 — 이러면 틀린 것으로 본다</span><input id="ph-break" placeholder="예: 분기 매출 성장이 10% 아래로 떨어지면"></label>
    <div class="cr-actions"><button type="button" class="primary" id="ph-add">가설 등록 (승인 대기)</button><span class="cr-err" id="ph-err"></span></div>
  </details></div>
<div class="pp-sec" id="pp-sim-head"><h2>과거 데이터로 검증 (시뮬레이션) ${tip('위는 증권사 모의 서버에 실제 주문이 나가는 계좌이고, 아래는 과거 시세로 같은 규칙을 돌려 보는 검증입니다. 아래 결과는 위 계좌의 주문·잔고에 영향을 주지 않습니다. 과거 자료는 좋아 보이게 만들기 쉬우므로 한 기간이 아니라 3·6·12·18개월 모두에서 손실이 작은 규칙을 고릅니다.')}</h2><p>같은 계획·규칙을 지난 3~18개월에 넣어 그냥 보유·지수와 비교 · 주문 없음</p></div>
<div class="cr-card" id="pp-setup"><header><h3>과거 데이터 시뮬 ${tip('공개 일봉으로 지난 기간을 다시 재생해 "그때 이 절차대로 했다면"을 계산합니다. 증권사 주문은 없고, 과거 자료라 좋아 보이게 만들기 쉽습니다. 기본값은 실시간 모의계좌의 계획·규칙을 그대로 넣어 "6개월 전에 이 계좌를 가지고 있었다면"을 보는 것입니다. 그냥 보유·지수와 비교하고, 아래 전략 검토에서 규칙만 바꿔 다시 돌려 봅니다. 실제 검증은 오른쪽 실시간 모의계좌의 기록입니다.')}</h3><span class="cr-muted" id="pp-rules"></span></header>
<div class="pp-form"><label class="ck-field unit"><span>시작 자금</span><input id="pp-capital" type="number" value="10000000" min="100000" step="100000" inputmode="numeric"><i>원</i></label>
<label class="ck-field"><span>종목</span><select id="pp-basket"><option value="mockplan">모의계좌 기본 계획 (비중 그대로)</option><option value="mockheld">모의계좌 지금 보유 종목</option><option value="demo">예시 6종목 (국내 4 · 미국 2)</option><option value="mine" disabled>내 보유 종목 (계좌 연결 또는 예시 자산 필요)</option><option value="custom">직접 입력</option></select></label>
<label class="ck-field"><span>기간</span><select id="pp-range"><option value="91">최근 3개월</option><option value="182" selected>최근 6개월</option><option value="365">최근 1년</option><option value="540">최근 18개월</option></select></label></div>
<div class="ck-field" id="pp-custom-wrap" hidden><span>종목 찾아 추가 (최대 12개)</span><input id="pp-custom" placeholder="이름·코드·티커 (예: 현대, 005380, NVDA)" autocomplete="off"><div class="cp-chips pp-picked" id="pp-picked"></div></div>
<div class="cr-actions"><button id="pp-run" class="primary">시뮬 실행</button><button id="pp-start" class="secondary">오늘부터 시뮬 기록(증권사 없이)</button><span id="pp-state" class="cr-err" role="status"></span></div></div>
<div class="cr-card" id="pp-live" hidden></div>
<div id="pp-result"></div>
<div class="cr-card" id="pp-ref"><h3>같은 절차를 지난 기간에 돌렸다면 ${tip('scripts/paper-rehearsal.mjs가 공개 일봉으로 네 가지 포트폴리오·아홉 기간(최근 12개월·6개월·올해·2020~2025년 각각)에 같은 절차를 돌린 결과입니다. 2012~2019 자료로 고른 규칙을 그 뒤 기간에 적용한 것이지만, 규칙 자체는 2026-11-06에 확정했으므로 완전한 표본 외 검증은 오늘 이후의 모의투자부터입니다.')}</h3><div id="pp-ref-body"><p class="cr-muted">불러오는 중…</p></div></div>
<div class="cr-card" id="pp-howto"><h3>전략 세우는 순서 ${tip('이 서비스의 정체성입니다. 예측하지 않고, 규칙을 잘 세워 감정 없이 이행하고, 기록으로 규칙을 고칩니다. 모의계좌는 가상 돈이라 누구나 같은 계좌로 연습할 수 있습니다.')}</h3><ol class="pp-order"><li><b>세 질문</b>으로 허용 손실·분산·점검 주기를 숫자로<small>규칙 화면 · 한 달 손실 5/10/20% → 하루 한도·현금 최소·종목 상한</small></li><li>종목은 <b>가설</b>로만<small>왜·언제까지·깨지는 조건·한도를 적어 등록</small></li><li><b>과거 데이터 시뮬</b>로 보유·지수와 비교<small>한 기간이 아니라 3·6·12·18개월 모두에서 손실이 작은 규칙을 고름</small></li><li><b>실시간 모의계좌</b>로 앞으로 검증<small>같은 규칙·계획을 한투 모의계좌가 자동 이행 · 체결은 한투 모의 서버의 판정이지 거래소 체결이 아님</small></li><li><b>기록으로 점검</b><small>한도 넘은 날·매매 횟수·막힌 이유로 규칙을 고침</small></li></ol><div class="cr-actions"><button type="button" class="secondary" data-core-go="rules">규칙 화면</button></div></div>
<div class="cr-card"><h3>절차</h3><ol class="pp-steps"><li>계획 비중<small>규칙의 한 종목 상한·현금 최소 비중 안에서 종목마다 균등</small></li><li>오늘 점검<small>주 마지막 거래일 종가(급할 때는 그날)에 규칙과 비교해 할 일을 냄</small></li><li>매매 전 확인<small>할 일마다 현금·비중·하루 손실 한도·매매 횟수를 확인, 하나라도 어기면 주문하지 않음</small></li><li>체결<small>다음 거래일 시가에 0.1% 불리하게, 편도 비용 0.2%, 국내 주식 1주 단위</small></li><li>평가와 비교<small>날마다 원화 환산, 같은 계획을 한 번 사서 둔 경우·지수와 비교</small></li></ol></div>
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

window.addEventListener('teamquant:asset-snapshot', e => { const ps = (e.detail?.positions || []).filter(p => p.symbol); S.mine = ps.map(p => ({ symbol: p.symbol, name: p.name || stockName(p.symbol), currency: p.currency || 'KRW' })); const o = $('#pp-basket option[value="mine"]'); o.disabled = !S.mine.length; o.textContent = S.mine.length ? `내 보유 종목 ${S.mine.length}개${e.detail?.paper ? ' (모의계좌)' : e.detail?.demo ? ' (예시 자산)' : ''}` : '내 보유 종목 (계좌 연결 또는 예시 자산 필요)'; });
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
  o1.disabled = !pb.basket.length; o1.textContent = pb.basket.length ? `모의계좌 기본 계획 ${pb.version || ''} · ${pb.basket.length}종목 · 현금 ${pb.cashPct}% (비중 그대로)` : '모의계좌 기본 계획 (자료 없음)';
  o2.disabled = !held.length; o2.textContent = held.length ? `모의계좌 지금 보유 ${held.length}종목 (균등)` : '모의계좌 지금 보유 종목 (없음)';
  if (/^mock/.test($('#pp-basket').value) && $('#pp-basket').selectedOptions[0]?.disabled) $('#pp-basket').value = o1.disabled ? (o2.disabled ? 'demo' : 'mockheld') : 'mockplan';
  $('#pp-rules').textContent = rulesLine(simRules()) + ' · ' + rulesSource();
}
async function loadMock() { try { applyMockOptions(await loadMockAccount({ fresh: true })); } catch { applyMockOptions(null); } return S.mock; }
function mockRules() { const r = S.mock?.prefs?.rules; return r ? normalizeRules(r).rules : null; }
const usingMock = () => /^mock/.test($('#pp-basket').value) && !!mockRules();
function simRules() { return usingMock() ? mockRules() : currentRules(); }
function rulesSource() { return usingMock() ? `모의계좌 PC 저장 규칙 (${String(S.mock.prefs.savedAt || '').slice(0, 10)})` : '규칙 화면의 내 규칙'; }
function planOf() { return $('#pp-basket').value === 'mockplan' && S.mock ? planBasketFrom(S.mock).plan : null; }
$('#pp-basket').addEventListener('change', () => { $('#pp-rules').textContent = rulesLine(simRules()) + ' · ' + rulesSource(); });

async function basketOf() {
  const kind = $('#pp-basket').value;
  if (kind === 'demo') return DEMO;
  if (kind === 'mockplan' || kind === 'mockheld') { if (!S.mock) await loadMock(); const b = kind === 'mockplan' ? planBasketFrom(S.mock).basket : heldBasketFrom(S.mock); if (!b.length) throw new Error('모의계좌 자료가 없습니다. PC 서버를 켜거나 저장소의 공개 파일이 올라올 때까지 기다리십시오.'); return b.slice(0, 24); }
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
    const basket = live ? live.basket : await basketOf(), rules = live ? normalizeRules(live.rules || {}).rules : simRules(), plan = live ? (live.plan || null) : planOf(), rulesFrom = live ? '시작할 때 고정한 규칙' : rulesSource();
    const from = live ? live.startDate : daysAgo(Number($('#pp-range').value));
    result.innerHTML = '<div class="cr-card"><div class="shimmer ct-skel"></div><div class="shimmer ct-skel"></div><p class="cr-muted">시세를 받아 절차를 재생하는 중…</p></div>';
    const krw = basket.filter(b => b.currency === 'KRW').length, benchDef = krw * 2 >= basket.length ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW' } : { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD' };
    const [{ candles, failed }, fx, kodex, spy] = await Promise.all([loadCandles(basket), fetchCandles('KRW=X', 'USD', '2y').then(d => d.candles).catch(() => []), fetchCandles('069500', 'KRW', '2y').then(d => d.candles).catch(() => null), fetchCandles('SPY', 'USD', '2y').then(d => d.candles).catch(() => null)]);
    const indexes = { KR: kodex ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: kodex } : null, US: spy ? { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: spy } : null }, bench = benchDef.symbol === 'SPY' ? spy : kodex;
    if (id !== S.run) return;
    await new Promise(r => setTimeout(r, 0));
    const r = rehearse({ basket, capitalKrw: capital, rules, plan, candlesBySymbol: candles, fxCandles: fx, from, to: today(), benchmark: bench ? { ...benchDef, candles: bench } : null, indexes, label: live ? '시뮬 기록' : '과거 데이터 시뮬' });
    if (id !== S.run) return;
    if (!r.ok) { result.innerHTML = `<div class="cr-card"><p class="cr-muted">${esc(r.reason)}${live ? ' 시작일 다음 거래일부터 체결이 기록됩니다.' : ''}</p></div>`; return; }
    const fr = forwardRange({ positions: r.end.positions, cashKrw: r.end.cash, candlesBySymbol: candles, fxCandles: fx });
    S.last = { r, fr, failed, live: !!live, rulesFrom, inputs: { basket, plan, capital, candles, fx, benchmark: bench ? { ...benchDef, candles: bench } : null, indexes, rules } }; S.journalFilter = '전체'; S.journalAll = false; S.review = null;
    render(); scheduleReview();
  } catch (e) { if (id === S.run) { state.textContent = e.message; result.innerHTML = ''; } }
}

function lineSvg(series, hasBench) {
  const W = 720, H = 220, L = 40, R = 10, T = 10, B = 24, keys = [['rule', '절차대로'], ['hold', '그냥 보유'], ...(hasBench ? [['bench', '지수'], ['mix', '지수+현금']] : [])];
  const vals = series.flatMap(p => keys.map(([k]) => p[k])).filter(Number.isFinite), lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
  const X = i => L + i / Math.max(1, series.length - 1) * (W - L - R), Y = v => T + (hi - v) / (hi - lo || 1) * (H - T - B);
  const path = k => series.map((p, i) => Number.isFinite(p[k]) ? `${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}` : '').filter(Boolean).join(' ');
  return `<div class="rp-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="절차대로·그냥 보유·지수(시작=100)">${[lo, (lo + hi) / 2, hi].map(v => `<line class="g" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`).join('')}<line class="b" x1="${L}" x2="${W - R}" y1="${Y(100)}" y2="${Y(100)}"/>${keys.map(([k]) => `<polyline class="l-${k === 'rule' ? 'actual' : k}" points="${path(k)}"/>`).join('')}<text x="${L}" y="${H - 6}">${series[0].date}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${series.at(-1).date}</text></svg>
  <div class="rp-legend">${keys.map(([k, l]) => `<span><i class="l-${k === 'rule' ? 'actual' : k}"></i>${l}</span>`).join('')}<span class="cr-muted">시작=100 · 원화</span></div></div>`;
}

function render() {
  const { r, fr, failed, live } = S.last, m = r.metrics, a = r.activity, body = $('#pp-result');
  const better = r.diff.vsHoldPct, mddBetter = r.diff.mddVsHoldPct;
  const verdict = `절차대로 <b class="${tone(m.rule.ret)}">${pct(m.rule.ret)}</b> · 그냥 보유 ${pct(m.hold.ret)}${m.bench ? ` · ${esc(r.benchmark.name)} ${pct(m.bench.ret)}` : ''}${m.mix ? ` · ${esc(r.mix.name)} ${pct(m.mix.ret)}` : ''}<br><span class="cr-muted">보유보다 수익률 ${pp(better)}, 최대 손실은 ${Math.abs(mddBetter) < 0.05 ? '같음' : mddBetter > 0 ? `${mddBetter.toFixed(1)}%p 작음` : `${(-mddBetter).toFixed(1)}%p 큼`}${m.mix ? ` · 같은 투자 비중의 지수+현금보다 최대 손실 ${Math.abs(r.diff.mddVsMixPct) < 0.05 ? '같음' : r.diff.mddVsMixPct > 0 ? `${r.diff.mddVsMixPct.toFixed(1)}%p 작음` : `${(-r.diff.mddVsMixPct).toFixed(1)}%p 큼`}` : ''}</span>`;
  const tile = (label, mm, me = false) => `<div class="${me ? 'me' : ''}"><span class="cr-muted">${label}</span><br><b>${won(mm.end)}</b><br><span class="${tone(mm.ret)}">${pct(mm.ret)}</span> · 최대 손실 ${pct(mm.mdd)}</div>`;
  const blocked = Object.entries(a.blocked).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${CHECK_LABEL[k] || k} ${v}건`).join(', ');
  const steps = ['전체', '점검', '주문', '체결', '차단', '미체결', '손실'];
  const rows = r.journal.filter(j => S.journalFilter === '전체' || j.step === S.journalFilter), shown = S.journalAll ? rows : rows.slice(0, 60);
  const holdRows = r.end.positions.filter(p => p.qty > 0).sort((x, y) => y.valueKrw - x.valueKrw).map(p => `<tr><td>${esc(p.name)}</td><td>${p.currency === 'USD' ? p.qty.toFixed(4) : p.qty.toLocaleString('ko-KR')}</td><td>${won(p.valueKrw)}</td><td>${p.weightPct.toFixed(1)}%</td><td class="${tone(p.pnlKrw)}">${swon(p.pnlKrw)}</td></tr>`).join('');
  body.innerHTML = `<div class="cr-card"><header><h3>${live ? '시뮬 기록(증권사 없이)' : '시뮬 결과'} <span class="cr-muted">${r.from} ~ ${r.to} · ${r.days}거래일</span></h3></header>
  <p class="rp-verdict">${verdict}</p>
  <p class="cr-muted" style="margin:-4px 0 10px">종목 ${Object.keys(r.plan).length}개 · 계획 비중 합 ${Object.values(r.plan).reduce((a, b) => a + b, 0).toFixed(0)}% (나머지 현금) · 규칙: ${esc(S.last.rulesFrom || '')} · 자금 ${won(r.capitalKrw)}</p>
  <div class="rp-tiles">${tile('절차대로', m.rule, true)}${tile('그냥 보유 (같은 종목·같은 비중)', m.hold)}${m.bench ? tile(esc(r.benchmark.name), m.bench) : '<div><span class="cr-muted">지수</span><br><b>—</b></div>'}${m.mix ? tile(esc(r.mix.name), m.mix) : ''}</div>
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
  body.insertAdjacentHTML('beforeend', '<div id="pp-review"></div>'); renderReview();
}

// ── 전략 검토: 같은 종목·네 기간에 규칙만 바꿔 다시 돌린다(측정이지 예측이 아니다) ──
function scheduleReview() { const id = S.run; setTimeout(() => { if (id !== S.run || !S.last?.inputs) return; try { const i = S.last.inputs; S.review = compareRuleSets({ basket: i.basket, plan: i.plan, capitalKrw: i.capital, candlesBySymbol: i.candles, fxCandles: i.fx, benchmark: i.benchmark, indexes: i.indexes, to: today(), current: { label: `지금 쓴 규칙`, rules: i.rules } }); } catch (e) { S.review = { error: e.message }; } renderReview(); }, 30); }
function renderReview() {
  const box = $('#pp-review'); if (!box) return; const v = S.review;
  if (!v) { box.innerHTML = `<div class="cr-card"><header><h3>전략 검토 — 규칙을 바꿨다면</h3></header><div class="shimmer ct-skel"></div><p class="cr-muted">같은 종목·네 기간에 규칙 네 가지를 다시 돌리는 중…</p></div>`; return; }
  if (v.error) { box.innerHTML = `<div class="cr-card"><header><h3>전략 검토</h3></header><p class="cr-muted">${esc(v.error)}</p></div>`; return; }
  const ws = v.windows.filter(w => v.hold[w.id]), sp = x => `${x > 0 ? '+' : ''}${x}%`;
  const cellHtml = c => c?.ok ? `<span class="${c.ret >= 0 ? 'up' : 'down'}">${sp(c.ret)}</span><small>보유 대비 ${c.vsHold > 0 ? '+' : ''}${c.vsHold}%p · 최대 손실 ${c.mdd}%</small><small>매매 ${c.trades}회 · 막힘 ${c.blocked}건 · 현금 ${c.cashAvg}%</small>` : `<span class="cr-muted">—</span><small>${esc(c?.reason || '')}</small>`;
  const sig = r => ws.map(w => JSON.stringify(r.cells[w.id])).join('|'), cur = v.rows.find(r => r.id === 'current'), twin = cur ? v.rows.find(r => r.id !== 'current' && sig(r) === sig(cur)) : null;
  const rows = v.rows.map(r => `<tr class="${r.id === 'current' ? 'me' : ''}"><td><b>${esc(r.label)}</b>${r.id === 'current' && twin ? `<small>${esc(twin.label)}과 결과 같음</small>` : ''}<small>하루 ${r.rules.dailyLoss}% · 종목 ${r.rules.maxSingle}% · 현금 ${r.rules.minCash}% · 30일 ${r.rules.maxTrades30}회</small>${r.prefs ? `<button type="button" class="secondary" data-rv-use="${esc(r.id)}">이 규칙을 세 질문에 넣기</button>` : ''}</td>${ws.map(w => `<td>${cellHtml(r.cells[w.id])}</td>`).join('')}</tr>`).join('');
  const hold = `<tr><td><b>그냥 보유</b><small>같은 비중을 한 번 사서 둠</small></td>${ws.map(w => `<td><span class="${v.hold[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.hold[w.id].ret)}</span><small>최대 손실 ${v.hold[w.id].mdd}%</small></td>`).join('')}</tr>`;
  const bn = ws.map(w => v.bench[w.id]?.name).find(Boolean), bench = bn ? `<tr><td><b>${esc(bn)}</b><small>지수를 샀다면</small></td>${ws.map(w => v.bench[w.id] ? `<td><span class="${v.bench[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.bench[w.id].ret)}</span><small>최대 손실 ${v.bench[w.id].mdd}%</small></td>` : '<td>—</td>').join('')}</tr>` : '';
  const mn = ws.map(w => v.mix?.[w.id]?.name).find(Boolean), mixRow = mn ? `<tr><td><b>${esc(mn)}</b><small>국가 비중·현금만 맞춘 비교선 · 주식·채권 구성까지 같은 위험은 아님</small></td>${ws.map(w => v.mix[w.id] ? `<td><span class="${v.mix[w.id].ret >= 0 ? 'up' : 'down'}">${sp(v.mix[w.id].ret)}</span><small>최대 손실 ${v.mix[w.id].mdd}%</small></td>` : '<td>—</td>').join('')}</tr>` : '';
  box.innerHTML = `<div class="cr-card"><header><h3>전략 검토 — 규칙을 바꿨다면 ${tip('같은 종목·같은 계획 비중에 규칙만 바꿔 네 기간(3·6·12·18개월, 오늘까지)을 다시 돌린 결과입니다. 계획 비중은 각 규칙의 현금 최소·한 종목 상한에 맞춰 줄였습니다. 한 기간의 1등을 고르면 그 기간에 맞춘 규칙이 됩니다. 예측이 아니라 측정입니다.')}</h3><span class="cr-muted">끝 ${v.to} · 자금 ${won(S.last.inputs.capital)}</span></header>
  <div class="pp-scroll"><table class="pp-rv"><thead><tr><th>규칙</th>${ws.map(w => `<th>${w.label}<small>${w.from} ~</small></th>`).join('')}</tr></thead><tbody>${rows}${hold}${mixRow}${bench}</tbody></table></div>
  <ul class="ct-actions" style="margin:10px 0 0">${v.findings.map(f => `<li${f.key === 'caution' ? ' class="cr-muted"' : ''}>${esc(f.text)}</li>`).join('')}</ul></div>`;
  box.querySelectorAll('[data-rv-use]').forEach(b => b.onclick = () => { const row = v.rows.find(r => r.id === b.dataset.rvUse); if (!row?.prefs) return; const k = document.body.dataset.account, key = `teamQuantRules:${session()}${k === 'paper' ? ':paper' : k === 'demo' ? ':demo' : ''}`; let saved = null; try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch { } try { localStorage.setItem(key, JSON.stringify({ rules: row.rules, plan: saved?.plan || null, prefs: row.prefs, version: RULES_VERSION, savedAt: new Date().toISOString() })); } catch { } $('#pp-state').textContent = `${row.label} 규칙을 세 질문에 넣었습니다. 규칙 화면에서 확인하고 PC 모의계좌에도 적용할 수 있습니다.`; $('[data-view="rules"]')?.click(); });
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
    const live = { version: PAPER_VERSION, startDate: today(), startedAt: new Date().toISOString(), capitalKrw: capital, basket, plan: planOf(), rules: simRules(), rulesFrom: rulesSource() };
    saveLive(live); renderLive(); void run({ live });
    $('#pp-state').textContent = `${live.startDate}부터 시작. 볼 때마다 시작일부터 오늘까지 같은 절차를 다시 재생합니다.`;
  } catch (e) { $('#pp-state').textContent = e.message; }
};
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page !== 'paper') return; void loadMock(); renderLive(); const live = loadLive(); if (live && !S.last) void run({ live }); });
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
// 운용 상태 띠: "지금 돌아가고 있는가"에 먼저 답한다(운용 상태 · 마지막 자동 실행 · 다음 점검 · 계획 버전·시장별 적용 · 투자 비중과 미집행 사유).
function statusStrip(s) {
  const rs = runState(s), inv = invested(s), nc = nextChecks(s), gaps = planGaps(s), la = lastAuto(s);
  const t = $('#pp-kis-title-state'); if (t) { t.textContent = rs.label; t.className = rs.state === 'running' ? 'run' : 'stop'; }
  const ap = ['KR', 'US'].map(m => { const a = planAppliedFor(s, m); return `${MARKET_NAME[m]} <b class="${a.applied === false ? 'stop' : ''}">${esc(a.label)}</b>`; }).join(' · ');
  const f0 = v => v === null || v === undefined ? '—' : `${Number(v).toFixed(0)}%`;
  const gapLines = gaps.filter(g => g.reason).map(g => `<div class="pp-gap">계획의 ${esc(g.name)} ${g.planPct}%${g.heldPct > 0 ? ` 중 ${g.gapPct}%p` : ''}가 아직 집행되지 않았습니다 (원인: ${esc(g.reason)}) ${tip('계획 비중과 실제 보유 비중의 차이가 10%p 넘는 시장입니다. 원인은 그 시장의 마지막 자동 실행 기록(보냄·차단 건수와 가장 많은 차단 이유)에서 가져왔습니다. 다음 자동 실행에서 다시 시도합니다.')}</div>`).join('');
  return `<div class="pp-strip">
  <div><span>운용 상태 ${tip('서버의 자동 운용이 켜져 있고 마지막 평가가 2일 안이면 "진행 중". 자동 운용이 꺼졌으면 "정지", 평가가 2일 넘게 없으면 "PC 서버 꺼짐", 킬 스위치가 켜졌으면 "전체 정지". 자료에 자동 운용 플래그가 없으면 최근 7일의 자동 실행 기록으로 추정합니다.')}</span><b class="${rs.state === 'running' ? 'run' : 'stop'}">${esc(rs.label)}</b><small>${rs.lastMarkDate ? `마지막 평가 ${esc(rs.lastMarkDate)}` : '평가 기록 없음'}${rs.inferred && rs.state !== 'killed' ? ' · 플래그 없음(기록으로 추정)' : ''} · ${s.live ? 'PC 실시간' : '공개 파일'}</small></div>
  <div><span>마지막 자동 실행 ${tip('서버가 시장마다 하루 한 번 자동으로 돌린 기록입니다(KST). 보냄은 증권사 모의 서버에 접수된 주문 수, 차단은 매매 전 확인·주문 보호에 막힌 수입니다.')}</span>${la ? `<b>${esc(kstStamp(la.at))}</b><small>${esc(MARKET_NAME[la.market] || la.market || '')} · ${esc(la.reason || '')} · 보냄 ${la.sent}건 · 차단 ${la.blocked}건${la.topBlock ? `<br>주된 차단 이유: ${esc(la.topBlock)}` : ''}</small>` : '<b>없음</b><small>아직 자동 실행 기록이 없습니다</small>'}</div>
  <div><span>다음 점검 ${tip(nc.note)}</span>${nc.checks.map(c => `<b>${esc(c.name)} ${esc(c.kst)}</b>`).join('<br>') || '<b>—</b>'}<small>${esc(nc.cadenceLabel)} · 계획 변경·첫 운용·급할 때는 그날 바로</small></div>
  <div><span>계획 버전 ${tip('기본 계획(data/paper-plan.json)의 버전에 승인된 가설·규칙 해시를 붙인 것입니다. "적용"은 그 시장에서 이 버전으로 주문이 실제로 나간 상태, "미적용"은 아직 안 나갔거나 실행했지만 전부 차단된 상태입니다.')}</span><b>${esc(s.planVersionNow || s.defaultPlanVersion || '—')}</b><small>${ap}</small></div>
  <div><span>투자 비중 ${tip('현재 = 주식 평가액 ÷ 총자산, 계획 = 100 − 계획의 현금 비중. 둘이 많이 다르면 계획의 일부가 아직 집행되지 않은 것이고, 그 사유를 아래 줄에 적습니다. 모의계좌 전체가 아니라 계획이 정한 만큼만 사는 것이 정상입니다.')}</span><b>현재 ${f0(inv.nowPct)} · 계획 ${f0(inv.planPct)}</b><small>${gaps.map(g => `${esc(g.name)} ${g.heldPct === null ? '—' : g.heldPct + '%'} / 계획 ${g.planPct}%`).join(' · ')}</small></div>
  ${gapLines}</div>`;
}
// 보유 표(담은 이유 포함) + 계획 중 미보유 목록.
function holdingsTable(s) {
  const w = s.planDoc?.weights || {}, ps = (s.balance?.positions || []).filter(p => p.qty > 0).sort((a, b) => (b.valueKrw || 0) - (a.valueKrw || 0)), nh = plannedNotHeld(s);
  const why = p => { const v = w[p.symbol]; if (!(v?.pct > 0)) return '<span class="stop">계획에 없음(정리 대상)</span>'; return `<b>계획 ${v.pct}%</b>${v.sectorName ? ` · ${esc(v.sectorName)}` : ''}${v.vol1y ? ` · 변동성 연 ${esc(v.vol1y)}%` : ''}${(v.why || []).length ? `<br>${v.why.map(esc).join(' · ')}` : ''}${v.exposure?.length ? `<br>노출: ${v.exposure.map(esc).join(' / ')}` : ''}`; };
  const held = ps.length ? `<details class="pp-kis-plan" open id="pp-kis-held"><summary>보유 ${ps.length}종목 ${tip('담은 이유는 기본 계획(data/paper-plan.json)의 종목별 메모입니다. 비중은 변동성 역수이고, 노출은 날짜가 붙은 정책·정치 사건 중 이 종목이 걸린 것입니다. 오를 종목을 고른 것이 아니라 노출을 나눈 것입니다.')}</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수량</th><th>평가액</th><th>비중</th><th style="text-align:left">담은 이유</th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.name)}<br><small class="cr-muted">${esc(p.symbol)} · ${esc(p.currency)}</small></td><td>${p.qty}</td><td>${won(p.valueKrw)}</td><td>${Number.isFinite(p.weightPct) ? p.weightPct.toFixed(1) + '%' : '—'}</td><td class="pp-why">${why(p)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  const miss = nh.length ? `<details class="pp-kis-plan" open id="pp-kis-missing"><summary>계획 중 미보유 ${nh.length}종목 (목표 합 ${nh.reduce((a, b) => a + b.pct, 0).toFixed(1)}%) ${tip('계획에는 있지만 모의계좌에 아직 없는 종목입니다. 목표 비중과 아직 없는 이유를 마지막 주문·자동 실행 기록에서 가져왔습니다. 다음 자동 실행(계획 변경·금요일)에서 다시 시도합니다.')}</summary><ul class="pp-kis-items">${nh.map(n => `<li class="bad"><span class="st">${esc(n.name)}</span> <small class="cr-muted" style="display:inline">${esc(n.symbol)} · ${esc(n.currency)}</small> · 목표 ${n.pct}%<small>${esc(n.reason)}</small></li>`).join('')}</ul></details>` : '';
  return held + miss;
}
function activityHtml(s) { const a = s.activity30; if (!a) return ''; return `<p class="pp-kis-note">최근 30일 · 매매 결정 <b>${a.decisions}</b>회${a.batches ? ` (재조정 묶음 ${a.batches}개는 각 1회)` : ''} · 실제 주문 <b>${a.orders}</b>건 · 체결 <b>${a.fills}</b>건${a.turnoverPct !== null && a.turnoverPct !== undefined ? ` · 회전율 ${a.turnoverPct}%` : ''}${a.rejected ? ` · 거부 ${a.rejected}` : ''}${a.notFound ? ` · 미확인 ${a.notFound}` : ''} ${tip('매매 결정 횟수는 규칙의 30일 상한에 쓰는 수입니다. 재조정 묶음(계획 변경·첫 운용)은 결정 1회로 세지만 주문은 여러 건이므로 실제 주문·체결 건수와 회전율(체결 금액 ÷ 평균 총자산)을 따로 보여 줍니다.')}</p>`; }
// 점검 항목은 서버가 주는 items[] 그대로 그린다(새 항목, 예: 마감 뒤 남은 미체결 leftOpen 도 자동으로 보인다). 목표(target)를 넘으면 붉게.
function integrityHtml(s) { const g = s.integrity; if (!g) return ''; return `<p class="pp-kis-note">시스템 점검 <b class="${g.ok ? '' : 'cr-err'}">${g.ok ? '이상 없음' : '확인 필요'}</b> · ${(g.items || []).map(i => `${esc(i.label || i.key || '')} <b class="${(i.count || 0) > (i.target || 0) ? 'cr-err' : ''}">${i.count ?? 0}건</b>`).join(' · ')}${g.pending ? ` · 진행 중 ${g.pending}건` : ''} ${tip('소프트웨어 검증 지표입니다. 모두 0건이 목표입니다. 어떤 오류가 한 번도 안 났다고 안전이 증명되는 것은 아니므로 합성 테스트가 상황을 강제로 만듭니다(test/paper-integrity.test.js).')}</p>`; }
function sleeveHtml(s) { const v = s.sleeve; if (!v) return ''; const t = tip('개별 종목(위성)을 고른 것이 지수보다 나았는지 따로 봅니다. 종목마다 첫 매수 뒤 수익을 같은 기간 그 나라 지수(KODEX 200 · S&P500 ETF)와 비교해 평가액 가중으로 묶은 값입니다. 단계는 나눠 사기 진행(1 = 목표의 60%, 2 = 80%, 3 = 100%)입니다.'); if (!v.n) return `<p class="pp-kis-note">위성 묶음 <b>—</b> <span class="cr-muted">(아직 체결된 위성 종목 없음)</span> ${t}</p>`; return `<p class="pp-kis-note">위성 묶음 ${v.n}종목 · 지수 대비 <b class="${v.excessPp >= 0 ? '' : 'cr-err'}">${v.excessPp >= 0 ? '+' : '−'}${Math.abs(v.excessPp).toFixed(1)}%p</b> ${t}</p><details class="pp-kis-plan"><summary>위성 종목별</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수익</th><th>지수</th><th>차이</th><th>단계</th></tr></thead><tbody>${v.items.map(i => `<tr><td>${esc(i.name)}<br><small class="cr-muted">${esc(i.since)} ~</small></td><td>${pct(i.returnPct)}</td><td>${i.indexPct == null ? '—' : pct(i.indexPct)}</td><td>${i.excessPct == null ? '—' : pct(i.excessPct)}</td><td>${i.step ?? 1}/3</td></tr>`).join('')}</tbody></table></div></details>`; }
function issuesHtml(s) { const xs = s.issues || []; if (!xs.length) return `<p class="pp-kis-note">이슈 대응 <b>해당 없음</b> ${tip('위성 종목의 공시(국내 DART · 미국 SEC 8-K)를 10분마다 읽습니다. 주의(유상증자·소송·임원 변경 등)면 그 종목 추가 매수를 14일 멈추고, 긴급(횡령·배임·감사의견·거래정지·주요 계약 해지 등)이면 계획 비중을 절반으로 줄여 다음 열린 장에서 팝니다. 지수는 건드리지 않습니다. 뉴스·발언은 아직 보지 않습니다.')}</p>`; return `<p class="pp-kis-note">이슈 대응 <b class="cr-err">${xs.length}건</b></p><ul class="pp-kis-items">${xs.map(i => `<li class="bad"><span class="st">${i.level === 'urgent' ? '긴급' : '주의'}</span> · ${esc(i.name)} — ${i.level === 'urgent' ? '계획 비중 절반 · 추가 매수 정지' : '추가 매수 정지'} (${esc(String(i.until || '').slice(0, 10))}까지)<small>${esc(i.source || '')} ${esc(i.date || '')} · ${esc(i.reason || '')}</small></li>`).join('')}</ul>`; }
function historyHtml(s) { const h = (s.prefsHistory || []).filter(x => !(x.changed || []).includes('init')); if (!h.length) return ''; return `<details class="pp-kis-plan"><summary>규칙 변경 이력 ${h.length}회</summary><ul class="pp-steps">${h.slice().reverse().map(x => `<li>${esc(String(x.at).slice(0, 10))} · ${esc((x.changed || []).join(', '))}<small>근거: ${esc(x.reason || '—')}${x.expected ? ' · 기대: ' + esc(x.expected) : ''}</small></li>`).join('')}</ul><p class="pp-kis-note">바꾼 뒤의 결과는 새 규칙의 평가이고, 바꾸기 전 결과와 합치지 않습니다. 기준선(아래)은 처음 규칙·계획을 고정해 계속 추적합니다.</p></details>`; }
function baselineHtml(s) { const b = s.baseline; if (!b) return ''; return `<details class="pp-kis-plan" id="pp-baseline"><summary>기준선과 비교 — ${esc(b.from)}의 계획·규칙을 바꾸지 않았다면</summary><div id="pp-baseline-body"><p class="cr-muted">열면 공개 일봉으로 ${esc(b.from)}부터 오늘까지 기준선(${Object.keys(b.plan || {}).length}종목 · 고정 규칙)을 다시 돌려 실제 모의계좌와 나란히 놓습니다.</p></div></details>`; }
async function wireBaseline(s) { const d = $('#pp-baseline'); if (!d) return; d.addEventListener('toggle', async () => { if (!d.open || d.dataset.done) return; d.dataset.done = '1'; const box = $('#pp-baseline-body'); box.innerHTML = '<div class="shimmer ct-skel"></div>'; try { const b = s.baseline, basket = Object.entries(b.plan).map(([symbol, v]) => ({ symbol, name: v.name || symbol, currency: v.currency || (/^\d{6}$/.test(symbol) ? 'KRW' : 'USD') })), plan = Object.fromEntries(Object.entries(b.plan).map(([k, v]) => [k, v.pct])); const [{ candles }, fx, bench, spy] = await Promise.all([loadCandles(basket), fetchCandles('KRW=X', 'USD', '2y').then(x => x.candles).catch(() => []), fetchCandles('069500', 'KRW', '2y').then(x => x.candles).catch(() => null), fetchCandles('SPY', 'USD', '2y').then(x => x.candles).catch(() => null)]); const r = rehearse({ basket, capitalKrw: b.capitalKrw, rules: normalizeRules(b.rules || DEFAULT_RULES).rules, plan, candlesBySymbol: candles, fxCandles: fx, from: b.from, to: today(), benchmark: bench ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: bench } : null, indexes: { KR: bench ? { symbol: '069500', name: 'KODEX 200', currency: 'KRW', candles: bench } : null, US: spy ? { symbol: 'SPY', name: 'S&P500 ETF', currency: 'USD', candles: spy } : null }, label: '기준선' }); const last = s.marks?.at(-1); if (!r.ok) { box.innerHTML = `<p class="cr-muted">${esc(r.reason)} (시작일 다음 거래일부터 계산됩니다)</p>`; return; } box.innerHTML = `<div class="rp-tiles"><div class="me"><span class="cr-muted">실제 모의계좌</span><br><b>${won(last?.total)}</b><br><span class="${tone(last && b.capitalKrw ? last.total / b.capitalKrw - 1 : 0)}">${pct(last && b.capitalKrw ? last.total / b.capitalKrw - 1 : null)}</span></div><div><span class="cr-muted">기준선(규칙·계획 고정, 시뮬)</span><br><b>${won(r.end.total)}</b><br><span class="${tone(r.metrics.rule.ret)}">${pct(r.metrics.rule.ret)}</span></div><div><span class="cr-muted">그냥 보유</span><br><b>${won(r.metrics.hold.end)}</b><br><span class="${tone(r.metrics.hold.ret)}">${pct(r.metrics.hold.ret)}</span></div>${r.metrics.mix ? `<div><span class="cr-muted">${esc(r.mix.name)}</span><br><b>${won(r.metrics.mix.end)}</b><br><span class="${tone(r.metrics.mix.ret)}">${pct(r.metrics.mix.ret)}</span></div>` : ''}${r.metrics.bench ? `<div><span class="cr-muted">KODEX 200</span><br><b>${won(r.metrics.bench.end)}</b><br><span class="${tone(r.metrics.bench.ret)}">${pct(r.metrics.bench.ret)}</span></div>` : ''}</div><p class="pp-kis-note">${r.from} ~ ${r.to} · ${r.days}거래일 · 실제와 기준선의 차이는 규칙·계획 변경과 체결 방식(한투 모의 서버 판정 vs 다음 시가 가정)의 차이입니다. 기준선 시작 전의 변화(첫 재조정 비용 등)는 이 비교에 넣지 않습니다.</p>`; } catch (e) { box.innerHTML = `<p class="cr-muted">${esc(e.message)}</p>`; } }); }
// 운용 헤드라인(결정 21): 굵은 숫자는 '지수 대비' 차이(%p) 하나뿐이다. 절대 수익률은 시장 방향이 만들므로 괄호 안 보조 글자로만 둔다. 비교선 숫자가 없으면(시세 보류·기준선 없음) '—' 와 사유를 보이고 절대 숫자는 작은 회색 글자로 남긴다.
// basis: 'plan'(모의계좌 · 기준선 날 계획의 국가 비중) | 'holdings'(실계좌 · 첫 평가점의 보유 국가 비중 — 계획이 없는 계좌에 '계획에서'라고 쓰면 거짓이다 · 2026-11-12 검토).
function progressHtml(s, { basis = 'plan' } = {}) {
  const m0 = s.marks?.[0], m1 = s.marks?.at(-1); if (!(m0 && m1 && s.marks.length > 1)) return '';
  const bm = s.benchmark || null, w = bm?.weights || null, own = m1.total > 0 && m0.total > 0 ? m1.total / m0.total - 1 : null, label = bm?.label || '국가 비중·현금 일치 지수 투자';
  // 일수·구간은 비교선이 잰 구간(기준선 날부터)을 따른다 — s.marks 는 400개로 잘리고 기준선 전 평가점도 들어 있어 굵은 숫자의 구간과 다를 수 있다. 비교선이 없을 때만 marks 로 대신한다.
  const from = bm?.from || m0.date, asOf = bm?.asOf || m1.date, days = bm?.days || s.marks.length;
  const src = basis === 'holdings' ? `첫 평가점(${esc(from)})의 보유 국가 비중(국내 평가 ÷ 총자산 · 미국 평가×환율 ÷ 총자산 · 나머지 현금)에서` : `기준선을 정한 날(${esc(s.baseline?.from || from)})의 계획에서 국가 비중과 현금 비중만 가져와`;
  const tipText = `비교선 '${label}': ${src} 국내 ${w ? w.KR : '—'}%는 KODEX 200, 미국 ${w ? w.US : '—'}%는 S&P500 ETF(원화 환산), 현금 ${w ? w.cash : '—'}%로 둔 지수 투자입니다. 같은 위험 수준은 아닙니다 — 이 계좌는 개별 종목을 들고 있고 비교선은 지수 둘과 현금뿐입니다. 절대 수익률은 그 기간 시장 방향에 따라 달라지므로 굵은 숫자는 '지수 대비' 차이(%p) 하나만 둡니다. 구간: ${esc(from)}부터 마지막 평가점(${esc(asOf)})까지(비교선이 잰 구간).`;
  const info = `<span class="cr-muted" title="${esc(tipText)}">ⓘ</span>`;
  if (bm && Number.isFinite(bm.diffPp)) return `<p class="pp-kis-note">운용 ${days}일 · 지수 대비 <b class="${tone(bm.diffPp)}">${pp(bm.diffPp)}</b> (절차 ${pct(Number.isFinite(bm.ownRetPct) ? bm.ownRetPct / 100 : own)} · ${esc(label)} ${pct(bm.benchRetPct / 100)})${bm.error ? ` <small class="cr-muted">${esc(bm.error)}</small>` : ''} ${info}</p>`;
  // 사유는 빠진 것에서 고른다: 비교선 객체가 있으면 그 error(없으면 자료 부족) · 없는데 기준선은 있으면 서버가 아직 비교선을 안 실은 공개 파일(갱신 전) · 둘 다 없으면 기준선 없음.
  const why = bm ? (bm.error || '비교할 자료 부족') : s.baseline ? '비교선 자료 없음 · 공개 파일 갱신 전' : '기준선 없음';
  return `<p class="pp-kis-note">운용 ${days}일 · 지수 대비 — <span class="cr-muted">(${esc(why)})</span> <small class="cr-muted">절차 ${pct(own)} · 시작 ${won(m0.total)} → 지금 ${won(m1.total)}</small> ${info}</p>`;
}
// 기록 해시 체인 표시: 서버의 chainCheck(공개하는 조각 — 닫힌 날만 — 으로 검증한 결과)를 그대로 보여 준다. 브라우저에서 다시 계산하지 않는다 — 검증은 `node scripts/kis-paper.mjs verify` 가 공개 파일만으로 한다.
// published:false(실계좌 카드): 그 기록은 공개 파일에 없으므로 공개 파일로 검증하라는 문장을 쓰면 모의계좌 체인을 검증하고 실계좌를 확인했다고 믿게 된다(2026-11-12 검토). 판정 색은 체인 자체(ok)만 따르고 과거 평가 변경은 따로 붉게 쓴다.
function chainHtml(s, { published = true } = {}) { const cc = s.chainCheck, ch = Array.isArray(s.chain) ? s.chain : [], breaks = (s.chainBreaks || []).length, days = cc ? cc.days : ch.length, ok = cc ? cc.ok : null, last = ch.at(-1); const how = published ? '공개 파일에는 닫힌 날(어제까지)만 올라가고 오늘 항목은 자정까지 평가마다 바뀝니다. 공개 파일만 있으면 누구나 다시 계산해 기록이 나중에 바뀌지 않았음을 확인할 수 있습니다(node scripts/kis-paper.mjs verify · 표시 숫자와 봉인 값도 대조).' : '이 기록은 공개 파일에 올라가지 않으므로 검증은 이 PC 의 장부(kis-prod-*.json)로만 할 수 있습니다.'; const tipText = `매일 마감 평가(총자산·현금·보유·그날 확인된 체결)를 전날 기록의 해시와 묶어 해시로 봉인합니다. ${how} 지난 날짜의 항목은 다시 쓰지 않으며, 봉인 뒤 평가점이 바뀌면 '과거 평가 변경'으로 남습니다. ${last?.hash ? `마지막 봉인 ${last.date} 해시 앞 12자: ${last.hash.slice(0, 12)}` : '봉인된 항목 없음'}`; return `<span>기록 <b>${days}일</b> · 해시 체인 <b class="${ok === false ? 'cr-err' : ''}">${ok === null ? '—' : ok ? '정상' : '확인 필요'}</b>${ok === false && cc?.brokenAt ? ` <span class="cr-err">(${esc(cc.brokenAt)}부터)</span>` : ''}${breaks ? ` <span class="cr-err">· 과거 평가 변경 ${breaks}건</span>` : ''} <span class="cr-muted" title="${esc(tipText)}">ⓘ</span></span>`; }
function kisSummary(s) { const b = s.balance; return `<div class="pp-kis-sum"><span><b>${esc(s.label || '한투 모의계좌')}</b>${s.live ? '' : ' <span class="cr-muted">(공개 파일)</span>'}</span><span>장 <b>${s.market?.open ? '열림' : '닫힘'}</b>${s.market?.open ? '' : ` <span class="cr-muted">(${esc(s.market?.reason || '')})</span>`}</span>${b ? `<span>현금 <b>${won(b.cash)}</b>${b.usFundingKrw > 0 ? ` <span class="cr-muted" title="한투 모의계좌는 미국 주식을 원화로 사도 예수금을 빼지 않습니다. 그대로 두면 산 돈과 산 주식이 둘 다 자산으로 잡혀 총자산이 매수금액만큼 부풀려지므로, 증권사가 적은 미국 매입금액(원화)을 정산 전 매수대금으로 보아 현금·총자산에서 뺀 값입니다. 예수금 원본 ${won(b.cashRawKrw)}.">ⓘ 해외 매수 정산 −${won(b.usFundingKrw)}</span>` : ''}</span><span>평가 <b>${won(b.total)}</b></span><span>보유 <b>${b.positions.length}종목</b></span>` : ''}<span>킬 스위치 <b class="${s.killSwitch ? 'on' : ''}">${s.killSwitch ? '켜짐' : '꺼짐'}</b></span><span>한도 1회 <b>${won(s.limits?.maxOrderKrw)}</b> · 하루 <b>${won(s.limits?.maxDailyKrw)}</b></span>${chainHtml(s)}</div>`; }
function kisOrdersTable(list, title) { if (!list?.length) return ''; return `<h4>${esc(title)}</h4><div class="pp-scroll"><table class="pp-journal"><tbody>${list.slice().reverse().map(o => `<tr class="${o.status === 'filled' ? '체결' : /rejected|not_found/.test(o.status) ? '차단' : ''}"><td>${esc(kstStamp(o.at))}</td><td>${o.side === 'BUY' ? '매수' : '매도'}</td><td>${esc(o.name)} ${o.qty}주 @${o.currency === 'USD' ? '$' + Number(o.price).toFixed(2) : won(o.price)}${o.filledQty ? ` · 체결 ${o.filledQty}주` : ''}<br><small class="cr-muted">${esc(orderStatusLabel(o.status))}${o.odno ? ' #' + esc(o.odno) : ''}${o.error ? ' · ' + esc(o.error) : ''}${o.note ? ' · ' + esc(o.note) : ''}</small></td></tr>`).join('')}</tbody></table></div>`; }
function kisItems(r) { const lab = r.planSource === 'default' && PLAN_DOC ? `검증된 기본 계획 ${PLAN_DOC.version}` : planForKis().label; return `<p class="pp-kis-note">${esc(String(r.at).slice(0, 16).replace('T', ' '))} 기준 · 계획: ${esc(lab)} · 규칙 ${r.evaluation.okCount}/${r.evaluation.known} 충족 · 할 일 ${r.items.length}건${r.skipped?.length ? ` · 해외 종목은 뺌(${esc(r.skipped.join(', '))})` : ''}${r.noData?.length ? ` · 시세 부족: ${esc(r.noData.join(', '))}` : ''}</p>${r.items.length ? `<ul class="pp-kis-items">${r.items.map(i => `<li class="${i.ok ? 'ok' : 'bad'}"><span class="st">${i.ok ? '통과' : '차단'}</span> · ${esc(i.name)} ${i.side === 'BUY' ? '매수' : '매도'} ${i.qty ?? '—'}주 @${i.currency === 'USD' ? '$' + (i.price ?? 0).toFixed(2) : won(i.price)} = ${won(i.amountKrw)}<small>${esc(i.why)}</small>${i.blocks.length ? `<small>${i.blocks.map(esc).join(' · ')}</small>` : ''}${i.warnings?.length ? `<small>! ${i.warnings.map(esc).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : '<p class="cr-muted">오늘은 규칙상 할 일이 없습니다.</p>'}${r.sent?.length ? kisOrdersTable(r.sent, '방금 보낸 주문') : ''}`; }
async function kisRefresh() {
  const card = $('#pp-kis'), body = $('#pp-kis-body'); if (!card) return;
  // PC(실시간)가 안 되면 저장소의 공개 파일을 읽기 전용으로 보여 준다. 모의계좌는 가상 돈이라 누가 봐도 괜찮다.
  let s; try { s = await loadMockAccount({ fresh: true, maxAge: 0 }); } catch (e) { card.hidden = false; $('#pp-kis-actions').hidden = true; body.innerHTML = `<p class="cr-muted">${esc(e.message)}</p>`; const t = $('#pp-kis-title-state'); if (t) { t.textContent = '자료 없음'; t.className = 'stop'; } renderHyp(null); return; }
  applyMockOptions(s); if (s.planDoc) PLAN_DOC = s.planDoc; else await loadPlanDoc(); K.status = s; card.hidden = false; $('#pp-kis-actions').hidden = !s.live;
  const pl = planForKis(), prog = progressHtml(s);
  const stale = s.markStale ? '<p class="cr-err">환율을 읽지 못해 총자산 평가를 보류했습니다(마지막 정상 평가 표시). 미국 자산이 있는 동안 모든 주문이 보류됩니다.</p>' : '';
  const ro = stale + (s.live ? '' : `<p class="pp-ro">읽기 전용 · 저장소에 올린 공개 파일 (${esc(String(s.asOf || '').slice(0, 16).replace('T', ' '))}) · 주문·가설 등록은 모의투자 키가 있는 PC 에 연결했을 때만 됩니다.</p>`);
  body.innerHTML = ro + statusStrip(s) + kisSummary(s) + (s.error ? `<p class="cr-err">${esc(s.error)}</p>` : '') + `<p class="pp-kis-note">계획: ${esc(pl.label)}${s.markets?.US ? ` · 미국 장 ${s.markets.US.open ? '열림' : '닫힘'}` : ''}</p>` + prog + activityHtml(s) + sleeveHtml(s) + integrityHtml(s) + issuesHtml(s) + holdingsTable(s) + baselineHtml(s) + historyHtml(s) + planDocHtml(pl.source === 'default' ? PLAN_DOC : null) + kisOrdersTable(s.live ? s.ordersToday : s.recentOrders, s.live ? '오늘 주문' : '최근 주문');
  wireBaseline(s);
  $('#pp-kis-kill').textContent = s.killSwitch ? '정지 해제' : '전체 정지'; renderHyp(s.hypotheses || [], !s.live);
}
async function kisPreview() { const st = $('#pp-kis-state'); st.textContent = '잔고·시세를 읽고 할 일을 정하는 중…'; K.armed = false; $('#pp-kis-run').textContent = '모의계좌에 주문 보내기'; try { const { plan } = planForKis(); const r = await privateRead('paper-live-preview', { rules: currentRules(), rebalance: $('#pp-kis-rebal')?.checked === true, ...(plan ? { plan } : {}) }); K.preview = r; $('#pp-kis-result').innerHTML = kisItems(r); const n = r.items.filter(i => i.ok).length; $('#pp-kis-run').disabled = n === 0; st.textContent = n ? `통과 ${n}건. "모의계좌에 주문 보내기"를 두 번 누르면 보냅니다.` : (r.items.length ? '통과한 주문이 없어 보낼 것이 없습니다.' : ''); } catch (e) { st.textContent = e?.message || '미리보기에 실패했습니다.'; } }
async function kisRun() { const st = $('#pp-kis-state'), btn = $('#pp-kis-run'); if (!K.preview) return; if (!K.armed) { K.armed = true; btn.textContent = `정말 보내기 (${K.preview.items.filter(i => i.ok).length}건)`; st.textContent = '한 번 더 누르면 모의계좌에 지정가 주문이 나갑니다. 실전 계좌가 아닙니다.'; return; } K.armed = false; btn.disabled = true; btn.textContent = '보내는 중…'; try { const { plan } = planForKis(); const r = await privateRead('paper-live-run', { rules: currentRules(), rebalance: $('#pp-kis-rebal')?.checked === true, ...(plan ? { plan } : {}) }); K.preview = null; $('#pp-kis-result').innerHTML = kisItems(r); st.textContent = `보냄 ${r.sent.filter(o => o.status === 'sent').length}건 · 거부 ${r.sent.filter(o => o.status === 'rejected').length}건 · 미확인 ${r.sent.filter(o => o.status === 'unknown').length}건${r.sent.some(o => o.status === 'expired') ? ` · 소멸(마감) ${r.sent.filter(o => o.status === 'expired').length}건` : ''}${r.note ? ' · ' + r.note : ''}`; await kisRefresh(); } catch (e) { st.textContent = e?.message || '주문에 실패했습니다.'; } finally { btn.textContent = '모의계좌에 주문 보내기'; } }
async function kisKill() { const st = $('#pp-kis-state'); try { const on = !K.status?.killSwitch; const r = await privateRead('paper-live-kill', { on }); st.textContent = on ? `전체 정지. 열린 주문 ${r.cancelled.length}건 취소 요청.` : '정지를 해제했습니다.'; await kisRefresh(); } catch (e) { st.textContent = e?.message || '처리하지 못했습니다.'; } }
$('#pp-kis-refresh').onclick = kisRefresh; $('#pp-kis-preview').onclick = kisPreview; $('#pp-kis-run').onclick = kisRun; $('#pp-kis-kill').onclick = kisKill;

// ── 실계좌(한투) 읽기 전용 기록(결정 22) ── PC 서버가 KIS_REAL_READONLY=1 로 켜져 있을 때만 보인다(Vercel·공개 파일에는 없다 — 실계좌는 개인 자료라 공개 스냅샷을 쓰지 않는다).
// 조회만 하는 리더의 기록이므로 버튼은 새로고침 하나다. 헤드라인(지수 대비)·해시 체인 표시는 모의계좌 카드의 progressHtml/chainHtml 을 쓰되 문구만 이 계좌에 맞춘다(비교선 비중은 보유에서 · 체인은 공개되지 않음).
// 보류(markStale)면 총자산을 '보류'로 두고 마지막 정상 평가의 날짜·값을 함께 보인다(사유: 환율 없음 · 미국 잔고 조회 실패 · 외화예수금 조회 실패 — 실계좌 기록은 총자산을 모르면 적지 않는다).
function realHoldings(b) { const ps = (b?.positions || []).filter(p => p.qty > 0).sort((a, c) => (c.valueKrw || 0) - (a.valueKrw || 0)); if (!ps.length) return ''; return `<details class="pp-kis-plan"><summary>보유 ${ps.length}종목</summary><div class="pp-scroll"><table class="pp-ref"><thead><tr><th>종목</th><th>수량</th><th>평가액</th></tr></thead><tbody>${ps.map(p => `<tr><td>${esc(p.name)}<br><small class="cr-muted">${esc(p.symbol)} · ${esc(p.currency)}</small></td><td>${p.qty}</td><td>${won(p.valueKrw)}</td></tr>`).join('')}</tbody></table></div></details>`; }
async function realRefresh() {
  const card = $('#pp-real'), body = $('#pp-real-body'); if (!card) return;
  let s; try { s = await privateRead('kis-real-status'); } catch { card.hidden = true; return; } // PC 없음·설정 없음(503) → 카드 숨김
  if (!s || s.readOnly !== true) { card.hidden = true; return; } card.hidden = false; const lab = $('#pp-real-label'); if (lab) lab.textContent = s.label || '한투';
  const b = s.balance, d1 = b && b.usCostKrw > 0 && b.cashUsd === 0 ? `<p class="pp-kis-note">${esc(b.note || '실계좌는 증권사 평가 그대로. 통합증거금으로 원화로 산 미국 주식은 D+1 정산 전까지 과대 평가될 수 있음(2026-11-12 미검증)')}</p>` : '';
  const lastM = s.marks?.at(-1), reason = { fx_missing: '환율을 읽지 못해', us_failed: '미국 잔고 조회에 실패해', us_cash_failed: '외화예수금 조회에 실패해' }[s.staleReason] || '잔고를 다 읽지 못해';
  const stale = s.markStale ? `<p class="cr-err">${reason} 총자산 평가를 보류했습니다${lastM ? ` · 마지막 정상 평가 ${esc(lastM.date)} ${won(lastM.total)}` : ' · 아직 정상 평가가 없습니다'}.</p>` : '';
  body.innerHTML = stale + `<div class="pp-kis-sum"><span><b>${esc(s.account || '실계좌')}</b> <span class="cr-muted">(조회만 · 주문 없음)</span></span>${b && b.cashKnown === false ? `<span>보유 평가 <b>${s.markStale ? '보류' : won(b.total)}</b> ${tip('토스 Open API는 현금을 주지 않아 보유 주식 평가(원화 환산 · 토스 매매기준율)만 셉니다. 수익률은 입금·추가 매수를 뺀 보유 기준 시간가중으로 잽니다(같은 날 사고판 손익·배당 현금은 빠짐).')}</span><span>보유 <b>${b.positions.length}종목</b></span>` : b ? `<span>총자산 평가 <b>${s.markStale ? '보류' : won(b.total)}</b> <span class="cr-muted" title="총자산 = 증권사 국내 총평가(tot_evlu_amt) + 미국 주식 평가×환율 + 외화예수금×환율. 현금은 가수도정산금액이라 D+2 전에는 현금+주식 ≠ 총자산일 수 있습니다. 증권사 평가 그대로이며 모의계좌의 정산 전 매수대금 보정은 쓰지 않습니다.">ⓘ</span></span><span>현금 <b>${won(b.cash)}</b></span><span>보유 <b>${b.positions.length}종목</b></span>` : ''}${chainHtml(s, { published: false })}</div>` + (s.error ? `<p class="cr-err">${esc(s.error)}</p>` : '') + progressHtml(s, { basis: 'holdings' }) + (s.benchmark?.basis === 'twr' ? '<p class="pp-kis-note">수익률은 입금·추가 매수를 뺀 보유 기준(시간가중)입니다 · 현금 제외</p>' : '') + d1 + realHoldings(b) + `<p class="pp-kis-note">${esc(kstStamp(s.asOf))} 기준 · 25분마다 PC 서버가 평가점을 적습니다 · 장부는 PC 에만 남고 공개 파일에 올라가지 않습니다.</p>`;
}
$('#pp-real-refresh').onclick = realRefresh;
window.addEventListener('teamquant:page', () => { if (document.querySelector('.view.active')?.dataset.page === 'paper') { void kisRefresh(); void realRefresh(); } });

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
function phStatusLabel(h) { return h.status === 'proposed' ? '승인 대기 · 계획 반영 전' : h.status === 'open' ? (h.expired ? '기한 지남 · 종료 필요' : '진행 중') : h.status === 'broken' ? '깨짐' : h.verdict === 'right' ? '종료 · 맞음' : h.verdict === 'wrong' ? '종료 · 틀림' : '종료'; }
function renderHyp(list, readOnly = false) {
  const box = $('#pp-hyp-list'); if (!box) return; const sum = $('#pp-hyp-new summary'); if (sum) sum.textContent = readOnly ? '가설 추가 (모의투자 키가 있는 PC 연결 필요)' : '가설 추가'; if (!list) { box.innerHTML = '<p class="cr-muted">모의계좌 자료를 불러오면 가설 목록이 보입니다.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="cr-muted">등록된 가설이 없습니다. 지금 모의계좌는 기본 계획(지수·채권·섹터 대표주)만 들고 있습니다.</p>'; return; }
  const total = K.status?.total || K.status?.balance?.total || null;
  box.innerHTML = [...list].sort((a, b) => (['open', 'proposed'].includes(a.status) ? 0 : 1) - (['open', 'proposed'].includes(b.status) ? 0 : 1) || b.openedAt.localeCompare(a.openedAt)).map(h => `<div class="ph-item"><header><b>${esc(h.name)} <small class="cr-muted">${esc(h.symbol)} · 한도 ${h.capPct}% · ${h.horizonMonths}개월${h.public === false ? ' · 비공개' : ''}</small></b><span class="st ${h.status}">${esc(phStatusLabel(h))}</span></header>
    <div class="num">${h.status === 'proposed' ? `승인하면 계획에 ${h.capPct}% 반영 → 예상 매수 약 ${total ? won(total * h.capPct / 100) : '—'} (다음 장중 자동 재조정)` : h.returnPct !== null && h.returnPct !== undefined ? `진입 대비 <b class="${h.returnPct > 0 ? 'up' : h.returnPct < 0 ? 'down' : ''}">${pct(h.returnPct)}</b>` : '아직 체결 없음'}${h.indexPct !== null && h.indexPct !== undefined ? ` · 같은 기간 지수 ${pct(h.indexPct)}` : ''}${h.excessPct !== null && h.excessPct !== undefined ? ` · 지수 대비 <b>${pp(h.excessPct * 100)}</b>` : ''} · ${h.daysOpen}일째</div>
    <p>${esc(h.thesis)}</p>${h.breakIf ? `<p class="cr-muted">깨지는 조건: ${esc(h.breakIf)}</p>` : ''}${h.evidence?.length ? `<p class="cr-muted">등록 때 근거: ${h.evidence.map(esc).join(' · ')}</p>` : ''}${h.closeNote ? `<p class="cr-muted">마감 메모: ${esc(h.closeNote)}</p>` : ''}
    ${h.status === 'proposed' && !readOnly ? `<div class="acts"><button type="button" class="primary" data-ph="approve" data-id="${esc(h.id)}">계획 반영 승인</button><button type="button" data-ph="remove" data-id="${esc(h.id)}">지우기</button></div>` : ''}
    ${h.status === 'open' && !readOnly ? `<div class="acts"><button type="button" data-ph="break" data-id="${esc(h.id)}">깨짐으로 표시</button><button type="button" data-ph="right" data-id="${esc(h.id)}">종료 · 맞음</button><button type="button" data-ph="wrong" data-id="${esc(h.id)}">종료 · 틀림</button></div>` : ''}</div>`).join('');
  box.querySelectorAll('[data-ph]').forEach(b => b.onclick = async () => { const kind = b.dataset.ph; try {
    if (kind === 'approve') { if (!confirm('이 가설을 계획에 반영합니다. 다음 장중 자동 실행이 한도만큼 모의계좌에서 삽니다(실제 돈 아님). 승인하시겠습니까?')) return; await privateRead('paper-live-hypothesis', { op: 'approve', item: { id: b.dataset.id } }); $('#pp-hyp-state').textContent = '승인했습니다. 다음 자동 실행(계획 변경)에서 모의계좌에 반영됩니다.'; }
    else if (kind === 'remove') { await privateRead('paper-live-hypothesis', { op: 'remove', item: { id: b.dataset.id } }); $('#pp-hyp-state').textContent = '승인 대기 가설을 지웠습니다.'; }
    else { const note = prompt(kind === 'break' ? '무엇이 깨졌습니까? (한 줄)' : '마감 메모 (선택)') ?? ''; await privateRead('paper-live-hypothesis', { op: kind === 'break' ? 'break' : 'close', item: { id: b.dataset.id, note, verdict: kind === 'right' ? 'right' : kind === 'wrong' ? 'wrong' : undefined } }); $('#pp-hyp-state').textContent = '가설을 닫았습니다. 다음 자동 실행에서 계획이 바뀝니다.'; }
    await kisRefresh(); } catch (e) { $('#pp-hyp-state').textContent = e?.message || '처리하지 못했습니다.'; } });
}
$('#ph-add').onclick = async () => { const err = $('#ph-err'); err.textContent = ''; if (!phPick) { err.textContent = '종목을 먼저 고르십시오.'; return; }
  try { await privateRead('paper-live-hypothesis', { op: 'add', item: { symbol: phPick.symbol, name: phPick.name, capPct: Number($('#ph-cap').value), horizonMonths: Number($('#ph-h').value), thesis: $('#ph-thesis').value.trim(), breakIf: $('#ph-break').value.trim(), evidence: phEvidence, public: $('#ph-public')?.checked !== false } });
    $('#ph-thesis').value = ''; $('#ph-break').value = ''; $('#ph-sym').value = ''; $('#ph-evidence').textContent = ''; phPick = null; $('#pp-hyp-new').open = false; $('#pp-hyp-state').textContent = '승인 대기로 등록했습니다. 목록에서 "계획 반영 승인"을 눌러야 모의계좌 계획에 들어갑니다.'; await kisRefresh(); }
  catch (e) { err.textContent = e?.status === 503 ? 'PC에 모의투자 키가 없습니다.' : (e?.message || 'PC 연결이 필요합니다.'); } };
