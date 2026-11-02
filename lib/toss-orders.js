import {createHash} from 'node:crypto';

export class OrderHistoryError extends Error{
 constructor(message='주문 이력 응답을 확인하지 못했습니다.',code='invalid_order_history'){super(message);this.name='OrderHistoryError';this.code=code;this.status=400;}
}
const fail=message=>{throw new OrderHistoryError(message);};
export const koreaDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
function stamp(s,nullable=false){if(s==null&&nullable)return null;if(typeof s!=='string'||!validDay(s.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))fail();return new Date(s).toISOString();}
function numeric(v,nullable=false){if(v==null&&nullable)return null;if(v==null||v===''||!['number','string'].includes(typeof v)||typeof v==='string'&&!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v)||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>Number.MAX_SAFE_INTEGER)fail();return Number(v);}
function code(v,max=50){if(typeof v!=='string'||!v||v.length>max||!/^[A-Za-z0-9_.-]+$/.test(v))fail();return v;}
export function orderQuery(input={},now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['status','from','to','symbol'].includes(k)))fail('주문 조회 조건을 확인하십시오.');
 const to=input.to||koreaDay(now);if(!validDay(to))fail('종료일 형식을 확인하십시오.');
 const from=input.from||new Date(Date.parse(to)-90*86400000).toISOString().slice(0,10),status=input.status||'CLOSED',symbol=String(input.symbol||'').trim().toUpperCase();
 if(!['OPEN','CLOSED'].includes(status)||!validDay(from)||!validDay(to)||from>to||to>koreaDay(now)||Date.parse(to)-Date.parse(from)>366*86400000)fail('기간은 오늘까지 최대 1년씩, 시작일과 종료일 순서대로 지정하십시오.');
 if(symbol&&!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(symbol))fail('종목 코드 형식을 확인하십시오.');
 return {status,from,to,symbol};
}
export function normalizeOrder(row,query,now=Date.now()){
 if(!row||!['BUY','SELL'].includes(row.side)||!['KRW','USD'].includes(row.currency)||typeof row.orderId!=='string'||!row.orderId||row.orderId.length>500)fail();
 const symbol=code(row.symbol,20).toUpperCase(),orderedAt=stamp(row.orderedAt),e=row.execution;
 if(koreaDay(orderedAt)<query.from||koreaDay(orderedAt)>query.to||Date.parse(orderedAt)>now+300000||query.symbol&&symbol!==query.symbol||!e)fail('조회 조건과 맞지 않는 주문 응답입니다. 다시 조회하십시오.');
 const quantity=numeric(row.quantity),orderAmount=numeric(row.orderAmount,true),filledQuantity=numeric(e.filledQuantity),averageFilledPrice=numeric(e.averageFilledPrice,true),filledAmount=numeric(e.filledAmount,true),filledAt=stamp(e.filledAt,true);
 if(filledQuantity>quantity+1e-8&&!(quantity===0&&orderAmount>0)||filledAt&&(filledAt<orderedAt||Date.parse(filledAt)>now+300000)||filledQuantity===0&&(averageFilledPrice!==null||filledAmount!==null||filledAt!==null))fail();
 if(e.settlementDate!=null&&!validDay(e.settlementDate))fail();
 return {ref:createHash('sha256').update(row.orderId).digest('hex'),symbol,side:row.side,status:code(row.status),orderType:code(row.orderType),timeInForce:code(row.timeInForce),currency:row.currency,quantity,orderAmount,limitPrice:numeric(row.price,true),orderedAt,canceledAt:stamp(row.canceledAt,true),
  execution:{filledQuantity,averageFilledPrice,filledAmount,commission:numeric(e.commission,true),tax:numeric(e.tax,true),filledAt,settlementDate:e.settlementDate??null}};
}
export function summarizeOrders(orders){
 return ['KRW','USD'].map(currency=>{
  const rows=orders.filter(o=>o.currency===currency),filled=rows.filter(o=>o.execution.filledQuantity>0);
  const sum=key=>filled.every(o=>o.execution[key]!==null)?filled.reduce((n,o)=>n+o.execution[key],0):null;
  const side=direction=>{const rs=filled.filter(o=>o.side===direction);return rs.every(o=>o.execution.filledAmount!==null)?rs.reduce((n,o)=>n+o.execution.filledAmount,0):null;};
  return {currency,orders:rows.length,filledOrders:filled.length,buyAmount:side('BUY'),sellAmount:side('SELL'),commission:sum('commission'),tax:sum('tax')};
 });
}
export async function collectOrderHistory(input,{readPage,now=()=>Date.now(),maxPages=8,delay=()=>Promise.resolve()}={}){
 const query=orderQuery(input,now()),byId=new Map(),cursors=new Set();let cursor=null,pages=0,complete=true,issue=null;
 while(pages<maxPages){
  let page;
  try{page=await readPage({...query,limit:100,...(cursor?{cursor}:{})});}catch(error){if(!pages)throw error;complete=false;issue='추가 페이지 조회에 실패했습니다. 표시된 주문은 일부일 수 있습니다.';break;}
  if(!page||!Array.isArray(page.orders)||page.orders.length>(query.status==='OPEN'?2000:100)||typeof page.hasNext!=='boolean'||page.nextCursor!==null&&typeof page.nextCursor!=='string')fail();
  pages++;
  for(const raw of page.orders){const row=normalizeOrder(raw,query,now()),previous=byId.get(row.ref);if(previous&&JSON.stringify(previous)!==JSON.stringify(row)){complete=false;issue='조회 중 주문 상태가 변경되었습니다. 결과를 다시 조회하십시오.';break;}byId.set(row.ref,row);}
  if(!complete)break;
  if(!page.hasNext){if(page.nextCursor!==null){complete=false;issue='페이지 종료 정보가 일치하지 않아 전체 조회로 확인할 수 없습니다.';}break;}
  if(query.status==='OPEN'||!page.nextCursor||page.nextCursor.length>4000||cursors.has(page.nextCursor)||!page.orders.length){complete=false;issue='다음 페이지 정보를 확인하지 못했습니다. 기간을 좁혀 다시 조회하십시오.';break;}
  cursors.add(page.nextCursor);cursor=page.nextCursor;
  if(pages===maxPages){complete=false;issue='최대 800개 주문 조회에 도달했습니다. 기간을 좁혀 다시 조회하십시오.';break;}
  await delay(200);
 }
 const orders=[...byId.values()].sort((a,b)=>b.orderedAt.localeCompare(a.orderedAt)||a.ref.localeCompare(b.ref));
 return {query,orders,totals:summarizeOrders(orders),pages,paginationComplete:complete,issue,fetchedAt:new Date(now()).toISOString(),source:'토스증권 Open API · 주문 목록 조회',
  coverage:{allBrokerOrderTypes:false,individualFillEvents:false,cashFlows:false,historicalEquity:false},
  notice:'주문 생성일(KST) 기준입니다. 지원되는 지정가·시장가·장마감지정가 등의 주문만 포함하며 일부 시간외 주문은 제외됩니다. 전체 페이지 조회 여부는 이 API 범위 안에서의 완료를 뜻합니다. 체결 정보는 주문별 누적 결과와 최종 체결시각이며 개별 부분체결의 시간 순서가 아닙니다. 입출금·과거 총자산·실현손익·원칙 준수율을 자동 계산하지 않습니다.'};
}
