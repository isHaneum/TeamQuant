import {mkdir,open,link,unlink,readdir,readFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {historyDirectory} from './history-store.js';
import {parsePerformanceInput,fail} from './performance-import.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createPerformanceStore({directory=historyDirectory(),env=process.env,publicRoots=[]}={}){
 const root=resolve(directory),dir=join(root,'performance'),archive=join(dir,'archive');let pending=Promise.resolve();
 function guard(){if(env.VERCEL)fail('성과 자료는 Vercel에 저장할 수 없습니다.');for(const p of publicRoots){const r=relative(resolve(p),root);if(r===''||(!r.startsWith('..')&&!isAbsolute(r)))fail('저장 위치는 프로젝트 밖이어야 합니다.');}}
 const idCheck=id=>{if(!/^[a-f0-9]{64}$/.test(id))fail('자료 id 오류');};
 async function init(){guard();await mkdir(archive,{recursive:true,mode:0o700});}
 async function load(id,archived=false){guard();idCheck(id);try{const content=await readFile(join(archived?archive:dir,id+'.performance.json'));if(content.length>4_000_000)fail('저장 자료 크기 초과');const r=JSON.parse(content);if(r.schemaVersion!==1||r.id!==id||hash(r.dataset)!==id||r.dataset.source!=='user_csv')fail('자료 검증 오류');return r;}catch{fail('PC의 성과 자료를 읽지 못했습니다. 원본은 덮어쓰지 않았습니다.');}}
 async function save(input){guard();const dataset=parsePerformanceInput(input);const id=hash(dataset),record={schemaVersion:1,id,importedAt:new Date().toISOString(),dataset};const raw=Buffer.from(JSON.stringify(record));if(raw.length>4_000_000)fail('저장 자료 크기 초과');await init();const temp=join(dir,'.tmp-'+randomUUID());let h;try{h=await open(temp,'wx',0o600);await h.writeFile(raw);await h.sync();await h.close();h=null;try{await link(temp,join(dir,id+'.performance.json'));}catch(e){if(e.code!=='EEXIST')throw e;}return await load(id);}finally{if(h)await h.close().catch(()=>{});await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
 return {
  import(input){const next=pending.then(()=>save(input));pending=next.catch(()=>{});return next;},load,
  async list({archived=false}={}){await init();const rows=[];for(const file of await readdir(archived?archive:dir)){if(!/^[a-f0-9]{64}\.performance\.json$/.test(file))continue;const r=await load(file.slice(0,-17),archived);rows.push({id:r.id,label:r.dataset.label,currency:r.dataset.currency,importedAt:r.importedAt,start:r.dataset.valuations[0].at,end:r.dataset.valuations.at(-1).at,complete:r.dataset.complete});}return rows.sort((a,b)=>b.importedAt.localeCompare(a.importedAt));},
  async archive(id,restore=false){await init();idCheck(id);await load(id,!restore?false:true);const source=join(restore?archive:dir,id+'.performance.json'),target=join(restore?dir:archive,id+'.performance.json');try{await link(source,target);}catch{fail('대상에 동일 자료가 있거나 파일 이동에 실패했습니다. 원본은 유지됩니다.');}await unlink(source);return {archived:!restore};}
 };
}
