// 로컬 금고(2026-11-16 법률·보안 검토). PC 에 남는 비밀(증권사·API 키), 토큰, 장부(실계좌 포함), 기록을 암호화해 둔다. PC 서버 전용(vercel.json 에서 막음).
// 키 계층: Windows DPAPI(CurrentUser) → KEK 32바이트 → 용도별 DEK 32바이트(secrets · tokens · ledgers · history).
//   DPAPI 는 PowerShell/.NET ProtectedData 를 자식 프로세스로 부른다. npm 의존성이 없고, 값은 표준 입출력으로만 오간다(명령줄 인수에 싣지 않음).
// 파일 형식 TQE1: 'TQE1'(4) · 판(1)=1 · 알고리즘(1)=1(AES-256-GCM) · 키ID 길이(1)+키ID · 용도 길이(1)+용도 · nonce(12) · 암호문 · 태그(16).
//   헤더(TQE1 ~ 용도)는 AAD 로 묶는다. 그래서 헤더를 바꾸거나 다른 용도의 파일과 바꿔치기하면(예: 장부 ↔ 비밀) 복호화가 실패한다.
// 한계(명시): 같은 Windows 사용자로 도는 코드는 DPAPI 를 똑같이 풀 수 있다. 악성코드, 로그인 세션 원격 장악, 메모리 덤프는 막지 못한다.
//   이 금고가 막는 것은 다른 계정, 디스크 분실(BitLocker 와 함께), 클라우드 동기화·공개 저장소·로그로 새는 사고다.
// 복구: DPAPI 키는 이 PC·이 프로필에 묶인다. 비밀번호 재설정·재설치 때를 위해 KEK 를 패스프레이즈(scrypt N=2^17, r=8, p=1)로 감싼 복구 파일을 따로 둔다.
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes as cryptoRandomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export class VaultError extends Error { constructor(message, code = 'vault_error') { super(message); this.code = code; } }

const MAGIC = Buffer.from('TQE1', 'latin1'), RMAGIC = Buffer.from('TQR1', 'latin1'), CLASSES = ['secrets', 'tokens', 'ledgers', 'history'];
const PURPOSE = /^(secrets|tokens|ledgers|history)\/[a-z0-9][a-z0-9._-]{0,62}$/;
const SECRET = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** 비밀이 담긴 process.env 를 자식 프로세스에 넘기지 않기 위한 최소 환경. */
export function minimalEnv(env = process.env, extra = {}) {
  const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'USERNAME', 'COMSPEC', 'ComSpec', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'PSModulePath', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'TZ'];
  const out = {}; for (const k of keep) if (env[k] !== undefined) out[k] = env[k];
  return { ...out, ...extra };
}

export const isSealed = buf => Buffer.isBuffer(buf) && buf.length >= 4 && buf.subarray(0, 4).equals(MAGIC);
export const vaultRoot = (env = process.env) => env.TEAMQUANT_VAULT_DIR || join(env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'TeamQuant');

/** 원자적 쓰기: 같은 폴더의 임시 파일 → fsync → 이름 바꾸기. 백신·색인기가 잠깐 잡고 있으면(EPERM/EACCES/EBUSY) 1초까지 다시 시도한다. */
export function atomicWriteSync(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${cryptoRandomBytes(4).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); return; }
    catch (e) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || i >= 10) { try { unlinkSync(tmp); } catch { } throw e; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
  }
}

/** Windows DPAPI(CurrentUser) — PowerShell 5.1 의 .NET ProtectedData. 스크립트와 데이터는 stdin 으로, 결과는 stdout(base64)으로만 오간다. */
export function dpapiPowerShell({ exe = 'powershell.exe', timeout = 30000, env = process.env } = {}) {
  const run = (op, buf) => {
    const script = ["$ErrorActionPreference='Stop'", 'Add-Type -AssemblyName System.Security',
      `$d=[Convert]::FromBase64String('${buf.toString('base64')}')`, "$e=[Text.Encoding]::UTF8.GetBytes('TeamQuant.vault.v1')",
      `$o=[Security.Cryptography.ProtectedData]::${op}($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
      '[Console]::Out.Write([Convert]::ToBase64String($o))', ''].join('\n');
    let out;
    try { out = execFileSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { input: script, encoding: 'utf8', windowsHide: true, timeout, env: minimalEnv(env), stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { throw new VaultError(op === 'Protect' ? 'Windows DPAPI 로 키를 감싸지 못했습니다.' : 'Windows DPAPI 로 키를 풀지 못했습니다(다른 Windows 계정이거나 프로필이 바뀌었으면 복구 파일이 필요합니다).', 'dpapi_failed'); }
    const b = Buffer.from(String(out).trim(), 'base64'); if (!b.length) throw new VaultError('DPAPI 응답이 비었습니다.', 'dpapi_failed'); return b;
  };
  return { kind: 'dpapi-currentuser', protect: b => run('Protect', b), unprotect: b => run('Unprotect', b) };
}

function gcmSeal(key, plain, aad, nonce) { const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }); c.setAAD(aad); const ct = Buffer.concat([c.update(plain), c.final()]); return { ct, tag: c.getAuthTag() }; }
function gcmOpen(key, ct, tag, aad, nonce) {
  if (tag.length !== 16) throw new VaultError('암호문 태그 길이가 맞지 않습니다.', 'bad_tag');
  const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 }); d.setAAD(aad); d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct), d.final()]); } catch { throw new VaultError('암호문 인증에 실패했습니다(변조 · 다른 용도의 파일 · 다른 키).', 'auth_failed'); }
}

/**
 * 금고를 만든다. dir 아래 keys/(kek.v1.dpapi · keyring.v1.json)와 vault/secrets/*.tqe 를 쓴다.
 * dpapi 는 테스트에서 가짜로 바꿀 수 있다({protect, unprotect}). 값은 어디에도 출력하지 않는다.
 */
export function createVault({ dir = vaultRoot(), dpapi = dpapiPowerShell(), randomBytes = cryptoRandomBytes } = {}) {
  const keysDir = join(dir, 'keys'), kekFile = join(keysDir, 'kek.v1.dpapi'), ringFile = join(keysDir, 'keyring.v1.json'), secretsDir = join(dir, 'vault', 'secrets');
  let kekCache = null, ringCache = null; const dekCache = new Map();
  function kek() {
    if (kekCache) return kekCache;
    if (existsSync(kekFile)) { const k = dpapi.unprotect(readFileSync(kekFile)); if (k.length !== 32) throw new VaultError('KEK 길이가 맞지 않습니다.', 'bad_kek'); return (kekCache = k); }
    if (existsSync(ringFile)) throw new VaultError('키 목록은 있는데 KEK 파일이 없습니다. 복구 파일로 되살리세요(node scripts/vault.mjs import-recovery).', 'kek_missing');
    const k = randomBytes(32); atomicWriteSync(kekFile, dpapi.protect(k)); return (kekCache = k);
  }
  function ring() {
    if (ringCache) return ringCache;
    try { ringCache = JSON.parse(readFileSync(ringFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new VaultError('키 목록(keyring)을 읽지 못했습니다.', 'bad_ring'); ringCache = { version: 1, active: {}, keys: {} }; }
    return ringCache;
  }
  function wrapDek(kid, dek) { const nonce = randomBytes(12), { ct, tag } = gcmSeal(kek(), dek, Buffer.from('TQK1|' + kid), nonce); return Buffer.concat([nonce, ct, tag]).toString('base64'); }
  function unwrapDek(kid, b64) { const b = Buffer.from(b64, 'base64'); return gcmOpen(kek(), b.subarray(12, b.length - 16), b.subarray(b.length - 16), Buffer.from('TQK1|' + kid), b.subarray(0, 12)); }
  function activeKid(cls) {
    const r = ring(); if (r.active[cls] && r.keys[r.active[cls]]) return r.active[cls];
    const kid = `${cls}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`, dek = randomBytes(32);
    r.keys[kid] = { class: cls, createdAt: new Date().toISOString(), status: 'active', wrapped: wrapDek(kid, dek) }; r.active[cls] = kid;
    atomicWriteSync(ringFile, JSON.stringify(r, null, 1)); dekCache.set(kid, dek); return kid;
  }
  function dekOf(kid) { if (dekCache.has(kid)) return dekCache.get(kid); const e = ring().keys[kid]; if (!e) throw new VaultError('이 파일을 만든 키가 키 목록에 없습니다.', 'unknown_kid'); const k = unwrapDek(kid, e.wrapped); dekCache.set(kid, k); return k; }
  const header = (kid, purpose) => { const k = Buffer.from(kid, 'utf8'), p = Buffer.from(purpose, 'utf8'); return Buffer.concat([MAGIC, Buffer.from([1, 1, k.length]), k, Buffer.from([p.length]), p]); };
  function parse(buf) {
    if (!isSealed(buf) || buf.length < 4 + 3 + 1 + 12 + 16) throw new VaultError('금고 형식(TQE1)이 아닙니다.', 'not_sealed');
    if (buf[4] !== 1 || buf[5] !== 1) throw new VaultError('지원하지 않는 금고 판입니다.', 'bad_version');
    let i = 6; const kl = buf[i++], kid = buf.toString('utf8', i, i + kl); i += kl; const pl = buf[i++], purpose = buf.toString('utf8', i, i + pl); i += pl;
    if (buf.length < i + 12 + 16) throw new VaultError('금고 파일이 잘렸습니다.', 'truncated');
    return { kid, purpose, aad: buf.subarray(0, i), nonce: buf.subarray(i, i + 12), ct: buf.subarray(i + 12, buf.length - 16), tag: buf.subarray(buf.length - 16) };
  }
  const checkPurpose = p => { if (!PURPOSE.test(p)) throw new VaultError(`금고 용도 이름이 올바르지 않습니다(${p}).`, 'bad_purpose'); return p.split('/')[0]; };
  const api = {
    /** 바이트 → TQE1 암호문. */
    seal(purpose, plain) { const cls = checkPurpose(purpose), kid = activeKid(cls), h = header(kid, purpose), nonce = randomBytes(12), { ct, tag } = gcmSeal(dekOf(kid), Buffer.from(plain), h, nonce); return Buffer.concat([h, nonce, ct, tag]); },
    /** TQE1 → 바이트. 용도가 다르면 거부한다. */
    open(buf, purpose) { const f = parse(buf); if (purpose && f.purpose !== purpose) throw new VaultError(`다른 용도의 금고 파일입니다(${f.purpose} ≠ ${purpose}).`, 'wrong_purpose'); return gcmOpen(dekOf(f.kid), f.ct, f.tag, f.aad, f.nonce); },
    /** 읽은 바이트를 푼다. 암호화 전 파일(평문)은 그대로 돌려주고 sealed:false 로 알린다 — 다음에 쓸 때 암호화된다. */
    decode(buf, purpose) { return isSealed(buf) ? { bytes: api.open(buf, purpose), sealed: true } : { bytes: buf, sealed: false }; },
    encodeJson(purpose, value) { return api.seal(purpose, Buffer.from(JSON.stringify(value))); },
    decodeJson(buf, purpose) { const { bytes, sealed } = api.decode(buf, purpose); return { value: JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')), sealed }; },
    readJsonFile(file, purpose) { return api.decodeJson(readFileSync(file), purpose); },
    writeJsonFile(file, purpose, value) { atomicWriteSync(file, api.encodeJson(purpose, value)); },
    /** 이름 붙은 비밀(키 파일 내용 등). */
    secretPath: name => { if (!SECRET.test(name)) throw new VaultError(`비밀 이름이 올바르지 않습니다(${name}).`, 'bad_secret_name'); return join(secretsDir, name + '.tqe'); },
    hasSecret(name) { return existsSync(api.secretPath(name)); },
    getSecret(name) { const p = api.secretPath(name); if (!existsSync(p)) return null; return api.open(readFileSync(p), 'secrets/' + name).toString('utf8'); },
    setSecret(name, text) { if (typeof text !== 'string' || !text.length) throw new VaultError('빈 비밀은 저장하지 않습니다.', 'empty_secret'); atomicWriteSync(api.secretPath(name), api.seal('secrets/' + name, Buffer.from(text, 'utf8'))); },
    deleteSecret(name) { try { unlinkSync(api.secretPath(name)); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } },
    listSecrets() { try { return readdirSync(secretsDir).filter(n => n.endsWith('.tqe')).map(n => n.slice(0, -4)).sort(); } catch { return []; } },
    /** 값 없는 상태 요약. */
    status() { const r = existsSync(ringFile) ? ring() : { active: {}, keys: {} }; return { dir, kek: existsSync(kekFile), protector: dpapi.kind || 'custom', classes: Object.fromEntries(CLASSES.map(c => [c, r.active[c] || null])), keys: Object.keys(r.keys).length, secrets: api.listSecrets() }; },
    /** 복구 파일(TQR1): KEK 를 패스프레이즈 유도키로 감싼다. 헤더(scrypt 매개변수·salt)는 AAD 로 묶는다. */
    exportRecovery(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.length < 12) throw new VaultError('패스프레이즈는 12자 이상이어야 합니다.', 'weak_passphrase');
      const salt = randomBytes(16), nonce = randomBytes(12), head = Buffer.concat([RMAGIC, Buffer.from([1, Math.log2(SCRYPT.N), SCRYPT.r, SCRYPT.p]), salt]);
      const key = scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT), { ct, tag } = gcmSeal(key, kek(), head, nonce); return Buffer.concat([head, nonce, ct, tag]);
    },
    /** 복구 파일로 KEK 를 되살려 이 PC 의 DPAPI 로 다시 감싼다. 이미 KEK 가 있으면 같은 키일 때만 통과한다. */
    importRecovery(buf, passphrase) {
      if (!(Buffer.isBuffer(buf) && buf.length === 4 + 4 + 16 + 12 + 32 + 16 && buf.subarray(0, 4).equals(RMAGIC) && buf[4] === 1)) throw new VaultError('복구 파일 형식(TQR1)이 아닙니다.', 'bad_recovery');
      const head = buf.subarray(0, 24), N = 2 ** buf[5], r = buf[6], p = buf[7], salt = buf.subarray(8, 24);
      if (N > 2 ** 20 || r > 16 || p > 4) throw new VaultError('복구 파일의 scrypt 매개변수가 허용 범위를 넘습니다.', 'bad_recovery');
      const key = scryptSync(String(passphrase).normalize('NFC'), salt, 32, { N, r, p, maxmem: SCRYPT.maxmem });
      const k = gcmOpen(key, buf.subarray(36, 68), buf.subarray(68), head, buf.subarray(24, 36));
      if (existsSync(kekFile)) { if (!timingSafeEqual(kek(), k)) throw new VaultError('이 PC 에는 다른 KEK 가 이미 있습니다. 덮어쓰지 않습니다.', 'kek_conflict'); return { restored: false, same: true }; }
      atomicWriteSync(kekFile, dpapi.protect(k)); kekCache = k; return { restored: true, same: false };
    },
  };
  return api;
}

let shared;
/** 프로세스 공용 금고. Windows 가 아니거나 TEAMQUANT_VAULT=off 면 null(평문 동작 그대로). 테스트는 이 함수를 쓰지 말고 createVault 에 임시 폴더·가짜 DPAPI 를 넘긴다. */
export function getVault(env = process.env) {
  if (shared !== undefined) return shared;
  shared = env.TEAMQUANT_VAULT === 'off' || (process.platform !== 'win32' && !env.TEAMQUANT_VAULT_DIR) ? null : createVault({ dir: vaultRoot(env) });
  return shared;
}
