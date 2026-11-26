import {manwon} from '/lib/investor-tools.js';
import {lastObservation} from '/lib/last-observation.js';
import {privateRead,installBridgeUi} from '/bridge-client.js';
import '/overview-ui.js';
import {tip} from '/tooltip-ui.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const native=(v,c)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='KRW'?0:2}).format(v);
// 기준 시각은 한국 시간 'MM-DD HH:mm'(다른 해는 YYYY-MM-DD HH:mm)으로 쓴다.
const stamp=iso=>{const t=new Date(iso);if(!iso||!Number.isFinite(t.getTime()))return '';const f=ms=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));const p=f(t),now=f(new Date());return `${p.year===now.year?'':p.year+'-'}${p.month}-${p.day} ${p.hour}:${p.minute}`;};
const onPc=location.hostname==='127.0.0.1';
const HISTORY_NOTE='조회한 보유 주식 평가액은 내 PC에 기록됩니다(현금·입출금 제외 · 계좌 수익률 아님).';
const historyIdle=()=>`내 PC 조회 기록 ${tip(HISTORY_NOTE)}`;
const button=document.createElement('button');button.className='nav-button';button.dataset.view='toss';button.textContent='내 포트폴리오';$('.overview-nav nav').insertBefore(button,$('[data-view="assets"]'));
const panel=document.createElement('section');panel.className='view';panel.dataset.page='toss';panel.id='toss';panel.innerHTML=`<div class="page-head"><div><h1>내 포트폴리오</h1><p>내 PC에서 바로 조회 · 조회 기록은 내 PC에 저장 · 주문 없음</p></div><div class="ov-actions"><button id="toss-refresh" type="button" class="tq-icon-btn" aria-label="새로고침" title="새로고침">↻</button></div></div><p id="toss-status" role="status">${onPc?'이 PC의 토스 API 키 파일로 자동 조회합니다':'내 PC와 연결하면 토스 계좌가 보입니다 · 설정 > 내 PC 연결'}</p><p class="muted" id="toss-history-state" role="status">${historyIdle()}</p><div id="toss-result"></div><p class="toss-clear-row"><button id="toss-clear" type="button" class="text-button">화면에서 지우기</button></p>`;document.querySelector('main').append(panel);
// 2026-11-26: 홈 머리의 '토스 자산 연결'(포트폴리오로 이동만 하던 버튼)은 뺐다. 포트폴리오는 더보기 > 내 포트폴리오에 있다.
let generation=0,controller=null,pending=false,lastSuccess=0,snapshotOwner=null;
$('#toss-refresh').onclick=async()=>{
  if(pending)return;pending=true;window.dispatchEvent(new CustomEvent('teamquant:connection',{detail:{status:'loading'}}));
  controller?.abort();controller=new AbortController();const run=++generation,owner=sessionStorage.getItem('teamQuantSession');$('#toss-refresh').disabled=true;$('#toss-status').textContent='토스증권에서 보유 주식 확인 중…';
  try{const d=await privateRead('holdings',{}, {signal:controller.signal});if(run!==generation||owner!==sessionStorage.getItem('teamQuantSession'))return;
    lastSuccess=Date.now();snapshotOwner=owner;
    window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot',{detail:d}));window.dispatchEvent(new CustomEvent('teamquant:connection',{detail:{status:'connected'}}));
    $('#toss-history-state').innerHTML=d.localHistory?.saved?`PC에 기록함 · ${esc(stamp(d.fetchedAt))} ${tip('현금·입출금이 빠져 계좌 수익률은 계산할 수 없습니다. \'화면에서 지우기\'는 PC 기록을 지우지 않습니다.')}`:d.localHistory?'조회는 됐지만 PC 기록 저장은 실패했습니다(이번 조회는 기록에 없음).':'PC 프로그램이 예전 버전이라 기록을 저장하지 못합니다. 새 버전을 받아 주세요.';
    $('#toss-status').textContent=`${d.source} · ${stamp(d.fetchedAt)} 조회 · 현금 제외`;
    $('#toss-result').innerHTML=`<article class="panel"><h2>보유 주식 평가액 ${manwon(d.holdingValueKrw)}</h2><p>국내·미국 주식 합계 · 조회 환율로 원화 환산 · 현금 제외</p><details><summary>통화별 금액</summary><div class="ov-kpis">${d.totals.map(t=>`<article><span>${t.currency==='KRW'?'국내 주식':'미국 주식'}</span><strong>${native(t.value,t.currency)}</strong><small>평가손익 ${native(t.pnl,t.currency)}</small></article>`).join('')}<article><span>지금 환율로 원화 환산</span><strong>${d.holdingValueKrw===null?'환율 확인 못 함':native(d.holdingValueKrw,'KRW')}</strong><small>${d.fx?'환율(1달러 = '+d.fx.midRate.toLocaleString('ko-KR')+'원) · '+esc(d.fx.asOf):'현금 포함 총자산이 아닙니다.'}</small></article></div><p class="muted">${esc(d.notice)}</p></details></article><article class="panel"><h2>보유 종목 ${tip('통화별로 나눠 보여 줍니다. 원화 금액은 지금 환율로 환산해 원화 기준 원금·환차손익이 빠져 있습니다. 현금 자료가 없어 현금 비중 규칙에는 쓰지 않습니다.')}</h2><div class="table-wrap"><table><thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가액</th><th>평가손익(수수료·세금 전)</th><th>오늘 손익</th></tr></thead><tbody>${d.positions.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.symbol)} · ${esc(p.currency)}</small></td><td>${p.quantity.toLocaleString('ko-KR',{maximumFractionDigits:8})}</td><td>${native(p.avgCost,p.currency)}</td><td>${native(p.price,p.currency)}</td><td>${native(p.value,p.currency)}</td><td>${native(p.pnl,p.currency)}<br>${p.returnPct>0?'+':''}${p.returnPct.toFixed(2)}%</td><td>${p.dailyPnl===null?'정보 없음':native(p.dailyPnl,p.currency)}</td></tr>`).join('')||'<tr><td colspan="7">보유 주식이 없습니다.</td></tr>'}</tbody></table></div></article>`;
  }catch(e){if(run===generation){
    if(snapshotOwner!==owner&&e.name!=='AbortError'){
      try{const history=await privateRead('history-list'),saved=lastObservation(history.records||[]);if(saved&&run===generation&&owner===sessionStorage.getItem('teamQuantSession')){snapshotOwner=owner;window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot',{detail:saved}));$('#toss-result').textContent='최신 조회 실패 · 마지막으로 조회한 자료를 보여 줍니다';}}catch{/* PC unavailable: keep only this tab's already authorized observation. */}
    }
    if(run===generation){$('#toss-status').textContent=snapshotOwner!==owner&&viewSource?`${viewSource} · 실계좌 연결 안 됨`:(snapshotOwner===owner?'최신 조회 실패 · 마지막 조회 자료 유지. ':'')+(e.name==='AbortError'?'조회 취소됨':e.message);window.dispatchEvent(new CustomEvent('teamquant:connection',{detail:{status:'error'}}));}
  }}finally{if(run===generation){pending=false;$('#toss-refresh').disabled=false;}}
};
$('#toss-clear').onclick=()=>{window.dispatchEvent(new Event('teamquant:asset-clear'));generation++;controller?.abort();$('#toss-refresh').disabled=false;$('#toss-result').replaceChildren();$('#toss-status').textContent='화면에서만 지웠습니다. PC 기록은 그대로입니다.';};
// 팀 모의계좌·예시 자산을 보여 줄 때 상태 줄에는 연결 오류 원문 대신 지금 보는 자료의 출처와 기준 시각을 쓴다.
let viewSource='';
window.addEventListener('teamquant:asset-snapshot',e=>{const d=e.detail;viewSource=d&&(d.paper||d.demo)?[d.source,stamp(d.fetchedAt)&&`${stamp(d.fetchedAt)} 기준`].filter(Boolean).join(' · '):'';if(viewSource)$('#toss-status').textContent=viewSource;});
window.addEventListener('teamquant:asset-clear',()=>{viewSource='';});
// 2026-11-26: 위쪽 바 계좌 표시(.mode)는 paper-account-ui.js(ACCOUNT_LABEL)와 connected-workspace-ui.js 가 쓴다. 여기서는 덮어쓰지 않는다.

installBridgeUi(panel,()=>$('#toss-refresh').onclick());

// A local profile stores strategies and paper books; it is not broker authentication.
const connectionHint=document.createElement('p');connectionHint.className='muted';connectionHint.id='local-key-hint';
connectionHint.textContent=onPc?'토스 API 키 파일 확인 중…':'계좌 키는 내 PC에만 둡니다. 공개 사이트에서는 연결 번호로 내 PC와 연결합니다.';
$('#login-form').append(connectionHint);connectionHint.hidden=true; // 2026-11-25 P0: 키 파일·서버 안내는 방문자에게 숨김
const readiness=onPc?privateRead('status').then(d=>{
 connectionHint.hidden=d.keyFile!=='ready';connectionHint.textContent=d.keyFile==='ready'?'토스 API 키 파일 준비됨 · 프로필을 열면 계좌를 자동으로 불러옵니다.':d.keyFile==='missing'?'설정한 토스 API 키 파일을 찾지 못했습니다. PC의 파일 위치를 확인하세요.':'토스 API 키 파일을 처음 설정해야 합니다. START-HERE.md를 보세요.';
 return d;
}).catch(()=>{connectionHint.textContent='PC 프로그램이 꺼져 있습니다. start-personal-server.cmd로 켜 주세요.';return null;}):Promise.resolve(null);
window.addEventListener('teamquant:asset-clear',()=>{
 generation++;pending=false;lastSuccess=0;snapshotOwner=null;controller?.abort();
 $('#toss-result').replaceChildren();$('#toss-refresh').disabled=false;
 $('#toss-history-state').innerHTML=historyIdle();
});
let entering=false;
async function enterAccount(){
 if(entering||pending||$('#app').hidden||!sessionStorage.getItem('teamQuantSession'))return;
 const page=document.querySelector('.view.active')?.dataset.page;
 if(!['home','toss','strategy','comparison','assets'].includes(page))return;
 if(snapshotOwner===sessionStorage.getItem('teamQuantSession')&&Date.now()-lastSuccess<60000)return;
 entering=true;try{await $('#toss-refresh').onclick();}finally{entering=false;}
}
window.addEventListener('teamquant:page',()=>void enterAccount());
window.addEventListener('teamquant:bridge-ready',()=>{if(!entering&&!pending)void enterAccount();});
let openedIntent=false;
function openAccountIntent(){
 if(openedIntent||!onPc||new URLSearchParams(location.search).get('view')!=='toss'||$('#app').hidden||!sessionStorage.getItem('teamQuantSession'))return;
 openedIntent=true;queueMicrotask(()=>button.click());
}
window.addEventListener('teamquant:state',openAccountIntent);queueMicrotask(openAccountIntent);
