// 오늘 장 한눈에(2026-11-13 · 결정 33): 지수 · 투자자별 순매수 · 업종 등락 · 종목 순위. 서버에서만 부른다.
// 출처는 시세에 쓰는 것과 같은 공개 시세 페이지(네이버 증권 모바일). 값을 바꾸지 않고 숫자·이름만 추린다. 한 부분이 실패해도 나머지는 보낸다.
const UA = { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0', Accept: 'application/json' };
const M = 'https://m.stock.naver.com', A = 'https://api.stock.naver.com';
export const MARKETS = ['KOSPI', 'KOSDAQ'];
export class MarketOverviewError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/[,+%\s]/g, '')); return Number.isFinite(n) ? n : null; };
const str = (v, n = 60) => String(v ?? '').slice(0, n);

export const pickIndex = (key, name, j) => j ? { key, name, price: num(j.closePrice), change: num(j.compareToPreviousClosePrice), pct: num(j.fluctuationsRatio), open: j.marketStatus === 'OPEN', at: str(j.localTradedAt, 40) || null } : null;
export const pickFx = j => { const r = j?.result; return r ? { key: 'USDKRW', name: '달러/원', price: num(r.closePrice), change: num(r.fluctuations), pct: num(r.fluctuationsRatio), open: r.marketStatus === 'OPEN', at: str(r.localTradedAt, 40) || null } : null; };
/** 투자자별 순매수(억원). */
export const pickFlow = (market, j) => j ? { market, date: /^\d{8}$/.test(j.bizdate || '') ? `${j.bizdate.slice(0, 4)}-${j.bizdate.slice(4, 6)}-${j.bizdate.slice(6)}` : null, personal: num(j.personalValue), foreign: num(j.foreignValue), institution: num(j.institutionalValue) } : null;
export const pickSectors = j => (j?.groups || []).map(g => ({ no: Number(g.no), name: str(g.name, 40), pct: num(g.changeRate), total: Number(g.totalCount) || 0, up: Number(g.riseCount) || 0, down: Number(g.fallCount) || 0 })).filter(g => Number.isInteger(g.no) && g.name && g.pct !== null);
/** 종목 한 줄. tradedValue 는 백만 원 단위로 온다 → 억원. */
export const pickStock = s => ({ code: str(s.itemCode, 12), name: str(s.stockName, 40), price: num(s.closePrice), pct: num(s.fluctuationsRatio), valueEok: num(s.accumulatedTradingValue) === null ? null : Math.round(num(s.accumulatedTradingValue) / 100), capEok: num(s.marketValue), type: s.stockEndType === 'stock' ? 'stock' : 'etf', market: s.sosok === '1' ? 'KOSDAQ' : 'KOSPI' });
export const pickStocks = (j, { onlyStocks = false, limit = 20 } = {}) => (j?.stocks || []).map(pickStock).filter(s => /^[0-9A-Z]{6}$/.test(s.code) && s.name && s.price !== null && s.pct !== null && (!onlyStocks || s.type === 'stock')).slice(0, limit);

const cache = new Map();
async function get(url, fetchImpl) { const r = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`시세 페이지 응답 ${r.status}`); return r.json(); }
const soft = async (fn, errors, label) => { try { return await fn(); } catch (e) { errors.push(label); return null; } };

/** @returns { asOf, market, indices[], flows[], sectors[], lists:{cap,up,down,volume}, errors[] } */
export async function fetchMarketOverview({ market = 'KOSPI', fetchImpl = fetch, now = () => Date.now(), ttlMs = 45000 } = {}) {
  if (!MARKETS.includes(market)) throw new MarketOverviewError('시장은 KOSPI 또는 KOSDAQ 입니다.', 400);
  const hit = cache.get(market); if (hit && now() - hit.at < ttlMs) return hit.v;
  const errors = [], g = u => get(u, fetchImpl);
  const [kospi, kosdaq, spx, ixic, fx, f1, f2, sectors, cap, up, down, volume] = await Promise.all([
    soft(() => g(`${M}/api/index/KOSPI/basic`), errors, '코스피'), soft(() => g(`${M}/api/index/KOSDAQ/basic`), errors, '코스닥'),
    soft(() => g(`${A}/index/.INX/basic`), errors, 'S&P500'), soft(() => g(`${A}/index/.IXIC/basic`), errors, '나스닥'),
    soft(() => g(`${M}/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW`), errors, '환율'),
    soft(() => g(`${M}/api/index/KOSPI/trend`), errors, '코스피 투자자별'), soft(() => g(`${M}/api/index/KOSDAQ/trend`), errors, '코스닥 투자자별'),
    soft(() => g(`${M}/api/stocks/industry?page=1&pageSize=100`), errors, '업종'),
    soft(() => g(`${M}/api/stocks/marketValue/${market}?page=1&pageSize=20`), errors, '시가총액 상위'), soft(() => g(`${M}/api/stocks/up/${market}?page=1&pageSize=30`), errors, '상승 상위'),
    soft(() => g(`${M}/api/stocks/down/${market}?page=1&pageSize=30`), errors, '하락 상위'), soft(() => g(`${M}/api/stocks/quantTop/${market}?page=1&pageSize=40`), errors, '거래량 상위'),
  ]);
  const indices = [pickIndex('KOSPI', '코스피', kospi), pickIndex('KOSDAQ', '코스닥', kosdaq), pickIndex('SPX', 'S&P500', spx), pickIndex('IXIC', '나스닥', ixic), pickFx(fx)].filter(x => x && x.price !== null);
  if (!indices.length) throw new MarketOverviewError('시장 자료를 받지 못했습니다. 잠시 뒤 다시 시도하십시오.');
  const v = { asOf: new Date(now()).toISOString(), market, source: '네이버 증권', indices, flows: [pickFlow('KOSPI', f1), pickFlow('KOSDAQ', f2)].filter(x => x && x.foreign !== null),
    sectors: pickSectors(sectors), lists: { cap: pickStocks(cap, { limit: 20 }), up: pickStocks(up, { onlyStocks: true, limit: 12 }), down: pickStocks(down, { onlyStocks: true, limit: 12 }), volume: pickStocks(volume, { onlyStocks: true, limit: 12 }) }, errors };
  cache.set(market, { at: now(), v }); return v;
}

/** 업종 하나의 종목(시가총액 순). */
export async function fetchIndustryStocks(no, { fetchImpl = fetch, now = () => Date.now(), ttlMs = 45000 } = {}) {
  const id = Number(no); if (!Number.isInteger(id) || id < 1 || id > 9999) throw new MarketOverviewError('업종 번호를 확인하십시오.', 400);
  const key = 'ind:' + id, hit = cache.get(key); if (hit && now() - hit.at < ttlMs) return hit.v;
  let j; try { j = await get(`${M}/api/stocks/industry/${id}?page=1&pageSize=40`, fetchImpl); } catch { throw new MarketOverviewError('업종 종목을 받지 못했습니다.'); }
  const v = { asOf: new Date(now()).toISOString(), no: id, name: str(j?.groupInfo?.name, 40) || null, stocks: pickStocks(j, { limit: 40 }).sort((a, b) => (b.capEok || 0) - (a.capEok || 0)) };
  cache.set(key, { at: now(), v }); return v;
}
export const _clearMarketOverviewCache = () => cache.clear();
