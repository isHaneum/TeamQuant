import '/toss-ui.js';
import {privateRead} from '/bridge-client.js';
import {stockName} from '/lib/instruments.js';
import {threeMonthsBefore} from '/lib/comparison.js';
import {tip} from '/tooltip-ui.js';

const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
// 주문 금액: 원화 '1,234,567원'(소수 없음), 달러 '$1,234.56'
const money=(v,c)=>{if(v===null||v===undefined)return '정보 없음';const s=v<0?'-':'',a=Math.abs(v);return c==='USD'?`${s}$${a.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:c==='KRW'?`${s}${Math.round(a).toLocaleString('ko-KR')}원`:`${s}${a.toLocaleString('ko-KR',{maximumFractionDigits:2})} ${c}`;};
const curName=c=>({KRW:'원화',USD:'달러'})[c]||c;
const qty=v=>v.toLocaleString('ko-KR',{maximumFractionDigits:8});
// 시각: 한국 시간 'MM-DD HH:mm'(다른 해는 YYYY-MM-DD HH:mm), 초 없이
const time=v=>{const t=new Date(v);if(!v||!Number.isFinite(t.getTime()))return '정보 없음';const f=d=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));const p=f(t),now=f(new Date());return `${p.year===now.year?'':p.year+'-'}${p.month}-${p.day} ${p.hour}:${p.minute}`;};
const statuses={PENDING:'미체결',PARTIAL_FILLED:'일부 체결',FILLED:'전량 체결',CANCELED:'취소',REJECTED:'거부',REPLACED:'정정 전 주문',PENDING_CANCEL:'취소 처리 중',PENDING_REPLACE:'정정 처리 중',CANCEL_REJECTED:'취소 거부',REPLACE_REJECTED:'정정 거부'};
const tifs={DAY:'당일',GTC:'취소 전까지'};
let report=null,epoch=0,controller=null,pending=false,pageIndex=0,owner=sessionStorage.getItem('teamQuantSession');const names=new Map();
const box=document.createElement('details');box.id='order-history';box.className='panel order-history';
box.innerHTML=`<summary>주문 내역</summary><p class="orders-intro">토스증권 주문 내역을 조회만 합니다(주문 생성·수정·취소 없음) · 최대 1년 · 주문한 날 기준 ${tip('공개 사이트에서는 설정 > 내 PC 연결을 먼저 해 주세요.\n장전·장후 시간외 종가 등 일부 주문은 빠집니다. 지원되는 주문 종류만 조회됩니다.\n주문별로 합친 체결 결과라 부분 체결 순서는 보이지 않습니다.')}</p>
<form id="orders-form" class="ov-form"><label>주문 시작일<input id="orders-from" type="date" value="${threeMonthsBefore(today())}" max="${today()}" required></label><label>주문 종료일<input id="orders-to" type="date" value="${today()}" max="${today()}" required></label><label>주문 구분<select id="orders-group"><option value="CLOSED">체결·취소된 주문 (거부 포함)</option><option value="OPEN">미체결 (일부 체결 포함)</option></select></label><label>종목<select id="orders-symbol"><option value="">전체 종목 · 다 판 종목 포함</option></select></label><button id="orders-load" class="primary" type="submit">조회</button></form>
<div class="ov-actions"><label class="orders-filled-only"><input id="orders-filled" type="checkbox">체결된 주문만</label><details class="more-menu"><summary aria-label="더 보기" title="더 보기">⋯</summary><div><button id="orders-export" class="secondary" disabled>파일로 저장</button></div></details></div><p id="orders-status" class="notice" role="status">기간을 고르고 '조회'를 누르세요. 이 창에만 보이고 저장되지 않습니다.</p><div id="orders-results"></div>`;
$('#toss-result').after(box);
const shortcut=document.createElement('button');shortcut.className='secondary';shortcut.id='orders-shortcut';shortcut.textContent='주문 내역';$('#toss .page-head .ov-actions').prepend(shortcut);
function syncNames(){
 const select=$('#orders-symbol'),current=select.value;
 select.innerHTML='<option value="">전체 종목 · 다 판 종목 포함</option>'+[...names].sort((a,b)=>a[1].localeCompare(b[1],'ko')).map(([s,n])=>`<option value="${esc(s)}">${esc(n===s?'종목명 확인 안 됨':n)} · ${esc(s)}</option>`).join('');
 if([...select.options].some(x=>x.value===current))select.value=current;
}
function invalidate(){epoch++;controller?.abort();pending=false;report=null;pageIndex=0;$('#orders-load').disabled=false;shortcut.disabled=false;$('#orders-export').disabled=true;$('#orders-results').replaceChildren();}
function render(){
 if(!report)return;
 const rows=report.orders.filter(o=>!$('#orders-filled').checked||o.execution.filledQuantity>0),size=40,max=Math.max(0,Math.ceil(rows.length/size)-1);pageIndex=Math.min(pageIndex,max);
 const displayed=rows.slice(pageIndex*size,(pageIndex+1)*size);
 const summary=report.totals.filter(t=>t.orders).map(t=>`<article class="panel"><h3>${esc(curName(t.currency))} · 조회한 주문 전체 합계(손익 아님) ${tip('표시 필터와 상관없이 조회된 전체 주문의 합계이며, 정보 없는 금액은 0으로 바꾸지 않습니다.')}</h3><div class="ov-kpis"><article><span>매수 체결금액</span><strong>${money(t.buyAmount,t.currency)}</strong></article><article><span>매도 체결금액</span><strong>${money(t.sellAmount,t.currency)}</strong></article><article><span>체결 수수료</span><strong>${money(t.commission,t.currency)}</strong></article><article><span>체결 세금</span><strong>${money(t.tax,t.currency)}</strong></article></div></article>`).join('');
 const info=[report.source,'주문한 날 기준',report.query.status==='OPEN'?'미체결':'체결·취소된 주문',`${time(report.fetchedAt)} 조회`,report.paginationComplete?'전부 불러옴':'일부만 불러옴',report.notice].filter(Boolean).join('\n');
 $('#orders-results').innerHTML=`<p class="orders-head">${esc(report.query.from)} ~ ${esc(report.query.to)} · 주문 ${report.orders.length}건 · 체결 ${report.orders.filter(o=>o.execution.filledQuantity>0).length}건 ${tip(info)}</p>${report.issue?`<p class="notice">${esc(report.issue)}</p>`:''}${summary}<div class="table-wrap"><table><thead><tr><th>주문 시각</th><th>종목</th><th>매매·상태</th><th>주문 수량·가격</th><th>체결 수량·평균가</th><th>체결금액</th><th>자세히</th></tr></thead><tbody>${displayed.map(o=>{
  const e=o.execution,candidate=names.get(o.symbol)||o.name||stockName(o.symbol),label=candidate===o.symbol?'종목명 확인 안 됨':candidate,hasFill=e.filledQuantity>0;
  return `<tr><td>${esc(time(o.orderedAt))}</td><td><b>${esc(label)}</b><small>${esc(o.symbol)} · ${esc(curName(o.currency))}</small></td><td>${o.side==='BUY'?'매수':'매도'}<small>${esc(statuses[o.status]||'기타 상태: '+o.status)}${hasFill&&o.status!=='FILLED'?' · 체결 수량 있음':''}</small></td><td>${o.quantity===0&&o.orderAmount>0?'금액 지정 '+money(o.orderAmount,o.currency):qty(o.quantity)+'주'}<small>${o.limitPrice===null?'가격 지정 안 함':money(o.limitPrice,o.currency)} · ${esc(({LIMIT:'지정가',MARKET:'시장가'})[o.orderType]||o.orderType)} / ${esc(tifs[o.timeInForce]||o.timeInForce)}</small></td><td>${qty(e.filledQuantity)}주<small>${e.averageFilledPrice===null?'평균 체결가 정보 없음':money(e.averageFilledPrice,o.currency)}</small></td><td>${hasFill?money(e.filledAmount,o.currency):'—'}</td><td><details><summary>자세히</summary><p>수수료 ${money(e.commission,o.currency)}<br>세금 ${money(e.tax,o.currency)}<br>최종 체결 ${esc(e.filledAt?time(e.filledAt):'정보 없음')}<br>결제 예정일 ${esc(e.settlementDate||'정보 없음')}</p></details></td></tr>`;
 }).join('')||`<tr><td colspan="7">이 조건의 주문이 없습니다. ${tip('이것만으로 과거 거래가 없었다고 볼 수는 없습니다.')}</td></tr>`}</tbody></table></div><div class="ov-actions orders-pages"><button id="orders-prev" class="secondary" ${pageIndex===0?'disabled':''}>이전</button><span>${rows.length?pageIndex*size+1:0} ~ ${Math.min((pageIndex+1)*size,rows.length)} / 표시 ${rows.length}건</span><button id="orders-next" class="secondary" ${pageIndex>=max?'disabled':''}>다음</button></div>`;
 $('#orders-prev').onclick=()=>{pageIndex--;render();};$('#orders-next').onclick=()=>{pageIndex++;render();};
}
async function load(){
 if(pending)return;
 if(!sessionStorage.getItem('teamQuantSession'))return;
 invalidate();pending=true;controller=new AbortController();const run=epoch,profile=sessionStorage.getItem('teamQuantSession');
 $('#orders-load').disabled=true;shortcut.disabled=true;$('#orders-status').textContent='토스증권 주문 내역 조회 중…';
 try{
  const data=await privateRead('order-history',{from:$('#orders-from').value,to:$('#orders-to').value,status:$('#orders-group').value,symbol:$('#orders-symbol').value},{signal:controller.signal});
  if(run!==epoch||profile!==sessionStorage.getItem('teamQuantSession'))return;
  if(!Array.isArray(data.orders)||!Array.isArray(data.totals)||!data.query)throw new Error('주문 내역을 읽지 못했습니다. PC 프로그램을 새 버전으로 바꿔 주세요.');
  report=data;for(const o of data.orders)if(!names.has(o.symbol)||names.get(o.symbol)===o.symbol)names.set(o.symbol,o.name||stockName(o.symbol));syncNames();render();$('#orders-export').disabled=false;
  $('#orders-status').textContent=data.paginationComplete?'조회 완료':'일부만 불러왔습니다. 기간을 줄여 다시 조회해 주세요.';
 }catch(error){if(run===epoch)$('#orders-status').textContent=error.name==='AbortError'?'조회를 중단했습니다.':error.message;}
 finally{if(run===epoch){pending=false;$('#orders-load').disabled=false;shortcut.disabled=false;}}
}
$('#orders-form').onsubmit=e=>{e.preventDefault();void load();};
$('#orders-form').onchange=()=>{if(report||pending){invalidate();$('#orders-status').textContent='조회 조건이 바뀌었습니다. 다시 조회해 주세요.';}};
// 상자가 포트폴리오의 '자세히' 접힘 안에 있으면 그것부터 연다(안 열면 눌러도 아무 일 없어 보임).
shortcut.onclick=()=>{const fold=box.parentElement?.closest('details');if(fold)fold.open=true;box.open=true;box.scrollIntoView({behavior:'smooth',block:'start'});if(!report)void load();};
$('#orders-filled').onchange=()=>{pageIndex=0;render();};
$('#orders-export').onclick=()=>{
 if(!report)return;
 const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TeamQuant-orders-${report.query.from}-${report.query.to}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.addEventListener('teamquant:asset-snapshot',e=>{for(const p of e.detail.positions)names.set(p.symbol,p.name);syncNames();if(report)render();});
window.addEventListener('teamquant:asset-clear',()=>{invalidate();names.clear();syncNames();$('#orders-status').textContent='화면에서 지웠습니다. 증권사의 실제 주문은 그대로입니다.';});
window.addEventListener('teamquant:state',()=>{const next=sessionStorage.getItem('teamQuantSession');if(next!==owner){invalidate();names.clear();syncNames();owner=next;$('#orders-status').textContent='프로필이 바뀌었습니다. 주문 내역을 다시 조회해 주세요.';}});
