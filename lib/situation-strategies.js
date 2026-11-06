// 상황별 전략(비중 방식). 매일 종가로 목표 비중을 정하고 다음 거래일 시가에 맞춘다.
// 목표가 바뀔 때만 거래하므로 매일 다시 맞추는 비용은 없다. 비용: 거래 금액의 0.2%(수수료·슬리피지 각 0.1%).
import { computeFeatures, regimeAt, REGIMES } from './situation.js';

const pctText = v => `${Math.round(v * 100)}%`;
export const SITUATION_STRATEGIES = [
  { id: 'hold', title: '그냥 보유', family: '기준', how: '처음에 사서 끝까지 들고 있습니다.', when: '다른 방식이 확실히 낫지 않을 때의 기본값', entry: '첫날 전부 매수', exit: '팔지 않음',
    decide: ({ fresh }) => fresh ? [1, '처음 매수'] : null },
  { id: 'trend_trail', title: '추세 따라가기 + 추적 손절', family: '추세 추종', how: '종가가 60일선 위이고 20일선이 60일선 위면 삽니다. 보유 중 가장 높았던 종가에서 평소 하루 변동폭의 3배만큼 내려오면 팝니다. 판 뒤에는 20일 최고가를 넘어야 다시 삽니다.', when: '추세가 이어지는 시장(미국 대형주·ETF의 강한 상승)',
    entry: '종가 > 60일선, 20일선 > 60일선', exit: '보유 중 최고 종가 − 평소 하루 변동폭 × 3 아래로 마감',
    decide({ F, i, w, mem, fresh }) {
      const c = F.close[i], m20 = F.ma20[i], m60 = F.ma60[i], move = F.absMove20[i];
      if (m60 === null || move === null) return null;
      if (w > 0) { mem.peak = Math.max(mem.peak ?? c, c); if (c < mem.peak - 3 * move) { mem.peak = null; mem.cool = true; return [0, '추적 손절: 최고 종가에서 평소 변동폭 3배 하락']; } return null; }
      const trend = c > m60 && m20 > m60;
      if (trend && (!mem.cool || (F.hi20prev[i] !== null && c > F.hi20prev[i]))) { mem.peak = c; mem.cool = false; return [1, fresh ? '추세 확인: 60일선 위' : '추세 재확인']; }
      return fresh ? [0, '추세 아님: 현금으로 대기'] : null;
    } },
  { id: 'pullback', title: '눌림목에서 사기', family: '추세 추종', how: '200일선 위 상승 추세에서 종가가 20일선 1% 안쪽까지 내려오면 삽니다. 60일선을 2% 넘게 깨면 팝니다.', when: '상승 추세 속 짧은 되돌림, 과열 뒤 식을 때',
    entry: '종가 > 200일선, 60일선 상승, 20일선 1% 이내까지 하락, 60일선 위', exit: '종가가 60일선 −2% 아래',
    decide({ F, i, w, fresh }) {
      const c = F.close[i], m20 = F.ma20[i], m60 = F.ma60[i], m200 = F.ma200[i];
      if (m60 === null) return null;
      if (w > 0) return c < m60 * 0.98 ? [0, '추세 이탈: 60일선 −2% 아래'] : null;
      if (m200 !== null && c > m200 && F.slope60[i] > 0 && c <= m20 * 1.01 && c >= m60) return [1, '눌림: 20일선 근처'];
      return fresh ? [0, '눌림 대기'] : null;
    } },
  { id: 'mean_revert', title: '평균 회귀(밴드)', family: '평균 회귀', how: '종가가 20일 평균보다 표준편차 2배 넘게 낮으면 사고, 20일 평균으로 돌아오면 팝니다. 산 값에서 10% 더 빠지면 손절합니다.', when: '횡보장, 오르내림이 잦은 종목',
    entry: '종가 < 20일 평균 − 2×표준편차', exit: '종가 ≥ 20일 평균, 또는 매수가 −10%',
    decide({ F, i, w, mem, fresh }) {
      const c = F.close[i], m = F.ma20[i], sd = F.sd20[i];
      if (m === null || sd === null) return null;
      if (w > 0) { if (c >= m) return [0, '20일 평균 회복']; if (mem.entry && c < mem.entry * 0.9) return [0, '손절 −10%']; return null; }
      if (c < m - 2 * sd) { mem.entry = c; return [1, '밴드 하단 이탈']; }
      return fresh ? [0, '밴드 하단 대기'] : null;
    } },
  { id: 'trim_rebuy', title: '과열 때 절반 이익 실현', family: '평균 회귀', how: '평소엔 전부 보유합니다. RSI 70 이상이거나 200일선보다 30% 넘게 위면 절반을 팔고, 종가가 20일선까지 내려오면 다시 채웁니다. 다시 채운 뒤에는 RSI가 60 아래로 식어야 다음 과열에 팝니다.', when: '국내 대형주 과열 구간',
    entry: '종가가 20일선 이하로 식으면 다시 100%', exit: 'RSI ≥ 70 또는 200일선 +30% 이상이면 50%로',
    decide({ F, i, mem, fresh }) {
      const hot = F.rsi[i] >= 70 || (F.gap200[i] !== null && F.gap200[i] >= 0.3);
      if (fresh) { mem.trimmed = hot; mem.armed = !hot; return hot ? [0.5, '과열: 절반만 보유'] : [1, '처음 매수']; }
      if (!mem.armed && F.rsi[i] < 60) mem.armed = true;
      if (!mem.trimmed && mem.armed && hot) { mem.trimmed = true; mem.armed = false; return [0.5, `과열(RSI ${Math.round(F.rsi[i])}): 절반 이익 실현`]; }
      if (mem.trimmed && F.ma20[i] !== null && F.close[i] <= F.ma20[i]) { mem.trimmed = false; return [1, '20일선까지 식음: 다시 채움']; }
      return null;
    } },
  { id: 'confirm_buy', title: '급락 뒤 확인하고 사기', family: '평균 회귀', how: '처음엔 1/3만 삽니다. 종가가 20일선을 되찾고 5일선이 20일선 위로 올라서면 나머지를 삽니다. 처음 산 값보다 15% 더 빠지면 1/3도 팝니다.', when: '시장 전체 하락이나 뉴스 없는 급락(기업 문제로 빠진 종목은 제외)',
    entry: '1/3 매수 → 종가 > 20일선 & 5일선 > 20일선이면 100%', exit: '첫 매수가 −15%면 0%',
    decide({ F, i, mem, fresh }) {
      const c = F.close[i], ok = F.ma20[i] !== null && c > F.ma20[i] && F.ma5[i] > F.ma20[i];
      if (fresh) { mem.base = c; mem.stage = 1; return [1 / 3, '1/3 먼저 매수']; }
      if (mem.stage === 1) { if (c < mem.base * 0.85) { mem.stage = 0; return [0, '첫 매수가 −15%: 정리']; } if (ok) { mem.stage = 2; return [1, '회복 확인: 나머지 매수']; } return null; }
      if (mem.stage === 0 && ok) { mem.stage = 2; return [1, '회복 확인: 다시 매수']; }
      return null;
    } },
  { id: 'dca', title: '나눠 사기(적립)', family: '적립', how: '돈을 12번에 나눠 21거래일(약 한 달)마다 1/12씩 삽니다. 1년 고점보다 10% 넘게 빠져 있으면 그달은 2배로 삽니다.', when: '지수 ETF, 하락장 공포 구간',
    entry: '21거래일마다 처음 자금의 1/12 (고점 대비 −10%면 2/12)', exit: '팔지 않음',
    decide({ F, i, mem, fresh, stockValue, value, capital }) {
      if (!fresh && i - mem.last < 21) return null;
      mem.last = i;
      const dip = F.dd[i] !== null && F.dd[i] <= -0.1, add = capital * (dip ? 2 : 1) / 12;
      const target = Math.min(1, (stockValue + add) / value);
      return target - stockValue / value < 0.005 ? null : [target, dip ? '고점 대비 −10%: 2배 적립' : '정기 적립'];
    } }
];
export const strategyById = id => SITUATION_STRATEGIES.find(s => s.id === id);

/**
 * 한 전략을 start~end 구간에 적용한다. 첫날은 종가에 진입하고, 이후 결정은 다음 거래일 시가에 체결한다.
 * @returns {{equity:{date,value,close,weight}[], trades:object[], finalWeight:number}}
 */
export function simulate(F, strategy, start, end = F.n - 1, { capital = 10_000_000, cost = 0.002 } = {}) {
  let cash = capital, shares = 0, pending = null;
  const mem = {}, equity = [], trades = [];
  const trade = (i, price, target, why) => {
    // 살 때는 비용까지 합쳐 목표 금액을 넘지 않게 해 현금이 음수가 되지 않는다.
    const value = cash + shares * price, gap = target * value - shares * price, delta = gap > 0 ? gap / (price * (1 + cost)) : gap / price;
    if (Math.abs(delta * price) < value * 0.002) return;
    const fee = Math.abs(delta * price) * cost;
    cash -= delta * price + fee; shares += delta;
    trades.push({ date: F.dates[i], side: delta > 0 ? '매수' : '매도', price: Math.round(price * 100) / 100, shares: Math.abs(delta), weight: Math.round(target * 100), reason: why, fee, pnl: null });
  };
  for (let i = start; i <= end; i++) {
    if (pending && i > start) { const px = F.open[i] > 0 ? F.open[i] : F.close[i - 1]; trade(i, px, pending[0], pending[1]); pending = null; }
    const close = F.close[i], value = cash + shares * close, stockValue = shares * close, w = value > 0 ? stockValue / value : 0;
    const fresh = i === start, d = strategy.decide({ F, i, w, mem, fresh, stockValue, value, capital });
    if (fresh) { if (d) trade(i, close, d[0], d[1]); }
    else if (d && i < end && Math.abs(d[0] - w) > 0.01) pending = d;
    const v = cash + shares * close;
    equity.push({ date: F.dates[i], value: v, close, weight: v > 0 ? shares * close / v : 0 });
  }
  return { equity, trades, finalWeight: equity.at(-1)?.weight || 0 };
}

const round = (v, n = 2) => Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : null;
function drawdown(values) { let peak = -Infinity, worst = 0; for (const v of values) { peak = Math.max(peak, v); worst = Math.min(worst, v / peak - 1); } return worst * 100; }

// 전략 테스트 화면용: runLabTest와 같은 모양으로 돌려준다.
export function runSituationTest(candles, indexCandles, id, from, capital = 10_000_000) {
  const s = strategyById(id); if (!s) throw new Error('지원하지 않는 상황별 방식입니다.');
  const F = computeFeatures(candles), start = F.dates.findIndex(d => d >= from);
  if (start < 0 || F.n - start < 5) throw new Error('선택한 기간에 시세가 부족합니다.');
  if (start < 60) throw new Error('이 방식은 평가 시작 전 60거래일 이상의 시세가 필요합니다.');
  const sim = simulate(F, s, start, F.n - 1, { capital });
  const eq = sim.equity, first = eq[0], last = eq.at(-1);
  const totalReturn = round((last.value / capital - 1) * 100), hold = { return: round((last.close / first.close - 1) * 100), maxDrawdown: round(drawdown(eq.map(e => e.close))) };
  const idx = (indexCandles || []).filter(c => c.date >= first.date && c.date <= last.date);
  const market = idx.length > 1 ? round((idx.at(-1).close / idx[0].close - 1) * 100) : null;
  const edge = round(totalReturn - hold.return), mdd = round(drawdown(eq.map(e => e.value)));
  const avgWeight = round(eq.reduce((a, e) => a + e.weight, 0) / eq.length * 100, 0);
  let verdict;
  if (!sim.trades.length) verdict = '이 기간에는 사라는 조건이 한 번도 나오지 않아 현금으로만 있었습니다.';
  else if (edge >= 2) verdict = `이 방식이 그냥 들고 있기보다 ${edge}%p 나았습니다.`;
  else if (edge <= -2) verdict = `그냥 들고 있는 편이 ${Math.abs(edge)}%p 나았습니다.`;
  else verdict = '그냥 들고 있기와 거의 같은 결과입니다.';
  const safer = mdd < 0 && hold.maxDrawdown < 0 && Math.abs(mdd) < Math.abs(hold.maxDrawdown) - 3;
  const trades = sim.trades.map(t => ({ ...t, reason: `${t.reason} · 비중 ${t.weight}%` }));
  return {
    situation: true,
    result: { summary: { startDate: first.date, endDate: last.date, totalReturn, maxDrawdown: mdd, tradeCount: trades.length, positionOpen: sim.finalWeight > 0.01, finalWeight: round(sim.finalWeight * 100, 0) }, trades, signals: trades.map(t => ({ date: t.date, side: t.side, reason: t.reason })) },
    hold, market, edge, inMarket: avgWeight, verdict,
    note: safer ? `대신 중간 최대 손실은 ${mdd}%로 그냥 보유(${hold.maxDrawdown}%)보다 작았습니다.` : null,
    curve: eq.map(e => ({ date: e.date, strategy: e.value / capital * 100, hold: e.close / first.close * 100 })),
    definition: { entryRule: s.entry, exitRule: s.exit, riskRule: `거래 금액의 0.2% 비용 · 다음 거래일 시가 체결 · 지금 비중 ${pctText(sim.finalWeight)}` },
    label: s.title
  };
}

// 시장 국면(상승장·하락장·횡보장)별로 나눈 성과. 한 국면에서만 이긴 방식을 걸러내는 용도.
export function regimeBreakdown(curve, indexCandles) {
  if (!curve?.length || !indexCandles?.length) return { available: false, rows: [] };
  const G = computeFeatures(indexCandles), at = new Map(G.dates.map((d, i) => [d, i]));
  const acc = {};
  for (let k = 1; k < curve.length; k++) {
    const j = at.get(curve[k].date); if (j === undefined) continue;
    const g = regimeAt(G, j); if (!g) continue;
    const a = (acc[g] ||= { days: 0, s: 1, h: 1 });
    a.days++; a.s *= curve[k].strategy / curve[k - 1].strategy; a.h *= curve[k].hold / curve[k - 1].hold;
  }
  const rows = ['up', 'sideways', 'down'].filter(g => acc[g]).map(g => ({ regime: g, label: REGIMES[g].label, days: acc[g].days, strategy: round((acc[g].s - 1) * 100), hold: round((acc[g].h - 1) * 100), edge: round((acc[g].s - acc[g].h) * 100) }));
  const wins = rows.filter(r => r.days >= 10 && r.edge > 0).length, valid = rows.filter(r => r.days >= 10).length;
  return { available: rows.length > 0, rows, note: !valid ? '국면을 나눌 만큼 기간이 길지 않습니다.' : wins === valid ? '모든 국면에서 그냥 보유보다 나았습니다.' : wins === 0 ? '어느 국면에서도 그냥 보유보다 낫지 않았습니다.' : `${valid}개 국면 중 ${wins}개에서만 나았습니다. 한 국면에서만 이긴 방식은 국면이 바뀌면 틀릴 수 있습니다.` };
}
