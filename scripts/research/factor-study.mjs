// 복합 요인 연구: 시점 기준(그때 알 수 있던 자료만) 월별 패널로
//  1) 요인별 예측력(다음 1·3개월 상대 수익과의 순위 상관, IC)  2) 고정 부호 복합 점수 vs 걷기식 학습 모델
//  3) 거시 지표로 지수 다음 달 방향 예측  4) 큰 하락 뒤 추가 매수·큰 상승 뒤 이익 실현(재무 상태별)  5) 세부 전략(플레이북) 모의 운용
// 2013~2019(또는 2016~2020)로 고르고 이후로 확인. 입력: .research/factor-data.json, 출력: data/factor-study.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const D = JSON.parse(readFileSync(join(root, '.research/factor-data.json'), 'utf8'));
const PICK_END = '2019-12-31';
const r2 = v => Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null, p1 = v => Number.isFinite(v) ? Math.round(v * 1000) / 10 : null;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const bs = (dates, d) => { let lo = 0, hi = dates.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { f = m; lo = m + 1; } else hi = m - 1; } return f; };

// ── 종목 준비 ────────────────────────────────────────────────
const stocks = [];
function addStock(market, sym, s) {
  if (!s.prices?.length) return;
  const dates = s.prices.map(x => x[0]), close = s.prices.map(x => x[1]);
  let q = [];
  if (market === 'KR') q = (s.quarters || []).map(x => ({ end: x.end, available: x.available, revenue: x.revenue, oi: x.operatingIncome, ni: x.netIncome, equity: x.equity }));
  else {
    const ends = new Set([...(s.revenue || []), ...(s.netIncome || [])].map(x => x.end));
    const at = (arr, e) => (arr || []).find(x => x.end === e);
    q = [...ends].map(e => { const R = at(s.revenue, e), O = at(s.operatingIncome, e), N = at(s.netIncome, e); return { end: e, available: [R, O, N].filter(Boolean).map(x => x.available).sort().at(-1), revenue: R?.val ?? null, oi: O?.val ?? null, ni: N?.val ?? null }; });
    q.forEach(x => { const eq = (s.equity || []).filter(e => e.end <= x.end).at(-1); x.equity = eq?.val ?? null; });
  }
  q.sort((a, b) => a.end.localeCompare(b.end));
  stocks.push({ market, sym, name: s.name, dates, close, q, shares: s.sharesNow, currency: market === 'KR' ? 'KRW' : 'USD' });
}
for (const [k, s] of Object.entries(D.kr)) addStock('KR', k, s);
for (const [k, s] of Object.entries(D.us)) addStock('US', k, s);
const macro = Object.fromEntries(Object.entries(D.macro).map(([k, v]) => [k, { dates: v.map(x => x[0]), close: v.map(x => x[1]) }]));
const px = (s, d) => { const i = bs(s.dates, d); return i < 0 ? null : s.close[i]; };
const pxIdx = (s, i) => s.close[Math.max(0, Math.min(s.close.length - 1, i))];

// 시점 기준 재무: d에 공개된 분기만. TTM(최근 4분기)과 1년 전 TTM.
function fundAt(s, d) {
  const q = s.q.filter(x => x.available && x.available <= d);
  if (q.length < 4) return null;
  const last4 = q.slice(-4), prev4 = q.slice(-8, -4);
  const span = (Date.parse(last4[3].end) - Date.parse(last4[0].end)) / 864e5; if (span > 300) return null; // 연속 분기 확인
  const sum = (arr, k) => arr.every(x => Number.isFinite(x[k])) ? arr.reduce((a, x) => a + x[k], 0) : null;
  const rev = sum(last4, 'revenue'), oi = sum(last4, 'oi'), ni = sum(last4, 'ni'), eq = last4[3].equity;
  const revP = prev4.length === 4 ? sum(prev4, 'revenue') : null, oiP = prev4.length === 4 ? sum(prev4, 'oi') : null;
  return { rev, oi, ni, eq, revGrowth: rev && revP > 0 ? rev / revP - 1 : null, margin: rev > 0 && oi != null ? oi / rev : null, marginPrev: revP > 0 && oiP != null ? oiP / revP : null, lastEnd: last4[3].end };
}

// ── 월말 패널 ────────────────────────────────────────────────
const FACTORS = ['mom', 'rev1', 'vol', 'dd52', 'ey', 'roe', 'growth', 'marginChg'];
const SIGN = { mom: 1, rev1: -1, vol: -1, dd52: 0, ey: 1, roe: 1, growth: 1, marginChg: 1 }; // 문헌에서 미리 정한 방향(dd52는 방향 미정이라 복합 점수에서 뺌)
function monthEnds(market) { const ix = macro[market === 'KR' ? '^KS11' : '^GSPC']; const out = []; for (let i = 0; i < ix.dates.length - 1; i++) if (ix.dates[i].slice(0, 7) !== ix.dates[i + 1].slice(0, 7) && ix.dates[i] >= '2012-12-01') out.push(ix.dates[i]); return out; }
const panel = []; // {market, date, rows:[{sym, f:{...}, fwd1, fwd3}]}
for (const market of ['KR', 'US']) {
  for (const d of monthEnds(market)) {
    const rows = [];
    for (const s of stocks.filter(x => x.market === market)) {
      const i = bs(s.dates, d); if (i < 260 || s.dates[i] < d.slice(0, 8) + '01') continue;
      const p = s.close[i], f = {};
      f.mom = pxIdx(s, i - 21) / pxIdx(s, i - 252) - 1; f.rev1 = p / pxIdx(s, i - 21) - 1;
      const rets = []; for (let k = i - 59; k <= i; k++) rets.push(s.close[k] / s.close[k - 1] - 1); f.vol = sd(rets) * Math.sqrt(252);
      f.dd52 = p / Math.max(...s.close.slice(i - 251, i + 1)) - 1;
      const fu = fundAt(s, d);
      if (fu) { const cap = s.shares ? p * s.shares : null; f.ey = cap && fu.ni != null ? fu.ni / cap : null; f.roe = fu.eq > 0 && fu.ni != null ? fu.ni / fu.eq : null; f.growth = fu.revGrowth; f.marginChg = fu.margin != null && fu.marginPrev != null ? fu.margin - fu.marginPrev : null; f.oi = fu.oi; f.margin = fu.margin; }
      const j1 = i + 21, j3 = i + 63;
      rows.push({ sym: s.sym, f, fwd1: j1 < s.close.length ? s.close[j1] / p - 1 : null, fwd3: j3 < s.close.length ? s.close[j3] / p - 1 : null });
    }
    if (rows.length < 8) continue;
    for (const h of ['fwd1', 'fwd3']) { const v = rows.map(r => r[h]).filter(Number.isFinite); const m = v.length ? mean(v) : 0; rows.forEach(r => { r[h + 'x'] = Number.isFinite(r[h]) ? r[h] - m : null; }); }
    panel.push({ market, date: d, rows });
  }
}
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : 0; };
const spearman = (x, y) => pearson(rank(x), rank(y));
const zscore = vals => { const v = vals.filter(Number.isFinite); if (v.length < 5) return vals.map(() => null); const m = mean(v), s = sd(v) || 1; return vals.map(x => Number.isFinite(x) ? Math.max(-3, Math.min(3, (x - m) / s)) : null); };
function composite(rows) {
  const zs = Object.fromEntries(FACTORS.filter(f => SIGN[f]).map(f => [f, zscore(rows.map(r => r.f[f]))]));
  return rows.map((r, i) => { const v = Object.entries(zs).map(([f, z]) => z[i] === null ? null : z[i] * SIGN[f]).filter(x => x !== null); return v.length >= 4 ? mean(v) : null; });
}
function icStats(get, horizon = 'fwd1x', filter = () => true) {
  const out = {};
  for (const [label, from, to] of [['pick', '0000', PICK_END], ['check', '2020-01-01', '9999'], ['all', '0000', '9999']]) {
    const ics = [];
    for (const m of panel.filter(x => x.date >= from && x.date <= to && filter(x))) {
      const sc = get(m), ok = m.rows.map((r, i) => [sc[i], r[horizon]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
      if (ok.length >= 8) ics.push(spearman(ok.map(x => x[0]), ok.map(x => x[1])));
    }
    out[label] = ics.length ? { months: ics.length, ic: r2(mean(ics)), t: r2(mean(ics) / (sd(ics) / Math.sqrt(ics.length))), positive: Math.round(ics.filter(x => x > 0).length / ics.length * 100) } : { months: 0 };
  }
  return out;
}
const factorIC = {};
for (const market of ['KR', 'US']) {
  factorIC[market] = {};
  for (const f of FACTORS) factorIC[market][f] = { fwd1: icStats(m => m.rows.map(r => r.f[f]), 'fwd1x', m => m.market === market), fwd3: icStats(m => m.rows.map(r => r.f[f]), 'fwd3x', m => m.market === market) };
  factorIC[market].composite = { fwd1: icStats(m => composite(m.rows), 'fwd1x', m => m.market === market), fwd3: icStats(m => composite(m.rows), 'fwd3x', m => m.market === market) };
}

// 걷기식 학습(능형 회귀): 해마다 그 전 자료로만 계수를 정하고 다음 해 예측
function ridge(X, y, lambda = 5) {
  const k = X[0].length, A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lambda : 0))), b = new Array(k).fill(0);
  for (let n = 0; n < X.length; n++) for (let i = 0; i < k; i++) { b[i] += X[n][i] * y[n]; for (let j = 0; j < k; j++) A[i][j] += X[n][i] * X[n][j]; }
  for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; for (let r = 0; r < k; r++) if (r !== i) { const c = A[r][i] / A[i][i]; for (let j = i; j < k; j++) A[r][j] -= c * A[i][j]; b[r] -= c * b[i]; } }
  return b.map((v, i) => v / A[i][i]);
}
const FX = FACTORS.filter(f => f !== 'dd52').concat('dd52');
const learned = {};
for (const market of ['KR', 'US']) {
  const ms = panel.filter(m => m.market === market), feats = m => { const zs = Object.fromEntries(FX.map(f => [f, zscore(m.rows.map(r => r.f[f]))])); return m.rows.map((r, i) => FX.map(f => zs[f][i] ?? 0)); };
  const preds = new Map();
  for (let y = 2016; y <= 2026; y++) {
    const train = ms.filter(m => m.date < `${y}-01-01` && m.date < `${y - 1}-11-30`), X = [], Y = [];
    for (const m of train) { const F = feats(m), yr = rank(m.rows.map(r => r.fwd1x ?? 0)), n = m.rows.length; m.rows.forEach((r, i) => { if (Number.isFinite(r.fwd1x)) { X.push(F[i]); Y.push(yr[i] / (n - 1) - 0.5); } }); }
    if (X.length < 200) continue;
    const w = ridge(X, Y);
    for (const m of ms.filter(m => m.date.startsWith(String(y)))) preds.set(m, feats(m).map(x => x.reduce((a, v, i) => a + v * w[i], 0)));
    if (y === 2026) learned[market + 'Weights'] = Object.fromEntries(FX.map((f, i) => [f, r2(w[i])]));
  }
  learned[market] = icStats(m => preds.get(m) || m.rows.map(() => null), 'fwd1x', m => m.market === market && preds.has(m));
}

// ── 3) 거시 지표로 다음 달 지수 방향 ─────────────────────────
function macroTest(indexSym) {
  const ix = macro[indexSym], months = monthEnds(indexSym === '^KS11' ? 'KR' : 'US');
  const at = (sym, d, back = 0) => { const s = macro[sym]; const i = bs(s.dates, d); return i - back >= 0 ? s.close[i - back] : null; };
  const rows = months.map(d => { const i = bs(ix.dates, d), ma = mean(ix.close.slice(Math.max(0, i - 199), i + 1));
    const x = [at('^VIX', d), at('^VIX', d) / at('^VIX', d, 21) - 1, at('^TNX', d) - at('^TNX', d, 63), at('KRW=X', d) / at('KRW=X', d, 63) - 1, ix.close[i] / ma - 1, at('CL=F', d) / at('CL=F', d, 63) - 1, ix.close[i] / ix.close[i - 21] - 1];
    return { d, x, y: i + 21 < ix.close.length ? ix.close[i + 21] / ix.close[i] - 1 : null }; }).filter(r => r.x.every(Number.isFinite) && Number.isFinite(r.y));
  const oos = [];
  for (let k = 0; k < rows.length; k++) { if (rows[k].d < '2016-01-01') continue; const tr = rows.slice(0, k - 1); if (tr.length < 36) continue;
    const mu = tr[0].x.map((_, j) => mean(tr.map(r => r.x[j]))), sg = tr[0].x.map((_, j) => sd(tr.map(r => r.x[j])) || 1), z = r => r.x.map((v, j) => (v - mu[j]) / sg[j]);
    const w = ridge(tr.map(z), tr.map(r => r.y), 10), ybar = mean(tr.map(r => r.y)), pred = z(rows[k]).reduce((a, v, j) => a + v * w[j], 0);
    oos.push({ y: rows[k].y, pred, base: ybar }); }
  const sse = oos.reduce((a, r) => a + (r.y - r.pred) ** 2, 0), sse0 = oos.reduce((a, r) => a + (r.y - r.base) ** 2, 0);
  const hit = oos.filter(r => Math.sign(r.pred) === Math.sign(r.y)).length / oos.length, up = oos.filter(r => r.y > 0).length / oos.length;
  return { months: oos.length, oosR2: r2(1 - sse / sse0), directionHit: Math.round(hit * 100), upShare: Math.round(up * 100) };
}
const macroResult = { KOSPI: macroTest('^KS11'), SP500: macroTest('^GSPC') };

// ── 4) 큰 하락 뒤 추가 매수 / 큰 상승 뒤 이익 실현: 재무 상태별 ───
function eventStudy(cond, label) {
  const groups = { healthy: [], weak: [], unknown: [] };
  for (const s of stocks) {
    let last = -1e9; const ix = macro[s.market === 'KR' ? '^KS11' : '^GSPC'];
    for (let i = 260; i < s.close.length - 120; i++) {
      if (s.dates[i] < '2015-06-01' || i - last < 60 || !cond(s, i)) continue; last = i;
      const fu = fundAt(s, s.dates[i]), k0 = bs(ix.dates, s.dates[i]), k6 = bs(ix.dates, s.dates[i + 60]), k12 = bs(ix.dates, s.dates[i + 120]);
      const ex60 = s.close[i + 60] / s.close[i] - 1 - (ix.close[k6] / ix.close[k0] - 1), ex120 = s.close[i + 120] / s.close[i] - 1 - (ix.close[k12] / ix.close[k0] - 1);
      let low = Infinity; for (let k = i + 1; k <= i + 60; k++) low = Math.min(low, s.close[k] / s.close[i] - 1);
      const weak = fu && ((fu.oi != null && fu.oi < 0) || (fu.revGrowth != null && fu.revGrowth < -0.1) || (fu.margin != null && fu.marginPrev != null && fu.margin - fu.marginPrev < -0.05));
      const g = !fu ? 'unknown' : weak ? 'weak' : 'healthy';
      groups[g].push({ ex60, ex120, low, date: s.dates[i], sym: s.sym });
    }
  }
  const st = a => a.length ? { n: a.length, ex60: p1(mean(a.map(x => x.ex60))), ex60med: p1([...a.map(x => x.ex60)].sort((x, y) => x - y)[Math.floor(a.length / 2)]), ex120: p1(mean(a.map(x => x.ex120))), hit120: Math.round(a.filter(x => x.ex120 > 0).length / a.length * 100), furtherDrop: p1(mean(a.map(x => x.low))) } : { n: 0 };
  return { label, healthy: st(groups.healthy), weak: st(groups.weak), unknown: st(groups.unknown), pickHealthy: st(groups.healthy.filter(x => x.date <= PICK_END)), checkHealthy: st(groups.healthy.filter(x => x.date > PICK_END)), pickWeak: st(groups.weak.filter(x => x.date <= PICK_END)), checkWeak: st(groups.weak.filter(x => x.date > PICK_END)) };
}
const dip20 = (s, i) => s.close[i] / Math.max(...s.close.slice(i - 63, i + 1)) - 1 <= -0.2;
const dip30 = (s, i) => s.close[i] / Math.max(...s.close.slice(i - 63, i + 1)) - 1 <= -0.3;
const run30 = (s, i) => s.close[i] / s.close[i - 60] - 1 >= 0.3;
const events = { dip20: eventStudy(dip20, '3개월 고점 대비 −20%'), dip30: eventStudy(dip30, '3개월 고점 대비 −30%'), run30: eventStudy(run30, '60거래일 +30% 급등') };

writeFileSync(join(root, '.research/panel-meta.json'), JSON.stringify({ months: panel.length, stocks: stocks.length }));
const result = { generatedAt: new Date().toISOString(), pickEnd: PICK_END, universe: { KR: stocks.filter(s => s.market === 'KR').map(s => s.name), US: stocks.filter(s => s.market === 'US').map(s => s.sym) }, months: panel.length, factorIC, learned, macro: macroResult, events, signs: SIGN };
writeFileSync(join(root, '.research/factor-study.json'), JSON.stringify(result, null, 1));
console.log('패널 월', panel.length, '종목', stocks.length);
for (const m of ['KR', 'US']) { console.log(`\n[${m}] 요인 IC(다음 1개월 상대 수익) 고르기 | 확인`); for (const f of [...FACTORS, 'composite']) { const a = factorIC[m][f].fwd1; console.log('  ', f.padEnd(10), JSON.stringify(a.pick), '|', JSON.stringify(a.check)); } console.log('   학습 모델(걷기식)', JSON.stringify(learned[m]), JSON.stringify(learned[m + 'Weights'])); }
console.log('\n거시 → 다음 달 지수', JSON.stringify(macroResult));
for (const [k, e] of Object.entries(events)) console.log('\n사건', e.label, '\n  재무 건강', JSON.stringify(e.healthy), '\n  재무 악화', JSON.stringify(e.weak), '\n  건강 고르기/확인', JSON.stringify(e.pickHealthy), JSON.stringify(e.checkHealthy), '\n  악화 고르기/확인', JSON.stringify(e.pickWeak), JSON.stringify(e.checkWeak));
