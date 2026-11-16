// 금고를 붙인 저장소(장부 · 현금 · 키 로더)와 토스 토큰 공유 — 가짜 DPAPI · 임시 폴더 · 가짜 fetch 로만 시험한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVault, isSealed } from '../lib/vault.js';
import { createLedgerStore } from '../lib/paper-live.js';
import { createCashStore } from '../lib/cash-store.js';
import { applyKeyFiles, applyVaultEnv, kisReadOnlySettings } from '../lib/key-files.js';
import { createTossTokenProvider, loadTossCredentials, createTossReader } from '../lib/toss.js';

const fake = { kind: 'fake', protect: b => Buffer.concat([Buffer.from('F'), b]), unprotect: b => b.subarray(1) };
const tmp = () => mkdtempSync(join(tmpdir(), 'tq-vs-'));

test('장부: 금고가 있으면 암호화해 쓰고, 평문 장부는 처음 읽을 때 같은 바이트 그대로 암호화본으로 바뀐다', () => {
  const dir = tmp(), vault = createVault({ dir: join(dir, 'v'), dpapi: fake });
  const plain = createLedgerStore(dir, { prefix: 'real' });
  plain.save('toss', { marks: [{ total: 123 }] });
  const before = readFileSync(plain.path('toss'));
  assert.ok(!isSealed(before));
  const sealed = createLedgerStore(dir, { prefix: 'real', vault });
  assert.deepEqual(sealed.load('toss').marks, [{ total: 123 }]);
  const after = readFileSync(plain.path('toss'));
  assert.ok(isSealed(after), '읽은 뒤 암호화본으로 바뀜');
  assert.equal(vault.open(after, 'ledgers/real-toss').toString(), before.toString(), '내용은 바이트 그대로');
  sealed.save('toss', { marks: [{ total: 456 }] });
  assert.deepEqual(sealed.load('toss').marks, [{ total: 456 }]);
  assert.throws(() => plain.load('toss'), /금고가 꺼져/);
});

test('현금 기록: 금고가 있으면 암호화해 쓰고 평문도 읽는다', async () => {
  const dir = tmp(), vault = createVault({ dir: join(dir, 'v'), dpapi: fake });
  writeFileSync(join(dir, 'cash-ledger.json'), JSON.stringify({ schema: 1, entries: [{ amount: 1000, note: '', currency: 'KRW', recordedAt: '2026-11-01T00:00:00.000Z' }] }));
  const store = createCashStore({ directory: dir, vault });
  assert.equal((await store.get()).latest.amount, 1000);
  await store.set({ amount: 2500, note: '메모' });
  assert.ok(isSealed(readFileSync(join(dir, 'cash-ledger.json'))));
  assert.equal((await store.get()).latest.amount, 2500);
});

test('키 로더: 금고의 비밀을 키 파일보다 먼저 쓰고, .env 비밀은 빈 변수만 채운다(값은 요약에 없음)', () => {
  const dir = tmp(), vault = createVault({ dir, dpapi: fake });
  vault.setSecret('dart', 'DART_API_KEY=' + 'a'.repeat(40));
  vault.setSecret('kis', ['simulappkey=' + 'P'.repeat(36), 'simulappsecret=' + 'S'.repeat(180), 'appkey=' + 'L'.repeat(36), 'app=' + 'T'.repeat(180), 'KIS_ACCOUNT_NO=12345678'].join('\n'));
  vault.setSecret('env', 'NAVER_CLIENT_ID=nid\nNAVER_CLIENT_SECRET="nsec"\n# 주석\nKEEP=old');
  const env = { KIS_MODE: 'vps', KIS_KEY_FILE: 'C:\\없는\\경로.key', KIS_PAPER_ACCOUNT_NO: '87654321', KEEP: 'mine', KIS_REAL_READONLY: '1' };
  const summary = applyKeyFiles(env, { vault, readFile: () => { throw new Error('파일을 읽으면 안 됨'); } });
  assert.equal(summary.dart.from, 'vault'); assert.equal(summary.kis.from, 'vault:paper-labels'); assert.equal(summary.kis.configured, true);
  assert.equal(env.KIS_APP_KEY, 'P'.repeat(36)); assert.equal(env.KIS_ACCOUNT_NO, '87654321');
  assert.ok(!JSON.stringify(summary).includes('PPPP'));
  assert.deepEqual(applyVaultEnv(env, vault), ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET']);
  assert.equal(env.NAVER_CLIENT_SECRET, 'nsec'); assert.equal(env.KEEP, 'mine');
  const ro = kisReadOnlySettings(env, { vault, readFile: () => { throw new Error('파일을 읽으면 안 됨'); } });
  assert.equal(ro.configured, true); assert.equal(ro.accountMasked, '****5678');
});

test('토스 자격: 금고의 비밀이 있으면 키 파일 대신 그것을 쓴다', async () => {
  const vault = createVault({ dir: tmp(), dpapi: fake });
  vault.setSecret('toss', 'client_id = cid\nclient_secret = csec');
  assert.deepEqual(await loadTossCredentials({ TOSS_KEY_FILE: 'C:\\없는\\경로' }, { vault }), { clientId: 'cid', clientSecret: 'csec' });
});

test('토스 토큰: 두 프로그램이 캐시 하나를 함께 쓰고, 401 을 받으면 다른 쪽이 받은 새 토큰을 먼저 쓴다', async () => {
  const dir = tmp(), vault = createVault({ dir, dpapi: fake }), cacheFile = join(dir, 'tokens', 'toss-token.json');
  let issued = 0; const live = new Set();
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/oauth2/token')) { issued++; live.clear(); const v = 'T' + issued; live.add(v); return { ok: true, status: 200, json: async () => ({ access_token: v, expires_in: 86400 }) }; }
    const bearer = String(opts.headers.Authorization || '').slice(7);
    if (!live.has(bearer)) return { ok: false, status: 401, json: async () => ({ error: { code: 'token-revoked' } }) };
    if (url.endsWith('/api/v1/accounts')) return { ok: true, status: 200, json: async () => ({ result: [{ accountType: 'BROKERAGE', accountSeq: 7 }] }) };
    return { ok: true, status: 200, json: async () => ({ result: { items: [] } }) };
  };
  const credentials = async () => ({ clientId: 'cid', clientSecret: 'cs' });
  const a = createTossTokenProvider({ fetchImpl, credentials, cacheFile, vault }), b = createTossTokenProvider({ fetchImpl, credentials, cacheFile, vault });
  assert.equal((await a.get()).value, 'T1'); assert.equal((await b.get()).value, 'T1', 'B 는 캐시에서 읽음'); assert.equal(issued, 1);
  assert.ok(isSealed(readFileSync(cacheFile)), '토큰 캐시는 암호화');
  a.invalidate('T1'); assert.equal((await a.get()).value, 'T2'); assert.equal(issued, 2);
  const reader = createTossReader({ fetchImpl, tokens: b }); // B 는 메모리에 T1 → 401 → 캐시의 T2 로 바꿔 한 번 다시
  const snap = await reader(); assert.equal(snap.positions.length, 0); assert.equal(issued, 2, '새로 받지 않고 다른 쪽 토큰을 씀');
});
