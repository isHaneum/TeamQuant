// 근거 카드 기준의 과거 검증(결정 29). 네트워크 없음 — data/company-history.json 만 읽는다.
// 물음(노션 HMW B): 오늘(2026-11-12) 정한 카드 기준(성장 5% · 성장 예측 상위 40% · ROE 8% · 가격 백분위 70 이하 · 깨짐 없음)을 과거 매달 말에 그때 알 수 있던 자료로만 적용했다면, 통과 종목은 다음 달에 나머지보다 나았는가?
// 방법: 매달 말 d 에 98개 기업의 카드를 만든다(재무는 공개일 ≤ d, 성장 예측은 그 달의 표본 외 예측 pred[d] — 모델은 해마다 그 전 자료로만 다시 학습됨). 통과 종목 동일가중의 다음 달 수익을 같은 시장 전체 동일가중·지수와 비교.
// 구간: 기준값은 과거 자료로 조정하지 않았으므로 전 기간이 미사용 구간이지만, 성장 예측 모델의 변수는 2020년까지 자료로 골랐다(growth-study pickEnd). 그래서 ~2020 과 2021~ 을 나눠 보고 뒤쪽을 본다.
// 한계: 98개는 2026년에 고른 기업(생존·선택 편향 → 전체 동일가중의 절대 수익은 부풀려져 있고, 통과 − 전체 비교만 해석), 주식 수는 현재 값 근사, 거래 비용·세금 없음, 월 1회 전부 교체 가정.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCard, CARD_RULES, CARD_VERSION } from '../lib/thesis-cards.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), hist = JSON.parse(readFileSync(join(root, 'data/company-history.json'), 'utf8')).companies;
const dates = [...new Set(Object.values(hist).flatMap(c => Object.keys(c.pred || {})))].sort(), rows = [];
for (const d of dates) for (const market of ['KR', 'US']) {
  const all = [], pass = [], wait = []; let idx = null;
  for (const [k, c] of Object.entries(hist)) { if (c.market !== market || !c.pred?.[d]) continue; const i = c.months.findIndex(m => m[0] === d); if (i < 0 || i + 1 >= c.months.length || !(c.months[i][1] > 0)) continue;
    const fwd = c.months[i + 1][1] / c.months[i][1] - 1; if (idx === null && c.months[i][2] > 0) idx = c.months[i + 1][2] / c.months[i][2] - 1;
    const v = buildCard(k, c, { growthRank: c.pred[d][0] }, { asOf: d }).verdict; all.push(fwd); if (v === 'pass') pass.push(fwd); else if (v === 'wait') wait.push(fwd); }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  if (all.length >= 10) rows.push({ date: d, market, n: all.length, nPass: pass.length, nWait: wait.length, pass: mean(pass), wait: mean(wait), all: mean(all), index: idx });
}
const r2 = x => x === null ? null : Math.round(x * 100) / 100;
function summarize(rs) {
  const ok = rs.filter(r => r.pass !== null), ex = ok.map(r => (r.pass - r.all) * 100), exI = ok.filter(r => r.index !== null).map(r => (r.pass - r.index) * 100), n = ex.length; if (!n) return null;
  const m = ex.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(ex.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1)), cum = k => ok.reduce((a, r) => a * (1 + r[k]), 1) - 1;
  return { months: n, emptyMonths: rs.length - n, avgPass: r2(ok.reduce((a, r) => a + r.nPass, 0) / n), avgAll: r2(ok.reduce((a, r) => a + r.n, 0) / n), excessVsAllPp: r2(m), t: r2(sd > 0 ? m / (sd / Math.sqrt(n)) : 0), hitPct: Math.round(ex.filter(x => x > 0).length / n * 100),
    excessVsIndexPp: r2(exI.reduce((a, b) => a + b, 0) / Math.max(1, exI.length)), cumPassPct: Math.round(cum('pass') * 100), cumAllPct: Math.round(cum('all') * 100), waitMinusAllPp: r2(ok.filter(r => r.wait !== null).reduce((a, r) => a + (r.wait - r.all) * 100, 0) / Math.max(1, ok.filter(r => r.wait !== null).length)) };
}
const period = (from, to) => Object.fromEntries(['KR', 'US'].map(mk => [mk, summarize(rows.filter(r => r.market === mk && r.date >= from && r.date <= to))]));
const out = { version: 'TB1-2026-11-12', generatedAt: new Date().toISOString(), cardVersion: CARD_VERSION, rules: CARD_RULES, from: dates[0], to: dates.at(-1),
  note: ['월말마다 그때 공개된 재무와 그 달의 표본 외 성장 예측으로 카드를 만들고, 통과 종목 동일가중의 다음 달 수익을 같은 시장 98개 종목군 전체 동일가중과 비교(월평균 %p).', '종목군은 2026년에 고른 98개라 생존·선택 편향이 있다 — 절대 수익이 아니라 통과 − 전체 차이만 본다. 비용·세금 없음. 주식 수는 현재 값 근사.', '기준값은 과거 자료로 조정하지 않았다(2026-11-12 에 정함). 성장 예측 모델의 변수는 2020년까지 자료로 골랐으므로 2021~ 이 엄격한 미사용 구간.'],
  periods: { '~2020': period('0000', '2020-12-31'), '2021~': period('2021-01-01', '9999'), all: period('0000', '9999') } };
for (const [p, v] of Object.entries(out.periods)) for (const mk of ['KR', 'US']) { const s = v[mk]; console.log(`${p} ${mk}: ` + (s ? `${s.months}개월 · 통과 평균 ${s.avgPass}/${s.avgAll}종목 · 통과−전체 월 ${s.excessVsAllPp}%p (t ${s.t}, 이긴 달 ${s.hitPct}%) · 통과−지수 월 ${s.excessVsIndexPp}%p · 대기−전체 ${s.waitMinusAllPp}%p · 누적 통과 ${s.cumPassPct}% vs 전체 ${s.cumAllPct}%` : '자료 없음')); }
if (!process.argv.includes('--print')) { writeFileSync(join(root, 'data/thesis-backtest.json'), JSON.stringify(out, null, 1)); console.log('저장: data/thesis-backtest.json'); }
