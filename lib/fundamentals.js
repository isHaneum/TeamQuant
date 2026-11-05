// 투자 지표(PER·PBR·ROE·배당·성장·목표가)를 네이버 증권 공개 페이지용 API에서 받아 정리한다.
// 공식 OpenAPI가 아니므로 형식이 바뀌면 실패할 수 있다. 실패는 숨기지 않고 오류로 돌려준다.
// 보내는 정보는 종목 코드뿐이다.

export class FundamentalsError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }

const UA = { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0', Accept: 'application/json' };
const SOURCE = '네이버 증권 (공개 화면용 API · 비공식)';

// "9.04배", "22,292원", "0.83%", "+55.32%", "N/A", "-" → 숫자 또는 null
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,\s]/g, '').replace(/(배|원|%|USD)$/u, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export function normalizeSymbol(input) {
  const s = String(input || '').trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
  if (/^\d[\dA-Z]{5}$/.test(s)) return { code: s, market: 'KR' };
  if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) return { code: s.replace(/-/g, '.'), market: 'US' };
  throw new FundamentalsError('종목 코드 형식이 올바르지 않습니다.', 400);
}

// 연간 재무표(rowList)에서 실적 확정 연도와 그 전 해 값을 꺼낸다.
export function annualSummary(financeInfo) {
  if (!financeInfo?.rowList || !financeInfo?.trTitleList) return null;
  const periods = financeInfo.trTitleList.filter(t => t.isConsensus !== 'Y').map(t => t.key);
  const est = financeInfo.trTitleList.find(t => t.isConsensus === 'Y')?.key || null;
  if (!periods.length) return null;
  const row = title => financeInfo.rowList.find(r => r.title === title)?.columns || {};
  const pick = (title, key) => key ? num(row(title)[key]?.value) : null;
  const last = periods.at(-1), prev = periods.at(-2);
  const growth = (title) => { const a = pick(title, last), b = pick(title, prev); return a !== null && b !== null && b > 0 ? Math.round((a / b - 1) * 10000) / 100 : null; };
  return {
    year: String(financeInfo.trTitleList.find(t => t.key === last)?.title || last).replace(/\.$/, ''),
    revenue: pick('매출액', last), operatingIncome: pick('영업이익', last) ?? pick('EBIT', last), netIncome: pick('당기순이익', last),
    roe: pick('ROE', last), roa: pick('ROA', last), debtRatio: pick('부채비율', last),
    // 해외 종목은 영업이익률 행이 없어 EBIT/매출로 계산한다.
    operatingMargin: pick('영업이익률', last) ?? (pick('EBIT', last) !== null && pick('매출액', last) > 0 ? pick('EBIT', last) / pick('매출액', last) * 100 : null),
    revenueGrowth: growth('매출액'), operatingIncomeGrowth: growth('영업이익') ?? growth('EBIT'),
    estimateRoe: pick('ROE', est), estimateRevenueGrowth: est && pick('매출액', est) !== null && pick('매출액', last) > 0 ? (pick('매출액', est) / pick('매출액', last) - 1) * 100 : null,
    history: periods.map(k => ({ period: k, revenue: pick('매출액', k), operatingIncome: pick('영업이익', k), roe: pick('ROE', k), dividendPerShare: pick('주당배당금', k) })),
    unit: financeInfo.unit || null
  };
}

const r1 = v => v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100;

export function fromKorea(integration, finance) {
  const info = Object.fromEntries((integration.totalInfos || []).map(x => [x.code, x.value]));
  const etf = integration.stockEndType === 'etf', ek = integration.etfKeyIndicator || {};
  const annual = annualSummary(finance?.financeInfo);
  const price = num(info.lastClosePrice);
  return {
    name: integration.stockName, market: 'KR', isEtf: etf, sector: etf ? (info.etfBaseIdx ? `ETF · ${info.etfBaseIdx}` : 'ETF') : null,
    price, per: num(info.per), forwardPer: num(info.cnsPer), pbr: num(info.pbr), eps: num(info.eps),
    dividendYield: etf ? num(ek.dividendYieldTtm) : num(info.dividendYieldRatio), dividendPerShare: num(info.dividend),
    fee: etf ? num(ek.totalFee) : null, marketCap: info.marketValue || ek.marketValue || null,
    high52: num(info.highPriceOf52Weeks), low52: num(info.lowPriceOf52Weeks),
    targetPrice: num(integration.consensusInfo?.priceTargetMean), analystScore: num(integration.consensusInfo?.recommMean),
    annual, business: [finance?.corporationSummary?.comment2, finance?.corporationSummary?.comment1].filter(Boolean).join(' ') || null,
    peers: (integration.industryCompareInfo || []).filter(x => x.itemCode !== integration.itemCode).slice(0, 4).map(x => x.stockName),
    basis: { per: (integration.totalInfos || []).find(x => x.code === 'per')?.valueDesc || null, dividend: (integration.totalInfos || []).find(x => x.code === 'dividendYieldRatio')?.valueDesc || null }
  };
}

export function fromUs(basic, integration, finance) {
  const info = Object.fromEntries((basic.stockItemTotalInfos || []).map(x => [x.code, x.value]));
  return {
    name: basic.stockName, market: 'US', isEtf: !!basic.isEtf, sector: info.industryGroupKor || basic.industryCodeType?.industryGroupKor || null,
    price: num(basic.closePrice), per: num(info.per), forwardPer: null, pbr: num(info.pbr), eps: num(info.eps),
    dividendYield: num(info.dividendYieldRatio), dividendPerShare: num(info.dividend), exDividendAt: info.exDividendAt && info.exDividendAt !== 'N/A' ? info.exDividendAt : null,
    fee: null, marketCap: info.marketValue || null, high52: num(info.highPriceOf52Weeks), low52: num(info.lowPriceOf52Weeks),
    targetPrice: num(integration?.consensusInfo?.priceTargetMean), analystScore: num(integration?.consensusInfo?.recommMean),
    annual: annualSummary(finance), business: integration?.summaries?.summary ? String(integration.summaries.summary).slice(0, 300) : null,
    peers: (integration?.industryCompareInfo?.globalStocks || []).filter(x => x.symbolCode !== basic.symbolCode).slice(0, 4).map(x => x.stockName), basis: {}
  };
}

async function get(url, fetchImpl) {
  let r; try { r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(8000) }); } catch { throw new FundamentalsError('투자 지표 서버에 연결하지 못했습니다.'); }
  if (!r.ok) { const e = new FundamentalsError(`투자 지표 응답 오류 (${r.status})`); e.upstream = r.status; throw e; }
  try { return await r.json(); } catch { throw new FundamentalsError('투자 지표 응답 형식을 확인하지 못했습니다.'); }
}

export async function fetchFundamentals(input, { fetchImpl = fetch } = {}) {
  const { code, market } = normalizeSymbol(input);
  let data;
  if (market === 'KR') {
    const [integration, finance] = await Promise.all([get(`https://m.stock.naver.com/api/stock/${code}/integration`, fetchImpl), get(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, fetchImpl).catch(() => null)]);
    data = fromKorea(integration, finance);
    if (!data.isEtf && /^\d+$/.test(String(integration.industryCode || ''))) {
      const g = await get(`https://m.stock.naver.com/api/stocks/industry/${integration.industryCode}?page=1&pageSize=1`, fetchImpl).catch(() => null);
      if (g?.groupInfo?.name) { data.sector = g.groupInfo.name; data.sectorToday = num(g.groupInfo.changeRate); }
    }
  } else {
    // 나스닥은 ".O", 뉴욕거래소는 접미사 없음.
    let basic = null, used = null;
    for (const c of [code + '.O', code]) { try { basic = await get(`https://api.stock.naver.com/stock/${c}/basic`, fetchImpl); used = c; break; } catch (e) { if (!e.upstream) throw e; } }
    if (!basic) throw new FundamentalsError('해외 종목의 투자 지표를 찾지 못했습니다.', 404);
    const [integration, finance] = await Promise.all([get(`https://api.stock.naver.com/stock/${used}/integration`, fetchImpl).catch(() => null), get(`https://api.stock.naver.com/stock/${used}/finance/annual`, fetchImpl).catch(() => null)]);
    data = fromUs(basic, integration, finance);
  }
  for (const k of ['per', 'forwardPer', 'pbr', 'dividendYield']) data[k] = r1(data[k]);
  if (data.annual) for (const k of ['revenueGrowth', 'operatingIncomeGrowth', 'estimateRevenueGrowth']) data.annual[k] = r1(data.annual[k]);
  return { symbol: code, ...data, source: SOURCE, fetchedAt: new Date().toISOString() };
}
