const $=s=>document.querySelector(s);
const getState=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'))||'{}');}catch{return {};}};
// 2026-11-26: 옛 단계 바(.flow-wrap · #flow-help)는 지웠다(늘 숨겨져 있었다). 고급 전략 실험 안의 순서 표시는 workspace-ui.js 의 .lab-flow 가 맡고,
// 메뉴 버튼은 index.html 의 .sidebar 에 그대로 두어 workspace-ui.js 가 숨은 메뉴로 옮긴다.
const steps=[['strategy'],['comparison'],['assets']];
$('.sidebar').classList.add('utility-navigation');$('.side-note').hidden=true;
const home=$('[data-view="home"]');home.textContent='홈';
$('[data-view="news"]').textContent='뉴스';$('[data-view="evidence"]').textContent='판단 기록';
$('.brand').addEventListener('click',event=>{event.preventDefault();home.click();});
// 2026-11-26: 위쪽 '내 계좌'(서버 계좌 조회 창)와 '개발용 계좌 도구'는 뺐다. 실계좌는 설정 > 내 PC 연결로만 본다.

const finder=$('.verify-panel');
const finderDetails=document.createElement('details');finderDetails.className='stock-finder';
const finderSummary=document.createElement('summary');finderSummary.textContent='긴 기간 테스트 (1·2·5년)';finderDetails.append(finderSummary,finder);
$('#comparison-stocks').after(finderDetails);
finder.classList.remove('verify-panel');finder.classList.add('finder-content');

const inputPanel=$('#natural-rule').closest('article');inputPanel.classList.add('principle-input');
inputPanel.querySelector('.step-title p').textContent='사고팔 조건을 문장으로 적거나 예시를 고르세요.';
$('#natural-rule').placeholder='예: 20일 최고가를 넘으면 사고, 7% 잃으면 판다.';
$('#parse-rule').textContent='규칙으로 바꾸기';
$('#rule-review').hidden=true;
$('#natural-rule').addEventListener('input',()=>{$('#rule-review').hidden=true;$('#approve-check').checked=false;$('#approve-strategy').disabled=true;});
window.addEventListener('teamquant:draft',()=>{
  $('#rule-review').hidden=false;$('#rule-review').scrollIntoView({behavior:'smooth',block:'start'});
});

const settingsPanel=$('#comparison-strategy').closest('article');
const settings=document.createElement('details');settings.id='comparison-settings';settings.className='panel comparison-settings';settings.open=!getState().comparison;
const summary=document.createElement('summary');summary.textContent='규칙과 종목 고르기';
const settingsContent=document.createElement('div');settingsContent.className='comparison-settings-body';
while(settingsPanel.firstChild)settingsContent.append(settingsPanel.firstChild);
settings.append(summary,settingsContent);settingsPanel.replaceWith(settings);

const decisions=$('#comparison-decisions').closest('article');
const decisionsDetails=document.createElement('details');decisionsDetails.className='decision-details panel';
const decisionsSummary=document.createElement('summary');decisionsSummary.textContent='날짜별 매매 신호';decisionsDetails.append(decisionsSummary);decisions.replaceWith(decisionsDetails);decisionsDetails.append(decisions);
$('#compare-paper').className='primary flow-continue';
window.addEventListener('teamquant:comparison-complete',()=>{
  settings.open=false;$('#comparison-result').scrollIntoView({behavior:'smooth',block:'start'});
});
// 2026-11-26 '계산 방법과 한계'는 접기 대신 ⓘ: journey-ui.js 가 #comparison-assumptions(숨김)에 쓰는 계산 가정을 ⓘ 글 앞에 붙인다.
const methodTip=$('#comparison-method-tip'),assumptions=$('#comparison-assumptions');
if(methodTip&&assumptions){const base=methodTip.dataset.tip||'';new MutationObserver(()=>{const text=[assumptions.textContent.trim(),base].filter(Boolean).join('\n\n');methodTip.dataset.tip=text;methodTip.setAttribute('aria-label','설명: '+text);}).observe(assumptions,{childList:true,characterData:true,subtree:true});}

function sync(){
  const s=getState(),page=$('.view.active')?.dataset.page||'home';
  document.body.classList.toggle('first-visit',!s.approved);
  steps.forEach(([name],i)=>{
    const b=$(`[data-view="${name}"]`);b.toggleAttribute('aria-current',name===page);
    if(name===page)b.setAttribute('aria-current','step');
    b.classList.toggle('complete',i===0?!!s.approved:i===1?!!s.comparison:!!s.activeStrategy);
  });
  if(s.comparison?.perStock?.length&&!$('#compare-paper').disabled){ // 펀드 기준가 결과(등록 불가)는 journey-ui 가 쓴 이름을 그대로 둔다
    const first=s.comparison.perStock[0].symbol,heading=$('#comparison-period').textContent;
    const names={'005930.KS':'삼성전자','000660.KS':'SK하이닉스','035420.KS':'NAVER','035720.KS':'카카오'};
    const name=names[first]||heading.split(' · ')[1]?.split(',')[0]?.trim()||'';
    $('#compare-paper').textContent=name?`${name} 가상 투자 시작`:'가상 투자 시작';
  }
}
window.addEventListener('teamquant:page',sync);window.addEventListener('teamquant:state',sync);sync();
