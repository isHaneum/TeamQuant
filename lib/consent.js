// 사용자 확인 조항 — PC 쪽(2026-11-16 법률 검토 · worklogs 의 consent-clauses.md C6·C7·C8·C9·C10·C13). PC 서버 전용(vercel.json 에서 막음).
// 원칙: 미리 체크된 동의 없음 · 조항마다 따로 묻고 따로 기록 · 문구나 매개변수(공개 범위 · 자동주문 금액 등)가 바뀌면 이전 동의는 무효라 다시 묻는다.
// 기록: 추가만 하는 해시 체인 {clause, ver, textSha256, paramsSha256, decidedAt, choice, prevHash, hash}. 금고(vault)가 있으면 암호화(history/consent).
// 법적 성격: 동의를 받아도 서비스의 법적 성격(투자자문·일임 해당 여부 등)은 바뀌지 않는다. 이 기록은 '확인했다'는 사실과 시점을 남기는 장치다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync, vaultRoot } from './vault.js';

export const CONSENT_VERSION = '2026-11-16.1';
const sha = s => createHash('sha256').update(String(s).normalize('NFC').replace(/\s+/g, ' ').trim()).digest('hex');
// 2026-11-16 고침: 예전 canon(JSON.stringify(v, 최상위 키 목록))은 안쪽 객체의 키를 버렸다 → C10 의 종목 코드만 바뀌면 다시 묻지 않았다.
//   납작한 객체(기록 항목 · C6 범위 · 빈 매개변수)는 예전과 같은 문자열이 나오므로 기존 해시 체인과 동의는 그대로 유효하다.
const sortDeep = v => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v);
const canon = v => JSON.stringify(sortDeep(v));

/** PC 쪽 조항 문구. 바꾸면 CONSENT_VERSION 을 올린다(이전 동의는 자동으로 무효). */
export const PC_CLAUSES = {
  C6: { title: '모의계좌 공개 동의(계좌 명의자)', gate: '모의계좌 공개 스냅샷 게시',
    text: p => `내 한국투자증권 모의계좌(가상 돈)의 보유 종목·거래 내역·수익률을 ${p.cadence === 'daily' ? '하루 한 번' : p.cadence} 웹사이트와 공개 GitHub 저장소에 공개합니다. 공개 항목: ${p.fields.join(', ')}. 계좌번호·주문번호·실계좌 정보는 넣지 않습니다. 공개를 멈춰도 이미 공개된 기록과 다른 사람이 만든 사본은 지울 수 없습니다.` },
  C7: { title: 'API 키 보관·암호화·책임', gate: '안내(차단 없음)',
    text: () => '증권사 앱키·시크릿과 접속 토큰은 이 PC 에만 암호화해 저장합니다(Windows DPAPI · AES-256-GCM 금고). 팀 서버·GitHub·노션·AI 서비스로 보내지 않습니다. 키에는 주문 권한이 있을 수 있으니 남에게 주거나 빌려주지 않습니다. 유출이 의심되면 바로 증권사에서 키를 폐기하고 다시 발급받습니다. 같은 Windows 계정으로 도는 악성코드는 이 암호화로 막을 수 없습니다.' },
  C8: { title: '본인 계좌·본인 키만', gate: '안내(차단 없음)',
    text: () => '내 명의 계좌와 내가 발급한 키만 연결합니다. 다른 사람의 계좌나 키를 받아 조회하거나 대신 주문하지 않습니다. 증권사 API 로 받은 정보는 본인 매매 목적에만 쓰고 다른 사람에게 배포하지 않습니다.' },
  C9: { title: '실계좌 연결(조회 전용)', gate: '실계좌 자동 기록(25분마다 조회)',
    text: () => '실계좌는 잔고와 보유 종목만 읽습니다. 이 연결에는 주문 기능이 없습니다. 다만 증권사 키 자체에는 주문 권한이 있을 수 있어서 \'조회 전용\'은 이 앱 코드가 지키는 제한입니다. 실계좌 정보는 이 PC 에만 암호화해 저장하고 공개하지 않습니다.' },
  C10: { title: '실거래 자동주문(내 돈 · 내 토스증권 계좌)', gate: '토스 실계좌 적립 주문',
    text: p => `거래일마다 아래 설정대로 내 토스증권 계좌에 실제 돈으로 매수 주문을 냅니다. 종목: ${p.targets.map(t => `${t.name || t.symbol} ${t.weight}%`).join(', ')} · 주기: ${p.cadence} · 1회 금액: ${Number(p.amountKrw).toLocaleString('ko-KR')}원 · 한 번에 쓸 수 있는 최대: ${Number(p.maxRunKrw).toLocaleString('ko-KR')}원 · 주문 1건 최대: ${Number(p.maxOrderKrw).toLocaleString('ko-KR')}원 · 실행: 거래일 ${p.time}. 예수금이 모자라거나 거래가 멈추면 주문이 나가지 않습니다. 주문이 나가도 체결되지 않거나 다른 가격에 체결될 수 있고, 체결된 주문은 이 앱에서 되돌릴 수 없습니다. 멈추려면 %LOCALAPPDATA%\\TeamQuant\\personal\\STOP 파일을 만들거나 설정의 paused 를 true 로 바꿉니다. 설정을 하나라도 바꾸면 다시 확인해야 주문이 나갑니다.` },
  C13: { title: '나이 확인(만 19세 이상)', gate: '안내(차단 없음)',
    text: () => '실계좌 연결·API 키 입력·자동주문은 만 19세 이상만 씁니다. 나는 만 19세 이상입니다.' },
};
/** 모의계좌 공개 범위(C6 매개변수). 공개 항목을 바꾸면 이 값을 바꾼다 → 다시 동의. */
export const PUBLISH_SCOPE = { targets: ['website', 'github'], cadence: 'daily', fields: ['보유 종목·비중', '주문·체결(번호 제외)', '평가점·수익률', '계획·규칙·이슈 상태'] };

export function clauseText(id, params = {}) { const c = PC_CLAUSES[id]; if (!c) throw new Error(`없는 조항: ${id}`); return c.text(params); }
export const consentFile = (env = process.env) => join(vaultRoot(env), 'consent', 'consent-log.json');

/** 동의 기록. vault 가 있으면 암호화. */
export function createConsentLog({ file = consentFile(), vault = null, now = () => new Date() } = {}) {
  const load = () => { if (!existsSync(file)) return { schema: 1, entries: [] }; const buf = readFileSync(file); return vault ? vault.decodeJson(buf, 'history/consent').value : JSON.parse(buf.toString('utf8')); };
  const save = d => { if (vault) vault.writeJsonFile(file, 'history/consent', d); else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(d, null, 1)); } };
  /** via: 어디서 결정했는지(예: 'pc-cli', 'telegram:<메시지 번호>'). 해시에 들어간다. */
  function record(id, params, choice, via) {
    const text = clauseText(id, params), d = load(), prev = d.entries.at(-1)?.hash || null;
    const e = { clause: id, ver: CONSENT_VERSION, textSha256: sha(text), paramsSha256: sha(canon(params)), decidedAt: now().toISOString(), choice, prevHash: prev };
    if (via) e.via = String(via).slice(0, 80);
    e.hash = sha(canon({ ...e })); d.entries.push(e); save(d); return e;
  }
  function verify() { let prev = null; for (const e of load().entries) { const { hash, ...rest } = e; if (e.prevHash !== prev || sha(canon(rest)) !== hash) return false; prev = hash; } return true; }
  /** 이 조항의 마지막 결정 + 그 결정이 지금 문구·매개변수에 대한 것인지(same). */
  function latest(id, params = {}) {
    const last = [...load().entries].reverse().find(e => e.clause === id); if (!last) return null;
    return { ...last, same: last.ver === CONSENT_VERSION && last.textSha256 === sha(clauseText(id, params)) && last.paramsSha256 === sha(canon(params)) };
  }
  return {
    entries: () => load().entries,
    accept: (id, params = {}, { via } = {}) => record(id, params, 'accept', via),
    decline: (id, params = {}, { via } = {}) => record(id, params, 'decline', via),
    withdraw: (id, params = {}, { via } = {}) => record(id, params, 'withdraw', via),
    latest,
    /** 지금 문구·매개변수에 대한 마지막 결정이 accept 이고 체인이 온전할 때만 true. */
    valid(id, params = {}) { if (!verify()) return false; const l = latest(id, params); return Boolean(l && l.same && l.choice === 'accept'); },
    verify,
  };
}
