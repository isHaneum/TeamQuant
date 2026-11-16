import {mkdir,readFile,readdir,open,link,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {HistoryError,assertHistoryRecord} from './history-model.js';

export function historyDirectory(env=process.env){
  return resolve(env.TEAMQUANT_HISTORY_DIR||join(env.LOCALAPPDATA||env.XDG_DATA_HOME||join(homedir(),'.local','share'),'TeamQuant','portfolio-history'));
}
const inside=(parent,child)=>{const r=relative(resolve(parent),resolve(child));return r===''||(!r.startsWith('..')&&!isAbsolute(r));};
// 2026-11-16: vault(lib/vault.js)를 넘기면 기록과 가명 키(.identity-salt)를 암호화해 쓴다(용도 history/record · history/identity-salt). 평문 파일도 그대로 읽는다.
export function createHistoryStore({directory=historyDirectory(),env=process.env,publicRoots=[],maxRecordBytes=1_000_000,vault=null}={}){
  const root=resolve(directory),records=join(root,'records');let ready;
  const dec=(bytes,purpose)=>vault?vault.decode(bytes,purpose).bytes:bytes,enc=(bytes,purpose)=>vault?vault.seal(purpose,bytes):bytes;
  function guard(){if(env.VERCEL)throw new HistoryError('cloud_history_forbidden');if(publicRoots.some(p=>inside(p,root)))throw new HistoryError('public_history_directory');}
  async function atomic(target,bytes){
    const temp=join(root,'.tmp-'+randomUUID());let handle;
    try{handle=await open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;try{await link(temp,target);return true;}catch(e){if(e.code!=='EEXIST')throw e;return false;}}
    finally{if(handle)await handle.close().catch(()=>{});await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async function init(){guard();if(!ready)ready=(async()=>{await mkdir(records,{recursive:true,mode:0o700});const secretFile=join(root,'.identity-salt');await atomic(secretFile,enc(randomBytes(32),'history/identity-salt'));const salt=dec(await readFile(secretFile),'history/identity-salt');if(salt.length!==32)throw new HistoryError('history_identity_corrupt');return salt;})().catch(e=>{ready=null;throw e;});return ready;}
  async function read(id){guard();if(!/^[a-f0-9]{64}$/.test(id))throw new HistoryError();const content=await readFile(join(records,id+'.history.json'));if(content.length>maxRecordBytes+256)throw new HistoryError('history_record_too_large');try{return assertHistoryRecord(JSON.parse(dec(content,'history/record').toString('utf8')));}catch{throw new HistoryError('history_record_corrupt');}}
  return {
    async accountId({clientId,accountRef,provider='toss'}={}){if(provider!=='toss'||typeof clientId!=='string'||!clientId||typeof accountRef!=='string'||!accountRef)throw new HistoryError('history_account_unknown');const salt=await init();return 'acct_'+createHmac('sha256',salt).update(JSON.stringify([provider,clientId,accountRef])).digest('hex');},
    async append(record){guard();assertHistoryRecord(record);const bytes=Buffer.from(JSON.stringify(record));if(bytes.length>maxRecordBytes)throw new HistoryError('history_record_too_large');await init();const inserted=await atomic(join(records,record.id+'.history.json'),enc(bytes,'history/record'));const saved=inserted?record:await read(record.id);return {inserted,record:saved};},
    async list({accountId,limit=100,from,to}={}){guard();if(!Number.isInteger(limit)||limit<1||limit>1000||accountId!==undefined&&!/^acct_[a-f0-9]{64}$/.test(accountId))throw new HistoryError();for(const d of [from,to])if(d!==undefined&&!Number.isFinite(Date.parse(d)))throw new HistoryError();if(from&&to&&Date.parse(from)>Date.parse(to))throw new HistoryError();await init();const names=await readdir(records),all=[];for(const name of names){if(!/^[a-f0-9]{64}\.history\.json$/.test(name))continue;const r=await read(name.slice(0,-13));if((accountId===undefined||r.accountId===accountId)&&(!from||Date.parse(r.observedAt)>=Date.parse(from))&&(!to||Date.parse(r.observedAt)<=Date.parse(to)))all.push(r);}all.sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||b.id.localeCompare(a.id));return {records:all.slice(0,limit),hasMore:all.length>limit};}
  };
}
