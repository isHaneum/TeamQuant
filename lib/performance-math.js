const DAY=86400000;
const unavailable=reason=>({value:null,reason});
const sum=items=>{let total=0,c=0;for(const x of items){const y=x-c,t=total+y;c=(t-total)-y;total=t;}return total;};
export const signedFlow=f=>f.type==='DEPOSIT'?f.amount:-f.amount;
export function xirr(input,{timeZone='UTC'}={}){
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const byDay=new Map();for(const r of input){const time=Date.parse(r.at);if(!Number.isFinite(time)||!Number.isFinite(r.amount))return unavailable('현금흐름의 날짜·금액 오류');const p=Object.fromEntries(fmt.formatToParts(new Date(time)).map(x=>[x.type,x.value])),day=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day))/DAY;if(!Number.isFinite(day)||!Number.isFinite(r.amount))return unavailable('현금흐름의 날짜·금액 오류');byDay.set(day,(byDay.get(day)||0)+r.amount);}
 const rows=[...byDay].sort((a,b)=>a[0]-b[0]).filter(x=>x[1]!==0);if(rows.length<2||rows.at(-1)[0]===rows[0][0])return unavailable('하루 이상 구분되는 현금흐름 필요');
 let changes=0;for(let i=1;i<rows.length;i++)if(Math.sign(rows[i][1])!==Math.sign(rows[i-1][1]))changes++;
 if(changes!==1)return unavailable(changes===0?'양수·음수 현금흐름 필요':'복수 수익률 해 가능성: 현금흐름 부호를 수동 검토하십시오.');
 const initial=rows[0][0],scale=Math.max(...rows.map(x=>Math.abs(x[1]))),f=x=>{const terms=rows.map(([day,a])=>({a:a/scale,e:-x*(day-initial)/365})),offset=Math.max(...terms.map(t=>t.e)),weighted=terms.map(t=>t.a*Math.exp(t.e-offset));return sum(weighted)/sum(weighted.map(Math.abs));};
 let lo=-20,hi=20,fl=f(lo),fh=f(hi);if(!Number.isFinite(fl)||!Number.isFinite(fh)||fl*fh>0)return unavailable('탐색 범위에서 해를 찾지 못했습니다.');
 for(let i=0;i<180;i++){const mid=(lo+hi)/2,fm=f(mid);if(Math.abs(fm)<1e-12){const value=Math.expm1(mid)*100;return Number.isFinite(value)?{value,reason:null}:unavailable('연환산 결과 범위 초과');}if(fl*fm<=0){hi=mid;fh=fm;}else{lo=mid;fl=fm;}}
 return {value:Math.expm1((lo+hi)/2)*100,reason:null};
}
export function tradeMetrics(trades,{from='',to='9999'}={}){
 const holdings=new Map(),seenOpening=new Set(),issues=[];let realized=0,fees=0,income=0;const decisions=[];
 for(const t of trades){if(t.at>to)continue;const inPeriod=t.at>=from;if(inPeriod)fees+=t.fee+t.tax;let p=holdings.get(t.symbol)||{quantity:0,cost:0,known:true};
  if(t.side==='OPENING'){if(holdings.has(t.symbol)||seenOpening.has(t.symbol)){if(inPeriod)issues.push(t.symbol+' 시작원가 순서 오류');p.known=false;}else{p={quantity:t.quantity,cost:t.quantity*t.price,known:true};seenOpening.add(t.symbol);}}
  if(t.side==='BUY'){p.quantity+=t.quantity;p.cost+=t.quantity*t.price+t.fee+t.tax;}
  if(t.side==='SELL'){if(!p.known||p.quantity+1e-8<t.quantity){if(inPeriod)issues.push(t.symbol+' 매도 원가/수량 기록 부족');p.known=false;}else{const cost=p.cost*t.quantity/p.quantity;if(inPeriod)realized+=t.quantity*t.price-t.fee-t.tax-cost;p.quantity=Math.max(0,p.quantity-t.quantity);p.cost=Math.max(0,p.cost-cost);}}
  if(inPeriod&&['DIVIDEND','INTEREST'].includes(t.side))income+=t.quantity*t.price-t.fee-t.tax;
  holdings.set(t.symbol,p);
  if(inPeriod&&['BUY','SELL'].includes(t.side)&&t.strategyId&&t.expectedAction&&t.decisionAt&&t.decisionAt<=t.at)decisions.push({id:t.id,symbol:t.symbol,at:t.at,side:t.side,expected:t.expectedAction,match:t.side===t.expectedAction,strategyId:t.strategyId,reason:t.reason});
 }
 return {realizedPnl:!trades.length||issues.length?null:realized,income,fees,issues:[...new Set(issues)],decisions,recordedMatchPct:decisions.length?decisions.filter(x=>x.match).length/decisions.length*100:null,scope:'입력한 전체 거래 기록의 이동평균 원가·비용 기준. 사용자 기록 일치율은 승인 규칙의 독립 재검증이 아님.'};
}
function analyzeWindow(dataset,start,end){
 const vals=dataset.valuations.filter(x=>x.at>=start&&x.at<=end),flows=dataset.flows.filter(x=>x.at>start&&x.at<=end),v0=vals[0],v1=vals.at(-1);
 if(vals.length<2||!v0||v0.at===v1.at)return {available:false,reason:'선택 기간에 서로 다른 시점의 평가 기록이 두 개 이상 필요합니다.'};
 const errors=[];if(!dataset.complete)errors.push('현금 포함 평가·외부 입출금의 누락 없음 확인이 필요합니다.');if(v0.phase!=='MARK'||v1.phase!=='MARK')errors.push('기간의 시작과 끝에 MARK 평가 기록이 필요합니다.');
 const net=sum(flows.map(signedFlow)),base=v0.equity;const flowMap=new Map();for(const f of flows)flowMap.set(f.at,(flowMap.get(f.at)||0)+signedFlow(f));
 const byAt=new Map();for(const v of vals){const group=byAt.get(v.at)||[];group.push(v);byAt.set(v.at,group);}
 let last=base,index=100,peak=100,mdd=0;const indexed=[],series=[];let cumulative=0;const processed=new Set();
 for(const v of vals){
  const flow=flowMap.get(v.at),same=byAt.get(v.at),pre=same.find(x=>x.phase==='PRE_FLOW'),post=same.find(x=>x.phase==='POST_FLOW');
  if(flow!==undefined){if(!pre||!post||same.length!==2||Math.abs(post.equity-pre.equity-flow)>Math.max(.01,Math.abs(post.equity)*1e-10))errors.push('입출금 전후 평가값 누락 또는 합계 불일치: '+v.at);}
  else if(v.phase!=='MARK'||same.length!==1)errors.push('입출금 없는 시각의 중복 평가 또는 phase 오류: '+v.at);
  if(v.phase==='POST_FLOW'){if(!processed.has(v.at)){cumulative+=flow||0;processed.add(v.at);}last=v.equity;}
  else {if(last===0){if(v.equity!==0)errors.push('0 기준자산 이후 설명되지 않은 자산 증가: 입출금·평가 확인 필요');}else index*=v.equity/last;last=v.equity;peak=Math.max(peak,index);mdd=Math.max(mdd,(1-index/peak)*100);}
  indexed.push({date:v.at,value:index,note:v.phase==='MARK'?'평가':v.phase==='PRE_FLOW'?'입출금 전':'입출금 후'});series.push({date:v.at,equity:v.equity,capital:base+cumulative,pnl:v.equity-base-cumulative,phase:v.phase});
 }
 for(const at of flowMap.keys())if(!byAt.has(at))errors.push('입출금 시점 평가 누락: '+at);
 if(!vals.some(v=>v.equity>0))errors.push('투입된 평가자산이 없어 TWR을 정의할 수 없습니다.');
 const twr=errors.length?unavailable([...new Set(errors)].join(' / ')):{value:index-100,reason:null};
 const basic=dataset.complete&&v0.phase==='MARK'&&v1.phase==='MARK';
 const investor=[{at:start,amount:-base},...flows.map(f=>({at:f.at,amount:-signedFlow(f)})),{at:end,amount:v1.equity}];
 return {available:true,start,end,currency:dataset.currency,initial:base,final:v1.equity,netDeposits:basic?net:null,investmentPnl:basic?v1.equity-base-net:null,twr,xirr:basic?xirr(investor,{timeZone:dataset.timezone||'Asia/Seoul'}):unavailable('평가·입출금 범위 확인 필요'),mdd:twr.value===null?unavailable('정확한 TWR 이력이 필요합니다. 관측 간 낙폭은 알 수 없습니다.'):{value:mdd,reason:null},series,capitalAvailable:basic,indexed:twr.value===null?[]:indexed,errors:[...new Set(errors)],flowCount:flows.length};
}
export function analyzePerformance(dataset,{range='ALL',end}={}){
 const all=dataset.valuations,last=end||all.at(-1)?.at;if(!last)return {available:false,reason:'평가 자료 없음'};let cutoff=null;
 if(range!=='ALL'){const months={ '1M':1,'3M':3,'6M':6,'1Y':12,'3Y':36}[range];if(!months)return {available:false,reason:'기간 선택 오류'};const d=new Date(last),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));cutoff=d.toISOString();}
 const vals=all.filter(v=>(!cutoff||v.at>=cutoff)&&v.at<=last);if(vals.length<2)return {available:false,reason:'선택 기간의 평가 자료 부족'};
 const result=analyzeWindow(dataset,vals[0].at,vals.at(-1).at),zone=dataset.timezone||'Asia/Seoul';
 const cal=at=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at)).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
 const months=[...new Set(vals.map(v=>cal(v.at).slice(0,7)))];
 const monthly=months.map(month=>{const monthVals=vals.filter(v=>cal(v.at).startsWith(month)),prior=vals.filter(v=>cal(v.at).slice(0,7)<month&&v.phase==='MARK').at(-1),first=prior||monthVals[0],last=monthVals.at(-1);const r=analyzeWindow(dataset,first.at,last.at),year=Number(month.slice(0,4)),m=Number(month.slice(5,7)),prevLast=new Date(Date.UTC(year,m-1,0)).toISOString().slice(0,10),monthLast=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);return {month,...r,partial:!prior||cal(prior.at)!==prevLast||cal(last.at)!==monthLast};});
 return {...result,monthly,trade:tradeMetrics(dataset.trades,{from:result.start,to:result.end}),source:dataset.source,complete:dataset.complete,sourceNotice:dataset.source==='synthetic_demo'?'DEMO 합성 자료 · 실제 계좌 성과 아님':'사용자 제공 CSV 기준 · 금융사 원장 대조 미완료',requestedRange:range,timezone:zone};
}
