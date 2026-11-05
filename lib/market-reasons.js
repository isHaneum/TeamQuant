// "오늘 시장은 왜 움직였나": 장 마감 기사에서 시장 지수를 다룬 기사만 고르고, 기사에 나온 이유를 주제로 묶는다.
// 이유를 지어내지 않는다. 기사 제목·요약에 실제로 나온 낱말만 주제로 센다.

export const THEMES = [
  ['정치·선거', /선거|상원|하원|의회|민주당|공화당|대선|중간선거|탄핵|셧다운|백악관|트럼프|대통령/],
  ['금리·연준', /금리|연준|Fed|FOMC|파월|국채|통화정책|한은|기준금리/i],
  ['관세·무역', /관세|무역|수출 ?규제|보호무역/],
  ['환율·달러', /환율|달러|원화|엔화|원·달러|원\/달러/],
  ['반도체·AI', /반도체|AI|인공지능|엔비디아|HBM|칩|빅테크/],
  ['기업 실적', /실적|어닝|영업이익|매출|가이던스/],
  ['물가·고용', /물가|CPI|PCE|인플레|고용|실업|일자리/],
  ['유가·원자재', /유가|원유|국제유가|금값|원자재|구리/],
  ['중국', /중국|위안|홍콩|상하이/],
  ['전쟁·지정학', /전쟁|분쟁|중동|우크라|이스라엘|이란|북한|지정학/],
  ['외국인·기관 매매', /외국인|기관|개인 순매|순매도|순매수|매도세|매수세|차익 ?실현|공매도|프로그램 매매/],
  ['경기 침체 우려', /침체|경기 둔화|리세션|경착륙/]
];

const SCOPE = {
  KR: { query: '코스피 마감', match: /코스피|코스닥|국내 ?증시|한국 ?증시|증시/ },
  US: { query: '뉴욕증시 마감', match: /뉴욕 ?증시|다우|나스닥|S&P|미 ?증시|미국 ?증시|월가/ }
};
export const marketQuery = scope => SCOPE[scope].query;

export function themesOf(text) { return THEMES.filter(([, re]) => re.test(text)).map(([label]) => label); }

/**
 * @param items 뉴스 검색 결과 [{title,description,link,sourceHost,publishedAt}]
 * @param scope 'KR' | 'US'
 * @param now   기준 시각(ms). 최근 hours 시간 안의 기사만 쓴다.
 */
export function marketReasons(items = [], { scope = 'KR', now = Date.now(), hours = 48, direction = 0 } = {}) {
  const re = SCOPE[scope].match, moveWord = /마감|하락|상승|급락|급등|반등|약세|강세|출렁|폭락|폭등|떨어|올라|내려/;
  const fresh = items.filter(a => a?.title && (!a.publishedAt || now - Date.parse(a.publishedAt) <= hours * 3600000));
  const scored = fresh.filter(a => re.test(a.title)).map(a => {
    const text = `${a.title} ${a.description || ''}`, themes = themesOf(text);
    // 지수 방향과 맞는 기사(하락한 날의 '하락' 기사)를 앞에 둔다.
    const dirFit = direction < 0 ? /하락|급락|약세|떨어|내려|폭락/.test(a.title) : direction > 0 ? /상승|급등|강세|올라|반등|폭등/.test(a.title) : false;
    return { ...a, themes, score: themes.length * 2 + (moveWord.test(a.title) ? 1 : 0) + (dirFit ? 2 : 0) };
  }).sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const counts = new Map();
  for (const a of scored.slice(0, 10)) for (const t of a.themes) counts.set(t, (counts.get(t) || 0) + 1);
  const themes = [...counts].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  const articles = scored.slice(0, 3).map(({ title, description, link, sourceHost, publishedAt, themes }) => ({ title, description, link, sourceHost, publishedAt, themes }));
  const top = themes.filter(t => t.count >= 1).slice(0, 3).map(t => t.label);
  return {
    available: articles.length > 0, themes, articles,
    summary: !articles.length ? '시장 마감 기사를 찾지 못했습니다.' : top.length ? `기사에 가장 많이 나온 이유: ${top.join(', ')}` : '기사에서 뚜렷한 이유 낱말을 찾지 못했습니다. 아래 기사 원문을 확인하십시오.'
  };
}
