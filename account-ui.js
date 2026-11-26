import '/journey-ui.js';
import '/overview-ui.js';
const $=s=>document.querySelector(s);
const dialog=$('#account-dialog');
// 2026-11-26: 조회 암호 입력(내 잔고 조회)과 '화면에서 연결 해제'는 결과가 홈에 보이지 않아 뺐다(예전 홈만 받던 이벤트). 처음 연결 안내는 PC 프로그램 안내 문서로 옮긴다.
// 실계좌는 설정 > 내 PC 연결로 조회한다. /api/kis-account 는 개발용 화면(app.js)이 그대로 쓴다.
dialog.innerHTML=`<div class="panel-head"><h2>한국투자증권 계좌 조회</h2><button id="owner-close" class="text-button">닫기</button></div><p>한국투자증권 계좌의 잔고·보유 종목만 조회합니다(주문 안 함).</p><p>증권사 키는 공개 사이트에 두지 않고 내 PC에만 암호화해 저장됩니다. 실계좌는 설정 > 내 PC 연결에서 연결하세요. 증권사 비밀번호·API 키는 이 화면에 넣지 마세요.</p>`;
document.querySelectorAll('[data-connect-account]').forEach(b=>b.onclick=()=>dialog.showModal());
$('#owner-close').onclick=()=>dialog.close();
