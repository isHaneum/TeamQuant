// 모의계좌 실행 엔진(PC 서버 전용): 규칙·계획으로 오늘 할 일을 정하고(evaluate), 할 일마다 매매 전 확인(preTradeCheck)과
// 주문 보호(order-guard)를 통과한 것만 한투 모의계좌에 지정가로 보낸다. 국내(KRX)와 미국(NASD·NYSE·AMEX) 종목을 함께 다루고,
// 각 종목은 그 시장이 열려 있을 때만 주문한다. 장부는 체크아웃 밖(LOCALAPPDATA/TeamQuant/paper-live)에 남긴다.
// 설계 조건(2026-11-09 방향 메모): ① 재시작해도 주문·체결 보존 ② 같은 신호가 여러 번 와도 중복 제출 없음 ③ 응답이 끊기면 재주문 전에 증권사 목록을 먼저 확인
// ④ 부분 체결·미체결·취소 구분 ⑤ 장이 닫혔거나 시세·잔고·환율을 못 읽으면 보류(fail-closed) ⑥ 전체 정지(킬 스위치) ⑦ 모의 키만(실전 키는 클라이언트가 거부).
import { evaluate, preTradeCheck, normalizeRules, planPctOf } from './core-rules.js';
import { buildEngine } from './core-risk.js';
import { checkOrder, DEFAULT_LIMITS } from './order-guard.js';
import { marketOpen, roundTick, marketOf, marketableLimit } from './kis-orders.js';
import { systemCheck } from './paper-integrity.js';
import { sealEntry, verifyChain } from './paper-chain.js';
import { benchmarkDefinition, createBenchmarkReader, compare as compareBenchmark, BENCHMARK_HOLD_REASON } from './paper-benchmark.js';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const PAPER_LIVE_VERSION = 'L6-2026-11-10';
const PENDING = ['sending', 'sent', 'partial', 'unknown', 'cancel_requested'];
// 같은 날 같은 종목에 새 주문을 막는 상태: 끝나지 않은 주문 + 접수되지 않은 것으로 '본' 주문(not_found). 접수 안 됐다는 확인은 증권사가 주지 않으므로 그날은 다시 내지 않는다.
const BLOCKING = [...PENDING, 'not_found'];
// 한도를 쓰지 않은(끝난) 상태. 'expired' = 그 시장 거래일이 끝났는데 증권사에 남은 수량이 있던 당일 주문(한투 모의 주문은 당일만 유효) — 다음 날 같은 종목 주문을 막지 않는다.
const DEAD = ['rejected', 'cancelled', 'not_found', 'expired'];
// 자동 실행에서 "다음 거래일에 다시 시도할 만한" 차단 이유(한도·장 시작 전후·끝나지 않은 주문·시세·예수금·환율·킬 스위치). 이 이유로만 전부 막혔으면 계획을 집행한 것으로 적지 않는다.
const RETRY_BLOCK = /오늘 주문 합계|장 시작|장이 끝났|마감 10분|주말|끝나지 않은 주문|접수 여부를 확인하지|현재가를 받지 못해|주문 가능 수량|환율|킬 스위치|중복 방지|거래정지|상한가|하한가/;
const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
const nyDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.parse(iso)));
// 거래일: 국내 주문은 KST 날짜, 미국 주문은 뉴욕 날짜. 미국 장은 KST 자정을 넘기므로 KST 날짜로 세면 같은 세션에 두 번 낼 수 있다.
// 주문번호 비교: 접수 응답은 10자리(앞 0 채움), 체결 목록은 앞 0 을 뗀 번호로 온다(모의 서버 2026-11-12 확인 — 이 차이로 미국 체결 5건이 끝내 매칭되지 않았다).
const odnoKey = v => String(v ?? "").replace(/^0+/, "");
const sameOdno = (a, b) => a != null && b != null && odnoKey(a) !== "" && odnoKey(a) === odnoKey(b);
const tradeDateOf = o => ((o.market || (/^\d{6}$/.test(String(o.symbol)) ? 'KR' : 'US')) === 'US' ? nyDate(o.at) : kstDate(o.at));
const hash8 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); };
const shiftDays = (ymd, n) => new Date(Date.parse(ymd) + n * 864e5).toISOString().slice(0, 10);
const US_RE = /^[A-Z][A-Z.\-]{0,9}$/;

export function ledgerDir(env = process.env) { return env.TEAMQUANT_PAPER_DIR || join(env.LOCALAPPDATA || env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'TeamQuant', 'paper-live'); }
/** 계좌별 JSON 장부. 임시 파일에 쓴 뒤 바꿔치기해 중간에 꺼져도 깨지지 않는다. prefix 기본 'kis-vps'(모의) · 실계좌 읽기 전용 기록은 'kis-prod' 로 다른 파일을 쓴다(섞이지 않게). */
export function createLedgerStore(dir, { prefix = 'kis-vps' } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = acc => join(dir, `${prefix}-${acc}.json`);
  return {
    path: file,
    load(acc) { try { return JSON.parse(readFileSync(file(acc), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    save(acc, ledger) { const tmp = file(acc) + '.tmp'; writeFileSync(tmp, JSON.stringify({ ...ledger, updatedAt: new Date().toISOString() })); renameSync(tmp, file(acc)); }
  };
}

/**
 * @param client  createKisClient() 결과(모의 전용)
 * @param store   createLedgerStore() 결과
 * @param readMarket (symbol, range) → {candles:[{date,open,close}]}  (lib/market.js fetchHeldMarketSeries). 'KRW=X' 로 환율도 읽는다.
 * @param defaultPlan () → plan | null  (요청에 계획이 없을 때 쓸 기본 계획, 예: data/paper-plan.json)
 * @param limits  order-guard 한도 덮어쓰기(선택)
 */
export function createPaperLive({ client, store, readMarket, defaultPlan = () => null, defaultPlanVersion = () => null, defaultPlanDoc = () => null, thesisCard = null, now = () => Date.now(), limits = {}, principalKrw = null, prefsCooldownDays = 0 } = {}) {
  const acc = String(client.settings().accountMasked || '').slice(-4) || 'none';
  const L = { ...DEFAULT_LIMITS, ...limits, allowLive: false };
  const iso = () => new Date(now()).toISOString(), todayYmd = () => kstDate(iso()), todayFor = market => (market === 'US' ? nyDate(iso()) : todayYmd());
  const fresh = () => ({ version: PAPER_LIVE_VERSION, mode: 'vps', account: client.settings().accountMasked, killSwitch: false, orders: [], runs: [], marks: [] });
  let ledger = store.load(acc) || fresh(); if (!ledger.marks) ledger.marks = []; if (!ledger.auto) ledger.auto = {}; if (!ledger.planVersion) ledger.planVersion = {}; if (!ledger.hypotheses) ledger.hypotheses = []; if (!ledger.prefs) ledger.prefs = null;
  // 기록 해시 체인(2026-11-12). 옛 장부(chain 없음)는 빈 체인으로 시작해 새 코드가 처음 돈 날이 첫 항목이다. 지난 평가점(marks)을 되메우지 않는다: 되메운 항목은 그날 적은 것이 아니므로 봉인 시각을 꾸미는 일이 된다.
  if (!Array.isArray(ledger.chain)) ledger.chain = []; if (!Array.isArray(ledger.chainBreaks)) ledger.chainBreaks = [];
  const persist = () => store.save(acc, ledger);
  // 비교선 정의(2026-11-12 결정 21): 기준선의 계획에서 국가 비중·현금 비중만 뽑은 것이라 시각이 붙은 기록이 아니라 '정의'다. 그래서 체인과 달리 옛 장부(baseline 에 benchmark 없음)에도 지금 만들어 넣어도 꾸미는 것이 없다.
  if (ledger.baseline && !ledger.baseline.benchmark) { ledger.baseline.benchmark = benchmarkDefinition(ledger.baseline.plan || {}); persist(); }
  const openToday = sym => ledger.orders.find(o => o.symbol === sym && BLOCKING.includes(o.status) && tradeDateOf(o) === todayFor(marketOf(sym)));
  if (!ledger.prefsHistory) ledger.prefsHistory = [];
  /** 최근 30일 활동: 매매 '결정' 횟수(보통 주문은 건마다, 재조정 묶음은 1회)는 규칙 상한에 쓰고, 실제 주문·체결 건수와 회전율은 따로 보여 준다. 묶음을 1회로 세는 것은 계획 전환을 가능하게 하려는 정책이지 주문이 한 번이라는 뜻이 아니다. */
  function activity30() {
    // 체결 건수는 체결 수량 기준: 일부 체결 뒤 소멸(expired)된 주문도 산 만큼은 체결이다.
    const within = o => now() - Date.parse(o.at) < 30 * 864e5, rec = ledger.orders.filter(within), done = rec.filter(o => ['filled', 'partial'].includes(o.status) || (o.filledQty || 0) > 0);
    const decisions = rec.filter(o => !o.batch && (done.includes(o) || PENDING.includes(o.status) || o.status === 'expired')).length + new Set(rec.filter(o => o.batch && !['rejected', 'not_found', 'cancelled'].includes(o.status)).map(o => o.batch)).size;
    const tradedKrw = done.reduce((a, o) => a + (o.filledQty || 0) * (o.avgPrice || o.price || 0) * (o.fx || 1), 0);
    const recentMarks = ledger.marks.slice(-30), avgTotal = recentMarks.length ? recentMarks.reduce((a, m) => a + m.total, 0) / recentMarks.length : 0;
    return { decisions, orders: rec.filter(o => o.status !== 'rejected').length, submitted: rec.length, fills: done.length, rejected: rec.filter(o => o.status === 'rejected').length, notFound: rec.filter(o => o.status === 'not_found').length, batches: new Set(rec.filter(o => o.batch).map(o => o.batch)).size, tradedKrw: Math.round(tradedKrw), turnoverPct: avgTotal > 0 ? Math.round(tradedKrw / avgTotal * 1000) / 10 : null };
  }
  const usable = plan => plan && typeof plan === 'object' && Object.keys(plan).length ? plan : null;
  /** PC 에 저장된 규칙(세 질문 프리셋 또는 화면 저장)을 쓴다. 요청에 규칙이 오면 그것이 우선. */
  const rulesNow = rules => (rules && Object.keys(rules).length ? rules : (ledger.prefs?.rules || {}));
  const openHyp = () => ledger.hypotheses.filter(h => h.status === 'open');
  /** 기본 계획에 열린 가설을 얹는다: 가설 종목은 정한 한도(%)로, 기본 계획은 남는 비중에 맞춰 같은 비율로 줄인다. */
  // 이슈 대응(결정 26): 공시 감시(lib/issue-watch.js)가 건 상태. 주의 = 추가 매수 정지(14일), 긴급 = 계획 비중 절반 + 추가 매수 정지(30일). 핵심 지수·정리 대상에는 걸지 않는다.
  // 절반은 겹쳐 줄이지 않는다(긴급이 또 와도 0.5 그대로 · 기한만 연장). 계획 버전에 긴급 상태를 넣어 다음 열린 장에서 평소 재조정 경로(주문 보호 전부)로 줄인다. 같은 공시는 한 번만 받는다.
  const activeIssues = () => Object.entries(ledger.issues || {}).filter(([, v]) => Date.parse(v.until) > now()).map(([symbol, v]) => ({ symbol, ...v }));
  const issueOf = symbol => { const v = ledger.issues?.[symbol]; return v && Date.parse(v.until) > now() ? v : null; };
  function setIssue({ symbol, name = null, level, reason = '', source = '', date = null, link = null, sources = null } = {}) {
    const key = String(symbol || '').split('.')[0].toUpperCase(); if (!key || !['caution', 'urgent'].includes(level)) return { applied: false, why: 'bad_input' };
    const doc = defaultPlanDoc?.()?.weights?.[key]; if (doc?.role === 'core' || doc?.exit) return { applied: false, why: 'not_satellite' };
    const seenKey = hash8(`${key}|${date}|${reason}`); ledger.issueSeen = ledger.issueSeen || []; if (ledger.issueSeen.includes(seenKey)) return { applied: false, why: 'seen' };
    ledger.issueSeen.push(seenKey); if (ledger.issueSeen.length > 500) ledger.issueSeen.splice(0, ledger.issueSeen.length - 500);
    ledger.issues = ledger.issues || {}; const cur = issueOf(key), urgent = level === 'urgent' || cur?.level === 'urgent', until = new Date(now() + (urgent ? 30 : 14) * 864e5).toISOString();
    ledger.issues[key] = { name: name || cur?.name || key, level: urgent ? 'urgent' : 'caution', factor: urgent ? 0.5 : 1, noAdd: true, reason: String(reason).slice(0, 160), source, date, link, ...(sources ? { sources } : {}), at: iso(), until: cur && cur.until > until ? cur.until : until };
    ledger.issueLog = [...(ledger.issueLog || []), { at: iso(), symbol: key, level, reason: String(reason).slice(0, 160), source, date }].slice(-200);
    persist(); return { applied: true, issue: ledger.issues[key] };
  }
  function clearIssue(symbol, why = '') { const key = String(symbol || '').toUpperCase(); if (!ledger.issues?.[key]) return { cleared: false }; ledger.issueLog = [...(ledger.issueLog || []), { at: iso(), symbol: key, level: 'cleared', reason: String(why).slice(0, 160) }].slice(-200); delete ledger.issues[key]; persist(); return { cleared: true }; }
  const withIssues = plan => { const act = activeIssues().filter(i => i.factor < 1); if (!act.length) return plan; const out = { ...plan }; for (const i of act) { const v = out[i.symbol]; if (v === undefined) continue; const pct = planPctOf(v); if (pct > 0) out[i.symbol] = { ...(typeof v === 'object' ? v : {}), pct: Math.round(pct * i.factor * 10) / 10, issue: i.level }; } return out; };
  // 나눠 사기(결정 27): 위성 종목은 목표 비중(targetPct)의 60% → 80% → 100% 로 단계별로 채운다. 단계는 장부(ledger.tranche)에 있고 checkTranches 가 조건이 맞을 때만 올린다.
  const TRANCHES = [0.6, 0.2, 0.2], trancheFrac = step => TRANCHES.slice(0, step).reduce((a, b) => a + b, 0);
  const planDocW = () => defaultPlanDoc?.()?.weights || {};
  const stepOf = (sym, w) => Math.min(3, Math.max(w?.tranche || 1, ledger.tranche?.[sym]?.step || 1));
  const raised = () => Object.entries(planDocW()).filter(([sym, w]) => w.role === 'satellite' && stepOf(sym, w) > (w.tranche || 1)).map(([sym, w]) => `${sym}@${stepOf(sym, w)}`).sort();
  const withTranche = plan => { const up = raised(); if (!up.length) return plan; const out = { ...plan }, doc = planDocW(); for (const x of up) { const sym = x.split('@')[0], w = doc[sym]; if (out[sym] === undefined || !(w.targetPct > 0)) continue; out[sym] = { ...(typeof out[sym] === 'object' ? out[sym] : {}), pct: Math.round(w.targetPct * trancheFrac(stepOf(sym, w)) * 10) / 10 }; } return out; };
  let lastBench = null; // status() 가 마지막으로 계산한 지수 대비(위성 추가 매수 금지 판단용)
  const mergedPlan = base => withIssues(withTranche(mergedHyp(base)));
  function mergedHyp(base) {
    const hyps = openHyp(); if (!hyps.length) return base || {};
    const out = {}; const hypPct = hyps.reduce((a, h) => a + h.capPct, 0), core = Object.values(base || {}).reduce((a, v) => a + (planPctOf(v) || 0), 0);
    const scale = core > 0 ? Math.max(0, core - hypPct) / core : 0;
    for (const [k, v] of Object.entries(base || {})) { const pct = (planPctOf(v) || 0) * scale; if (pct >= 0.5) out[k] = { ...(typeof v === 'object' ? v : {}), pct: Math.round(pct * 10) / 10 }; }
    for (const h of hyps) { const key = String(h.symbol).split('.')[0].toUpperCase(); out[key] = { pct: Math.max(out[key]?.pct || 0, h.capPct), name: h.name, currency: h.currency, hypothesis: h.id }; }
    return out;
  }
  const rulesHash = () => (ledger.prefs ? hash8(JSON.stringify({ r: ledger.prefs.rules, c: ledger.prefs.cadence, s: ledger.prefs.sectorCap })) : null);
  const planVersionNow = () => `${defaultPlanVersion?.() || 'none'}${openHyp().length ? '+H:' + openHyp().map(h => `${h.id}@${h.capPct}`).join(',') : ''}${rulesHash() ? '+R:' + rulesHash() : ''}${activeIssues().some(i => i.factor < 1) ? '+I:' + hash8(activeIssues().filter(i => i.factor < 1).map(i => i.symbol).sort().join(',')) : ''}${raised().length ? '+T:' + hash8(raised().join(',')) : ''}`;


  /** 증권사 주문 목록과 장부를 맞춘다. 주문번호가 없는 'sending/unknown' 건은 종목·방향·수량·가격으로 찾아 번호를 붙인다(재주문 전 필수). */
  async function reconcile() {
    // 오늘 것만 보면 밤에 낸 미국 주문이 자정(KST)을 넘긴 뒤 영영 맞춰지지 않는다. 최근 4일의 끝나지 않은 주문을, 그 주문의 KST 날짜(미국 주문은 뉴욕 날짜도)로 조회한다.
    // '목록에 없음'으로 소멸 처리한 주문도 4일 안엔 다시 본다 — 조회 범위가 모자라 못 본 체결(2026-11-10 NYSE·AMEX 4건)을 스스로 바로잡기 위해서다.
    const healable = o => o.status === 'expired' && !(o.filledQty > 0) && /목록에 없음/.test(o.note || '');
    const mine = ledger.orders.filter(o => (PENDING.includes(o.status) || healable(o)) && now() - Date.parse(o.at) < 4 * 864e5);
    if (!mine.length) return { checked: 0, updated: 0 };
    const dates = [...new Set(mine.flatMap(o => [kstDate(o.at).replace(/-/g, ''), ...(o.market === 'US' ? [nyDate(o.at).replace(/-/g, '')] : [])]))];
    const raw = []; for (const d of dates) raw.push(...await client.orders(d)); // 조회 자체가 실패하면 예외 → 어떤 상태도 바꾸지 않는다(fail-closed)
    const seen = new Set(), broker = raw.filter(x => { const k = `${x.market || ''}:${odnoKey(x.odno)}`; if (!x.odno || seen.has(k)) return false; seen.add(k); return true; });
    // client.orders() 는 미국 목록 조회 실패를 삼키고 국내 목록만 돌려준다(kis-orders.js). 그래서 미국 주문이 "목록에 없다"는 것은 목록에 미국 행이 하나라도 있을 때만 증거다 — 아니면 그대로 두고(fail-closed) 다음 재조회를 기다린다.
    const usProven = raw.some(x => x.market === 'US'), absentProven = o => (o.market || marketOf(o.symbol)) !== 'US' || usProven;
    let updated = 0;
    for (const o of mine) {
      let b = o.odno ? broker.find(x => sameOdno(x.odno, o.odno)) : null;
      if (!b && !o.odno) { b = broker.find(x => x.code === o.symbol && x.side === o.side && x.qty === o.qty && Math.abs((x.price || 0) - o.price) < (o.currency === 'USD' ? 0.011 : 0.5) && !ledger.orders.some(y => y.odno && sameOdno(y.odno, x.odno))); if (b) { o.odno = b.odno; o.orgno = b.orgno; o.note = '재조회로 주문번호를 확인했습니다.'; } }
      // 거래일이 지난 당일 주문: 증권사가 아직 'open'(남은 수량 있음)으로 돌려주거나 목록에 없으면 죽은 주문이다 → 소멸(expired). 체결된 수량은 그대로 둔다. 조회가 성공한 뒤에만 여기 온다(fail-closed).
      const dayOver = tradeDateOf(o) < todayFor(o.market || marketOf(o.symbol));
      if (b) {
        o.filledQty = b.filled; o.remaining = b.remaining; o.avgPrice = b.avgPrice; if (b.reason) o.error = b.reason; o.checkedAt = iso(); updated++;
        if ((b.filled || 0) > 0 && !o.filledAt) o.filledAt = iso(); // 체결을 처음 확인한 시각(한 번만). 기록 체인은 이 KST 날짜의 항목에 체결을 넣는다 — 뉴욕 거래일로 고르면 자정 뒤 미국 체결이 닫힌 항목에 속해 빠진다(paper-chain.js).
        const stillOpen = b.status === 'open' || (b.status === 'partial' && (b.remaining ?? (b.qty - b.filled)) > 0);
        if (dayOver && stillOpen) { o.status = 'expired'; o.expiredAt = iso(); o.note = `장 마감으로 소멸(미체결 ${o.remaining ?? Math.max(0, o.qty - (o.filledQty || 0))}주${(o.filledQty || 0) > 0 ? ` · 체결 ${o.filledQty}주` : ''})`; }
        else { const wasExpired = o.status === 'expired'; o.status = b.status === 'open' ? (o.status === 'cancel_requested' ? 'cancel_requested' : 'sent') : b.status; if (wasExpired && o.status !== 'expired') { o.note = `재조회로 체결을 확인했습니다(앞서 '목록에 없음'으로 소멸 처리한 기록을 바로잡음 ${todayYmd()}).`; delete o.expiredAt; } }
      }
      else if (dayOver && absentProven(o)) { o.status = 'expired'; o.expiredAt = iso(); o.checkedAt = iso(); o.note = `장 마감으로 소멸(증권사 ${tradeDateOf(o)} 주문 목록에 없음 · 미체결 ${o.remaining ?? o.qty}주)`; updated++; }
      else if (['sending', 'unknown'].includes(o.status)) {
        // 접수되지 않았다는 것이 확인되기 전까지 재주문하지 않는다: 성공한 조회에서 10분 넘게 떨어진 두 번 모두 없어야 not_found 로 '본다'. 그 뒤에도 그날은 같은 종목에 새 주문을 내지 않는다(BLOCKING).
        o.misses = [...(o.misses || []), now()].slice(-6);
        if (o.misses.length >= 2 && o.misses.at(-1) - o.misses[0] >= 10 * 60e3 && now() - Date.parse(o.at) > 10 * 60e3) { o.status = 'not_found'; o.note = `증권사 주문 목록에 없음(성공한 조회 ${o.misses.length}회, ${Math.round((o.misses.at(-1) - o.misses[0]) / 60e3)}분 간격). 접수되지 않은 것으로 보지만 오늘은 같은 종목에 다시 주문하지 않습니다.`; updated++; }
      }
    }
    persist(); return { checked: mine.length, updated };
  }

  async function fxNow() { try { const d = await readMarket('KRW=X', '1y'); const c = (d.candles || []).filter(x => x.close > 0); return { rate: c.at(-1)?.close ?? null, candles: c.map(x => ({ date: x.date, close: x.close })) }; } catch { return { rate: null, candles: [] }; } }
  /** 통합증거금 보정. 한투 모의계좌는 미국 주식을 원화로 사도 원화 예수금을 빼지 않는다(2026-11-12 확인: 미국 매수 2,816만원 뒤에도 예수금 그대로, 외화예수금 0).
   *  그대로 두면 산 돈과 산 주식이 둘 다 자산으로 잡혀 총자산이 매수금액만큼 부풀려진다(11-11 공개 숫자 +29.9%). 외화예수금이 없는데 미국 보유가 있으면 증권사가 적은
   *  매입금액(원화)을 '정산 전 매수대금'으로 보아 현금과 총자산에서 뺀다. 달러로 샀으면(외화예수금 > 0) 빼지 않는다. 미국 매도 뒤 증권사가 원화·달러 어느 쪽으로 돌려주는지는 아직 못 봤다(첫 매도 때 확인). */
  // 미국 잔고 조회가 실패하면 증권사 클라이언트는 미국 보유분을 뺀 잔고를 돌려준다(usError). 그 잔고로 판단하면 가진 미국 종목을 또 사게 되고, 그 잔고로 평가하면 그날 기록이 틀린다.
  // 2026-11-13 15:15 게시분이 미국 5종목 없이 나갔다 → 불완전한 잔고는 '읽지 못함'으로 다룬다(주문 없음 · 평가는 마지막 값 유지).
  async function readBalance() { const b = await client.balance(); if (b?.usError) throw new Error(`미국 잔고를 읽지 못했습니다(${String(b.usError).slice(0, 80)}) · 불완전한 잔고로는 판단·기록하지 않습니다.`); return settleUs(b); }
  function settleUs(b) {
    const funding = (b.stockUsd || 0) > 0 && !((b.cashUsd || 0) > 0) && (b.usCostKrw || 0) > 0 ? Math.round(b.usCostKrw) : 0;
    return { ...b, cash: b.cash - funding, total: b.total - funding, cashRawKrw: b.cash, usFundingKrw: funding };
  }
  function mark(bal, fx) { // 하루 한 점: 원화 환산 총자산(국내 + 미국×환율 + 외화예수금×환율 − 정산 전 미국 매수대금)
    const usd = (bal.stockUsd || 0) + (bal.cashUsd || 0), d = todayYmd();
    // 해외 자산이 있는데 환율이 없으면 총자산을 알 수 없다. 새 평가점을 적지 않고 마지막 정상 평가를 '보류' 표시로 돌려준다(환율 장애가 자산 급감으로 기록되지 않게).
    if (usd > 0 && !(fx > 0)) { const last = ledger.marks.at(-1); return { ...(last || { date: d, total: Math.round(bal.total), cash: Math.round(bal.cash), stock: Math.round(bal.stock) }), stale: true, note: '환율 미확인 · 평가 보류' }; }
    const total = bal.total + (fx ? usd * fx : 0);
    const m = { date: d, total: Math.round(total), cash: Math.round(bal.cash), stock: Math.round(bal.stock + (fx ? (bal.stockUsd || 0) * fx : 0)), fx: fx || null, at: iso(), ...(bal.usFundingKrw ? { funding: bal.usFundingKrw } : {}) };
    const i = ledger.marks.findIndex(x => x.date === d); if (i >= 0) ledger.marks[i] = m; else ledger.marks.push(m); if (ledger.marks.length > 800) ledger.marks.splice(0, ledger.marks.length - 800);
    seal(m, bal);
    return m;
  }
  /** 하루 봉인: 오늘 평가점(총자산·현금·주식·정산 전 매수대금·환율)과 보유(종목·수량)·그날 체결을 전날 항목의 해시와 묶어 체인에 넣는다. 같은 날은 교체, 지난 날짜는 다시 쓰지 않고 chainBreaks 에만 적는다.
   *  규칙 본문은 lib/paper-chain.js sealEntry(실계좌 기록과 공용). */
  const seal = (m, bal) => sealEntry(ledger, m, { positions: bal.positions || [], fills: ledger.orders, at: iso() });

  /** 잔고·시세로 오늘 할 일을 정한다. plan 은 {코드|티커: pct | {pct,name}}; 국내 6자리 코드와 미국 티커를 쓴다. */
  async function decide({ rules, plan, rebalance = false }) {
    const R = { ...normalizeRules(rulesNow(rules)).rules, ...(rebalance ? { letWinnersRun: false } : {}) }, bal = await readBalance(), fx = await fxNow();
    const positions = bal.positions.map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency, market: p.market, exchange: p.exchange || null, valueKrw: p.currency === 'USD' ? (fx.rate ? (p.value || 0) * fx.rate : null) : p.valueKrw, qty: p.qty })).filter(p => Number.isFinite(p.valueKrw));
    const P = {}, skipped = [];
    for (const [k, v] of Object.entries(plan || {})) { const code = String(k).split('.')[0].toUpperCase(), pct = planPctOf(v); const kr = /^\d{6}$/.test(code), us = US_RE.test(code); if ((kr || us) && Number.isFinite(pct) && (pct > 0 || (pct === 0 && v?.exit === true))) P[code] = { pct, name: v?.name || positions.find(p => p.symbol === code)?.name || code, currency: kr ? 'KRW' : 'USD' }; else if (!(kr || us)) skipped.push(k); }
    const syms = [...new Set([...positions.map(p => p.symbol), ...Object.keys(P)])], cs = {}, meta = {}, noData = [];
    for (const s of syms) { try { const d = await readMarket(s, '2y'); cs[s] = (d.candles || []).filter(c => c.close > 0).map(c => ({ date: c.date, open: c.open, close: c.close })); } catch { cs[s] = []; } if (cs[s].length < 30) noData.push(s); const cur = marketOf(s) === 'US' ? 'USD' : 'KRW'; meta[s] = { name: positions.find(p => p.symbol === s)?.name || P[s]?.name || s, currency: cur, market: cur === 'USD' ? 'US' : 'KR' }; }
    const today = todayYmd(), engine = buildEngine(cs, meta, fx.candles, { from: shiftDays(today, -400) });
    // 위성 종목에는 200일선 규칙을 쓰지 않는다(결정 28): 살 이유는 근거 카드(성장·가치)이고, 싸진 종목은 대개 200일선 아래라 가치 기준·15% 하락 추가 매수와 부딪힌다. 지수(핵심)에는 그대로 적용.
    const risk = Object.fromEntries(syms.map(s => { const r = engine.riskAt(s, today); return [s, planDocW()[s]?.role === 'satellite' && r ? { ...r, trendApplies: false } : r]; })), portVar = h => engine.portVarAt(h, today);
    // 30일 매매 횟수: 보통 주문은 건마다, 재조정 묶음(계획 변경·첫 운용)은 묶음 하나를 1회로 센다(그렇지 않으면 17종목 계획은 상한 8회에 막혀 영영 못 맞춘다).
    const trades30 = activity30().decisions;
    const e = evaluate({ positions, cashKrw: bal.cash, rules: R, plan: P, risk, portVar, trades30 });
    const m = mark(bal, fx.rate);
    // 기준선: 처음 운용을 정한 날의 계획·규칙·총자산을 고정해 둔다. 뒤에 규칙·계획을 바꿔도 "바꾸지 않았다면"을 시뮬 엔진으로 계속 추적할 수 있다.
    // benchmark: 그 계획의 국가 비중·현금 비중으로 고정한 비교선 정의(KODEX 200·S&P500 ETF·현금). 뒤에 계획이 바뀌어도 헤드라인 '지수 대비'는 이 정의로만 잰다.
    if (!ledger.baseline) ledger.baseline = { at: iso(), from: today, capitalKrw: m.total, plan: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, { pct: v.pct, name: v.name, currency: v.currency }])), rules: { ...R, letWinnersRun: true }, planVersion: planVersionNow(), benchmark: benchmarkDefinition(P) };
    persist();
    const fxMissing = !(fx.rate > 0) && (bal.positions.some(p => p.currency === 'USD') || (bal.cashUsd || 0) > 0 || Object.values(P).some(v => v.currency === 'USD'));
    return { rules: R, plan: P, skipped, noData, bal, fx: fx.rate, positions, e, risk, portVar, trades30, mark: m, fxMissing };
  }

  /** 보내지 않고 할 일마다 통과/차단 이유를 돌려준다. */
  async function preview({ rules, plan, rebalance = false } = {}) {
    const planUsed = usable(plan) ? { plan: mergedPlan(plan), source: 'request' } : { plan: mergedPlan(usable(defaultPlan()) || {}), source: 'default' };
    const d = await decide({ rules, plan: planUsed.plan, rebalance }), markets = { KR: marketOpen(new Date(now()), 'KR'), US: marketOpen(new Date(now()), 'US') };
    try { await reconcile(); } catch (e) { /* 재조회 실패는 아래에서 미확인 주문으로 막힌다 */ }
    const items = []; let settling = d.bal.cash; const view = d.positions.map(p => ({ ...p }));
    for (const a of d.e.actions) {
      const side = a.kind === 'reduce' ? 'SELL' : 'BUY', market = marketOf(a.symbol), mk = markets[market], usd = market === 'US';
      const item = { symbol: a.symbol, name: a.name, market, currency: usd ? 'USD' : 'KRW', side, amountKrw: Math.round(a.amountKrw), why: (a.why || [])[0] || (side === 'SELL' ? '계획 비중보다 많음' : '계획 비중보다 적음'), qty: null, price: null, ok: false, blocks: [], warnings: [] };
      items.push(item);
      if (ledger.killSwitch) item.blocks.push('전체 정지(킬 스위치)가 켜져 있습니다.');
      if (d.fxMissing) { item.blocks.push('환율(KRW=X)을 읽지 못해 총자산·비중을 알 수 없습니다. 모든 주문을 보류합니다.'); continue; }
      if (!mk.open) item.blocks.push(mk.reason);
      // 위성 추가 매수 금지: 포트폴리오가 비교선보다 5%p 넘게 뒤처져 있으면 개별 종목을 더 사지 않는다(지수·매도는 그대로).
      if (side === 'BUY' && planDocW()[a.symbol]?.role === 'satellite' && lastBench?.diffPp != null && lastBench.diffPp <= -5) item.blocks.push(`위성 추가 매수 금지: 지수 대비 ${lastBench.diffPp}%p (기준 −5%p)`);
      const iss = side === 'BUY' ? issueOf(a.symbol) : null; if (iss?.noAdd) item.blocks.push(`이슈 대응: 추가 매수 정지(${iss.level === 'urgent' ? '긴급' : '주의'} · ${iss.reason} · ${String(iss.until).slice(0, 10)}까지)`);
      if (usd && !(d.fx > 0)) { item.blocks.push('환율(KRW=X)을 읽지 못해 미국 주문을 내지 않습니다.'); continue; }
      const pend = openToday(a.symbol); if (pend) item.blocks.push(pend.status === 'not_found' ? `${a.name}에 접수 여부를 확인하지 못한 주문이 있어 오늘은 다시 내지 않습니다.` : `${a.name}에 끝나지 않은 주문이 있습니다(${pend.status}${pend.odno ? ' · ' + pend.odno : ''}).`);
      let px; try { px = await client.price(a.symbol); } catch (e) { item.blocks.push(`현재가를 받지 못해 주문하지 않습니다 (${e.message})`); continue; }
      const fx = usd ? d.fx : 1; item.price = marketableLimit(px.price, side, market, L.limitBufferPct ?? 0.5); item.lastPrice = px.price; item.exchange = px.exchange || null; item.fx = usd ? d.fx : null;
      const held = d.positions.find(p => p.symbol === a.symbol);
      let qty = Math.floor(item.amountKrw / (item.price * fx)); if (side === 'SELL') qty = Math.min(qty, held?.qty || 0);
      // 정리 대상(계획 pct 0 · exit)은 전량 판다 — 금액 내림 때문에 1주가 남지 않게(결정 25). 매수가 1회 한도를 넘으면 막지 않고 한도만큼만 산다(나머지는 다음 점검 때).
      if (side === 'SELL' && d.plan[a.symbol]?.pct === 0 && held?.qty > 0) qty = held.qty;
      if (side === 'BUY' && L.maxOrderKrw > 0 && qty * item.price * fx > L.maxOrderKrw) { const cap = Math.floor(L.maxOrderKrw / (item.price * fx)); if (cap > 0) { item.warnings.push(`1회 한도에 맞춰 ${qty}주 → ${cap}주`); qty = cap; } }
      if (!(qty > 0)) { item.blocks.push(side === 'SELL' ? '팔 수량이 없습니다.' : '1주 미만이라 주문하지 않습니다.'); continue; }
      item.qty = qty; item.amountKrw = Math.round(qty * item.price * fx);
      const order = { symbol: a.symbol, name: a.name, currency: item.currency, side, amountKrw: item.amountKrw };
      const chk = preTradeCheck({ positions: view, cashKrw: settling, rules: d.rules, plan: d.plan, portVar: d.portVar, trades30: rebalance ? null : d.trades30 + items.filter(i => i.ok).length }, order, d.risk[a.symbol]);
      if (chk.error) item.blocks.push(chk.error); else for (const f of chk.failed) item.blocks.push(`${f.label}: ${f.detail}`);
      item.unknownChecks = (chk.unknown || []).map(u => u.label);
      // 하루 한도·중복은 이 주문의 시장·거래일(국내 KST, 미국 뉴욕)로 센다. 장부 주문마다 시장·거래일·상태를 붙여 보내고 묶는 일은 order-guard 가 한다.
      const g = checkOrder({ symbol: a.symbol, side, qty, limitPrice: item.price, currency: item.currency, at: iso(), mode: 'paper', market, tradeDate: todayFor(market) }, {
        limits: L, fx: d.fx, equityKrw: d.e.total, positions: d.positions.map(p => ({ symbol: p.symbol, qty: p.qty, valueKrw: p.valueKrw })), killSwitch: ledger.killSwitch, lastPrice: px.price, halted: px.halted,
        limitUp: px.upper > 0 && px.price >= px.upper, limitDown: px.lower > 0 && px.price <= px.lower, marketOpenAt: mk.openAt,
        todayOrders: ledger.orders.filter(o => !DEAD.includes(o.status) && now() - Date.parse(o.at) < 3 * 864e5).map(o => ({ key: o.key, amountKrw: o.amountKrw, at: o.at, status: o.status, market: o.market || marketOf(o.symbol), tradeDate: tradeDateOf(o) }))
      });
      item.key = g.key; item.blocks.push(...g.blocks); item.warnings.push(...g.warnings);
      if (side === 'BUY') { try { const bp = await client.buyingPower(a.symbol, item.price); const can = bp.cashQty ?? bp.maxQty; if (can !== null && can < qty) item.blocks.push(`주문 가능 수량 ${can}주 < ${qty}주 (예수금 기준)`); } catch (e) { item.blocks.push(`주문 가능 수량을 확인하지 못해 주문하지 않습니다 (${e.message})`); } }
      item.ok = item.blocks.length === 0;
      if (item.ok) { settling += side === 'SELL' ? item.amountKrw : -item.amountKrw; const vp = view.find(p => p.symbol === a.symbol); if (vp) vp.valueKrw = Math.max(0, vp.valueKrw + (side === 'SELL' ? -item.amountKrw : item.amountKrw)); else view.push({ symbol: a.symbol, name: a.name, currency: item.currency, valueKrw: item.amountKrw }); }
    }
    return { version: PAPER_LIVE_VERSION, at: iso(), account: client.settings().accountMasked, markets, market: markets.KR, killSwitch: ledger.killSwitch, limits: L, fx: d.fx, fxMissing: d.fxMissing, planSource: planUsed.source, planSize: Object.keys(d.plan).length, rebalance,
      balance: { cash: d.bal.cash, cashRawKrw: d.bal.cashRawKrw, usFundingKrw: d.bal.usFundingKrw, cashUsd: d.bal.cashUsd, total: d.mark.total, totalKrwOnly: d.bal.total, stock: d.mark.stock, positions: d.positions, usError: d.bal.usError || null },
      evaluation: { urgent: d.e.urgent, okCount: d.e.okCount, known: d.e.known, checks: d.e.checks, actions: d.e.actions.length, total: d.e.total }, items, skipped: d.skipped, noData: d.noData, trades30: d.trades30, mark: d.mark };
  }

  /** 통과한 주문만 순서대로 보낸다. 보내기 전에 장부에 'sending' 으로 먼저 적고, 응답을 못 받으면 'unknown' 으로 남겨 다음 재조회가 번호를 찾게 한다. */
  async function run({ rules, plan, dryRun = false, rebalance = false } = {}) {
    if (rebalance && !dryRun) await cancelOpen(); // 재조정은 새 목표로 다시 내므로 열린 주문을 먼저 거둔다
    const pv = await preview({ rules, plan, rebalance }); const batch = rebalance ? `RB-${todayYmd()}-${Date.now().toString(36)}` : null;
    if (dryRun) return { ...pv, dryRun: true, sent: [] };
    if (ledger.killSwitch) return { ...pv, sent: [], note: '킬 스위치가 켜져 있어 보내지 않았습니다.' };
    const sent = [];
    for (const it of pv.items.filter(i => i.ok)) {
      if (openToday(it.symbol)) continue; // 같은 실행 안에서 두 번 나가지 않게
      const rec = { key: it.key, at: iso(), symbol: it.symbol, name: it.name, market: it.market, currency: it.currency, exchange: it.exchange || null, side: it.side, qty: it.qty, price: it.price, fx: it.fx || null, amountKrw: it.amountKrw, why: it.why, batch, status: 'sending', odno: null, orgno: '', filledQty: 0, remaining: it.qty };
      ledger.orders.push(rec); persist();
      try { const r = await client.place({ code: it.symbol, side: it.side, qty: it.qty, price: it.price, exchange: it.exchange || null }); rec.odno = r.odno; rec.orgno = r.orgno; rec.exchange = r.exchange || rec.exchange; rec.status = r.odno ? 'sent' : 'unknown'; rec.brokerMsg = r.msg || ''; }
      catch (e) { rec.status = e.code === 'network' ? 'unknown' : 'rejected'; rec.error = e.message; }
      persist(); sent.push(rec);
    }
    // 차단 이유 요약 키에는 주문 번호를 남기지 않는다("(sent · 0000012345)" → "(sent)"): 이 요약이 공개 스냅샷(runs)으로 나간다.
    const blockedReasons = {}; for (const i of pv.items.filter(i => !i.ok)) { const k = String(i.blocks[0] || '기타').split(':')[0].replace(/\s·\s[^)]*\)/, ')').slice(0, 40); blockedReasons[k] = (blockedReasons[k] || 0) + 1; }
    ledger.runs.push({ at: iso(), blockedReasons, actions: pv.items.length, sent: sent.filter(r => r.status === 'sent').length, rejected: sent.filter(r => r.status === 'rejected').length, unknown: sent.filter(r => r.status === 'unknown').length, blocked: pv.items.filter(i => !i.ok).length, planSource: pv.planSource, rebalance, batch });
    if (ledger.runs.length > 200) ledger.runs.splice(0, ledger.runs.length - 200);
    persist();
    try { await reconcile(); } catch { /* 다음 status 에서 다시 맞춘다 */ }
    return { ...pv, dryRun: false, sent: sent.map(r => ({ ...r })), note: pv.items.length && !pv.items.some(i => i.ok) ? '통과한 주문이 없습니다.' : undefined };
  }

  async function cancelOpen() {
    try { await reconcile(); } catch { }
    const open = ledger.orders.filter(o => ['sent', 'partial'].includes(o.status) && o.odno && (o.remaining ?? o.qty) > 0), out = [];
    for (const o of open) { try { await client.cancel({ odno: o.odno, orgno: o.orgno, code: o.symbol, exchange: o.exchange || null, market: o.market || null }); o.status = 'cancel_requested'; o.cancelAt = iso(); out.push({ odno: o.odno, ok: true }); } catch (e) { out.push({ odno: o.odno, ok: false, error: e.message }); } }
    persist(); try { await reconcile(); } catch { }
    return out;
  }
  async function kill(on) { ledger.killSwitch = Boolean(on); ledger.killAt = iso(); persist(); const cancelled = on ? await cancelOpen() : []; return { killSwitch: ledger.killSwitch, cancelled }; }


  /**
   * 자동 실행(서버가 주기적으로 부른다). 시장마다 하루 한 번만 보내며, 보내는 날은 ① 그 시장의 주 마지막 거래일(금요일) ② 규칙이 '급함'이라 할 때
   * ③ 기본 계획 버전이 바뀐 뒤 그 시장에서 아직 안 보냈을 때 ④ 그 시장에 아직 체결이 하나도 없을 때. 그 밖의 날은 점검만 하고(1시간에 한 번) 보내지 않는다.
   * 기본 규칙(C3)과 기본 계획(data/paper-plan.json)만 쓴다. 반환 {ran, market, reason, sent, blocked} 또는 {ran:false}.
   */
  async function autoRun() {
    const t = new Date(now()), ver = planVersionNow(), cadence = ledger.prefs?.cadence || 'weekly';
    for (const market of ['KR', 'US']) {
      const mk = marketOpen(t, market); if (!mk.open) continue;
      const key = `${market}:${todayFor(market)}`; if (ledger.auto[key]) continue;
      const chk = ledger.autoChecked?.[key]; if (chk && (typeof chk === 'number' ? now() - chk < 55 * 60e3 : chk.ver === ver && now() - chk.at < 55 * 60e3)) continue; // 계획·규칙이 바뀌면 바로 다시 본다
      const pv = await preview({});
      const wd = market === 'US' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(t) : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(now() + 9 * 3600e3).getUTCDay()];
      const planChanged = Boolean(ver) && ledger.planVersion[market] !== ver, never = !ledger.orders.some(o => o.market === market && ['filled', 'partial', 'sent', 'expired'].includes(o.status));
      // 전환 잔여: 계획은 집행으로 적혔지만 정리(exit) 종목이 아직 남아 있다(지정가 미체결 등). 평소 점검은 오른 종목을 그대로 두므로(letWinnersRun) 정리 종목이 영영 남는다 → 다음 거래일에 재조정으로 다시 낸다. 계획 버전·시장마다 3번까지.
      const resKey = `${market}:${ver}`;
      const leftN = planChanged || never ? 0 : (pv.balance?.positions || []).filter(p => p.market === market && p.qty > 0 && planDocW()[p.symbol]?.role === 'exit').length;
      const residual = leftN > 0 && (ledger.residual?.[resKey] || 0) < 3;
      const kst = new Date(now() + 9 * 3600e3), monthKey = `${market}:${kst.toISOString().slice(0, 7)}`;
      const monthly = cadence === 'monthly' && !Object.keys(ledger.auto).some(k => k.startsWith(monthKey)); // 그 달에 어떤 이유로든 한 번 보냈으면 월간 점검은 끝
      const scheduled = cadence === 'weekly' ? (wd === 'Fri' ? '주간 점검(금요일)' : null) : cadence === 'monthly' ? (monthly ? '월간 점검' : null) : null;
      const reason = pv.evaluation.urgent ? '규칙상 급함' : planChanged ? `계획 변경(${ver.slice(0, 60)})` : never ? '첫 운용' : residual ? '전환 잔여(정리 종목 남음)' : scheduled;
      if (!reason) { ledger.autoChecked = { ...(ledger.autoChecked || {}), [key]: { at: now(), ver } }; persist(); continue; }
      const rebalance = Boolean(planChanged || never || residual);
      const r = await run({ rebalance }); if (residual) ledger.residual = { ...(ledger.residual || {}), [resKey]: (ledger.residual?.[resKey] || 0) + 1 };
      const sentN = r.sent.filter(x => !['rejected', 'unknown'].includes(x.status)).length, blockedItems = r.items.filter(i => !i.ok);
      // 계획을 '집행했다'고 적는 조건: 하나라도 보냈거나, 할 일이 없었거나, 막힌 것이 전부 다시 시도해도 소용없는 이유(1주 미만·팔 수량 없음·규칙 불합격)일 때.
      // 한도·장 시작 전·끝나지 않은 주문·시세·예수금 같은 이유로 전부 막혔으면 계획 버전을 적지 않아 다음 거래일 자동 실행이 다시 시도한다(같은 날 반복은 날짜 키가 막는다).
      // 막힌 이유가 '전부' 다시 시도할 만한 것일 때만 재시도 대상이다(1주 미만·1회 금액 한도 같은 이유가 하나라도 섞이면 내일도 같은 결과).
      const retryable = blockedItems.filter(i => i.blocks.length > 0 && i.blocks.every(t => RETRY_BLOCK.test(t)));
      const applied = sentN > 0 || r.items.length === 0 || retryable.length === 0;
      const note = applied ? (sentN > 0 ? `${sentN}건 전송` : r.items.length === 0 ? '할 일 없음' : `전부 막힘(${blockedItems.length}건) · 다시 시도해도 같은 결과라 집행으로 적음`) : `미집행 · ${retryable.length}건이 한도·시간·확인 문제로 막힘 → 다음 거래일 다시 시도`;
      ledger.auto[key] = { at: iso(), reason, rebalance, sent: sentN, blocked: blockedItems.length, items: r.items.length, applied, note };
      if (ver && applied) ledger.planVersion[market] = ver; persist();
      return { ran: true, market, reason, sent: sentN, blocked: blockedItems.length, items: r.items.length, applied, note };
    }
    return { ran: false };
  }
  /** 시장별로 지금 계획 버전이 집행됐는가(마지막 자동 실행에서 적어 둔 버전과 같은가). false 면 화면에 '계획 미집행'으로 보인다. */
  const planApplied = () => { const ver = planVersionNow(); return { KR: ledger.planVersion.KR === ver, US: ledger.planVersion.US === ver }; };


  /** 가설마다 진입가(가설 등록 뒤 체결 평균)·지금 가격·수익률·같은 기간 지수를 붙인다. 지수: 국내 KODEX 200, 미국 SPY. */
  // 같은 기간 지수 수익: 진입일 시가(주문은 장 시작 직후에 나간다) → 최근 종가. 진입일 봉이 아직 없으면(오늘 산 종목) null = 아직 비교 전. 2026-11-13 까지는 봉이 없을 때 1년 전 봉으로 떨어져 +42% 같은 값이 나왔고, 값이 서버가 꺼질 때까지 굳어 있었다 → 10분마다 다시 계산.
  const idxCache = new Map();
  async function indexPctSince(market, fromIso) { const sym = market === 'US' ? 'SPY' : '069500', key = `${sym}:${fromIso.slice(0, 10)}`; const hit = idxCache.get(key); if (hit && now() - hit.at < 10 * 60e3) return hit.v; let v = null; try { const d = await readMarket(sym, '1y'); const c = (d.candles || []).filter(x => x.close > 0), from = fromIso.slice(0, 10), base = c.find(x => x.date >= from); v = base ? c.at(-1).close / (base.open > 0 ? base.open : base.close) - 1 : null; } catch { } idxCache.set(key, { v, at: now() }); return v; }
  /** 헤드라인 비교(결정 21): 기준선의 비교선 정의 + 첫 평가점 → 마지막 평가점 구간의 절차·비교선 수익률과 그 차이(%p). 지수 시세 30분 캐시(성공만)·실패 시 정의와 null 숫자 — lib/paper-benchmark.js createBenchmarkReader(실계좌 기록과 공용).
   *  기준선이 없으면(아직 운용을 정하지 않음) null. status() 밖으로 던지지 않는다. */
  const benchmarkFor = createBenchmarkReader({ readMarket, now });
  // 비교 구간은 기준선 날부터: status() 는 기준선 전에도 평가점을 적으므로(현금만 든 날들) marks[0] 에서 시작하면 그 날들의 지수 변동이 영영 들어간다(2026-11-12 검토).
  const benchMarks = () => (ledger.baseline?.from ? ledger.marks.filter(m => m.date >= ledger.baseline.from) : ledger.marks);
  const benchmarkNow = () => benchmarkFor(ledger.baseline?.benchmark || null, benchMarks());
  /** 위성 묶음 성과(결정 27): 위성 종목마다 첫 매수 뒤 수익을 같은 기간 그 나라 지수와 비교하고, 평가액 가중으로 묶는다. "개별 종목을 고른 것이 지수보다 나았는가"를 따로 본다. */
  async function sleeveNow(balance) {
    const items = [];
    for (const [sym, w] of Object.entries(planDocW())) { if (w.role !== 'satellite') continue;
      const fills = ledger.orders.filter(o => o.symbol === sym && o.side === 'BUY' && (o.filledQty || 0) > 0), pos = balance?.positions?.find(p => p.symbol === sym); if (!fills.length || !(pos?.qty > 0) || !(pos.price > 0)) continue;
      const qty = fills.reduce((a, o) => a + o.filledQty, 0), entry = fills.reduce((a, o) => a + o.filledQty * (o.avgPrice || o.price), 0) / qty, since = fills[0].at, ret = pos.price / entry - 1, idx = await indexPctSince(marketOf(sym), since);
      items.push({ symbol: sym, name: w.name, since: since.slice(0, 10), entryPrice: entry, price: pos.price, returnPct: ret, indexPct: idx, excessPct: idx === null ? null : ret - idx, valueKrw: pos.valueKrw ?? null, step: stepOf(sym, w), targetPct: w.targetPct ?? null }); }
    const ok = items.filter(i => i.excessPct !== null && i.valueKrw > 0), sum = ok.reduce((a, i) => a + i.valueKrw, 0);
    return { items, n: ok.length, excessPp: sum > 0 ? Math.round(ok.reduce((a, i) => a + i.excessPct * i.valueKrw, 0) / sum * 1e4) / 100 : null };
  }
  /** 추가 매수 단계 올리기. 조건(각각 한 번): ① 첫 매수가보다 15% 하락 ② 새 분기 실적으로 다시 만든 카드가 통과 ③ 다시 만든 카드에서 가격이 자기 과거 중간값 이하. 카드가 탈락이면(근거 깨짐) · 이슈가 걸려 있으면 · 지수 대비 −5%p 이하면 올리지 않는다. */
  function checkTranches(sleeve) {
    let changed = false; ledger.tranche = ledger.tranche || {};
    for (const i of sleeve.items) { const w = planDocW()[i.symbol], card = thesisCard?.(i.symbol) || null, t = ledger.tranche[i.symbol] || (ledger.tranche[i.symbol] = { step: w.tranche || 1, used: [], base: { lastQuarter: card?.growth?.lastQuarter || null, cardAsOf: card?.asOf || null }, log: [] });
      if (stepOf(i.symbol, w) >= 3 || issueOf(i.symbol) || (card && card.verdict === 'fail') || (lastBench?.diffPp != null && lastBench.diffPp <= -5)) continue;
      const conds = [['drop15', i.price <= i.entryPrice * 0.85, '첫 매수가보다 15% 하락(근거 유지)'], ['earnings', card?.verdict === 'pass' && t.base.lastQuarter && card.growth?.lastQuarter > t.base.lastQuarter, '새 분기 실적이 성장 근거 확인'], ['median', card?.verdict === 'pass' && t.base.cardAsOf && card.asOf > t.base.cardAsOf && card.value?.pct != null && card.value.pct <= 0.5, '가격이 자기 과거 중간값 이하']];
      const hit = conds.find(([k, ok]) => ok && !t.used.includes(k)); if (!hit) continue;
      t.step = stepOf(i.symbol, w) + 1; t.used.push(hit[0]); t.log.push({ at: iso(), step: t.step, reason: hit[2] }); changed = true; }
    if (changed) persist();
  }
  async function enrichHypotheses(balance, fx) {
    const out = [];
    for (const h of ledger.hypotheses) {
      const code = String(h.symbol).split('.')[0].toUpperCase(), fills = ledger.orders.filter(o => o.symbol === code && o.side === 'BUY' && (o.filledQty || 0) > 0 && o.at >= h.openedAt); // 체결 수량 기준(일부 체결 뒤 소멸된 주문 포함)
      const qty = fills.reduce((a, o) => a + (o.filledQty || 0), 0), cost = fills.reduce((a, o) => a + (o.filledQty || 0) * (o.avgPrice || o.price), 0), entry = qty ? cost / qty : null;
      const pos = balance?.positions?.find(p => p.symbol === code), price = pos?.price ?? null, ret = entry && price ? price / entry - 1 : null;
      const idx = h.status === 'open' || h.closedAt ? await indexPctSince(h.market || marketOf(code), h.openedAt) : null;
      out.push({ ...h, entryPrice: entry, price, qty: pos?.qty ?? qty, returnPct: ret, indexPct: idx, excessPct: ret !== null && idx !== null ? ret - idx : null, daysOpen: Math.max(0, Math.round((now() - Date.parse(h.openedAt)) / 864e5)), expired: Date.parse(h.closesAt) < now() });
    }
    return out;
  }
  function setPrefs(p) {
    if (!p || typeof p !== 'object') throw Object.assign(new Error('규칙이 없습니다.'), { status: 400 }); const { rules, errors } = normalizeRules(p.rules || {}); if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
    const before = ledger.prefs ? { rules: ledger.prefs.rules, cadence: ledger.prefs.cadence, sectorCap: ledger.prefs.sectorCap } : null;
    const next = { rules, cadence: ['weekly', 'monthly', 'urgent'].includes(p.cadence) ? p.cadence : 'weekly', sectorCap: Number.isFinite(Number(p.sectorCap)) ? Number(p.sectorCap) : null };
    const changed = before ? [...Object.keys(rules).filter(k => JSON.stringify(before.rules?.[k]) !== JSON.stringify(rules[k])), ...(before.cadence !== next.cadence ? ['cadence'] : []), ...(before.sectorCap !== next.sectorCap ? ['sectorCap'] : [])] : ['init'];
    // 규칙을 자주 바꾸지 못하게 한다(결정 34): 마지막 저장 뒤 prefsCooldownDays 일 안에는 바꿀 수 없다. 처음 저장과 같은 값 저장은 예외. 바꾼 뒤 20거래일 전의 성과는 새 규칙의 평가가 아니기 때문이다.
    if (before && changed.length && prefsCooldownDays > 0 && ledger.prefs?.savedAt) { const until = Date.parse(ledger.prefs.savedAt) + prefsCooldownDays * 864e5; if (now() < until) throw Object.assign(new Error(`규칙은 저장 뒤 ${prefsCooldownDays}일 동안 바꿀 수 없습니다. ${new Date(until + 9 * 3600e3).toISOString().slice(0, 10)}부터 바꿀 수 있습니다.`), { status: 409, code: 'prefs_locked', allowedAt: new Date(until).toISOString() }); }
    // 전략 변경은 근거를 남긴다. 처음 저장은 예외. 수익률이 나빴다는 이유만의 변경은 과적합이므로 기록이 그 판단의 증거가 된다.
    if (before && changed.length && !String(p.reason || '').trim()) throw Object.assign(new Error('규칙을 바꾸는 근거를 적어 주십시오(무엇을 보고 바꾸는지).'), { status: 400 });
    ledger.prefs = changed.length ? { ...next, prefs: p.prefs || null, savedAt: iso() } : { ...ledger.prefs, prefs: p.prefs || ledger.prefs.prefs || null };
    if (changed.length) { ledger.prefsHistory.push({ at: iso(), changed, before, after: next, reason: String(p.reason || '').slice(0, 300), expected: String(p.expected || '').slice(0, 300), planVersion: planVersionNow(), lastMark: ledger.marks.at(-1)?.total ?? null }); if (ledger.prefsHistory.length > 50) ledger.prefsHistory.splice(0, ledger.prefsHistory.length - 50); }
    persist(); return { ...ledger.prefs, changed };
  }
  function hypothesis(op, item = {}) {
    if (op === 'add') {
      const code = String(item.symbol || '').split('.')[0].toUpperCase(); if (!(/^\d{6}$/.test(code) || /^[A-Z][A-Z.\-]{0,9}$/.test(code))) throw Object.assign(new Error('종목 코드가 올바르지 않습니다.'), { status: 400 });
      const cap = Number(item.capPct); if (!(cap >= 1 && cap <= 10)) throw Object.assign(new Error('가설 한도는 1~10% 사이입니다.'), { status: 400 });
      if (!String(item.thesis || '').trim()) throw Object.assign(new Error('가설(근거)을 적어 주십시오.'), { status: 400 });
      if (ledger.hypotheses.some(h => h.symbol === code && ['open', 'proposed'].includes(h.status))) throw Object.assign(new Error('같은 종목의 가설이 이미 열려 있거나 승인 대기 중입니다.'), { status: 400 });
      if (openHyp().reduce((a, h) => a + h.capPct, 0) + cap > 30) throw Object.assign(new Error('열린 가설 한도 합은 30%까지입니다.'), { status: 400 });
      const months = [3, 6, 12].includes(Number(item.horizonMonths)) ? Number(item.horizonMonths) : 6, opened = new Date(now());
      const h = { id: `H${Date.now().toString(36)}`, symbol: code, name: item.name || code, currency: marketOf(code) === 'US' ? 'USD' : 'KRW', market: marketOf(code), capPct: cap, public: item.public !== false, thesis: String(item.thesis).slice(0, 600), breakIf: String(item.breakIf || '').slice(0, 300), evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 8).map(String) : [], horizonMonths: months, openedAt: opened.toISOString(), closesAt: new Date(opened.getFullYear(), opened.getMonth() + months, opened.getDate()).toISOString(), status: item.approve === true ? 'open' : 'proposed' };
      if (h.status === 'open') h.approvedAt = h.openedAt;
      ledger.hypotheses.push(h); persist(); return h;
    }
    const h = ledger.hypotheses.find(x => x.id === item.id); if (!h) throw Object.assign(new Error('가설을 찾지 못했습니다.'), { status: 404 });
    // 승인: 가설 등록은 관심의 기록이고, 계획에 넣어 다음 장중 자동 매수로 이어지는 것은 사용자의 명시적 승인이다. 진입가·기간은 승인 시점부터 센다.
    if (op === 'approve') { if (h.status !== 'proposed') throw Object.assign(new Error('승인 대기 중인 가설만 승인할 수 있습니다.'), { status: 400 }); if (openHyp().reduce((a, x) => a + x.capPct, 0) + h.capPct > 30) throw Object.assign(new Error('열린 가설 한도 합은 30%까지입니다.'), { status: 400 }); const t = new Date(now()); h.status = 'open'; h.approvedAt = iso(); h.openedAt = h.approvedAt; h.closesAt = new Date(t.getFullYear(), t.getMonth() + h.horizonMonths, t.getDate()).toISOString(); h.approveNote = String(item.note || '').slice(0, 300); }
    else if (op === 'break') { h.status = 'broken'; h.closedAt = iso(); h.closeNote = String(item.note || '').slice(0, 300); }
    else if (op === 'close') { h.status = 'closed'; h.closedAt = iso(); h.closeNote = String(item.note || '').slice(0, 300); h.verdict = ['right', 'wrong', 'unclear'].includes(item.verdict) ? item.verdict : 'unclear'; }
    else if (op === 'remove') { if (h.status === 'proposed') { ledger.hypotheses = ledger.hypotheses.filter(x => x.id !== item.id); persist(); return h; } if (h.status === 'open') throw Object.assign(new Error('열린 가설은 먼저 깨짐·종료로 닫으십시오.'), { status: 400 }); ledger.hypotheses = ledger.hypotheses.filter(x => x.id !== item.id); }
    else throw Object.assign(new Error('지원하지 않는 작업입니다.'), { status: 404 });
    persist(); return h;
  }

  async function status() {
    let recon = null, balance = null, error = null, m = null, fx = null;
    try { recon = await reconcile(); } catch (e) { error = `재조회 실패: ${e.message}`; }
    try { const b = await readBalance(); fx = (await fxNow()).rate; m = mark(b, fx); persist(); balance = { cash: b.cash, cashRawKrw: b.cashRawKrw, usFundingKrw: b.usFundingKrw, cashUsd: b.cashUsd, total: m.total, totalKrwOnly: b.total, stock: m.stock, positions: b.positions.map(p => ({ ...p, valueKrw: p.currency === 'USD' ? (fx ? (p.value || 0) * fx : null) : p.valueKrw })), usError: b.usError || null }; } catch (e) { error = error || `잔고 조회 실패: ${e.message}`; }
    const today = ledger.orders.filter(o => kstDate(o.at) === todayYmd());
    const hyps = await enrichHypotheses(balance, fx);
    let sleeve = { items: [], n: 0, excessPp: null }; try { sleeve = await sleeveNow(balance); checkTranches(sleeve); } catch { }
    let benchmark = null; try { benchmark = await benchmarkNow(); lastBench = benchmark; } catch { benchmark = ledger.baseline?.benchmark ? { ...ledger.baseline.benchmark, ...compareBenchmark({ marks: benchMarks(), series: null }), error: BENCHMARK_HOLD_REASON } : null; }
    // 밖으로 내는 체인은 닫힌 날만: 오늘 항목은 자정까지 평가마다 바뀌므로 공개하면 같은 날짜의 해시가 커밋마다 달라져 변조와 구별되지 않는다(2026-11-12 검토). chainCheck 도 같은 조각으로 센다(공개 파일만으로 숫자가 맞아야 한다).
    const pubChain = ledger.chain.filter(e => e.date < todayYmd()).slice(-400);
    return { version: PAPER_LIVE_VERSION, prefsCooldownDays, prefsNextChangeAt: prefsCooldownDays > 0 && ledger.prefs?.savedAt ? new Date(Date.parse(ledger.prefs.savedAt) + prefsCooldownDays * 864e5).toISOString() : null, principalKrw: Number.isFinite(principalKrw) && principalKrw > 0 ? principalKrw : null, prefs: ledger.prefs, hypotheses: hyps, benchmark, planVersionNow: planVersionNow(), mode: 'vps', account: client.settings().accountMasked, markets: { KR: marketOpen(new Date(now()), 'KR'), US: marketOpen(new Date(now()), 'US') }, market: marketOpen(new Date(now()), 'KR'), killSwitch: ledger.killSwitch, limits: L, fx, balance, error, reconciled: recon,
      sleeve, tranche: Object.fromEntries(Object.entries(ledger.tranche || {}).map(([k, v]) => [k, { step: v.step, log: (v.log || []).slice(-3) }])), issues: activeIssues(), issueLog: (ledger.issueLog || []).slice(-20), ordersToday: today, recentOrders: ledger.orders.slice(-20), runs: ledger.runs.slice(-5), marks: ledger.marks.slice(-400), auto: Object.entries(ledger.auto).slice(-6).map(([k, v]) => ({ key: k, ...v })), planVersion: ledger.planVersion, planApplied: planApplied(), ledgerPath: store.path(acc), activity30: activity30(), prefsHistory: ledger.prefsHistory.slice(-10), baseline: ledger.baseline || null, integrity: systemCheck(ledger, now()), chain: pubChain, chainCheck: verifyChain(pubChain), chainBreaks: ledger.chainBreaks.slice(-50), markStale: Boolean(m?.stale), rulesVersion: rulesHash(), hasDefaultPlan: Boolean(usable(defaultPlan())), defaultPlanVersion: defaultPlanVersion?.() || null, planDoc: defaultPlanDoc?.() || null };
  }
  return { preview, run, status, kill, cancelOpen, reconcile, autoRun, setPrefs, hypothesis, setIssue, clearIssue, issues: activeIssues, _ledger: () => ledger };
}
