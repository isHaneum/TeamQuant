export const feeSource='https://corp.tossinvest.com/ko/open-api';
export function defaultCosts(currency){if(!['KRW','USD'].includes(currency))throw new Error('지원하지 않는 통화');return {commissionPct:currency==='KRW'?0.015:0.1,slippagePct:0.05,totalPct:currency==='KRW'?0.065:0.15,source:feeSource,checkedAt:'2026-11-02',scope:'일반 거래 기본 가정 · 세금/환전/이벤트 혜택 미반영 · 실제 납부액 아님'};}
export function fxRate(currency,fx){return currency==='KRW'?1:currency==='USD'&&Number.isFinite(fx)&&fx>0?fx:null;}
export function toWon(value,currency,fx){const r=fxRate(currency,fx);return Number.isFinite(value)&&r!==null?value*r:null;}
export function manwon(value){return Number.isFinite(value)?(value/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'만원':'미확인';}
export function fromManwon(value){if(value===''||!Number.isFinite(Number(value))||Number(value)<0)throw new Error('0 이상의 만원 금액을 입력하십시오.');return Number(value)*10000;}
export function aggregateCandles(rows,interval='day'){
 if(!['day','week','month'].includes(interval))throw new Error('봉 주기 오류');
 const groups=new Map();let last='';
 for(const c of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||c.date<=last||![c.open,c.high,c.low,c.close].every(x=>Number.isFinite(x)&&x>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.low>c.high)throw new Error('OHLC 가격 결측·날짜 순서 오류로 캔들을 표시할 수 없습니다.');last=c.date;
  const d=new Date(c.date+'T00:00:00Z');if(interval==='week')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const key=interval==='month'?c.date.slice(0,7):interval==='week'?d.toISOString().slice(0,10):c.date;
  const a=groups.get(key);if(a){a.high=Math.max(a.high,c.high);a.low=Math.min(a.low,c.low);a.close=c.close;a.date=c.date;a.volume=a.volume===null||!Number.isFinite(c.volume)?null:a.volume+c.volume;}else groups.set(key,{...c,volume:Number.isFinite(c.volume)?c.volume:null,startDate:c.date});
 }return [...groups.values()];
}
export function combinedComparison(reports,fx){
 if(!reports.length)throw new Error('비교 결과가 없습니다.');const factors=reports.map(r=>fxRate(r.currency,fx));if(factors.some(x=>x===null))throw new Error('환율이 없어 통합 비교를 보류합니다.');
 const start=reports.map(r=>r.start).sort().at(-1),end=reports.map(r=>r.end).sort()[0];
 // Retain each market's changes; carry the last known close on the other market's holiday.
 const dates=[...new Set(reports.flatMap(r=>r.base.equity.map(x=>x.date)))].filter(d=>d>=start&&d<=end).sort();if(!dates.length)throw new Error('공통 비교 기간이 없습니다.');
 const capital=reports.reduce((s,r,i)=>s+r.initialCapital*factors[i],0);if(!(capital>0))throw new Error('비교 시작 자금 없음');
 const out={start,end,initialCapital:capital,currency:'KRW',fx,scope:'현재 고정 환율 환산 · 휴장일 직전 종가 유지 · 실제 과거 환차손익 제외'};
 for(const kind of ['base','filtered','buyHold','benchmark']){const equity=dates.map(date=>({date,value:reports.reduce((s,r,i)=>{const p=r[kind].equity.filter(x=>x.date<=date).at(-1);if(!p)throw new Error('날짜별 평가액 부족');return s+p.value*factors[i];},0)}));let peak=capital,mdd=0;for(const p of equity){peak=Math.max(peak,p.value);mdd=Math.max(mdd,(1-p.value/peak)*100);}out[kind]={equity,returnPct:(equity.at(-1).value/capital-1)*100,maxDrawdown:mdd};}return out;
}
export function nextAction(signal){
 if(!signal||['UNAVAILABLE','WARMUP'].includes(signal.action))return {label:'판단 보류',next:'가격 자료와 승인 전략을 먼저 확인',kind:'blocked'};
 if(signal.action==='SELL')return {label:'매도 조건 충족',next:'보유분을 모의 장부에 복사하고 매도했을 때의 변화를 비교',kind:'review'};
 if(signal.action==='BUY')return {label:'매수 조건 충족',next:'추가 가상 현금과 종목 비중을 확인한 뒤 모의 매수 검토',kind:'review'};
 return {label:'현재 보유 유지',next:'현재 원칙에 따른 매도 조건 없음 · 다음 완료 일봉에서 재점검',kind:'hold'};
}
export function actualCostSummary(report,fx){
 const filled=report.orders.filter(o=>o.execution.filledQuantity>0);
 const sum=field=>filled.length&&filled.every(o=>Number.isFinite(o.execution[field])&&fxRate(o.currency,fx)!==null)?filled.reduce((s,o)=>s+toWon(o.execution[field],o.currency,fx),0):null;
 return {commission:sum('commission'),tax:sum('tax'),filled:filled.length,complete:report.paginationComplete===true};
}
