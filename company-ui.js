// 과거 기업 분석(전략 테스트 화면, 테스트 격자 아래): 기업과 날짜를 고르면 그때 공개돼 있던 재무·시세·주식 수만 보여 주고, 모델이 그때 기준으로 내린 판단(표본 외)과 그 근거를 낸 뒤,
// '실제 결과 보기'를 눌러야 이후 실제 성장·수익률과 비교한다. 자료는 data/company-history.json(G2: 그때 주식 수, 월별 모델 판단·근거).
import { tip } from '/tooltip-ui.js';
import { knownAt, outcomeAfter, monthAt, capAt, rankIn, topPct, rankWord, driverText } from '/lib/company-lab.js';

const $ = s => box.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const pctp = (v, d = 1) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%p` : '—';
const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
const money = (v, cur) => !Number.isFinite(v) ? '—' : cur === 'USD' ? (Math.abs(v) >= 1e12 ? `${(v / 1e12).toFixed(1)}조 달러` : Math.abs(v) >= 1e8 ? `${Math.round(v / 1e8).toLocaleString('ko-KR')}억 달러` : `${Math.round(v / 1e4).toLocaleString('ko-KR')}만 달러`) : Math.abs(v) >= 1e12 ? `${(v / 1e12).toFixed(1)}조원` : `${(v / 1e8).toFixed(0)}억원`;
const price = (v, cur) => !Number.isFinite(v) ? '—' : cur === 'USD' ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `${Math.round(v).toLocaleString('ko-KR')}원`;

let H = null, loading = null;
const box = document.createElement('section'); box.className = 'ch';
const load = () => loading ||= fetch('/data/company-history.json?v=G2').then(r => { if (!r.ok) throw new Error('기업 자료를 불러오지 못했습니다.'); return r.json(); }).then(d => { H = d; return d; });

box.innerHTML = `<article class="lt-card ch-card"><header class="ch-head"><div><h3>과거 기업 분석 ${tip('고른 날짜에 알 수 있던 자료(그때까지 공시된 재무·주식 수·시세)만으로 판단해 보고 나중에 실제 결과와 비교합니다. 재무는 한국은 제출 기한, 미국은 SEC 제출일 기준입니다. 모델도 그 전에 결과가 공개된 자료로만 배웠습니다. 결과는 따로 눌러야 보입니다(결과를 알고 보면 이유를 끼워 맞추기 쉬워서).')}</h3><p class="lt-muted">그때 알 수 있던 자료로 판단하고, 그다음에 실제 결과와 비교합니다</p></div>
  <form class="ch-form" id="ch-form"><input id="ch-sym" list="ch-list" autocomplete="off" placeholder="기업 (예: 엔비디아, SK하이닉스, 펠로톤)"><datalist id="ch-list"></datalist><input id="ch-date" type="month" min="2015-01" max="2026-10"><button type="submit" class="primary">그때 기준으로 분석</button></form></header>
  <div id="ch-out"><p class="ch-range" id="ch-intro">기업과 달을 고르세요.</p></div></article>`;
// lab-ui.js보다 먼저 실행될 수 있어, 전략 테스트 화면이 생길 때까지 기다렸다가 붙인다. 주 도구(전략 테스트 격자)를 밀어내지 않게 그 아래에 둔다.
function mount() { const host = document.getElementById('quicktest'); if (!host) return false; (host.querySelector('.lt') || host.lastElementChild).after(box); return true; }
if (!mount()) { const mo = new MutationObserver(() => { if (mount()) mo.disconnect(); }); mo.observe(document.querySelector('main'), { childList: true }); }
load().then(h => {
  $('#ch-list').innerHTML = Object.entries(h.companies).map(([s, c]) => `<option value="${esc(c.name)}">${esc(s)}</option>`).join('');
  const n = h.model?.companiesByMarket || {};
  $('#ch-intro').textContent = `비교 기업 ${Object.keys(h.companies).length}개(한국 ${n.KR ?? '?'} · 미국 ${n.US ?? '?'}) · 시세 2015년~ · 모델 판단 2017년~`;
}).catch(() => {});

const peers = c => Object.values(H.companies).filter(x => x.market === c.market);
function psrOf(x, d) { const m = monthAt(x.months, d), k = m && knownAt(x.quarters, d); if (!m || m.date < d.slice(0, 7) + '-01' || !k || !(k.rev > 0)) return null; const { cap } = capAt(x, d, m.close); return cap ? cap / k.rev : null; }

function analyze(sym, ym) {
  const c = H.companies[sym], d = ym + '-31', m = monthAt(c.months, d), k = knownAt(c.quarters, d), cur = c.currency;
  if (!m || m.date < ym + '-01') return `<p class="lt-warn">${esc(c.name)}의 ${ym} 시세가 없습니다(상장 전이거나 자료 범위 밖).</p>`;
  if (!k) return `<p class="lt-warn">${ym}까지 공개된 분기 재무가 8개 미만이라 분석하지 못합니다.</p>`;
  const cp = capAt(c, d, m.close), cap = cp.cap, per = cap && k.ni > 0 ? cap / k.ni : null, psr = cap && k.rev > 0 ? cap / k.rev : null;
  const mi = m.i, mom = mi >= 12 ? c.months[mi - 1][1] / c.months[mi - 12][1] - 1 : null, hi52 = Math.max(...c.months.slice(Math.max(0, mi - 12), mi + 1).map(x => x[1]));
  const pred = c.pred?.[m.date], gRank = pred?.[0] ?? null, ps = peers(c);
  const psrRank = rankIn(ps.map(x => psrOf(x, d)), psr);
  const priceWord = psrRank === null ? null : psrRank >= 0.8 ? '높은 성장 기대가 이미 반영됨' : psrRank >= 0.5 ? '보통' : '낮은 편';
  const verdict = gRank === null ? '모델 판단 없음(그 전 학습 자료가 부족한 시기)' : gRank >= 0.6 && psrRank >= 0.8 ? '성장 좋음 · 주가에 이미 많이 반영' : gRank >= 0.6 && psrRank !== null && psrRank < 0.5 ? '성장 좋음 · 가격 부담 낮은 편 (지수보다 더 오른다는 보장 없음)' : gRank >= 0.6 ? '성장 좋음 · 가격 보통' : gRank < 0.4 ? '성장 낮음' : '성장 보통';
  const drivers = (pred?.[2] || []).map(([fi, v]) => driverText(H.model.featureNames?.[fi], v, null, cur));
  const row = (l, v, t = '') => `<div class="hm-kv"><span>${l}${t ? tip(t) : ''}</span><b>${v}</b></div>`;
  const modelTip = "같은 달·같은 시장 비교 기업 중 다음 1년 매출 성장 순위를 매깁니다. 2021~2025년(확인 기간)에 따로 확인하니 '올해 성장률이 그대로 간다'고 본 것보다 조금 나았지만, 나은 몫은 주로 주가에 담긴 시장 기대에서 나왔고 주가가 지수보다 더 오를지는 맞히지 못했습니다.";
  return `<div class="ch-grid">
    <section><h4>그때 알 수 있던 것 <small>${esc(m.date)} 종가 · 최근 분기 말 ${esc(k.lastEnd)} (발표일 ${esc(k.lastAvail)})</small></h4>
      <div class="hm-kvs">
        ${row('주가', price(m.close, cur), '월말 종가(액면분할 반영)')}${row(cp.pit ? '시가총액' : '시가총액(추정)', money(cap, cur), cp.pit ? `그때 공개된 주식 수(기준일 ${cp.asOf}) × 그때 주가` : '그때 주식 수 자료가 없어 지금 주식 수 × 그때 주가로 추정했습니다. 그 뒤의 증자·소각이 섞여 있습니다.')}
        ${row('최근 4분기 매출', money(k.rev, cur))}${row('매출 성장(전년 대비)', `<span class="${tone(k.revG)}">${pct(k.revG)}</span>`, `그 1년 전 성장률 ${pct(k.revGPrev)} → 성장 속도 변화 ${k.revG != null && k.revGPrev != null ? pctp(k.revG - k.revGPrev) : '—'}`)}
        ${row('영업이익률', pct(k.margin), `1년 전 ${pct(k.marginPrev)}`)}${row('영업이익 성장', `<span class="${tone(k.oiG)}">${k.oi != null && k.oi < 0 ? '적자' : pct(k.oiG)}</span>`)}${row('ROE', pct(k.roe))}
        ${row('PER', per ? `${per.toFixed(1)}배` : '적자 또는 자료 없음')}${row('PSR(시가총액/매출)', psr ? `${psr.toFixed(1)}배` : '—', psrRank !== null ? `같은 달 같은 시장 비교 기업 ${ps.length}개 중 ${topPct(psrRank)}로 비쌈` : '')}
        ${row('12개월 주가 흐름', pct(mom))}${row('52주 고점 대비', pct(m.close / hi52 - 1))}
      </div>
      <details class="ch-q"><summary>그때까지 나온 분기 실적 8개</summary><div class="table-wrap"><table class="lt-table"><thead><tr><th>분기 말</th><th>발표일</th><th>매출</th><th>영업이익</th><th>순이익</th></tr></thead><tbody>${c.quarters.filter(x => x[1] <= d).slice(-8).map(x => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td><td>${money(x[2], cur)}</td><td class="${tone(x[3])}">${money(x[3], cur)}</td><td class="${tone(x[4])}">${money(x[4], cur)}</td></tr>`).join('')}</tbody></table></div></details>
    </section>
    <section><h4>모델 판단 <small>${esc(m.date)} 기준 · 그 전 공개 결과로만 학습</small> ${tip(modelTip)}</h4>
      <table class="ch-verdict"><tbody>
        <tr><td>다음 1년 매출 성장 전망</td><td><b>${rankWord(gRank) ?? '판단 없음'}</b>${gRank !== null ? ` <small>같은 달 같은 시장 비교 기업 중 ${topPct(gRank)}</small>` : ''}</td></tr>
        ${drivers.length ? `<tr><td>이유 ${tip('그 판단에 영향이 컸던 항목 3개입니다. ▲는 성장 순위를 올렸고 ▼는 내렸습니다. PSR·주가 흐름이 크면 시장이 이미 그 성장을 기대하고 있었다는 뜻입니다.')}</td><td>${drivers.map(esc).join('<br>')}</td></tr>` : ''}
        <tr><td>가격에 반영된 기대</td><td><b>${priceWord ?? '—'}</b>${psrRank !== null ? ` <small>PSR ${topPct(psrRank)}</small>` : ''}</td></tr>
        <tr><td>지수 대비 주가</td><td><b>판단하지 않음</b> <small>확인 기간에 맞히지 못함</small></td></tr>
        <tr><td>종합</td><td><b>${esc(verdict)}</b></td></tr>
      </tbody></table>
      <button type="button" class="secondary" id="ch-reveal">실제 결과 보기</button><div id="ch-result"></div>
    </section></div>`;
}
function reveal(sym, ym) {
  const c = H.companies[sym], d = ym + '-31', m = monthAt(c.months, d), k = knownAt(c.quarters, d), pred = c.pred?.[m.date], gRank = pred?.[0] ?? null;
  const g = (x, y) => x != null && y > 0 ? x / y - 1 : null, rows = [];
  for (const [label, nq, months] of [['1년 뒤', 4, 12], ['2년 뒤', 8, 24], ['3년 뒤', 12, 36]]) {
    const o = outcomeAfter(c.quarters, k.lastEnd, nq), j = m.i + months, mm = j < c.months.length ? c.months[j] : null;
    rows.push({ label, revG: o ? g(o.rev, k.rev) : null, oiG: o && k.oi > 0 && o.oi != null ? o.oi / k.oi - 1 : null, ret: mm ? mm[1] / m.close - 1 : null, ex: mm ? (mm[1] / m.close - 1) - (mm[2] / m.idx - 1) : null, when: mm?.[0] });
  }
  const r1 = rows[0];
  // 실제 1년 성장이 같은 달·같은 시장 비교 기업 중 어디였나(그 달 결과가 나온 기업끼리)
  const act = peers(c).map(x => { const mm = monthAt(x.months, d), kk = mm && mm.date >= ym + '-01' && knownAt(x.quarters, d), o = kk && outcomeAfter(x.quarters, kk.lastEnd, 4); return o && kk.rev > 0 && o.rev != null ? o.rev / kk.rev - 1 : null; }).filter(Number.isFinite);
  const actRank = r1.revG === null ? null : rankIn(act, r1.revG);
  const judged = gRank === null || actRank === null ? null : Math.abs(gRank - actRank) <= 0.25 ? '맞음' : (gRank >= 0.6) === (actRank >= 0.6) ? '대체로 맞음' : '틀림';
  if (rows.every(r => r.revG === null && r.ret === null)) return '<p class="cr-muted">그 뒤 자료가 아직 없습니다(최근 시점).</p>';
  return `<h4>실제 결과</h4><div class="table-wrap"><table class="lt-table"><thead><tr><th></th><th>매출 성장(누적)</th><th>영업이익 성장</th><th>주가</th><th>지수 대비 ${tip('주가 수익률 − 같은 기간 지수(코스피 또는 S&P500) 수익률. 단위는 %p(퍼센트포인트)입니다. 예: 주가 −81%, 지수 +22%면 −103%p.')}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.label}${r.when ? `<small>${esc(r.when)}</small>` : ''}</td><td class="${tone(r.revG)}">${pct(r.revG)}</td><td class="${tone(r.oiG)}">${r.oiG !== null && r.oiG < -1 ? '적자 전환' : pct(r.oiG)}</td><td class="${tone(r.ret)}">${pct(r.ret)}</td><td class="${tone(r.ex)}"><b>${pctp(r.ex)}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="ch-judge">${actRank !== null ? `실제 1년 매출 성장은 같은 달 같은 시장 비교 기업 ${act.length}개 중 <b>${topPct(actRank)}</b>${judged ? ` → 모델의 성장 판단 <b>${judged}</b>` : ''}.` : ''} ${r1.ex !== null ? `주가는 1년 동안 지수보다 <b class="${tone(r1.ex)}">${pctp(r1.ex)}</b>${gRank !== null && gRank >= 0.6 && r1.ex < 0 ? ' — 성장은 맞았어도 그 기대가 가격에 먼저 반영돼 있었음' : ''}.` : ''}</p>`;
}
$('#ch-form').onsubmit = async e => {
  e.preventDefault(); const out = $('#ch-out'), name = $('#ch-sym').value.trim(), ym = $('#ch-date').value;
  try {
    const h = await load(); const q = name.toLowerCase(), sym = Object.keys(h.companies).find(s => h.companies[s].name.toLowerCase() === q || s.toLowerCase() === q) || Object.keys(h.companies).find(s => h.companies[s].name.toLowerCase().startsWith(q) || h.companies[s].name.toLowerCase().includes(`(${q})`));
    if (!sym) throw new Error('목록에 있는 기업 이름을 고르세요.'); if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('달을 고르세요.');
    out.innerHTML = analyze(sym, ym);
    const btn = $('#ch-reveal'); if (btn) btn.onclick = () => { $('#ch-result').innerHTML = reveal(sym, ym); btn.disabled = true; };
  } catch (err) { out.innerHTML = `<p class="lt-warn">${esc(err.message)}</p>`; }
};
window.addEventListener('teamquant:study', e => { const s = e.detail?.symbol?.split('.')[0]; if (H?.companies[s]) $('#ch-sym').value = H.companies[s].name; });
