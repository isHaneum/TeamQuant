// 사용자 확인 조항 — 브라우저 쪽(2026-11-16 법률 검토 · C1 이 앱이 하는 일 · C2 투자 위험 · C3 자료 한계는 필수, C4 저장 위치 · C11 사이트 서버 위치는 고지,
// C12 동의 관리는 설정 화면, PC 프로그램을 받기 전에는 C7 키 보관 · C8 본인 계좌 · C9 조회만 · C13 나이를 따로 확인).
// 원칙: 미리 체크된 칸 없음 · 조항마다 따로 체크 · 다 체크하기 전에는 '시작' 버튼이 꺼져 있음 · 문구가 바뀌면(버전·지문이 다르면) 다시 묻는다.
// 기록은 이 브라우저(localStorage)에만: {ver, decidedAt, choices, sha(문구 SHA-256)}. 서버로 보내지 않는다. 동의해도 서비스의 법적 성격은 바뀌지 않는다.
// 2026-11-26.1: 쉬운 말로 다시 씀(법률 용어는 괄호에 남김). 위험 고지·투자 권유 아님·책임·동의 취소는 그대로 둔다. C4 의 '설정 > 내 기록 지우기'는 workspace-ui.js 에 있다.
import { tip } from '/tooltip-ui.js';
const VER = '2026-11-26.1', KEY = 'teamQuantConsent:v1', PCKEY = 'teamQuantConsentPc:v1';
const REQUIRED = [
  ['C2', '투자 위험', '주식·ETF 투자는 원금을 전부 잃을 수도 있고, 그 손실은 모두 내 몫입니다. 모의계좌 성과와 과거 수익률은 앞으로의 수익을 보장하지 않습니다. 해외 자산은 환율 때문에 손실이 더 커질 수 있고, 세금·수수료·실제 체결가는 계산과 다를 수 있습니다.', '원금을 잃을 수 있고 그 손실은 내 책임임을 확인했습니다'],
  ['C1', '이 앱이 하는 일', '이 앱은 대학 수업 팀 프로젝트로 만든 무료 계산 도구입니다. 투자를 권하거나 대신 투자해 주는 서비스(투자자문·투자권유·투자일임)가 아니고, 팀은 금융위원회에 등록된 금융투자업자가 아닙니다. 계획과 \'할 일\' 금액은 내가 넣은 규칙과 보유 종목으로 계산한 결과이며, 실행 여부는 내가 정합니다. 1:1 상담이나 질문 답변은 하지 않고, 대가·광고·제휴 수익을 받지 않습니다.', '위 내용을 확인했습니다'],
  ['C3', '자료가 늦거나 틀릴 수 있음', '가격·재무·뉴스는 야후 파이낸스, 금융감독원 전자공시(DART), 한국투자증권, 네이버 뉴스에서 가져와 늦거나 틀릴 수 있습니다. 뉴스 \'주의\' 표시는 자동 규칙이 붙이며 기사 내용이 사실인지는 확인하지 않습니다. 중요한 결정 전에는 공시·증권사 화면 원문을 확인하세요. 팀의 고의나 중대한 과실로 생긴 손해는 이 안내와 관계없이 팀이 책임집니다.', '자료가 늦거나 틀릴 수 있음을 확인했습니다'],
];
const NOTICES = [
  ['C4', '내 정보는 이 브라우저에', '입력한 규칙과 보유 내역은 이 브라우저에만 저장되고, 설정 > 내 기록 지우기로 지울 수 있습니다. 시세·뉴스를 받으려고 종목 코드·이름이 사이트 서버로 전달될 수 있습니다. 프로필 잠금 번호는 보안 기능이 아니니 은행·카드 비밀번호를 쓰지 마세요. 공용 PC에서는 쓰지 마세요.'],
  ['C11', '사이트 서버 위치', '웹사이트와 공개 자료는 미국 업체 Vercel·GitHub의 서버에 있습니다. 팀은 방문자 정보를 따로 모으지 않지만, 이 업체들은 접속 기록(IP 등)을 자기 정책에 따라 미국 등에서 처리합니다.'],
  // 2026-11-27 C15(LEGAL 5.3 · H1): 고지(체크 없음)라 동의 지문(REQUIRED)·VER 에 들어가지 않는다. 넣어도 기존 동의는 그대로다.
  ['C15', 'AI 사용 안내', "팀 모의계좌(가상 돈)의 '하락 시 추가 매수 허용·보류·금지' 카드는 생성형 AI(Anthropic Claude)가 공개 기사와 시세로 씁니다. 이 카드에는 'AI 판정 · 날짜'를 붙입니다. AI는 틀리거나 기사를 잘못 읽을 수 있습니다. 이 카드는 팀 모의계좌의 매수 조건으로만 쓰이며, 매매하라는 뜻이 아닙니다. '오늘 시장' AI 요약은 2026-11-27부터 멈췄습니다. 방문자가 입력한 내용은 AI로 보내지 않습니다."],
];
const PC = [
  ['C7', '키는 내 PC에만, 암호화해서', '증권사 API 키(앱키·시크릿)와 접속 토큰은 이 프로그램을 실행하는 내 PC에만 암호화해 저장합니다. 팀 서버·GitHub·노션·AI 서비스로 보내지 않습니다. 키에는 주문 권한이 있을 수 있으니 남에게 주거나 빌려주지 말고, 새어 나간 것 같으면 바로 증권사에서 지우고 새로 받으세요.'],
  ['C8', '본인 계좌·본인 키만', '내 명의 계좌와 내가 받은 키만 연결합니다. 다른 사람의 계좌나 키로 조회하거나 대신 주문하지 않습니다. 증권사 API로 받은 정보는 내 매매에만 쓰고 다른 사람에게 나눠 주지 않습니다.'],
  ['C9', '조회만', '이 프로그램은 실계좌의 잔고와 보유 종목만 읽습니다. 증권사 키 자체에는 주문 권한이 있을 수 있어서 \'조회만\'은 이 프로그램 코드가 지키는 제한입니다. 팀은 내 키·계좌 정보를 받지 않습니다.'],
  ['C13', '만 19세 이상', '실계좌 연결과 API 키 입력은 만 19세 이상만 할 수 있습니다. 나는 만 19세 이상입니다.'],
];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
async function sha(text) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.normalize('NFC'))); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch { return 'nohash'; } }
async function fingerprints(list) { const o = {}; for (const [id, , text] of list) o[id] = await sha(text); return o; }
async function valid(k, list) { const r = read(k); if (!r || r.ver !== VER) return false; const f = await fingerprints(list); return list.every(([id]) => r.choices?.[id] === 'accept' && r.sha?.[id] === f[id]); }

// 창은 z-index 999: ⓘ 말풍선(tooltip-ui.js, 1000)이 창 위에 보이게 한다. 색·간격은 tokens.css 의 --tq-* 만 쓴다.
const style = document.createElement('style');
style.textContent = '.tq-consent{position:fixed;inset:0;z-index:999;background:rgba(17,24,39,.55);display:grid;place-items:center;padding:var(--tq-sp-4)}.tq-consent>div{background:var(--tq-paper);color:var(--tq-ink);max-width:640px;width:100%;max-height:calc(100vh - 32px);overflow:auto;border-radius:var(--tq-r-2);padding:var(--tq-sp-5) var(--tq-sp-5) var(--tq-sp-4);box-shadow:0 20px 50px rgba(0,0,0,.25)}.tq-consent h2{margin:0 0 var(--tq-sp-1);font-size:var(--tq-fs-4)}.tq-consent .tq-sub{margin:0 0 var(--tq-sp-2);color:var(--tq-sub);font-size:var(--tq-fs-1);line-height:1.6}.tq-consent section{padding:var(--tq-sp-3) 0;border-bottom:1px solid var(--tq-line)}.tq-consent h3{margin:0 0 var(--tq-sp-1);font-size:var(--tq-fs-3)}.tq-consent p{margin:0 0 var(--tq-sp-2);font-size:var(--tq-fs-2);line-height:1.6}.tq-consent label{display:flex;gap:var(--tq-sp-2);align-items:flex-start;font-weight:700;font-size:var(--tq-fs-2);cursor:pointer}.tq-consent input{margin-top:3px;width:18px;height:18px}.tq-consent .tq-notes{margin-top:var(--tq-sp-3);padding:var(--tq-sp-3);border-radius:var(--tq-r-1);background:var(--tq-soft)}.tq-consent .tq-notes h3{font-size:var(--tq-fs-2)}.tq-consent .tq-notes p{font-size:var(--tq-fs-1);color:var(--tq-sub)}.tq-consent .tq-notes p:last-child{margin-bottom:0}.tq-consent .tq-actions{display:flex;gap:var(--tq-sp-2);justify-content:flex-end;flex-wrap:wrap}.tq-consent button{font:inherit;border-radius:var(--tq-r-1);padding:10px var(--tq-sp-4);border:1px solid var(--tq-line);background:var(--tq-paper);color:var(--tq-ink);cursor:pointer}.tq-consent button.tq-go{background:var(--tq-ink);color:var(--tq-paper);border-color:var(--tq-ink)}.tq-consent button[disabled]{opacity:.45;cursor:not-allowed}.tq-consent button.tip{padding:0;border-radius:50%;color:var(--tq-faint);font:italic 600 10px/1 Georgia,serif}';
document.head.append(style);

/** 체크 조항 + 고지로 된 창. 모두 체크해야 확인 버튼이 켜진다. 반환: true(확인) / false(나가기). */
function dialog({ title, sub, subTip = '', checks, notices = [], go, leave }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div'); wrap.className = 'tq-consent'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'tq-consent-title');
    const notes = notices.length ? `<div class="tq-notes">${notices.map(([, h, text]) => `<h3>${esc(h)}</h3><p>${esc(text)}</p>`).join('')}</div>` : '';
    wrap.innerHTML = `<div><h2 id="tq-consent-title">${esc(title)}</h2><p class="tq-sub">${esc(sub)}${subTip ? ' ' + tip(subTip) : ''}</p>${checks.map(([id, h, text, label]) => `<section><h3>${esc(h)}</h3><p>${esc(text)}</p><label><input type="checkbox" data-tq-check="${id}"> ${esc(label || '확인했습니다')} (필수)</label></section>`).join('')}${notes}<div class="tq-actions"><button type="button" data-tq-leave>${esc(leave)}</button><button type="button" class="tq-go" data-tq-go disabled>${esc(go)}</button></div></div>`;
    const boxes = [...wrap.querySelectorAll('[data-tq-check]')], goBtn = wrap.querySelector('[data-tq-go]');
    for (const b of boxes) b.addEventListener('change', () => { goBtn.disabled = !boxes.every(x => x.checked); });
    goBtn.addEventListener('click', () => { if (boxes.every(x => x.checked)) { wrap.remove(); resolve(true); } });
    wrap.querySelector('[data-tq-leave]').addEventListener('click', () => { wrap.remove(); resolve(false); });
    document.body.append(wrap); boxes[0]?.focus();
  });
}

let asking = null;
/** 2026-11-25 UI·UX P0: 들어올 때 막지 않는다. 내 기록을 만드는 행동(가상계좌 만들기·가져오기) 바로 전에 묻는다. 반환: 동의 있음 true · 취소 false. */
async function requireConsent(what = '계속하기') {
  if (await valid(KEY, REQUIRED)) return true;
  if (asking) return asking;
  asking = (async () => {
    // 2026-11-27 보완 2: 제목·부제는 짧게, 안내 문장은 부제 ⓘ 로(제목·부제는 동의 지문(REQUIRED)·VER 밖이라 기존 동의는 그대로).
    const ok = await dialog({ title: `${what} · 확인`, sub: `필수 확인 ${REQUIRED.length}개`, subTip: `모두 체크하면 계속할 수 있습니다. 체크 기록은 이 브라우저에만 남고, 설정 > 동의 관리에서 동의를 취소할 수 있습니다.\n문구 버전 ${VER}`, checks: REQUIRED, notices: NOTICES, go: '확인하고 계속', leave: '취소' });
    if (ok) { write(KEY, { ver: VER, decidedAt: new Date().toISOString(), choices: Object.fromEntries(REQUIRED.map(([id]) => [id, 'accept'])), sha: await fingerprints(REQUIRED), notices: NOTICES.map(([id]) => id) }); renderManage(); }
    return ok;
  })();
  try { return await asking; } finally { asking = null; }
}
window.tqRequireConsent = requireConsent;

/** 고지(읽기 전용): 상단 '투자 권유 아님' 버튼으로 언제든 연다. 체크 없음. */
function noticeDialog() {
  // 닫으면 연 자리로 포커스를 돌려준다(보통 머리글 배지 · LEGAL 5.1). 연 자리가 없거나 사라졌으면 위쪽 버튼으로.
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const wrap = document.createElement('div'); wrap.className = 'tq-consent'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'tq-notice-title');
  wrap.innerHTML = `<div><h2 id="tq-notice-title">쓰기 전에 알아 둘 것</h2>${[...REQUIRED, ...NOTICES].map(([, h, text]) => `<section><h3>${esc(h)}</h3><p>${esc(text)}</p></section>`).join('')}<div class="tq-actions"><button type="button" class="tq-go" data-tq-close>닫기</button></div></div>`;
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); (opener?.isConnected && !opener.closest('.tq-consent') ? opener : document.getElementById('tq-notice-btn'))?.focus(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-tq-close]')) close(); });
  document.addEventListener('keydown', onKey); document.body.append(wrap); wrap.querySelector('[data-tq-close]').focus();
}
function mountNotice() {
  const host = document.querySelector('.top-actions'); if (!host || document.getElementById('tq-notice-btn')) return;
  const b = document.createElement('button'); b.type = 'button'; b.id = 'tq-notice-btn'; b.className = 'tq-notice-btn'; b.textContent = '투자 권유 아님'; b.title = '이 앱이 하는 일 · 투자 위험 · 자료가 늦거나 틀릴 수 있음'; b.addEventListener('click', noticeDialog); host.prepend(b);
}

// 동의한 날: 'MM-DD'(다른 해는 YYYY-MM-DD). 지금 문구와 버전이 다르면 다시 확인해야 한다고 쓴다.
function agreedOn(x) {
  if (!x?.decidedAt) return '아직 안 함';
  const f = ms => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map(p => [p.type, p.value]));
  const t = new Date(x.decidedAt); if (!Number.isFinite(t.getTime())) return '아직 안 함';
  const p = f(t), now = f(new Date()), day = `${p.year === now.year ? '' : p.year + '-'}${p.month}-${p.day}`;
  return x.ver === VER ? `${day} 동의` : `${day} 동의 · 문구가 바뀌어 다시 확인 필요`;
}
/** 설정 > 동의 관리(C12): 무엇에 언제 동의했는지 보고 취소한다. 취소하면 다음에 다시 묻는다. */
function renderManage() {
  const host = document.getElementById('workspace-settings'); if (!host) return;
  let box = document.getElementById('tq-consent-manage');
  if (!box) { box = document.createElement('article'); box.className = 'panel'; box.id = 'tq-consent-manage'; (host.querySelector('.ws-list') || host).append(box); }
  const r = read(KEY), pc = read(PCKEY);
  box.innerHTML = `<h2>동의 관리 ${tip(`문구 버전 ${VER} · 기록은 이 브라우저에만 있고 서버로 보내지 않습니다. 동의를 취소하면 다음에 다시 묻습니다. 고지 전문은 위쪽 '투자 권유 아님'에서 볼 수 있습니다.`)}</h2><div class="tq-consent-rows"><p>시작 확인 ${tip('이 앱이 하는 일 · 투자 위험 · 자료가 늦거나 틀릴 수 있음')} · ${esc(agreedOn(r))}</p><p>PC 프로그램 확인 ${tip('키 보관 · 본인 계좌 · 조회만 · 나이')} · ${esc(agreedOn(pc))}</p></div><button type="button" class="secondary" id="tq-consent-withdraw">동의 취소</button>`;
  box.querySelector('#tq-consent-withdraw').onclick = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(PCKEY); } catch { } renderManage(); };
}

// PC 프로그램(TeamQuant-PC.zip)은 C7·C8·C9·C13 을 확인한 뒤에만 내려받는다.
// 내려받기는 먼저(동기적으로) 막고, 확인이 끝난 뒤에 다시 누른다(비동기 확인 뒤에 막으면 이미 내려받기가 시작된다).
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href*="TeamQuant-PC.zip"]'); if (!a || a.dataset.tqOk === '1') return;
  e.preventDefault(); e.stopPropagation();
  (async () => {
    if (!(await valid(PCKEY, PC))) {
      const ok = await dialog({ title: 'PC 프로그램 받기 · 확인', sub: `필수 확인 ${PC.length}개`, subTip: `이 프로그램은 내 PC에서 내 증권사 키로만 작동합니다. 팀은 키·계좌 정보를 받지 않습니다.\n문구 버전 ${VER}`, checks: PC.map(([id, h, t]) => [id, h, t, '확인했습니다']), go: '확인하고 내려받기', leave: '취소' });
      if (!ok) return;
      write(PCKEY, { ver: VER, decidedAt: new Date().toISOString(), choices: Object.fromEntries(PC.map(([id]) => [id, 'accept'])), sha: await fingerprints(PC) }); renderManage();
    }
    a.dataset.tqOk = '1'; a.click(); delete a.dataset.tqOk;
  })();
}, true);

const appEl = document.getElementById('app');
if (appEl) new MutationObserver(() => mountNotice()).observe(appEl, { attributes: true, attributeFilter: ['hidden'] });
renderManage(); mountNotice();
