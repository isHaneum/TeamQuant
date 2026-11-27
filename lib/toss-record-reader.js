// 토스 실계좌 읽기 전용 리더(PC 서버 전용 · 2026-11-12 결정 24 · 2026-11-26 현금 포함 TR2). lib/real-record.js 가 받는 리더 모양(settings/balance/orders)으로 토스 Open API 조회(lib/toss.js)를 감싼다.
// 왜: 사용자의 실제 돈은 토스 종합계좌에 있다(한투 실전 계좌는 0원 · 2026-11-12 조회). 검증 기록은 실제 돈이 있는 계좌여야 의미가 있다.
// 주문 함수는 없다: lib/toss.js 리더는 조회(계좌·보유·환율·주문 내역·매수 가능 금액)만 하고, 이 래퍼도 settings/balance/orders 만 내놓는다(real-record 가 place/cancel 이 있으면 거부한다).
// 현금(2026-11-26 고침): 2026-11-12 에는 "토스 Open API 는 현금을 주지 않는다"고 보고 총자산 = 보유 주식만 적었다. 틀린 전제였다 — GET /api/v1/buying-power(KRW·USD)의 cashBuyingPower 가 있고
//   개인 재조정 모듈(personal/toss-dca)이 11-22 부터 이 값으로 총자산을 센다. 그 결과 매도 뒤 판 돈이 기록에서 사라져 총자산이 판 금액만큼 '급락'한 것처럼 남았다(실제 금액은 공개 저장소에 적지 않는다).
//   이제 cash = 원화 매수 가능 금액 + 달러 매수 가능 금액 × 환율, total = 보유 주식 평가 + cash, cashKnown: true. cashKrw(원화분)·cashUsd(달러 금액)를 따로 넘긴다.
//   매수 가능 금액의 뜻(조회로 확인한 것 · 문서에 정의 없음): 달러분은 결제 전 매도 대금을 포함한다(매도 직후 조회로 확인). 원화·달러는 서로 섞이지 않는다(자동 환전 없음 · FAQ 39).
//   미체결 매수 주문이 잡아 둔 금액은 빠진다 — 그 평가점은 그만큼 낮고, real-record 는 그 차이를 출금으로 추정했다가 주문이 끝난 다음 평가점에서 입금으로 되돌린다(원금은 다시 맞음).
// 보류(fail-closed): 원화 현금 조회 실패 → cashKrwError, 달러 현금 조회 실패 → cashUsdError. real-record 가 평가점을 적지 않는다(미국 잔고 조회 실패와 같은 규칙 · 현금 없는 총자산이 자산 급감으로 봉인되지 않게).
//   조회 함수(read.cash)가 없는 리더(옛 테스트 가짜 등)는 예전 방식 그대로: cashKnown:false · 총자산 = 보유 주식 · 보유 기준 시간가중(TOSS_HOLDINGS_ONLY_NOTE).
// 환율: 토스 매매기준율(midRate)을 먼저, 없으면 호출자가 넘긴 환율(Yahoo KRW=X). 미국 보유나 달러 현금이 있는데 둘 다 없으면 total=null → real-record 가 평가를 보류한다(fail-closed).
export const TOSS_RECORD_VERSION = 'TR2-2026-11-26';
export const TOSS_CASH_NOTE = '총자산 = 보유 주식 평가 + 현금(원화 매수 가능 금액 + 달러 매수 가능 금액 × 토스 매매기준율). 미체결 매수 주문에 잡힌 금액은 그동안 현금에서 빠집니다. 수익률은 추정 입출금을 뺀 시간가중입니다.';
export const TOSS_HOLDINGS_ONLY_NOTE = '이 리더는 현금을 읽지 않습니다. 총자산 = 보유 주식 평가(원화 환산)이고, 수익률은 입금·추가 매수를 뺀 보유 기준 시간가중입니다.';
const day = ymd => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const codeOf = e => (e && typeof e.code === 'string' && /^[a-z_]{1,40}$/.test(e.code) ? e.code : 'cash_failed');

/** @param read createTossReader() 결과(콜백 없이 만든 별도 인스턴스를 권장 — 25분 기록이 화면용 보유 기록(onSnapshot)을 늘리지 않게). read.cash(currency) 가 있으면 현금을 넣는다. */
export function createTossRecordReader({ read } = {}) {
  if (typeof read !== 'function' || typeof read.orders !== 'function') throw new Error('토스 조회 함수가 필요합니다.');
  const settings = () => ({ mode: 'toss', source: 'toss', label: '토스', readOnly: true, accountMasked: '토스 종합계좌', ledgerKey: 'toss', version: TOSS_RECORD_VERSION });
  async function balance({ fx = null } = {}) {
    const s = await read();
    const rate = s.fx?.midRate > 0 ? s.fx.midRate : fx > 0 ? fx : null;
    const positions = s.positions.map(p => { const us = p.currency === 'USD'; return { symbol: p.symbol, name: p.name, market: us ? 'US' : 'KR', currency: p.currency, qty: p.quantity, price: p.price, value: p.value, avgCost: p.avgCost, valueKrw: us ? (rate ? p.value * rate : null) : p.value }; });
    const krw = positions.filter(p => p.currency === 'KRW').reduce((a, p) => a + p.value, 0), usd = positions.filter(p => p.currency === 'USD').reduce((a, p) => a + p.value, 0), hasUs = positions.some(p => p.currency === 'USD');
    const base = { totalKrwOnly: Math.round(krw), stockUsd: usd, usCostKrw: null, fx: rate, positions, usError: null, asOf: s.fetchedAt || null };
    if (typeof read.cash !== 'function') {
      const total = hasUs && !rate ? null : Math.round(krw + usd * (rate || 0));
      return { ...base, cash: 0, cashRaw: null, cashKnown: false, cashKrw: null, cashUsd: null, cashKrwError: null, cashUsdError: null, stock: total, stockKrw: total, total, note: TOSS_HOLDINGS_ONLY_NOTE };
    }
    // 원화·달러를 따로 읽어 어느 쪽이 실패했는지 남긴다(보류 사유). 보유 조회와 현금 조회 사이(1초 안팎)에 체결되면 그 평가점은 한쪽이 두 번 또는 빠져 보일 수 있다 — 다음 평가점에서 반대 방향 추정 입출금으로 되돌아온다.
    let cashKrw = null, cashUsd = null, cashKrwError = null, cashUsdError = null;
    try { cashKrw = await read.cash('KRW'); } catch (e) { cashKrwError = codeOf(e); }
    try { cashUsd = await read.cash('USD'); } catch (e) { cashUsdError = codeOf(e); }
    const cashKnown = cashKrwError === null && cashUsdError === null;
    const stock = (hasUs || cashUsd > 0) && !rate ? null : Math.round(krw + usd * (rate || 0));
    const cash = cashKnown && stock !== null ? Math.round(cashKrw + cashUsd * (rate || 0)) : null;
    // 현금 조회 실패: total 은 보유 주식만(=null 이 아니다) — real-record 가 cashKrwError·cashUsdError 를 보고 평가점을 보류한다(fx_missing 과 사유를 섞지 않게).
    const total = stock === null ? null : cashKnown ? stock + cash : stock;
    return { ...base, cash: cashKnown ? cash : 0, cashRaw: cashKrw, cashKnown, cashKrw, cashUsd, cashKrwError, cashUsdError, stock, stockKrw: stock, total, note: TOSS_CASH_NOTE };
  }
  /** 그날(KST 주문일) 끝난 주문 중 체결 수량이 있는 것. 주문번호 원문은 없다 — 토스 리더가 sha256(orderId)인 ref 만 준다. fee = 수수료 + 세금(주문 통화 · 토스가 둘 다 비우면 null). */
  async function orders(dateYmd) {
    if (!/^\d{8}$/.test(String(dateYmd || ''))) throw new Error('조회 날짜(YYYYMMDD)가 필요합니다.');
    const d = day(String(dateYmd)), r = await read.orders({ status: 'CLOSED', from: d, to: d });
    return (r?.orders || []).filter(o => (o.execution?.filledQuantity || 0) > 0).map(o => { const e = o.execution, filled = e.filledQuantity;
      return { market: o.currency === 'USD' ? 'US' : 'KR', odno: o.ref, code: o.symbol, side: o.side, qty: o.quantity, filled, avgPrice: e.averageFilledPrice ?? null, fee: e.commission == null && e.tax == null ? null : (e.commission || 0) + (e.tax || 0), status: o.quantity > 0 && filled + 1e-9 < o.quantity ? 'partial' : 'filled' }; });
  }
  /** 거래내역(2026-11-26 · 조회만): read.transactions 가 있으면 그대로 넘긴다 — real-record 가 원금·실현손익을 실제 입출금·매매로 센다(lib/toss-ledger.js). 없으면 이 함수도 없다(추정 RR2 그대로). */
  const out = { settings, balance, orders };
  if (typeof read.transactions === 'function') out.transactions = (opts = {}) => read.transactions(opts);
  return out;
}
