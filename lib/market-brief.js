// 보유 종목 종합 리포트 엔진 (브라우저·서버 공용, 순수 함수).
// 가격·지수·뉴스·공시·실적을 모아 "왜 움직였나 / 큰 흐름 / 지금 점검할 것"을 근거와 함께 만든다.
// 인과를 단정하지 않는다: 시장 연동 몫은 통계 추정이고, 뉴스·공시는 같은 시점에 나온 후보다.

const round = (v, d = 2) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 1 : 2)}%` : '—';
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function cleanCandles(candles = []) {
  return candles.filter(c => c && typeof c.date === 'string' && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((c, i, arr) => i === 0 || c.date !== arr[i - 1].date);
}

// 같은 날짜에 둘 다 값이 있는 구간의 일간 수익률(%) 쌍.
export function alignedReturns(stock, index) {
  const s = cleanCandles(stock), idx = new Map(cleanCandles(index).map(c => [c.date, c.close])), out = [];
  for (let i = 1; i < s.length; i++) {
    const a = idx.get(s[i - 1].date), b = idx.get(s[i].date);
    if (a && b) out.push({ date: s[i].date, stock: (s[i].close / s[i - 1].close - 1) * 100, market: (b / a - 1) * 100 });
  }
  return out;
}

export function estimateBeta(pairs, lookback = 120) {
  const xs = pairs.slice(-lookback);
  if (xs.length < 40) return { beta: 1, reliable: false, n: xs.length };
  const mx = mean(xs.map(p => p.market)), my = mean(xs.map(p => p.stock));
  let cov = 0, vx = 0, vy = 0;
  for (const p of xs) { cov += (p.market - mx) * (p.stock - my); vx += (p.market - mx) ** 2; vy += (p.stock - my) ** 2; }
  if (vx === 0) return { beta: 1, reliable: false, n: xs.length };
  const beta = Math.max(0, Math.min(3, cov / vx)), corr = vy ? cov / Math.sqrt(vx * vy) : 0;
  return { beta: round(beta, 2), correlation: round(corr, 2), reliable: true, n: xs.length };
}

const NAME_NOISE = /\(주\)|㈜|주식회사|\s/g;
export function relevantTo(name, text) {
  const key = String(name || '').replace(NAME_NOISE, '');
  if (key.length < 2) return false;
  return String(text || '').replace(/\s/g, '').includes(key);
}

const CATEGORY_RULES = [
  ['earnings', '실적', /실적|영업이익|매출|순이익|분기|어닝|컨센서스|흑자|적자/],
  ['contract', '수주·계약', /수주|공급\s?계약|계약\s?체결|납품|수출\s?계약/],
  ['analyst', '증권사 전망', /목표\s?(주)?가|투자\s?의견|리포트|커버리지|매수\s?의견|중립\s?의견/],
  ['flow', '수급', /외국인|기관|순매수|순매도|공매도|수급|개미|개인\s?투자자/],
  ['corporate', '회사 결정', /유상증자|무상증자|자사주|자기주식|배당|합병|인수|분할|상장|지분/],
  ['industry', '업황·산업', /반도체|HBM|D램|낸드|AI|인공지능|2차\s?전지|배터리|바이오|신약|조선|방산|자동차|업황|수요/],
  ['macro', '시장 전체', /금리|환율|연준|Fed|FOMC|관세|유가|CPI|물가|코스피|코스닥|나스닥|S&P|증시|경기/],
  ['risk', '위험 요인', /소송|제재|리콜|압수수색|횡령|배임|조사|중단|사고|경고/]
];
const POSITIVE = /최대|호실적|서프라이즈|흑자\s?전환|수주|상향|급등|신고가|강세|돌파|반등|승인|확대|개선|회복|매수|성장|증가|기대|상회|호재|훈풍|수혜/;
const NEGATIVE = /적자|쇼크|부진|하향|급락|약세|신저가|유상증자|소송|제재|리콜|중단|우려|하락|악재|손실|철회|감소|둔화|매도|경고|리스크|충격|흔들|규제|불안|부담|압박|폭락|추락|하회/;

export function classifyHeadline(title = '', description = '') {
  const text = `${title} ${description}`;
  const category = CATEGORY_RULES.find(([, , re]) => re.test(text)) || ['other', '기타', null];
  const pos = POSITIVE.test(title), neg = NEGATIVE.test(title);
  return { category: category[0], categoryLabel: category[1], tone: pos && !neg ? 1 : neg && !pos ? -1 : 0 };
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// 최근 영업일 전후(기본 3일)의 관련 뉴스를 주제별로 묶는다.
export function clusterNews(news = [], name, asOf, windowDays = 3) {
  // 제목에 회사 이름이 있는 기사만 쓴다. 본문에 한 번 언급된 기사는 원인 근거로 약하다.
  const items = news.filter(n => n?.title && n.publishedAt && relevantTo(name, n.title))
    .map(n => ({ ...n, date: n.publishedAt.slice(0, 10), ...classifyHeadline(n.title, n.description) }))
    .filter(n => { const d = daysBetween(n.date, asOf); return d >= -1 && d <= windowDays; });
  const groups = new Map();
  for (const n of items) { const g = groups.get(n.category) || { category: n.category, label: n.categoryLabel, items: [], tone: 0 }; g.items.push(n); g.tone += n.tone; groups.set(n.category, g); }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

function movingAverage(closes, n) { if (closes.length < n) return null; return mean(closes.slice(-n)); }

export function priceContext(candles) {
  const c = cleanCandles(candles), closes = c.map(x => x.close), last = c.at(-1);
  if (c.length < 2) return null;
  const rets = closes.slice(1).map((v, i) => (v / closes[i] - 1) * 100);
  const dayReturn = rets.at(-1), typical = median(rets.slice(-60).map(Math.abs));
  const ret = n => c.length > n ? (last.close / c.at(-1 - n).close - 1) * 100 : null;
  const year = c.slice(-252), high = Math.max(...year.map(x => x.close)), low = Math.min(...year.map(x => x.close));
  const vols = c.slice(-21, -1).map(x => x.volume).filter(v => Number.isFinite(v) && v > 0);
  const volumeRatio = Number.isFinite(last.volume) && vols.length >= 10 ? last.volume / mean(vols) : null;
  const sd = Math.sqrt(mean(rets.slice(-60).map(r => r * r)) || 0);
  return {
    asOf: last.date, close: last.close, dayReturn: round(dayReturn), typicalMove: round(typical), moveRatio: typical ? round(Math.abs(dayReturn) / typical, 1) : null,
    week: round(ret(5)), month: round(ret(20)), quarter: round(ret(60)),
    ma20: movingAverage(closes, 20), ma60: movingAverage(closes, 60), high52: high, low52: low,
    fromHigh: round((last.close / high - 1) * 100), fromLow: round((last.close / low - 1) * 100),
    volumeRatio: round(volumeRatio, 1), annualVolatility: round(sd * Math.sqrt(252), 1)
  };
}

// 하루 움직임을 시장 연동 추정 몫과 종목 고유 몫으로 나눈다.
export function decomposeMove(stockCandles, indexCandles) {
  const pairs = alignedReturns(stockCandles, indexCandles), last = pairs.at(-1), stockLast = cleanCandles(stockCandles).at(-1);
  if (!last || last.date !== stockLast?.date) return { available: false, reason: '같은 날짜의 시장 지수 자료가 없습니다.' };
  const fit = estimateBeta(pairs.slice(0, -1));
  const expected = fit.beta * last.market, own = last.stock - expected;
  const sameSign = Math.sign(expected) === Math.sign(last.stock) && last.stock !== 0;
  const marketShare = sameSign ? Math.min(1, Math.abs(expected) / Math.abs(last.stock)) : 0;
  return { available: true, date: last.date, stock: round(last.stock), market: round(last.market), beta: fit.beta, betaReliable: fit.reliable, correlation: fit.correlation ?? null,
    expected: round(expected), own: round(own), marketShare: round(marketShare, 2) };
}

const MATERIAL = new Set(['earnings', 'contract', 'dilution', 'buyback', 'treasury-sale', 'dividend', 'control', 'risk', 'restructure', 'capex']);
const DISCLOSURE_TONE = { contract: 1, buyback: 1, dividend: 1, capex: 1, dilution: -1, 'treasury-sale': -1, risk: -1 };

// 핵심: 근거를 종합해 한 줄 판단, 원인 후보, 큰 흐름, 점검 항목을 만든다.
export function composeBrief({ name, symbol, currency = 'KRW', marketName = '시장', candles, indexCandles, news = [], disclosures = [], financials = null, holding = null }) {
  const ctx = priceContext(candles);
  if (!ctx) return { name, symbol, available: false, headline: `${name}: 가격 자료가 부족해 리포트를 만들 수 없습니다.` };
  const move = indexCandles?.length ? decomposeMove(candles, indexCandles) : { available: false, reason: '시장 지수 자료 없음' };
  const dir = Math.sign(ctx.dayReturn);
  const recentDisclosures = (Array.isArray(disclosures) ? disclosures : []).filter(d => MATERIAL.has(d.kind) && daysBetween(d.date, ctx.asOf) >= 0 && daysBetween(d.date, ctx.asOf) <= 3);
  const clusters = clusterNews(news, name, ctx.asOf);
  const causes = [];
  const small = ctx.moveRatio !== null && ctx.moveRatio < 0.6;

  if (move.available && move.marketShare >= 0.6 && Math.abs(ctx.dayReturn) >= 0.3) {
    causes.push({ kind: 'market', confidence: move.betaReliable ? 'high' : 'medium', title: `${marketName} 전체 움직임의 영향이 큽니다`,
      detail: `${marketName} ${pct(move.market)} · 이 종목은 평소 시장의 ${move.beta}배로 움직여 약 ${pct(move.expected)}가 시장 몫으로 추정됩니다.` });
  }
  const ownDir = move.available ? Math.sign(move.own) : dir;
  const ownMeaningful = !move.available || Math.abs(move.own) >= Math.max(0.8, (ctx.typicalMove || 1) * 0.6);
  if (ownMeaningful) {
    // 방향이 정해진 공시(계약·증자 등)는 주가 방향과 맞을 때만 원인 후보다. 실적 공시처럼 방향이 내용에 달린 것은 '보통'.
    for (const d of recentDisclosures) {
      const tone = DISCLOSURE_TONE[d.kind] ?? 0, fits = tone === 0 ? null : tone === ownDir;
      causes.push({ kind: 'disclosure', confidence: fits === true ? 'high' : fits === null ? 'medium' : 'low', title: `${d.date} 공시: ${d.label}`, detail: d.title, link: d.link, fits });
    }
    for (const g of clusters) {
      if (g.category === 'other') continue;
      const tone = Math.sign(g.tone), fits = tone === 0 ? null : tone === ownDir;
      if (fits === false && g.items.length < 2) continue;
      causes.push({ kind: 'news', confidence: fits === true && g.items.length >= 2 ? 'medium' : 'low', title: `${g.label} 관련 기사 ${g.items.length}건`, detail: g.items[0].title, link: g.items[0].link, source: g.items[0].sourceHost, fits, items: g.items.slice(0, 3) });
    }
    if (!causes.some(c => c.kind !== 'market' && c.fits !== false && c.confidence !== 'low')) {
      causes.push({ kind: 'unknown', confidence: 'low', title: '뚜렷한 개별 원인을 찾지 못했습니다', detail: '같은 시점에 방향이 맞는 관련 공시·기사가 없습니다. 수급이나 업종 흐름일 수 있으나 확정할 수 없습니다.' });
    }
  }
  for (const c of causes) if (c.fits === false) c.title += ' (주가 방향과 반대)';
  const rank = { high: 0, medium: 1, low: 2 };
  const order = c => c.fits === false ? 4 : c.kind === 'unknown' ? 3 : rank[c.confidence];
  causes.sort((a, b) => order(a) - order(b));

  // 한 줄 판단
  let headline;
  const lead = `${name} ${pct(ctx.dayReturn)}`;
  if (small) headline = `${lead} · 평소 하루 변동(±${ctx.typicalMove}%)보다 작은 움직임입니다.`;
  else if (causes[0]?.kind === 'market') headline = `${lead} · 대부분 ${marketName} 전체 흐름(${pct(move.market)})에 따른 움직임입니다.`;
  else if (causes[0] && causes[0].kind !== 'unknown' && causes[0].fits !== false && causes[0].confidence !== 'low') headline = `${lead} · 시장과 다르게 움직였고, 주요 원인 후보는 ${causes[0].title.replace(/^\d{4}-\d{2}-\d{2} /, '')}입니다.`;
  else headline = `${lead} · 시장과 다르게 움직였지만 확인된 원인은 없습니다.`;

  // 큰 흐름
  const context = [];
  if (ctx.month !== null) context.push({ label: '최근 한 달', value: pct(ctx.month), tone: Math.sign(ctx.month) });
  if (ctx.ma60) context.push({ label: '추세 (60일 평균선)', value: ctx.close >= ctx.ma60 ? '평균선 위 · 상승 흐름 유지' : '평균선 아래 · 약세 흐름', tone: ctx.close >= ctx.ma60 ? 1 : -1 });
  context.push({ label: '1년 고점 대비', value: pct(ctx.fromHigh), tone: ctx.fromHigh > -10 ? 1 : ctx.fromHigh < -30 ? -1 : 0 });
  if (ctx.volumeRatio) context.push({ label: '오늘 거래량', value: `평소의 ${ctx.volumeRatio}배`, tone: 0 });
  const growth = financials && !financials.error ? financials.growth : null;
  if (growth) context.push({ label: `실적 (${financials.year} ${financials.period}, 전년 대비)`, value: `매출 ${pct(growth.revenue)} · 영업이익 ${pct(growth.operatingIncome)}`, tone: Math.sign((growth.operatingIncome ?? 0) + (growth.revenue ?? 0)) });

  // 지금 점검할 것 (사고팔라는 지시가 아니라 충동 매매를 막는 점검)
  const checks = [];
  if (small) checks.push('평소 범위의 움직임입니다. 이것만으로 사고팔 이유는 약합니다.');
  else if (causes[0]?.kind === 'market') checks.push(dir < 0 ? '시장 전체 하락입니다. 회사 문제로 보기 어렵습니다. 처음 산 이유가 그대로인지만 확인하십시오.' : '시장 전체 상승입니다. 이 종목만의 호재로 보고 추가 매수하지 않도록 주의하십시오.');
  if (causes.some(c => c.kind === 'disclosure' && c.confidence === 'high')) checks.push('공시 원문을 먼저 읽고, 실적·사업 계획에 실제로 영향을 주는지 확인하십시오.');
  if (ctx.month !== null && ctx.month > 20) checks.push(`한 달 새 ${pct(ctx.month)} 올랐습니다. 지금 사면 추격 매수가 될 수 있어 분할 매수가 안전합니다.`);
  if (ctx.month !== null && ctx.month < -20 && growth && growth.operatingIncome > 0) checks.push('주가는 크게 내렸지만 최근 실적은 늘었습니다. 공포 매도 전에 하락 이유를 확인하십시오.');
  if (growth && growth.operatingIncome < -20) checks.push('영업이익이 전년보다 크게 줄었습니다. 실적 악화가 일시적인지 확인하십시오.');
  if (holding?.weightPct > 35) checks.push(`보유 주식의 ${round(holding.weightPct, 0)}%가 이 종목입니다. 한 종목 비중이 높아 변동이 계좌 전체를 흔듭니다.`);
  if (!checks.length) checks.push('특별히 대응할 신호는 없습니다. 정한 원칙대로 유지하십시오.');

  return {
    name, symbol, currency, available: true, asOf: ctx.asOf, headline, tone: small ? 0 : dir,
    price: ctx, move, causes: causes.slice(0, 4), context, checks: checks.slice(0, 3),
    financials: financials && !financials.error ? financials : null,
    disclosures: (Array.isArray(disclosures) ? disclosures : []).filter(d => d.kind !== 'other').slice(0, 5),
    news: clusters.flatMap(g => g.items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5),
    holding,
    caveat: '시장 몫은 과거 1년 동조성으로 추정한 값이고, 기사·공시는 같은 시점에 나온 원인 후보입니다. 인과관계를 확정하지 않습니다.'
  };
}

// 여러 종목 리포트를 계좌 한 줄 요약으로 묶는다.
export function summarizePortfolio(briefs, holdings = []) {
  const ok = briefs.filter(b => b.available);
  if (!ok.length) return { headline: '아직 리포트를 만든 종목이 없습니다.', up: 0, down: 0 };
  const up = ok.filter(b => b.price.dayReturn > 0).length, down = ok.filter(b => b.price.dayReturn < 0).length;
  const marketDriven = ok.filter(b => b.causes[0]?.kind === 'market').length;
  const totalValue = holdings.reduce((s, h) => s + (h.valueKrw || 0), 0);
  const weighted = totalValue ? ok.reduce((s, b) => { const h = holdings.find(x => x.symbol === b.symbol); return s + (h?.valueKrw || 0) / totalValue * b.price.dayReturn; }, 0) : null;
  const biggest = [...ok].sort((a, b) => Math.abs(b.price.dayReturn) - Math.abs(a.price.dayReturn))[0];
  let headline = `보유 ${ok.length}종목 중 ${up}개 상승, ${down}개 하락.`;
  if (marketDriven >= Math.ceil(ok.length / 2)) headline += ' 오늘 움직임은 대부분 시장 전체 흐름 때문입니다.';
  else headline += ` 가장 크게 움직인 종목은 ${biggest.name}(${pct(biggest.price.dayReturn)})입니다.`;
  return { headline, up, down, marketDriven, weightedReturn: round(weighted), biggest: biggest.symbol };
}
