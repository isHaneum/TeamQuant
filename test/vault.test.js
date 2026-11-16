// 로컬 금고(lib/vault.js) — 가짜 DPAPI 와 임시 폴더로만 시험한다(실제 %LOCALAPPDATA% 금고·PowerShell 을 건드리지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault, isSealed, atomicWriteSync, minimalEnv, VaultError } from '../lib/vault.js';

const fakeDpapi = () => { let calls = 0; return { kind: 'fake', get calls() { return calls; }, protect: b => { calls++; return Buffer.concat([Buffer.from('FAKE'), Buffer.from(b).reverse()]); }, unprotect: b => { calls++; assert.equal(b.subarray(0, 4).toString(), 'FAKE'); return Buffer.from(b.subarray(4)).reverse(); } }; };
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-vault-'));

test('금고: 봉인·해제 왕복, 용도가 다르거나 바뀐 파일은 거부', () => {
  const v = createVault({ dir: tmp(), dpapi: fakeDpapi() });
  const sealed = v.seal('ledgers/real-toss', Buffer.from('{"a":1}'));
  assert.ok(isSealed(sealed)); assert.ok(!sealed.includes(Buffer.from('"a":1')), '평문이 그대로 남으면 안 됨');
  assert.equal(v.open(sealed, 'ledgers/real-toss').toString(), '{"a":1}');
  assert.throws(() => v.open(sealed, 'secrets/real-toss'), e => e instanceof VaultError && e.code === 'wrong_purpose');
  const bad = Buffer.from(sealed); bad[bad.length - 20] ^= 1; // 암호문 한 비트
  assert.throws(() => v.open(bad), e => e.code === 'auth_failed');
  const swapped = Buffer.from(sealed.toString('latin1').replace('ledgers/real-toss', 'ledgers/real-tosz'), 'latin1'); // 헤더(AAD) 변조
  assert.throws(() => v.open(swapped), e => e.code === 'auth_failed');
  assert.throws(() => v.seal('Ledgers/x', Buffer.from('1')), e => e.code === 'bad_purpose');
});

test('금고: 평문 파일은 그대로 읽고 sealed:false 로 알린다(다음 쓰기 때 암호화)', () => {
  const dir = tmp(), v = createVault({ dir, dpapi: fakeDpapi() }), f = join(dir, 'x.json');
  writeFileSync(f, '\uFEFF{"version":"DCA2","n":3}');
  assert.deepEqual(v.readJsonFile(f, 'ledgers/toss-dca'), { value: { version: 'DCA2', n: 3 }, sealed: false });
  v.writeJsonFile(f, 'ledgers/toss-dca', { version: 'DCA2', n: 4 });
  assert.ok(isSealed(readFileSync(f)));
  assert.deepEqual(v.readJsonFile(f, 'ledgers/toss-dca'), { value: { version: 'DCA2', n: 4 }, sealed: true });
});

test('금고: 이름 붙은 비밀 저장·조회·목록·삭제, 상태에는 값이 없다', () => {
  const v = createVault({ dir: tmp(), dpapi: fakeDpapi() });
  assert.equal(v.getSecret('toss'), null);
  v.setSecret('toss', 'clientId=abc\nclientSecret=SECRET-VALUE-123');
  assert.equal(v.getSecret('toss'), 'clientId=abc\nclientSecret=SECRET-VALUE-123');
  assert.ok(!readFileSync(v.secretPath('toss')).includes(Buffer.from('SECRET-VALUE-123')));
  assert.deepEqual(v.listSecrets(), ['toss']);
  const s = JSON.stringify(v.status()); assert.ok(!s.includes('SECRET-VALUE-123')); assert.match(s, /"secrets":\["toss"\]/);
  assert.throws(() => v.setSecret('../x', 'y'), e => e.code === 'bad_secret_name'); assert.throws(() => v.setSecret('x', ''), e => e.code === 'empty_secret');
  assert.equal(v.deleteSecret('toss'), true); assert.equal(v.deleteSecret('toss'), false);
});

test('금고: 같은 폴더의 새 인스턴스가 이전 파일을 연다(키 목록·KEK 를 다시 읽음), DPAPI 는 필요할 때만 부른다', () => {
  const dir = tmp(), d1 = fakeDpapi(), v1 = createVault({ dir, dpapi: d1 });
  assert.equal(d1.calls, 0, '만들기만 해서는 DPAPI 를 부르지 않음');
  const s = v1.seal('history/record', Buffer.from('hello')); assert.equal(d1.calls, 1, 'KEK 생성 때 한 번');
  const d2 = fakeDpapi(), v2 = createVault({ dir, dpapi: d2 });
  assert.equal(v2.open(s, 'history/record').toString(), 'hello'); assert.equal(d2.calls, 1, 'KEK 풀 때 한 번');
  v2.open(s, 'history/record'); assert.equal(d2.calls, 1, '다시 부르지 않음');
});

test('금고: 복구 파일로 다른 폴더(새 PC)에서 KEK 를 되살린다 · 틀린 패스프레이즈는 실패', () => {
  const a = tmp(), va = createVault({ dir: a, dpapi: fakeDpapi() });
  const sealed = va.seal('ledgers/real-toss', Buffer.from('{"x":42}'));
  const rec = va.exportRecovery('correct horse battery staple');
  assert.throws(() => va.exportRecovery('short'), e => e.code === 'weak_passphrase');
  const b = tmp(); mkdirSync(join(b, 'keys'), { recursive: true }); copyFileSync(join(a, 'keys', 'keyring.v1.json'), join(b, 'keys', 'keyring.v1.json'));
  const vb = createVault({ dir: b, dpapi: fakeDpapi() });
  assert.throws(() => vb.open(sealed), e => e.code === 'kek_missing', '키 목록만 있고 KEK 가 없으면 새로 만들지 않음');
  assert.throws(() => vb.importRecovery(rec, 'wrong passphrase!!'), e => e.code === 'auth_failed');
  assert.deepEqual(vb.importRecovery(rec, 'correct horse battery staple'), { restored: true, same: false });
  assert.ok(existsSync(join(b, 'keys', 'kek.v1.dpapi')));
  assert.equal(vb.open(sealed, 'ledgers/real-toss').toString(), '{"x":42}');
  assert.deepEqual(vb.importRecovery(rec, 'correct horse battery staple'), { restored: false, same: true });
});

test('원자적 쓰기는 덮어쓰고 임시 파일을 남기지 않는다 · 최소 환경에는 비밀 변수가 없다', () => {
  const dir = tmp(), f = join(dir, 'a', 'b.bin');
  atomicWriteSync(f, Buffer.from('1')); atomicWriteSync(f, Buffer.from('22'));
  assert.equal(readFileSync(f, 'utf8'), '22');
  const env = minimalEnv({ PATH: 'p', SystemRoot: 'C:\\Windows', KIS_APP_SECRET: 's', NAVER_CLIENT_SECRET: 'n', DART_API_KEY: 'd' });
  assert.deepEqual(Object.keys(env).sort(), ['PATH', 'SystemRoot']);
});
