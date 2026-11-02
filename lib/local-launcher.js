export const localAddress='http://127.0.0.1:8766';
export async function probeLocalServer(fetchImpl=fetch){
 let response;
 try{response=await fetchImpl(localAddress+'/api/bridge/status',{method:'POST',headers:{Origin:localAddress,'Content-Type':'application/json','X-TeamQuant-Action':'bridge-local'},body:'{}',signal:AbortSignal.timeout(1500)});}
 catch(error){return {state:error.cause?.code==='ECONNREFUSED'?'stopped':'busy'};}
 try{const d=await response.json();if(response.ok&&d.service==='teamquant-local'&&d.schemaVersion===1&&['ready','missing','not_configured'].includes(d.keyFile))return {state:'ready',keyFile:d.keyFile};}catch{}
 return {state:'busy'};
}
export async function ensureLocalServer({probe=probeLocalServer,start,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=24}={}){
 const first=await probe();
 if(first.state==='ready')return {...first,reused:true};
 if(first.state!=='stopped')throw new Error('8766 포트에 다른 서버나 이전 버전이 실행 중입니다. 기존 서버를 확인한 뒤 다시 실행하십시오.');
 await start();
 for(let i=0;i<attempts;i++){await delay(250);const next=await probe();if(next.state==='ready')return {...next,reused:false};}
 throw new Error('PC 서버를 시작하지 못했습니다. Node.js 22 이상과 실행 폴더를 확인하십시오.');
}
