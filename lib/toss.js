import {readFile} from 'node:fs/promises';
export class TossError extends Error{constructor(code,status=502){super(({ip_not_allowed:'토스 Open API 허용 IP에 현재 PC의 공인 IP를 등록하십시오.',invalid_client:'토스 client_id·client_secret을 확인하세요.',not_configured:'로컬 토스 키 파일 설정을 확인하세요.',no_account:'조회할 수 있는 종합매매 계좌가 없습니다.',rate_limited:'조회 한도를 초과했습니다. 잠시 후 다시 조회하세요.',invalid_response:'토스 응답 형식을 확인하지 못했습니다.',upstream_failed:'토스 조회에 실패했습니다. 잠시 후 다시 시도하세요.'})[code]||'토스 조회 실패');this.code=code;this.status=status;}}
export async function loadTossCredentials(env=process.env){
  if(env.TOSS_CLIENT_ID&&env.TOSS_CLIENT_SECRET)return {clientId:env.TOSS_CLIENT_ID,clientSecret:env.TOSS_CLIENT_SECRET};
  if(!env.TOSS_KEY_FILE)throw new TossError('not_configured',503);
  let text;try{text=await readFile(env.TOSS_KEY_FILE,'utf8');}catch{throw new TossError('not_configured',503);}
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
  return {positions,totals,holdingValueKrw:hasUsd&&!rate?null:totals[0].value+totals[1].value*(rate||0),fx:rate?{midRate:rate,asOf:fx.validFrom}:null,cashKnown:false};
}
export function createTossReader({fetchImpl=fetch,credentials=()=>loadTossCredentials(),now=()=>Date.now()}={}){
  let token=null,pending=null;
  async function request(path,{bearer,account,body}={}){
    let response;try{response=await fetchImpl('https://openapi.tossinvest.com'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(account?{'X-Tossinvest-Account':String(account)}:{})},...(body?{body}:{}),signal:AbortSignal.timeout(12000)});}catch{throw new TossError('upstream_failed');}
    let data;try{data=await response.json();}catch{throw new TossError('invalid_response');}
    if(!response.ok){if(response.status===403)throw new TossError('ip_not_allowed',403);if(response.status===401){token=null;throw new TossError('invalid_client',401);}if(response.status===429)throw new TossError('rate_limited',429);throw new TossError('upstream_failed');}return data;
  }
  async function authenticate(){
    if(token&&token.expiresAt>now()+60000)return token.value;
    if(!pending)pending=(async()=>{const c=await credentials(),r=await request('/oauth2/token',{body:new URLSearchParams({grant_type:'client_credentials',client_id:c.clientId,client_secret:c.clientSecret}).toString()});if(!r.access_token||!Number.isFinite(Number(r.expires_in)))throw new TossError('invalid_response');token={value:r.access_token,expiresAt:now()+Number(r.expires_in)*1000};return token.value;})().finally(()=>pending=null);
    return pending;
  }
  return async function read(){
    const bearer=await authenticate(),accounts=(await request('/api/v1/accounts',{bearer})).result;
    if(!Array.isArray(accounts))throw new TossError('invalid_response');
    const account=accounts.find(a=>a.accountType==='BROKERAGE'&&Number.isSafeInteger(a.accountSeq)&&a.accountSeq>0);
    if(!account)throw new TossError('no_account',404);
    const holdings=(await request('/api/v1/holdings',{bearer,account:account.accountSeq})).result;
    let fx=null,fxUnavailable=false;if(holdings?.items?.some(p=>p.currency==='USD')){try{fx=(await request('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW',{bearer})).result;}catch{fxUnavailable=true;}}
    return {...normalizeTossHoldings(holdings,fx),provider:'toss',accountCount:accounts.filter(a=>a.accountType==='BROKERAGE').length,fxUnavailable,fetchedAt:new Date(now()).toISOString(),source:'토스증권 Open API',notice:'첫 번째 종합매매 계좌의 국내·미국 보유주식. 현금·옵션·채권 제외. 원화 환산은 현재 매매기준율 기준으로 실제 환전·세후 금액과 다를 수 있음.'};
  };
}
export function allowLocalToss(request,port,env=process.env){return !env.VERCEL&&request.method==='POST'&&request.headers.host===`127.0.0.1:${port}`&&request.headers.origin===`http://127.0.0.1:${port}`&&request.headers['x-teamquant-action']==='read-toss';}
export const fetchTossHoldings=createTossReader();
