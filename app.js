import {closePrivateSession} from './bridge-client.js';
import "/flow-ui.js";
import {stockName,resolveStockInput} from "/lib/instruments.js";
import "/journey-ui.js";
import { createStrategyDefinition, validateStrategy, runBacktest } from "/lib/backtest.js";
import { parseNaturalStrategy } from "/lib/natural-language.js";
import { runSplitValidation, recordTrial, overfitWarning } from "/lib/oos-validation.js";
import "/news-ui.js";
import "/overview-ui.js";
import "/account-ui.js";
import "/toss-ui.js";
import "/asset-hub-ui.js";
import "/help-ui.js";
import "/performance-ui.js";
import "/orders-ui.js";
import "/planner-ui.js";
import "/workspace-ui.js";
import "/connected-workspace-ui.js";
import "/investor-ui.js";
import "/brief-ui.js";
import { tip } from "/tooltip-ui.js"; // 마지막에 둔다: 모듈 실행 순서를 바꾸지 않는다(이미 workspace-ui 쪽에서 불러옴).

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
function defaultState() { return { approved:null, activeStrategy:null, lastRun:null, paper:{ initialCash:10_000_000, cash:10_000_000, holdings:{}, orders:[] }, logs:[], oosLedger:[] }; }
function loadState() { try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(stateKey()) || "{}") }; } catch { return defaultState(); } }
function saveState(state) { localStorage.setItem(stateKey(), JSON.stringify(state)); }
async function hash(text) { const data=new TextEncoder().encode(text); const digest=await crypto.subtle.digest("SHA-256",data); return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join(""); }
// 화면에 보이는 프로필 이름: 체험 프로필의 내부 이름 'demo'는 그대로 보여 주지 않는다.
const profileLabel = user => user === "demo" ? "체험 프로필" : user;

function showPage(name) {
  $$(".view").forEach(node=>node.classList.toggle("active",node.dataset.page===name));
  $$(".nav-button").forEach(node=>node.classList.toggle("active",node.dataset.view===name));
  window.dispatchEvent(new Event("teamquant:page")); if(name==="assets") renderAssets(); if(name==="evidence") renderEvidence(); window.scrollTo({top:0,behavior:"smooth"});
}

function indicatorText(indicators={}) {
  const labels={fastSma:"단기 이동평균선",slowSma:"장기 이동평균선",previousFastSma:"어제 단기 이동평균선",previousSlowSma:"어제 장기 이동평균선",rsi:"RSI",previousRsi:"어제 RSI",close:"종가",entryHigh:"매수 기준 최고가",exitLow:"매도 기준 최저가",predictedPct:"5일 예측(%)",thresholdPct:"매수 기준(%)"};
  return Object.entries(indicators).map(([key,value])=>`${labels[key]||key} ${key.endsWith('Pct')?Number(value).toFixed(3):/rsi/i.test(key)?Number(value).toFixed(2):won.format(value)}`).join(" · ") || "—";
}

// 2026-11-26: 예전 홈(환영 문장 · 다음 할 일 · 최근 테스트 미니 차트 · 단계 표시)은 index.html 에서 지웠다. 홈은 overview-ui · brief-ui 가 그린다.
function renderDashboard() {
  const state=loadState();
  $("#user-name").textContent=profileLabel(activeUser);
  window.dispatchEvent(new Event("teamquant:state"));
  renderOosHistory(state.oosLedger||[]);
}

function restoreApproved() {
  const approved=loadState().approved; if(!approved)return;
  $("#natural-rule").value=approved.original; draft={original:approved.original,config:approved.config,warnings:[],definition:approved.definition}; renderDraft(); $("#approve-check").checked=true; $("#approve-strategy").disabled=false; $("#approve-strategy").textContent="3개월 테스트로 이동"; $("#run-backtest").disabled=false; $("#verify-state").textContent=`확정됨 · ${approved.definition.name}`; try{validateStrategy(approved.definition);}catch(e){draft=null;$("#approve-check").checked=false;$("#approve-strategy").disabled=true;$("#run-backtest").disabled=true;$("#parse-warning").hidden=false;$("#parse-warning").textContent=e.message+" 매매 규칙 문장을 다시 변환해 확인·확정해 주세요.";}
}

function renderDraft() {
  if(!draft)return; $("#approve-strategy").textContent="확정하고 3개월 테스트"; const def=draft.definition;
  $("#review-name").textContent=def.name; $("#review-entry").textContent=def.entryRule; $("#review-exit").textContent=def.exitRule; $("#review-risk").textContent=def.riskRule;
  window.dispatchEvent(new Event("teamquant:draft")); const warning=$("#parse-warning"); warning.hidden=!draft.warnings.length; warning.textContent=draft.warnings.join(" "); $("#approve-check").checked=false; $("#approve-strategy").disabled=true;
}

function parseRule() {
  try { const parsed=parseNaturalStrategy($("#natural-rule").value),definition=createStrategyDefinition(parsed.config); validateStrategy(definition); draft={...parsed,definition}; renderDraft(); toast("변환된 매매 규칙을 확인하세요."); }
  catch(error){toast(error.message);}
}

function approveStrategy() {
  if(!draft||!$("#approve-check").checked)return; try{validateStrategy(draft.definition);}catch(e){toast(e.message);return;} const state=loadState(); if(state.approved?.definition.id===draft.definition.id&&state.approved.original===draft.original){showPage("comparison");return;} state.approved={...draft,approvedAt:new Date().toISOString()}; state.activeStrategy=null; delete state.comparison; saveState(state); $("#run-backtest").disabled=false; $("#verify-state").textContent=`확정됨 · ${draft.definition.name}`; $("#verify-result").hidden=true; renderDashboard(); toast("매매 규칙을 확정했습니다."); showPage("comparison");
}

function oosSummaryText(entry,error) {
  if(!entry) return `확인 기간 테스트를 하지 못했습니다(${error||"자료 부족"}). 전체 수익률만 보고 판단하지 마세요.`;
  const period=`정할 때 쓴 기간 ${entry.tuning.start}~${entry.tuning.end}(${entry.tuning.days}거래일) · 확인 기간 ${entry.test.start}~${entry.test.end}(${entry.test.days}거래일)`;
  const status=entry.independent?`확인 기간 결과입니다${entry.reproduction?"(같은 조건으로 다시 실행)":""}.`:`확인 기간 결과 아님: ${entry.reasons.join(" ")}`;
  const warn=overfitWarning(entry.tuningReturn,entry.testReturn), drift=warn?` ${warn}`:"";
  return `${period}. ${status} 이 종목 ${entry.trialNumber}번째 테스트.${drift}`;
}
// 테스트 기록의 '바뀐 항목'은 영어 설정 이름 대신 화면 말로 쓴다(lib/backtest.js createStrategyDefinition 의 값 이름).
const PARAM_LABEL={type:"방식",fastPeriod:"단기 이동평균선(일)",slowPeriod:"장기 이동평균선(일)",rsiPeriod:"RSI 기간",rsiFilterMax:"RSI 상한",rsiBuy:"RSI 매수 기준",rsiSell:"RSI 매도 기준",entryLookback:"매수 기준 기간(일)",exitLookback:"매도 기준 기간(일)",stopLossPct:"손절(%)",takeProfitPct:"익절(%)",positionPct:"비중(%)"};
const TYPE_LABEL={ma_cross:"이동평균 교차",rsi_reversal:"RSI 과매도 반전",breakout:"가격 돌파"};
function renderOosHistory(ledger=[]) {
  const node=$("#oos-history"); if(!node)return; const rows=ledger.slice(-20).reverse();
  if(!rows.length){node.innerHTML='<p class="muted">아직 테스트 기록이 없습니다.</p>';return;}
  const value=(key,v)=>v===null||v===undefined?"—":key==="type"?(TYPE_LABEL[v]||v):v;
  const change=(e)=>e.changesFromPrevious?.length?e.changesFromPrevious.map(c=>`${PARAM_LABEL[c.key]||c.key} ${value(c.key,c.before)}→${value(c.key,c.after)}`).join(", "):"—";
  node.innerHTML=`<p class="muted">최근 ${rows.length}건 / 전체 ${ledger.length}건 · 기록은 하나씩 고치거나 지울 수 없습니다 ${tip("이 브라우저 프로필에 저장됩니다. 설정 > 내 기록 지우기로는 모두 지울 수 있습니다.")}</p><div class="table-scroll"><table><thead><tr><th>#</th><th>종목</th><th>규칙 이름</th><th>확인 기간</th><th>정할 때</th><th>확인</th><th>확인 기간 결과</th><th>바뀐 항목</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${e.trialNumber}</td><td>${escapeHtml(stockName(e.symbol))}</td><td>${escapeHtml(e.strategyName||"—")}</td><td>${escapeHtml(e.test.start)}~${escapeHtml(e.test.end)}</td><td>${pct(e.tuningReturn)}</td><td>${pct(e.testReturn)}</td><td title="${escapeHtml(e.reasons.join(" "))}">${e.independent?"예":"아니오"}</td><td>${escapeHtml(change(e))}</td></tr>`).join("")}</tbody></table></div>`;
}

async function runApprovedBacktest() {
  const state=loadState(); if(!state.approved)return toast("매매 규칙을 먼저 확정하세요."); const button=$("#run-backtest"); button.disabled=true; button.textContent="시세 불러오는 중…";
  try {
    const symbol=await resolveStockInput($("#symbol").value), range=$("#range").value, response=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=${range}`), data=await response.json(); if(!response.ok)throw new Error(data.error||"시세를 불러오지 못했습니다.");
    const cost=Number($("#cost").value)/100, options={...state.approved.config,initialCapital:Number($("#capital").value),feeRate:cost/2,slippageRate:cost/2};
    const result=runBacktest(data.candles,options); let validationReturn=null, oos=null, oosError=null;
    try { const validation=runSplitValidation(data.candles,options,{tuningRatio:Number($("#oos-ratio").value)}), recorded=recordTrial(state.oosLedger||[],validation,{symbol:data.symbol}); state.oosLedger=recorded.ledger; oos=recorded.entry; validationReturn=oos.testReturn; } catch(error) { oosError=error.message; }
    currentData=data; currentResult=result; const latest=result.decisions.at(-1);
    state.lastRun={symbol:data.symbol,startDate:data.candles[0].date,endDate:data.candles.at(-1).date,lastPrice:data.candles.at(-1).close,summary:result.summary,validationReturn,oos:oos&&{id:oos.id,independent:oos.independent,test:oos.test,tuning:oos.tuning},latestDecision:latest,equity:result.equity.filter((_,i)=>i%Math.max(1,Math.floor(result.equity.length/100))===0),strategy:result.strategy,settings:result.settings};
    const log={id:`${result.strategy.id}:${data.symbol}:${latest.date}`,date:latest.date,symbol:data.symbol,strategyDecision:latest.decision,userAction:null,indicators:latest.indicators,reason:latest.reason,strategyId:result.strategy.id,strategyName:result.strategy.name,createdAt:new Date().toISOString()}; const index=state.logs.findIndex(x=>x.id===log.id); if(index>=0)state.logs[index]={...state.logs[index],...log,userAction:state.logs[index].userAction};else state.logs.push(log);
    saveState(state); $("#result-return").textContent=pct(result.summary.totalReturn); $("#result-mdd").textContent=`−${result.summary.maxDrawdown.toFixed(2)}%`; $("#result-validation").textContent=pct(validationReturn); $("#result-tuning").textContent=pct(oos?.tuningReturn); $("#robust-warning").textContent=oosSummaryText(oos,oosError); renderOosHistory(state.oosLedger); $("#verify-result").hidden=false; $("#verify-state").textContent=`${stockName(data.symbol)} · ${data.candles.at(-1).date} 기준`; renderDashboard(); toast("테스트를 마쳤습니다.");
  } catch(error){toast(error.message); $("#verify-state").textContent=error.message;} finally{button.disabled=false;button.textContent="테스트 실행";}
}

function renderAssets() {
  const state=loadState(),paper=state.paper,run=state.lastRun,holdings=Object.values(paper.holdings); let holdingValue=0,pnl=0;
  $("#holdings-body").innerHTML=holdings.length?holdings.map(h=>{const value=h.qty*h.lastPrice,itemPnl=(h.lastPrice-h.avgPrice)*h.qty;holdingValue+=value;pnl+=itemPnl;return `<tr><td>${stockName(h.symbol)}</td><td>${won.format(h.qty)}주</td><td>${money(h.avgPrice)}</td><td>${money(h.lastPrice)}</td><td class="${itemPnl>=0?'good':'bad'}">${money(itemPnl)}</td></tr>`}).join(""):'<tr><td colspan="5" class="empty">보유 종목이 없습니다.</td></tr>';
  $("#asset-total").textContent=money(paper.cash+holdingValue); $("#asset-cash").textContent=money(paper.cash); $("#asset-pnl").textContent=money(pnl); $("#asset-pnl").className=pnl>=0?"good":"bad";
  $("#order-asof").textContent=run?`${run.endDate} 테스트 기준 가격 · 실제 체결 아님(가상 투자)`:"테스트한 날의 가격과 신호가 보입니다.";
  $("#order-symbol").textContent=run?`${stockName(run.symbol)} · ${money(run.lastPrice)}`:"테스트 결과 없음"; $("#order-decision").textContent=run?.latestDecision.decision||"—"; $("#order-reason").textContent=run?.latestDecision.reason||"최근 신호의 이유가 보입니다."; $("#order-evidence").textContent=`지표 · ${indicatorText(run?.latestDecision.indicators)}`;
}

async function refreshAssets() {
  const state=loadState(),symbols=Object.keys(state.paper.holdings); if(!symbols.length)return toast("새로고침할 보유 종목이 없습니다.");
  try { const results=await Promise.all(symbols.map(async symbol=>{const r=await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}&range=6mo`),d=await r.json();if(!r.ok)throw new Error(d.error);return [symbol,d.candles.at(-1).close];})); results.forEach(([symbol,price])=>state.paper.holdings[symbol].lastPrice=price); saveState(state);renderAssets();renderDashboard();toast("현재가를 새로 불러왔습니다."); } catch(error){toast(error.message);}
}

function selectedUserAction() { const value=$("#user-action").value,decision=loadState().lastRun?.latestDecision.decision; if(value!=="FOLLOW")return value; return decision==="매수 신호"?"BUY":decision==="매도 신호"?"SELL":"SKIP"; }
function actionLabel(action){return {BUY:"가상 매수",SELL:"가상 매도",SKIP:"거래 안 함"}[action]||action;}
function strategyAction(decision){return decision==="매수 신호"?"BUY":decision==="매도 신호"?"SELL":"SKIP";}

function executePaperDecision() {
  const state=loadState(),run=state.lastRun;if(!run)return toast("먼저 테스트를 실행하세요."); if(!state.activeStrategy||state.approved?.definition.id!==run.strategy.id||state.activeStrategy.symbol!==run.symbol)return toast("지금 매매 규칙으로 테스트한 뒤 가상 투자에 등록하세요."); const action=selectedUserAction(),expected=strategyAction(run.latestDecision.decision),qty=Math.max(1,Math.floor(Number($("#order-qty").value))),price=run.lastPrice,feeRate=run.settings.feeRate,holding=state.paper.holdings[run.symbol],different=action!==expected,override=$("#override-reason").value.trim(); if(!Number.isFinite(qty)||!Number.isSafeInteger(qty)||qty<1)return toast("수량을 올바르게 입력하세요."); if(different&&!override)return toast("규칙 신호와 다르게 고른 이유를 입력하세요.");
  if(action==="BUY"){const cost=qty*price*(1+feeRate);if(cost>state.paper.cash)return toast("가상 현금이 부족합니다.");const oldQty=holding?.qty||0,oldCost=holding?holding.avgPrice*oldQty:0;state.paper.cash-=cost;state.paper.holdings[run.symbol]={symbol:run.symbol,qty:oldQty+qty,avgPrice:(oldCost+qty*price)/(oldQty+qty),lastPrice:price};}
  if(action==="SELL"){if(!holding||holding.qty<qty)return toast("가상 보유 수량이 부족합니다.");state.paper.cash+=qty*price*(1-feeRate);holding.qty-=qty;holding.lastPrice=price;if(holding.qty===0)delete state.paper.holdings[run.symbol];}
  if(action!=="SKIP")state.paper.orders.push({date:new Date().toISOString(),symbol:run.symbol,action,qty,price,strategyId:run.strategy.id,different,reason:override||run.latestDecision.reason}); const id=`${run.strategy.id}:${run.symbol}:${run.latestDecision.date}`,log=state.logs.find(x=>x.id===id);if(log){log.userAction=actionLabel(action);log.userReason=override||"규칙 신호 따름";log.adherent=!different;} saveState(state);renderAssets();renderEvidence();renderDashboard();toast(action==="SKIP"?"판단을 기록했습니다.":`${actionLabel(action)}를 반영했습니다.`);
}

const escapeHtml=value=>String(value??"—").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// 판단 기록의 '규칙 이름': 내부 ID 대신 이름. 이름을 남기지 않은 예전 기록은 지금 확정한 규칙과 같을 때만 그 이름을 쓴다.
const ruleName=(x,approved)=>x.strategyName||(approved&&x.strategyId===approved.definition.id?approved.definition.name:"—");
function renderEvidence() {
  const state=loadState(),logs=state.logs.slice().reverse(),acted=logs.filter(x=>x.userAction&&typeof x.adherent==='boolean'),adherent=acted.filter(x=>x.adherent).length; $("#log-count").textContent=`${logs.length}건`; $("#adherence").textContent=acted.length?`${(adherent/acted.length*100).toFixed(1)}%`:"—"; $("#evidence-version").textContent=state.approved?.definition.name||"—";
  // 2026-11-26: 기록이 없으면 빈 숫자 타일과 내보내기 버튼을 숨기고 한 줄 안내만 둔다.
  const summary=$("#evidence .evidence-summary");if(summary)summary.hidden=!logs.length;$("#export-log").hidden=!logs.length;
  $("#evidence-body").innerHTML=logs.length?logs.map(x=>`<tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(stockName(x.symbol))}</td><td>${escapeHtml(x.strategyDecision)}</td><td>${escapeHtml(x.userAction||"테스트만")}${x.userReason?`<br><small>${escapeHtml(x.userReason)}</small>`:""}</td><td>${escapeHtml(indicatorText(x.indicators))}</td><td>${escapeHtml(x.reason)}</td><td>${escapeHtml(ruleName(x,state.approved))}</td></tr>`).join(""):'<tr><td colspan="7" class="empty">고급 전략 실험에서 가상 투자 신호를 기록하면 여기에 쌓입니다.</td></tr>';
}

function exportLogs(){const logs=loadState().logs;if(!logs.length)return toast("저장할 기록이 없습니다.");const rows=[["date","symbol","strategyDecision","userAction","indicators","reason","strategyId"],...logs.map(x=>[x.date,x.symbol,x.strategyDecision,x.userAction||"",JSON.stringify(x.indicators),x.reason,x.strategyId])];const csv="﻿"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`team-quant-${activeUser}-decisions.csv`;a.click();URL.revokeObjectURL(a.href);}

async function login(id,pin){const user=id.trim().toLowerCase();if(!/^[a-z0-9가-힣_-]{2,24}$/i.test(user))return toast("프로필 이름은 2~24자로 입력하세요.");const users=JSON.parse(localStorage.getItem("teamQuantUsers")||"{}"),digest=await hash(`${user}:${pin}`);if(users[user]&&users[user]!==digest)return toast("잠금 번호가 맞지 않습니다.");if(!users[user]){users[user]=digest;localStorage.setItem("teamQuantUsers",JSON.stringify(users));}activeUser=user;sessionStorage.setItem("teamQuantSession",user);sessionStorage.removeItem("teamQuantShowLogin");document.body.classList.remove("tq-booting");if($("#remember-profile").checked&&user!=="demo")localStorage.setItem("teamQuantRememberProfile",JSON.stringify({user,expiresAt:Date.now()+30*86400000}));else localStorage.removeItem("teamQuantRememberProfile");$("#login-view").hidden=true;$("#app").hidden=false;restoreApproved();renderDashboard();renderAssets();renderEvidence();showPage("home");}

$("#login-form").addEventListener("submit",async e=>{e.preventDefault();await login($("#login-id").value,$("#login-pin").value);});
$("#demo-login").addEventListener("click",()=>login("demo","0000")); $("#logout").addEventListener("click",async()=>{localStorage.removeItem("teamQuantRememberProfile");await closePrivateSession();sessionStorage.removeItem("teamQuantSession");sessionStorage.setItem("teamQuantShowLogin","1");location.reload();});
$$(".nav-button").forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.view))); $$('[data-open]').forEach(b=>b.addEventListener("click",()=>showPage(b.dataset.open)));
// 2026-11-26: '모의 운용 등록'(#register-paper)은 3개월 테스트의 '가상 투자 시작'(#compare-paper)과 같은 일이라 하나로 합쳤다(teamquant:comparison-paper).
$$("[data-example]").forEach(b=>b.addEventListener("click",()=>{$("#natural-rule").value=examples[b.dataset.example];parseRule();})); $("#parse-rule").addEventListener("click",parseRule); $("#approve-check").addEventListener("change",()=>$("#approve-strategy").disabled=!draft||!$("#approve-check").checked); $("#approve-strategy").addEventListener("click",approveStrategy); $("#run-backtest").addEventListener("click",runApprovedBacktest);
// 2026-11-26: 개발용 서버 계좌 조회(KIS · /api/kis-account 카드)와 숨은 계좌 탭은 뺐다. 실계좌는 설정 > 내 PC 연결로만 본다.
$("#refresh-assets").addEventListener("click",refreshAssets); $("#user-action").addEventListener("change",()=>{$("#override-wrap").hidden=$("#user-action").value==="FOLLOW";}); $("#paper-order").addEventListener("click",executePaperDecision); $("#export-log").addEventListener("click",exportLogs);

function resumeSession(user){activeUser=user;$("#login-view").hidden=true;$("#app").hidden=false;restoreApproved();renderDashboard();renderAssets();renderEvidence();showPage("home");}
let remembered=null;try{remembered=JSON.parse(localStorage.getItem("teamQuantRememberProfile"));}catch{}if(remembered?.expiresAt>Date.now()&&/^[a-z0-9가-힣_-]{2,24}$/.test(remembered.user))sessionStorage.setItem("teamQuantSession",remembered.user);// 2026-11-25 UI·UX P0: 처음 온 방문자는 체험 프로필로 바로 들어간다(로그인 관문 없음). '프로필 바꾸기' 뒤에만 프로필 화면을 보여 준다.
const session=sessionStorage.getItem("teamQuantSession");if(session){resumeSession(session);document.body.classList.remove("tq-booting");}else if(sessionStorage.getItem("teamQuantShowLogin")!=="1")login("demo","0000");else document.body.classList.remove("tq-booting");

window.addEventListener('teamquant:model-evidence',event=>{
  if(!activeUser)return;
  const {signal,production,data}=event.detail,state=loadState();
  const id=`${signal.modelId}:${signal.symbol}:${signal.date}`;
  const entry={id,date:signal.date,symbol:signal.symbol,strategyDecision:signal.decision,userAction:'모델 예측 저장',adherent:null,
    indicators:{predictedPct:signal.predictedReturn*100,thresholdPct:signal.threshold*100},
    reason:`${signal.modelId} · 학습 정답 관측 ${production.lastTrainingLabel} · 데이터 ${data.hash.slice(0,12)} · 5일 예측 · 주문 실행 없음`,
    strategyId:signal.modelId,modelEvidence:{signal,production,datasetHash:data.hash},createdAt:new Date().toISOString()};
  if(!state.logs.some(x=>x.id===id))state.logs.push(entry);
  saveState(state);renderEvidence();const saved=$('#ml-saved');if(saved)saved.textContent='판단 기록에 저장했습니다. 확정한 매매 규칙과 가상 잔고는 그대로입니다.';
});

window.addEventListener('teamquant:comparison-paper',event=>{
  const s=loadState(),report=event.detail,stock=report.perStock.find(x=>x.symbol===report.paperSymbol)||report.perStock[0],run=stock.base;
  if(!s.approved||s.approved.definition.id!==report.strategyId)return toast('매매 규칙이 바뀌었습니다. 다시 테스트하세요.');
  const last=run.decisions.at(-1);
  s.lastRun={symbol:stock.symbol,startDate:report.start,endDate:report.end,lastPrice:last.close,summary:run.summary,validationReturn:null,latestDecision:last,equity:run.equity,strategy:run.strategy,settings:run.settings};
  s.activeStrategy={...s.approved,registeredAt:new Date().toISOString(),symbol:stock.symbol};
  const id=`${run.strategy.id}:${stock.symbol}:${last.date}`;
  if(!s.logs.some(x=>x.id===id))s.logs.push({id,date:last.date,symbol:stock.symbol,strategyDecision:last.decision,userAction:null,indicators:last.indicators,reason:last.reason,strategyId:run.strategy.id,strategyName:run.strategy.name,createdAt:new Date().toISOString()});
  saveState(s);renderDashboard();renderAssets();renderEvidence();showPage('assets');toast(stockName(stock.symbol)+' 가상 투자에 등록했습니다. 아직 주문은 없습니다.');
});

$("#natural-rule").addEventListener("input",()=>{draft=null;});

// 2026-11-26: 'teamquant:review'(예전 홈 보유 점검 기록)를 보내는 곳이 없어 받는 쪽도 뺐다.
