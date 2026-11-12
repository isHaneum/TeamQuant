import {createDeviceStore} from './lib/device-store.js';
import {localStatus} from './lib/local-status.js';
import {createInvestmentStore} from './lib/investment-store.js';
import {createCashStore} from './lib/cash-store.js';
import {fetchFundamentals} from './lib/fundamentals.js';
import {readIssueFeed} from './lib/issue-feed.js';
import {fetchQuote} from './lib/quote-check.js';
import {createPerformanceStore} from './lib/performance-store.js';
import {createHistoryStore} from './lib/history-store.js';
import {createHistoryRecorder} from './lib/history-recorder.js';
import {createLocalBridge} from './lib/local-bridge.js';
import {allowLocalToss,createTossReader} from './lib/toss.js';
import {privateAccountStatus,readPrivateAccount} from './lib/private-account.js';
import {searchStocks} from "./lib/stocks.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMarketSeries, fetchHeldMarketSeries } from "./lib/market.js";
import { fetchNews } from "./lib/news.js";
import { fetchCompanyBrief } from "./lib/dart.js";
import { fetchKisAccount } from "./lib/kis.js";
import { getResearchStatus, startResearchRefresh } from "./lib/research-job.js";
import { applyKeyFiles, kisReadOnlySettings } from "./lib/key-files.js";
import { readFileSync } from "node:fs";
import { createKisClient } from "./lib/kis-orders.js";
import { createKisReader } from "./lib/kis-reader.js";
import { createRealRecord } from "./lib/real-record.js";
import { createTossRecordReader } from "./lib/toss-record-reader.js";
import { createPaperLive, createLedgerStore, ledgerDir } from "./lib/paper-live.js";
import { publicSnapshot } from "./lib/paper-public.js";
import { writeFileSync } from "node:fs";
import { execFile } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));
for (const file of [".env", ".env.local"]) {
  try { process.loadEnvFile(join(root, file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
// 키 파일(.env.local 의 *_KEY_FILE 경로)을 환경 변수로 올린다. 값은 로그에 남기지 않는다.
const keyFiles = applyKeyFiles(process.env);
if (keyFiles.kis.reason) console.log(`[KIS] ${keyFiles.kis.reason}`); if (keyFiles.dart.reason) console.log(`[DART] ${keyFiles.dart.reason}`);
const port = Number(process.env.PORT || 8766);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".zip":"application/zip" };

const historyStore=createHistoryStore({publicRoots:[root]});
const historyRecorder=createHistoryRecorder({store:historyStore});
const performanceStore=createPerformanceStore({publicRoots:[root]});
const investments=createInvestmentStore({publicRoots:[root,join(root,'..')]});
const cashStore=createCashStore({publicRoots:[root,join(root,'..')]});
const fetchTossHoldings=createTossReader({onSnapshot:historyRecorder.snapshot,onFailure:historyRecorder.failure});
// 한투 모의계좌 실행 엔진(모의 키가 있을 때만). 실전 모드(prod)에서는 만들지 않는다.
let paperLive=null;try{if(keyFiles.kis.configured&&keyFiles.kis.mode==='vps'){let limits={};try{limits=process.env.PAPER_LIVE_LIMITS?JSON.parse(process.env.PAPER_LIVE_LIMITS):{};}catch{}const defaultPlan=()=>{try{const d=JSON.parse(readFileSync(join(root,'data/paper-plan.json'),'utf8'));return Object.fromEntries(Object.entries(d.weights||{}).map(([k,v])=>[k,{pct:v.pct,name:v.name,currency:v.currency}]));}catch{return null;}};const defaultPlanVersion=()=>{try{return JSON.parse(readFileSync(join(root,'data/paper-plan.json'),'utf8')).version||null;}catch{return null;}};paperLive=createPaperLive({client:createKisClient({tokenFile:join(ledgerDir(),'kis-vps-token.json')}),store:createLedgerStore(ledgerDir()),readMarket:fetchHeldMarketSeries,defaultPlan,defaultPlanVersion,defaultPlanDoc:()=>{try{return JSON.parse(readFileSync(join(root,'data/paper-plan.json'),'utf8'));}catch{return null;}},limits});
// 공개 스냅샷: 모의계좌는 가상 돈이라 누구나 봐도 된다. status() 를 줄여(계좌번호·경로·주문번호 제외) data/paper-live-public.json 에 적고(PAPER_LIVE_PUBLISH_REPO 에도),
// PAPER_LIVE_PUBLISH=1 이면 하루 한 번(16:00 KST 뒤) 그 파일 하나만 커밋·푸시한다. 다른 변경은 건드리지 않는다(pathspec 커밋).
const publicRepo=process.env.PAPER_LIVE_PUBLISH_REPO||null,publicFiles=[join(root,'data','paper-live-public.json'),...(publicRepo&&publicRepo!==root?[join(publicRepo,'data','paper-live-public.json')]:[])];
const git=(args,timeout)=>new Promise(res=>execFile('git',args,{timeout,windowsHide:true},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||'')})));
paperLive.publishPublic=async({push=false}={})=>{const st=await paperLive.status();const pub=publicSnapshot(st,{asOf:new Date().toISOString()});let written=0;for(const f of publicFiles){try{writeFileSync(f,JSON.stringify(pub,null,1));written++;}catch(e){console.log(`[KIS 공개] 쓰기 실패: ${e.message}`);}}
  let pushed=null;if(push&&publicRepo){const day=pub.asOf.slice(0,10);const c=await git(['-C',publicRepo,'commit','-q','-m',`Mock account snapshot ${day}\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`,'--','data/paper-live-public.json'],60e3);if(!c.ok)pushed={ok:false,note:/nothing to commit|no changes|nothing added/.test(c.out+c.err)?'변화 없음':'커밋 실패'};else{const p=await git(['-C',publicRepo,'push','-q'],120e3);pushed={ok:p.ok,note:p.ok?'푸시 완료':'푸시 실패'};}console.log(`[KIS 공개] ${pub.asOf} ${pushed.note}`);}
  return {...pub,written,pushed};};
// 자동 실행(PAPER_LIVE_AUTO=1): 10분마다 확인. 시장이 열려 있고 금요일·급함·계획 변경·첫 운용일 때만 하루 한 번 보낸다. 그 밖에는 점검만.
if(process.env.PAPER_LIVE_AUTO==='1'){let publishedDay=null,publicWroteAt=0;const autoTick=async()=>{try{const r=await paperLive.autoRun();if(r.ran)console.log(`[KIS 자동] ${new Date().toISOString()} ${r.market} ${r.reason}: 할 일 ${r.items} · 보냄 ${r.sent} · 차단 ${r.blocked}`);}catch(e){console.log(`[KIS 자동] 실패: ${e.message}`);}
  // 공개 스냅샷은 25분마다 파일로, 하루 한 번(16:00 KST 뒤)은 저장소에도.
  try{const kst=new Date(Date.now()+9*3600e3),day=kst.toISOString().slice(0,10),hhmm=kst.getUTCHours()*100+kst.getUTCMinutes(),push=process.env.PAPER_LIVE_PUBLISH==='1'&&hhmm>=1600&&publishedDay!==day;if(push||Date.now()-publicWroteAt>=25*60e3){if(push)publishedDay=day;publicWroteAt=Date.now();await paperLive.publishPublic({push});}}catch(e){console.log(`[KIS 공개] 실패: ${e.message}`);}};setInterval(autoTick,10*60e3).unref();setTimeout(autoTick,30e3).unref();console.log('[KIS] 자동 실행 켜짐(10분마다 확인 · 금요일/급함/계획 변경/첫 운용에만 전송)');}console.log(`[KIS] 모의계좌 ${keyFiles.kis.accountMasked} 실행 엔진 준비 (장부: ${ledgerDir()})`);}}catch(e){console.log(`[KIS] 모의계좌 엔진을 만들지 못했습니다: ${e.message}`);}
// 실계좌 읽기 전용 기록(2026-11-12 결정 22): KIS_REAL_READONLY=1 이면 같은 키 파일의 실전 이름표로 '조회만' 한다. 넘기는 리더(lib/kis-reader.js)에는 주문 함수가 없고 GET 이 아닌 요청은 던지므로 이 경로에서 주문이 나갈 수 없다.
// 실전 키는 process.env 에 올리지 않고(엔진의 env 는 모의 한 벌만), 장부는 kis-prod-*.json 으로 모의 장부와 분리한다. 공개 스냅샷은 쓰지 않는다(개인 자료) — 위 publishPublic 은 모의계좌 status 만 받는다. 로그에는 값·계좌번호·경로·증권사 문구를 남기지 않는다.
// 결정 24: REAL_RECORD_SOURCE=toss 면 실제 돈이 있는 토스 종합계좌를 같은 방식(읽기 전용 · 하루 한 점 · 해시 체인 · 공개 안 함)으로 기록한다. 토스 리더는 화면용(onSnapshot 보유 기록)과 따로 만든다.
function startRealTick(label){const realTick=async()=>{try{const s=await realRecord.status();if(s.error)console.log(`[실계좌] 평가 보류 (조회 실패)`);}catch(e){console.log(`[실계좌] 기록 실패 (${e.code||'error'})`);}};setInterval(realTick,25*60e3).unref();setTimeout(realTick,45e3).unref();console.log(`[실계좌] ${label} 읽기 전용 기록 준비 (주문 기능 없음 · 25분마다 평가 · 공개 안 함)`);}
let realRecord=null;try{const ro=process.env.REAL_RECORD_SOURCE==='toss'?{configured:false}:kisReadOnlySettings(process.env);if(process.env.REAL_RECORD_SOURCE==='toss'){realRecord=createRealRecord({reader:createTossRecordReader({read:createTossReader()}),store:createLedgerStore(ledgerDir(),{prefix:'real'}),readMarket:fetchHeldMarketSeries});startRealTick('토스 종합계좌');}else if(ro.configured){realRecord=createRealRecord({reader:createKisReader({settings:ro,tokenFile:join(ledgerDir(),'kis-prod-token.json')}),store:createLedgerStore(ledgerDir(),{prefix:'kis-prod'}),readMarket:fetchHeldMarketSeries});
  const realTick=async()=>{try{const s=await realRecord.status();if(s.error)console.log(`[KIS 실계좌] 평가 보류 (조회 실패)`);}catch(e){console.log(`[KIS 실계좌] 기록 실패 (${e.code||'error'})`);}};setInterval(realTick,25*60e3).unref();setTimeout(realTick,45e3).unref();
  console.log(`[KIS 실계좌] ${ro.accountMasked} 읽기 전용 기록 준비 (주문 기능 없음 · 25분마다 평가 · 공개 안 함)`);}else if(process.env.KIS_REAL_READONLY==='1')console.log(`[KIS 실계좌] ${ro.reason}`);}catch(e){console.log(`[KIS 실계좌] 준비 실패 (${e.code||'error'})`);}
const bridge=createLocalBridge({port,paperLive,realRecord,devices:createDeviceStore({publicRoots:[root,join(root,'..')]}),readHoldings:fetchTossHoldings,readOrders:input=>fetchTossHoldings.orders(input),readMarket:fetchHeldMarketSeries,readNews:fetchNews,readStatus:()=>localStatus(),performance:performanceStore,investments,cash:cashStore,readHistory:async()=>{const r=await historyStore.list({limit:1000});return {...r,records:r.records.map(x=>({id:x.id,accountId:x.accountId,observedAt:x.observedAt,status:x.status,errorCode:x.errorCode,data:x.data?{totals:x.data.totals,fx:x.data.fx,cashKnown:false}:null}))};}});
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if(url.pathname.startsWith('/api/bridge/')){
      let size=0,raw='',body={};
      for await(const chunk of request){size+=chunk.length;if(size>(url.pathname==='/api/bridge/performance-import'?4_000_000:url.pathname.startsWith('/api/bridge/investment-')?65536:4096)){response.writeHead(413);return response.end();}raw+=chunk;}
      try{if(raw)body=JSON.parse(raw);}catch{response.writeHead(400);return response.end();}
      const result=await bridge.handle(request,url.pathname.split('/').at(-1),body);
      response.writeHead(result.status,result.headers);return response.end(result.body?JSON.stringify(result.body):'');
    }
    if(url.pathname==='/api/toss-account'){
      response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('Cache-Control','private, no-store');
      if(!allowLocalToss(request,port)){response.writeHead(403);return response.end(JSON.stringify({error:'본인 PC의 TeamQuant 화면에서만 조회할 수 있습니다.'}));}
      try{const data=await fetchTossHoldings();return response.end(JSON.stringify(data));}catch(error){response.writeHead(error.status||502);return response.end(JSON.stringify({error:error.message,code:error.code||'upstream_failed'}));}
    }
    if (url.pathname === '/api/account-connect') {
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return response.end(JSON.stringify(privateAccountStatus()));
    }
    if (url.pathname === '/api/stocks') {
      if(request.method!=='GET'){response.writeHead(405);return response.end();}
      const data=await searchStocks(url.searchParams.get('q'),url.searchParams.get('code'));
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return response.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/dart') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      try { const data = await fetchCompanyBrief(url.searchParams.get('code') || ''); response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); return response.end(JSON.stringify(data)); }
      catch (error) { response.writeHead(error.status || 502, {'Content-Type':'application/json; charset=utf-8'}); return response.end(JSON.stringify({error:error.message})); }
    }
    if (url.pathname === '/api/fundamentals') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      try { const data = await fetchFundamentals(url.searchParams.get('symbol') || ''); response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, max-age=600'}); return response.end(JSON.stringify(data)); }
      catch (error) { response.writeHead(error.status || 502, {'Content-Type':'application/json; charset=utf-8'}); return response.end(JSON.stringify({error:error.message})); }
    }
    if (url.pathname === '/api/quote') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      try { const q = await fetchQuote(url.searchParams.get('symbol') || ''); response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); return response.end(JSON.stringify(q)); }
      catch (error) { response.writeHead(error.status || 502, {'Content-Type':'application/json; charset=utf-8'}); return response.end(JSON.stringify({error:error.message})); }
    }
    if (url.pathname === '/api/issues') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      try { const { data } = await readIssueFeed(url.searchParams, { localDir: join(root, '.issue-data') }); response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}); return response.end(JSON.stringify(data === null ? { available: false } : { available: true, ...(Array.isArray(data) ? { items: data } : data) })); }
      catch (error) { response.writeHead(error.status || 502, {'Content-Type':'application/json; charset=utf-8'}); return response.end(JSON.stringify({error:error.message})); }
    }
    if (url.pathname === '/api/news') {
      if (request.method !== 'GET') { response.writeHead(405, {'Allow':'GET'}); return response.end(); }
      const data = await fetchNews(url.searchParams.get('query'), url.searchParams.get('sort') || 'date');
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store'});
      return response.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/ml') {
      const report=await readFile(join(root,'data','ml-report.json'));
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return response.end(report);
    }
    if (url.pathname === '/api/research') {
      if(!['GET','POST'].includes(request.method)){response.writeHead(405);return response.end();}
      if(request.method==='POST') {
        const allowedOrigin=`http://127.0.0.1:${port}`;
        if(request.headers.origin!==allowedOrigin || request.headers['x-teamquant-action']!=='refresh'){
          response.writeHead(403);return response.end(JSON.stringify({error:'허용되지 않은 요청'}));
        }
      }
      response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      return response.end(JSON.stringify(request.method==='GET'?getResearchStatus():startResearchRefresh()));
    }
    if (url.pathname === "/api/market") {
      const data = await fetchMarketSeries(url.searchParams.get("symbol") || "005930.KS", url.searchParams.get("range") || "1y");
      response.writeHead(200, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
      return response.end(JSON.stringify(data));
    }
    if (url.pathname === "/api/kis-account") {
      const result = await readPrivateAccount(request,{readAccount:fetchKisAccount});
      const data=result.body;
      response.writeHead(result.status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"private, no-store" });
      return response.end(JSON.stringify(data));
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    // Only public application assets. Never expose .env, model files or SQLite journals.
    if(!/^(?:downloads\/TeamQuant-PC\.zip|index\.html|styles\.css|typography\.css|overview\.css|overview-ui\.js|planner-ui\.js|planner\.css|investor-ui\.js|connected-workspace-ui\.js|workspace-ui\.js|workspace\.css|account-ui\.js|toss-ui\.js|bridge-client\.js|asset-hub-ui\.js|performance-ui\.js|performance-view-ui\.js|orders-ui\.js|help-ui\.js|app\.js|ml-ui\.js|news-ui\.js|journey-ui\.js|flow-ui\.js|brief-ui\.js|brief\.css|lab-ui\.js|lab\.css|portfolio-ui\.js|tooltip-ui\.js|demo-ui\.js|issues-ui\.js|issues\.css|response-ui\.js|core-ui\.js|core\.css|paper-ui\.js|paper-account-ui\.js|sector-ui\.js|stock-search-ui\.js|company-ui\.js|growth-ui\.js|lib\/(?:client-data|company-lab|core-rules|core-risk|report-card|paper-trading|paper-public|strategy-review|sectors|rule-presets|situation|situation-strategies|issue-bot|risk-models|shock-analogs|market-response|strategy-lab|stock-score|move-explain|portfolio-advice|backtest|oos-validation|market-brief|asset-timeline|trade-review|market-reasons|trading-habits|dca-advisor|natural-language|instruments|comparison|portfolio|briefing|asset-workspace|performance-view|product-catalog|performance-import|performance-math|performance-benchmark|last-observation|investor-tools|candlestick-view|account-view|trusted-device|holdings-overview|goal-engine|allocation-planner)\.js|data\/(?:ml-report|stock-names|situation-stats|shock-study|risk-model-report|core-validation|strategy-evidence|company-history|growth-study|growth-outlook|growth-ledger|growth-universe|growth-strategy|paper-rehearsal|sectors|paper-plan|paper-live-public)\.json)$/.test(requested)){
      response.writeHead(404);return response.end();
    }
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch (error) {
    const status = error.status || (error.code === "ENOENT" ? 404 : 400);
    response.writeHead(status, { "Content-Type":"application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, "127.0.0.1", () => console.log(`Team Quant simulator: http://127.0.0.1:${port}`));
