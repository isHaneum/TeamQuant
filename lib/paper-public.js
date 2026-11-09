// 한투 모의계좌의 공개 스냅샷(브라우저·Node 공용).
// 모의계좌는 가상 돈(1억)이라 누가 봐도 괜찮다. PC 서버가 status() 를 이 모양으로 줄여 data/paper-live-public.json 에 적고
// 저장소에 올리면, PC 연결이 없는 사람(Vercel 방문자·팀원)도 같은 계좌를 보고 과거 데이터 시뮬에 그 계획·규칙을 그대로 넣어 볼 수 있다.
// 빠지는 것: 계좌번호(가린 것 포함)·장부 파일 경로·주문 번호·증권사 응답 원문·토큰. 남는 것: 잔고·보유·날마다 평가·계획·규칙·가설·주문 요약.
export const PUBLIC_VERSION = 'PUB1-2026-11-09';
export const PUBLIC_LABEL = '한투 모의계좌 (팀 공용)';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const pos = p => ({ symbol: p.symbol, name: p.name || p.symbol, market: p.market || (p.currency === 'USD' ? 'US' : 'KR'), currency: p.currency || 'KRW', qty: num(p.qty), price: num(p.price), avgCost: num(p.avgCost), value: num(p.value), valueKrw: num(p.valueKrw) });
const order = o => ({ at: o.at, symbol: o.symbol, name: o.name, market: o.market || null, currency: o.currency, side: o.side, qty: num(o.qty), price: num(o.price), fx: num(o.fx), amountKrw: num(o.amountKrw), why: o.why || '', batch: o.batch || null, status: o.status, filledQty: num(o.filledQty) || 0, avgPrice: num(o.avgPrice), remaining: num(o.remaining), error: o.error ? String(o.error).slice(0, 160) : undefined, note: o.note || undefined });
const hyp = h => ({ id: h.id, public: h.public !== false, approvedAt: h.approvedAt || null, symbol: h.symbol, name: h.name, currency: h.currency, market: h.market, capPct: h.capPct, horizonMonths: h.horizonMonths, thesis: h.thesis, breakIf: h.breakIf || '', evidence: h.evidence || [], openedAt: h.openedAt, closesAt: h.closesAt, closedAt: h.closedAt || null, status: h.status, closeNote: h.closeNote || '', verdict: h.verdict || null, entryPrice: num(h.entryPrice), price: num(h.price), qty: num(h.qty), returnPct: num(h.returnPct), indexPct: num(h.indexPct), excessPct: num(h.excessPct), daysOpen: num(h.daysOpen), expired: Boolean(h.expired) });

/** paper-live status() → 공개 스냅샷. 계좌번호·경로·주문 번호를 뺀다. */
export function publicSnapshot(status, { asOf = new Date().toISOString(), label = PUBLIC_LABEL } = {}) {
  const s = status || {}, b = s.balance || null, marks = Array.isArray(s.marks) ? s.marks.map(m => ({ date: m.date, total: num(m.total), cash: num(m.cash), stock: num(m.stock) })) : [];
  const positions = (b?.positions || []).map(pos), total = num(b?.total);
  for (const p of positions) p.weightPct = total && p.valueKrw !== null ? p.valueKrw / total * 100 : null;
  const planDoc = s.planDoc ? { version: s.planDoc.version, asOf: s.planDoc.asOf, cashPct: s.planDoc.cashPct, method: s.planDoc.method || [], caps: s.planDoc.caps || null, weights: s.planDoc.weights || {}, validation: s.planDoc.validation || null, sources: s.planDoc.sources || [] } : null;
  const first = marks[0] || null, last = marks.at(-1) || null;
  return {
    version: PUBLIC_VERSION, engine: s.version || null, label, asOf, mode: 'vps', public: true,
    since: first?.date || null, days: marks.length, startTotal: first?.total ?? null, total: last?.total ?? total,
    markets: s.markets || null, market: s.market || null, killSwitch: Boolean(s.killSwitch), limits: s.limits || null, fx: num(s.fx),
    balance: b ? { cash: num(b.cash), cashUsd: num(b.cashUsd), total, stock: num(b.stock), positions, usError: b.usError ? true : null } : null,
    error: s.error ? '잔고를 읽지 못해 마지막 기록을 보여 줍니다.' : null, markStale: Boolean(s.markStale), rulesVersion: s.rulesVersion || null,
    ordersToday: (s.ordersToday || []).map(order), recentOrders: (s.recentOrders || []).map(order),
    runs: (s.runs || []).map(r => ({ at: r.at, blockedReasons: r.blockedReasons || {}, actions: r.actions, sent: r.sent, rejected: r.rejected, unknown: r.unknown, blocked: r.blocked, planSource: r.planSource, rebalance: Boolean(r.rebalance) })),
    auto: (s.auto || []).map(a => ({ key: a.key, at: a.at, reason: a.reason, rebalance: Boolean(a.rebalance), sent: a.sent, blocked: a.blocked, items: a.items })),
    marks, prefs: s.prefs ? { rules: s.prefs.rules, cadence: s.prefs.cadence, sectorCap: s.prefs.sectorCap ?? null, prefs: s.prefs.prefs || null, savedAt: s.prefs.savedAt || null } : null,
    hypotheses: (s.hypotheses || []).filter(h => h.public !== false).map(hyp), hiddenHypotheses: (s.hypotheses || []).filter(h => h.public === false).length,
    activity30: s.activity30 || null, integrity: s.integrity ? { ok: Boolean(s.integrity.ok), items: s.integrity.items || [], notFound: s.integrity.notFound ?? 0, rejected: s.integrity.rejected ?? 0, pending: s.integrity.pending ?? 0, orders: s.integrity.orders ?? 0 } : null,
    prefsHistory: (s.prefsHistory || []).map(x => ({ at: x.at, changed: x.changed || [], before: x.before, after: x.after, reason: x.reason || '', expected: x.expected || '', planVersion: x.planVersion || null })),
    baseline: s.baseline ? { at: s.baseline.at, from: s.baseline.from, capitalKrw: num(s.baseline.capitalKrw), plan: s.baseline.plan || {}, rules: s.baseline.rules || null, planVersion: s.baseline.planVersion || null } : null,
    planVersionNow: s.planVersionNow || null, defaultPlanVersion: s.defaultPlanVersion || null, hasDefaultPlan: Boolean(s.hasDefaultPlan), planDoc
  };
}

/** 체결된 주문을 토스 주문 모양으로(성적표·월별 자산 계산이 그 모양을 읽는다). */
export function tossOrdersFrom(orders = []) {
  return orders.filter(o => ['filled', 'partial'].includes(o.status) && (o.filledQty || 0) > 0).map((o, i) => {
    const q = o.filledQty, px = o.avgPrice || o.price, at = o.at;
    return { ref: `paper${i}-${o.symbol}`, symbol: o.symbol, side: o.side, status: 'FILLED', orderType: 'LIMIT', timeInForce: 'DAY', currency: o.currency, quantity: q, orderAmount: null, limitPrice: o.price, orderedAt: at, canceledAt: null,
      execution: { filledQuantity: q, averageFilledPrice: px, filledAmount: q * px, commission: 0, tax: 0, filledAt: at, settlementDate: null } };
  });
}

/** 공개 스냅샷 → 화면 모듈이 읽는 자산 스냅샷(teamquant:asset-snapshot). demo 표식을 함께 켜서 PC 를 묻지 않게 하고, paper 표식으로 모의계좌임을 구분한다. */
export function assetSnapshotFrom(pub, { fetchedAt = pub?.asOf } = {}) {
  const fx = pub?.fx || null, b = pub?.balance;
  const positions = (b?.positions || []).filter(p => p.qty > 0 && p.price > 0).map(p => { const cost = p.avgCost > 0 ? p.qty * p.avgCost : null, value = p.qty * p.price; return { symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.qty, avgCost: p.avgCost ?? null, price: p.price, cost: cost ?? value, value, pnl: cost === null ? 0 : value - cost, returnPct: cost ? (value / cost - 1) * 100 : 0, dailyPnl: null }; });
  const cashKrw = (b?.cash || 0) + (fx && b?.cashUsd ? b.cashUsd * fx : 0);
  const orders = tossOrdersFrom(pub?.recentOrders || []).reverse();
  return { source: `${pub?.label || PUBLIC_LABEL} · 실제 돈 아님`, fetchedAt: fetchedAt || new Date().toISOString(), fx: fx ? { midRate: fx, asOf: '모의계좌 조회 환율' } : null, positions, totals: [], cashKnown: true,
    demo: true, paper: true, demoCash: Math.round(cashKrw), paperMeta: { label: pub?.label || PUBLIC_LABEL, asOf: pub?.asOf || null, since: pub?.since || null, days: pub?.days || 0, startTotal: pub?.startTotal ?? null, total: pub?.total ?? null, live: Boolean(pub?.live), planVersion: pub?.planVersionNow || null, cadence: pub?.prefs?.cadence || 'weekly' },
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
