// 핵심 기능 검증: 화면의 '오늘 점검'과 같은 엔진(core-rules.evaluate, core-risk)을 2012년부터 날마다 그대로 돌려
// ① 규칙대로 했을 때 vs 그냥 보유 ② 계좌 하루 손실 범위(95%·99%)가 실제로 맞았는지 ③ 규칙끼리 부딪히는지(매매 횟수)를 잰다.
// 규칙 변형은 2012~2019로 고르고 2020~2026으로 확인한다. 공개 일봉만 사용. 사용: node scripts/validate-core.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, DEFAULT_RULES, RULES_VERSION } from '../lib/core-rules.js';
import { krwReturns, riskPath, riskGrid, portfolioRiskAt, CORE_RISK_VERSION } from '../lib/core-risk.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=946684800&period2=9999999999&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
const FROM = '2012-01-02', SPLIT = '2020-01-01', COST = 0.002, CAPITAL = 100_000_000;
const PORTFOLIOS = [
  { id: 'demo', label: '예시 자산과 같은 6종목', items: [['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['069500.KS', 'KODEX 200'], ['NVDA', '엔비디아'], ['KO', '코카콜라'], ['035420.KS', 'NAVER']] },
  { id: 'kr', label: '국내 대형주 5종목', items: [['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['005380.KS', '현대차'], ['035420.KS', 'NAVER'], ['105560.KS', 'KB금융']] },
  { id: 'us', label: '미국 기술주 5종목', items: [['AAPL', '애플'], ['MSFT', '마이크로소프트'], ['NVDA', '엔비디아'], ['AMZN', '아마존'], ['GOOGL', '알파벳']] },
  { id: 'etf', label: '지수·채권 ETF 4종', items: [['SPY', 'S&P500 ETF'], ['QQQ', '나스닥100 ETF'], ['TLT', '미국 장기채 ETF'], ['069500.KS', 'KODEX 200']] }
];
const VARIANTS = [
  { id: 'A', label: '종목별 변동성 15% · 하루 손실 3% · 매일', rules: { perAssetVol: true, dailyLoss: 3 }, weekly: false, band: 0.05 },
  { id: 'B', label: '계좌 하루 손실 1.5% · 주 1회', rules: { perAssetVol: false, dailyLoss: 1.5 }, weekly: true, band: 0.10 },
  { id: 'C', label: '계좌 하루 손실 2.5% · 주 1회', rules: { perAssetVol: false, dailyLoss: 2.5 }, weekly: true, band: 0.10 },
  { id: 'D', label: 'B에서 200일선 규칙 끔', rules: { perAssetVol: false, dailyLoss: 1.5, trendUS: false }, weekly: true, band: 0.10 },
  { id: 'E', label: 'B를 매일 점검', rules: { perAssetVol: false, dailyLoss: 1.5 }, weekly: false, band: 0.05 }
];
const CRISES = [['코로나 급락', '2020-02-19', '2020-03-23'], ['2022 하락장', '2022-01-03', '2022-10-14'], ['2026 하반기', '2026-06-01', '2026-12-31']];
const cache = {}; const get = async s => (cache[s] ||= await history(s));
const fx = await get('KRW=X');

function metrics(dates, path) {
  const years = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / (365.25 * 864e5), r = path.slice(1).map((v, k) => v / path[k] - 1);
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  let peak = -Infinity, mdd = 0; for (const v of path) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  let worst12 = 0; for (let k = 252; k < path.length; k++) worst12 = Math.min(worst12, path[k] / path[k - 252] - 1);
  const crisis = {};
  for (const [name, a, b] of CRISES) { const idx = dates.map((d, k) => [d, k]).filter(([d]) => d >= a && d <= b).map(([, k]) => k); if (idx.length < 5) continue; const s = path.slice(idx[0], idx.at(-1) + 1); let pk = -Infinity, dd = 0; for (const v of s) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); } crisis[name] = { ret: +(s.at(-1) / s[0] * 100 - 100).toFixed(1), mdd: +(dd * 100).toFixed(1) }; }
  return { cagr: +((path.at(-1) / path[0]) ** (1 / years) * 100 - 100).toFixed(2), vol: +(sd * Math.sqrt(252) * 100).toFixed(1), sharpe: +(m / sd * Math.sqrt(252)).toFixed(2), mdd: +(mdd * 100).toFixed(1), worst12: +(worst12 * 100).toFixed(1), crisis };
}
function slice(dates, path, a, b) { const idx = dates.map((d, k) => [d, k]).filter(([d]) => d >= a && d <= b).map(([, k]) => k); return metrics(idx.map(k => dates[k]), idx.map(k => path[k])); }
function kupiec(x, n, p) { const ph = x / n, ll0 = (n - x) * Math.log(1 - p) + x * Math.log(p), ll1 = (n - x) * Math.log(Math.max(1e-12, 1 - ph)) + (x ? x * Math.log(ph) : 0), lr = -2 * (ll0 - ll1); return { rate: +(ph * 100).toFixed(2), n, lr: +lr.toFixed(2), pass: lr < 3.84 }; }
const weekOf = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

function simulate(ctx, V) {
  const { syms, info, grid, paths, above, ret } = ctx, RULES = { ...DEFAULT_RULES, ...V.rules };
  const last = Object.fromEntries(syms.map(s => [s, { vol: null, above: null }]));
  const k0 = grid.dates.findIndex(d => d >= FROM), plan = Object.fromEntries(syms.map(s => [s, Math.min(RULES.maxSingle, 90 / syms.length)]));
  const init = Object.fromEntries(syms.map(s => [s, CAPITAL * plan[s] / 100])), cash0 = CAPITAL - Object.values(init).reduce((a, b) => a + b, 0);
  const hold = { ...init }, rule = { ...init }; let cash = cash0;
  const trades = [], dates = [], pathHold = [], pathRule = [], vb = { hold: [0, 0, 0], rule: [0, 0, 0] }, big = { hold: 0, rule: 0 };
  let prevVar = null, actionDays = 0;
  for (let k = k0; k < grid.dates.length; k++) {
    const d = grid.dates[k];
    const pnlH = syms.reduce((a, s) => a + hold[s] * (ret[s].get(d) || 0), 0), pnlR = syms.reduce((a, s) => a + rule[s] * (ret[s].get(d) || 0), 0);
    const totH0 = cash0 + syms.reduce((a, s) => a + hold[s], 0), totR0 = cash + syms.reduce((a, s) => a + rule[s], 0);
    if (prevVar) for (const [key, pnl] of [['hold', pnlH], ['rule', pnlR]]) { vb[key][2]++; if (-pnl > prevVar[key].var95) vb[key][0]++; if (-pnl > prevVar[key].var99) vb[key][1]++; }
    if (-pnlH > totH0 * RULES.dailyLoss / 100) big.hold++; if (-pnlR > totR0 * RULES.dailyLoss / 100) big.rule++;
    for (const s of syms) { const r = ret[s].get(d) || 0; hold[s] *= 1 + r; rule[s] *= 1 + r; }
    const risk = {};
    for (const s of syms) { const p = paths[s].get(d); if (p) last[s].vol = p.vol; const a = above[s].get(d); if (a !== undefined) last[s].above = a; risk[s] = last[s].vol ? { ok: true, vol: last[s].vol, trendApplies: info[s].market === 'US' && last[s].above !== null, above200: last[s].above } : { ok: false }; }
    const since = trades.filter(t => Date.parse(d) - Date.parse(t) < 30 * 864e5).length;
    const e = evaluate({ positions: syms.map(s => ({ symbol: s, name: info[s].name, currency: info[s].currency, valueKrw: rule[s] })), cashKrw: cash, rules: RULES, plan, risk, portVar: h => portfolioRiskAt(grid, h, k), trades30: since, band: V.band });
    const weekEnd = k === grid.dates.length - 1 || weekOf(grid.dates[k + 1]) !== weekOf(d), act = !V.weekly || weekEnd || e.urgent;
    if (act && e.actions.length) actionDays++;
    for (const a of act ? e.actions : []) {
      if (a.kind === 'reduce') { const amt = Math.min(a.amountKrw, rule[a.symbol]); rule[a.symbol] -= amt; cash += amt * (1 - COST); }
      else { const amt = Math.min(a.amountKrw, Math.max(0, cash)); rule[a.symbol] += amt; cash -= amt * (1 + COST); }
      trades.push(d);
    }
    prevVar = { hold: portfolioRiskAt(grid, syms.map(s => ({ symbol: s, valueKrw: hold[s] })), k), rule: portfolioRiskAt(grid, syms.map(s => ({ symbol: s, valueKrw: rule[s] })), k) };
    dates.push(d); pathHold.push(cash0 + syms.reduce((a, s) => a + hold[s], 0)); pathRule.push(cash + syms.reduce((a, s) => a + rule[s], 0));
  }
  const years = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / (365.25 * 864e5);
  let over = 0, windows = 0; for (let k = 0; k < dates.length; k += 5) { windows++; const n = trades.filter(t => t <= dates[k] && Date.parse(dates[k]) - Date.parse(t) < 30 * 864e5).length; if (n > RULES.maxTrades30) over++; }
  const avgInvested = pathRule.length ? 1 - cash / pathRule.at(-1) : null;
  return {
    dates, pathHold, pathRule,
    result: { label: V.label, rules: RULES, weekly: V.weekly, band: V.band,
      all: metrics(dates, pathRule), pick: slice(dates, pathRule, FROM, '2019-12-31'), check: slice(dates, pathRule, SPLIT, '2099-12-31'),
      var: { hold95: kupiec(vb.hold[0], vb.hold[2], 0.05), hold99: kupiec(vb.hold[1], vb.hold[2], 0.01), rule95: kupiec(vb.rule[0], vb.rule[2], 0.05), rule99: kupiec(vb.rule[1], vb.rule[2], 0.01) },
      dailyLossBreach: { hold: +(big.hold / dates.length * 100).toFixed(2), rule: +(big.rule / dates.length * 100).toFixed(2) },
      trading: { tradesPerYear: +(trades.length / years).toFixed(1), actionDaysPerMonth: +(actionDays / years / 12).toFixed(1), over30DayLimitShare: +(over / windows * 100).toFixed(1) },
      endInvested: +(avgInvested * 100).toFixed(1) }
  };
}

// 기본값(core-rules.DEFAULT_RULES, 주 1회, 띠 10%)은 C. 선택 기준(2012~2019): 30일 매매 상한 초과 5% 이하, 최대 손실이 보유보다 확실히 작음, 평균 샤프가 보유 이상.
const out = { default: 'C', selection: '2012~2019: 30일 매매 상한 초과 ≤5%, 최대 손실 < 보유, 평균 샤프 ≥ 보유 → C. 2020~2026은 확인용.', version: RULES_VERSION, riskVersion: CORE_RISK_VERSION, generatedAt: new Date().toISOString(), from: FROM, split: SPLIT, cost: COST, variants: VARIANTS.map(({ id, label, rules, weekly, band }) => ({ id, label, rules, weekly, band })), portfolios: {} };
const f = m => `샤프 ${m.sharpe} 최대손실 ${m.mdd}% 연 ${m.cagr}%`;
for (const P of PORTFOLIOS) {
  const syms = P.items.map(([s]) => s), info = Object.fromEntries(P.items.map(([s, name]) => [s, { name, market: /\.(KS|KQ)$/.test(s) ? 'KR' : 'US', currency: /\.(KS|KQ)$/.test(s) ? 'KRW' : 'USD' }]));
  const candles = {}; for (const s of syms) { candles[s] = await get(s); await sleep(100); }
  const series = Object.fromEntries(syms.map(s => [s, krwReturns(candles[s], info[s].currency, fx)])), grid = riskGrid(series);
  const paths = Object.fromEntries(syms.map(s => [s, riskPath(candles[s], { market: info[s].market, from: '2011-06-01' })]));
  const above = Object.fromEntries(syms.map(s => { const c = candles[s], m = new Map(); let sum = 0; c.forEach((x, k) => { sum += x.close; if (k >= 200) sum -= c[k - 200].close; if (k >= 199) m.set(x.date, x.close > sum / 200); }); return [s, m]; }));
  const ret = Object.fromEntries(syms.map(s => [s, new Map(series[s].map(x => [x.date, x.r]))]));
  const ctx = { syms, info, grid, paths, above, ret }, o = (out.portfolios[P.id] = { label: P.label, items: P.items, variants: {} });
  for (const V of VARIANTS) {
    const sim = simulate(ctx, V); o.variants[V.id] = sim.result;
    if (!o.hold) { o.from = sim.dates[0]; o.to = sim.dates.at(-1); o.hold = { all: metrics(sim.dates, sim.pathHold), pick: slice(sim.dates, sim.pathHold, FROM, '2019-12-31'), check: slice(sim.dates, sim.pathHold, SPLIT, '2099-12-31') }; console.log(`\n${P.label} ${o.from}~${o.to}\n  보유: 고르기 ${f(o.hold.pick)} | 확인 ${f(o.hold.check)}`); }
    const v = sim.result; console.log(`  ${V.id} ${V.label}: 고르기 ${f(v.pick)} | 확인 ${f(v.check)} | VaR95 ${v.var.rule95.rate}% 99 ${v.var.rule99.rate}% | 매매/년 ${v.trading.tradesPerYear} 상한초과 ${v.trading.over30DayLimitShare}%`);
  }
}
writeFileSync(resolve(root, 'data/core-validation.json'), JSON.stringify(out));
