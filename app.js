import "/news-ui.js";
import { createStrategyDefinition, runBacktest } from "/lib/backtest.js";
import { parseNaturalStrategy } from "/lib/natural-language.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
let activeUser = null, draft = null, currentData = null, currentResult = null;

const examples = {
  ma: "20일 이동평균이 60일 이동평균을 상향 돌파하고 RSI 14가 70 미만일 때 매수. 하향 돌파하면 매도. 손절 8%, 종목당 비중 20%.",
  rsi: "RSI 14가 과매도 30을 다시 넘으면 매수하고 과매수 70 아래로 내려오면 매도. 손절 10%, 비중 30%.",
  breakout: "20일 최고가를 돌파하면 매수하고 10일 최저가를 깨면 매도. 손절 7%, 익절 20%, 비중 25%."
};

function money(value) { return `${won.format(Number(value || 0))}원`; }
function pct(value) { return value === null || value === undefined ? "—" : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`; }
function toast(message) { const node=$("#toast"); node.textContent=message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>node.classList.remove("show"),2200); }
function stateKey() { return `teamQuant:user:${activeUser}`; }
function defaultState() { return { approved:null, activeStrategy:null, lastRun:null, paper:{ initialCash:10_000_000, cash:10_000_000, holdings:{}, orders:[] }, logs:[] }; }
function loadState() { try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(stateKey()) || "{}") }; } catch { return defaultState(); } }
function saveState(state) { localStorage.setItem(stateKey(), JSON.stringify(state)); }
async function hash(text) { const data=new TextEncoder().encode(text); const digest=await crypto.subtle.digest("SHA-256",data); return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join(""); }

function showPage(name) {
  $$(".view").forEach(node=>node.classList.toggle("active",node.dataset.page===name));
  $$(".nav-button").forEach(node=>node.classList.toggle("active",node.dataset.view===name));
  if(name==="assets") renderAssets(); if(name==="evidence") renderEvidence(); window.scrollTo({top:0,behavior:"smooth"});
}

function indicatorText(indicators={}) {
  const labels={fastSma:"단기 MA",slowSma:"장기 MA",previousFastSma:"전일 단기 MA",previousSlowSma:"전일 장기 MA",rsi:"RSI",previousRsi:"전일 RSI",close:"종가",entryHigh:"진입 최고가",exitLow:"청산 최저가"};
  return Object.entries(indicators).map(([key,value])=>`${labels[key]||key} ${won.format(value)}`).join(" · ") || "—";
}

function renderMiniChart(items=[]) {
  const node=$("#home-chart"); if(items.length<2){node.innerHTML="";return;}
  const width=720,height=170,p=8,values=items.map(x=>x.value),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
  const points=values.map((v,i)=>`${p+i/(values.length-1)*(width-p*2)},${p+(max-v)/span*(height-p*2)}`).join(" ");
  node.innerHTML=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><line class="grid-line" x1="0" y1="${height/2}" x2="${width}" y2="${height/2}"/><polyline class="series" points="${points}"/></svg>`;
}

function renderDashboard() {
  const state=loadState(), approved=state.approved, run=state.lastRun, paper=state.paper;
  $("#welcome-name").textContent=activeUser; $("#user-name").textContent=activeUser;
  $("#home-strategy").textContent=approved?.definition.name||"없음"; $("#home-strategy-id").textContent=approved?.definition.id||"전략을 먼저 승인하세요.";
  const total=paper.cash+Object.values(paper.holdings).reduce((sum,h)=>sum+h.qty*h.lastPrice,0), profit=(total/paper.initialCash-1)*100;
  $("#home-total").textContent=money(total); $("#home-profit").textContent=`초기 자금 대비 ${pct(profit)}`;
  $("#home-decision").textContent=run?.latestDecision.decision||"—"; $("#home-reason").textContent=run?.latestDecision.reason||"검증 후 표시됩니다.";
  $("#home-result-title").textContent=run?`${run.symbol} · ${pct(run.summary.totalReturn)}`:"검증 결과 없음"; $("#home-result-copy").textContent=run?`${run.startDate}~${run.endDate} · MDD -${run.summary.maxDrawdown.toFixed(2)}% · 평가 구간 ${pct(run.validationReturn)}`:"승인된 전략을 시장 데이터로 검증하세요.";
  renderMiniChart(run?.equity||[]); $("#journey-approve").classList.toggle("done",!!approved); $("#journey-test").classList.toggle("done",!!run); $("#journey-paper").classList.toggle("done",!!state.activeStrategy);
}

function restoreApproved() {
  const approved=loadState().approved; if(!approved)return;
  $("#natural-rule").value=approved.original; draft={original:approved.original,config:approved.config,warnings:[],definition:approved.definition}; renderDraft(); $("#approve-check").checked=true; $("#run-backtest").disabled=false; $("#verify-state").textContent=`승인됨 · ${approved.definition.id}`;
}

function renderDraft() {
  if(!draft)return; const def=draft.definition;
  $("#review-name").textContent=def.name; $("#review-entry").textContent=def.entryRule; $("#review-exit").textContent=def.exitRule; $("#review-risk").textContent=def.riskRule;
  const warning=$("#parse-warning"); warning.hidden=!draft.warnings.length; warning.textContent=draft.warnings.join(" "); $("#approve-check").checked=false; $("#approve-strategy").disabled=true;
}

function parseRule() {
  try { const parsed=parseNaturalStrategy($("#natural-rule").value); draft={...parsed,definition:createStrategyDefinition(parsed.config)}; renderDraft(); toast("변환된 규칙을 확인하세요."); }
  catch(error){toast(error.message);}
}

function approveStrategy() {
  if(!draft||!$("#approve-check").checked)return; const state=loadState(); state.approved={...draft,approvedAt:new Date().toISOString()}; state.activeStrategy=null; saveState(state); $("#run-backtest").disabled=false; $("#verify-state").textContent=`승인됨 · ${draft.definition.id}`; $("#verify-result").hidden=true; renderDashboard(); toast("전략을 승인했습니다.");
}

async function runApprovedBacktest() {
  const state=loadState(); if(!state.approved)return toast("전략을 먼저 승인하세요."); const button=$("#run-backtest"); button.disabled=true; button.textContent="데이터 조회 중";
  try {
    const symbol=$("#symbol").value.trim().toUpperCase(), range=$("#range").value, response=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${range}`), data=await response.json(); if(!response.ok)throw new Error(data.error||"시장 데이터 조회 실패");
    const cost=Number($("#cost").value)/100, options={...state.approved.config,initialCapital:Number($("#capital").value),feeRate:cost/2,slippageRate:cost/2};
    const result=runBacktest(data.candles,options); let validationReturn=null;
    try { const split=Math.floor(data.candles.length*.7), segment=data.candles.slice(split); validationReturn=runBacktest(segment,options).summary.totalReturn; } catch {}
    currentData=data; currentResult=result; const latest=result.decisions.at(-1);
    state.lastRun={symbol:data.symbol,startDate:data.candles[0].date,endDate:data.candles.at(-1).date,lastPrice:data.candles.at(-1).close,summary:result.summary,validationReturn,latestDecision:latest,equity:result.equity.filter((_,i)=>i%Math.max(1,Math.floor(result.equity.length/100))===0),strategy:result.strategy,settings:result.settings};
    const log={id:`${result.strategy.id}:${data.symbol}:${latest.date}`,date:latest.date,symbol:data.symbol,strategyDecision:latest.decision,userAction:null,indicators:latest.indicators,reason:latest.reason,strategyId:result.strategy.id,createdAt:new Date().toISOString()}; const index=state.logs.findIndex(x=>x.id===log.id); if(index>=0)state.logs[index]={...state.logs[index],...log,userAction:state.logs[index].userAction};else state.logs.push(log);
    saveState(state); $("#result-return").textContent=pct(result.summary.totalReturn); $("#result-mdd").textContent=`-${result.summary.maxDrawdown.toFixed(2)}%`; $("#result-validation").textContent=pct(validationReturn); const gap=validationReturn===null?null:result.summary.totalReturn-validationReturn; $("#robust-warning").textContent=gap!==null&&gap>10?`전체 구간보다 평가 구간 수익률이 ${gap.toFixed(1)}%p 낮습니다. 기간과 변수 변경 검증이 필요합니다.`:"전체 구간과 평가 구간을 분리해 계산했습니다."; $("#verify-result").hidden=false; $("#verify-state").textContent=`${data.symbol} · ${data.candles.at(-1).date} 기준`; renderDashboard(); toast("검증을 완료했습니다.");
  } catch(error){toast(error.message); $("#verify-state").textContent=error.message;} finally{button.disabled=false;button.textContent="검증 실행";}
}

function registerPaper() { const state=loadState(); if(!state.lastRun)return; state.activeStrategy={...state.approved,registeredAt:new Date().toISOString(),symbol:state.lastRun.symbol}; if(state.paper.initialCash!==Number($("#capital").value)&&!state.paper.orders.length){state.paper.initialCash=Number($("#capital").value);state.paper.cash=state.paper.initialCash;} saveState(state); renderDashboard(); showPage("assets"); toast("모의 운용에 등록했습니다."); }

function renderAssets() {
  const state=loadState(),paper=state.paper,run=state.lastRun,holdings=Object.values(paper.holdings); let holdingValue=0,pnl=0;
  $("#holdings-body").innerHTML=holdings.length?holdings.map(h=>{const value=h.qty*h.lastPrice,itemPnl=(h.lastPrice-h.avgPrice)*h.qty;holdingValue+=value;pnl+=itemPnl;return `<tr><td>${h.symbol}</td><td>${won.format(h.qty)}주</td><td>${money(h.avgPrice)}</td><td>${money(h.lastPrice)}</td><td class="${itemPnl>=0?'good':'bad'}">${money(itemPnl)}</td></tr>`}).join(""):'<tr><td colspan="5" class="empty">보유 종목이 없습니다.</td></tr>';
  $("#asset-total").textContent=money(paper.cash+holdingValue); $("#asset-cash").textContent=money(paper.cash); $("#asset-pnl").textContent=money(pnl); $("#asset-pnl").className=pnl>=0?"good":"bad";
  $("#order-symbol").textContent=run?`${run.symbol} · ${money(run.lastPrice)}`:"검증 결과 없음"; $("#order-decision").textContent=run?.latestDecision.decision||"—"; $("#order-reason").textContent=run?.latestDecision.reason||"최근 판단 사유가 표시됩니다."; $("#order-evidence").textContent=`지표값 · ${indicatorText(run?.latestDecision.indicators)}`;
}

async function refreshAssets() {
  const state=loadState(),symbols=Object.keys(state.paper.holdings); if(!symbols.length)return toast("갱신할 보유 종목이 없습니다.");
  try { const results=await Promise.all(symbols.map(async symbol=>{const r=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=6mo`),d=await r.json();if(!r.ok)throw new Error(d.error);return [symbol,d.candles.at(-1).close];})); results.forEach(([symbol,price])=>state.paper.holdings[symbol].lastPrice=price); saveState(state);renderAssets();renderDashboard();toast("현재가를 갱신했습니다."); } catch(error){toast(error.message);}
}

function selectedUserAction() { const value=$("#user-action").value,decision=loadState().lastRun?.latestDecision.decision; if(value!=="FOLLOW")return value; return decision==="매수 신호"?"BUY":decision==="매도 신호"?"SELL":"SKIP"; }
function actionLabel(action){return {BUY:"모의 매수",SELL:"모의 매도",SKIP:"거래 안 함"}[action]||action;}
function strategyAction(decision){return decision==="매수 신호"?"BUY":decision==="매도 신호"?"SELL":"SKIP";}

function executePaperDecision() {
  const state=loadState(),run=state.lastRun;if(!run)return toast("전략 검증을 먼저 실행하세요."); const action=selectedUserAction(),expected=strategyAction(run.latestDecision.decision),qty=Math.max(1,Math.floor(Number($("#order-qty").value))),price=run.lastPrice,feeRate=run.settings.feeRate,holding=state.paper.holdings[run.symbol],different=action!==expected,override=$("#override-reason").value.trim(); if(different&&!override)return toast("전략과 다르게 판단한 이유를 입력하세요.");
  if(action==="BUY"){const cost=qty*price*(1+feeRate);if(cost>state.paper.cash)return toast("모의 현금이 부족합니다.");const oldQty=holding?.qty||0,oldCost=holding?holding.avgPrice*oldQty:0;state.paper.cash-=cost;state.paper.holdings[run.symbol]={symbol:run.symbol,qty:oldQty+qty,avgPrice:(oldCost+qty*price)/(oldQty+qty),lastPrice:price};}
  if(action==="SELL"){if(!holding||holding.qty<qty)return toast("모의 보유 수량이 부족합니다.");state.paper.cash+=qty*price*(1-feeRate);holding.qty-=qty;holding.lastPrice=price;if(holding.qty===0)delete state.paper.holdings[run.symbol];}
  if(action!=="SKIP")state.paper.orders.push({date:new Date().toISOString(),symbol:run.symbol,action,qty,price,strategyId:run.strategy.id,different,reason:override||run.latestDecision.reason}); const id=`${run.strategy.id}:${run.symbol}:${run.latestDecision.date}`,log=state.logs.find(x=>x.id===id);if(log){log.userAction=actionLabel(action);log.userReason=override||"전략 판단 따름";log.adherent=!different;} saveState(state);renderAssets();renderEvidence();renderDashboard();toast(action==="SKIP"?"판단을 기록했습니다.":`${actionLabel(action)}를 반영했습니다.`);
}

function renderEvidence() {
  const state=loadState(),logs=state.logs.slice().reverse(),acted=logs.filter(x=>x.userAction),adherent=acted.filter(x=>x.adherent).length; $("#log-count").textContent=`${logs.length}건`; $("#adherence").textContent=acted.length?`${(adherent/acted.length*100).toFixed(1)}%`:"—"; $("#evidence-version").textContent=state.approved?.definition.id||"—";
  $("#evidence-body").innerHTML=logs.length?logs.map(x=>`<tr><td>${x.date}</td><td>${x.symbol}</td><td>${x.strategyDecision}</td><td>${x.userAction||"검증만"}${x.userReason?`<br><small>${x.userReason}</small>`:""}</td><td>${indicatorText(x.indicators)}</td><td>${x.reason}</td><td>${x.strategyId}</td></tr>`).join(""):'<tr><td colspan="7" class="empty">기록이 없습니다.</td></tr>';
}

async function loadKisAccount() {
  const node=$("#kis-result");node.innerHTML='<p class="muted">연결 상태를 확인하고 있습니다.</p>';
  try{const response=await fetch("/api/kis-account"),data=await response.json();if(!response.ok)throw new Error(data.error);if(!data.configured){node.innerHTML=`<h3>서버 설정 필요</h3><p class="muted">Vercel Secret에 KIS_APP_KEY, KIS_APP_SECRET, KIS_ACCOUNT_NO를 설정하면 읽기 전용 잔고를 표시할 수 있습니다.</p>`;return;}node.innerHTML=`<div class="summary-grid"><article><span>계좌 모드</span><strong>${data.modeLabel}</strong></article><article><span>총 평가금액</span><strong>${money(data.summary.totalEvaluation)}</strong></article><article><span>예수금</span><strong>${money(data.summary.cash)}</strong></article></div><div class="table-wrap"><table><thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>수익률</th></tr></thead><tbody>${data.holdings.map(h=>`<tr><td>${h.name}</td><td>${h.quantity}</td><td>${money(h.averagePrice)}</td><td>${money(h.currentPrice)}</td><td>${pct(h.returnRate)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">보유 종목 없음</td></tr>'}</tbody></table></div>`;}catch(error){node.innerHTML=`<p class="bad">${error.message}</p>`;}
}

function exportLogs(){const logs=loadState().logs;if(!logs.length)return toast("저장할 기록이 없습니다.");const rows=[["date","symbol","strategyDecision","userAction","indicators","reason","strategyId"],...logs.map(x=>[x.date,x.symbol,x.strategyDecision,x.userAction||"",JSON.stringify(x.indicators),x.reason,x.strategyId])];const csv="\ufeff"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`team-quant-${activeUser}-decisions.csv`;a.click();URL.revokeObjectURL(a.href);}

async function login(id,pin){const user=id.trim().toLowerCase();if(!/^[a-z0-9가-힣_-]{2,24}$/i.test(user))return toast("사용자 ID는 2~24자로 입력하세요.");const users=JSON.parse(localStorage.getItem("teamQuantUsers")||"{}"),digest=await hash(`${user}:${pin}`);if(users[user]&&users[user]!==digest)return toast("PIN이 일치하지 않습니다.");if(!users[user]){users[user]=digest;localStorage.setItem("teamQuantUsers",JSON.stringify(users));}activeUser=user;sessionStorage.setItem("teamQuantSession",user);$("#login-view").hidden=true;$("#app").hidden=false;restoreApproved();renderDashboard();renderAssets();renderEvidence();}

$("#login-form").addEventListener("submit",async e=>{e.preventDefault();await login($("#login-id").value,$("#login-pin").value);});
$("#demo-login").addEventListener("click",()=>login("demo","0000")); $("#logout").addEventListener("click",()=>{sessionStorage.removeItem("teamQuantSession");location.reload();});
$$(".nav-button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.view))); $$('[data-open]').forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.open)));
$$("[data-example]").forEach(b=>b.addEventListener("click",()=>{$("#natural-rule").value=examples[b.dataset.example];parseRule();})); $("#parse-rule").addEventListener("click",parseRule); $("#approve-check").addEventListener("change",()=>$("#approve-strategy").disabled=!draft||!$("#approve-check").checked); $("#approve-strategy").addEventListener("click",approveStrategy); $("#run-backtest").addEventListener("click",runApprovedBacktest); $("#register-paper").addEventListener("click",registerPaper);
$$("[data-asset-tab]").forEach(b=>b.addEventListener("click",()=>{$$("[data-asset-tab]").forEach(x=>x.classList.toggle("active",x===b));$$(".asset-page").forEach(x=>x.classList.toggle("active",x.id===`${b.dataset.assetTab}-assets`));})); $("#refresh-assets").addEventListener("click",refreshAssets); $("#user-action").addEventListener("change",()=>{$("#override-wrap").hidden=$("#user-action").value==="FOLLOW";}); $("#paper-order").addEventListener("click",executePaperDecision); $("#load-kis").addEventListener("click",loadKisAccount); $("#export-log").addEventListener("click",exportLogs);

function resumeSession(user){activeUser=user;$("#login-view").hidden=true;$("#app").hidden=false;restoreApproved();renderDashboard();renderAssets();renderEvidence();}
const session=sessionStorage.getItem("teamQuantSession");if(session)resumeSession(session);
