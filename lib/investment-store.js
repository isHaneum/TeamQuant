import {mkdir,readFile,readdir,open,rename,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {historyDirectory} from './history-store.js';
import {PlanError,monthOf,number,depositCount} from './goal-engine.js';
import {normalizeBook,allocationPlan} from './allocation-planner.js';
const inside=(parent,child)=>{const r=relative(resolve(parent),resolve(child));return !r||!r.startsWith('..')&&!isAbsolute(r);};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export function createInvestmentStore({directory=join(historyDirectory(),'investments'),env=process.env,publicRoots=[],now=()=>new Date()}={}){
 const root=resolve(directory);const date=()=>new Date(now());
 function guard(){if(env.VERCEL||publicRoots.some(p=>inside(p,root)))throw new PlanError('모의 장부는 공개 폴더와 Vercel에 저장할 수 없습니다.');}
 async function init(){guard();await mkdir(root,{recursive:true,mode:0o700});}
 function path(id){if(!validId(id))throw new PlanError('장부 ID가 올바르지 않습니다.');return join(root,id+'.investment.json');}
 async function load(id){guard();const bytes=await readFile(path(id));if(bytes.length>2_000_000)throw new PlanError('장부 크기 제한을 넘었습니다.');let b;try{b=JSON.parse(bytes);}catch{throw new PlanError('장부 JSON을 읽을 수 없습니다. 원본은 유지됩니다.');}if(b.schema!==1||b.id!==id||!Number.isInteger(b.revision)||!Array.isArray(b.executions)||!Array.isArray(b.approvals)||!Array.isArray(b.assets)||!Number.isFinite(b.cash)||b.cash<0)throw new PlanError('장부 형식을 확인하십시오. 원본은 유지됩니다.');return b;}
 async function write(b){const bytes=JSON.stringify(b);if(Buffer.byteLength(bytes)>2_000_000)throw new PlanError('장부 기록 한도를 넘었습니다. 새 장부를 생성하십시오.');const temp=join(root,'.investment-'+randomUUID()+'.tmp');let f;try{f=await open(temp,'wx',0o600);await f.writeFile(bytes);await f.sync();await f.close();f=null;await rename(temp,path(b.id));}finally{await f?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 async function locked(id,fn){await init();path(id);let lock;try{lock=await open(join(root,id+'.lock'),'wx',0o600);}catch(e){if(e.code==='EEXIST'){const error=new PlanError('다른 작업이 장부를 갱신 중입니다. 잠시 후 다시 시도하십시오.');error.status=409;throw error;}throw e;}try{return await fn();}finally{await lock.close();await unlink(join(root,id+'.lock'));}}
 function current(b,revision){if(b.revision!==revision){const e=new PlanError('장부가 변경되었습니다. 다시 불러와 계산하십시오.');e.status=409;throw e;}}
 function preview(b,body){current(b,body.revision);return allocationPlan(b,{scenario:body.scenario,month:body.month},date());}
 return {
  async intent(){await init();try{const bytes=await readFile(join(root,'planning-intent.json'));if(bytes.length>2000)throw new PlanError('목표 초안 파일을 확인하십시오.');return JSON.parse(bytes);}catch(e){if(e.code==='ENOENT')return {goal:null};throw e;}},
  async saveIntent({target,monthly,startMonth,targetMonth}){await init();number(target,'목표 자산',1);number(monthly,'월 납입액');depositCount(startMonth,targetMonth,date());const goal={target,monthly,startMonth,targetMonth};const f=await open(join(root,'planning-intent.json'),'wx',0o600);try{await f.writeFile(JSON.stringify({goal}));await f.sync();}finally{await f.close();}return {saved:true};},
  async list(){await init();const names=(await readdir(root)).filter(n=>/^[a-f0-9-]+\.investment\.json$/.test(n));if(names.length>200)throw new PlanError('장부가 200개를 초과했습니다. PC 파일을 정리하십시오.');const books=[];for(const n of names){const b=await load(n.slice(0,-16));books.push({id:b.id,label:b.label,currency:b.currency,revision:b.revision,updatedAt:b.updatedAt,executionCount:b.executions.length});}return {books:books.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};},
  load,
  async create({draft}){await init();const id=randomUUID();return locked(id,async()=>{const b={...normalizeBook(draft,date()),schema:1,id,revision:1,createdAt:date().toISOString(),updatedAt:date().toISOString(),approvals:[],executions:[],settingsHistory:[]};b.settingsHistory.push({revision:1,goal:b.goal,fx:b.fx,assets:b.assets,at:b.createdAt});await write(b);return b;});},
  async update(body){return locked(body.id,async()=>{const b=await load(body.id);current(b,body.revision);if(b.settingsHistory.length>=240)throw new PlanError('설정 변경 기록 한도입니다. 새 장부를 생성하십시오.');const draft=normalizeBook({...body.draft,currency:b.currency,cash:b.cash,origin:b.origin},date());
   for(const a of b.assets){const next=draft.assets.find(x=>x.symbol===a.symbol);if(a.quantity>0&&(!next||next.quantity!==a.quantity))throw new PlanError('기존 장부 수량은 모의 실행으로만 변경됩니다. 새 장부를 만들면 별도 시작할 수 있습니다.');}
   for(const a of draft.assets)if(a.quantity!==(b.assets.find(x=>x.symbol===a.symbol)?.quantity||0))throw new PlanError('추가 상품의 시작 수량은 0이어야 합니다.');
   Object.assign(b,draft,{revision:b.revision+1,updatedAt:date().toISOString()});b.settingsHistory.push({revision:b.revision,goal:b.goal,fx:b.fx,assets:b.assets,at:b.updatedAt});await write(b);return b;
  });},
  async preview(body){return preview(await load(body.id),body);},
  async approve(body){return locked(body.id,async()=>{const b=await load(body.id),plan=preview(b,body);if(b.executions.some(e=>e.month===plan.month))throw new PlanError('이 장부의 이번 달 납입·모의 실행은 이미 기록되었습니다.');if(plan.blockers.length)throw new PlanError(plan.blockers.join(' '));if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)throw new PlanError('승인 이유를 1~500자로 입력하십시오.');if(b.approvals.length>=1200)throw new PlanError('승인 기록 한도입니다. 새 장부를 생성하십시오.');
   b.revision++;const approval={id:randomUUID(),revision:b.revision,goalVersion:hash({goal:b.goal,fx:b.fx,assets:b.assets}),planHash:hash(plan),plan,reason:body.reason.trim(),at:date().toISOString()};b.approvals.push(approval);b.updatedAt=approval.at;await write(b);return {book:b,approval};
  });},
  async execute(body){return locked(body.id,async()=>{const b=await load(body.id),prior=b.executions.find(x=>x.approvalId===body.approvalId);if(prior)return {book:b,execution:prior,replayed:true};current(b,body.revision);const a=b.approvals.find(x=>x.id===body.approvalId&&x.revision===b.revision);if(!a)throw new PlanError('현재 장부에 대한 승인이 필요합니다.');if(a.plan.month!==monthOf(date())||b.executions.some(x=>x.month===a.plan.month))throw new PlanError('승인 월이 바뀌었거나 이미 납입을 실행했습니다.');
   const plan=allocationPlan(b,{scenario:a.plan.scenario,month:a.plan.month},date());if(plan.blockers.length||hash(plan)!==a.planHash)throw new PlanError('승인 후 계산 조건이 변경되었습니다. 다시 계산하고 승인하십시오.');
   b.cash=plan.cashAfter;for(const asset of b.assets)asset.quantity=plan.rows.find(r=>r.symbol===asset.symbol).quantityAfter;b.revision++;b.updatedAt=date().toISOString();const execution={id:randomUUID(),approvalId:a.id,goalVersion:a.goalVersion,month:plan.month,at:b.updatedAt,kind:'PAPER_ONLY',contribution:plan.contribution,plan,reason:a.reason};b.executions.push(execution);await write(b);return {book:b,execution,replayed:false};
  });}
 };
}
