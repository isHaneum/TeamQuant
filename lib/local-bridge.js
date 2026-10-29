import {NewsError} from './news.js';
import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest();
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(digest(a),digest(b));
export function createLocalBridge({port,readHoldings,readMarket,readNews,now=()=>Date.now(),env=process.env}={}){
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
   if(!challenge||challenge.expiresAt<=now())return result(410,{error:'연결코드가 만료됐어요. PC 화면에서 다시 발급하세요.'});
   if(++challenge.attempts>5){challenge=null;return result(429,{error:'입력 횟수를 초과했어요. PC에서 코드를 다시 발급하세요.'});}
   if(!matches(String(body.code||''),challenge.code))return result(401,{error:'연결코드를 확인하세요.'});
   challenge=null;const token=randomBytes(32).toString('base64url'),expiresAt=now()+3600000;
   for(const [k,v] of sessions)if(v.expiresAt<=now())sessions.delete(k);
   if(sessions.size>=8)sessions.delete(sessions.keys().next().value);
   sessions.set(createHash('sha256').update(token).digest('hex'),{expiresAt});
   return result(200,{token,expiresAt});
  }
  if(!(origin===local&&req.headers['x-teamquant-action']==='bridge-local')&&!auth(req))return result(401,{error:'PC 연결이 만료됐어요. 일회용 코드로 다시 연결하세요.'});
  try{
   if(path==='disconnect'){sessions.delete(createHash('sha256').update(req.headers.authorization.slice(7)).digest('hex'));return result(200,{disconnected:true});}
   if(path==='holdings'){lastSnapshot=await readHoldings();return result(200,lastSnapshot);}
   if(!lastSnapshot)return result(409,{error:'보유 자산을 먼저 조회하세요.'});
   const symbols=new Set(lastSnapshot.positions.map(p=>p.symbol));
   if(path==='market'){
    const symbol=String(body.symbol||'');
    const base=symbol.replace(/\.(KS|KQ)$/,'');
    if(!symbols.has(base)&&!['^KS11','SPY'].includes(symbol))return result(403,{error:'보유 종목과 비교 지수만 조회할 수 있어요.'});
    return result(200,await readMarket(symbol,'1y'));
   }
   if(path==='news'){
    const p=lastSnapshot.positions.find(p=>p.symbol===body.symbol);if(!p)return result(403,{error:'보유 종목만 조회할 수 있어요.'});
    return result(200,await readNews(p.symbol==='035420'?'네이버 실적':p.name,'date'));
   }
   return result(404,{error:'지원하지 않는 조회입니다.'});
  }catch(e){return result(e.status||502,{error:e.code||e instanceof NewsError?e.message:'로컬 데이터 조회에 실패했습니다.',code:e.code||'read_failed'});}
 }
 return {handle};
}
