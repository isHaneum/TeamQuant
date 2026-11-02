import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {goalProjection,futureValue,monthOf} from '../lib/goal-engine.js';
import {normalizeBook,allocationPlan,bookValue} from '../lib/allocation-planner.js';
import {createInvestmentStore} from '../lib/investment-store.js';
import {createLocalBridge} from '../lib/local-bridge.js';
const now=new Date('2026-11-02T03:00:00Z'),month='2026-11';
const fixture=()=>({label:'SYNTHETIC TEST',currency:'USD',cash:1000,fx:null,goal:{target:100000,targetMonth:'2036-11',startMonth:month,monthly:500,annualRate:.04,cashPct:10,maxPct:80,costPct:.1},assets:[{symbol:'VOO',quantity:10,price:400,priceDate:'2026-11-01',targetPct:60,lot:1,source:'SYNTHETIC'},{symbol:'BND',quantity:10,price:70,priceDate:'2026-11-01',targetPct:30,lot:1,source:'SYNTHETIC'}]});
const close=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
async function sandbox(fn){const directory=await mkdtemp(join(tmpdir(),'tq-investment-test-'));try{return await fn(directory);}finally{assert.ok(relative(resolve(tmpdir()),resolve(directory)).startsWith('tq-investment-test-'));await rm(directory,{recursive:true,force:true});}}
test('goal: zero/negative/compound rates and delayed end-month contributions',()=>{
 close(futureValue(100,10,12,0),220);close(futureValue(100,0,12,.05),105);close(futureValue(100,0,12,-.1),90);
 const r=goalProjection({current:0,target:24000,monthly:1000,startMonth:'2027-01',targetMonth:'2028-12',annualRate:0},now);
 assert.equal(r.months,25);assert.equal(r.deposits,24);close(r.projected,24000);close(r.requiredRate,0);assert.equal(r.series[1].value,0);assert.equal(r.series[2].value,1000);close(r.neededMonthly,1000);close(r.neededCurrent,0);
});
test('goal: required rate inversion, principal/growth split, missing funding and invalid dates',()=>{
 const input={current:10000,monthly:200,target:futureValue(10000,200,12,.08),startMonth:'2026-12',targetMonth:'2027-11',annualRate:.08},r=goalProjection(input,now);
 close(r.requiredRate,.08);close(r.projected,r.principal+r.assumedGrowth);close(r.series.at(-1).value,r.projected);
 assert.equal(goalProjection({...input,current:0,monthly:0},now).requiredStatus,'no_funding');
 assert.throws(()=>goalProjection({...input,targetMonth:'2026-13'},now));assert.throws(()=>goalProjection({...input,startMonth:'2028-01'},now));assert.throws(()=>futureValue(100,1,12,NaN));
 assert.equal(monthOf(new Date('2026-10-31T16:00Z')),'2026-11');
});
test('allocation: underweight ETF receives new funds, costs conserve paper wealth',()=>{
 const b=fixture(),p=allocationPlan(b,{scenario:'gap',month},now);assert.equal(p.rows[0].buyQuantity,0);assert.ok(p.rows[1].buyQuantity>0);assert.ok(p.deviationAfter<p.deviationBefore);assert.equal(p.blockers.length,0);assert.ok(p.spend<=500);
 close(p.after,p.before+p.contribution-p.fees-p.rounding);close(p.cashAfter,1000+500-p.spend);close(p.rows.reduce((s,r)=>s+r.weightAfter,0)+p.cashWeight,100);
});
test('allocation: KRW/USD conversion direction and frozen non-ETF holdings',()=>{
 const b=fixture();b.fx=1400;b.assets.push({symbol:'005930',name:'SYNTHETIC existing stock',currency:'KRW',quantity:2,price:70000,priceDate:'2026-11-01',targetPct:0,lot:1});
 close(bookValue(normalizeBook(b,now)),5800);let p=allocationPlan(b,{month},now);assert.equal(p.rows.at(-1).buyQuantity,0);close(p.rows.at(-1).valueBefore,100);
 b.currency='KRW';b.cash=1400000;b.goal.monthly=700000;close(bookValue(normalizeBook(b,now)),8120000);p=allocationPlan(b,{month},now);close(p.rows[0].unitPrice,560000);
 b.fx=null;assert.throws(()=>normalizeBook(b,now));b.fx=1400;b.assets.at(-1).targetPct=1;assert.throws(()=>normalizeBook(b,now));
});
test('allocation: inputs/target sum/lot precision/cash/date and concentration gates',()=>{
 for(const alter of [b=>b.cash=null,b=>b.goal.costPct=null,b=>b.assets[0].lot=0,b=>b.assets[0].targetPct=50,b=>b.assets[0].quantity=.00000001,b=>b.assets[0].priceDate='2026-02-30',b=>b.assets.push({...b.assets[0]}),b=>b.goal.monthly=.001]){const b=fixture();alter(b);assert.throws(()=>normalizeBook(b,now));}
 const stale=fixture();stale.assets[0].priceDate='2026-10-01';assert.ok(allocationPlan(stale,{month},now).blockers.some(x=>x.includes('7일')));
 const future=fixture();future.goal.startMonth='2027-01';assert.ok(allocationPlan(future,{month},now).blockers.some(x=>x.includes('납입 시작')));
 const concentrated=fixture();concentrated.goal.maxPct=60;concentrated.assets[0].quantity=1000;assert.ok(allocationPlan(concentrated,{month},now).blockers.length);
 const cash=fixture();cash.cash=0;cash.goal.cashPct=40;cash.assets[0].targetPct=40;cash.assets[1].targetPct=20;assert.ok(allocationPlan(cash,{month},now).blockers.some(x=>x.includes('현금')));
});
test('allocation: deterministic fractional/whole lots never overspend in 200 scenarios',()=>{
 let seed=19;const random=()=>((seed=seed*16807%2147483647)/2147483647);
 for(let i=0;i<100;i++)for(const scenario of ['gap','target']){const b=fixture();b.currency=i%2?'KRW':'USD';b.assets.forEach(a=>{a.currency=b.currency;if(b.currency==='KRW')a.symbol=a.symbol==='VOO'?'069500.KS':'360750.KS';a.quantity=Math.floor(random()*100);a.price=random()*1000+.01;a.lot=i%3?1:.001;});b.goal.monthly=Math.round(random()*500000);b.cash=Math.round(random()*100000);b.goal.costPct=random()*10;b.goal.maxPct=100;b.goal.cashPct=0;b.assets[0].targetPct=60;b.assets[1].targetPct=40;const p=allocationPlan(b,{scenario,month},now);assert.ok(p.cashAfter>=0);assert.ok(p.spend<=b.goal.monthly+1e-8);close(p.after,p.before+p.contribution-p.fees-p.rounding,.001);for(const r of p.rows)close(r.buyQuantity/r.lot,Math.round(r.buyQuantity/r.lot),1e-5);}
});
test('store: create/approve/execute/restart preserves quantities, idempotency and immutable approval',async()=>sandbox(async directory=>{
 const s=createInvestmentStore({directory,env:{},now:()=>now});let b=await s.create({draft:fixture()});let p=await s.preview({id:b.id,revision:b.revision,scenario:'gap',month});assert.equal(p.rows[1].buyQuantity,7);
 const approved=await s.approve({id:b.id,revision:b.revision,scenario:'gap',month,reason:'SYNTHETIC underweight correction'});assert.equal(approved.book.revision,2);assert.equal(approved.approval.goalVersion.length,64);
 const result=await s.execute({id:b.id,revision:2,approvalId:approved.approval.id});assert.equal(result.book.executions.length,1);assert.equal(result.book.assets[1].quantity,17);const retry=await s.execute({id:b.id,revision:2,approvalId:approved.approval.id});assert.equal(retry.replayed,true);assert.equal(retry.execution.id,result.execution.id);
 const reloaded=await createInvestmentStore({directory,env:{},now:()=>now}).load(b.id);assert.equal(reloaded.cash,result.book.cash);assert.equal(reloaded.approvals[0].plan.rows[1].quantityBefore,10);assert.equal((await s.list()).books[0].executionCount,1);
 await assert.rejects(s.approve({id:b.id,revision:3,scenario:'target',month,reason:'duplicate month'}));
 const later=createInvestmentStore({directory,env:{},now:()=>new Date('2026-12-02T03:00Z')});b=await later.load(b.id);const draft={...b,assets:b.assets.map(a=>({...a,priceDate:'2026-12-01'}))};b=await later.update({id:b.id,revision:b.revision,draft});p=await later.preview({id:b.id,revision:b.revision,scenario:'gap',month:'2026-12'});assert.equal(p.rows[1].quantityBefore,17);assert.equal(p.before,bookValue(b));
}));
test('store: revision, stale approval, quantity edits and missing approval are rejected',async()=>sandbox(async directory=>{
 const s=createInvestmentStore({directory,env:{},now:()=>now}),b=await s.create({draft:fixture()}),a=await s.approve({id:b.id,revision:1,scenario:'gap',month,reason:'test'});
 await assert.rejects(s.execute({id:b.id,revision:1,approvalId:a.approval.id}));
 await assert.rejects(s.update({id:b.id,revision:2,draft:{...a.book,assets:a.book.assets.map(x=>({...x,quantity:2}))}}));
 const updated=await s.update({id:b.id,revision:2,draft:{...a.book,goal:{...a.book.goal,monthly:600}}});
 await assert.rejects(s.execute({id:b.id,revision:updated.revision,approvalId:a.approval.id}));await assert.rejects(s.load('../other'));await assert.rejects(s.execute({id:b.id,revision:updated.revision,approvalId:'none'}));
}));
test('store: simultaneous executions cannot double count one monthly contribution',async()=>sandbox(async directory=>{
 const s=createInvestmentStore({directory,env:{},now:()=>now}),b=await s.create({draft:fixture()}),a=await s.approve({id:b.id,revision:1,scenario:'gap',month,reason:'test'}),body={id:b.id,revision:2,approvalId:a.approval.id};
 const result=await Promise.allSettled([s.execute(body),s.execute(body)]);assert.ok(result.some(x=>x.status==='fulfilled'));assert.equal((await s.load(b.id)).executions.length,1);assert.equal((await readdir(directory)).filter(x=>x.endsWith('.lock')).length,0);
}));
test('store: future monthly deposit cannot be approved; expired approval cannot execute',async()=>sandbox(async directory=>{
 const s=createInvestmentStore({directory,env:{},now:()=>now}),draft=fixture();draft.goal.startMonth='2027-01';const b=await s.create({draft});await assert.rejects(s.approve({id:b.id,revision:1,scenario:'gap',month,reason:'test'}));
 const c=await s.create({draft:fixture()}),a=await s.approve({id:c.id,revision:1,scenario:'gap',month,reason:'test'}),later=createInvestmentStore({directory,env:{},now:()=>new Date('2026-12-02')});await assert.rejects(later.execute({id:c.id,revision:2,approvalId:a.approval.id}));
}));
test('store: cloud/public directory and corrupt originals fail closed',async()=>sandbox(async directory=>{
 await assert.rejects(createInvestmentStore({directory,env:{VERCEL:'1'}}).list());await assert.rejects(createInvestmentStore({directory,env:{},publicRoots:[tmpdir()]}).list());
 const s=createInvestmentStore({directory,env:{},now:()=>now}),b=await s.create({draft:fixture()}),path=join(directory,b.id+'.investment.json');await writeFile(path,'broken');await assert.rejects(s.load(b.id));assert.equal(await readFile(path,'utf8'),'broken');
}));
test('bridge: planner needs local/paired authorization but not a broker snapshot/key',async()=>sandbox(async directory=>{
 const store=createInvestmentStore({directory,env:{},now:()=>now}),bridge=createLocalBridge({port:8779,investments:store,env:{}}),req={method:'POST',headers:{host:'127.0.0.1:8779',origin:'http://127.0.0.1:8779','x-teamquant-action':'bridge-local'}};
 const r=await bridge.handle(req,'investment-create',{draft:fixture()});assert.equal(r.status,200);assert.equal((await bridge.handle({...req,headers:{...req.headers,origin:'https://teamquant.vercel.app'}},'investment-list')).status,401);
 assert.equal((await bridge.handle({...req,headers:{...req.headers,origin:'https://untrusted.example'}},'investment-list')).status,403);assert.equal((await bridge.handle(req,'investment-unknown')).status,404);
}));


test('store: goal-only private intent is separate from an executable allocation',async()=>sandbox(async directory=>{
 const s=createInvestmentStore({directory,env:{},now:()=>now});assert.deepEqual(await s.intent(),{goal:null});
 const goal={target:100000,monthly:500,startMonth:'2027-01',targetMonth:'2028-12'};
 await s.saveIntent(goal);assert.deepEqual(await s.intent(),{goal});assert.equal((await s.list()).books.length,0);
 await assert.rejects(s.saveIntent({...goal,monthly:999}));assert.deepEqual(await s.intent(),{goal});
}));
