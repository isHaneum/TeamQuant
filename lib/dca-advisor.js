// 적립식 투자 점검: 보유 종목별로 "계속 적립 / 적립 보류·점검 / 비중 조절"을 근거와 함께 판단한다.
// 가격 하락 자체는 교체 사유로 보지 않는다. 판단 기준은 실적(투자 이유), 비중, 변동성, 매매 습관이다.

const round = (v, d = 0) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const ETF_NAME = /KODEX|TIGER|ACE|KBSTAR|RISE|SOL|ARIRANG|HANARO|KOSEF|PLUS|ETF|ETN|S&P|나스닥100|SPY|QQQ|VOO|VTI|IVV|SCHD/i;
export const DCA_LIMITS = { maxSingleWeight: 35, highVolatility: 55, earningsDrop: -15, coreTarget: 50 };

export function isBroadFund(position) { return position.kind === 'ETF' || ETF_NAME.test(position.name || '') || ETF_NAME.test(position.symbol || ''); }

export function judgeHolding(position, brief, limits = DCA_LIMITS) {
  const reasons = [], fund = isBroadFund(position);
  const g = brief?.financials?.growth || null, vol = brief?.price?.annualVolatility ?? null, fromHigh = brief?.price?.fromHigh ?? null;
  let verdict = 'keep';

  if (fund) reasons.push({ tone: 1, text: '여러 종목에 나눠 투자하는 지수형 상품이라 적립식에 잘 맞습니다.' });
  if (g) {
    const rev = g.revenue, op = g.operatingIncome;
    if ((op ?? 0) <= limits.earningsDrop && (rev ?? 0) < 0) { verdict = 'review'; reasons.push({ tone: -1, text: `최근 실적이 전년보다 나빠졌습니다 (매출 ${round(rev, 1)}%, 영업이익 ${round(op, 1)}%). 처음 산 이유가 유지되는지 확인할 때입니다.` }); }
    else if ((op ?? 0) <= limits.earningsDrop) { verdict = 'watch'; reasons.push({ tone: -1, text: `영업이익이 전년보다 ${round(op, 1)}% 줄었습니다. 다음 실적까지 신규 적립 금액을 줄여 지켜볼 수 있습니다.` }); }
    else if ((op ?? 0) > 0 && (rev ?? 0) >= 0) reasons.push({ tone: 1, text: `실적이 늘고 있습니다 (매출 ${round(rev, 1)}%, 영업이익 ${round(op, 1)}%). 주가가 내려도 같은 금액을 적립하면 더 많은 수량을 삽니다.` });
    else reasons.push({ tone: 0, text: '실적 변화가 뚜렷하지 않습니다.' });
  } else if (!fund) {
    reasons.push({ tone: 0, text: '실적 자료가 없습니다(해외 주식 등). 가격만으로 판단하지 말고 회사 실적 발표를 직접 확인하십시오.' });
    if (verdict === 'keep') verdict = 'watch';
  }
  if (fromHigh !== null && fromHigh <= -30 && !fund) reasons.push({ tone: 0, text: `1년 고점 대비 ${round(fromHigh, 1)}%입니다. 하락만으로 교체하지 말고 원인이 실적인지 시장인지 구분하십시오.` });
  if (vol !== null && vol >= limits.highVolatility && !fund) { reasons.push({ tone: -1, text: `연 변동성이 ${round(vol)}%로 큽니다. 적립 비중을 작게 두면 계좌 흔들림이 줄어듭니다.` }); if (verdict === 'keep') verdict = 'watch'; }
  if (position.weightPct > limits.maxSingleWeight) { reasons.push({ tone: -1, text: `보유 주식의 ${round(position.weightPct)}%를 차지합니다(기준 ${limits.maxSingleWeight}%). 새 적립금은 다른 종목이나 지수 상품으로 나누는 편이 안전합니다.` }); if (verdict !== 'review') verdict = 'cap'; }

  const labels = { keep: '계속 적립', watch: '적립 유지·관찰', cap: '비중 줄여 적립', review: '신규 적립 보류·점검' };
  return { symbol: position.symbol, name: position.name, fund, verdict, label: labels[verdict], reasons, weightPct: round(position.weightPct, 1) };
}

export function adviseDca(positions = [], briefsBySymbol = {}, habits = null, limits = DCA_LIMITS) {
  const total = positions.reduce((s, p) => s + (p.valueKrw || 0), 0);
  const withWeights = positions.map(p => ({ ...p, weightPct: total ? (p.valueKrw || 0) / total * 100 : null }));
  const items = withWeights.map(p => judgeHolding(p, briefsBySymbol[p.symbol], limits));
  const fundShare = total ? round(withWeights.filter(isBroadFund).reduce((s, p) => s + (p.valueKrw || 0), 0) / total * 100) : null;
  const switching = habits?.available ? habits.metrics : null;

  const summary = [];
  if (fundShare !== null && fundShare < limits.coreTarget) summary.push(`지수형 상품 비중이 ${fundShare}%입니다. 적립식의 중심(예: 절반 이상)을 지수형 상품으로 두면 종목을 자주 바꿀 필요가 줄어듭니다.`);
  else if (fundShare !== null) summary.push(`지수형 상품 비중이 ${fundShare}%로 적립식의 중심이 잡혀 있습니다.`);
  const review = items.filter(i => i.verdict === 'review');
  if (review.length) summary.push(`${review.map(i => i.name).join(', ')}은(는) 실적이 나빠져 신규 적립을 멈추고 점검할 때입니다. 이미 산 물량을 바로 팔라는 뜻은 아닙니다.`);
  if (!review.length) summary.push('실적이 무너진 종목은 없습니다. 지금 종목을 바꿔야 할 근거는 약합니다.');
  if (switching && (switching.churnCount >= 2 || switching.tradesPerWeek >= 3)) summary.push(`최근 주당 ${switching.tradesPerWeek}회 거래했습니다. 적립식은 같은 종목을 꾸준히 사야 평균 단가가 분산됩니다. 종목을 자주 바꾸면 그 효과가 사라집니다.`);

  return {
    items, fundShare, summary,
    switchRules: [
      '바꾸는 이유는 가격이 아니라 사실이어야 합니다: 실적이 2분기 연속 나빠졌거나, 처음 산 이유(제품·시장)가 사라졌을 때.',
      `한 종목이 보유 주식의 ${limits.maxSingleWeight}%를 넘으면 그 종목은 팔지 말고 새 적립금만 다른 곳에 넣습니다.`,
      '주가 하락은 교체 사유가 아닙니다. 적립식은 내릴 때 같은 돈으로 더 많이 삽니다.',
      '종목 교체는 분기에 한 번, 실적 발표를 확인한 뒤에만 합니다.'
    ],
    caveat: '판단 기준을 점검하는 도구이며 특정 종목의 매수·매도 권유가 아닙니다. 현금·다른 계좌 자산은 반영하지 않았습니다.'
  };
}
