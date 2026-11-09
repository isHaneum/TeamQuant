// 시스템 점검(소프트웨어 검증): 모의계좌 장부에서 "규칙을 정확히 실행했는가"를 센다. 수익률이 아니라 정확성·안정성의 지표다.
// 목표는 전부 0건: 의도하지 않은 중복 주문, 미확인(not_found) 뒤 같은 날 같은 종목 재전송, 이유 없는 주문, 1시간 넘게 미확인인 주문.
// 어떤 오류가 한 번도 안 났다고 그 오류에 안전하다는 뜻은 아니다. 합성 테스트(test/paper-integrity.test.js)가 상황을 강제로 만든다.
const PENDING = ['sending', 'sent', 'partial', 'unknown', 'cancel_requested'];
const kstDate = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

/** @returns {{duplicates:number, resentAfterNotFound:number, noReason:number, staleUnknown:number, notFound:number, rejected:number, orders:number, runs:number, ok:boolean, items:[{key,label,count,target}]}} */
export function systemCheck(ledger = {}, now = Date.now()) {
  const orders = Array.isArray(ledger.orders) ? ledger.orders : [], live = orders.filter(o => !['rejected', 'cancelled', 'not_found'].includes(o.status));
  // 중복: 같은 종목·방향·수량·가격의 살아 있는 주문이 2분 안에 둘 이상(재조정은 먼저 취소하고 다시 내므로 취소된 건은 뺀다)
  let duplicates = 0; const seen = [];
  for (const o of live) { const t = Date.parse(o.at); if (seen.some(p => p.symbol === o.symbol && p.side === o.side && p.qty === o.qty && Math.abs((p.price || 0) - (o.price || 0)) < 1e-6 && Math.abs(Date.parse(p.at) - t) < 2 * 60e3)) duplicates++; seen.push(o); }
  // 미확인 뒤 재전송: not_found 로 판정한 주문과 같은 날·같은 종목·같은 방향으로 그 뒤에 나간 주문
  let resentAfterNotFound = 0;
  for (const o of orders.filter(x => x.status === 'not_found')) if (orders.some(x => x !== o && x.symbol === o.symbol && x.side === o.side && kstDate(x.at) === kstDate(o.at) && Date.parse(x.at) > Date.parse(o.at) && !['rejected'].includes(x.status))) resentAfterNotFound++;
  const noReason = orders.filter(o => !String(o.why || '').trim()).length;
  const staleUnknown = orders.filter(o => ['sending', 'unknown'].includes(o.status) && now - Date.parse(o.at) > 60 * 60e3).length;
  const notFound = orders.filter(o => o.status === 'not_found').length, rejected = orders.filter(o => o.status === 'rejected').length;
  const pending = orders.filter(o => PENDING.includes(o.status)).length;
  const items = [
    { key: 'duplicates', label: '의도하지 않은 중복 주문', count: duplicates, target: 0 },
    { key: 'resentAfterNotFound', label: '미확인 주문 뒤 같은 날 재전송', count: resentAfterNotFound, target: 0 },
    { key: 'noReason', label: '이유 없는 주문', count: noReason, target: 0 },
    { key: 'staleUnknown', label: '1시간 넘게 미확인', count: staleUnknown, target: 0 }
  ];
  return { duplicates, resentAfterNotFound, noReason, staleUnknown, notFound, rejected, pending, orders: orders.length, runs: Array.isArray(ledger.runs) ? ledger.runs.length : 0, ok: items.every(i => i.count <= i.target), items };
}
