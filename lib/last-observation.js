// Only used after the authenticated PC history reader succeeds. No browser persistence.
export function lastObservation(records){
 const valid=records.filter(r=>r.status==='success'&&r.kind==='holdings_snapshot'&&r.data?.positions&&Number.isFinite(Date.parse(r.observedAt)));
 if(new Set(valid.map(r=>r.accountId)).size!==1)return null; // Never guess a different account.
 const r=valid.sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0];if(!r)return null;
 const d=r.data;
 return {source:r.source,fetchedAt:r.observedAt,provenance:{kind:'saved_observation',recordId:r.id},cashKnown:false,holdingValueKrw:d.holdingValueKrw,fx:d.fx?{midRate:d.fx.rate,asOf:d.fx.asOf}:null,
  positions:d.positions.map(p=>({symbol:p.symbol,name:p.name,currency:p.currency,quantity:p.quantity,avgCost:p.averageCost,price:p.price,cost:p.costBasis,value:p.holdingValue,pnl:p.unrealizedPnl,returnPct:p.costBasis>0?p.unrealizedPnl/p.costBasis*100:0,dailyPnl:null,dailyPct:null})),
  totals:d.totals.map(t=>({currency:t.currency,value:t.holdingValue,cost:t.costBasis,pnl:t.unrealizedPnl})),notice:'PC에 저장된 마지막 관측 자료 · 현재 잔고 및 현재 시세 아님'};
}
