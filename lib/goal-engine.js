// End-of-month contributions; rates are assumptions, not estimates of returns.
export class PlanError extends Error { constructor(message){super(message);this.name='PlanError';this.status=400;} }
export function number(value,label,min=0,max=1e15){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new PlanError(`${label} 값을 확인하십시오.`);return value;}
export function monthOf(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(now).replace('/','-');}
export function monthsUntil(target,now=new Date()){
 if(!/^\d{4}-\d{2}$/.test(target)||+target.slice(5)<1||+target.slice(5)>12)throw new PlanError('목표 시점은 연월 형식이어야 합니다.');
 const today=monthOf(now),n=(+target.slice(0,4)- +today.slice(0,4))*12+(+target.slice(5)- +today.slice(5));
 if(n<1||n>600)throw new PlanError('목표 시점은 다음 달부터 50년 이내로 설정하십시오.');return n;
}
export function depositCount(startMonth,targetMonth,now=new Date()){
 if(!/^\d{4}-\d{2}$/.test(startMonth)||+startMonth.slice(5)<1||+startMonth.slice(5)>12)throw new PlanError('납입 시작 연월을 확인하십시오.');
 const offset=(+startMonth.slice(0,4)- +monthOf(now).slice(0,4))*12+(+startMonth.slice(5)- +monthOf(now).slice(5));
 const months=monthsUntil(targetMonth,now);if(startMonth>targetMonth)throw new PlanError('납입 시작은 목표 시점보다 늦을 수 없습니다.');
 return {months,offset:Math.max(1,offset),deposits:Math.max(0,months-Math.max(1,offset)+1)};
}
export function futureValue(principal,contribution,months,annualRate){
 number(principal,'시작 자산');number(contribution,'월 납입액');number(months,'기간',1,600);number(annualRate,'연 수익률',-.9999,10);
 const log=Math.log1p(annualRate)/12,m=Math.expm1(log),growth=Math.exp(log*months);
 return principal*growth+contribution*(Math.abs(m)<1e-12?months:Math.expm1(log*months)/m);
}
export function goalProjection({current,target,monthly,targetMonth,startMonth,annualRate},now=new Date()){
 number(target,'목표 자산',.01);const {months,deposits,offset}=depositCount(startMonth,targetMonth,now);number(current,'현재 자산');number(monthly,'월 납입액');
 const fv=rate=>futureValue(current,0,months,rate)+(deposits?futureValue(0,monthly,deposits,rate):0);
 const projected=fv(annualRate),principal=current+monthly*deposits;
 let requiredRate=null,requiredStatus='solved';
 if(!current&&!monthly)requiredStatus='no_funding';
 else if(fv(-.9999)>=target)requiredStatus='below_search_range';
 else if(fv(10)<target)requiredStatus='above_search_range';
 else{let lo=-.9999,hi=10;for(let i=0;i<100;i++){const mid=(lo+hi)/2;if(fv(mid)<target)lo=mid;else hi=mid;}requiredRate=(lo+hi)/2;}
 const unit=deposits?futureValue(0,1,deposits,annualRate):0,neededMonthly=unit?Math.max(0,(target-futureValue(current,0,months,annualRate))/unit):null;
 const neededCurrent=Math.max(0,(target-(deposits?futureValue(0,monthly,deposits,annualRate):0))/futureValue(1,0,months,annualRate));
 return {months,deposits,current,target,monthly,annualRate,projected,principal,assumedGrowth:projected-principal,gap:projected-target,requiredRate,requiredStatus,neededMonthly,neededCurrent,
  series:Array.from({length:months+1},(_,i)=>{const count=Math.max(0,i-offset+1);return {month:i,value:(i?futureValue(current,0,i,annualRate):current)+(count?futureValue(0,monthly,count,annualRate):0),paidIn:current+monthly*count};})};
}
