import {closePrivateSession} from '/bridge-client.js';
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
import '/market-ui.js';
import '/company-ui.js';
import '/growth-ui.js';
const $=s=>document.querySelector(s);
const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css?v=ux-20261126';document.head.append(style);
const navigation=$('.overview-nav nav'),main=document.createElement('div');main.className='workspace-main';main.setAttribute('aria-label','메인 메뉴');
// 2026-11-05: 두 단계(내 자산/Strategy Lab → 세부 탭) 메뉴를 한 줄로 펼친다. 원래 nav 버튼은 숨겨 두고 그대로 눌러 화면을 바꾼다.
// 2026-11-26: 판단 기록은 더보기에서 빼 고급 전략 실험 묶음(단계 표시) 안으로, 이용 안내는 설정 안에서 더보기로 옮겼다.
// 모델 연구(PC 전용 5일 수익률 예측)는 메뉴에서 뺐다(2026-11-15 수익률 예측을 쓰지 않기로 함).
const names={market:'시장',rules:'규칙',precheck:'종목·주문 점검',report:'내 계좌 최근 기간',paper:'모의투자',sectors:'섹터',issues:'이슈',quicktest:'전략 테스트',home:'홈',toss:'내 포트폴리오',performance:'과거 투자 성과',planner:'목표·ETF 적립',evidence:'판단 기록',strategy:'고급 전략 실험',comparison:'3개월 테스트',simulation:'투자금 계산',assets:'가상 투자',news:'뉴스',help:'이용 안내'};
const primary=[['home','홈'],['rules','규칙'],['paper','모의투자'],['market','시장']],marketViews=['market','precheck','sectors','issues','news'],moreViews=['quicktest','toss','performance','planner','strategy','help'],labViews=['quicktest'],advancedViews=['strategy','comparison','simulation','assets','evidence'];
const hiddenNav=document.createElement('div');hiddenNav.hidden=true;hiddenNav.className='workspace-hidden-nav';
for(const view of Object.keys(names)){const button=document.querySelector(`.sidebar [data-view="${view}"]`);if(button){button.textContent=names[view];hiddenNav.append(button);}}
const topButtons=new Map();
for(const [view,label] of primary){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.workspace=view;b.onclick=()=>$(`[data-view="${view}"]`)?.click();main.append(b);topButtons.set(view,b);}
const moreMenu=document.createElement('details');moreMenu.className='workspace-more';moreMenu.innerHTML='<summary>더보기</summary><div role="menu"></div>';
for(const view of moreViews){if(!hiddenNav.querySelector(`[data-view="${view}"]`)&&!document.querySelector(`.sidebar [data-view="${view}"]`))continue;const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.textContent=names[view];b.dataset.workspace=view;b.onclick=()=>{moreMenu.open=false;$(`[data-view="${view}"]`)?.click();};moreMenu.lastElementChild.append(b);}
main.append(moreMenu);document.addEventListener('click',e=>{if(moreMenu.open&&!moreMenu.contains(e.target))moreMenu.open=false;});
// 2026-11-09: 열릴 때 메뉴가 화면 밖으로 나가지 않게 왼쪽 위치를 맞춘다(좁은 화면에서 '더보기'가 줄 끝에 있을 때).
moreMenu.addEventListener('toggle',()=>{const panel=moreMenu.lastElementChild;panel.style.left='';panel.style.right='';if(!moreMenu.open)return;const r=panel.getBoundingClientRect(),vw=document.documentElement.clientWidth;if(r.right>vw-12)panel.style.left=`${Math.round(Math.min(0,vw-12-r.right))}px`;if(r.left<12)panel.style.left=`${Math.round(12-moreMenu.getBoundingClientRect().left)}px`;});
// 2026-11-16 한 줄 머리글: 브랜드 줄과 메뉴 줄(둘 다 위에 고정, 합 141px)을 한 줄로 합친다. 메뉴는 아이콘 옆으로 옮기고 비어 버린 옛 메뉴 줄은 CSS 로 숨긴다(숨은 nav 버튼은 그대로 눌러 화면을 바꾼다). 이름 'Team Quant' 는 아이콘의 aria-label·title 로 남긴다.
const BRAND_ICON='<svg viewBox="0 0 36 36" aria-hidden="true" focusable="false"><rect width="36" height="36" rx="10" fill="#17283e"/><rect x="8.5" y="19" width="5" height="8.5" rx="1.6" fill="#fff" opacity=".5"/><rect x="15.5" y="14" width="5" height="13.5" rx="1.6" fill="#fff" opacity=".78"/><rect x="22.5" y="8.5" width="5" height="19" rx="1.6" fill="#7fb0ff"/></svg>';
const brand=$('.topbar .brand');if(brand){brand.querySelector('.brand-mark').innerHTML=BRAND_ICON;brand.setAttribute('aria-label','Team Quant 홈');brand.title='Team Quant';brand.after(main);document.body.classList.add('tq-onebar');}else navigation.prepend(main);navigation.append(hiddenNav);
for(const d of document.querySelectorAll('.sidebar details'))if(!d.querySelector('button'))d.hidden=true; // 버튼을 옮긴 뒤 빈 '고급 도구' 묶음
// Settings is a separate view so connection forms retain their original handlers.
// 2026-11-26 설정은 카드 하나짜리 목록: 프로필 · 내 PC 연결 · 동의 관리 · 내 기록. 동의 관리 칸(#tq-consent-manage)은 자리만 만들고 consent-ui.js 가 채운다.
const TIP_PROFILE='프로필은 이 브라우저 안에서 규칙·가상 투자 기록을 사람별로 나누는 이름표입니다. 잠금 번호는 보안 장치가 아니고, 실계좌는 내 PC 연결로만 봅니다. 회원 가입은 없습니다.';
const TIP_PC='실계좌는 내 PC 프로그램과 내 API 키로만 연결됩니다. 연결 번호를 넣을 때 \'30일 자동 연결\'을 고르면 PC 프로그램이 켜져 있는 동안 다시 묻지 않습니다. 토스 API 키는 내 PC에만 있습니다. 공용 PC에서는 자동 연결을 쓰지 마세요. \'연결 끊기\'를 누르면 자동 연결도 지워집니다.';
const TIP_CLEAR='이 브라우저의 규칙·가상계좌·동의 기록을 지웁니다. PC에 저장된 기록은 그대로입니다.';
const settings=document.createElement('section');settings.className='view';settings.dataset.page='settings';settings.id='workspace-settings';settings.innerHTML='<div class="page-head"><div><h1>설정</h1><p>프로필 · 내 PC 연결 · 동의 관리 · 내 기록</p></div></div><div class="ws-list"><article class="panel ws-row"><h2>프로필 '+tip(TIP_PROFILE)+'</h2><div id="workspace-profile"></div></article><article class="panel ws-row"><h2>내 PC 연결 '+tip(TIP_PC)+'</h2><div id="workspace-connections"></div></article><article class="panel ws-row" id="tq-consent-manage"></article><article class="panel ws-row"><h2>내 기록 '+tip(TIP_CLEAR)+'</h2><div id="workspace-data"><button type="button" class="secondary" id="workspace-clear">내 기록 지우기</button><span id="workspace-clear-state" class="muted" role="status"></span></div></article></div>';
document.querySelector('main').append(settings);
const settingButton=document.createElement('button');settingButton.className='nav-button workspace-settings-button';settingButton.dataset.view='settings';settingButton.textContent='설정';$('.top-actions').append(settingButton);
$('#workspace-profile').append($('#user-name'),$('#logout'));
const connections=$('#workspace-connections'),bridgeBoxes=[...document.querySelectorAll('.bridge-panel')];for(const [i,box] of bridgeBoxes.entries()){box.hidden=i!==bridgeBoxes.length-1;connections.append(box);}
// 2026-11-26: 이름과 하는 일이 달랐던 '토스 자산 연결'(포트폴리오로 이동만 함)과 '내 계좌'(서버 계좌 조회 창)는 뺐다. 이용 안내는 더보기에 있다.

// 내 기록 지우기: 이 브라우저에 Team Quant 가 남긴 것(프로필·규칙·가상계좌·동의 기록·화면 설정)을 모두 지운다. PC 기록·30일 자동 연결은 건드리지 않는다.
$('#workspace-clear').onclick=async()=>{
  if(!confirm('이 브라우저에 저장된 Team Quant 기록(프로필·규칙·가상계좌·동의 기록)을 모두 지웁니다. PC에 저장된 기록은 그대로입니다. 지운 기록은 되돌릴 수 없습니다.'))return;
  const state=$('#workspace-clear-state');
  try{for(const k of Object.keys(localStorage))if(k.startsWith('teamQuant'))localStorage.removeItem(k);for(const k of Object.keys(sessionStorage))if(k.startsWith('teamQuant')||k.startsWith('tq:'))sessionStorage.removeItem(k);}
  catch{if(state)state.textContent='이 브라우저의 저장 공간을 열 수 없어 지우지 못했습니다.';return;}
  try{await closePrivateSession();}catch{/* PC 연결이 없으면 끊을 것도 없다 */}
  location.reload();
};

function sync(){const view=$('.view.active')?.dataset.page||'home',top=marketViews.includes(view)?'market':labViews.includes(view)?'quicktest':view;for(const [key,b] of topButtons){b.classList.toggle('active',key===top);b.setAttribute('aria-current',key===top?'page':'false');}const adv=advancedViews.includes(view),inMore=moreViews.includes(view)||adv;moreMenu.classList.toggle('active',inMore);moreMenu.querySelector('summary').textContent=inMore?(adv?names.strategy:names[view])+' ▾':'더보기 ▾';for(const b of moreMenu.querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.workspace===view||(b.dataset.workspace==='strategy'&&adv)?'page':'false');}
window.addEventListener('teamquant:page',sync);window.addEventListener('teamquant:state',sync);sync();

// 2026-11-26 홈 머리: 큰 제목 '내 자산'(메뉴가 이미 '홈')과 큰 [계좌 새로고침] 버튼·상태 문장을 뺐다. 제목은 화면 낭독기에만 남긴다.
// 계좌 이름 · 기준 시각 · 작은 [새로고침]은 홈 계좌 띠(brief-ui.js #hm-acct · #hm-refresh)가 모든 계좌 종류에서 맡는다(#hm-refresh 는 실계좌면 #toss-refresh 를 누른다).
// 다른 모듈이 .page-head·.ov-actions 에 붙이므로 두 칸은 그대로 둔다.
const homeTitle=$('#overview .page-head h1');
if(homeTitle){homeTitle.textContent='홈';homeTitle.classList.add('tq-vh');}

// 30일 자동 열기: 체험 프로필은 늘 자동으로 열리므로 숨긴다(app.js login 도 demo 는 기억하지 않는다).
const rememberCurrent=document.createElement('button');rememberCurrent.type='button';rememberCurrent.className='secondary';rememberCurrent.textContent='30일 동안 자동으로 열기';$('#workspace-profile').append(rememberCurrent);
const rememberedFor=()=>{try{const r=JSON.parse(localStorage.getItem('teamQuantRememberProfile')||'null');return r?.expiresAt>Date.now()?r.user:null;}catch{return null;}};
function syncRemember(){const user=sessionStorage.getItem('teamQuantSession');rememberCurrent.hidden=!user||user==='demo';const on=!!user&&rememberedFor()===user;rememberCurrent.disabled=on;rememberCurrent.textContent=on?'30일 동안 자동으로 열립니다':'30일 동안 자동으로 열기';}
rememberCurrent.onclick=()=>{const user=sessionStorage.getItem('teamQuantSession');if(!user||user==='demo')return;try{localStorage.setItem('teamQuantRememberProfile',JSON.stringify({user,expiresAt:Date.now()+30*86400000}));}catch{}syncRemember();};
window.addEventListener('teamquant:state',syncRemember);syncRemember();

// 고급 전략 실험 묶음 안의 이동(작은 단계 표시). 투자금 계산·가상 투자·판단 기록으로 가는 길이 여기뿐이라 남긴다.
const steps=[['strategy','1 매매 규칙'],['comparison','2 3개월 테스트'],['simulation','3 투자금 계산'],['assets','4 가상 투자'],['evidence','판단 기록']];
for(const [page] of steps){const head=$('#'+page+' .page-head');if(!head)continue;const bar=document.createElement('nav');bar.className='lab-flow';bar.setAttribute('aria-label','고급 전략 실험 순서');for(const [target,label] of steps){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-current',target===page?'step':'false');b.onclick=()=>$('[data-view="'+target+'"]')?.click();bar.append(b);}head.after(bar);}
// Remove redundant invitations, not the tools/data they previously linked to. (다른 모듈이 그 칸을 지워도 멈추지 않게 확인하고 숨긴다)
const strategySummary=$('#ov-strategy-summary')?.closest('article');if(strategySummary)strategySummary.hidden=true;
const ovRefresh=$('#overview .page-head #ov-refresh');if(ovRefresh)ovRefresh.hidden=true;
// 2026-11-16 사용자 확인 조항(consent-ui.js): 설정 화면이 만들어진 뒤에 붙인다(동의 관리 칸이 설정에 들어가야 하므로).
import('/consent-ui.js').catch(()=>{});
// 2026-11-16 간결 화면(compact-ui.js · compact.css): 설명 문장을 가리고 핵심 숫자만 남긴다.
import('/compact-ui.js').catch(()=>{});
