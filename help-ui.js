import '/asset-hub-ui.js';
import {RULE_LOCK_DAYS,PLAN_CHANGE_MAX,PLAN_CHANGE_DAYS} from '/lib/rule-presets.js';
const $=s=>document.querySelector(s);
const navigate=page=>document.querySelector(`[data-view="${page}"]`)?.click();
// 2026-11-26: 이용 안내는 더보기 메뉴에 있다(workspace-ui.js names·moreViews). 질문형 제목 대신 주제형 제목을 쓴다. 처음 사용 카드는 위쪽 메뉴 4개(홈 · 규칙 · 모의투자 · 시장) 순서.
const nav=document.createElement('button');nav.className='nav-button';nav.dataset.view='help';nav.textContent='이용 안내';$('.overview-nav nav').append(nav);
const page=document.createElement('section');page.id='help';page.className='view';page.dataset.page='help';
page.innerHTML=`<div class="page-head"><div><h1>이용 안내</h1><p>규칙 정하기부터 모의투자까지</p></div></div>
<article class="panel"><h2>처음 사용한다면</h2><p>계좌가 없어도 됩니다. 규칙을 정하고(규칙), 가상 돈으로 연습하고(모의투자), 지켰는지 홈에서 봅니다.</p><div class="tutorial-grid">
<article><b>1. 홈</b><p>규칙을 지켰는지, 지수보다 나았는지, 오늘 시장을 한 화면에 봅니다. 설정 > 내 PC 연결을 하면 토스 계좌 보유 종목이 보이고 내 규칙으로 점검됩니다(이 화면에서는 주문을 내지 않습니다).</p><button data-help-go="home" class="secondary">홈</button></article>
<article><b>2. 규칙</b><p>한 종목 최대 비중·현금 최소 비중·하루 손실 한도 같은 규칙을 정합니다. 확정하면 ${RULE_LOCK_DAYS}일 동안 바꿀 수 없고, 그 뒤에는 이유를 10자 이상 적어야 바뀝니다. 목표 비중은 ${PLAN_CHANGE_DAYS}일에 ${PLAN_CHANGE_MAX}번까지 바꿀 수 있습니다.</p><button data-help-go="rules" class="secondary">규칙 정하기</button></article>
<article><b>3. 모의투자</b><p>내 가상계좌(이 브라우저 안의 가상 돈)와 팀 모의계좌(한국투자증권 모의투자 · 가상 1억)를 탭으로 나눠 봅니다. 과거 시세로 먼저 해 보려면 더보기 > 전략 테스트를 쓰세요.</p><button data-help-go="paper" class="secondary">모의투자</button></article>
<article><b>4. 시장</b><p>지수·섹터·이슈·뉴스를 봅니다. 사기 전에는 종목·주문 점검에서 금액을 넣어 내 규칙에 맞는지 봅니다(실제 주문 없음).</p><button data-help-go="market" class="secondary">시장</button></article></div></article>
<article class="panel"><h2>테스트 결과 읽는 법</h2><dl class="help-definitions"><dt>매매 규칙만</dt><dd>확정한 매수·매도·손절 규칙대로 사고판 결과입니다.</dd><dt>매매 규칙 + 지수 60일선</dt><dd>같은 규칙에 '비교 지수가 60일선 위일 때만 새로 사기' 조건을 더합니다. 뉴스·AI 효과가 아닙니다.</dd><dt>그냥 보유</dt><dd>같은 종목을 같은 금액으로 처음에 사서 계속 들고 있었을 때입니다. 매매 규칙의 효과를 재는 기준입니다.</dd><dt>비교 지수</dt><dd>원화 종목은 코스피, 달러 종목은 S&P500(SPY)과 비교합니다. 지수는 현금 없이 전부 투자한 것이라 현금 비중이 규칙과 다릅니다.</dd><dt>시작 = 100</dt><dd>시작을 100으로 놓고 그립니다(105 = +5%, 95 = −5%).</dd><dt>지수 대비와 최대 하락폭</dt><dd>지수 대비 = 규칙 수익률 − 지수 수익률(%p). 최대 하락폭 = 중간 최고점에서 가장 많이 떨어진 폭. 지수보다 덜 떨어져도 돈을 벌었다는 뜻은 아닙니다.</dd></dl></article>
<details class="panel help-install"><summary>내 PC에 설치하기 (개발자용)</summary><ol class="setup-steps"><li><a href="/downloads/TeamQuant-PC.zip" download>PC 프로그램 받기</a> → 압축 풀기(Node.js 22 이상)</li><li>폴더 안 START-HERE.md대로 .env.local에 내 API 키 파일 위치 적기(증권사에 내 PC 공인 IP 등록). 다른 사람의 키는 쓰지 않습니다.</li><li>start-personal-server.cmd 실행 → <a href="http://127.0.0.1:8766/" target="_blank" rel="noopener">내 PC 화면</a>(프로그램을 켠 PC에서만 열림)의 설정 > 내 PC 연결에서 연결 번호 받기</li><li>공개 사이트 설정 > 내 PC 연결에 번호 넣기. 브라우저가 '로컬 네트워크 접근'을 물으면 허용합니다.</li><li>연결 뒤 5분마다 새로 불러오고 PC 프로그램은 계속 켜 두어야 합니다. '30일 자동 연결'을 고르지 않으면 이 창에서 1시간만 유지됩니다.</li></ol><p>프로필은 이 브라우저에만 있습니다. 같은 이름이라도 다른 PC에서는 기록이 보이지 않고, 회원 가입은 없습니다. 증권사 키와 잔고는 공개 사이트에 올리지 않고, 각 PC 프로그램에 설정한 계좌만 조회합니다.</p></details>
<article class="panel"><h2>자주 묻는 질문</h2><details><summary>지난 계좌 성과 보기</summary><p>더보기 > 과거 투자 성과에서 PC를 연결하고 평가액(현금 포함)·입출금·거래내역 파일(CSV)을 넣습니다. 자료는 내 PC에만 저장됩니다. 입출금 효과를 뺀 수익률은 입출금 앞뒤 평가액이 있어야 계산됩니다. 조회한 보유 주식 기록은 현금 제외 평가액으로 따로 보여 줍니다. 파일 내용을 증권사 거래 기록과 자동으로 맞춰 보지는 않습니다.</p></details>
<details><summary>쓸 수 있는 종목</summary><p>고급 전략 실험에서는 국내 상장 주식과 지원 ETF(KODEX 200 · TIGER 미국S&P500)를 이름으로 추가해 테스트·가상 투자할 수 있습니다. 연결한 계좌의 국내·미국 보유 주식은 통화별로 점검합니다. 일반 펀드는 하루 기준가 CSV로 참고용 테스트만 되고, 펀드 매매·환매는 아직 없습니다.</p></details>
<details><summary>결과가 없거나 거래가 0회일 때</summary><p>매매 규칙 확정, 지표를 계산할 앞 기간, 가격 자료가 있어야 합니다. 기간 안에 살 조건이 한 번도 맞지 않으면 현금으로 남습니다(일부러 거래를 만들지 않음). 이유는 날짜별 매매 신호에서 볼 수 있습니다.</p></details>
<details><summary>지수 60일선 조건의 한계</summary><p>늘 낫지는 않습니다. 오르는 구간을 놓치거나 늦게 살 수 있습니다. 같은 기간·종목·비용으로 비교한 결과를 보세요. 최근 3개월을 보고 고친 규칙은 다른 기간으로 다시 테스트하세요.</p></details>
<details><summary>뉴스·AI는 테스트에 안 들어감</summary><p>테스트는 숫자 규칙과 지수 60일선 조건만 봅니다. 기사는 출처 확인용이고, 뉴스·AI 판단은 테스트에 넣지 않았습니다.</p></details>
<details><summary>모의투자와 실계좌 차이</summary><p>모의투자의 내 가상계좌는 이 브라우저 안의 가상 돈, 팀 모의계좌는 한국투자증권 모의투자의 가상 1억입니다. 고급 전략 실험의 가상 투자(내 보유로 시작한 것 포함)도 실제 잔고와 따로입니다. 호가·세금·배당·환매 지연은 실제와 완전히 같지 않습니다.</p></details>
<details><summary>보유 종목 3개월 테스트는 실제 수익률이 아님</summary><p>지금 가진 종목을 3개월 전부터 들고 있었다고 가정한 계산입니다. 실제 거래·입출금·현금 기록이 없어 계좌의 진짜 지난 성과는 아닙니다.</p></details>
<details><summary>내 계좌가 보이는 범위</summary><p>각 PC는 그 PC의 프로그램과 키로만 연결됩니다. 공개 사이트에는 증권사 키와 잔고를 저장하지 않습니다. 한 PC의 프로그램은 키 주인 한 사람의 계좌만 보여 주고, 같은 PC에서는 프로필을 바꿔도 같은 계좌가 보입니다.</p></details>
<details><summary>저장되는 것과 지우는 법</summary><p>규칙·가상 투자 기록은 이 브라우저(프로필별)에, 보유 주식 조회 기록은 내 PC에 저장됩니다. 화면에 띄운 계좌·연결 정보는 이 창에만 있어 '화면에서 지우기'나 새로고침으로 사라집니다(PC 기록은 그대로). 이 브라우저의 기록은 설정 > 내 기록 지우기로 지웁니다. 내려받은 파일은 직접 보관하세요.</p></details>
</article>`;
document.querySelector('main').append(page);page.querySelectorAll('[data-help-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.helpGo));
// 2026-11-26: 홈 위에 만들었다가 workspace-ui.js 가 지우던 소개 카드('3개월 전략 검증' · '처음 이용 안내')는 뺐다.
// 포트폴리오의 연결 안내 문장은 설정 > 내 PC 연결의 ⓘ로 옮기고, 이 자리에는 이용 안내로 가는 버튼만 둔다.
const accountGuide=document.createElement('p');accountGuide.className='muted';accountGuide.innerHTML='<button class="text-button" id="account-help">연결 방법·지원 범위</button>';$('#toss .page-head').after(accountGuide);$('#account-help').onclick=()=>navigate('help');
