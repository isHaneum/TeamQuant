#!/usr/bin/env node
// 로컬 금고 관리(2026-11-16 · lib/vault.js). 어떤 명령도 비밀 값을 화면에 출력하지 않는다(이름·줄 수·개수만).
//   node scripts/vault.mjs status                         금고 상태와 데이터 파일의 암호화 여부(개수)
//   node scripts/vault.mjs import <이름> <파일>             키 파일 내용을 금고 비밀로 저장(kis · dart · toss · llm …). 원본 파일은 지우지 않는다.
//   node scripts/vault.mjs import-env <env파일> <변수...>   .env 파일에 직접 적힌 키 줄을 금고 비밀 'env' 로 옮기고 그 줄을 env 파일에서 지운다
//   node scripts/vault.mjs set <이름>                      새로 발급한 키를 숨김 입력으로 저장(이름표=값 줄을 넣고 빈 줄로 끝)
//   node scripts/vault.mjs migrate [--dry]                 PC 데이터 파일(장부 · 토큰 · 보유 기록 · 현금 · 계획 · 성과 · 적립 장부)을 암호화본으로 바꾼다
//                                                          ※ PC 서버(8766)와 적립 작업이 돌지 않을 때만 실행한다(평문을 읽는 옛 코드가 덮어쓸 수 있음)
//   node scripts/vault.mjs export-recovery <파일>           복구 파일(TQR1) + 키 목록 사본을 만든다(패스프레이즈 두 번 · 오프라인 USB 에 보관)
//   node scripts/vault.mjs import-recovery <파일>           다른 PC·새 프로필에서 KEK 를 되살린다
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { getVault, isSealed, atomicWriteSync, vaultRoot } from '../lib/vault.js';

const env = process.env, root = vaultRoot(env), cmd = process.argv[2] || 'status', args = process.argv.slice(3);
const vault = getVault(env); if (!vault) { console.error('금고를 쓸 수 없습니다(Windows 아님 또는 TEAMQUANT_VAULT=off).'); process.exit(2); }

/** 숨김 입력(화면에 글자가 보이지 않음). */
function hidden(prompt, { multiline = false } = {}) {
  return new Promise(res => {
    let muted = false; const out = new Writable({ write(c, e, cb) { if (!muted) process.stdout.write(c, e); cb(); } });
    const rl = createInterface({ input: process.stdin, output: out, terminal: true }), lines = [];
    process.stdout.write(prompt); muted = true;
    rl.on('line', l => { if (!multiline) { rl.close(); process.stdout.write('\n'); res(l); return; } if (!l.trim()) { rl.close(); process.stdout.write('\n'); res(lines.join('\n')); return; } lines.push(l); process.stdout.write(`\n  (${lines.length}줄 받음 · 끝내려면 빈 줄)\n`); });
  });
}

/** 알려진 데이터 파일 → 금고 용도. 저장소 코드(lib/*)가 쓰는 용도와 같아야 한다. */
function dataFiles() {
  const out = [], add = (file, purpose) => { if (existsSync(file) && statSync(file).isFile()) out.push({ file, purpose }); };
  const list = d => { try { return readdirSync(d); } catch { return []; } };
  const pl = env.TEAMQUANT_PAPER_DIR || join(root, 'paper-live');
  for (const n of list(pl)) {
    const f = join(pl, n);
    if (n === 'kis-vps-token.json') add(f, 'tokens/kis-vps');
    else if (n === 'kis-prod-token.json') add(f, 'tokens/kis-prod');
    else if (/^(kis-vps|kis-prod|real)-[A-Za-z0-9]+\.json$/.test(n)) add(f, 'ledgers/' + n.slice(0, -5).toLowerCase());
    else if (/^(kis-vps|kis-prod|real)-.+\.bak-.+\.json$/.test(n)) add(f, ('ledgers/backup-' + n.slice(0, -5).toLowerCase().replace(/[^a-z0-9._-]/g, '-')).slice(0, 72));
  }
  const ph = env.TEAMQUANT_HISTORY_DIR || join(root, 'portfolio-history');
  add(join(ph, '.identity-salt'), 'history/identity-salt');
  for (const n of list(join(ph, 'records'))) if (/^[a-f0-9]{64}\.history\.json$/.test(n)) add(join(ph, 'records', n), 'history/record');
  add(join(ph, 'cash', 'cash-ledger.json'), 'history/cash');
  for (const n of list(join(ph, 'investments'))) { if (/\.investment\.json$/.test(n)) add(join(ph, 'investments', n), 'history/investment'); if (n === 'planning-intent.json') add(join(ph, 'investments', n), 'history/planning-intent'); }
  for (const d of [join(ph, 'performance'), join(ph, 'performance', 'archive')]) for (const n of list(d)) if (/\.performance\.json$/.test(n)) add(join(d, n), 'history/performance');
  add(join(root, 'personal', 'toss-dca.json'), 'ledgers/toss-dca');
  add(join(root, 'tokens', 'toss-token.json'), 'tokens/toss');
  return out;
}

try {
  if (cmd === 'status') {
    const s = vault.status(), files = dataFiles(), sealed = files.filter(f => isSealed(readFileSync(f.file)));
    console.log(`금고 폴더: ${s.dir}\nKEK(DPAPI): ${s.kek ? '있음' : '아직 없음'} · 보호: ${s.protector} · 데이터 키 ${s.keys}개`);
    console.log(`비밀: ${s.secrets.length ? s.secrets.join(', ') : '없음'}`);
    const by = {}; for (const f of files) { const k = f.purpose.split('/')[0] + '/' + (isSealed(readFileSync(f.file)) ? '암호화' : '평문'); by[k] = (by[k] || 0) + 1; }
    console.log(`데이터 파일 ${files.length}개 중 암호화 ${sealed.length}개 · 평문 ${files.length - sealed.length}개 — ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
  } else if (cmd === 'import') {
    const [name, file] = args; if (!name || !file) throw new Error('사용법: import <이름> <파일>');
    const text = readFileSync(file, 'utf8'); vault.setSecret(name, text);
    if (vault.getSecret(name) !== text) throw new Error('저장 확인 실패');
    console.log(`저장: 비밀 '${name}' (${text.split(/\r?\n/).filter(l => l.trim()).length}줄). 원본 파일은 그대로 있습니다 — 키를 재발급하거나 원본을 지운 뒤에는 금고만 씁니다.`);
  } else if (cmd === 'import-env') {
    const [file, ...keys] = args; if (!file || !keys.length) throw new Error('사용법: import-env <env파일> <변수...>');
    const raw = readFileSync(file, 'utf8'), eol = raw.includes('\r\n') ? '\r\n' : '\n', lines = raw.split(/\r?\n/), moved = [], kept = [];
    for (const l of lines) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m && keys.includes(m[1])) moved.push(l.trim()); else kept.push(l); }
    if (!moved.length) throw new Error('옮길 줄이 없습니다(이미 옮겼거나 이름이 다름).');
    const prev = vault.hasSecret('env') ? vault.getSecret('env').split(/\r?\n/).filter(l => l.trim() && !keys.includes((l.match(/^([A-Za-z_][A-Za-z0-9_]*)=/) || [])[1])) : [];
    const next = [...prev, ...moved].join('\n'); vault.setSecret('env', next); if (vault.getSecret('env') !== next) throw new Error('저장 확인 실패');
    atomicWriteSync(file, Buffer.from([...kept, `# ${new Date().toISOString().slice(0, 10)}: ${moved.map(l => l.split('=')[0]).join(', ')} → 금고 비밀 'env' 로 옮김(node scripts/vault.mjs status)`].join(eol)));
    console.log(`옮김: ${moved.map(l => l.split('=')[0].trim()).join(', ')} → 금고 비밀 'env'. ${basename(file)} 에서 그 줄을 지웠습니다.`);
  } else if (cmd === 'set') {
    const [name] = args; if (!name) throw new Error('사용법: set <이름>');
    console.log(`'${name}' 에 넣을 내용을 이름표=값 줄로 붙여 넣으세요(화면에 보이지 않습니다). 빈 줄로 끝냅니다.`);
    const text = await hidden('> ', { multiline: true }); if (!text.trim()) throw new Error('입력이 없습니다.');
    vault.setSecret(name, text); console.log(`저장: 비밀 '${name}' (${text.split('\n').length}줄).`);
  } else if (cmd === 'migrate') {
    const dry = args.includes('--dry'); let done = 0, skip = 0;
    for (const { file, purpose } of dataFiles()) {
      const buf = readFileSync(file); if (isSealed(buf)) { skip++; continue; }
      if (dry) { console.log(`  바꿀 것: ${basename(dirname(file))}/${basename(file)} → ${purpose}`); done++; continue; }
      const sealed = vault.seal(purpose, buf); if (!vault.open(sealed, purpose).equals(buf)) throw new Error('암호화 확인 실패: ' + file);
      atomicWriteSync(file, sealed); done++;
    }
    console.log(`${dry ? '(연습) ' : ''}암호화본으로 바꿈 ${done}개 · 이미 암호화 ${skip}개`);
  } else if (cmd === 'export-recovery') {
    const [out] = args; if (!out) throw new Error('사용법: export-recovery <파일>');
    const p1 = await hidden('복구 패스프레이즈(12자 이상, 화면에 안 보임): '), p2 = await hidden('한 번 더: ');
    if (p1 !== p2) throw new Error('두 입력이 다릅니다.');
    writeFileSync(out, vault.exportRecovery(p1), { flag: 'wx' }); copyFileSync(join(root, 'keys', 'keyring.v1.json'), out + '.keyring.json');
    console.log(`복구 파일: ${resolve(out)} (+ .keyring.json). 오프라인 USB 두 곳에 두고, 패스프레이즈는 다른 곳에 보관하세요. OneDrive·메일 금지.`);
  } else if (cmd === 'import-recovery') {
    const [file] = args; if (!file) throw new Error('사용법: import-recovery <파일>');
    const ringBackup = file + '.keyring.json', ring = join(root, 'keys', 'keyring.v1.json');
    if (!existsSync(ring) && existsSync(ringBackup)) { atomicWriteSync(ring, readFileSync(ringBackup)); console.log('키 목록을 복구 파일 옆 사본에서 되살렸습니다.'); }
    const r = vault.importRecovery(readFileSync(file), await hidden('복구 패스프레이즈: '));
    console.log(r.restored ? 'KEK 를 되살려 이 PC 의 DPAPI 로 다시 감쌌습니다.' : '이 PC 의 KEK 와 같습니다(바꾸지 않음).');
  } else { console.log('명령: status | import <이름> <파일> | import-env <env> <변수...> | set <이름> | migrate [--dry] | export-recovery <파일> | import-recovery <파일>'); process.exitCode = 2; }
} catch (e) { console.error(`실패: ${e.message}`); process.exitCode = 1; }
