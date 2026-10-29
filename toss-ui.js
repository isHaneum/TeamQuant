import {privateRead,installBridgeUi} from '/bridge-client.js';
import '/overview-ui.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const native=(v,c)=>new Intl.NumberFormat('ko-KR',{style:'currency',currency:c,maximumFractionDigits:c==='KRW'?0:2}).format(v);
const button=document.createElement('button');button.className='nav-button';button.dataset.view='toss';button.textContent='내 실제 자산';$('.overview-nav nav').insertBefore(button,$('[data-view="assets"]'));
const panel=document.createElement('section');panel.className='view';panel.dataset.page='toss';panel.id='toss';panel.innerHTML=`<div class="page-head"><div><h1>내 자산과 다음 선택</h1><p>본인 PC에서 직접 조회 · 주문 없음 · 조회 결과는 화면에만 보관</p></div><div class="ov-actions"><button id="toss-refresh" class="primary">내 보유 주식 조회</button><button id="toss-clear" class="secondary">화면에서 지우기</button></div></div><p id="toss-status" class="notice" role="status">로컬 서버의 토스 키 파일로 연결해요. 기존 한국투자 계좌와 별도예요.</p><div id="toss-result"></div>`;document.querySelector('main').append(panel);
const shortcut=document.createElement('button');shortcut.className='secondary';shortcut.textContent='토스 자산 연결';shortcut.onclick=()=>button.click();$('#overview .page-head .ov-actions').prepend(shortcut);
let generation=0,controller=null;
$('#toss-refresh').onclick=async()=>{
  controller?.abort();controller=new AbortController();const run=++generation,owner=sessionStorage.getItem('teamQuantSession');$('#toss-refresh').disabled=true;$('#toss-result').replaceChildren();$('#toss-status').textContent='토스증권에서 보유 주식 확인 중…';
  try{const d=await privateRead('holdings');if(run!==generation||owner!==sessionStorage.getItem('teamQuantSession'))return;
    window.dispatchEvent(new CustomEvent('teamquant:asset-snapshot',{detail:d}));
    $('#toss-status').textContent=`${d.source} · 조회 ${new Date(d.fetchedAt).toLocaleString('ko-KR')} · 첫 번째 종합매매 계좌 · 현금 제외`;
    $('#toss-result').innerHTML=`<article class="panel"><h2>보유 주식 평가액</h2><div class="ov-kpis">${d.totals.map(t=>`<article><span>${t.currency==='KRW'?'국내 주식':'미국 주식'}</span><strong>${native(t.value,t.currency)}</strong><small>평가손익 ${native(t.pnl,t.currency)}</small></article>`).join('')}<article><span>현재 환율로 원화 환산</span><strong>${d.holdingValueKrw===null?'환율 확인 불가':native(d.holdingValueKrw,'KRW')}</strong><small>${d.fx?'1 USD = '+d.fx.midRate.toLocaleString('ko-KR')+'원 · '+esc(d.fx.asOf):'현금 포함 총자산이 아니에요.'}</small></article></div><p class="muted">${esc(d.notice)}</p></article><article class="panel"><h2>보유 종목</h2><div class="table-wrap"><table><thead><tr><th>종목</th><th>수량</th><th>평균 매입가</th><th>현재가</th><th>평가액</th><th>평가손익 · 비용 전</th><th>일간 손익</th></tr></thead><tbody>${d.positions.map(p=>`<tr><td>${esc(p.name)}<br><small>${esc(p.symbol)} · ${esc(p.currency)}</small></td><td>${p.quantity.toLocaleString('ko-KR',{maximumFractionDigits:8})}</td><td>${native(p.avgCost,p.currency)}</td><td>${native(p.price,p.currency)}</td><td>${native(p.value,p.currency)}</td><td>${native(p.pnl,p.currency)}<br>${p.returnPct.toFixed(2)}%</td><td>${p.dailyPnl===null?'미제공':native(p.dailyPnl,p.currency)}</td></tr>`).join('')||'<tr><td colspan="7">보유 주식이 없습니다.</td></tr>'}</tbody></table></div><p class="muted">통화별 금액을 구분해요. 현재 환율로 환산한 금액은 원화 기준 취득원가·환차손익을 재현하지 않아요. 현금 자료가 없어 현금 비중과 전체 자산 원칙 점검에는 자동 반영하지 않아요.</p></article>`;
  }catch(e){if(run===generation)$('#toss-status').textContent=e.name==='AbortError'?'조회 취소됨':e.message;}finally{if(run===generation)$('#toss-refresh').disabled=false;}
};
$('#toss-clear').onclick=()=>{window.dispatchEvent(new Event('teamquant:asset-clear'));generation++;controller?.abort();$('#toss-refresh').disabled=false;$('#toss-result').replaceChildren();$('#toss-status').textContent='화면의 조회 정보를 지웠어요.';};

window.addEventListener('teamquant:page',()=>{const active=document.querySelector('.view.active')?.dataset.page==='toss';document.querySelector('.mode').textContent=active?'실제 자산 조회 · 주문 없음':'모의투자 · 실제 주문 없음';});

installBridgeUi(panel,()=>$('#toss-refresh').onclick());
