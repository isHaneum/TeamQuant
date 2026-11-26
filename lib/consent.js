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
  // 2026-11-26 사용자: 휴대폰 알림이 "뭘 말하려는지 모르겠다" → C10·C11 을 한 문단이 아니라 묶음별 줄로. 의미·의무는 그대로(되돌릴 수 없음 · 세금 책임 · 멈추는 법 · 설정이 바뀌면 다시 물음).
  //   문구가 바뀌면 그 조항의 이전 동의만 무효(textSha256 비교) — 다른 조항(C6·C9 등)은 그대로라 CONSENT_VERSION 은 올리지 않는다.
  C10: { title: '토스 계좌 자동 적립 (실제 돈 · 사기만 함)', gate: '토스 실계좌 적립 주문',
    text: p => {
      const money = n => `${Number(n).toLocaleString('ko-KR')}원`;
      const sched = { daily: '거래일마다', weekly: '매주 그 주 첫 거래일', monthly: '매달 정한 날 이후 첫 거래일' }[p.cadence] || String(p.cadence);
      return ['내 토스증권 계좌에서 아래 설정대로 실제 돈으로 사기만 합니다(팔지 않음).', '',
        '적립 설정',
        `• 종목: ${p.targets.map(t => `${t.name || t.symbol} ${t.weight}%`).join(', ')}`,
        `• 언제: ${sched}${p.time ? ` ${p.time}` : ''}`,
        `• 한 번에: ${money(p.amountKrw)} (밀린 돈까지 최대 ${money(p.maxRunKrw)}, 주문 1건 최대 ${money(p.maxOrderKrw)})`, '',
        '알아 둘 것',
        '• 예수금이 모자라거나 장이 열리지 않으면 주문하지 않습니다.',
        '• 주문이 체결되지 않거나 다른 가격에 체결될 수 있고, 체결된 주문은 되돌릴 수 없습니다.',
        '• 멈추려면 적립 설정의 paused 를 true 로 바꾸거나 STOP 파일(%LOCALAPPDATA%\\TeamQuant\\personal\\STOP)을 만듭니다.',
        '• 설정이 하나라도 바뀌면 다시 묻습니다.'].join('\n');
    } },
  C11: { title: '토스 계좌 자동 비중 맞추기 (실제 돈 · 팔기도 함)', gate: '토스 실계좌 비중 맞추기(매도·매수) 주문',
    // 2026-11-24 결정 60: 실제 동작과 맞춤 — 달러는 계획에 있는 미국 상장 종목 어디에나 쓰인다 · 고정 비중 표시 · 같은 실행 매수 · 다시 내기(chase).
    text: p => {
      const buf = p.bufPct ?? 0.3;
      return ['내 토스증권 계좌에서 아래 목표 비중에 맞춰 실제 돈으로 사고팝니다.', '',
        '목표 비중',
        ...p.targets.map(t => `• ${t.name || t.symbol} ${t.weight}%${t.fixed ? ' (고정)' : ''}`),
        `• 현금 ${p.cashPct}%`,
        ...(p.exit?.length ? [`• 모두 팔 종목: ${p.exit.join(', ')}`] : []), '',
        '주문 방식',
        `• ${p.mode === 'convert' ? '지금 비중을 목표까지 한 번에 맞춥니다.' : '분기마다, 목표에서 많이 벗어난 종목만 맞춥니다(변동성·세금을 따져 정한 폭 밖일 때만).'}`,
        '• 파는 것은 목표보다 많은 만큼만입니다. 올랐다는 이유만으로 팔지 않고, 하락 때 더 산 몫은 산 값보다 비쌀 때만 팝니다.',
        `• 지정가로 냅니다(현재가 ±${buf}%).${p.chase?.steps > 0 ? ` 안 채워지면 ${p.chase.waitSec}초마다 취소하고 남은 수량을 그때 가격으로 다시 냅니다(최대 ${p.chase.steps}번, 처음 가격보다 ${p.chase.maxPct}% 넘게 불리하면 내지 않음, 마지막 주문은 장 마감까지 유효).` : ''}`,
        `• ${p.sameRunBuy === false ? '판 돈으로 사는 주문은 다음 실행에서 냅니다.' : '판 돈이 다 들어오면 같은 실행에서 바로 삽니다(안 되면 다음 실행).'}`,
        '• 환전하지 않습니다. 달러는 계획에 있는 미국 종목에만, 원화는 국내 종목에만 씁니다.', '',
        '알아 둘 것',
        '• 보낸 주문은 되돌릴 수 없습니다.',
        '• 미국 주식에서 생긴 이익은 양도소득세 대상이고, 세금 계산·신고는 내가 합니다.',
        '• 설정이 하나라도 바뀌면 다시 묻습니다.'].join('\n');
    } },
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
