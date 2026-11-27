// 홈 '지수 대비 수익률' 그래프 그리기(lib/compare-chart.js): 눈금 · % 바꾸기 · 빈 날 · 점 하나 · 모두 내림/오름 · NaN 없음 · 날짜 글.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toPct, fmtPct, niceStep, niceTicks, tickLabel, dateTicks, dateLabel, placeLabels, chartModel, chartSvg, pointAt, nearestIndex, summaryText, textWidth } from '../lib/compare-chart.js';

const names = { own: '내 계좌', spx: 'S&P500', kospi: '코스피' };
const day = (start, k) => new Date(Date.parse(`${start}T00:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
// 시작 = 100 선(평일만 · 주말 건너뜀)
function weekdays(start, n, f) {
  const out = []; for (let k = 0; out.length < n; k++) { const d = day(start, k), w = new Date(`${d}T00:00:00Z`).getUTCDay(); if (w && w < 6) out.push(d); }
  return out.map((date, i) => ({ date, ...f(i) }));
}
const noNaN = s => assert.ok(!/NaN|undefined|Infinity/.test(s), `NaN/undefined 없음: ${s.match(/.{0,40}(NaN|undefined|Infinity).{0,40}/)?.[0]}`);

test('toPct · fmtPct: 시작 = 100 → 시작일 대비 %, 빼기는 −, 0은 부호 없음', () => {
  assert.equal(toPct(100), 0); assert.equal(toPct(79.3).toFixed(1), '-20.7'); assert.equal(toPct(null), null); assert.equal(toPct(NaN), null);
  assert.equal(fmtPct(-20.7), '−20.7%'); assert.equal(fmtPct(9.84), '+9.8%'); assert.equal(fmtPct(-0.04), '0.0%'); assert.equal(fmtPct(null), '—');
});

test('niceStep · niceTicks: 1·2·5 간격 · 0 포함 · 범위를 덮음', () => {
  assert.equal(niceStep(42, 5), 10); assert.equal(niceStep(9, 5), 2); assert.equal(niceStep(3, 5), 1); assert.equal(niceStep(0.4, 5), 0.1);
  const a = niceTicks(-31.8, 4.2, 5);
  assert.deepEqual(a.ticks, [-40, -30, -20, -10, 0, 10]); assert.equal(a.step, 10);
  const b = niceTicks(-9.8, -2, 5); assert.ok(b.ticks.includes(0) && b.lo <= -9.8 && b.hi === 0, '모두 내림이어도 0 줄이 있다');
  const c = niceTicks(3, 17, 5); assert.ok(c.ticks.includes(0) && c.lo === 0 && c.hi >= 17, '모두 오름이어도 0 줄이 있다'); assert.equal(c.step, 5);
  const z = niceTicks(0, 0, 5); assert.ok(z.lo < 0 && z.hi > 0, '범위 0이면 넓힌다');
  const s = niceTicks(-0.3, 0.2, 5); assert.ok(s.ticks.every(v => Number.isFinite(v)) && s.step === 0.1);
  assert.equal(tickLabel(-0.3, 0.1), '−0.3%'); assert.equal(tickLabel(10, 10), '+10%'); assert.equal(tickLabel(0, 10), '0%');
});

test('dateTicks: 첫날·마지막 날 포함 · 눈금은 MM-DD · 첫 눈금과 해가 바뀐 눈금에 연도', () => {
  const ds = weekdays('2026-08-26', 65, () => ({})).map(p => p.date);
  const t = dateTicks(ds, { count: 5 });
  assert.equal(t.length, 5); assert.equal(t[0].date, ds[0]); assert.equal(t.at(-1).date, ds.at(-1));
  assert.equal(t[0].label, ds[0].slice(5)); assert.equal(t[0].year, '2026');
  assert.ok(t.every(x => /^\d{2}-\d{2}$/.test(x.label)), 'MM-DD'); assert.ok(t.slice(1).every(x => x.year === ''), '연도는 첫 눈금에만');
  assert.equal(t.at(-1).label, ds.at(-1).slice(5));
  assert.equal(t[0].anchor, 'start'); assert.equal(t.at(-1).anchor, 'end');
  assert.deepEqual(dateLabel('2027-01-04', '2026-12-28'), { label: '01-04', year: '2027' }, '해가 바뀌면 연도를 붙인다');
  assert.deepEqual(dateLabel('2026-12-28', '2026-12-01'), { label: '12-28', year: '' });
  assert.deepEqual(dateTicks(['2026-11-26']).map(x => [x.label, x.year]), [['11-26', '2026']]);
  assert.deepEqual(dateTicks([]), []);
  // 좁으면 겹치는 가운데 눈금을 뺀다(첫날·마지막 날은 남는다)
  const narrow = dateTicks(ds, { count: 5, xOf: i => i / (ds.length - 1) * 120 });
  assert.ok(narrow.length < 5 && narrow.length >= 2 && narrow[0].date === ds[0] && narrow.at(-1).date === ds.at(-1));
  assert.equal(dateTicks(ds, { count: 4, xOf: i => i / (ds.length - 1) * 194 }).length, 4, '390px 화면 그림 폭(약 194px)에도 눈금 4개');
  for (let k = 1; k < narrow.length; k++) assert.ok(narrow[k].i > narrow[k - 1].i);
});

test('placeLabels: 겹치지 않음 · 범위 안 · 옮긴 것만 안내선', () => {
  const p = placeLabels([{ key: 'own', y: 50 }, { key: 'spx', y: 52 }, { key: 'kospi', y: 120 }], { gap: 15, min: 10, max: 130 });
  const ys = p.map(x => x.y);
  for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= 15 - 1e-9);
  assert.ok(ys.every(y => y >= 10 && y <= 130));
  assert.equal(p.find(x => x.key === 'kospi').moved, false); assert.equal(p.find(x => x.key === 'spx').moved, true);
  const bottom = placeLabels([{ key: 'a', y: 129 }, { key: 'b', y: 130 }, { key: 'c', y: 131 }], { gap: 15, min: 10, max: 130 });
  assert.ok(bottom.every(x => x.y <= 130) && bottom[1].y - bottom[0].y >= 15 && bottom[2].y - bottom[1].y >= 15, '아래 끝에 몰려도 위로 밀어 올린다');
  const tight = placeLabels([{ key: 'a', y: 5 }, { key: 'b', y: 5 }, { key: 'c', y: 5 }], { gap: 15, min: 0, max: 20 });
  assert.ok(tight.every(x => Number.isFinite(x.y) && x.y >= 0 && x.y <= 20));
});

test('chartModel · chartSvg: 3개월 · 세로 눈금 · 날짜 · 끝 이름표 값 · NaN 없음', () => {
  const line = weekdays('2026-08-26', 65, i => ({ own: 100 - 20.7 * i / 64, spx: 100 - 9.8 * i / 64, kospi: 100 - 31.8 * i / 64 }));
  const m = chartModel(line, { width: 520, height: 200, names });
  const svg = chartSvg(m);
  noNaN(svg);
  assert.match(svg, /viewBox="0 0 520 200"/); assert.match(svg, /width="100%"/);
  assert.match(svg, /시작일 대비\(%\)/);
  assert.match(svg, /class="cc-zero"/, '0% 줄은 따로 강조');
  assert.ok(svg.includes('내 계좌 −20.7%') && svg.includes('S&amp;P500 −9.8%') && svg.includes('코스피 −31.8%'), '끝 이름표 = 이름 + 마지막 %');
  assert.ok(svg.includes('>08-26<') && svg.includes('>2026<'), '첫 눈금 날짜 + 연도'); assert.ok(svg.includes(`>${line.at(-1).date.slice(5)}<`), '마지막 날짜');
  assert.ok(m.y.labels.includes('0%') && m.y.labels.includes('−30%'));
  // 끝 이름표끼리 겹치지 않는다
  const ys = m.labels.map(l => l.y).sort((a, b) => a - b); for (let k = 1; k < ys.length; k++) assert.ok(ys[k] - ys[k - 1] >= m.fs + 3 - 1e-9);
  // 오른쪽 이름표 칸이 그림 안에 들어간다
  for (const s of m.series) assert.ok(m.plot.r + 8 + textWidth(s.label, m.fs) <= m.W + 1, `${s.label} 이 잘리지 않음`);
});

test('chartModel: 쉬는 날(값 없음)은 선을 끊고 · 휴장일이 있어도 날짜 간격대로', () => {
  const line = [
    { date: '2026-11-02', own: 100, spx: 100, kospi: 100 },
    { date: '2026-11-03', own: 101, spx: null, kospi: 101 },
    { date: '2026-11-04', own: 102, spx: 103, kospi: null },
    { date: '2026-11-05', own: 103, spx: 104, kospi: 102 },
    { date: '2026-11-09', own: 99, spx: 101, kospi: 98 }
  ];
  const m = chartModel(line, { width: 400, height: 200, names });
  const spx = m.series.find(s => s.key === 'spx');
  assert.equal((spx.d.match(/M/g) || []).length, 1, '첫 점은 혼자라 점으로, 뒤 셋은 한 선');
  assert.equal(spx.dots.length, 1);
  const kospi = m.series.find(s => s.key === 'kospi');
  assert.equal((kospi.d.match(/M/g) || []).length, 2, '빈 날을 사이에 두고 두 조각');
  // 11-05 → 11-09 는 나흘 간격이라 하루 간격보다 4배 넓다
  const gap1 = m.xs[3] - m.xs[2], gap4 = m.xs[4] - m.xs[3];
  assert.ok(Math.abs(gap4 / gap1 - 4) < 1e-6);
  const pt = pointAt(m, 1);
  assert.equal(pt.date, '2026-11-03');
  assert.deepEqual(pt.rows.map(r => r.text), ['+1.0%', '—', '+1.0%']);
  assert.deepEqual(pt.rows.map(r => r.name), ['내 계좌', 'S&P500', '코스피']);
  assert.equal(nearestIndex(m, m.xs[3] + 1), 3);
  noNaN(chartSvg(m));
});

test('chartModel: 점 하나 · 지수 없음 · 모두 오름 · 아주 좁은 화면에서도 NaN 없음', () => {
  const one = chartModel([{ date: '2026-11-26', own: 100, spx: null, kospi: null }], { width: 300, names });
  assert.equal(one.series.length, 1); assert.equal(one.series[0].d, ''); assert.equal(one.series[0].dots.length, 1);
  assert.equal(one.xTicks.length, 1); assert.equal(one.xTicks[0].label, '11-26'); assert.equal(one.xTicks[0].year, '2026');
  noNaN(chartSvg(one));
  const up = chartModel(weekdays('2026-10-26', 22, i => ({ own: 100 + i, spx: 100 + i / 2, kospi: 100 + i / 3 })), { width: 326, height: 200, names });
  assert.ok(up.y.lo === 0 && up.y.hi >= 21); noNaN(chartSvg(up));
  assert.equal(up.xTicks[0].year, '2026'); assert.ok(up.xTicks.length >= 4, '좁은 카드(326px)에도 날짜 눈금 4개 이상');
  const down = chartModel(weekdays('2026-05-26', 130, i => ({ own: 100 - i / 5, spx: 100 - i / 9, kospi: 100 - i / 4 })), { width: 200, height: 200, names });
  assert.ok(down.y.hi === 0 && down.y.lo <= -32); noNaN(chartSvg(down));
  assert.equal(chartModel([], { width: 300 }).series.length, 0); noNaN(chartSvg(chartModel([], { width: 300 })));
  noNaN(chartSvg(chartModel([{ date: 'bad', own: 1 }, { date: '2026-11-02', own: NaN, spx: Infinity }], { width: 300 })));
});

test('summaryText: 기간과 세 값을 한 문장으로', () => {
  assert.equal(summaryText({ months: 3, from: '2026-08-26', to: '2026-11-26', values: [{ name: '내 계좌', v: -20.7 }, { name: 'S&P500', v: -9.8 }, { name: '코스피', v: -31.8 }] }),
    '3개월(2026-08-26 ~ 2026-11-26) 동안 내 계좌 −20.7%, S&P500 −9.8%, 코스피 −31.8%');
});
