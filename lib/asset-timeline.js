// 월별 주식 자산 추이: 지금 보유 수량에서 실제 체결을 시간 역순으로 되돌려 각 월말 보유 수량을 복원하고,
// 그 날의 마지막 종가(달러 종목은 그 날 환율)로 평가한다. 계좌 기록을 지어내지 않기 위해
// 체결 이력이 닿지 않는 달, 시세가 없는 달, 수량이 맞지 않는 달은 값을 비워 둔다. 현금은 포함하지 않는다.

export const koreaDay = v => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));

// candles는 날짜 오름차순. date 당일 또는 그 이전 마지막 종가.
export function closeOn(candles, date) {
  if (!Array.isArray(candles) || !candles.length) return null;
  let lo = 0, hi = candles.length - 1, found = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].date <= date) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found === null) return null;
  const v = candles[found].close; return Number.isFinite(v) && v > 0 ? v : null;
}

// 오늘을 포함해 최근 count개의 월말 날짜. 이번 달은 오늘 날짜로 끝난다.
export function monthEnds(today, count = 12) {
  const [y, m] = today.split('-').map(Number), out = [today];
  for (let k = 1; k < count; k++) {
    const end = new Date(Date.UTC(y, m - k, 0)); // m-k월의 0일 = 이전 달 말일
    out.unshift(end.toISOString().slice(0, 10));
  }
  return out;
}

export const newYorkDay = v => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));

// 주문 이력에서 체결된 것만 날짜·수량·금액으로 정리한다. date = 한국 날짜(월말 묶기용), marketDate = 그 시장의 거래일(미국 종목은 뉴욕 날짜 —
// 미국 정규장 대부분은 한국 날짜로 다음 날이라, 한국 날짜로 지수 종가를 찾으면 다음 장 종가가 된다 · 2026-11-17 교차 검증 F06).
export function fillsFrom(orders = []) {
  return orders.flatMap(o => {
    const e = o?.execution, q = e?.filledQuantity;
    if (!(q > 0) || !['BUY', 'SELL'].includes(o.side)) return [];
    const price = e.averageFilledPrice ?? (e.filledAmount != null ? e.filledAmount / q : null);
    const amount = e.filledAmount ?? (price != null ? price * q : null), at = e.filledAt || o.orderedAt;
    const ts = Date.parse(at);
    return [{ symbol: o.symbol, currency: o.currency, side: o.side, quantity: q, price, amount, date: koreaDay(at), marketDate: o.currency === 'USD' ? newYorkDay(at) : koreaDay(at), ts: Number.isFinite(ts) ? ts : null, fees: (e.commission ?? 0) + (e.tax ?? 0) }];
  // 체결 시각 순(2026-11-17 재점검): 날짜로만 정렬하면 같은 날 산 뒤 판 체결의 순서가 입력 순서(토스 이력은 최신 먼저)를 따라,
  // 원금 계산(costBasisReader)이 판 것을 먼저 보고 원금을 틀리게 셌다. 시각이 없으면 날짜로만 비교한다.
  }).sort((a, b) => (a.ts !== null && b.ts !== null ? a.ts - b.ts : 0) || a.date.localeCompare(b.date));
}

const toKrw = (amount, currency, rate) => currency === 'KRW' ? amount : Number.isFinite(rate) && rate > 0 ? amount * rate : null;

/**
 * 보유 주식의 원화 손익·수익률(홈 숫자). 2026-11-16: 토스 앱은 미국 주식 원금을 산 날 환율로 센다.
 * 토스가 준 계좌 손익률(snapshot.account · basis 'purchase_fx')이 있으면 그 값을 쓰고, 원금 = 평가액 ÷ (1 + 손익률)로 되돌린다.
 * 없으면(모의계좌·예시 자산) 원금도 오늘 환율로 바꾸므로 미국 종목은 달러 기준(산 뒤 환율 변동 빠짐)이다 — basis 'current_fx' 로 알려 화면이 밝힌다.
 */
export function holdingsReturn(snapshot) {
  const ps = snapshot?.positions || [], rate = snapshot?.fx?.midRate;
  const value = ps.reduce((s, p) => s + (toKrw(p.value, p.currency, rate) ?? NaN), 0), costNow = ps.reduce((s, p) => s + (toKrw(p.cost, p.currency, rate) ?? NaN), 0);
  const hasUsd = ps.some(p => p.currency === 'USD'), currentFxPct = costNow > 0 && Number.isFinite(value) ? (value / costNow - 1) * 100 : null, a = snapshot?.account;
  if (a?.basis === 'purchase_fx' && Number.isFinite(a.returnPct) && a.returnPct > -100) {
    const after = Number.isFinite(a.returnAfterCostPct) ? a.returnAfterCostPct : null;
    // 환율을 못 읽어 원화 금액을 모를 때도 토스가 준 손익률은 그대로 보인다(금액만 비움 · 교차 검증 F19).
    if (!(value > 0)) return { value: NaN, cost: NaN, pnl: NaN, returnPct: a.returnPct, basis: 'purchase_fx', currentFxPct: null, returnAfterCostPct: after };
    const cost = value / (1 + a.returnPct / 100);
    return { value, cost, pnl: value - cost, returnPct: a.returnPct, basis: 'purchase_fx', currentFxPct: hasUsd ? currentFxPct : null, returnAfterCostPct: after };
  }
  return { value, cost: costNow, pnl: value - costNow, returnPct: currentFxPct, basis: hasUsd ? 'current_fx' : 'krw', currentFxPct: null, returnAfterCostPct: null };
}

/**
 * @param positions 현재 보유 [{symbol,currency,quantity,cost,value}] (cost·value는 종목 통화)
 * @param orders    정규화된 주문 이력(체결 포함)
 * @param candlesBySymbol {symbol: [{date,close}]}
 * @param fxCandles USD→KRW 일봉 [{date,close}]
 * @param fxNow     현재 환율
 * @param today     YYYY-MM-DD (한국 날짜)
 * @param coverageFrom 체결 이력이 빠짐없이 들어 있는 시작일. 이보다 앞선 월말은 복원하지 않는다.
 * @param costKrwNow 지금 보유의 원화 원금(미국 주식은 산 날 환율 · holdingsReturn 의 cost). 없으면 원금도 오늘 환율로 바꾼다(달러 기준 · 원금선이 환율 변동만큼 어긋남).
 */
export function buildAssetTimeline({ positions = [], orders = [], candlesBySymbol = {}, fxCandles = [], fxNow = null, today, coverageFrom = null, months = 12, costKrwNow = null }) {
  const fills = fillsFrom(orders), warnings = [];
  const fxAt = date => closeOn(fxCandles, date) ?? fxNow;
  const nowCost = Number.isFinite(costKrwNow) && costKrwNow > 0 ? costKrwNow : positions.reduce((s, p) => s + (toKrw(p.cost, p.currency, fxNow) ?? NaN), 0);
  const nowValue = positions.reduce((s, p) => s + (toKrw(p.value, p.currency, fxNow) ?? NaN), 0);
  const symbols = new Map(positions.map(p => [p.symbol, { currency: p.currency, quantity: p.quantity }]));
  for (const f of fills) if (!symbols.has(f.symbol)) symbols.set(f.symbol, { currency: f.currency, quantity: 0 });
  if (fills.some(f => f.amount === null)) warnings.push('체결 금액이 없는 주문이 있어 일부 달의 원금이 비어 있습니다.');
  const principalAt = costBasisReader({ positions, fills, symbols, fxAt, fxNow, costKrwNow });

  const points = monthEnds(today, months).map((date, i, all) => {
    const month = date.slice(0, 7), isToday = i === all.length - 1;
    if (isToday) return { month, date, value: Number.isFinite(nowValue) ? nowValue : null, principal: Number.isFinite(nowCost) ? nowCost : null, current: true };
    if (coverageFrom && date < coverageFrom) return { month, date, value: null, principal: null, reason: '체결 이력 조회 범위 밖' };
    const later = fills.filter(f => f.date > date);
    let value = 0, missing = [], mismatch = false;
    for (const [symbol, info] of symbols) {
      const q = info.quantity - later.filter(f => f.symbol === symbol).reduce((s, f) => s + (f.side === 'BUY' ? f.quantity : -f.quantity), 0);
      if (q < -1e-6) { mismatch = true; continue; }
      if (q <= 1e-9) continue;
      const close = closeOn(candlesBySymbol[symbol], date), krw = close === null ? null : toKrw(q * close, info.currency, fxAt(date));
      if (krw === null) missing.push(symbol); else value += krw;
    }
    const principal = principalAt(date);
    if (mismatch) return { month, date, value: null, principal: null, reason: '보유 수량이 체결 이력과 맞지 않음' };
    if (missing.length) return { month, date, value: null, principal: Number.isFinite(principal) ? principal : null, reason: '시세 없음: ' + missing.join(', ') };
    return { month, date, value, principal: Number.isFinite(principal) ? principal : null };
  });
  if (points.some(p => p.reason?.startsWith('보유 수량'))) warnings.push('일부 달은 보유 수량이 체결 이력과 맞지 않아(액면분할·입고 등) 비워 두었습니다.');
  if (principalAt.reopened && points.some(p => p.value !== null && p.principal === null && !p.current)) warnings.push('조회 범위 앞부터 들고 있다가 범위 안에서 다 판 종목이 있어, 그 매도 전 달의 넣은 돈은 비워 두었습니다(그때 원가를 체결 이력으로 알 수 없음).');

  const valid = points.filter(p => p.value !== null);
  const first = valid[0], last = points.at(-1);
  // 기간 투자 손익 = 마지막 평가액 − 처음 평가액 − 그 사이 순매수(산 금액 − 판 금액, 체결일 환율). 판 이익(실현 손익)도 들어간다.
  // 원금선은 '그때 들고 있던 주식의 원가'라 (평가액 − 원금)의 변화로 세면 판 이익이 빠지므로 체결로 직접 센다.
  let periodGain = null;
  if (first && last.value !== null) {
    let net = 0;
    for (const f of fills) { if (f.date <= first.date || f.date > last.date) continue; const a = f.amount === null ? null : toKrw(f.amount, f.currency, fxAt(f.date)); if (a === null) { net = NaN; break; } net += f.side === 'BUY' ? a : -a; }
    periodGain = Number.isFinite(net) ? last.value - first.value - net : null;
  }
  return { points, warnings, fills: fills.length, periodGain, from: first?.date ?? null };
}

/**
 * 월말 원금(2026-11-17 · 교차 검증 F18) = 그때 들고 있던 주식의 원가(이동평균). 예전에는 '지금 원금 − 그 뒤 순매수'라 매도를 판 금액으로 되더해,
 * 이익을 보고 판 적이 있으면 그 전 달들이 손실로 칠해지고 첫 매수 전 달에도 넣은 돈이 생겼다. 이제 매도는 판 수량 × 그때 평균 원가로 되돌린다.
 * 종목마다: 조회 범위 처음에 보유가 없었으면(범위 안 체결로 수량이 다 설명됨) 앞에서부터 쌓고(정확),
 * 있었으면 지금 원가에서 거꾸로 되돌린다. 거꾸로 가다 수량 0에서 매도를 만나면(다 판 뒤 다시 산 종목) 그 앞 원가를 알 수 없어 NaN.
 * 미국 종목의 지금 원화 원가: costKrwNow(산 날 환율 원금 합)가 있으면 거기서 국내 원가·앞에서 쌓은 미국 원가를 뺀 몫을 달러 원가 비율로 나눈다(같은 평균 환율 · 근사), 없으면 오늘 환율.
 * @returns {(date:string) => number} 그 날짜의 원금(원) · 모르면 NaN
 */
function costBasisReader({ positions, fills, symbols, fxAt, fxNow, costKrwNow }) {
  const amountKrw = f => { const r = f.currency === 'KRW' ? 1 : fxAt(f.date); return f.amount === null || !(r > 0) ? NaN : f.amount * r; };
  const posCost = new Map(positions.map(p => [p.symbol, Number(p.cost) || 0]));
  const by = new Map(); for (const f of fills) { if (!by.has(f.symbol)) by.set(f.symbol, []); by.get(f.symbol).push(f); }
  const plan = [...symbols].map(([symbol, info]) => { const fs = by.get(symbol) || [], net = fs.reduce((s, f) => s + (f.side === 'BUY' ? f.quantity : -f.quantity), 0); return { symbol, info, fs, forward: info.quantity - net <= 1e-6 }; });
  // 앞에서부터: 체결마다 그 뒤 원가 [{date, cost}]
  const fwd = new Map();
  for (const p of plan.filter(x => x.forward)) {
    let qty = 0, cost = 0; const st = [];
    for (const f of p.fs) { if (f.side === 'BUY') { qty += f.quantity; cost += amountKrw(f); } else if (qty > 1e-9) { cost -= cost * Math.min(1, f.quantity / qty); qty -= f.quantity; } if (qty <= 1e-9) { qty = Math.max(0, qty); cost = Number.isFinite(cost) ? 0 : cost; } st.push({ date: f.date, cost }); }
    fwd.set(p.symbol, st);
  }
  const back = plan.filter(x => !x.forward), usBackNative = back.filter(x => x.info.currency === 'USD').reduce((s, x) => s + (posCost.get(x.symbol) || 0), 0);
  let usRate = fxNow;
  if (Number.isFinite(costKrwNow) && costKrwNow > 0 && usBackNative > 0) {
    const krw = plan.filter(x => x.info.currency === 'KRW').reduce((s, x) => s + (posCost.get(x.symbol) || 0), 0);
    const usFwd = plan.filter(x => x.forward && x.info.currency === 'USD').reduce((s, x) => s + (fwd.get(x.symbol).at(-1)?.cost ?? 0), 0);
    const r = (costKrwNow - krw - usFwd) / usBackNative;
    if (Number.isFinite(r) && r > 0 && (!(fxNow > 0) || (r > fxNow / 2 && r < fxNow * 2))) usRate = r;
  }
  // 거꾸로: costs[k] = 최근 체결 k개를 되돌린 뒤 원가(모르면 NaN)
  const bwd = new Map(); let reopened = false;
  for (const p of back) {
    const desc = [...p.fs].reverse(); let qty = p.info.quantity, cost = p.info.currency === 'KRW' ? (posCost.get(p.symbol) || 0) : (posCost.get(p.symbol) || 0) * (usRate > 0 ? usRate : NaN);
    const costs = [cost];
    for (const f of desc) {
      if (f.side === 'BUY') { qty -= f.quantity; cost -= amountKrw(f); if (qty <= 1e-9) { qty = Math.max(0, qty); cost = Number.isFinite(cost) ? 0 : cost; } }
      else if (qty > 1e-9) { cost += f.quantity * (cost / qty); qty += f.quantity; }
      else { cost = NaN; qty += f.quantity; reopened = true; }
      costs.push(cost);
    }
    bwd.set(p.symbol, { desc, costs });
  }
  return Object.assign(date => {
    let sum = 0;
    for (const p of plan) {
      if (p.forward) { const st = fwd.get(p.symbol); let c = 0; for (const s of st) { if (s.date > date) break; c = s.cost; } sum += c; }
      else { const { desc, costs } = bwd.get(p.symbol); let k = 0; while (k < desc.length && desc[k].date > date) k++; sum += costs[k]; }
    }
    return sum;
  }, { reopened });
}
