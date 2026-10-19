let tokenCache = null;

function settings() {
  const appKey=process.env.KIS_APP_KEY,appSecret=process.env.KIS_APP_SECRET,account=process.env.KIS_ACCOUNT_NO;
  const mode=(process.env.KIS_MODE||"vps").toLowerCase(),product=process.env.KIS_ACCOUNT_PRODUCT_CODE||"01";
  return { configured:Boolean(appKey&&appSecret&&account),appKey,appSecret,account,product,mode,baseUrl:mode==="prod"?"https://openapi.koreainvestment.com:9443":"https://openapivts.koreainvestment.com:29443" };
}

async function accessToken(config) {
  if(tokenCache&&tokenCache.mode===config.mode&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.value;
  const response=await fetch(`${config.baseUrl}/oauth2/tokenP`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant_type:"client_credentials",appkey:config.appKey,appsecret:config.appSecret}),signal:AbortSignal.timeout(8000)}),data=await response.json();
  if(!response.ok||!data.access_token)throw new Error(data.error_description||"KIS 접근 토큰을 발급하지 못했습니다.");
  tokenCache={mode:config.mode,value:data.access_token,expiresAt:Date.now()+Math.max(300,Number(data.expires_in||86400))*1000}; return tokenCache.value;
}

export async function fetchKisAccount() {
  const config=settings(); if(!config.configured)return {configured:false}; const token=await accessToken(config);
  const params=new URLSearchParams({CANO:config.account,ACNT_PRDT_CD:config.product,AFHR_FLPR_YN:"N",OFL_YN:"",INQR_DVSN:"00",UNPR_DVSN:"01",FUND_STTL_ICLD_YN:"N",FNCG_AMT_AUTO_RDPT_YN:"N",PRCS_DVSN:"00",CTX_AREA_FK100:"",CTX_AREA_NK100:""});
  const response=await fetch(`${config.baseUrl}/uapi/domestic-stock/v1/trading/inquire-balance?${params}`,{headers:{authorization:`Bearer ${token}`,appkey:config.appKey,appsecret:config.appSecret,tr_id:config.mode==="prod"?"TTTC8434R":"VTTC8434R",custtype:"P"},signal:AbortSignal.timeout(8000)}),data=await response.json();
  if(!response.ok||data.rt_cd!=="0")throw new Error(data.msg1||"KIS 잔고 조회에 실패했습니다."); const summary=data.output2?.[0]||{};
  return {configured:true,mode:config.mode,modeLabel:config.mode==="prod"?"실전 계좌 · 읽기 전용":"모의투자 계좌",summary:{cash:Number(summary.dnca_tot_amt||0),totalEvaluation:Number(summary.tot_evlu_amt||0),profit:Number(summary.evlu_pfls_smtl_amt||0)},holdings:(data.output1||[]).filter(x=>Number(x.hldg_qty)>0).map(x=>({symbol:x.pdno,name:x.prdt_name,quantity:Number(x.hldg_qty),availableQuantity:Number(x.ord_psbl_qty),averagePrice:Number(x.pchs_avg_pric),currentPrice:Number(x.prpr),returnRate:Number(x.evlu_pfls_rt)})),fetchedAt:new Date().toISOString()};
}
