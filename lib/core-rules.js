// 핵심 기능의 규칙 엔진(브라우저·Node 공용).
// 사용자가 정한 규칙과 계획 비중으로 ① 오늘 점검(지금 계좌가 규칙에서 얼마나 벗어났고 무엇을 할지) ② 매매 전 확인을 계산한다.
// 비중은 모두 '총자산(주식 + 현금)' 대비 %. 현금을 모르면 주식 합계 대비로 계산하고 현금 규칙은 확인 불가로 둔다.
export const RULES_VERSION = 'C3-2026-11-06';

export const RULE_DEFS = [
  { id: 'maxSingle', label: '한 종목 최대 비중', unit: '%', min: 5, max: 100, step: 1, default: 25, help: '한 종목이 총자산에서 차지할 수 있는 최대 비중입니다. 한 종목에 몰린 손실을 막습니다.' },
  { id: 'minCash', label: '현금 최소 비중', unit: '%', min: 0, max: 90, step: 1, default: 10, help: '총자산 중 늘 현금으로 남겨 둘 비중입니다. 급락 때 팔지 않고 버틸 여유입니다.' },
  { id: 'dailyLoss', label: '하루 손실 한도', unit: '%', min: 0.5, max: 20, step: 0.5, default: 2.5, help: '계좌 전체가 하루에 잃을 수 있는 금액(95% 범위)의 상한입니다. 넘으면 모든 종목 목표를 같은 비율로 줄입니다. 2012~2026 네 가지 포트폴리오에서 이 계산의 95% 범위를 넘은 날은 4.5~4.9%였습니다(목표 5%). 기본값 2.5%는 2012~2019 자료로 고르고 2020~2026에서 확인했습니다.' },
  { id: 'volTarget', label: '종목 변동성 목표', unit: '%', min: 5, max: 100, step: 1, default: 15, help: '종목별 변동성 규칙을 켰을 때만 씁니다. 비중 = 계획 × min(1, 목표 ÷ 예측 변동성).' },
  { id: 'perAssetVol', label: '종목별 변동성 규칙', type: 'bool', default: false, help: '켜면 종목마다 예측 변동성이 목표보다 큰 만큼 비중을 줄입니다. 여러 종목을 함께 들 때는 분산 효과를 무시해 지나치게 현금이 많아져(검증 결과) 기본은 끔. 계좌 전체 위험은 하루 손실 한도가 맡습니다.' },
  { id: 'trendUS', label: '미국 종목 200일선 규칙', type: 'bool', default: true, help: '미국 종목·지수는 종가가 200일 평균 아래면 비중을 0으로 둡니다. 미국 지수에서는 검증됐고, 한국에서는 효과가 없어 한국 종목엔 쓰지 않습니다.' },
  { id: 'letWinnersRun', label: '오른 종목은 상한까지 두기', type: 'bool', default: true, help: '많이 오른 종목을 계획 비중으로 되돌려 팔지 않고, 한 종목 최대 비중까지는 그대로 둡니다. 덜어내는 것은 상한을 넘는 만큼만입니다. 무작위 6종목 포트폴리오 120개(2016~2026, 매달 적립)에서 상한 초과분만 덜기는 그냥 적립보다 최대 손실을 줄였고(2021~2026 중앙 −36%→−29%), 수익률은 비슷했습니다.' },
  { id: 'noLeverage', label: '레버리지·인버스 금지', type: 'bool', default: true, help: '2배·3배·인버스 상품은 보유하지 않습니다. 하루 움직임이 커서 위 규칙들이 의미를 잃습니다.' },
  { id: 'maxTrades30', label: '30일 매매 횟수 상한', unit: '회', min: 1, max: 200, step: 1, default: 8, help: '최근 30일 체결 횟수의 상한입니다. 잦은 매매는 비용과 감정 매매를 늘립니다.' }
];
export const DEFAULT_RULES = Object.fromEntries(RULE_DEFS.map(d => [d.id, d.default]));
// 계획 금액의 10% 넘게 차이 날 때만, 주 1회(그 주 마지막 거래일 종가) 맞춘다. 급할 때(evaluate.urgent)는 바로.
export const BAND = 0.10;
export const CADENCE = 'weekly';
// 계획 비중 값: 숫자(%) 또는 {pct, name, currency}
export const planPctOf = v => typeof v === 'number' ? v : Number(v?.pct); // 계획 금액의 5% 넘게 차이 날 때만 맞춘다(검증과 같은 기준)

export function normalizeRules(input = {}) {
  const rules = { ...DEFAULT_RULES }, errors = [];
  for (const d of RULE_DEFS) {
    if (input[d.id] === undefined || input[d.id] === null || input[d.id] === '') continue;
    if (d.type === 'bool') { rules[d.id] = !!input[d.id]; continue; }
    const v = Number(input[d.id]);
    if (!Number.isFinite(v) || v < d.min || v > d.max) errors.push(`${d.label}은 ${d.min}~${d.max}${d.unit} 사이여야 합니다.`);
    else rules[d.id] = v;
  }
  if (rules.maxSingle > 100 - rules.minCash + 1e-9) errors.push('한 종목 최대 비중이 (100 − 현금 최소 비중)보다 큽니다.');
  return { rules, errors };
}

const LEV_NAME = /레버리지|인버스|2X|3X|울트라|선물인버스|곱버스|\bBull\b|\bBear\b|ProShares Ultra|Direxion/i;
const LEV_TICKERS = new Set(['TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXU', 'SPXL', 'SPXS', 'TNA', 'TZA', 'LABU', 'LABD', 'NVDL', 'NVDS', 'TSLL', 'TSLQ', 'UVXY', 'SVXY', 'QLD', 'SSO', 'SDS', 'QID', 'FNGU', 'FNGD', 'TECL', 'TECS', 'YINN', 'YANG', 'BITX', 'CONL', 'MSTU']);
const LEV_KR = new Set(['122630', '252670', '233740', '251340', '114800', '123320', '233160', '304940', '306530', '462330', '465350']);
export function isLeveraged({ symbol = '', name = '' } = {}) { const code = String(symbol).split('.')[0].toUpperCase(); return LEV_TICKERS.has(code) || LEV_KR.has(code) || LEV_NAME.test(name); }

// 규칙 배수: 변동성 목표 ÷ 예측 변동성(최대 1), 미국 종목이 200일선 아래면 0, 레버리지면 0. 시세가 부족하면 null.
export function multOf(risk, rules, leveraged = false) {
  if (leveraged && rules.noLeverage) return 0;
  if (!risk?.ok || !(risk.vol > 0)) return null;
  if (risk.trendApplies && rules.trendUS && risk.above200 === false) return 0;
  return rules.perAssetVol ? Math.min(1, rules.volTarget / 100 / risk.vol) : 1;
}

/** 지금 비중으로 계획 비중을 채운다(종목 최대 비중으로 자르고, 현금 최소 비중을 남기도록 줄임). positions: [{symbol, valueKrw}] */
export function initialPlan(positions, cashKrw, rules = DEFAULT_RULES) {
  const stock = positions.reduce((a, p) => a + (p.valueKrw || 0), 0), total = stock + (Number.isFinite(cashKrw) ? cashKrw : 0);
  if (!total) return {};
  const plan = {}; for (const p of positions) if (p.valueKrw > 0) plan[p.symbol] = Math.min(rules.maxSingle, p.valueKrw / total * 100);
  const room = 100 - rules.minCash, sum = Object.values(plan).reduce((a, b) => a + b, 0);
  if (sum > room) for (const k of Object.keys(plan)) plan[k] *= room / sum;
  for (const k of Object.keys(plan)) plan[k] = Math.round(plan[k] * 10) / 10;
  return plan;
}

/**
 * 오늘 점검.
 * @param s.positions [{symbol, name, currency, valueKrw}]
 * @param s.cashKrw 현금(원) 또는 null(모름)
 * @param s.rules, s.plan {symbol: 계획 %}
 * @param s.risk {symbol: {ok, mult, vol, above200, trendApplies}}
 * @param s.portVar (holdings:[{symbol, valueKrw}]) → {var95, ...}
 * @param s.trades30 최근 30일 체결 횟수(모르면 null)
 */
export function evaluate(s) {
  const rules = s.rules || DEFAULT_RULES, cashKnown = Number.isFinite(s.cashKrw);
  const stock = s.positions.reduce((a, p) => a + (p.valueKrw || 0), 0), total = stock + (cashKnown ? s.cashKrw : 0);
  // 지금 보유한 종목 + 계획에는 있지만 지금은 없는 종목(규칙으로 팔았다가 다시 살 수 있어야 함)
  const held = s.positions.filter(p => p.valueKrw > 0), heldSet = new Set(held.map(p => p.symbol));
  const planned0 = Object.entries(s.plan || {}).filter(([sym, v]) => !heldSet.has(sym) && planPctOf(v) > 0)
    .map(([sym, v]) => ({ ...(s.positions.find(p => p.symbol === sym) || {}), symbol: sym, name: v?.name || s.positions.find(p => p.symbol === sym)?.name || sym, currency: v?.currency || s.positions.find(p => p.symbol === sym)?.currency || 'KRW', valueKrw: 0 }));
  const rows = [...held, ...planned0].map(p => {
    const risk = s.risk?.[p.symbol], lev = isLeveraged(p), planned = planPctOf(s.plan?.[p.symbol]);
    const basePlan = Math.min(rules.maxSingle, Number.isFinite(planned) ? planned : p.valueKrw / total * 100);
    // 오른 종목은 상한까지 계획이 따라 올라간다(되돌려 팔지 않음)
    const planPct = rules.letWinnersRun ? Math.min(rules.maxSingle, Math.max(basePlan, p.valueKrw / total * 100)) : basePlan;
    const m = multOf(risk, rules, lev), mult = m === null ? 1 : m;
    const why = [];
    if (!Number.isFinite(planned)) why.push('계획 비중 없음 → 지금 비중(최대 비중 이내)을 계획으로 봄');
    if (lev && rules.noLeverage) why.push('레버리지·인버스 상품');
    else if (risk?.ok && risk.trendApplies && rules.trendUS && !risk.above200) why.push('200일선 아래(미국 규칙)');
    else if (rules.perAssetVol && risk?.ok && risk.vol * 100 > rules.volTarget) why.push(`예측 변동성 연 ${Math.round(risk.vol * 100)}% > 목표 ${rules.volTarget}%`);
    if (!risk?.ok && !lev) why.push('시세 부족으로 변동성 규칙 미적용');
    return { symbol: p.symbol, name: p.name, currency: p.currency, currentKrw: p.valueKrw, currentPct: p.valueKrw / total * 100, planPct, mult, vol: risk?.vol ?? null, targetPct: planPct * mult, leveraged: lev, why };
  });
  // 현금 최소 비중을 지키도록 목표 합을 제한
  let scale = 1; const room = 100 - (cashKnown ? rules.minCash : 0), sumT = rows.reduce((a, r) => a + r.targetPct, 0);
  if (sumT > room) scale = room / sumT;
  // 하루 손실 한도: 목표 보유로 계산한 95% 손실이 한도를 넘으면 같은 비율로 줄인다(손실은 금액에 거의 비례)
  const at = k => rows.map(r => ({ symbol: r.symbol, valueKrw: total * r.targetPct * k / 100 }));
  let varTarget = s.portVar ? s.portVar(at(scale)) : null, varCut = false;
  for (let it = 0; it < 4 && varTarget?.ok && varTarget.var95 > total * rules.dailyLoss / 100 * 1.001; it++) { scale *= (total * rules.dailyLoss / 100) / varTarget.var95; varTarget = s.portVar(at(scale)); varCut = true; }
  for (const r of rows) {
    r.targetPct *= scale; r.targetKrw = total * r.targetPct / 100; r.diffKrw = r.targetKrw - r.currentKrw;
    const band = Math.max((s.band ?? BAND) * total * r.planPct / 100, 10000);
    r.action = r.diffKrw <= -band ? 'reduce' : r.diffKrw >= band ? 'add' : 'keep';
    if (scale < 0.999 && varCut) r.why.push('계좌 하루 손실 한도로 함께 축소');
  }
  const varNow = s.portVar ? s.portVar(rows.map(r => ({ symbol: r.symbol, valueKrw: r.currentKrw }))) : null;
  const cashPct = cashKnown ? s.cashKrw / total * 100 : null;
  const over = rows.filter(r => r.currentPct > rules.maxSingle + 0.05), levHeld = rows.filter(r => r.leveraged);
  const heavy = rows.filter(r => r.action === 'reduce' && (r.mult < 0.999 || r.currentPct > r.planPct * (1 + BAND)));
  const checks = [
    { id: 'maxSingle', label: '한 종목 최대 비중', ok: !over.length, detail: over.length ? over.map(r => `${r.name} ${r.currentPct.toFixed(1)}%`).join(', ') + ` > ${rules.maxSingle}%` : `가장 큰 종목 ${rows.length ? Math.max(...rows.map(r => r.currentPct)).toFixed(1) : 0}%` },
    { id: 'minCash', label: '현금 최소 비중', ok: cashKnown ? cashPct >= rules.minCash - 0.05 : null, detail: cashKnown ? `현금 ${cashPct.toFixed(1)}% (기준 ${rules.minCash}%)` : '현금을 기록하지 않아 확인할 수 없음' },
    { id: 'dailyLoss', label: '하루 손실 한도', ok: varNow?.ok ? varNow.var95 <= total * rules.dailyLoss / 100 * 1.001 : null, detail: varNow?.ok ? `지금 하루 95% 손실 ${Math.round(varNow.var95).toLocaleString('ko-KR')}원 = 총자산의 ${(varNow.var95 / total * 100).toFixed(2)}% (한도 ${rules.dailyLoss}%)` : '시세가 부족해 계산하지 못함' },
    { id: 'volTarget', label: rules.perAssetVol ? '종목 변동성 규칙' : '계획 비중·200일선', ok: !heavy.length, detail: heavy.length ? heavy.map(r => `${r.name}(규칙 비중 ${r.targetPct.toFixed(1)}%)`).join(', ') + ' 줄일 차례' : '모든 종목이 규칙 비중 안' },
    { id: 'noLeverage', label: '레버리지·인버스 금지', ok: rules.noLeverage ? !levHeld.length : true, detail: levHeld.length ? levHeld.map(r => r.name).join(', ') : '해당 상품 없음' },
    { id: 'maxTrades30', label: '30일 매매 횟수', ok: Number.isFinite(s.trades30) ? s.trades30 <= rules.maxTrades30 : null, detail: Number.isFinite(s.trades30) ? `최근 30일 ${s.trades30}회 (상한 ${rules.maxTrades30}회)` : '체결 이력을 불러오지 못함' }
  ];
  // 할 일: 줄이기 먼저(큰 금액 순), 그다음 늘리기(현금이 있을 때만)
  const actions = [];
  for (const r of rows.filter(r => r.action === 'reduce').sort((a, b) => a.diffKrw - b.diffKrw)) actions.push({ kind: 'reduce', symbol: r.symbol, name: r.name, amountKrw: -r.diffKrw, text: `${r.name} ${Math.round(-r.diffKrw).toLocaleString('ko-KR')}원어치 줄이기 → 총자산의 ${r.targetPct.toFixed(1)}%`, why: r.why });
  let buyRoom = cashKnown ? Math.max(0, s.cashKrw - total * rules.minCash / 100) + actions.reduce((a, x) => a + x.amountKrw, 0) : null;
  for (const r of rows.filter(r => r.action === 'add').sort((a, b) => b.diffKrw - a.diffKrw)) {
    const amt = buyRoom === null ? r.diffKrw : Math.min(r.diffKrw, buyRoom); if (buyRoom !== null) buyRoom -= amt;
    if (amt >= 10000) actions.push({ kind: 'add', symbol: r.symbol, name: r.name, amountKrw: amt, text: `${r.name} ${Math.round(amt).toLocaleString('ko-KR')}원어치까지 늘릴 수 있음${buyRoom === null ? '(현금 확인 필요)' : ''}`, why: r.why });
  }
  if (levHeld.length && rules.noLeverage) for (const r of levHeld) if (!actions.some(a => a.symbol === r.symbol)) actions.unshift({ kind: 'reduce', symbol: r.symbol, name: r.name, amountKrw: r.currentKrw, text: `${r.name} 정리(레버리지·인버스 금지)`, why: r.why });
  const okCount = checks.filter(c => c.ok === true).length, known = checks.filter(c => c.ok !== null).length;
  // 바로 할 일: 하루 손실이 한도의 1.25배를 넘거나, 레버리지 보유, 한 종목이 상한의 1.2배를 넘을 때. 그 밖에는 주 1회(그 주 마지막 거래일 종가) 맞춘다.
  const urgent = (varNow?.ok && varNow.var95 > total * rules.dailyLoss / 100 * 1.25) || (levHeld.length > 0 && rules.noLeverage) || rows.some(r => r.currentPct > rules.maxSingle * 1.2);
  return { version: RULES_VERSION, urgent, total, stock, cashKnown, cashPct, rows, checks, actions, okCount, known, varNow, varTarget, scale };
}

/**
 * 매매 전 확인. order: {symbol, name, currency, side:'BUY'|'SELL', amountKrw}. riskOfOrder: 그 종목의 assetRisk 결과.
 * 매도는 위험을 줄이므로 매매 횟수만 본다. 매수는 모든 규칙을 본다.
 */
export function preTradeCheck(s, order, riskOfOrder) {
  const rules = s.rules || DEFAULT_RULES, cashKnown = Number.isFinite(s.cashKrw), amt = Number(order.amountKrw);
  if (!(amt > 0)) return { ok: false, error: '금액을 0보다 크게 입력하십시오.' };
  const held = s.positions.find(p => p.symbol === order.symbol), heldKrw = held?.valueKrw || 0;
  // 전량 매도는 주문가(호가 올림)·환율 차이로 금액이 보유 평가보다 조금 클 수 있다 — 2%까지 허용(수량 초과는 order-guard 가 막는다 · 결정 25).
  if (order.side === 'SELL' && amt > heldKrw * 1.02 + 1) return { ok: false, error: `보유 금액(${Math.round(heldKrw).toLocaleString('ko-KR')}원)보다 많이 팔 수 없습니다.` };
  const sign = order.side === 'BUY' ? 1 : -1;
  const after = s.positions.map(p => p.symbol === order.symbol ? { ...p, valueKrw: p.valueKrw + sign * amt } : p);
  if (!held) after.push({ symbol: order.symbol, name: order.name, currency: order.currency, valueKrw: amt });
  const cashAfter = cashKnown ? s.cashKrw - sign * amt : null;
  const total = after.reduce((a, p) => a + Math.max(0, p.valueKrw), 0) + (cashKnown ? cashAfter : 0);
  const posAfter = held ? heldKrw + sign * amt : amt, weightAfter = posAfter / total * 100;
  const lev = isLeveraged(order), planned = s.plan?.[order.symbol];
  const planPct = Math.min(rules.maxSingle, Number.isFinite(planPctOf(planned)) ? planPctOf(planned) : rules.maxSingle);
  const mult = multOf(riskOfOrder, rules, lev);
  const ruleWeight = mult === null ? null : planPct * mult;
  const varAfter = s.portVar ? s.portVar(after.filter(p => p.valueKrw > 0).map(p => ({ symbol: p.symbol, valueKrw: p.valueKrw }))) : null;
  const trades = Number.isFinite(s.trades30) ? s.trades30 + 1 : null;
  const checks = [];
  if (order.side === 'BUY') {
    checks.push({ id: 'cash', label: '현금 충분', ok: cashKnown ? cashAfter >= 0 : null, detail: cashKnown ? `주문 뒤 현금 ${Math.round(cashAfter).toLocaleString('ko-KR')}원` : '현금을 기록하지 않아 확인할 수 없음' });
    checks.push({ id: 'maxSingle', label: '한 종목 최대 비중', ok: weightAfter <= rules.maxSingle + 0.05, detail: `주문 뒤 ${weightAfter.toFixed(1)}% (상한 ${rules.maxSingle}%)` });
    checks.push({ id: 'volTarget', label: rules.perAssetVol ? '종목 변동성 규칙' : '계획 비중·200일선', ok: ruleWeight === null ? null : weightAfter <= ruleWeight * (1 + BAND) + 0.05, detail: ruleWeight === null ? '시세가 부족해 계산하지 못함' : `규칙 비중 ${ruleWeight.toFixed(1)}%${riskOfOrder?.ok ? ` (예측 변동성 연 ${Math.round(riskOfOrder.vol * 100)}%${riskOfOrder.trendApplies && !riskOfOrder.above200 && rules.trendUS ? ', 200일선 아래' : ''})` : ''}` });
    checks.push({ id: 'minCash', label: '현금 최소 비중', ok: cashKnown ? cashAfter / total * 100 >= rules.minCash - 0.05 : null, detail: cashKnown ? `주문 뒤 현금 ${(cashAfter / total * 100).toFixed(1)}% (기준 ${rules.minCash}%)` : '현금을 기록하지 않아 확인할 수 없음' });
    checks.push({ id: 'dailyLoss', label: '하루 손실 한도', ok: varAfter?.ok ? varAfter.var95 <= total * rules.dailyLoss / 100 * 1.001 : null, detail: varAfter?.ok ? `주문 뒤 계좌 하루 95% 손실 ${Math.round(varAfter.var95).toLocaleString('ko-KR')}원 = ${(varAfter.var95 / total * 100).toFixed(2)}% (한도 ${rules.dailyLoss}%)` : '시세가 부족해 계산하지 못함' });
    checks.push({ id: 'noLeverage', label: '레버리지·인버스 금지', ok: !(lev && rules.noLeverage), detail: lev ? '레버리지·인버스 상품' : '해당 없음' });
  }
  checks.push({ id: 'maxTrades30', label: '30일 매매 횟수', ok: trades === null ? null : trades <= rules.maxTrades30, detail: trades === null ? '체결 이력을 불러오지 못함' : `이 주문까지 ${trades}회 (상한 ${rules.maxTrades30}회)` });
  const failed = checks.filter(c => c.ok === false), unknown = checks.filter(c => c.ok === null);
  return { ok: !failed.length, failed, unknown, checks, after: { weightPct: weightAfter, cashKrw: cashAfter, total, var95: varAfter?.var95 ?? null }, ruleWeight, planPct, mult };
}

/** 모든 매수 규칙을 지키는 최대 매수 금액(원). 이분 탐색. 매매 횟수 규칙은 금액과 무관하므로 따로 본다. */
/**
 * 새 돈 배분: 들어온 금액을 계획(규칙 적용 뒤) 대비 모자란 종목부터 나눈다. 한 종목 상한·현금 최소·하루 손실 한도를 지키고,
 * 남는 돈은 현금으로 둔다. 무작위 포트폴리오 모의 운용에서 '모자란 종목부터'는 균등 적립과 수익·손실이 비슷하면서 매매가 약 40% 적었고,
 * 떨어진 종목에 자연히 더 들어가 따로 '하락 시 추가 매수' 규칙을 둔 것과 결과가 같았다.
 */
export function allocateCash(s, amountKrw) {
  const amt = Number(amountKrw); if (!(amt > 0)) return { ok: false, error: '넣을 금액을 0보다 크게 입력하십시오.' };
  const rules = s.rules || DEFAULT_RULES, cashKnown = Number.isFinite(s.cashKrw);
  const next = { ...s, cashKrw: (cashKnown ? s.cashKrw : 0) + amt };
  const e = evaluate(next), total = e.total, keepCash = total * rules.minCash / 100;
  let room = Math.max(0, next.cashKrw - keepCash);
  const gaps = e.rows.map(r => ({ r, gap: Math.max(0, Math.min(r.targetKrw, total * rules.maxSingle / 100) - r.currentKrw) })).filter(g => g.gap >= 10000 && !g.r.leveraged);
  const gapSum = gaps.reduce((a, g) => a + g.gap, 0), spend = Math.min(room, gapSum), buys = [];
  for (const g of gaps.sort((a, b) => b.gap - a.gap)) { const x = gapSum ? spend * g.gap / gapSum : 0; if (x >= 10000) buys.push({ symbol: g.r.symbol, name: g.r.name, amountKrw: Math.floor(x / 1000) * 1000, why: g.r.currentPct < g.r.planPct * 0.8 ? '계획보다 많이 모자람(떨어졌거나 덜 산 종목)' : '계획보다 모자람' }); }
  // 하루 손실 한도 확인: 넘으면 같은 비율로 줄인다
  const after = e.rows.map(r => ({ symbol: r.symbol, valueKrw: r.currentKrw + (buys.find(b => b.symbol === r.symbol)?.amountKrw || 0) }));
  let v = s.portVar ? s.portVar(after) : null, k = 1, overNow = false;
  if (v?.ok && v.var95 > total * rules.dailyLoss / 100) { const base = s.portVar(e.rows.map(r => ({ symbol: r.symbol, valueKrw: r.currentKrw }))); overNow = (base?.var95 || 0) >= total * rules.dailyLoss / 100; const extra = v.var95 - (base?.var95 || 0); k = overNow ? 0 : extra > 0 ? Math.max(0, Math.min(1, (total * rules.dailyLoss / 100 - (base?.var95 || 0)) / extra)) : 0; for (const b of buys) b.amountKrw = Math.floor(b.amountKrw * k / 1000) * 1000; }
  const kept = buys.filter(b => b.amountKrw >= 10000), used = kept.reduce((a, b) => a + b.amountKrw, 0);
  const note = overNow ? `계좌 하루 손실 범위가 이미 한도(${rules.dailyLoss}%)를 넘어 새 돈은 현금으로 둡니다. 한도 안으로 돌아오면 모자란 종목부터 넣습니다.` : k < 1 ? '하루 손실 한도 때문에 일부만 사고 나머지는 현금으로 둡니다.' : used < amt ? '모자란 종목을 다 채우고 남는 돈은 현금으로 둡니다(현금 최소 비중 포함).' : '';
  return { ok: true, amountKrw: amt, buys: kept, keepCashKrw: amt - used, limitedByRisk: k < 1, overLimitNow: overNow, note };
}

export function maxBuyAmount(s, order, riskOfOrder, { cap = 1e12 } = {}) {
  const ok = a => { const r = preTradeCheck(s, { ...order, side: 'BUY', amountKrw: a }, riskOfOrder); return !r.error && r.checks.every(c => c.id === 'maxTrades30' || c.ok !== false); };
  let hi = Number.isFinite(s.cashKrw) ? Math.max(0, s.cashKrw) : Math.min(cap, s.positions.reduce((a, p) => a + p.valueKrw, 0));
  if (hi < 1000 || !ok(1000)) return 0;
  if (ok(hi)) return Math.floor(hi);
  let lo = 1000; for (let k = 0; k < 40 && hi - lo > 1000; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return Math.floor(lo / 1000) * 1000;
}
