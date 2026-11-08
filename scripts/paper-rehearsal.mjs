// 모의투자 절차 리허설: 화면의 모의투자(lib/paper-trading.rehearse)를 공개 일봉으로 여러 포트폴리오·기간에 돌려
// "앱이 시키는 대로 했다면" 그냥 보유·지수와 어떻게 달랐는지, 절차 비용(수수료+미끄러짐)과 규칙이 막은 주문이 얼마였는지 잰다.
// 결과: data/paper-rehearsal.json (화면의 '같은 절차를 지난 기간에 돌렸다면' 참고 수치). 사용: node scripts/paper-rehearsal.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rehearse, PAPER_VERSION } from '../lib/paper-trading.js';
import { DEFAULT_RULES, RULES_VERSION } from '../lib/core-rules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function history(symbol) {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=1420070400&period2=9999999999&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0 TeamQuantAcademicPrototype/1.0' }, signal: AbortSignal.timeout(25000) });
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], tz = res.meta.gmtoffset || 0, seen = new Set();
      return res.timestamp.map((t, i) => ({ date: new Date((t + tz) * 1000).toISOString().slice(0, 10), open: q.open[i], close: q.close[i] })).filter(c => c.close > 0 && !seen.has(c.date) && seen.add(c.date));
    } catch (e) { if (k === 2) throw new Error(`${symbol}: ${e.message}`); await sleep(1500); }
  }
}
const KR = s => /\.(KS|KQ)$/.test(s);
const mk = items => items.map(([symbol, name]) => ({ symbol, name, currency: KR(symbol) ? 'KRW' : 'USD' }));
const PORTFOLIOS = [
  { id: 'demo', label: '예시 자산과 같은 6종목', bench: '069500.KS', basket: mk([['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['069500.KS', 'KODEX 200'], ['NVDA', '엔비디아'], ['KO', '코카콜라'], ['035420.KS', 'NAVER']]) },
  { id: 'kr', label: '국내 대형주 5종목', bench: '069500.KS', basket: mk([['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['005380.KS', '현대차'], ['035420.KS', 'NAVER'], ['105560.KS', 'KB금융']]) },
  { id: 'us', label: '미국 기술주 5종목', bench: 'SPY', basket: mk([['AAPL', '애플'], ['MSFT', '마이크로소프트'], ['NVDA', '엔비디아'], ['AMZN', '아마존'], ['GOOGL', '알파벳']]) },
  { id: 'etf', label: '지수·채권 ETF 4종', bench: 'SPY', basket: mk([['SPY', 'S&P500 ETF'], ['QQQ', '나스닥100 ETF'], ['TLT', '미국 장기채 ETF'], ['069500.KS', 'KODEX 200']]) }
];
const BENCH_NAME = { '069500.KS': 'KODEX 200', SPY: 'S&P500 ETF' };
const today = new Date().toISOString().slice(0, 10), y = +today.slice(0, 4);
const WINDOWS = [
  { id: 'recent12m', label: '최근 12개월', from: `${y - 1}-${today.slice(5)}` },
  { id: 'recent6m', label: '최근 6개월', from: new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10) },
  { id: 'ytd', label: `${y}년`, from: `${y}-01-01` },
  ...[2020, 2021, 2022, 2023, 2024, 2025].map(yy => ({ id: `y${yy}`, label: `${yy}년`, from: `${yy}-01-01`, to: `${yy}-12-31` }))
];
const CAPITAL = 10_000_000;

const cache = {}; const get = async s => (cache[s] ||= await history(s));
const fx = await get('KRW=X');
const out = { version: PAPER_VERSION, rulesVersion: RULES_VERSION, generatedAt: new Date().toISOString(), capitalKrw: CAPITAL, rules: DEFAULT_RULES, cost: 0.002, slippage: 0.001, windows: WINDOWS.map(w => ({ id: w.id, label: w.label, from: w.from, to: w.to || today })), portfolios: {} };
const f = m => m ? `${(m.ret * 100).toFixed(1)}% (최대손실 ${(m.mdd * 100).toFixed(1)}%)` : '—';
for (const P of PORTFOLIOS) {
  const candles = {}; for (const b of P.basket) { candles[b.symbol] = await get(b.symbol); await sleep(120); }
  const bench = { symbol: P.bench, name: BENCH_NAME[P.bench], currency: KR(P.bench) ? 'KRW' : 'USD', candles: await get(P.bench) };
  const o = (out.portfolios[P.id] = { label: P.label, basket: P.basket, benchmark: { symbol: P.bench, name: bench.name }, windows: {} });
  console.log(`\n${P.label} (지수: ${bench.name})`);
  for (const W of WINDOWS) {
    const r = rehearse({ basket: P.basket, capitalKrw: CAPITAL, candlesBySymbol: candles, fxCandles: fx, from: W.from, to: W.to || today, benchmark: bench, label: `${P.label} · ${W.label}` });
    if (!r.ok) { o.windows[W.id] = { ok: false, reason: r.reason }; console.log(`  ${W.label}: ${r.reason}`); continue; }
    o.windows[W.id] = { ok: true, from: r.from, to: r.to, days: r.days, metrics: r.metrics, diff: r.diff, activity: r.activity, endCashPct: r.end.cash / r.end.total * 100,
      // 화면에 그릴 수 있게 주 단위로 줄인 경로
      series: r.series.filter((_, k) => k % 5 === 0 || k === r.series.length - 1), journalSample: r.journal.filter(j => ['차단', '손실', '점검'].includes(j.step)).slice(0, 12) };
    console.log(`  ${W.label} ${r.from}~${r.to}: 절차 ${f(r.metrics.rule)} | 보유 ${f(r.metrics.hold)} | 지수 ${f(r.metrics.bench)} | 매매 ${r.activity.trades}회 차단 ${r.activity.blockedTotal}건 비용 ${r.activity.costPct.toFixed(2)}% 현금 평균 ${r.activity.cashAvgPct.toFixed(0)}% 한도 초과일 ${r.activity.breaches}`);
  }
}
// 요약: 기간·포트폴리오별 (절차 − 보유) 수익률, 최대 손실 차이의 중앙값
const cells = Object.values(out.portfolios).flatMap(p => Object.values(p.windows).filter(w => w.ok));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
out.summary = { cells: cells.length, medianRetDiffVsHoldPct: med(cells.map(c => c.diff.vsHoldPct)), medianMddDiffVsHoldPct: med(cells.map(c => c.diff.mddVsHoldPct)), medianRetDiffVsBenchPct: med(cells.filter(c => c.diff.vsBenchPct !== null).map(c => c.diff.vsBenchPct)),
  shareBetterRetThanHold: cells.filter(c => c.diff.vsHoldPct > 0).length / cells.length, shareSmallerMddThanHold: cells.filter(c => c.diff.mddVsHoldPct > 0).length / cells.length,
  medianCostPct: med(cells.map(c => c.activity.costPct)), medianTradesPerYear: med(cells.map(c => c.activity.trades / Math.max(0.2, c.days / 252))), medianCashAvgPct: med(cells.map(c => c.activity.cashAvgPct)), medianBreachPct: med(cells.map(c => c.activity.breachPct)) };
console.log('\n요약', JSON.stringify(out.summary, null, 1));
writeFileSync(resolve(root, 'data/paper-rehearsal.json'), JSON.stringify(out));
console.log('→ data/paper-rehearsal.json');
