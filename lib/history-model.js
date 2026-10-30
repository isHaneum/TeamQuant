import {createHash} from 'node:crypto';

export class HistoryError extends Error {
  constructor(code='invalid_history'){super('로컬 자산 이력을 확인하지 못했습니다.');this.code=code;}
}
const fail=()=>{throw new HistoryError();};
const text=(v,max=160)=>typeof v==='string'&&v.trim()&&v.length<=max?v:fail();
const amount=(v,signed=false)=>Number.isFinite(v)&&(signed||v>=0)?v:fail();
const date=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail();return new Date(v).toISOString();};
const keys=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail();};
const account=id=>id===null||/^acct_[a-f0-9]{64}$/.test(id)?id:fail();
const failureCodes=new Set(['ip_not_allowed','invalid_client','not_configured','no_account','rate_limited','invalid_response','upstream_failed']);
function fingerprint(record){const {id,recordedAt,...data}=record;return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
function finalize(data,recordedAt){const r={schemaVersion:1,...data,recordedAt:date(recordedAt)};r.id=fingerprint(r);assertHistoryRecord(r);return r;}

export function createHoldingsRecord(snapshot,{accountId,recordedAt=new Date().toISOString()}={}){
  account(accountId);if(accountId===null||!snapshot||!Array.isArray(snapshot.positions)||snapshot.positions.length>1000)fail();
  const observedAt=date(snapshot.fetchedAt),seen=new Set();
  const positions=snapshot.positions.map(p=>{
    const symbol=text(p.symbol,32).toUpperCase(),currency=['KRW','USD'].includes(p.currency)?p.currency:fail(),key=currency+':'+symbol;
    if(seen.has(key))fail();seen.add(key);
    return {symbol,name:text(p.name),currency,quantity:amount(p.quantity),averageCost:amount(p.avgCost),price:amount(p.price),costBasis:amount(p.cost),holdingValue:amount(p.value),unrealizedPnl:amount(p.pnl,true)};
  }).sort((a,b)=>(a.currency+':'+a.symbol).localeCompare(b.currency+':'+b.symbol));
  // Cash is not returned by the current connector. It must never become zero cash.
  if(snapshot.cashKnown!==false)fail();
  const totals=['KRW','USD'].map(currency=>{const rows=positions.filter(p=>p.currency===currency);return {currency,holdingValue:rows.reduce((s,p)=>s+p.holdingValue,0),costBasis:rows.reduce((s,p)=>s+p.costBasis,0),unrealizedPnl:rows.reduce((s,p)=>s+p.unrealizedPnl,0),cash:null,totalEquity:null};});
  let fx=null;if(snapshot.fx){fx={base:'USD',quote:'KRW',rate:amount(snapshot.fx.midRate),asOf:snapshot.fx.asOf==null?null:text(snapshot.fx.asOf,80)};if(fx.rate<=0)fail();}
  const hasUsd=positions.some(p=>p.currency==='USD');
  const data={positions,totals,fx,holdingValueKrw:hasUsd&&!fx?null:totals[0].holdingValue+totals[1].holdingValue*(fx?.rate||0),cashKnown:false,coverage:{cash:false,transactions:false,externalCashFlows:false}};
  return finalize({kind:'holdings_snapshot',status:'success',scope:'holdings_only',provider:'toss',accountId,observedAt,source:text(snapshot.source),data,errorCode:null},recordedAt);
}
export function createFailureRecord({accountId=null,observedAt=new Date().toISOString(),errorCode}={},recordedAt=new Date().toISOString()){
  return finalize({kind:'collection_failure',status:'failed',scope:'unavailable',provider:'toss',accountId:account(accountId),observedAt:date(observedAt),source:'토스증권 Open API',data:null,errorCode:failureCodes.has(errorCode)?errorCode:'upstream_failed'},recordedAt);
}
export function assertHistoryRecord(r){
  keys(r,['schemaVersion','kind','status','scope','provider','accountId','observedAt','source','data','errorCode','recordedAt','id']);
  if(r.schemaVersion!==1||r.provider!=='toss'||r.id!==fingerprint(r))fail();account(r.accountId);date(r.observedAt);date(r.recordedAt);text(r.source);
  if(r.kind==='collection_failure') {if(r.status!=='failed'||r.scope!=='unavailable'||r.data!==null||!failureCodes.has(r.errorCode))fail();return r;}
  if(r.kind!=='holdings_snapshot'||r.status!=='success'||r.scope!=='holdings_only'||r.accountId===null||r.errorCode!==null)fail();
  const d=r.data;keys(d,['positions','totals','fx','holdingValueKrw','cashKnown','coverage']);
  if(d.cashKnown!==false||!Array.isArray(d.positions)||d.positions.length>1000||!Array.isArray(d.totals)||d.totals.length!==2)fail();
  const seen=new Set();for(const p of d.positions){keys(p,['symbol','name','currency','quantity','averageCost','price','costBasis','holdingValue','unrealizedPnl']);text(p.symbol,32);text(p.name);if(!['KRW','USD'].includes(p.currency)||seen.has(p.currency+':'+p.symbol))fail();seen.add(p.currency+':'+p.symbol);for(const k of ['quantity','averageCost','price','costBasis','holdingValue'])amount(p[k]);amount(p.unrealizedPnl,true);}
  for(const [i,t] of d.totals.entries()){keys(t,['currency','holdingValue','costBasis','unrealizedPnl','cash','totalEquity']);if(t.currency!==['KRW','USD'][i]||t.cash!==null||t.totalEquity!==null)fail();for(const k of ['holdingValue','costBasis','unrealizedPnl']){amount(t[k],k==='unrealizedPnl');const rows=d.positions.filter(p=>p.currency===t.currency);if(t[k]!==rows.reduce((s,p)=>s+p[k],0))fail();}}
  if(d.fx!==null){keys(d.fx,['base','quote','rate','asOf']);if(d.fx.base!=='USD'||d.fx.quote!=='KRW'||amount(d.fx.rate)<=0)fail();if(d.fx.asOf!==null)text(d.fx.asOf,80);}
  const expected=d.positions.some(p=>p.currency==='USD')&&!d.fx?null:d.totals[0].holdingValue+d.totals[1].holdingValue*(d.fx?.rate||0);if(d.holdingValueKrw!==expected)fail();
  keys(d.coverage,['cash','transactions','externalCashFlows']);if(Object.values(d.coverage).length!==3||Object.values(d.coverage).some(v=>v!==false))fail();return r;
}
