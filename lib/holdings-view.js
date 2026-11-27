// 홈 '종목별 수익률' 카드와 계좌 띠의 계산(2026-11-26). 화면(DOM) 없이 숫자만 만든다 — node 시험(test/holdings-view.test.js)과 브라우저가 함께 쓴다.
// 보유·현금·원금은 이 탭 메모리의 값만 받고, 저장하거나 보내지 않는다. 매수·매도 권유를 만들지 않는다(순서·막대는 내 기록을 보여 줄 뿐).
const fin = Number.isFinite;
const pos = v => fin(v) && v > 0;

/** 종목 통화 금액 → 원. 달러는 오늘 환율(fxRate)로 바꾼다. 바꿀 수 없으면 null. */
export const toKrw = (amount, currency, fxRate) => !fin(amount) ? null : currency === 'KRW' ? amount : pos(fxRate) ? amount * fxRate : null;

/**
 * 보유 종목 줄 + 현금 줄.
 * @param positions 홈 스냅샷 positions [{symbol,name,currency,quantity,avgCost,price,cost,value,pnl,returnPct,dailyPnl,dailyPct}] (금액은 종목 통화)
 * @param fxRate   달러 → 원 오늘 환율
 * @param cashKrw  현금(원). 모르면 null — 그러면 비중은 주식만으로 나눈다.
 * @param dayPct   {symbol: 오늘 등락 %} (증권사 값이 없을 때 쓰는 전날 종가 대비 등락)
 * @returns {rows, cash, stockKrw, totalKrw, cashKnown}
 *   rows: {symbol,name,currency,valueKrw,costKrw,pnlKrw,returnPct,dayPct,weightPct}
 *   returnPct 는 매입 평균가 대비(종목 통화 기준 — 미국 주식은 달러 기준이라 환율 변화가 빠진다). pnlKrw 는 그 손익을 오늘 환율로 바꾼 값.
 */
export function holdingRows(positions = [], { fxRate = null, cashKrw = null, dayPct = {} } = {}) {
  const rows = (positions || []).filter(p => p && p.symbol && !(fin(p.quantity) && p.quantity <= 0)).map(p => {
    const cost = pos(p.cost) ? p.cost : pos(p.avgCost) && pos(p.quantity) ? p.avgCost * p.quantity : null;
    const returnPct = fin(p.returnPct) ? p.returnPct : cost && fin(p.value) ? (p.value / cost - 1) * 100 : null;
    const pnl = fin(p.pnl) ? p.pnl : cost && fin(p.value) ? p.value - cost : null;
    const prevValue = fin(p.dailyPnl) && fin(p.value) ? p.value - p.dailyPnl : null;
    const day = fin(p.dailyPct) ? p.dailyPct : fin(dayPct?.[p.symbol]) ? dayPct[p.symbol] : pos(prevValue) ? p.dailyPnl / prevValue * 100 : null;
    return { symbol: p.symbol, name: p.name || p.symbol, currency: p.currency, valueKrw: toKrw(p.value, p.currency, fxRate), costKrw: toKrw(cost, p.currency, fxRate), pnlKrw: toKrw(pnl, p.currency, fxRate), returnPct, dayPct: day, weightPct: null };
  });
  const stockKrw = rows.reduce((s, r) => s + (fin(r.valueKrw) ? r.valueKrw : 0), 0);
  const cashKnown = fin(cashKrw) && cashKrw >= 0, totalKrw = stockKrw + (cashKnown ? cashKrw : 0);
  for (const r of rows) r.weightPct = totalKrw > 0 && fin(r.valueKrw) ? r.valueKrw / totalKrw * 100 : null;
  const cash = cashKnown ? { valueKrw: cashKrw, weightPct: totalKrw > 0 ? cashKrw / totalKrw * 100 : null } : null;
  return { rows, cash, stockKrw, totalKrw, cashKnown };
}

/** 정렬: 'weight' = 평가액 큰 순 · 'return' = 수익률 높은 순. 값이 없는 줄은 뒤로, 같으면 이름순. 원본은 바꾸지 않는다. */
export function sortRows(rows = [], by = 'weight') {
  const key = by === 'return' ? 'returnPct' : 'valueKrw';
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (fin(x) !== fin(y)) return fin(x) ? -1 : 1;
    if (fin(x) && x !== y) return y - x;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });
}

/** 보기 좋은 올림(1 · 2 · 2.5 · 5 · 10 × 10^k). 0 이하면 1. */
export function niceCeil(v) {
  if (!(v > 0) || !fin(v)) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  const step = [1, 2, 2.5, 5, 10].find(s => m <= s + 1e-9);
  return Number((step * p).toPrecision(12));
}

/**
 * 가운데 0 선에서 좌우로 뻗는 막대. 보이는 줄의 |수익률| 최댓값을 보기 좋게 올린 값(scale)이 막대 반쪽 끝이다.
 * @returns {scale, bars: Map(symbol → {side:'up'|'down'|'flat', widthPct})}  widthPct 는 전체 칸 폭 기준 0~50.
 */
export function barScale(rows = []) {
  const max = Math.max(0, ...rows.map(r => Math.abs(r.returnPct)).filter(fin));
  const scale = niceCeil(max);
  const bars = new Map(rows.map(r => {
    const v = r.returnPct;
    if (!fin(v)) return [r.symbol, null];
    return [r.symbol, { side: v > 0 ? 'up' : v < 0 ? 'down' : 'flat', widthPct: Math.min(50, Math.abs(v) / scale * 50) }];
  }));
  return { scale, bars };
}

/** 보유 전체 평가 손익(원). 원가·손익을 아는 종목만 더한다. 미국 주식은 오늘 환율 기준(산 날 환율이 아님). */
export function holdingsTotal(rows = []) {
  const ok = rows.filter(r => fin(r.pnlKrw) && pos(r.costKrw));
  const pnlKrw = ok.reduce((s, r) => s + r.pnlKrw, 0), costKrw = ok.reduce((s, r) => s + r.costKrw, 0);
  return { pnlKrw: ok.length ? pnlKrw : null, costKrw: ok.length ? costKrw : null, returnPct: costKrw > 0 ? pnlKrw / costKrw * 100 : null, counted: ok.length, of: rows.length };
}

/**
 * 카드 한 번 그릴 몫: 정렬 → 앞 limit 개(펼치면 전부) → 막대 비율.
 * @returns {rows, hidden, scale, bars, cash, total, stockKrw, totalKrw, cashKnown, hasUsd}
 */
export function holdingsView(positions, { fxRate = null, cashKrw = null, dayPct = {}, sort = 'weight', limit = 10, expanded = false } = {}) {
  const base = holdingRows(positions, { fxRate, cashKrw, dayPct });
  const sorted = sortRows(base.rows, sort), shown = expanded ? sorted : sorted.slice(0, Math.max(1, limit));
  const { scale, bars } = barScale(shown);
  return { ...base, rows: shown, hidden: sorted.length - shown.length, scale, bars, total: holdingsTotal(base.rows), hasUsd: base.rows.some(r => r.currency === 'USD') };
}

/**
 * 계좌 띠 숫자(원금 기준). 모르는 값은 null 로 두고 지어내지 않는다.
 * @param kind     'real' | 'paper' | 'demo'
 * @param holdings holdingsReturn(snapshot) 결과 {value, cost, pnl, returnPct, basis}
 * @param cashKrw  현금(원) 또는 null
 * @param real     실계좌 기록(kis-real-status) — principal {krw, method, since, asOf, deposits, withdrawals} · returns {totalPnlKrw, returnPct, realizedByMonth, realizedByYear, method, since, asOf} · balance {total, cashKnown} · markStale
 * @param paper    {principalKrw, startTotal}
 * @param today    'YYYY-MM-DD'(한국 날짜) — 이번 달·올해 실현 손익 열쇠
 * @returns {principal:{krw,method,since,asOf,deposits,withdrawals,complete,unknownCount,fetchError}|null, costKrw, assets:{krw,stockKrw,cashKrw,cashKnown,from}, totalPnl:{krw,pct,from}|null, realized:{month,year,since,asOf,unknownSells}|null, unrealized:{krw,pct}}
 */
export function accountSummary({ kind = 'real', holdings = {}, cashKrw = null, real = null, paper = null, today = '' } = {}) {
  const stockKrw = fin(holdings.value) ? holdings.value : null, cashKnown = fin(cashKrw) && cashKrw >= 0;
  const unrealized = { krw: fin(holdings.pnl) ? holdings.pnl : null, pct: fin(holdings.returnPct) ? holdings.returnPct : null };
  let assets = { krw: stockKrw === null ? null : stockKrw + (cashKnown ? cashKrw : 0), stockKrw, cashKrw: cashKnown ? cashKrw : null, cashKnown, from: 'snapshot' };
  let principal = null, totalPnl = null, realized = null;
  if (kind === 'real' && real && typeof real === 'object') {
    const p = real.principal, r = real.returns, b = real.balance;
    if (p && pos(p.krw)) {
      // complete:false = 금액을 모르는 증권 입고·환율 없는 달러 입출금·기록 밖 주식이 있어 원금이 덜 세졌을 수 있음. unknownCount = 그 원인 건수(거래 행은 받지 않음).
      const miss = Array.isArray(p.unknowns) ? p.unknowns.filter(u => u && ['transfer_no_value', 'usd_no_rate', 'exceeds_holding'].includes(u.reason)).reduce((a, u) => a + (fin(u.count) ? u.count : 0), 0) : 0;
      principal = { krw: p.krw, method: p.method === 'transactions' ? 'transactions' : 'estimated', since: p.since || null, asOf: p.asOf || null, deposits: fin(p.deposits) ? p.deposits : null, withdrawals: fin(p.withdrawals) ? p.withdrawals : null,
        complete: p.method === 'transactions' ? p.complete !== false : null, unknownCount: miss, fetchError: typeof p.fetchError === 'string' && p.fetchError ? p.fetchError : null };
    }
    // 기록의 총자산은 그 기록의 원금·손익과 같은 시점 값이라 함께 쓴다(못 읽은 날 markStale 이면 화면 스냅샷으로).
    if (principal && b && pos(b.total) && !real.markStale) {
      const known = b.cashKnown !== false;
      assets = { krw: b.total, stockKrw: fin(b.stock) ? b.stock : stockKrw, cashKrw: known && fin(b.cash) ? b.cash : assets.cashKrw, cashKnown: known, from: 'record' };
    }
    if (principal) {
      const krw = fin(r?.totalPnlKrw) ? r.totalPnlKrw : fin(assets.krw) && assets.cashKnown ? assets.krw - principal.krw : null; // 현금을 모르면 총자산 − 원금을 만들지 않는다
      const pct = fin(r?.returnPct) ? r.returnPct : krw !== null ? krw / principal.krw * 100 : null;
      totalPnl = krw === null ? null : { krw, pct, from: fin(r?.totalPnlKrw) ? 'record' : 'computed' };
    }
    if (r && (r.realizedByMonth || r.realizedByYear)) {
      const pick = (obj, key) => !obj || typeof obj !== 'object' ? null : fin(obj[key]) ? obj[key] : 0;
      realized = { month: pick(r.realizedByMonth, String(today).slice(0, 7)), year: pick(r.realizedByYear, String(today).slice(0, 4)), since: r.since || null, asOf: r.asOf || null,
        unknownSells: fin(r.realizedUnknownSells) && r.realizedUnknownSells > 0 ? r.realizedUnknownSells : 0 }; // 원가를 몰라 뺀 매도 건수(0 이면 다 셈)
    }
  } else if (kind === 'paper') {
    const krw = pos(paper?.principalKrw) ? paper.principalKrw : pos(paper?.startTotal) ? paper.startTotal : null;
    if (krw) principal = { krw, method: pos(paper?.principalKrw) ? 'paper' : 'paper-start', since: null, asOf: null, deposits: null, withdrawals: null };
  } else if (kind === 'demo') {
    const cost = fin(holdings.cost) ? holdings.cost : null;
    if (cost !== null && cashKnown) principal = { krw: cost + cashKrw, method: 'demo', since: null, asOf: null, deposits: null, withdrawals: null };
  }
  if (principal && !totalPnl && kind !== 'real' && fin(assets.krw) && assets.cashKnown) { const krw = assets.krw - principal.krw; totalPnl = { krw, pct: krw / principal.krw * 100, from: 'computed' }; }
  return { principal, costKrw: fin(holdings.cost) ? holdings.cost : null, assets, totalPnl, realized, unrealized };
}
