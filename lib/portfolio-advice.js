// 비중 점검: 보유 주식 + 직접 기록한 현금으로 현금 비중·집중도·업종·나라·배당을 기준값과 비교한 사실을 적는다.
// 매수·매도 지시나 종목별 후보는 내지 않는다(2026-11-27 LEGAL 2.1 '종목별 사라·팔라 방향 표시 금지' · 4.3). 기준값은 화면에 함께 보여 준다.

export const TARGETS = {
  balanced: { cash: [10, 30], single: 25, sector: 40 },
  growth: { cash: [5, 20], single: 30, sector: 50 },
  value: { cash: [10, 30], single: 25, sector: 40 },
  dividend: { cash: [10, 25], single: 20, sector: 35 }
};

const pctOf = (a, b) => b > 0 ? a / b * 100 : null;
const r0 = v => Math.round(v);
const hasRules = rules => !!rules && Number.isFinite(rules.maxSingle) && Number.isFinite(rules.minCash);

/**
 * 한 종목 한도와 비중을 나눌 기준. 비중 점검(아래)과 종목 점검 표(portfolio-ui.js 비중 열·지표 요약 라벨)가 같은 값을 쓴다.
 * 내 규칙이 있으면 그 한 종목 최대 비중(규칙 화면과 같이 현금을 알면 총자산 대비, 모르면 주식 합계 대비).
 * 내 규칙이 없으면(팀 모의계좌 등) 투자 성향 기준값, 주식 합계 대비.
 * @returns {single, mine, base, baseName}
 */
export function weightRule({ stocks = 0, cash = null, style = 'balanced', rules = null } = {}) {
  const mine = hasRules(rules), onTotal = mine && Number.isFinite(cash);
  return { single: mine ? rules.maxSingle : (TARGETS[style] || TARGETS.balanced).single, mine, base: onTotal ? stocks + cash : stocks, baseName: onTotal ? '총자산' : '주식' };
}

/**
 * @param holdings [{symbol,name,valueKrw,currency,sector,dividendYield}]
 * @param cash 원화 현금(모르면 null)
 * @param rules 규칙 화면의 내 한도 {maxSingle, minCash}(총자산 대비 %). 주면 한 종목·현금 하한을 이 값으로 점검한다(성향 기준 대신).
 */
export function advisePortfolio(holdings = [], { cash = null, style = 'balanced', rules = null } = {}) {
  const base = TARGETS[style] || TARGETS.balanced, mine = hasRules(rules);
  const t = mine ? { ...base, single: rules.maxSingle, cash: [rules.minCash, Math.max(rules.minCash, base.cash[1])], mine: true } : base;
  const stocks = holdings.reduce((s, h) => s + (h.valueKrw || 0), 0), total = stocks + (Number.isFinite(cash) ? cash : 0);
  const cashPct = Number.isFinite(cash) ? pctOf(cash, total) : null;
  // 내 규칙의 한 종목 한도는 총자산(현금 포함) 대비. 현금을 모르면 규칙 화면처럼 주식 합계 대비로 본다.
  const { base: weightBase, baseName } = weightRule({ stocks, cash, style, rules }), whose = mine ? '내 규칙' : '성향 기준';
  const group = key => { const m = new Map(); for (const h of holdings) { const k = h[key] || '분류 없음'; m.set(k, (m.get(k) || 0) + (h.valueKrw || 0)); } return [...m].map(([label, value]) => ({ label, value, pct: pctOf(value, stocks) })).sort((a, b) => b.value - a.value); };
  const sectors = group('sector'), countries = group('country');
  const dividend = holdings.reduce((s, h) => s + (h.valueKrw || 0) * ((h.dividendYield > 0 ? h.dividendYield : 0) / 100), 0);
  const checks = [], actions = [];
  // 1. 현금
  if (cashPct === null) checks.push({ key: 'cash', tone: 0, title: '현금을 기록하면 전체 비중을 점검할 수 있습니다', text: '증권사 예수금·CMA·통장 중 투자에 쓸 돈을 적어 주세요. 현금이 없으면 급할 때 손실 중인 주식을 팔게 됩니다.' });
  // 2026-11-27(LEGAL 4.3 · H4): 방향을 권하는 문장 대신 사실 + 내 규칙 결과만 쓴다. 같은 날 보완 2(사용자 지시 "줄글 설명 제거"): actions 는 문장이 아니라 상태 줄('✕ 규칙 이름 · 지금 값 · 한도')로 쓴다(뜻은 같음 · LEGAL 4.3 보완 2).
  else if (cashPct < t.cash[0]) { checks.push({ key: 'cash', tone: -1, title: `현금 ${r0(cashPct)}% · 기준(${t.cash[0]}~${t.cash[1]}%)보다 적음`, text: '시장이 크게 빠질 때 살 돈이 없고, 생활비가 필요하면 주식을 팔아야 합니다.' }); actions.push(`✕ 현금 최소 비중 · 현금 ${r0(cashPct)}% · 최소 ${t.cash[0]}% (${whose})`); }
  else if (cashPct > t.cash[1]) { checks.push({ key: 'cash', tone: 0, title: `현금 ${r0(cashPct)}% · 기준(${t.cash[0]}~${t.cash[1]}%)보다 많음`, text: '물가만큼 가치가 줄 수 있습니다.' });
    const extra = cash - total * (t.cash[1] / 100); actions.push(`현금 기준 상한(${t.cash[1]}%) 넘음 · 약 ${Math.round(extra / 1e4).toLocaleString('ko-KR')}만 원`); }
  else checks.push({ key: 'cash', tone: 1, title: `현금 ${r0(cashPct)}% · 기준 범위 안`, text: '급할 때 쓸 돈과 기회가 왔을 때 살 돈이 적당히 있습니다.' });
  // 2. 한 종목 집중
  const big = holdings.filter(h => pctOf(h.valueKrw, weightBase) > t.single).sort((a, b) => b.valueKrw - a.valueKrw);
  if (big.length) { checks.push({ key: 'single', tone: -1, title: `한 종목 비중이 큼: ${big.map(h => `${h.name} ${r0(pctOf(h.valueKrw, weightBase))}%`).join(', ')}`, text: `한 종목이 ${baseName}의 ${t.single}%를 넘으면 그 종목 하나가 계좌 전체를 흔듭니다.` }); actions.push(`✕ 한 종목 최대 비중 · ${big.map(h => `${h.name} ${r0(pctOf(h.valueKrw, weightBase))}%`).join(', ')} · 한도 ${t.single}% (${whose})`); }
  else if (holdings.length) checks.push({ key: 'single', tone: 1, title: `한 종목 비중 ${t.single}% 이하`, text: '특정 종목에 지나치게 몰려 있지 않습니다.' });
  // 3. 업종 집중
  const topSector = sectors.find(s => s.label !== '분류 없음');
  if (topSector && topSector.pct > t.sector) { checks.push({ key: 'sector', tone: -1, title: `${topSector.label} 업종 ${r0(topSector.pct)}%`, text: `같은 업종은 함께 오르고 함께 빠집니다. 기준은 ${t.sector}% 이하입니다.` }); actions.push(`✕ 섹터 상한 · ${topSector.label} ${r0(topSector.pct)}% · 상한 ${t.sector}%`); }
  else if (topSector) checks.push({ key: 'sector', tone: 1, title: `업종 분산 양호 (가장 큰 업종 ${topSector.label} ${r0(topSector.pct)}%)`, text: '한 업종에 지나치게 몰려 있지 않습니다.' });
  // 4. 나라·통화
  const kr = countries.find(c => c.label === '국내')?.pct ?? 0;
  if (holdings.length && (kr > 85 || kr < 15)) checks.push({ key: 'country', tone: 0, title: kr > 85 ? `국내 주식 ${r0(kr)}%` : `해외 주식 ${r0(100 - kr)}%`, text: kr > 85 ? `주식의 ${r0(kr)}%가 국내 주식입니다. 한 나라 시장의 움직임이 계좌 전체에 그대로 옵니다.` : '원·달러 환율 변화가 수익에 크게 영향을 줍니다.' });
  // 5. 배당
  if (stocks > 0) { const y = dividend / stocks * 100;
    checks.push({ key: 'dividend', tone: style === 'dividend' && y < 2.5 ? -1 : 0, title: `예상 연 배당 약 ${Math.round(dividend / 1e4).toLocaleString('ko-KR')}만 원 (주식의 ${y.toFixed(1)}%)`, text: style === 'dividend' && y < 2.5 ? `고른 성향(배당) 기준보다 예상 배당률이 낮습니다(${y.toFixed(1)}% · 기준 2.5%)` : '최근 배당률로 계산한 대략적인 1년 배당입니다. 세금(국내 15.4%) 전입니다.' }); }
  // 6. (2026-11-27 뺌) 종목 이름별 '지표 상위 · 더 살지는'·'지표가 약한 종목' 줄: 한도 안 · 현금 충분한 종목만 골라 사실상 매수 후보 목록이 됐다(LEGAL 2.1).
  //    같은 지표 요약은 종목 점검 표의 '지표 요약' 열에만 둔다. 종목을 권하지 않는다(결정 63).
  if (!actions.length && holdings.length) actions.push(mine ? '✓ 내 규칙·기준 안' : '✓ 성향 기준 안');
  return { stocks, cash, total, cashPct, sectors, countries, dividend, checks, actions, targets: t };
}

// 받침에 맞는 조사: josa('SK하이닉스', '은', '는') → '는'. 한글이 아니면 받침 없음으로 본다.
export function josa(word, withBatchim, without) {
  const ch = String(word || '').trim().replace(/["')\]]+$/, '').slice(-1), code = ch.charCodeAt(0) - 0xac00;
  if (/\d/.test(ch)) return '013678'.includes(ch) ? withBatchim : without; // 영·일·삼·육·칠·팔
  return code >= 0 && code <= 11171 && code % 28 ? withBatchim : without;
}
