// 종목 판단: 투자 지표 · 가격 흐름 · 뉴스 · 목표가를 투자 성향별 가중치로 합쳐 "추가 매수 검토 / 보유 유지 / 비중 축소 검토"를 낸다.
// 규칙과 가중치를 모두 화면에 보여 줄 수 있게 이유 목록을 같이 돌려준다. 매수·매도 지시가 아니라 점검 순서를 정하는 도구다.

export const STYLES = {
  balanced: { label: '균형', desc: '가치·수익성·성장·배당을 고르게 봅니다.', w: { value: 1, quality: 1, growth: 1, dividend: 0.7, stability: 0.6, target: 0.6, trend: 0.6, news: 0.5 } },
  growth: { label: '성장', desc: '매출·이익이 빠르게 느는 회사를 우선합니다. 비싼 PER은 덜 감점합니다.', w: { value: 0.4, quality: 0.8, growth: 1.6, dividend: 0.2, stability: 0.4, target: 0.8, trend: 0.8, news: 0.6 } },
  value: { label: '가치', desc: '이익·자산에 비해 싼 회사를 우선합니다.', w: { value: 1.6, quality: 1, growth: 0.5, dividend: 0.7, stability: 0.8, target: 0.6, trend: 0.3, news: 0.4 } },
  dividend: { label: '배당', desc: '꾸준한 배당과 안정적인 재무를 우선합니다.', w: { value: 0.8, quality: 0.8, growth: 0.4, dividend: 1.8, stability: 1.2, target: 0.4, trend: 0.3, news: 0.4 } }
};

const f1 = v => Number.isFinite(v) ? (Math.round(v * 10) / 10).toLocaleString('ko-KR') : '—';

// 각 항목: tone(-1~+1)과 사람이 읽는 설명. 자료가 없으면 null(점수에서 빠짐).
export function factors(fund, { price = null, brief = null } = {}) {
  const out = [], a = fund?.annual || {}, etf = fund?.isEtf;
  const add = (key, label, value, tone, text) => out.push({ key, label, value, tone, text });
  if (!etf) {
    const pe = fund?.forwardPer > 0 ? fund.forwardPer : fund?.per;
    if (fund && (fund.per === null || fund.per <= 0) && !(fund.forwardPer > 0)) add('value', '가격 수준 (PER)', '계산 불가', -0.5, '최근 이익이 없거나 적자라 PER을 계산할 수 없습니다.');
    else if (pe > 0) add('value', '가격 수준 (PER)', `${f1(pe)}배${fund.forwardPer > 0 ? ' (내년 예상)' : ''}`, pe < 10 ? 1 : pe < 20 ? 0.5 : pe < 35 ? 0 : pe < 60 ? -0.5 : -1,
      pe < 10 ? '이익에 비해 주가가 싼 편입니다.' : pe < 20 ? '이익에 비해 보통 수준입니다.' : pe < 35 ? '다소 비싼 편입니다. 성장이 이어져야 정당화됩니다.' : '이익에 비해 매우 비쌉니다. 기대가 꺾이면 크게 빠질 수 있습니다.');
    const q = Number.isFinite(a.roe) ? ['ROE', a.roe, a.roe >= 15 ? 1 : a.roe >= 8 ? 0.3 : a.roe >= 0 ? -0.5 : -1] : Number.isFinite(a.roa) ? ['ROA', a.roa, a.roa >= 8 ? 1 : a.roa >= 4 ? 0.3 : a.roa >= 0 ? -0.5 : -1] : null;
    if (q) add('quality', `돈 버는 힘 (${q[0]})`, `${f1(q[1])}%${Number.isFinite(a.operatingMargin) ? ` · 영업이익률 ${f1(a.operatingMargin)}%` : ''}`, q[2],
      q[2] >= 1 ? '자본 대비 이익을 잘 내는 회사입니다.' : q[2] > 0 ? '이익을 내지만 특별히 높지는 않습니다.' : '자본에 비해 이익이 약합니다.');
    if (Number.isFinite(a.revenueGrowth)) { const g = a.revenueGrowth, og = a.operatingIncomeGrowth;
      add('growth', `성장 (${a.year || '최근'} 매출)`, `${g > 0 ? '+' : ''}${f1(g)}%${Number.isFinite(og) ? ` · 영업이익 ${og > 0 ? '+' : ''}${f1(og)}%` : ''}`, g >= 20 ? 1 : g >= 8 ? 0.5 : g >= 0 ? 0 : -1,
        g >= 20 ? '매출이 빠르게 늘고 있습니다.' : g >= 8 ? '꾸준히 성장하고 있습니다.' : g >= 0 ? '성장이 느립니다.' : '매출이 줄었습니다.'); }
    if (Number.isFinite(a.debtRatio)) add('stability', '재무 안정 (부채비율)', `${f1(a.debtRatio)}%`, a.debtRatio < 100 ? 0.7 : a.debtRatio < 200 ? 0 : -1, a.debtRatio < 100 ? '빚 부담이 적습니다.' : a.debtRatio < 200 ? '보통 수준의 빚입니다.' : '빚이 많아 금리·경기에 약할 수 있습니다.');
  } else if (Number.isFinite(fund?.fee)) add('stability', '보수 (연 비용)', `${f1(fund.fee)}%`, fund.fee <= 0.2 ? 0.7 : fund.fee <= 0.5 ? 0 : -0.5, fund.fee <= 0.2 ? '비용이 낮은 지수형 상품입니다.' : '비용이 다소 높습니다.');
  if (fund) { const y = fund.dividendYield;
    add('dividend', '배당', Number.isFinite(y) && y > 0 ? `연 ${f1(y)}%${Number.isFinite(fund.dividendPerShare) ? ` (주당 ${fund.dividendPerShare.toLocaleString('ko-KR')})` : ''}` : '없음', !(y > 0) ? 0 : y >= 4 ? 1 : y >= 2 ? 0.6 : y >= 1 ? 0.3 : 0.1,
      !(y > 0) ? '배당이 없거나 매우 적어 주가 상승에만 기대야 합니다.' : y >= 4 ? '배당만으로도 의미 있는 수익이 납니다.' : y >= 2 ? '배당이 꽤 쏠쏠합니다.' : '배당이 있지만 크지 않습니다.'); }
  const now = price ?? fund?.price;
  if (Number.isFinite(fund?.targetPrice) && now > 0) { const up = (fund.targetPrice / now - 1) * 100;
    add('target', '증권사 목표가', `${f1(up > 0 ? up : up)}% ${up >= 0 ? '위' : '아래'}${Number.isFinite(fund.analystScore) ? ` · 의견 ${f1(fund.analystScore)}/5` : ''}`, up >= 30 ? 1 : up >= 10 ? 0.5 : up >= 0 ? 0 : -1,
      up >= 10 ? '증권사들은 지금보다 높은 가격을 예상합니다.' : up >= 0 ? '목표가와 현재가가 비슷합니다.' : '주가가 이미 목표가를 넘었습니다.'); }
  if (brief?.available) { const c = brief.price, ma = brief.context?.find(x => x.label.startsWith('추세'));
    if (ma) add('trend', '가격 흐름 (60일 평균선)', ma.value.split(' · ')[0], ma.tone > 0 ? 0.5 : -0.5, ma.tone > 0 ? '최근 3개월 흐름이 위쪽입니다.' : `최근 흐름이 약합니다${Number.isFinite(c.fromHigh) ? ` (1년 고점 대비 ${f1(c.fromHigh)}%)` : ''}.`);
    const tones = (brief.newsTone || []); if (tones.length >= 2) { const s = tones.reduce((n, t) => n + t, 0) / tones.length;
      add('news', '최근 뉴스 분위기', `좋은 소식 ${tones.filter(t => t > 0).length} · 나쁜 소식 ${tones.filter(t => t < 0).length}`, s > 0.25 ? 0.5 : s < -0.25 ? -0.5 : 0, s > 0.25 ? '최근 기사는 대체로 긍정적입니다.' : s < -0.25 ? '최근 기사에 악재가 많습니다.' : '최근 기사는 좋고 나쁜 소식이 섞여 있습니다.'); } }
  return out;
}

export function scoreStock(fund, { style = 'balanced', price, brief, weightPct = null, weightLimit = 30 } = {}) {
  const st = STYLES[style] || STYLES.balanced, list = factors(fund, { price, brief });
  // 배당 성향에서는 배당이 거의 없는 것을 감점한다.
  if (style === 'dividend') for (const f of list) if (f.key === 'dividend') { const y = fund?.dividendYield; f.tone = !(y > 0) || y < 1 ? -1 : y < 2 ? -0.3 : f.tone; if (f.tone < 0) f.text = '배당 중심으로 보기엔 배당이 적습니다.'; }
  const scored = list.filter(f => Number.isFinite(f.tone) && st.w[f.key] > 0), wsum = scored.reduce((n, f) => n + st.w[f.key], 0);
  const score = wsum ? scored.reduce((n, f) => n + f.tone * st.w[f.key], 0) / wsum : null; // -1 ~ +1
  let stance, label;
  if (score === null || scored.length < 3) { stance = 'unknown'; label = '판단 자료 부족'; }
  else if (score >= 0.3) { stance = 'buy'; label = '추가 매수 검토'; }
  else if (score <= -0.25) { stance = 'trim'; label = '비중 축소 검토'; }
  else { stance = 'hold'; label = '보유 유지'; }
  const notes = [];
  if (stance === 'buy' && weightPct > weightLimit) { label = '좋지만 비중이 큼'; notes.push(`이미 보유 주식의 ${Math.round(weightPct)}%입니다. 더 사기보다 다른 종목·현금으로 나누는 편이 안전합니다.`); }
  const pros = scored.filter(f => f.tone > 0).sort((a, b) => b.tone * st.w[b.key] - a.tone * st.w[a.key]).slice(0, 2);
  const cons = scored.filter(f => f.tone < 0).sort((a, b) => a.tone * st.w[a.key] - b.tone * st.w[b.key]).slice(0, 2);
  const summary = stance === 'unknown' ? '지표가 부족해 종합 판단을 내리지 않습니다.' : [pros.length ? `좋은 점: ${pros.map(f => f.label.replace(/ \(.*\)/, '')).join(', ')}` : '', cons.length ? `걸리는 점: ${cons.map(f => f.label.replace(/ \(.*\)/, '')).join(', ')}` : ''].filter(Boolean).join(' · ');
  return { stance, label, score: score === null ? null : Math.round(score * 100) / 100, style, styleLabel: st.label, factors: list, pros, cons, summary, notes };
}
