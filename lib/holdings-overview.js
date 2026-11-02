// Holdings are not an account balance. Never infer cash or historical FX P/L.
export function holdingsOverview(snapshot){
 const rate=snapshot.fx?.midRate,positions=snapshot.positions.map(p=>{
  const fx=p.currency==='KRW'?1:p.currency==='USD'&&Number.isFinite(rate)&&rate>0?rate:null;
  return {...p,price:fx===null?null:p.price*fx,avgCost:fx===null?null:p.avgCost*fx,value:fx===null?null:p.value*fx,pnl:fx===null?null:p.pnl*fx,dailyPnl:fx===null||p.dailyPnl==null?null:p.dailyPnl*fx,dailyPct:p.dailyPct??null,weightPct:null,asOf:snapshot.fetchedAt,source:'금융사 조회 · 현재 환율 환산'};
 });
 const complete=positions.every(p=>p.value!==null),total=complete?positions.reduce((s,p)=>s+p.value,0):null,pnl=complete?positions.reduce((s,p)=>s+p.pnl,0):null;
 return {positions:positions.map(p=>({...p,weightPct:total>0?p.value/total*100:null})),total,pnl,cash:null,cashPct:null,returnPct:null,dailyPnl:positions.every(p=>p.dailyPnl!==null)?positions.reduce((s,p)=>s+p.dailyPnl,0):null,complete,scope:'holdings_only'};
}
