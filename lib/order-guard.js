// 자동매매 안전장치: 주문을 보내기 직전의 마지막 검사. 설계 문서 05절 "자동매매" 안전장치를 코드로 옮긴 것이다.
// 이 저장소에는 아직 실제 주문 경로가 없다. 모의 계좌 연결(2단계)에서 모든 주문은 이 검사를 통과해야 하고, 결과는 감사 기록으로 남긴다.
// maxDailyKrw 는 "시장별 · 그 시장의 거래일별" 합계다(국내는 KST 날짜, 미국은 뉴욕 날짜). 국내·미국을 합산하지 않는다 — 합산하면 낮의 국내 재조정이
// 밤의 미국 주문을 전부 막는다(2026-11-09 실제 발생). 거부·취소·소멸·미접수(rejected/cancelled/expired/not_found) 주문은 한도를 쓰지 않은 것으로 본다.
export const DEFAULT_LIMITS = Object.freeze({ maxOrderKrw: 1_000_000, maxDailyKrw: 3_000_000, maxWeightPct: 25, dailyLossStopPct: 3, priceBandPct: 3, minutesAfterOpen: 5, duplicateWindowMin: 10, allowLive: false });
// 한도를 쓰지 않은 주문 상태: 증권사가 받지 않았거나(rejected/not_found) 남은 수량이 사라진(cancelled/expired) 것.
export const NOT_COUNTED = Object.freeze(['rejected', 'cancelled', 'expired', 'not_found']);
const MARKET_LABEL = { KR: '국내', US: '미국' };

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
// 같은 거래일 같은 종목·방향·수량·가격이면 같은 주문으로 본다(중복 방지 키). 거래일(tradeDate)이 없으면 UTC 날짜로 대신한다(이전 장부와 호환).
export const intentKey = i => `OI-${hash([String(i.tradeDate || String(i.at || '').slice(0, 10)), i.symbol, i.side, i.qty, i.limitPrice].join('|'))}`;
/** 같은 시장·같은 거래일의 주문만 고른다. intent 에 tradeDate 가 없으면(옛 호출) UTC 날짜·시장 무관으로 본다. */
export function sameTradingDay(intent, o) {
  if (intent.tradeDate) { if (o.tradeDate !== intent.tradeDate) return false; if (intent.market && o.market && o.market !== intent.market) return false; return true; }
  return String(o.at).slice(0, 10) === String(intent.at).slice(0, 10);
}

/**
 * @param intent {symbol, side:'BUY'|'SELL', qty, limitPrice, currency:'KRW'|'USD', at:ISO, mode:'paper'|'live', market?:'KR'|'US', tradeDate?:'YYYY-MM-DD'(그 시장의 거래일)}
 * @param ctx {limits, equityKrw, positions:[{symbol, qty, valueKrw}], todayOrders:[{key, amountKrw, at, market?, tradeDate?, status?}], dayPnlPct, killSwitch, lastPrice, fx, halted, limitUp, limitDown, marketOpenAt:ISO}
 */
export function checkOrder(intent, ctx = {}) {
  const L = { ...DEFAULT_LIMITS, ...(ctx.limits || {}) }, blocks = [], warnings = [];
  const key = intentKey(intent), fx = intent.currency === 'USD' ? Number(ctx.fx) : 1;
  const amountKrw = Number(intent.qty) * Number(intent.limitPrice) * fx;
  if (intent.mode !== 'paper' && !L.allowLive) blocks.push('실계좌 주문은 아직 허용하지 않습니다(모의 계좌만).');
  if (ctx.killSwitch) blocks.push('전체 정지(킬 스위치)가 켜져 있습니다.');
  if (Number.isFinite(ctx.dayPnlPct) && ctx.dayPnlPct <= -L.dailyLossStopPct) blocks.push(`오늘 손실 ${ctx.dayPnlPct}%로 일 손실 한도(−${L.dailyLossStopPct}%)에 도달했습니다.`);
  if (!['BUY', 'SELL'].includes(intent.side)) blocks.push('주문 방향이 올바르지 않습니다.');
  if (!Number.isInteger(intent.qty) || intent.qty <= 0) blocks.push('수량은 1 이상의 정수여야 합니다.');
  if (!(intent.limitPrice > 0)) blocks.push('지정가 주문만 허용합니다.');
  if (intent.currency === 'USD' && !(fx > 0)) blocks.push('환율이 없어 원화 금액을 계산하지 못했습니다.');
  if (Number.isFinite(amountKrw) && amountKrw > L.maxOrderKrw) blocks.push(`1회 주문 금액 ${Math.round(amountKrw).toLocaleString('ko-KR')}원이 한도 ${L.maxOrderKrw.toLocaleString('ko-KR')}원을 넘습니다.`);
  // 하루 합계·중복: 같은 시장의 같은 거래일 주문만. 한도를 쓰지 않은 상태(NOT_COUNTED)는 뺀다.
  const today = (ctx.todayOrders || []).filter(o => sameTradingDay(intent, o) && !NOT_COUNTED.includes(o.status));
  const used = today.reduce((a, o) => a + (Number(o.amountKrw) || 0), 0);
  if (Number.isFinite(amountKrw) && used + amountKrw > L.maxDailyKrw) blocks.push(`오늘 주문 합계가 한도 ${L.maxDailyKrw.toLocaleString('ko-KR')}원을 넘습니다${intent.market && MARKET_LABEL[intent.market] ? `(${MARKET_LABEL[intent.market]} 거래일 ${intent.tradeDate || ''} 기준)` : ''}.`);
  const dup = today.find(o => o.key === key && Date.parse(intent.at) - Date.parse(o.at) < L.duplicateWindowMin * 60000);
  if (dup) blocks.push('같은 주문이 방금 나갔습니다(중복 방지).');
  const held = (ctx.positions || []).find(p => p.symbol === intent.symbol);
  if (intent.side === 'BUY' && ctx.equityKrw > 0) {
    const after = ((held?.valueKrw || 0) + amountKrw) / ctx.equityKrw * 100;
    if (after > L.maxWeightPct) blocks.push(`사고 나면 한 종목 비중이 ${after.toFixed(1)}%로 한도 ${L.maxWeightPct}%를 넘습니다.`);
  }
  if (intent.side === 'SELL' && !(held?.qty >= intent.qty)) blocks.push('보유 수량보다 많이 팔 수 없습니다.');
  if (ctx.lastPrice > 0 && intent.limitPrice > 0) {
    const gap = Math.abs(intent.limitPrice / ctx.lastPrice - 1) * 100;
    if (gap > L.priceBandPct) blocks.push(`지정가가 현재가와 ${gap.toFixed(1)}% 차이나 허용 폭(${L.priceBandPct}%)을 넘습니다.`);
  } else warnings.push('현재가를 확인하지 못했습니다.');
  if (ctx.halted) blocks.push('거래정지 종목입니다.');
  if (intent.side === 'BUY' && ctx.limitUp) blocks.push('상한가 종목은 사지 않습니다.');
  if (intent.side === 'SELL' && ctx.limitDown) warnings.push('하한가라 체결되지 않을 수 있습니다.');
  if (ctx.marketOpenAt) { const m = (Date.parse(intent.at) - Date.parse(ctx.marketOpenAt)) / 60000; if (m >= 0 && m < L.minutesAfterOpen) blocks.push(`장 시작 뒤 ${L.minutesAfterOpen}분 안에는 주문하지 않습니다.`); if (m < 0) blocks.push('장 시작 전입니다.'); }
  return { ok: blocks.length === 0, key, amountKrw: Number.isFinite(amountKrw) ? Math.round(amountKrw) : null, blocks, warnings };
}

// 감사 기록 한 줄: 누가(사람·규칙) 무엇을 왜 판단했고 검사 결과가 어땠는지.
export function auditEntry(intent, result, { decidedBy = 'rule', reason = '', strategy = null } = {}) {
  return { at: intent.at, key: result.key, symbol: intent.symbol, side: intent.side, qty: intent.qty, limitPrice: intent.limitPrice, mode: intent.mode, decidedBy, strategy, reason, ok: result.ok, blocks: result.blocks, warnings: result.warnings };
}
