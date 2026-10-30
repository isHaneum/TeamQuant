import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createHoldingsRecord,createFailureRecord} from '../lib/history-model.js';
import {createHistoryStore,historyDirectory} from '../lib/history-store.js';
import {createHistoryRecorder} from '../lib/history-recorder.js';
import {createTossReader} from '../lib/toss.js';

const observedAt='2026-10-30T01:00:00.000Z',recordedAt='2026-10-30T01:00:01.000Z';
const context={clientId:'test-client-private',accountRef:'test-account-private'};
const snapshot=(change={})=>({fetchedAt:observedAt,source:'토스증권 Open API',cashKnown:false,accountNo:'MUST-NOT-PERSIST',clientSecret:'MUST-NOT-PERSIST',positions:[{symbol:'AAPL',name:'Example',currency:'USD',quantity:.5,avgCost:100,price:80,cost:50,value:40,pnl:-10}],fx:null,...change});
async function temp(t){const directory=await mkdtemp(join(tmpdir(),'teamquant-history-test-'));t.after(async()=>{const abs=resolve(directory);assert.equal(dirname(abs).toLowerCase(),resolve(tmpdir()).toLowerCase());assert.ok(basename(abs).startsWith('teamquant-history-test-'));await rm(abs,{recursive:true,force:true});});return directory;}
async function setup(t){const directory=await temp(t),store=createHistoryStore({directory,env:{}}),accountId=await store.accountId(context);return {directory,store,accountId};}

test('holding-only records retain fractions, losses and unknown cash/FX without fabricating equity',async t=>{
 const {accountId}=await setup(t),r=createHoldingsRecord(snapshot(),{accountId,recordedAt});assert.equal(r.scope,'holdings_only');assert.equal(r.data.positions[0].quantity,.5);assert.equal(r.data.totals[1].unrealizedPnl,-10);assert.equal(r.data.totals[1].cash,null);assert.equal(r.data.totals[1].totalEquity,null);assert.equal(r.data.holdingValueKrw,null);assert.ok(!JSON.stringify(r).includes('MUST-NOT-PERSIST'));
 const withFx=createHoldingsRecord(snapshot({fx:{midRate:1300,asOf:observedAt}}),{accountId,recordedAt});assert.equal(withFx.data.holdingValueKrw,52000);const dated=createHoldingsRecord(snapshot({fx:{midRate:1300,asOf:'2026-10-30'}}),{accountId,recordedAt});assert.equal(dated.data.fx.asOf,'2026-10-30');assert.equal(withFx.data.coverage.externalCashFlows,false);
 for(const bad of [snapshot({cashKnown:true}),snapshot({positions:[{...snapshot().positions[0],price:NaN}]}),snapshot({positions:[...snapshot().positions,...snapshot().positions]}),snapshot({fetchedAt:'bad'})])assert.throws(()=>createHoldingsRecord(bad,{accountId,recordedAt}));
});
test('failure observations contain no valuation and sanitize vendor errors',()=>{const r=createFailureRecord({observedAt,errorCode:'credential-secret-value'},recordedAt);assert.equal(r.status,'failed');assert.equal(r.data,null);assert.equal(r.accountId,null);assert.equal(r.errorCode,'upstream_failed');assert.ok(!JSON.stringify(r).includes('credential-secret-value'));});
test('local history survives restart, partitions real owners and never stores raw identifiers',async t=>{
 const {directory,store,accountId}=await setup(t);await store.append(createHoldingsRecord(snapshot(),{accountId,recordedAt}));const restarted=createHistoryStore({directory,env:{}});assert.equal(await restarted.accountId(context),accountId);const other=await restarted.accountId({...context,clientId:'different-user'});assert.notEqual(other,accountId);assert.equal((await restarted.list({accountId:other})).records.length,0);assert.equal((await restarted.list({accountId})).records.length,1);
 const files=await readdir(join(directory,'records'));const content=await readFile(join(directory,'records',files[0]),'utf8');for(const s of [...Object.values(context),'MUST-NOT-PERSIST'])assert.ok(!content.includes(s));
});
test('concurrent duplicate writes are immutable and keep the first recorded time',async t=>{
 const {store,accountId}=await setup(t),r=createHoldingsRecord(snapshot(),{accountId,recordedAt});const writes=await Promise.all(Array.from({length:12},()=>store.append(r)));assert.equal(writes.filter(x=>x.inserted).length,1);const later=createHoldingsRecord(snapshot(),{accountId,recordedAt:'2026-10-30T02:00:00Z'});assert.equal(later.id,r.id);assert.equal((await store.append(later)).record.recordedAt,recordedAt);assert.equal((await store.list()).records.length,1);
});
test('incomplete temporary files are ignored; corruption and tampering are never replaced by zeros',async t=>{
 const {directory,store,accountId}=await setup(t),r=createHoldingsRecord(snapshot(),{accountId,recordedAt});await store.append(r);await writeFile(join(directory,'records','.tmp-interrupted'),'partial');assert.equal((await store.list()).records.length,1);await assert.rejects(()=>store.append({...r,clientSecret:'secret'}));await writeFile(join(directory,'records',r.id+'.history.json'),'{broken');await assert.rejects(()=>store.list(),e=>e.code==='history_record_corrupt'&&!e.message.includes('broken'));assert.equal(await readFile(join(directory,'records',r.id+'.history.json'),'utf8'),'{broken');
});
test('cloud/public directory guards run before writing; default storage is user data',async t=>{
 const directory=await temp(t),blocked=join(directory,'not-created');for(const store of [createHistoryStore({directory:blocked,env:{VERCEL:'1'}}),createHistoryStore({directory:blocked,env:{},publicRoots:[directory]})])await assert.rejects(()=>store.accountId(context));await assert.rejects(()=>access(blocked));assert.equal(historyDirectory({LOCALAPPDATA:directory}),resolve(directory,'TeamQuant','portfolio-history'));
});
test('history queries filter accounts/dates and explicitly flag pagination',async t=>{
 const {store,accountId}=await setup(t);for(let i=1;i<=3;i++)await store.append(createHoldingsRecord(snapshot({fetchedAt:`2026-10-${26+i}T00:00:00Z`}),{accountId,recordedAt}));const r=await store.list({accountId,limit:2});assert.equal(r.records.length,2);assert.equal(r.hasMore,true);assert.ok(r.records[0].observedAt>r.records[1].observedAt);assert.equal((await store.list({from:'2026-10-28',to:'2026-10-28T23:59:59Z'})).records.length,1);for(const args of [{limit:0},{from:'invalid'},{from:'2026-10-30',to:'2026-10-20'},{accountId:'../private'}])await assert.rejects(()=>store.list(args));
});
test('reader integration records two successful observations and a failed collection separately',async t=>{
 const {store}=await setup(t),recorder=createHistoryRecorder({store,now:()=>recordedAt});let time=Date.parse(observedAt),fail=false;
 const reader=createTossReader({onSnapshot:recorder.snapshot,onFailure:recorder.failure,now:()=>time,credentials:async()=>({clientId:context.clientId,clientSecret:'fake-secret'}),fetchImpl:async url=>{if(fail&&url.endsWith('/holdings'))return {ok:false,status:403,json:async()=>({error:'private-vendor-error'})};const payload=url.endsWith('/oauth2/token')?{access_token:'fake-token',expires_in:86400}:url.endsWith('/accounts')?{result:[{accountType:'BROKERAGE',accountSeq:1,accountNo:'DO-NOT-STORE'}]}:{result:{items:[{symbol:'005930',name:'Example',currency:'KRW',quantity:'1',averagePurchasePrice:'100',lastPrice:'120',marketValue:{purchaseAmount:'100',amount:'120'},profitLoss:{amount:'20',rate:'.2'}}]}};return {ok:true,json:async()=>payload};}});
 const first=await reader();assert.equal(first.localHistory.saved,true);time+=300000;await reader();fail=true;await assert.rejects(reader(),e=>e.code==='ip_not_allowed');const records=(await store.list()).records;assert.equal(records.filter(x=>x.status==='success').length,2);assert.equal(records.filter(x=>x.status==='failed').length,1);assert.ok(records.find(x=>x.status==='failed').data===null);assert.ok(!JSON.stringify(records).includes('DO-NOT-STORE'));assert.ok(!JSON.stringify(first).includes(context.clientId));
});
test('storage failure is visible without discarding successful broker data',async()=>{const r=createHistoryRecorder({store:{accountId:async()=>{throw new Error('private path and secret');}}});assert.deepEqual(await r.snapshot(snapshot(),context),{saved:false,scope:'holdings_only',code:'local_history_unavailable'});assert.equal(await r.failure(new Error('private'),context),false);});
