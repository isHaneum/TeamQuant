import {PlanError,number,depositCount,monthOf} from './goal-engine.js';
// Explicit, limited ETF universe. This is a product selector, not a recommendation.
export const plannerEtfs=[
 ['069500.KS','KODEX 200','KRW'],['360750.KS','TIGER 미국S&P500','KRW'],
 ['SPY','SPDR S&P 500 ETF','USD'],['VOO','Vanguard S&P 500 ETF','USD'],
 ['VTI','Vanguard Total Stock Market ETF','USD'],['BND','Vanguard Total Bond Market ETF','USD'],
 ['QQQ','Invesco QQQ ETF','USD'],['VT','Vanguard Total World Stock ETF','USD']
].map(([symbol,name,currency])=>({symbol,name,currency}));
const canonical=s=>String(s).replace(/^(\d{6})$/,'$1.KS');
const units=c=>c==='KRW'?1:100;
export function normalizeBook(input,now=new Date()){
 if(!input||!['KRW','USD'].includes(input.currency))throw new PlanError('통화를 골라 주세요.');
 const currency=input.currency,scale=units(currency),g=input.goal||{};
 const goal={target:number(g.target,'목표 자산',1),targetMonth:String(g.targetMonth),monthly:number(g.monthly,'매달 넣을 돈'),annualRate:number(g.annualRate,'가정 연 수익률',-.5,1),cashPct:number(g.cashPct,'현금 최소 비중',0,100),maxPct:number(g.maxPct,'한 종목 최대 비중',1,100),costPct:number(g.costPct,'매매마다 비용',0,10)};
 goal.startMonth=String(g.startMonth);depositCount(goal.startMonth,goal.targetMonth,now);
 const cash=number(input.cash,'확인한 가상 현금');if(Math.abs(cash*scale-Math.round(cash*scale))>1e-5||Math.abs(goal.monthly*scale-Math.round(goal.monthly*scale))>1e-5)throw new PlanError('원화는 1원, 달러는 1센트 단위로 넣어 주세요.');
 if(!Array.isArray(input.assets)||input.assets.length<1||input.assets.length>40)throw new PlanError('종목은 1~40개까지 넣을 수 있습니다.');
 const seen=new Set();const assets=input.assets.map(a=>{
  const symbol=canonical(a.symbol);if(!/^[A-Z0-9.-]{1,18}$/.test(symbol)||seen.has(symbol))throw new PlanError('중복 종목 또는 종목코드 오류입니다.');seen.add(symbol);
  const etf=plannerEtfs.find(p=>p.symbol===symbol),type=etf?'ETF':'FROZEN';
  const currency=etf?.currency||a.currency;if(!['KRW','USD'].includes(currency))throw new PlanError('원화·달러 종목만 넣을 수 있습니다.');
  const quantity=number(a.quantity,'보유 수량',0,1e9);if(Math.abs(quantity*1e6-Math.round(quantity*1e6))>Math.max(1e-7,Number.EPSILON*quantity*1e6*2))throw new PlanError('수량은 소수점 6자리까지 넣을 수 있습니다.');
  const price=number(a.price,'확인한 가격',.000001,1e10),targetPct=number(a.targetPct,'목표 비중',0,100),lot=number(a.lot,'주문 단위',.000001,1e6);
  if(Math.abs(lot*1e6-Math.round(lot*1e6))>1e-6)throw new PlanError('주문 단위는 소수점 6자리까지 넣을 수 있습니다.');
  if(type==='FROZEN'&&targetPct!==0)throw new PlanError('목록 밖의 보유 종목은 사지 않습니다. 목표 비중을 0으로 넣어 주세요.');
  if(targetPct>goal.maxPct)throw new PlanError('ETF 목표 비중이 한 종목 최대 비중을 넘습니다.');
  const priceDate=String(a.priceDate);if(!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)||!Number.isFinite(Date.parse(priceDate))||new Date(priceDate).toISOString().slice(0,10)!==priceDate||priceDate>new Date(now).toISOString().slice(0,10))throw new PlanError('가격 날짜를 확인해 주세요.');
  return {symbol,name:etf?.name||String(a.name||symbol).slice(0,80),currency,type,quantity,price,priceDate,source:String(a.source||'직접 입력 · 시세 확인 안 됨').slice(0,150),targetPct,lot};
 });
 if(Math.abs(assets.reduce((s,a)=>s+a.targetPct,0)+goal.cashPct-100)>.00001)throw new PlanError('ETF 목표 비중과 현금 비중의 합은 100%여야 합니다.');
 const mixed=assets.some(a=>a.currency!==currency),fx=mixed?number(input.fx,'환율(1달러 = 원)',100,10000):null;
 const total=cash+goal.monthly+assets.reduce((s,a)=>s+a.quantity*a.price*(a.currency===currency?1:currency==='KRW'?fx:1/fx),0);
 if(total*scale>1e14)throw new PlanError('금액이 너무 큽니다. 계획을 더 작게 나눠 주세요.');
 return {currency,cash,fx,goal,assets,label:String(input.label||'나의 적립 계획').slice(0,60),origin:input.origin==='account-copy'?'account-copy':'manual'};
}
export function valueAsset(asset,book){const fx=asset.currency===book.currency?1:book.currency==='KRW'?book.fx:1/book.fx;return asset.quantity*asset.price*fx;}
export function bookValue(book){return book.cash+book.assets.reduce((s,a)=>s+valueAsset(a,book),0);}
function projection(gaps,budget){ // Euclidean projection onto a nonnegative, budget-bounded simplex.
 if(gaps.reduce((s,x)=>s+Math.max(0,x),0)<=budget)return gaps.map(x=>Math.max(0,x));
 let lo=0,hi=Math.max(...gaps,0);for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(gaps.reduce((s,x)=>s+Math.max(0,x-mid),0)>budget)lo=mid;else hi=mid;}return gaps.map(x=>Math.max(0,x-hi));
}
export function allocationPlan(raw,{scenario='gap',month=monthOf()}={},now=new Date()){
 const book=normalizeBook(raw,now);if(!['gap','target'].includes(scenario)||month!==monthOf(now))throw new PlanError('이번 달의 두 가지 배분 방식만 계산할 수 있습니다.');
 const {goal:g}=book,scale=units(book.currency),before=bookValue(book),total=before+g.monthly,rate=g.costPct/100;
 if(total<=0)throw new PlanError('보유 자산이나 매달 넣을 돈이 필요합니다.');
 const values=book.assets.map(a=>valueAsset(a,book));
 // Existing cash is reserved. Only this month's contribution can fund purchases.
 const available=Math.max(0,Math.min(g.monthly,book.cash+g.monthly-total*g.cashPct/100)),grossBudget=available/(1+rate),minTotal=total-grossBudget*rate;
 let amounts=scenario==='gap'?projection(book.assets.map((a,i)=>a.type==='ETF'?total*a.targetPct/100-values[i]:0),grossBudget):book.assets.map(a=>grossBudget*a.targetPct/100);
 amounts=amounts.map((x,i)=>Math.min(x,Math.max(0,minTotal*g.maxPct/100-values[i])));
 let remaining=Math.floor(available*scale+1e-8);const rows=book.assets.map((a,i)=>{
  const fx=a.currency===book.currency?1:book.currency==='KRW'?book.fx:1/book.fx,unitPrice=a.price*fx;
  let lots=Math.min(Math.floor((amounts[i]+1e-9)/unitPrice/a.lot),Math.floor((1e9-a.quantity)/a.lot)),quantity=Math.round(lots*a.lot*1e6)/1e6;
  const charge=q=>{const gross=Math.max(0,Math.ceil((q*unitPrice-1e-9)*scale)),fee=Math.max(0,Math.ceil((gross*rate-1e-9)));return {gross,fee,cost:gross+fee};};
  let c=charge(quantity);if(c.cost>remaining){let lo=0,hi=lots;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(charge(Math.round(mid*a.lot*1e6)/1e6).cost<=remaining)lo=mid;else hi=mid-1;}lots=lo;quantity=Math.round(lots*a.lot*1e6)/1e6;c=charge(quantity);}
  remaining-=c.cost;return {...a,quantityBefore:a.quantity,buyQuantity:quantity,quantityAfter:Math.round((a.quantity+quantity)*1e6)/1e6,valueBefore:values[i],gross:c.gross/scale,fee:c.fee/scale,spend:c.cost/scale,rounding:c.gross/scale-quantity*unitPrice,unitPrice};
 });
 const spend=rows.reduce((s,r)=>s+Math.round(r.spend*scale),0)/scale,cashAfter=(Math.round((book.cash+g.monthly)*scale)-Math.round(spend*scale))/scale;
 const after=cashAfter+rows.reduce((s,r)=>s+r.quantityAfter*r.unitPrice,0);
 for(const r of rows){r.weightBefore=before?r.valueBefore/before*100:0;r.weightAfter=r.quantityAfter*r.unitPrice/after*100;r.deviation=r.weightAfter-r.targetPct;}
 const cashWeight=cashAfter/after*100,blockers=[];
 if(month<g.startMonth)blockers.push('적립 시작 전입니다. 미리보기만 되고, 적립 시작 달부터 가상 매수를 기록할 수 있습니다.');
 if(rows.some(r=>r.weightAfter>g.maxPct+1e-6))blockers.push('기존 보유 종목을 넣으면 한 종목 최대 비중을 넘습니다. 목표를 바꾸거나 계획을 나눠 주세요(자동 매도 없음).');
 if(cashWeight<g.cashPct-1e-6)blockers.push('현금 최소 비중보다 적습니다. 이번 달 적립금만으로는 채워지지 않습니다.');
 if(rows.some(r=>Date.parse(new Date(now).toISOString().slice(0,10))-Date.parse(r.priceDate)>7*86400000))blockers.push('7일보다 오래된 가격이 있습니다. 가격과 날짜를 다시 확인해 주세요.');
 return {scenario,month,before,contribution:g.monthly,totalBeforeCosts:total,after,cashBefore:book.cash,cashAfter,cashWeight,spend,fees:rows.reduce((s,r)=>s+r.fee,0),rounding:rows.reduce((s,r)=>s+r.rounding,0),rows,blockers,
  deviationBefore:book.assets.reduce((s,a,i)=>s+Math.abs((before?values[i]/before*100:0)-a.targetPct),Math.abs((before?book.cash/before*100:0)-g.cashPct))/2,
  deviationAfter:(rows.reduce((s,r)=>s+Math.abs(r.deviation),0)+Math.abs(cashWeight-g.cashPct))/2,
  method:'고정 가격·고정 환율로 계산합니다. 이번 달 적립금만 씁니다. 모자란 금액에 가깝게 나눈 뒤 주문 단위로 내림합니다(가장 좋은 조합이라는 보장은 없음). 분배금·시장 변동·세금·실제 체결은 넣지 않았습니다.'};
}
