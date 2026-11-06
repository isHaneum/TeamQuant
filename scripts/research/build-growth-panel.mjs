// 기업 성장 예측 연구용 패널과 화면용 기업 이력을 만든다.
//  입력 .research/factor-data.json (build-factor-data.mjs)
//  출력 .research/growth-panel.csv  : 기업 × 월말, 그 시점에 공개돼 있던 재무·시세 특징 + 이후 실제 결과(목표)
//       data/company-history.json  : 화면(과거 기업 분석)용 분기 재무·월말 시세·지수. 모델 판단은 growth-model.py가 덧붙인다.
// 원칙: 특징은 'available'(공개일) ≤ 분석일인 분기만 쓴다. 목표는 실제 결과이므로 공개일을 보지 않지만, 그 결과가 공개된 날(…Known)을 함께 적어
//       학습할 때 '그 결과를 이미 알 수 있었던 행'만 쓰게 한다.
// 시가총액 두 가지: (가) 지금 주식 수 × 그때 주가(예전 방식, 미래 증자·소각이 섞임) (나) 그때 공개된 주식 수(.research/shares-pit.json, build-shares.mjs) × 그때 주가.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SECTOR } from './universe.mjs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const D = JSON.parse(readFileSync(join(root, '.research/factor-data.json'), 'utf8'));
const SH = existsSync(join(root, '.research/shares-pit.json')) ? JSON.parse(readFileSync(join(root, '.research/shares-pit.json'), 'utf8')) : null;
const bs = (dates, d) => { let lo = 0, hi = dates.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { f = m; lo = m + 1; } else hi = m - 1; } return f; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const plusDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

// ── 그때 주식 수 고르기·다듬기 ──
// 지금 단위 = 그때 주식 수 × 그 뒤 분할 배수(Yahoo가 시세를 조정한 배수와 같아야 시가총액이 맞는다).
// 튀는 값(앞뒤 값과 모두 1.6배 넘게 다르고 앞뒤끼리는 비슷함 = 단위 오류·분할 경계)은 버린다. 계속 유지되는 계단(증자·감자)은 그대로 둔다.
// 미국은 표지·희석 가중평균·순이익÷EPS 중 다듬은 뒤 계단이 가장 적은 것을 쓰고, 그래도 계단이 2번 이상이면(종류주 섞임 의심) 쓰지 않는다.
const splitFactor = (splits, d) => (splits || []).filter(([sd]) => sd > d).reduce((a, [, r]) => a * r, 1);
const far = (a, b) => a / b > 1.6 || a / b < 0.62;
function despike(ser) {
  let x = ser.slice();
  for (let pass = 0; pass < 6; pass++) {
    const drop = new Set();
    x.forEach((e, i) => {
      const p = x[i - 1], n = x[i + 1];
      if (p && n) { if (far(e.v, p.v) && far(e.v, n.v) && !far(p.v, n.v)) drop.add(i); }
      else if (n && x[i + 2]) { if (far(e.v, n.v) && !far(n.v, x[i + 2].v)) drop.add(i); }
      else if (p && x[i - 2]) { if (far(e.v, p.v) && !far(p.v, x[i - 2].v)) drop.add(i); }
    });
    if (!drop.size) break;
    x = x.filter((_, i) => !drop.has(i));
  }
  return x;
}
const steps = x => x.slice(1).filter((e, i) => e.asOf >= '2012-01-01' && far(e.v, x[i].v)).length;
const shareLog = [];
function pickShares(raw, sym) {
  if (!raw) { shareLog.push(`${sym} 없음`); return null; }
  const cands = raw.sources ? Object.entries(raw.sources) : [['dart', raw.series || []]];
  let best = null;
  for (const [src, arr] of cands) {
    if ((arr || []).length < 8) continue;
    const ser = despike(arr.map(e => ({ asOf: e.asOf, available: e.available < e.asOf ? e.asOf : e.available, v: e.shares * splitFactor(raw.splits, e.asOf) })).sort((a, b) => a.asOf.localeCompare(b.asOf)));
    const sc = { src, ser, steps: steps(ser), dropped: arr.length - ser.length };
    if (!best || sc.steps < best.steps) best = sc;
  }
  if (!best) { shareLog.push(`${sym} 자료 부족`); return null; }
  if (raw.sources && best.steps >= 2) { shareLog.push(`${sym} 제외(${best.src} 계단 ${best.steps})`); return null; }
  if (best.dropped || best.steps || best.src !== 'dart' && best.src !== 'cover') shareLog.push(`${sym} ${best.src}${best.dropped ? ` 튀는 값 ${best.dropped}개 제거` : ''}${best.steps ? ` 계단 ${best.steps}` : ''}`);
  return { series: best.ser, src: best.src };
}

const companies = [];
function add(market, sym, s) {
  if (!s.prices?.length) return;
  let q = [];
  if (market === 'KR') q = (s.quarters || []).map(x => ({ end: x.end, available: x.available, revenue: x.revenue, oi: x.operatingIncome, ni: x.netIncome, equity: x.equity, ocf: null }));
  else {
    const ends = new Set([...(s.revenue || []), ...(s.netIncome || [])].map(x => x.end)), at = (arr, e) => (arr || []).find(x => x.end === e);
    q = [...ends].map(e => { const R = at(s.revenue, e), O = at(s.operatingIncome, e), N = at(s.netIncome, e), C = at(s.ocf, e); const eq = (s.equity || []).filter(x => x.end <= e).at(-1); return { end: e, available: [R, O, N].filter(Boolean).map(x => x.available).sort().at(-1), revenue: R?.val ?? null, oi: O?.val ?? null, ni: N?.val ?? null, equity: eq?.val ?? null, ocf: C?.val ?? null }; });
  }
  q = q.filter(x => x.available && (x.revenue != null || x.ni != null)).sort((a, b) => a.end.localeCompare(b.end));
  // 같은 기말이 둘이면(정정 등) 먼저 공개된 것을 쓴다
  const seen = new Map(); for (const x of q) if (!seen.has(x.end) || x.available < seen.get(x.end).available) seen.set(x.end, x);
  const pit = pickShares(SH?.[market === 'KR' ? 'kr' : 'us']?.[sym], sym);
  companies.push({ market, sym, sector: SECTOR[sym] || '기타', pit, name: s.name, currency: market === 'KR' ? 'KRW' : 'USD', dates: s.prices.map(x => x[0]), close: s.prices.map(x => x[1]), q: [...seen.values()].sort((a, b) => a.end.localeCompare(b.end)), shares: s.sharesNow });
}
for (const [k, s] of Object.entries(D.kr)) add('KR', k, s);
const US_NAMES = { AAPL: '애플', MSFT: '마이크로소프트', NVDA: '엔비디아', AMZN: '아마존', GOOGL: '알파벳', META: '메타', JPM: 'JP모건', JNJ: '존슨앤드존슨', XOM: '엑슨모빌', PG: 'P&G', KO: '코카콜라', PEP: '펩시코', WMT: '월마트', HD: '홈디포', UNH: '유나이티드헬스', V: '비자', MA: '마스터카드', NKE: '나이키', INTC: '인텔', CSCO: '시스코', ORCL: '오라클', PFE: '화이자', MRK: '머크', CVX: '셰브론', BA: '보잉', CAT: '캐터필러', MCD: '맥도날드', COST: '코스트코', ADBE: '어도비', GE: 'GE', F: '포드', GM: 'GM', VZ: '버라이즌', T: 'AT&T', IBM: 'IBM', KHC: '크래프트하인즈', PYPL: '페이팔', ROKU: '로쿠', ZM: '줌', PTON: '펠로톤', NFLX: '넷플릭스', AMD: 'AMD', MU: '마이크론', TSLA: '테슬라', CRM: '세일즈포스', SNAP: '스냅', SBUX: '스타벅스', QCOM: '퀄컴', LLY: '일라이릴리' };
for (const [k, s] of Object.entries(D.us)) add('US', k, { ...s, name: US_NAMES[k] ? `${US_NAMES[k]} (${k})` : k });
const macro = Object.fromEntries(Object.entries(D.macro).map(([k, v]) => [k, { dates: v.map(x => x[0]), close: v.map(x => x[1]) }]));
const idxOf = m => macro[m === 'KR' ? '^KS11' : '^GSPC'];

// 공개된 분기만으로 TTM과 1년 전 TTM
const ttm = (arr, k) => arr.length === 4 && arr.every(x => Number.isFinite(x[k])) ? arr.reduce((a, x) => a + x[k], 0) : null;
const contiguous = arr => arr.length === 4 && (Date.parse(arr[3].end) - Date.parse(arr[0].end)) / 864e5 < 300;
function known(c, d) {
  const q = c.q.filter(x => x.available <= d); if (q.length < 8) return null;
  const a = q.slice(-4), b = q.slice(-8, -4), z = q.slice(-12, -8);
  if (!contiguous(a) || !contiguous(b)) return null;
  const rev = ttm(a, 'revenue'), revP = ttm(b, 'revenue'), revPP = z.length === 4 ? ttm(z, 'revenue') : null;
  const oi = ttm(a, 'oi'), oiP = ttm(b, 'oi'), ni = ttm(a, 'ni'), niP = ttm(b, 'ni'), ocf = ttm(a, 'ocf');
  const g = (x, y) => x != null && y > 0 ? x / y - 1 : null;
  return { lastEnd: a[3].end, lastAvail: a[3].available, rev, oi, ni, eq: a[3].equity, ocf, revG: g(rev, revP), revGPrev: g(revP, revPP), oiG: oi != null && oiP > 0 ? oi / oiP - 1 : null, niG: g(ni, niP), margin: rev > 0 && oi != null ? oi / rev : null, marginPrev: revP > 0 && oiP != null ? oiP / revP : null, nQuarters: q.length };
}
// 실제 결과: 마지막 알려진 분기 다음 4개 분기(공개 여부 무관)
function outcome(c, lastEnd, horizonQ = 4) {
  const after = c.q.filter(x => x.end > lastEnd).slice(0, horizonQ);
  if (after.length < horizonQ || (Date.parse(after.at(-1).end) - Date.parse(after[0].end)) / 864e5 > 300 * horizonQ / 4) return null;
  return { rev: ttm(after.slice(-4), 'revenue'), oi: ttm(after.slice(-4), 'oi'), ni: ttm(after.slice(-4), 'ni'), end: after.at(-1).end, known: after.map(x => x.available).sort().at(-1) };
}
// 분석일에 공개돼 있던 것 중 기준일이 가장 늦은 주식 수(지금 단위). 400일 넘게 묵은 값은 쓰지 않는다.
function pitShares(c, d) {
  let x = null; for (const e of c.pit?.series || []) if (e.available <= d && (!x || e.asOf > x.asOf)) x = e;
  if (!x || (Date.parse(d) - Date.parse(x.asOf)) / 864e5 > 400) return null;
  return x.v;
}
const priceAt = (c, d) => { const i = bs(c.dates, d); return i < 0 ? null : c.close[i]; };

const monthEnds = {};
for (const m of ['KR', 'US']) { const ix = idxOf(m); monthEnds[m] = ix.dates.filter((d, i) => i < ix.dates.length - 1 && d.slice(0, 7) !== ix.dates[i + 1].slice(0, 7) && d >= '2014-01-01'); }
const rows = [], header = ['market', 'sym', 'date', 'lastEnd', 'revG', 'revGPrev', 'accel', 'oiG', 'niG', 'margin', 'marginChg', 'roe', 'ey', 'psr', 'logCap', 'mom', 'vol', 'dd52', 'ocfMargin', 'fwdRevG', 'fwdOiG', 'fwdNiG', 'fwdRevG2y', 'fwdEx12', 'fwdEx24', 'fwdRet12', 'sector', 'psrPit', 'eyPit', 'logCapPit', 'fwdKnown', 'fwd2yKnown'];
for (const c of companies) {
  const ix = idxOf(c.market);
  for (const d of monthEnds[c.market]) {
    const i = bs(c.dates, d); if (i < 260 || c.dates[i] < d.slice(0, 8) + '01') continue;
    const k = known(c, d); if (!k) continue;
    const p = c.close[i], cap = c.shares ? p * c.shares : null, sp = pitShares(c, d), capPit = sp ? p * sp : null;
    const rets = []; for (let t = i - 59; t <= i; t++) rets.push(c.close[t] / c.close[t - 1] - 1);
    const f = { revG: k.revG, revGPrev: k.revGPrev, accel: k.revG != null && k.revGPrev != null ? k.revG - k.revGPrev : null, oiG: k.oiG, niG: k.niG, margin: k.margin, marginChg: k.margin != null && k.marginPrev != null ? k.margin - k.marginPrev : null,
      roe: k.eq > 0 && k.ni != null ? k.ni / k.eq : null, ey: cap && k.ni != null ? k.ni / cap : null, psr: cap && k.rev > 0 ? cap / k.rev : null, logCap: cap ? Math.log(cap) : null,
      mom: c.close[i - 21] / c.close[i - 252] - 1, vol: sd(rets) * Math.sqrt(252), dd52: p / Math.max(...c.close.slice(i - 251, i + 1)) - 1, ocfMargin: k.rev > 0 && k.ocf != null ? k.ocf / k.rev : null };
    const o = outcome(c, k.lastEnd), o2 = outcome(c, k.lastEnd, 8);
    const g = (x, y) => x != null && y > 0 ? x / y - 1 : null;
    const fwd = h => { const j = bs(c.dates, plusDays(d, h)); if (j >= c.dates.length - 1 || c.dates[j] < plusDays(d, h - 10)) return null; const a = bs(ix.dates, d), b = bs(ix.dates, c.dates[j]); return [c.close[j] / p - 1, c.close[j] / p - 1 - (ix.close[b] / ix.close[a] - 1)]; };
    const r12 = fwd(365), r24 = fwd(730);
    rows.push([c.market, c.sym, d, k.lastEnd, f.revG, f.revGPrev, f.accel, f.oiG, f.niG, f.margin, f.marginChg, f.roe, f.ey, f.psr, f.logCap, f.mom, f.vol, f.dd52, f.ocfMargin,
      o ? g(o.rev, k.rev) : null, o && k.oi > 0 && o.oi != null ? o.oi / k.oi - 1 : null, o ? g(o.ni, k.ni) : null, o2 ? g(o2.rev, k.rev) : null, r12 ? r12[1] : null, r24 ? r24[1] : null, r12 ? r12[0] : null,
      c.sector, capPit && k.rev > 0 ? capPit / k.rev : null, capPit && k.ni != null ? k.ni / capPit : null, capPit ? Math.log(capPit) : null, o?.known ?? null, o2?.known ?? null]);
  }
}
const csv = [header.join(','), ...rows.map(r => r.map(v => v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(6) : '') : v).join(','))].join('\n');
writeFileSync(join(root, '.research/growth-panel.csv'), csv);

// 화면용 이력(월말 종가·지수, 분기 재무). 모델 판단(pred)은 growth-model.py가 채운다.
const hist = { version: 'H1-2026-11-06', generatedAt: new Date().toISOString(), note: '공개 재무(한국 OpenDART: 법정 기한을 공개일로 가정, 미국 SEC: 최초 제출일)와 분할 조정 시세. 주식 수는 현재 값으로 과거 시가총액을 근사.', companies: {} };
for (const c of companies) {
  const ix = idxOf(c.market), months = monthEnds[c.market].map(d => { const i = bs(c.dates, d), j = bs(ix.dates, d); return i >= 0 && c.dates[i] >= d.slice(0, 8) + '01' ? [d, Math.round(c.close[i] * 100) / 100, Math.round(ix.close[j] * 100) / 100] : null; }).filter(Boolean);
  const sharesPit = (c.pit?.series || []).map(e => [e.asOf, e.available, Math.round(e.v)]);
  hist.companies[c.sym] = { name: c.name, market: c.market, sector: c.sector, currency: c.currency, shares: c.shares ? Math.round(c.shares) : null, sharesPit, quarters: c.q.map(x => [x.end, x.available, x.revenue, x.oi, x.ni, x.equity]), months, pred: {} };
}
writeFileSync(join(root, 'data/company-history.json'), JSON.stringify(hist));
// 점검: 최근 '그때 주식 수'와 지금 주식 수(네이버 시가총액 ÷ 주가)가 20% 넘게 다르면 표시
for (const c of companies) { const last = c.pit?.series.at(-1)?.v, r = last && c.shares ? last / c.shares : null; if (r && (r < 0.8 || r > 1.25)) shareLog.push(`${c.sym} 최근/지금 ${r.toFixed(2)}`); }
console.log('주식 수', companies.filter(c => c.pit).length + '/' + companies.length, '|', shareLog.join(' | '));
console.log('기업', companies.length, '패널 행', rows.length, '목표 있음', rows.filter(r => r[19] != null).length, '수익 목표', rows.filter(r => r[23] != null).length);
