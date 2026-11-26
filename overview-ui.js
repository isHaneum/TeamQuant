import {manwon} from '/lib/investor-tools.js';
import {accountView} from '/lib/account-view.js';
import {holdingsOverview} from '/lib/holdings-overview.js';
import {performanceChart,wireCharts} from '/lib/performance-view.js';
import {stockName} from '/lib/instruments.js';
import {portfolioMetrics,evaluatePrinciples,simulateContributions} from '/lib/portfolio.js';
import {relevantArticles} from '/lib/briefing.js';
import {tip} from '/tooltip-ui.js';
const $=s=>document.querySelector(s),money=manwon;
const pct=v=>!Number.isFinite(v)?'—':(v>0?'+':'')+v.toFixed(2)+'%',esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// 기준 시각: 'MM-DD HH:mm'(다른 해는 'YYYY-MM-DD HH:mm') · 한국 시간
const stamp=iso=>{const d=new Date(iso);if(!iso||!Number.isFinite(d.getTime()))return '';const f=(o,x)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',...o}).formatToParts(x).map(p=>[p.type,p.value])),p=f({year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'},d),y=f({year:'numeric'},new Date()).year;return `${p.year===y?'':p.year+'-'}${p.month}-${p.day} ${p.hour}:${p.minute}`;};
const key=()=>sessionStorage.getItem('teamQuantSession')?'teamQuant:user:'+sessionStorage.getItem('teamQuantSession'):null;
const state=()=>{try{return JSON.parse(localStorage.getItem(key())||'{}');}catch{return {};}};
let liveAccount=null,connectionState='idle';
const get=()=>{const o={schemaVersion:1,mode:'paper',quotes:{},newsCache:{},principleVersions:[],reviews:[],simulationRuns:[],...state().overview};o.mode=accountView(key(),liveAccount,connectionState).mode;if(o.mode==='broker_holdings')o.newsCache=liveAccount.newsCache||{};return o;};
function save(change){const k=key();if(!k)return;const s=state();const o=get();if(o.mode==='broker_holdings'&&change.newsCache)liveAccount.newsCache=change.newsCache;s.overview={...o,...change};if(o.mode==='broker_holdings')s.overview.newsCache=state().overview?.newsCache||{};localStorage.setItem(k,JSON.stringify(s));}
const navigate=page=>$(`[data-view="${page}"]`)?.click();
// lib/portfolio.js 규칙 상태(원래 값으로 비교) → 화면 말(용어표 #31)
const STATUS_WORD={위반:'어김',충족:'지킴','평가 불가':'확인 못 함',임박:'한도 가까움'},statusWord=s=>STATUS_WORD[s]||s;
const DEMO={cash:2800000,positions:[{symbol:'005930.KS',name:'삼성전자',quantity:50,avgCost:70000},{symbol:'000660.KS',name:'SK하이닉스',quantity:10,avgCost:180000},{symbol:'035420.KS',name:'NAVER',quantity:10,avgCost:200000}]};
const demoQuotes={'005930.KS':{price:72000,prevClose:73000},'000660.KS':{price:190000,prevClose:184000},'035420.KS':{price:210000,prevClose:212000}};
function portfolio(){const s=state(),o=get();if(o.mode==='pending')return {cash:0,positions:[]};if(['account','broker_holdings'].includes(o.mode))return liveAccount.portfolio;if(o.mode==='demo')return DEMO;if(o.mode==='manual')return o.manualPortfolio||{cash:0,positions:[]};return {cash:s.paper?.cash??10000000,positions:Object.values(s.paper?.holdings||{}).map(h=>({symbol:h.symbol,name:stockName(h.symbol),quantity:h.qty,avgCost:h.avgPrice}))};}
function metrics(){if(get().mode==='pending')return {total:null,cash:null,cashPct:null,pnl:null,returnPct:null,dailyPnl:null,positions:[],complete:false};if(get().mode==='broker_holdings')return holdingsOverview(liveAccount.snapshot);const o=get(),p=portfolio(),q=['account','broker_holdings'].includes(o.mode)?liveAccount.quotes:o.mode==='demo'?Object.fromEntries(Object.entries(demoQuotes).map(([s,x])=>[s,{...x,asOf:'예시',source:'예시 가격'}])):{...o.quotes};if(o.mode==='paper')for(const h of Object.values(state().paper?.holdings||{}))if(!q[h.symbol])q[h.symbol]={price:h.lastPrice,prevClose:null,asOf:'가상 거래 때 가격',source:'기존 가상 투자'};return portfolioMetrics(p,q);}

// Keep the original home DOM as an integration adapter for the existing modules.
// 2026-11-26: 예전 홈은 brief-ui 가 '예전 화면 도구'로 접어 둔다. 다른 모듈이 붙는 자리(#ov-kpis · #ov-next · #ov-strategy-summary · #ov-refresh · .ov-actions)만 남기고, 열 수 없던 입력·창·이동 버튼은 뺐다.
for(const node of [...$('#home').children])node.classList.add('legacy-home');
const root=document.createElement('div');root.id='overview';root.innerHTML=`
  <div class="page-head"><div><h1>홈</h1><p id="ov-source"></p></div><div class="ov-actions"><select id="ov-mode" aria-label="자산 보기"><option value="paper">가상 투자</option><option value="manual">직접 입력한 자산</option><option value="demo">예시</option></select><button id="ov-refresh" class="secondary">시세 새로고침</button></div></div>
  <p id="ov-status" role="status" class="muted"></p>
  <div id="ov-empty" class="ov-empty" hidden><h2>보유 자산 연결</h2><p>계좌를 연결하면 보유 종목과 평가액이 보입니다.</p></div>
  <div class="ov-kpis" id="ov-kpis"></div>
  <div class="ov-grid">
    <article class="panel ov-holdings"><div class="panel-head"><div><h2>보유 종목</h2><p class="muted">종목별 가격·비중·규칙</p></div></div><div class="table-wrap"><table><thead><tr><th>종목</th><th>현재가 / 오늘 등락</th><th>평가액 / 비중</th><th>평가손익 / 수익률</th><th>오늘 손익</th><th>규칙</th></tr></thead><tbody id="ov-holdings"></tbody></table></div></article>
    <article class="panel"><h2>자산 구성</h2><div id="ov-allocation"></div><p class="muted">현금을 포함한 총자산 기준 비중</p></article>
    <article class="panel ov-briefing"><div class="panel-head"><div><h2>내 종목 브리핑</h2><p class="muted">시세 변화와 관련 검색 기사</p></div></div><div id="ov-briefing"></div></article>
    <article class="panel"><div class="panel-head"><h2>규칙 점검</h2></div><div id="ov-rules"></div><p class="muted">매매 신호와 별도 · 확인할 수 있는 규칙을 같은 비중으로 계산 · 한도에 가까운 것은 지킴으로 셉니다.</p></article>
  </div>
  <article class="panel" id="ov-next"><div class="panel-head"><div><h2>보유 종목으로 이어가기</h2><p id="ov-next-context" class="muted"></p></div></div></article>
  <article class="panel"><h2>확정한 매매 규칙</h2><p id="ov-strategy-summary"></p></article>`;
$('#home').prepend(root);
const briefing=root.querySelector('.ov-briefing');root.querySelector('.ov-holdings').after(briefing);
// 2026-11-26: 옛 단계 바(.flow-wrap)와 메뉴 버튼 옮기기·이름 바꾸기는 지웠다(이름은 workspace-ui.js 가 정한다).
const navigation=$('.sidebar nav');
const simNav=document.createElement('button');simNav.className='nav-button';simNav.dataset.view='simulation';simNav.textContent='투자금 계산';navigation.insertBefore(simNav,$('[data-view="news"]'));
$('.sidebar').classList.add('overview-nav');
$('#strategy h1').textContent='고급 전략 실험';$('#strategy .page-head p').textContent='매매 규칙을 정하고, 확정한 규칙을 과거 시세로 테스트하세요.';
// 과거 검증으로 가는 버튼은 이것 하나로 둔다(단계 버튼 '2. 과거 검증'과 같은 이름).
const labCompare=document.createElement('button');labCompare.className='secondary';labCompare.textContent='과거 검증';labCompare.onclick=()=>navigate('comparison');$('#strategy .page-head').append(labCompare);
const simulation=document.createElement('section');simulation.className='view';simulation.dataset.page='simulation';simulation.id='simulation';simulation.innerHTML=`<div class="page-head"><div><h1>투자금 계산</h1><p>수익률을 가정하고 원금과 수익을 나눠 봅니다.</p></div></div><div class="sim-layout"><article class="panel"><h2>계산 조건 ${tip('매달 말에 넣는다고 보고 수익·비용을 달마다 복리로 계산 · 세금·물가 제외 · 가격·수익 예측 아님')}</h2><p id="sim-context" class="muted"></p><form id="sim-form"><div class="ov-form"><label>시작 자산 (원)<input id="sim-initial" type="number" min="0" value="10000000" required></label><label>지금 추가할 금액 (원)<input id="sim-once" type="number" min="0" value="0" required></label><label>매달 넣을 돈 (원)<input id="sim-monthly" type="number" min="0" value="500000" required></label><label>기간 (개월)<input id="sim-months" type="number" min="1" max="600" value="120" required></label><label>가정 연 수익률 (%)<input id="sim-rate" type="number" min="-99" max="100" step=".1" value="0" required></label><label>연간 비용 (%)<input id="sim-fee" type="number" min="0" max="20" step=".1" value="0" required></label></div><button class="primary" type="submit">계산하기</button></form></article><article class="panel"><h2>가정에 따른 자산 변화</h2><div id="sim-result"></div><button id="sim-save" class="secondary" disabled>결과 저장</button><p id="sim-status" role="status"></p></article></div><article class="panel"><h2>저장한 계산</h2><div id="sim-history"></div></article>`;document.querySelector('main').append(simulation);
// 판단 기록 머리: 내려받기는 한 곳에 둔다. 판단 기록 CSV 는 원래 버튼(#export-log)이 그대로 만들고, 규칙·검토 기록은 이 브라우저에 저장한 값을 파일로 내려받는다.
function downloadReview(){const o=get(),blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),principleVersions:o.principleVersions,reviews:o.reviews,simulationRuns:o.simulationRuns},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='teamquant-portfolio-review.json';a.click();URL.revokeObjectURL(url);}
const downloads=document.createElement('details');downloads.className='tq-dl';downloads.innerHTML='<summary>내려받기</summary><div role="menu"><button type="button" role="menuitem" data-dl="csv">판단 기록 CSV 파일 저장</button><button type="button" role="menuitem" data-dl="review">규칙·검토 기록 파일로 저장</button></div>';
downloads.addEventListener('click',e=>{const b=e.target.closest('[data-dl]');if(!b)return;downloads.open=false;if(b.dataset.dl==='csv')$('#export-log')?.click();else downloadReview();});
document.addEventListener('click',e=>{if(downloads.open&&!downloads.contains(e.target))downloads.open=false;});
{const head=$('#evidence .page-head'),csv=$('#export-log');if(csv)csv.hidden=true;head?.append(downloads);}
let currentMetrics,simResult=null;
function render(){
  if(!key())return;const o=get(),p=portfolio();
  const connected=o.mode!=='pending';root.classList.toggle('account-pending',!connected);
  $('#ov-mode').hidden=true;
  if(!connected){currentMetrics=null;$('#ov-source').textContent='토스증권 계좌 · 연결 상태 확인';$('#ov-empty').hidden=false;$('#ov-empty h2').textContent=connectionState==='loading'?'보유 주식 확인 중':'계좌 연결 확인';$('#ov-empty p').textContent=connectionState==='loading'?'PC에 등록한 토스 키로 보유 주식을 조회하고 있습니다.':'실계좌를 조회하면 보유 종목과 평가액이 보입니다. 조회 전에는 가상 금액을 보여 주지 않습니다.';$('#ov-kpis').replaceChildren();$('#ov-holdings').replaceChildren();$('#ov-briefing').replaceChildren();return;}
  currentMetrics=metrics();const m=currentMetrics,r=evaluatePrinciples(o.mode==='broker_holdings'?{...m,positions:m.positions.map(p=>({...p,weightPct:null})),cashPct:null}:m,o.principles);
  $('#ov-mode').value=o.mode;
  const holdingsOnly=o.mode==='broker_holdings';
  $('#ov-source').textContent=['account','broker_holdings'].includes(o.mode)?`${connectionState!=='connected'||liveAccount.snapshot?.provenance?.kind==='saved_observation'?'마지막 조회 자료 · 최신 연결 확인 필요 · ':''}${liveAccount.label} · 증권사 조회 ${stamp(liveAccount.fetchedAt)||liveAccount.fetchedAt} 기준 · 이 화면에만 보관 · 조회만${holdingsOnly?' · 현금·총자산·계좌 수익률 확인 안 됨':''}`:o.mode==='demo'?'예시 · 예시 보유 수량·평균단가·가격 · 실제 아님':o.mode==='manual'?'직접 입력한 수량·평균단가 + 조회 시세 · 계좌 연결 안 됨':'브라우저에 저장한 가상 투자 · 실계좌와 별도';
  $('#ov-empty').hidden=p.positions.length>0;$('#ov-empty h2').textContent='조회된 보유 주식 없음';$('#ov-empty p').textContent='계좌를 조회했지만 보유 주식이 없습니다. 현금·펀드 같은 다른 잔고는 여기에 나오지 않습니다.';
  const cards=holdingsOnly?[['보유 주식 평가액',money(m.total),'현금 제외 · 총자산 확인 안 됨'],['보유 종목 평가손익',money(m.pnl),m.returnPct===null?'원금 기준':'원금 기준 '+pct(m.returnPct)],['계좌 성과·손익 효과','확인 안 됨','현금·입금·출금·전체 평가 기록 필요'],['규칙 점검',r.score===null?'정하지 않음':r.score.toFixed(0)+'%',r.measurable+'개 확인 가능 · 현금 비중 확인 안 됨']]:[[o.mode==='paper'?'가상 투자 총자산':o.mode==='demo'?'예시 총자산':'총자산',money(m.total),'현금 '+money(m.cash)],['보유 자산 평가손익',money(m.pnl),m.returnPct===null?'원금 기준':pct(m.returnPct)+' · 원금 기준'],['전 거래일 대비 손익',money(m.dailyPnl),'지금 수량 × 전날 대비 가격 차이'],['규칙 지킴',r.score===null?'정하지 않음':r.score.toFixed(0)+'%',r.measurable+'개 확인 가능 · 같은 비중']];
  $('#ov-kpis').innerHTML=cards.map(([a,b,c])=>`<article><span>${a}</span><strong>${b}</strong><small>${c}</small></article>`).join('');
  $('#ov-holdings').innerHTML=m.positions.map(x=>{const rule=r.evaluations.find(e=>e.symbol===x.symbol);return `<tr><td><b>${esc(x.name)}</b><small>${x.quantity}주 · 평균단가 ${money(x.avgCost)}</small></td><td>${money(x.price)}<small>${pct(x.dailyPct)}</small><small>${esc(x.asOf||'자료 없음')}</small></td><td>${money(x.value)}<small>${x.weightPct===null?'—':x.weightPct.toFixed(1)+'%'}</small></td><td>${money(x.pnl)}<small>${pct(x.returnPct)}</small></td><td>${money(x.dailyPnl)}</td><td>${rule?statusWord(rule.status):'정하지 않음'}</td></tr>`;}).join('')||'<tr><td colspan="6" class="empty">조회 범위에 보유 주식이 없습니다.</td></tr>';
  $('#ov-allocation').closest('article').querySelector('p.muted').textContent=holdingsOnly?'보유 주식 평가액 기준 비중 · 현금 제외':'현금을 포함한 조회 자산 기준 비중';
  $('#ov-allocation').innerHTML=m.total>0?[...m.positions.map(x=>[x.name,x.weightPct]),...(holdingsOnly?[]:[['현금',m.cashPct]])].map(([name,value])=>`<div class="allocation-row"><span>${esc(name)}</span><b>${value.toFixed(1)}%</b><div><i style="width:${Math.min(100,value)}%"></i></div></div>`).join('')+(holdingsOnly?'<p class="muted">보유 주식 평가액 안에서의 비중입니다. 현금 자료가 없어 계좌 전체 비중은 확인 안 됨입니다.</p>':''):'<p class="muted">모든 종목의 가격을 확인하면 비중을 보여 줍니다.</p>';
  $('#ov-rules').innerHTML=r.evaluations.length?r.evaluations.map(e=>`<div class="rule-row"><b>${esc(e.label)} · ${statusWord(e.status)}</b><p>${e.actual===null?'가격 자료 부족':`지금 ${e.actual.toFixed(2)}% / ${e.direction==='max'?'최대':'최소'} ${e.threshold}%${e.gap>0?' · '+e.gap.toFixed(2)+'%p '+(e.direction==='max'?'초과':'부족'):''}`}</p></div>`).join(''):'<p>아직 규칙이 없습니다. 규칙 화면에서 한 종목 최대 비중과 현금 최소 비중을 정하세요.</p>';
  $('#ov-strategy-summary').textContent=state().approved?state().approved.definition.name+' · '+state().approved.definition.entryRule:'아직 확정한 매매 규칙이 없습니다. 고급 전략 실험에서 정할 수 있습니다.';
  $('#ov-next-context').textContent=holdingsOnly?'과거 투자 성과(CSV)는 현금 포함 평가액과 입금·출금 기록이 있을 때만 계좌 수익률을 계산합니다. 목표·ETF 적립은 이 보유 종목을 따로 가상 계획으로 복사하며 실제 주문은 내지 않습니다.':'실계좌, 가상 투자, 과거 시세 테스트·가정은 서로 다른 자료입니다. 과거 투자 성과와 목표·ETF 적립은 필요한 자료 범위를 먼저 확인합니다.';
  $('#sim-history').innerHTML=(o.simulationRuns||[]).slice().reverse().slice(0,10).map(x=>`<p>${stamp(x.savedAt)} · ${x.assumptions.months}개월 · 월 ${money(x.assumptions.monthly)} · 가정 ${x.assumptions.annualRate}% → ${money(x.value)}</p>`).join('')||'<p class="muted">저장한 계산이 없습니다.</p>';
  renderBriefing();
}
function renderBriefing(){
  const o=get(),m=currentMetrics;if(!m)return;
  const movers=m.positions.filter(p=>p.dailyPnl!==null).sort((a,b)=>Math.abs(b.dailyPnl)-Math.abs(a.dailyPnl));
  $('#ov-briefing').innerHTML=(movers.length?movers:m.positions).slice(0,3).map((p,index)=>{
    const cache=o.newsCache?.[p.symbol],item=cache?relevantArticles(p,cache.items||[])[0]:null;
    return `<div class="brief-row"><b>${esc(p.name)}</b><p>${o.mode==='demo'?'예시 가격 변화':p.asOf?esc(p.asOf)+' 종가 기준':'시세 확인 전'} · ${pct(p.dailyPct)} · 지금 보유 수량 기준 ${money(p.dailyPnl)}</p>${item?`<a href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><p>${index===0?esc(item.description.slice(0,140))+(item.description.length>140?'…':''):''}</p><small>${esc(item.sourceHost)} · 발행 ${esc(item.publishedAt||'시각 없음')} · 받은 시각 ${esc(cache.fetchedAt)}</small>`:`<p class="muted">${esc(cache?.error|| (cache?'관련 기사 없음':'관련 기사 불러오기 전'))}</p>`}${index===0?`<p class="muted">${o.mode==='demo'?'검색 기사는 예시 가격과 관계없습니다. ':''}종목 이름으로 찾은 기사이며 가격이 움직인 원인으로 확인한 것은 아닙니다.</p>`:''}</div>`;
  }).join('')||'<p>보유 종목이 있으면 가격 변화와 관련 기사를 함께 보여 줍니다.</p>';
}
function safeUrl(url){try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}}
async function refreshQuotes(){
  const user=key(),o=get(),positions=portfolio().positions;
  if(o.mode==='broker_holdings'){document.querySelector('#toss-refresh')?.click();return;}if(o.mode==='account'){document.querySelector('[data-connect-account]')?.click();return;}
  if(o.mode==='demo'){$('#ov-status').textContent='예시는 고정된 예시 가격을 씁니다. 실제 시세는 직접 입력한 자산에서 조회하세요.';return;}
  if(!positions.length){$('#ov-status').textContent='보유 종목이 있어야 시세를 조회합니다.';return;}
  $('#ov-refresh').disabled=true;$('#ov-status').textContent='종목별 시세 확인 중…';
  const result=await Promise.allSettled(positions.map(async p=>{
    const res=await fetch('/api/market?'+new URLSearchParams({symbol:p.symbol,range:'3mo'}));const data=await res.json();if(!res.ok)throw new Error(p.name+': '+(data.error||'조회 실패'));
    if(data.currency!=='KRW')throw new Error(p.name+': 원화 자료만 지원');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',hour:'numeric',hourCycle:'h23'}).format(new Date()));
    const candles=data.candles.filter(c=>hour>=16||c.date!==today),last=candles.at(-1),prev=candles.at(-2);if(!last||!prev)throw new Error(p.name+': 가격 자료 부족');
    return [p.symbol,{price:last.close,prevClose:prev.close,asOf:last.date,fetchedAt:data.fetchedAt,source:data.source}];
  }));
  $('#ov-refresh').disabled=false;if(user!==key()||get().mode!==o.mode)return;
  const quotes={...get().quotes};for(const r of result)if(r.status==='fulfilled')quotes[r.value[0]]=r.value[1];save({quotes});render();
  $('#ov-status').textContent=result.some(r=>r.status==='rejected')?result.filter(r=>r.status==='rejected').map(r=>r.reason.message).join(' / ')+' · 실패한 종목은 이전 값 유지':`조회 완료 · ${stamp(new Date().toISOString())} 기준 · 야후 파이낸스 무료 시세(늦을 수 있음) · 거래소 실시간 가격이 아닙니다.`;
}
function switchMode(mode){save({mode});render();}
$('#ov-mode').onchange=e=>switchMode(e.target.value);$('#ov-refresh').onclick=refreshQuotes;
function chart(series){return performanceChart(['value','principal'].map(key=>series.map((x,i)=>({date:x.month+'개월',value:x[key]}))),['가정한 수익률의 자산','원금'],{normalized:false,unit:'원',title:'원금과 가정한 자산'});}
function allocationImpact(args){
  const m=metrics(),same=m.total&&Math.abs(args.initial-m.total)<=1;
  if(['account','broker_holdings'].includes(get().mode)&&m.cash===null)return same?'<p>시작 금액은 보유 주식 평가액입니다. 현금 자료가 없어 계좌 전체 비중 변화는 계산하지 않습니다.</p>':'<p class="muted">시작 자산을 바꿔서 비중 비교는 뺐습니다.</p>';
  if(!same)return '<p class="muted">시작 자산을 바꿔서 비중 비교는 뺐습니다.</p>';
  const total=m.total+args.once;
  return `<details><summary>지금 넣으면 비중</summary><p class="muted">추가금을 현금으로 넣은 직후 비중입니다(이후 매수·가격 변화·월 적립은 계산 안 함).</p><table><thead><tr><th>자산</th><th>지금</th><th>넣은 직후</th></tr></thead><tbody>${[...m.positions.map(p=>[p.name,p.value]),['현금',m.cash]].map(([name,value])=>`<tr><td>${esc(name)}</td><td>${(value/m.total*100).toFixed(2)}%</td><td>${((value+(name==='현금'?args.once:0))/total*100).toFixed(2)}%</td></tr>`).join('')}</tbody></table></details>`;
}
function calculateSim(){try{const args={initial:Number($('#sim-initial').value),once:Number($('#sim-once').value),monthly:Number($('#sim-monthly').value),months:Number($('#sim-months').value),annualRate:Number($('#sim-rate').value),annualFee:Number($('#sim-fee').value)};simResult=simulateContributions(args);const other=[args.annualRate-3,args.annualRate,args.annualRate+3].filter(x=>x>-100&&x<=100).map(annualRate=>simulateContributions({...args,annualRate}));$('#sim-result').innerHTML=`<div class="sim-total"><small>${args.months}개월 후 · 가정 결과</small><strong>${money(simResult.value)}</strong><p>원금 ${money(simResult.principal)} · 수익(가정) ${money(simResult.gain)}</p></div>${chart(simResult.series)}${allocationImpact(args)}<table><thead><tr><th>가정 연 수익률</th><th>가정 자산</th><th>원금 대비</th></tr></thead><tbody>${other.map(r=>`<tr><td>${r.assumptions.annualRate.toFixed(1)}%</td><td>${money(r.value)}</td><td>${money(r.gain)}</td></tr>`).join('')}</tbody></table><p class="muted">±3%p는 비교용 가정이며 일어날 확률을 뜻하지 않습니다. 시작 자산도 이번 계산의 원금으로 셉니다.</p>`;wireCharts($('#sim-result'));$('#sim-save').disabled=false;$('#sim-status').textContent='';}catch(e){simResult=null;$('#sim-save').disabled=true;$('#sim-status').textContent=e.message;}}
$('#sim-form').onsubmit=e=>{e.preventDefault();calculateSim();};$('#sim-form').addEventListener('input',()=>{simResult=null;$('#sim-save').disabled=true;$('#sim-status').textContent='조건이 바뀌었습니다. 다시 계산해 주세요.';});
// 실계좌 금액이 들어갈 수 있는 계산만 저장하지 않는다. 팀 모의계좌·예시(가상 돈)는 저장한다(예전에는 모든 홈 자산에서 저장이 막혔다).
const realAmounts=()=>{const mode=get().mode;if(mode==='account')return true;if(mode!=='broker_holdings')return false;const s=liveAccount?.snapshot;return !(s?.paper||s?.demo);};
$('#sim-save').onclick=()=>{if(realAmounts()){$('#sim-status').textContent='실계좌 금액이 들어간 계산은 저장하지 않습니다. 이 화면에서만 보세요.';return;}if(!simResult)return;save({simulationRuns:[...get().simulationRuns,{...simResult,savedAt:new Date().toISOString(),mode:get().mode}].slice(-30)});render();$('#sim-status').textContent='가정과 월별 결과를 저장했습니다.';};
window.addEventListener('teamquant:state',()=>render());window.addEventListener('teamquant:page',()=>{if($('.view.active')?.dataset.page==='home')render();});
render();

window.addEventListener('teamquant:account-snapshot',event=>{
 const d=event.detail;
 if(!d.configured||!Array.isArray(d.holdings))return;
 const positions=d.holdings.map(h=>({symbol:h.symbol,name:h.name,quantity:h.quantity,avgCost:h.averagePrice}));
 liveAccount={owner:key(),label:d.mode==='prod'?'한국투자증권 실계좌 · 조회만':'한국투자증권 모의계좌 · 조회만',fetchedAt:d.fetchedAt,portfolio:{cash:d.summary.cash,positions},quotes:Object.fromEntries(d.holdings.map(h=>[h.symbol,{price:h.currentPrice,prevClose:null,asOf:d.fetchedAt,source:'한국투자증권 잔고 조회'}]))};
 if(!$('#ov-mode option[value="account"]')){const option=document.createElement('option');option.value='account';option.textContent='한국투자증권 조회 잔고';$('#ov-mode').append(option);}
 save({mode:'account'});render();$('#ov-status').textContent='보유 국내 주식과 현금 기준입니다. 펀드·해외 자산·미수·정산 항목이 빠져 증권사 총평가액과 다를 수 있습니다. 전날 가격 자료가 없어 오늘 손익은 보여 주지 않습니다.';
});
window.addEventListener('teamquant:account-disconnect',()=>{liveAccount=null;save({mode:'paper'});$('#ov-mode option[value="account"]')?.remove();render();$('#ov-status').textContent='조회한 계좌의 화면 자료를 지웠습니다.';});
window.addEventListener('teamquant:asset-snapshot',event=>{
 const d=event.detail;if(!Array.isArray(d?.positions))return;
 liveAccount={snapshot:d,newsCache:{},owner:key(),label:d.paper?'팀 모의계좌 · 가상 돈':'토스증권 보유 주식 · 조회만',fetchedAt:d.fetchedAt,portfolio:{cash:null,positions:d.positions.map(p=>({symbol:p.symbol,name:p.name,quantity:p.quantity,avgCost:p.avgCost}))},quotes:Object.fromEntries(d.positions.map(p=>[p.symbol,{price:p.price,prevClose:null,asOf:d.fetchedAt,source:'토스증권 보유주식 조회'}]))};
 if(!$('#ov-mode option[value="broker_holdings"]')){const option=document.createElement('option');option.value='broker_holdings';option.textContent='토스 보유 주식(조회만)';$('#ov-mode').append(option);}
 save({mode:'broker_holdings'});render();$('#ov-status').textContent='조회한 보유 주식만 보여 줍니다(현금·총자산·입금·출금·계좌 수익률은 자료에 없음). 자세한 자료는 과거 투자 성과(CSV)나 목표·ETF 적립에서 이어서 볼 수 있습니다.';
});

window.addEventListener('teamquant:asset-clear',()=>{if(get().mode!=='broker_holdings')return;liveAccount=null;save({mode:'paper'});$('#ov-mode option[value="broker_holdings"]')?.remove();render();$('#ov-status').textContent='조회 정보를 화면에서 지웠습니다. PC 원본 기록은 유지됩니다.';});

window.addEventListener('teamquant:connection',e=>{connectionState=e.detail.status;render();});
