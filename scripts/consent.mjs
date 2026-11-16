#!/usr/bin/env node
// PC 쪽 확인 조항(C6 모의계좌 공개 · C7 키 보관 · C8 본인 계좌 · C9 실계좌 조회 · C13 나이)을 직접 읽고 결정한다(2026-11-16).
//   node scripts/consent.mjs            지금 상태(조항마다 동의 여부)
//   node scripts/consent.mjs review     아직 동의하지 않았거나 문구가 바뀐 조항을 하나씩 보여 주고 묻는다('동의' 라고 입력해야 동의)
//   node scripts/consent.mjs withdraw C6   그 조항 동의를 철회(공개·실계좌 기록은 다음 실행부터 멈춘다)
// 토스 실거래 자동주문(C10)은 적립 모듈에서 묻는다: node personal/toss-dca/toss-dca.mjs consent
import { createInterface } from 'node:readline/promises';
import { getVault } from '../lib/vault.js';
import { createConsentLog, PC_CLAUSES, PUBLISH_SCOPE, clauseText } from '../lib/consent.js';

const ids = ['C6', 'C7', 'C8', 'C9', 'C13'], params = id => (id === 'C6' ? PUBLISH_SCOPE : {});
const log = createConsentLog({ vault: getVault() }), cmd = process.argv[2] || 'status';
const line = id => `${id} ${PC_CLAUSES[id].title} — ${log.valid(id, params(id)) ? '동의함' : '동의 없음'} · 막는 것: ${PC_CLAUSES[id].gate}`;
try {
  if (!log.verify()) throw new Error('동의 기록의 해시 체인이 맞지 않습니다(파일이 바뀜). 기록을 확인하세요.');
  if (cmd === 'status') for (const id of ids) console.log(line(id));
  else if (cmd === 'review') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (const id of ids) {
      if (log.valid(id, params(id))) { console.log(`${id} 이미 동의함(같은 문구) — 건너뜀`); continue; }
      console.log(`\n[${id}] ${PC_CLAUSES[id].title}\n${clauseText(id, params(id))}\n`);
      const a = (await rl.question("동의하면 '동의' 라고 입력하세요(그 밖의 입력은 거절로 기록): ")).trim();
      const e = a === '동의' ? log.accept(id, params(id)) : log.decline(id, params(id)); console.log(`→ ${e.choice === 'accept' ? '동의' : '거절'} 기록(${e.decidedAt})`);
    }
    rl.close(); console.log(''); for (const id of ids) console.log(line(id));
  } else if (cmd === 'withdraw') {
    const id = process.argv[3]; if (!ids.includes(id)) throw new Error(`철회할 조항: ${ids.join(' · ')}`);
    log.withdraw(id, params(id)); console.log(`${id} 동의를 철회했습니다. ${PC_CLAUSES[id].gate} 은(는) 다음 실행부터 멈춥니다.`);
  } else { console.log('명령: status | review | withdraw <조항>'); process.exitCode = 2; }
} catch (e) { console.error(`실패: ${e.message}`); process.exitCode = 1; }
