import test from 'node:test';
import assert from 'node:assert/strict';
import {collectOrderHistory,normalizeOrder,orderQuery,summarizeOrders} from '../lib/toss-orders.js';
import {createTossReader} from '../lib/toss.js';
import {createLocalBridge} from '../lib/local-bridge.js';
const now=()=>Date.parse('2026-11-02T03:00:00Z'),query={status:'CLOSED',from:'2026-08-02',to:'2026-11-02',symbol:''};
const raw=(id='PRIVATE_ORDER_ID',extra={})=>({orderId:id,symbol:'EXAMPLE',side:'BUY',orderType:'LIMIT',timeInForce:'DAY',status:'FILLED',quantity:'2',price:'100',orderAmount:null,currency:'USD',orderedAt:'2026-10-29T22:30:00+09:00',canceledAt:null,execution:{filledQuantity:'2',averageFilledPrice:'99.5',filledAmount:'199',commission:'.2',tax:'0',filledAt:'2026-10-29T22:31:00+09:00',settlementDate:'2026-10-30'},...extra});
const page=(orders,nextCursor=null)=>({orders,hasNext:nextCursor!==null,nextCursor});
test('date queries validate KST day, range, symbols and reject write-related input before network',()=>{
 assert.equal(orderQuery({},now()).to,'2026-11-02');assert.equal(orderQuery({},Date.parse('2026-11-01T16:00:00Z')).to,'2026-11-02');
 for(const input of [{from:'2026-02-30'},{to:'invalid'},{from:'2026-11-03'},{to:'2026-11-03'},{from:'2020-01-01'},{symbol:'../orders'},{status:'FILLED'},{method:'DELETE'},{quantity:100}])assert.throws(()=>orderQuery(input,now()));
 assert.equal(orderQuery({...query,symbol:'example'},now()).symbol,'EXAMPLE');
});
test('order normalization preserves native values, fractional fills and unknown codes without raw IDs',()=>{
 const o=normalizeOrder(raw(undefined,{quantity:'.5',orderType:'FUTURE_TYPE',status:'NEW_STATUS',execution:{...raw().execution,filledQuantity:'.25',filledAmount:'24.875',commission:null,tax:null}}),query,now());
 assert.equal(o.quantity,.5);assert.equal(o.execution.filledQuantity,.25);assert.equal(o.execution.commission,null);assert.equal(o.orderType,'FUTURE_TYPE');assert.equal(o.status,'NEW_STATUS');assert.match(o.ref,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(o).includes('PRIVATE_ORDER_ID'),false);
});
test('canceled partial fills remain trades; amount-based orders do not assume requested shares',()=>{
 const canceled=normalizeOrder(raw('a',{status:'CANCELED',execution:{...raw().execution,filledQuantity:'1',filledAmount:'99.5'}}),query,now());
 assert.equal(canceled.execution.filledQuantity,1);assert.equal(summarizeOrders([canceled])[1].filledOrders,1);
 const amount=normalizeOrder(raw('b',{quantity:'0',orderAmount:'200',price:null,orderType:'MARKET'}),query,now());assert.equal(amount.quantity,0);assert.equal(amount.execution.filledQuantity,2);
 const unfilled=normalizeOrder(raw('c',{status:'REJECTED',execution:{filledQuantity:'0',averageFilledPrice:null,filledAmount:null,commission:null,tax:null,filledAt:null,settlementDate:null}}),query,now());assert.equal(unfilled.execution.averageFilledPrice,null);
});
test('invalid prices, impossible fills, currency and dates cannot become zeros or matching results',()=>{
 for(const row of [raw('a',{price:'bad'}),raw('bad-date',{orderedAt:'2026-02-30T10:00:00+09:00'}),raw('b',{currency:'EUR'}),raw('c',{orderedAt:'2027-01-01T10:00:00+09:00'}),raw('d',{execution:{...raw().execution,filledQuantity:'3'}}),raw('e',{execution:{...raw().execution,filledAt:'2026-10-28T22:31:00+09:00'}}),raw('f',{execution:{...raw().execution,filledAmount:'0x10'}})])assert.throws(()=>normalizeOrder(row,query,now()));
 assert.throws(()=>normalizeOrder(raw(),{...query,symbol:'OTHER'},now()));
});
test('currency summaries retain unknown fees and do not mislabel gross proceeds as P/L',()=>{
 const usd=normalizeOrder(raw('u'),query,now()),krw=normalizeOrder(raw('k',{currency:'KRW',side:'SELL',execution:{...raw().execution,commission:null}}),query,now());
 const [k,u]=summarizeOrders([usd,krw]);assert.equal(k.buyAmount,0);assert.equal(k.sellAmount,199);assert.equal(k.commission,null);assert.equal(u.buyAmount,199);assert.equal(u.commission,.2);assert.equal('profit' in u,false);
});
test('pagination follows opaque cursors, deduplicates identical orders and marks API scope limitations',async()=>{
 const pages=[page([raw('a')],'cursor'),page([raw('a'),raw('b')])],calls=[];
 const r=await collectOrderHistory(query,{now,readPage:async q=>{calls.push(q);return pages.shift();}});
 assert.equal(r.orders.length,2);assert.equal(r.pages,2);assert.equal(r.paginationComplete,true);assert.equal(calls[1].cursor,'cursor');assert.equal(r.coverage.allBrokerOrderTypes,false);assert.equal(r.coverage.individualFillEvents,false);assert.equal(JSON.stringify(r).includes('PRIVATE_ORDER_ID'),false);
});
test('loops, limits, changing orders and interrupted pagination are explicitly incomplete',async()=>{
 const loop=await collectOrderHistory(query,{now,readPage:async()=>page([raw('a')],'loop')});assert.equal(loop.paginationComplete,false);assert.match(loop.issue,/다음 페이지/);
 const limit=await collectOrderHistory(query,{now,maxPages:1,readPage:async()=>page([raw('a')],'more')});assert.equal(limit.paginationComplete,false);assert.match(limit.issue,/최대/);
 let count=0;const changed=await collectOrderHistory(query,{now,readPage:async()=>++count===1?page([raw('a')],'next'):page([raw('a',{status:'CANCELED'})])});assert.equal(changed.paginationComplete,false);assert.match(changed.issue,/상태가 변경/);
 count=0;const interrupted=await collectOrderHistory(query,{now,readPage:async()=>{if(++count===1)return page([raw('a')],'next');throw new Error('secret upstream details');}});assert.equal(interrupted.paginationComplete,false);assert.equal(interrupted.orders.length,1);assert.equal(JSON.stringify(interrupted).includes('secret upstream'),false);
});
test('first-page failure is not an empty successful account, malformed pages fail visibly',async()=>{
 await assert.rejects(collectOrderHistory(query,{now,readPage:async()=>{throw new Error('network');}}));
 await assert.rejects(collectOrderHistory(query,{now,readPage:async()=>({orders:null,hasNext:false,nextCursor:null})}));
});
test('broker adapter shares the existing token and account; all order operations are GET',async()=>{
 const calls=[];
 const r=createTossReader({now,credentials:async()=>({clientId:'SYNTHETIC_ID',clientSecret:'SYNTHETIC_SECRET'}),fetchImpl:async(url,options)=>{
  calls.push({url,options});let data;
  if(url.endsWith('/oauth2/token'))data={access_token:'SYNTHETIC_TOKEN',expires_in:86400};
  else if(url.endsWith('/accounts'))data={result:[{accountSeq:7,accountNo:'PRIVATE_ACCOUNT',accountType:'BROKERAGE'}]};
  else if(url.includes('/orders?'))data={result:page([raw()])};
  else if(url.includes('/stocks/'))data={result:{name:'합성 종목'}};
  else data={result:{items:[]}};
  return {ok:true,json:async()=>data};
 }});
 await r();const result=await r.orders(query);await r.orders(query);
 assert.equal(calls.filter(c=>c.url.includes('/orders?')).length,1);
 assert.equal(calls.filter(c=>c.url.endsWith('/oauth2/token')).length,1);assert.equal(result.orders[0].name,'합성 종목');assert.ok(calls.filter(c=>!c.url.endsWith('/oauth2/token')).every(c=>c.options.method==='GET'));
 assert.equal(calls.find(c=>c.url.includes('/orders?')).options.headers['X-Tossinvest-Account'],'7');assert.equal(JSON.stringify(result).includes('PRIVATE_ACCOUNT'),false);assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'),false);
 const before=calls.length;await assert.rejects(r.orders({method:'DELETE'}));assert.equal(calls.length,before);
});
test('history bridge requires exact local authorization or remote pairing and works without holdings',async()=>{
 let calls=0;const local={method:'POST',headers:{host:'127.0.0.1:8766',origin:'http://127.0.0.1:8766','x-teamquant-action':'bridge-local'}};
 const b=createLocalBridge({port:8766,env:{},readOrders:async q=>{calls++;return {query:q,orders:[]};}});
 assert.equal((await b.handle(local,'order-history',query)).status,200);assert.equal(calls,1);
 for(const r of [{...local,method:'GET'},{...local,headers:{...local.headers,origin:'https://evil.example'}},{...local,headers:{...local.headers,host:'evil.example'}},{...local,headers:{...local.headers,origin:'https://teamquant.vercel.app','x-teamquant-action':undefined}}])assert.notEqual((await b.handle(r,'order-history',query)).status,200);
 assert.equal(calls,1);assert.equal((await createLocalBridge({port:8766,env:{VERCEL:'1'}}).handle(local,'order-history',query)).status,403);
 const c=await b.handle(local,'challenge'),remote={method:'POST',headers:{host:'127.0.0.1:8766',origin:'https://teamquant.vercel.app'}};
 const pair=await b.handle(remote,'pair',{code:c.body.code});remote.headers.authorization='Bearer '+pair.body.token;assert.equal((await b.handle(remote,'order-history',query)).status,200);
});
