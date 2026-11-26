import '/asset-hub-ui.js';
import '/workspace-ui.js';
import {ACCOUNT_LABEL} from '/paper-account-ui.js';
// 기준 시각은 한국 시간 'MM-DD HH:mm'(다른 해는 YYYY-MM-DD HH:mm).
const stamp=iso=>{const t=new Date(iso);if(!iso||!Number.isFinite(t.getTime()))return '';const f=ms=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));const p=f(t),now=f(new Date());return `${p.year===now.year?'':p.year+'-'}${p.month}-${p.day} ${p.hour}:${p.minute}`;};
function mountConnectedWorkspace(){
// Reuse the same live snapshot, rule approval and paper engines across both menus.
const $=s=>document.querySelector(s);
const profile=()=>sessionStorage.getItem('teamQuantSession');
const approved=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+profile())||'{}').approved;}catch{return null;}};
let snapshot=null,owner=null,strategyId=null;
const panels={compare:$('[data-asset-panel="compare"]'),paper:$('[data-asset-panel="paper"]')};
// 2026-11-26: 화면 본문을 접어 두면 들어가도 빈 화면처럼 보여서, 이 접기는 처음부터 펼쳐 둔다.
for(const [kind,page,title] of [['compare','comparison','테스트 설정·결과'],['paper','assets','가상 투자 잔고와 매매 신호']]){
 const host=$('#'+page),legacy=document.createElement('details');legacy.className='panel legacy-research';legacy.open=true;legacy.innerHTML='<summary>'+title+'</summary>';
 for(const child of [...host.children])if(!child.classList.contains('page-head')&&!child.classList.contains('lab-flow'))legacy.append(child);
 host.append(panels[kind],legacy);panels[kind].hidden=true;
}
$('#asset-hub .workspace-tabs').hidden=true;
$('#assets h1').textContent='가상 투자';$('#assets .page-head p').textContent='확정한 매매 규칙의 신호를 가상 돈으로 따라 해 봅니다.';$('#assets .legacy-research').append($('#refresh-assets'));

// 옛 화면 3곳 위의 한 줄 카드: 지금 쓰는 보유 자료와 확정한 규칙을 보여 준다(investor-ui.js 가 #strategy 카드 뒤에 붙으므로 카드는 남긴다).
const contexts=[];
for(const page of ['strategy','comparison','assets']){
 const card=document.createElement('article');card.className='panel connected-context';card.innerHTML='<p class="connected-summary"></p><p class="connected-strategy"></p>';
 ($('#'+page+' .lab-flow')||$('#'+page+' .page-head')).after(card);contexts.push(card); // 단계 표시(이동) 다음에 둔다
}
// 2026-11-26: 화면에 보이지 않던 카드 버튼 5개·홈 버튼 3개(CSS 로 숨김)는 뺐다. 같은 곳은 메뉴로 간다.
function sync(){
 const connected=!!snapshot&&owner===profile(),a=approved();
 for(const card of contexts){card.querySelector('.connected-summary').textContent=connected?[snapshot.source||'내 계좌',`보유 ${snapshot.positions.length}종목`,stamp(snapshot.fetchedAt)].filter(Boolean).join(' · '):'계좌를 연결하면 보유 종목으로 바로 테스트합니다.';card.querySelector('.connected-strategy').textContent=a?`확정한 규칙: ${a.definition.name}`:'매매 규칙을 확정하면 내 보유 종목에 바로 적용해 점검·테스트합니다.';}
 for(const p of Object.values(panels))p.hidden=!connected;
 $('#hub-strategy').textContent=a?`${a.definition.name} · ${a.definition.entryRule}`:'먼저 고급 전략 실험에서 매매 규칙을 확정하세요.';
 if(strategyId!==a?.definition.id){strategyId=a?.definition.id||null;window.dispatchEvent(new Event('teamquant:approved-context'));}
 const page=$('.view.active')?.dataset.page;
 // 위쪽 바 계좌 표시: 문구는 paper-account-ui.js ACCOUNT_LABEL 한 곳에서 정한다. 고급 전략 실험의 가상 투자 화면만 따로 표시한다.
 const kind=document.body.dataset.account||(connected?'real':'none');$('.mode').textContent=['assets','comparison','simulation'].includes(page)?ACCOUNT_LABEL.lab:(ACCOUNT_LABEL[kind]||ACCOUNT_LABEL.none);
 // 과거 투자 성과의 '예시로 보기'(#perf-demo)는 계좌와 상관없는 CSV 예시라 연결돼 있어도 숨기지 않는다(2026-11-26).
}
window.addEventListener('teamquant:asset-snapshot',e=>{snapshot=e.detail;owner=profile();sync();});
window.addEventListener('teamquant:asset-clear',()=>{snapshot=null;owner=null;sync();});
window.addEventListener('teamquant:state',sync);window.addEventListener('teamquant:page',sync);sync();

}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountConnectedWorkspace,{once:true});else mountConnectedWorkspace();
