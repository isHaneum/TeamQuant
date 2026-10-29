import {runBacktest,createStrategyDefinition,evaluateStrategy} from './backtest.js';
import {threeMonthsBefore} from './comparison.js';
export function holdingWeights(snapshot){
 const usd=snapshot.fx?.midRate,values=snapshot.positions.map(p=>p.currency==='KRW'?p.value:p.currency==='USD'&&usd>0?p.value*usd:null);
 const total=values.every(v=>Number.isFinite(v)&&v>=0)?values.reduce((a,b)=>a+b,0):null;
 return snapshot.positions.map((p,i)=>({...p,valueKrw:values[i],weight:total>0?values[i]/total:null}));
}
export function inspectHolding(p,config,candles){
 const strategy=createStrategyDefinition(config);
 if(!Array.isArray(candles)||candles.length<strategy.warmup+2)throw new Error('지표 준비 기간을 포함한 가격 자료가 부족해요.');
 if(candles.some((c,i)=>!Number.isFinite(c.close)||c.close<=0||(i&&c.date<=candles[i-1].date)))throw new Error('가격 결측·날짜 중복·시각 역전이 있어 평가를 보류해요.');
 const evaluation=evaluateStrategy(strategy,candles.map(c=>c.close),candles.length-1,true),last=candles.at(-1);
 const loss=config.stopLossPct>0&&p.returnPct<=-config.stopLossPct,profit=config.takeProfitPct>0&&p.returnPct>=config.takeProfitPct;
 const action=loss||profit?'SELL':evaluation.action;
 return {symbol:p.symbol,strategyId:strategy.id,date:last.date,action,reason:loss?`조회 평균매입가 기준 손절 ${config.stopLossPct}% 도달`:profit?`조회 평균매입가 기준 익절 ${config.takeProfitPct}% 도달`:evaluation.reason,indicators:evaluation.indicators,priceSource:loss||profit?'조회 잔고의 평가손익률':'완료 일봉의 규칙 평가',observedReturn:p.returnPct,scope:'현재 보유분의 매도·유지 점검, 추가 매수 판단과 별도'};
}
export function seedPaper(snapshot,extraCash={KRW:0,USD:0}){
 for(const c of ['KRW','USD'])if(!Number.isFinite(extraCash[c])||extraCash[c]<0)throw new Error('가상 현금은 0 이상의 숫자여야 해요.');
 const positions=snapshot.positions.map(p=>({...p})),initial=Object.fromEntries(['KRW','USD'].map(c=>[c,extraCash[c]+positions.filter(p=>p.currency===c).reduce((s,p)=>s+p.value,0)]));
 return {positions,cash:{...extraCash},initial,orders:[],createdAt:new Date().toISOString(),sourceAsOf:snapshot.fetchedAt,assumption:'현재 보유주식 복사 + 입력한 가상 현금. 실제 현금 잔고 아님.'};
}
export function paperTrade(workspace,{symbol,side,quantity,costPct,reason,expected,strategyId,asOf},now=new Date().toISOString()){
 if(!['BUY','SELL','HOLD'].includes(side)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(costPct)||costPct<0||costPct>=10||!reason?.trim())throw new Error('수량·편도 비용·판단 이유를 확인하세요.');
 const next=structuredClone(workspace),p=next.positions.find(p=>p.symbol===symbol);if(!p||!Number.isFinite(p.price)||p.price<=0)throw new Error('종목의 조회 가격이 없어요.');
 const gross=quantity*p.price,fee=gross*costPct/100;
 if(side==='BUY'){if(next.cash[p.currency]+1e-8<gross+fee)throw new Error('가상 현금이 부족해요.');p.avgCost=(p.quantity*p.avgCost+gross)/(p.quantity+quantity);p.quantity+=quantity;next.cash[p.currency]-=gross+fee;}
 if(side==='SELL'){if(quantity>p.quantity+1e-8)throw new Error('모의 보유 수량보다 많이 팔 수 없어요.');p.quantity=Math.max(0,p.quantity-quantity);next.cash[p.currency]+=gross-fee;}
 p.value=p.quantity*p.price;p.cost=p.quantity*p.avgCost;p.pnl=p.value-p.cost;p.returnPct=p.cost>0?p.pnl/p.cost*100:0;
 next.orders.push({symbol,side,quantity:side==='HOLD'?0:quantity,price:p.price,currency:p.currency,fee:side==='HOLD'?0:fee,reason,expected:expected||null,strategyId,asOf,createdAt:now,execution:'조회 가격 고정 가상 체결, 실제 주문 없음'});
 return next;
}
export function compareOwnedBasket(series,benchmark,config,costPct){
 if(!series.length||series.length>30||!Number.isFinite(costPct)||costPct<0||costPct>=10)throw new Error('종목과 비용 범위를 확인하세요.');
 const currency=series[0].position.currency;if(series.some(s=>s.position.currency!==currency))throw new Error('비교는 통화별로 나눠야 해요.');
 for(const rows of [...series.map(s=>s.candles),benchmark.candles])if(!Array.isArray(rows)||rows.length<90||rows.some((c,i)=>!Number.isFinite(c.open)||c.open<=0||!Number.isFinite(c.close)||c.close<=0||(i&&c.date<=rows[i-1].date)))throw new Error('가격 결측·시각 역전·준비 기간 부족으로 비교를 보류해요.');
 const normal=rows=>rows.map(c=>{const ratio=c.adjustedClose>0?c.adjustedClose/c.close:1;return {...c,open:c.open*ratio,close:c.close*ratio};});
 const index=normal(benchmark.candles),maps=series.map(s=>new Map(normal(s.candles).map(c=>[c.date,c])));
 const common=index.map(c=>c.date).filter(d=>maps.every(m=>m.has(d))),end=common.at(-1);if(!end)throw new Error('공통 거래일이 없어요.');
 const dates=common.filter(d=>d>=threeMonthsBefore(end));if(dates.length<40)throw new Error('최근 3개월 공통 거래일이 부족해요.');
 const first=dates[0],allowed={};index.forEach((c,i)=>allowed[c.date]=i>=59&&c.close>index.slice(i-59,i+1).reduce((a,b)=>a+b.close,0)/60);
 const capital=series.reduce((s,x)=>s+x.position.value,0);if(capital<=0)throw new Error('보유주식 평가액이 없어요.');
 const cost=costPct/100;
 const runs=series.map((s,i)=>{const candles=common.map(d=>maps[i].get(d)),options={...config,initialCapital:s.position.value,feeRate:cost/2,slippageRate:cost/2,evaluationStartDate:first};const by=new Map(candles.map(c=>[c.date,c]));const buyHold=dates.map(d=>({date:d,value:s.position.value/(1+cost)*by.get(d).close/by.get(first).open}));return {symbol:s.position.symbol,base:runBacktest(candles,options),filtered:runBacktest(candles,{...options,entryAllowedByDate:allowed}),buyHold};});
 const metrics=equity=>{let peak=capital,mdd=0;for(const x of equity){peak=Math.max(peak,x.value);mdd=Math.max(mdd,(1-x.value/peak)*100);}return {equity,returnPct:(equity.at(-1).value/capital-1)*100,maxDrawdown:mdd};};
 const combine=kind=>metrics(dates.map((date,i)=>({date,value:runs.reduce((sum,r)=>sum+(kind==='buyHold'?r.buyHold[i].value:r[kind].equity[i].value),0)})));
 const by=new Map(index.map(c=>[c.date,c]));const market=metrics(dates.map(d=>({date:d,value:capital/(1+cost)*by.get(d).close/by.get(first).open})));
 return {currency,start:first,end,initialCapital:capital,strategyId:createStrategyDefinition(config).id,config,costPct,base:combine('base'),filtered:combine('filtered'),buyHold:combine('buyHold'),benchmark:market,runs,
  assumption:'현재 보유 종목·현재 평가액 비중을 3개월 전 시작 현금 배분으로 사용한 사후 가정. 실제 계좌 수익률 아님. 현재 종목 선택 편향·현금/투입 비중 차이·세금/환차손익 미반영. 시장 필터는 기준 지수 60일 평균, 과거 뉴스 효과 아님.'};
}
