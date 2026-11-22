// PREREG-J implementation. Node 24, no deps. Run: node macro.mjs
import fs from 'fs';
import { parseDta118 } from './dta.mjs';
const C='cache'; fs.mkdirSync(C,{recursive:true});
const LOG=[]; const log=(...a)=>{const s=a.join(' ');LOG.push(s);console.log(s)};
const UA={'User-Agent':'Mozilla/5.0'};
const TODAY=new Date().toISOString().slice(0,10);
const SOURCES=[];
async function cached(name,url,bin=false){
  const p=`${C}/${name}`;
  if(fs.existsSync(p)){return bin?fs.readFileSync(p):fs.readFileSync(p,'utf8')}
  const r=await fetch(url,{headers:UA}); if(!r.ok) throw new Error(`${name} HTTP ${r.status}`);
  const d=bin?Buffer.from(await r.arrayBuffer()):await r.text(); fs.writeFileSync(p,d); return d;
}
async function fred(id){
  const url=`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
  try{const t=await cached(`fred_${id}.csv`,url);
    const m=new Map();for(const l of t.trim().split('\n').slice(1)){const [d,v]=l.split(',');if(v&&v!=='.')m.set(d,+v)}
    const ks=[...m.keys()];SOURCES.push({name:id,url,fetched:TODAY,first:ks[0],last:ks[ks.length-1],n:ks.length});return m;
  }catch(e){log(`SOURCE FAIL ${id}: ${e.message}`);SOURCES.push({name:id,url,fetched:TODAY,error:e.message});return null}
}
async function yahoo(sym){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&period1=0&period2=${Math.floor(Date.now()/1000)}`;
  try{const t=await cached(`yahoo_${sym.replace(/[^A-Za-z0-9]/g,'_')}.json`,url);const j=JSON.parse(t);const res=j.chart.result[0];
    const ts=res.timestamp,c=res.indicators.quote[0].close;const m=new Map();
    for(let i=0;i<ts.length;i++){if(c[i]!=null&&isFinite(c[i])){const d=new Date(ts[i]*1000).toISOString().slice(0,10);m.set(d,c[i])}}
    const ks=[...m.keys()];SOURCES.push({name:sym,url:url.replace(/period2=\d+/,'period2={now}'),fetched:TODAY,first:ks[0],last:ks[ks.length-1],n:ks.length});return m;
  }catch(e){log(`SOURCE FAIL ${sym}: ${e.message}`);SOURCES.push({name:sym,url,fetched:TODAY,error:e.message});return null}
}
async function gpr(){
  const url='https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.dta';
  try{const b=await cached('gpr_daily.dta',url,true);const d=parseDta118(b);const m=new Map();
    for(const r of d.rows){if(r.GPRD_MA30!=null&&r.DAY){const s=String(r.DAY);m.set(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`,r.GPRD_MA30)}}
    const ks=[...m.keys()];SOURCES.push({name:'GPRD_MA30',url,fetched:TODAY,first:ks[0],last:ks[ks.length-1],n:ks.length});return m;
  }catch(e){log(`SOURCE FAIL GPR: ${e.message}`);SOURCES.push({name:'GPRD_MA30',url,fetched:TODAY,error:e.message});return null}
}
// ---------- utils
const addDays=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
function sortedKV(m){const ks=[...m.keys()].sort();return {ks,vs:ks.map(k=>m.get(k))}}
function asofFn(m){const {ks,vs}=sortedKV(m);return (cutoff)=>{let lo=0,hi=ks.length-1,ans=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(ks[mid]<=cutoff){ans=mid;lo=mid+1}else hi=mid-1}return ans<0?null:{v:vs[ans],d:ks[ans],i:ans}}}
function trailingMeanFn(m,n){const {ks,vs}=sortedKV(m);return (cutoff)=>{let lo=0,hi=ks.length-1,ans=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(ks[mid]<=cutoff){ans=mid;lo=mid+1}else hi=mid-1}if(ans<n-1)return null;let s=0;for(let i=ans-n+1;i<=ans;i++)s+=vs[i];return s/n}}
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const sd=a=>{const mu=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-mu)**2,0)/(a.length-1))};
const quantile=(a,q)=>{const s=[...a].sort((x,y)=>x-y);const p=(s.length-1)*q;const lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo)};
function corr(a,b){const ma=mean(a),mb=mean(b);let sab=0,saa=0,sbb=0;for(let i=0;i<a.length;i++){sab+=(a[i]-ma)*(b[i]-mb);saa+=(a[i]-ma)**2;sbb+=(b[i]-mb)**2}return sab/Math.sqrt(saa*sbb)}
function solve(A,b){const n=b.length;const M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];const pv=M[c][c];if(Math.abs(pv)<1e-12)throw new Error('singular');for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/pv;for(let k=c;k<=n;k++)M[r][k]-=f*M[c][k]}}return M.map((r,i)=>r[n]/r[i])}
function ridgeFit(X,y,lam){const p=X[0].length,n=X.length;const mu=[],sg=[];for(let j=0;j<p;j++){const col=X.map(r=>r[j]);mu.push(mean(col));const s=sd(col);sg.push(s>1e-12?s:1)}
  const Z=X.map(r=>[1,...r.map((v,j)=>(v-mu[j])/sg[j])]);const A=Array.from({length:p+1},()=>Array(p+1).fill(0));const b=Array(p+1).fill(0);
  for(let i=0;i<n;i++){const z=Z[i];for(let j=0;j<=p;j++){b[j]+=z[j]*y[i];for(let k=0;k<=p;k++)A[j][k]+=z[j]*z[k]}}
  for(let j=1;j<=p;j++)A[j][j]+=lam;const beta=solve(A,b);
  return {predict:(x)=>{let s=beta[0];for(let j=0;j<p;j++)s+=beta[j+1]*(x[j]-mu[j])/sg[j];return s},beta}}
function logitFit(X,y,lam=1e-3,iters=25){const p=X[0].length,n=X.length;const mu=[],sg=[];for(let j=0;j<p;j++){const col=X.map(r=>r[j]);mu.push(mean(col));const s=sd(col);sg.push(s>1e-12?s:1)}
  const Z=X.map(r=>[1,...r.map((v,j)=>(v-mu[j])/sg[j])]);let beta=Array(p+1).fill(0);beta[0]=Math.log((mean(y)+1e-6)/(1-mean(y)+1e-6));
  for(let it=0;it<iters;it++){const A=Array.from({length:p+1},()=>Array(p+1).fill(0));const g=Array(p+1).fill(0);
    for(let i=0;i<n;i++){const z=Z[i];let e=0;for(let j=0;j<=p;j++)e+=beta[j]*z[j];const pr=1/(1+Math.exp(-e));const w=pr*(1-pr)+1e-9;for(let j=0;j<=p;j++){g[j]+=z[j]*(y[i]-pr);for(let k=0;k<=p;k++)A[j][k]+=w*z[j]*z[k]}}
    for(let j=1;j<=p;j++){A[j][j]+=lam;g[j]-=lam*beta[j]}const step=solve(A,g);let mx=0;for(let j=0;j<=p;j++){beta[j]+=step[j];mx=Math.max(mx,Math.abs(step[j]))}if(mx<1e-7)break}
  return {prob:(x)=>{let e=beta[0];for(let j=0;j<p;j++)e+=beta[j+1]*(x[j]-mu[j])/sg[j];return 1/(1+Math.exp(-e))},beta}}
function blockBoot(eB2,eM2,blk,B,seed=7){let s=seed;const rnd=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff};const n=eB2.length,nb=Math.ceil(n/blk);const out=[];
  for(let b=0;b<B;b++){let sb=0,sm=0,c=0;for(let k=0;k<nb;k++){const st=Math.floor(rnd()*(n-blk+1));for(let i=st;i<st+blk&&c<n;i++,c++){sb+=eB2[i];sm+=eM2[i]}}out.push(1-Math.sqrt(sm/c)/Math.sqrt(sb/c))}
  return {p05:quantile(out,0.05),p50:quantile(out,0.5),p95:quantile(out,0.95)}}

// ---------- load
log(`PREREG-J run ${new Date().toISOString()}`);
const [SPX,NDX,KS,GOLD,VIXY,DXY,HYG,IEF]=await Promise.all(['^GSPC','^NDX','^KS11','GC=F','^VIX','DX-Y.NYB','HYG','IEF'].map(yahoo));
const [T10Y2Y,WTI,EPU,TB3,NFCI,NFCICREDIT,VIXCLS]=await Promise.all(['T10Y2Y','DCOILWTICO','USEPUINDXD','DGS3MO','NFCI','NFCICREDIT','VIXCLS'].map(fred));
const GPR=await gpr();
for(const s of SOURCES) log(`SRC ${s.name}: ${s.error?'FAIL '+s.error:`${s.first}..${s.last} n=${s.n}`}`);

if(VIXY&&VIXCLS){let diff=0,c=0;for(const [d,v] of VIXCLS){if(VIXY.has(d)){diff+=Math.abs(VIXY.get(d)-v);c++}}log(`VIX cross-check Yahoo vs FRED: mean abs diff ${(diff/c).toFixed(4)} over ${c} days`)}
const VIX=VIXY||VIXCLS;

// ---------- calendar & point-in-time features on S&P dates
const spx=sortedKV(SPX); const D=spx.ks, P=spx.vs; const N=D.length; const idx=new Map(D.map((d,i)=>[d,i]));
const r=Array(N).fill(null);for(let i=1;i<N;i++)r[i]=Math.log(P[i]/P[i-1]);
const vixAs=asofFn(VIX), t2As=asofFn(T10Y2Y), wtiAs=asofFn(WTI), nfAs=asofFn(NFCI), nfcAs=asofFn(NFCICREDIT), gprAs=GPR?asofFn(GPR):null, epuAvg=trailingMeanFn(EPU,30), tbAs=asofFn(TB3), dxyAs=asofFn(DXY);
const nfcSorted=sortedKV(NFCICREDIT);
function nfc4w(cut){const a=nfcAs(cut);if(!a||a.i<4)return null;return a.v-nfcSorted.vs[a.i-4]}
const FEAT_NAMES=['logVIX','NFCI','NFCICREDIT_4w','T10Y2Y','DXY_21d','WTI_21d','logGPR_MA30','logEPU_30d'];
const F=Array(N).fill(null);
const dxyArr=[],wtiArr=[];
for(let i=0;i<N;i++){const d=D[i],prev=D[i-1]??addDays(d,-1);
  const dx=dxyAs(d);dxyArr.push(dx?dx.v:null);const w=wtiAs(prev);wtiArr.push(w?w.v:null)}
for(let i=0;i<N;i++){const d=D[i],prev=D[i-1]??addDays(d,-1),wk=addDays(d,-7);
  const v=vixAs(prev),nf=nfAs(wk),nc=nfc4w(wk),t2=t2As(prev),g=gprAs?gprAs(prev):null,e=epuAvg(prev);
  if(!v||!nf||nc==null||!t2||!g||e==null||i<21||dxyArr[i]==null||dxyArr[i-21]==null||wtiArr[i]==null||wtiArr[i-21]==null||wtiArr[i]<=0||wtiArr[i-21]<=0)continue;
  F[i]=[Math.log(v.v),nf.v,nc,t2.v,Math.log(dxyArr[i]/dxyArr[i-21]),Math.log(wtiArr[i]/wtiArr[i-21]),Math.log(g.v),Math.log(e)]}
const firstF=F.findIndex(x=>x);log(`Features available from ${D[firstF]} (${FEAT_NAMES.join(',')})`);
const tbill=Array(N).fill(0);for(let i=0;i<N;i++){const t=tbAs(D[i-1]??D[i]);tbill[i]=t?t.v/100/252:0}

// ---------- H1a realized vol
const monthEnds=[];for(let i=0;i<N-1;i++){if(D[i].slice(0,7)!==D[i+1].slice(0,7))monthEnds.push(i)}
function rvRange(a,b){const x=[];for(let i=a;i<=b;i++)if(r[i]!=null)x.push(r[i]);return sd(x)*Math.sqrt(252)}
const obsRV=[];
for(const i of monthEnds){if(i<252||i+63>=N||!F[i])continue;if(D[i]<'1991-01-01')continue;obsRV.push({i,d:D[i],base:Math.log(rvRange(i-251,i)),y:Math.log(rvRange(i+1,i+63)),x:F[i]})}
function runH1(obs,label,lam=1.0){
  const eB=[],eBp=[],eM=[],eO=[],dates=[];let lastBeta=null;
  for(let j=0;j<obs.length;j++){const o=obs[j];if(o.d<'2005-01-01')continue;
    const tr=obs.filter(q=>q.i+63<=o.i);if(tr.length<36)continue;
    const bp=ridgeFit(tr.map(q=>[q.base]),tr.map(q=>q.y),0);
    const m=ridgeFit(tr.map(q=>[q.base,...q.x]),tr.map(q=>q.y),lam);
    const ol=ridgeFit(tr.map(q=>[q.base,...q.x]),tr.map(q=>q.y),0);
    eB.push(o.y-o.base);eBp.push(o.y-bp.predict([o.base]));eM.push(o.y-m.predict([o.base,...o.x]));eO.push(o.y-ol.predict([o.base,...o.x]));dates.push(o.d);lastBeta=m.beta}
  const rmse=e=>Math.sqrt(mean(e.map(x=>x*x)));
  const R={label,nOOS:eB.length,oosFrom:dates[0],oosTo:dates[dates.length-1],rmse_B_naive:rmse(eB),rmse_Bplus:rmse(eBp),rmse_M_ridge:rmse(eM),rmse_M_ols:rmse(eO)};
  R.improve_ridge_vs_Bplus=1-R.rmse_M_ridge/R.rmse_Bplus;R.improve_ols_vs_Bplus=1-R.rmse_M_ols/R.rmse_Bplus;R.improve_Bplus_vs_naive=1-R.rmse_Bplus/R.rmse_B_naive;
  R.boot_ridge_vs_Bplus=blockBoot(eBp.map(x=>x*x),eM.map(x=>x*x),12,2000);
  R.verdict=(R.improve_ridge_vs_Bplus>=0.10&&R.boot_ridge_vs_Bplus.p05>0)?'ADOPT':'REJECT';
  const sub={};for(const [k,a,b] of [['2005-2012','2005','2013'],['2013-2019','2013','2020'],['2020-2026','2020','2027']]){const ix=dates.map((d,i)=>i).filter(i=>dates[i]>=a&&dates[i]<b);if(ix.length)sub[k]={n:ix.length,rmse_Bplus:rmse(ix.map(i=>eBp[i])),rmse_M_ridge:rmse(ix.map(i=>eM[i]))}}
  R.subperiods=sub;R.lastBeta_std=lastBeta;
  log(`\n[H1 ${label}] OOS n=${R.nOOS} ${R.oosFrom}..${R.oosTo}`);log(`  RMSE naive=${R.rmse_B_naive.toFixed(4)} B+=${R.rmse_Bplus.toFixed(4)} ridge=${R.rmse_M_ridge.toFixed(4)} ols=${R.rmse_M_ols.toFixed(4)}`);
  log(`  improve ridge vs B+ = ${(100*R.improve_ridge_vs_Bplus).toFixed(1)}%  boot90%=[${(100*R.boot_ridge_vs_Bplus.p05).toFixed(1)}, ${(100*R.boot_ridge_vs_Bplus.p95).toFixed(1)}]  ols vs B+ = ${(100*R.improve_ols_vs_Bplus).toFixed(1)}%  -> ${R.verdict}`);
  log(`  last ridge beta (intercept, base, ${FEAT_NAMES.join(',')}): ${lastBeta.map(b=>b.toFixed(3)).join(' ')}`);
  for(const k in sub)log(`  ${k}: n=${sub[k].n} B+=${sub[k].rmse_Bplus.toFixed(4)} ridge=${sub[k].rmse_M_ridge.toFixed(4)}`);
  return R}
const H1a=runH1(obsRV,'RV S&P 63d');
// ---------- H1b correlation S&P-gold-KOSPI
const common=D.filter(d=>GOLD.has(d)&&KS.has(d));
const cm={};{let prev=null;const arr=[];for(const d of common){if(prev){arr.push({d,rs:Math.log(SPX.get(d)/SPX.get(prev)),rg:Math.log(GOLD.get(d)/GOLD.get(prev)),rk:Math.log(KS.get(d)/KS.get(prev))})}prev=d}cm.arr=arr;cm.idx=new Map(arr.map((o,i)=>[o.d,i]))}
function avgCorr(a,b){const s=cm.arr.slice(a,b+1);return (corr(s.map(o=>o.rs),s.map(o=>o.rg))+corr(s.map(o=>o.rs),s.map(o=>o.rk))+corr(s.map(o=>o.rg),s.map(o=>o.rk)))/3}
const obsC=[];
for(const i of monthEnds){const d=D[i];if(!F[i])continue;let ci=cm.idx.get(d);if(ci==null){let lo=0,hi=cm.arr.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(cm.arr[m].d<=d){ans=m;lo=m+1}else hi=m-1}ci=ans}
  if(ci<252||ci+63>=cm.arr.length)continue;obsC.push({i:ci,d,base:avgCorr(ci-251,ci),y:avgCorr(ci+1,ci+63),x:F[i]})}
log(`\nCorr obs: ${obsC.length} from ${obsC[0]?.d}; common dates n=${cm.arr.length} (${cm.arr[0]?.d}..${cm.arr[cm.arr.length-1]?.d})`);
const H1b=runH1(obsC,'Corr S&P-gold-KOSPI 63d');

// ---------- H2 fear-reserve trigger
function dd63Label(i){let mn=Infinity;for(let k=1;k<=63&&i+k<N;k++)mn=Math.min(mn,P[i+k]/P[i]-1);return mn<=-0.10?1:0}
const vixAt=Array(N).fill(null);for(let i=0;i<N;i++){const v=VIX.get(D[i]);vixAt[i]=v??null}
const ncHist=[];const cond2=Array(N).fill(false);
for(let i=0;i<N;i++){if(!F[i])continue;const nc=F[i][2],nf=F[i][1];ncHist.push(nc);if(ncHist.length>=260){const q=quantile(ncHist,0.9);cond2[i]=(nc>q)||(nf>0)}}
const probs=Array(N).fill(null),thr3=Array(N).fill(null);let lastLogit=null;
{let model=null,th=null;const startSig=idx.get(D.find(d=>d>='2000-01-01'));
  for(let i=startSig;i<N;i++){if(i===startSig||D[i].slice(0,7)!==D[i-1].slice(0,7)){const X=[],Y=[],V=[];for(let k=firstF;k+63<=i;k++){if(!F[k]||D[k]<'1991-01-01')continue;X.push(F[k]);Y.push(dd63Label(k));if(vixAt[k]!=null)V.push(vixAt[k])}
      model=logitFit(X,Y);const fitted=X.map(x=>model.prob(x));const fr=[30,40,50].map(t=>V.filter(v=>v>=t).length/V.length);th=fr.map(f=>f>0?quantile(fitted,1-f):Infinity);lastLogit={beta:model.beta,n:X.length,baseRate:mean(Y),thresholds:th,vixFreq:fr}}
    if(F[i]){probs[i]=model.prob(F[i]);thr3[i]=th}}}
log(`\n[H2 logistic, last refit] n=${lastLogit.n} baseRate(dd<=-10% in 63d)=${lastLogit.baseRate.toFixed(3)} beta(std; intercept,${FEAT_NAMES.join(',')})=${lastLogit.beta.map(b=>b.toFixed(2)).join(' ')} thresholds=${lastLogit.thresholds.map(t=>t.toFixed(3)).join('/')} vixFreq30/40/50=${lastLogit.vixFreq.map(f=>(100*f).toFixed(2)+'%').join('/')}`);
function simulate(Pr,startI,endI,variant){
  let cash=1.0,shares=0,rungDone=[false,false,false],epiCash=1.0,refHigh=null,runMax=-Infinity;const deps=[];let pending=null;
  for(let i=startI;i<endI;i++){cash*=1+tbill[i];const p=Pr[i];if(p==null)continue;
    if(pending){const amt=Math.min(cash,epiCash/3);cash-=amt;shares+=amt/p;deps.push({i,rung:pending,price:p});pending=null}
    if(shares>0&&refHigh!=null&&p>refHigh){cash+=shares*p;shares=0;rungDone=[false,false,false];refHigh=null}
    runMax=Math.max(runMax,p);
    let sig=null;
    if(variant==='i'||variant==='ii'){const v=vixAt[i];if(v!=null){for(let k=2;k>=0;k--){if(!rungDone[k]&&v>=[30,40,50][k]){sig=k;break}}}
      if(sig!=null&&variant==='ii'&&!cond2[i])sig=null}
    else if(variant==='iii'){const pr=probs[i],th=thr3[i];if(pr!=null&&th){for(let k=2;k>=0;k--){if(!rungDone[k]&&pr>=th[k]){sig=k;break}}}}
    if(sig!=null){let k=rungDone.indexOf(false);if(k>=0&&k<=sig){if(shares===0&&!rungDone.some(x=>x)){epiCash=cash;refHigh=runMax}rungDone[k]=true;pending=k+1}}
  }
  let pEnd=null;for(let i=endI-1;i>=startI;i--){if(Pr[i]!=null){pEnd=Pr[i];break}}let cashOnly=1.0;for(let i=startI;i<endI;i++)cashOnly*=1+tbill[i];
  return {terminal:cash+shares*pEnd,cashOnly,deps}}
function priceArr(m){return D.map(d=>m.get(d)??null)}
const assets={SPX:P,NDX:priceArr(NDX)};
const H2={};
for(const [an,Pr] of Object.entries(assets)){
  const res={};const firstP=Pr.findIndex(x=>x!=null);
  const sampleStart=Math.max(firstP,idx.get(D.find(d=>d>='1990-02-01')));
  for(const v of ['i','ii','iii']){const st=v==='iii'?idx.get(D.find(d=>d>='2000-01-01')):sampleStart;const s=simulate(Pr,st,N,v);
    const fwd=s.deps.filter(x=>x.i+252<N&&Pr[x.i+252]!=null).map(x=>{let c=1;for(let k=x.i+1;k<=x.i+252;k++)c*=1+tbill[k];return {d:D[x.i],rung:x.rung,ex:Pr[x.i+252]/x.price-c}});
    res[v]={from:D[st],nDeploy:s.deps.length,nDeploy2000plus:s.deps.filter(x=>D[x.i]>='2000').length,nWith12m:fwd.length,mean12mExcess:fwd.length?mean(fwd.map(f=>f.ex)):null,median12mExcess:fwd.length?quantile(fwd.map(f=>f.ex),0.5):null,hit:fwd.length?mean(fwd.map(f=>f.ex>0?1:0)):null,deployDates:s.deps.map(x=>`${D[x.i]}:r${x.rung}`)};
    log(`\n[H2 ${an} variant ${v}] from ${D[st]} deployments=${s.deps.length} (12m-measurable ${fwd.length}) mean12mExcess=${res[v].mean12mExcess==null?'n/a':(100*res[v].mean12mExcess).toFixed(1)+'%'} median=${res[v].median12mExcess==null?'n/a':(100*res[v].median12mExcess).toFixed(1)+'%'} hit=${res[v].hit==null?'n/a':(100*res[v].hit).toFixed(0)+'%'}`);
    log(`   dates: ${res[v].deployDates.join(' ')}`)}
  function windows(fromDate){const out=[];for(const i of monthEnds){const st=i+1;if(st>=N||D[st]<fromDate)continue;const endD=addDays(D[st],3652);const e=D.findIndex(d=>d>=endD);if(e<0)break;out.push([st,e])}return out}
  for(const [tag,fromD,vs] of [['win2000',"2000-01-01",['i','ii','iii']],['win1990',"1990-02-01",['i','ii']]]){
    const W=windows(fromD).filter(([s])=>s>=firstP);const rows=W.map(([s,e])=>{const o={start:D[s],end:D[e-1]};for(const v of vs){const rr=simulate(Pr,s,e,v);o[v]=rr.terminal;o[v+'_n']=rr.deps.length;o.cash=rr.cashOnly}return o});
    const summ={nWindows:rows.length,from:rows[0]?.start,to:rows[rows.length-1]?.start};
    for(const v of vs){summ[`share_${v}_beats_cash`]=mean(rows.map(o=>o[v]>o.cash?1:0));summ[`mean_terminal_${v}`]=mean(rows.map(o=>o[v]));summ[`mean_triggers_${v}`]=mean(rows.map(o=>o[v+'_n']))}
    summ.mean_terminal_cash=mean(rows.map(o=>o.cash));
    for(const v of vs.filter(x=>x!=='i')){summ[`share_${v}_beats_i`]=mean(rows.map(o=>o[v]>o.i?1:0));summ[`share_${v}_ties_i`]=mean(rows.map(o=>o[v]===o.i?1:0))}
    res[tag]=summ;log(`\n[H2 ${an} ${tag}] windows=${summ.nWindows} ${summ.from}..${summ.to} meanTerminalCash=${summ.mean_terminal_cash.toFixed(3)}`);for(const v of vs)log(`   ${v}: beats cash ${(100*summ[`share_${v}_beats_cash`]).toFixed(0)}% meanTerminal=${summ[`mean_terminal_${v}`].toFixed(3)} meanTriggers=${summ[`mean_triggers_${v}`].toFixed(2)}`+(v!=='i'?` beats(i) ${(100*summ[`share_${v}_beats_i`]).toFixed(0)}% ties ${(100*summ[`share_${v}_ties_i`]).toFixed(0)}%`:''))}
  H2[an]=res}
const H2verdict={};
for(const v of ['ii','iii']){const cnt={};let ok=true;
  for(const a of ['SPX','NDX']){const plain=v==='iii'?H2[a].i.nDeploy2000plus:H2[a].i.nDeploy;const vn=H2[a][v].nDeploy;cnt[a]={variant:vn,plain_same_period:plain};
    if(!(H2[a].win2000[`share_${v}_beats_i`]>=0.70&&vn>=0.5*plain))ok=false}
  H2verdict[v]={adopt:ok,shares:{SPX:H2.SPX.win2000[`share_${v}_beats_i`],NDX:H2.NDX.win2000[`share_${v}_beats_i`]},triggers:cnt};
  log(`\n[H2 verdict ${v}] ${ok?'ADOPT':'REJECT'} share beat(i): SPX ${(100*H2verdict[v].shares.SPX).toFixed(0)}% NDX ${(100*H2verdict[v].shares.NDX).toFixed(0)}% triggers ${JSON.stringify(cnt)}`)}

// ---------- latest state vector JSON
const li=N-1;const lastF=F[li];const state={asof:D[li],generated:new Date().toISOString(),point_in_time:'daily FRED lag 1 trading day; weekly NFCI lag 7 days; GPR/EPU lag 1 day; Yahoo close same day',
  features:FEAT_NAMES.map((n,j)=>({name:n,value:lastF?lastF[j]:null})),
  raw:{vix_close:vixAt[li],vix_prev:vixAs(D[li-1])?.v,nfci:nfAs(addDays(D[li],-7)),nfcicredit_4w:nfc4w(addDays(D[li],-7)),t10y2y:t2As(D[li-1]),wti:wtiAs(D[li-1]),dxy:dxyAs(D[li]),gpr_ma30:gprAs?gprAs(D[li-1]):null,epu30:epuAvg(D[li-1]),tbill3m:tbAs(D[li-1])},
  drawdown_prob_63d:probs[li],logit_thresholds:thr3[li],credit_cond_ii:cond2[li],sources:SOURCES};
fs.writeFileSync('macro_state.json',JSON.stringify(state,null,1));
fs.writeFileSync('macro.json',JSON.stringify({prereg:'PREREG-J.md',run:new Date().toISOString(),sources:SOURCES,features:FEAT_NAMES,H1a,H1b,H2,H2verdict,lastLogit,state},null,1));
fs.writeFileSync('macro.out',LOG.join('\n'));
log('\nwrote macro.json macro.out macro_state.json');
