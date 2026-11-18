// 여윳돈 하락 매수 규칙 시험(PREREG.md 에 미리 적은 규칙·판정 기준 그대로). 공개 일봉만 쓴다.
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
const map = rows => new Map(rows.map(r => [r.d, r]));
const lastBefore = (rows, d, strict = false) => { let lo = 0, hi = rows.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (strict ? rows[m].d < d : rows[m].d <= d) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? null : rows[k]; };

const spTR = await get('^SP500TR'), gspc = await get('^GSPC'), ndx = await get('^NDX'), ks = await get('^KS11'), vix = await get('^VIX'), vix3m = await get('^VIX3M'), irx = await get('^IRX'), fx = await get('KRW=X');
const sp = spTR && spTR.length > 5000 ? spTR : gspc;
// 시장 정의: rows(일봉) · fear(d) = 그날 결정에 쓸 수 있는 VIX · fear3m · cashRate(d)
const usFear = d => lastBefore(vix, d)?.c ?? null, usFear3m = d => lastBefore(vix3m, d)?.c ?? null;
const krFear = d => lastBefore(vix, d, true)?.c ?? null, krFear3m = d => lastBefore(vix3m, d, true)?.c ?? null; // 국내 장은 미국 전날 종가까지만 안다
const usCash = d => (lastBefore(irx, d)?.c ?? 3) / 100;
const spKrw = (() => { const g = gspc.filter(r => r.d >= '2004-01-02'); return g.map(r => { const f0 = lastBefore(fx, r.d)?.c; return f0 ? { d: r.d, o: r.o * f0, c: r.c * f0 } : null; }).filter(Boolean); })();
const MARKETS = [
  { id: 'SP500', name: `S&P500 ${sp === spTR ? '총수익' : '가격'}`, rows: sp.filter(r => r.d >= '1990-01-02'), fear: usFear, fear3m: usFear3m, cash: usCash },
  { id: 'NDX', name: '나스닥100(가격)', rows: ndx.filter(r => r.d >= '1990-01-02'), fear: usFear, fear3m: usFear3m, cash: usCash },
  { id: 'KOSPI', name: '코스피(가격)', rows: ks.filter(r => r.d >= '1997-01-02'), fear: krFear, fear3m: krFear3m, cash: () => 0.025 },
  { id: 'SPKRW', name: 'S&P500 원화(가격)', rows: spKrw, fear: usFear, fear3m: usFear3m, cash: () => 0.025, only: ['S0', 'S1', 'S2', 'S4', 'S5'] }
];
const COST = 0.001;

/** 한 규칙을 from~to 로 돌린다. 반환 {wealth, path, tranches} */
function run(mk, rule, from, to, refill) {
  const R = mk.rows.filter(r => r.d >= from && r.d < to); if (R.length < 50) return null;
  let ath = Math.max(...mk.rows.filter(r => r.d < from).map(r => r.c), R[0].c); // 그 전 최고점부터 이어서 본다
  const w0 = rule === 'S0' ? 1 : 0.8; let U = w0 / R[0].c, C = 1 - w0, T = (1 - w0) / 3;
  let flags = {}, n = 0, lastT = null, lastFill = null, pending = [], deployed = false, refillNext = false;
  const tranches = [], path = [];
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    // ① 시가 체결(전날 결정)
    if (pending.length) { for (const p of pending) { const amt = Math.min(p.amt, C); if (amt > 1e-12) { U += amt * (1 - COST) / r.o; C -= amt; tranches.push({ d: r.d, px: r.o, k: p.k, why: p.why, i }); lastFill = r.o; lastT = i; deployed = true; } } pending = []; }
    if (refillNext) { const tot = U * r.o + C, target = 0.2 * tot; if (C < target) { const sell = target - C; U -= sell / r.o; C += sell * (1 - COST); } T = target / 3; refillNext = false; }
    // ② 현금 이자(하루)
    C *= 1 + mk.cash(r.d) / 252;
    const prevAth = ath; ath = Math.max(ath, r.c); const dd = r.c / ath - 1, ret = i ? r.c / R[i - 1].c - 1 : 0;
    // ③ 새 최고점: 사이클 끝(표시 초기화 · 채우기)
    if (r.c >= prevAth && i > 0) { if (deployed && refill && rule !== 'S0' && rule !== 'S1') refillNext = true; flags = {}; n = 0; lastT = null; lastFill = null; deployed = false; }
    // ④ 오늘 종가로 결정 → 내일 시가
    if (rule !== 'S0' && rule !== 'S1' && C > 1e-9 && i + 1 < R.length) {
      const v = mk.fear(r.d), v3 = mk.fear3m(r.d), add = (k, why) => { if (!flags[k]) { flags[k] = true; n++; pending.push({ amt: T, k, why }); } };
      if (rule === 'S2') { for (const [k, th] of [[1, -0.1], [2, -0.2], [3, -0.3]]) if (dd <= th) add(k, `낙폭 ${Math.round(th * 100)}%`); }
      if (rule === 'S3' && v !== null) { for (const [k, th] of [[1, 30], [2, 40], [3, 50]]) if (v >= th) add(k, `VIX ${th}`); }
      const spaced = (gap, step) => n < 3 && (lastT === null || (i - lastT >= gap && r.c <= lastFill * (1 - step)));
      if (rule === 'S4' && n < 3) { if (n === 0 ? dd <= -0.1 && v !== null && v >= 30 : spaced(10, 0.10)) add(n + 1, n === 0 ? '낙폭 −10%·VIX 30' : '앞 매수보다 −10%·10일'); }
      if (rule === 'S5' && n < 3 && ret <= -0.03 && dd <= -0.1 && (n === 0 || spaced(10, 0.05))) add(n + 1, '−3% 급락일·낙폭 −10%');
      if (rule === 'S6' && n < 3 && v !== null && v3 !== null && v >= v3 && dd <= -0.1 && (n === 0 || spaced(10, 0.05))) add(n + 1, 'VIX≥VIX3M·낙폭 −10%');
    }
    path.push(U * r.c + C);
  }
  return { wealth: path.at(-1), path, tranches, R };
}
const cagr = (w, R) => Math.pow(w, 365.25 / ((Date.parse(R.at(-1).d) - Date.parse(R[0].d)) / 864e5)) - 1;
const mdd = p => { let pk = -Infinity, m = 0; for (const v of p) { pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return m; };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const RULES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const out = { market: {}, prereg: 'PREREG.md' };
for (const mk of MARKETS) {
  const rules = mk.only || RULES, first = mk.rows[0].d, last = mk.rows.at(-1).d;
  const res = { name: mk.name, from: first, to: last, whole: {}, rolling: {}, halves: {}, tranches: {} };
  for (const refill of [false, true]) {
    const tag = refill ? 'refill' : 'once';
    const base = {}; for (const ru of rules) { const s6from = ru === 'S6' ? '2006-08-01' : first; const x = run(mk, ru, s6from > first ? s6from : first, '9999', refill); if (!x) continue; base[ru] = x; }
    // S6 은 2006-08 부터라 같은 기간의 S1·S0 와 따로 비교
    const s1 = base.S1, s0 = base.S0;
    res.whole[tag] = Object.fromEntries(Object.entries(base).map(([ru, x]) => { const cmp = ru === 'S6' ? run(mk, 'S1', x.R[0].d, '9999', refill) : s1, cmp0 = ru === 'S6' ? run(mk, 'S0', x.R[0].d, '9999', refill) : s0; return [ru, { from: x.R[0].d, cagr: r2(cagr(x.wealth, x.R) * 100), mdd: r1(mdd(x.path) * 100), vsKeepPct: r1((x.wealth / cmp.wealth - 1) * 100), vsAllInPct: r1((x.wealth / cmp0.wealth - 1) * 100), cagrVsKeep: r2((cagr(x.wealth, x.R) - cagr(cmp.wealth, cmp.R)) * 100), tranches: x.tranches.length }]; }));
    // 10년 창(1월 시작)
    const y0 = +first.slice(0, 4) + (first.slice(5) > '01-15' ? 1 : 0), y1 = +last.slice(0, 4) - 10;
    res.rolling[tag] = {};
    for (const ru of rules.filter(r => r !== 'S0' && r !== 'S1')) {
      const ex = [], ex0 = []; for (let y = Math.max(y0, ru === 'S6' ? 2007 : y0); y <= y1; y++) { const a = run(mk, ru, `${y}-01-01`, `${y + 10}-01-01`, refill), b = run(mk, 'S1', `${y}-01-01`, `${y + 10}-01-01`, refill), c = run(mk, 'S0', `${y}-01-01`, `${y + 10}-01-01`, refill); if (!a || !b || !c) continue; ex.push(a.wealth / b.wealth - 1); ex0.push(a.wealth / c.wealth - 1); }
      const s = [...ex].sort((p, q) => p - q), s0x = [...ex0].sort((p, q) => p - q);
      res.rolling[tag][ru] = { windows: ex.length, beatKeepShare: r1(ex.filter(v => v > 0).length / Math.max(1, ex.length) * 100), medianVsKeepPct: r1((s[Math.floor(s.length / 2)] ?? NaN) * 100), worstVsKeepPct: r1((s[0] ?? NaN) * 100), medianVsAllInPct: r1((s0x[Math.floor(s0x.length / 2)] ?? NaN) * 100) };
    }
    // 반으로 나눈 두 기간
    const mid = mk.rows[Math.floor(mk.rows.length / 2)].d; res.halves[tag] = {};
    for (const ru of rules.filter(r => r !== 'S0' && r !== 'S1')) { const h = []; for (const [a, b] of [[first, mid], [mid, '9999']]) { const st = ru === 'S6' && a < '2006-08-01' ? '2006-08-01' : a; if (st >= b) { h.push(null); continue; } const x = run(mk, ru, st, b, refill), k = run(mk, 'S1', st, b, refill); h.push(x && k ? r1((x.wealth / k.wealth - 1) * 100) : null); } res.halves[tag][ru] = { split: mid, firstHalfVsKeepPct: h[0], secondHalfVsKeepPct: h[1] }; }
    // 매수 기록(한 번만 · 전체 기간)
    if (!refill) for (const ru of rules.filter(r => r !== 'S0' && r !== 'S1')) {
      const x = base[ru]; if (!x) continue; const R = x.R;
      res.tranches[ru] = x.tranches.map(t => { const k12 = R.findIndex(r => r.d >= new Date(Date.parse(t.d) + 365 * 864e5).toISOString().slice(0, 10)); let low = Infinity; for (let j = t.i; j < R.length; j++) { low = Math.min(low, R[j].c); if (R[j].c >= Math.max(...R.slice(0, t.i + 1).map(z => z.c))) break; } return { d: t.d, k: t.k, why: t.why, fwd12: k12 > 0 ? r1((R[k12].c / t.px - 1) * 100) : null, fellMorePct: r1((low / t.px - 1) * 100) }; });
    }
  }
  out.market[mk.id] = res;
}
writeFileSync(join(HERE, 'dip-reserve.json'), JSON.stringify(out, null, 1));
for (const [id, m] of Object.entries(out.market)) {
  console.log(`\n=== ${m.name} ${m.from}~${m.to}`);
  for (const tag of ['once', 'refill']) {
    console.log(` [${tag === 'once' ? '한 번 쓰고 끝' : '최고점 회복 때 다시 채움'}]`);
    for (const [ru, w] of Object.entries(m.whole[tag])) { const ro = m.rolling[tag][ru], h = m.halves[tag][ru]; console.log(`  ${ru} CAGR ${w.cagr}% MDD ${w.mdd}% · 여윳돈 그대로 대비 ${w.vsKeepPct}% (연 ${w.cagrVsKeep}%p) · 전부 투자 대비 ${w.vsAllInPct}% · 매수 ${w.tranches}회${ro ? ` | 10년창 ${ro.windows}개 중 이김 ${ro.beatKeepShare}% · 중앙 ${ro.medianVsKeepPct}% · 최악 ${ro.worstVsKeepPct}% · 전부투자 대비 중앙 ${ro.medianVsAllInPct}%` : ''}${h ? ` | 반기 ${h.firstHalfVsKeepPct} / ${h.secondHalfVsKeepPct}` : ''}`); }
  }
}
