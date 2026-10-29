import {stockName,stockNames,resolveStockInput} from '/lib/instruments.js';
import {compareThreeMonths} from '/lib/comparison.js';
const $=s=>document.querySelector(s);
const state=()=>{try{return JSON.parse(localStorage.getItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'))||'{}');}catch{return {};}};
const pct=v=>(v>0?'+':'')+v.toFixed(2)+'%';
const navigate=name=>document.querySelector(`[data-view="${name}"]`).click();
function guide(){
  const s=state();
  if(result && result.strategyId!==s.approved?.definition.id){result=null;$('#comparison-result').hidden=true;}
  if(!result && s.comparison?.perStock && s.comparison.strategyId===s.approved?.definition.id){result=s.comparison;renderComparison();}
  const next=!s.approved?'strategy':!s.comparison||!s.activeStrategy?'comparison':'assets';
  $('#next-title').textContent=!s.approved?'내 투자 기준부터 정해볼까요?':!s.comparison?'내 전략, 최근 3개월에는 어땠을까요?':'검증한 전략을 모의 자산으로 확인하세요';
  $('#next-description').textContent=!s.approved?'사고파는 조건을 문장으로 적고, 변환된 규칙을 확인하세요.':!s.comparison?'같은 전략을 여러 종목에 적용하고 코스피와 나란히 비교해 보세요.':'과거 결과가 앞으로의 수익을 보장하지는 않아요. 모의투자에서 판단을 확인하세요.';
  $('#next-action').textContent=!s.approved?'내 투자 기준 만들기':!s.comparison?'3개월 검증하기':'모의 자산 보기';
  $('#next-action').onclick=()=>navigate(next);
  $('#comparison-strategy').textContent=s.approved?`${s.approved.definition.name} · ${s.approved.definition.entryRule}`:'아직 투자 기준이 없어요. 먼저 전략을 설정하고 확인해 주세요.';
}
window.addEventListener('teamquant:state',guide);
$('#comparison-nav').addEventListener('click',guide);
$('#comparison-edit').onclick=()=>navigate('strategy');
$('#home-compare').onclick=()=>navigate('comparison');
$('#compare-paper').onclick=()=>{if(result)window.dispatchEvent(new CustomEvent('teamquant:comparison-paper',{detail:result}));};

const symbolInput=$('#symbol');
function suggestions(){
  const q=symbolInput.value.trim().toLowerCase();$('#symbols').replaceChildren();
  Object.entries(stockNames).filter(([code,name])=>name.toLowerCase().includes(q)||code.startsWith(q)).slice(0,15).forEach(([code,name])=>{
    const option=document.createElement('option');option.value=name;option.label=name+' · '+code;$('#symbols').append(option);
  });
}
symbolInput.addEventListener('input',suggestions);suggestions();
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

let result;
function invalidateComparison(){result=null;$('#comparison-result').hidden=true;$('#compare-status').textContent='설정이 바뀌었어요. 다시 검증해 주세요.';const s=state();delete s.comparison;localStorage.setItem('teamQuant:user:'+sessionStorage.getItem('teamQuantSession'),JSON.stringify(s));}
$('#comparison-stocks').addEventListener('change',invalidateComparison);
$('#compare-capital').addEventListener('change',invalidateComparison);
$('#compare-cost').addEventListener('change',invalidateComparison);
async function market(symbol){
  const response=await fetch('/api/market?'+new URLSearchParams({symbol,range:'1y'})),data=await response.json();
  if(!response.ok)throw new Error(stockName(symbol)+': '+(data.error||'데이터 조회 실패'));
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}),hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  if(hour<16)data.candles=data.candles.filter(c=>c.date!==today);
  return data;
}
function chart(data){
  const series=[data.base,data.filtered,data.benchmark],w=900,h=240,p=24;
  const values=series.flatMap(s=>s.equity.map(e=>e.value/data.initialCapital*100)),lo=Math.min(99,...values),hi=Math.max(101,...values),range=hi-lo;
  const paths=series.map((s,k)=>`<polyline fill="none" stroke="${['#111','#777','#aaa'][k]}" stroke-width="${k===0?3:2}" ${k===1?'stroke-dasharray="7 5"':k===2?'stroke-dasharray="2 5"':''} points="${s.equity.map((e,i)=>`${p+i/(s.equity.length-1)*(w-p*2)},${p+(hi-e.value/data.initialCapital*100)/range*(h-p*2)}`).join(' ')}"/>`).join('');
  $('#comparison-chart').innerHTML=`<svg role="img" aria-label="초기자산 100 기준 전략과 코스피 추이" viewBox="0 0 ${w} ${h}"><text x="24" y="16" font-size="11">${hi.toFixed(1)}</text>${paths}<text x="24" y="238" font-size="11">${lo.toFixed(1)}</text></svg>`;
}
function renderComparison(){
    $('#compare-capital').value=result.initialCapital;$('#compare-cost').value=result.costPct;
    const selected=new Set(result.perStock.map(x=>x.symbol));
    document.querySelectorAll('[data-compare-symbol]').forEach(n=>n.checked=selected.has(n.dataset.compareSymbol));
    $('#comparison-result').hidden=false;
    $('#comparison-period').textContent=`${result.start} ~ ${result.end} · ${result.perStock.map(x=>stockName(x.symbol)).join(', ')} · 각 종목에 같은 금액 배분`;
    $('#comparison-rows').replaceChildren();
    for(const [label,value] of [['내 전략',result.base],['시장 조건 추가',result.filtered],['코스피 비교',result.benchmark]]){
      const tr=document.createElement('tr');for(const text of [label,pct(value.returnPct),'-'+value.maxDrawdown.toFixed(2)+'%',pct(value.returnPct-result.benchmark.returnPct),value.trades===undefined?'—':value.trades+'회']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-rows').append(tr);
    }
    const delta=result.filtered.returnPct-result.base.returnPct;
    $('#comparison-verdict').textContent=`시장 조건을 추가한 수익률은 기존 전략보다 ${Math.abs(delta).toFixed(2)}%p ${delta>=0?'높았어요':'낮았어요'}. 최대 낙폭은 ${result.base.maxDrawdown.toFixed(2)}%에서 ${result.filtered.maxDrawdown.toFixed(2)}%로 변했어요.`;
    $('#comparison-assumptions').textContent=result.note;chart(result);
    $('#comparison-decisions').replaceChildren();
    for(const stock of result.perStock)for(const d of stock.market.decisions.filter(d=>d.decision!=='관망'||d.reason.includes('시장 조건')).slice(-8)){
      const tr=document.createElement('tr');for(const text of [d.date,stockName(stock.symbol),d.decision,d.reason,d.scheduledExecution||'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('#comparison-decisions').append(tr);
    }

}
$('#run-comparison').onclick=async()=>{
  const s=state(),status=$('#compare-status'),button=$('#run-comparison');
  if(!s.approved){status.textContent='투자 기준을 먼저 설정하고 승인하세요.';navigate('strategy');return;}
  const symbols=[...document.querySelectorAll('[data-compare-symbol]:checked')].map(n=>n.dataset.compareSymbol);
  if(!symbols.length||symbols.length>6){status.textContent='비교할 종목을 1~6개 선택하세요.';return;}
  button.disabled=true;$('#comparison-result').hidden=true;status.textContent='실제 일봉과 시장 데이터를 불러오는 중이에요.';
  try{
    const data=await Promise.all([...symbols,'^KS11'].map(market));
    result=compareThreeMonths(data.slice(0,-1),data.at(-1),s.approved.config,Number($('#compare-capital').value),Number($('#compare-cost').value));
    result.strategyId=s.approved.definition.id;result.sources=data.map(x=>({symbol:x.symbol,fetchedAt:x.fetchedAt,source:x.source}));result.createdAt=new Date().toISOString();
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
