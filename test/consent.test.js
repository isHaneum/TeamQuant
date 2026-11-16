// PC 쪽 확인 조항 기록(lib/consent.js): 문구·매개변수가 바뀌면 다시 묻고, 기록을 고치면 무효가 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createConsentLog, PUBLISH_SCOPE, clauseText, CONSENT_VERSION } from '../lib/consent.js';
import { createVault, isSealed } from '../lib/vault.js';

const fake = { kind: 'fake', protect: b => Buffer.concat([Buffer.from('F'), b]), unprotect: b => b.subarray(1) };
const dca = { targets: [{ symbol: '000001', name: '예시 ETF', weight: 100 }], cadence: 'daily', amountKrw: 10000, maxRunKrw: 20000, maxOrderKrw: 20000, bufferPct: 0.5, live: true, time: '14:10' };

test('동의: 체크하지 않으면 무효, 동의하면 유효, 매개변수가 바뀌면 다시 무효', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-consent-')), log = createConsentLog({ file: join(dir, 'c.json'), vault: createVault({ dir, dpapi: fake }) });
  assert.equal(log.valid('C6', PUBLISH_SCOPE), false);
  log.decline('C6', PUBLISH_SCOPE); assert.equal(log.valid('C6', PUBLISH_SCOPE), false);
  log.accept('C6', PUBLISH_SCOPE); assert.equal(log.valid('C6', PUBLISH_SCOPE), true);
  assert.equal(log.valid('C6', { ...PUBLISH_SCOPE, fields: [...PUBLISH_SCOPE.fields, '실계좌'] }), false, '공개 범위가 바뀌면 다시 물음');
  log.accept('C10', dca); assert.equal(log.valid('C10', dca), true);
  assert.equal(log.valid('C10', { ...dca, amountKrw: 15000 }), false, '금액이 바뀌면 다시 물음');
  assert.match(clauseText('C10', dca), /10,000원/);
  log.withdraw('C6', PUBLISH_SCOPE); assert.equal(log.valid('C6', PUBLISH_SCOPE), false);
  assert.ok(isSealed(readFileSync(join(dir, 'c.json'))), '기록은 암호화');
});

test('동의: 안쪽 값(종목 코드)만 바뀌어도 다시 묻고 · 결정 경로(via)를 남기고 · 예전 방식 해시 체인도 그대로 맞다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-consent-')), file = join(dir, 'c.json');
  // 2026-11-16 이전 canon 으로 만든 기록(납작한 항목)이 새 코드에서도 검증되는지
  const sha = s => createHash('sha256').update(String(s).normalize('NFC').replace(/\s+/g, ' ').trim()).digest('hex'), oldCanon = v => JSON.stringify(v, Object.keys(v || {}).sort());
  const e0 = { clause: 'C6', ver: CONSENT_VERSION, textSha256: sha(clauseText('C6', PUBLISH_SCOPE)), paramsSha256: sha(oldCanon(PUBLISH_SCOPE)), decidedAt: '2026-11-16T05:00:00.000Z', choice: 'accept', prevHash: null }; e0.hash = sha(oldCanon({ ...e0 }));
  writeFileSync(file, JSON.stringify({ schema: 1, entries: [e0] }));
  const log = createConsentLog({ file }); assert.equal(log.verify(), true); assert.equal(log.valid('C6', PUBLISH_SCOPE), true, '예전 C6 동의는 그대로 유효');
  const e = log.accept('C10', dca, { via: 'telegram:42' }); assert.equal(e.via, 'telegram:42'); assert.equal(log.verify(), true); assert.equal(log.valid('C10', dca), true);
  assert.equal(log.valid('C10', { ...dca, targets: [{ ...dca.targets[0], symbol: '000002' }] }), false, '종목 코드만 바뀌어도 다시 물음');
  assert.equal(log.latest('C10', dca).same, true); assert.equal(log.latest('C10', { ...dca, time: '10:05' }).same, false); assert.equal(log.latest('C13'), null);
});

test('동의: 기록을 고치면 해시 체인이 깨져 모든 동의가 무효', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-consent-')), file = join(dir, 'c.json'), log = createConsentLog({ file });
  log.accept('C9'); log.accept('C6', PUBLISH_SCOPE); assert.equal(log.valid('C9'), true);
  const d = JSON.parse(readFileSync(file, 'utf8')); d.entries[0].choice = 'accept'; d.entries[0].decidedAt = '2020-01-01T00:00:00.000Z'; writeFileSync(file, JSON.stringify(d));
  assert.equal(log.verify(), false); assert.equal(log.valid('C9'), false); assert.equal(log.valid('C6', PUBLISH_SCOPE), false);
});
