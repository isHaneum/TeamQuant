// PC 쪽 확인 조항 기록(lib/consent.js): 문구·매개변수가 바뀌면 다시 묻고, 기록을 고치면 무효가 된다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConsentLog, PUBLISH_SCOPE, clauseText } from '../lib/consent.js';
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

test('동의: 기록을 고치면 해시 체인이 깨져 모든 동의가 무효', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-consent-')), file = join(dir, 'c.json'), log = createConsentLog({ file });
  log.accept('C9'); log.accept('C6', PUBLISH_SCOPE); assert.equal(log.valid('C9'), true);
  const d = JSON.parse(readFileSync(file, 'utf8')); d.entries[0].choice = 'accept'; d.entries[0].decidedAt = '2020-01-01T00:00:00.000Z'; writeFileSync(file, JSON.stringify(d));
  assert.equal(log.verify(), false); assert.equal(log.valid('C9'), false); assert.equal(log.valid('C6', PUBLISH_SCOPE), false);
});
