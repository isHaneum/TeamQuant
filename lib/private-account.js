import {createHash,timingSafeEqual} from 'node:crypto';
export function privateAccountStatus(env=process.env){
  const credentials=Boolean(env.KIS_APP_KEY&&env.KIS_APP_SECRET&&/^\d{8}$/.test(env.KIS_ACCOUNT_NO||''));
  const ownerAuth=Boolean(env.KIS_OWNER_ACCESS_TOKEN?.length>=32);
  return {available:credentials&&ownerAuth,kind:'owner_read_only',simpleConnection:false,status:credentials&&ownerAuth?'owner_ready':'owner_setup_required',message:credentials&&ownerAuth?'본인 계좌 조회가 준비되었습니다. 계좌 조회 암호를 입력하세요.':'본인 조회용 한투 키·계좌번호·32자 이상 조회 암호를 Vercel 서버에 설정해야 합니다. 금융사 간편 인증은 제공하지 않습니다.'};
}
export async function readPrivateAccount(request,{env=process.env,readAccount}={}){
  if(request.method!=='GET')return {status:405,body:{error:'GET 요청만 지원합니다.'}};
  const config=privateAccountStatus(env);
  if(!config.available)return {status:503,body:{configured:false,error:config.message}};
  const header=request.headers?.authorization||request.headers?.get?.('authorization')||'';
  const supplied=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
  if(supplied.length<32||supplied.length>512||!timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(env.KIS_OWNER_ACCESS_TOKEN).digest()))return {status:401,body:{error:'계좌 조회 암호를 확인하세요.'}};
  try{return {status:200,body:await readAccount()};}catch{return {status:502,body:{error:'금융사 잔고 조회에 실패했습니다. 한투 키·계좌 구분·API 이용 신청 상태를 확인하세요.'}};}
}
