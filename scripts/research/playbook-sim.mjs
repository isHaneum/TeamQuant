// 세부 전략(플레이북) 모의 운용: 54개 대형주에서 무작위로 뽑은 6종목 포트폴리오 120개로, 2016-01부터
// 처음 1,000만원 + 매달 50만원을 넣으며 정책별 결과를 비교한다(사후에 고른 승자 종목 효과를 피하려고 무작위).
// 정책은 같은 날 같은 자료만 본다. 계좌 위험 한도는 앱의 오늘 점검과 같은 엔진(core-rules.evaluate + core-risk)을 쓴다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, DEFAULT_RULES } from '../../lib/core-rules.js';
import { riskGrid, portfolioRiskAt } from '../../lib/core-risk.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const D = JSON.parse(readFileSync(join(root, '.research/factor-data.json'), 'utf8'));
const START = '2016-01-04', SPLIT = '2021-01-01', COST = 0.002, INIT = 10_000_000, MONTHLY = 500_000, N_PORT = 120, N_HOLD = 6;
const bs = (dates, d) => { let lo = 0, hi = dates.length - 1, f = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { f = m; lo = m + 1; } else hi = m - 1; } return f; };
const fx = D.macro['KRW=X'], fxDates = fx.map(x => x[0]), fxClose = fx.map(x => x[1]);
const stocks = [];
for (const [k, s] of Object.entries(D.kr)) if (s.prices?.[0]?.[0] <= '2015-06-01') stocks.push({ sym: k, name: s.name, usd: false, dates: s.prices.map(x => x[0]), close: s.prices.map(x => x[1]) });
for (const [k, s] of Object.entries(D.us)) if (s.prices?.[0]?.[0] <= '2015-06-01') stocks.push({ sym: k, name: s.name, usd: true, dates: s.prices.map(x => x[0]), close: s.prices.map(x => x[1]) });
// 원화 가격(미국은 그날 환율)
for (const s of stocks) s.krw = s.close.map((c, i) => s.usd ? c * fxClose[Math.max(0, bs(fxDates, s.dates[i]))] : c);
const series = Object.fromEntries(stocks.map(s => [s.sym, s.krw.slice(1).map((v, i) => ({ date: s.dates[i + 1], r: v / s.krw[i] - 1 }))]));
const grid = riskGrid(series), dates = grid.dates.filter(d => d >= START);
const priceAt = (s, d) => { const i = bs(s.dates, d); return i < 0 ? null : s.krw[i]; };
const high63 = (s, d) => { const i = bs(s.dates, d); return i < 63 ? null : Math.max(...s.krw.slice(i - 63, i + 1)); };
const weekOf = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ports = Array.from({ length: N_PORT }, () => { const pick = new Set(); while (pick.size < N_HOLD) pick.add(stocks[Math.floor(rnd() * stocks.length)]); return [...pick]; });

const POLICIES = {
  P0: { label: '단순 적립: 매달 균등, 팔지 않음' },
  P1: { label: '새 돈은 비중이 모자란 종목부터', fill: true },
  P2: { label: 'P1 + 한 종목 25% 넘는 만큼만 덜기', fill: true, trim: true },
  P3: { label: 'P2 + 하락 분할 매수(예비 현금 10%, −20%·−30%)', fill: true, trim: true, dip: true },
  P4: { label: 'P2 + 계좌 하루 손실 한도 2.5%(주 1회)', fill: true, trim: true, risk: true },
  P5: { label: 'P3 + P4 (전체 플레이북)', fill: true, trim: true, dip: true, risk: true }
};
function run(port, P) {
  const hold = Object.fromEntries(port.map(s => [s.sym, 0])); let cash = 0, reserve = 0, trades = 0, lastDip = {};
  const buy = (s, amt, d) => { const p = priceAt(s, d); if (!p || amt < 1000) return; hold[s.sym] += amt * (1 - COST) / p; trades++; };
  const sell = (s, amt, d) => { const p = priceAt(s, d); if (!p || amt < 1000) return 0; const q = Math.min(hold[s.sym], amt / p); hold[s.sym] -= q; trades++; return q * p * (1 - COST); };
  const value = d => port.reduce((a, s) => a + hold[s.sym] * (priceAt(s, d) || 0), 0);
  const path = [], flows = []; let prevMonth = '';
  for (let k = 0; k < dates.length; k++) {
    const d = dates[k], month = d.slice(0, 7);
    let flow = 0;
    if (month !== prevMonth) { // 새 돈 투입(첫날은 처음 금액)
      const add = prevMonth === '' ? INIT : MONTHLY; flow = add; prevMonth = month;
      let toInvest = add; if (P.dip) { const keep = add * 0.1; reserve += keep; toInvest -= keep; }
      if (P.risk && k > 0 && cash > 0) { toInvest += 0; } // 위험 모드 현금은 아래 점검이 다시 넣는다
      if (!P.fill) for (const s of port) buy(s, toInvest / port.length, d);
      else { // 목표(균등) 대비 모자란 만큼 순서대로 채운다
        const tot = value(d) + toInvest, target = tot * (P.dip ? 0.9 : 1) / port.length;
        let left = toInvest; const gaps = port.map(s => [s, Math.max(0, target - hold[s.sym] * (priceAt(s, d) || 0))]).sort((a, b) => b[1] - a[1]);
        const gapSum = gaps.reduce((a, g) => a + g[1], 0);
        for (const [s, g] of gaps) { const amt = gapSum > 0 ? left * g / gapSum : left / port.length; buy(s, amt, d); }
      }
    }
    if (P.trim && month !== (dates[k - 1] || '').slice(0, 7)) { // 매달 첫날: 25% 넘는 만큼만 덜어 모자란 종목으로
      const tot = value(d) + cash + reserve; let freed = 0;
      for (const s of port) { const v = hold[s.sym] * (priceAt(s, d) || 0); if (v > tot * 0.25 * 1.1) freed += sell(s, v - tot * 0.25, d); }
      if (freed > 0) { const under = port.filter(s => hold[s.sym] * (priceAt(s, d) || 0) < tot * 0.25); for (const s of under) buy(s, freed / under.length, d); }
    }
    if (P.dip && reserve > 0) for (const s of port) { // 3개월 고점 대비 −20%·−30%에서 예비 현금 1/3씩(종목당 20거래일에 한 번)
      const p = priceAt(s, d), h = high63(s, d); if (!p || !h || (lastDip[s.sym] !== undefined && k - lastDip[s.sym] < 20)) continue;
      const dd = p / h - 1; if (dd <= -0.2) { const amt = reserve / 3; buy(s, amt, d); reserve -= amt; lastDip[s.sym] = k; }
    }
    if (P.risk) { // 주 1회(급하면 바로) 앱의 오늘 점검과 같은 엔진으로 계좌 위험 한도 적용
      const weekEnd = k === dates.length - 1 || weekOf(dates[k + 1]) !== weekOf(d), gk = bs(grid.dates, d);
      const positions = port.map(s => ({ symbol: s.sym, name: s.name, currency: s.usd ? 'USD' : 'KRW', valueKrw: hold[s.sym] * (priceAt(s, d) || 0) }));
      const tot = positions.reduce((a, x) => a + x.valueKrw, 0) + cash + reserve;
      const plan = Object.fromEntries(port.map(s => [s.sym, Math.min(25, (P.dip ? 90 : 100) / port.length)]));
      const risk = Object.fromEntries(port.map(s => [s.sym, { ok: true, vol: 0.3, trendApplies: false }]));
      const e = evaluate({ positions, cashKrw: cash + reserve, rules: { ...DEFAULT_RULES, minCash: 0, trendUS: false }, plan, risk, portVar: h => portfolioRiskAt(grid, h, gk), trades30: 0 });
      if (weekEnd || e.urgent) for (const a of e.actions) { const s = port.find(x => x.sym === a.symbol); if (a.kind === 'reduce') cash += sell(s, a.amountKrw, d); else { const amt = Math.min(a.amountKrw, cash); if (amt > 0) { buy(s, amt, d); cash -= amt; } } }
    }
    path.push(value(d) + cash + reserve); flows.push(flow);
  }
  return { path, flows, trades };
}
function metrics(path, flows, from, to) {
  const idx = dates.map((d, k) => [d, k]).filter(([d]) => d >= from && d <= to).map(([, k]) => k);
  let twr = 1, peak = 1, mdd = 0; const rets = [];
  for (let j = 1; j < idx.length; j++) { const k = idx[j], prev = path[k - 1]; if (prev <= 0) continue; const r = (path[k] - flows[k]) / prev - 1; twr *= 1 + r; rets.push(r); peak = Math.max(peak, twr); mdd = Math.min(mdd, twr / peak - 1); }
  const years = (Date.parse(dates[idx.at(-1)]) - Date.parse(dates[idx[0]])) / (365.25 * 864e5), m = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  return { cagr: twr ** (1 / years) - 1, mdd, sharpe: m / sd * Math.sqrt(252) };
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const res = {};
const runs = Object.fromEntries(Object.keys(POLICIES).map(id => [id, ports.map(p => run(p, POLICIES[id]))]));
const invested = dates.map((d, k) => runs.P0[0].flows.slice(0, k + 1).reduce((a, b) => a + b, 0));
for (const [id, P] of Object.entries(POLICIES)) {
  const out = { label: P.label };
  for (const [name, from, to] of [['pick', START, '2020-12-31'], ['check', SPLIT, '2099'], ['all', START, '2099']]) {
    const ms = runs[id].map(r => metrics(r.path, r.flows, from, to)), base = runs.P0.map(r => metrics(r.path, r.flows, from, to));
    out[name] = { cagrMed: +(q(ms.map(m => m.cagr), 0.5) * 100).toFixed(1), mddMed: +(q(ms.map(m => m.mdd), 0.5) * 100).toFixed(1), mddWorst10: +(q(ms.map(m => m.mdd), 0.1) * 100).toFixed(1), sharpeMed: +q(ms.map(m => m.sharpe), 0.5).toFixed(2), beatsP0Sharpe: Math.round(ms.filter((m, i) => m.sharpe > base[i].sharpe).length / ms.length * 100), beatsP0Mdd: Math.round(ms.filter((m, i) => m.mdd > base[i].mdd + 0.01).length / ms.length * 100) };
  }
  const finals = runs[id].map(r => r.path.at(-1));
  out.finalMed = Math.round(q(finals, 0.5)); out.finalP10 = Math.round(q(finals, 0.1)); out.tradesPerYear = +(runs[id].reduce((a, r) => a + r.trades, 0) / runs[id].length / ((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / (365.25 * 864e5))).toFixed(1);
  res[id] = out;
  console.log(`${id} ${P.label}\n   고르기(2016~2020) 연 ${out.pick.cagrMed}% 최대손실 ${out.pick.mddMed}%(하위10% ${out.pick.mddWorst10}%) 샤프 ${out.pick.sharpeMed} | P0보다 샤프↑ ${out.pick.beatsP0Sharpe}% 손실↓ ${out.pick.beatsP0Mdd}%\n   확인(2021~2026) 연 ${out.check.cagrMed}% 최대손실 ${out.check.mddMed}%(하위10% ${out.check.mddWorst10}%) 샤프 ${out.check.sharpeMed} | P0보다 샤프↑ ${out.check.beatsP0Sharpe}% 손실↓ ${out.check.beatsP0Mdd}%\n   최종 자산 중앙 ${(out.finalMed / 1e4).toFixed(0)}만원(하위10% ${(out.finalP10 / 1e4).toFixed(0)}만원) · 넣은 돈 ${(invested.at(-1) / 1e4).toFixed(0)}만원 · 매매 연 ${out.tradesPerYear}번`);
}
writeFileSync(join(root, '.research/playbook-sim.json'), JSON.stringify({ generatedAt: new Date().toISOString(), start: START, split: SPLIT, portfolios: N_PORT, holdings: N_HOLD, initial: INIT, monthly: MONTHLY, invested: invested.at(-1), policies: res }, null, 1));
