// 결정 B 시험: 핵심 지수의 200일선 규칙 × 공포 사다리(S3) 조합. PREREG-B.md 를 먼저 적었다. 공개 일봉만(dip-reserve.mjs 와 같은 캐시).
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), CACHE = join(HERE, 'cache'); mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(sym) {
  const f = join(CACHE, sym.replace(/[^A-Za-z0-9]/g, '_') + '.json'); if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=473385600&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) })).json(); await sleep(300);
  const x = j.chart.result?.[0]; if (!x) return null;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: x.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }), q = x.indicators.quote[0];
  const rows = x.timestamp.map((t, i) => ({ d: fmt.format(new Date(t * 1000)), o: q.open[i], c: q.close[i] })).filter(r => r.c > 0).map(r => ({ ...r, o: r.o > 0 ? r.o : r.c }));
  const seen = new Set(), out = rows.filter(r => !seen.has(r.d) && seen.add(r.d));
  writeFileSync(f, JSON.stringify(out)); return out;
}
const lastBefore = (rows, d, strict = false) => { let lo = 0, hi = rows.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (strict ? rows[m].d < d : rows[m].d <= d) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? null : rows[k]; };

const spTR = await get('^SP500TR'), gspc = await get('^GSPC'), ndx = await get('^NDX'), ks = await get('^KS11'), vix = await get('^VIX'), irx = await get('^IRX'), fx = await get('KRW=X');
const sp = spTR && spTR.length > 5000 ? spTR : gspc;
const usFear = d => lastBefore(vix, d)?.c ?? null, krFear = d => lastBefore(vix, d, true)?.c ?? null, usCash = d => (lastBefore(irx, d)?.c ?? 3) / 100;
const spKrw = (() => { const g = gspc.filter(r => r.d >= '2003-01-02'); return g.map(r => { const f0 = lastBefore(fx, r.d)?.c; return f0 ? { d: r.d, o: r.o * f0, c: r.c * f0 } : null; }).filter(Boolean); })();
const MARKETS = [
  { id: 'SP500', name: `S&P500 ${sp === spTR ? '총수익' : '가격'}`, rows: sp, from: '1990-01-02', fear: usFear, cash: usCash },
  { id: 'NDX', name: '나스닥100(가격)', rows: ndx, from: '1990-01-02', fear: usFear, cash: usCash },
  { id: 'KOSPI', name: '코스피(가격)', rows: ks, from: '1997-01-02', fear: krFear, cash: () => 0.025 },
  { id: 'SPKRW', name: 'S&P500 원화(가격)', rows: spKrw, from: '2004-01-02', fear: usFear, cash: () => 0.025 }
];
const COST = 0.001, W0 = 0.8, T = 0.2 / 3;
const VARIANTS = { V0: { trend: false, fear: true, override: false, low: 0 }, V1: { trend: true, fear: false, override: false, low: 0 }, V3: { trend: true, fear: true, override: true, low: 0 }, V5: { trend: true, fear: false, override: false, low: 0.4 }, V6: { trend: true, fear: true, override: true, low: 0.4 } };

/** 한 변형을 from~to 로 돌린다. 반환 {wealth, path, trades, R} */
function run(mk, vid, from, to) {
  const V = VARIANTS[vid], all = mk.rows, i0 = all.findIndex(r => r.d >= from); if (i0 < 0) return null;
  const R = []; for (let j = i0; j < all.length && all[j].d < to; j++) R.push(all[j]); if (R.length < 250) return null;
  const ma = i => { const j = i0 + i; if (j < 199) return null; let s = 0; for (let k = j - 199; k <= j; k++) s += all[k].c; return s / 200; };
  let ath = R[0].c; for (let k = 0; k < i0; k++) if (all[k].c > ath) ath = all[k].c;
  let U = W0 / R[0].c, C = 1 - W0, flags = {}, n = 0, deployed = false, trendUp = null, pending = [], trades = 0;
  const path = [];
  const toFrac = frac => ({ type: 'to', frac });
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    // ① 시가 체결(전날 결정)
    for (const p of pending) {
      if (p.type === 'buy') { const amt = Math.min(p.amt, C); if (amt > 1e-12) { U += amt * (1 - COST) / r.o; C -= amt; trades++; } }
      else { const W = U * r.o + C, target = p.frac * W, cur = U * r.o; if (cur > target + 1e-9) { const sell = cur - target; U -= sell / r.o; C += sell * (1 - COST); trades++; } else if (target > cur + 1e-9) { const buy = Math.min(target - cur, C); if (buy > 1e-12) { U += buy * (1 - COST) / r.o; C -= buy; trades++; } } }
    }
    pending = [];
    // ② 현금 이자
    C *= 1 + mk.cash(r.d) / 252;
    const prevAth = ath; if (r.c > ath) ath = r.c;
    const m = ma(i), below = m !== null && r.c < m, last = i + 1 >= R.length;
    // ③ 새 최고점: 사이클 끝 — 되채움(80/20) · 표시 초기화
    if (i > 0 && r.c >= prevAth) { if (deployed && !last) pending.push(toFrac(W0)); flags = {}; n = 0; deployed = false; }
    if (last) { path.push(U * r.c + C); break; }
    // ④ 공포 사다리(오늘 종가의 VIX → 내일 시가)
    if (V.fear && !(i > 0 && r.c >= prevAth)) { const v = mk.fear(r.d); if (v !== null) for (const [k, th] of [[1, 30], [2, 40], [3, 50]]) if (v >= th && !flags[k]) { flags[k] = true; n++; deployed = true; if (V.override && V.trend && below && trendUp === false) pending.push(toFrac(W0 + T * n)); else pending.push({ type: 'buy', amt: T }); } }
    // ⑤ 추세 규칙(상태가 바뀔 때만 매매 · 공포 단계가 켜진 동안은 무시(override))
    if (V.trend && m !== null) {
      const up = !below;
      if (trendUp === null) { trendUp = up; if (!up) pending.push(toFrac(V.low)); }
      else if (up !== trendUp) { trendUp = up; if (!(V.override && n > 0)) pending.push(toFrac(up ? W0 + T * n : V.low + T * n)); }
    }
    path.push(U * r.c + C);
  }
  return { wealth: path.at(-1), path, trades, R };
}
const cagr = (w, R) => Math.pow(w, 365.25 / ((Date.parse(R.at(-1).d) - Date.parse(R[0].d)) / 864e5)) - 1;
const mdd = p => { let pk = -Infinity, m = 0; for (const v of p) { pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return m; };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const out = { prereg: 'PREREG-B.md', market: {} };
for (const mk of MARKETS) {
  const first = mk.from, last = mk.rows.at(-1).d, res = { name: mk.name, from: first, to: last, whole: {}, rolling: {}, halves: {} };
  const base = {}; for (const v of Object.keys(VARIANTS)) base[v] = run(mk, v, first, '9999');
  for (const [v, x] of Object.entries(base)) res.whole[v] = { cagr: r2(cagr(x.wealth, x.R) * 100), mdd: r1(mdd(x.path) * 100), trades: x.trades, vsV0Pct: r1((x.wealth / base.V0.wealth - 1) * 100), cagrVsV0: r2((cagr(x.wealth, x.R) - cagr(base.V0.wealth, base.V0.R)) * 100) };
  const y0 = +first.slice(0, 4) + (first.slice(5) > '01-15' ? 1 : 0), y1 = +last.slice(0, 4) - 10;
  for (const v of Object.keys(VARIANTS).filter(k => k !== 'V0')) {
    const ex = []; for (let y = y0; y <= y1; y++) { const a = run(mk, v, `${y}-01-01`, `${y + 10}-01-01`), b = run(mk, 'V0', `${y}-01-01`, `${y + 10}-01-01`); if (a && b) ex.push(a.wealth / b.wealth - 1); }
    const s = [...ex].sort((p, q) => p - q);
    res.rolling[v] = { windows: ex.length, beatV0Share: r1(ex.filter(z => z > 0).length / Math.max(1, ex.length) * 100), medianVsV0Pct: r1((s[Math.floor(s.length / 2)] ?? NaN) * 100), worstVsV0Pct: r1((s[0] ?? NaN) * 100), bestVsV0Pct: r1((s.at(-1) ?? NaN) * 100) };
    const mid = mk.rows[Math.floor((mk.rows.findIndex(r => r.d >= first) + mk.rows.length) / 2)].d, h = [];
    for (const [a, b] of [[first, mid], [mid, '9999']]) { const x = run(mk, v, a, b), k = run(mk, 'V0', a, b); h.push(x && k ? r1((x.wealth / k.wealth - 1) * 100) : null); }
    res.halves[v] = { split: mid, firstHalfVsV0Pct: h[0], secondHalfVsV0Pct: h[1] };
  }
  out.market[mk.id] = res;
}
// 판정(PREREG-B): 모든 시장에서 10년 창 ≥70% · 두 반기 모두 이김 · 전체 CAGR 이 V0 보다 2%p 넘게 뒤지지 않음
out.verdict = {};
for (const v of Object.keys(VARIANTS).filter(k => k !== 'V0')) {
  const fails = [];
  for (const [id, m] of Object.entries(out.market)) { const ro = m.rolling[v], h = m.halves[v], w = m.whole[v]; if (!(ro.beatV0Share >= 70)) fails.push(`${id} 10년창 ${ro.beatV0Share}%`); if (!(h.firstHalfVsV0Pct > 0 && h.secondHalfVsV0Pct > 0)) fails.push(`${id} 반기 ${h.firstHalfVsV0Pct}/${h.secondHalfVsV0Pct}`); if (!(w.cagrVsV0 >= -2)) fails.push(`${id} CAGR ${w.cagrVsV0}%p`); }
  out.verdict[v] = { pass: fails.length === 0, fails };
}
writeFileSync(join(HERE, 'trend-fear.json'), JSON.stringify(out, null, 1));
for (const [id, m] of Object.entries(out.market)) {
  console.log(`\n=== ${m.name} ${m.from}~${m.to}`);
  for (const [v, w] of Object.entries(m.whole)) { const ro = m.rolling[v], h = m.halves[v]; console.log(`  ${v} CAGR ${w.cagr}% MDD ${w.mdd}% 매매 ${w.trades}회 · V0 대비 ${w.vsV0Pct}% (연 ${w.cagrVsV0}%p)${ro ? ` | 10년창 ${ro.windows}개 중 이김 ${ro.beatV0Share}% · 중앙 ${ro.medianVsV0Pct}% · 최악 ${ro.worstVsV0Pct}% · 최고 ${ro.bestVsV0Pct}%` : ''}${h ? ` | 반기 ${h.firstHalfVsV0Pct} / ${h.secondHalfVsV0Pct}` : ''}`); }
}
console.log('\n판정:', JSON.stringify(out.verdict));
