import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {ensureLocalServer,localAddress} from './lib/local-launcher.js';

const root=dirname(fileURLToPath(import.meta.url));
try{
 if(process.env.VERCEL)throw new Error('개인 PC에서만 실행할 수 있습니다.');
 const state=await ensureLocalServer({start:async()=>{
  const child=spawn(process.execPath,[join(root,'dev-server.mjs')],{cwd:root,env:{...process.env,PORT:'8766'},detached:true,windowsHide:true,stdio:'ignore'});
  await once(child,'spawn');child.unref();
 }});
 console.log(state.reused?'실행 중인 TeamQuant 서버에 연결했습니다.':'TeamQuant 서버를 실행했습니다.');
 console.log(state.keyFile==='ready'?'기존 토스 키 파일이 연결되어 있습니다.':'토스 키 파일 설정을 확인하십시오. START-HERE.md에 초기 설정 방법이 있습니다.');
 const address=localAddress+'/?view=toss';
 if(process.platform==='win32'){
  const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',address],{windowsHide:true,stdio:'ignore'});
  await once(browser,'exit');
 }else console.log(address);
}catch(error){console.error(error.message);process.exitCode=1;}
