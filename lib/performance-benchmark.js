function closeTime(date,currency){
 if(currency==='KRW')return Date.parse(date+'T16:00:00+09:00');
 for(const h of [21,22]){const t=Date.parse(date+'T'+h+':00:00Z'),p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));if(p.hour==='17'&&`${p.year}-${p.month}-${p.day}`===date)return t;}
 return NaN;
}
export function comparePerformanceBenchmark(report,market){
 if(!report.available||report.twr?.value===null)return {available:false,reason:'입출금 효과를 제거한 TWR부터 계산되어야 합니다.'};
 if(market.currency!==report.currency)return {available:false,reason:'계좌와 기준 시장의 통화가 다릅니다.'};
 const rows=market.candles.map(c=>({date:c.date,value:c.adjustedClose>0?c.adjustedClose:c.close,at:closeTime(c.date,market.currency)})).filter(c=>Number.isFinite(c.value)&&c.value>0&&Number.isFinite(c.at)).sort((a,b)=>a.at-b.at);
 if(new Set(rows.map(x=>x.date)).size!==rows.length)return {available:false,reason:'기준 시장의 중복 날짜를 확인하십시오.'};
 const quote=at=>{const time=Date.parse(at),r=rows.filter(c=>c.at<=time).at(-1);return r&&time-r.at<=7*86400000?r:null;};
 const first=quote(report.start),last=quote(report.end);if(!first||!last||first.at>=last.at)return {available:false,reason:'동일 관측 기간을 비교할 완료 일봉이 부족합니다.'};
 const value=(last.value/first.value-1)*100,series=report.indexed.map(p=>{const q=quote(p.date);return q?{date:p.date,value:q.value/first.value*100}:null;});
 return {available:true,source:market.source||'원천 미표시',fetchedAt:market.fetchedAt||null,firstQuote:first,lastQuote:last,returnPct:value,excessPp:report.twr.value-value,firstDate:first.date,lastDate:last.date,series:series.every(Boolean)?series:[],notice:'각 평가 시점에 확인 가능한 직전 완료 일봉 사용(최대 7일). 코스피는 배당 미포함 지수, SPY는 공급자 수정주가. 계좌와 기준 시장의 투자 노출·비용이 다름.'};
}
