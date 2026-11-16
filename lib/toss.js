import {collectOrderHistory,orderQuery} from './toss-orders.js';
import {readFile} from 'node:fs/promises';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {getVault,vaultRoot} from './vault.js';
export class TossError extends Error{constructor(code,status=502){super(({ip_not_allowed:'토스 Open API 허용 IP에 현재 PC의 공인 IP를 등록하십시오.',invalid_client:'토스 client_id·client_secret을 확인하세요.',not_configured:'로컬 토스 키 파일 설정을 확인하세요.',no_account:'조회할 수 있는 종합매매 계좌가 없습니다.',history_forbidden:'토스 주문 조회 권한과 허용 IP 설정을 확인하십시오.',rate_limited:'조회 한도를 초과했습니다. 잠시 후 다시 조회하세요.',invalid_response:'토스 응답 형식을 확인하지 못했습니다.',upstream_failed:'토스 조회에 실패했습니다. 잠시 후 다시 시도하세요.'})[code]||'토스 조회 실패');this.code=code;this.status=status;}}
// 2026-11-16: vault(lib/vault.js)에 비밀 'toss' 가 있으면 그것을 먼저 쓰고, 없을 때만 TOSS_KEY_FILE 을 읽는다.
export async function loadTossCredentials(env=process.env,{vault=null}={}){
  if(env.TOSS_CLIENT_ID&&env.TOSS_CLIENT_SECRET)return {clientId:env.TOSS_CLIENT_ID,clientSecret:env.TOSS_CLIENT_SECRET};
  let text;
  if(vault?.hasSecret('toss')){try{text=vault.getSecret('toss');}catch{throw new TossError('not_configured',503);}}
  else{if(!env.TOSS_KEY_FILE)throw new TossError('not_configured',503);try{text=await readFile(env.TOSS_KEY_FILE,'utf8');}catch{throw new TossError('not_configured',503);}}
  const fields={};for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    const match=line.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);if(!match)continue;
    const name=match[1].toLowerCase().replace(/[\s_-]/g,''),value=match[2].replace(/^['"]|['"]$/g,'');
    if(['clientid','tossclientid','tossinvestclientid'].includes(name))fields.clientId=value;
    if(['clientsecret','tossclientsecret','tossinvestclientsecret'].includes(name))fields.clientSecret=value;
  }
  if(!fields.clientId||!fields.clientSecret)throw new TossError('not_configured',503);return fields;
}
const number=(value,min=0)=>{if(value===null||value===undefined||value==='')throw new TossError('invalid_response');const n=Number(value);if(!Number.isFinite(n)||n<min)throw new TossError('invalid_response');return n;};
export function normalizeTossHoldings(result,fx=null){
  if(!result||!Array.isArray(result.items))throw new TossError('invalid_response');
  const positions=result.items.map(p=>{
    if(!['KRW','USD'].includes(p.currency)||typeof p.symbol!=='string'||typeof p.name!=='string')throw new TossError('invalid_response');
    return {symbol:p.symbol,name:p.name,currency:p.currency,quantity:number(p.quantity),avgCost:number(p.averagePurchasePrice),price:number(p.lastPrice),
      cost:number(p.marketValue?.purchaseAmount),value:number(p.marketValue?.amount),pnl:number(p.profitLoss?.amount,-Infinity),returnPct:number(p.profitLoss?.rate,-Infinity)*100,
      dailyPnl:p.dailyProfitLoss?.amount==null?null:number(p.dailyProfitLoss.amount,-Infinity),dailyPct:p.dailyProfitLoss?.rate==null?null:number(p.dailyProfitLoss.rate,-Infinity)*100};
  });
  const totals=['KRW','USD'].map(currency=>{const rows=positions.filter(p=>p.currency===currency);return {currency,cost:rows.reduce((s,p)=>s+p.cost,0),value:rows.reduce((s,p)=>s+p.value,0),pnl:rows.reduce((s,p)=>s+p.pnl,0),count:rows.length};});
  const rate=fx&&Number.isFinite(Number(fx.midRate))&&Number(fx.midRate)>0?Number(fx.midRate):null;
  const hasUsd=positions.some(p=>p.currency==='USD');
  // 2026-11-16(사용자 보고: 토스 앱 수익률과 홈 숫자가 다름): 계좌 합계 손익률(profitLoss.rate)은 평가액은 오늘 환율, 미국 주식 원금은 산 날 원화로 센 값이다(토스 앱 숫자).
  //   문서는 '현재 환율로 원화 환산한 기준'이라고만 적지만, 주문 이력으로 원금을 체결일 환율로 다시 세면 이 값과 맞고 오늘 환율로만 세면 맞지 않았다(조회만 한 검산 · 숫자는 로컬 기록에만).
  //   종목별 purchaseAmount·rate 는 그 종목 통화(미국 = 달러) 기준이다. 원금까지 오늘 환율로 바꿔 더하면 달러 기준(산 뒤 환율 변동 빠짐)이 되므로 계좌 손익률은 토스 값을 그대로 둔다.
  const opt=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const r=opt(result.profitLoss?.rate),ra=opt(result.profitLoss?.rateAfterCost);
  const account=r!==null&&r>-1?{returnPct:r*100,returnAfterCostPct:ra!==null&&ra>-1?ra*100:null,basis:'purchase_fx',source:'토스 계좌 합계'}:null;
  return {positions,totals,holdingValueKrw:hasUsd&&!rate?null:totals[0].value+totals[1].value*(rate||0),fx:rate?{midRate:rate,asOf:fx.validFrom}:null,cashKnown:false,account};
}
// 2026-11-16 토큰 공급자: 토스는 클라이언트당 유효 토큰이 1개다(새로 받으면 앞 토큰은 바로 401 token-revoked). 화면용·기록용 리더와 적립 모듈이 각자 받으면 서로를 무효화했다.
// 그래서 토큰을 공유 캐시 하나(금고가 있으면 암호화 · tokens/toss)에 두고 모두 그것을 쓴다. 401 이면 그 토큰을 버리고, 다른 프로세스가 이미 받은 새 토큰이 있으면 그것을, 없으면 새로 받아 한 번만 다시 시도한다.
const TOSS_BASE='https://openapi.tossinvest.com';
export function createTossTokenProvider({fetchImpl=fetch,credentials,now=()=>Date.now(),cacheFile=null,vault=null}={}){
  let mem=null,pending=null;
  const valid=t=>t&&typeof t.value==='string'&&t.expiresAt>now()+60000;
  const readCache=()=>{if(!cacheFile)return null;try{const buf=readFileSync(cacheFile),t=vault?vault.decodeJson(buf,'tokens/toss').value:JSON.parse(buf.toString('utf8'));return valid(t)?t:null;}catch{return null;}};
  const writeCache=t=>{if(!cacheFile)return;try{if(vault)vault.writeJsonFile(cacheFile,'tokens/toss',t);else{mkdirSync(dirname(cacheFile),{recursive:true});writeFileSync(cacheFile,JSON.stringify(t));}}catch{}};
  async function issue(){
    const c=await credentials();let response;
    try{response=await fetchImpl(TOSS_BASE+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:c.clientId,client_secret:c.clientSecret}).toString(),signal:AbortSignal.timeout(12000)});}catch{throw new TossError('upstream_failed');}
    let data;try{data=await response.json();}catch{throw new TossError('invalid_response');}
    if(!response.ok){if(response.status===403)throw new TossError('ip_not_allowed',403);if(response.status===401||response.status===400)throw new TossError('invalid_client',401);if(response.status===429)throw new TossError('rate_limited',429);throw new TossError('upstream_failed');}
    if(!data?.access_token||!Number.isFinite(Number(data.expires_in)))throw new TossError('invalid_response');
    const t={value:data.access_token,expiresAt:now()+Number(data.expires_in)*1000,clientId:c.clientId};writeCache(t);return t;
  }
  return {
    async get(){if(valid(mem))return mem;const c=readCache();if(c)return (mem=c);if(!pending)pending=issue().then(t=>(mem=t)).finally(()=>{pending=null;});return pending;},
    /** 401 을 받은 토큰을 버린다. 공유 캐시가 같은 토큰이면 비워서, 다음 get() 이 새로 받게 한다(다른 프로세스가 이미 바꿨으면 그 토큰을 읽는다). */
    invalidate(stale){if(!mem||mem.value===stale)mem=null;if(!cacheFile)return;const c=readCache();if(c&&c.value===stale){try{writeFileSync(cacheFile,'{}');}catch{}}},
  };
}
let sharedTokens=null;
/** 프로세스 공용 토큰 공급자(PC 서버와 적립 모듈이 같은 캐시 파일을 쓴다). 자격을 직접 넘기는 테스트는 쓰지 않는다. */
export function sharedTossTokens(env=process.env){
  if(!sharedTokens){const vault=env.VERCEL?null:getVault(env);sharedTokens=createTossTokenProvider({credentials:()=>loadTossCredentials(env,{vault}),cacheFile:env.VERCEL?null:join(vaultRoot(env),'tokens','toss-token.json'),vault});}
  return sharedTokens;
}
export function createTossReader({fetchImpl=fetch,credentials=null,now=()=>Date.now(),onSnapshot,onFailure,tokens=null}={}){
  let token=null,tok=null;const stockNames=new Map(),orderCache=new Map(),orderPending=new Map();
  const provider=()=>tok||(tok=tokens||(credentials?createTossTokenProvider({fetchImpl,credentials,now}):sharedTossTokens()));
  async function raw(path,{bearer,account,body}={}){
    let response;try{response=await fetchImpl(TOSS_BASE+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(account?{'X-Tossinvest-Account':String(account)}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(12000)});}catch{throw new TossError('upstream_failed');}
    let data;try{data=await response.json();}catch{throw new TossError('invalid_response');}
    if(!response.ok){if(response.status===403)throw new TossError(path.startsWith('/api/v1/orders')?'history_forbidden':'ip_not_allowed',403);if(response.status===401)throw new TossError('invalid_client',401);if(response.status===429){const error=new TossError('rate_limited',429),seconds=Number(response.headers?.get?.('retry-after'));if(Number.isFinite(seconds)&&seconds>0&&seconds<=3600){error.retryAfterSeconds=Math.ceil(seconds);error.message+=' '+error.retryAfterSeconds+'초 후 다시 조회하십시오.';}throw error;}throw new TossError('upstream_failed');}return data;
  }
  async function authenticate(){token=await provider().get();return token.value;}
  /** 인증된 GET. 401(다른 프로그램이 새 토큰을 받아 이 토큰이 무효)이면 토큰을 바꿔 한 번만 다시 시도한다. */
  async function request(path,opts={}){const bearer=await authenticate();try{return await raw(path,{...opts,bearer});}catch(e){if(e.status!==401)throw e;provider().invalidate(bearer);return raw(path,{...opts,bearer:await authenticate()});}}
  const read=async function(){
    let context={provider:'toss'};
    try{
    await authenticate();const clientId=token.clientId,accounts=(await request('/api/v1/accounts')).result;
    if(!Array.isArray(accounts))throw new TossError('invalid_response');
    const account=accounts.find(a=>a.accountType==='BROKERAGE'&&Number.isSafeInteger(a.accountSeq)&&a.accountSeq>0);
    if(!account)throw new TossError('no_account',404);
    context={provider:'toss',clientId,accountRef:String(account.accountSeq)};
    const holdings=(await request('/api/v1/holdings',{account:account.accountSeq})).result;
    let fx=null,fxUnavailable=false;if(holdings?.items?.some(p=>p.currency==='USD')){try{fx=(await request('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW')).result;}catch{fxUnavailable=true;}}
    const snapshot={...normalizeTossHoldings(holdings,fx),provider:'toss',accountCount:accounts.filter(a=>a.accountType==='BROKERAGE').length,fxUnavailable,fetchedAt:new Date(now()).toISOString(),source:'토스증권 Open API',notice:'첫 번째 종합매매 계좌의 국내·미국 보유주식. 현금·옵션·채권 제외. 원화 환산은 현재 매매기준율 기준으로 실제 환전·세후 금액과 다를 수 있음.'};
    for(const p of snapshot.positions)stockNames.set(p.symbol,p.name);
    if(onSnapshot){try{snapshot.localHistory=await onSnapshot(snapshot,context);}catch{snapshot.localHistory={saved:false,scope:'holdings_only',code:'local_history_unavailable'};}}
    return snapshot;
    }catch(error){if(onFailure)try{await onFailure(error,context);}catch{}throw error;}
  };
  read.orders=async input=>{
    const query=orderQuery(input,now());
    await authenticate();const accounts=(await request('/api/v1/accounts')).result;
    if(!Array.isArray(accounts))throw new TossError('invalid_response');
    const account=accounts.find(a=>a.accountType==='BROKERAGE'&&Number.isSafeInteger(a.accountSeq)&&a.accountSeq>0);
    if(!account)throw new TossError('no_account',404);
    const cacheKey=JSON.stringify([token.clientId,account.accountSeq,query]),cached=orderCache.get(cacheKey);
    if(cached&&cached.expiresAt>now())return cached.report;
    if(orderPending.has(cacheKey))return orderPending.get(cacheKey);
    const pendingRead=(async()=>{
    const report=await collectOrderHistory(query,{now,delay:ms=>new Promise(resolve=>setTimeout(resolve,ms)),readPage:async q=>{
      const params=new URLSearchParams({status:q.status,from:q.from,to:q.to,limit:String(q.limit)});
      if(q.symbol)params.set('symbol',q.symbol);if(q.cursor)params.set('cursor',q.cursor);
      return (await request('/api/v1/orders?'+params,{account:account.accountSeq})).result;
    }});
    let lookedUp=0;
    for(const symbol of new Set(report.orders.map(o=>o.symbol))){
      if(stockNames.has(symbol)||lookedUp>=30)continue;lookedUp++;
      try{const d=(await request('/api/v1/stocks/'+encodeURIComponent(symbol))).result;if(typeof d?.name==='string'&&d.name.trim()&&d.name.length<=120)stockNames.set(symbol,d.name);}catch{}
    }
    report.orders=report.orders.map(o=>({...o,name:stockNames.get(o.symbol)||null}));
    if(report.paginationComplete){if(orderCache.size>=8)orderCache.delete(orderCache.keys().next().value);orderCache.set(cacheKey,{report,expiresAt:now()+(query.status==='OPEN'?5000:30000)});}
    return report;
    })().finally(()=>orderPending.delete(cacheKey));
    orderPending.set(cacheKey,pendingRead);return pendingRead;
  };
  return read;
}
export function allowLocalToss(request,port,env=process.env){return !env.VERCEL&&request.method==='POST'&&request.headers.host===`127.0.0.1:${port}`&&request.headers.origin===`http://127.0.0.1:${port}`&&request.headers['x-teamquant-action']==='read-toss';}
export const fetchTossHoldings=createTossReader();
