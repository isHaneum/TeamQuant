import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {localStatus} from '../lib/local-status.js';
import {probeLocalServer,ensureLocalServer} from '../lib/local-launcher.js';
import {createLocalBridge} from '../lib/local-bridge.js';

test('status exposes file availability only, without reading or returning credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tq-connect-test-'));
 try{
  const path=join(dir,'fixture.key');await writeFile(path,'SYNTHETIC_SECRET_MUST_NOT_LEAVE_FILE');
  const d=await localStatus({TOSS_KEY_FILE:path});
  assert.deepEqual(d,{service:'teamquant-local',schemaVersion:1,keyFile:'ready'});
  assert.equal(JSON.stringify(d).includes(dir),false);assert.equal(JSON.stringify(d).includes('SECRET'),false);
  assert.equal((await localStatus({})).keyFile,'not_configured');
  assert.equal((await localStatus({TOSS_KEY_FILE:join(dir,'missing.key')})).keyFile,'missing');
  await mkdir(join(dir,'not-a-file'));assert.equal((await localStatus({TOSS_KEY_FILE:join(dir,'not-a-file')})).keyFile,'missing');
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('tq-connect-test-'));await rm(dir,{recursive:true,force:true});}
});
test('status retains exact Origin, Host, method and remote pairing policy without a broker read',async()=>{
 let reads=0;const local={method:'POST',headers:{host:'127.0.0.1:8766',origin:'http://127.0.0.1:8766','x-teamquant-action':'bridge-local'}};
 const b=createLocalBridge({port:8766,env:{},readStatus:async()=>({service:'teamquant-local',schemaVersion:1,keyFile:'ready'}),readHoldings:async()=>{reads++;}});
 assert.equal((await b.handle(local,'status')).status,200);assert.equal(reads,0);
 for(const req of [{...local,method:'GET'},{...local,headers:{...local.headers,origin:'https://evil.example'}},{...local,headers:{...local.headers,host:'evil.example'}},{...local,headers:{...local.headers,origin:'https://teamquant.vercel.app','x-teamquant-action':undefined}}])assert.notEqual((await b.handle(req,'status')).status,200);
 const cloud=createLocalBridge({port:8766,env:{VERCEL:'1'}});assert.equal((await cloud.handle(local,'status')).status,403);
});
test('launcher reuses a recognized server and starts a stopped server once',async()=>{
 let starts=0;
 const ready={state:'ready',keyFile:'ready'};
 assert.equal((await ensureLocalServer({probe:async()=>ready,start:async()=>starts++})).reused,true);assert.equal(starts,0);
 const states=[{state:'stopped'},{state:'stopped'},ready];
 assert.equal((await ensureLocalServer({probe:async()=>states.shift(),start:async()=>starts++,delay:async()=>{}})).reused,false);assert.equal(starts,1);
});
test('launcher never starts over an unknown service and bounds failed startup',async()=>{
 let starts=0;
 await assert.rejects(ensureLocalServer({probe:async()=>({state:'busy'}),start:async()=>starts++}),/8766/);assert.equal(starts,0);
 await assert.rejects(ensureLocalServer({probe:async()=>({state:'stopped'}),start:async()=>starts++,delay:async()=>{},attempts:2}),/시작하지 못했습니다/);assert.equal(starts,1);
});
test('probe sends only a local status request, rejects impostors and distinguishes refused connections',async()=>{
 let req;
 const ready=await probeLocalServer(async(url,options)=>{req={url,options};return {ok:true,json:async()=>({service:'teamquant-local',schemaVersion:1,keyFile:'ready'})};});
 assert.equal(ready.state,'ready');assert.equal(req.url,'http://127.0.0.1:8766/api/bridge/status');assert.equal(req.options.body,'{}');assert.equal(req.options.headers.Authorization,undefined);
 assert.equal((await probeLocalServer(async()=>({ok:true,json:async()=>({otherService:true})}))).state,'busy');
 assert.equal((await probeLocalServer(async()=>{throw new Error('closed',{cause:{code:'ECONNREFUSED'}});})).state,'stopped');
 assert.equal((await probeLocalServer(async()=>{throw new Error('timeout');})).state,'busy');
});
