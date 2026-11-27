// 홈 '지수 대비 수익률' 선 그래프를 그리는 순수 함수(입출력 없음 · node 시험: test/compare-chart.test.js).
// 입력은 lib/index-compare.js indexCompare().line 그대로: [{date:'YYYY-MM-DD', own, spx, kospi}], 시작 = 100.
// 세로축 = 시작일 대비 %(값 − 100), 가로축 = 날짜(실제 날짜 간격). 화면 붙이기·마우스·키보드는 home-top-ui.js 가 한다.
// 빨강·파랑은 오름·내림 뜻이라 선 색으로 쓰지 않는다: 내 계좌 굵은 실선 · S&P500 긴 점선 · 코스피 짧은 점선(색 없이도 구분).

export const MINUS = '−';
export const KEYS = ['own', 'spx', 'kospi'];
const DAY = 864e5;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = v => Number(v.toFixed(1));
const f1 = v => v.toFixed(1);
const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));

/** 시작 = 100 값을 시작일 대비 %로. 숫자가 아니면 null. */
export function toPct(v) { return Number.isFinite(v) ? v - 100 : null; }

/** '+1.2%' · '−3.4%' · '0.0%'(반올림해서 0이면 부호 없음). digits 자리. 숫자가 아니면 '—'. */
export function fmtPct(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(digits)), s = r > 0 ? '+' : r < 0 ? MINUS : '';
  return `${s}${Math.abs(r).toFixed(digits)}%`;
}

/** 눈금 간격: 1·2·5 × 10ⁿ 가운데 span 을 maxTicks 칸 안쪽으로 나누는 가장 작은 값. */
export function niceStep(span, maxTicks = 5) {
  const raw = Math.abs(span) / Math.max(1, maxTicks);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** 0을 꼭 포함하는 '깔끔한' 세로 눈금. 범위가 0이면 ±1%로 넓힌다. */
export function niceTicks(min, max, maxTicks = 5) {
  let lo = Math.min(0, Number.isFinite(min) ? min : 0), hi = Math.max(0, Number.isFinite(max) ? max : 0);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, maxTicks), q = v => Number(v.toFixed(10));
  lo = q(Math.floor(lo / step + 1e-9) * step); hi = q(Math.ceil(hi / step - 1e-9) * step);
  const ticks = []; for (let v = lo, k = 0; v <= hi + step / 2 && k < 50; k++, v = q(lo + k * step)) ticks.push(v);
  return { lo, hi, step, ticks };
}

/** 눈금 글: 간격이 1 미만이면 소수 한 자리. */
export function tickLabel(v, step) { const d = step < 1 ? (step < 0.1 ? 2 : 1) : 0; return Math.abs(v) < 1e-9 ? '0%' : fmtPct(v, d); }

/** 글 폭 어림(px): 한글은 글자 크기만큼, 숫자·영문은 0.62배, 띄어쓰기·기호는 0.35배. */
export function textWidth(s, fs = 12) {
  let w = 0; for (const ch of String(s ?? '')) w += /[ㄱ-힣]/.test(ch) ? fs : /[ .,:·()\-]/.test(ch) ? fs * 0.35 : ch === '%' ? fs * 0.85 : fs * 0.62;
  return Math.ceil(w);
}

/** 날짜 이름: 늘 MM-DD. 첫 눈금 · 해가 바뀐 눈금은 그 아래 줄에 연도(YYYY)를 붙인다(좁은 화면에서도 눈금 4~5개가 들어가게). */
export function dateLabel(date, prev) { const d = String(date).slice(0, 10); return { label: d.slice(5), year: !prev || String(prev).slice(0, 4) !== d.slice(0, 4) ? d.slice(0, 4) : '' }; }

/**
 * 가로 날짜 눈금: 첫날 · 마지막 날 + 그 사이를 시간으로 고르게 나눈 날(실제 자료가 있는 날 가운데 가장 가까운 날).
 * xOf(i) 를 주면 글이 서로 겹치는 가운데 눈금은 뺀다(첫날·마지막 날은 남긴다). 반환: [{i, date, label:'MM-DD', year:'YYYY'|'', anchor}]
 */
export function dateTicks(dates, { count = 5, xOf = null, fs = 12, gap = 8 } = {}) {
  const ds = (dates || []).map(d => String(d).slice(0, 10)), n = ds.length;
  if (!n) return [];
  if (n === 1) return [{ i: 0, date: ds[0], label: ds[0].slice(5), year: ds[0].slice(0, 4), anchor: 'middle' }];
  const t = ds.map(d => Date.parse(d)), t0 = t[0], span = t[n - 1] - t0;
  const want = Math.max(2, count), idx = [];
  for (let k = 0; k < want; k++) {
    const target = t0 + span * k / (want - 1);
    let best = 0; for (let i = 1; i < n; i++) if (Math.abs(t[i] - target) < Math.abs(t[best] - target)) best = i;
    if (k === 0) best = 0; if (k === want - 1) best = n - 1;
    if (!idx.includes(best)) idx.push(best);
  }
  idx.sort((a, b) => a - b);
  let ticks = idx.map((i, k) => ({ i, date: ds[i], anchor: k === 0 ? 'start' : k === idx.length - 1 ? 'end' : 'middle' }));
  const relabel = () => ticks.forEach((x, k) => Object.assign(x, dateLabel(x.date, k ? ticks[k - 1].date : null)));
  relabel();
  if (typeof xOf === 'function') {
    const span2 = x => { const w = textWidth(x.label, fs), p = xOf(x.i); return x.anchor === 'start' ? [p, p + w] : x.anchor === 'end' ? [p - w, p] : [p - w / 2, p + w / 2]; };
    // 가운데 눈금부터 하나씩 빼며 겹침을 없앤다.
    for (let guard = 0; guard < 20; guard++) {
      let k = -1;
      for (let j = 1; j < ticks.length; j++) if (span2(ticks[j - 1])[1] + gap > span2(ticks[j])[0]) { k = j; break; }
      if (k < 0) break;
      if (ticks.length <= 2) { ticks = [ticks[0]]; break; } // 너무 좁으면 첫날만(기간 줄에 두 날짜가 다 있다)
      let drop = k === ticks.length - 1 ? k - 1 : k; if (drop === 0) drop = 1;
      ticks.splice(drop, 1); relabel();
    }
  }
  return ticks;
}

/**
 * 선 끝 이름표 자리: y 순서대로 최소 gap 간격, [min,max] 안. 겹치지 않는다.
 * items: [{key, y}] → [{key, y0, y, moved}] (y0 = 선 끝 원래 높이, moved = 안내선이 필요한지)
 */
export function placeLabels(items, { gap = 15, min = 0, max = 100 } = {}) {
  const out = items.filter(x => Number.isFinite(x?.y)).map(x => ({ ...x, y0: x.y, y: Math.min(max, Math.max(min, x.y)) })).sort((a, b) => a.y - b.y);
  const n = out.length; if (!n) return out;
  if ((n - 1) * gap > max - min) { out.forEach((x, k) => { x.y = n === 1 ? (min + max) / 2 : min + (max - min) * k / (n - 1); }); }
  else {
    for (let k = 1; k < n; k++) out[k].y = Math.max(out[k].y, out[k - 1].y + gap);
    if (out[n - 1].y > max) { out[n - 1].y = max; for (let k = n - 2; k >= 0; k--) out[k].y = Math.min(out[k].y, out[k + 1].y - gap); }
  }
  out.forEach(x => { x.moved = Math.abs(x.y - x.y0) > 1.5; });
  return out;
}

/**
 * 그래프 모형(좌표 · 눈금 · 이름표). line: indexCompare().line, names: {own, spx, kospi}.
 * 숫자가 아닌 값(쉬는 날·자료 없음)은 선을 끊는다. 점이 하나뿐이면 점만 찍는다.
 */
export function chartModel(line, { width = 480, height = 200, names = {}, fs = 12 } = {}) {
  const pts = (line || []).filter(p => p && isDate(p.date)).map(p => ({ date: String(p.date).slice(0, 10), ...Object.fromEntries(KEYS.map(k => [k, toPct(p[k])])) }));
  const keys = KEYS.filter(k => pts.some(p => Number.isFinite(p[k])));
  const W = Math.max(200, Math.round(Number(width) || 480)), H = Math.max(140, Math.round(Number(height) || 200));
  const n = pts.length;
  // 선 끝 값(마지막 숫자)
  const endOf = k => { for (let i = n - 1; i >= 0; i--) if (Number.isFinite(pts[i][k])) return { i, v: pts[i][k] }; return null; };
  const ends = Object.fromEntries(keys.map(k => [k, endOf(k)]));
  const labelText = k => `${names[k] || k} ${fmtPct(ends[k].v)}`;
  const vals = pts.flatMap(p => keys.map(k => p[k])).filter(Number.isFinite);
  const rows = H < 170 ? 4 : 5;
  const y = niceTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 0, rows);
  const yLabels = y.ticks.map(v => tickLabel(v, y.step));
  const L = Math.max(...yLabels.map(s => textWidth(s, fs))) + 8;
  const R = (keys.length ? Math.max(...keys.map(k => textWidth(labelText(k), fs))) : 0) + 14;
  const T = 24, B = 38, plot = { l: L, r: Math.max(L + 40, W - R), t: T, b: H - B };
  const t0 = n ? Date.parse(pts[0].date) : 0, tSpan = n > 1 ? Date.parse(pts[n - 1].date) - t0 : 0;
  const xOf = i => n <= 1 ? (plot.l + plot.r) / 2 : plot.l + (Date.parse(pts[i].date) - t0) / (tSpan || DAY) * (plot.r - plot.l);
  const yOf = v => plot.t + (y.hi - v) / (y.hi - y.lo) * (plot.b - plot.t);
  const xs = pts.map((_, i) => xOf(i));
  const series = keys.map(k => {
    const segs = []; let cur = [];
    pts.forEach((p, i) => { if (Number.isFinite(p[k])) cur.push([xs[i], yOf(p[k])]); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    const d = segs.filter(s => s.length > 1).map(s => s.map(([a, b], j) => `${j ? 'L' : 'M'}${f1(a)},${f1(b)}`).join('')).join('');
    const dots = segs.filter(s => s.length === 1).map(s => s[0]);
    const e = ends[k];
    return { key: k, name: names[k] || k, d, dots, end: { i: e.i, x: xs[e.i], y: yOf(e.v), v: e.v }, label: labelText(k) };
  });
  const labels = placeLabels(series.map(s => ({ key: s.key, y: s.end.y })), { gap: fs + 3, min: plot.t + fs / 2 - 2, max: plot.b });
  const xTicks = dateTicks(pts.map(p => p.date), { count: plot.r - plot.l < 260 ? 4 : 5, xOf: i => xs[i], fs });
  return { W, H, fs, plot, n, keys, pts, xs, series, labels, y: { ...y, labels: yLabels, pos: y.ticks.map(yOf) }, xTicks, yOf };
}

/** 한 날짜의 읽기 값: {date, rows:[{key, name, text}]} (자료 없는 선은 '—'). */
export function pointAt(model, i) {
  const p = model?.pts?.[i]; if (!p) return null;
  return { i, date: p.date, x: model.xs[i], rows: model.series.map(s => ({ key: s.key, name: s.name, v: p[s.key], text: fmtPct(p[s.key]), y: Number.isFinite(p[s.key]) ? model.yOf(p[s.key]) : null })) };
}

/** 가로 위치 x 에 가장 가까운 자료 번호. */
export function nearestIndex(model, x) {
  const xs = model?.xs || []; if (!xs.length) return -1;
  let best = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

/** 화면 읽기 프로그램용 한 문장: '3개월(2026-08-26 ~ 2026-11-26) 동안 내 계좌 −20.7%, S&P500 −9.8%, 코스피 −31.8%' */
export function summaryText({ months, from, to, values = [] } = {}) {
  const span = months ? `${months}개월${from && to ? `(${from} ~ ${to})` : ''}` : from && to ? `${from} ~ ${to}` : '이 기간';
  return `${span} 동안 ${values.map(v => `${v.name} ${fmtPct(v.v)}`).join(', ')}`;
}

/** SVG 글(가로 100% · viewBox). 안내선·점은 숨겨 두고 home-top-ui.js 가 움직인다. */
export function chartSvg(model, { title = '' } = {}) {
  const { W, H, plot, fs } = model, P = f1;
  const grid = model.y.ticks.map((v, k) => {
    const yy = P(model.y.pos[k]), zero = Math.abs(v) < 1e-9;
    return `<line class="${zero ? 'cc-zero' : 'cc-grid'}" x1="${P(plot.l)}" x2="${P(plot.r)}" y1="${yy}" y2="${yy}"/><text class="cc-tick${zero ? ' cc-tick0' : ''}" x="${P(plot.l - 6)}" y="${P(model.y.pos[k] + fs / 2 - 2)}" text-anchor="end">${esc(model.y.labels[k])}</text>`;
  }).join('');
  const xt = model.xTicks.map(t => `<line class="cc-xtick" x1="${P(model.xs[t.i])}" x2="${P(model.xs[t.i])}" y1="${P(plot.b)}" y2="${P(plot.b + 4)}"/><text class="cc-tick" x="${P(model.xs[t.i])}" y="${P(plot.b + 4 + fs + 1)}" text-anchor="${t.anchor}">${esc(t.label)}</text>${t.year ? `<text class="cc-tick cc-year" x="${P(model.xs[t.i])}" y="${P(plot.b + 4 + fs * 2 + 3)}" text-anchor="${t.anchor}">${esc(t.year)}</text>` : ''}`).join('');
  const lines = model.series.map(s => `${s.d ? `<path class="cc-l cc-${s.key}" d="${s.d}"/>` : ''}${s.dots.map(([a, b]) => `<circle class="cc-dot cc-${s.key}" cx="${P(a)}" cy="${P(b)}" r="3"/>`).join('')}`).join('');
  const byKey = Object.fromEntries(model.series.map(s => [s.key, s]));
  const lx = plot.r + 8;
  const labels = model.labels.map(l => {
    const s = byKey[l.key];
    const lead = l.moved ? `<path class="cc-lead" d="M${P(s.end.x + 3)},${P(l.y0)}L${P(plot.r + 3)},${P(l.y0)}L${P(lx - 2)},${P(l.y)}"/>` : '';
    return `${lead}<circle class="cc-end cc-${l.key}" cx="${P(s.end.x)}" cy="${P(l.y0)}" r="3.5"/><text class="cc-lab cc-t-${l.key}" x="${P(lx)}" y="${P(l.y + fs / 2 - 2)}">${esc(s.label)}</text>`;
  }).join('');
  const hover = `<g class="cc-hover" visibility="hidden"><line class="cc-guide" x1="0" x2="0" y1="${P(plot.t)}" y2="${P(plot.b)}"/>${model.series.map(s => `<circle class="cc-hdot cc-${s.key}" data-key="${s.key}" cx="0" cy="0" r="4"/>`).join('')}</g>`;
  const cap = `<text class="cc-cap" x="0" y="${fs}">시작일 대비(%)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" aria-hidden="true" focusable="false">${title ? `<title>${esc(title)}</title>` : ''}${cap}${grid}<line class="cc-axis" x1="${P(plot.l)}" x2="${P(plot.r)}" y1="${P(plot.b)}" y2="${P(plot.b)}"/>${xt}${lines}${labels}${hover}<rect class="cc-hit" x="${P(plot.l)}" y="${P(plot.t)}" width="${P(Math.max(0, plot.r - plot.l))}" height="${P(plot.b - plot.t)}" fill="transparent"/></svg>`;
}

/** 범례 줄에 쓰는 작은 선 모양(선 종류만 · 이름은 옆 글자). */
export function keySvg(key) { return `<svg class="cc-key" viewBox="0 0 22 8" width="22" height="8" aria-hidden="true" focusable="false"><line class="cc-l cc-${esc(key)}" x1="1" x2="21" y1="4" y2="4"/></svg>`; }
