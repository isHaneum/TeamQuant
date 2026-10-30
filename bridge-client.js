const local=location.hostname==='127.0.0.1';
let capability=null;
export async function privateRead(path,body={}){
 if(!local&&!capability&&path!=='pair')throw new Error('PC 화면에서 연결코드를 발급한 뒤 이 화면에 입력하세요.');
 let response;try{response=await fetch((local?'':'http://127.0.0.1:8766')+'/api/bridge/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(local?{'X-TeamQuant-Action':'bridge-local'}:{}),...(capability?{Authorization:'Bearer '+capability.token}:{})},body:JSON.stringify(body),cache:'no-store'});}catch{throw new Error('PC의 로컬 서버 실행 여부와 브라우저의 로컬 네트워크 접근 권한을 확인하세요.');}
 const data=await response.json();if(!response.ok){if(response.status===401&&!local)capability=null;throw new Error(data.error||'PC 연결 실패');}return data;
}
export async function pairPrivatePc(code){capability=await privateRead('pair',{code});return {expiresAt:capability.expiresAt};}
export function installBridgeUi(panel,refresh){
 const box=document.createElement('details');box.className='panel bridge-panel';box.open=!local;
 box.innerHTML=`<summary>내 PC 연결 · ${local?'로컬 실행 중':'연결 대기'}</summary><p>Vercel은 화면만 제공합니다. 조회 데이터는 PC에서 이 탭으로 직접 전달됩니다. 보유 주식 조회 이력은 PC에 저장하며 Vercel 서버에는 저장하지 않습니다.</p>${local?'<button id="bridge-code" class="secondary">Vercel 연결코드 발급</button> <strong id="bridge-code-value"></strong> <a href="https://teamquant.vercel.app/" target="_blank" rel="noopener noreferrer">Vercel 열기</a><p class="muted">2분 유효 · 1회 사용 · 코드를 공유하지 마세요.</p>':'<form id="bridge-form"><label>PC에서 발급한 6자리 코드<input id="bridge-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="off" required></label><button class="primary">내 PC와 연결</button></form><p class="muted">localhost:8766을 계속 켜두세요. 연결 후 5분마다 갱신, 이 탭에서 1시간 유지. 브라우저가 로컬 네트워크 접근을 물으면 본인 연결인지 확인 후 허용하세요.</p>'}<p id="bridge-status" role="status"></p>`;
 panel.querySelector('.page-head').after(box);
 const status=box.querySelector('#bridge-status');
 if(local)box.querySelector('#bridge-code').onclick=async()=>{try{const d=await privateRead('challenge');box.querySelector('#bridge-code-value').textContent=d.code;setTimeout(()=>box.querySelector('#bridge-code-value').textContent='코드 만료',120000);}catch(e){status.textContent=e.message;}};
 else box.querySelector('#bridge-form').onsubmit=async e=>{e.preventDefault();try{capability=await privateRead('pair',{code:box.querySelector('#bridge-input').value});box.querySelector('#bridge-input').value='';status.textContent='연결 완료 · 1시간 유효';box.open=false;await refresh();}catch(err){status.textContent=err.message;}};
 let lastRefresh=0;
 window.addEventListener('teamquant:asset-snapshot',()=>lastRefresh=Date.now());
 setInterval(()=>{if(lastRefresh&&Date.now()-lastRefresh>=300000&&document.visibilityState==='visible')refresh();},300000);
 window.addEventListener('teamquant:asset-clear',async()=>{lastRefresh=0;if(capability)try{await privateRead('disconnect');}catch{}capability=null;});
}
