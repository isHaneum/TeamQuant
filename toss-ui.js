import {privateRead,installBridgeUi} from '/bridge-client.js';
import '/overview-ui.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const native=(v,c)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='KRW'?0:2}).format(v);
const button=document.createElement('button');button.className='nav-button';button.dataset.view='toss';button.textContent='내 실제 자산';$('.overview-nav nav').insertBefore(button,$('[data-view="assets"]'));
const panel=document.createElement('section');panel.className='view';panel.dataset.page='toss';panel.id='toss';panel.innerHTML=`<div class="page-head"><div><h1>내 자산과 다음 선택</h1><p>본인 PC에서 직접 조회 · 보유 주식 이력은 PC에 저장 · 주문 없음</p></div><div class="ov-actions"><button id="toss-refresh" class="primary">보유 주식 새로고침</button><button id="toss-clear" class="secondary">화면에서 지우기</button></div></div><p id="toss-status" class="notice" role="status">이 PC에 설정된 토스 키 파일을 사용합니다. 내 실제 자산에 들어오면 자동 조회합니다.</p><p class="muted" id="toss-history-state" role="status">조회 성공 시 보유 주식 평가액 이력을 PC 사용자 데이터 폴더에 저장합니다. 현금·입출금·실제 계좌 수익률은 포함하지 않습니다.</p><div id="toss-result"></div>`;document.querySelector('main').append(panel);
const shortcut=document.createElement('button');shortcut.className='secondary';shortcut.textContent='토스 자산 연결';shortcut.onclick=()=>button.click();$('#overview .page-head .ov-actions').prepend(shortcut);
let generation=0,controller=null,pending=false,lastSuccess=0,snapshotOwner=null;
const onPc=location.hostname==='127.0.0.1';
$('#toss-refresh').onclick=async()=>{
  if(pending)return;pending=true;
  controller?.abort();controller=new AbortController();const run=++generation,owner=sessionStorage.getItem('teamQuantSession');$('#toss-refresh').disabled=true;$('#toss-status').textContent='토스증권에서 보유 주식 확인 중…';
  try{const d=await privateRead('holdings');if(run!==generation||owner!==sessionStorage.getItem('teamQuantSession'))return;
    lastSuccess=Date.now();snapshotOwner=owner;
    window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot',{detail:d}));
    $('#toss-history-state').textContent=d.localHistory?.saved?'보유 주식 조회 이력을 PC에 저장했습니다. 현금·입출금 미포함으로 실제 계좌 수익률을 계산할 수 없습니다. 화면에서 지우기는 PC 이력을 삭제하지 않습니다.':d.localHistory?'조회는 성공했으나 PC 이력 저장에 실패했습니다. 이 조회는 이력에 반영되지 않았습니다.':'이 PC 서버는 이력 저장을 지원하지 않습니다. 최신 PC 연결 패키지가 필요합니다.';
    $('#toss-status').textContent=`${d.source} · 조회 ${new Date(d.fetchedAt).toLocaleString('ko-KR')} · 첫 번째 종합매매 계좌 · 현금 제외`;
    $('#toss-result').innerHTML=`<article class="panel"><h2>보유 주식 평가액</h2><div class="ov-kpis">${d.totals.map(t=>`<article><span>${t.currency==='KRW'?'국내 주식':'미국 주식'}</span><strong>${native(t.value,t.currency)}</strong><small>평가손익 ${native(t.pnl,t.currency)}</small></article>`).join('')}<article><span>현재 환율로 원화 환산</span><strong>${d.holdingValueKrw===null?'환율 확인 불가':native(d.holdingValueKrw,'KRW')}</strong><small>${d.fx?'1 USD = '+d.fx.midRate.toLocaleString('ko-KR')+'원 · '+esc(d.fx.asOf):'현금 포함 총자산이 아닙니다.'}</small></article></div><p class="muted">${esc(d.notice)}</p></article><article class="panel"><h2>보유 종목</h2><div class="table-wrap"><table><thead><tr><th>종목</th><th>수량</th><th>평균 매입가</th><th>현재가</th><th>평가액</th><th>평가손익 · 비용 전</th><th>일간 손익</th></tr></thead><tbody>${d.positions.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.symbol)} · ${esc(p.currency)}</small></td><td>${p.quantity.toLocaleString('ko-KR',{maximumFractionDigits:8})}</td><td>${native(p.avgCost,p.currency)}</td><td>${native(p.price,p.currency)}</td><td>${native(p.value,p.currency)}</td><td>${native(p.pnl,p.currency)}<br>${p.returnPct.toFixed(2)}%</td><td>${p.dailyPnl===null?'미제공':native(p.dailyPnl,p.currency)}</td></tr>`).join('')||'<tr><td colspan="7">보유 주식이 없습니다.</td></tr>'}</tbody></table></div><p class="muted">통화별 금액을 구분합니다. 현재 환율로 환산한 금액은 원화 기준 취득원가·환차손익을 재현하지 않습니다. 현금 자료가 없어 현금 비중과 전체 자산 원칙 점검에는 자동 반영하지 않습니다.</p></article>`;
  }catch(e){if(run===generation)$('#toss-status').textContent=e.name==='AbortError'?'조회 취소됨':e.message;}finally{if(run===generation){pending=false;$('#toss-refresh').disabled=false;}}
};
$('#toss-clear').onclick=()=>{window.dispatchEvent(new Event('teamquant:asset-clear'));generation++;controller?.abort();$('#toss-refresh').disabled=false;$('#toss-result').replaceChildren();$('#toss-status').textContent='화면의 조회 정보를 삭제했습니다. PC에 저장된 이력은 유지됩니다.';};

window.addEventListener('teamquant:page',()=>{const active=document.querySelector('.view.active')?.dataset.page==='toss';document.querySelector('.mode').textContent=active?'실제 자산 조회 · 주문 없음':'모의투자 · 실제 주문 없음';});

installBridgeUi(panel,()=>$('#toss-refresh').onclick());

// A local profile stores strategies and paper books; it is not broker authentication.
const connectionHint=document.createElement('p');connectionHint.className='muted';connectionHint.id='local-key-hint';
connectionHint.textContent=onPc?'PC 키 파일 확인 중…':'개인 계좌 키는 본인 PC에 보관합니다. Vercel에서는 PC 연결코드를 사용합니다.';
$('#login-form').append(connectionHint);
const readiness=onPc?privateRead('status').then(d=>{
 connectionHint.textContent=d.keyFile==='ready'?'기존 토스 키 파일이 연결되어 있습니다. 프로필을 열고 내 실제 자산을 선택하면 자동 조회합니다.':d.keyFile==='missing'?'설정된 토스 키 파일을 찾지 못했습니다. PC의 파일 위치를 확인하십시오.':'토스 키 파일 초기 설정이 필요합니다. START-HERE.md를 확인하십시오.';
 return d;
}).catch(()=>{connectionHint.textContent='PC 서버 연결을 확인하십시오. start-personal-server.cmd로 실행할 수 있습니다.';return null;}):Promise.resolve(null);
window.addEventListener('teamquant:asset-clear',()=>{
 generation++;pending=false;lastSuccess=0;snapshotOwner=null;controller?.abort();
 $('#toss-result').replaceChildren();$('#toss-refresh').disabled=false;
 $('#toss-history-state').textContent='화면의 자산 정보만 지웠습니다. PC 이력은 유지되며, 다시 들어오면 새로 조회합니다.';
});
let wasActive=false,visit=0;
window.addEventListener('teamquant:page',()=>{
 const page=document.querySelector('.view.active')?.dataset.page,active=page==='toss'||page==='home';
 const thisVisit=++visit;
 if(active&&!wasActive&&!$('#app').hidden&&sessionStorage.getItem('teamQuantSession')){
  const owner=sessionStorage.getItem('teamQuantSession');
  (onPc?readiness:privateRead('status').catch(()=>null)).then(d=>{
   if(thisVisit!==visit||d?.keyFile!=='ready'||owner!==sessionStorage.getItem('teamQuantSession')||$('#app').hidden)return;
   if(snapshotOwner!==owner||Date.now()-lastSuccess>=60000)void $('#toss-refresh').onclick();
  });
 }
 wasActive=active;
});
let openedIntent=false;
function openAccountIntent(){
 if(openedIntent||!onPc||new URLSearchParams(location.search).get('view')!=='toss'||$('#app').hidden||!sessionStorage.getItem('teamQuantSession'))return;
 openedIntent=true;queueMicrotask(()=>button.click());
}
window.addEventListener('teamquant:state',openAccountIntent);queueMicrotask(openAccountIntent);
