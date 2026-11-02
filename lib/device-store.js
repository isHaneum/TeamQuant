import {mkdir,readFile,writeFile,access,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {randomBytes,createPublicKey} from 'node:crypto';
import {historyDirectory} from './history-store.js';

export function createDeviceStore({directory=join(historyDirectory(),'devices'),publicRoots=[],env=process.env,now=()=>Date.now()}={}){
 const root=resolve(directory);
 function guard(){if(env.VERCEL||publicRoots.some(p=>{const r=relative(resolve(p),root);return !r||(!r.startsWith('..')&&!isAbsolute(r));}))throw new Error('Private device storage required');}
 async function get(id){guard();if(!/^[a-f0-9]{64}$/.test(id||''))return null;try{await access(join(root,id+'.revoked'));return null;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{const raw=await readFile(join(root,id+'.device.json'));if(raw.length>4096)return null;const d=JSON.parse(raw);return d.id===id&&d.expiresAt>now()?d:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 return {get,
  async register({profile,origin,publicKey}){guard();if(!/^[a-z0-9가-힣_-]{2,24}$/.test(profile||'')||origin!=='https://teamquant.vercel.app'||publicKey?.d||publicKey?.kty!=='EC'||publicKey?.crv!=='P-256'||![publicKey.x,publicKey.y].every(x=>/^[\w-]{43}$/.test(x||'')))throw new Error('Invalid device');
   const key={kty:'EC',crv:'P-256',x:publicKey.x,y:publicKey.y};createPublicKey({key,format:'jwk'});
   await mkdir(root,{recursive:true,mode:0o700});const names=await readdir(root);if(names.length>200)throw new Error('Device limit');
   const d={id:randomBytes(32).toString('hex'),profile,origin,publicKey:key,expiresAt:now()+30*86400000};await writeFile(join(root,d.id+'.device.json'),JSON.stringify(d),{flag:'wx',mode:0o600});return d;},
  async revoke(id){guard();if(!/^[a-f0-9]{64}$/.test(id||''))return;try{await writeFile(join(root,id+'.revoked'),'revoked',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}},
  async revokeAll(){guard();let names;try{names=await readdir(root);}catch(e){if(e.code==='ENOENT')return;throw e;}for(const name of names)if(/^[a-f0-9]{64}\.device\.json$/.test(name))await this.revoke(name.slice(0,64));}
 };
}
