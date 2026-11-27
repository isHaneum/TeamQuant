import {performanceChart,wireCharts,effectSummary} from '/lib/performance-view.js';
import {parseFundCsv} from '/lib/product-catalog.js';
import {stockName,stockNames,resolveStockInput} from '/lib/instruments.js';
import {compareThreeMonths} from '/lib/comparison.js';
import {tip} from '/tooltip-ui.js';
const $=s=>document.querySelector(s);
const state=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'))||'{}');}catch{return {};}};
const pct=v=>(v>0?'+':'')+v.toFixed(2)+'%';
const navigate=name=>document.querySelector(`[data-view="${name}"]`).click();
function guide(){
  const s=state();if(!s.comparison&&$('#comparison-settings'))$('#comparison-settings').open=true;
  if(result && result.strategyId!==s.approved?.definition.id){result=null;$('#comparison-result').hidden=true;}
  if(!result && s.comparison?.perStock && s.comparison.strategyId===s.approved?.definition.id){result=s.comparison;renderComparison();}
  $('#comparison-strategy').textContent=s.approved?`${s.approved.definition.name} · ${s.approved.definition.entryRule}`:'매매 규칙 없음';
}
window.addEventListener('teamquant:state',guide);
$('#comparison-nav').addEventListener('click',guide);
$('#comparison-edit').onclick=()=>navigate('strategy');
const paperChoice=document.createElement('label');paperChoice.textContent='가상 투자할 종목';const paperSelect=document.createElement('select');paperSelect.id='comparison-paper-symbol';paperChoice.append(paperSelect);$('#compare-paper').before(paperChoice);
$('#compare-paper').onclick=()=>{if(result&&!result.researchOnly)window.dispatchEvent(new CustomEvent('teamquant:comparison-paper',{detail:{...result,paperSymbol:$('#comparison-paper-symbol').value}}));};

const fundSeries=new Map();
const productName=symbol=>fundSeries.get(symbol)?.name||result?.products?.find(p=>p.symbol===symbol)?.name||stockName(symbol);
const addProduct=(symbol,name)=>{let item=[...document.querySelectorAll('[data-compare-symbol]')].find(x=>x.dataset.compareSymbol===symbol);if(item){item.checked=true;return;}const label=document.createElement('label');item=document.createElement('input');item.type='checkbox';item.checked=true;item.dataset.compareSymbol=symbol;label.append(item,document.createTextNode(name));$('#comparison-stocks').append(label);};
const extra=document.createElement('div');extra.className='product-picker';extra.innerHTML=`<label>종목 찾기<input id="comparison-product" list="symbols" placeholder="주식·ETF 이름 또는 6자리 코드"></label><button id="comparison-add" class="secondary" type="button">종목 추가</button><p class="muted">지원 ETF: KODEX 200 · TIGER 미국S&P500</p><label>비교 지수<select id="compare-benchmark"><option value="^KS11">코스피 · 원화 종목</option><option value="SPY">S&P500(SPY) · 달러 종목</option></select></label>`;
$('#comparison-stocks').after(extra);
// 펀드 기준가 CSV는 초보에게 필요 없는 기능이라 '추가 도구' 접힘(flow-ui .stock-finder) 맨 아래로 옮긴다.
const fundBox=document.createElement('details');fundBox.innerHTML=`<summary>펀드 기준가 CSV로 참고용 테스트</summary><p>date,nav 두 열 CSV(90행 이상, 최근 1년 권장) ${tip('파일은 서버로 보내지 않습니다. 펀드 매매·환매 기간은 따라 하지 않습니다.')}</p><label>펀드 이름<input id="fund-name" maxlength="60" value="기준가 펀드"></label><label>통화<select id="fund-currency"><option value="KRW">원화</option><option value="USD">달러</option></select></label><input type="file" id="fund-file" accept=".csv,text/csv" aria-label="펀드 기준가 CSV"><p id="fund-status" role="status"></p>`;
($('.stock-finder')||extra).append(fundBox);
// 투자금 칸의 단위 라벨은 investor-ui.js 한 곳에서만 바꾼다(여기서 덮어쓰지 않음).
$('#compare-benchmark').onchange=()=>{invalidateComparison();};
$('#comparison-add').onclick=async()=>{try{const v=$('#comparison-product').value,symbol=await resolveStockInput(v);addProduct(symbol,stockName(symbol));invalidateComparison();$('#compare-status').textContent=stockName(symbol)+' 추가 완료';}catch(e){$('#compare-status').textContent=e.message;}};
$('#fund-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>2_000_000)throw new Error('2MB 이하 파일만 올릴 수 있습니다.');const data=parseFundCsv(await f.text(),$('#fund-name').value,$('#fund-currency').value);data.symbol='FUND-'+crypto.randomUUID().slice(0,8);fundSeries.set(data.symbol,data);addProduct(data.symbol,data.name+' · 기준가');invalidateComparison();$('#fund-status').textContent=`${data.candles.length}행 확인 · ${data.candles[0].date} ~ ${data.candles.at(-1).date} · 참고용`; }catch(e){$('#fund-status').textContent=e.message;}e.target.value='';};
const symbolInput=$('#symbol');
function suggestions(event){
  const q=(event?.target||symbolInput).value.trim().toLowerCase();$('#symbols').replaceChildren();
  Object.entries(stockNames).filter(([code,name])=>name.toLowerCase().includes(q)||code.startsWith(q)).slice(0,15).forEach(([code,name])=>{
    const option=document.createElement('option');option.value=name;option.label=name+' · '+code;$('#symbols').append(option);
  });
}
symbolInput.addEventListener('input',suggestions);$('#comparison-product').addEventListener('input',suggestions);suggestions();
// '추가 도구' 안의 두 번째 추가 버튼은 '종목 추가'와 같은 동작으로 합친다. 버튼(index.html)이 지워져도 멈추지 않게 있을 때만 묶는다.
const addFromFinder=$('#add-comparison-stock');
if(addFromFinder)addFromFinder.onclick=async()=>{
  try{const symbol=await resolveStockInput(symbolInput.value);addProduct(symbol,stockName(symbol));invalidateComparison();navigate('comparison');$('#compare-status').textContent=stockName(symbol)+' 추가 완료';}
  catch(e){$('#compare-status').textContent=e.message;}
};

let result,requestGeneration=0;
function invalidateComparison(){requestGeneration++;result=null;$('#comparison-result').hidden=true;$('#compare-status').textContent='설정이 바뀌었습니다. 다시 확인해 주세요.';const s=state();delete s.comparison;localStorage.setItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'),JSON.stringify(s));}
$('#comparison-stocks').addEventListener('change',invalidateComparison);
$('#compare-capital').addEventListener('change',invalidateComparison);
$('#compare-cost').addEventListener('change',invalidateComparison);
async function market(symbol){
  const response=await fetch('/api/market?'+new URLSearchParams({symbol,range:'1y'})),data=await response.json();
  if(!response.ok)throw new Error(stockName(symbol)+': '+(data.error||'시세 조회 실패'));
  const zone=data.currency==='USD'?'America/New_York':'Asia/Seoul',today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date()),hour=Number(new Intl.DateTimeFormat('en',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date()));
  if(hour<(data.currency==='USD'?17:16))data.candles=data.candles.filter(c=>c.date!==today);
  return data;
}
const indexName=label=>label==='SPY'?'S&P500(SPY)':label||'코스피';
function chart(data){
 const values=[data.base,data.filtered,...(data.buyHold?[data.buyHold]:[]),data.benchmark];
 const labels=['매매 규칙만','매매 규칙 + 지수 60일선',...(data.buyHold?['그냥 보유']:[]),indexName(data.benchmarkLabel)];
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
    $('#comparison-result').hidden=false;$('#compare-paper').disabled=!!result.researchOnly;$('#compare-paper').textContent=result.researchOnly?'펀드 기준가 테스트 · 가상 투자 등록 불가':'가상 투자 시작';
    $('#comparison-period').textContent=`${result.start} ~ ${result.end} · ${result.perStock.map(x=>productName(x.symbol)).join(', ')} · 종목마다 같은 금액`;
    $('#comparison-rows').replaceChildren();
    for(const [label,value] of [['매매 규칙만',result.base],['매매 규칙 + 지수 60일선',result.filtered],...(result.buyHold?[['그냥 보유',result.buyHold]]:[]),[indexName(result.benchmarkLabel),result.benchmark]]){
      const diff=value.returnPct-result.benchmark.returnPct;
      const tr=document.createElement('tr');for(const text of [label,pct(value.returnPct),'-'+value.maxDrawdown.toFixed(2)+'%',(diff>0?'+':'')+diff.toFixed(2)+'%p',value.trades===undefined?'—':value.trades+'번']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-rows').append(tr);
    }
    const delta=result.filtered.returnPct-result.base.returnPct;
    $('#comparison-verdict').textContent=`지수 60일선 조건: 수익률 ${delta>=0?'+':'−'}${Math.abs(delta).toFixed(2)}%p · 최대 하락폭 ${result.base.maxDrawdown.toFixed(2)}% → ${result.filtered.maxDrawdown.toFixed(2)}%`;
    $('#comparison-assumptions').textContent=result.note;chart(result);
    $('#comparison-decisions').replaceChildren();
    for(const stock of result.perStock)for(const d of stock.market.decisions.filter(d=>!['관망','유지','현금 대기'].includes(d.decision)||d.reason.startsWith('지수 60일선')).slice(-8)){
      const tr=document.createElement('tr');for(const text of [d.date,productName(stock.symbol),d.decision,d.reason,d.scheduledExecution||'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-decisions').append(tr);
    }

}
$('#run-comparison').onclick=async()=>{
  const s=state(),status=$('#compare-status'),button=$('#run-comparison');
  if(!s.approved){status.textContent='매매 규칙을 먼저 정하고 확정해 주세요.';navigate('strategy');return;}
  const symbols=[...document.querySelectorAll('[data-compare-symbol]:checked')].map(n=>n.dataset.compareSymbol);
  if(!symbols.length||symbols.length>6){status.textContent='비교할 종목을 1~6개 골라 주세요.';return;}
  const request=++requestGeneration,owner=sessionStorage.getItem('teamQuantSession');button.disabled=true;$('#comparison-result').hidden=true;status.textContent='시세 불러오는 중…';
  try{
    const data=await Promise.all([...symbols,$('#compare-benchmark').value].map(symbol=>fundSeries.has(symbol)?fundSeries.get(symbol):market(symbol)));
    if(new Set(data.map(x=>x.currency)).size>1)throw new Error('원화 종목은 코스피, 달러 종목은 S&P500(SPY)과 비교해 주세요. 원화·달러 종목을 섞어서는 비교할 수 없습니다.');
    if(request!==requestGeneration||owner!==sessionStorage.getItem('teamQuantSession')||state().approved?.definition.id!==s.approved.definition.id)throw new Error('매매 규칙·설정·프로필이 바뀌었습니다. 다시 확인해 주세요.');
    result=compareThreeMonths(data.slice(0,-1),data.at(-1),s.approved.config,Number($('#compare-capital').value),Number($('#compare-cost').value));
    result.strategyId=s.approved.definition.id;result.sources=data.map(x=>({symbol:x.symbol,fetchedAt:x.fetchedAt,source:x.source}));result.createdAt=new Date().toISOString();result.products=data.slice(0,-1).map(x=>({symbol:x.symbol,name:productName(x.symbol),type:x.instrumentType}));result.researchOnly=data.some(x=>x.instrumentType==='MUTUALFUND');result.dataset=data;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.map(x=>({symbol:x.symbol,candles:x.candles})))));result.datasetHash=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');if(result.researchOnly)result.note+=' · 펀드: 다음 기준가에 샀다고 보고 계산한 참고용 결과(신청·환매 지연·기준가 확정 시각·분배금·보수 빠짐) · 가상 투자 등록 불가';
    if(request!==requestGeneration||owner!==sessionStorage.getItem('teamQuantSession')||state().approved?.definition.id!==s.approved.definition.id)throw new Error('설정이 바뀌었습니다. 다시 확인해 주세요.');
    renderComparison();
    s.comparison=result;localStorage.setItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'),JSON.stringify(s));
    $('#comparison-result').hidden=false;status.textContent='테스트 완료';guide();window.dispatchEvent(new Event('teamquant:comparison-complete'));window.dispatchEvent(new Event('teamquant:state'));
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
$('#download-comparison').onclick=()=>{
  if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='TeamQuant-3month-comparison.json';a.click();URL.revokeObjectURL(url);
};
// 실행 버튼 이름은 index.html('최근 3개월로 테스트' · 용어표 #70)을 그대로 쓰고, 자주 안 쓰는 파일 저장은 ⋯ 메뉴로 접는다. 둘 다 id로 묶여 있어 동작은 그대로다.
{const dl=$('#download-comparison'),more=document.createElement('details');more.className='more-menu';more.innerHTML='<summary aria-label="더 보기" title="더 보기">⋯</summary><div></div>';dl.replaceWith(more);more.querySelector('div').append(dl);dl.textContent='파일로 저장';}
// 예전 '내 계좌 연결' 창(#account-dialog)은 account-ui.js가 내용을 바꾸고 다시 묶으므로 여기서는 묶지 않는다.
guide();
