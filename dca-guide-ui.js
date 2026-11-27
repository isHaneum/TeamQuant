// 규칙 화면의 '월급 적립' 카드(결정 41 · 2026-11-26부터 '지금 규칙' 아래 접힘). 계산은 lib/dca-guide.js, 숫자는 data/dca-guide.json 에서만 온다.
// 입력값은 이 브라우저에만 저장한다(서버로 보내지 않음). 저장이 막힌 브라우저에서도 화면은 그대로 동작한다.
import { tip } from '/tooltip-ui.js';
import { planGuide } from '/lib/dca-guide.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => `${Math.round(v).toLocaleString('ko-KR')}원`;
const man = v => `${(v / 10000).toLocaleString('ko-KR')}만 원`;
const KEY = 'teamQuantDcaGuide';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const store = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const srcLine = s => `${s.t} (${s.d})`;
let ruleFull = ''; // 복사할 적립 규칙 전문(화면에는 요약 한 줄 + ⓘ)
const ACC = { pension: '연금저축', irp: 'IRP', isa: 'ISA(중개형)', general: '일반 계좌' };
const introTip = g => `매달 들어오는 돈을 어느 계좌에, 어떤 ETF로 넣을지 정합니다.\n세법(${g.checked} 기준)과 운용사 공시 비용으로 계산한 값이며, 수익 예측이나 매수 권유가 아닙니다.\n입력값은 이 브라우저에만 저장됩니다.`;

// 접힘(details) 안에 둘 때는 제목·ⓘ·기준일을 접힘 제목(summary)에 두고, 닫혀 있을 때 보일 한 줄(#dg-sum)을 붙인다.
function summaryHtml(g) { return `<b>월급 적립</b>${tip(introTip(g))}<small class="dg-asof">세법 ${esc(g.checked.slice(0, 7))} 기준</small><small class="dg-sum" id="dg-sum"></small>`; }
function template(g, { inFold = false } = {}) {
  const p = g.tax.pension, isa = g.tax.isa;
  return `${inFold ? '' : `<header><h3>월급 적립 ${tip(introTip(g))}</h3><span class="dg-asof">세법 ${esc(g.checked.slice(0, 7))} 기준</span></header>`}
  <div class="dg-in">
    <label><span>매달 넣을 돈 <b class="dg-k" id="dg-monthly-k"></b></span><input id="dg-monthly" type="number" min="0" step="10000" inputmode="numeric" aria-label="매달 넣을 돈(원)"></label>
    <label><span>연봉(세전, 만 원) ${tip(`원천징수영수증의 '총급여'입니다. 월급이 없으면 비워 둡니다.\n${man(p.lowSalary)} 이하면 연금저축 공제율 ${(p.rateLow * 100).toFixed(1)}%, 넘으면 ${(p.rateHigh * 100).toFixed(1)}%.\n${man(isa.lowSalary)} 이하면 서민형 ISA(비과세 ${man(isa.taxFreeLow)})를 쓸 수 있습니다(가입하는 증권사에서 확인).`)}</span><input id="dg-salary" type="number" min="0" step="100" inputmode="numeric" placeholder="월급 없으면 비움" aria-label="연봉(만 원)"></label>
    <label><span>그중 ${p.lockAge}세까지 안 꺼낼 돈 <b class="dg-k" id="dg-old-k"></b>${tip(`노후용 돈입니다. 연금저축·IRP에 넣습니다.\n${p.lockAge}세 전에 꺼내면 돌려받은 세금과 이익에 ${(p.earlyTax * 100).toFixed(1)}%를 다시 냅니다.\n${p.lockAge}세 뒤 연금으로 받으면 세금은 ${p.laterTax}만 냅니다.`)}</span><input id="dg-old" type="number" min="0" step="10000" inputmode="numeric" aria-label="그중 노후용(원)"><span class="dg-chips"><button type="button" data-old="all">전부</button><button type="button" data-old="half">절반</button><button type="button" data-old="none">0원</button></span></label>
  </div>
  <div class="dg-kpis" id="dg-kpis"></div>
  <div class="dg-grid">
    <section><h4>넣을 계좌 ${tip('세금 혜택이 큰 계좌부터 채웁니다. 노후용 돈: 연금저축 → IRP. 나머지: ISA → 일반 계좌.\n계좌 한도를 넘는 돈만 다음 계좌로 갑니다.')}</h4><ol class="dg-acc" id="dg-acc"></ol></section>
    <section><h4>살 ETF ${tip(`같은 지수를 따르는 ETF는 담긴 회사가 같아서 오래 들수록 비용 차이만 남습니다. 그래서 같은 지수 안에서는 1년 비용(실부담 비용)이 낮고 규모가 큰 ETF를 고릅니다.\n지수끼리 섞는 비율은 직접 정합니다.${g.missing ? `\n${g.missing}` : ''}`)}</h4><div id="dg-buy"></div></section>
  </div>
  <details class="dg-skip-wrap rl-in"><summary>신경 쓰지 않아도 되는 것</summary><ul class="dg-skip" id="dg-skip"></ul></details>
  <section class="dg-rule"><h4>내 적립 규칙</h4><p id="dg-rule"></p><div class="dg-actions"><button type="button" class="secondary" id="dg-copy">적립 규칙 복사</button><span id="dg-copied" class="cr-muted" role="status" aria-live="polite"></span></div></section>`;
}

function accountRows(g, r) {
  const p = g.tax.pension, isa = g.tax.isa, out = [];
  const by = id => r.plan.rows.find(x => x.id === id);
  const free = r.plan.isaLow ? isa.taxFreeLow : isa.taxFree;
  const refundTip = `연말정산 때 돌려받는 돈입니다. 그해 낸 소득세보다 많이 돌려받지는 못합니다(연봉이 낮으면 덜 받을 수 있음).\n${p.lockAge}세 전에 꺼내면 ${(p.earlyTax * 100).toFixed(1)}%를 다시 냅니다.\n출처: ${p.src.map(srcLine).join(' · ')}`;
  let n = 0;
  if (r.plan.noSalary) out.push(`<li class="off"><span class="dg-n">—</span><b>연금저축</b><em>0원</em><small>세액공제 ${(p.rateHigh * 100).toFixed(1)}~${(p.rateLow * 100).toFixed(1)}% ${tip(`월급이 생긴 해부터 1순위입니다. 넣는 돈의 ${(p.rateHigh * 100).toFixed(1)}~${(p.rateLow * 100).toFixed(1)}%를 돌려받습니다.\n${refundTip}`)}</small></li>`);
  for (const id of ['pension', 'irp', 'isa', 'general']) {
    const row = by(id); if (!(row.monthly > 0)) continue; n++;
    const head = `<span class="dg-n">${n}</span><b>${ACC[id]}</b><em>월 ${fmt(row.monthly)}</em>`;
    if (id === 'pension') out.push(`<li>${head}<small>1년에 최대 ${fmt(row.refundMax)} 돌려받음 ${tip(refundTip)}</small></li>`);
    if (id === 'irp') out.push(`<li>${head}<small>1년에 최대 ${fmt(row.refundMax)} 돌려받음 ${tip(`연금저축 한도(연 ${man(p.cap)})를 넘는 노후용 돈이 갑니다. 둘을 합쳐 연 ${man(p.capWithIrp)}까지 공제됩니다.\nIRP는 ${Math.round((1 - g.tax.irp.riskyMax) * 100)}% 이상을 예금·채권형 같은 안전자산으로 둬야 하고, 중간에 꺼내기가 연금저축보다 어렵습니다.\n${refundTip}`)}</small></li>`);
    if (id === 'isa') out.push(`<li>${head}<small>이익 ${man(free)}까지 세금 0원${r.isa.saved > 0 ? ` · ${r.isa.years}년 예시 ${fmt(r.isa.saved)} 아낌` : ''} ${tip(`일반 계좌에서는 해외 지수 ETF 이익에 ${(g.tax.general.rate * 100).toFixed(1)}%가 붙습니다. ISA는 이익 ${man(free)}까지 0원, 넘는 부분은 ${(isa.overRate * 100).toFixed(1)}%입니다.\n${isa.years}년은 유지해야 혜택이 남습니다. 넣은 원금 안에서는 중간에 꺼낼 수 있습니다. 한 해 ${man(isa.yearCap)}까지(안 쓴 한도는 다음 해로).\n한국 주식 ETF는 일반 계좌에서도 매매 이익에 세금이 없어 ISA 효과가 작습니다.${r.isa.saved > 0 ? `\n예시: 연 ${Math.round(r.isa.rate * 100)}% 오른다고 치고 ${r.isa.years}년 뒤 한 번에 판다고 볼 때(예측 아님).` : ''}\n${isa.pending}.\n출처: ${isa.src.map(srcLine).join(' · ')}`)}</small></li>`);
    if (id === 'general') out.push(`<li>${head}<small>언제든 꺼냄 ${tip(`해외 지수 ETF의 이익과 분배금에는 ${(g.tax.general.rate * 100).toFixed(1)}%가 붙고, 한국 주식 ETF는 분배금에만 붙습니다.\n이자·배당(분배금 포함)이 한 해 2,000만 원을 넘으면 다른 소득과 합쳐 세금을 계산합니다.`)}</small></li>`);
  }
  return out.join('') || '<li class="off"><span class="dg-n">—</span><b>매달 넣을 돈</b><em>0원</em><small>금액을 넣으면 계산합니다.</small></li>';
}

function buyRows(g, r) {
  const sum = g.categories.reduce((s, c) => s + (Number(r.rawMix[c.id]) || 0), 0);
  return g.categories.map(c => {
    const pk = r.picks[c.id], pct = r.rawMix[c.id] ?? 0;
    const table = `<table><thead><tr><th>ETF</th><th>1년 비용</th>${c.items.some(i => i.aumEok) ? '<th>순자산</th>' : ''}</tr></thead><tbody>${c.items.map(i => `<tr${i === pk.pick ? ' class="on"' : ''}><td>${esc(i.name)}${i === pk.pick ? ' ✓' : ''}</td><td>${i.cost.toFixed(4)}%</td>${c.items.some(x => x.aumEok) ? `<td>${i.aumEok ? `${i.aumEok.toLocaleString('ko-KR')}억${c.minAumEok && i.aumEok < c.minAumEok ? ' · 작음' : ''}` : '—'}</td>` : ''}</tr>`).join('')}</tbody></table><p class="dg-src">${esc(c.asOf)} 기준 · <a href="${esc(c.src.u)}" target="_blank" rel="noopener noreferrer">${esc(c.src.t)}</a></p>`;
    return `<div class="dg-cat"><div class="dg-cat-top"><b>${esc(c.label)} <small>${esc(c.index)}</small></b><label class="dg-pct"><input type="number" min="0" max="100" step="5" data-mix="${esc(c.id)}" value="${esc(pct)}" aria-label="${esc(c.label)} 비율(%)"><span>%</span></label></div>
      <p class="dg-pick">${pk.pick ? `<b>${esc(pk.pick.name)}</b> · 1년 비용 ${pk.pick.cost.toFixed(4)}% ${tip(`같은 지수 큰 ETF 중 가장 비싼 ${pk.dear.name}(${pk.dear.cost.toFixed(4)}%)보다 1,000만 원당 1년 ${fmt(pk.per10m)} 덜 냅니다.${pk.small ? `\n순자산 ${c.minAumEok.toLocaleString('ko-KR')}억 원 미만 ${pk.small}개는 작아서 고르지 않습니다(거래가 적고 상장폐지 위험).` : ''}\n실부담 비용 = 총보수 + 기타비용 + 매매·중개수수료. ${c.asOf} 기준 집계라 지금 값은 운용사 공시로 확인하세요.`)}` : '자료 없음'}</p>
      <details><summary>같은 지수 ${c.items.length}개 비교</summary>${table}</details></div>`;
  }).join('') + (sum !== 100 ? `<p class="dg-warn">합계 ${sum}% — 비율대로 나눠 계산합니다.</p>` : '');
}

function render(box, g, st, fold = null) {
  const r = planGuide(st, g); r.rawMix = st.mix;
  const p = g.tax.pension, $ = s => box.querySelector(s);
  const k = v => (v >= 10000 ? `${(Math.round(v / 1000) / 10).toLocaleString('ko-KR')}만 원` : v > 0 ? fmt(v) : '');
  $('#dg-monthly-k').textContent = k(r.input.monthly); $('#dg-old-k').textContent = k(r.input.oldAge);
  // 2026-11-27 보완 2: 숫자 없는 보조 설명('월급이 생기면 연금저축부터' 등)은 타일 이름 ⓘ 끝으로 옮겼다.
  const refund = r.plan.noSalary ? ['0원', '', ' 월급이 생기면 연금저축부터 채웁니다.'] : r.plan.refundMax > 0 ? [`최대 ${fmt(r.plan.refundMax)}`, `연금저축·IRP · 공제율 ${(r.plan.rate * 100).toFixed(1)}%`, ''] : ['0원', '', ' 노후용 돈을 정하면 생깁니다.'];
  // 증권사 수수료 타일은 '신경 쓰지 않아도 되는 것' 첫 줄과 같은 숫자·ⓘ라 지웠다(타일 2개).
  $('#dg-kpis').innerHTML = `<article><span>1년에 돌려받는 세금 ${tip('연금저축·IRP에 넣은 돈의 일부를 연말정산 때 돌려받습니다. 법으로 정해진 돈이라 시장과 관계없이 확정입니다(그해 낸 소득세 한도 안).' + refund[2])}</span><strong>${refund[0]}</strong>${refund[1] ? `<small>${refund[1]}</small>` : ''}</article>
    <article><span>싼 ETF로 아끼는 돈 ${tip('같은 지수 안에서 비용이 낮은 큰 ETF를 고를 때와 가장 비싼 큰 ETF를 고를 때의 1년 비용 차이입니다. 모인 돈이 커질수록 같이 커집니다.')}</span><strong>1,000만 원당 ${fmt(r.costPer10m)}</strong><small>1년 기준</small></article>`;
  // 접힘이 닫혀 있을 때 보일 한 줄: 매달 넣을 돈 · 계좌별 금액 · 돌려받는 세금(숫자 먼저).
  const sumEl = fold?.querySelector('#dg-sum');
  if (sumEl) sumEl.textContent = r.input.monthly > 0 ? `매달 ${fmt(r.input.monthly)} — ${r.plan.rows.filter(x => x.monthly > 0).map(x => `${ACC[x.id]} ${fmt(x.monthly)}`).join(' · ')} · 1년에 돌려받는 세금 ${refund[0]}` : '';
  $('#dg-acc').innerHTML = accountRows(g, r);
  $('#dg-buy').innerHTML = buyRows(g, r);
  const t = g.timing;
  $('#dg-skip').innerHTML = [
    `<li>증권사 수수료 — 한 달 ${r.brokerMonthly.toLocaleString('ko-KR')}원 ${tip(g.fees.brokerNote)}</li>`,
    `<li>사는 날·횟수 — 매일·매주·매달 차이는 최종 금액의 ${(t.frequencyMax * 100).toFixed(1)}% 이하 ${tip(t.src)}</li>`,
    `<li>떨어지길 기다리기 — 오히려 ${Math.round(t.waitDip[0] * 100)}~${Math.round(t.waitDip[1] * 100)}% 덜 모임 ${tip(t.src)}</li>`,
    `<li>배당 많은 ETF 고르기 — 배당만큼 값이 빠지고, 일반 계좌에선 세금만 먼저 냄 ${tip(`분배금은 받을 때마다 ${(g.tax.general.rate * 100).toFixed(1)}%를 떼고(일반 계좌), 한 해 금융소득 2,000만 원 기준에도 쌓입니다. ISA·연금계좌 안에서는 꺼낼 때까지 미뤄집니다.`)}</li>`,
    `<li>이미 산 ETF 갈아타기 — 1,000만 원당 1년 ${fmt(r.costPer10m)} 차이, 팔면 세금이 생김</li>`
  ].join('');
  // 2026-11-27 보완 2: 규칙 문장(복사할 전문)은 ⓘ 와 [적립 규칙 복사]에 두고, 화면에는 숫자 요약 한 줄만.
  ruleFull = r.input.monthly > 0 ? r.rule : '';
  if (ruleFull) { const buys = g.categories.filter(c => (Number(st.mix[c.id]) || 0) > 0).map(c => `${r.picks[c.id]?.pick?.name || c.label} ${st.mix[c.id]}%`); $('#dg-rule').innerHTML = `${esc([`매달 ${fmt(r.input.monthly)}`, ...r.plan.rows.filter(x => x.monthly > 0).map(x => `${ACC[x.id]} ${fmt(x.monthly)}`), ...buys, `${g.lockDays}일 잠금`].join(' · '))} ${tip(ruleFull, '적립 규칙 문장')}`; }
  else $('#dg-rule').textContent = '매달 넣을 돈을 넣으면 규칙 문장이 만들어집니다.';
  $('#dg-copy').disabled = !(r.input.monthly > 0);
  box.dataset.version = r.version;
  return r;
}

/** box: 카드 내용을 그릴 곳. fold: 카드를 감싼 접힘(details) — 주면 제목·ⓘ를 그 summary 에 두고, 닫혔을 때 보일 한 줄을 채운다. */
export async function mountDcaGuide(box, { fold = null } = {}) {
  if (!box) return;
  let g = null;
  try { const res = await fetch('/data/dca-guide.json?v=DG1'); g = res.ok ? await res.json() : null; } catch { g = null; }
  if (!g?.categories?.length) { (fold || box).remove(); return; }
  const saved = load() || {};
  const st = { monthly: saved.monthly ?? 300000, salaryMan: saved.salaryMan ?? '', oldAge: saved.oldAge ?? '', mix: saved.mix && typeof saved.mix === 'object' ? saved.mix : { [g.categories[0].id]: 100 } };
  for (const c of g.categories) if (!(c.id in st.mix)) st.mix[c.id] = 0;
  const head = fold?.querySelector(':scope > summary'); if (head) head.innerHTML = summaryHtml(g);
  box.innerHTML = template(g, { inFold: !!head });
  const $ = s => box.querySelector(s);
  $('#dg-monthly').value = st.monthly; $('#dg-salary').value = st.salaryMan; $('#dg-old').value = st.oldAge;
  const update = () => { store(st); render(box, g, st, fold); };
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'dg-monthly') st.monthly = t.value === '' ? 0 : Number(t.value);
    else if (t.id === 'dg-salary') st.salaryMan = t.value;
    else if (t.id === 'dg-old') st.oldAge = t.value;
    else if (t.dataset.mix) st.mix[t.dataset.mix] = t.value === '' ? 0 : Number(t.value);
    else return;
    update();
  });
  box.addEventListener('click', e => {
    const chip = e.target.closest('[data-old]');
    if (chip) { const m = Number(st.monthly) || 0; st.oldAge = chip.dataset.old === 'all' ? m : chip.dataset.old === 'half' ? Math.round(m / 2 / 1000) * 1000 : 0; $('#dg-old').value = st.oldAge; update(); return; }
    if (e.target.closest('#dg-copy')) {
      const text = ruleFull, done = ok => { $('#dg-copied').textContent = ok ? '복사함' : '문장을 길게 눌러 복사하세요'; };
      try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch { done(false); }
    }
  });
  render(box, g, st, fold);
}
