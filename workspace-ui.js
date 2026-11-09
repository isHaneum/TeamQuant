import {manwon} from '/lib/investor-tools.js';
import {performanceChart,wireCharts} from '/lib/performance-view.js';
import {privateRead} from '/bridge-client.js';
// Composition adapter: keep existing views, IDs, handlers and storage intact.
import '/planner-ui.js';
import '/performance-ui.js';
import '/orders-ui.js';
import '/help-ui.js';
import {tip} from '/tooltip-ui.js';
import '/lab-ui.js';
import '/portfolio-ui.js';
import '/issues-ui.js';
import '/response-ui.js';
import '/core-ui.js';
import '/paper-ui.js';
import '/paper-account-ui.js';
import '/sector-ui.js';
import '/company-ui.js';
import '/growth-ui.js';
const $=s=>document.querySelector(s);
const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);
const navigation=$('.overview-nav nav'),main=document.createElement('div');main.className='workspace-main';main.setAttribute('aria-label','메인 메뉴');
// 2026-11-05: 두 단계(내 자산/Strategy Lab → 세부 탭) 메뉴를 한 줄로 펼친다. 원래 nav 버튼은 숨겨 두고 그대로 눌러 화면을 바꾼다.
const names={rules:'규칙',precheck:'매매 전 확인',report:'성적표',paper:'모의투자',sectors:'섹터',issues:'시장 (참고)',quicktest:'전략 테스트·과거 기업 분석',home:'홈',toss:'포트폴리오 (참고)',performance:'과거 투자 성과',planner:'목표·ETF 적립',evidence:'판단 기록',strategy:'원칙 승인·모의 운용 (고급)',comparison:'과거 검증',simulation:'투자금 계산',assets:'모의 운용',news:'시장 뉴스',model:'모델 연구'};
const primary=[['home','홈'],['precheck','매매 전 확인'],['report','성적표'],['paper','모의투자'],['rules','규칙']],moreViews=['sectors','issues','quicktest','toss','news','performance','planner','evidence','strategy','model'],labViews=['quicktest'],advancedViews=['strategy','comparison','simulation','assets'];
const hiddenNav=document.createElement('div');hiddenNav.hidden=true;hiddenNav.className='workspace-hidden-nav';
for(const view of Object.keys(names)){const button=document.querySelector(`.sidebar [data-view="${view}"]`);if(button){button.textContent=names[view];hiddenNav.append(button);}}
const topButtons=new Map();
for(const [view,label] of primary){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.workspace=view;b.onclick=()=>$(`[data-view="${view}"]`)?.click();main.append(b);topButtons.set(view,b);}
const moreMenu=document.createElement('details');moreMenu.className='workspace-more';moreMenu.innerHTML='<summary>더보기</summary><div role="menu"></div>';
for(const view of moreViews){if(!hiddenNav.querySelector(`[data-view="${view}"]`)&&!document.querySelector(`.sidebar [data-view="${view}"]`))continue;const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=names[view];b.dataset.workspace=view;b.onclick=()=>{moreMenu.open=false;$(`[data-view="${view}"]`)?.click();};moreMenu.lastElementChild.append(b);}
main.append(moreMenu);document.addEventListener('click',e=>{if(moreMenu.open&&!moreMenu.contains(e.target))moreMenu.open=false;});
// 2026-11-09: 열릴 때 메뉴가 화면 밖으로 나가지 않게 왼쪽 위치를 맞춘다(좁은 화면에서 '더보기'가 줄 끝에 있을 때).
moreMenu.addEventListener('toggle',()=>{const panel=moreMenu.lastElementChild;panel.style.left='';panel.style.right='';if(!moreMenu.open)return;const r=panel.getBoundingClientRect(),vw=document.documentElement.clientWidth;if(r.right>vw-12)panel.style.left=`${Math.round(Math.min(0,vw-12-r.right))}px`;if(r.left<12)panel.style.left=`${Math.round(12-moreMenu.getBoundingClientRect().left)}px`;});
navigation.prepend(main);navigation.append(hiddenNav);
for(const d of document.querySelectorAll('.sidebar details'))if(!d.querySelector('button'))d.hidden=true; // 버튼을 옮긴 뒤 빈 '고급 도구' 묶음
// Settings is a separate view so connection forms retain their original handlers.
const settings=document.createElement('section');settings.className='view';settings.dataset.page='settings';settings.id='workspace-settings';settings.innerHTML='<div class="page-head"><div><h1>설정</h1><p>프로필 · 계좌 연결 · 데이터</p></div></div><article class="panel"><h2>프로필 '+tip('현재 프로필은 전략과 모의 기록을 구분하는 브라우저 설정입니다. 4자리 PIN은 금융정보 접근 인증이 아니며, 실제 자산은 별도의 PC 연결 권한으로 조회합니다. 정식 회원 인증은 아직 없습니다.')+'</h2><div id="workspace-profile"></div></article><article class="panel"><h2>증권사·개인 PC 연결 '+tip('처음 코드를 승인할 때 이 브라우저를 30일 동안 기억할 수 있습니다. 이후 PC 서버가 켜져 있으면 자동으로 다시 연결됩니다. 토스 API 키는 PC에만 둡니다. 공용 PC에서는 기억 기능을 쓰지 마십시오. 연결 해제는 기억된 권한도 지웁니다.')+'</h2><div id="workspace-connections"></div></article><article class="panel"><h2>데이터 관리·도움말 '+tip('브라우저 프로필 기록과 PC 저장 장부는 그대로 유지됩니다. JSON 내보내기는 각 자료 화면에 있습니다.')+'</h2><div id="workspace-data"></div></article>';
document.querySelector('main').append(settings);
const settingButton=document.createElement('button');settingButton.className='nav-button workspace-settings-button';settingButton.dataset.view='settings';settingButton.textContent='설정';$('.top-actions').append(settingButton);
$('#workspace-profile').append($('#user-name'),$('#logout'));
const connections=$('#workspace-connections'),bridgeBoxes=[...document.querySelectorAll('.bridge-panel')];for(const [i,box] of bridgeBoxes.entries()){box.hidden=i!==bridgeBoxes.length-1;connections.append(box);}
const perfConnect=$('#perf-pair')?.closest('details')||$('#perf-code')?.closest('details');if(perfConnect){perfConnect.hidden=true;connections.append(perfConnect);}
const account=$('[data-connect-account]');if(account)connections.append(account);
const help=navigation.querySelector('[data-view="help"]');if(help)$('#workspace-data').append(help);
// Existing entry shortcuts remain usable, but are now grouped with connections.
const shortcut=$('#overview .page-head .ov-actions button');if(shortcut?.textContent==='토스 자산 연결')connections.append(shortcut);
const note=document.createElement('p');note.className='workspace-security-note';note.textContent='체험 환경 · 정식 회원 인증 미연결';$('.top-actions').prepend(note);
$('#login-form h2').textContent='체험 프로필 열기';$('#login-form > p:not(.eyebrow)').textContent='기존 전략·모의 기록을 여는 체험 프로필입니다. 정식 회원 인증과 금융정보 접근 권한은 별도입니다.';
function sync(){const view=$('.view.active')?.dataset.page||'home',top=labViews.includes(view)?'quicktest':view;for(const [key,b] of topButtons){b.classList.toggle('active',key===top);b.setAttribute('aria-current',key===top?'page':'false');}const inMore=moreViews.includes(view)||advancedViews.includes(view);moreMenu.classList.toggle('active',inMore);moreMenu.querySelector('summary').textContent=inMore?(advancedViews.includes(view)?'고급 전략 실험':names[view])+' ▾':'더보기 ▾';for(const b of moreMenu.querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.workspace===view||(b.dataset.workspace==='strategy'&&advancedViews.includes(view))?'page':'false');}
window.addEventListener('teamquant:page',sync);window.addEventListener('teamquant:state',sync);sync();

// Private plan summary is memory-only; distinguish its paper book from actual holdings.
const homePlan=document.createElement('article');homePlan.className='panel';homePlan.id='home-month-plan';homePlan.innerHTML='<div class="panel-head"><h2>투자 목표와 이번 달 계획</h2><button id="home-plan-refresh" class="secondary">PC 계획 불러오기</button></div><p id="home-plan-state" role="status">PC에 저장한 목표와 적립식 모의 장부를 확인할 수 있습니다.</p><div id="home-plan-summary"></div><button id="home-plan-open" class="secondary">목표·ETF 배분안 확인</button>';
$('#ov-kpis').after(homePlan);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let planEpoch=0,planOwner=null;
async function summarizePlan(){const epoch=++planEpoch,owner=sessionStorage.getItem('teamQuantSession');$('#home-plan-state').textContent='PC 저장 계획 확인 중…';try{const [intent,list]=await Promise.all([privateRead('investment-intent'),privateRead('investment-list')]);const latest=list.books[0],book=latest?await privateRead('investment-load',{id:latest.id}):null;if(epoch!==planEpoch||owner!==sessionStorage.getItem('teamQuantSession'))return;const goal=book?.goal||intent.goal,currency=book?.currency||'KRW',money=v=>currency==='KRW'?manwon(v):new Intl.NumberFormat('ko-KR',{style:'currency',currency}).format(v);$('#home-plan-state').textContent=book?'최근 PC 모의 장부 · '+book.label:goal?'PC에 저장한 목표 초안 · ETF 비중 확인 전':'아직 저장한 목표가 없습니다.';$('#home-plan-summary').innerHTML=goal?`<div class="ov-kpis"><article><span>목표 자산</span><strong>${safe(money(goal.target))}</strong><small>목표 ${safe(goal.targetMonth)}</small></article><article><span>월 납입 계획</span><strong>${safe(money(goal.monthly))}</strong><small>시작 ${safe(goal.startMonth)}</small></article><article><span>기록된 모의 납입</span><strong>${book?.executions.length||0}회</strong><small>실제 계좌 입금·운용 성과와 별도</small></article></div><p>목표 비중과 비용을 확인한 뒤 배분안을 비교하고 승인합니다. 실제 주문은 수행하지 않습니다.</p>`:'';planOwner=owner;}catch{if(epoch===planEpoch){$('#home-plan-state').textContent='PC 계획 연결 대기 · 설정에서 개인 PC 연결 상태를 확인하십시오.';if(planOwner!==owner)$('#home-plan-summary').replaceChildren();else $('#home-plan-state').textContent='마지막으로 불러온 계획 · PC 연결 실패로 갱신하지 못했습니다.';}}}
$('#home-plan-refresh').onclick=summarizePlan;$('#home-plan-open').onclick=()=>$('[data-view="planner"]').click();
window.addEventListener('teamquant:page',()=>{if($('.view.active')?.dataset.page==='home'&&location.hostname==='127.0.0.1'&&planOwner!==sessionStorage.getItem('teamQuantSession'))void summarizePlan();});
window.addEventListener('teamquant:asset-clear',()=>{planEpoch++;planOwner=null;$('#home-plan-summary').replaceChildren();$('#home-plan-state').textContent='화면의 계획 요약을 지웠습니다. PC 원본은 유지됩니다.';});

const historyCard=document.createElement('article');historyCard.className='panel';historyCard.id='home-history';historyCard.innerHTML='<div class="panel-head"><h2>보유주식 평가액 추이</h2><button id="home-history-read" class="secondary">PC 관측 이력 불러오기</button></div><p>조회 시점의 주식 평가액입니다. 현금·입출금이 빠져 있어 총자산 변화나 투자 수익률을 뜻하지 않습니다.</p><div class="ov-actions"><label>관측 계좌<select id="home-history-account"></select></label><label>표시 통화<select id="home-history-currency"><option>KRW</option><option>USD</option></select></label></div><p id="home-history-state" role="status">저장된 실제 관측 이력이 있을 때 표시합니다. 모의 결과를 채워 넣지 않습니다.</p><div id="home-history-chart"></div>';
homePlan.after(historyCard);let observations=null,historyEpoch=0;
function drawHomeHistory(){if(!observations)return;const id=$('#home-history-account').value,currency=$('#home-history-currency').value,records=observations.records.filter(r=>r.accountId===id&&r.status==='success').sort((a,b)=>a.observedAt.localeCompare(b.observedAt)),points=records.map(r=>({date:r.observedAt,value:r.data?.totals.find(t=>t.currency===currency)?.holdingValue})).filter(p=>Number.isFinite(p.value));$('#home-history-chart').innerHTML=points.length?performanceChart([points],['조회 보유주식 평가액'],{normalized:false,timeScale:true,unit:currency,title:'실제 관측 평가액 · 현금 제외',readoutNote:'PC에 기록한 조회 시각',axisNote:'추가 매수·매도·가격 변동이 함께 반영될 수 있습니다. 평가액 증가를 투자 수익으로 해석하지 않습니다.'}):'<p>선택한 계좌·통화의 관측 자료가 없습니다.</p>';$('#home-history-state').textContent=`성공 관측 ${points.length}건 · ${observations.hasMore?'최근 1,000건 제한':'조회 범위 내 자료'} · 현재 환율로 과거를 재환산하지 않습니다.`;wireCharts($('#home-history-chart'));}
$('#home-history-read').onclick=async()=>{const epoch=++historyEpoch,owner=sessionStorage.getItem('teamQuantSession');try{const data=await privateRead('history-list');if(epoch!==historyEpoch||owner!==sessionStorage.getItem('teamQuantSession'))return;observations=data;$('#home-history-account').innerHTML=[...new Set(data.records.filter(r=>r.status==='success').map(r=>r.accountId))].map((id,i)=>`<option value="${safe(id)}">관측 계좌 ${i+1} · ${safe(id.slice(-6))}</option>`).join('');drawHomeHistory();}catch{$('#home-history-state').textContent='관측 이력 연결 대기 · 설정에서 PC 연결을 확인하십시오.';}};
$('#home-history-account').onchange=drawHomeHistory;$('#home-history-currency').onchange=drawHomeHistory;
window.addEventListener('teamquant:asset-clear',()=>{historyEpoch++;observations=null;$('#home-history-account').replaceChildren();$('#home-history-chart').replaceChildren();$('#home-history-state').textContent='화면의 관측 이력을 지웠습니다. PC 원본 기록은 유지됩니다.';});

// Put strategy education in the Lab; asset home leads with account context.
const researchIntro=$('#home .verification-entry');if(researchIntro)$('#strategy .page-head').after(researchIntro);
$('#home h1').textContent='내 자산';
const homeRead=document.createElement('button');homeRead.className='primary';homeRead.textContent='계좌 새로고침';homeRead.id='home-read-holdings';$('#overview .page-head .ov-actions').prepend(homeRead);homeRead.onclick=()=>$('#toss-refresh').click();
const readState=document.createElement('p');readState.className='muted';readState.setAttribute('role','status');readState.textContent='등록된 PC 연결을 확인하고 있습니다.';$('#overview .page-head').after(readState);
new MutationObserver(()=>{readState.textContent=$('#toss-status').textContent;homeRead.disabled=$('#toss-refresh').disabled;}).observe($('#toss-status'),{childList:true,subtree:true,characterData:true});

window.addEventListener('teamquant:asset-snapshot',()=>{if(planOwner!==sessionStorage.getItem('teamQuantSession'))void summarizePlan();});

const rememberCurrent=document.createElement('button');rememberCurrent.className='secondary';rememberCurrent.textContent='이 PC에서 현재 프로필 유지 (30일)';$('#workspace-profile').append(rememberCurrent);rememberCurrent.onclick=()=>{const user=sessionStorage.getItem('teamQuantSession');if(!user)return;localStorage.setItem('teamQuantRememberProfile',JSON.stringify({user,expiresAt:Date.now()+30*86400000}));rememberCurrent.textContent='현재 프로필 유지 설정 완료 · 30일';};

// One primary journey; retain every existing engine and direct navigation target.
const steps=[['strategy','1. 원칙 설정'],['comparison','2. 과거 검증'],['simulation','3. 투자금 계산'],['assets','4. 모의 운용']];
for(const [page] of steps){const bar=document.createElement('nav');bar.className='lab-flow';bar.setAttribute('aria-label','전략 검토 순서');for(const [target,label] of steps){const b=document.createElement('button');b.className='secondary';b.textContent=label;b.setAttribute('aria-current',target===page?'step':'false');b.onclick=()=>$('[data-view="'+target+'"]').click();bar.append(b);}$('#'+page+' .page-head').after(bar);}
// Remove redundant invitations, not the tools/data they previously linked to.
$('#ov-strategy-summary').closest('article').hidden=true;
$('#strategy .verification-entry')?.remove();
$('#overview .page-head #ov-refresh').hidden=true;
// 2026-11-05: 머리말 정리. 상단 보안 문구는 설정의 ⓘ로, 홈의 '과거 투자 성과'는 더보기로 일원화.
note.hidden=true;
for(const b of document.querySelectorAll('#overview .page-head .ov-actions button'))if(b.textContent==='과거 투자 성과')b.hidden=true;
