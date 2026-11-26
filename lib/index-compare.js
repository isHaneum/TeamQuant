// 홈 맨 위 '지수 대비 수익률'·'내 종목 소식'의 계산 부분(순수 함수 · 입출력 없음). 화면은 home-top-ui.js 가 그린다.
// home-top-ui.js 는 브라우저 전용 모듈을 불러와 node 시험에서 읽을 수 없어서 계산만 이 파일로 옮겼다(test/index-compare.test.js).
import { closeOn, koreaDay } from './asset-timeline.js';

const shiftDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** n개월 전 같은 날(그 달에 없는 날이면 그 달 마지막 날). */
export function monthsAgo(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number), last = new Date(Date.UTC(y, m - n, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 - n, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * 같은 날짜들에 지수를 맞춰 시작 = 100으로 비교한다.
 * points: [{date, own}] 날짜 오름차순(own 은 어떤 단위든 첫 값으로 100에 맞춘다). spx·kospi·fx: [{date, close}] 날짜 오름차순.
 * S&P500은 종가 × 달러 환율(원화 기준). usLag: 한국 날짜로 찍은 평가점(팀 모의계좌)이면 미국 종가는 그 날짜 전날까지의 마지막 종가를 쓴다(그 시각엔 그날 미국 장이 끝나지 않았다).
 * 지수 자료가 모자라면(시작값이 없거나 마지막 봉이 7일 넘게 오래됨) 그 선만 null.
 */
export function indexCompare({ points = [], spx = [], kospi = [], fx = [], usLag = false } = {}) {
  const pts = points.filter(p => p && typeof p.date === 'string' && Number.isFinite(p.own) && p.own > 0);
  if (pts.length < 2) return null;
  const first = pts[0].date, last = pts.at(-1).date;
  const spxAt = d => { const s = closeOn(spx, usLag ? shiftDays(d, -1) : d), f = closeOn(fx, d); return s && f ? s * f : null; };
  const ksAt = d => closeOn(kospi, d);
  const lineOf = at => { const base = at(first); if (!(base > 0)) return null; const vals = pts.map(p => { const v = at(p.date); return v > 0 ? v / base * 100 : null; }); return Number.isFinite(vals.at(-1)) ? vals : null; };
  const fresh = cs => cs.length > 0 && cs.at(-1).date >= shiftDays(last, -7);
  const sp = fresh(spx) && fresh(fx) ? lineOf(spxAt) : null, ks = fresh(kospi) ? lineOf(ksAt) : null;
  const own = pts.map(p => p.own / pts[0].own * 100);
  const ownRet = own.at(-1) - 100, spxRet = sp ? sp.at(-1) - 100 : null, ksRet = ks ? ks.at(-1) - 100 : null;
  return { from: first, to: last, own: ownRet, spx: spxRet, kospi: ksRet, vsSpx: spxRet === null ? null : ownRet - spxRet, vsKospi: ksRet === null ? null : ownRet - ksRet,
    line: pts.map((p, i) => ({ date: p.date, own: own[i], spx: sp ? sp[i] : null, kospi: ks ? ks[i] : null })) };
}

/**
 * 내 종목 소식 고르기: ① 3일 안 공시 ② 평소의 2배 넘는 움직임 ③ 이름이 든 오늘 기사 2건 이상 순서로, 한 종목에 한 줄, 최대 max개.
 * 등락·공시 제목·기사 수·원문 링크만 담는다(원인을 단정하는 말은 만들지 않는다).
 */
export function pickNews(positions = [], briefs = new Map(), todayYmd = koreaDay(Date.now()), max = 3) {
  const out = [];
  for (const p of positions) {
    const b = briefs.get(p.symbol); if (!b?.available) continue;
    const asOf = b.asOf || todayYmd;
    const disc = (b.disclosures || []).find(d => d?.date && daysBetween(d.date, asOf) >= 0 && daysBetween(d.date, asOf) <= 3) || null;
    const big = Number.isFinite(b.price?.moveRatio) && b.price.moveRatio >= 2;
    const todays = (b.allNews || []).filter(n => n?.publishedAt && koreaDay(n.publishedAt) === todayYmd);
    const news = todays.length >= 2 ? { count: todays.length, first: todays[0] } : null;
    const rank = disc ? 3 : big ? 2 : news ? 1 : 0; if (!rank) continue;
    out.push({ symbol: p.symbol, name: p.name || b.name, day: Number.isFinite(b.price?.dayReturn) ? b.price.dayReturn : null, typical: b.price?.typicalMove ?? null, big, disc, news, rank });
  }
  return out.sort((a, b) => b.rank - a.rank || Math.abs(b.day ?? 0) - Math.abs(a.day ?? 0)).slice(0, max);
}
