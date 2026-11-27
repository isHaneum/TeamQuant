// 첫 방문 안내 '투자 규칙 확인 도구 · 규칙 3단계'(결정 71 · 2026-11-27, 보완 2 같은 날)의 순수 로직과 화면 문구.
// 화면 문구는 모두 여기(TOUR_COPY) 한 곳에만 둔다. tutorial-ui.js 에는 한글 문자열을 두지 않는다(test/tutorial.test.js 가 확인).
// 이 파일은 DOM·저장소·네트워크를 쓰지 않는다. 브라우저와 node --test 가 같은 파일을 읽는다(lib 폴더는 상대 경로 import).
import { RULE_LOCK_DAYS } from './rule-presets.js';

// 문구 버전은 그대로 둔다(2026-11-27 보완 2): 이번 변경은 줄글을 빼기만 해서, 이미 끈 사람에게 카드를 다시 띄울 이유가 없다.
export const COPY_VER = '2026-11-27.1';
export const STORE_KEY = 'teamQuantTour:v1';
export const SESSION_KEY = 'teamQuantTourSeen';
/** 계좌 판정이 끝나지 않아도 이만큼 지나면 카드를 띄운다. */
export const ACCOUNT_WAIT_MS = 4000;
/** 팀 기록이 이 시간보다 오래되면 ③ 띠 ⓘ 에 기준 날짜를 적는다(주말에 공개하지 않으면 48시간은 월요일마다 잘못 울린다). */
export const STALE_HOURS = 72;
export const STEPS = ['rule', 'today', 'team'];
const RULE_DONE = ['previewed', 'confirmed', 'skipped'];
const VIEWS = ['open', 'mini', 'off', 'done'];
const ACCTS = ['paper', 'demo', 'none', 'real'];

// ── 화면 문구. [ ] 안은 화면의 실제 버튼 이름이다(시험이 앱 소스에서 찾는다). '?'로 끝나는 문구는 없다.
// 2026-11-27 보완 2(사용자 지시 · 결정 71): 카드는 제목 + 단계 이름 + 버튼만, 띠는 단계 이름 + 할 일 한 줄만 보인다.
//   설명·기준·주의는 띠의 ⓘ(*Tip) 안에만 둔다. 계좌 줄·늦음 줄·LEGAL 5.1 줄·'하지 않는 일' 줄은 카드에서 뺐다
//   (LEGAL 5.1 은 머리글 [투자 권유 아님] 배지 → 고지 창이 맡는다). '가상 돈'·'실제 아님'처럼 뻔한 말은 쓰지 않는다.
export const TOUR_COPY = {
  title: '투자 규칙 확인 도구',
  listTitle: n => `${n}/3`,
  steps: {
    rule: { name: '① 규칙 정하기' },
    today: { name: '② 오늘 점검 보기' },
    team: { name: '③ 팀 기록 보기' }
  },
  ruleDone: { confirmed: '확정함', previewed: '확인만 함', skipped: '나중에 하기로 함' },
  stepDone: '완료',
  vh: { done: '완료', left: '남음' },
  btn: { go: '하러 가기', start: '시작', later: '나중에', off: '그만 보기', expand: '펼치기', close: '닫기', checklist: '체크리스트', skipRule: '①은 나중에' },
  mini: n => `규칙 3단계 ${n}/3`,
  // 끝 카드: 제목 + [닫기]. 아래 셋은 제목 옆 ⓘ 안에만 들어간다.
  end: {
    title: '3단계 완료',
    summary: rule => `① ${rule} · ② 완료 · ③ 완료`,
    demo: '예시 자산은 홈 계좌 띠의 [예시 끄기]로 끕니다.',
    again: '이 안내는 더보기 > 이용 안내에서 다시 볼 수 있습니다.'
  },
  replay: '규칙 3단계 다시 보기',
  replayPrev: n => `(지난번 ${n}/3)`,
  bandLabel: '규칙 3단계 안내',
  views: { rules: '규칙 화면', home: '홈', paper: '모의투자 화면' },
  // 홈 규칙 점검 카드 제목('규칙 6개 중 5개 지킴')을 알아보는 낱말과, 아직 계산 중일 때 띠에 넣는 글(자리표시 글자 N·M 을 쓰지 않는다).
  heroMark: '지킴',
  heroFallback: '규칙 … 지킴',
  // 띠: 본문은 할 일 한 줄(짧은 명령형 · 30자 이내 · 한 문장). 나머지는 모두 *Tip(ⓘ) 안.
  band: {
    move: { rules: '규칙으로', home: '홈으로', paper: '모의투자로' },
    // 규칙 화면이 아니면 [규칙으로] 이동 버튼이 함께 나온다(본문은 같다).
    rulePaper: '[예시 자산으로 바꿔서 직접 정하기] 누르기',
    // 공개 사이트에 실계좌 연결 안내가 남아 있어(홈 연결 카드 · LEGAL M7 사용자 결정) '실계좌 기능이 없다'고 단정하지 않는다.
    rulePaperTip: '규칙 화면 맨 위 카드의 맨 아래에 있습니다. 팀 모의계좌 규칙은 보기만 됩니다. 이 공개 화면에서는 예시 종목 6개로 정해 봅니다. 누르면 홈 숫자도 예시 자산으로 바뀌고, 홈 계좌 띠의 [예시 끄기]로 돌아갑니다.',
    ruleNone: '[예시 자산으로 둘러보기] 누르기',
    ruleNoneTip: '팀 기록을 불러오지 못했습니다. 홈의 이 버튼을 누르면 예시 종목 6개로 해 볼 수 있습니다.',
    ruleFail: '예시 자산을 만들지 못했습니다',
    ruleFailTip: '시세를 받지 못했습니다. ①은 나중에 하고 ②·③을 먼저 볼 수 있습니다.',
    ruleDemo: '[이 규칙으로 확정] 누르기',
    ruleDemoTip: '바로 확정되지 않고, 바뀌는 값과 잠금 날짜가 먼저 나옵니다. 값을 고치려면 [값 고쳐서 확정]을 누릅니다. 고칠 칸만 열리고, 값을 고친 뒤 [변경 내용 확인]을 누르면 같은 확인 표가 나옵니다.',
    ruleConfirm: '[확정] 또는 [취소] 누르기',
    ruleConfirmTip: (days, day) => `확정하면 ${days}일 동안 바꿀 수 없습니다(${day}부터 다시 바꿀 수 있음). 그 뒤에는 바꾸는 이유를 10자 이상 적어야 합니다. 잠금은 이 브라우저에만 저장됩니다. [취소]해도 이 단계는 끝납니다.`,
    todayDemo: h => `'${h}' 카드 보기`,
    todayDemoTip: '홈의 이 카드가 매일 볼 곳입니다. 방금 정한 규칙(확정 전이면 기본 규칙)으로 예시 자산을 계산했습니다. 할 일 금액은 내가 정한 규칙으로 계산한 결과이며, 실행 여부는 내가 정합니다. ✕ 줄은 오늘 어긴 규칙입니다.',
    todayPaper: h => `'${h}' 카드 보기`,
    todayPaperTip: '홈의 이 카드가 매일 볼 곳입니다. 지금은 팀 모의계좌가 팀 규칙을 지켰는지 보여 줍니다. ✕ 줄은 오늘 어긴 규칙입니다. 숫자는 홈 계좌 띠에 적힌 기준 날짜의 것입니다. 내 규칙으로 보려면 ①을 먼저 합니다.',
    todayNone: '[예시 자산으로 둘러보기] 누르기',
    todayNoneTip: "홈의 '규칙 … 지킴' 카드는 보유 종목이 있어야 보입니다. 홈의 이 버튼을 누르면 나옵니다.",
    teamTab: '[팀 모의계좌] 탭 누르기',
    team: "'규칙 지킴·어김' 줄 보기",
    teamTip: '팀이 정한 규칙으로 굴린 한국투자증권 모의투자 계좌의 기록입니다. 하루 손실 한도를 넘은 날 · 30일 매매 횟수 · 규칙 변경이 날마다 쌓입니다. 팀 계획을 따라 하라는 뜻이 아닙니다. 20거래일이 지나기 전에는 판단하기 이릅니다.',
    // 공개된 팀 기록이 오래됐을 때만 ③ ⓘ 끝에 붙인다(본문 꼬리 문장은 뺐다 · 보완 2).
    teamStaleTip: day => ` 공개된 팀 기록은 ${day} 기준입니다.`
  }
};

// ── 날짜(한국 시간). 화면 날짜는 'MM-DD', 같은 해가 아니면 'YYYY-MM-DD'(core-ui.js md 와 같은 규칙).
const kday = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
export function mdOf(ms, now = Date.now()) { if (!Number.isFinite(ms)) return ''; const d = kday(ms); return d.slice(0, 4) === kday(now).slice(0, 4) ? d.slice(5) : d; }
/** 지금 확정하면 다시 바꿀 수 있는 날. core-ui.js showConfirm 의 '부터' 날짜, rule-presets changeGate 의 kstDay(until)와 같은 식이다. */
export const unlockDay = (now = Date.now()) => mdOf(now + RULE_LOCK_DAYS * 864e5, now);
/** 팀 기록이 멈춰 있는가: 실시간(live)이면 아니다. asOf 가 STALE_HOURS 보다 오래되면 그렇다. */
export function isStale(asOf, now = Date.now(), live = false) {
  if (live) return false; const t = Date.parse(asOf || ''); if (!Number.isFinite(t)) return false;
  return now - t > STALE_HOURS * 3600e3;
}
/** '봤다': 카드의 절반 이상이 보이거나, 화면보다 긴 카드는 보이는 높이가 화면의 절반 이상. */
export function seen(ratio, visH = 0, vh = 0) { return ratio >= 0.5 || (vh > 0 && visH >= vh * 0.5); }

// ── 저장 상태 teamQuantTour:v1 (브라우저 단위 · 서버로 보내지 않음)
export function fresh() {
  return { v: 1, copyVer: COPY_VER, view: 'open', started: false, shown: 0, rule: null, today: 0, team: 0, m: { firstSeen: 0, startedAt: 0, todayAcct: null, ended: null, fallbacks: [] } };
}
const num = v => (Number.isFinite(v) && v >= 0 ? v : 0);
/** 저장 글 → 상태. 깨진 JSON · 다른 v · 모양이 다른 값은 처음 상태로 읽는다. */
export function parse(raw) {
  let o = null; try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return fresh(); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return fresh();
  const m = o.m && typeof o.m === 'object' ? o.m : {}, e = m.ended && typeof m.ended === 'object' ? m.ended : null;
  return {
    v: 1, copyVer: typeof o.copyVer === 'string' ? o.copyVer : '', view: VIEWS.includes(o.view) ? o.view : 'open', started: o.started === true, shown: num(o.shown),
    rule: RULE_DONE.includes(o.rule) ? o.rule : null, today: num(o.today), team: num(o.team),
    m: { firstSeen: num(m.firstSeen), startedAt: num(m.startedAt), todayAcct: ACCTS.includes(m.todayAcct) ? m.todayAcct : null,
      ended: e ? { how: String(e.how || ''), at: num(e.at), ...(e.next !== undefined ? { next: STEPS.includes(e.next) ? e.next : null } : {}) } : null,
      fallbacks: Array.isArray(m.fallbacks) ? [...new Set(m.fallbacks.filter(x => STEPS.includes(x)))] : [] }
  };
}
/** 상태 전이(새 객체를 돌려준다). ①은 '확정함'이 '확인만 함'보다 앞선다. 'skipped'는 다른 결과를 덮지 않는다. */
export function reduce(s, ev = {}) {
  const n = { ...(s || fresh()) }; n.m = { ...(n.m || fresh().m) }; n.m.fallbacks = [...(n.m.fallbacks || [])];
  const at = Number.isFinite(ev.at) ? ev.at : Date.now();
  const fb = step => { if (STEPS.includes(step) && !n.m.fallbacks.includes(step)) n.m.fallbacks.push(step); };
  switch (ev.type) {
    case 'preview': if (n.rule !== 'confirmed') n.rule = 'previewed'; break;
    case 'confirm': n.rule = 'confirmed'; break;
    case 'skip': if (!n.rule) n.rule = 'skipped'; break;
    case 'today': if (!n.today) { n.today = at; n.m.todayAcct = ACCTS.includes(ev.acct) ? ev.acct : null; } break;
    case 'team': if (!n.team) { n.team = at; if (ev.fallback) fb('team'); } break;
    case 'start': n.started = true; n.view = 'open'; if (!n.m.startedAt) n.m.startedAt = at; break;
    case 'later': n.view = 'mini'; break;
    case 'expand': n.view = 'open'; n.shown = 0; break;
    case 'off': n.view = 'off'; n.m.ended = { how: 'off', at, next: STEPS.includes(ev.next) ? ev.next : null }; break;
    case 'done': n.view = 'done'; n.m.ended = { how: ev.how === 'left' ? 'left' : 'done', at }; break;
    case 'reopen':
      Object.assign(n, { view: 'open', copyVer: COPY_VER, started: false, shown: 0, rule: n.rule === 'confirmed' ? 'confirmed' : null, today: 0, team: 0 });
      Object.assign(n.m, { startedAt: 0, todayAcct: null, ended: null, fallbacks: [] }); break;
    case 'shown': n.shown = (n.shown || 0) + 1; if (!n.m.firstSeen) n.m.firstSeen = at; break;
    case 'fallback': fb(ev.step); break;
    default: break;
  }
  return n;
}
/** 진행: 끝난 단계 수 · 다음 단계(①→②→③ 중 아직 안 끝난 가장 앞) · 셋 다 끝났는가. ①의 'skipped'는 넘어간 것으로 친다. */
export function progress(s) {
  const steps = { rule: RULE_DONE.includes(s?.rule), today: s?.today > 0, team: s?.team > 0 };
  const n = STEPS.filter(k => steps[k]).length;
  return { n, done: n === STEPS.length, next: STEPS.find(k => !steps[k]) || null, steps };
}
/** 끝 카드를 보고 떠난 사람: 다음 방문 때 'done'으로 바꾼다(아무것도 띄우지 않음). */
export function settle(s) { return progress(s).done && (s.view === 'open' || s.view === 'mini') ? reduce(s, { type: 'done', how: 'left' }) : s; }

/**
 * 첫 화면에서 저절로 띄울지. 반환 'open' | 'mini' | null.
 * env: { appVisible, loginVisible, consentOpen, dialogOpen, account, host, sinceAppMs, forced }
 * - 앱이 보이고 로그인 화면이 숨어 있어야 한다. 동의·고지 창이나 열린 dialog 가 있으면 기다린다(null).
 * - 실계좌(real)와 PC 화면(127.0.0.1)에는 띄우지 않는다(PC 화면은 ?tour=1 일 때만).
 * - 계좌 판정(paper·demo)이 끝났거나 앱이 보인 뒤 ACCOUNT_WAIT_MS 가 지나야 한다.
 * - 'off'·'done'은 문구 버전이 바뀌었거나 ?tour=1 일 때만 다시 연다. 아무것도 누르지 않고 3번 본 카드는 한 줄로 접는다.
 */
export function shouldAutoShow(s, env = {}) {
  if (!env.appVisible || env.loginVisible) return null;
  if (env.consentOpen || env.dialogOpen) return null;
  if (env.account === 'real') return null;
  if (env.host === '127.0.0.1' && !env.forced) return null;
  if (!(env.account === 'paper' || env.account === 'demo' || (env.sinceAppMs || 0) >= ACCOUNT_WAIT_MS)) return null;
  if (env.forced || !s) return 'open';
  if (s.view === 'off' || s.view === 'done') return s.copyVer !== COPY_VER ? 'open' : null;
  if (s.view === 'mini') return 'mini';
  return !s.started && s.shown >= 3 ? 'mini' : 'open';
}

/** 단계가 열리는 화면. ①은 계좌가 없으면(none) 홈의 [예시 자산으로 둘러보기]부터. */
export const stepView = (step, account) => (step === 'team' ? 'paper' : step === 'today' ? 'home' : account === 'none' ? 'home' : 'rules');

/**
 * 아래 띠 한 장. ctx: { s, account, view(지금 화면), confirmOpen, demoFailed, paperTab('mine'|'team'), stale, staleDay, hero, now, prefer }
 * 반환 { key, step, view(그 단계 화면), target(윤곽), scrollTo, focus, title, body, tip, move(이동 버튼 이름|null), checklist, skip } 또는 null(끝났거나 실계좌).
 * 띠는 아직 안 끝난 가장 앞 단계를 가리킨다. 다만 [하러 가기]로 고른 단계(prefer)의 화면에 있으면 그 단계를 보인다.
 */
export function bandFor(ctx = {}) {
  const s = ctx.s || fresh(), p = progress(s), acct = ctx.account || 'none', here = ctx.view || null, B = TOUR_COPY.band;
  if (p.done || acct === 'real') return null;
  // cta: 띠 본문이 누르라고 하는 버튼. 도착했을 때 띠 밑에 깔리면 그만큼 더 굴린다(390px).
  // reveal: 사용자가 연 화면(확인 표)에서도 띠가 처음 바뀔 때 한 번, 그 버튼이 띠 위로 오게 조금 굴린다.
  const mk = (key, step, view, target, body, tip = '', extra = {}) => ({
    key, step, view, target, scrollTo: extra.scrollTo || target, focus: extra.focus || null, cta: extra.cta || null, reveal: !!extra.reveal, title: TOUR_COPY.steps[step].name, body, tip,
    move: view && view !== here ? B.move[view] : null, checklist: here !== 'home', skip: !!extra.skip
  });
  // 계좌가 없을 때(none)는 홈 연결 카드 전체가 아니라 [예시 자산으로 둘러보기] 버튼만 가리킨다(연결 번호·PC 프로그램 안내는 튜토리얼이 약속하지 않음).
  const NONE_TARGET = '#hm-connect [data-demo-start]';
  // ①-다: 확인 표가 열려 있는 동안(①이 이미 '확인만 함'이어도). 잠금 날짜는 확인 표의 '잠금' 줄과 이 띠의 ⓘ 에 있다.
  if (ctx.confirmOpen && acct === 'demo' && s.rule !== 'confirmed') return mk('rule-confirm', 'rule', 'rules', '#rl-confirm', B.ruleConfirm, B.ruleConfirmTip(RULE_LOCK_DAYS, unlockDay(ctx.now ?? Date.now())), { cta: '#rl-cancel', reveal: true });
  let next = p.next;
  if (ctx.prefer && STEPS.includes(ctx.prefer) && !p.steps[ctx.prefer] && here === stepView(ctx.prefer, acct)) next = ctx.prefer;
  if (next === 'rule') {
    if (ctx.demoFailed && acct !== 'demo') return mk('rule-fail', 'rule', null, null, B.ruleFail, B.ruleFailTip, { skip: true });
    if (acct === 'paper') return mk('rule-paper', 'rule', 'rules', '#rl-now', B.rulePaper, B.rulePaperTip, { cta: '#rl-now [data-demo-start]' });
    if (acct === 'demo') return mk('rule-demo', 'rule', 'rules', '#rl-now', B.ruleDemo, B.ruleDemoTip, { cta: '#rl-confirm-now' });
    return mk('rule-none', 'rule', 'home', NONE_TARGET, B.ruleNone, B.ruleNoneTip);
  }
  if (next === 'today') {
    const h = typeof ctx.hero === 'string' && ctx.hero.includes(TOUR_COPY.heroMark) ? ctx.hero.trim() : TOUR_COPY.heroFallback;
    if (acct === 'demo') return mk('today-demo', 'today', 'home', '#core-today', B.todayDemo(h), B.todayDemoTip);
    if (acct === 'paper') return mk('today-paper', 'today', 'home', '#core-today', B.todayPaper(h), B.todayPaperTip);
    return mk('today-none', 'today', 'home', NONE_TARGET, B.todayNone, B.todayNoneTip);
  }
  // ③: 공개된 팀 기록이 오래됐으면 그 날짜를 ⓘ 끝에 붙인다(본문은 한 줄 그대로 · 2026-11-27 보완 2).
  const tip = B.teamTip + (ctx.stale && ctx.staleDay ? B.teamStaleTip(ctx.staleDay) : '');
  if (ctx.paperTab === 'mine') return mk('team-tab', 'team', 'paper', '.pp-tabs', B.teamTab, tip, { focus: '[data-pp-tab-btn="team"]' });
  return mk('team', 'team', 'paper', '#pp-kis', B.team, tip, { scrollTo: '.pp-adh' });
}
