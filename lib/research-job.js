import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
let status={local:true,running:false,state:'idle',log:'',finishedAt:null};
export function getResearchStatus(){return {...status};}
export function startResearchRefresh(){
  if(status.running)return getResearchStatus();
  status={local:true,running:true,state:'running',log:'데이터 수집 및 고정 모델 예측 중',startedAt:new Date().toISOString()};
  const child=spawn(process.execPath,['ml/run.mjs','refresh'],{cwd:root,shell:false,windowsHide:true});
  const append=chunk=>{status.log=(status.log+'\n'+chunk.toString()).slice(-6000);};
  child.stdout.on('data',append);child.stderr.on('data',append);
  child.on('error',error=>{status={...status,running:false,state:'failed',log:error.message,finishedAt:new Date().toISOString()};});
  child.on('exit',code=>{status={...status,running:false,state:code===0?'completed':'failed',exitCode:code,finishedAt:new Date().toISOString()};});
  return getResearchStatus();
}
