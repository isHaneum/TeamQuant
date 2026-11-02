import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeviceStore} from '../lib/device-store.js';
import {createLocalBridge} from '../lib/local-bridge.js';
test('browser client pairs once, reconnects after module reload/server restart and revocation blocks reads',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tq-client-'));
 globalThis.location={hostname:'teamquant.vercel.app',origin:'https://teamquant.vercel.app'};
 globalThis.sessionStorage={getItem:()=> 'synthetic'};globalThis.window=new EventTarget();globalThis.__qaDevices=new Map();
 const local={method:'POST',headers:{host:'127.0.0.1:8766',origin:'http://127.0.0.1:8766','x-teamquant-action':'bridge-local'}};
 const make=()=>createLocalBridge({port:8766,env:{},devices:createDeviceStore({directory,env:{}}),readHoldings:async()=>({positions:[],synthetic:true})});let bridge=make(),codes=0;
 globalThis.fetch=async(url,options)=>{const path=url.split('/').at(-1);if(path==='pair')codes++;const r=await bridge.handle({method:'POST',headers:{host:'127.0.0.1:8766',origin:location.origin,authorization:options.headers.Authorization}},path,JSON.parse(options.body));return {ok:r.status===200,status:r.status,json:async()=>r.body};};
 // IndexedDB persistence is separately exercised in the browser. Keep the actual signing implementation here.
 const trusted=await readFile(new URL('../lib/trusted-device.js',import.meta.url),'utf8');
 const helper="export async function deviceRecord(p,v){if(v===undefined)return globalThis.__qaDevices.get(p);if(v===null)globalThis.__qaDevices.delete(p);else globalThis.__qaDevices.set(p,v);}\n"+trusted.slice(trusted.indexOf('export async function newDevice'));
 const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const source=(await readFile(new URL('../bridge-client.js',import.meta.url),'utf8')).replace("'./lib/trusted-device.js'",JSON.stringify(uri(helper)));
 const first=await import(uri(source)+'#first');
 const code=(await bridge.handle(local,'challenge')).body.code;await first.pairPrivatePc(code,true);assert.equal((await first.privateRead('holdings')).synthetic,true);
 await first.closePrivateSession();bridge=make();
 const second=await import(uri(source)+'#reload');assert.equal((await second.privateRead('holdings')).synthetic,true);assert.equal(codes,1);
 await second.privateRead('device-forget');await second.closePrivateSession();await assert.rejects(()=>second.privateRead('holdings'));assert.equal(codes,1);
});
