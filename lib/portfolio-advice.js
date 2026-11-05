// 포트폴리오 방향 제안: 보유 주식 + 직접 기록한 현금으로 현금 비중·집중도·업종·나라·배당을 점검하고 다음 방향을 제안한다.
// 매수·매도 지시가 아니라 "어디부터 손볼지" 순서를 정한다. 기준값은 화면에 함께 보여 준다.

export const TARGETS = {
  balanced: { cash: [10, 30], single: 25, sector: 40 },
  growth: { cash: [5, 20], single: 30, sector: 50 },
  value: { cash: [10, 30], single: 25, sector: 40 },
  dividend: { cash: [10, 25], single: 20, sector: 35 }
};

const pctOf = (a, b) => b > 0 ? a / b * 100 : null;
const r0 = v => Math.round(v);

/**
 * @param holdings [{symbol,name,valueKrw,currency,sector,dividendYield,stance,label}]
 * @param cash 원화 현금(모르면 null)
 */
export function advisePortfolio(holdings = [], { cash = null, style = 'balanced' } = {}) {
  const t = TARGETS[style] || TARGETS.balanced;
  const stocks = holdings.reduce((s, h) => s + (h.valueKrw || 0), 0), total = stocks + (Number.isFinite(cash) ? cash : 0);
  const cashPct = Number.isFinite(cash) ? pctOf(cash, total) : null;
  const group = key => { const m = new Map(); for (const h of holdings) { const k = h[key] || '분류 없음'; m.set(k, (m.get(k) || 0) + (h.valueKrw || 0)); } return [...m].map(([label, value]) => ({ label, value, pct: pctOf(value, stocks) })).sort((a, b) => b.value - a.value); };
  const sectors = group('sector'), countries = group('country');
  const dividend = holdings.reduce((s, h) => s + (h.valueKrw || 0) * ((h.dividendYield > 0 ? h.dividendYield : 0) / 100), 0);
  const checks = [], actions = [];
  // 1. 현금
  if (cashPct === null) checks.push({ key: 'cash', tone: 0, title: '현금을 기록하면 전체 비중을 점검할 수 있습니다', text: '증권사 예수금·CMA·통장 중 투자에 쓸 돈을 적어 주십시오. 현금이 없으면 급할 때 손실 중인 주식을 팔게 됩니다.' });
  else if (cashPct < t.cash[0]) { checks.push({ key: 'cash', tone: -1, title: `현금 ${r0(cashPct)}% · 기준(${t.cash[0]}~${t.cash[1]}%)보다 적음`, text: '시장이 크게 빠질 때 살 돈이 없고, 생활비가 필요하면 주식을 팔아야 합니다.' }); actions.push('새 매수는 잠시 줄이고, 월 적립금 일부를 현금으로 남겨 현금 비중을 먼저 채우십시오.'); }
  else if (cashPct > t.cash[1]) { checks.push({ key: 'cash', tone: 0, title: `현금 ${r0(cashPct)}% · 기준(${t.cash[0]}~${t.cash[1]}%)보다 많음`, text: '물가만큼 가치가 줄 수 있습니다. 한 번에 넣기보다 나눠서 투자하는 편이 안전합니다.' });
    const extra = cash - total * (t.cash[1] / 100); actions.push(`기준을 넘는 현금 약 ${Math.round(extra / 1e4).toLocaleString('ko-KR')}만원은 3~6개월에 나눠 투자하는 방법을 검토하십시오.`); }
  else checks.push({ key: 'cash', tone: 1, title: `현금 ${r0(cashPct)}% · 기준 범위 안`, text: '급할 때 쓸 돈과 기회가 왔을 때 살 돈이 적당히 있습니다.' });
  // 2. 한 종목 집중
  const big = holdings.filter(h => pctOf(h.valueKrw, stocks) > t.single).sort((a, b) => b.valueKrw - a.valueKrw);
  if (big.length) { checks.push({ key: 'single', tone: -1, title: `한 종목 비중이 큼: ${big.map(h => `${h.name} ${r0(pctOf(h.valueKrw, stocks))}%`).join(', ')}`, text: `한 종목이 주식의 ${t.single}%를 넘으면 그 종목 하나가 계좌 전체를 흔듭니다.` }); actions.push(`${big.map(h => h.name).join(', ')}${josa(big.at(-1).name, '은', '는')} 더 사지 말고, 새 돈은 다른 종목이나 지수 ETF로 나누십시오.`); }
  else if (holdings.length) checks.push({ key: 'single', tone: 1, title: `한 종목 비중 ${t.single}% 이하`, text: '특정 종목에 지나치게 몰려 있지 않습니다.' });
  // 3. 업종 집중
  const topSector = sectors.find(s => s.label !== '분류 없음');
  if (topSector && topSector.pct > t.sector) { checks.push({ key: 'sector', tone: -1, title: `${topSector.label} 업종 ${r0(topSector.pct)}%`, text: `같은 업종은 함께 오르고 함께 빠집니다. 기준은 ${t.sector}% 이하입니다.` }); actions.push(`${topSector.label}${josa(topSector.label, '이', '가')} 아닌 업종(예: 소비재·헬스케어·금융) 또는 지수 ETF로 분산을 검토하십시오.`); }
  else if (topSector) checks.push({ key: 'sector', tone: 1, title: `업종 분산 양호 (가장 큰 업종 ${topSector.label} ${r0(topSector.pct)}%)`, text: '한 업종에 지나치게 몰려 있지 않습니다.' });
  // 4. 나라·통화
  const kr = countries.find(c => c.label === '국내')?.pct ?? 0;
  if (holdings.length && (kr > 85 || kr < 15)) checks.push({ key: 'country', tone: 0, title: kr > 85 ? `국내 주식 ${r0(kr)}%` : `해외 주식 ${r0(100 - kr)}%`, text: kr > 85 ? '한국 시장에만 기대고 있습니다. 미국 지수 ETF 등으로 일부 나누면 한쪽 시장이 빠질 때 덜 흔들립니다.' : '원·달러 환율 변화가 수익에 크게 영향을 줍니다.' });
  // 5. 배당
  if (stocks > 0) { const y = dividend / stocks * 100;
    checks.push({ key: 'dividend', tone: style === 'dividend' && y < 2.5 ? -1 : 0, title: `예상 연 배당 약 ${Math.round(dividend / 1e4).toLocaleString('ko-KR')}만원 (주식의 ${y.toFixed(1)}%)`, text: style === 'dividend' && y < 2.5 ? '배당 성향인데 배당 비중이 낮습니다. 배당수익률 3% 이상 종목·배당 ETF 비중을 늘리는 방향을 검토하십시오.' : '최근 배당수익률로 계산한 대략적인 연간 배당입니다. 세금(국내 15.4%) 전입니다.' }); }
  // 6. 종목 판단 연결
  const buy = holdings.filter(h => h.stance === 'buy' && !(pctOf(h.valueKrw, stocks) > t.single)), trim = holdings.filter(h => h.stance === 'trim');
  if (buy.length && (cashPct === null || cashPct >= t.cash[0])) actions.push(`추가로 산다면 지표가 좋은 ${buy.slice(0, 3).map(h => h.name).join(', ')}부터 검토하십시오. 한 번에 사지 말고 나눠서 사는 편이 안전합니다.`);
  if (trim.length) actions.push(`${trim.map(h => h.name).join(', ')}${josa(trim.at(-1).name, '은', '는')} 지표가 약합니다. 처음 산 이유가 아직 맞는지 확인하고, 아니라면 비중을 줄이는 방향을 검토하십시오.`);
  if (!actions.length && holdings.length) actions.push('지금 구성은 기준 안에 있습니다. 정해 둔 날에 정해 둔 금액을 적립하는 방식을 유지하십시오.');
  return { stocks, cash, total, cashPct, sectors, countries, dividend, checks, actions, targets: t };
}

// 받침에 맞는 조사: josa('SK하이닉스', '은', '는') → '는'. 한글이 아니면 받침 없음으로 본다.
export function josa(word, withBatchim, without) {
  const ch = String(word || '').trim().replace(/["')\]]+$/, '').slice(-1), code = ch.charCodeAt(0) - 0xac00;
  if (/\d/.test(ch)) return '013678'.includes(ch) ? withBatchim : without; // 영·일·삼·육·칠·팔
  return code >= 0 && code <= 11171 && code % 28 ? withBatchim : without;
}
