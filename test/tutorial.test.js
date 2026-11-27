// 첫 방문 안내 '첫 규칙 3단계'(결정 71): 순수 로직(lib/tour-state.js)과 소스 검사. 네트워크·DOM 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOUR_COPY, COPY_VER, STORE_KEY, SESSION_KEY, fresh, parse, reduce, progress, settle, shouldAutoShow, bandFor, unlockDay, isStale, seen, stepView } from '../lib/tour-state.js';
import { changeGate, RULE_LOCK_DAYS } from '../lib/rule-presets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = f => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
const noComments = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const T0 = Date.parse('2026-11-27T03:00:00Z');
const at = (s, ...evs) => evs.reduce((x, type) => reduce(x, typeof type === 'string' ? { type, at: T0 } : { at: T0, ...type }), s);
// TOUR_COPY 의 모든 문자열(함수는 예시 값으로 불러서)
function strings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (typeof o === 'function') strings(o('11-16', '12-25'), out);
  else if (Array.isArray(o)) o.forEach(x => strings(x, out));
  else if (o && typeof o === 'object') Object.values(o).forEach(x => strings(x, out));
  return out;
}
const ALL = strings(TOUR_COPY);

// ── 7.1 순수 로직
test('1 parse: 깨진 JSON·다른 v 는 처음 상태, 올바른 값은 그대로', () => {
  assert.deepEqual(parse('{깨짐'), fresh()); assert.deepEqual(parse(JSON.stringify({ ...fresh(), v: 2 })), fresh()); assert.deepEqual(parse(null), fresh()); assert.deepEqual(parse('[1]'), fresh());
  const ok = { v: 1, copyVer: COPY_VER, view: 'mini', started: true, shown: 2, rule: 'previewed', today: T0, team: 0, m: { firstSeen: T0 - 1000, startedAt: T0, todayAcct: 'demo', ended: { how: 'off', at: T0, next: 'team' }, fallbacks: ['team'] } };
  assert.deepEqual(parse(JSON.stringify(ok)), ok);
  // 모양이 다른 칸은 버린다(이상한 rule · 음수 · 모르는 단계)
  const bad = parse(JSON.stringify({ ...ok, rule: 'hacked', shown: -4, view: 'x', m: { ...ok.m, fallbacks: ['team', 'zzz', 'team'] } }));
  assert.equal(bad.rule, null); assert.equal(bad.shown, 0); assert.equal(bad.view, 'open'); assert.deepEqual(bad.m.fallbacks, ['team']);
});

test('2 reduce: ①은 확정함이 확인만보다 앞서고, 나중에(skip)는 다른 결과를 덮지 않는다', () => {
  const f = fresh();
  assert.equal(at(f, 'preview', 'confirm').rule, 'confirmed');
  assert.equal(at(f, 'confirm', 'preview').rule, 'confirmed');
  assert.equal(at(f, 'skip', 'preview').rule, 'previewed');
  assert.equal(at(f, 'preview', 'skip').rule, 'previewed');
  const off = at(f, 'start', 'confirm', { type: 'today', acct: 'demo' }, { type: 'off', next: 'team' });
  assert.equal(off.view, 'off'); assert.deepEqual(off.m.ended, { how: 'off', at: T0, next: 'team' });
  const back = at(off, 'reopen');
  assert.equal(back.view, 'open'); assert.equal(back.rule, 'confirmed'); assert.equal(back.today, 0); assert.equal(back.started, false); assert.equal(back.copyVer, COPY_VER);
  assert.equal(at(at(f, 'preview'), 'reopen').rule, null); // 확인만 한 것은 처음부터
  assert.equal(at(f, 'shown', 'shown').shown, 2); assert.equal(at(f, 'shown').m.firstSeen, T0);
  assert.deepEqual(at(f, { type: 'team', fallback: true }, { type: 'fallback', step: 'team' }).m.fallbacks, ['team']);
  assert.equal(f.rule, null); // 원래 상태는 바꾸지 않는다
});

test('3 progress: 순서와 관계없이 세고, 다음은 아직 안 끝난 가장 앞 단계', () => {
  let p = progress(at(fresh(), 'team')); assert.equal(p.n, 1); assert.equal(p.next, 'rule'); assert.equal(p.done, false);
  p = progress(at(fresh(), 'skip', 'today')); assert.equal(p.next, 'team'); assert.equal(p.n, 2);
  p = progress(at(fresh(), 'preview', 'today', 'team')); assert.equal(p.done, true); assert.equal(p.next, null);
  // 끝 카드를 보고 떠난 사람은 다음 방문 때 done
  const s = settle(at(fresh(), 'confirm', 'today', 'team')); assert.equal(s.view, 'done'); assert.equal(s.m.ended.how, 'left');
});

test('4 shouldAutoShow: 앱이 보이고 창이 없고, 계좌 판정이 끝났을 때만', () => {
  const env = { appVisible: true, loginVisible: false, consentOpen: false, dialogOpen: false, account: 'paper', host: 'teamquant.vercel.app', sinceAppMs: 100 };
  assert.equal(shouldAutoShow(null, env), 'open'); assert.equal(shouldAutoShow(fresh(), env), 'open');
  assert.equal(shouldAutoShow(fresh(), { ...env, loginVisible: true }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, appVisible: false }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, consentOpen: true }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, dialogOpen: true }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, account: 'real' }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, host: '127.0.0.1' }), null);
  assert.equal(shouldAutoShow(at(fresh(), 'off'), env), null);
  assert.equal(shouldAutoShow(at(fresh(), 'off'), { ...env, forced: true }), 'open');
  assert.equal(shouldAutoShow({ ...at(fresh(), 'done'), copyVer: '2026-01-01.1' }, env), 'open');
  assert.equal(shouldAutoShow(at(fresh(), 'done'), env), null);
  assert.equal(shouldAutoShow(at(fresh(), 'later'), env), 'mini');
  assert.equal(shouldAutoShow(fresh(), { ...env, account: 'none', sinceAppMs: 3999 }), null);
  assert.equal(shouldAutoShow(fresh(), { ...env, account: 'none', sinceAppMs: 4000 }), 'open');
  assert.equal(shouldAutoShow({ ...fresh(), shown: 3 }, env), 'mini');
  assert.equal(shouldAutoShow({ ...fresh(), shown: 3, started: true }, env), 'open');
  assert.equal(shouldAutoShow({ ...fresh(), shown: 2 }, env), 'open');
});

// 2026-11-27 보완 2(사용자 지시 "줄글 설명은 다 제거 · 부가 설명은 클릭으로만"): 띠 본문은 할 일 한 줄뿐이고,
// 이유·기준·잠금 날짜·늦음 같은 설명은 모두 ⓘ(b.tip)로 옮겼다. 그래서 예전에 본문에서 찾던 글을 이제 tip 에서 찾는다.
test('5 bandFor: 계좌·화면마다 띠 한 장(본문은 한 줄 · 설명은 ⓘ)', () => {
  const f = fresh(), now = T0;
  let b = bandFor({ s: f, account: 'paper', view: 'home', now });
  assert.equal(b.target, '#rl-now'); assert.match(b.body, /\[예시 자산으로 바꿔서 직접 정하기\]/); assert.equal(b.move, TOUR_COPY.band.move.rules); assert.equal(b.checklist, false);
  // 규칙 화면이 아니면 본문은 같고 [규칙으로] 이동 버튼이 함께 나온다(어디 있는지는 ⓘ 에)
  assert.equal(b.body, TOUR_COPY.band.rulePaper); assert.match(b.tip, /규칙 화면 맨 위 카드/);
  b = bandFor({ s: f, account: 'paper', view: 'rules', now }); assert.equal(b.move, null); assert.equal(b.checklist, true); assert.equal(b.body, TOUR_COPY.band.rulePaper);
  assert.equal(b.cta, '#rl-now [data-demo-start]');
  // 공개 사이트 홈에 실계좌 연결 안내가 남아 있으므로(LEGAL M7) '실계좌 기능이 없다'고 단정하지 않는다
  assert.doesNotMatch(b.tip, /실계좌 기능이 없/);
  b = bandFor({ s: f, account: 'demo', view: 'rules', now }); assert.equal(b.key, 'rule-demo'); assert.equal(b.target, '#rl-now'); assert.equal(b.cta, '#rl-confirm-now');
  // ①-다: 잠금 날짜는 확인 표의 '잠금' 줄에 있으므로 띠에서는 ⓘ 안에만 둔다(날짜 식은 확인 표와 같다 · 시험 6)
  b = bandFor({ s: f, account: 'demo', view: 'rules', confirmOpen: true, now }); assert.equal(b.key, 'rule-confirm'); assert.equal(b.target, '#rl-confirm'); assert.equal(b.body, TOUR_COPY.band.ruleConfirm);
  assert.ok(b.tip.includes(`${unlockDay(now)}부터`)); assert.ok(b.tip.includes(`${RULE_LOCK_DAYS}일`)); assert.doesNotMatch(b.body, /\d{2}-\d{2}/);
  assert.equal(b.cta, '#rl-cancel'); assert.equal(b.reveal, true); // 확인 표의 [취소]·[확정]이 띠 밑에 깔리지 않게 한 번 굴린다
  // 이미 '확인만 함'이어도 확인 표가 열려 있으면 잠금 날짜를 보인다
  assert.equal(bandFor({ s: at(f, 'preview'), account: 'demo', view: 'rules', confirmOpen: true, now }).key, 'rule-confirm');
  b = bandFor({ s: f, account: 'paper', view: 'rules', demoFailed: true, now }); assert.match(b.body, /만들지 못했습니다/); assert.equal(b.skip, true); assert.equal(b.target, null); assert.match(b.tip, /②·③을 먼저/);
  // 계좌가 없으면 홈 연결 카드 전체가 아니라 [예시 자산으로 둘러보기] 버튼만 가리킨다
  b = bandFor({ s: f, account: 'none', view: 'rules', now }); assert.equal(b.target, '#hm-connect [data-demo-start]'); assert.equal(b.move, TOUR_COPY.band.move.home); assert.match(b.body, /\[예시 자산으로 둘러보기\]/);
  const r = at(f, 'preview');
  b = bandFor({ s: r, account: 'paper', view: 'home', hero: '규칙 6개 중 5개 지킴', now }); assert.equal(b.target, '#core-today'); assert.match(b.tip, /팀 모의계좌/); assert.doesNotMatch(b.tip, /방금 정한/); assert.equal(b.body, "'규칙 6개 중 5개 지킴' 카드 보기");
  // 계산 중이면 자리표시 글자(N·M)를 쓰지 않는다
  b = bandFor({ s: r, account: 'demo', view: 'home', hero: '규칙 점검 중', now }); assert.match(b.tip, /방금 정한/); assert.ok(b.body.includes(TOUR_COPY.heroFallback)); assert.doesNotMatch(b.body, /N개|M개/);
  b = bandFor({ s: r, account: 'none', view: 'home', now }); assert.equal(b.key, 'today-none'); assert.equal(b.target, '#hm-connect [data-demo-start]');
  const t = at(r, 'today');
  b = bandFor({ s: t, account: 'paper', view: 'paper', paperTab: 'mine', now }); assert.equal(b.target, '.pp-tabs'); assert.equal(b.focus, '[data-pp-tab-btn="team"]'); assert.equal(b.body, TOUR_COPY.band.teamTab);
  // 공개된 팀 기록이 오래됐으면 그 날짜는 ⓘ 끝에만 붙는다(본문 꼬리 문장 teamStaleTail 은 보완 2에서 뺐다)
  b = bandFor({ s: t, account: 'paper', view: 'paper', paperTab: 'team', stale: true, staleDay: '11-16', now }); assert.equal(b.target, '#pp-kis'); assert.equal(b.scrollTo, '.pp-adh'); assert.match(b.tip, /공개된 팀 기록은 11-16 기준/); assert.doesNotMatch(b.body, /11-16/); assert.match(b.body, /규칙 지킴·어김/);
  // '예시 자산과는 따로' 꼬리(teamDemoTail)는 뺐다
  b = bandFor({ s: t, account: 'demo', view: 'home', paperTab: 'team', now }); assert.doesNotMatch(b.body + b.tip, /예시 자산과는 따로/); assert.equal(b.move, TOUR_COPY.band.move.paper);
  // 모든 띠 본문: 한 줄(30자 이내 · 문장 하나 · 마침표로 이어 붙이지 않음)
  for (const [k, v] of Object.entries(TOUR_COPY.band)) {
    if (k === 'move' || k.endsWith('Tip')) continue;
    const body = typeof v === 'function' ? v('규칙 6개 중 5개 지킴') : v;
    assert.ok(body.length <= 30, `${k}: ${body}`); assert.doesNotMatch(body, /[.。]/, k);
  }
  assert.equal(bandFor({ s: at(t, 'team'), account: 'paper', view: 'home', now }), null);
  assert.equal(bandFor({ s: f, account: 'real', view: 'home', now }), null);
  // [하러 가기]로 ③을 먼저 고르고 모의투자 화면에 있으면 ③을 보인다(다른 화면이면 가장 앞 단계)
  assert.equal(bandFor({ s: f, account: 'paper', view: 'paper', paperTab: 'team', prefer: 'team', now }).step, 'team');
  assert.equal(bandFor({ s: f, account: 'paper', view: 'home', prefer: 'team', now }).step, 'rule');
  assert.equal(stepView('rule', 'none'), 'home'); assert.equal(stepView('rule', 'paper'), 'rules'); assert.equal(stepView('team', 'demo'), 'paper');
});

test('6 unlockDay: 한국 날짜로 28일 뒤 · changeGate 잠금 문구의 날짜와 같다', () => {
  assert.equal(unlockDay(Date.parse('2026-11-27T03:00:00Z')), '12-25');
  assert.equal(unlockDay(Date.parse('2026-11-26T14:59:59Z')), '12-24'); // KST 11-26 23:59
  assert.equal(unlockDay(Date.parse('2026-11-26T15:00:00Z')), '12-25'); // KST 11-27 00:00
  assert.equal(unlockDay(Date.parse('2026-12-20T03:00:00Z')), '2027-01-17'); // 같은 해가 아니면 YYYY-MM-DD
  for (const t of ['2026-11-27T03:00:00Z', '2026-11-26T14:59:59Z', '2026-11-26T15:00:00Z']) {
    const ms = Date.parse(t), g = changeGate({ rules: {}, confirmedAt: new Date(ms).toISOString() }, { dailyLoss: 1.5 }, { now: ms + 1000, reason: '0123456789ab' });
    assert.equal(g.code, 'locked'); assert.ok(g.why.includes(`-${unlockDay(ms)}부터`), g.why);
  }
});

test('7 isStale · seen', () => {
  assert.equal(isStale('2026-11-16T04:46:27.920Z', T0), true);
  const base = Date.parse('2026-11-20T00:00:00Z');
  assert.equal(isStale('2026-11-20T00:00:00Z', base + 71 * 3600e3), false); assert.equal(isStale('2026-11-20T00:00:00Z', base + 73 * 3600e3), true);
  assert.equal(isStale('2026-11-16T04:46:27.920Z', T0, true), false); assert.equal(isStale(null, T0), false);
  assert.equal(seen(0.5), true); assert.equal(seen(0.49, 100, 844), false); assert.equal(seen(0.3, 500, 844), true);
});

// ── 7.2 소스 검사
const TUT = src('tutorial-ui.js'), TUT_CODE = noComments(TUT), CSS = src('tutorial.css');
const FORBIDDEN = ['할까요', '사라', '팔라', '추천', '유망', '수익', '원금 보장', '자동', '오늘 시장', 'AI가 골라', 'PC', '토스', '텔레그램', '가설', '그래프'];

test('8 문구에 금지어가 없고, tutorial-ui.js 코드에는 한글이 없다', () => {
  assert.ok(ALL.length > 40);
  for (const s of ALL) for (const w of FORBIDDEN) assert.ok(!s.includes(w), `'${w}' in ${s}`);
  for (const w of FORBIDDEN) assert.ok(!TUT_CODE.includes(w), `'${w}' in tutorial-ui.js`);
  assert.doesNotMatch(TUT_CODE, /[가-힣ㄱ-ㆎ]/);
});

// 2026-11-27 보완 2(사용자 지시): 예전 시험 9는 카드의 LEGAL 5.1 한 줄('수업 과제용 · 투자 권유 아님 · 모의계좌는 가상 돈 …')과
// '하지 않는 일' 5줄을 글자 그대로 확인했다. 사용자가 "무료 도구·줄글 설명은 다 제거, 부가 설명은 클릭으로만, 제목은 '투자 규칙 확인 도구'"라고
// 지시해 카드에서 그 줄을 모두 뺐고, LEGAL 5.1 의 자리를 머리글 [투자 권유 아님] 배지(항상 보임) → 누르면 고지 창(C1·C2·C3·C4·C11·C15 전문)으로 옮겼다.
// 같은 내용(권하지 않음 · 돈 안 받음 · 남의 계좌 주문 안 함 · 1:1 답변 안 함 · 등록 업자 아님)은 고지 창 C1 에 그대로 있다(시험 19 지문).
// 그래서 이 시험은 새 기준을 확인한다: 제목 · 카드에 설명 줄 없음 · 배지가 고지 창을 엶 · 뻔한 말(R3)이 문구에 없음.
test('9 카드는 제목 "투자 규칙 확인 도구"만 · 설명 줄 없음 · LEGAL 5.1 은 머리글 배지 → 고지 창 · 뻔한 말 없음', () => {
  assert.equal(TOUR_COPY.title, '투자 규칙 확인 도구');
  for (const k of ['acct', 'stale', 'legalLine', 'noticeLabel', 'notDo']) assert.ok(!(k in TOUR_COPY), k);
  for (const k of Object.keys(TOUR_COPY.steps)) assert.deepEqual(Object.keys(TOUR_COPY.steps[k]), ['name'], k);
  const fn = name => { const i = TUT.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return TUT.slice(i, TUT.indexOf('\n}', i)); };
  const open = fn('openHtml'), end = fn('endHtml'), row = fn('stepRow');
  assert.doesNotMatch(open + row, /<p[\s>]/, '펼친 카드에 설명 줄(<p>) 없음');
  assert.doesNotMatch(end, /<p[\s>]/); assert.match(end, /tip\(/, '끝 카드 설명은 ⓘ 안');
  assert.doesNotMatch(TUT_CODE, /tq-notice-btn|data-tq-act="notice"/);
  // 머리글 배지: 위쪽 바(.top-actions)에 늘 붙고, 누르면 고지 창(REQUIRED + NOTICES 전문)을 연다
  const c = src('consent-ui.js'), part = name => { const i = c.indexOf(`function ${name}(`); return c.slice(i, c.indexOf('\n}', i)); };
  const mount = part('mountNotice'), nd = part('noticeDialog');
  assert.match(mount, /querySelector\('\.top-actions'\)/); assert.match(mount, /id = 'tq-notice-btn'/); assert.match(mount, /textContent = '투자 권유 아님'/); assert.match(mount, /addEventListener\('click', noticeDialog\)/);
  assert.match(nd, /\[\.\.\.REQUIRED, \.\.\.NOTICES\]/);
  const legal = src('docs/LEGAL.md'), sec = legal.slice(legal.indexOf('### 5.1'), legal.indexOf('### 5.2'));
  assert.match(sec, /투자 권유 아님/); assert.match(sec, /고지 창/); assert.doesNotMatch(sec, /> 수업 과제용/);
  for (const s of ALL) for (const w of ['무료 도구', '가상 돈', '가상 1억', '실제 아님', '내 계좌가 아닙', '투자 권유 아님', '수업 과제용', '그 뒤 갱신 안 됨']) assert.ok(!s.includes(w), `'${w}' in ${s}`);
});

test('10 어떤 문구도 ? 로 끝나지 않는다', () => { for (const s of ALL) assert.ok(!/[?？]\s*$/.test(s), s); });

test('11 문구의 [버튼 이름]이 앱 소스에 있다', () => {
  const app = ['core-ui.js', 'brief-ui.js', 'virtual-ui.js'].map(src).join('\n'), names = new Set();
  for (const s of ALL) for (const m of s.matchAll(/\[([^\]]+)\]/g)) names.add(m[1]);
  for (const n of ['예시 자산으로 바꿔서 직접 정하기', '이 규칙으로 확정', '값 고쳐서 확정', '변경 내용 확인', '취소', '예시 자산으로 둘러보기', '예시 끄기', '팀 모의계좌']) assert.ok(names.has(n), n);
  for (const n of names) assert.ok(app.includes(`>${n}<`) || app.includes(`'${n}'`) || app.includes(n), n);
  for (const [f, n] of [['core-ui.js', '>예시 자산으로 바꿔서 직접 정하기<'], ['core-ui.js', '>이 규칙으로 확정<'], ['core-ui.js', '>값 고쳐서 확정<'], ['core-ui.js', '>변경 내용 확인<'], ['core-ui.js', '>취소<'], ['brief-ui.js', '>예시 자산으로 둘러보기<'], ['brief-ui.js', '>예시 끄기<'], ['virtual-ui.js', '>팀 모의계좌<']]) assert.ok(src(f).includes(n), `${f} ${n}`);
});

test('12 가리키는 선택자가 앱 소스에 있다', () => {
  const has = (f, ...xs) => { const t = src(f); for (const x of xs) assert.ok(t.includes(x), `${f}: ${x}`); };
  has('core-ui.js', 'id="rl-now"', 'id="rl-confirm"', "'core-today'", 'ct-hero');
  has('paper-ui.js', 'id="pp-kis"', 'pp-adh', "'core-paper'");
  has('virtual-ui.js', 'data-pp-tab-btn', "'pp-tabs'", 'dataset.ppTab');
  has('brief-ui.js', 'id="hm-connect"', "id = 'report'", 'data-demo-start');
  has('core-ui.js', 'data-demo-start', 'id="rl-confirm-now"');
  has('consent-ui.js', "'tq-notice-btn'"); has('help-ui.js', 'tutorial-grid');
  const used = TUT + src('lib/tour-state.js');
  // 'tq-notice-btn' 은 뺐다: 보완 2에서 카드의 [알아 둘 것] 버튼이 없어져 이 모듈은 고지 창을 열지 않는다(머리글 배지가 연다 · 시험 9).
  for (const x of ['#rl-now', 'rl-confirm', 'core-today', 'ct-hero', '#pp-kis', '.pp-adh', 'data-pp-tab-btn', '.pp-tabs', '#hm-connect', "'report'", 'tutorial-grid']) assert.ok(used.includes(x), x);
});

test('13 색 리터럴 없음 · z-index 는 31~998', () => {
  for (const [name, t] of [['tutorial.css', CSS], ['tutorial-ui.js', TUT_CODE]]) {
    assert.doesNotMatch(t, /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})(?![\w-])/i, name); assert.doesNotMatch(t, /rgba?\(/i, name); assert.doesNotMatch(t, /hsla?\(/i, name);
    for (const m of t.matchAll(/z-index\s*:\s*(-?\d+)/g)) { const z = Number(m[1]); assert.ok(z >= 31 && z <= 998, `${name} z-index ${z}`); }
  }
  assert.match(CSS, /z-index:40/);
});

test('14 저장 키는 두 개뿐 · 읽기 키는 teamQuant 로 시작 · tq: 와 teamQuantPaperTab 없음', () => {
  assert.equal(STORE_KEY, 'teamQuantTour:v1'); assert.equal(SESSION_KEY, 'teamQuantTourSeen');
  const writes = [...TUT_CODE.matchAll(/(?:setItem|removeItem)\(\s*([^,)]+)/g)].map(m => m[1].trim());
  assert.ok(writes.length >= 2); for (const k of writes) assert.ok(['STORE_KEY', 'SESSION_KEY'].includes(k), k);
  const reads = [...TUT_CODE.matchAll(/getItem\(\s*([^)]+?)\s*\)/g)].map(m => m[1].trim());
  assert.ok(reads.length >= 4); for (const k of reads) assert.ok(['STORE_KEY', 'SESSION_KEY'].includes(k) || /^['`]teamQuant/.test(k), k);
  assert.ok(!TUT_CODE.includes('tq:')); assert.ok(!TUT.includes('teamQuantPaperTab'));
});

// 보완 2(2026-11-27): 카드의 [알아 둘 것](고지 창 열기)을 빼서 .click() 은 화면 이동 한 번뿐이다.
test('15 .click() 은 한 번뿐(화면 이동), 기능 버튼은 누르지 않는다', () => {
  const lines = TUT_CODE.split('\n').filter(l => l.includes('.click('));
  assert.equal((TUT_CODE.match(/\.click\(/g) || []).length, 1);
  for (const l of lines) assert.ok(l.includes('[data-view='), l);
  for (const id of ['data-demo-start', 'rl-commit', 'rl-confirm-now', 'va-create', 'va-check', 'cp-run', 'data-pp-tab-btn']) assert.doesNotMatch(TUT_CODE, new RegExp(`${id}[^\\n]*\\.click\\(`), id);
});

test('16 인라인 처리기·스크립트 없음(CSP script-src self)', () => {
  assert.doesNotMatch(TUT, /onclick\s*=/i); assert.doesNotMatch(TUT, /<script/i);
  assert.doesNotMatch(TUT_CODE, /<[a-z][^>]*\son[a-z]+\s*=/i);
});

test('17 네트워크를 쓰지 않는다', () => {
  for (const f of ['tutorial-ui.js', 'lib/tour-state.js']) { const t = noComments(src(f)); for (const w of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'WebSocket']) assert.ok(!t.includes(w), `${f}: ${w}`); }
});

test('18 workspace-ui.js 가 동의 모듈 뒤에 불러오고, 내 기록 지우기가 우리 키도 지운다', () => {
  const w = src('workspace-ui.js'), a = w.indexOf("import('/consent-ui.js')"), b = w.indexOf("import('/tutorial-ui.js')");
  assert.ok(a > 0 && b > a);
  assert.match(w, /Object\.keys\(localStorage\)\)if\(k\.startsWith\('teamQuant'\)\)localStorage\.removeItem\(k\)/);
  assert.match(w, /Object\.keys\(sessionStorage\)\)if\(k\.startsWith\('teamQuant'\)/);
  assert.ok(STORE_KEY.startsWith('teamQuant') && SESSION_KEY.startsWith('teamQuant'));
});

test('19 동의 문구(REQUIRED)와 버전이 그대로다(바뀌면 모든 동의가 풀린다)', () => {
  const c = src('consent-ui.js'), i = c.indexOf('const REQUIRED = ['), j = c.indexOf('];', i), block = c.slice(i, j + 2);
  assert.equal(createHash('sha256').update(block, 'utf8').digest('hex'), '03f22d06006ee51451ff50bad4c2a93aa18769589293038854bac29b3c3e28ab');
  assert.match(c, /const VER = '2026-11-26\.1'/);
});

test('19b C15 AI 사용 안내: 고지 창(NOTICES)과 LEGAL 5.3 이 같은 글 · 멈춘 오늘 시장 요약을 지금 만든다고 적지 않음', () => {
  const c = src('consent-ui.js'), n = c.slice(c.indexOf('const NOTICES = ['), c.indexOf('];', c.indexOf('const NOTICES = [')));
  const m = n.match(/\['C15', 'AI 사용 안내', "([^"]+)"\]/); assert.ok(m, 'C15 in NOTICES');
  const legal = src('docs/LEGAL.md'), i = legal.indexOf('**C15 AI 사용 안내**'), quote = legal.slice(i).split('\n').find(l => l.startsWith('> ')).slice(2).trim();
  assert.equal(m[1], quote);
  assert.match(m[1], /'오늘 시장' AI 요약은 2026-11-27부터 멈췄습니다/); assert.match(m[1], /Anthropic Claude/);
  const sec53 = legal.slice(legal.indexOf('### 5.3'), legal.indexOf('### 5.4'));
  assert.doesNotMatch(sec53, /"AI 요약"과 하락 매수 카드는/); assert.doesNotMatch(sec53, /"오늘 시장" 요약\(AI 요약 표시\)은 생성형 AI/);
});

test('20 core-ui.js 가 ① 결과를 알린다(확인 표가 보인 뒤 · 저장이 된 뒤)', () => {
  const c = src('core-ui.js'), fn = name => { const i = c.indexOf(`function ${name}(`); return c.slice(i, c.indexOf('\nfunction ', i + 10)); };
  const sc = fn('showConfirm'), cc = fn('commitChange');
  assert.ok(sc.indexOf('teamquant:rules-preview') > sc.indexOf('box.innerHTML'));
  assert.ok(cc.includes('teamquant:rules-confirmed')); assert.ok(cc.indexOf('teamquant:rules-confirmed') > cc.indexOf('if (!save('));
});

test('21 1장 문구 되돌림 방지', () => {
  const none = (f, ...ws) => { const t = src(f); for (const w of ws) assert.ok(!t.includes(w), `${f}: ${w}`); };
  none('core-ui.js', '까지 바꿀 수 없습니다', '지금 바로 맞출 일', '연 수익 ${v.all');
  none('lib/core-rules.js', '원어치 줄이기', '늘릴 수 있음', '줄일 차례');
  none('lib/stock-score.js', '추가 매수 검토', '안전합니다');
  none('lib/portfolio-advice.js', '나누세요', '검토하세요', '지키세요', '채우세요', '안전합니다');
  // 종목 이름별 매수 후보·매도 검토 줄(LEGAL 2.1)은 코드에서 뺐다(주석의 설명은 예외)
  for (const w of ['더 살지', '지표 상위:', '지표가 약한 종목:']) assert.ok(!noComments(src('lib/portfolio-advice.js')).includes(w), w);
  assert.ok(!src('portfolio-ui.js').includes('지금 현금 대기'));
  none('paper-ui.js', '사람이 하루 1번'); none('home-top-ui.js', 'Claude(Opus');
  // 보완 2(2026-11-27): 이용 안내 카드 설명은 제목 옆 ⓘ('<b>1. 홈 ${tip(…)}</b>')로 옮겨 제목 앞부분으로 자른다.
  const help = src('help-ui.js'), card1 = help.slice(help.indexOf('<b>1. 홈'), help.indexOf('<b>2. 규칙'));
  assert.ok(card1.length > 20); assert.ok(!card1.includes('오늘 시장')); assert.ok(!card1.includes('토스'));
  assert.ok(src('paper-ui.js').includes('· AI 판정 · ${esc(md(c.asOf))}'));
});

// 보완 2(2026-11-27 · R6): 확정 버튼 위 잠금 문장(3문장)은 '28일 잠금 ⓘ' 짧은 라벨로 줄였다. 날짜·이유 10자·저장 위치는 그 ⓘ 안에 있고,
// 확인 표의 '잠금' 줄('…부터 다시 바꿀 수 있습니다')이 확정 전에 한 번 더 보인다. 그래서 라벨이 늘 보이는지 · 날짜가 ⓘ 안에 있는지를 본다.
test('22 규칙 화면의 잠금 라벨(28일 잠금 ⓘ)과 확인 표 잠금 줄 · 수준 카드 기간 줄', () => {
  const c = src('core-ui.js'), i = c.indexOf('function renderNow('), now = c.slice(i, c.indexOf('\nfunction ', i + 10));
  assert.ok(now.includes('rl-cap') && now.includes('${RULE_LOCK_DAYS}일 잠금 ${tip('), '확정 버튼 위 짧은 라벨 + ⓘ');
  assert.ok(now.includes('부터 다시 바꿀 수 있음') && now.includes('10자 이상'), 'ⓘ 안에 날짜·이유 조건');
  assert.doesNotMatch(now, /<p class="rl-cap">확정하면/, '버튼 위 줄글 없음');
  const sc = c.slice(c.indexOf('function showConfirm('), c.indexOf('\nfunction ', c.indexOf('function showConfirm(') + 10));
  assert.ok(sc.includes('부터 다시 바꿀 수 있습니다'), '확인 표 잠금 줄');
  assert.ok(c.includes('id="rl-levels-note"'));
});
