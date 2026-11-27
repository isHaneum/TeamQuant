// 첫 방문 안내 '투자 규칙 확인 도구'(결정 71 · 2026-11-27): 홈 맨 위 카드 하나(체크리스트) + 시작한 뒤 화면 아래 띠.
// - 2026-11-27 보완 2(사용자 지시): 카드는 제목 · 진행 숫자 · 단계 이름 · 버튼만. 설명은 띠·끝 카드의 ⓘ 안에만.
//   LEGAL 5.1(투자 권유 아님 · 고지 전문)은 머리글 [투자 권유 아님] 배지(consent-ui.js)가 맡아 카드의 [알아 둘 것] 버튼은 뺐다.
// - 방문자가 직접 누른다. 이 모듈이 대신 하는 일은 화면 이동(data-view 버튼) 한 가지뿐이다.
//   계좌·규칙·동의·탭 상태는 바꾸지 않는다(예시 자산 시작·확정·탭 버튼은 누르지 않는다).
// - 화면 문구는 lib/tour-state.js 의 TOUR_COPY 에만 있다. 이 파일에는 한글 문자열을 두지 않는다(주석은 예외 · test/tutorial.test.js).
// - 기록은 이 브라우저의 teamQuantTour:v1(못 쓰면 sessionStorage teamQuantTourSeen, 그것도 안 되면 메모리)에만. 서버로 보내지 않는다.
// - 색·간격은 tokens.css 토큰만(tutorial.css). 덮개·좌표 말풍선 없음: 대상 카드에 윤곽선만 그린다.
import { TOUR_COPY as T, COPY_VER, STORE_KEY, SESSION_KEY, parse, reduce, progress, settle, shouldAutoShow, bandFor, stepView, isStale, seen, mdOf } from '/lib/tour-state.js';
import { tip } from '/tooltip-ui.js';
import { mockCached } from '/paper-account-ui.js';

const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/tutorial.css?v=tour-20261127b'; document.head.append(css);

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const viewNow = () => document.querySelector('.view.active')?.dataset.page || '';
const account = () => document.body.dataset.account || 'none';
const blockedByDialog = () => !!document.querySelector('.tq-consent, dialog[open]');
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// 화면 이동: 위쪽 메뉴와 같은 숨은 nav 버튼을 누른다(help-ui.js navigate 와 같은 방식).
const go = view => document.querySelector(`[data-view="${view}"]`)?.click();
const FORCED = (() => { try { return new URLSearchParams(location.search).get('tour') === '1'; } catch { return false; } })();

// ── 저장: localStorage → (막혀 있으면) sessionStorage → 메모리. 모든 읽기·쓰기는 try/catch.
const store = { local: true };
function readSaved() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { store.local = false; }
  if (!store.local) { try { raw = sessionStorage.getItem(SESSION_KEY); } catch { raw = null; } }
  return raw;
}
function persist() {
  const text = JSON.stringify(S);
  if (store.local) { try { localStorage.setItem(STORE_KEY, text); return; } catch { store.local = false; } }
  try { sessionStorage.setItem(SESSION_KEY, text); } catch { /* 메모리에만 둔다 */ }
}
let S = settle(parse(readSaved()));
const update = ev => { S = reduce(S, ev); persist(); };

// 이 탭 안의 실행 상태(저장하지 않음)
const R = { decided: false, on: false, appAt: 0, prefer: null, demoFailed: false, demoTimer: 0, escHidden: false, nav: null, current: null, cardHtml: '', bandHtml: '', locKey: '', target: null, scrollEl: null, locateRun: 0, since: {}, timer: 0, paperMeta: null };

// ① '확정함' 미리 표시: 예시 자산 규칙 저장값(core-ui.js profileKey 의 ':demo')에 확정 기록이 있으면(읽기만).
function presetRule() {
  if (S.rule === 'confirmed') return;
  try {
    const user = sessionStorage.getItem('teamQuantSession') || 'guest';
    const saved = JSON.parse(localStorage.getItem(`teamQuantRules:${user}:demo`) || 'null');
    if (saved?.confirmedAt) S = reduce(S, { type: 'confirm' });
  } catch { /* 읽지 못하면 그대로 */ }
}

// ── 화면에서 읽는 값
function staleInfo() {
  const pub = mockCached(), asOf = pub?.asOf || R.paperMeta?.asOf || null, live = pub ? !!pub.live : !!R.paperMeta?.live, now = Date.now();
  return { stale: isStale(asOf, now, live), day: asOf ? mdOf(Date.parse(asOf), now) : '' };
}
function heroText() {
  const h = $('#core-today .ct-hero h2'), first = h?.firstChild;
  return first && first.nodeType === 3 ? first.textContent.trim() : '';
}
function ctx() {
  const conf = document.getElementById('rl-confirm'), page = document.getElementById('core-paper'), st = staleInfo(), view = viewNow();
  return { s: S, account: account(), view, confirmOpen: view === 'rules' && !!conf && !conf.hidden, demoFailed: R.demoFailed, paperTab: page?.dataset.ppTab || null, stale: st.stale, staleDay: st.day, hero: heroText(), now: Date.now(), prefer: R.prefer };
}
const hasSize = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
function visible(el) {
  if (!hasSize(el)) return false;
  const r = el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
  const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  return seen(visH / r.height, visH, vh);
}
const active = () => R.on && account() !== 'real' && (S.view === 'open' || S.view === 'mini');

// ── 시작 카드 (#report 의 첫 자식)
// 단계 줄: 이름 + [하러 가기](끝난 단계는 결과 낱말). 설명 글은 두지 않는다(보완 2).
function stepRow(p, key) {
  const done = p.steps[key], st = T.steps[key], state = key === 'rule' ? (T.ruleDone[S.rule] || T.stepDone) : T.stepDone;
  return `<li class="tq-tour-step${done ? ' is-done' : ''}">`
    + `<span class="tq-tour-step-text">${done ? '<span class="tq-tour-mark" aria-hidden="true">✓</span>' : ''}<b>${esc(st.name)}</b><span class="tq-vh"> · ${esc(done ? T.vh.done : T.vh.left)}</span></span>`
    + (done ? `<span class="tq-tour-state">${esc(state)}</span>` : `<button type="button" class="secondary" data-tq-act="go" data-tq-step="${key}">${esc(T.btn.go)}</button>`) + '</li>';
}
// 펼친 카드: 제목 '투자 규칙 확인 도구' 바로 옆에 진행 숫자(0/3), 그 밑은 단계 셋과 버튼뿐이다.
function openHtml(p) {
  return `<div class="tq-tour-head"><h2 id="tq-tour-title" tabindex="-1">${esc(T.title)}</h2><span class="tq-tour-n">${esc(T.listTitle(p.n))}</span></div>`
    + `<ol class="tq-tour-steps">${['rule', 'today', 'team'].map(k => stepRow(p, k)).join('')}</ol>`
    // 2026-11-27: [시작]은 ① [하러 가기]와 같은 일이라 뺐다(버튼 수 줄임 · 'start' 처리는 다시 보기 호환으로 남김).
    + `<div class="tq-tour-actions"><button type="button" class="secondary" data-tq-act="later">${esc(T.btn.later)}</button><button type="button" class="text-button" data-tq-act="off">${esc(T.btn.off)}</button></div>`;
}
const miniHtml = p => `<p id="tq-tour-title" class="tq-tour-mini-text">${esc(T.mini(p.n))}</p><button type="button" class="secondary" data-tq-act="expand">${esc(T.btn.expand)}</button>`;
// 끝 카드: 제목 + ⓘ + [닫기]. 결과 요약·예시 끄는 법·다시 보는 곳은 ⓘ 안에만.
function endHtml() {
  const t = [T.end.summary(T.ruleDone[S.rule] || T.stepDone), account() === 'demo' ? T.end.demo : '', T.end.again].filter(Boolean).join('\n');
  return `<div class="tq-tour-head"><h2 id="tq-tour-title" tabindex="-1">${esc(T.end.title)}</h2>${tip(t)}</div>`
    + `<div class="tq-tour-actions"><button type="button" class="primary" data-tq-act="close">${esc(T.btn.close)}</button></div>`;
}
function renderCard() {
  let card = document.getElementById('tq-tour');
  if (!active()) { if (card) card.hidden = true; return; }
  const host = document.getElementById('report'); if (!host) return; // 홈 뼈대가 생기면(teamquant:page · asset-snapshot) 다시 그린다
  if (!card) { card = document.createElement('section'); card.id = 'tq-tour'; card.className = 'tq-tour'; card.setAttribute('aria-labelledby', 'tq-tour-title'); card.addEventListener('click', onCardClick); }
  if (host.firstElementChild !== card) host.prepend(card);
  const p = progress(S), mode = p.done ? 'end' : S.view === 'mini' ? 'mini' : 'open', html = mode === 'end' ? endHtml() : mode === 'mini' ? miniHtml(p) : openHtml(p);
  card.classList.toggle('tq-tour-mini', mode === 'mini'); card.classList.toggle('tq-tour-end', mode === 'end');
  // 다시 그려도 포커스를 잃지 않는다: 제목(다시 보기·[체크리스트]로 온 경우)이나 같은 버튼으로 돌려준다(없으면 제목).
  if (R.cardHtml !== html || !card.innerHTML) {
    const a = card.contains(document.activeElement) ? document.activeElement : null;
    const sel = !a ? null : a.id === 'tq-tour-title' ? '#tq-tour-title' : a.dataset?.tqAct ? `[data-tq-act="${a.dataset.tqAct}"]${a.dataset.tqStep ? `[data-tq-step="${a.dataset.tqStep}"]` : ''}` : '#tq-tour-title';
    card.innerHTML = html; R.cardHtml = html;
    if (sel) (card.querySelector(sel) || card.querySelector('#tq-tour-title'))?.focus({ preventScroll: true });
  }
  card.hidden = false;
}

// ── 아래 띠 (시작한 뒤 · 끝나기 전)
function ensureBand() {
  let band = document.getElementById('tq-tour-band'); if (band) return band;
  band = document.createElement('div'); band.id = 'tq-tour-band'; band.setAttribute('role', 'region'); band.setAttribute('aria-label', T.bandLabel); band.hidden = true;
  band.innerHTML = '<p class="tq-vh" aria-live="polite" id="tq-tour-live"></p><div class="tq-tour-band-in"></div>';
  band.addEventListener('click', onBandClick); band.addEventListener('keydown', onBandKey);
  document.body.append(band); return band;
}
function bandHtml(b) {
  const btn = (act, label, cls = 'secondary') => `<button type="button" class="${cls}" data-tq-act="${act}">${esc(label)}</button>`;
  return `<div class="tq-tour-band-text"><p class="tq-tour-band-title"><b>${esc(b.title)}</b>${b.tip ? ' ' + tip(b.tip) : ''}</p><p class="tq-tour-band-body">${esc(b.body)}</p></div>`
    + `<div class="tq-tour-band-actions">${b.skip ? btn('skip', T.btn.skipRule, 'primary') : ''}${b.move ? btn('move', b.move, 'primary') : ''}${b.checklist ? btn('checklist', T.btn.checklist) : ''}${btn('off', T.btn.off, 'text-button')}</div>`;
}
function measure() {
  const band = document.getElementById('tq-tour-band'), top = $('.topbar');
  document.documentElement.style.setProperty('--tq-tour-top', `${(top?.offsetHeight || 60) + 16}px`);
  if (band && !band.hidden) document.body.style.setProperty('--tq-tour-band-h', `${band.offsetHeight}px`);
}
function renderBand() {
  const band = ensureBand(), p = progress(S);
  const want = active() && S.view === 'open' && S.started && !p.done && !blockedByDialog() && !R.escHidden;
  const b = want ? bandFor(ctx()) : null;
  if (!b) { if (!band.hidden || R.current) { band.hidden = true; document.body.classList.remove('tq-tour-band'); R.current = null; R.locKey = ''; clearTarget(); } return; }
  const html = bandHtml(b), wasHidden = band.hidden, fresh = html !== R.bandHtml;
  if (fresh) {
    const had = band.contains(document.activeElement) ? document.activeElement.dataset?.tqAct : null;
    band.lastElementChild.innerHTML = html; R.bandHtml = html; if (had) band.querySelector(`[data-tq-act="${had}"]`)?.focus();
  }
  band.hidden = false; document.body.classList.add('tq-tour-band');
  if (wasHidden || fresh) measure();
  R.current = b;
  // 단계·대상·화면이 바뀔 때만 다시 찾는다(찾는 중인 것을 250ms 마다 새로 시작하지 않는다).
  const key = `${b.key}|${b.target}|${viewNow()}`;
  if (key !== R.locKey || (R.target && !R.target.isConnected)) {
    const changed = key !== R.locKey; R.locKey = key; locate(null);
    if (changed && b.reveal) afterScroll(() => reveal(b.key));
  }
}
// 사용자가 연 확인 표처럼 튜토리얼이 굴리지 않은 화면에서, 띠가 누르라고 하는 버튼이 띠 밑에 깔리면 한 번만 조금 굴린다.
// 표 위쪽이 머리글 밑으로 들어가지 않는 만큼만 굴리고, 표가 화면보다 길면 버튼 쪽을 보인다(버튼 위쪽은 머리글 아래).
function reveal(key) {
  const b = R.current; if (!b || b.key !== key || !b.cta) return;
  const cta = document.querySelector(b.cta), band = document.getElementById('tq-tour-band'); if (!hasSize(cta) || !band || band.hidden) return;
  const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tq-tour-top')) || 76;
  const c = cta.getBoundingClientRect(), limit = band.getBoundingClientRect().top - 8;
  if (c.bottom <= limit || c.top >= window.innerHeight + 400) return; // 이미 보이거나, 화면에서 너무 멀면(사용자가 다른 곳을 보는 중) 그대로 둔다
  const dy = Math.min(c.bottom - limit, c.top - margin);
  if (dy > 0) window.scrollBy({ top: dy, behavior: reduced() ? 'instant' : 'auto' });
}
function clearTarget() { R.locateRun++; R.target?.classList.remove('tq-tour-target'); R.scrollEl?.classList.remove('tq-tour-scroll'); R.target = null; R.scrollEl = null; }
// 대상 찾기: 150ms 간격으로 최대 3초. 크기가 0이 아닌 요소에 윤곽선 · [하러 가기]·[이동]으로 왔을 때만 스크롤하고 포커스를 옮긴다.
// 그 단계의 화면이 아니면 찾지 않는다(윤곽선은 그 화면에서만 · 못 찾은 기록 fallbacks 도 그 화면에서 3초 지났을 때만).
function locate(nav) {
  const run = ++R.locateRun, t0 = Date.now();
  const step = () => {
    if (run !== R.locateRun) return;
    const b = R.current;
    if (!b || !b.target || (b.view && viewNow() !== b.view)) { R.target?.classList.remove('tq-tour-target'); R.scrollEl?.classList.remove('tq-tour-scroll'); R.target = null; R.scrollEl = null; return; }
    const el = document.querySelector(b.target);
    if (hasSize(el)) {
      if (R.target !== el) { R.target?.classList.remove('tq-tour-target'); el.classList.add('tq-tour-target'); R.target = el; }
      if (nav) {
        const sc = b.scrollTo && b.scrollTo !== b.target ? document.querySelector(b.scrollTo) : null, to = hasSize(sc) ? sc : el;
        // 굴릴 줄(예: 팀 기록 줄 .pp-adh)이 아직 그려지지 않았으면 3초 안에서 더 기다린다(대상 카드 맨 위로만 굴리면 390px에서 그 줄이 띠 밑에 남는다).
        if (sc !== to && b.scrollTo && b.scrollTo !== b.target && Date.now() - t0 < 3000) { setTimeout(step, 150); return; }
        R.scrollEl?.classList.remove('tq-tour-scroll'); if (to !== el) { to.classList.add('tq-tour-scroll'); R.scrollEl = to; }
        scrollToTarget(b, to);
        if (!nav.noFocus) focusTarget(b, el);
      }
      return;
    }
    if (Date.now() - t0 >= 3000) { if (!S.m.fallbacks.includes(b.step)) update({ type: 'fallback', step: b.step }); return; }
    setTimeout(step, 150);
  };
  step();
}
// 대상 위쪽을 머리글 바로 아래에 둔다(scroll-margin 과 같은 값). 띠가 누르라고 하는 버튼(cta)이 띠 밑에 깔리면
// 그 버튼이 띠 위로 올라올 만큼 더 굴린다. 버튼 위쪽이 머리글 밑으로 들어가지는 않게 한다. 한 번만 굴린다(html 이 smooth 라 굴린 뒤에 재지 않음).
function scrollToTarget(b, to) {
  const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tq-tour-top')) || 76;
  let y = to.getBoundingClientRect().top + window.scrollY - margin;
  const cta = b.cta ? document.querySelector(b.cta) : null, band = document.getElementById('tq-tour-band');
  if (hasSize(cta) && band && !band.hidden) {
    const c = cta.getBoundingClientRect(), limit = band.getBoundingClientRect().top - 8;
    const bottom = c.bottom + window.scrollY - y, top = c.top + window.scrollY - y;
    if (bottom > limit) y += Math.max(0, Math.min(bottom - limit, top - margin));
  }
  window.scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'instant' : 'auto' });
}
// 포커스 옮기기: 포커스를 받지 못하는 요소는 잠깐 tabindex=-1 을 준다(blur 되면 뺀다).
function focusEl(f, scroll = false) {
  if (!f || !f.isConnected) return false;
  if (!f.matches('button, a[href], input, select, textarea, [tabindex]')) { f.setAttribute('tabindex', '-1'); f.addEventListener('blur', () => f.removeAttribute('tabindex'), { once: true }); }
  try { f.focus({ preventScroll: !scroll }); } catch { return false; /* 포커스를 못 옮겨도 윤곽선은 남는다 */ }
  return document.activeElement === f;
}
function focusTarget(b, el) { focusEl((b.focus && document.querySelector(b.focus)) || el); }
// 카드·띠가 사라질 때 포커스가 BODY 로 빠지지 않게: 홈이면 규칙 점검 카드 제목, 아니면 지금 화면의 제목.
function focusPage(scroll = false) {
  const h = viewNow() === 'home' ? $('#core-today h2') : null;
  return focusEl(hasSize(h) ? h : document.querySelector('.view.active .page-head h1') || document.querySelector('.view.active h1'), scroll);
}
const focusInTour = () => !!document.activeElement?.closest?.('#tq-tour, #tq-tour-band');
function announce() {
  const live = document.getElementById('tq-tour-live'), b = R.current, v = viewNow(); if (!live || !b || !T.views[v]) return;
  const text = `${T.views[v]} · ${b.title}`; live.textContent = ''; setTimeout(() => { live.textContent = text; }, 60);
}

// ── 다시 보기: 이용 안내 '처음 사용한다면' 칸의 안내 묶음 바로 앞(이 모듈을 못 불러오면 버튼도 생기지 않는다)
function renderReplay() {
  const grid = $('#help .tutorial-grid'); if (!grid) return;
  let b = document.getElementById('tq-tour-replay');
  if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'tq-tour-replay'; b.className = 'secondary tq-tour-replay'; b.addEventListener('click', replay); grid.before(b); }
  const p = progress(S), text = S.started && !p.done ? `${T.replay} ${T.replayPrev(p.n)}` : T.replay;
  if (b.textContent !== text) b.textContent = text;
}
function replay() {
  update({ type: 'reopen' }); presetRule(); persist();
  R.on = true; R.decided = true; R.prefer = null; R.escHidden = false; R.demoFailed = false;
  R.nav = { card: true }; render(); go('home'); ensureTimer();
}

function render() { renderCard(); renderBand(); renderReplay(); ensureTimer(); }

// ── 단계 이동
function navigate(view, extra = {}) {
  if (!view) return;
  R.nav = { view, ...extra };
  if (viewNow() === view) { onPage(); return; }
  go(view);
}
function onCardClick(e) {
  const b = e.target.closest?.('[data-tq-act]'); if (!b) return;
  const act = b.dataset.tqAct, p = progress(S);
  if (act === 'start') { update({ type: 'start' }); R.prefer = null; render(); navigate(p.next ? stepView(p.next, account()) : null, { target: true }); return; }
  if (act === 'go') { const step = b.dataset.tqStep; update({ type: 'start' }); R.prefer = step; render(); navigate(stepView(step, account()), { target: true }); return; }
  if (act === 'later') { update({ type: 'later' }); render(); $('#tq-tour [data-tq-act="expand"]')?.focus(); return; }
  if (act === 'expand') { update({ type: 'expand' }); render(); $('#tq-tour-title')?.focus(); return; }
  if (act === 'off') { stop(); return; }
  if (act === 'close') { update({ type: 'done' }); render(); focusPage(true); }
}
function stop() { const had = focusInTour(); update({ type: 'off', next: progress(S).next }); R.prefer = null; render(); if (had) focusPage(); }
function onBandClick(e) {
  const b = e.target.closest?.('[data-tq-act]'); if (!b) return;
  const act = b.dataset.tqAct, cur = R.current;
  if (act === 'move' && cur?.view) { R.prefer = cur.step; navigate(cur.view, { target: true }); return; }
  if (act === 'checklist') { R.nav = { card: true }; if (viewNow() === 'home') onPage(); else go('home'); return; }
  if (act === 'skip') { update({ type: 'skip' }); R.demoFailed = false; render(); return; }
  if (act === 'off') stop();
}
function onBandKey(e) {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.tip[aria-expanded="true"]')) return; // ⓘ 말풍선이 열려 있으면 그것만 닫힌다(tooltip-ui.js)
  const t = R.target; R.escHidden = true; renderBand();
  // 띠와 함께 포커스가 사라지지 않게: 윤곽을 그렸던 대상 카드로, 없으면 지금 화면의 제목으로.
  if (!(hasSize(t) && focusEl(t))) focusPage();
}
// 화면이 바뀌면: 띠를 다시 고르고(Esc 로 숨긴 것도 다시 보임) · showPage 의 부드러운 스크롤이 끝난 뒤 대상을 찾는다.
function afterScroll(fn) {
  let done = false; const run = () => { if (done) return; done = true; window.removeEventListener('scrollend', run); fn(); };
  if ('onscrollend' in window) window.addEventListener('scrollend', run, { once: true });
  setTimeout(run, 500);
}
function onPage() {
  R.escHidden = false;
  if (!R.decided) tryShow();
  render(); announce();
  const nav = R.nav; R.nav = null; if (!nav) return;
  afterScroll(() => {
    if (nav.card) { const t = $('#tq-tour-title'); if (t) { t.scrollIntoView({ block: 'start', behavior: reduced() ? 'instant' : 'auto' }); t.focus({ preventScroll: true }); } return; }
    if (nav.target && R.current) locate(nav);
  });
}

// ── 저절로 띄우기 · 단계 판정(사용자가 직접 한 것만)
function env() {
  const app = $('#app'), login = $('#login-view'), appVisible = !!app && !app.hidden;
  if (appVisible && !R.appAt) R.appAt = Date.now();
  return { appVisible, loginVisible: !!login && !login.hidden, consentOpen: !!$('.tq-consent'), dialogOpen: !!$('dialog[open]'), account: account(), host: location.hostname, sinceAppMs: R.appAt ? Date.now() - R.appAt : 0, forced: FORCED };
}
function tryShow() {
  if (R.decided) return;
  const e = env(), mode = shouldAutoShow(S, e);
  if (mode) {
    R.decided = true; R.on = true;
    if (FORCED || ((S.view === 'off' || S.view === 'done') && mode === 'open')) S = reduce(S, { type: 'reopen' });
    else if (mode === 'mini' && S.view !== 'mini') S = reduce(S, { type: 'later' });
    presetRule(); update({ type: 'shown' }); render(); return;
  }
  // 끈 사람·끝낸 사람(문구 버전 같음)은 기다리지 않는다.
  if (!FORCED && (S.view === 'off' || S.view === 'done') && S.copyVer === COPY_VER) { R.decided = true; render(); return; }
  if (R.appAt && Date.now() - R.appAt > 30000) { R.decided = true; render(); }
}
// 보는 시간 판정: 같은 조건이 1초(팀 기록 줄이 없으면 3초) 이어져야 센다. 고지·동의 창이 떠 있는 동안은 세지 않는다.
function hold(key, ok, ms, fn) {
  if (!ok) { R.since[key] = 0; return false; }
  if (!R.since[key]) { R.since[key] = Date.now(); return false; }
  if (Date.now() - R.since[key] < ms) return false;
  R.since[key] = 0; fn(); return true;
}
function tick() {
  if (!R.decided) { tryShow(); return; }
  if (!active() || !S.started || progress(S).done) return;
  if (blockedByDialog()) { R.since = {}; renderBand(); return; }
  const v = viewNow(), kind = account(); let changed = false;
  if (!S.today) {
    const card = document.getElementById('core-today'), h = card?.querySelector('.ct-hero h2');
    const ok = v === 'home' && !!card && !card.hidden && !!h && h.textContent.includes(T.heroMark) && visible(card);
    changed = hold('today', ok, 1000, () => update({ type: 'today', acct: kind })) || changed;
  }
  if (!S.team) {
    const page = document.getElementById('core-paper'), adh = page?.querySelector('.pp-adh'), kis = document.getElementById('pp-kis');
    const onTeam = v === 'paper' && page?.dataset.ppTab === 'team';
    if (adh) changed = hold('team', onTeam && visible(adh), 1000, () => update({ type: 'team' })) || changed;
    else changed = hold('team', onTeam && visible(kis), 3000, () => update({ type: 'team', fallback: true })) || changed;
  }
  render();
  if (changed && progress(S).done) R.prefer = null;
}
function ensureTimer() {
  const need = !R.decided || (active() && S.started && !progress(S).done);
  if (need && !R.timer) R.timer = setInterval(tick, 250);
  if (!need && R.timer) { clearInterval(R.timer); R.timer = 0; }
}

// ① 결과: 확인 표가 보였을 때(core-ui.js showConfirm) · 저장이 된 뒤(commitChange). 실계좌 화면은 세지 않는다.
window.addEventListener('teamquant:rules-preview', () => { if (account() === 'real') return; update({ type: 'preview' }); render(); });
window.addEventListener('teamquant:rules-confirmed', () => { if (account() === 'real') return; update({ type: 'confirm' }); render(); });
// ① 실패: [예시 자산으로 둘러보기]·[예시 자산으로 바꿔서 직접 정하기] 누름을 듣기만 한다(가로채지 않음). 10초 안에 예시 자산이 오지 않으면 실패 띠.
document.addEventListener('click', e => {
  if (!e.target.closest?.('[data-demo-start]')) return;
  clearTimeout(R.demoTimer); R.demoTimer = setTimeout(() => { if (account() !== 'demo') { R.demoFailed = true; render(); } }, 10000);
});
window.addEventListener('teamquant:asset-snapshot', e => {
  const d = e.detail || {};
  if (d.paper) R.paperMeta = d.paperMeta || null;
  if (d.demo && !d.paper) { clearTimeout(R.demoTimer); R.demoFailed = false; }
  if (!R.decided) tryShow(); render();
});
window.addEventListener('teamquant:asset-clear', () => render());
window.addEventListener('teamquant:page', onPage);
window.addEventListener('resize', measure);
// 확인 표가 닫히면(#rl-confirm hidden) · 모의투자 탭이 바뀌면 · 고지·동의 창이 열리고 닫히면 띠를 다시 고른다.
const watch = (el, opts) => { if (el) new MutationObserver(() => { if (!R.decided) tryShow(); render(); }).observe(el, opts); };
watch(document.getElementById('rl-confirm'), { attributes: true, attributeFilter: ['hidden'] });
// ③ 탭 안내 중에 사용자가 [팀 모의계좌] 탭을 직접 누르면, 팀 기록 줄(.pp-adh)이 화면 밖일 수 있어(390px) 그 줄까지 굴린다(포커스는 누른 탭에 둔다).
const paperEl = document.getElementById('core-paper');
if (paperEl) new MutationObserver(() => {
  const before = R.current?.key; if (!R.decided) tryShow(); render();
  if (before === 'team-tab' && R.current?.key === 'team') locate({ target: true, noFocus: true });
}).observe(paperEl, { attributes: true, attributeFilter: ['data-pp-tab'] });
watch(document.getElementById('app'), { attributes: true, attributeFilter: ['hidden'] });
watch(document.body, { childList: true });

tryShow(); render();
