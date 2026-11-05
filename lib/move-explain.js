// 종목 상세의 "오늘 왜 움직였나"를 한 문단 결론 + 근거 목록으로 만든다.
// 예전에는 '참고' 기사 목록과 '원인을 찾지 못했다'가 함께 나와 모순처럼 보였다.
// 이제 결론은 하나이고, 기사는 "주가 방향과 맞는지"를 표시한 근거로만 보여 준다.

const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';

export function explainMove(b, { market = null, sectorName = null, sectorToday = null } = {}) {
  if (!b?.available) return { conclusion: b?.headline || '가격 자료가 없어 설명할 수 없습니다.', evidence: [] };
  const p = b.price, dir = Math.sign(p.dayReturn), word = dir < 0 ? '하락' : dir > 0 ? '상승' : '보합';
  const size = p.moveRatio === null ? 'normal' : p.moveRatio < 0.6 ? 'small' : p.moveRatio < 1.5 ? 'normal' : p.moveRatio < 2.5 ? 'big' : 'huge';
  const sizeText = { small: '평소보다 작은', normal: '평소 수준의', big: '평소보다 큰', huge: '이례적으로 큰' }[size];
  const evidence = [];
  for (const c of b.causes || []) {
    if (c.kind === 'disclosure' || c.kind === 'news') evidence.push({ kind: c.kind, title: c.detail, label: c.title.replace(/ \(주가 방향과 반대\)$/, ''), link: c.link, source: c.source, fit: c.fits === true ? 'match' : c.fits === false ? 'opposite' : 'neutral' });
  }
  const parts = [`오늘 ${pct(p.dayReturn)}는 ${sizeText} ${word}입니다${p.typicalMove ? ` (평소 하루 ±${p.typicalMove}%)` : ''}.`];
  const m = b.move, marketLed = m?.available && m.marketShare >= 0.6 && Math.abs(p.dayReturn) >= 0.3;
  const sectorLed = Number.isFinite(sectorToday) && Math.sign(sectorToday) === dir && Math.abs(sectorToday) >= 1.5;
  const strongDisclosure = evidence.find(e => e.kind === 'disclosure' && e.fit === 'match');
  const fittingNews = evidence.filter(e => e.kind === 'news' && e.fit === 'match');
  let main;
  if (strongDisclosure) main = `가장 유력한 이유는 공시입니다: ${strongDisclosure.label.replace(/^\d{4}-\d{2}-\d{2} 공시: /, '')}.`;
  else if (marketLed) main = `대부분 ${b.marketName} 전체 움직임(${pct(m.market)}) 때문입니다. 이 종목은 평소 시장의 ${m.beta}배로 움직여 약 ${pct(m.expected)}가 시장 몫입니다.${market?.themes?.length ? ` 기사에 나온 시장의 이유는 ${market.themes.slice(0, 2).map(t => t.label).join(', ')}입니다.` : ''}`;
  else if (sectorLed) main = `${sectorName || '같은 업종'} 업종 전체가 ${pct(sectorToday)} 움직인 날입니다. 회사 고유의 문제라기보다 업종 흐름으로 보입니다.`;
  else if (fittingNews.length) main = `주가 방향과 맞는 ${fittingNews[0].label.replace(/ 관련 기사 \d+건$/, '')} 기사가 있습니다: "${fittingNews[0].title}".`;
  else if (size === 'small' || size === 'normal') main = `특별한 소식이 없어도 나올 수 있는 크기라 원인을 하나로 단정할 필요가 없습니다.${evidence.length ? ' 같은 날 나온 기사는 아래에 있지만 주가 방향과 뚜렷하게 맞지는 않습니다.' : ''}`;
  else main = '평소보다 큰 움직임인데 방향이 맞는 공시·기사를 찾지 못했습니다. 외국인·기관의 대량 매매나 아직 기사화되지 않은 소식일 수 있습니다.';
  parts.push(main);
  if (Number.isFinite(sectorToday) && !sectorLed && sectorName) parts.push(`참고로 ${sectorName} 업종은 오늘 ${pct(sectorToday)}입니다.`);
  return { conclusion: parts.join(' '), evidence, size, marketLed, sectorLed };
}
