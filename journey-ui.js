import {performanceChart,wireCharts,effectSummary} from '/lib/performance-view.js';
import {parseFundCsv} from '/lib/product-catalog.js';
import {stockName,stockNames,resolveStockInput} from '/lib/instruments.js';
import {compareThreeMonths} from '/lib/comparison.js';
const $=s=>document.querySelector(s);
const state=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'))||'{}');}catch{return {};}};
const pct=v=>(v>0?'+':'')+v.toFixed(2)+'%';
const navigate=name=>document.querySelector(`[data-view="${name}"]`).click();
function guide(){
  const s=state();if(!s.comparison&&$('#comparison-settings'))$('#comparison-settings').open=true;
  if(result && result.strategyId!==s.approved?.definition.id){result=null;$('#comparison-result').hidden=true;}
  if(!result && s.comparison?.perStock && s.comparison.strategyId===s.approved?.definition.id){result=s.comparison;renderComparison();}
  const next=!s.approved?'strategy':!s.comparison||!s.activeStrategy?'comparison':'assets';
  $('#next-title').textContent=!s.approved?'투자 원칙 설정':!s.comparison?'최근 3개월 전략 성과 검증':'검증한 전략을 모의 자산으로 확인하세요';
  $('#next-description').textContent=!s.approved?'사고파는 조건을 문장으로 적고, 변환된 규칙을 확인하세요.':!s.comparison?'같은 투자 대상에 원칙만 적용한 결과와 시장 조건을 추가한 결과를 확인하십시오.':'과거 결과가 앞으로의 수익을 보장하지는 않아요. 모의투자에서 판단을 확인하세요.';
  $('#next-action').textContent=!s.approved?'내 투자 기준 만들기':!s.comparison?'3개월 검증하기':'모의 자산 보기';
  $('#next-action').onclick=()=>navigate(next);
  $('#comparison-strategy').textContent=s.approved?`${s.approved.definition.name} · ${s.approved.definition.entryRule}`:'아직 투자 기준이 없습니다. 먼저 전략을 설정하고 확인하십시오.';
}
window.addEventListener('teamquant:state',guide);
$('#comparison-nav').addEventListener('click',guide);
$('#comparison-edit').onclick=()=>navigate('strategy');
$('#home-compare').onclick=()=>navigate('comparison');
const paperChoice=document.createElement('label');paperChoice.textContent='모의 운용에 등록할 상품';const paperSelect=document.createElement('select');paperSelect.id='comparison-paper-symbol';paperChoice.append(paperSelect);$('#compare-paper').before(paperChoice);
$('#compare-paper').onclick=()=>{if(result&&!result.researchOnly)window.dispatchEvent(new CustomEvent('teamquant:comparison-paper',{detail:{...result,paperSymbol:$('#comparison-paper-symbol').value}}));};

const fundSeries=new Map();
const productName=symbol=>fundSeries.get(symbol)?.name||result?.products?.find(p=>p.symbol===symbol)?.name||stockName(symbol);
const addProduct=(symbol,name)=>{let item=[...document.querySelectorAll('[data-compare-symbol]')].find(x=>x.dataset.compareSymbol===symbol);if(item){item.checked=true;return;}const label=document.createElement('label');item=document.createElement('input');item.type='checkbox';item.checked=true;item.dataset.compareSymbol=symbol;label.append(item,document.createTextNode(name));$('#comparison-stocks').append(label);};
const extra=document.createElement('div');extra.className='product-picker';extra.innerHTML=`<label>상품 추가<input id="comparison-product" list="symbols" placeholder="주식·ETF 이름 또는 6자리 코드"></label><button id="comparison-add" class="secondary" type="button">투자 대상에 추가</button><p class="muted">지원 ETF: KODEX 200, TIGER 미국S&P500. ETF는 펀드 중 거래소 상장 상품입니다.</p><details><summary>일반 펀드 · 기준가 CSV로 연구용 검증</summary><p>실제 상품의 일별 기준가를 date,nav 두 열로 입력하십시오. 최근 1년 권장, 90행 이상 필요. 파일은 서버로 전송하지 않습니다. 매매 체결·환매 기간을 재현하지 않습니다.</p><label>펀드 이름<input id="fund-name" maxlength="60" value="기준가 펀드"></label><label>통화<select id="fund-currency"><option>KRW</option><option>USD</option></select></label><input type="file" id="fund-file" accept=".csv,text/csv" aria-label="펀드 기준가 CSV"><p id="fund-status" role="status"></p></details><label>기준 시장<select id="compare-benchmark"><option value="^KS11">코스피 · 원화 상품</option><option value="SPY">SPY · 달러 상품</option></select></label>`;
$('#comparison-stocks').after(extra);
$('#compare-benchmark').onchange=invalidateComparison;
$('#comparison-add').onclick=async()=>{try{const v=$('#comparison-product').value,symbol=await resolveStockInput(v);addProduct(symbol,stockName(symbol));invalidateComparison();$('#compare-status').textContent=stockName(symbol)+' 추가 완료';}catch(e){$('#compare-status').textContent=e.message;}};
$('#fund-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2_000_000)throw new Error('2MB 이하 파일만 지원합니다.');const data=parseFundCsv(await f.text(),$('#fund-name').value,$('#fund-currency').value);data.symbol='FUND-'+crypto.randomUUID().slice(0,8);fundSeries.set(data.symbol,data);addProduct(data.symbol,data.name+' · 기준가');invalidateComparison();$('#fund-status').textContent=`${data.candles.length}행 확인 · ${data.candles[0].date} ~ ${data.candles.at(-1).date} · 연구용`; }catch(e){$('#fund-status').textContent=e.message;}e.target.value='';};
const symbolInput=$('#symbol');
function suggestions(event){
  const q=(event?.target||symbolInput).value.trim().toLowerCase();$('#symbols').replaceChildren();
  Object.entries(stockNames).filter(([code,name])=>name.toLowerCase().includes(q)||code.startsWith(q)).slice(0,15).forEach(([code,name])=>{
    const option=document.createElement('option');option.value=name;option.label=name+' · '+code;$('#symbols').append(option);
  });
}
symbolInput.addEventListener('input',suggestions);$('#comparison-product').addEventListener('input',suggestions);suggestions();
$('#add-comparison-stock').onclick=async()=>{
  const status=$('#compare-status');
  try{
    const symbol=await resolveStockInput(symbolInput.value);
    if(document.querySelector(`[data-compare-symbol="${symbol}"]`))return;
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.compareSymbol=symbol;
    label.append(input,document.createTextNode(stockName(symbol)));$('#comparison-stocks').append(label);invalidateComparison();
    navigate('comparison');status.textContent=stockName(symbol)+' 추가됨';
  }catch(e){status.textContent=e.message;}
};

let result,requestGeneration=0;
function invalidateComparison(){requestGeneration++;result=null;$('#comparison-result').hidden=true;$('#compare-status').textContent='설정이 변경되었습니다. 다시 검증해 주세요.';const s=state();delete s.comparison;localStorage.setItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'),JSON.stringify(s));}
$('#comparison-stocks').addEventListener('change',invalidateComparison);
$('#compare-capital').addEventListener('change',invalidateComparison);
$('#compare-cost').addEventListener('change',invalidateComparison);
async function market(symbol){
  const response=await fetch('/api/market?'+new URLSearchParams({symbol,range:'1y'})),data=await response.json();
  if(!response.ok)throw new Error(stockName(symbol)+': '+(data.error||'데이터 조회 실패'));
  const zone=data.currency==='USD'?'America/New_York':'Asia/Seoul',today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date()),hour=Number(new Intl.DateTimeFormat('en',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date()));
  if(hour<(data.currency==='USD'?17:16))data.candles=data.candles.filter(c=>c.date!==today);
  return data;
}
function chart(data){
 const values=[data.base,data.filtered,...(data.buyHold?[data.buyHold]:[]),data.benchmark];
 const labels=['원칙만 적용','원칙 + 시장 조건',...(data.buyHold?['같은 상품 그대로 보유']:[]),(data.benchmarkLabel||'코스피')+' 기준 시장'];
 $('#comparison-chart').innerHTML=effectSummary(data)+performanceChart(values.map(s=>s.equity.map(x=>({date:x.date,value:x.value/data.initialCapital*100}))),labels);
 wireCharts($('#comparison-chart'));
}
function renderComparison(){
    $('#compare-capital').value=result.initialCapital;$('#compare-cost').value=result.costPct;
    $('#compare-benchmark').value=result.benchmarkLabel==='SPY'?'SPY':'^KS11';
    for(const p of result.products||[])addProduct(p.symbol,p.name);
    $('#comparison-paper-symbol').replaceChildren();for(const x of result.perStock){const option=document.createElement('option');option.value=x.symbol;option.textContent=productName(x.symbol);$('#comparison-paper-symbol').append(option);}
    const selected=new Set(result.perStock.map(x=>x.symbol));
    document.querySelectorAll('[data-compare-symbol]').forEach(n=>n.checked=selected.has(n.dataset.compareSymbol));
    $('#comparison-result').hidden=false;$('#compare-paper').disabled=!!result.researchOnly;$('#compare-paper').textContent=result.researchOnly?'일반 펀드 기준가 검증 · 주문 등록 불가':'이 원칙으로 모의 운용 시작';
    $('#comparison-period').textContent=`${result.start} ~ ${result.end} · ${result.perStock.map(x=>productName(x.symbol)).join(', ')} · 동일 상품 묶음에 같은 금액 배분 · ${result.datasetHash?'자료 '+result.datasetHash.slice(0,12):''}`;
    $('#comparison-rows').replaceChildren();
    for(const [label,value] of [['원칙만 적용',result.base],['원칙 + 시장 조건',result.filtered],...(result.buyHold?[['같은 상품 그대로 보유',result.buyHold]]:[]),[(result.benchmarkLabel||'코스피')+' 기준 시장',result.benchmark]]){
      const tr=document.createElement('tr');for(const text of [label,pct(value.returnPct),'-'+value.maxDrawdown.toFixed(2)+'%',(value.returnPct-result.benchmark.returnPct).toFixed(2)+'%p',value.trades===undefined?'—':value.trades+'회']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-rows').append(tr);
    }
    const delta=result.filtered.returnPct-result.base.returnPct;
    $('#comparison-verdict').textContent=`시장 조건을 추가한 수익률은 기존 전략보다 ${Math.abs(delta).toFixed(2)}%p ${delta>=0?'높습니다':'낮습니다'}. 최대 낙폭은 ${result.base.maxDrawdown.toFixed(2)}%에서 ${result.filtered.maxDrawdown.toFixed(2)}%로 변했습니다.`;
    $('#comparison-assumptions').textContent=result.note;chart(result);
    $('#comparison-decisions').replaceChildren();
    for(const stock of result.perStock)for(const d of stock.market.decisions.filter(d=>d.decision!=='관망'||d.reason.includes('시장 조건')).slice(-8)){
      const tr=document.createElement('tr');for(const text of [d.date,productName(stock.symbol),d.decision,d.reason,d.scheduledExecution||'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-decisions').append(tr);
    }

}
$('#run-comparison').onclick=async()=>{
  const s=state(),status=$('#compare-status'),button=$('#run-comparison');
  if(!s.approved){status.textContent='투자 기준을 먼저 설정하고 승인하세요.';navigate('strategy');return;}
  const symbols=[...document.querySelectorAll('[data-compare-symbol]:checked')].map(n=>n.dataset.compareSymbol);
  if(!symbols.length||symbols.length>6){status.textContent='비교할 종목을 1~6개 선택하세요.';return;}
  const request=++requestGeneration,owner=sessionStorage.getItem('teamQuantSession');button.disabled=true;$('#comparison-result').hidden=true;status.textContent='실제 일봉과 시장 데이터를 불러오는 중입니다.';
  try{
    const data=await Promise.all([...symbols,$('#compare-benchmark').value].map(symbol=>fundSeries.has(symbol)?fundSeries.get(symbol):market(symbol)));
    if(new Set(data.map(x=>x.currency)).size>1)throw new Error('원화 상품은 코스피, 달러 상품은 SPY를 선택하십시오. 혼합 통화 비교는 지원하지 않습니다.');
    if(request!==requestGeneration||owner!==sessionStorage.getItem('teamQuantSession')||state().approved?.definition.id!==s.approved.definition.id)throw new Error('전략·설정·프로필이 변경되었습니다. 다시 검증하십시오.');
    result=compareThreeMonths(data.slice(0,-1),data.at(-1),s.approved.config,Number($('#compare-capital').value),Number($('#compare-cost').value));
    result.strategyId=s.approved.definition.id;result.sources=data.map(x=>({symbol:x.symbol,fetchedAt:x.fetchedAt,source:x.source}));result.createdAt=new Date().toISOString();result.products=data.slice(0,-1).map(x=>({symbol:x.symbol,name:productName(x.symbol),type:x.instrumentType}));result.researchOnly=data.some(x=>x.instrumentType==='MUTUALFUND');result.dataset=data;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.map(x=>({symbol:x.symbol,candles:x.candles})))));result.datasetHash=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');if(result.researchOnly)result.note+=' · 일반 펀드: 다음 관측 기준가를 가상 체결가로 사용한 연구용 계산. 신청/환매 지연·기준가 확정 시각·분배금·보수 별도 미반영. 모의주문 등록 불가.';
    if(request!==requestGeneration||owner!==sessionStorage.getItem('teamQuantSession')||state().approved?.definition.id!==s.approved.definition.id)throw new Error('설정이 변경되었습니다. 다시 검증하십시오.');
    renderComparison();
    s.comparison=result;localStorage.setItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'),JSON.stringify(s));
    $('#comparison-result').hidden=false;status.textContent='검증 완료';guide();window.dispatchEvent(new Event('teamquant:comparison-complete'));window.dispatchEvent(new Event('teamquant:state'));
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
$('#download-comparison').onclick=()=>{
  if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='TeamQuant-3month-comparison.json';a.click();URL.revokeObjectURL(url);
};
const dialog=$('#account-dialog');
document.querySelectorAll('[data-connect-account]').forEach(b=>b.onclick=()=>{dialog.showModal();$('#connect-state').textContent='조회 전용 연결을 준비합니다. 주문 권한은 요청하지 않습니다.';$('#connect-consent').checked=false;$('#connect-continue').disabled=true;});
$('#connect-close').onclick=()=>dialog.close();
$('#connect-consent').onchange=()=>$('#connect-continue').disabled=!$('#connect-consent').checked;
$('#connect-continue').onclick=async()=>{
  $('#connect-state').textContent='금융사 연결 가능 여부 확인 중';
  try{const r=await fetch('/api/account-connect'),data=await r.json();$('#connect-state').textContent=data.message;}catch{$('#connect-state').textContent='연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.';}
};
guide();
