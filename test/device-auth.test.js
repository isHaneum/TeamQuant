import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {createDeviceStore} from '../lib/device-store.js';
import {createLocalBridge} from '../lib/local-bridge.js';
const local={method:'POST',headers:{host:'127.0.0.1:8766',origin:'http://127.0.0.1:8766','x-teamquant-action':'bridge-local'}};
const remote={method:'POST',headers:{host:'127.0.0.1:8766',origin:'https://teamquant.vercel.app'}};
test('remembered WebCrypto proof survives server restart, rejects replay, wrong profile, expiry and revocation',async()=>{
 let time=Date.now();const directory=await mkdtemp(join(tmpdir(),'tq-device-'));
 const store=()=>createDeviceStore({directory,env:{},now:()=>time});
 const make=()=>createLocalBridge({port:8766,env:{},now:()=>time,devices:store(),readHoldings:async()=>({positions:[]})});
 let b=make();const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 assert.equal(keys.privateKey.extractable,false);await assert.rejects(()=>webcrypto.subtle.exportKey('jwk',keys.privateKey));
 const publicKey=await webcrypto.subtle.exportKey('jwk',keys.publicKey);
 assert.equal((await b.handle(remote,'pair',{remember:true,profile:'tester',publicKey,code:'123456'})).status,410);
 const code=(await b.handle(local,'challenge')).body.code;
 const paired=await b.handle(remote,'pair',{code,remember:true,profile:'tester',publicKey});assert.equal(paired.status,200);
 const body={deviceId:paired.body.deviceId,profile:'tester'};b=make();
 assert.equal((await b.handle(remote,'device-challenge',{...body,profile:'other'})).status,401);
 async function proof(){const c=await b.handle(remote,'device-challenge',body);assert.equal(c.status,200);const signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,Buffer.from(c.body.message))).toString('base64url');return {...body,nonce:JSON.parse(c.body.message).nonce,signature};}
 const forged=await proof();assert.equal((await b.handle(remote,'device-login',{...forged,signature:'a'.repeat(86)})).status,401);assert.equal((await b.handle(remote,'device-login',forged)).status,401);
 const expired=await proof();time+=60001;assert.equal((await b.handle(remote,'device-login',expired)).status,401);
 const valid=await proof(),login=await b.handle(remote,'device-login',valid);assert.equal(login.status,200);assert.equal((await b.handle(remote,'device-login',valid)).status,401);
 const auth={...remote,headers:{...remote.headers,authorization:'Bearer '+login.body.token}};
 assert.equal((await b.handle(auth,'holdings')).status,200);
 assert.equal((await b.handle(auth,'devices-revoke-all')).status,403);
 assert.equal((await b.handle(auth,'device-forget')).status,200);assert.equal((await b.handle(auth,'holdings')).status,401);assert.equal((await make().handle(remote,'device-challenge',body)).status,401);
 const c=(await b.handle(local,'challenge')).body.code;const p=await b.handle(remote,'pair',{code:c,remember:true,profile:'tester',publicKey});time+=30*86400000+1;assert.equal((await b.handle(remote,'device-challenge',{...body,deviceId:p.body.deviceId})).status,401);
 assert.equal((await b.handle(local,'disconnect')).status,200);
});
test('device store refuses private keys, public directory and cloud persistence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tq-device-guard-'));const d={profile:'tester',origin:remote.headers.origin,publicKey:{kty:'EC',crv:'P-256',d:'secret'}};
 await assert.rejects(()=>createDeviceStore({directory,env:{}}).register(d));
 await assert.rejects(()=>createDeviceStore({directory,publicRoots:[directory],env:{}}).get('a'.repeat(64)));
 await assert.rejects(()=>createDeviceStore({directory,env:{VERCEL:'1'}}).get('a'.repeat(64)));
});
