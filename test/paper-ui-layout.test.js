// 모의투자 화면 재배치(2026-11-10): 카드 순서·폰 폭 보유 표 규칙·문구 규칙을 소스에서 고정한다.
// 브라우저 검증(헤드리스 Chrome 390px/1366px)은 scratch 의 reorg-qa.mjs 가 하고, 여기서는 그 전제가 되는 마크업·CSS 가 사라지지 않았는지만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const paperUi = readFileSync(new URL('paper-ui.js', root), 'utf8');
const briefUi = readFileSync(new URL('brief-ui.js', root), 'utf8');

test('TC-UI-REORG-01 모의투자 화면 순서: 실시간 모의계좌 → 종목 가설 → 과거 데이터 검증 헤더 → 시뮬 설정', () => {
  const order = ['id="pp-kis"', 'id="pp-hyp"', 'id="pp-sim-head"', 'id="pp-setup"', 'id="pp-live"', 'id="pp-result"', 'id="pp-ref"', 'id="pp-howto"'].map(s => paperUi.indexOf(s));
  assert.ok(order.every(i => i >= 0), `missing id: ${order}`);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  for (const id of ['pp-kis', 'pp-hyp', 'pp-sim-head', 'pp-setup', 'pp-kis-body', 'pp-kis-actions', 'pp-kis-title-state']) assert.equal(paperUi.split(`id="${id}"`).length - 1, 1, `id ${id} must appear exactly once`);
  assert.match(paperUi, /과거 데이터로 검증 \(시뮬레이션\)/);
});

test('TC-UI-REORG-02 폰 폭 보유 표: 담은 이유 셀을 종목 줄 아래 전체 폭으로 내리는 규칙이 #pp-kis-held 에 묶여 있다', () => {
  // 보유 표만 id 를 가진다(계획 근거 표·규칙 이력·기준선은 같은 .pp-kis-plan 이지만 이 규칙을 받으면 안 된다).
  assert.equal(paperUi.split('id="pp-kis-held"').length - 1, 1);
  assert.match(paperUi, /<details class="pp-kis-plan" open id="pp-kis-held"><summary>보유 /);
  const media = paperUi.slice(paperUi.indexOf('@media(max-width:760px){'));
  assert.match(media, /#pp-kis-held table\.pp-ref\{display:block;width:auto;min-width:0;max-width:100%\}/);
  assert.match(media, /#pp-kis-held table\.pp-ref tr\{display:grid;grid-template-columns:[^}]*\}/);
  assert.match(media, /#pp-kis-held table\.pp-ref td\.pp-why\{grid-column:1\/-1;min-width:0;max-width:none/);
  // 데스크톱 규칙은 그대로: 담은 이유 열은 가로 스크롤 표 안에서 최소 240px.
  assert.match(paperUi, /\.pp-why\{white-space:normal!important;text-align:left!important;min-width:240px/);
});

test('TC-UI-REORG-03 문구 규칙: "~할까요?" 없음 · 상태 띠 다섯 항목 · 홈 배너에 진행 상태와 투자 비중', () => {
  assert.doesNotMatch(paperUi, /할까요\?/);
  assert.doesNotMatch(briefUi, /할까요\?/);
  for (const k of ['운용 상태', '마지막 자동 실행', '다음 점검', '계획 버전', '투자 비중']) assert.ok(paperUi.includes(`<span>${k} ${'$'}{tip(`), `strip item ${k} with tip()`);
  assert.match(paperUi, /아직 집행되지 않았습니다 \(원인: /);
  assert.match(briefUi, /투자 비중 \$\{m\.investedPct\.toFixed\(0\)\}%/);
  assert.match(briefUi, /m\.run\?\.label/);
});

test('TC-UI-REORG-05 실계좌 읽기 전용 카드(결정 22): 모의계좌 카드 바로 아래 · 기본 숨김(브리지 응답이 있을 때만) · "주문 기능 없음" 배지와 tip() ⓘ(폰에서도 보임) · 지수 대비·해시 체인은 모의 카드 함수를 이 계좌의 문구로 재사용(보유 국가 비중 · 공개 안 됨) · 보류 사유·마지막 정상 평가 · KST 시각 · 주문 버튼 없음', () => {
  const kis = paperUi.indexOf('id="pp-kis"'), real = paperUi.indexOf('id="pp-real"'), hyp = paperUi.indexOf('id="pp-hyp"');
  assert.ok(kis >= 0 && real > kis && real < hyp, '순서: 모의계좌 → 실계좌 → 가설');
  assert.equal(paperUi.split('id="pp-real"').length - 1, 1); assert.match(paperUi, /<article class="cr-card" id="pp-real" hidden>/);
  assert.match(paperUi, /실계좌\(<span id="pp-real-label">토스<\/span>\) · 읽기 전용 <span class="pp-badge">주문 기능 없음<\/span> \$\{tip\('이 계좌로는 조회만 합니다\. 주문은 모의계좌에서만 보냅니다\.'\)\}<\/h3>/, 'title 속성만 있는 span 은 폰에서 안 보이므로 tip() 을 쓴다');
  const s = paperUi.indexOf('async function realRefresh('), e = paperUi.indexOf("$('#pp-real-refresh')"); assert.ok(s >= 0 && e > s);
  const block = paperUi.slice(s, e);
  assert.match(block, /privateRead\('kis-real-status'\)/); assert.match(block, /catch \{ card\.hidden = true; return; \}/); assert.match(block, /s\.readOnly !== true\) \{ card\.hidden = true/);
  assert.match(block, /chainHtml\(s, \{ published: false \}\)/, '실계좌 체인은 공개 파일에 없으므로 공개 파일로 검증하라는 문장을 쓰지 않는다'); assert.match(block, /progressHtml\(s, \{ basis: 'holdings' \}\)/, '비교선 비중은 계획이 아니라 보유에서');
  assert.doesNotMatch(block, /chainHtml\(s\)|progressHtml\(s\)/);
  assert.match(block, /b\.usCostKrw > 0 && b\.cashUsd === 0/, '외화예수금 조회 실패(null)는 D+1 메모의 조건이 아니다'); assert.match(block, /D\+1 정산 전까지 과대 평가될 수 있음\(2026-11-12 미검증\)/);
  assert.match(block, /us_failed: '미국 잔고 조회에 실패해'/); assert.match(block, /마지막 정상 평가 \$\{esc\(lastM\.date\)\} \$\{won\(lastM\.total\)\}/); assert.match(block, /총자산 평가 <b>\$\{s\.markStale \? '보류' : won\(b\.total\)\}<\/b>/);
  assert.match(block, /\$\{esc\(kstStamp\(s\.asOf\)\)\} 기준/, '기준 시각은 KST'); assert.match(block, /tot_evlu_amt/, '총자산 ⓘ 는 실제 계산 규칙을 적는다');
  // chainHtml/progressHtml 의 문구 분기: 실계좌용 문장이 있고 공개 파일 검증 문장은 published 일 때만
  const ch = paperUi.slice(paperUi.indexOf('function chainHtml('), paperUi.indexOf('function kisSummary(')); assert.match(ch, /published \? '공개 파일에는 닫힌 날/); assert.match(ch, /kis-prod-\*\.json\)로만/); assert.match(ch, /마지막 봉인 \$\{last\.date\} 해시 앞 12자/); assert.doesNotMatch(ch, /오늘 해시/); assert.match(ch, /<b class="\$\{ok === false \? 'cr-err' : ''\}">/, "판정 색은 체인 자체만 따른다('정상'이 붉게 찍히지 않게)");
  const pg = paperUi.slice(paperUi.indexOf('function progressHtml('), paperUi.indexOf('function chainHtml(')); assert.match(pg, /basis === 'holdings' \? `첫 평가점\(\$\{esc\(from\)\}\)의 보유 국가 비중/); assert.match(pg, /의 계획에서 국가 비중과 현금 비중만 가져와`/);
  assert.doesNotMatch(block, /paper-live-run|paper-live-preview|privateRead\('paper-live|주문 보내기|kisRun|kisPreview/, '실계좌 카드에는 주문 경로가 없다');
  assert.doesNotMatch(paperUi, /할까요\?/);
});

test('TC-UI-REORG-04 헤드라인 규칙(결정 21): 모의계좌 카드의 운용 줄은 "지수 대비 %p" 만 굵고 절대 수익률은 괄호 안 · 숫자가 없으면 "지수 대비 —" 와 사유 · ⓘ 에 위험 수준이 다르다는 설명', () => {
  const s = paperUi.indexOf('function progressHtml('), e = paperUi.indexOf('function chainHtml('); assert.ok(s >= 0 && e > s);
  const block = paperUi.slice(s, e);
  assert.doesNotMatch(paperUi, /운용 \$\{s\.marks\.length\}일 · 시작 /, '절대 수익률이 헤드라인이면 안 된다');
  assert.match(block, /지수 대비 <b class="\$\{tone\(bm\.diffPp\)\}">\$\{pp\(bm\.diffPp\)\}<\/b> \(절차 \$\{pct\(/);
  assert.equal(block.split('<b').length - 1, 1, '굵은 숫자는 지수 대비 하나뿐');
  assert.match(block, /지수 대비 — <span class="cr-muted">\(\$\{esc\(why\)\}\)<\/span> <small class="cr-muted">절차 /);
  // 사유는 빠진 것에서: 비교선 객체가 있으면 그 error · 기준선만 있으면 공개 파일 갱신 전 · 둘 다 없으면 기준선 없음
  assert.match(block, /const why = bm \? \(bm\.error \|\| '비교할 자료 부족'\) : s\.baseline \? '비교선 자료 없음 · 공개 파일 갱신 전' : '기준선 없음';/);
  // 일수·구간은 비교선이 잰 구간(bm.days/from/asOf)을 따르고 marks 는 대체값
  assert.match(block, /const from = bm\?\.from \|\| m0\.date, asOf = bm\?\.asOf \|\| m1\.date, days = bm\?\.days \|\| s\.marks\.length;/); assert.match(block, /운용 \$\{days\}일 · 지수 대비 <b/); assert.doesNotMatch(block, /운용 \$\{s\.marks\.length\}일/);
  assert.match(block, /같은 위험 수준은 아닙니다/); assert.match(block, /class="cr-muted" title="\$\{esc\(tipText\)\}">ⓘ/);
  assert.match(paperUi, /prog = progressHtml\(s\)/);
});
