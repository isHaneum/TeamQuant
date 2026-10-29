const $=s=>document.querySelector(s);
const getState=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'))||'{}');}catch{return {};}};
const steps=[['strategy','1','투자 기준'],['comparison','2','3개월 검증'],['assets','3','모의 운용']];
const flow=document.createElement('nav');flow.className='flow-navigation';flow.setAttribute('aria-label','투자 시작 단계');
for(const [page,number,label] of steps){
  const button=$(`[data-view="${page}"]`);
  button.innerHTML=`<span class="flow-number">${number}</span><span>${label}</span>`;
  button.classList.add('flow-step');flow.append(button);

}
const flowWrap=document.createElement('div');flowWrap.className='flow-wrap';flowWrap.append(flow);
const helper=document.createElement('p');helper.id='flow-help';helper.setAttribute('role','status');flowWrap.append(helper);
$('.topbar').after(flowWrap);
$('.sidebar').classList.add('utility-navigation');$('.side-note').hidden=true;
const home=$('[data-view="home"]');home.textContent='내 현황';
$('[data-view="news"]').textContent='뉴스';$('[data-view="evidence"]').textContent='판단 내역';
$('.brand').addEventListener('click',event=>{event.preventDefault();home.click();});
const account=document.createElement('button');account.className='account-shortcut secondary compact';account.textContent='내 계좌';account.dataset.connectAccount='';$('.top-actions').prepend(account);

const devAccount=document.createElement('details');devAccount.className='account-dev-tools';
const devAccountTitle=document.createElement('summary');devAccountTitle.textContent='개발용 계좌 도구';
devAccount.append(devAccountTitle,$('[data-asset-tab="kis"]'),$('#kis-assets'));$('#assets').append(devAccount);
$('#assets .asset-tabs').hidden=true;


const finder=$('.verify-panel');
const finderDetails=document.createElement('details');finderDetails.className='stock-finder';
const finderSummary=document.createElement('summary');finderSummary.textContent='다른 종목 추가';finderDetails.append(finderSummary,finder);
$('#comparison-stocks').after(finderDetails);
finder.classList.remove('verify-panel');finder.classList.add('finder-content');

const inputPanel=$('#natural-rule').closest('article');inputPanel.classList.add('principle-input');
inputPanel.querySelector('.step-title p').textContent='사고팔 때 지키고 싶은 조건을 적어주세요. 아래 예시로 시작해도 좋아요.';
$('#natural-rule').placeholder='예: 20일 최고가를 넘으면 사고, 7% 손실이 나면 팔고 싶어요.';
$('#parse-rule').textContent='조건 확인하기';
$('#rule-review').hidden=true;
$('#natural-rule').addEventListener('input',()=>{$('#rule-review').hidden=true;$('#approve-check').checked=false;$('#approve-strategy').disabled=true;});
window.addEventListener('teamquant:draft',()=>{
  $('#rule-review').hidden=false;$('#rule-review').scrollIntoView({behavior:'smooth',block:'start'});
});

const settingsPanel=$('#comparison-strategy').closest('article');
const settings=document.createElement('details');settings.id='comparison-settings';settings.className='panel comparison-settings';settings.open=!getState().comparison;
const summary=document.createElement('summary');summary.textContent='검증할 전략과 종목';
const settingsContent=document.createElement('div');settingsContent.className='comparison-settings-body';
while(settingsPanel.firstChild)settingsContent.append(settingsPanel.firstChild);
settings.append(summary,settingsContent);settingsPanel.replaceWith(settings);

const decisions=$('#comparison-decisions').closest('article');
const decisionsDetails=document.createElement('details');decisionsDetails.className='decision-details panel';
const decisionsSummary=document.createElement('summary');decisionsSummary.textContent='날짜별 판단 근거 보기';decisionsDetails.append(decisionsSummary);decisions.replaceWith(decisionsDetails);decisionsDetails.append(decisions);
$('#compare-paper').className='primary flow-continue';
window.addEventListener('teamquant:comparison-complete',()=>{
  settings.open=false;$('#comparison-result').scrollIntoView({behavior:'smooth',block:'start'});
});

function sync(){
  const s=getState(),page=$('.view.active')?.dataset.page||'home';
  document.body.classList.toggle('first-visit',!s.approved);
  steps.forEach(([name],i)=>{
    const b=$(`[data-view="${name}"]`);b.toggleAttribute('aria-current',name===page);
    if(name===page)b.setAttribute('aria-current','step');
    b.classList.toggle('complete',i===0?!!s.approved:i===1?!!s.comparison:!!s.activeStrategy);
  });
  $('#flow-help').textContent={home:'기준을 정하고, 과거 결과를 확인한 뒤 모의투자로 시작하세요.',strategy:'1 / 3 · 투자 기준을 적고, 변환된 조건을 확인하세요.',comparison:'2 / 3 · 종목과 투자금을 고르면 같은 조건으로 비교해요.',assets:'3 / 3 · 등록한 전략의 판단을 모의 자산으로 확인하세요.',news:'관심 뉴스 확인 후 상단 단계로 돌아가 이어갈 수 있어요.',evidence:'어떤 기준으로 판단했는지 확인하세요.'}[page]||'고급 분석 도구';
  if(s.comparison?.perStock?.length){
    const first=s.comparison.perStock[0].symbol,heading=$('#comparison-period').textContent;
    const names={'005930.KS':'삼성전자','000660.KS':'SK하이닉스','035420.KS':'NAVER','035720.KS':'카카오'};
    $('#compare-paper').textContent=`${names[first]||heading.split(' · ')[1]?.split(',')[0]||'선택 종목'}로 모의 운용 시작`;
  }
}
window.addEventListener('teamquant:page',sync);window.addEventListener('teamquant:state',sync);sync();
