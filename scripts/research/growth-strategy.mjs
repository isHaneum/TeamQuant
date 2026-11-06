// 성장 전망으로 종목을 고르면 돈이 되는가? (성장 전망 → 전략 검증) 결과: data/growth-strategy.json
// 실행 전에 고정한 가설(결과를 본 뒤 바꾸지 않음):
//  H1 성장 전망 상위 20%만 동일가중 보유 → 같은 시장 연구 기업 전체 동일가중보다 낫다.
//  H2 성장 전망 하위 20%를 빼고 보유 → 전체보다 낫다(위험 걸러내기).
//  H3 모델이 '올해 성장률 그대로' 상위 20%보다 낫다.
//  H4 하락장(2022년, 시장이 5% 넘게 빠진 달)에 성장 상위가 덜 빠진다.
//  H5 성장 전망이 높을수록 다음 12개월 최대 낙폭이 크다(위험 경고로 쓸 수 있는가).
// 규칙: 매월 말 그때까지 공개된 정보로 만든 표본 외 판단(company-history pred, 매년 1월 재학습)으로 다음 달 말까지 보유.
//       시장(한국·미국)별로 따로 만들고, 그 달 판단이 있는 기업이 20개 이상일 때만. 수익률은 배당 포함(.research/dividends.json).
//       거래 비용: 편도 한국 0.2%(세금 포함 근사), 미국 0.05%. 설정 기간 2017~2020, 보고 기간 2021~.
// 한계: 사후에 고른 98개 기업 안의 비교라 '전체 대비' 수익률은 생존 편향으로 부풀려져 있다. 같은 기업 안 상대 비교만 해석한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownAt } from '../../lib/company-lab.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hist = JSON.parse(readFileSync(join(root, 'data/company-history.json'), 'utf8'));
const divs = existsSync(join(root, '.research/dividends.json')) ? JSON.parse(readFileSync(join(root, '.research/dividends.json'), 'utf8')) : {};
const COST = { KR: 0.002, US: 0.0005 }, CHECK_START = '2021-01', MIN_N = 20;

// ── 기업-월 행 ──
const rows = [], divWarn = [];
for (const [sym, c] of Object.entries(hist.companies)) {
  const m = c.months, dv = divs[sym] || [];
  for (let i = 0; i + 1 < m.length; i++) {
    const d = m[i][0], p = c.pred[d]; if (!p) continue;
    let div = 0; for (const [dd, a] of dv) if (dd > d && dd <= m[i + 1][0]) div += a;
    if (div > 0.15 * m[i][1]) { divWarn.push(`${sym} ${d} ${div}`); div = 0; }
    const ret = (m[i + 1][1] + div) / m[i][1] - 1;
    // 다음 12개월 최대 낙폭(월말 종가 기준)
    let peak = m[i][1], mdd = 0; const end = Math.min(m.length - 1, i + 12);
    for (let j = i + 1; j <= end; j++) { peak = Math.max(peak, m[j][1]); mdd = Math.min(mdd, m[j][1] / peak - 1); }
    const k = knownAt(c.quarters, d);
    // 비교 기준: 지난 12개월 월간 수익률 변동성(이미 아는 값)
    let vol = null; if (i >= 12) { const rr = []; for (let j = i - 11; j <= i; j++) rr.push(m[j][1] / m[j - 1][1] - 1); const mu = rr.reduce((s, x) => s + x, 0) / 12; vol = Math.sqrt(rr.reduce((s, x) => s + (x - mu) ** 2, 0) / 11); }
    rows.push({ sym, mkt: c.market, ym: d.slice(0, 7), g: p[0], ret, idxRet: m[i + 1][2] / m[i][2] - 1, persist: k?.revG ?? null, vol, mdd: end - i === 12 ? mdd : null });
  }
}
// ── 같은 시장·같은 달 집단 ──
const groups = new Map();
for (const r of rows) { const key = `${r.mkt}|${r.ym}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
const pct = (arr, f) => { const v = arr.map(f), idx = v.map((x, i) => [x, i]).filter(([x]) => Number.isFinite(x)).sort((a, b) => a[0] - b[0]); const out = Array(arr.length).fill(null); idx.forEach(([, i], r) => out[i] = (r + 0.5) / idx.length); return out; };
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const PORTS = {
  ALL: () => true,
  TOP: r => r.gr >= 0.8,
  EXBOT: r => r.gr >= 0.2,
  BOT: r => r.gr < 0.2,
  PTOP: r => r.pr != null && r.pr >= 0.8,
};
const series = { KR: [], US: [] }, prevW = { KR: {}, US: {} };
for (const [key, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (g.length < MIN_N) continue;
  const [mkt, ym] = key.split('|'), gr = pct(g, r => r.g), pr = pct(g, r => r.persist);
  g.forEach((r, i) => { r.gr = gr[i]; r.pr = pr[i]; });
  const pt = { ym, n: g.length, idx: median(g.map(r => r.idxRet)) };
  for (const [name, f] of Object.entries(PORTS)) {
    const sel = g.filter(f); if (!sel.length) { pt[name] = null; continue; }
    const w = Object.fromEntries(sel.map(r => [r.sym, 1 / sel.length])), pw = prevW[mkt][name] || {};
    const bought = Object.keys({ ...w, ...pw }).reduce((s, k) => s + Math.max(0, (w[k] || 0) - (pw[k] || 0)), 0);
    const cost = Object.keys(pw).length ? 2 * bought * COST[mkt] : COST[mkt];
    pt[name] = sel.reduce((s, r) => s + r.ret, 0) / sel.length - cost; pt[name + 'Turn'] = bought;
    prevW[mkt][name] = w;
  }
  // H5: 성장 전망 순위와 다음 12개월 최대 낙폭의 순위 상관(낙폭이 클수록 작은 값 → 음의 상관이면 '높을수록 더 빠짐')
  const okRows = g.filter(r => r.mdd != null);
  if (okRows.length >= MIN_N) {
    const a = pct(okRows, r => r.g), b = pct(okRows, r => r.mdd), c2 = pct(okRows, r => r.persist), v = pct(okRows, r => r.vol);
    pt.ddIc = spearman(a, b); pt.ddIcPersist = spearman(c2, b); pt.ddIcVol = spearman(v.map(x => x == null ? null : -x), b);
    // 변동성을 뺀 뒤에도 성장 전망이 낙폭을 더 알려주는가(순위 잔차끼리의 상관)
    const resid = (y, x) => { const ok = y.map((t, i) => [t, x[i]]).filter(([t, s]) => t != null && s != null); const n = ok.length, mx = ok.reduce((s, q) => s + q[1], 0) / n, my = ok.reduce((s, q) => s + q[0], 0) / n; const bb = ok.reduce((s, q) => s + (q[1] - mx) * (q[0] - my), 0) / ok.reduce((s, q) => s + (q[1] - mx) ** 2, 0); return y.map((t, i) => t == null || x[i] == null ? null : t - my - bb * (x[i] - mx)); };
    if (v.filter(x => x != null).length >= MIN_N) pt.ddIcPartial = spearman(resid(a, v), resid(b, v));
    pt.ddTop = median(okRows.filter((r, i) => a[i] >= 0.8).map(r => r.mdd)); pt.ddRest = median(okRows.filter((r, i) => a[i] < 0.8).map(r => r.mdd));
  }
  series[mkt].push(pt);
}
function spearman(a, b) { const ok = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null); const n = ok.length; if (n < 5) return null; const ma = ok.reduce((s, x) => s + x[0], 0) / n, mb = ok.reduce((s, x) => s + x[1], 0) / n; let num = 0, da = 0, db = 0; for (const [x, y] of ok) { num += (x - ma) * (y - mb); da += (x - ma) ** 2; db += (y - mb) ** 2; } return num / Math.sqrt(da * db); }
// Newey-West 평균·표준오차
function nw(x, lag = 3) { const v = x.filter(Number.isFinite), n = v.length; if (n < 6) return null; const m = v.reduce((s, y) => s + y, 0) / n, e = v.map(y => y - m); let s = e.reduce((a, y) => a + y * y, 0) / n; for (let l = 1; l <= lag; l++) { let c = 0; for (let i = l; i < n; i++) c += e[i] * e[i - l]; s += 2 * (1 - l / (lag + 1)) * c / n; } const se = Math.sqrt(Math.max(s, 0) / n); return { mean: m, se, t: m / se, n }; }
const r3 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
function perf(rets) { const v = rets.filter(Number.isFinite); if (!v.length) return null; let w = 1, peak = 1, mdd = 0; for (const r of v) { w *= 1 + r; peak = Math.max(peak, w); mdd = Math.min(mdd, w / peak - 1); } const mean = v.reduce((s, x) => s + x, 0) / v.length, sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)); return { months: v.length, cagr: r3(w ** (12 / v.length) - 1), vol: r3(sd * Math.sqrt(12)), mdd: r3(mdd), total: r3(w - 1) }; }
function excess(pts, a, b) { const d = pts.map(p => p[a] != null && p[b] != null ? p[a] - p[b] : null); const s = nw(d); return s && { annual: r3(s.mean * 12), ci95: [r3((s.mean - 1.96 * s.se) * 12), r3((s.mean + 1.96 * s.se) * 12)], t: r3(s.t), winPct: Math.round(100 * d.filter(x => x > 0).length / d.filter(x => x != null).length), months: s.n }; }

const out = { version: 'S1-' + new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), modelVersion: hist.model.version,
  rules: { rebalance: '매월 말', hold: '다음 달 말', weights: '동일가중', costOneWay: COST, minGroup: MIN_N, checkStart: CHECK_START, dividends: Object.keys(divs).length > 0 },
  hypotheses: { H1: '성장 상위 20% > 전체', H2: '성장 하위 20% 제외 > 전체', H3: '모델 상위 20% > 올해 성장률 상위 20%', H4: '하락장에서 성장 상위가 덜 빠진다', H5: '성장 전망이 높을수록 다음 12개월 낙폭이 크다' },
  markets: {}, combined: {}, notes: [] };
for (const mkt of ['KR', 'US']) {
  const all = series[mkt], pick = all.filter(p => p.ym < CHECK_START), check = all.filter(p => p.ym >= CHECK_START);
  const block = pts => ({
    span: pts.length ? [pts[0].ym, pts.at(-1).ym] : null,
    perf: Object.fromEntries(['ALL', 'TOP', 'EXBOT', 'BOT', 'PTOP', 'idx'].map(k => [k, perf(pts.map(p => p[k]))])),
    turnover: Object.fromEntries(['TOP', 'EXBOT', 'PTOP'].map(k => [k, r3(pts.slice(1).reduce((s, p) => s + (p[k + 'Turn'] || 0), 0) / Math.max(1, pts.length - 1) * 12)])),
    excess: { H1_TOP_ALL: excess(pts, 'TOP', 'ALL'), H2_EXBOT_ALL: excess(pts, 'EXBOT', 'ALL'), H3_TOP_PTOP: excess(pts, 'TOP', 'PTOP'), TOP_BOT: excess(pts, 'TOP', 'BOT'), ALL_IDX: excess(pts, 'ALL', 'idx') },
    y2022: Object.fromEntries(['ALL', 'TOP', 'EXBOT', 'BOT', 'PTOP', 'idx'].map(k => [k, perf(pts.filter(p => p.ym.startsWith('2022')).map(p => p[k]))?.total ?? null])),
    downMonths: (() => { const dm = pts.filter(p => p.idx < -0.05); return { months: dm.length, TOP_ALL: r3(dm.reduce((s, p) => s + p.TOP - p.ALL, 0) / Math.max(1, dm.length)), EXBOT_ALL: r3(dm.reduce((s, p) => s + p.EXBOT - p.ALL, 0) / Math.max(1, dm.length)) }; })(),
    drawdownRisk: (() => { const v = pts.filter(p => p.ddIc != null); const s = nw(v.map(p => p.ddIc), 11), sp = nw(v.map(p => p.ddIcPersist), 11), sv = nw(v.map(p => p.ddIcVol), 11), spa = nw(v.map(p => p.ddIcPartial), 11); return s && { ic: r3(s.mean), tNW: r3(s.t), persistIc: r3(sp?.mean), volIc: r3(sv?.mean), volT: r3(sv?.t), afterVolIc: r3(spa?.mean), afterVolT: r3(spa?.t), medianMddTop20: r3(median(v.map(p => p.ddTop))), medianMddRest: r3(median(v.map(p => p.ddRest))), months: v.length }; })(),
  });
  out.markets[mkt] = { pick: block(pick), check: block(check), monthly: check.map(p => [p.ym, r3(p.ALL), r3(p.TOP), r3(p.EXBOT), r3(p.BOT), r3(p.PTOP), r3(p.idx)]) };
}
// 두 시장 평균(같은 달 둘 다 있을 때)
const byYm = new Map(); for (const mkt of ['KR', 'US']) for (const p of series[mkt]) { if (!byYm.has(p.ym)) byYm.set(p.ym, []); byYm.get(p.ym).push(p); }
const both = [...byYm.entries()].filter(([, a]) => a.length === 2).sort().map(([ym, a]) => ({ ym, ...Object.fromEntries(['ALL', 'TOP', 'EXBOT', 'BOT', 'PTOP'].map(k => [k, (a[0][k] + a[1][k]) / 2])) }));
for (const [name, pts] of [['pick', both.filter(p => p.ym < CHECK_START)], ['check', both.filter(p => p.ym >= CHECK_START)]])
  out.combined[name] = { months: pts.length, H1_TOP_ALL: excess(pts, 'TOP', 'ALL'), H2_EXBOT_ALL: excess(pts, 'EXBOT', 'ALL'), H3_TOP_PTOP: excess(pts, 'TOP', 'PTOP'), TOP_BOT: excess(pts, 'TOP', 'BOT') };
out.notes.push('표본 외 판단: 매년 1월, 그 전에 결과가 공개된 자료로만 다시 학습한 모델의 월말 판단.');
out.notes.push('생존 편향: 98개 기업은 지금 기준으로 고른 기업이라 전체 동일가중(ALL)의 절대 수익률은 부풀려져 있다. 상위·하위 비교만 해석한다.');
if (divWarn.length) out.notes.push(`배당이 주가의 15%를 넘는 ${divWarn.length}건은 자료 오류로 보고 뺐다: ${divWarn.slice(0, 5).join(', ')}`);
writeFileSync(join(root, 'data/growth-strategy.json'), JSON.stringify(out, null, 1));
const show = (t, x) => console.log(t, JSON.stringify(x));
for (const mkt of ['KR', 'US']) { const c = out.markets[mkt].check, p = out.markets[mkt].pick; console.log(`\n== ${mkt} 보고 ${c.span} / 설정 ${p.span}`); show(' perf', c.perf); show(' excess', c.excess); show(' pick excess', p.excess); show(' 2022', c.y2022); show(' down', c.downMonths); show(' ddRisk', c.drawdownRisk); show(' turnover', c.turnover); }
show('\ncombined', out.combined); if (divWarn.length) console.log('배당 제외', divWarn);
