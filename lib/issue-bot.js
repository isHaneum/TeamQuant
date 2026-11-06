// 실시간 이슈 봇의 계산 부분(입출력 없음). scripts/issue-bot.mjs가 수집·저장을 맡고, 화면(issues-ui.js)도 같은 정의를 쓴다.
// 원칙: 기사 본문은 저장하지 않는다(제목·요약·링크만). 원인을 지어내지 않는다. 매수·매도 지시 문장을 만들지 않는다.
export const ISSUE_VERSION = 'I1-2026-11-06';

export const TOPICS = [
  { id: 'war', label: '전쟁·지정학', re: /전쟁|분쟁|교전|공습|폭격|침공|미사일|휴전|중동|우크라|러시아|이스라엘|이란|하마스|헤즈볼라|북한|대만 해협|지정학/, critical: /개전|선전포고|침공|공습|미사일 (발사|공격)|핵실험|전면전|계엄/, queries: ['전쟁 증시', '공습 유가', '휴전 협상'], markets: ['CL=F', 'GC=F', '^VIX', 'KRW=X'] },
  { id: 'politics', label: '선거·정치', re: /선거|대선|총선|중간선거|탄핵|계엄|의회|국회|여야|셧다운|백악관|트럼프|대통령|정권/, critical: /계엄|탄핵 ?(가결|인용|소추)|쿠데타|셧다운 (돌입|시작)|대선 결과|당선 확정/, queries: ['선거 증시', '탄핵 증시', '정부 셧다운'], markets: ['^KS11', '^GSPC', 'KRW=X'] },
  { id: 'rates', label: '금리·통화', re: /금리|연준|Fed|FOMC|파월|한은|기준금리|국채|통화정책|양적/i, critical: /긴급 ?(금리|회의)|깜짝 ?(인상|인하)|빅스텝|자이언트 ?스텝/, queries: ['FOMC 금리', '한은 기준금리', '국채 금리 급등'], markets: ['^TNX', '^GSPC', '^KS11'] },
  { id: 'trade', label: '관세·무역', re: /관세|무역|수출 ?규제|수출 ?통제|보호무역|제재/, critical: /관세 ?폭탄|전면 ?관세|수출 ?금지|보복 ?관세/, queries: ['관세 발표 증시', '수출 통제'], markets: ['^KS11', '^GSPC', 'KRW=X'] },
  { id: 'fx', label: '환율·달러', re: /환율|달러|원화|엔화|위안화|외환/, critical: /외환 ?위기|환율 ?(폭등|폭락)|외환당국 ?개입/, queries: ['원달러 환율 급등'], markets: ['KRW=X'] },
  { id: 'energy', label: '유가·원자재', re: /유가|원유|WTI|브렌트|OPEC|금값|원자재|천연가스/, critical: /유가 ?(폭등|폭락)|호르무즈|감산 ?합의|원유 ?공급 ?차질/, queries: ['국제유가 급등'], markets: ['CL=F', 'GC=F'] },
  { id: 'market', label: '증시 급변', re: /폭락|급락|급등|폭등|서킷브레이커|사이드카|패닉|변동성/, critical: /서킷브레이커|사이드카|블랙 ?먼데이|대폭락/, queries: ['코스피 급락', '뉴욕증시 급락', '서킷브레이커'], markets: ['^KS11', '^GSPC', '^VIX'] },
  { id: 'credit', label: '신용·금융위기', re: /디폴트|파산|부도|뱅크런|유동성 ?위기|부실|구조조정/, critical: /디폴트|뱅크런|파산 ?신청|부도 ?처리/, queries: ['디폴트 우려', '뱅크런'], markets: ['^VIX', '^GSPC', '^KS11'] },
  { id: 'disaster', label: '재난·사고', re: /지진|태풍|홍수|화재|폭발|정전|팬데믹|감염병|테러/, critical: /대지진|팬데믹|테러/, queries: ['지진 공장 가동 중단'], markets: ['^KS11', '^GSPC'] },
  { id: 'policy', label: '규제·정책', re: /규제|법안|금융위|공정위|세제|공매도|밸류업/, critical: /공매도 ?금지|거래 ?정지|긴급 ?조치/, queries: ['금융당국 증시 대책'], markets: ['^KS11'] }
];
export const CONTEXT_QUERIES = ['코스피 마감', '뉴욕증시 마감', '코스피 장중', '뉴욕증시 장중'];

export const MARKETS = [
  ['^KS11', '코스피', '%'], ['^KQ11', '코스닥', '%'], ['^GSPC', 'S&P 500', '%'], ['^IXIC', '나스닥', '%'],
  ['KRW=X', '원/달러', '%'], ['CL=F', 'WTI 유가', '%'], ['GC=F', '금', '%'], ['^VIX', 'VIX 변동성', '%'], ['^TNX', '미 10년 금리', 'bp']
];
export const LEVELS = { urgent: '긴급', caution: '주의', watch: '관찰' };

const KST = 9 * 3600000;
export const kstHour = ms => new Date(ms + KST).getUTCHours();
export const kstDate = ms => new Date(ms + KST).toISOString().slice(0, 10);
export function slotOf(ms) { const h = kstHour(ms); return h >= 6 && h < 12 ? 'pre' : h >= 12 && h < 20 ? 'close' : 'us'; }
export const SLOT_TITLE = { pre: '장 전 브리핑', close: '국내 장 마감 브리핑', us: '미국 장 브리핑' };

// ── 시장 움직임 ───────────────────────────────────────────────
// candles: 일봉(오름차순). 마지막 봉은 장중이면 지연 시세다. z = 오늘 변화 / 최근 60일 하루 변화의 표준편차.
export function marketMove(symbol, label, unit, candles) {
  const c = (candles || []).filter(x => Number.isFinite(x.close) && x.close > 0);
  if (c.length < 22) return { symbol, label, unit, available: false };
  const last = c.at(-1), prev = c.at(-2);
  const change = unit === 'bp' ? (last.close - prev.close) * 100 : (last.close / prev.close - 1) * 100;
  const hist = [];
  for (let i = Math.max(1, c.length - 61); i < c.length - 1; i++) hist.push(unit === 'bp' ? (c[i].close - c[i - 1].close) * 100 : (c[i].close / c[i - 1].close - 1) * 100);
  const m = hist.reduce((a, b) => a + b, 0) / hist.length, sd = Math.sqrt(hist.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(1, hist.length - 1));
  return { symbol, label, unit, available: true, date: last.date, last: last.close, change: Math.round(change * 100) / 100, z: sd > 0 ? Math.round(change / sd * 10) / 10 : 0, sd, source: 'Yahoo' };
}
// 네이버 현재가로 교차 확인: 날짜가 더 새롭거나 값이 0.3% 넘게 다르면 네이버 값으로 바꾸고 표시한다(% 단위 지표만).
export function applyQuote(move, q, quoteDate) {
  if (!move?.available || !q || !Number.isFinite(q.price) || !Number.isFinite(q.pct) || move.unit !== '%') return move;
  const newer = quoteDate > move.date, differs = Math.abs(q.price / move.last - 1) > 0.003;
  if (!newer && !differs) return { ...move, checked: true };
  return { ...move, date: quoteDate, last: q.price, change: Math.round(q.pct * 100) / 100, z: move.sd > 0 ? Math.round(q.pct / move.sd * 10) / 10 : 0, source: '네이버 현재가', live: q.status === 'OPEN', checked: true };
}

// ── 기사 정리 ────────────────────────────────────────────────
// 제목을 낱말로 나누고(조사 떼기), 자주 나오는 낱말일수록 가중치를 낮춘(TF-IDF) 코사인 유사도로 묶는다.
const STOPWORDS = new Set('속보 단독 종합 상보 특징주 포토 영상 오늘 이번 관련 기자 뉴스 위해 대한 통해 이후 있는 없는 한다 했다 밝혀 전망 우려 가능성 미국 한국 국내 정부 시장 증시 주가 투자자 투자 지수 오늘의 이슈'.split(' '));
const PARTICLE = /(으로|에서|까지|부터|에게|처럼|보다|이라|라는|하는|했다|한다|되는|된다|에는|에도|으며|이며|은|는|이|가|을|를|에|의|와|과|도|로|만|서)$/;
export function tokensOf(title) {
  return [...new Set(String(title || '').replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|<[^>]*>/g, ' ').split(/[^\p{L}\p{N}]+/u)
    .map(w => (w.length >= 3 ? w.replace(PARTICLE, '') : w).toLowerCase()).filter(w => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w)))];
}
// 실행 사이에 같은 사건인지 볼 때 쓰는 낱말 겹침(Dice).
export function similarity(a, b) { const A = tokensOf(a), B = new Set(tokensOf(b)); if (!A.length || !B.size) return 0; const k = A.filter(w => B.has(w)).length; return 2 * k / (A.length + B.size); }
export function topicsOf(text) { return TOPICS.filter(t => t.re.test(text)).map(t => t.id); }
export function criticalOf(text) { return TOPICS.filter(t => t.critical.test(text)).map(t => t.id); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
const safeLink = u => { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } };
function cosine(A, B) { let dot = 0, na = 0, nb = 0; for (const [w, v] of A) { na += v * v; const b = B.get(w); if (b) dot += v * b; } for (const v of B.values()) nb += v * v; return na && nb ? dot / Math.sqrt(na * nb) : 0; }

/** 제목이 비슷한 기사를 한 사건으로 묶는다. items: [{title, description, link, sourceHost, publishedAt}] */
export function clusterArticles(items, { threshold = 0.25, now = Date.now(), hours = 24 } = {}) {
  const seen = new Set(), fresh = [];
  for (const a of items || []) {
    const link = safeLink(a?.link), at = Date.parse(a?.publishedAt);
    if (!a?.title || !link || seen.has(link) || !Number.isFinite(at) || now - at > hours * 3600000 || at - now > 600000) continue;
    seen.add(link); fresh.push({ title: a.title, description: a.description || '', link, host: a.sourceHost || new URL(link).hostname, at, tk: tokensOf(a.title) });
  }
  const df = new Map(); for (const a of fresh) for (const w of a.tk) df.set(w, (df.get(w) || 0) + 1);
  const idf = w => Math.log((fresh.length + 1) / ((df.get(w) || 0) + 1)) + 1;
  fresh.sort((a, b) => a.at - b.at);
  const clusters = [];
  for (const a of fresh) {
    const v = new Map(a.tk.map(w => [w, idf(w)]));
    let best = null, bs = 0;
    for (const c of clusters) { const s = cosine(v, c.v); if (s > bs) { bs = s; best = c; } }
    if (best && bs >= threshold) { best.articles.push(a); for (const [w, x] of v) best.v.set(w, (best.v.get(w) || 0) + x); }
    else clusters.push({ rep: a.title, v, articles: [a] });
  }
  return clusters.map(c => {
    // 주제는 제목으로만 판단한다(요약문은 여러 주제를 두루 언급해 과하게 붙는다). 제목에 없으면 첫 기사 요약을 본다.
    const titles = c.articles.map(a => a.title).join(' '), hosts = new Set(c.articles.map(a => a.host));
    const topics = topicsOf(titles).length ? topicsOf(titles) : topicsOf(c.articles[0].description);
    return {
      id: hash(tokensOf(c.rep).join(' ') + kstDate(c.articles[0].at)), title: c.rep, firstSeen: new Date(c.articles[0].at).toISOString(), lastSeen: new Date(c.articles.at(-1).at).toISOString(),
      count: c.articles.length, sources: hosts.size, topics, critical: criticalOf(c.articles.map(a => a.title).join(' ')),
      links: c.articles.slice(-4).reverse().map(a => ({ title: a.title, link: a.link, host: a.host, at: new Date(a.at).toISOString() }))
    };
  });
}

// ── 기사 급증 ────────────────────────────────────────────────
// 검색어마다 날짜순 최근 20건 중 3시간 안에 나온 수로 시간당 기사 수를 잰다. 20건이 모두 3시간 안이면 포화(실제는 더 많음).
export function topicRate(itemsByQuery, now = Date.now(), hours = 3) {
  const lists = Array.isArray(itemsByQuery?.[0]) ? itemsByQuery : [itemsByQuery || []];
  const per = lists.map(items => { const times = items.map(a => Date.parse(a.publishedAt)).filter(Number.isFinite); const recent = times.filter(t => now - t <= hours * 3600000 && t - now < 600000).length; return { rate: recent / hours, saturated: times.length >= 20 && recent >= times.length }; });
  const rate = per.reduce((a, p) => a + p.rate, 0) / Math.max(1, per.length);
  return { rate: Math.round(rate * 10) / 10, saturated: per.filter(p => p.saturated).length, queries: per.length };
}
// history: 이전 실행의 시간당 기사 수. 기록이 적을 때(처음 며칠)는 포화된 검색어 비율로 판단한다.
export function spikeZ(r, history = []) {
  const rate = typeof r === 'number' ? r : r.rate, h = history.filter(Number.isFinite);
  if (h.length < 8) { const sat = typeof r === 'number' ? 0 : r.saturated / Math.max(1, r.queries); return sat >= 0.5 ? 3 : rate >= 3 ? 1.5 : 0; }
  const m = h.reduce((a, b) => a + b, 0) / h.length, sd = Math.sqrt(h.reduce((a, v) => a + (v - m) ** 2, 0) / (h.length - 1));
  return Math.round((rate - m) / Math.max(sd, 0.7) * 10) / 10;
}

// ── 심각도 ───────────────────────────────────────────────────
// 기사 신호(핵심 단어+출처 2곳 이상, 또는 기사 급증)와 시장 신호(관련 지표 |z| ≥ 2)가 함께면 긴급.
export function assess(cluster, { spikes = {}, moves = [], now = Date.now() } = {}) {
  const topicDefs = TOPICS.filter(t => cluster.topics.includes(t.id) || cluster.critical.includes(t.id));
  const related = new Set(topicDefs.flatMap(t => t.markets));
  const react = moves.filter(m => m.available && related.has(m.symbol)).sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0] || null;
  const spike = Math.max(0, ...cluster.topics.map(t => spikes[t] ?? 0));
  const newsSignal = (cluster.critical.length > 0 && cluster.sources >= 2) || (spike >= 3 && cluster.count >= 3);
  const marketSignal = !!react && Math.abs(react.z) >= 2;
  const age = (now - Date.parse(cluster.firstSeen)) / 3600000;
  const level = newsSignal && marketSignal && cluster.count >= 3 && age <= 12 ? 'urgent' : newsSignal || (marketSignal && Math.abs(react.z) >= 2.5 && cluster.count >= 3 && age <= 6) ? 'caution' : 'watch';
  const score = Math.round(Math.min(100, (cluster.critical.length ? 25 : 0) + Math.min(25, spike * 8) + Math.min(30, Math.max(0, Math.abs(react?.z || 0) - 1) * 15) + Math.min(10, cluster.sources * 2) + Math.min(10, cluster.count)));
  const why = [];
  if (cluster.critical.length) why.push('핵심 단어');
  if (spike >= 3) why.push(`기사 급증(평소 대비 ${spike}σ)`);
  if (react) why.push(`${react.label} ${react.change > 0 ? '+' : ''}${react.change}${react.unit === 'bp' ? 'bp' : '%'}${Math.abs(react.z) >= 2 ? `(평소의 ${Math.abs(react.z)}배)` : ''}`);
  return { level, label: LEVELS[level], score, spike, news: newsSignal, reaction: react ? { symbol: react.symbol, label: react.label, change: react.change, unit: react.unit, z: react.z } : null, why };
}

// 한 시장 움직임을 여러 사건이 나눠 갖지 않게 한다: 같은 지표 반응을 근거로 한 사건 중 점수가 가장 높은 것만 긴급,
// 기사 신호 없이 시장 반응만으로 주의가 된 사건은 지표마다 2개까지만 둔다.
export function dedupeUrgent(issues) {
  const urgent = new Set(), marketOnly = new Map();
  const down = (i, level, note) => { i.assess = { ...i.assess, level, label: LEVELS[level], why: [...i.assess.why, note] }; };
  for (const i of [...issues].sort((a, b) => b.assess.score - a.assess.score || b.count - a.count)) {
    const key = i.assess.reaction?.symbol || 'none';
    if (i.assess.level === 'urgent') { if (urgent.has(key)) down(i, 'caution', '같은 시장 움직임의 다른 사건이 먼저'); else urgent.add(key); }
    else if (i.assess.level === 'caution' && !i.assess.news) { const n = marketOnly.get(key) || 0; if (n >= 2) down(i, 'watch', '시장 반응만 있는 사건이 이미 2건'); marketOnly.set(key, n + 1); }
  }
  return issues;
}
// 사건 기록에 남길 만한가: 여러 기사로 확인됐거나 등급이 붙었거나 핵심 단어가 있는 사건.
export const worthRecording = i => i.count >= 2 || i.assess.level !== 'watch' || i.critical.length > 0;

// ── 알림 조절 ────────────────────────────────────────────────
// 같은 사건은 1시간에 한 번까지. 0~7시(한국)에는 긴급만. 등급이 오르면 다시 알린다.
export function shouldAlert(prev, cur, now = Date.now()) {
  if (cur.level === 'watch') return false;
  const h = kstHour(now);
  if ((h < 7) && cur.level !== 'urgent') return false;
  if (!prev?.alertedAt) return true;
  const rank = { watch: 0, caution: 1, urgent: 2 };
  if (rank[cur.level] > rank[prev.alertedLevel || 'watch']) return true;
  return now - Date.parse(prev.alertedAt) >= 3600000;
}

// 이전 실행에서 본 사건과 같은지(48시간 안, 제목 유사도).
export function matchKnown(cluster, known = [], threshold = 0.32) {
  let best = null, bs = 0;
  for (const k of known) { const s = similarity(cluster.title, k.title); if (s > bs) { bs = s; best = k; } }
  return bs >= threshold ? best : null;
}

// ── 브리핑 ───────────────────────────────────────────────────
const sign = (v, u = '%') => `${v > 0 ? '+' : ''}${v}${u}`;
const topicLabel = id => TOPICS.find(t => t.id === id)?.label || id;
export function composeBriefing({ now = Date.now(), slot = slotOf(now), moves = [], issues = [] } = {}) {
  const pick = slot === 'pre' || slot === 'us' ? ['^GSPC', '^IXIC', 'KRW=X', 'CL=F', '^VIX', '^TNX'] : ['^KS11', '^KQ11', 'KRW=X', '^GSPC', 'CL=F', '^VIX'];
  const shown = pick.map(s => moves.find(m => m.symbol === s)).filter(m => m?.available);
  // 시세 제공처가 아직 최신 거래일을 올리지 않은 지표는 날짜를 붙여 오래된 값임을 밝힌다.
  const newest = moves.filter(m => m.available).map(m => m.date).sort().at(-1);
  const when = m => m.date < newest ? `(${m.date.slice(5).replace('-', '.')} 기준)` : '';
  const lead = shown.slice(0, 3).map(m => `${m.label} ${sign(m.change, m.unit === 'bp' ? 'bp' : '%')}${when(m)}`).join(', ');
  const big = moves.filter(m => m.available && Math.abs(m.z) >= 2).map(m => `${m.label} ${sign(m.change, m.unit === 'bp' ? 'bp' : '%')} — 평소 하루 움직임의 ${Math.abs(m.z)}배`);
  const top = [...issues].sort((a, b) => b.assess.score - a.assess.score || b.count - a.count).slice(0, 6);
  const themes = [...new Set(top.flatMap(i => i.topics))].slice(0, 3).map(topicLabel);
  const alerts = top.filter(i => i.assess.level !== 'watch');
  const headline = `${lead || '시장 자료 없음'}${themes.length ? ` · 주요 이슈: ${themes.join(', ')}` : ''}`;
  const lines = [
    `[${SLOT_TITLE[slot]}] ${kstDate(now)} ${String(kstHour(now)).padStart(2, '0')}시`, headline,
    ...big.map(x => `· ${x}`),
    ...top.slice(0, 5).map((i, k) => `${k + 1}. ${i.assess.level === 'watch' ? '' : `[${i.assess.label}] `}${i.title} (${i.sources}곳 보도)${i.links[0] ? `\n   ${i.links[0].link}` : ''}`),
    '정해진 규칙으로 기사 제목과 시장 숫자만 정리했습니다. 원인을 단정하지 않으며 매수·매도 권유가 아닙니다.'
  ];
  return { id: `${kstDate(now)}-${slot}`, version: ISSUE_VERSION, slot, title: SLOT_TITLE[slot], at: new Date(now).toISOString(), headline, markets: shown, unusual: big, issues: top, alerts, text: lines.join('\n') };
}

// 사건 기록 한 줄(월별 JSONL). 시장 숫자는 기록 시점 값이다. 사건 연구(이후 1·5·20일 반응)는 이 기록으로 나중에 계산한다.
export function eventRecord(issue, moves, now = Date.now()) {
  return { id: issue.id, recordedAt: new Date(now).toISOString(), firstSeen: issue.firstSeen, title: issue.title, topics: issue.topics, critical: issue.critical, level: issue.assess.level, score: issue.assess.score, count: issue.count, sources: issue.sources,
    links: issue.links.slice(0, 3).map(l => ({ title: l.title, link: l.link, host: l.host })),
    market: Object.fromEntries(moves.filter(m => m.available).map(m => [m.symbol, { change: m.change, z: m.z, date: m.date }])) };
}

// 화면용: 내 보유 종목 이름·업종이 사건 제목에 나오는지(브라우저에서만 계산, 서버로 보내지 않음).
export function relatedToHoldings(issues, holdings = []) {
  const out = [];
  for (const h of holdings) {
    const names = [h.name, h.sector].filter(x => x && String(x).length >= 2);
    for (const i of issues) {
      const text = [i.title, ...i.links.map(l => l.title)].join(' ');
      const hit = names.find(n => text.includes(n));
      if (hit) out.push({ holding: h.name, via: hit === h.name ? '종목명' : '업종', issue: i });
    }
  }
  return out;
}
