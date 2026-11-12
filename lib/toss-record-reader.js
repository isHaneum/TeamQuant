// 토스 실계좌 읽기 전용 리더(PC 서버 전용 · 2026-11-12 결정 24). lib/real-record.js 가 받는 리더 모양(settings/balance/orders)으로 토스 Open API 조회(lib/toss.js)를 감싼다.
// 왜: 사용자의 실제 돈은 토스 종합계좌에 있다(한투 실전 계좌는 0원 · 2026-11-12 조회). 검증 기록은 실제 돈이 있는 계좌여야 의미가 있다.
// 주문 함수는 없다: lib/toss.js 리더는 조회(계좌·보유·환율·주문 내역)만 하고, 이 래퍼도 settings/balance/orders 만 내놓는다(real-record 가 place/cancel 이 있으면 거부한다).
// 현금: 토스 Open API 는 현금을 주지 않는다(normalizeTossHoldings cashKnown:false). 그래서 total = 보유 주식 평가(원화 환산)이고, cashKnown:false 를 넘겨
//   real-record 가 총자산 비율이 아니라 보유 기준 시간가중 지수(index)로 지수와 비교하게 한다 — 적립 입금·추가 매수가 수익으로 잡히지 않게.
// 환율: 토스 매매기준율(midRate)을 먼저, 없으면 호출자가 넘긴 환율(Yahoo KRW=X). 미국 보유가 있는데 둘 다 없으면 total=null → real-record 가 평가를 보류한다(fail-closed).
export const TOSS_RECORD_VERSION = 'TR1-2026-11-12';
export const TOSS_CASH_NOTE = '토스 Open API는 현금을 주지 않습니다. 총자산 = 보유 주식 평가(원화 환산)이고, 수익률은 입금·추가 매수를 뺀 보유 기준 시간가중입니다.';
const day = ymd => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/** @param read createTossReader() 결과(콜백 없이 만든 별도 인스턴스를 권장 — 25분 기록이 화면용 보유 기록(onSnapshot)을 늘리지 않게). */
export function createTossRecordReader({ read } = {}) {
  if (typeof read !== 'function' || typeof read.orders !== 'function') throw new Error('토스 조회 함수가 필요합니다.');
  const settings = () => ({ mode: 'toss', source: 'toss', label: '토스', readOnly: true, accountMasked: '토스 종합계좌', ledgerKey: 'toss', version: TOSS_RECORD_VERSION });
  async function balance({ fx = null } = {}) {
    const s = await read();
    const rate = s.fx?.midRate > 0 ? s.fx.midRate : fx > 0 ? fx : null;
    const positions = s.positions.map(p => { const us = p.currency === 'USD'; return { symbol: p.symbol, name: p.name, market: us ? 'US' : 'KR', currency: p.currency, qty: p.quantity, price: p.price, value: p.value, avgCost: p.avgCost, valueKrw: us ? (rate ? p.value * rate : null) : p.value }; });
    const krw = positions.filter(p => p.currency === 'KRW').reduce((a, p) => a + p.value, 0), usd = positions.filter(p => p.currency === 'USD').reduce((a, p) => a + p.value, 0);
    const total = positions.some(p => p.currency === 'USD') && !rate ? null : Math.round(krw + usd * (rate || 0));
    return { cash: 0, cashRaw: null, cashKnown: false, totalKrwOnly: Math.round(krw), stock: total, stockKrw: total, stockUsd: usd, cashUsd: null, usCostKrw: null, fx: rate, total, positions, usError: null, cashUsdError: null, note: TOSS_CASH_NOTE, asOf: s.fetchedAt || null };
  }
  /** 그날(KST 주문일) 끝난 주문 중 체결 수량이 있는 것. 주문번호 원문은 없다 — 토스 리더가 sha256(orderId)인 ref 만 준다. */
  async function orders(dateYmd) {
    if (!/^\d{8}$/.test(String(dateYmd || ''))) throw new Error('조회 날짜(YYYYMMDD)가 필요합니다.');
    const d = day(String(dateYmd)), r = await read.orders({ status: 'CLOSED', from: d, to: d });
    return (r?.orders || []).filter(o => (o.execution?.filledQuantity || 0) > 0).map(o => { const filled = o.execution.filledQuantity;
      return { market: o.currency === 'USD' ? 'US' : 'KR', odno: o.ref, code: o.symbol, side: o.side, qty: o.quantity, filled, avgPrice: o.execution.averageFilledPrice ?? null, status: o.quantity > 0 && filled + 1e-9 < o.quantity ? 'partial' : 'filled' }; });
  }
  return { settings, balance, orders };
}
