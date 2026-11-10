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
