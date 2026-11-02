import '/toss-ui.js';
import {privateRead} from '/bridge-client.js';
import {stockName} from '/lib/instruments.js';
import {threeMonthsBefore} from '/lib/comparison.js';

const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const money=(v,c)=>v===null?'미제공':new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='KRW'?4:6}).format(v);
const qty=v=>v.toLocaleString('ko-KR',{maximumFractionDigits:8});
const time=v=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(v)):'미제공';
const statuses={PENDING:'대기',PARTIAL_FILLED:'부분 체결',FILLED:'체결 완료',CANCELED:'취소',REJECTED:'거절',REPLACED:'정정 전 주문',PENDING_CANCEL:'취소 처리 중',PENDING_REPLACE:'정정 처리 중',CANCEL_REJECTED:'취소 거절',REPLACE_REJECTED:'정정 거절'};
let report=null,epoch=0,controller=null,pending=false,pageIndex=0,owner=sessionStorage.getItem('teamQuantSession');const names=new Map();
const box=document.createElement('details');box.id='order-history';box.className='panel order-history';
box.innerHTML=`<summary>실제 주문·체결 이력</summary><p>기존 토스 키로 첫 번째 종합매매 계좌를 조회합니다. 주문 생성·수정·취소 기능은 없습니다. Vercel에서는 내 PC 연결을 먼저 완료하십시오.</p>
<form id="orders-form" class="ov-form"><label>주문 시작일 · 한국시간<input id="orders-from" type="date" value="${threeMonthsBefore(today())}" max="${today()}" required></label><label>주문 종료일 · 한국시간<input id="orders-to" type="date" value="${today()}" max="${today()}" required></label><label>주문 구분<select id="orders-group"><option value="CLOSED">종료된 주문 · 체결/취소/거절 포함</option><option value="OPEN">진행 중 주문 · 부분 체결 포함</option></select></label><label>종목<select id="orders-symbol"><option value="">전체 종목 · 매도 완료 종목 포함</option></select></label><button id="orders-load" class="primary" type="submit">주문 이력 조회</button></form>
<p class="muted">한 번에 최대 1년 구간을 조회할 수 있습니다. 날짜는 체결일이 아닌 주문 생성일 기준입니다. 장전·장후 시간외 종가 등 일부 주문 유형은 제외됩니다. 주문별 누적 체결 결과이며 개별 부분체결의 전체 시간 순서는 제공하지 않습니다.</p>
<div class="ov-actions"><label class="orders-filled-only"><input id="orders-filled" type="checkbox">체결 수량이 있는 주문만 표시</label><button id="orders-export" class="secondary" disabled>조회 결과 JSON 저장</button></div><p id="orders-status" class="notice" role="status">위 버튼으로 실제 주문 이력을 조회할 수 있습니다. 조회 데이터는 이 탭의 메모리에만 표시합니다.</p><div id="orders-results"></div><a href="/downloads/TeamQuant-PC.zip" download>최신 PC 연결 패키지</a>`;
$('#toss-result').after(box);
const shortcut=document.createElement('button');shortcut.className='secondary';shortcut.id='orders-shortcut';shortcut.textContent='주문·체결 이력';$('#toss .page-head .ov-actions').prepend(shortcut);
function syncNames(){
 const select=$('#orders-symbol'),current=select.value;
 select.innerHTML='<option value="">전체 종목 · 매도 완료 종목 포함</option>'+[...names].sort((a,b)=>a[1].localeCompare(b[1],'ko')).map(([s,n])=>`<option value="${esc(s)}">${esc(n===s?'종목명 미확인':n)} · ${esc(s)}</option>`).join('');
 if([...select.options].some(x=>x.value===current))select.value=current;
}
function invalidate(){epoch++;controller?.abort();pending=false;report=null;pageIndex=0;$('#orders-load').disabled=false;shortcut.disabled=false;$('#orders-export').disabled=true;$('#orders-results').replaceChildren();}
function render(){
 if(!report)return;
 const rows=report.orders.filter(o=>!$('#orders-filled').checked||o.execution.filledQuantity>0),size=40,max=Math.max(0,Math.ceil(rows.length/size)-1);pageIndex=Math.min(pageIndex,max);
 const displayed=rows.slice(pageIndex*size,(pageIndex+1)*size);
 const summary=report.totals.filter(t=>t.orders).map(t=>`<article class="panel"><h3>${esc(t.currency)} · 조회된 전체 주문 합계</h3><div class="ov-kpis"><article><span>매수 체결금액</span><strong>${money(t.buyAmount,t.currency)}</strong></article><article><span>매도 체결금액</span><strong>${money(t.sellAmount,t.currency)}</strong></article><article><span>체결 수수료</span><strong>${money(t.commission,t.currency)}</strong></article><article><span>체결 세금</span><strong>${money(t.tax,t.currency)}</strong></article></div><p class="muted">매매 금액은 투자손익이 아닙니다. 표시 필터와 별도로 조회된 전체 주문의 합계이며, 미제공 금액은 0으로 바꾸지 않습니다.</p></article>`).join('');
 $('#orders-results').innerHTML=`<p>${esc(report.source)}<br>${esc(report.query.from)} ~ ${esc(report.query.to)} · 주문 생성일 · ${report.query.status==='OPEN'?'진행 중':'종료'} · 조회 ${time(report.fetchedAt)}<br>조회된 주문 ${report.orders.length}건 · 체결 수량이 있는 주문 ${report.orders.filter(o=>o.execution.filledQuantity>0).length}건 · ${report.paginationComplete?'이 API 응답의 전체 페이지 확인':'일부 페이지만 확인'}</p>${report.issue?`<p class="notice">${esc(report.issue)}</p>`:''}${summary}<div class="table-wrap"><table><thead><tr><th>주문 시각 · 한국시간</th><th>종목</th><th>매매·주문 상태</th><th>요청 수량·가격</th><th>체결 수량·평균가</th><th>체결 상세</th></tr></thead><tbody>${displayed.map(o=>{
  const e=o.execution,candidate=names.get(o.symbol)||o.name||stockName(o.symbol),label=candidate===o.symbol?'종목명 미확인':candidate,hasFill=e.filledQuantity>0;
  return `<tr><td>${esc(time(o.orderedAt))}</td><td><b>${esc(label)}</b><small>${esc(o.symbol)} · ${esc(o.currency)}</small></td><td>${o.side==='BUY'?'매수':'매도'}<small>${esc(statuses[o.status]||'기타 상태: '+o.status)}${hasFill&&o.status!=='FILLED'?' · 체결 수량 있음':''}</small></td><td>${o.quantity===0&&o.orderAmount>0?'금액 지정 '+money(o.orderAmount,o.currency):qty(o.quantity)+'주'}<small>${o.limitPrice===null?'가격 미지정':money(o.limitPrice,o.currency)} · ${esc(({LIMIT:'지정가',MARKET:'시장가'})[o.orderType]||o.orderType)} / ${esc(o.timeInForce)}</small></td><td>${qty(e.filledQuantity)}주<small>${e.averageFilledPrice===null?'평균 체결가 미제공':money(e.averageFilledPrice,o.currency)}</small></td><td><details><summary>체결 정보</summary><p>체결금액 ${money(e.filledAmount,o.currency)}<br>수수료 ${money(e.commission,o.currency)}<br>세금 ${money(e.tax,o.currency)}<br>최종 체결 ${esc(time(e.filledAt))}<br>결제 예정일 ${esc(e.settlementDate||'미제공')}<br>조회용 식별자 ${esc(o.ref.slice(0,12))}</p></details></td></tr>`;
 }).join('')||'<tr><td colspan="6">선택한 조건에 표시할 주문이 없습니다. 이것만으로 과거 거래가 없었다고 판단할 수는 없습니다.</td></tr>'}</tbody></table></div><div class="ov-actions orders-pages"><button id="orders-prev" class="secondary" ${pageIndex===0?'disabled':''}>이전</button><span>${rows.length?pageIndex*size+1:0} ~ ${Math.min((pageIndex+1)*size,rows.length)} / 표시 ${rows.length}건</span><button id="orders-next" class="secondary" ${pageIndex>=max?'disabled':''}>다음</button></div><p class="muted">${esc(report.notice)}</p>`;
 $('#orders-prev').onclick=()=>{pageIndex--;render();};$('#orders-next').onclick=()=>{pageIndex++;render();};
}
async function load(){
 if(pending)return;
 if(!sessionStorage.getItem('teamQuantSession'))return;
 invalidate();pending=true;controller=new AbortController();const run=epoch,profile=sessionStorage.getItem('teamQuantSession');
 $('#orders-load').disabled=true;shortcut.disabled=true;$('#orders-status').textContent='토스증권 주문 이력 조회 중…';
 try{
  const data=await privateRead('order-history',{from:$('#orders-from').value,to:$('#orders-to').value,status:$('#orders-group').value,symbol:$('#orders-symbol').value},{signal:controller.signal});
  if(run!==epoch||profile!==sessionStorage.getItem('teamQuantSession'))return;
  if(!Array.isArray(data.orders)||!Array.isArray(data.totals)||!data.query)throw new Error('주문 이력 응답 형식을 확인하지 못했습니다. 최신 PC 서버를 확인하십시오.');
  report=data;for(const o of data.orders)if(!names.has(o.symbol)||names.get(o.symbol)===o.symbol)names.set(o.symbol,o.name||stockName(o.symbol));syncNames();render();$('#orders-export').disabled=false;
  $('#orders-status').textContent=data.paginationComplete?'주문 이력 조회 완료 · 지원되는 주문 유형만 포함 · 주문별 누적 체결 결과':'일부 주문만 조회했습니다. 경고 내용을 확인하고 기간을 좁혀 다시 조회하십시오.';
 }catch(error){if(run===epoch)$('#orders-status').textContent=error.name==='AbortError'?'조회를 중단했습니다.':error.message;}
 finally{if(run===epoch){pending=false;$('#orders-load').disabled=false;shortcut.disabled=false;}}
}
$('#orders-form').onsubmit=e=>{e.preventDefault();void load();};
$('#orders-form').onchange=()=>{if(report||pending){invalidate();$('#orders-status').textContent='조회 조건이 변경되었습니다. 다시 조회하십시오.';}};
shortcut.onclick=()=>{box.open=true;box.scrollIntoView({behavior:'smooth',block:'start'});if(!report)void load();};
$('#orders-filled').onchange=()=>{pageIndex=0;render();};
$('#orders-export').onclick=()=>{
 if(!report)return;
 const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TeamQuant-orders-${report.query.from}-${report.query.to}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('teamquant:asset-snapshot',e=>{for(const p of e.detail.positions)names.set(p.symbol,p.name);syncNames();if(report)render();});
window.addEventListener('teamquant:asset-clear',()=>{invalidate();names.clear();syncNames();$('#orders-status').textContent='화면의 주문 이력을 지웠습니다. 증권사의 실제 주문은 변경하지 않았습니다.';});
window.addEventListener('teamquant:state',()=>{const next=sessionStorage.getItem('teamQuantSession');if(next!==owner){invalidate();names.clear();syncNames();owner=next;$('#orders-status').textContent='프로필이 변경되었습니다. 주문 이력을 다시 조회하십시오.';}});
