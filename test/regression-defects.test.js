// 테스트 보고서(STR-TQ-2026-001) 결함 수정과 함께 추가한 회귀 테스트. 같은 결함이 다시 생기면 실패한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { overfitWarning } from '../lib/oos-validation.js';
import { manwon } from '../lib/investor-tools.js';

const root = new URL('../', import.meta.url);

test('TC-REG-001 (DEF-07, SSRD v1.1 CAP-04) 과적합 경고 경계: 10.0%p 차이는 경고 없음, 10.1%p부터 경고', () => {
  assert.equal(overfitWarning(20, 10), '');
  assert.match(overfitWarning(20.1, 10), /10\.1%p 낮아 과적합/);
  assert.equal(overfitWarning(5, 20), '', '평가 구간이 더 좋으면 경고 없음');
  assert.equal(overfitWarning(Number.NaN, 1), '', '수익률을 모르면 경고하지 않음');
});

test('TC-REG-002 (DEF-05) 운영 배포는 서버 전용 파일을 내주지 않고, 화면에 필요한 파일은 막지 않는다', () => {
  const dev = readFileSync(new URL('dev-server.mjs', root), 'utf8');
  const s = dev.indexOf('lib\\/(?:') + 'lib\\/(?:'.length, e = dev.indexOf(')\\.js', s);
  const allowed = new Set(dev.slice(s, e).split('|'));
  const libs = readdirSync(new URL('lib/', root)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
  const serverOnly = libs.filter(f => !allowed.has(f));
  const redirects = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')).redirects || [];
  const toRe = src => new RegExp('^' + src.replace(/\./g, '\\.').replace(/:\w+\(([^)]+)\)/g, '($1)').replace(/:\w+\*/g, '.*') + '$');
  const blocked = p => redirects.some(r => toRe(r.source).test(p));
  assert.ok(serverOnly.length >= 20);
  for (const f of serverOnly) assert.ok(blocked(`/lib/${f}.js`), `서버 전용 /lib/${f}.js 가 열려 있음`);
  for (const p of ['/dev-server.mjs', '/launch-personal-server.mjs', '/docs/DECISIONS.md']) assert.ok(blocked(p), `${p} 가 열려 있음`);
  for (const f of allowed) assert.ok(!blocked(`/lib/${f}.js`), `화면에 필요한 /lib/${f}.js 를 막음`);
  for (const p of ['/', '/index.html', '/app.js', '/styles.css', '/data/growth-outlook.json', '/api/quote']) assert.ok(!blocked(p), `${p} 를 막음`);
});

test('TC-REG-003 (DEF-06) 만원 표기: 100만 원 이상은 정수 만원, 그 아래는 소수 한 자리', () => {
  assert.equal(manwon(16_400_394), '1,640만원');
  assert.equal(manwon(1_027_937), '103만원');
  assert.equal(manwon(50_000), '5만원');
  assert.equal(manwon(12_345), '1.2만원');
  assert.equal(manwon(null), '미확인');
});
