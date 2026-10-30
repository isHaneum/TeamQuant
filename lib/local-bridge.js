import {NewsError} from './news.js';
import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest();
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(digest(a),digest(b));
export function createLocalBridge({port,readHoldings,readMarket,readNews,performance,readHistory,now=()=>Date.now(),env=process.env}={}){
 const local=`http://127.0.0.1:${port}`,remote='https://teamquant.vercel.app';
 let challenge=null;const sessions=new Map();let lastSnapshot=null;
 function policy(req){return !env.VERCEL&&req.headers.host===`127.0.0.1:${port}`&&[local,remote].includes(req.headers.origin);}
 function auth(req){const value=req.headers.authorization?.replace(/^Bearer /,'');if(!value)return false;const entry=sessions.get(createHash('sha256').update(value).digest('hex'));if(!entry||entry.expiresAt<=now())return false;return true;}
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
  if(path==='pair'){
   if(!challenge||challenge.expiresAt<=now())return result(410,{error:'연결코드가 만료되었습니다. PC 화면에서 다시 발급하세요.'});
   if(++challenge.attempts>5){challenge=null;return result(429,{error:'입력 횟수를 초과했습니다. PC에서 코드를 다시 발급하세요.'});}
   if(!matches(String(body.code||''),challenge.code))return result(401,{error:'연결코드를 확인하세요.'});
   challenge=null;const token=randomBytes(32).toString('base64url'),expiresAt=now()+3600000;
   for(const [k,v] of sessions)if(v.expiresAt<=now())sessions.delete(k);
   if(sessions.size>=8)sessions.delete(sessions.keys().next().value);
   sessions.set(createHash('sha256').update(token).digest('hex'),{expiresAt});
   return result(200,{token,expiresAt});
  }
  if(!(origin===local&&req.headers['x-teamquant-action']==='bridge-local')&&!auth(req))return result(401,{error:'PC 연결이 만료되었습니다. 일회용 코드로 다시 연결하세요.'});
  try{
   if(path==='disconnect'){sessions.delete(createHash('sha256').update(req.headers.authorization.slice(7)).digest('hex'));return result(200,{disconnected:true});}
   if(path==='holdings'){lastSnapshot=await readHoldings();return result(200,lastSnapshot);}
   if(path==='history-list'){if(!readHistory)return result(503,{error:'최신 PC 서버가 필요합니다.'});try{return result(200,await readHistory());}catch{return result(500,{error:'PC 이력 파일을 확인하지 못했습니다. 원본을 덮어쓰지 않았습니다.'});}}
   if(path.startsWith('performance-')){if(!performance)return result(503,{error:'최신 PC 서버가 필요합니다.'});try{if(path==='performance-import')return result(200,await performance.import(body));if(path==='performance-list')return result(200,await performance.list({archived:body.archived===true}));if(path==='performance-load')return result(200,await performance.load(body.id,body.archived===true));if(path==='performance-archive')return result(200,await performance.archive(body.id,body.restore===true));return result(404,{error:'지원하지 않는 성과 작업입니다.'});}catch(e){return result(400,{error:e.name==='PerformanceError'?e.message:'PC 성과 자료를 처리하지 못했습니다. 원본은 유지됩니다.'});}}
   if(!lastSnapshot)return result(409,{error:'보유 자산을 먼저 조회하세요.'});
   const symbols=new Set(lastSnapshot.positions.map(p=>p.symbol));
   if(path==='market'){
    const symbol=String(body.symbol||'');
    const base=symbol.replace(/\.(KS|KQ)$/,'');
    if(!symbols.has(base)&&!['^KS11','SPY'].includes(symbol))return result(403,{error:'보유 종목과 비교 지수만 조회할 수 있습니다.'});
    return result(200,await readMarket(symbol,'1y'));
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
