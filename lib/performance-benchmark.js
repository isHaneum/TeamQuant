function closeTime(date,currency){
 if(currency==='KRW')return Date.parse(date+'T16:00:00+09:00');
 for(const h of [21,22]){const t=Date.parse(date+'T'+h+':00:00Z'),p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));if(p.hour==='17'&&`${p.year}-${p.month}-${p.day}`===date)return t;}
 return NaN;
}
export function comparePerformanceBenchmark(report,market){
 if(!report.available||report.twr?.value===null)return {available:false,reason:'입출금 효과를 뺀 수익률이 먼저 계산되어야 합니다.'};
 if(market.currency!==report.currency)return {available:false,reason:'계좌와 비교 지수의 통화가 다릅니다.'};
 const rows=market.candles.map(c=>({date:c.date,value:c.adjustedClose>0?c.adjustedClose:c.close,at:closeTime(c.date,market.currency)})).filter(c=>Number.isFinite(c.value)&&c.value>0&&Number.isFinite(c.at)).sort((a,b)=>a.at-b.at);
 if(new Set(rows.map(x=>x.date)).size!==rows.length)return {available:false,reason:'비교 지수에 같은 날짜가 두 번 있습니다.'};
 const quote=at=>{const time=Date.parse(at),r=rows.filter(c=>c.at<=time).at(-1);return r&&time-r.at<=7*86400000?r:null;};
 const first=quote(report.start),last=quote(report.end);if(!first||!last||first.at>=last.at)return {available:false,reason:'같은 기간을 비교할 마감 종가가 부족합니다.'};
 const value=(last.value/first.value-1)*100,series=report.indexed.map(p=>{const q=quote(p.date);return q?{date:p.date,value:q.value/first.value*100}:null;});
 return {available:true,source:market.source||'출처 정보 없음',fetchedAt:market.fetchedAt||null,firstQuote:first,lastQuote:last,returnPct:value,excessPp:report.twr.value-value,firstDate:first.date,lastDate:last.date,series:series.every(Boolean)?series:[],notice:'각 평가 시점 직전의 마감 종가를 씁니다(최대 7일 전까지). 코스피는 배당이 빠진 지수, S&P500(SPY)은 배당·분할을 반영한 가격입니다. 계좌와 지수는 담은 종목과 비용이 다릅니다.'};
}
