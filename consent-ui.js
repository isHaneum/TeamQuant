// 사용자 확인 조항 — 브라우저 쪽(2026-11-16 법률 검토 · C1 서비스 성격 · C2 투자 위험 · C3 데이터 한계는 필수, C4 저장 위치 · C11 외부 서비스는 고지,
// C12 동의 관리는 설정 화면, PC 연결 패키지를 받기 전에는 C7 키 보관 · C8 본인 계좌 · C9 조회 전용 · C13 나이를 따로 확인).
// 원칙: 미리 체크된 칸 없음 · 조항마다 따로 체크 · 다 체크하기 전에는 '시작' 버튼이 꺼져 있음 · 문구가 바뀌면(버전·지문이 다르면) 다시 묻는다.
// 기록은 이 브라우저(localStorage)에만: {ver, decidedAt, choices, sha(문구 SHA-256)}. 서버로 보내지 않는다. 동의해도 서비스의 법적 성격은 바뀌지 않는다.
const VER = '2026-11-16.1', KEY = 'teamQuantConsent:v1', PCKEY = 'teamQuantConsentPc:v1';
const REQUIRED = [
  ['C2', '투자 위험', '주식·ETF 투자는 원금의 0~100%를 잃을 수 있고, 그 손실은 모두 내 몫입니다. 모의계좌 성과와 과거 수익률은 미래 수익을 보장하지 않습니다. 해외 자산은 환율 때문에 손실이 더 커질 수 있고, 세금·수수료·실제 체결가는 계산과 다를 수 있습니다.', '원금 손실 가능성과 그 손실이 내 책임임을 확인했습니다'],
  ['C1', '서비스 성격', '이 앱은 대학 수업 팀 프로젝트로 만든 무료 계산 도구입니다. 투자자문·투자권유·투자일임 서비스가 아니고, 팀은 금융위원회에 등록된 금융투자업자가 아닙니다. 계획과 \'할 일\' 금액은 내가 넣은 규칙과 보유 종목으로 계산한 결과이며, 실행 여부는 내가 정합니다. 개별 상담이나 질문 답변은 하지 않고, 대가·광고·제휴 수익을 받지 않습니다.', '위 내용을 확인했습니다'],
  ['C3', '데이터 한계', '가격·재무·뉴스는 Yahoo Finance, OpenDART, 한국투자증권 API, 네이버 뉴스 검색에서 가져오며 늦거나 틀릴 수 있습니다. 뉴스 \'주의\' 표시는 자동 규칙으로 붙고, 기사 내용이 사실인지는 확인하지 않습니다. 중요한 결정 전에는 공시·증권사 화면 원문을 확인하세요. 팀의 고의 또는 중대한 과실로 생긴 손해는 이 안내와 관계없이 책임 대상입니다.', '데이터가 늦거나 틀릴 수 있음을 확인했습니다'],
];
const NOTICES = [
  ['C4', '내 정보는 이 브라우저에', '입력한 규칙과 보유 내역은 이 브라우저(localStorage)에 저장되고, 설정에서 지울 수 있습니다. 시세·뉴스를 가져오려고 종목 코드·이름이 사이트 서버(Vercel)로 전달될 수 있습니다. 프로필 PIN 은 보안 기능이 아니니 은행·카드 비밀번호를 쓰지 마세요. 공용 PC 에서는 쓰지 마세요.'],
  ['C11', '외부 서비스', '웹사이트는 미국 Vercel 에, 공개 데이터는 미국 GitHub 에 있습니다. 팀은 방문자 정보를 따로 모으지 않지만, 호스팅 업체는 접속 기록(IP 등)을 자체 정책에 따라 미국 등에서 처리합니다.'],
];
const PC = [
  ['C7', '키는 내 PC 에만, 암호화해서', '증권사 앱키·시크릿과 접속 토큰은 이 프로그램을 돌리는 내 PC 에만 암호화해 저장합니다. 팀 서버·GitHub·노션·AI 서비스로 보내지 않습니다. 키에는 주문 권한이 있을 수 있으니 남에게 주거나 빌려주지 않고, 유출이 의심되면 바로 증권사에서 폐기하고 다시 발급받습니다.'],
  ['C8', '본인 계좌·본인 키만', '내 명의 계좌와 내가 발급한 키만 연결합니다. 다른 사람의 계좌나 키를 받아 조회하거나 대신 주문하지 않습니다. 증권사 API 로 받은 정보는 본인 매매 목적에만 쓰고 다른 사람에게 배포하지 않습니다.'],
  ['C9', '조회 전용', '실계좌는 잔고와 보유 종목만 읽습니다. 증권사 키 자체에는 주문 권한이 있을 수 있어서 \'조회 전용\'은 이 프로그램 코드가 지키는 제한입니다. 팀은 내 키·계좌 정보를 받지 않습니다.'],
  ['C13', '만 19세 이상', '실계좌 연결·API 키 입력은 만 19세 이상만 씁니다. 나는 만 19세 이상입니다.'],
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
async function sha(text) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.normalize('NFC'))); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch { return 'nohash'; } }
async function fingerprints(list) { const o = {}; for (const [id, , text] of list) o[id] = await sha(text); return o; }
async function valid(k, list) { const r = read(k); if (!r || r.ver !== VER) return false; const f = await fingerprints(list); return list.every(([id]) => r.choices?.[id] === 'accept' && r.sha?.[id] === f[id]); }

const style = document.createElement('style');
style.textContent = '.tq-consent{position:fixed;inset:0;z-index:1000;background:rgba(17,24,39,.55);display:grid;place-items:center;padding:16px}.tq-consent>div{background:#fff;color:#111;max-width:640px;width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:16px;padding:22px 22px 18px;box-shadow:0 20px 50px rgba(0,0,0,.25)}.tq-consent h2{margin:0 0 4px;font-size:20px}.tq-consent .tq-sub{margin:0 0 14px;color:#555;font-size:13px}.tq-consent section{border:1px solid #e3e7ee;border-radius:12px;padding:12px 14px;margin:10px 0}.tq-consent h3{margin:0 0 6px;font-size:15px}.tq-consent p{margin:0 0 8px;font-size:14px;line-height:1.6}.tq-consent label{display:flex;gap:8px;align-items:flex-start;font-weight:700;font-size:14px;cursor:pointer}.tq-consent input{margin-top:3px;width:18px;height:18px}.tq-consent .tq-note{background:#f6f8fb;border-color:#eef1f5}.tq-consent .tq-note p{font-size:13px;color:#444}.tq-consent .tq-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}.tq-consent button{font:inherit;border-radius:10px;padding:10px 16px;border:1px solid #cbd3dd;background:#fff;cursor:pointer}.tq-consent button.tq-go{background:#17283e;color:#fff;border-color:#17283e}.tq-consent button[disabled]{opacity:.45;cursor:not-allowed}';
document.head.append(style);

/** 체크 조항 + 고지로 된 창. 모두 체크해야 확인 버튼이 켜진다. 반환: true(확인) / false(나가기). */
function dialog({ title, sub, checks, notices = [], go, leave }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div'); wrap.className = 'tq-consent'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'tq-consent-title');
    wrap.innerHTML = `<div><h2 id="tq-consent-title">${esc(title)}</h2><p class="tq-sub">${esc(sub)}</p>${checks.map(([id, h, text, label]) => `<section><h3>${esc(h)}</h3><p>${esc(text)}</p><label><input type="checkbox" data-tq-check="${id}"> ${esc(label || '확인했습니다')} (필수)</label></section>`).join('')}${notices.map(([, h, text]) => `<section class="tq-note"><h3>${esc(h)}</h3><p>${esc(text)}</p></section>`).join('')}<div class="tq-actions"><button type="button" data-tq-leave>${esc(leave)}</button><button type="button" class="tq-go" data-tq-go disabled>${esc(go)}</button></div></div>`;
    const boxes = [...wrap.querySelectorAll('[data-tq-check]')], goBtn = wrap.querySelector('[data-tq-go]');
    for (const b of boxes) b.addEventListener('change', () => { goBtn.disabled = !boxes.every(x => x.checked); });
    goBtn.addEventListener('click', () => { if (boxes.every(x => x.checked)) { wrap.remove(); resolve(true); } });
    wrap.querySelector('[data-tq-leave]').addEventListener('click', () => { wrap.remove(); resolve(false); });
    document.body.append(wrap); boxes[0]?.focus();
  });
}

let asking = false;
async function ensureConsent() {
  const app = document.getElementById('app'); if (!app || app.hidden || asking) return;
  if (await valid(KEY, REQUIRED)) return;
  asking = true;
  const ok = await dialog({ title: '시작하기 전에 확인해 주세요', sub: `확인 조항 ${VER} · 체크한 내용은 이 브라우저에만 기록됩니다(설정 > 동의 관리에서 철회).`, checks: REQUIRED, notices: NOTICES, go: '확인하고 시작', leave: '나가기' });
  asking = false;
  if (ok) { write(KEY, { ver: VER, decidedAt: new Date().toISOString(), choices: Object.fromEntries(REQUIRED.map(([id]) => [id, 'accept'])), sha: await fingerprints(REQUIRED), notices: NOTICES.map(([id]) => id) }); renderManage(); }
  else { document.getElementById('logout')?.click(); if (!document.getElementById('app')?.hidden) location.reload(); }
}

/** 설정 > 동의 관리(C12): 무엇에 언제 동의했는지 보고 철회한다. 철회하면 다음에 다시 묻는다. */
function renderManage() {
  const host = document.getElementById('workspace-settings'); if (!host) return;
  let box = document.getElementById('tq-consent-manage');
  if (!box) { box = document.createElement('article'); box.className = 'panel'; box.id = 'tq-consent-manage'; host.append(box); }
  const r = read(KEY), pc = read(PCKEY), when = x => (x?.decidedAt ? new Date(x.decidedAt).toLocaleString('ko-KR') : '없음');
  box.innerHTML = `<h2>동의 관리</h2><p>시작 확인(서비스 성격 · 투자 위험 · 데이터 한계): ${esc(when(r))}${r?.ver ? ` · 문구 ${esc(r.ver)}` : ''}</p><p>PC 연결 확인(키 보관 · 본인 계좌 · 조회 전용 · 나이): ${esc(when(pc))}</p><p class="muted">기록은 이 브라우저에만 있고 서버로 보내지 않습니다. 철회하면 다음에 다시 묻습니다. ${esc(NOTICES.map(([, h, t]) => `${h}: ${t}`).join(' '))}</p><button type="button" class="secondary" id="tq-consent-withdraw">동의 철회</button>`;
  box.querySelector('#tq-consent-withdraw').onclick = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(PCKEY); } catch { } renderManage(); ensureConsent(); };
}

// PC 연결 패키지(TeamQuant-PC.zip)는 C7·C8·C9·C13 을 확인한 뒤에만 내려받는다.
// 내려받기는 먼저(동기적으로) 막고, 확인이 끝난 뒤에 다시 누른다(비동기 확인 뒤에 막으면 이미 내려받기가 시작된다).
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href*="TeamQuant-PC.zip"]'); if (!a || a.dataset.tqOk === '1') return;
  e.preventDefault(); e.stopPropagation();
  (async () => {
    if (!(await valid(PCKEY, PC))) {
      const ok = await dialog({ title: 'PC 연결 프로그램을 받기 전에', sub: '이 프로그램은 내 PC 에서 내 증권사 키로만 돕니다. 팀은 키·계좌 정보를 받지 않습니다.', checks: PC.map(([id, h, t]) => [id, h, t, '확인했습니다']), go: '확인하고 내려받기', leave: '취소' });
      if (!ok) return;
      write(PCKEY, { ver: VER, decidedAt: new Date().toISOString(), choices: Object.fromEntries(PC.map(([id]) => [id, 'accept'])), sha: await fingerprints(PC) }); renderManage();
    }
    a.dataset.tqOk = '1'; a.click(); delete a.dataset.tqOk;
  })();
}, true);

const appEl = document.getElementById('app');
if (appEl) new MutationObserver(() => ensureConsent()).observe(appEl, { attributes: true, attributeFilter: ['hidden'] });
renderManage(); ensureConsent();
