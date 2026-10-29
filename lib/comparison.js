import {runBacktest} from './backtest.js';

export function threeMonthsBefore(date) {
  const value=new Date(date+'T00:00:00Z'), day=value.getUTCDate();
  value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth()-3);
  const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate();
  value.setUTCDate(Math.min(day,last)); return value.toISOString().slice(0,10);
}

function adjusted(candles) {
  return candles.map(c=>{const ratio=c.adjustedClose>0?c.adjustedClose/c.close:1;return {...c,open:c.open*ratio,close:c.close*ratio};});
}

export function compareThreeMonths(series, market, config, initialCapital, costPct) {
  if(!series.length || !series.every(s=>s.candles.length>90) || market.candles.length<90) throw new Error('준비 기간을 포함한 1년 데이터가 필요합니다.');
  if(!Number.isFinite(initialCapital)||initialCapital<=0) throw new Error('모의 투자금을 확인하세요.');
  if(!Number.isFinite(costPct)||costPct<0||costPct>=10) throw new Error('편도 비용은 0% 이상 10% 미만으로 설정하세요.');
  const index=adjusted(market.candles), maps=series.map(s=>new Map(adjusted(s.candles).map(c=>[c.date,c])));
  const common=index.map(c=>c.date).filter(date=>maps.every(map=>map.has(date)));
  const end=common.at(-1); if(!end) throw new Error('공통 거래일을 찾지 못했습니다.');
  const cutoff=threeMonthsBefore(end), dates=common.filter(d=>d>=cutoff);
  if(dates.length<40) throw new Error('최근 3개월의 공통 거래일이 부족합니다.');
  const start=dates[0], allowed={};
  index.forEach((c,i)=>{allowed[c.date]=i>=59&&c.close>index.slice(i-59,i+1).reduce((s,x)=>s+x.close,0)/60;});
  const options={...config,initialCapital:initialCapital/series.length,feeRate:costPct/200,slippageRate:costPct/200,evaluationStartDate:start};
  const perStock=series.map((s,i)=>{
    const candles=common.map(date=>maps[i].get(date));
    return {symbol:s.symbol,base:runBacktest(candles,options),market:runBacktest(candles,{...options,entryAllowedByDate:allowed})};
  });
  const combine=key=>{
    const equity=dates.map((date,i)=>({date,value:perStock.reduce((sum,s)=>sum+s[key].equity[i].value,0)}));
    let peak=initialCapital,mdd=0; for(const row of equity){peak=Math.max(peak,row.value);mdd=Math.max(mdd,(1-row.value/peak)*100);}
    return {equity,returnPct:(equity.at(-1).value/initialCapital-1)*100,maxDrawdown:mdd,trades:perStock.reduce((s,x)=>s+x[key].trades.length,0)};
  };
  const indexByDate=new Map(index.map(c=>[c.date,c]));
  const cost=costPct/100,first=indexByDate.get(start).open;
  const benchmarkEquity=dates.map((date,i)=>({date,value:initialCapital/(1+cost)*indexByDate.get(date).close/first}));
  let peak=initialCapital,mdd=0;for(const row of benchmarkEquity){peak=Math.max(peak,row.value);mdd=Math.max(mdd,(1-row.value/peak)*100);}
  const base=combine('base'),filtered=combine('market'),benchmark={equity:benchmarkEquity,returnPct:(benchmarkEquity.at(-1).value/initialCapital-1)*100,maxDrawdown:mdd};
  return {start,end,cutoff,initialCapital,costPct,config,base,filtered,benchmark,perStock,
    note:'수정주가 기반 · 평가 시작 시 현금 · 종목별 동일 자금 · 종가 판단 후 다음 거래일 시가 체결 · 시장 조건은 코스피 60일 평균 위에서만 신규 매수 · 기존 보유분은 원래 매도 규칙 유지 · 코스피는 지수의 이론적 비교이며 실제 ETF 체결 아님, 종가 평가 시 강제 청산하지 않음 · 과거 뉴스·AI 효과 검증 아님'};
}
