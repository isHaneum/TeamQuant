// Pure calculations shared by the dashboard, rule review and simulations.
const finite=(n,min=0)=>Number.isFinite(n)&&n>=min;
export function portfolioMetrics(portfolio,quotes={}) {
  if(!finite(portfolio.cash))throw new Error('현금은 0 이상의 숫자로 입력하세요.');
  const positions=portfolio.positions.map(p=>{
    if(!finite(p.quantity)||!finite(p.avgCost))throw new Error('수량과 평균단가를 확인하세요.');
    const q=quotes[p.symbol]||{},price=finite(q.price,Number.MIN_VALUE)?q.price:null;
    const prev=finite(q.prevClose,Number.MIN_VALUE)?q.prevClose:null;
    const value=price===null?null:p.quantity*price,cost=p.quantity*p.avgCost;
    return {...p,price,prevClose:prev,value,cost,pnl:value===null?null:value-cost,
      returnPct:price===null||cost===0?null:(value/cost-1)*100,
      dailyPnl:price===null||prev===null?null:p.quantity*(price-prev),
      dailyPct:price===null||prev===null?null:(price/prev-1)*100,asOf:q.asOf||null,source:q.source||null};
  });
  const complete=positions.every(p=>p.value!==null),pricedValue=positions.reduce((s,p)=>s+(p.value??0),0);
  const total=complete?portfolio.cash+pricedValue:null;
  const cost=positions.reduce((s,p)=>s+p.cost,0);
  const pnl=complete?pricedValue-cost:null;
  const dailyPnl=positions.every(p=>p.dailyPnl!==null)?positions.reduce((s,p)=>s+p.dailyPnl,0):null;
  return {positions:positions.map(p=>({...p,weightPct:total>0&&p.value!==null?p.value/total*100:null})),
    total,cash:portfolio.cash,cost,pnl,dailyPnl,returnPct:cost>0&&pnl!==null?pnl/cost*100:null,
    cashPct:total>0?portfolio.cash/total*100:null,complete};
}
export function evaluatePrinciples(metrics,principles) {
  if(!principles?.approvedAt)return {evaluations:[],score:null,measurable:0};
  const {maxPositionPct,minCashPct}=principles;
  if(!finite(maxPositionPct)||maxPositionPct>100||!finite(minCashPct)||minCashPct>100)throw new Error('비중 범위는 0~100%입니다.');
  const evaluations=metrics.positions.map(p=>({id:'position:'+p.symbol,symbol:p.symbol,label:p.name+' 최대 비중',
    actual:p.weightPct,threshold:maxPositionPct,direction:'max',
    status:p.weightPct===null?'평가 불가':p.weightPct>maxPositionPct?'위반':p.weightPct>=maxPositionPct*.9?'임박':'충족',
    gap:p.weightPct===null?null:Math.max(0,p.weightPct-maxPositionPct)}));
  evaluations.push({id:'cash',label:'최소 현금 비중',actual:metrics.cashPct,threshold:minCashPct,direction:'min',
    status:metrics.cashPct===null?'평가 불가':metrics.cashPct<minCashPct?'위반':metrics.cashPct<=minCashPct+2?'임박':'충족',gap:metrics.cashPct===null?null:Math.max(0,minCashPct-metrics.cashPct)});
  const measured=evaluations.filter(e=>e.actual!==null);
  return {evaluations,score:measured.length?measured.filter(e=>e.status!=='위반').length/measured.length*100:null,measurable:measured.length};
}
export function simulateContributions({initial,once,monthly,months,annualRate,annualFee=0}) {
  if(![initial,once,monthly].every(x=>finite(x))||!Number.isInteger(months)||months<1||months>600||!Number.isFinite(annualRate)||annualRate<=-100||annualRate>100||!finite(annualFee)||annualFee>20)throw new Error('금액·기간·수익률 범위를 확인하세요.');
  const rate=((1+annualRate/100)*(1-annualFee/100))**(1/12)-1;
  let value=initial+once;
  const series=[{month:0,value,principal:value,gain:0}];
  for(let month=1;month<=months;month++){
    value=value*(1+rate)+monthly;const principal=initial+once+monthly*month;
    series.push({month,value,principal,gain:value-principal});
  }
  return {series,...series.at(-1),rate,assumptions:{initial,once,monthly,months,annualRate,annualFee,timing:'월말 납입',tax:'미반영',inflation:'미반영'}};
}
export function rebalanceOptions(metrics,symbol,maxPct,feePct=.2) {
  const p=metrics.positions.find(p=>p.symbol===symbol);
  if(!p||!metrics.total||!p.price||!finite(maxPct)||maxPct<=0||maxPct>100||!finite(feePct)||feePct>=100)throw new Error('현재 가격과 0 초과 최대 비중이 필요합니다.');
  const target=maxPct/100,fee=feePct/100;
  const qty=Math.min(p.quantity,Math.max(0,Math.ceil((p.value-target*metrics.total)/(p.price*(1-target*fee)))));
  const proceeds=qty*p.price,fees=proceeds*fee,total=metrics.total-fees;
  const additionalCash=Math.max(0,p.value/target-metrics.total);
  return {symbol,quantity:qty,fees,proceeds:proceeds-fees,afterWeightPct:total>0?(p.value-proceeds)/total*100:null,
    afterCash:metrics.cash+proceeds-fees,additionalCash,feePct,beforeWeightPct:p.weightPct};
}
