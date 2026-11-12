// 한투 모의계좌의 공개 스냅샷(브라우저·Node 공용).
// 모의계좌는 가상 돈(1억)이라 누가 봐도 괜찮다. PC 서버가 status() 를 이 모양으로 줄여 data/paper-live-public.json 에 적고
// 저장소에 올리면, PC 연결이 없는 사람(Vercel 방문자·팀원)도 같은 계좌를 보고 과거 데이터 시뮬에 그 계획·규칙을 그대로 넣어 볼 수 있다.
// 빠지는 것: 계좌번호(가린 것 포함)·장부 파일 경로·주문 번호·증권사 응답 원문·토큰·자동 실행 메모. 남는 것: 잔고·보유·날마다 평가·계획(근거 포함)·규칙·가설·주문 요약·자동 실행 요약·시장별 계획 적용 여부·기록 해시 체인(날짜·금액·종목·수량·해시만)·비교선(국가 비중·현금 일치 지수 투자: 정의와 지수 대비 숫자 — 헤드라인은 절대 수익률이 아니라 이 차이다).
// 아래쪽 helpers(runState·invested·planGaps…)는 "지금 진행 중인가 · 계획 중 무엇이 아직 집행되지 않았나"를 화면과 홈 배너가 같은 식으로 답하게 한다.
export const PUBLIC_VERSION = 'PUB2-2026-11-10';
export const PUBLIC_LABEL = '한투 모의계좌 (팀 공용)';
export const MARKET_NAME = { KR: '국내', US: '미국' };
/** 주문 상태 → 화면 글자. 'expired' 는 그 시장 거래일이 끝난 뒤 남은 미체결을 서버가 닫은 것. */
export const ORDER_STATUS_LABEL = { sent: '보냄(미체결)', filled: '체결', partial: '일부 체결', rejected: '거부', not_found: '미확인(조회 안 됨)', unknown: '미확인', cancelled: '취소', canceled: '취소', expired: '소멸(마감)' };
export const orderStatusLabel = st => ORDER_STATUS_LABEL[st] || String(st || '—');
export const RUN_STATE_LABEL = { running: '진행 중', stopped: '정지(자동 운용 꺼짐)', killed: '전체 정지(킬 스위치)', offline: 'PC 서버 꺼짐', unknown: '서버 켜짐 · 자동 운용 미확인' };

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
// 증권사·엔진이 만든 문장(주문 오류·메모·차단 이유)에서 주문 번호(10자리)·계좌번호(8자리) 꼴의 숫자열과 "(sent · 번호)" 꼬리를 지운다. 금액은 쉼표가 있어 남는다.
const scrub = s => (s === null || s === undefined ? s : String(s).replace(/\s·\s[^)\s]*\)/g, ')').replace(/\d{7,}/g, '…'));
const marketOfSymbol = (symbol, v) => v?.market || (v?.currency ? (v.currency === 'USD' ? 'US' : 'KR') : (/^\d{6}$/.test(String(symbol)) ? 'KR' : 'US'));
const pos = p => ({ symbol: p.symbol, name: p.name || p.symbol, market: p.market || (p.currency === 'USD' ? 'US' : 'KR'), currency: p.currency || 'KRW', qty: num(p.qty), price: num(p.price), avgCost: num(p.avgCost), value: num(p.value), valueKrw: num(p.valueKrw) });
const order = o => ({ at: o.at, symbol: o.symbol, name: o.name, market: o.market || null, currency: o.currency, side: o.side, qty: num(o.qty), price: num(o.price), fx: num(o.fx), amountKrw: num(o.amountKrw), why: o.why || '', batch: o.batch || null, status: o.status, filledQty: num(o.filledQty) || 0, avgPrice: num(o.avgPrice), remaining: num(o.remaining), error: o.error ? scrub(String(o.error).slice(0, 160)) : undefined, note: o.note ? scrub(o.note) : undefined });
const hyp = h => ({ id: h.id, public: h.public !== false, approvedAt: h.approvedAt || null, symbol: h.symbol, name: h.name, currency: h.currency, market: h.market, capPct: h.capPct, horizonMonths: h.horizonMonths, thesis: h.thesis, breakIf: h.breakIf || '', evidence: h.evidence || [], openedAt: h.openedAt, closesAt: h.closesAt, closedAt: h.closedAt || null, status: h.status, closeNote: h.closeNote || '', verdict: h.verdict || null, entryPrice: num(h.entryPrice), price: num(h.price), qty: num(h.qty), returnPct: num(h.returnPct), indexPct: num(h.indexPct), excessPct: num(h.excessPct), daysOpen: num(h.daysOpen), expired: Boolean(h.expired) });
// 자동 실행 요약: 시각·시장·이유·보냄·차단·할 일 수만. 메모·주문 목록·증권사 응답은 뺀다(주문 번호가 섞일 수 있다).
const autoRec = a => { const key = String(a.key || ''); return { key: a.key, at: a.at, market: a.market || (/^(KR|US):/.test(key) ? key.slice(0, 2) : null), reason: a.reason ? String(a.reason).slice(0, 120) : '', rebalance: Boolean(a.rebalance), sent: num(a.sent) ?? 0, blocked: num(a.blocked) ?? 0, items: typeof a.items === 'number' ? a.items : Array.isArray(a.items) ? a.items.length : null }; };
// 시장별 계획 적용 여부(서버가 주면). boolean 또는 {applied, at, version} 둘 다 받는다.
// 해시 체인 항목: 봉인된 payload 의 키만 그대로 옮긴다(값은 손대지 않는다 — 바꾸면 공개 파일로 다시 계산한 해시가 맞지 않는다). lib/paper-chain.js entryFor 가 만드는 키와 같아야 한다.
const chainEntry = e => ({ date: e.date, prevHash: e.prevHash, hash: e.hash, payload: e.payload && typeof e.payload === 'object' ? { date: e.payload.date, total: e.payload.total, cash: e.payload.cash, stock: e.payload.stock, funding: e.payload.funding, fx: e.payload.fx, positions: (e.payload.positions || []).map(p => ({ symbol: p.symbol, qty: p.qty })), fills: (e.payload.fills || []).map(f => ({ symbol: f.symbol, side: f.side, qty: f.qty, avgPrice: f.avgPrice })) } : null });
// 비교선(결정 21): 정의(이름·국가 비중·현금·다리 종목)와 숫자(절차·비교선 수익률·차이 %p·구간)만. 다른 키(메모 등)는 옮기지 않고 error 는 엔진의 고정 문구만 남긴다.
const leg = l => (l && typeof l === 'object' ? { symbol: String(l.symbol || ''), name: String(l.name || l.symbol || ''), currency: String(l.currency || 'KRW') } : null);
// 수익 숫자는 null 을 지켜야 한다(num(null) 은 0 — 보류를 '0%p' 로 보이게 하면 안 된다).
const nnum = v => (v === null || v === undefined ? null : num(v));
const benchmarkRec = b => (b && typeof b === 'object' ? { version: b.version || null, label: String(b.label || ''), weights: { KR: num(b.weights?.KR) ?? 0, US: num(b.weights?.US) ?? 0, cash: num(b.weights?.cash) ?? 0 }, legs: { KR: leg(b.legs?.KR), US: leg(b.legs?.US) }, ownRetPct: nnum(b.ownRetPct), benchRetPct: nnum(b.benchRetPct), diffPp: nnum(b.diffPp), days: num(b.days) ?? 0, from: b.from || null, asOf: b.asOf || null, error: b.error ? scrub(String(b.error).slice(0, 120)) : null } : null);
const appliedRec = v => v === null || v === undefined ? null : typeof v === 'boolean' ? { applied: v, at: null, version: null } : typeof v === 'object' ? { applied: typeof v.applied === 'boolean' ? v.applied : typeof v.ok === 'boolean' ? v.ok : null, at: v.at || null, version: v.version || null } : null;

/** paper-live status() → 공개 스냅샷. 계좌번호·경로·주문 번호를 뺀다. */
export function publicSnapshot(status, { asOf = new Date().toISOString(), label = PUBLIC_LABEL } = {}) {
  const s = status || {}, b = s.balance || null, marks = Array.isArray(s.marks) ? s.marks.map(m => ({ date: m.date, total: num(m.total), cash: num(m.cash), stock: num(m.stock), ...(num(m.funding) ? { funding: num(m.funding) } : {}) })) : [];
  const positions = (b?.positions || []).map(pos), total = num(b?.total);
  for (const p of positions) p.weightPct = total && p.valueKrw !== null ? p.valueKrw / total * 100 : null;
  const planDoc = s.planDoc ? { version: s.planDoc.version, asOf: s.planDoc.asOf, cashPct: s.planDoc.cashPct, reservePct: s.planDoc.reservePct ?? null, waitingPct: s.planDoc.waitingPct ?? null, method: s.planDoc.method || [], caps: s.planDoc.caps || null, weights: s.planDoc.weights || {}, concentration: s.planDoc.concentration || null, validation: s.planDoc.validation || null, criteria: Array.isArray(s.planDoc.criteria) ? s.planDoc.criteria : null, backtest: s.planDoc.backtest || null, screening: s.planDoc.screening || null, sources: s.planDoc.sources || [] } : null;
  const first = marks[0] || null, last = marks.at(-1) || null;
  return {
    version: PUBLIC_VERSION, engine: s.version || null, label, asOf, mode: 'vps', public: true,
    since: first?.date || null, days: marks.length, startTotal: first?.total ?? null, total: last?.total ?? total,
    markets: s.markets || null, market: s.market || null, killSwitch: Boolean(s.killSwitch), limits: s.limits || null, fx: num(s.fx),
    balance: b ? { cash: num(b.cash), cashRawKrw: num(b.cashRawKrw), usFundingKrw: num(b.usFundingKrw) ?? 0, cashUsd: num(b.cashUsd), total, stock: num(b.stock), positions, usError: b.usError ? true : null } : null,
    error: s.error ? '잔고를 읽지 못해 마지막 기록을 보여 줍니다.' : null, markStale: Boolean(s.markStale), rulesVersion: s.rulesVersion || null,
    ordersToday: (s.ordersToday || []).map(order), recentOrders: (s.recentOrders || []).map(order),
    runs: (s.runs || []).map(r => ({ at: r.at, blockedReasons: Object.fromEntries(Object.entries(r.blockedReasons || {}).map(([k, v]) => [scrub(k), num(v) ?? 0])), actions: r.actions, sent: r.sent, rejected: r.rejected, unknown: r.unknown, blocked: r.blocked, planSource: r.planSource, rebalance: Boolean(r.rebalance) })),
    auto: (s.auto || []).map(autoRec),
    settings: s.settings && typeof s.settings === 'object' ? { auto: typeof s.settings.auto === 'boolean' ? s.settings.auto : null } : null,
    planVersion: s.planVersion && typeof s.planVersion === 'object' ? { KR: s.planVersion.KR || null, US: s.planVersion.US || null } : null,
    planApplied: s.planApplied && typeof s.planApplied === 'object' ? { KR: appliedRec(s.planApplied.KR), US: appliedRec(s.planApplied.US) } : null,
    sleeve: s.sleeve ? { n: num(s.sleeve.n) ?? 0, excessPp: num(s.sleeve.excessPp), items: (s.sleeve.items || []).map(i => ({ symbol: i.symbol, name: i.name, since: i.since, returnPct: num(i.returnPct), indexPct: num(i.indexPct), excessPct: num(i.excessPct), step: num(i.step), targetPct: num(i.targetPct) })) } : null,
    issues: (s.issues || []).map(i => ({ symbol: i.symbol, name: i.name || i.symbol, level: i.level, factor: num(i.factor), reason: scrub(i.reason), source: i.source || null, date: i.date || null, at: i.at || null, until: i.until || null })),
    marks, prefs: s.prefs ? { rules: s.prefs.rules, cadence: s.prefs.cadence, sectorCap: s.prefs.sectorCap ?? null, prefs: s.prefs.prefs || null, savedAt: s.prefs.savedAt || null } : null,
    hypotheses: (s.hypotheses || []).filter(h => h.public !== false).map(hyp), hiddenHypotheses: (s.hypotheses || []).filter(h => h.public === false).length,
    activity30: s.activity30 || null, integrity: s.integrity ? { ok: Boolean(s.integrity.ok), items: (s.integrity.items || []).map(i => ({ key: i.key, label: i.label, count: num(i.count) ?? 0, target: num(i.target) ?? 0 })), notFound: s.integrity.notFound ?? 0, rejected: s.integrity.rejected ?? 0, pending: s.integrity.pending ?? 0, leftOpen: s.integrity.leftOpen ?? undefined, orders: s.integrity.orders ?? 0 } : null,
    prefsHistory: (s.prefsHistory || []).map(x => ({ at: x.at, changed: x.changed || [], before: x.before, after: x.after, reason: x.reason || '', expected: x.expected || '', planVersion: x.planVersion || null })),
    baseline: s.baseline ? { at: s.baseline.at, from: s.baseline.from, capitalKrw: num(s.baseline.capitalKrw), plan: s.baseline.plan || {}, rules: s.baseline.rules || null, planVersion: s.baseline.planVersion || null } : null,
    // 기록 해시 체인(2026-11-12): 항목·검증 결과·봉인 뒤 바뀐 지난 평가점 메모(엔진이 쓴 문장만 · 숫자열은 스크럽). 공개 파일만으로 `node scripts/kis-paper.mjs verify` 가 다시 검증한다.
    chain: (Array.isArray(s.chain) ? s.chain : []).map(chainEntry), chainCheck: s.chainCheck && typeof s.chainCheck === 'object' ? { ok: Boolean(s.chainCheck.ok), days: num(s.chainCheck.days) ?? 0, brokenAt: s.chainCheck.brokenAt || null, reason: s.chainCheck.reason ? scrub(String(s.chainCheck.reason).slice(0, 160)) : null } : null,
    chainBreaks: (Array.isArray(s.chainBreaks) ? s.chainBreaks : []).map(b => ({ date: b.date, at: b.at || null, note: scrub(String(b.note || '').slice(0, 160)) })),
    // 비교선(2026-11-12 결정 21): 헤드라인은 '지수 대비 diffPp' 만. startTotal·total 은 그대로 두되(PUB2 호환) 화면은 이를 작은 보조 글자로만 쓴다.
    benchmark: benchmarkRec(s.benchmark),
    planVersionNow: s.planVersionNow || null, defaultPlanVersion: s.defaultPlanVersion || null, hasDefaultPlan: Boolean(s.hasDefaultPlan), planDoc
  };
}

// ── 시각(KST·뉴욕) ─────────────────────────────────────────────
const KST = 'Asia/Seoul', NY = 'America/New_York', WD = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' };
const parts = (ms, tz) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms))) p[x.type] = x.value; p.hour = p.hour === '24' ? '00' : p.hour; return p; };
/** ISO → 'YYYY-MM-DD HH:mm'(KST). 날짜는 늘 절대값으로 쓴다. */
export function kstStamp(iso) { const ms = Date.parse(iso); if (!iso || !Number.isFinite(ms)) return iso ? String(iso).slice(0, 16).replace('T', ' ') : ''; const p = parts(ms, KST); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; }
const zoned = (ms, tz) => { const p = parts(ms, tz); return { ymd: [Number(p.year), Number(p.month), Number(p.day)], weekend: p.weekday === 'Sat' || p.weekday === 'Sun' }; };
const fromZoned = ([y, m, d], hh, mm, tz) => { const want = Date.UTC(y, m - 1, d, hh, mm); let guess = want; for (let i = 0; i < 2; i++) { const p = parts(guess, tz); guess += want - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)); } return guess; };

/** 다음 자동 점검: 그 시장의 다음 거래일 개장(국내 09:00 KST · 미국 09:30 뉴욕 = 겨울 23:30 · 여름 22:30 KST). 휴장일은 보지 않는다. */
export function nextChecks(pub, now = Date.now()) {
  const one = market => { const tz = market === 'KR' ? KST : NY, [hh, mm] = market === 'KR' ? [9, 0] : [9, 30]; for (let d = 0; d < 8; d++) { const z = zoned(now + d * 864e5, tz); if (z.weekend) continue; const at = fromZoned(z.ymd, hh, mm, tz); if (at <= now) continue; const k = parts(at, KST); return { market, name: MARKET_NAME[market], at: new Date(at).toISOString(), kst: `${k.year}-${k.month}-${k.day} (${WD[k.weekday] || k.weekday}) ${k.hour}:${k.minute}` }; } return null; };
  const cadence = pub?.prefs?.cadence || 'weekly', cadenceLabel = cadence === 'monthly' ? '정기 주문은 월 1회(그 달 첫 자동 실행)' : cadence === 'weekly' ? '정기 주문은 주 1회(금요일)' : `정기 주문 ${cadence}`;
  return { checks: ['KR', 'US'].map(one).filter(Boolean), cadence, cadenceLabel, note: '서버는 장이 열려 있을 때 10분마다 확인하고, 시장마다 하루 한 번만 보냅니다. 보내는 날은 정기(주간=금요일·월간=그 달 첫 실행)·계획 변경·첫 운용·규칙상 급함일 때이고, 그 밖의 날은 점검만 합니다. 표시 시각은 다음 거래일 개장이며 휴장일은 반영하지 않습니다.' };
}

/** 그 시장의 마지막 자동 실행 + 같은 시각 run 기록의 차단 이유. */
export function lastAutoFor(pub, market) {
  const a = (pub?.auto || []).filter(x => x.at && (x.market || String(x.key || '').slice(0, 2)) === market).sort((x, y) => String(x.at).localeCompare(String(y.at))).at(-1) || null; if (!a) return null;
  const run = (pub?.runs || []).map(r => ({ r, d: Math.abs(Date.parse(r.at) - Date.parse(a.at)) })).filter(x => Number.isFinite(x.d) && x.d < 5 * 60e3).sort((x, y) => x.d - y.d)[0]?.r || null;
  const reasons = Object.entries(run?.blockedReasons || {}).sort((x, y) => y[1] - x[1]);
  return { ...a, market, blockedReasons: reasons, topBlock: reasons[0]?.[0] || null };
}
/** 전체 중 마지막 자동 실행. */
export function lastAuto(pub) { const a = (pub?.auto || []).filter(x => x.at).sort((x, y) => String(x.at).localeCompare(String(y.at))).at(-1); return a ? lastAutoFor(pub, a.market || String(a.key || '').slice(0, 2)) : null; }

/** 운용 상태. 서버의 자동 운용 플래그(settings.auto)가 있으면 그것, 없으면 최근 7일 자동 실행 기록으로 추정. 마지막 평가가 2일 넘게 없으면 PC 서버 꺼짐. */
export function runState(pub, now = Date.now()) {
  const last = (pub?.marks || []).at(-1) || null, markAge = last?.date ? (now - Date.parse(`${last.date}T00:00:00+09:00`)) / 864e5 : null;
  const la = lastAuto(pub), autoAge = la ? (now - Date.parse(la.at)) / 864e5 : null;
  const flag = pub?.settings?.auto, autoOn = typeof flag === 'boolean' ? flag : autoAge !== null && autoAge <= 7 ? true : null;
  const fresh = Boolean(pub?.live) || (markAge !== null && markAge <= 2);
  const state = !pub ? 'unknown' : pub.killSwitch ? 'killed' : autoOn === false ? 'stopped' : !fresh ? 'offline' : autoOn ? 'running' : 'unknown';
  return { state, label: RUN_STATE_LABEL[state], autoOn, inferred: typeof flag !== 'boolean', lastMarkDate: last?.date || null, markAgeDays: markAge === null ? null : Math.max(0, Math.floor(markAge)), lastAuto: la, live: Boolean(pub?.live) };
}

/** 투자 비중: 현재 = 주식 ÷ 총자산, 계획 = 100 − 계획 현금 비중. */
export function invested(pub) { const b = pub?.balance, total = num(b?.total), stock = num(b?.stock), cash = num(pub?.planDoc?.cashPct); return { nowPct: total > 0 && stock !== null ? stock / total * 100 : null, planPct: cash === null ? null : 100 - cash }; }

/** 시장별 계획 적용 여부. 서버의 planApplied 가 있으면 그것, 없으면 planVersion[market] 과 planVersionNow 비교(+ 마지막 자동 실행이 전부 차단이면 미적용). */
export function planAppliedFor(pub, market) {
  const pa = pub?.planApplied?.[market]; if (pa && typeof pa.applied === 'boolean') return { applied: pa.applied, label: pa.applied ? '적용' : '미적용', at: pa.at || null, source: 'server' };
  const nowV = pub?.planVersionNow || null; if (!nowV) return { applied: null, label: '—', at: null, source: 'none' };
  const a = lastAutoFor(pub, market), v = pub?.planVersion?.[market] || (a?.reason && a.reason.includes(nowV.slice(0, 60)) ? nowV : null);
  if (v !== nowV) return { applied: false, label: v ? '미적용(이전 버전)' : '미적용', at: null, source: 'version' };
  if (a && a.sent === 0 && a.blocked > 0) return { applied: false, label: '미적용(실행했으나 전부 차단)', at: a.at, source: 'version' };
  return { applied: true, label: '적용', at: a?.at || null, source: 'version' };
}

/** 시장별 계획 비중 vs 보유 비중. 10%p 넘게 모자라면 reason 에 왜 아직인지(마지막 자동 실행 기록) 적는다. */
export function planGaps(pub) {
  const w = pub?.planDoc?.weights || {}, ps = (pub?.balance?.positions || []).filter(p => p.qty > 0), total = num(pub?.balance?.total);
  return ['KR', 'US'].map(market => {
    const planPct = Object.entries(w).filter(([k, v]) => v?.pct > 0 && marketOfSymbol(k, v) === market).reduce((s, [, v]) => s + v.pct, 0);
    const heldPct = total > 0 ? ps.filter(p => (p.market || (p.currency === 'USD' ? 'US' : 'KR')) === market).reduce((s, p) => s + (p.valueKrw || 0), 0) / total * 100 : null;
    const a = lastAutoFor(pub, market), name = MARKET_NAME[market];
    const reason = planPct > 0 && heldPct !== null && planPct - heldPct >= 10 ? (!a ? '아직 자동 실행 전' : a.sent === 0 && a.blocked > 0 ? `${kstStamp(a.at)} 자동 실행에서 ${name} 주문 ${a.blocked}건 전부 차단${a.topBlock ? ` — ${a.topBlock}` : ''}` : a.sent > 0 ? `${kstStamp(a.at)} 자동 실행 보냄 ${a.sent}건 · 차단 ${a.blocked}건 — 미체결 또는 다음 실행 대기` : `${kstStamp(a.at)} 자동 실행 · 할 일 없음으로 판정`) : null;
    return { market, name, planPct: Math.round(planPct * 10) / 10, heldPct: heldPct === null ? null : Math.round(heldPct * 10) / 10, gapPct: heldPct === null ? null : Math.round((planPct - heldPct) * 10) / 10, reason, lastAuto: a };
  });
}
/** 계획에는 있지만 보유하지 않은 종목(목표 비중·이유). */
export function plannedNotHeld(pub) {
  const w = pub?.planDoc?.weights || {}, held = new Set((pub?.balance?.positions || []).filter(p => p.qty > 0).map(p => p.symbol));
  return Object.entries(w).filter(([k, v]) => v?.pct > 0 && !held.has(k)).map(([symbol, v]) => {
    const market = marketOfSymbol(symbol, v), o = (pub?.recentOrders || []).filter(x => x.symbol === symbol && x.at).sort((x, y) => String(x.at).localeCompare(String(y.at))).at(-1) || null, a = lastAutoFor(pub, market);
    const reason = o ? `${kstStamp(o.at)} ${o.side === 'BUY' ? '매수' : '매도'} ${o.qty ?? ''}주 ${orderStatusLabel(o.status)}` : a ? (a.sent === 0 && a.blocked > 0 ? `${kstStamp(a.at)} 자동 실행 차단${a.topBlock ? ' — ' + a.topBlock : ''}` : `${kstStamp(a.at)} 자동 실행 뒤에도 미보유(1주 미만·미체결)`) : '아직 집행 전';
    return { symbol, name: v.name || symbol, pct: v.pct, currency: v.currency || (market === 'US' ? 'USD' : 'KRW'), market, reason };
  }).sort((a, b) => b.pct - a.pct);
}
/** 보유 중이지만 계획에 없는 종목 코드(정리 대상). */
export function heldNotPlanned(pub) { const w = pub?.planDoc?.weights || {}; return (pub?.balance?.positions || []).filter(p => p.qty > 0 && !(w[p.symbol]?.pct > 0)).map(p => p.symbol); }

/** 체결된 주문을 토스 주문 모양으로(성적표·월별 자산 계산이 그 모양을 읽는다). */
export function tossOrdersFrom(orders = []) {
  return orders.filter(o => ['filled', 'partial'].includes(o.status) && (o.filledQty || 0) > 0).map((o, i) => {
    const q = o.filledQty, px = o.avgPrice || o.price, at = o.at;
    return { ref: `paper${i}-${o.symbol}`, symbol: o.symbol, side: o.side, status: 'FILLED', orderType: 'LIMIT', timeInForce: 'DAY', currency: o.currency, quantity: q, orderAmount: null, limitPrice: o.price, orderedAt: at, canceledAt: null,
      execution: { filledQuantity: q, averageFilledPrice: px, filledAmount: q * px, commission: 0, tax: 0, filledAt: at, settlementDate: null } };
  });
}

/** 공개 스냅샷 → 화면 모듈이 읽는 자산 스냅샷(teamquant:asset-snapshot). demo 표식을 함께 켜서 PC 를 묻지 않게 하고, paper 표식으로 모의계좌임을 구분한다. paperMeta.run·investedPct 로 홈 배너가 "진행 중인가"에 답한다. */
export function assetSnapshotFrom(pub, { fetchedAt = pub?.asOf, now = Date.now() } = {}) {
  const fx = pub?.fx || null, b = pub?.balance;
  const positions = (b?.positions || []).filter(p => p.qty > 0 && p.price > 0).map(p => { const cost = p.avgCost > 0 ? p.qty * p.avgCost : null, value = p.qty * p.price; return { symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.qty, avgCost: p.avgCost ?? null, price: p.price, cost: cost ?? value, value, pnl: cost === null ? 0 : value - cost, returnPct: cost ? (value / cost - 1) * 100 : 0, dailyPnl: null }; });
  const cashKrw = (b?.cash || 0) + (fx && b?.cashUsd ? b.cashUsd * fx : 0);
  const orders = tossOrdersFrom(pub?.recentOrders || []).reverse();
  const rs = runState(pub, now), inv = invested(pub);
  return { source: `${pub?.label || PUBLIC_LABEL} · 실제 돈 아님`, fetchedAt: fetchedAt || new Date().toISOString(), fx: fx ? { midRate: fx, asOf: '모의계좌 조회 환율' } : null, positions, totals: [], cashKnown: true,
    demo: true, paper: true, demoCash: Math.round(cashKrw), paperMeta: { label: pub?.label || PUBLIC_LABEL, asOf: pub?.asOf || null, since: pub?.since || null, days: pub?.days || 0, startTotal: pub?.startTotal ?? null, total: pub?.total ?? null, live: Boolean(pub?.live), planVersion: pub?.planVersionNow || null, cadence: pub?.prefs?.cadence || 'weekly', run: { state: rs.state, label: rs.label, lastMarkDate: rs.lastMarkDate }, investedPct: inv.nowPct, planInvestedPct: inv.planPct, lastAutoAt: rs.lastAuto?.at || null },
    demoOrders: { query: { from: pub?.since || null, to: (fetchedAt || '').slice(0, 10), status: 'CLOSED', symbol: '' }, orders, totals: [], pages: 1, paginationComplete: true, issue: null, fetchedAt: fetchedAt || new Date().toISOString(), source: '모의계좌 체결', notice: '' } };
}

/** 공개 스냅샷의 기본 계획 → 과거 데이터 시뮬 입력(바구니 + 비중 계획). */
export function planBasketFrom(pub) {
  const w = pub?.planDoc?.weights || {}; const basket = [], plan = {};
  for (const [symbol, v] of Object.entries(w)) { if (!(v?.pct > 0)) continue; basket.push({ symbol, name: v.name || symbol, currency: v.currency || (/^\d{6}$/.test(symbol) ? 'KRW' : 'USD') }); plan[symbol] = v.pct; }
  return { basket, plan, cashPct: pub?.planDoc?.cashPct ?? Math.max(0, 100 - Object.values(plan).reduce((a, b) => a + b, 0)), version: pub?.planDoc?.version || null };
}
/** 공개 스냅샷의 지금 보유 → 바구니(비중은 균등). */
export function heldBasketFrom(pub) { return (pub?.balance?.positions || []).filter(p => p.qty > 0).map(p => ({ symbol: p.symbol, name: p.name, currency: p.currency })); }
