import '/asset-hub-ui.js';
import '/workspace-ui.js';
function mountConnectedWorkspace(){
// Reuse the same live snapshot, rule approval and paper engines across both menus.
const $=s=>document.querySelector(s);
const profile=()=>sessionStorage.getItem('teamQuantSession');
const approved=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+profile())||'{}').approved;}catch{return null;}};
let snapshot=null,owner=null,strategyId=null;
const panels={compare:$('[data-asset-panel="compare"]'),paper:$('[data-asset-panel="paper"]')};
for(const [kind,page,title] of [['compare','comparison','다른 상품·연구 조건으로 검증'],['paper','assets','기존 독립 모의 장부']]){
 const host=$('#'+page),legacy=document.createElement('details');legacy.className='panel legacy-research';legacy.innerHTML='<summary>'+title+'</summary>';
 for(const child of [...host.children])if(!child.classList.contains('page-head')&&!child.classList.contains('lab-flow'))legacy.append(child);
 host.append(panels[kind],legacy);panels[kind].hidden=true;
}
$('#asset-hub .workspace-tabs').hidden=true;
$('#assets h1').textContent='모의 운용';$('#assets .page-head p').textContent='내 보유 종목을 복사하고 승인한 원칙으로 가상 운용합니다.';$('#assets .legacy-research').append($('#refresh-assets'));

const contexts=[];
for(const page of ['strategy','comparison','assets']){
 const card=document.createElement('article');card.className='panel connected-context';card.innerHTML='<h2>내 보유 자산과 연결</h2><p class="connected-summary"></p><p class="connected-symbols"></p><p class="connected-strategy"></p><div class="ov-actions"><button data-owned-action="home" class="secondary">내 자산 보기</button><button data-owned-action="review" class="secondary">승인 원칙으로 보유 종목 점검</button><button data-owned-action="compare" class="secondary">보유 종목으로 3개월 검증</button><button data-owned-action="paper" class="secondary">보유 종목으로 모의 운용</button><button data-owned-action="settings" class="secondary">연결 설정</button></div>';
 $('#'+page+' .page-head').after(card);contexts.push(card);
}
const homeActions=document.createElement('div');homeActions.className='ov-actions owned-actions';homeActions.innerHTML='<button data-owned-action="review" class="secondary">보유 종목 원칙 점검</button><button data-owned-action="compare" class="secondary">이 자산으로 전략 검증</button><button data-owned-action="paper" class="secondary">이 자산으로 모의 운용</button>';
$('#ov-next').append(homeActions);
document.addEventListener('click',e=>{const b=e.target.closest('[data-owned-action]');if(!b)return;const target={review:'toss',compare:'comparison',paper:'assets'}[b.dataset.ownedAction]||b.dataset.ownedAction;$('[data-view="'+target+'"]')?.click();if(b.dataset.ownedAction==='review')$('#hub-evaluate')?.scrollIntoView({block:'center',behavior:'smooth'});});
function sync(){
 const connected=!!snapshot&&owner===profile(),a=approved();
 for(const card of contexts){card.querySelector('.connected-summary').textContent=connected?`토스증권 · ${snapshot.positions.length}개 보유 종목 · 조회 ${new Date(snapshot.fetchedAt).toLocaleString('ko-KR')} · 내 자산과 동일한 조회 자료`:'실제 계좌 연결 후 같은 보유 종목을 전략 검증과 모의 운용에 사용합니다.';card.querySelector('.connected-symbols').textContent=connected?snapshot.positions.slice(0,8).map(p=>p.name).join(' · ')+(snapshot.positions.length>8?' 외 '+(snapshot.positions.length-8)+'개':''):'';card.querySelector('.connected-strategy').textContent=a?`승인 전략: ${a.definition.name} · ${a.definition.id}`:'투자 원칙을 입력하고 승인하면 같은 규칙으로 보유 종목을 점검하고 검증합니다.';card.querySelector('[data-owned-action="settings"]').hidden=connected;for(const b of card.querySelectorAll('[data-owned-action="review"],[data-owned-action="compare"],[data-owned-action="paper"]'))b.disabled=!connected;}
 for(const p of Object.values(panels))p.hidden=!connected;
 homeActions.hidden=!connected;
 $('#hub-strategy').textContent=a?`${a.definition.name} · ${a.definition.id} · ${a.definition.entryRule}`:'Strategy Lab에서 투자 원칙을 승인하십시오.';
 if(strategyId!==a?.definition.id){strategyId=a?.definition.id||null;window.dispatchEvent(new Event('teamquant:approved-context'));}
 const page=$('.view.active')?.dataset.page;
 const kind=document.body.dataset.account||(connected?'real':'none');$('.mode').textContent=['assets','comparison','simulation'].includes(page)?'가상 검증 · 실제 주문 없음':({real:'실계좌 조회 · 주문 없음',paper:'모의계좌 · 실제 돈 아님',demo:'예시 자산 · 가짜 보유'})[kind]||'계좌 연결 확인';
 const perfDemo=$('#perf-demo');if(perfDemo)perfDemo.hidden=connected;
}
window.addEventListener('teamquant:asset-snapshot',e=>{snapshot=e.detail;owner=profile();sync();});
window.addEventListener('teamquant:asset-clear',()=>{snapshot=null;owner=null;sync();});
window.addEventListener('teamquant:state',sync);window.addEventListener('teamquant:page',sync);sync();

}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountConnectedWorkspace,{once:true});else mountConnectedWorkspace();
