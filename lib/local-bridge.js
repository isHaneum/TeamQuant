import {NewsError} from './news.js';
import {randomBytes,randomInt,createHash,timingSafeEqual,createPublicKey,verify} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest();
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(digest(a),digest(b));
export function createLocalBridge({port,paperLive,realRecord,readHoldings,readMarket,readNews,performance,investments,cash,readHistory,readStatus,readOrders,devices,now=()=>Date.now(),env=process.env}={}){
 const local=`http://127.0.0.1:${port}`,remote='https://teamquant.vercel.app';
 let challenge=null;const sessions=new Map();let lastSnapshot=null;
 function policy(req){return !env.VERCEL&&req.headers.host===`127.0.0.1:${port}`&&[local,remote].includes(req.headers.origin);}
 const proofs=new Map();
 function issue(deviceId=null){const token=randomBytes(32).toString('base64url'),expiresAt=now()+3600000;for(const [k,v] of sessions)if(v.expiresAt<=now())sessions.delete(k);if(sessions.size>=8)sessions.delete(sessions.keys().next().value);sessions.set(digest(token).toString('hex'),{expiresAt,deviceId});return {token,expiresAt};}
 async function auth(req){const token=req.headers.authorization?.replace(/^Bearer /,'');const entry=token&&sessions.get(digest(token).toString('hex'));return entry&&entry.expiresAt>now()&&(!entry.deviceId||await devices?.get(entry.deviceId))?entry:null;}
 async function handle(req,path,body={}){
  const origin=req.headers.origin;
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Origin'};
  if(!policy(req))return {status:403,headers,body:{error:'허용되지 않은 로컬 연결입니다.'}};
  Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-TeamQuant-Action','Access-Control-Allow-Private-Network':'true'});
  if(req.method==='OPTIONS')return {status:204,headers,body:null};
  if(req.method!=='POST')return {status:405,headers,body:{error:'POST 요청만 지원합니다.'}};
  const result=(status,body)=>({status,headers,body});
  if(path==='challenge'||path==='reset'){
   if(origin!==local||req.headers['x-teamquant-action']!=='bridge-local')return result(403,{error:'본인 PC 화면에서 연결코드를 발급하세요.'});
   if(path==='reset'){sessions.clear();challenge=null;return result(200,{disconnected:true});}
   challenge={code:String(randomInt(0,1000000)).padStart(6,'0'),expiresAt:now()+120000,attempts:0};
   return result(200,{code:challenge.code,expiresAt:challenge.expiresAt});
  }
  if(path==='device-challenge'||path==='device-login'){
   try{const d=await devices?.get(body.deviceId);if(!d||d.origin!==origin||d.profile!==body.profile)return result(401,{error:'기억된 연결이 없거나 만료되었습니다.'});
    for(const [k,v] of proofs)if(v.expiresAt<=now())proofs.delete(k);
    if(path==='device-challenge'){if(proofs.size>=100)return result(429,{error:'잠시 후 다시 연결하십시오.'});const nonce=randomBytes(32).toString('base64url'),expiresAt=now()+60000;const message=JSON.stringify({purpose:'teamquant-device-login',deviceId:d.id,profile:d.profile,origin,nonce,expiresAt});proofs.set(nonce,{message,expiresAt,deviceId:d.id});return result(200,{message});}
    const proof=proofs.get(body.nonce);proofs.delete(body.nonce);if(!proof||proof.expiresAt<=now()||proof.deviceId!==d.id||typeof body.signature!=='string'||body.signature.length!==86)return result(401,{error:'재연결 인증이 만료되었습니다.'});
    const ok=verify('sha256',Buffer.from(proof.message),{key:createPublicKey({key:d.publicKey,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(body.signature,'base64url'));return ok?result(200,issue(d.id)):result(401,{error:'브라우저 인증 실패'});
   }catch{return result(503,{error:'PC의 기억된 연결을 확인하지 못했습니다.'});}
  }
  if(path==='pair'){
   if(!challenge||challenge.expiresAt<=now())return result(410,{error:'연결코드가 만료되었습니다. PC 화면에서 다시 발급하세요.'});
   if(++challenge.attempts>5){challenge=null;return result(429,{error:'입력 횟수를 초과했습니다. PC에서 코드를 다시 발급하세요.'});}
   if(!matches(String(body.code||''),challenge.code))return result(401,{error:'연결코드를 확인하세요.'});
   challenge=null;
   let device;try{if(body.remember){if(!devices)throw new Error();device=await devices.register({profile:body.profile,origin,publicKey:body.publicKey});}}catch{return result(400,{error:'브라우저 등록에 실패했습니다. 최신 PC 서버와 브라우저를 확인하십시오.'});}
   return result(200,{...issue(device?.id),...(device?{deviceId:device.id,deviceExpiresAt:device.expiresAt}:{})});
  }
  let session;try{session=await auth(req);}catch{return result(503,{error:'PC 연결 확인 실패'});}
  const isLocal=origin===local&&req.headers['x-teamquant-action']==='bridge-local';
  if(!isLocal&&!session)return result(401,{error:'PC 연결이 필요합니다. 설정에서 최초 연결을 진행하십시오.'});
  try{
   if(path==='devices-revoke-all'){if(!isLocal)return result(403,{error:'본인 PC에서만 가능합니다.'});await devices?.revokeAll();sessions.clear();proofs.clear();return result(200,{disconnected:true});}
   if(path==='device-forget'){if(session?.deviceId)await devices.revoke(session.deviceId);return result(200,{disconnected:true});}
   if(path==='status')return result(200,readStatus?await readStatus():{service:'teamquant-local',schemaVersion:1,keyFile:'not_configured'});
   if(path==='cash-get'||path==='cash-set'){if(!cash)return result(503,{error:'현금 기록을 지원하는 최신 PC 서버를 실행하십시오.'});try{return result(200,path==='cash-get'?await cash.get():await cash.set(body));}catch(e){return result(400,{error:e.name==='CashError'?e.message:'PC 현금 기록을 처리하지 못했습니다. 원본은 유지됩니다.'});}}
   if(path.startsWith('investment-')){
    if(!investments)return result(503,{error:'투자 계획을 지원하는 최신 PC 서버를 실행하십시오.'});
    const operation=path.slice(11);if(!['intent','list','load','create','update','preview','approve','execute'].includes(operation))return result(404,{error:'지원하지 않는 투자 계획 작업입니다.'});
    try{return result(200,await investments[operation](operation==='load'?body.id:body));}catch(e){return result(e.status||400,{error:e.name==='PlanError'?e.message:'PC 장부를 처리하지 못했습니다. 원본 파일은 유지됩니다.'});}
   }
   if(path==='disconnect'){if(req.headers.authorization)sessions.delete(digest(req.headers.authorization.slice(7)).toString('hex'));return result(200,{disconnected:true});}
   if(path==='order-history'){if(!readOrders)return result(503,{error:'주문 이력을 지원하는 최신 PC 서버가 필요합니다.'});return result(200,await readOrders(body));}
   if(path==='holdings'){lastSnapshot=await readHoldings();return result(200,lastSnapshot);}
   if(path==='history-list'){if(!readHistory)return result(503,{error:'최신 PC 서버가 필요합니다.'});try{return result(200,await readHistory());}catch{return result(500,{error:'PC 이력 파일을 확인하지 못했습니다. 원본을 덮어쓰지 않았습니다.'});}}
   if(path.startsWith('performance-')){if(!performance)return result(503,{error:'최신 PC 서버가 필요합니다.'});try{if(path==='performance-import')return result(200,await performance.import(body));if(path==='performance-list')return result(200,await performance.list({archived:body.archived===true}));if(path==='performance-load')return result(200,await performance.load(body.id,body.archived===true));if(path==='performance-archive')return result(200,await performance.archive(body.id,body.restore===true));return result(404,{error:'지원하지 않는 성과 작업입니다.'});}catch(e){return result(400,{error:e.name==='PerformanceError'?e.message:'PC 성과 자료를 처리하지 못했습니다. 원본은 유지됩니다.'});}}
   if(path.startsWith('paper-live-')){
    // 한투 모의계좌 실행: status / preview / run / kill / cancel. 모의 키가 없는 PC 는 503. 실제 주문은 run 에서만, 그것도 모의계좌에만 나간다.
    if(!paperLive)return result(503,{error:'이 PC 에 한투 모의투자 키가 설정되지 않았습니다. .env.local 의 KIS_KEY_FILE·KIS_PAPER_ACCOUNT_NO 를 확인하십시오.',configured:false});
    const op=path.slice(11);
    try{
     if(op==='status')return result(200,await paperLive.status());
     if(op==='preview')return result(200,await paperLive.run({rules:body.rules,plan:body.plan,dryRun:true,rebalance:body.rebalance===true}));
     if(op==='run')return result(200,await paperLive.run({rules:body.rules,plan:body.plan,dryRun:false,rebalance:body.rebalance===true}));
     if(op==='kill')return result(200,await paperLive.kill(body.on!==false));
     if(op==='cancel')return result(200,{cancelled:await paperLive.cancelOpen()});
     if(op==='prefs')return result(200,paperLive.setPrefs(body));
     if(op==='hypothesis')return result(200,paperLive.hypothesis(body.op,body.item||{}));
     if(op==='public'){if(!paperLive.publishPublic)return result(404,{error:'공개 스냅샷을 지원하지 않는 서버입니다.'});return result(200,await paperLive.publishPublic({push:isLocal&&body.push===true}));}
     return result(404,{error:'지원하지 않는 모의계좌 작업입니다.'});
    }catch(e){return result(e.status||502,{error:e.message||'모의계좌 처리에 실패했습니다.',code:e.code||'paper_live_failed'});}
   }
   if(path==='kis-real-status'){
    // 실계좌 읽기 전용 기록(결정 22): 조회 결과만 돌려준다(쓰는 작업 없음). 응답에는 가린 계좌번호만 있고 장부 경로·주문번호·토큰은 record 가 넣지 않는다. 설정이 없는 PC 는 503 → 화면은 카드를 숨긴다.
    if(!realRecord)return result(503,{error:'이 PC 에 실계좌 읽기 전용 설정(KIS_REAL_READONLY=1)이 없습니다.',configured:false});
    try{return result(200,await realRecord.status());}catch(e){return result(502,{error:'실계좌 조회에 실패했습니다.',code:e.code||'real_record_failed'});}
   }
   if(!lastSnapshot)return result(409,{error:'보유 자산을 먼저 조회하세요.'});
   const symbols=new Set(lastSnapshot.positions.map(p=>p.symbol));
   if(path==='market'){
    const symbol=String(body.symbol||'');
    const base=symbol.replace(/\.(KS|KQ)$/,'');
    if(!symbols.has(base)&&!['^KS11','SPY'].includes(symbol))return result(403,{error:'보유 종목과 비교 지수만 조회할 수 있습니다.'});
    return result(200,await readMarket(symbol,['3mo','6mo','1y','2y','5y'].includes(body.range)?body.range:'1y'));
   }
   if(path==='news'){
    const p=lastSnapshot.positions.find(p=>p.symbol===body.symbol);if(!p)return result(403,{error:'보유 종목만 조회할 수 있습니다.'});
    return result(200,await readNews(p.symbol==='035420'?'네이버 실적':p.name,'date'));
   }
   return result(404,{error:'지원하지 않는 조회입니다.'});
  }catch(e){return result(e.status||502,{error:e.code||e instanceof NewsError?e.message:'로컬 데이터 조회에 실패했습니다.',code:e.code||'read_failed'});}
 }
 return {handle};
}
